import { randomUUID } from "node:crypto";
import { ligarDecisaoATarefa } from "./tarefa-casa.ts";
import type { Concessao } from "../contracts/concessao.ts";
import type { Assunto } from "../contracts/destino-no-chat.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { ItemAprovacao } from "../contracts/item-aprovacao.ts";
import type { DesfechoItem, MotivoAprovacaoManual } from "../contracts/motivos.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import { montarItens, type PropostaItem } from "../domain/aprovacao-item.ts";
import { MOTIVO_ITEM_DE_APROVACAO, MOTIVO_LOTE_MISTO } from "../domain/decisoes.ts";
import { acaoArriscadaNoApp, decidirLote, envioParaForaNoApp, REGRA_APROVACAO_PERMANENTE, sempreServe, type DecisaoAutomatica } from "../domain/aprovacao-permanente.ts";
import { aPedidoDeOutraPessoa, modoNoTurno, REGRA_MODO_AUTOMATICO, REGRA_MODO_TOTAL, REGRA_REVISOR } from "../domain/modo-aprovacao.ts";
import { RISCO_APAGAR_NO_APP, RISCO_DO_GATILHO } from "../domain/revisor.ts";
import { conectorTocaDadoPessoal } from "../domain/dado-pessoal.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { errosDoSchema } from "../domain/schema-args.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { executarItens, type DesfechoExecutado, type ItemAExecutar } from "./decidir.ts";
import { limparFalhasDosExecutados } from "./disjuntor-conector.ts";
import { JANELA_CONVERSA_DE_FORA_MS, medirRevisao } from "./medir-revisao.ts";
import { revisarAcaoFase1, type PedidoNaFila } from "./revisar-acao.ts";
import { PRAZO_DECISAO_MS } from "./pedir-a-pessoa.ts";
import { semprePermitirVivo } from "./regras-vivas.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import { ferramentaDoItem, registrarAutorizadosNaMaquina, registrarCartoes } from "./trilha-decisoes.ts";
import type { Deps } from "./tipos.ts";

/**
 * Aprovação em LISTA tipada (E4.1/E4.2, EMENDA 23): cada item vira linha própria em itens_aprovacao
 * com destino tipado; origem sensível (declaração do conector de ORIGEM, nunca o texto — ADR-002)
 * nasce desmarcada com justificativa fixa do sistema. O destino tem que existir no catálogo do
 * conector registrado (o agente nunca inventa escopo, E6.2).
 *
 * ADR-042: antes de criar a pendência, a regra NOMEADA decide item a item sobre o plano JÁ PUXADO
 * (avaliação local, nunca consulta por chamada — ADR-013). Quando TODO o lote passa, a decisão nasce
 * FECHADA (`estado: 'decidida'`, `decidida_por` NULO porque nenhuma pessoa decidiu) e o turno segue
 * sem morrer no long-poll. Quando qualquer item precisa de gente, o lote inteiro pergunta — executar
 * metade deixaria o mundo meio mudado sem desfazer — e cada item guarda o motivo de ter parado.
 */
/**
 * definido em 2026-09-21: a classificação por origem (ADR-002) fica DESLIGADA — decisão do Marlon,
 * de que o nod não está sendo construído para tratar dado pessoal sensível. Nenhum item novo nasce
 * sensível, então o CHECK item_sensivel_marcado_exige_pessoa vira vacuamente verdadeiro.
 *
 * NEUTRALIZADA, não removida, e isso é deliberado. Remover custaria ~78 arquivos e migração nova,
 * com quatro efeitos irreversíveis: `origem_sensivel` é carimbo do instante da criação e não há
 * coluna que guarde qual conector originou o item (architecture.html:224 — "impossível de
 * retroagir"); a trilha é imutável por trigger e já gravou `sensiveis: N` por evento (ADR-004);
 * mensagens de resultado já escritas trazem "(sensível, não aprovado)" no texto; e o Postgres não
 * remove valor de enum. Deixando a coluna e o CHECK, o histórico continua legível e voltar atrás
 * é esta constante.
 *
 * O que NÃO sai daqui, porque não depende desta premissa: trilha sem texto livre, erro que não ecoa
 * `message` e rótulo de métrica em união fechada valem para qualquer titular (ADR-002 refinamento,
 * ADR-004, ADR-017). Fica em aberto o parecer jurídico nomeado em product-spec.html:456 e o art. 14
 * da LGPD (architecture.html:545), que nenhum ADR cobre.
 */
const CLASSIFICAR_ORIGEM_SENSIVEL = false;

/**
 * NOD-263: o lote que a regra aprovou sozinha, com a decisão JÁ FECHADA na fase 1 (nunca aparece em "Sua vez" nem expira).
 * Os itens rodam FORA da tx (`executarItens`) e o desfecho entra na fase 2, numa tx nova (`assentarLoteAutomatico`).
 */
export type LoteAutomatico = {
  decisaoId: string;
  conversaId: string;
  turnoId: string;
  agenteId: string;
  aExecutar: ItemAExecutar[];
  regra: `regra:${string}`;
  regraVersao: number;
};

type EntradaPedido = Parameters<CasoNod<Deps, "pedir_aprovacao">>[1];
type SaidaPedido = Awaited<ReturnType<CasoNod<Deps, "pedir_aprovacao">>>;

/**
 * A fase 1 devolve a saída final (pendente, recusada), o lote automático a executar fora da tx ou (ADR-115, PR 5) o lote
 * EM REVISÃO: a decisão `em_revisao` e o pedido que a rota entrega ao executor do revisor depois do commit (nulo = cartão na hora).
 */
export type SaidaFase1Pedido = { saida: SaidaPedido } | { lote: LoteAutomatico } | { revisao: { aguardar: string; fila: PedidoNaFila | null }; events: RuntimeEvent[] };

/**
 * NOD-443 (revisão 8 do PR #628): o turno da tarefa que quem participa do quadro pediu (o bot da dona sob a procuração
 * dela) só pede aprovação enquanto ela participa. A dona tirou a pessoa do quadro: o pedido dela deixou de valer, e o
 * cartão não chega à dona. Turno sob procuração que não é de tarefa de quadro (sem quadro) segue como antes.
 */
async function quemPediuSaiuDoQuadro(deps: Deps, turnoId: string): Promise<boolean> {
  const turno = await deps.repos.turnos.buscar(turnoId);
  if (!turno || !aPedidoDeOutraPessoa(turno.sobProcuracaoDe, deps.escopo.pessoaId) || !turno.sobProcuracaoDe) return false;
  const q = await deps.repos.quadros.doTurno(turno.id);
  return !!q && !(await deps.repos.quadros.ehMembro(q.id, turno.sobProcuracaoDe));
}

/** `comRevisor`: só o caminho da ferramenta (a rota interna sabe esperar a revisão e enfileirar o pedido); os outros, como hoje. */
const montarFase1 = (computador: boolean, comRevisor = false) => async (deps: Deps, input: EntradaPedido): Promise<SaidaFase1Pedido> => {
  const agora = deps.agora();
  if (!Array.isArray(input.itens) || input.itens.length === 0) throw new ErroDeDominio("entrada_invalida", { cause: "itens vazios" });
  if (await quemPediuSaiuDoQuadro(deps, input.turnoId)) {
    return { saida: { data: { estado: "recusada", erros: ["quem pediu esta tarefa não participa mais do quadro: o pedido deixou de valer"], instrucao: "não peça de novo; encerre o turno" }, events: [] } };
  }
  const propostas: PropostaItem[] = [];
  const conectorIdPorIdx: (string | null)[] = [];
  // ADR-059: a capacidade de destino é arriscada (apagar, merge, aprovar PR)? Lido do catálogo do CONECTOR.
  const arriscadaPorIdx: boolean[] = [];
  // PR 1 dos modos de aprovação (medir antes): a escrita que manda algo para fora (envioParaForaNoApp).
  const envioPorIdx: boolean[] = [];
  let concessoes: Concessao[] | undefined;
  // definido em 2026-09-30 (ADR-062): argumentos conferidos contra o schema do conector ANTES do card. Sem isso, um
  // item sem campo obrigatório virava card, falhava depois do clique e o bot pedia de novo igual (o Milton teve 6
  // comentários sem `assignee` hoje, 6 cards). Volta ao bot como resposta, não como exceção: o `cause` de um erro de
  // domínio só vai para o log (AGENTS.md: erro nunca vaza `message`), e o bot precisa ler o que corrigir.
  const errosDeArgs: string[] = [];
  for (const [idxItem, item] of input.itens.entries()) {
    if (item.destino.conector === "computador") {
      if (!computador) throw new ErroDeDominio("nao_permitido");
      const id = item.destino.argumentos?.acaoId;
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id) || item.destino.ferramenta !== "executar") throw new ErroDeDominio("entrada_invalida");
      const c = await deps.repos.computadores.obter(input.agenteId);
      const a = await deps.repos.computadores.buscarAcao(id);
      if (!c || !a || a.computadorId !== c.id || a.turnoId !== input.turnoId || a.estado !== "pendente") throw new ErroDeDominio("nao_permitido");
      propostas.push({ texto: item.texto, destino: item.destino, origemSensivel: false });
      conectorIdPorIdx.push(null);
      arriscadaPorIdx.push(false);
      envioPorIdx.push(false);
      continue;
    }
    const conector = await deps.repos.conectores.buscarPorSlug(item.destino.conector);
    if (!conector) throw new ErroDeDominio("entrada_invalida", { cause: `conector ${item.destino.conector} não registrado` });
    const capacidade = conector.catalogo.find((c) => c.nome === item.destino.ferramenta);
    if (!capacidade) {
      throw new ErroDeDominio("entrada_invalida", { cause: `ferramenta ${item.destino.ferramenta} fora do catálogo de ${conector.slug}` });
    }
    // definido em 2026-09-24 (revisão da ADR-047): o catálogo do CONECTOR não é o do agente. Sem concessão,
    // um clique em "Pode fazer" executava uma ferramenta que a pessoa nunca deu a ele; pede acesso antes.
    concessoes ??= await deps.repos.concessoes.doAgente(input.agenteId);
    if (!concessoes.some((c) => c.conectorId === conector.id && c.capacidade === item.destino.ferramenta)) {
      throw new ErroDeDominio("nao_permitido", { cause: `sem concessão de ${conector.slug}.${item.destino.ferramenta}: peça com pedir_acesso` });
    }
    errosDeArgs.push(...errosDoSchema(capacidade.schema, item.destino.argumentos ?? {}, `itens[${idxItem}].destino.argumentos (${conector.slug}.${item.destino.ferramenta})`));
    let origemSensivel = false;
    if (CLASSIFICAR_ORIGEM_SENSIVEL && item.origem_conector) {
      const origem = await deps.repos.conectores.buscarPorSlug(item.origem_conector);
      // Origem desconhecida = fail-closed: trata como sensível (ADR-002: não declarou = toca).
      origemSensivel = origem ? conectorTocaDadoPessoal(origem) : true;
    }
    // ADR-048: carimbado na criação pelo plano JÁ PUXADO — a ferramenta que roda no gh do Mac deste
    // turno roda lá também quando aprovada; o agente não escolhe onde.
    const naMaquina = input.plano?.catalogo.ferramentas.some((f) => f.nome === `${conector.slug}__${item.destino.ferramenta}` && f.conectorId === conector.id && f.execucao === "maquina") === true;
    propostas.push({
      texto: item.texto,
      destino: { conector: conector.slug, ferramenta: item.destino.ferramenta, argumentos: item.destino.argumentos ?? {}, ...(naMaquina ? { execucao: "maquina" as const } : {}) },
      origemSensivel,
    });
    conectorIdPorIdx.push(conector.id);
    arriscadaPorIdx.push(acaoArriscadaNoApp(capacidade));
    envioPorIdx.push(envioParaForaNoApp(capacidade));
  }

  if (errosDeArgs.length > 0) return { saida: { data: { estado: "recusada", erros: errosDeArgs, instrucao: "corrija os argumentos e chame pedir_aprovacao de novo" }, events: [] } };

  // ADR-052 (0033): turno que trouxe a web pelas nativas não usa "Sempre permitir" — a mesma regra do não confiável.
  const contaminado = input.plano ? await deps.repos.turnos.contaminado(input.turnoId) : false;
  const planoDoTurno = input.plano && contaminado ? { ...input.plano, confiancaEntrada: "nao_confiavel" as const } : input.plano ?? null;
  // ADR-062: as regras "Sempre permitir" de AGORA, não as congeladas no plano — o clique vale já neste turno.
  const plano = planoDoTurno ? { ...planoDoTurno, semprePermitir: await semprePermitirVivo(deps, input.agenteId, planoDoTurno) } : null;
  // ADR-059: o modo ATUAL do agente, não o do plano — trocar para mais restrito vale já na próxima ação.
  const agente = plano ? await deps.repos.agentes.buscar(input.agenteId) : null;
  // NOD-443 (ADR-143, revisão 3): no turno a pedido de outra pessoa vale o manual, qualquer que seja o modo da dona.
  const modo = modoNoTurno(agente?.modoAprovacao, plano?.autoria) ?? "manual";
  if (input.plano) {
    // O lote vai ao revisor uma vez só (lote misto pergunta tudo, numa revisão só): arriscado se algum item é, senão envio.
    const candidatos = arriscadaPorIdx.filter((a, idx) => a || envioPorIdx[idx] === true).length;
    await medirRevisao(deps, input.plano, modo, { origem: "app", via: "pedido", arriscada: arriscadaPorIdx.some(Boolean), credencial: false, envioParaFora: envioPorIdx.some(Boolean), contaminado: contaminado || input.plano.confiancaEntrada !== "confiavel", itens: candidatos });
  }
  // ADR-115 (PR 5 dos modos de aprovação): o revisor do Automático no lote — a chave ligada, o modo atual automático e o
  // caminho da ferramenta. Desligada, a decisão é a de hoje, byte a byte. O "contaminado" do envio olha também a conversa
  // nas últimas 24 h (revisão de engenharia 11); a leitura que falha conta como lida (vai ao revisor).
  const revisor = comRevisor && input.plano !== undefined && input.plano !== null && deps.services.revisor?.config.ligado === true && modo === "automatico";
  const contaminadoTurno = contaminado || (input.plano?.confiancaEntrada ?? "confiavel") !== "confiavel";
  const contaminadoParaRevisor = revisor && !contaminadoTurno && envioPorIdx.some(Boolean)
    ? await deps.repos.turnos.conversaLeuDeFora(input.conversaId, { agora, janelaMs: JANELA_CONVERSA_DE_FORA_MS }).catch(() => true)
    : contaminadoTurno;
  const { automatico, revisar, porItem } = decidirLote(propostas.map((p, idx) => ({
    plano, destino: p.destino, origemSensivel: p.origemSensivel, modo, arriscada: arriscadaPorIdx[idx] === true,
    ...(revisor ? { revisor, envioParaFora: envioPorIdx[idx] === true, contaminadoParaRevisor } : {}),
  })));
  if (revisar && input.plano) {
    // O lote inteiro numa revisão só (lote misto continua perguntando tudo, ADR-042): um pedido ao revisor com todos os
    // itens e o resumo que o bot escreveu; "pede" leva o lote ao cartão, "libera" roda o lote como o automático.
    const r = await revisarAcaoFase1(deps, {
      plano: input.plano,
      tipo: "app",
      itens: propostas.map((p, idx) => ({ texto: p.texto, destino: p.destino, sempreServe: sempreServe({ destino: p.destino, arriscada: arriscadaPorIdx[idx] === true }, contaminadoTurno) })),
      acao: { tipo: "apps", itens: propostas.map((p) => ({ app: p.destino.conector, ferramenta: p.destino.ferramenta, argumentos: p.destino.argumentos, textoDoItem: p.texto })), resumo: input.resumo },
      gatilho: revisar,
      risco: revisar === "arriscado" ? RISCO_APAGAR_NO_APP : RISCO_DO_GATILHO.envio_apos_fora,
      contaminado: contaminadoParaRevisor,
      frase: input.resumo,
      agente: agente ? { nome: agente.nome, titulo: agente.titulo, descricao: agente.descricao } : null,
    });
    return { revisao: { aguardar: r.data.aguardar, fila: r.data.revisao }, events: r.events ?? [] };
  }

  const decisao = await deps.repos.decisoes.criar({
    tipo: "aprovacao",
    agenteId: input.agenteId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    prazoDecisaoEm: agora + PRAZO_DECISAO_MS,
    frase: input.resumo,
  });
  if (!decisao) throw new Error("decisão não criada");
  const itens = montarItens({ tenantId: deps.escopo.tenantId, decisaoId: decisao.id, propostas, agora });

  if (!automatico) {
    await deps.repos.itensAprovacao.criarLote(
      decisao.id,
      itens.map((i, idx) => ({ idx: i.idx, texto: i.textoOriginal, destino: i.destino, origemSensivel: i.origemSensivel, justificativa: i.justificativa, motivoManual: motivoDe(porItem[idx]) })),
    );
    // NOD-70: cada item que parou no cartão vira linha `cartao` com o motivo, na tx em que o cartão nasce. O item que
    // seria automático e parou porque o lote tem outro que precisa da pessoa (ADR-042) leva `lote_misto`.
    await registrarCartoes(deps, { agenteId: input.agenteId, turnoId: input.turnoId, itens: itens.map((i, idx) => ({ destino: i.destino, motivo: motivoDe(porItem[idx]) ?? MOTIVO_LOTE_MISTO })) });
    // ADA-28 (ADR-159): a aprovação que parou na pessoa durante uma tarefa é a espera dela (um único "Precisa de você").
    const daTarefa = await ligarDecisaoATarefa(deps, decisao);
    return { saida: { data: { estado: "pendente", decisao_id: decisao.id, instrucao: "encerre o turno; a decisão retoma depois" }, events: [eventoCriada(deps, input, decisao.id, itens, agora), ...daTarefa] } };
  }

  // Lote automático (NOD-263): a fase 1 cria os itens e FECHA a decisão por regra; o efeito sai daqui sem banco.
  const criados = await deps.repos.itensAprovacao.criarLote(
    decisao.id,
    itens.map((i) => ({ idx: i.idx, texto: i.textoOriginal, destino: i.destino, origemSensivel: i.origemSensivel, justificativa: i.justificativa })),
  );
  const rotina = (await rotinaDoTurno(deps.repos, input.turnoId)) !== null;
  // decidida_por fica NULO: nenhuma PESSOA decidiu. Quem decidiu está em decidido_por da autoria,
  // com a versão da regra (ADR-023: autoria não se infere de outro campo).
  // A regra que MAIS concede manda no registro: se a pessoa criou uma permissão, é ela que
  // responde "sob que autoridade isto saiu?", mesmo que outros itens tenham passado por leitura.
  // ADR-059: o modo do bot concede mais que a regra por ferramenta — total, depois automático, depois a permanente.
  const quemMaisConcede = [REGRA_MODO_TOTAL, REGRA_MODO_AUTOMATICO, REGRA_APROVACAO_PERMANENTE]
    .map((r) => porItem.find((d) => d.automatico && d.regra === r))
    .find((d) => d !== undefined);
  const regra = quemMaisConcede?.automatico ? quemMaisConcede.regra : primeiraRegra(porItem);
  const regraVersao = quemMaisConcede?.automatico ? quemMaisConcede.versao : primeiraVersao(porItem);
  await deps.repos.decisoes.fecharPorRegra(decisao.id, { regra, regraVersao, agora });
  const lote: LoteAutomatico = {
    decisaoId: decisao.id,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    agenteId: input.agenteId,
    aExecutar: criados.map((item, idx) => {
      const d = porItem[idx];
      return { item, conectorId: conectorIdPorIdx[idx] ?? null, dono: deps.escopo, rotina, ...(d?.automatico ? { regra: d.regra, regraVersao: d.versao } : {}) };
    }),
    regra,
    regraVersao,
  };
  await registrarAutorizadosNaMaquina(deps, lote);
  return { lote };
};

export type EntradaAssentarLote = { lote: LoteAutomatico; desfechos: readonly DesfechoExecutado[] };

/**
 * FASE 2 do lote automático (NOD-263), numa tx NOVA: grava o desfecho por item só se ainda aberto (`desfecho is null`) e
 * escreve a fala "Fiz sem perguntar" + o evento `mensagem_criada` só quando ESTA fase gravou algum desfecho — repetir a
 * fase (retry da escrita depois de banco_ocupado) não reescreve desfecho nem duplica a mensagem. Nunca reexecuta o efeito
 * (ADR-009). Item que roda no gh do Mac sem desfecho deixa a decisão pendente para o turno, como antes.
 */
export const assentarLoteAutomatico = async (deps: Deps, input: EntradaAssentarLote): Promise<SaidaPedido> => {
  const agora = deps.agora();
  const { lote, desfechos } = input;
  let gravados = 0;
  const criados = lote.aExecutar.map((a) => a.item);
  const regraDoItem = new Map(lote.aExecutar.map((a) => [a.item.id, a]));
  for (const d of desfechos) {
    if (!(await deps.repos.itensAprovacao.registrarDesfechoSeAberto(d.itemId, d.desfecho))) continue;
    gravados++;
    // NOD-70: o item que esta fase gravou vai à trilha com a regra que o liberou (a do item; senão a do lote). Só quem foi
    // gravado agora: a fase repetida não duplica a linha. O item do Mac já foi à trilha na autorização
    // (registrarAutorizadosNaMaquina); no modo local ele chega aqui com desfecho e não pode gravar de novo (revisão 6).
    const a = regraDoItem.get(d.itemId);
    if (!a || a.item.destino.execucao === "maquina" || (d.desfecho !== "executado" && d.desfecho !== "falhou_na_execucao")) continue;
    await deps.repos.trilha.registrar({
      agenteId: lote.agenteId,
      turnoId: lote.turnoId,
      conectorId: a.conectorId,
      ferramenta: ferramentaDoItem(a.item.destino),
      kind: "tool_call",
      motivo: MOTIVO_ITEM_DE_APROVACAO,
      regra: a.regra ?? lote.regra,
      regraVersao: a.regraVersao ?? lote.regraVersao,
      em: agora,
    });
  }
  // Revisão 7 do PR #538 (NOD-374): o item do lote que deu certo fecha a falha do app, como a chamada direta.
  const desfechoDe = new Map(desfechos.map((d) => [d.itemId, d.desfecho]));
  await limparFalhasDosExecutados(deps, lote.aExecutar.filter((a) => a.conectorId !== null).map((a) => ({ slug: a.item.destino.conector, desfecho: desfechoDe.get(a.item.id) ?? null })), lote.agenteId);
  // ADR-048: item que roda no gh do Mac (servidor compartilhado) ainda não tem desfecho: o turno espera
  // pelo long-poll de `aguardar` enquanto o app desktop da pessoa executa; a fala "Fiz sem perguntar"
  // sai quando o Mac relatar (itens-na-maquina.ts).
  if (criados.some((i) => i.selecionado && i.destino.execucao === "maquina" && !desfechos.some((d) => d.itemId === i.id))) {
    return { data: { estado: "pendente", decisao_id: lote.decisaoId, instrucao: "encerre o turno; a decisão retoma depois" }, events: [] };
  }
  // definido em 2026-10-15 (NOD-255, C18): todos os itens já têm desfecho e o resultado volta NESTE turno (a resposta
  // da ferramenta) — quem continua é o turno. Sem a reivindicação, o assentamento (continuarAprovacoesDoTurno, 0032)
  // via a decisão como "decidida e não continuada" e enfileirava uma retomada redundante, que rodava a rotina de novo.
  // O caso do item no Mac (acima) não reivindica: ali a retomada é o caminho legítimo do resultado. Idempotente
  // (só grava se continuada_em is null), então vem antes do retorno de fase repetida.
  await deps.repos.decisoes.reivindicarContinuacao(lote.decisaoId, "turno", agora);
  const resultado = { estado: "decidida" as const, itens: desfechos.map((d, idx) => ({ idx, desfecho: d.desfecho })) };
  if (gravados === 0) return { data: resultado, events: [] };

  const autoria = autoriaDoAgente(deps.escopo, lote.agenteId, { decididoPor: lote.regra, regraVersao: lote.regraVersao });
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: lote.conversaId,
    turnoId: lote.turnoId,
    kind: "resultado_aprovacao",
    assunto: assuntoDoReciboAutomatico(criados, desfechos),
    texto: textoAutomatico(criados, desfechos, lote.regra),
    confianca: "confiavel",
    autoria,
  });

  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "mensagem_criada",
    autoria,
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: lote.conversaId,
    turnoId: lote.turnoId,
    dados: { decisao_id: lote.decisaoId, mensagem_id: mensagem?.id ?? null, itens: criados.length, executados: desfechos.filter((d) => d.desfecho === "executado").length },
  };
  return { data: resultado, events: [evento] };
};

/**
 * Fase 1 do pedir_aprovacao chamado pela ferramenta (NOD-263): a rota interna executa o lote fora da tx e assenta numa nova.
 * O caminho do computador não passa aqui — ele nunca é automático (sem plano, o modo é manual).
 */
export const pedirAprovacaoFase1 = montarFase1(false, true);

/**
 * Composição em UMA tx (fase 1 → executarItens → fase 2) para quem já está fora do caminho da ferramenta: o computador (que
 * nunca é automático) e os testes. Com tx escopada aberta e lote automático, a guarda de `executarItens` acusa.
 */
const montarPedido = (computador: boolean): CasoNod<Deps, "pedir_aprovacao"> => async (deps, input) => {
  const f = await montarFase1(computador)(deps, input);
  if ("saida" in f) return f.saida;
  // Sem `comRevisor` a fase 1 nunca manda ao revisor; se mandasse, a decisão `em_revisao` espera como o `pendente`.
  if ("revisao" in f) return { data: { estado: "pendente", decisao_id: f.revisao.aguardar, instrucao: "encerre o turno; a decisão retoma depois" }, events: f.events };
  const desfechos = await executarItens(deps.services, f.lote.aExecutar);
  return assentarLoteAutomatico(deps, { lote: f.lote, desfechos });
};

const motivoDe = (d: DecisaoAutomatica | undefined): MotivoAprovacaoManual | null => (d && !d.automatico ? d.motivo : null);
const primeiraRegra = (ds: readonly DecisaoAutomatica[]): `regra:${string}` => {
  const a = ds.find((d) => d.automatico);
  return a?.automatico ? a.regra : REGRA_APROVACAO_PERMANENTE;
};
const primeiraVersao = (ds: readonly DecisaoAutomatica[]): number => {
  const a = ds.find((d) => d.automatico);
  return a?.automatico ? a.versao : 1;
};

/** ADR-059: o modo que aprovou vai na fala, para quem lê de manhã saber por que nada pediu clique. */
const PELO_MODO: Readonly<Record<string, string>> = {
  [REGRA_MODO_AUTOMATICO]: " · aprovação automática",
  [REGRA_MODO_TOTAL]: " · sem aprovações",
  // ADR-115 (PR 5): o revisor do Automático liberou (a linha do revisor, PR 4, diz o porquê; esta vai à Atividade).
  [REGRA_REVISOR]: " · o revisor liberou",
};

/**
 * Chat limpo (PR 1, decisão 10): o recibo do que uma regra aprovou sozinha vai para a Atividade quando tudo saiu; com um
 * item que falhou na execução ele fica no chat — uma ação em nome da pessoa que não saiu.
 */
export function assuntoDoReciboAutomatico(itens: readonly Pick<ItemAprovacao, "id">[], desfechos: readonly { itemId: string; desfecho: DesfechoItem }[]): Assunto {
  // O mesmo critério de textoAutomatico: item sem desfecho conta como falhou na execução.
  const falhou = itens.some((i) => (desfechos.find((d) => d.itemId === i.id)?.desfecho ?? "falhou_na_execucao") === "falhou_na_execucao");
  return falhou ? "aprovacao.automatica_falhou" : "aprovacao.automatica";
}

/** Fala na conversa do que saiu sem perguntar: "precisa ficar no chat" foi requisito explícito. */
export function textoAutomatico(itens: readonly ItemAprovacao[], desfechos: readonly { itemId: string; desfecho: DesfechoItem }[], regra?: string): string {
  const linhas = itens.map((i) => {
    const d = desfechos.find((x) => x.itemId === i.id)?.desfecho ?? "falhou_na_execucao";
    return `- ${i.textoFinal} (${i.destino.conector}.${i.destino.ferramenta}): ${d.replaceAll("_", " ")}`;
  });
  return `Fiz sem perguntar (${itens.length === 1 ? "1 ação" : `${itens.length} ações`})${(regra && PELO_MODO[regra]) ?? ""}:\n${linhas.join("\n")}`;
}

function eventoCriada(deps: Deps, input: { agenteId: string; conversaId: string; turnoId: string }, decisaoId: string, itens: readonly ItemAprovacao[], agora: number): RuntimeEvent {
  return {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "decisao_criada",
    autoria: autoriaDoAgente(deps.escopo, input.agenteId),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    dados: { decisao_id: decisaoId, tipo: "aprovacao", itens: itens.length, sensiveis: itens.filter((i) => i.origemSensivel).length },
  };
}

export const pedirAprovacao = montarPedido(false);
export const pedirAprovacaoComputador = montarPedido(true);
