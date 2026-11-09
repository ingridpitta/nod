import { randomUUID } from "node:crypto";
import type { Decisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { ItemAprovacao } from "../contracts/item-aprovacao.ts";
import type { DesfechoItem } from "../contracts/motivos.ts";
import type { Turno } from "../contracts/turno.ts";
import { argumentosComTextoFinal, mesmaAcao, redigirDesfechoAprovacao } from "../domain/aprovacao-desfecho.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { exigirForaDaTx } from "../db/tx.ts";
import { redigir } from "../domain/redacao.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { limparFalhasDosExecutados } from "./disjuntor-conector.ts";
import { enfileirarRetomada } from "./enfileirar-retomada.ts";
import { fecharGemeas } from "./fechar-gemeas.ts";
import { PRAZO_DECISAO_MS } from "./pedir-a-pessoa.ts";
import { autoriaDaPessoa } from "./registrar-negacao.ts";
import type { CasoDeUso, Deps, Services } from "./tipos.ts";
import { sincronizarDasDecisoes } from "./trabalhos.ts";
import { registrarCliques } from "./trilha-decisoes.ts";

export type MarcacaoItem = { id: string; selecionado: boolean; textoFinal?: string };

export type EntradaDecidir = { decisaoId: string; itens?: MarcacaoItem[] };

/** Item pronto para executar FORA da transação (conector resolvido por slug ainda dentro dela). */
export type ItemAExecutar = {
  item: ItemAprovacao;
  conectorId: string | null;
  computador?: { tenantId: string; pessoaId: string; agenteId: string; turnoId: string; acaoId: string };
  /** ADR-048: a dona da decisão — item `execucao: "maquina"` só roda no gh do Mac DELA. */
  dono?: { tenantId: string; pessoaId: string };
  /** NOD-70: a regra que liberou ESTE item no lote automático (a trilha grava por item; o lote guarda a que mais concede). */
  regra?: string;
  regraVersao?: number;
  /** ADR-048: a decisão veio de turno de rotina; só então o GitHub App da organização pode atender. */
  rotina?: boolean;
  /** ADR-055: comando no terminal do Mac — aprovar LIBERA; quem roda é o hook do turno, no Mac da pessoa. */
  terminal?: boolean;
  /** NOD-282 (G6): a mesma ação já saiu numa decisão posterior da mesma faixa — não chama o conector de novo. */
  jaFeito?: boolean;
};

export type SaidaMarcarEDecidir = { decisao: Decisao; itens: ItemAprovacao[]; aExecutar: ItemAExecutar[] };

export type DesfechoExecutado = { itemId: string; desfecho: DesfechoItem };

export type SaidaDecidir = {
  decisao: Decisao;
  itens: ItemAprovacao[];
  desfechos: DesfechoExecutado[];
  mensagemId: string | null;
  turnoRetomadaId: string | null;
};

/**
 * FASE 1 (na tx da rota): marca/desmarca/edita os itens (marcado_por = pessoa da sessão), fecha a
 * decisão (idempotente: já decidida → estado_invalido) e devolve o que executar. Só 'aprovacao' e
 * 'retomar_turno' são decididos aqui; perfil/rotina/gate_rotina/acesso e as três de pedir_a_pessoa
 * são compostas pela L9 com os casos de uso da L6/L7 (ver PENDENCIA-CONTRATO.md).
 */
export const marcarEDecidir: CasoDeUso<EntradaDecidir, SaidaMarcarEDecidir> = async (deps, input) => {
  const agora = deps.agora();
  const decisao = await deps.repos.decisoes.buscar(input.decisaoId);
  if (!decisao) throw new ErroDeDominio("nao_encontrado", { cause: "decisão" });
  if ((await deps.repos.agentes.buscar(decisao.agenteId, true))?.excluidoEm || (decisao.turnoId && await deps.repos.agentes.execucaoBloqueada(decisao.turnoId))) throw new ErroDeDominio("estado_invalido");
  if (decisao.estado !== "pendente" && decisao.estado !== "reaberta") throw new ErroDeDominio("estado_invalido", { cause: `decisão ${decisao.estado}` });
  if (decisao.tipo !== "aprovacao" && decisao.tipo !== "retomar_turno") {
    throw new ErroDeDominio("estado_invalido", { cause: `decisão do tipo ${decisao.tipo} não é decidida por este caso de uso` });
  }
  for (const marca of input.itens ?? []) {
    const existente = await deps.repos.itensAprovacao.buscar(marca.id);
    if (!existente || existente.decisaoId !== decisao.id) throw new ErroDeDominio("entrada_invalida", { cause: `item ${marca.id} não pertence à decisão` });
    // Computador e terminal (ADR-055): aprova-se exatamente o que o bot vai fazer — o texto não se edita no card.
    if ((existente.destino.conector === "computador" || existente.destino.conector === "terminal") && marca.textoFinal !== undefined && marca.textoFinal !== existente.textoOriginal) throw new ErroDeDominio("entrada_invalida");
    const marcado = await deps.repos.itensAprovacao.marcar(marca.id, { selecionado: marca.selecionado, textoFinal: marca.textoFinal, agora });
    if (!marcado) throw new ErroDeDominio("nao_permitido", { cause: "item de outra pessoa" });
  }
  const decidida = await deps.repos.decisoes.decidir(decisao.id, { por: deps.escopo.pessoaId, agora });
  if (!decidida) throw new ErroDeDominio("estado_invalido", { cause: "decisão já decidida" });
  const itens = await deps.repos.itensAprovacao.listar(decisao.id);
  // ADR-115: o desfecho do cartão que a revisão deixou (a linha em acoes_pelo_modo, quando há; senão nada muda).
  if (decisao.tipo === "aprovacao" && itens.some(doRevisor)) {
    await deps.repos.acoesPeloModo.registrarDesfechoPessoa(decisao.id, itens.some((i) => i.selecionado) ? "aprovou" : "negou");
  }
  const aExecutar: ItemAExecutar[] = [];
  const dono = { tenantId: decisao.tenantId, pessoaId: decisao.ownerId };
  const rotina = decisao.turnoId ? (await rotinaDoTurno(deps.repos, decisao.turnoId)) !== null : false;
  // NOD-282 (G6): o que já saiu depois desta decisão, na mesma faixa — só lido se algum item de app foi aprovado.
  const deApp = (i: ItemAprovacao) => i.destino.conector !== "computador" && i.destino.conector !== "terminal";
  const depois = decisao.tipo === "aprovacao" && itens.some((i) => i.selecionado && deApp(i)) ? await deps.repos.itensAprovacao.executadosDepois(decisao.id) : [];
  for (const item of itens) {
    if (item.destino.conector === "computador") {
      if (decisao.ownerId !== deps.escopo.pessoaId || !decisao.turnoId || typeof item.destino.argumentos.acaoId !== "string") throw new ErroDeDominio("nao_permitido");
      if (!item.selecionado) await deps.repos.computadores.concluir(item.destino.argumentos.acaoId, "recusada");
      aExecutar.push({ item, conectorId: null, computador: { tenantId: decisao.tenantId, pessoaId: decisao.ownerId, agenteId: decisao.agenteId, turnoId: decisao.turnoId, acaoId: item.destino.argumentos.acaoId } });
      continue;
    }
    // ADR-055: o comando roda no Mac da DONA, pelo hook do turno dela — só ela aprova.
    if (item.destino.conector === "terminal") {
      if (decisao.ownerId !== deps.escopo.pessoaId || !decisao.turnoId) throw new ErroDeDominio("nao_permitido");
      aExecutar.push({ item, conectorId: null, terminal: true });
      continue;
    }
    if (item.selecionado && depois.some((feito) => mesmaAcao(feito, item))) {
      aExecutar.push({ item, conectorId: null, dono, rotina, jaFeito: true });
      continue;
    }
    const conector = item.selecionado ? await deps.repos.conectores.buscarPorSlug(item.destino.conector) : null;
    aExecutar.push({ item, conectorId: conector?.id ?? null, dono, rotina });
  }
  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "decisao_decidida",
    autoria: autoriaDaPessoa(deps.escopo),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: decidida.conversaId,
    turnoId: decidida.turnoId,
    dados: { decisao_id: decidida.id, tipo: decidida.tipo, selecionados: itens.filter((i) => i.selecionado).length, total: itens.length },
  };
  return { data: { decisao: decidida, itens, aExecutar }, events: [evento] };
};

export { argumentosComTextoFinal };

/**
 * Execução FORA da transação (sem banco): exatamente os itens selecionados vão ao conector
 * (E4.1); desmarcado sensível = sensivel_nao_aprovado, desmarcado comum = retirado_pela_pessoa,
 * erro ou isError do conector = falhou_na_execucao (E4.5: nunca "enviado" quando falhou).
 */
export async function executarItens(services: Pick<Services, "conectores" | "computadores" | "github">, aExecutar: readonly ItemAExecutar[]): Promise<DesfechoExecutado[]> {
  // NOD-263: o gh do Mac e o computador do bot também são efeito de fora — a guarda vale para o lote inteiro. Item de
  // terminal só libera o hook (nada sai daqui) e desmarcado não roda: sozinhos, não acusam.
  if (aExecutar.some((a) => a.item.selecionado && !a.terminal && !a.jaFeito)) exigirForaDaTx({ itens: aExecutar.length, decisao_id: aExecutar[0]?.item.decisaoId });
  const desfechos: DesfechoExecutado[] = [];
  for (const { item, conectorId, computador, dono, rotina, terminal, jaFeito } of aExecutar) {
    if (!item.selecionado) {
      desfechos.push({ itemId: item.id, desfecho: item.origemSensivel ? "sensivel_nao_aprovado" : "retirado_pela_pessoa" });
      continue;
    }
    if (jaFeito) {
      desfechos.push({ itemId: item.id, desfecho: "ja_executado" });
      continue;
    }
    // ADR-055: nada roda no servidor. "executado" é o que o hook lê para soltar o comando (autorizar-comando.ts).
    if (terminal) {
      desfechos.push({ itemId: item.id, desfecho: "executado" });
      continue;
    }
    if (item.destino.execucao === "maquina") {
      // ADR-048: roda no gh do Mac da dona. No modo local o servidor É esse Mac e executa agora; no
      // compartilhado o item fica SEM desfecho e o app desktop da dona o puxa pela ponte (itens-na-maquina.ts).
      const local = dono && services.github?.executarNaMaquina ? await services.github.executarNaMaquina(dono, item.destino.ferramenta, argumentosComTextoFinal(item)).catch(() => null) : null;
      if (local) desfechos.push({ itemId: item.id, desfecho: local.isError ? "falhou_na_execucao" : "executado" });
      continue;
    }
    if (computador) {
      try {
        if (!services.computadores) throw new ErroDeDominio("estado_invalido");
        await services.computadores.executarAprovado(computador);
        desfechos.push({ itemId: item.id, desfecho: "executado" });
      } catch { desfechos.push({ itemId: item.id, desfecho: "falhou_na_execucao" }); }
      continue;
    }
    if (!conectorId) {
      desfechos.push({ itemId: item.id, desfecho: "falhou_na_execucao" });
      continue;
    }
    try {
      const r = await services.conectores.chamar(conectorId, item.destino.ferramenta, argumentosComTextoFinal(item), { rotina: rotina === true });
      desfechos.push({ itemId: item.id, desfecho: r.isError ? "falhou_na_execucao" : "executado" });
    } catch {
      desfechos.push({ itemId: item.id, desfecho: "falhou_na_execucao" });
    }
  }
  return desfechos;
}

/**
 * NOD-285 (K2): a retomada leva os anexos da fala de origem (enfileirar-retomada), então "nada foi reenviado" seria falso
 * quando há arquivo — e, sem sessão, fazia o modelo achar que já tinha visto o anexo. Sem anexo, o texto de antes.
 */
export function fraseDoReenvio(comAnexos: boolean): string {
  return comAnexos ? "os arquivos da fala de origem seguem anexados" : "nada foi reenviado";
}

/** A entrada da retomada que continua uma aprovação: o desfecho por item, em texto fixo do servidor. */
export function entradaDaAprovacao(decisao: Decisao, itens: readonly ItemAprovacao[], texto: string, comAnexos = false): string {
  const reenvio = fraseDoReenvio(comAnexos);
  const linhas = itens.map((i) => `- item ${i.idx + 1} (${i.destino.conector}.${i.destino.ferramenta}): ${i.desfecho ?? "sem desfecho"} — ${i.textoFinal}`);
  const noComputador = itens.some((i) => i.destino.conector === "computador" && i.desfecho === "executado");
  // ADR-055: o comando aprovado depois de a espera no turno acabar ainda não rodou — o turno anterior foi negado.
  const noTerminal = itens.some((i) => i.destino.conector === "terminal" && i.desfecho === "executado");
  return [
    // definido em 2026-09-28: não é "turno interrompido" — o turno que pediu concluiu; esta é a continuação dele.
    `Continuando a tarefa: a pessoa decidiu a aprovação que você pediu; ${reenvio}.`,
    `Resultado da aprovação "${decisao.frase}" (${texto}):`,
    ...linhas,
    ...(noComputador ? ["O resultado da ação no computador não veio junto: observe a tela ou os arquivos antes de seguir."] : []),
    ...(noTerminal ? ["O comando aprovado ainda NÃO rodou: rode exatamente o mesmo comando agora — ele passa sem novo pedido."] : []),
    `Continue a partir daqui; ${reenvio}.`,
  ].join("\n");
}

/** O item veio do revisor do Automático (ADR-115): o cartão era o compacto do revisor. */
const doRevisor = (i: Pick<ItemAprovacao, "motivoManual">): boolean => i.motivoManual === "revisor_pediu" || i.motivoManual === "revisor_falhou";

function turnoCriado(deps: DepsContinuacao, turnoId: string, decisao: Decisao, autoria: RuntimeEvent["autoria"], agora: number): RuntimeEvent {
  return { tenantId: deps.escopo.tenantId, id: randomUUID(), createdAt: agora, kind: "turno_criado", autoria, pessoaDestinoId: deps.escopo.pessoaId, conversaId: decisao.conversaId, turnoId, dados: { origem: "retomada", retoma_turno_id: decisao.turnoId, decisao_id: decisao.id } };
}

/**
 * Rede de segurança (definido em 2026-09-28, 0032): o turno TERMINOU sem receber uma aprovação que já foi
 * decidida — a espera do proxy acabou um instante antes do clique, ou o turno caiu. Chamado pelo
 * assentamento do turno, sob a mesma trava da fase 2. Item ainda executando fica para a fase 2.
 */
export async function continuarAprovacoesDoTurno(deps: DepsContinuacao, turno: Turno): Promise<RuntimeEvent[]> {
  return (await continuarAprovacoes(deps, turno)).events;
}

/** O que a continuação de uma aprovação usa de Deps: o varredor de lease (laço de fundo) também a chama (NOD-261). */
export type DepsContinuacao = Pick<Deps, "repos" | "escopo" | "agora">;

/**
 * definido em 2026-10-15 (NOD-261, E2): como continuarAprovacoesDoTurno, dizendo quantas aprovações ESTA chamada
 * continuou (a retomada nova ou a juntada à que já estava na fila). O varredor usa a contagem para fechar o "Retomar" do
 * mesmo turno: a continuação já o retoma, e duas retomadas refariam o efeito externo.
 */
export async function continuarAprovacoes(deps: DepsContinuacao, turno: Turno): Promise<{ events: RuntimeEvent[]; continuadas: number }> {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  let continuadas = 0;
  for (const decisao of await deps.repos.decisoes.aContinuarDoTurno(turno.id)) {
    const itens = await deps.repos.itensAprovacao.listar(decisao.id);
    if (itens.some((i) => i.selecionado && i.desfecho === null)) continue;
    if ((await deps.repos.decisoes.reivindicarContinuacao(decisao.id, "retomada", agora)) !== "minha") continue;
    const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
    const texto = redigirDesfechoAprovacao({ itens, aprovadorNome: pessoa?.nome ?? "A pessoa", agora });
    const r = await enfileirarRetomada(deps, { original: turno, prazoEm: agora + PRAZO_DECISAO_MS, entradaTexto: entradaDaAprovacao(decisao, itens, texto, turno.entradaAnexos.length > 0) });
    if (r.turno) continuadas += 1;
    if (r.turno && r.nova) events.push(turnoCriado(deps, r.turno.id, decisao, autoriaDaPessoa(deps.escopo), agora));
  }
  return { events, continuadas };
}

export type EntradaAssentarAprovacao = { decisaoId: string; desfechos: readonly DesfechoExecutado[] };
export type SaidaAssentarAprovacao = { mensagemId: string | null; turnoRetomadaId: string | null; itens: ItemAprovacao[] };

/**
 * FASE 2 (tx nova): grava o desfecho por item, escreve a mensagem PERMANENTE 'resultado_aprovacao'
 * ("Marlon aprovou 2 de 4; não enviado: …", E4.5) e cria o turno de RETOMADA (origem 'retomada',
 * retoma_turno_id → o turno que pediu; --resume pela sessão da conversa) com prompt tipado por item.
 */
export const assentarAprovacao: CasoDeUso<EntradaAssentarAprovacao, SaidaAssentarAprovacao> = async (deps, input) => {
  const agora = deps.agora();
  const decisao = await deps.repos.decisoes.buscar(input.decisaoId);
  if (!decisao) throw new ErroDeDominio("nao_encontrado", { cause: "decisão" });
  for (const d of input.desfechos) await deps.repos.itensAprovacao.registrarDesfecho(d.itemId, d.desfecho);
  const itens = await deps.repos.itensAprovacao.listar(decisao.id);
  // NOD-70: o que a pessoa decidiu no cartão vai à trilha na mesma tx do desfecho (a fase repetida desfaz junto).
  const destinoDe = new Map(itens.map((i) => [i.id, i.destino]));
  await registrarCliques(deps, { agenteId: decisao.agenteId, turnoId: decisao.turnoId, itens: input.desfechos.flatMap((d) => { const destino = destinoDe.get(d.itemId); return destino ? [{ destino, desfecho: d.desfecho }] : []; }) });
  const executados = new Set(input.desfechos.filter((d) => d.desfecho === "executado").map((d) => d.itemId));
  await limparFalhasDosExecutados(deps, itens.filter((i) => executados.has(i.id)).map((i) => ({ slug: i.destino.conector, desfecho: "executado" })), decisao.agenteId);
  const noMac = itens.filter((i) => i.selecionado && i.desfecho === null && i.destino.execucao === "maquina");
  if (noMac.length > 0) {
    // ADR-048: aprovado, mas o efeito é do gh do Mac da dona — o resultado e a retomada saem quando
    // ele relatar (itens-na-maquina.ts), ou por expiração. Enquanto isso a conversa diz o que espera.
    const autoriaEspera = autoriaDaPessoa(deps.escopo);
    const espera = await deps.repos.mensagens.criar({
      conversaId: decisao.conversaId,
      turnoId: decisao.turnoId,
      autoria: autoriaEspera,
      kind: "sistema",
      assunto: "aprovacao.recibo",
      texto: `Aprovado. ${noMac.length === 1 ? "1 ação aguarda" : `${noMac.length} ações aguardam`} seu Mac: com o app nod aberto e o gh logado, o GitHub recebe em instantes e o resultado aparece aqui.`,
      confianca: "confiavel",
    });
    const aviso: RuntimeEvent[] = espera ? [{ tenantId: deps.escopo.tenantId, id: randomUUID(), createdAt: agora, kind: "mensagem_criada", autoria: autoriaEspera, pessoaDestinoId: deps.escopo.pessoaId, conversaId: decisao.conversaId, turnoId: decisao.turnoId, dados: { mensagem_id: espera.id, kind: "sistema", decisao_id: decisao.id, aguardando_maquina: noMac.length } }] : [];
    // Revisão do épico (S2): a decisão fechou; a task espera o Mac como qualquer turno sem nada vivo (o resultado volta
    // como retomada, que a reabre).
    return { data: { mensagemId: espera?.id ?? null, turnoRetomadaId: null, itens }, events: [...aviso, ...(await sincronizarDasDecisoes(deps, [decisao]))] };
  }
  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  const aprovadorNome = pessoa?.nome ?? "A pessoa";
  // NOD-282 (G6): tudo o que a pessoa aprovou já tinha saído numa decisão posterior — nada saiu de novo, e o bot não
  // volta para refazer: a conversa só diz que a ação já foi feita.
  const selecionados = itens.filter((i) => i.selecionado);
  const tudoJaFeito = selecionados.length > 0 && selecionados.every((i) => i.desfecho === "ja_executado");
  const texto = tudoJaFeito ? (selecionados.length === 1 ? "Essa ação já foi feita." : "Essas ações já foram feitas.") : redigirDesfechoAprovacao({ itens, aprovadorNome, agora });
  const autoria = autoriaDaPessoa(deps.escopo);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: decisao.conversaId,
    turnoId: decisao.turnoId,
    autoria,
    kind: "resultado_aprovacao",
    texto,
    // PR 4 dos modos de aprovação: o cartão era do revisor — o encolhido diz "Negado por você", como os botões dele.
    payload: { kind: "resultado_aprovacao", decisaoId: decisao.id, frase: decisao.frase, itens: itens.map((i) => ({ idx: i.idx, desfecho: i.desfecho ?? "falhou_na_execucao", texto: i.textoFinal })), ...(itens.some(doRevisor) ? { revisor: true as const } : {}) },
    confianca: "confiavel",
  });
  const events: RuntimeEvent[] = [];
  let turnoRetomadaId: string | null = null;
  if (decisao.turnoId) {
    // definido em 2026-09-28 (0032): uma decisão, UMA continuação. A trava do turno serializa esta fase com o
    // assentamento dele. Turno vivo = ele mesmo recebe a decisão (espera do proxy) ou, se terminar sem ela,
    // o assentamento a continua (continuarAprovacoesDoTurno). Antes esta fase SEMPRE criava retomada, e a
    // aprovação dada durante a espera virava duas continuações — dez turnos da Ada em três minutos.
    const original = await deps.repos.turnos.buscarTravado(decisao.turnoId);
    const vivo = original?.estado === "despachando";
    if (original && !vivo && (await deps.repos.decisoes.reivindicarContinuacao(decisao.id, "retomada", agora)) === "minha" && !tudoJaFeito) {
      const r = await enfileirarRetomada(deps, { original, prazoEm: agora + PRAZO_DECISAO_MS, entradaTexto: entradaDaAprovacao(decisao, itens, texto, original.entradaAnexos.length > 0) });
      turnoRetomadaId = r.turno?.id ?? null;
      if (r.turno && r.nova) events.push(turnoCriado(deps, r.turno.id, decisao, autoria, agora));
    }
  }
  if (mensagem) {
    events.push({
      tenantId: deps.escopo.tenantId,
      id: randomUUID(),
      createdAt: agora,
      kind: "mensagem_criada",
      autoria,
      pessoaDestinoId: deps.escopo.pessoaId,
      conversaId: decisao.conversaId,
      turnoId: decisao.turnoId,
      dados: { mensagem_id: mensagem.id, kind: "resultado_aprovacao", decisao_id: decisao.id, executados: itens.filter((i) => i.desfecho === "executado").length, total: itens.length },
    });
  }
  // Revisão do épico (S2, 2026-10-08): a task do turno que pediu relê o estado — com a retomada na fila, ou sem ela.
  events.push(...(await sincronizarDasDecisoes(deps, [decisao])));
  return { data: { mensagemId: mensagem?.id ?? null, turnoRetomadaId, itens }, events };
};

/**
 * SÓ PARA TESTES (NOD-263): o caminho completo sobre os MESMOS deps (uma transação) — fase 1 → execução → fase 2. Produção
 * separa as fases (rotas/decisoes.ts): a execução roda fora de tx. Chamado de dentro de uma tx escopada, a guarda de
 * `executarItens` loga `conector_dentro_da_tx` (e lança em teste). 'retomar_turno' cria o turno novo sem executar nada.
 */
export const decidir: CasoDeUso<EntradaDecidir, SaidaDecidir> = async (deps: Deps, input) => {
  const fase1 = await marcarEDecidir(deps, input);
  const events: RuntimeEvent[] = [...(fase1.events ?? [])];
  if (fase1.data.decisao.tipo === "retomar_turno") {
    const r = await retomarPorDecisao(deps, { decisao: fase1.data.decisao });
    events.push(...(r.events ?? []));
    return { data: { decisao: fase1.data.decisao, itens: [], desfechos: [], mensagemId: null, turnoRetomadaId: r.data.turnoRetomadaId }, events };
  }
  const desfechos = await executarItens(deps.services, fase1.data.aExecutar);
  const fase2 = await assentarAprovacao(deps, { decisaoId: fase1.data.decisao.id, desfechos });
  events.push(...(fase2.events ?? []));
  return { data: { decisao: fase1.data.decisao, itens: fase2.data.itens, desfechos, mensagemId: fase2.data.mensagemId, turnoRetomadaId: fase2.data.turnoRetomadaId }, events };
};

/**
 * Decisão 'retomar_turno' (ADR-009/010: retomar = turno NOVO com retoma_turno_id, nunca requeue).
 * O texto de entrada é a redação fixa de retomada; a sessão do CLI vem da conversa (--resume).
 */
export const retomarPorDecisao: CasoDeUso<{ decisao: Decisao }, { turnoRetomadaId: string | null }> = async (deps, { decisao }) => {
  const agora = deps.agora();
  // definido em 2026-09-24: o "Retomar" repetido da mesma conversa (×N na fila) sai junto — fase da
  // DONA, a mesma transação que cria o turno de retomada.
  const gemeas = await fecharGemeas(deps, decisao);
  if (!decisao.turnoId) return { data: { turnoRetomadaId: null }, events: gemeas.events };
  const original = await deps.repos.turnos.buscar(decisao.turnoId);
  if (!original) throw new ErroDeDominio("nao_encontrado", { cause: "turno interrompido" });
  const { turno, nova } = await enfileirarRetomada(deps, {
    original,
    prazoEm: agora + PRAZO_DECISAO_MS,
    entradaTexto: redigir("retomada", agora, { motivo: original.motivoInterrupcao ?? "interrupção" }),
    reenvios: original.reenvios + 1,
  });
  const events: RuntimeEvent[] = turno && nova
    ? [{ tenantId: deps.escopo.tenantId, id: randomUUID(), createdAt: agora, kind: "turno_criado", autoria: autoriaDaPessoa(deps.escopo), pessoaDestinoId: deps.escopo.pessoaId, conversaId: decisao.conversaId, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id, decisao_id: decisao.id } }]
    : [];
  // Revisão do épico (S2): a task do turno caído relê o estado (com a retomada na fila) — as gêmeas são da mesma faixa (S4).
  return { data: { turnoRetomadaId: turno?.id ?? null }, events: [...gemeas.events, ...events, ...(await sincronizarDasDecisoes(deps, [decisao]))] };
};
