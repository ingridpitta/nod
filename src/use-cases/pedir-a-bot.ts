import { aPedidoDeOutraPessoa } from "../domain/modo-aprovacao.ts";
import type { Agente } from "../contracts/agente.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import type { Turno } from "../contracts/turno.ts";
import { cotaSegura, fraseDaEsperaDaCota } from "../domain/cota-da-ia.ts";
import { blocoDaPessoa, entradaDoPedido } from "../domain/delegacao.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { podeRepassar, proximaProfundidade } from "../domain/profundidade.ts";
import { cicloDoPedido, horarioDoPedido, instrucaoEsperaCircular, instrucaoJaPedido, instrucaoPedidoRecebido, instrucaoPedidosAbertos, repeticaoDoPedido } from "../domain/triagem.ts";
import { comentarTarefa } from "./comentar-tarefa.ts";
import { podeJuntarNoTurno, type FalhaQuadro } from "./quadro.ts";
import { agenteVisivel, autoriaAgente, autorizarAlvo, evento, PRAZO_DECISAO_MS, resolverAlvo } from "./apoio-l7.ts";
import { JANELA_PEDIDOS_ABERTOS_MS } from "./pedidos-abertos.ts";
import type { Deps } from "./tipos.ts";
import { ehColega } from "./ver-colegas.ts";
import { situacaoDoBotPelaCota } from "./cota-dos-bots.ts";

/**
 * Classes de procuração que autorizam pedir a bot de OUTRO dono (ADR-025). definido em 2026-09-29 (ADR-058):
 * `pedir_a_bot` é a nova; as procurações antigas, dadas para perguntar_a_bot ou delegar_tarefa, continuam valendo.
 */
export const CLASSES_PEDIR_A_BOT = ["pedir_a_bot", "delegar_tarefa", "perguntar_a_bot"] as const;

/**
 * O turno de quem pede: dele, e abaixo do limite da corrente (revisto em 2026-09-30, ADR-063: era só profundidade 0,
 * "um salto" da ADR-058). O catálogo já tira pedir_a_bot no limite; esta checagem é a segunda camada.
 */
async function turnoDoRemetente(deps: Deps, turnoId: string, remetenteId: string): Promise<Turno> {
  const turno = await deps.repos.turnos.buscar(turnoId);
  if (!turno || turno.agenteId !== remetenteId) throw new ErroDeDominio("nao_permitido", { cause: "turno do remetente" });
  if (!podeRepassar(turno.profundidade)) throw new ErroDeDominio("nao_permitido", { cause: "limite da corrente de pedidos entre bots" });
  // NOD-443 (ADR-143, revisão 3 do PR #628): o turno a pedido de outra pessoa (quem participa do quadro da dona) não pede
  // a colegas. O plano já não traz pedir_a_bot; isto é a defesa em profundidade: o turno do colega nasceria sob a
  // procuração da dona (abaixo), e a procuração do membro se perderia num salto que roda no modo da dona.
  if (aPedidoDeOutraPessoa(turno.sobProcuracaoDe, turno.ownerId)) throw new ErroDeDominio("nao_permitido", { cause: "turno a pedido de outra pessoa não pede a colegas" });
  return turno;
}

/**
 * A mensagem da PESSOA que abriu o turno de quem pede, lida do banco por `mensagem_origem_id` (0024), mais as
 * falas absorvidas pelo mesmo turno, na ordem em que chegaram. Vai junto como contexto literal (ADR-058); não
 * é mais condição: turno de rotina ou retomada não tem, e pede do mesmo jeito.
 */
async function mensagensDaPessoa(deps: Deps, turno: Turno): Promise<Mensagem[]> {
  if (!turno.mensagemOrigemId || turno.entradaConfianca !== "confiavel") return [];
  const daPessoa = (m: Mensagem | null): m is Mensagem =>
    m !== null && m.kind === "texto" && m.conversaId === turno.conversaId && m.confianca === "confiavel" && m.autoria.autor_tipo === "pessoa" && m.autoria.autor_id === deps.escopo.pessoaId;
  const principal = await deps.repos.mensagens.buscar(turno.mensagemOrigemId);
  if (!daPessoa(principal)) return [];
  const absorvidos = (await deps.repos.turnos.listarDaConversa(turno.conversaId, 200)).filter((t) => t.absorvidoPor === turno.id && t.mensagemOrigemId);
  const outras = (await Promise.all(absorvidos.map((t) => deps.repos.mensagens.buscar(t.mensagemOrigemId as string)))).filter(daPessoa);
  return [principal, ...outras].sort((a, b) => a.criadoEm - b.criadoEm);
}

/** A janela dos pedidos abertos (ADR-099 item 8): mora em pedidos-abertos.ts desde o NOD-259, que a usa também no prompt. */
export { JANELA_PEDIDOS_ABERTOS_MS };

/** Os colegas de quem pediu que estão livres agora (sem turno vivo nem pronto na fila), fora o alvo. */
async function colegasLivres(deps: Deps, remetente: Agente, alvoId: string, agora: number): Promise<Agente[]> {
  const colegas = (await deps.repos.agentes.listar()).filter((a) => ehColega(remetente, a) && a.id !== alvoId);
  const livres = new Set(await deps.repos.pedidosDeColega.livres(colegas.map((a) => a.id), agora));
  return colegas.filter((a) => livres.has(a.id));
}

/** Os erros do pedido com a tarefa (NOD-417, emenda da ADR-142): cada um diz o que corrigir; nada é pedido. */
type ErroNaTarefa = Extract<Awaited<ReturnType<typeof pedirABot>>["data"], { ok: false }>["erro"];
const ERRO_DO_QUADRO: Record<FalhaQuadro, ErroNaTarefa> = { experimento_desligado: "experimento_desligado", sem_quadro: "sem_quadro", nao_encontrado: "tarefa_invalida", entrada_invalida: "tarefa_invalida", nao_permitido: "tarefa_invalida", estado_invalido: "tarefa_invalida", conflito: "tarefa_invalida" };
const CORRECAO: Record<ErroNaTarefa, string> = {
  experimento_desligado: "O quadro está desligado nos experimentos da pessoa: chame sem a tarefa.",
  sem_quadro: "Diga o quadro certo ou chame sem a tarefa.",
  tarefa_invalida: "Corrija a tarefa (o id ou o título exato) ou chame sem ela.",
  colega_fora_do_quadro: "Chame sem a tarefa para pedir na conversa dele.",
  colega_nao_acionado: "Chame sem a tarefa para pedir na conversa dele.",
  espera_circular: "",
  ja_pedido: "",
};
// Revisão 3 do PR #622: no colega_nao_acionado o comentário já ficou na tarefa; "Nada foi pedido" mentia.
const recusa = (erro: ErroNaTarefa, detalhe: string) => ({
  data: { ok: false as const, erro, instrucao: `${detalhe}. ${erro === "colega_nao_acionado" ? "O comentário ficou na tarefa, mas nenhum pedido ficou aberto." : "Nada foi pedido."} ${CORRECAO[erro]}` },
});

/**
 * pedir_a_bot com a tarefa do quadro como contexto (definido em 2026-11-02, NOD-417; revisto na revisão do PR #622, emenda
 * da ADR-142): o pedido vira um comentário do remetente na tarefa e aciona o colega por ele, sem trocar o responsável. Fora
 * isso é o MESMO pedido do caminho sem tarefa: a mensagem da pessoa vai junto, o `peer_pedido` fica no turno de quem recebe
 * e o `handoff` na conversa de quem pede (a espera circular e o `ja_pedido` o veem, o painel e o varredor de esperas
 * também), e o resultado volta a quem pediu pela entrega de sempre (entregarRespostaPeer) quando o turno do colega acaba.
 * Não passa pela triagem na conversa do colega: o turno é o da tarefa. O comentário é texto de bot (ADR-047): fica
 * `deFora` e o turno de quem recebe nasce contaminado. O responsável da tarefa, se não é o remetente, também é acionado.
 * Um trabalho por gatilho: com um turno do colega na fila para a tarefa, o pedido se junta a ele — menos quando esse turno
 * já atende o pedido de outro bot (o resultado iria ao bot errado). `tarefa_id` é sempre o turno do colega, como sem tarefa.
 */
async function pedirNaTarefa(
  deps: Deps,
  input: Parameters<typeof pedirABot>[1],
  c: { remetente: Agente; alvo: Agente; turnoRemetente: Turno; pedido: string; contexto: string | null; tarefa: string; aviso: string },
): ReturnType<typeof pedirABot> {
  // O quadro é da pessoa: um colega de outro dono (por procuração) não está nele e o comentário não o acionaria.
  if (c.alvo.ownerId !== deps.escopo.pessoaId) return recusa("colega_fora_do_quadro", `${c.alvo.nome} não está no quadro desta pessoa`);
  const pessoaId = deps.escopo.pessoaId;
  const pessoaNome = (await deps.repos.pessoas.buscar(pessoaId))?.nome ?? "a pessoa";
  const pedidos = (await mensagensDaPessoa(deps, c.turnoRemetente)).map((m) => m.texto);
  const volta = `Este pedido é de ${c.remetente.nome} (pedir_a_bot): responda na tarefa e termine com o resultado, que volta a ${c.remetente.nome}.`;
  const limpo = c.turnoRemetente.entradaConfianca === "confiavel" && !(await deps.repos.turnos.contaminado(c.turnoRemetente.id));
  const texto = c.contexto ? `${c.pedido}\n\n${c.contexto}` : c.pedido;
  const r = await comentarTarefa(
    deps,
    { autor: { tipo: "agente", agenteId: c.remetente.id }, ops: [], executor: c.turnoRemetente.executor, turnoId: c.turnoRemetente.id, conversaId: input.conversaId, profundidade: c.turnoRemetente.profundidade, origemConfiavel: limpo },
    { tipo: "comentar", tarefa: c.tarefa, texto },
    {
      pedido: {
        alvoId: c.alvo.id,
        complemento: [blocoDaPessoa(pessoaNome, pedidos), volta].filter(Boolean).join("\n\n"),
        podeJuntar: (turnoId) => podeJuntarNoTurno(deps, turnoId, c.remetente.id),
      },
    },
  );
  if (!r.data.ok) return recusa(ERRO_DO_QUADRO[r.data.erro], r.data.detalhe);
  const doAlvo = r.data.comecaram.find((x) => x.agenteId === c.alvo.id);
  // O remetente está abaixo do limite da corrente (turnoDoRemetente) e o colega é da pessoa: sem turno é estado quebrado,
  // e o lançamento desfaz o comentário junto.
  // Revisão 2 do PR #622: sem turno do colega (sem conversa própria, fora dos acionáveis), o erro é tipado como os outros
  // e o bot corrige a chamada; o comentário fica na tarefa (é da tarefa), mas nenhum pedido aberto é registrado.
  const turno = doAlvo ? await deps.repos.turnos.buscar(doAlvo.turnoId) : null;
  if (!turno) return recusa("colega_nao_acionado", r.data.freados ? `a tarefa passou do freio de acionamentos da hora (revisão do PR #629): ${c.alvo.nome} não foi acionado e a pessoa decide` : `${c.alvo.nome} não pôde ser acionado na tarefa`);
  const autoria = autoriaAgente(c.remetente.id, pessoaId, pessoaId);
  const jaPediu = (await deps.repos.mensagens.pedidoDaTarefa(turno.id))?.autoria.autor_id === c.remetente.id;
  const mensagem = jaPediu ? null : await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria,
    kind: "texto",
    texto,
    payload: { kind: "peer_pedido", conversaOrigemId: input.conversaId, turnoOrigemId: input.turnoId, nome: c.remetente.nome },
    confianca: "nao_confiavel",
  });
  const handoff = await deps.repos.mensagens.criar({
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    autoria,
    kind: "handoff",
    texto: `${c.remetente.nome} pediu a ${c.alvo.nome}: ${c.pedido}`,
    payload: { kind: "handoff", de: c.remetente.id, para: c.alvo.id, motivo: c.pedido, tarefaId: turno.id, nomePara: c.alvo.nome },
    confianca: "nao_confiavel",
  });
  const juntou = r.data.juntados ? " (o comentário se juntou ao trabalho dele que já estava na fila)" : "";
  // A mesma checagem da cota do pedido sem tarefa (NOD-302; revisão 2 do PR #622): o turno da tarefa também é fundo novo, e
  // quem pediu sabe que ele espera e até quando.
  const cota = await situacaoDoBotPelaCota(deps, c.alvo);
  const espera = cota.situacao !== "livre" && cota.ia && cotaSegura("fundo_novo", cota.situacao) ? ` Ele ainda não começa: ${fraseDaEsperaDaCota({ ia: cota.ia, situacao: cota.situacao, voltaEm: cota.voltaEm, agora: deps.agora() })}. Diga isso a quem espera a resposta.` : "";
  const instrucao = `Pedido gravado como comentário na tarefa e ${c.alvo.nome} foi acionado${juntou}.${espera} A resposta chega a você num novo turno; diga em uma frase o que pediu e encerre.`;
  return {
    data: { ok: true, tarefa_id: turno.id, instrucao: [c.aviso, instrucao].filter(Boolean).join(" "), livres: [] },
    events: [
      ...(r.events ?? []),
      evento(deps, "mensagem_criada", autoria, { mensagemId: handoff?.id ?? null, kind: "handoff", tarefaId: turno.id }, { conversaId: input.conversaId, turnoId: input.turnoId }),
      ...(mensagem ? [evento(deps, "mensagem_criada", autoria, { mensagemId: mensagem.id, kind: "texto", tarefaId: turno.id }, { conversaId: turno.conversaId, turnoId: turno.id })] : []),
    ],
  };
}

/**
 * Ferramenta `pedir_a_bot` (definido em 2026-09-29, ADR-058; substitui perguntar_a_bot e delegar_tarefa): um
 * bot pede a um colega uma resposta ou um trabalho, e o colega resolve com os acessos DELE. O remetente é o
 * agente do TOKEN; o alvo, um colega do mesmo dono (outro dono só com procuração). Vale de conversa, sala,
 * rotina, retomada e — desde 2026-09-30 (ADR-063) — de quem cumpre um pedido, abaixo do limite da corrente.
 *
 * O turno do alvo nasce na conversa própria dele: origem 'delegacao', um passe a mais que o de quem pediu,
 * `sob_procuracao_de` = a pessoa dona dos dois e entrada CONFIÁVEL — catálogo inteiro das concessões dele.
 * revisto em 2026-10-01 (ADR-066): a trava da rotina de onde o pedido nasceu saiu. No lugar dela, se quem pediu já
 * tinha lido algo de fora (entrada marcada ou turno contaminado), o turno de quem recebe nasce com a mesma marca —
 * ela só pesa no modo manual, e a página lida não se lava pelo pedido (ADR-062).
 * Na conversa do alvo fica o `peer_pedido` (fala do remetente, "remetente · por pessoa", ADR-023); na de
 * origem, o `handoff`. revisto em 2026-10-18 (chat limpo, PR 3): os dois guardam o nome do outro bot no momento (`nome`,
 * `nomePara`), para a troca agrupada dizer o nome do bot de outro dono ou já excluído. Os dois são texto de modelo e continuam marcados não confiáveis (ADR-026: a marca é
 * do conteúdo); o que mudou é que ela não reduz mais o catálogo de quem recebe.
 */
export const pedirABot: CasoNod<Deps, "pedir_a_bot"> = async (deps, input) => {
  const remetente = await agenteVisivel(deps.repos, input.agenteId);
  const pedido = input.pedido.trim();
  if (pedido === "") throw new ErroDeDominio("texto_vazio");
  const contexto = input.contexto?.trim() || null;
  const turnoRemetente = await turnoDoRemetente(deps, input.turnoId, remetente.id);
  const alvo = await resolverAlvo(deps.repos, remetente, input.agente);
  // definido em 2026-09-30 (ADR-063, como a Jornada 02 de 2026-09-16 já previa): entre donos diferentes continua um
  // salto só. A procuração (ADR-025) é de um bot para outro; sem esta trava, o bot da Ana, cumprindo por procuração
  // um pedido do Marlon, chamaria outro bot dela, que nunca deu procuração a ninguém.
  if (turnoRemetente.profundidade > 0 && (remetente.ownerId !== deps.escopo.pessoaId || alvo.ownerId !== deps.escopo.pessoaId)) {
    throw new ErroDeDominio("nao_permitido", { cause: "entre donos diferentes, a corrente é de um salto" });
  }
  await autorizarAlvo(deps.repos, remetente, alvo, CLASSES_PEDIR_A_BOT);
  const conversaAlvo = await deps.repos.conversas.buscarPropriaDoAgente(alvo.id);
  if (!conversaAlvo) throw new ErroDeDominio("nao_encontrado", { cause: "conversa própria do alvo" });
  // definido em 2026-10-12 (ADR-099 item 8, I7 revista): espera circular. A trava por tenant serializa os pedidos
  // cruzados (A→B e B→A ao mesmo tempo): o segundo espera o primeiro gravar o handoff e então enxerga o ciclo.
  const agora = deps.agora();
  await deps.repos.pedidosDeColega.travar();
  const abertos = await deps.repos.pedidosDeColega.abertos(agora - JANELA_PEDIDOS_ABERTOS_MS);
  const ciclo = cicloDoPedido(abertos, remetente.id, alvo.id);
  if (ciclo) {
    const nomes = await Promise.all(ciclo.map(async (id) => (id === remetente.id ? remetente.nome : (await deps.repos.agentes.buscar(id))?.nome ?? "um colega")));
    return { data: { ok: false, erro: "espera_circular", instrucao: instrucaoEsperaCircular(nomes) } };
  }
  // definido em 2026-10-15 (NOD-259): o mesmo pedido repetido. Cada janela de uma rotina é um fio novo e pedia de novo ao
  // mesmo colega (19–22 pendentes do Leonardo ao Ze 1 em 24 h, 9 num turno só em 3 s). Ainda dentro da trava, que
  // serializa os pedidos simultâneos: o mesmo texto de um aberto, ou o teto do par, é recusado (`ja_pedido`); abaixo do
  // teto o pedido passa com o aviso dos que já esperam resposta.
  const repeticao = repeticaoDoPedido(abertos, remetente.id, alvo.id, pedido);
  if (repeticao.tipo === "recusa") {
    return { data: { ok: false, erro: "ja_pedido", instrucao: instrucaoJaPedido(alvo.nome, repeticao, horarioDoPedido(repeticao.desde, agora)) } };
  }
  const aviso = repeticao.tipo === "aviso" ? instrucaoPedidosAbertos(alvo.nome, repeticao.abertos, horarioDoPedido(repeticao.desde, agora)) : "";
  if (input.tarefa?.trim()) return pedirNaTarefa(deps, input, { remetente, alvo, turnoRemetente, pedido, contexto, tarefa: input.tarefa.trim(), aviso });
  const pessoaId = deps.escopo.pessoaId;
  const pessoaNome = (await deps.repos.pessoas.buscar(pessoaId))?.nome ?? "a pessoa";
  const pedidos = (await mensagensDaPessoa(deps, turnoRemetente)).map((m) => m.texto);
  // revisto em 2026-10-12 (ADR-099 itens 1, 1a e 8, I7 revista; era uma task de quem recebe, ADR-083 S7): o pedido entra na
  // fila do DONO de quem recebe — um turno curto de triagem na conversa própria dele (faixa da conversa, sem trabalho),
  // que o `reivindicar` põe depois das falas da pessoa. Ali o dono responde já, abre frentes (o lote fica ligado a este
  // turno e o resultado vai direto a quem pediu, I3), junta a uma frente que já mexe na mesma coisa ou espera.
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: conversaAlvo.id,
    agenteId: alvo.id,
    origem: "delegacao",
    prazoEm: agora + PRAZO_DECISAO_MS,
    profundidade: proximaProfundidade(turnoRemetente.profundidade),
    entradaTexto: entradaDoPedido({ pessoaNome, remetenteNome: remetente.nome, pedidos, pedido, contexto }),
    entradaConfianca: "confiavel",
    sobProcuracaoDe: pessoaId,
    modelo: alvo.modelo,
    harness: alvo.harness,
    // NOD-206 (#200): o do turno de quem pede (o bot local delega na mesma máquina); o plano grava o real.
    executor: turnoRemetente.executor,
  });
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "turno do pedido não criado" });
  // A marca de quem pediu (ADR-062/066) vai no turno de triagem e, dele, nas frentes que ele abrir (frentes.ts).
  if (turnoRemetente.entradaConfianca !== "confiavel" || (await deps.repos.turnos.contaminado(turnoRemetente.id))) await deps.repos.turnos.contaminar(turno.id, agora);
  const autoria = autoriaAgente(remetente.id, pessoaId, pessoaId);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: conversaAlvo.id,
    turnoId: turno.id,
    autoria,
    kind: "texto",
    texto: contexto ? `${pedido}\n\n${contexto}` : pedido,
    payload: { kind: "peer_pedido", conversaOrigemId: input.conversaId, turnoOrigemId: input.turnoId, nome: remetente.nome },
    confianca: "nao_confiavel",
  });
  const handoff = await deps.repos.mensagens.criar({
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    autoria,
    kind: "handoff",
    texto: `${remetente.nome} pediu a ${alvo.nome}: ${pedido}`,
    payload: { kind: "handoff", de: remetente.id, para: alvo.id, motivo: pedido, tarefaId: turno.id, nomePara: alvo.nome },
    confianca: "nao_confiavel",
  });
  const livres = await colegasLivres(deps, remetente, alvo.id, agora);
  // NOD-302 (continuação da NOD-253): a cota da IA de quem recebe segura o fundo novo (a triagem do pedido é fundo novo,
  // tipoParaCota) — quem pediu sabe que o pedido espera e até quando.
  const cota = await situacaoDoBotPelaCota(deps, alvo);
  const espera = cota.situacao !== "livre" && cota.ia && cotaSegura("fundo_novo", cota.situacao) ? { ia: cota.ia, situacao: cota.situacao, voltaEm: cota.voltaEm, agora } : undefined;
  return {
    data: { ok: true, tarefa_id: turno.id, instrucao: [aviso, instrucaoPedidoRecebido(alvo.nome, livres.map((a) => a.nome), espera)].filter(Boolean).join(" "), livres: livres.map((a) => ({ id: a.id, nome: a.nome })) },
    events: [
      evento(deps, "mensagem_criada", autoria, { mensagemId: handoff?.id ?? null, kind: "handoff", tarefaId: turno.id }, { conversaId: input.conversaId, turnoId: input.turnoId }),
      evento(deps, "turno_criado", autoria, { turnoId: turno.id, agenteId: alvo.id, origem: "delegacao", profundidade: turno.profundidade, remetenteAgenteId: remetente.id, mensagemId: mensagem?.id ?? null }, { conversaId: conversaAlvo.id, turnoId: turno.id }),
    ],
  };
};
