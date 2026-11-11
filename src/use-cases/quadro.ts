import { createHash, randomUUID } from "node:crypto";
import type { Agente } from "../contracts/agente.ts";
import type { Decisao } from "../contracts/decisao.ts";
import type { Autoria, Executor, RuntimeEvent } from "../contracts/evento.ts";
import { LIMITES_QUADRO } from "../contracts/quadro.ts";
import type { AutorLote, ColunaQuadro, ComentarioQuadroDto, ComentarioTarefa, EntradaHistoricoDto, LinhaDeSistema, LoteQuadro, MudancaTarefa, OpQuadro, PrNaTela, Quadro, QuadroDaPessoaDto, OpcaoDeTarefaDto, QuadroDto, ResumoQuadroParaBot, TarefaDto, TarefaPorCodigoDto, TarefaQuadro } from "../contracts/quadro.ts";
import { ehNod } from "../domain/nod.ts";
import type { MovimentoParaBot, MovimentoTarefa } from "../contracts/freios-quadro.ts";
import { fraseDaTrava, MOTIVO_LACO_SEM_NOMES, mudouATarefa, nomeDaParada, paradaDaPessoa } from "../domain/freios-quadro.ts";
import { branchSugerido, codigoDaTarefa, formatarCodigo, lerCodigo, prefixoDoNome } from "../domain/codigo-tarefa.ts";
import { mudancasDaTarefa, statusNoDestino } from "../domain/historico-tarefa.ts";
import { type AgenteDoQuadro, chaveDeBusca, entradaDaResposta, entradaDaTarefa, etapaDaTarefa, execucaoDoTurno, metaCumprida, planejarLote, progresso, recusaDoLimite, resolverTarefa, tarefasDaMeta, resumoDaMeta, resumoDoLote, terminadaDepois, terminou } from "../domain/quadro.ts";
import { acionaNaColuna, colunaDeEspera, colunasDe, colunasDto, COLUNAS_PADRAO, grupoDe, papelDe, responsavelDe, colunaNaTela, esperandoPessoa, NOME_DA_ESPERA } from "../domain/colunas.ts";
import { TAREFA_PASSOU_A_VOCE } from "../domain/comentarios-quadro.ts";
import { ERROS_FALA, type Fala } from "../domain/fala-da-pessoa.ts";
import { ERRO_IMPORTACAO_PARADA, identificadorDaUrl, importacaoParada } from "../domain/importar-linear.ts";
import { resumoDoPr } from "../domain/prs-da-tarefa.ts";
import type { FotoLote } from "../repositories/quadros.repo.ts";
import type { EstadoExecucao, ExecucoesDaTarefa, TrabalhoParaBot } from "../contracts/quadro-execucoes.ts";
import { autoriaAgente, autoriaPessoa, ehUuid, evento, PRAZO_DECISAO_MS } from "./apoio-l7.ts";
import { quadroDoCriar, quadroPeloNome, renomeDoLote } from "./quadros-do-bot.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { podeRepassar, proximaProfundidade } from "../domain/profundidade.ts";
import type { Profundidade } from "../contracts/turno.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { avisarRiscoDoQuadro } from "./risco-quadro.ts";
import { OPS_DE_PESSOAS } from "../domain/quadro.ts";
import { assinatura, podeDesfazer, quemDecide } from "../domain/quadro-pessoas.ts";
import { aplicarPessoas, avisarQuemParticipa, pelaPorta, restaurarPessoas } from "./quadro-pessoas.ts";
import { comentarTarefa, mudarComentario } from "./comentar-tarefa.ts";
import { avisarNoLote } from "./avisos-quadro.ts";
import { esperaPessoa } from "../domain/avisos-quadro.ts";
import { eventoTrabalhoMudou, sincronizarDasDecisoes, sincronizarTrabalho } from "./trabalhos.ts";
import { motivosDaFila } from "./fila-da-tarefa.ts";
import { pastaDoTrabalho, tituloDoTrabalho } from "../domain/trabalho.ts";
import { pastaDoBot } from "../domain/nativas.ts";
import type { Trabalho } from "../contracts/trabalho.ts";
import { fecharPedidosDeDone, pedirODone, responderPelaDecisao } from "./tarefa-casa.ts";
import { situacaoDasTarefas } from "./situacao-trabalho.ts";
import { estadoLinha, voltaNaTela } from "../domain/quadro-execucoes.ts";
import { registrarAvisoDoQuadro, registrarHistoricoComTrilha, type TipoAvisoDoQuadro } from "./trilha-quadro.ts";
import { aplicarOpsDeLabel, ehOpDeLabel, prepararLabels } from "./quadro-labels.ts";
import { labelsDaTarefa } from "../domain/quadro-labels.ts";

/**
 * O quadro-agente (definido em 2026-10-31, NOD-442). Um só caminho para a pessoa (as rotas) e para qualquer bot (a
 * ferramenta gerir_quadro): cada chamada é um lote, tudo ou nada, com a foto do antes para o Desfazer. As tarefas com
 * responsável que entram em A fazer começam sozinhas: o turno nasce na conversa própria do bot (origem delegacao, sob
 * procuração da pessoa, como um pedido de colega).
 */

/** NOD-418: `estado_invalido` = o Repetir com o trabalho rodando (cancele antes). NOD-416: `conflito` = a tarefa mudou de quadro no meio do mover. */
export type FalhaQuadro = "experimento_desligado" | "sem_quadro" | "entrada_invalida" | "nao_encontrado" | "nao_permitido" | "estado_invalido" | "conflito";

export type PedidoLote = {
  autor: AutorLote;
  /** O quadro: id, ou nome/id do bot anfitrião. */
  quadro?: string;
  /** O bot da tela (a rota é /agentes/:id/quadro): o anfitrião quando não veio `quadro`. */
  anfitriaoId?: string;
  /** ADA-14 (ADR-153): qual dos quadros do anfitrião a tela abriu (`?quadro=`); sem ele, o padrão do bot. */
  quadroDoBot?: string;
  ops: readonly OpQuadro[];
  /** Onde rodam os turnos que o lote começa (o do turno de quem chamou; a rota, o do servidor). */
  executor: Executor;
  /** O turno de quem chamou (a ferramenta), para a trilha. */
  turnoId?: string | null;
  conversaId?: string | null;
  /**
   * A profundidade do turno de quem chamou (a pessoa, pela tela: 0). O turno que o lote começa soma 1; no limite
   * (PROFUNDIDADE_MAXIMA, ADR-063) nada começa sozinho — senão dois bots se passavam a tarefa sem fim (revisão do PR #612).
   */
  profundidade?: Profundidade;
  /**
   * O turno de quem fez o lote era confiável e limpo (ADR-062). A pessoa pela tela: true (o padrão). O bot: o turno dele
   * confiável e não contaminado. Falso contamina o turno que o lote começa, como o pedir_a_bot (revisão do PR #612).
   */
  origemConfiavel?: boolean;
  /** O bot fala num turno da pessoa (conversa/ligação): começa até a tarefa que já é dele. */
  autorNaConversa?: boolean;
  /**
   * NOD-443 (ADR-143): quem participa do quadro e pediu, quando o lote entrou pela porta (o escopo é o da dona). Ausente =
   * a própria dona (pela tela ou por um bot dela).
   */
  pedidoPor?: string;
  /** NOD-443: o nome do bot de quem participa, pelo qual ela pediu ("Ana, pela Ada"). O escopo da dona não lê o bot dela. */
  viaNome?: string | null;
  /**
   * NOD-443 (revisão 2 do PR #628, achado 2): o lote é do bot da dona no turno que o pedido de quem participa abriu (sob a
   * procuração dela, `pedidoPor`). As regras são as de quem pediu (o que ela não pode, o bot dela também não) e o turno só
   * mexe na tarefa dele; mas o lote não é dela: não entra no mural nem vira "quem pediu" de nada.
   */
  porProcuracao?: boolean;
  /**
   * NOD-430: "total" = a pessoa pela tela (o padrão dela), ou o bot a pedido dela na conversa, num turno limpo (o lote grava
   * pedido_por = a pessoa, via = o bot). "normal" = o bot sozinho (tarefa, rotina, colega, turno contaminado); é o padrão do bot (limiteDe).
   */
  limite?: "total" | "normal";
  /**
   * NOD-430: o id do card 'quadro_exclusao' confirmado (pela pessoa ou pelo modo): o remover_quadro do bot passa, e os
   * outros cards abertos do mesmo quadro fecham (este o caso de uso fecha como confirmado). Só o caso de uso põe.
   */
  exclusaoConfirmada?: string;
  /**
   * ADA-28 (ADR-159): a resposta deste lote é o espelho de uma decisão ligada que já fechou e já retomou o bot (Sua vez,
   * cartão): a tarefa sai de "Precisa de você", mas o turno da resposta não abre (senão o bot acordava duas vezes).
   */
  respostaJaRetomada?: boolean;
  /**
   * ADA-15 (ADR-154): as falas da pessoa no turno de quem chamou (a de origem e as absorvidas), para os passos
   * `pela_fala`. Só o gerir_quadro põe, e só num turno da conversa com a pessoa; ausente = nenhum `pela_fala` vale.
   */
  falas?: readonly Fala[] | null;
};

/** `entregue`: o recado entra no próximo passo (agora), quando o trabalho da fila começar, ou virou um trabalho novo. */
export type TrabalhoFeito = { numero: number | null; estado: EstadoExecucao | null; entregue?: "agora" | "quando_comecar" | "novo"; cancelados?: number };

/**
 * O limite do lote (NOD-430). Sem `limite`, a pessoa (a tela) tem o total e o bot o normal: o total do bot só vem de quem
 * conferiu a conversa e o turno limpo e o diz de propósito (gerir_quadro). Revisão 1 do PR #627: antes, todo pedido
 * sem limite valia total, e um caminho novo de bot esquecido abriria o controle da tela.
 */
export const limiteDe = (p: Pick<PedidoLote, "autor" | "limite">): "total" | "normal" => p.limite ?? (p.autor.tipo === "agente" ? "normal" : "total");

/** NOD-430: o bot age a pedido da pessoa, na conversa e num turno limpo: o histórico mostra "Você, pela <bot>". */
export const pedidoDaPessoa =(p: PedidoLote): boolean => p.autor.tipo === "agente" && limiteDe(p) !== "normal" && p.autorNaConversa === true && p.origemConfiavel !== false;

export type Comecou = { tarefaId: string; agenteId: string; agenteNome: string; turnoId: string };

export type ResultadoLote =
  | { ok: true; quadro: QuadroDto | null; lote: LoteQuadro | null; comecaram: Comecou[]; desfeito: boolean; /** NOD-416: a tarefa que mudou de quadro (o código novo e o antigo, que continua abrindo). */ movida?: { tarefaId: string; codigo: string; codigoAntigo: string }; /** No limite da corrente: o que ia começar e ficou em A fazer. */ seguradas?: number; /** Um passo de coluna foi para a posição válida mais próxima (NOD-448). */ ajustada?: boolean; /** NOD-415: o quadro foi removido (o bot voltou a agente comum). */ removido?: boolean; /** Revisão 3 do PR #623: o id da tarefa de cada criar_tarefa, na ordem dos passos (null se o mesmo lote a excluiu). */ criadas?: (string | null)[]; /** NOD-417: o comentário gravado (op comentar) e quantos gatilhos se juntaram a um turno da fila (comentário ou lote). */ comentario?: ComentarioTarefa & { paiId?: string | null }; juntados?: number; /** Revisão do PR #629: o comentário de bot não acionou ninguém porque a tarefa passou do freio da hora. */ freados?: number; /** NOD-418: Repetir, Cancelar ou recado: o trabalho que ficou e a vista da tarefa aberta. */ trabalho?: TrabalhoFeito; trabalhos?: ExecucoesDaTarefa; /** 2026-11-10: quantos chips "manda agora" entraram no turno em andamento (recado), sem abrir turno. */ mandadosAgora?: number }
  | { ok: false; erro: FalhaQuadro; detalhe: string; /** Revisão 7 do PR #623: a chave da recusa do mover que a tela distingue (a rota não mapeia texto). */ motivo?: RecusaDoMover };

export const falha = (erro: FalhaQuadro, detalhe: string): { data: ResultadoLote } => ({ data: { ok: false, erro, detalhe } });
/** Revisão 7 do PR #623: a recusa do mover leva a CHAVE tipada; o texto da lista segue como detalhe (bot e log). */
const recusaDoMover = (erro: FalhaQuadro, motivo: RecusaDoMover): { data: ResultadoLote } => ({ data: { ok: false, erro, detalhe: RECUSAS_DO_MOVER[motivo], motivo } });

export async function experimentoLigado(deps: Deps): Promise<boolean> {
  return (await deps.repos.preferencias.buscar()).experimentos?.quadro === true;
}

export async function agentesDaPessoa(deps: Deps): Promise<Agente[]> {
  return (await deps.repos.agentes.listar()).filter((a) => a.ownerId === deps.escopo.pessoaId);
}

export const paraAgenteDoQuadro = (a: Agente): AgenteDoQuadro => ({ id: a.id, nome: a.nome, nod: ehNod(a) });

/**
 * NOD-416 (ADR-144): o prefixo do quadro. O quadro novo nasce com ele; o que o servidor de antes criou (sem prefixo)
 * ganha no próximo lote. A escolha é serializada por pessoa (dois quadros novos ao mesmo tempo não pegam o mesmo).
 */
async function escolherPrefixo(deps: Deps, anfitriao: string, agentes: readonly Agente[]): Promise<string> {
  await deps.repos.quadros.travarPrefixos();
  const nome = agentes.find((a) => a.id === anfitriao)?.nome ?? (await deps.repos.agentes.buscar(anfitriao, true))?.nome ?? "";
  return prefixoDoNome(nome, await deps.repos.quadros.prefixosUsados());
}

export async function comPrefixo(deps: Deps, q: Quadro, agentes: readonly Agente[]): Promise<Quadro> {
  if (q.prefixo !== null) return q;
  await deps.repos.quadros.definirPrefixo(q.id, await escolherPrefixo(deps, q.agenteId, agentes));
  return (await deps.repos.quadros.buscar(q.id)) ?? q;
}

/**
 * As tarefas sem número (o servidor de antes as criou) ganham o seu, e o código fica guardado para o link. A consulta já
 * vem filtrada (revisão 5 do PR #623): o lote comum não relê o quadro inteiro só para achar nenhuma.
 */
async function numerarFaltantes(deps: Deps, q: Quadro): Promise<void> {
  if (q.prefixo === null) return;
  const sem = await deps.repos.quadros.tarefasSemNumero(q.id);
  if (sem.length === 0) return;
  const primeiro = await deps.repos.quadros.reservarNumeros(q.id, sem.length);
  for (const [i, t] of sem.entries()) await deps.repos.quadros.numerarTarefa(t.id, primeiro + i);
  await deps.repos.quadros.guardarCodigos(sem.map((t, i) => ({ prefixo: q.prefixo!, numero: primeiro + i, tarefaId: t.id })));
}

/**
 * Revisão 5 do PR #623: o código de outro prefixo que é de uma tarefa DESTE quadro (ela veio de outro quadro, e o bot
 * ainda a chama pelo código de lá). Vira um mapa código → id para o `resolverTarefa`, pelo histórico de códigos.
 */
export async function codigosAntigosDaqui(deps: Deps, ops: readonly OpQuadro[], q: Quadro, tarefas: readonly TarefaQuadro[]): Promise<Map<string, string>> {
  const daqui = new Set(tarefas.map((t) => t.id));
  const m = new Map<string, string>();
  for (const op of ops) {
    if (!("tarefa" in op) || typeof op.tarefa !== "string") continue;
    const c = lerCodigo(op.tarefa);
    if (!c || c.prefixo === q.prefixo) continue;
    const chave = formatarCodigo(c.prefixo, c.numero);
    if (m.has(chave)) continue;
    const id = await deps.repos.quadros.tarefaDoCodigo(c.prefixo, c.numero);
    if (id && daqui.has(id)) m.set(chave, id);
  }
  return m;
}

/**
 * O código antigo de uma tarefa que mudou de quadro: a dica para o bot que ainda a procura no quadro velho. Revisão 7 do
 * PR #623: o id (uuid) também ganha a dica. O id não muda no mover, então o bot que guardou o id da tarefa e a procura no
 * quadro de antes ouve onde ela está agora, como quem passou o código antigo.
 */
async function dicaDoCodigo(deps: Deps, ops: readonly OpQuadro[], q: Quadro): Promise<string | null> {
  const repo = deps.repos.quadros;
  for (const op of ops) {
    if (!("tarefa" in op) || typeof op.tarefa !== "string") continue;
    const ref = op.tarefa.trim();
    const c = lerCodigo(ref);
    const id = ehUuid(ref) ? ref.toLowerCase() : c ? await repo.tarefaDoCodigo(c.prefixo, c.numero) : null;
    const t = id ? await repo.tarefa(id) : null;
    if (!t || t.quadroId === q.id) continue;
    const onde = await repo.buscar(t.quadroId);
    if (!onde) continue;
    const anfitriao = (await deps.repos.agentes.buscar(onde.agenteId, true))?.nome ?? "outro bot";
    const agora = codigoDaTarefa(onde.prefixo, t);
    if (!c) return `a tarefa ${t.id} está no quadro de ${anfitriao}, como ${agora} (passe quadro "${anfitriao}")`;
    return `${formatarCodigo(c.prefixo, c.numero)} mudou de quadro: agora é ${agora}, no quadro de ${anfitriao} (passe quadro "${anfitriao}")`;
  }
  return null;
}

/** O bot anfitrião que a ferramenta nomeou ao criar o quadro: id ou nome exato (um só); o Nod também pode ter quadro. */
function anfitriaoPeloNome(ref: string, agentes: readonly Agente[]): string | null {
  const r = ref.trim().replace(/^@/, "");
  if (ehUuid(r)) return agentes.some((a) => a.id === r) ? r : null;
  const achados = agentes.filter((a) => chaveDeBusca(a.nome) === chaveDeBusca(r));
  return achados.length === 1 ? achados[0]!.id : null;
}

/** Acha o quadro: id do quadro, ou o bot anfitrião (id ou nome); sem referência, o do bot da tela ou do autor, senão o único. */
export async function acharQuadro(deps: Deps, p: PedidoLote, agentes: readonly Agente[]): Promise<Quadro | null | { ambiguo: Quadro[] } | { semNome: string; nomes: string[] }> {
  const repo = deps.repos.quadros;
  // NOD-443 (revisão 7 do PR #628, achado 2): sob a procuração de quem participa, o quadro é o do próprio turno — nunca o
  // que a referência nomeia. Sem isso, um nome que não bate devolvia a lista dos quadros (e bots) da dona antes da
  // checagem de participação.
  if (p.porProcuracao) return p.turnoId ? repo.doTurno(p.turnoId) : null;
  if (p.quadro !== undefined && p.quadro.trim() !== "") {
    const ref = p.quadro.trim().replace(/^@/, "");
    if (ehUuid(ref)) return (await repo.buscar(ref)) ?? (await repo.doAgente(ref));
    const preferido = p.anfitriaoId ?? (p.autor.tipo === "agente" ? p.autor.agenteId : null);
    // ADA-14: "Ana / Site" acha o quadro "Site" da Ana.
    if (p.quadro.includes("/")) {
      const a = await quadroPeloNome(deps, ref, agentes, preferido);
      if (a) return a;
    }
    const donos = agentes.filter((a) => chaveDeBusca(a.nome) === chaveDeBusca(ref));
    if (donos.length === 1) return repo.doAgente(donos[0]!.id);
    // NOD-430: o nome que não bate devolve os quadros da pessoa (o bot pergunta em qual); o repetido, as candidatas.
    const todos = await repo.listar();
    if (donos.length > 1) {
      const deles = todos.filter((q) => donos.some((a) => a.id === q.agenteId));
      return deles.length === 1 ? deles[0]! : deles.length === 0 ? null : { ambiguo: deles };
    }
    // ADA-14: o nome do quadro (ou o prefixo), preferindo os do bot da tela ou do autor.
    const peloNome = await quadroPeloNome(deps, ref, agentes, preferido);
    if (peloNome) return peloNome;
    return { semNome: ref, nomes: todos.map((q) => agentes.find((a) => a.id === q.agenteId)?.nome).filter((n): n is string => !!n) };
  }
  if (p.anfitriaoId) return repo.daTela(p.anfitriaoId, p.quadroDoBot);
  if (p.autor.tipo === "agente") {
    // O bot no turno de uma tarefa mexe, por padrão, no quadro dessa tarefa, não no dele (revisão rodada 4).
    const daTarefa = p.turnoId ? await repo.doTurno(p.turnoId) : null;
    if (daTarefa) return daTarefa;
    const proprio = await repo.doAgente(p.autor.agenteId);
    if (proprio) return proprio;
  }
  const todos = await repo.listar();
  if (todos.length === 1) return todos[0]!;
  return todos.length === 0 ? null : { ambiguo: todos };
}

/**
 * NOD-419: quantos movimentos de cada tarefa a tela recebe (fora os `acionou`, que têm o mesmo teto à parte: revisão 3 do
 * PR #629, senão 11 comentários de bot empurravam o último movimento de verdade e o Desfazer sumia). A janela que as travas, o laço e o freio leem (24 h) é contada
 * no banco, pelo relógio que grava `criado_em` (revisão do PR #629).
 */
const MOVIMENTOS_NA_TELA = 10;

/** A falha de um quadro que não se achou de primeira (vários, ou nome que não bate), já com o que o bot pergunta. */
export function falhaDoAchado(achado: { ambiguo: Quadro[] } | { semNome: string; nomes: string[] }, agentes: readonly Agente[]): { erro: FalhaQuadro; detalhe: string } {
  if ("semNome" in achado) {
    const lista = achado.nomes.length ? `Os quadros da pessoa: ${achado.nomes.join(", ")}. Pergunte em qual deles` : "A pessoa ainda não tem quadro";
    return { erro: "nao_encontrado", detalhe: `não há um quadro "${achado.semNome}". ${lista}` };
  }
  const nomes = achado.ambiguo.map((x) => `${agentes.find((a) => a.id === x.agenteId)?.nome ?? "?"} (${x.id})`).slice(0, 5).join(", ");
  return { erro: "sem_quadro", detalhe: `a pessoa tem ${achado.ambiguo.length} quadros: diga qual em quadro (o nome do bot anfitrião ou o id): ${nomes}. Se ela não disse, pergunte` };
}

/**
 * O quadro como a tela e o bot leem (tarefas, execução de cada uma, nomes, o último lote). Sempre no escopo da dona;
 * NOD-443: `leitor` é quem lê (a dona, ou quem participa e entrou pela porta), para o "Você", o Desfazer e quem decide.
 */
export async function montarQuadro(deps: Pick<Deps, "repos" | "agora" | "escopo"> & { services?: Pick<Deps["services"], "trabalhosVivos" | "maquinas"> }, q: Quadro, leitor: string = deps.escopo.pessoaId): Promise<QuadroDto> {
  const repo = deps.repos.quadros;
  const donaId = deps.escopo.pessoaId;
  const tarefas = await repo.tarefas(q.id);
  const estados = await repo.estadosDosTurnos(tarefas.map((t) => t.turnoId).filter((id): id is string => id !== null));
  // NOD-460: desde quando cada turno vivo trabalha (o selo "Trabalhando · há N min" do card).
  // ADA-16 (ADR-163): e desde quando cada um espera na fila ("na fila há X min"); a fila é o pendente da mesma cadeia.
  const desdes = await repo.desdeDosTurnos(tarefas.flatMap((t) => (t.turnoId && ["despachando", "pendente"].includes(estados.get(t.turnoId) ?? "") ? [t.turnoId] : [])));
  // A volta marcada é um pendente que espera a hora: entra na consulta e sai "esperando", não "na fila".
  const esperando = await repo.tarefasEsperando(tarefas.filter((t) => t.turnoId && estados.get(t.turnoId) !== "despachando"));
  // ADA-16 (ADR-163, sem teto próprio): por que cada tarefa na fila espera — a mesma tarefa em série ou o portão da máquina.
  const naFila = tarefas.filter((t) => t.turnoId && estados.get(t.turnoId) === "pendente" && !esperando.has(t.id));
  const motivos = await motivosDaFila(deps, naFila);
  const colunas = colunasDe(q);
  // NOD-419: os últimos movimentos de cada tarefa (de quem e para quem, com os nomes).
  const movs = await repo.ultimosMovimentos(q.id, MOVIMENTOS_NA_TELA);
  const ids = new Set([q.agenteId, ...tarefas.map((t) => t.agenteId).filter((id): id is string => id !== null), ...colunas.map((c) => c.responsavel).filter((id): id is string => Boolean(id)),
    ...movs.flatMap((m) => [m.agenteAntes, m.agenteDepois, m.autor.tipo === "agente" ? m.autor.agenteId : null]).filter((id): id is string => id !== null)]);
  const nomes = new Map<string, string>();
  for (const id of ids) {
    const a = await deps.repos.agentes.buscar(id, true);
    if (a) nomes.set(id, a.nome);
  }
  const ultimoSemBarreira = await repo.ultimoLote(q.id);
  // O lote que um mover_quadro invalidou não aparece para desfazer (revisão 2 do PR #623).
  const ultimo = ultimoSemBarreira && !(await repo.mudouDeQuadroDepois(ultimoSemBarreira.id, q.id)) ? ultimoSemBarreira : null;
  // NOD-443: as pessoas do quadro, os nomes de quem pediu (quem saiu também tem nome) e quem decide cada pendência (D5).
  const membros = await repo.membros(q.id);
  const naLista = new Set(membros.map((m) => m.pessoaId));
  const nomesPessoa = new Map<string, string>(membros.map((m) => [m.pessoaId, m.nome]));
  const nomeDe = async (id: string): Promise<string> => {
    if (!nomesPessoa.has(id)) nomesPessoa.set(id, (await deps.repos.pessoas.buscar(id))?.nome ?? "alguém");
    return nomesPessoa.get(id)!;
  };
  const donaNome = await nomeDe(donaId);
  const comentarios = await repo.comentarios(q.id, 50);
  // Quem saiu também conta: a pendência dela volta à dona dizendo quem era.
  const varias = membros.length > 0 || comentarios.length > 0 || tarefas.some((t) => t.pedidoPor && t.pedidoPor !== donaId);
  const extras = new Map<string, Pick<TarefaDto, "pedidoPorNome" | "decide">>();
  if (varias) {
    for (const t of tarefas) {
      const pedido = t.pedidoPor && t.pedidoPor !== donaId ? (t.pedidoPor === leitor ? "você" : await nomeDe(t.pedidoPor)) : null;
      let decide: TarefaDto["decide"] = null;
      if (t.status === "voce") {
        const d = quemDecide({ pedidoPor: t.pedidoPor, donaId, membros: naLista });
        decide = { pessoaId: d.pessoaId, nome: await nomeDe(d.pessoaId), voce: d.pessoaId === leitor, saiu: d.saiu ? await nomeDe(d.saiu) : null };
      }
      extras.set(t.id, { pedidoPorNome: pedido, decide });
    }
  }
  // NOD-420: desde quando a tarefa está na coluna (a tela mostra "parada há" e o prazo).
  const marcas = await repo.marcasDeAviso(q.id);
  // NOD-421: os PRs ligados e as linhas de sistema (uma consulta cada, agrupadas por tarefa).
  // O branch fica de fora do DTO: nome de fora que a tela não mostra (o casamento é no servidor).
  const prs = new Map<string, PrNaTela[]>();
  for (const { tarefaId, branch: _branch, mergePendente: _pendente, ...p } of await repo.prsDoQuadro(q.id)) prs.set(tarefaId, [...(prs.get(tarefaId) ?? []), p]);
  // NOD-443 (revisão 5 do PR #628, achado 4): o aviso do GitHub fala da conexão e dos repos da dona — só ela o vê.
  const avisoGithub = leitor === donaId ? await repo.avisoGithub(q.id) : null;
  const linhas = new Map<string, LinhaDeSistema[]>();
  for (const { tarefaId, ...l } of await repo.linhasDoQuadro(q.id)) linhas.set(tarefaId, [...(linhas.get(tarefaId) ?? []), l]);
  // ADA-232: o estado do card numa linha (o trabalho vivo, a volta marcada e a frente aberta de cada tarefa).
  const situacoes = await situacaoDasTarefas(deps, tarefas.map((t) => t.id));
  // 0159: o catálogo de labels (cada tarefa leva as suas resolvidas, na ordem do catálogo).
  const catalogo = (await repo.labels(q.id)).map((l) => ({ id: l.id, nome: l.nome, cor: l.cor }));
  const comFrente = await deps.repos.trabalhos.tarefasComFrenteAberta(tarefas.map((t) => t.id));
  const dtos: TarefaDto[] = tarefas.map((t) => ({
    ...t,
    // ADR-162: a tarefa que espera a pessoa aparece na coluna de onde veio (o status `voce` não é coluna), com a marca.
    status: colunaNaTela(colunas, t),
    esperaPessoa: esperandoPessoa(t),
    estadoLinha: estadoLinha({ status: t.status, vivo: situacoes.get(t.id)?.vivo ?? false, volta: voltaNaTela(situacoes.get(t.id)?.volta ?? null), frenteAberta: comFrente.has(t.id) }),
    naColunaDesde: marcas.get(t.id)?.naColunaDesde ?? null,
    codigo: codigoDaTarefa(q.prefixo, t),
    branch: branchSugerido(codigoDaTarefa(q.prefixo, t), t.titulo),
    // Só o que ainda está em jogo mostra a execução (um turno concluído de uma tarefa feita não acende nada).
    // A coluna com passagem (ADR-142) é uma etapa em andamento onde ela aciona (revisão 3: o Backlog com passagem não).
    execucao: ["fazendo", "afazer"].includes(papelDe(colunas, t.status)) || (responsavelDe(colunas, t.status) && acionaNaColuna(colunas, t.status)) ? execucaoDoTurno(t.turnoId ? estados.get(t.turnoId) : null, esperando.has(t.id)) : null,
    trabalhandoDesde: t.turnoId && estados.get(t.turnoId) === "despachando" ? desdes.get(t.turnoId) ?? null : null,
    naFilaDesde: t.turnoId && estados.get(t.turnoId) === "pendente" && !esperando.has(t.id) ? desdes.get(t.turnoId) ?? null : null,
    motivoFila: motivos.get(t.id) ?? null,
    agenteNome: t.agenteId ? nomes.get(t.agenteId) ?? null : null,
    // ADA-15: "Respondido no chat com <bot> · ver mensagem". A conversa e a mensagem são da dona: quem só participa vê o
    // bot, sem o link (ele não abre a conversa de outra pessoa).
    respostaAgenteNome: t.respostaAgenteId ? nomes.get(t.respostaAgenteId) ?? null : null,
    ...(leitor !== donaId ? { respostaMensagemId: null, respostaConversaId: null } : {}),
    ...(extras.get(t.id) ?? {}),
    prs: prs.get(t.id) ?? [],
    linhas: linhas.get(t.id) ?? [],
    labels: labelsDaTarefa(t.labelIds, catalogo),
    movimentos: movs.filter((m) => m.tarefaId === t.id).map((m) => ({ ...m, autorNome: m.autor.tipo === "agente" ? nomes.get(m.autor.agenteId) ?? null : null, agenteAntesNome: m.agenteAntes ? nomes.get(m.agenteAntes) ?? null : null, agenteDepoisNome: m.agenteDepois ? nomes.get(m.agenteDepois) ?? null : null })),
  }));
  // NOD-415 (ADR-141): o que terminou antes de a meta ser posta não entra no "N de M".
  // Revisão 4 do PR #630 (decisão 3 da Ada): nem o que veio do Linear.
  const { feitas, total } = progresso(tarefasDaMeta(tarefas, q.metaDesde, colunas, await deps.repos.quadroImportacoes.importadas(q.id)), colunas);
  // NOD-422: a última importação do Linear (sem a conversa de onde veio, que a tela não usa).
  const imp = await deps.repos.quadroImportacoes.ultima(q.id);
  // Revisão do PR #630: a 'trazendo' parada (o processo caiu no meio) já aparece como falhou, e a tela para de reler; a
  // próxima tentativa a marca no banco (conferirImportacao).
  const parada = imp ? importacaoParada(imp, deps.agora()) : false;
  const importacao = imp ? { id: imp.id, quadroId: imp.quadroId, time: imp.time, filtro: imp.filtro, estado: parada ? "falhou" as const : imp.estado, total: imp.total, trazidas: imp.trazidas, erro: parada ? ERRO_IMPORTACAO_PARADA : imp.erro, loteId: imp.loteId, colunas: imp.colunas, criadoEm: imp.criadoEm, atualizadoEm: imp.atualizadoEm } : null;
  return {
    ...q,
    agenteNome: nomes.get(q.agenteId) ?? "",
    colunas: colunasDto(colunas).map((c) => (c.responsavel ? { ...c, responsavelNome: nomes.get(c.responsavel) ?? null } : c)),
    tarefas: dtos,
    ultimoLote: ultimo ? { id: ultimo.id, quadroId: ultimo.quadroId, autor: ultimo.autor, resumo: ultimo.resumo, tarefaIds: ultimo.tarefaIds, desfeitoEm: ultimo.desfeitoEm, criadoEm: ultimo.criadoEm } : null,
    feitas,
    total,
    importacao,
    // NOD-422 (PR 2): o quadro assumiu a esteira (a tela mostra e oferece o Desfazer).
    assumidoEm: await deps.repos.quadroImportacoes.assumidoEm(q.id),
    ...(varias || leitor !== donaId
      ? {
          voce: { pessoaId: leitor, papel: leitor === donaId ? ("dona" as const) : ("membro" as const), podeDesfazer: ultimo !== null && ultimo.desfeitoEm === null && podeDesfazer({ lotePedidoPor: ultimo.pedidoPor, quemPede: leitor, donaId }) },
          dona: { pessoaId: donaId, nome: donaNome },
          membros,
          comentarios: await Promise.all(comentarios.map(async (c): Promise<ComentarioQuadroDto> => ({ id: c.id, tarefaId: c.tarefaId, texto: c.texto, deFora: c.deFora, criadoEm: c.criadoEm, assinatura: c.pedidoPor ? assinatura({ pessoaId: c.pedidoPor, pessoaNome: await nomeDe(c.pedidoPor), botNome: c.viaNome, quemLe: leitor }) : (c.viaNome ?? "Um bot") }))),
        }
      : {}),
    avisoGithub,
    labels: catalogo,
  };
}

/**
 * Quem lê o quadro que o lote devolve. NOD-443 (revisão 7 do PR #628, achado 3; ADR-143 Rev5 achado 4): no turno do bot
 * da dona sob a procuração de quem participa, quem lê é quem pediu — sem o aviso do GitHub da dona e com o "Você" dela.
 */
export const leitorDoLote = (deps: Pick<Deps, "escopo">, p: Pick<PedidoLote, "pedidoPor" | "porProcuracao">): string => (p.porProcuracao && p.pedidoPor ? p.pedidoPor : deps.escopo.pessoaId);

/** `trabalhos`: o trabalho atual de cada tarefa (trabalhosParaBot); a tarefa que nunca teve trabalho fica sem o campo. */
export function resumoParaBot(q: QuadroDto, trabalhos: ReadonlyMap<string, TrabalhoParaBot> = new Map()): ResumoQuadroParaBot {
  return {
    id: q.id,
    anfitriao: q.agenteNome,
    meta: q.meta,
    prazo: q.prazo,
    cumprida: q.cumpridoEm !== null,
    resumo: q.resumo,
    colunas: q.colunas.map((c) => ({ id: c.id, nome: c.nome, grupo: c.grupo, ...(c.responsavelNome ? { passa_para: c.responsavelNome } : {}), ...(c.instrucoes ? { instrucoes: c.instrucoes } : {}), ...(c.prazoMin ? { prazo_min: c.prazoMin } : {}), ...(fraseDaTrava(q.colunas, c.trava) ? { trava: fraseDaTrava(q.colunas, c.trava)! } : {}) })),
    // NOD-420: a pergunta de Bloqueado também (o bot responde "o que está travado?" sem abrir o card).
    tarefas: q.tarefas.map((t) => ({ id: t.id, codigo: t.codigo, titulo: t.titulo, status: t.status, agente: t.agenteNome, linear: t.linearId, pr: t.prUrl, pergunta: t.esperaPessoa || esperaPessoa(q.colunas, t.status) ? t.pergunta : null, ...(t.esperaPessoa ? { esperando_voce: true } : {}), execucao: t.execucao, ...(t.prioridade && t.prioridade !== "sem" ? { prioridade: t.prioridade } : {}), ...(t.decide ? { decide: t.decide.voce ? "você" : t.decide.nome } : {}), ...(trabalhos.has(t.id) ? { trabalho: trabalhos.get(t.id)! } : {}), ...(t.prs?.length ? { prs: t.prs.map(resumoDoPr) } : {}), ...movimentosParaBot(t), ...(t.labels?.length ? { labels: t.labels.map((l) => l.nome) } : {}), ...(t.prazoEm ? { prazo_em: t.prazoEm } : {}) })),
    ...(q.labels?.length ? { labels: q.labels.map((l) => ({ nome: l.nome, cor: l.cor })) } : {}),
    // NOD-443: o bot de quem participa sabe o modo (no "só a dona", comentar) e quem está no quadro.
    ...(q.membros && q.dona ? { modo: q.modoConversa, dona: q.dona.nome, pessoas: q.membros.map((m) => m.nome) } : {}),
    ...(q.avisoGithub ? { avisoGithub: q.avisoGithub } : {}),
  };
}

/**
 * Quem assina o lote. NOD-443 (revisão 2, achado 4): dentro da porta o escopo é o da dona, mas quem pediu é quem participa
 * (a procuração é dela). Revisão 3, achado 4: a conta de execução é a de quem roda o bot. O bot de quem participa (pela
 * porta, sem `porProcuracao`) roda na conta dela; o bot da dona agindo sob a procuração dela (`porProcuracao`) e o lote da
 * própria dona rodam na conta da dona.
 */
function autoriaDoLote(deps: Deps, p: Pick<PedidoLote, "autor" | "pedidoPor" | "porProcuracao">): Autoria {
  const quem = p.pedidoPor ?? deps.escopo.pessoaId;
  if (p.autor.tipo !== "agente") return autoriaPessoa(quem);
  const conta = p.pedidoPor && !p.porProcuracao ? p.pedidoPor : deps.escopo.pessoaId;
  return autoriaAgente(p.autor.agenteId, conta, quem);
}

/** Quantos movimentos de cada tarefa o bot lê (o primeiro é o que o desfazer_movimento sem id desfaz). */
const MOVIMENTOS_PARA_BOT = 3;

function movimentosParaBot(t: TarefaDto): { movimentos?: MovimentoParaBot[] } {
  const ms = (t.movimentos ?? []).filter((m) => m.desfeitoEm === null && mudouATarefa(m)).slice(0, MOVIMENTOS_PARA_BOT);
  return ms.length === 0 ? {} : { movimentos: ms.map((m) => ({ id: m.id, de: m.de, para: m.para, por: m.autor.tipo === "agente" ? m.autorNome ?? "bot" : "pessoa", ...(paradaDaPessoa(m) ? { so_a_pessoa_desfaz: true as const } : {}) })) };
}

export function eventoQuadro(deps: Deps, p: Pick<PedidoLote, "autor" | "conversaId" | "turnoId" | "pedidoPor" | "porProcuracao">, q: { id: string; agenteId: string }, loteId: string | null, tarefas: readonly string[], removido = false): RuntimeEvent {
  const autoria = autoriaDoLote(deps, p);
  return evento(deps, "quadro_mudou", autoria, { quadroId: q.id, agenteId: q.agenteId, loteId, tarefas: tarefas.join(","), autor: p.autor.tipo, ...(removido ? { removido: true } : {}) }, { conversaId: p.conversaId ?? null, turnoId: p.turnoId ?? null });
}

/**
 * NOD-443 (revisão 1, achado 7): o turno do bot da dona roda no executor dela, não no de quem pediu (o bot de quem
 * participa traz o executor do turno dele). O da dona: o do último turno dela na conversa do bot. Revisão 8 do PR #628:
 * sem nenhum turno dela ali, o padrão dela (o palpite `catcher` de quem enfileira, NOD-206), nunca o de quem pediu — o
 * executor real é decidido no plano (emitirPlanoTurno), pela máquina da dona.
 */
async function executorDaDona(deps: Deps, conversaId: string): Promise<Executor> {
  const dela = (await deps.repos.turnos.listarDaConversa(conversaId, 20)).filter((t) => (t.sobProcuracaoDe ?? deps.escopo.pessoaId) === deps.escopo.pessoaId);
  return dela.at(-1)?.executor ?? "catcher";
}

/** Abre o turno do bot responsável (o começo da tarefa ou a volta depois da resposta). null = o bot não tem conversa. */
/**
 * O turno na fila serve para juntar mais um gatilho (NOD-417, revisão do PR #622)? Não quando ele já atende o pedido de
 * OUTRO bot (o `peer_pedido` dele): a entrega do resultado é pelo turno, e iria ao bot errado. `de` é quem pede agora
 * (o bot remetente ou o autor do lote; a pessoa = null). O pedir_a_bot com a tarefa e o lote usam a mesma regra.
 */
export async function podeJuntarNoTurno(deps: Deps, turnoId: string, de: string | null): Promise<boolean> {
  const quem = (await deps.repos.mensagens.pedidoDaTarefa(turnoId))?.autoria.autor_id;
  return quem === undefined || quem === de;
}

/** A tarefa que o turno executa (o dele ou uma retomada dele), entre as do autor: o `terminei` sem tarefa vale para ela. */
async function tarefaDoTurnoDe(deps: Deps, tarefas: readonly TarefaQuadro[], agenteId: string, turnoId: string): Promise<string | null> {
  for (const t of tarefas) {
    if (t.agenteId !== agenteId || !t.turnoId) continue;
    if (t.turnoId === turnoId || (await deps.repos.quadros.cadeiaDoTurno(t.turnoId)).some((x) => x.id === turnoId)) return t.id;
  }
  return null;
}

/** A tarefa de que o turno é: o trabalho dela (ADA-16) leva o título, a pasta e a sessão. */
export type TarefaDoTurno = Pick<TarefaQuadro, "id" | "titulo">;

/**
 * definido em 2026-11-07 (ADA-16, ADR-163): o trabalho do bot na tarefa — um só por (bot, tarefa), criado na primeira
 * etapa e reaproveitado nas seguintes (a sessão e a pasta continuam: ADA-10). Travado (FOR NO KEY UPDATE) até o fim da
 * transação: duas etapas da mesma tarefa abrindo turno ao mesmo tempo se enfileiram aqui. A corrida da criação cai no
 * ON CONFLICT do índice `trabalhos_da_tarefa` e relê o que a outra criou.
 */
async function trabalhoDaTarefa(deps: Deps, agente: Agente, conversaId: string, tarefa: TarefaDoTurno): Promise<{ trabalho: Trabalho; events: RuntimeEvent[] }> {
  const existente = await deps.repos.trabalhos.daTarefa(agente.id, tarefa.id, { travar: true });
  if (existente) return { trabalho: existente, events: [] };
  const titulo = tituloDoTrabalho(tarefa.titulo);
  const id = randomUUID();
  const criado = await deps.repos.trabalhos.criar({ id, agenteId: agente.id, conversaId, titulo, origem: "quadro", tarefaId: tarefa.id, forma: "task", pasta: pastaDoTrabalho(pastaDoBot(agente.nome), titulo, id) });
  if (criado) return { trabalho: criado, events: [eventoTrabalhoMudou(deps, criado)] };
  const daOutra = await deps.repos.trabalhos.daTarefa(agente.id, tarefa.id, { travar: true });
  if (!daOutra) throw new ErroDeDominio("estado_invalido", { cause: "trabalho da tarefa não criado" });
  return { trabalho: daOutra, events: [] };
}

/**
 * Abre o turno do bot responsável (o começo da tarefa ou a volta depois da resposta). null = o bot não tem conversa.
 * revisto em 2026-11-07 (ADA-16, ADR-163): o turno entra no trabalho próprio da tarefa (`trabalhoDaTarefa`), não mais nos
 * bastidores da conversa do bot. A faixa do reivindicar passa a ser o trabalho: tarefas diferentes do mesmo bot rodam
 * em paralelo (sem teto próprio: o freio é o portão de recursos da máquina) e duas etapas do bot na mesma tarefa entram em sequência.
 */
export async function abrirTurno(deps: Deps, p: PedidoLote, agente: Agente, entradaTexto: string, deFora: boolean, tarefa: TarefaDoTurno): Promise<{ turnoId: string; trabalhoId: string; events: RuntimeEvent[] } | null> {
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
  if (!conversa) return null;
  const doTrabalho = await trabalhoDaTarefa(deps, agente, conversa.id, tarefa);
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: conversa.id,
    agenteId: agente.id,
    trabalhoId: doTrabalho.trabalho.id,
    origem: "delegacao",
    prazoEm: deps.agora() + PRAZO_DECISAO_MS,
    // A corrente de quem moveu a tarefa, mais um (a pessoa pela tela começa em 0).
    profundidade: proximaProfundidade(p.profundidade ?? 0),
    entradaTexto,
    // Confiável como o pedir_a_bot (ADR-062); contaminado logo abaixo quando o pedido traz dado de fora. NOD-443 (revisão
    // 1, achado 1): o pedido de quem participa é conteúdo de fora para o bot da dona (catálogo reduzido, sem "Sempre
    // permitir") e a procuração é de quem pediu, não da dona.
    entradaConfianca: p.pedidoPor ? "nao_confiavel" : "confiavel",
    sobProcuracaoDe: p.pedidoPor ?? deps.escopo.pessoaId,
    modelo: agente.modelo,
    harness: agente.harness,
    executor: p.pedidoPor ? await executorDaDona(deps, conversa.id) : p.executor,
  });
  if (!turno) return null;
  // Dado de fora: a tarefa foi escrita por um turno não confiável (deFora, pegajoso) ou o turno de quem fez o lote não era
  // confiável. O Linear é conteúdo interno (ADR-062 §1, conteudoInterno). Suposição registrada no PR: tarefa criada pela
  // pessoa ou por um bot num turno limpo é pedido confiável.
  if (deFora || p.origemConfiavel === false || p.pedidoPor) await deps.repos.turnos.contaminar(turno.id, deps.agora());
  // Quem pediu assina: pela tela, a pessoa; pelo bot dela, o bot sob a procuração dela, na conta de quem o roda.
  const autoria = autoriaDoLote(deps, p);
  // A etapa nova reabre o trabalho que já tinha acabado (terminado, falhou ou parado pela tela de Trabalhos): mover o card
  // para o andamento é o pedido de seguir. O estado sai dos fatos (estadoDoTrabalho), com o turno novo já na fila.
  const sincronizado = await sincronizarTrabalho(deps, doTrabalho.trabalho.id, { reabrir: true });
  return {
    turnoId: turno.id,
    trabalhoId: doTrabalho.trabalho.id,
    events: [...doTrabalho.events, evento(deps, "turno_criado", autoria, { turnoId: turno.id, agenteId: agente.id, origem: "delegacao", profundidade: turno.profundidade, trabalhoId: doTrabalho.trabalho.id }, { conversaId: conversa.id, turnoId: turno.id }), ...sincronizado],
  };
}

/**
 * O turno de uma tarefa que deixou de valer (Desfazer, outro responsável, excluída, cancelada): o que está na fila sai;
 * o que já roda recebe o Parar (revisão do PR #612). Nunca o turno de quem chamou (ele está aplicando este lote).
 */
export async function pararTurno(deps: Deps, p: PedidoLote, turnoId: string): Promise<void> {
  // A cadeia inteira (revisão rodada 6): a tarefa guarda o turno que a começou, e quem roda agora pode ser uma retomada
  // dele (depois de um cartão, da espera de CI, da resposta de um colega). Se quem chamou está nela, nada para.
  const cadeia = await deps.repos.quadros.cadeiaDoTurno(turnoId);
  if (cadeia.some((t) => t.id === p.turnoId)) return;
  for (const t of cadeia) {
    if (t.estado !== "pendente" && t.estado !== "despachando") continue;
    if (!(await deps.repos.turnos.cancelarPendente(t.id))) await deps.repos.turnos.pedirInterrupcao([t.id], deps.agora());
  }
}

/**
 * ADR-162 (fluxo Multica): a pergunta à pessoa é um COMENTÁRIO na tarefa, com a @menção de quem decide; o card fica na
 * coluna. `autor` agente = o bot que perguntou (texto de bot: de fora, ADR-047); `sistema` = a espera que o próprio quadro
 * deixou com a pessoa (o bot parou sem saída, o freio, o agente da etapa que sumiu), que não aciona ninguém.
 */
export async function comentarPergunta(deps: Pick<Deps, "repos" | "escopo">, t: Pick<TarefaQuadro, "id" | "quadroId" | "pergunta" | "pedidoPor">, autor: { tipo: "agente"; agenteId: string } | { tipo: "sistema" }, texto: string | null = t.pergunta): Promise<void> {
  if (!texto?.trim()) return;
  const membros = t.pedidoPor && t.pedidoPor !== deps.escopo.pessoaId ? new Set((await deps.repos.quadros.membros(t.quadroId)).map((m) => m.pessoaId)) : new Set<string>();
  const decide = quemDecide({ pedidoPor: t.pedidoPor ?? null, donaId: deps.escopo.pessoaId, membros }).pessoaId;
  const nome = (await deps.repos.pessoas.buscar(decide))?.nome?.split(/\s+/)[0];
  const corpo = `${nome ? `@${nome} ` : ""}${texto.trim()}`.slice(0, LIMITES_QUADRO.comentario);
  await deps.repos.quadroComentarios.inserir({ quadroId: t.quadroId, tarefaId: t.id, autor, texto: corpo, deFora: autor.tipo === "agente" });
}

/**
 * O aviso vai pela conversa de `agenteDaConversa` (o responsável). Revisão 4 do PR #629: o "não é comigo" sem candidato
 * deixa a tarefa sem responsável; aí o aviso sai pela conversa de quem recusou, senão a pessoa não ficava sabendo.
 */
export async function avisarComVoce(deps: Deps, t: TarefaQuadro, quemPergunta: string, texto?: string, agenteDaConversa: string | null = t.agenteId, chave = `quadro-${texto ? "freio" : "voce"}:${t.id}:${t.mudadoEm}`, tipo: TipoAvisoDoQuadro = "decisao"): Promise<RuntimeEvent | null> {
  if (!agenteDaConversa) return null;
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agenteDaConversa);
  if (!conversa) return null;
  // A autoria é de quem escreveu a pergunta (o bot do lote); a pessoa pela tela, o responsável.
  const autoria = autoriaAgente(quemPergunta, deps.escopo.pessoaId);
  const h = createHash("sha256").update(chave).digest("hex");
  const m = await deps.repos.mensagens.criar({
    conversaId: conversa.id,
    turnoId: null,
    autoria,
    kind: "texto",
    texto: texto ?? `Preciso de você no quadro, em "${t.titulo}": ${t.pergunta ?? ""}`.trim(),
    payload: { kind: "aviso_pessoa" },
    confianca: "nao_confiavel",
    idEnvio: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`,
  });
  if (m) await registrarAvisoDoQuadro(deps, { quadroId: t.quadroId, tipo, tarefas: 1, mensagemId: m.id, autoria });
  return m ? evento(deps, "mensagem_criada", autoria, { mensagem_id: m.id, kind: "texto", aviso: true }, { conversaId: conversa.id, turnoId: null }) : null;
}

/**
 * NOD-422: a importação do Linear só se desfaz inteira. As tarefas da foto dela que mudaram depois (mudado_em) ou ganharam
 * um comentário que não veio do Linear (revisão 3 do PR #630: o Desfazer apagaria a tarefa com o comentário) impedem, e a
 * recusa diz quais. null = nenhuma mexida.
 */
async function recusaDaImportacao(deps: Deps, q: Quadro, lote: LoteQuadro & { antes: FotoLote }, atuais: ReadonlyMap<string, TarefaQuadro>): Promise<string | null> {
  const daFoto = lote.antes.tarefas.map((t) => atuais.get(t.id)).filter((t): t is TarefaQuadro => !!t);
  const comentadas = await deps.repos.quadroImportacoes.comentadasDepois(lote.id, daFoto.map((t) => t.id));
  // Revisão 4: o PR ligado depois (o laço do NOD-421 grava pr_url sem mexer no mudado_em) também é mexida.
  const comPr = await deps.repos.quadroImportacoes.comPrDepois(lote.id, daFoto.map((t) => t.id));
  const mexidas = daFoto.filter((t) => t.mudadoEm > lote.criadoEm || comentadas.has(t.id) || comPr.has(t.id));
  if (!mexidas.length) return null;
  return `a importação do Linear não se desfaz: ${mexidas.slice(0, 5).map((t) => codigoDaTarefa(q.prefixo, t)).join(", ")}${mexidas.length > 5 ? ` e mais ${mexidas.length - 5}` : ""} ${mexidas.length === 1 ? "mudou" : "mudaram"} depois dela`;
}

/**
 * Revisão 7 do PR #629: o aviso do laço e do freio na conversa. O texto é do sistema; o título da tarefa é o único conteúdo
 * que pode ter vindo de fora, e sai quando a tarefa é de fora ou o turno que a mexeu não era confiável. `bloqueou` = o
 * freio levou a tarefa a Bloqueado (o do comentário a deixa na coluna).
 */
export function avisoDoFreio(t: Pick<TarefaQuadro, "titulo" | "deFora">, f: { tipo: "laco" | "freio"; motivo: string }, deTurnoDeFora: boolean, bloqueou = true): string {
  const semTitulo = t.deFora || deTurnoDeFora;
  // Revisão 8 do PR #629: de turno não confiável, o motivo do laço sai sem os nomes das colunas (que um turno de fora pode
  // ter escrito); o card guarda o motivo completo.
  const motivo = deTurnoDeFora && f.tipo === "laco" ? MOTIVO_LACO_SEM_NOMES : f.motivo;
  if (bloqueou) return semTitulo ? `Uma tarefa do quadro foi para Bloqueado: ${motivo}` : `"${t.titulo}" foi para Bloqueado: ${motivo}`;
  return semTitulo ? `Numa tarefa do quadro: ${motivo}` : `Em "${t.titulo}": ${motivo}`;
}

/**
 * O quadro é todo do bot: ele fez o lote da criação e nenhum comentário das tarefas é de outro (a pessoa ou outro bot).
 * Merge da NOD-443: nem tem gente do time nele (o quadro com pessoas não some por um Desfazer do bot).
 */
async function soDoBot(deps: Deps, q: Quadro, autorDoLote: AutorLote, agenteId: string): Promise<boolean> {
  if (autorDoLote.tipo !== "agente" || autorDoLote.agenteId !== agenteId) return false;
  if ((await deps.repos.quadros.membros(q.id)).length > 0) return false;
  // Revisão 4 do PR #627: uma consulta pelo quadro (antes, uma por tarefa).
  return !(await deps.repos.quadroComentarios.temDeOutroNoQuadro(q.id, agenteId));
}

/** Desfaz o último lote do quadro: volta à foto do antes e cancela os turnos que ele abriu e ainda não começaram. */
async function desfazer(deps: Deps, p: PedidoLote, q: Quadro, loteId: string | undefined): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  const repo = deps.repos.quadros;
  const ultimo = await repo.ultimoLote(q.id);
  if (loteId && loteId !== ultimo?.id) {
    // Revisão 3 do PR #630: pediu o Desfazer de uma importação depois de alguém mexer nas tarefas dela (o caso comum: um
    // lote novo, da tela ou do chat). A recusa diz qual tarefa mudou, como quando a mexida foi fora de lote.
    const pedido = await repo.lote(loteId);
    const importada = pedido && pedido.quadroId === q.id && pedido.desfeitoEm === null ? await deps.repos.quadroImportacoes.doLote(pedido.id) : null;
    // Revisão 4: reimportou depois (a mais nova também mexe nas mesmas tarefas): a recusa aponta a mais nova, a única que
    // se desfaz (o Desfazer volta um lote só; desfeita a mais nova, a primeira não volta a ser desfazível).
    if (importada && (await deps.repos.quadroImportacoes.maisNovaQue(q.id, pedido!.id))) return falha("entrada_invalida", "há uma importação do Linear mais nova neste quadro: só a mais nova se desfaz (o Desfazer volta um lote só)");
    const recusa = importada ? await recusaDaImportacao(deps, q, pedido!, new Map((await repo.tarefas(q.id)).map((t) => [t.id, t]))) : null;
    if (recusa) return falha("entrada_invalida", recusa);
  }
  if (!ultimo) return falha("nao_encontrado", "não há o que desfazer neste quadro");
  if (loteId && loteId !== ultimo.id) return falha("entrada_invalida", "só o último lote do quadro se desfaz");
  // NOD-443 (D9): quem participa desfaz só o que ela mesma pediu; a dona, qualquer um.
  if (p.pedidoPor && !podeDesfazer({ lotePedidoPor: ultimo.pedidoPor, quemPede: p.pedidoPor, donaId: deps.escopo.pessoaId })) return falha("entrada_invalida", "o último lote não é seu: só quem pediu e a dona do quadro o desfazem");
  // Um bot desfaz só num turno limpo; o lote da pessoa ou de outro bot, só a pedido dela na conversa (revisão rodada 4).
  if (p.autor.tipo === "agente") {
    if (p.origemConfiavel === false) return falha("entrada_invalida", "desfazer só num turno limpo, em que nada de fora entrou");
    const meu = ultimo.autor.tipo === "agente" && ultimo.autor.agenteId === p.autor.agenteId;
    if (!meu && p.autorNaConversa !== true) return falha("entrada_invalida", "o último lote não é seu: o da pessoa ou de outro bot só se desfaz a pedido dela, na conversa com você");
    // Revisão 3 do PR #627: no limite normal o bot só desfaz o que ele poderia ter feito nele, o lote dele sem a pessoa
    // (pedido_por nulo). O lote feito a pedido dela (o controle da tela) ou o de outro só se desfaz na conversa limpa.
    if (limiteDe(p) === "normal" && (!meu || ultimo.pedidoPor != null)) return falha("entrada_invalida", recusaDoLimite("desfazer um lote feito a pedido da pessoa ou por outro"));
    // Revisão 5 do PR #629: a mesma regra do desfazer_movimento (SO_A_PESSOA_DESFAZ). O lote em que o laço ou o freio parou
    // a tarefa o agente não desfaz sozinho; a pessoa pode, e o agente a pedido dela na conversa.
    if (p.autorNaConversa !== true) {
      // Revisão 10: o lote do 4º passe que levou a tarefa a Bloqueado também (paradaDaPessoa).
      const parado = (await repo.paradasVivasDoLote(ultimo.id)).map(paradaDaPessoa).find((x) => x !== null);
      if (parado) return falha("entrada_invalida", `${nomeDaParada(parado)} só a pessoa desfaz: o último lote parou a tarefa; deixe onde está e espere a resposta dela`);
    }
  }
  // Revisão 2 do PR #623 (a barreira): um mover_quadro que entrou ou saiu deste quadro depois do lote o invalida. A foto
  // não conhece a tarefa que chegou: o Desfazer do lote que criou o quadro a apagava, e o de colunas a deixava fora delas.
  if (await repo.mudouDeQuadroDepois(ultimo.id, q.id)) return falha("entrada_invalida", "uma tarefa mudou de quadro (entrou ou saiu deste) depois do último lote: ele não se desfaz mais. Para voltar a tarefa, use mover_quadro; o resto, desfaça mudando à mão");
  const foto: FotoLote = ultimo.antes;
  const atuais = new Map((await repo.tarefas(q.id)).map((t) => [t.id, t]));
  // NOD-422: o Desfazer da importação do Linear só volta inteiro; se alguém mexeu numa tarefa depois, recusa e diz quais.
  const importacao = await deps.repos.quadroImportacoes.doLote(ultimo.id);
  if (importacao) {
    const recusa = await recusaDaImportacao(deps, q, ultimo, atuais);
    if (recusa) return falha("entrada_invalida", recusa);
  }
  for (const { id, antes } of foto.tarefas) {
    const atual = atuais.get(id);
    if (atual?.turnoId && atual.turnoId !== (antes?.turnoId ?? null)) await pararTurno(deps, p, atual.turnoId);
  }
  if (foto.quadro === null) {
    // Revisão 2 do PR #627: desfazer a criação apaga o quadro, sem Desfazer. O bot só faz isso no quadro que ele criou e
    // que só tem conteúdo dele; o da pessoa, de outro bot ou com comentário de outro vai pelo card (remover_quadro).
    if (p.autor.tipo === "agente" && !(await soDoBot(deps, q, ultimo.autor, p.autor.agenteId))) {
      return falha("entrada_invalida", "desfazer a criação apagaria um quadro com conteúdo da pessoa ou de outro bot: para excluí-lo, peça com remover_quadro (vira o card que a pessoa confirma)");
    }
    // Os códigos ficam e reservam o prefixo (revisão 5 do PR #623): o quadro que nascer depois não reusa o link velho.
    await repo.apagarHistorico([...atuais.keys()]);
    await repo.apagar(q.id);
    return { data: { ok: true, quadro: null, lote: null, comecaram: [], desfeito: true }, events: [eventoQuadro(deps, p, q, ultimo.id, []), ...(await fecharExclusoesPendentes(deps, q.id))] };
  }
  const estadosAntes = await repo.estadosDosTurnos(foto.tarefas.map((t) => t.antes?.turnoId).filter((id): id is string => !!id));
  // As colunas da foto (ou as de agora, na foto de antes da NOD-448): a tarefa restaurada cai numa coluna que existe.
  const colunasDaFoto = colunasDe(foto.quadro.colunas !== undefined ? { colunas: foto.quadro.colunas } : q);
  const historico: MudancaTarefa[] = [];
  const criadasNoLote = foto.tarefas.filter((t) => t.antes === null).map((t) => t.id);
  for (const { id, antes } of foto.tarefas) {
    if (antes === null) { await repo.apagarTarefa(id); continue; }
    // A foto no andamento com um turno que já parou (o Desfazer interrompeu, ou acabou): volta à espera, sem turno, para
    // não ficar em "falhou" sem ninguém (revisão rodada 3). Recomeça a pedido (mudar_tarefa status afazer).
    const vivo = antes.turnoId !== null && ["pendente", "despachando"].includes(estadosAntes.get(antes.turnoId) ?? "");
    // Só a tarefa cujo turno ESTE lote trocou (passou de mão, parou): a que ele só mudou de coluna (remover, substituir)
    // volta exatamente para onde estava, com o turno que tinha (revisão do PR #615, rodada 2).
    const mexeuNoTurno = (atuais.get(id)?.turnoId ?? null) !== (antes.turnoId ?? null);
    // E a que tinha um turno que não terminou bem (o lote o parou ao mandá-la para Cancelado/Backlog, ou ele caiu): sem
    // isso ela voltaria ao andamento como "Falhou", sem ninguém (revisão 4). Só o turno concluído volta como estava.
    // Só quando o lote a tirou do andamento: a que já estava parada lá e o lote só editou volta igual (revisão 5).
    const atual = atuais.get(id);
    const saiuDoAndamento = !!atual && papelDe(colunasDe(q), atual.status) !== "fazendo";
    const turnoMorto = antes.turnoId !== null && estadosAntes.get(antes.turnoId) !== "concluido" && saiuDoAndamento;
    const andava = papelDe(colunasDaFoto, antes.status) === "fazendo" && (mexeuNoTurno || turnoMorto);
    // A foto de antes da 0136 não tem `terminadaEm`: terminada = o grupo da coluna dela, desde o `mudadoEm` (revisão do merge).
    const daFoto = (antes.terminadaEm as number | null | undefined) !== undefined ? antes : { ...antes, terminadaEm: terminou(colunasDaFoto, antes.status) ? antes.mudadoEm : null };
    const restaurada = await repo.restaurarTarefa(andava && !vivo ? { ...daFoto, status: colunaDeEspera(colunasDaFoto), turnoId: null, terminadaEm: null } : daFoto, { manterMudadoEm: !!importacao });
    // NOD-416: o Desfazer também é uma mudança, de quem desfez.
    const de = atuais.get(id);
    if (de) historico.push(...mudancasDaTarefa({ tarefaId: id, antes: de, pedido: restaurada, final: restaurada, autor: p.autor }));
    // A que o lote excluiu volta: "restaurada", na coluna de agora, por quem desfez (revisão 5 do PR #623).
    else historico.push({ tarefaId: id, campo: "restaurada", de: null, para: restaurada.status, autor: p.autor });
  }
  // A tarefa que o lote criou e o Desfazer apagou não deixa o código nem o histórico para trás.
  await repo.apagarCodigosEHistorico(criadasNoLote);
  await registrarHistoricoComTrilha(deps, q.id, historico, null);
  await repo.salvar(q.id, foto.quadro);
  // ADA-14 (QA): o lote que renomeou ou trocou o projeto os volta (a foto sem eles não mexe).
  if (foto.quadro.nome !== undefined || foto.quadro.projetoId !== undefined) {
    await repo.renomear(q.id, { ...(foto.quadro.nome !== undefined ? { nome: foto.quadro.nome } : {}), ...(foto.quadro.projetoId !== undefined ? { projetoId: foto.quadro.projetoId } : {}) });
  }
  // NOD-443: o lote das pessoas ou do modo volta quem estava e o modo de antes.
  const sairam = foto.pessoas ? await restaurarPessoas(deps, q.id, foto.pessoas) : [];
  await repo.marcarDesfeito(ultimo.id);
  // A importação que trocou o prefixo pelo do time o devolve, se nenhum outro quadro o pegou nesse meio-tempo (revisão do PR #630).
  const prefixoDaFoto = foto.quadro.prefixo;
  if (importacao && prefixoDaFoto && prefixoDaFoto !== q.prefixo) {
    await repo.travarPrefixos();
    if (!(await repo.prefixoDeOutroQuadro(q.id, prefixoDaFoto))) await deps.repos.quadroImportacoes.trocarPrefixo(q.id, prefixoDaFoto);
  }
  if (importacao) {
    // Os comentários e as linhas 'linear' que ela trouxe às tarefas que já existiam (as criadas já foram com a tarefa).
    await deps.repos.quadroImportacoes.apagarComentariosDoLote(ultimo.id);
    await deps.repos.quadroImportacoes.apagarLinhasDoLote(ultimo.id);
    // Revisão 3 do PR #630: e os códigos do time que ela guardou nas tarefas que já existiam (os das criadas já foram).
    await repo.apagarCodigos(foto.codigos ?? []);
    await deps.repos.quadroImportacoes.desfazer(importacao.id);
  }
  // NOD-419: os movimentos do lote desfeito saem do jogo (o histórico os mostra riscados; não se desfazem de novo).
  await repo.desfazerMovimentosDoLote(ultimo.id);
  const atualizado = await repo.buscar(q.id);
  return {
    data: { ok: true, quadro: atualizado ? await montarQuadro(deps, atualizado, leitorDoLote(deps, p)) : null, lote: null, comecaram: [], desfeito: true },
    events: [comSairam(eventoQuadro(deps, p, q, ultimo.id, foto.tarefas.map((t) => t.id)), sairam)],
  };
}

/**
 * Aplica um lote (a ferramenta manda vários passos; cada rota, um). Planeja tudo em memória primeiro (o erro volta sem
 * gravar nada), trava o quadro (um lote por vez: duas abas, dois bots), grava, começa as tarefas e fecha a meta.
 */
export async function aplicarLoteQuadro(deps: Deps, p: PedidoLote): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  // NOD-443 (ADR-143): o quadro de outra pessoa, em que quem pede participa, entra pela porta (o escopo da dona).
  if (!p.pedidoPor) {
    const pelaDona = await pelaPorta(deps, p);
    if (pelaDona) return pelaDona;
    // NOD-417 × NOD-443: no próprio quadro, o comentário numa tarefa é o da NOD-417 (grava e aciona o responsável e os
    // @mencionados, sem lote). O de quem participa (pela porta, com pedidoPor) e o do quadro sem tarefa são o da NOD-443 (D7).
    const so = p.ops[0];
    if (p.ops.length === 1 && so?.tipo === "comentar" && so.tarefa) return comentarTarefa(deps, p, { ...so, tarefa: so.tarefa });
    // 2026-11-10: o autor edita ou apaga o próprio comentário (sem lote, sem acionar).
    if (p.ops.length === 1 && (so?.tipo === "editar_comentario" || so?.tipo === "apagar_comentario")) return mudarComentario(deps, p, so);
  }
  if (p.ops.some((o) => o.tipo === "editar_comentario" || o.tipo === "apagar_comentario")) return { data: { ok: false, erro: "nao_permitido", detalhe: "editar ou apagar comentário só no próprio quadro" } };
  const r = await aplicarLoteDaDona(deps, p);
  return { ...r, ...(r.events ? { events: await comMembros(deps, r.events) } : {}) };
}

/**
 * NOD-443: o quadro.mudou vai também a cada pessoa do quadro (o despacho lê `membros`, depois do commit). Revisão 8: todo
 * emissor de quadro_mudou passa por aqui (o lote, o comentário na tarefa e o laço dos PRs do GitHub; revisão 11 do PR
 * #630: a importação do Linear e o assumir); sem isso o frame chegava só à dona.
 */
export async function comMembros(deps: Deps, events: RuntimeEvent[]): Promise<RuntimeEvent[]> {
  const cache = new Map<string, string[]>();
  const out: RuntimeEvent[] = [];
  for (const e of events) {
    const qid = e.kind === "quadro_mudou" ? e.dados.quadroId : null;
    if (typeof qid !== "string") { out.push(e); continue; }
    if (!cache.has(qid)) cache.set(qid, (await deps.repos.quadros.membros(qid)).map((m) => m.pessoaId));
    // NOD-455: quem acabou de sair (tirada ou o Desfazer da entrada) também recebe ESTE aviso, só com ids: a tela dela
    // relê pela porta, recebe "não encontrado" e troca na hora para "Você não participa deste quadro".
    const { sairam, ...dados } = e.dados;
    const extra = typeof sairam === "string" && sairam ? sairam.split(",") : [];
    const membros = [...new Set([...cache.get(qid)!, ...extra])].join(",");
    out.push(membros ? { ...e, dados: { ...dados, membros } } : { ...e, dados });
  }
  return out;
}

/** NOD-455: marca no aviso quem saiu do quadro neste lote (o comMembros o junta aos destinatários e tira a marca). */
export function comSairam(e: RuntimeEvent, sairam: readonly string[]): RuntimeEvent {
  return sairam.length ? { ...e, dados: { ...e.dados, sairam: sairam.join(",") } } : e;
}

async function aplicarLoteDaDona(deps: Deps, p: PedidoLote): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  if (!(await experimentoLigado(deps))) return falha("experimento_desligado", "o quadro está desligado nos experimentos da pessoa");
  if (p.ops.length === 0) return falha("entrada_invalida", "acoes vazio");
  const repo = deps.repos.quadros;
  const agentes = await agentesDaPessoa(deps);
  const criando = p.ops[0]!.tipo === "criar_quadro";
  // NOD-443 (revisão 2, achado 2): sob a procuração de quem participa, o bot da dona só mexe na tarefa do turno.
  const doQuadro = p.porProcuracao ? p.ops.find((o) => ["criar_quadro", "mover_quadro", "desfazer", "remover_quadro"].includes(o.tipo)) : undefined;
  if (doQuadro) return falha("nao_permitido", `${doQuadro.tipo}: neste turno, o bot só mexe na tarefa que foi pedida a ele. Para o resto, peça a quem pediu ou à dona`);

  let q: Quadro | null;
  if (criando) {
    // O anfitrião: o bot da tela; senão o que a ferramenta nomeou em `quadro` (id ou nome); senão o próprio bot.
    const anfitriao = p.anfitriaoId ?? (p.quadro?.trim() ? anfitriaoPeloNome(p.quadro, agentes) : p.autor.tipo === "agente" ? p.autor.agenteId : null);
    if (!anfitriao || !agentes.some((a) => a.id === anfitriao)) return falha("nao_encontrado", "bot anfitrião do quadro");
    // ADA-14 (ADR-153 §7): sem o índice "um por bot" (0156), a trava do bot é que impede dois "primeiro quadro" juntos.
    await repo.travarBot(anfitriao);
    // ADA-14: criar_quadro com um nome novo cria OUTRO quadro no bot (com a flag); sem nome, o de sempre.
    const escolha = await quadroDoCriar(deps, anfitriao, p.ops[0] as Extract<OpQuadro, { tipo: "criar_quadro" }>, p.quadroDoBot);
    if ("erro" in escolha) return falha(escolha.erro, escolha.detalhe);
    q = escolha.quadro;
    if (!q) {
      const sozinha = p.ops.find((o) => o.tipo === "desfazer" || o.tipo === "remover_quadro" || o.tipo === "mover_quadro");
      if (sozinha) return falha("entrada_invalida", `${sozinha.tipo} vai sozinho na chamada`);
      return criarComLote(deps, p, anfitriao, agentes, { nome: escolha.nome, projetoId: escolha.projetoId });
    }
  } else if (p.ops[0]!.tipo === "mover_quadro") {
    if (p.ops.length > 1) return falha("entrada_invalida", "mover_quadro vai sozinho na chamada");
    return moverDeQuadro(deps, p, p.ops[0]!, agentes);
  } else {
    const achado = await acharQuadro(deps, p, agentes);
    if (achado && ("ambiguo" in achado || "semNome" in achado)) { const f = falhaDoAchado(achado, agentes); return falha(f.erro, f.detalhe); }
    q = achado;
  }
  if (!q && p.porProcuracao) return falha("nao_encontrado", "quadro não encontrado");
  if (!q) return falha("sem_quadro", "não há quadro: crie com criar_quadro (meta e prazo são opcionais)");
  const travado = (await travarQuadros(deps, [q])).get(q.id) ?? null;
  if (!travado) return falha("sem_quadro", "o quadro sumiu");
  // NOD-443 (revisão 1, achado 4): a porta conferiu a participação antes da trava. Tirar alguém também trava o quadro;
  // com a trava na mão, quem saiu enquanto o lote dela esperava não grava mais nada (o mesmo "não encontrado").
  if (p.pedidoPor && !(await repo.ehMembro(travado.id, p.pedidoPor))) return falha("nao_encontrado", "quadro não encontrado");
  // Com a trava na mão, de novo (codex rodada 4): o lote que trocou a tarefa de mão pode ter parado este turno enquanto
  // ele esperava a trava. O turno parado não escreve por cima do novo responsável.
  if (p.turnoId) {
    const meu = await deps.repos.turnos.buscar(p.turnoId);
    if (meu && (meu.pararSolicitadoEm != null || meu.estado === "interrompido")) return falha("entrada_invalida", "este turno foi parado: a tarefa mudou de mão ou foi desfeita");
  }
  const so = p.ops[0]!;
  if ((OPS_DE_PESSOAS as readonly string[]).includes(so.tipo)) {
    if (p.ops.length > 1) return falha("entrada_invalida", `${so.tipo} vai sozinho na chamada`);
    return aplicarPessoas(deps, p, travado, so);
  }
  // 0159: o catálogo de labels (só ops de label na chamada).
  if (ehOpDeLabel(so)) return aplicarOpsDeLabel(deps, p, travado);
  if (so.tipo === "desfazer") {
    if (p.ops.length > 1) return falha("entrada_invalida", "desfazer vai sozinho na chamada");
    return desfazer(deps, p, travado, so.lote);
  }
  if (so.tipo === "remover_quadro") {
    if (p.ops.length > 1) return falha("entrada_invalida", "remover_quadro vai sozinho na chamada");
    return removerQuadro(deps, p, travado);
  }
  // ADA-14: o nome e o projeto do editar_quadro, validados antes do lote e gravados só se ele passou.
  const renome = await renomeDoLote(deps, travado, p.ops);
  if (renome && "erro" in renome) return falha(renome.erro, renome.detalhe);
  // QA da ADA-14: o nome e o projeto vão no lote (o plano §4.2: com Desfazer), não depois dele.
  return aplicarNoQuadro(deps, p, travado, agentes, false, renome);
}

/**
 * A tarefa de um mover: id; o identificador do Linear no quadro achado (ganha do código, revisão do PR #623); o código
 * (de qualquer quadro da pessoa; o antigo também vale); senão o título no quadro achado.
 */
async function tarefaDoMover(deps: Deps, p: PedidoLote, ref: string, agentes: readonly Agente[]): Promise<TarefaQuadro | { erro: FalhaQuadro; detalhe: string }> {
  const repo = deps.repos.quadros;
  const r = ref.trim();
  if (ehUuid(r)) return (await repo.tarefa(r.toLowerCase())) ?? { erro: "nao_encontrado", detalhe: `tarefa "${r}" não encontrada` };
  const achado = await acharQuadro(deps, p, agentes);
  const noQuadro = achado && !("ambiguo" in achado) && !("semNome" in achado) ? achado : null;
  const daqui = noQuadro ? await repo.tarefas(noQuadro.id) : null;
  // O código e o id do Linear pela mesma regra do link (`?tarefa=`): uma só acha; as duas (o código do quadro de uma e o
  // id do Linear de outra) recusam com as duas para a pessoa escolher (revisão do PR #630).
  const pelo = await tarefasDoCodigo(deps, r);
  if (pelo.length === 1) return pelo[0]!;
  if (pelo.length > 1) {
    // Revisão 10: da URL, o identificador (como no verTarefaPorCodigo): a opção "do Linear" e a frase dizem NOD-451.
    const ident = identificadorDaUrl(r) ?? r;
    const opcoes = await opcoesDeTarefa(deps, ident, pelo);
    return { erro: "entrada_invalida", detalhe: `"${ident}" acha ${opcoes.length} tarefas: ${opcoes.map((o) => `"${o.titulo}" (${o.codigoAtual}${o.doLinear ? `, do Linear ${ident.toUpperCase()}` : ""}, id ${o.tarefaId})`).join(" e ")}. Pergunte à pessoa qual e diga pelo id` };
  }
  if (achado && "ambiguo" in achado) return { erro: "sem_quadro", detalhe: `diga a tarefa pelo código (ex.: ZE-12) ou pelo id: a pessoa tem ${achado.ambiguo.length} quadros` };
  if (achado && "semNome" in achado) return falhaDoAchado(achado, agentes);
  if (!noQuadro || !daqui) return { erro: "nao_encontrado", detalhe: `tarefa "${r}" não encontrada` };
  const t = resolverTarefa(daqui, r, { prefixo: noQuadro.prefixo });
  return "erro" in t ? { erro: "nao_encontrado", detalhe: t.erro } : t;
}

/**
 * O quadro de destino: id do quadro, nome (ou id) do bot anfitrião, ou o prefixo (ZE). O quadro de um bot excluído não é
 * destino (revisão do PR #623): a tarefa sumiria da vista da pessoa.
 */
async function quadroDoMover(deps: Deps, ref: string, agentes: readonly Agente[]): Promise<Quadro | null> {
  const repo = deps.repos.quadros;
  const r = ref.trim().replace(/^@/, "");
  const prefixo = r.toUpperCase();
  const vivo = async (q: Quadro | null): Promise<Quadro | null> => (q && (await deps.repos.agentes.buscar(q.agenteId)) ? q : null);
  if (ehUuid(r)) return vivo((await repo.buscar(r)) ?? (await repo.doAgente(r)));
  const donos = agentes.filter((a) => chaveDeBusca(a.nome) === chaveDeBusca(r));
  if (donos.length === 1) {
    const q = await vivo(await repo.doAgente(donos[0]!.id));
    if (q) return q;
  }
  const porPrefixo = (await repo.listar()).filter((q) => q.prefixo !== null && q.prefixo === prefixo);
  if (porPrefixo.length === 1) return vivo(porPrefixo[0]!);
  // ADA-14: o nome do quadro ("Site" ou "Ana / Site"); o ambíguo não é destino (o bot diz qual).
  const peloNome = await quadroPeloNome(deps, r, agentes);
  return peloNome && !("ambiguo" in peloNome) ? vivo(peloNome) : null;
}

/**
 * Trava quadros para um lote, sempre na mesma ordem (revisão do PR #623): primeiro o advisory dos prefixos da pessoa, se
 * algum deles ainda não tem prefixo (o `comPrefixo` vai escolher um), e depois o FOR UPDATE de cada quadro em ordem de id.
 * O `criarComLote` também pega o advisory antes do FOR UPDATE; com a ordem invertida aqui, um lote que esperava o
 * advisory segurando o quadro e uma criação que esperava o quadro segurando o advisory se travavam. O advisory é por
 * sessão e reentrante: o `escolherPrefixo` que vem depois o pega de novo sem esperar.
 */
async function travarQuadros(deps: Deps, quadros: readonly Quadro[]): Promise<Map<string, Quadro>> {
  // O prefixo nunca volta a nulo: lido sem trava e não nulo, continua não nulo sob a trava.
  if (quadros.some((q) => q.prefixo === null)) await deps.repos.quadros.travarPrefixos();
  const travados = new Map<string, Quadro>();
  for (const id of [...new Set(quadros.map((q) => q.id))].sort()) {
    const t = await deps.repos.quadros.buscarTravado(id);
    if (t) travados.set(id, t);
  }
  return travados;
}

/**
 * Revisão 2 do PR #623: os porquês do mover que a tela distingue. A rota manda só a CHAVE, como `motivo` (lista branca,
 * como a NOD-346); o texto segue sendo o detalhe para o bot e o log (ADR-002: a causa nunca atravessa a resposta).
 * Revisão 7: a chave viaja tipada na falha (`recusaDoMover`), não é deduzida do texto.
 */
export const RECUSAS_DO_MOVER = {
  ja_neste_quadro: "a tarefa já está neste quadro",
  fora_do_quadro: "a tarefa não está no quadro deste bot",
  tarefa_sumiu: "a tarefa sumiu",
  quadro_sumiu: "a tarefa ou o quadro sumiu",
  mudou_de_quadro: "a tarefa mudou de quadro enquanto este pedido esperava: leia o quadro de novo e repita, se ainda quiser",
  linear_no_destino: "o quadro de destino já tem esta tarefa do Linear",
} as const;
export type RecusaDoMover = keyof typeof RECUSAS_DO_MOVER;

/**
 * NOD-416 (ADR-144): a tarefa muda de quadro. Ganha o código do destino (o que ela já teve lá, se voltou; senão o próximo
 * número) e o antigo continua abrindo. Cai na mesma coluna, se o destino a tem, ou na padrão do mesmo grupo. Não aciona
 * ninguém nem para o turno que ela já tem: só muda de lugar. Não vira lote (o Desfazer é mover de volta). Os dois quadros
 * são travados em ordem de id (dois movers cruzados não se travam).
 */
async function moverDeQuadro(deps: Deps, p: PedidoLote, op: OpQuadro, agentes: readonly Agente[]): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  if (op.tipo !== "mover_quadro") return falha("entrada_invalida", "mover_quadro");
  const repo = deps.repos.quadros;
  // Revisão do PR #623: o mover é "muda" sem card e sem Desfazer (emenda da ADR-135). Por isso o bot só move num turno
  // limpo, como o Desfazer e as colunas, e não no fim da corrente de bots (ADR-063), como o começo de tarefa.
  if (p.autor.tipo === "agente") {
    if (p.origemConfiavel === false) return falha("entrada_invalida", "mover_quadro só num turno limpo, em que nada de fora entrou (não tem Desfazer): diga à pessoa o que sugere");
    if (!podeRepassar(p.profundidade ?? 0)) return falha("entrada_invalida", "mover_quadro não sai no fim da corrente de bots: diga à pessoa o que sugere");
  }
  const achada = await tarefaDoMover(deps, p, op.tarefa, agentes);
  if ("erro" in achada) return falha(achada.erro, achada.detalhe);
  // A rota é /agentes/:id/quadro/tarefas/:tid/mover: a tarefa tem de estar no quadro de :id (revisão do PR #623).
  if (p.anfitriaoId) {
    const daRota = await repo.daTela(p.anfitriaoId, p.quadroDoBot);
    if (!daRota || daRota.id !== achada.quadroId) return recusaDoMover("nao_encontrado", "fora_do_quadro");
  }
  const alvo = await quadroDoMover(deps, op.quadro, agentes);
  if (!alvo) return falha("nao_encontrado", `quadro "${op.quadro}" não encontrado: passe o nome do bot anfitrião, o prefixo do quadro ou o id`);
  if (alvo.id === achada.quadroId) return recusaDoMover("entrada_invalida", "ja_neste_quadro");
  const daOrigemSemTrava = await repo.buscar(achada.quadroId);
  // Revisão 7 do PR #623: o retorno da trava é o que vale. Um quadro que não voltou travado (removido enquanto este
  // pedido esperava) recusa aqui, antes de qualquer leitura ou escrita; e origem e destino seguem pelas linhas lidas
  // sob o FOR UPDATE, não por uma releitura solta.
  const travados = await travarQuadros(deps, daOrigemSemTrava ? [daOrigemSemTrava, alvo] : [alvo]);
  const origemSemPrefixo = travados.get(achada.quadroId);
  const destinoSemPrefixo = travados.get(alvo.id);
  if (!origemSemPrefixo || !destinoSemPrefixo) return recusaDoMover("nao_encontrado", "quadro_sumiu");
  if (p.turnoId) {
    const meu = await deps.repos.turnos.buscar(p.turnoId);
    if (meu && (meu.pararSolicitadoEm != null || meu.estado === "interrompido")) return falha("entrada_invalida", "este turno foi parado: a tarefa mudou de mão ou foi desfeita");
  }
  // Com as travas na mão, de novo: outro mover pode ter levado a tarefa enquanto este esperava.
  const t = await repo.tarefa(achada.id);
  if (!t) return recusaDoMover("nao_encontrado", "tarefa_sumiu");
  if (t.quadroId === alvo.id) return recusaDoMover("entrada_invalida", "ja_neste_quadro");
  // Revisão 2 do PR #623: só se move a partir do quadro de origem que foi TRAVADO. A tarefa que outro mover levou a um
  // terceiro quadro (não travado aqui) recusa; seguir leria e escreveria aquele quadro sem trava, e o prefixo dele
  // pegaria o advisory depois do FOR UPDATE (a ordem invertida que trava com a criação).
  if (t.quadroId !== achada.quadroId) return recusaDoMover("conflito", "mudou_de_quadro");
  // Revisão 10 do PR #630: o mesmo time importado nos dois quadros. O destino já tem a sua cópia da issue (o índice único
  // quadro_tarefas_linear daria 23505, um 500): recusa antes, dizendo qual. Lido sob a trava do destino.
  if (t.linearId !== null) {
    const doLinear = chaveDeBusca(t.linearId);
    if ((await repo.tarefas(alvo.id)).some((x) => x.linearId !== null && chaveDeBusca(x.linearId) === doLinear)) {
      const nome = agentes.find((a) => a.id === destinoSemPrefixo.agenteId)?.nome ?? destinoSemPrefixo.prefixo ?? "de destino";
      return { data: { ok: false, erro: "conflito", detalhe: `o quadro ${nome} já tem a tarefa do Linear ${t.linearId.trim().toUpperCase()}: abra a de lá, ou exclua uma das duas antes de mover`, motivo: "linear_no_destino" } };
    }
  }
  const origem = await comPrefixo(deps, origemSemPrefixo, agentes);
  const destino = await comPrefixo(deps, destinoSemPrefixo, agentes);
  await numerarFaltantes(deps, origem);
  const daOrigem = (await repo.tarefa(t.id)) ?? t;
  const codigoAntigo = codigoDaTarefa(origem.prefixo, daOrigem);
  const numero = (await repo.numeroAntigo(t.id, destino.prefixo!)) ?? (await repo.reservarNumeros(destino.id, 1));
  const colunasOrigem = colunasDe(origem);
  const colunasDestino = colunasDe(destino);
  const estadoDoTurno = daOrigem.turnoId ? (await repo.estadosDosTurnos([daOrigem.turnoId])).get(daOrigem.turnoId) : undefined;
  const turnoVivo = ["pendente", "despachando"].includes(estadoDoTurno ?? "");
  const status = statusNoDestino(colunasOrigem, daOrigem.status, colunasDestino, daOrigem.agenteId, turnoVivo);
  const esperando = status === "voce" || status === "bloqueado";
  // Com responsável, a volta da resposta abre o turno (voltaDaResposta): a tarefa vai rodar, então volta para a execução
  // como se o turno estivesse vivo (revisão 9 do PR #623). Sem responsável, a mesma regra de quem não roda.
  const voltarPara = esperando && daOrigem.voltarPara !== null ? statusNoDestino(colunasOrigem, daOrigem.voltarPara, colunasDestino, daOrigem.agenteId, turnoVivo || daOrigem.agenteId !== null) : null;
  const ordem = (await repo.tarefas(destino.id)).reduce((m, x) => Math.max(m, x.ordem), 0) + 1;
  const movida = await repo.moverTarefa(t.id, { quadroId: destino.id, status, voltarPara, ordem, numero, terminadaEm: terminadaDepois({ status, terminadaEm: daOrigem.terminadaEm }, deps.agora(), colunasDestino) });
  if (!movida) return recusaDoMover("nao_encontrado", "tarefa_sumiu");
  await repo.guardarCodigos([{ prefixo: destino.prefixo!, numero, tarefaId: t.id }]);
  const historico: MudancaTarefa[] = [{ tarefaId: t.id, campo: "quadro", de: origem.id, para: destino.id, autor: p.autor }];
  if (status !== daOrigem.status) historico.push({ tarefaId: t.id, campo: "status", de: daOrigem.status, para: status, autor: { tipo: "regra" } });
  await registrarHistoricoComTrilha(deps, destino.id, historico, null);
  // A meta dos dois quadros muda com a tarefa: a origem pode fechar e o destino reabrir (revisão 2 do PR #623).
  const nomes = new Map(agentes.map((a) => [a.id, a.nome]));
  for (const q of [origem, destino]) {
    const fecho = fechoDaMeta({ meta: q.meta, prazo: q.prazo, metaDesde: q.metaDesde, anterior: q }, await repo.tarefas(q.id), colunasDe(q), nomes, deps.agora(), await deps.repos.quadroImportacoes.importadas(q.id));
    await repo.salvar(q.id, { meta: q.meta, prazo: q.prazo, ...fecho });
  }
  const atual = (await repo.buscar(destino.id)) ?? destino;
  return {
    data: { ok: true, quadro: await montarQuadro(deps, atual, leitorDoLote(deps, p)), lote: null, comecaram: [], desfeito: false, movida: { tarefaId: t.id, codigo: codigoDaTarefa(atual.prefixo, movida), codigoAntigo } },
    events: [eventoQuadro(deps, p, origem, null, [t.id]), eventoQuadro(deps, p, atual, null, [t.id])],
  };
}

/**
 * NOD-415 (ADR-141): o bot volta a ser um agente comum. Para os turnos que as tarefas abriram e ainda rodam, e apaga o
 * quadro (tarefas e lotes vão junto, em cascata). A conversa, a memória, as rotinas e os acessos do bot não são do quadro
 * e ficam. Não tem Desfazer: um bot só remove a pedido da pessoa, agora, na conversa com ele e num turno limpo.
 */
async function removerQuadro(deps: Deps, p: PedidoLote, q: Quadro): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  // NOD-430: o bot não apaga na hora. O remover_quadro dele vira o card 'quadro_exclusao' (gerir_quadro →
  // proporExclusaoDoQuadro, que confere o pedido, o turno limpo e o nome em `bot`); aqui só chega o card confirmado.
  if (p.autor.tipo === "agente" && p.exclusaoConfirmada === undefined) return falha("entrada_invalida", "remover o quadro pela conversa vira um card que a pessoa confirma (gerir_quadro)");
  const tarefas = await deps.repos.quadros.tarefas(q.id);
  for (const t of tarefas) if (t.turnoId) await pararTurno(deps, p, t.turnoId);
  // Os códigos ficam, sem tarefa (revisão 5 do PR #623): reservam o prefixo, e o link velho dá "não encontrada".
  // NOD-455: os membros caem em CASCADE com o quadro; lidos antes, eles recebem este último aviso (a tela vira "sem acesso").
  const membros = (await deps.repos.quadros.membros(q.id)).map((m) => m.pessoaId);
  await deps.repos.quadros.apagarHistorico(tarefas.map((t) => t.id));
  await deps.repos.quadros.apagar(q.id);
  const fechados = await fecharExclusoesPendentes(deps, q.id, p.exclusaoConfirmada);
  return { data: { ok: true, quadro: null, lote: null, comecaram: [], desfeito: false, removido: true }, events: [comSairam(eventoQuadro(deps, p, q, null, tarefas.map((t) => t.id), true), membros), ...fechados] };
}

/** NOD-430 (revisão 1 do PR #627): o quadro saiu, o card de excluí-lo não tem mais o que pedir. */
export const REGRA_QUADRO_JA_REMOVIDO = "regra:quadro_ja_removido" as const;
/** NOD-430 (revisão 1 do PR #627): a pessoa pediu de novo depois de o quadro mudar; o card velho dá lugar ao novo. */
export const REGRA_EXCLUSAO_SUBSTITUIDA = "regra:quadro_exclusao_substituida" as const;

/**
 * Fecha por regra os cards 'quadro_exclusao' ainda abertos do quadro que saiu (pela tela, pelo Desfazer da criação ou
 * por outro card), menos o `exceto` (o card que está sendo confirmado agora fecha como confirmado no caso de uso dele).
 * A proposta vai a recusada: nada foi excluído por ela. Sem isto o card ficava na Sua vez com botões mortos.
 */
export async function fecharExclusoesPendentes(deps: Deps, quadroId: string, exceto?: string, regra: typeof REGRA_QUADRO_JA_REMOVIDO | typeof REGRA_EXCLUSAO_SUBSTITUIDA = REGRA_QUADRO_JA_REMOVIDO): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  const fechadas: Decisao[] = [];
  for (const proposta of await deps.repos.propostas.exclusoesPendentesDoQuadro(quadroId)) {
    if (proposta.id === exceto) continue;
    await deps.repos.propostas.decidir(proposta.id, "recusada");
    const d = await deps.repos.decisoes.fecharPorRegra(proposta.id, { regra, regraVersao: 1, agora });
    if (!d) continue;
    fechadas.push(d);
    events.push(evento(deps, "decisao_decidida", autoriaPessoa(deps.escopo.pessoaId, regra), { decisao_id: d.id, tipo: d.tipo, regra }, { conversaId: d.conversaId, turnoId: d.turnoId }));
  }
  return [...events, ...(fechadas.length ? await sincronizarDasDecisoes(deps, fechadas) : [])];
}

/**
 * O histórico que o lote lê: o das últimas 24 h e, de qualquer idade, o último desfazível e a entrada na espera SÓ das
 * tarefas que podem precisar deles: a que o lote desfaz (revisão 2 do PR #629: a tela oferece o Desfazer no último
 * movimento sem olhar a idade) e a que está numa espera (revisões 7 e 8: o laço ou o freio de mais de 24 h ainda a
 * segura). Revisão 9: antes entravam os antigos de TODAS as tarefas, e o passe velho de outra tarefa contava no laço
 * (`passagensEntre` não olha a idade). Exportado para o teste de integração.
 */
export async function historicoDoLote(deps: Deps, quadroId: string, ops: readonly OpQuadro[], tarefas: readonly TarefaQuadro[]): Promise<MovimentoTarefa[]> {
  const recentes = await deps.repos.quadros.movimentos(quadroId);
  const esperando = new Set(tarefas.filter((t) => t.status === "voce" || t.status === "bloqueado").map((t) => t.id));
  const desfeitas = new Set<string>();
  for (const o of ops) {
    if (o.tipo !== "desfazer_movimento") continue;
    const t = resolverTarefa(tarefas.map((x) => ({ ...x, nova: false })), o.tarefa);
    if (!("erro" in t)) desfeitas.add(t.id);
  }
  if (esperando.size === 0 && desfeitas.size === 0) return recentes;
  const ids = new Set(recentes.map((m) => m.id));
  const entradas = esperando.size > 0 ? await deps.repos.quadros.entradasNaEspera(quadroId) : [];
  const alvo = (m: MovimentoTarefa) => esperando.has(m.tarefaId) || desfeitas.has(m.tarefaId);
  const velhos = [...new Map([...(await deps.repos.quadros.ultimosDesfaziveis(quadroId)), ...entradas].map((m) => [m.id, m])).values()].filter((m) => alvo(m) && !ids.has(m.id));
  return velhos.length === 0 ? recentes : [...velhos, ...recentes].sort((a, b) => a.criadoEm - b.criadoEm);
}

/**
 * A prévia de um lote (NOD-448): o mesmo planejamento do aplicar, sem gravar nem travar. O substituir_colunas pela
 * conversa usa para validar e montar o card antes de a pessoa confirmar.
 */
export async function preverLoteQuadro(deps: Deps, p: PedidoLote): Promise<{ ok: true; quadro: Quadro; tarefas: TarefaQuadro[]; colunas: ColunaQuadro[] } | { ok: false; erro: FalhaQuadro; detalhe: string }> {
  if (!(await experimentoLigado(deps))) return { ok: false, erro: "experimento_desligado", detalhe: "o quadro está desligado nos experimentos da pessoa" };
  const agentes = await agentesDaPessoa(deps);
  const achado = await acharQuadro(deps, p, agentes);
  if (achado && ("ambiguo" in achado || "semNome" in achado)) return { ok: false, ...falhaDoAchado(achado, agentes) };
  if (!achado) return { ok: false, erro: "sem_quadro", detalhe: "não há quadro: crie com criar_quadro (meta e prazo são opcionais)" };
  const tarefas = await deps.repos.quadros.tarefas(achado.id);
  const codigosAntigos = await codigosAntigosDaqui(deps, p.ops, achado, tarefas);
  const plano = planejarLote({ quadro: { meta: achado.meta, prazo: achado.prazo, colunas: achado.colunas, prefixo: achado.prefixo, ...(achado.quemFecha ? { quemFecha: achado.quemFecha } : {}) }, quadroId: achado.id, tarefas, agentes: agentes.map(paraAgenteDoQuadro), autorAgenteId: p.autor.tipo === "agente" ? p.autor.agenteId : null, ops: p.ops, agora: deps.agora(), origemConfiavel: p.origemConfiavel !== false, autorNaConversa: p.autorNaConversa === true, codigosAntigos, historico: await historicoDoLote(deps, achado.id, p.ops, tarefas), acionamentosNaHora: await deps.repos.quadros.acionamentosNaHora(achado.id), limite: limiteDe(p) });
  if ("erro" in plano) return { ok: false, erro: "entrada_invalida", detalhe: plano.indice >= 0 ? `ação ${plano.indice + 1}: ${plano.erro}` : plano.erro };
  return { ok: true, quadro: achado, tarefas, colunas: colunasDe(plano.quadro) };
}

/** O lote que cria o quadro: o quadro nasce dentro dele (o Desfazer apaga o quadro). */
async function criarComLote(deps: Deps, p: PedidoLote, anfitriao: string, agentes: readonly Agente[], extra: { nome: string | null; projetoId: string | null } = { nome: null, projetoId: null }): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  const op = p.ops[0]!;
  if (op.tipo !== "criar_quadro") return falha("entrada_invalida", "criar_quadro primeiro");
  // Planeja antes de criar: um passo inválido não deixa quadro órfão.
  const plano = planejarLote({ quadro: null, quadroId: "novo", tarefas: [], agentes: agentes.map(paraAgenteDoQuadro), autorAgenteId: p.autor.tipo === "agente" ? p.autor.agenteId : null, ops: p.ops, agora: deps.agora(), origemConfiavel: p.origemConfiavel !== false, autorNaConversa: p.autorNaConversa === true, limite: limiteDe(p) });
  if ("erro" in plano) return falha("entrada_invalida", plano.indice >= 0 ? `ação ${plano.indice + 1}: ${plano.erro}` : plano.erro);
  const prefixo = await escolherPrefixo(deps, anfitriao, agentes);
  const criado = await deps.repos.quadros.criar({ agenteId: anfitriao, meta: op.meta ?? null, prazo: op.prazo ?? null, metaDesde: deps.agora(), prefixo, nome: extra.nome, projetoId: extra.projetoId });
  // Reserva do servidor de antes (o índice único): o segundo lê o quadro do bot e aplica o resto por cima. Com nome, não:
  // o quadro com nome é outro, e a trava do bot (travarBot) já serializa.
  const q = criado ?? (extra.nome === null ? await deps.repos.quadros.doAgente(anfitriao) : null);
  if (!q) return falha("sem_quadro", "o quadro não foi criado");
  const travado = (await deps.repos.quadros.buscarTravado(q.id)) ?? q;
  return aplicarNoQuadro(deps, { ...p, ops: p.ops.slice(1) }, travado, agentes, criado !== null);
}

/**
 * A meta fecha (ou reabre) pelo estado final das tarefas; sem meta (fluxo contínuo, ADR-141) nada fecha. A meta que já
 * estava cumprida guarda o momento e o resumo de quando fechou. Usado pelo lote e pelo mover (revisão 2 do PR #623).
 */
function fechoDaMeta(q: { meta: string | null; prazo: string | null; metaDesde: number; anterior: { cumpridoEm: number | null; resumo: string | null } }, finais: readonly TarefaQuadro[], colunas: readonly ColunaQuadro[], nomes: ReadonlyMap<string, string>, agora: number, importadas: ReadonlySet<string>): { cumpridoEm: number | null; resumo: string | null } {
  const daMeta = tarefasDaMeta(finais, q.metaDesde, colunas, importadas);
  if (q.meta === null || !metaCumprida(daMeta, colunas)) return { cumpridoEm: null, resumo: null };
  const { anterior } = q;
  return { cumpridoEm: anterior.cumpridoEm ?? agora, resumo: anterior.cumpridoEm !== null && anterior.resumo ? anterior.resumo : resumoDaMeta({ prazo: q.prazo, colunas }, daMeta, nomes, agora) };
}

/** ADA-15: quando cada tarefa que espera a pessoa foi posta lá (a pergunta do card), em epoch ms. */
async function perguntasDoQuadro(deps: Deps, quadroId: string, tarefas: readonly TarefaQuadro[]): Promise<Map<string, number>> {
  const entradas = new Map((await deps.repos.quadros.entradasNaEspera(quadroId)).map((m) => [m.tarefaId, m.criadoEm]));
  return new Map(tarefas.filter((t) => t.status === "voce" || t.status === "bloqueado").map((t) => [t.id, entradas.get(t.id) ?? t.mudadoEm]));
}

/** ADA-15 (revisão do PR #696): por tarefa, as falas do turno que já autorizaram um passo nela (uma fala, um passo). */
async function falasUsadas(deps: Deps, tarefas: readonly TarefaQuadro[], falas: readonly Fala[]): Promise<Map<string, Set<string>>> {
  const usadas = new Map<string, Set<string>>();
  for (const u of await deps.repos.quadros.falasUsadas(tarefas.map((t) => t.id), falas.map((f) => f.id))) {
    usadas.set(u.tarefaId, (usadas.get(u.tarefaId) ?? new Set()).add(u.mensagemId));
  }
  return usadas;
}

async function aplicarNoQuadro(deps: Deps, p: PedidoLote, qSemPrefixo: Quadro, agentes: readonly Agente[], nasceuAgora: boolean, renome?: { nome?: string | null; projetoId?: string | null } | null): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  const repo = deps.repos.quadros;
  const agora = deps.agora();
  // NOD-416: o quadro e as tarefas que o servidor de antes criou ganham prefixo e número antes de o lote os ler.
  const q = await comPrefixo(deps, qSemPrefixo, agentes);
  await numerarFaltantes(deps, q);
  const tarefasAntes = await repo.tarefas(q.id);
  const autorAgenteId = p.autor.tipo === "agente" ? p.autor.agenteId : null;
  // NOD-443: quem pediu. A dona pela tela ou na conversa com um bot dela; quem participa, pela porta. O turno que o próprio
  // quadro abriu (a tarefa de um bot) não tem quem pediu: não entra no mural (D8) nem muda quem decide.
  const quemPediu = p.pedidoPor ?? (p.autor.tipo === "pessoa" || p.autorNaConversa === true ? deps.escopo.pessoaId : null);
  // Revisão 2, achado 2: o bot da dona sob a procuração de quem participa segue as regras dela, mas não pede em nome dela.
  // Merge da NOD-430: o pedido_por da dona só vai no lote quando foi pedido dela (limite total, turno limpo): o bot num turno
  // contaminado da conversa age sozinho e assina só com o nome dele.
  const registraPedido = p.porProcuracao ? null : (p.pedidoPor ?? (p.autor.tipo === "pessoa" || pedidoDaPessoa(p) ? deps.escopo.pessoaId : null));
  const podeComecar = podeRepassar(p.profundidade ?? 0);
  const estados = await repo.estadosDosTurnos(tarefasAntes.map((t) => t.turnoId).filter((id): id is string => id !== null));
  const vivas = new Set(tarefasAntes.filter((t) => t.turnoId && ["pendente", "despachando"].includes(estados.get(t.turnoId) ?? "")).map((t) => t.id));
  // NOD-443 (revisão 1, achado 1): o que quem participa escreve (título, descrição, pergunta, o Linear) é de fora para os
  // bots da dona: a tarefa fica deFora, como a escrita por um turno não confiável.
  const origemConfiavel = p.origemConfiavel !== false && !p.pedidoPor;
  const codigosAntigos = await codigosAntigosDaqui(deps, p.ops, q, tarefasAntes);
  const tarefaDoTurno = autorAgenteId && p.turnoId && p.ops.some((o) => (o.tipo === "terminei" || o.tipo === "devolver") && !o.tarefa) ? await tarefaDoTurnoDe(deps, tarefasAntes, autorAgenteId, p.turnoId) : null;
  const historico = await historicoDoLote(deps, q.id, p.ops, tarefasAntes);
  const acionamentosNaHora = await repo.acionamentosNaHora(q.id);
  // ADA-15 (ADR-154): `pela_fala` só no lote do bot da dona, no turno da conversa com ela (nunca pela porta, sob procuração
  // ou pela tela). A hora da pergunta de cada tarefa que espera é o movimento que a pôs lá (o mudado_em, sem movimento).
  const comFala = p.ops.some((o) => "pela_fala" in o && o.pela_fala === true);
  if (comFala && (p.autor.tipo !== "agente" || !p.autorNaConversa || p.pedidoPor || p.porProcuracao || !p.falas)) return falha("nao_permitido", ERROS_FALA.semFala);
  const falas = comFala ? { doTurno: p.falas ?? [], perguntaEm: await perguntasDoQuadro(deps, q.id, tarefasAntes), usadas: await falasUsadas(deps, tarefasAntes, p.falas ?? []) } : null;
  // 0159: os nomes de label viram ids do catálogo (o nome novo vira label, gravada só se o lote passar).
  const labels = await prepararLabels(deps, p, q.id);
  if ("erro" in labels) {
    if (nasceuAgora) await repo.apagar(q.id);
    return falha("entrada_invalida", labels.indice >= 0 ? `ação ${labels.indice + 1}: ${labels.erro}` : labels.erro);
  }
  const plano = planejarLote({ quadro: { meta: q.meta, prazo: q.prazo, colunas: q.colunas, prefixo: q.prefixo, ...(q.quemFecha ? { quemFecha: q.quemFecha } : {}) }, quadroId: q.id, tarefas: tarefasAntes, agentes: agentes.map(paraAgenteDoQuadro), autorAgenteId, ops: labels.ops, agora, podeComecar, vivas, origemConfiavel, turnoConfiavel: p.origemConfiavel !== false, autorNaConversa: p.autorNaConversa === true, codigosAntigos, limite: limiteDe(p), tarefaDoTurno, historico, acionamentosNaHora, falas });
  if ("erro" in plano) {
    // O quadro que nasceu neste lote não fica de pé sem o resto (tudo ou nada). Não acontece: criarComLote já planejou.
    if (nasceuAgora) await repo.apagar(q.id);
    const naoAchou = plano.erro.includes("não está no quadro") || plano.erro.includes("não encontrado");
    const dica = naoAchou ? await dicaDoCodigo(deps, p.ops, q) : null;
    const detalhe = plano.indice >= 0 ? `ação ${plano.indice + 1}: ${plano.erro}` : plano.erro;
    return falha(naoAchou ? "nao_encontrado" : "entrada_invalida", dica ? `${detalhe}. ${dica}` : detalhe);
  }
  const antesPorId = new Map(tarefasAntes.map((t) => [t.id, t]));
  // Revisão 2, achados 2 e 6: a tarefa do turno de quem chamou (o turno que a tarefa abriu, ou um que o retoma).
  const daTarefa = p.turnoId && (p.porProcuracao || !quemPediu) ? await repo.tarefaDoTurno(p.turnoId) : null;
  if (p.porProcuracao) {
    const fora = foraDaTarefaDoTurno(q, plano, daTarefa);
    if (fora) return falha("nao_permitido", fora);
  }
  const alheia = quemPediu ? await pendenciaAlheia(deps, q, plano, antesPorId, quemPediu) : pendenciaDeOutraTarefa(plano, antesPorId, daTarefa);
  if (alheia) return falha("nao_permitido", alheia);
  const deOutra = p.pedidoPor ? tarefaDeOutraPessoa(plano, antesPorId, p.pedidoPor, p.porProcuracao === true) : null;
  if (deOutra) return falha("nao_permitido", deOutra);
  // NOD-443 (revisão 5 do PR #628, achado 5): quem participa não grava PR em tarefa nenhuma, nem na que ela pediu. O PR vai
  // ao turno do bot da dona (entradaDaResposta) e ao resumo do quadro como coisa dela; quem grava é o bot da dona (no turno
  // dele, também sob a procuração de quem pediu) e o laço do servidor (NOD-421, os PRs ligados).
  if (p.pedidoPor && !p.porProcuracao) {
    const comPr = plano.tarefas.find((t) => t.prUrl !== (antesPorId.get(t.id)?.prUrl ?? null));
    if (comPr) return falha("nao_permitido", `o PR de "${comPr.titulo}" é do bot da dona do quadro, não de quem participa: peça ao bot (ponha a tarefa em A fazer) ou deixe um comentário (comentar)`);
  }
  // 0159: o lote passou: as labels novas entram no catálogo antes das tarefas que apontam para elas.
  await labels.gravar();
  const colunasFinais = colunasDe(plano.quadro);
  const espera = colunaDeEspera(colunasFinais);
  const porAgente = new Map(agentes.map((a) => [a.id, a]));
  const idReal = new Map<string, string>();
  const gravadas = new Map<string, TarefaQuadro>();

  // O turno que a tarefa tinha e deixou de valer: excluída, cancelada, de volta ao backlog ou com outro responsável.
  for (const id of plano.apagadas) {
    const velho = antesPorId.get(id)?.turnoId;
    if (velho) await pararTurno(deps, p, velho);
    await repo.apagarTarefa(id);
  }
  for (const id of plano.tocadas) {
    const a = antesPorId.get(id);
    const t = plano.tarefas.find((x) => x.id === id);
    // NOD-448: pelo papel da coluna (a da pessoa em Não iniciado espera como o Backlog; em Fechado, como Cancelado).
    const papel = t ? papelDe(colunasFinais, t.status) : null;
    // Revisão 3 do PR #622: espera é onde a coluna não aciona (acionaNaColuna); com passagem ou sem, o Backlog para o turno.
    const naEspera = !!t && papel === "backlog" && !acionaNaColuna(colunasFinais, t.status);
    if (a?.turnoId && t && (t.agenteId !== a.agenteId || papel === "cancelado" || naEspera)) await pararTurno(deps, p, a.turnoId);
  }
  // NOD-419: desfazer o movimento que acionou um agente para o turno dele (como no Desfazer do lote, ADR-140).
  for (const m of historico) {
    if (!m.acionou || !plano.movimentosDesfeitos.includes(m.id)) continue;
    const t = plano.tarefas.find((x) => x.id === m.tarefaId);
    const a = antesPorId.get(m.tarefaId);
    if (t && a?.turnoId) { await pararTurno(deps, p, a.turnoId); t.turnoId = null; }
  }
  // NOD-416: as novas pegam números seguidos do quadro (sob a trava dele) e o código delas fica guardado.
  const quantasNovas = plano.tarefas.filter((t) => t.nova && plano.tocadas.includes(t.id)).length;
  // Quem pediu a tarefa (D5): quem a criou, e depois quem a pôs para andar ou respondeu a pergunta. Revisão 2, achado 1:
  // só a dona troca quem pediu uma tarefa que já existe; quem participa (e o bot sob a procuração dela) nunca escreve por cima.
  const pedidas = new Set(p.pedidoPor ? [] : [...plano.comecam, ...plano.respondidas.map((r) => r.id)]);
  let proximo = quantasNovas > 0 && q.prefixo !== null ? await repo.reservarNumeros(q.id, quantasNovas) : null;
  const codigos: { prefixo: string; numero: number; tarefaId: string }[] = [];
  for (const id of plano.tocadas) {
    const t = plano.tarefas.find((x) => x.id === id);
    if (!t) continue;
    if (t.nova) {
      const numero = proximo !== null ? proximo++ : null;
      const nova = await repo.inserirTarefa({ quadroId: q.id, titulo: t.titulo, descricao: t.descricao, status: t.status, agenteId: t.agenteId, linearId: t.linearId, linearUrl: t.linearUrl, prUrl: t.prUrl, pergunta: t.pergunta, resposta: t.resposta, deFora: t.deFora, terminadaEm: t.terminadaEm, numero, pedidoPor: registraPedido, prioridade: t.prioridade, labelIds: t.labelIds ?? [], prazoEm: t.prazoEm ?? null });
      idReal.set(id, nova.id);
      gravadas.set(nova.id, nova);
      if (numero !== null && q.prefixo !== null) codigos.push({ prefixo: q.prefixo, numero, tarefaId: nova.id });
    } else {
      const salva = await repo.salvarTarefa(id, registraPedido && pedidas.has(id) ? { ...t, pedidoPor: registraPedido } : t);
      if (salva) gravadas.set(id, salva);
    }
  }
  await repo.guardarCodigos(codigos);

  // Quem começa: o turno nasce agora; a tarefa guarda o turno (o card mostra Na fila / Rodando / Falhou).
  // NOD-443: o pedido de quem participa chega ao bot com o nome dela (e o do bot dela, que não é da dona).
  const pessoaNome = (await deps.repos.pessoas.buscar(p.pedidoPor ?? deps.escopo.pessoaId))?.nome ?? "a pessoa";
  const deQuem = autorAgenteId ? porAgente.get(autorAgenteId)?.nome ?? p.viaNome ?? null : null;
  const comecaram: Comecou[] = [];
  const events: RuntimeEvent[] = [];
  let juntados = 0;
  // `deBot`: o texto do turno leva conteúdo escrito por um bot (o motivo do devolver): o turno nasce contaminado (ADR-047/062).
  const abrir = async (idPlano: string, texto: (t: TarefaQuadro) => string, origem: "inicio" | "resposta", deBot = false) => {
    const id = idReal.get(idPlano) ?? idPlano;
    const t = gravadas.get(id);
    if (!t) return;
    const deFora = t.deFora || deBot;
    const agente = t.agenteId ? porAgente.get(t.agenteId) : undefined;
    // O responsável oculto ou excluído não recebe turno: a tarefa volta a A fazer, sem ficar em Fazendo (revisão rodada 5).
    if (!agente) {
      const volta = await repo.salvarTarefa(id, { ...t, status: espera, turnoId: null, terminadaEm: null });
      if (volta) gravadas.set(id, volta);
      return;
    }
    // Um trabalho por gatilho (NOD-417): se o mesmo agente já tem um turno na fila para esta tarefa (o da tarefa ou o de
    // um comentário), o gatilho se junta a ele em vez de abrir outro.
    // Revisão 2 do PR #622: a mesma regra do pedir_a_bot com a tarefa (o turno que atende o pedido de outro bot não serve),
    // e o turno juntado fica com a maior profundidade (o gatilho não sai do limite da corrente por juntar).
    // Revisão 3 do PR #628 (pós-merge), achado 1: o pedido de quem participa nunca se junta a um turno da fila. Esse turno
    // é da dona (confiável, sob a procuração dela) e o texto de outra pessoa entraria nele sem a degradação do abrirTurno
    // (não confiável, sob a procuração de quem pediu, contaminado, manual); abre o turno dela pelo caminho de sempre.
    let naFila = p.pedidoPor ? null : await deps.repos.quadroComentarios.turnoNaFila(id, agente.id, t.turnoId);
    if (naFila && !(await podeJuntarNoTurno(deps, naFila.id, autorAgenteId))) naFila = null;
    // Juntar num turno de comentário (não o da própria tarefa): a menção pedia para não mexer no status; agora pode.
    const junto = naFila && naFila.id !== t.turnoId ? `${TAREFA_PASSOU_A_VOCE}\n\n${texto(t)}` : texto(t);
    const juntada = naFila ? await deps.repos.turnos.juntarEntrada(naFila.id, junto, [], { profundidade: proximaProfundidade(p.profundidade ?? 0) }) : null;
    if (juntada) {
      if (deFora || !origemConfiavel) await deps.repos.turnos.contaminar(juntada.id, deps.agora());
      if (t.turnoId && t.turnoId !== juntada.id) await pararTurno(deps, p, t.turnoId);
      const salva = await repo.salvarTarefa(id, { ...t, turnoId: juntada.id });
      if (salva) gravadas.set(id, salva);
      // NOD-418: o turno juntado já é um trabalho (o mesmo turno raiz não vira dois).
      await deps.repos.quadroExecucoes.inserir({ tarefaId: id, origem, turnoId: juntada.id });
      comecaram.push({ tarefaId: id, agenteId: agente.id, agenteNome: agente.nome, turnoId: juntada.id });
      juntados++;
      return;
    }
    // Um turno novo para a tarefa: o anterior não roda em dobro (na fila, cancela; rodando, pede a interrupção).
    if (t.turnoId) await pararTurno(deps, p, t.turnoId);
    const aberto = await abrirTurno(deps, p, agente, texto(t), deFora, t);
    if (!aberto) {
      // Sem turno (o bot sem conversa própria): a tarefa não fica em Fazendo sem ninguém; volta a A fazer (revisão rodada 4).
      const volta = await repo.salvarTarefa(id, { ...t, status: espera, turnoId: null, terminadaEm: null });
      if (volta) gravadas.set(id, volta);
      return;
    }
    const salva = await repo.salvarTarefa(id, { ...t, turnoId: aberto.turnoId });
    if (salva) gravadas.set(id, salva);
    // NOD-418: cada gatilho é um trabalho da tarefa (a lista na tarefa aberta, o retry e o Bloqueado partem daqui).
    await deps.repos.quadroExecucoes.inserir({ tarefaId: id, origem, turnoId: aberto.turnoId });
    comecaram.push({ tarefaId: id, agenteId: agente.id, agenteNome: agente.nome, turnoId: aberto.turnoId });
    events.push(...aberto.events);
  };
  const meta = plano.quadro.meta;
  const prazo = plano.quadro.prazo;
  const catalogo = plano.comecam.length ? await repo.labels(q.id) : [];
  const nomesDosBots = new Map(agentes.map((a) => [a.id, a.nome]));
  // 2026-11-10: a devolvida leva ao turno de quem recebe quem devolveu e o motivo (dentro da cerca: é texto de bot).
  const devolucoes = new Map(plano.devolvidas.map((d) => [d.id, { por: d.agenteId ? nomesDosBots.get(d.agenteId) ?? "um bot" : pessoaNome, motivo: d.motivo }]));
  for (const id of plano.comecam) {
    await abrir(id, (t) => entradaDaTarefa({
      quadroId: q.id, meta, prazo, tarefa: t, labels: labelsDaTarefa(t.labelIds, catalogo).map((l) => l.nome), pessoaNome, deQuem: deQuem && t.agenteId !== autorAgenteId ? deQuem : null,
      etapa: etapaDaTarefa(colunasFinais, t.status, { agenteId: t.agenteId, nomes: nomesDosBots, quemFecha: plano.quadro.quemFecha ?? "bot" }), devolucao: devolucoes.get(id) ?? null,
    }), "inicio", devolucoes.has(id) && plano.devolvidas.some((d) => d.id === id && d.agenteId !== null));
  }
  for (const r of plano.respondidas) {
    // ADA-28 (ADR-159): a resposta que espelha uma decisão já respondida não acorda o bot de novo; a resposta pelo card
    // de uma tarefa cuja espera é uma decisão ligada continua pela retomada da decisão (um turno só, o do pedido).
    if (p.respostaJaRetomada) continue;
    const pelaDecisao = await responderPelaDecisao(deps, { tarefaId: r.id, resposta: r.resposta, pessoaNome, executor: p.executor });
    if (pelaDecisao) {
      events.push(...pelaDecisao);
      continue;
    }
    await abrir(r.id, (t) => entradaDaResposta({ quadroId: q.id, tarefa: t, resposta: r.resposta, pessoaNome }), "resposta");
  }

  // "Com você": a pendência da dona avisa pelo avisarNoLote do NOD-420, junto com as outras decisões (depois da janela).
  // NOD-443 (D6; revisão 1, achado 5): a pendência de quem participa é dela. A conversa da dona não recebe o aviso (o
  // avisarNoLote a pula); a de quem decide, sim (no escopo dela), a menos que tenha sido ela mesma a pôr em Com você.
  for (const id of plano.tocadas) {
    const t = gravadas.get(idReal.get(id) ?? id);
    const a = antesPorId.get(idReal.get(id) ?? id);
    if (!t || t.status !== "voce" || a?.status === "voce") continue;
    const decide = t.pedidoPor && t.pedidoPor !== deps.escopo.pessoaId ? quemDecide({ pedidoPor: t.pedidoPor, donaId: deps.escopo.pessoaId, membros: new Set((await repo.membros(q.id)).map((m) => m.pessoaId)) }).pessoaId : deps.escopo.pessoaId;
    if (decide === deps.escopo.pessoaId) continue;
    // O bot da dona sob a procuração dela não é ela: quem pediu fica sabendo pelo bot dela.
    if (decide !== p.pedidoPor || p.porProcuracao) await avisarQuemParticipa(deps, q, t, decide);
  }
  // ADR-162: a tarefa que passou a esperar a pessoa ganha a pergunta como comentário (o card fica na coluna). A do próprio
  // responsável perguntando é dele; a que o quadro deixou (freio, agente da etapa que sumiu) é do sistema. A recusa ("não
  // é comigo") já deixa o comentário dela logo abaixo.
  for (const id of plano.tocadas) {
    const t = gravadas.get(idReal.get(id) ?? id);
    const a = antesPorId.get(idReal.get(id) ?? id);
    if (!t || t.status !== "voce" || a?.status === "voce" || plano.recusas.some((r) => r.id === id)) continue;
    const doBot = autorAgenteId !== null && autorAgenteId === t.agenteId && !plano.freadas.some((f) => f.id === id);
    await comentarPergunta(deps, t, doBot ? { tipo: "agente", agenteId: autorAgenteId } : { tipo: "sistema" });
  }
  // NOD-419: o laço e o freio mandaram para Bloqueado — uma linha na conversa do responsável, sem banner e sem acionar.
  // Revisão 5 do PR #629: sem responsável o aviso sai pela conversa do agente que fez o lote. Revisão 7: o texto é do
  // sistema e sai sempre; de turno não confiável ou com tarefa de fora, sem o título (o único conteúdo de fora nele).
  for (const f of plano.freadas) {
    const t = gravadas.get(idReal.get(f.id) ?? f.id);
    const daConversa = t ? t.agenteId ?? autorAgenteId : null;
    if (!t || !daConversa) continue;
    const ev = await avisarComVoce(deps, t, autorAgenteId ?? daConversa, avisoDoFreio(t, f, p.origemConfiavel === false), daConversa, undefined, "freio");
    if (ev) events.push(ev);
  }
  // NOD-419: a recusa deixa o motivo em comentário na tarefa (a linha na atividade), além do histórico.
  for (const r of plano.recusas) {
    // Revisão 9 do PR #629: a tarefa criada no mesmo lote tem o id do plano (`novo:N`) até ser gravada; o comentário vai no real.
    await deps.repos.quadroComentarios.inserir({ quadroId: q.id, tarefaId: idReal.get(r.id) ?? r.id, autor: { tipo: "agente", agenteId: r.agenteId }, texto: `não é comigo — ${r.motivo}`, deFora: true }); // texto de bot é dado de fora (ADR-047/062; revisão do PR #629)
  }
  // 2026-11-10: a devolução deixa o motivo em comentário na tarefa (quem recebe também o lê no turno). De bot, de fora.
  for (const d of plano.devolvidas) {
    const nomeColuna = colunasFinais.find((c) => c.id === d.para)?.nome ?? d.para;
    await deps.repos.quadroComentarios.inserir({ quadroId: q.id, tarefaId: idReal.get(d.id) ?? d.id, autor: d.agenteId ? { tipo: "agente", agenteId: d.agenteId } : { tipo: "pessoa" }, texto: `devolveu para ${nomeColuna} — ${d.motivo}`, deFora: d.agenteId !== null });
  }

  // A meta fecha (ou reabre) pelo estado final das tarefas. Sem meta (fluxo contínuo, ADR-141) nada fecha.
  const finais = await repo.tarefas(q.id);
  // A meta foi POSTA neste lote (não havia), ou uma meta NOVA veio depois de a anterior ser cumprida: ela conta a partir
  // de agora (revisões 2, 3 e 4) — o feito antes dela não a cumpre, e o período do risco começa aqui. Corrigir o texto de
  // uma meta ainda aberta, ou trocar o prazo, não recomeça a contagem.
  const metaNova = meta !== null && (q.meta === null || (q.cumpridoEm !== null && meta !== q.meta));
  const metaDesde = metaNova ? agora : q.metaDesde;
  const nomes = new Map(agentes.map((a) => [a.id, a.nome]));
  const importadas = await deps.repos.quadroImportacoes.importadas(q.id);
  const { cumpridoEm, resumo } = fechoDaMeta({ meta, prazo, metaDesde, anterior: metaNova ? { cumpridoEm: null, resumo: null } : q }, finais, colunasFinais, nomes, agora, importadas);
  // ADA-28 (escopo E): quem dá o Done também é do quadro (ausente = bot).
  const quemFecha = plano.quadro.quemFecha ?? "bot";
  const mudouQuemFecha = quemFecha !== (q.quemFecha ?? "bot");
  const mudouQuadro = meta !== q.meta || prazo !== q.prazo || cumpridoEm !== q.cumpridoEm || resumo !== q.resumo || mudouQuemFecha;
  const mudouColunas = plano.mudouColunas;
  if (mudouQuadro || mudouColunas || plano.tocadas.length > 0 || plano.apagadas.length > 0) await repo.salvar(q.id, { meta, prazo, cumpridoEm, resumo, metaDesde, ...(mudouColunas ? { colunas: plano.quadro.colunas } : {}), ...(mudouQuemFecha ? { quemFecha } : {}) });
  // ADA-14 (QA): o nome e o projeto do editar_quadro, no mesmo lote; a foto guarda os de antes para o Desfazer.
  const mudouNome = !!renome && ((renome.nome !== undefined && renome.nome !== q.nome) || (renome.projetoId !== undefined && renome.projetoId !== q.projetoId));
  if (mudouNome) await repo.renomear(q.id, renome!);

  const tarefaIds = [...plano.tocadas.map((id) => idReal.get(id) ?? id), ...plano.apagadas];
  const foto: FotoLote = {
    quadro: nasceuAgora ? null : { meta: q.meta, prazo: q.prazo, cumpridoEm: q.cumpridoEm, resumo: q.resumo, metaDesde: q.metaDesde, colunas: q.colunas, quemFecha: q.quemFecha ?? "bot", ...(mudouNome ? { nome: q.nome, projetoId: q.projetoId } : {}) },
    tarefas: tarefaIds.map((id) => ({ id, antes: antesPorId.get(id) ?? null })),
  };
  const opsDoResumo: OpQuadro[] = nasceuAgora ? [{ tipo: "criar_quadro", meta: q.meta }, ...p.ops] : [...p.ops];
  const lote = nasceuAgora || tarefaIds.length > 0 || mudouQuadro || mudouColunas || mudouNome ? await repo.inserirLote({ quadroId: q.id, autor: p.autor, resumo: resumoDoLote(opsDoResumo, plano.frasesDasColunas), antes: foto, tarefaIds, pedidoPor: registraPedido, viaNome: deQuem }) : null;
  // NOD-419: o histórico do lote (a tarefa nova já com o id real) e os movimentos que ele desfez.
  await repo.inserirMovimentos(q.id, lote?.id ?? null, plano.movimentos.map((m) => ({ ...m, tarefaId: idReal.get(m.tarefaId) ?? m.tarefaId })));
  await repo.marcarMovimentosDesfeitos(plano.movimentosDesfeitos);
  // NOD-416: o histórico de cada tarefa tocada: o que o autor pediu é dele; o que o motor fez depois, da regra.
  const historicoDasTarefas: MudancaTarefa[] = [];
  for (const id of plano.tocadas) {
    const real = idReal.get(id) ?? id;
    const final = gravadas.get(real);
    const pedido = plano.pedidos.get(id);
    if (!final || !pedido) continue;
    historicoDasTarefas.push(...mudancasDaTarefa({ tarefaId: real, antes: antesPorId.get(real) ?? null, pedido, final, autor: p.autor, statusPorRegra: plano.porRegra.has(id) }));
  }
  // ADA-15: o passo que a fala da pessoa autorizou leva o id da mensagem no histórico da tarefa.
  const comMensagem = historicoDasTarefas.map((m) => { const f = plano.pelaFala.get(m.tarefaId); return f ? { ...m, mensagemId: f.id } : m; });
  await registrarHistoricoComTrilha(deps, q.id, comMensagem, lote?.id ?? null);
  const atualizado = (await repo.buscar(q.id)) ?? q;
  events.unshift(eventoQuadro(deps, p, atualizado, lote?.id ?? null, tarefaIds));
  // NOD-415 (ADR-141): o risco de prazo (só com meta e prazo), uma vez por (quadro, meta, prazo).
  const risco = await avisarRiscoDoQuadro(deps, atualizado, finais, importadas);
  if (risco) events.push(risco);
  // NOD-420: o que espera a pessoa (avisos-quadro.ts). A janela junta as decisões: a que acabou de entrar sai com as
  // outras no próximo lote ou na volta do varredor, não agora. A cobrança do prazo fica só no varredor e o aviso corre
  // isolado (revisão do PR #624): nenhum dos dois falha a edição.
  events.push(...(await avisarNoLote(deps, atualizado)));
  // ADA-28 (escopo E): com quem_fecha pessoa, o terminei da última etapa pede o Done (não move); e a tarefa que chegou a
  // Feito por outro caminho resolve a "pronta para o Done" que estava aberta.
  if (plano.pedemDone.length > 0) {
    const agenteDoTurno = p.autor.tipo === "agente" ? p.autor.agenteId : null;
    events.push(...(await pedirODone(deps, { quadroId: q.id, tarefaIds: plano.pedemDone, agenteId: agenteDoTurno, conversaId: p.conversaId ?? null })));
  }
  const fechadasAgora = [...gravadas.values()].filter((t) => { const g = grupoDe(colunasFinais, t.status); return g === "feito" || g === "fechado"; }).map((t) => t.id);
  if (fechadasAgora.length > 0) await fecharPedidosDeDone(deps, fechadasAgora);
  // No limite da corrente: o que ia começar e ficou em A fazer (o bot avisa; a pessoa começa pelo quadro).
  const seguradas = plano.seguradas.length;
  const criadas = plano.criadas.map((id) => idReal.get(id) ?? null);
  return { data: { ok: true, quadro: await montarQuadro(deps, atualizado, leitorDoLote(deps, p)), lote, comecaram, desfeito: false, ...(seguradas ? { seguradas } : {}), ...(plano.ajustada ? { ajustada: true } : {}), ...(criadas.length ? { criadas } : {}), ...(juntados ? { juntados } : {}) }, events };
}

/**
 * NOD-443 (revisão 1, achado 2): só quem decide (D5) responde a pendência ou a tira de Com você. A dona não responde a de
 * quem participa; quem participa não responde a da dona nem a de outra pessoa. O turno que o próprio quadro abriu (o bot
 * na tarefa, sem quem pediu) não passa por aqui: ele não responde (gerir_quadro) e pode retirar a própria pergunta.
 * Excluir não conta (é outra regra, achado 6). Devolve o detalhe da recusa, ou null.
 */
async function pendenciaAlheia(deps: Deps, q: Quadro, plano: Extract<ReturnType<typeof planejarLote>, { tarefas: unknown }>, antesPorId: ReadonlyMap<string, TarefaQuadro>, quem: string): Promise<string | null> {
  const respondidas = new Set(plano.respondidas.map((r) => r.id));
  const saem = plano.tocadas.filter((id) => antesPorId.get(id)?.status === "voce" && !paradaPeloLimite(plano, id) && (respondidas.has(id) || plano.tarefas.find((t) => t.id === id)?.status !== "voce"));
  if (saem.length === 0) return null;
  const membros = new Set((await deps.repos.quadros.membros(q.id)).map((m) => m.pessoaId));
  for (const id of saem) {
    const t = antesPorId.get(id)!;
    const d = quemDecide({ pedidoPor: t.pedidoPor, donaId: deps.escopo.pessoaId, membros });
    if (d.pessoaId === quem) continue;
    const nome = (await deps.repos.pessoas.buscar(d.pessoaId))?.nome ?? "outra pessoa";
    return `"${t.titulo}" espera ${nome}: só quem decide responde ou tira a tarefa de Com você. Diga a ${nome} ou deixe um comentário (comentar)`;
  }
  return null;
}

/**
 * NOD-419 × NOD-443 (merge do PR #628): o 4º "não é comigo" leva a tarefa de Com você a Bloqueado pelo limite de recusas. Não
 * é o bot respondendo a pendência: a parada é do sistema e só a pessoa a tira e desfaz, então as regras de quem decide não a
 * barram.
 */
function paradaPeloLimite(plano: Extract<ReturnType<typeof planejarLote>, { tarefas: unknown }>, id: string): boolean {
  return plano.recusas.some((r) => r.id === id) && plano.tarefas.find((t) => t.id === id)?.status === "bloqueado";
}

/**
 * NOD-443 (revisão 2 do PR #628, achado 6): o turno que o próprio quadro abriu (sem quem pediu) só tira de Com você a
 * tarefa dele; sem turno (ou sem tarefa ligada a ele), nenhuma. Devolve o detalhe da recusa, ou null.
 */
function pendenciaDeOutraTarefa(plano: Extract<ReturnType<typeof planejarLote>, { tarefas: unknown }>, antesPorId: ReadonlyMap<string, TarefaQuadro>, daTarefa: string | null): string | null {
  const respondidas = new Set(plano.respondidas.map((r) => r.id));
  for (const id of plano.tocadas) {
    const a = antesPorId.get(id);
    if (a?.status !== "voce" || id === daTarefa || paradaPeloLimite(plano, id)) continue;
    if (respondidas.has(id) || plano.tarefas.find((t) => t.id === id)?.status !== "voce") return `"${a.titulo}" espera quem decide: este turno só mexe na pendência da tarefa dele. Deixe um comentário (comentar)`;
  }
  return null;
}

/**
 * NOD-443 (revisão 2 do PR #628, achado 2): no turno que o pedido de quem participa abriu, o bot da dona age por ela, e
 * só na tarefa do turno: não cria nem exclui outras, não mexe nas outras, nem na meta, no prazo ou nas colunas.
 */
function foraDaTarefaDoTurno(q: Quadro, plano: Extract<ReturnType<typeof planejarLote>, { tarefas: unknown }>, daTarefa: string | null): string | null {
  const caminho = "neste turno, o bot só mexe na tarefa que foi pedida a ele. Para o resto, peça a quem pediu ou à dona";
  if (plano.quadro.meta !== q.meta || plano.quadro.prazo !== q.prazo || plano.mudouColunas || (plano.quadro.quemFecha ?? "bot") !== (q.quemFecha ?? "bot")) return `A meta, o prazo e as colunas são da dona: ${caminho}`;
  const outra = [...plano.tocadas, ...plano.apagadas].find((id) => id !== daTarefa);
  if (outra === undefined) return null;
  const titulo = plano.tarefas.find((t) => t.id === outra)?.titulo;
  return `${titulo ? `"${titulo}"` : "Essa tarefa"} não é a deste turno: ${caminho}`;
}

/**
 * NOD-443 (revisão 1, achado 6): quem participa não exclui nem reescreve (título, descrição, responsável) a tarefa que não
 * pediu. Na dela, tudo; na dos outros, mudar o status, responder o que é dela (pendenciaAlheia) e comentar. A dona, tudo.
 * Revisão 3 do PR #628 (pós-merge), achado 2: a pergunta e o PR também são de quem pediu (a pergunta vira a pendência de
 * quem decide; o PR entra no turno da resposta). O bot da dona sob a procuração dela (`porProcuracao`) escreve os dois
 * na tarefa do turno dele (é o trabalho dele: perguntar, abrir o PR); o que ele escreve fica de fora (planejarLote). Revisão
 * 4, achado 1: o item do Linear (linearId, linearUrl) e o deFora também; os PRs ligados (NOD-421, quadro_tarefa_prs) não
 * passam pelo lote (só o laço do servidor os grava, na tarefa da dona).
 */
function tarefaDeOutraPessoa(plano: Extract<ReturnType<typeof planejarLote>, { tarefas: unknown }>, antesPorId: ReadonlyMap<string, TarefaQuadro>, quem: string, porProcuracao: boolean): string | null {
  const caminho = "Mude o status ou deixe um comentário (comentar) para quem pediu";
  for (const id of plano.apagadas) {
    const a = antesPorId.get(id);
    if (a && a.pedidoPor !== quem) return `"${a.titulo}" não foi você quem pediu: só quem pediu e a dona a excluem. ${caminho}`;
  }
  for (const id of plano.tocadas) {
    const a = antesPorId.get(id);
    const t = plano.tarefas.find((x) => x.id === id);
    if (!a || !t || a.pedidoPor === quem) continue;
    // NOD-455 (revisão 5, achado M1): mudar o status é de quem participa, e a passagem da coluna (ADR-142) troca o
    // responsável. Essa troca é da regra, não dela: vale quando o responsável final é o da coluna em que a tarefa ficou.
    // Revisão 7, achado A1: uma troca explícita no lote (até para ninguém) não é da regra, e a coluna sem responsável não passa.
    const pelaPassagem = plano.passagens.has(id) && !plano.trocasDeResponsavel.has(id) && t.agenteId !== null && t.agenteId === responsavelDe(colunasDe(plano.quadro), t.status);
    if (t.titulo !== a.titulo || t.descricao !== a.descricao || (t.agenteId !== a.agenteId && !pelaPassagem)) return `"${a.titulo}" não foi você quem pediu: o título, a descrição e o responsável são de quem pediu e da dona. ${caminho}`;
    if (!porProcuracao && (t.pergunta !== a.pergunta || t.prUrl !== a.prUrl)) return `"${a.titulo}" não foi você quem pediu: a pergunta e o PR são de quem pediu e da dona. ${caminho}`;
    // Revisão 4 do PR #628, achado 1: trazer de novo do Linear (importar_linear) reescrevia o link e marcava a tarefa da dona
    // de fora sem mudar o título. O item do Linear e a proveniência também são de quem pediu e da dona; sob a procuração, o
    // bot marca de fora o que ele escreve na tarefa do turno dele (a pergunta, o PR), e isso vale.
    if (t.linearId !== a.linearId || t.linearUrl !== a.linearUrl) return `"${a.titulo}" não foi você quem pediu: o item do Linear dela é de quem pediu e da dona. ${caminho}`;
    if (!porProcuracao && t.deFora !== a.deFora) return `"${a.titulo}" não foi você quem pediu: o conteúdo dela é de quem pediu e da dona. ${caminho}`;
  }
  return null;
}

/** A aba Quadro de um bot: o quadro dele montado (ou null, ainda sem quadro). Experimento desligado = nao_permitido. */
export const verQuadro: CasoDeUso<{ agenteId: string; quadro?: string | null }, { quadro: QuadroDto | null }> = async (deps, input) => {
  if (!(await experimentoLigado(deps))) throw new ErroDeDominio("nao_permitido", { cause: "experimento quadro desligado" });
  // ADA-14: o quadro que a tela escolheu (se ainda for deste bot); sem ele, o padrão.
  const q = await deps.repos.quadros.daTela(input.agenteId, input.quadro);
  return { data: { quadro: q ? await montarQuadro(deps, q) : null } };
};

async function exigirQuadroLigado(deps: Deps): Promise<void> {
  if (!(await experimentoLigado(deps))) throw new ErroDeDominio("nao_permitido", { cause: "experimento quadro desligado" });
}

/**
 * NOD-416: o link da tarefa (`?tarefa=ZE-12`). O código atual ou um antigo (a tarefa mudou de quadro) leva a ela, no quadro
 * em que está hoje; o id também vale. Outro dono não acha (a RLS e o filtro do dono): nao_encontrado.
 */
export const verTarefaPorCodigo: CasoDeUso<{ codigo: string }, TarefaPorCodigoDto> = async (deps, input) => {
  await exigirQuadroLigado(deps);
  const repo = deps.repos.quadros;
  // Revisão 6 do PR #630: a URL da issue no Linear também abre a tarefa importada (o mesmo que o mover_quadro aceita).
  const ref = identificadorDaUrl(input.codigo) ?? input.codigo.trim();
  const uuid = ehUuid(ref) ? await repo.tarefa(ref.toLowerCase()) : null;
  // A entrada crua: tarefasDoCodigo distingue a URL do Linear (só pode ser a importada) do código puro.
  const achadas = uuid ? [uuid] : await tarefasDoCodigo(deps, input.codigo.trim());
  const opcoes = await opcoesDeTarefa(deps, ref, achadas);
  if (opcoes.length === 0) throw new ErroDeDominio("nao_encontrado", { cause: `tarefa ${ref}` });
  if (opcoes.length > 1) return { data: { ambigua: opcoes } };
  const { titulo: _t, doLinear: _l, ...achada } = opcoes[0]!;
  return { data: achada };
};

/**
 * Revisão do PR #630: as tarefas que um código acha, a mesma regra no link e no mover_quadro. O código do quadro (atual
 * ou antigo, em `quadro_tarefa_codigos`) e o id do Linear (a tarefa trazida de lá, em qualquer quadro). Quando são
 * tarefas diferentes, nenhuma ganha: quem chamou pede a escolha. Revisão 8: a URL da issue no Linear só pode ser da
 * importada; com ela, a tarefa de mesmo linear_id ganha da que tem o código no quadro (a nativa NOD-451 criada no quadro
 * de prefixo NOD antes de a issue NOD-451 chegar). O código puro segue perguntando qual.
 */
async function tarefasDoCodigo(deps: Deps, entrada: string): Promise<TarefaQuadro[]> {
  const repo = deps.repos.quadros;
  const daUrl = identificadorDaUrl(entrada);
  const ref = daUrl ?? entrada;
  const importadas = /^[a-z][a-z0-9]{0,9}-\d+$/i.test(ref.trim()) ? await repo.tarefasDoLinear(ref) : [];
  // Revisão 10: a URL sem importada não cai no código do quadro (abriria, e o mover_quadro moveria, a nativa de mesmo
  // código, sem Desfazer): é nao_encontrado.
  if (daUrl) return importadas;
  const c = lerCodigo(ref);
  const id = c ? await repo.tarefaDoCodigo(c.prefixo, c.numero) : null;
  const nativa = id ? await repo.tarefa(id) : null;
  const porId = new Map<string, TarefaQuadro>();
  for (const t of [...importadas, ...(nativa ? [nativa] : [])]) porId.set(t.id, t);
  return [...porId.values()];
}

/** Cada tarefa achada com o quadro em que está hoje (a de quadro sumido sai) e o código atual. */
async function opcoesDeTarefa(deps: Deps, ref: string, tarefas: readonly TarefaQuadro[]): Promise<OpcaoDeTarefaDto[]> {
  const c = lerCodigo(ref);
  const quadros = new Map((await deps.repos.quadros.buscarVarios([...new Set(tarefas.map((t) => t.quadroId))])).map((q) => [q.id, q]));
  return tarefas.flatMap((t) => {
    const q = quadros.get(t.quadroId);
    if (!q) return [];
    const codigoAtual = codigoDaTarefa(q.prefixo, t);
    const doLinear = t.linearId !== null && chaveDeBusca(t.linearId) === chaveDeBusca(ref);
    return [{ agenteId: q.agenteId, quadroId: q.id, tarefaId: t.id, codigo: c ? formatarCodigo(c.prefixo, c.numero) : codigoAtual, codigoAtual, titulo: t.titulo, doLinear }];
  });
}

/** NOD-416: o histórico da tarefa aberta, com os nomes resolvidos (a coluna, o bot, o anfitrião do quadro). */
export const historicoDaTarefa: CasoDeUso<{ agenteId: string; tarefaId: string }, { historico: EntradaHistoricoDto[] }> = async (deps, input) => {
  await exigirQuadroLigado(deps);
  const repo = deps.repos.quadros;
  const t = ehUuid(input.tarefaId) ? await repo.tarefa(input.tarefaId) : null;
  // ADA-14: a tarefa de qualquer quadro deste bot (não só do padrão).
  const q = t ? await repo.doBot(input.agenteId, t.quadroId) : null;
  if (!q || !t || t.quadroId !== q.id) throw new ErroDeDominio("nao_encontrado", { cause: "tarefa fora deste quadro" });
  const linhas = await repo.historico(t.id);
  // Revisão 2 do PR #623: os quadros e os bots citados numa leitura só (antes, uma busca por linha), e a coluna pelo
  // quadro em que a mudança aconteceu (antes, a coluna da pessoa no quadro de origem saía com o id cru).
  const ehId = (v: string | null): v is string => v !== null && ehUuid(v);
  const idsQuadros = new Set<string>([q.id, ...linhas.map((l) => l.quadroId)]);
  for (const l of linhas) if (l.campo === "quadro") for (const v of [l.de, l.para]) if (ehId(v)) idsQuadros.add(v);
  const quadros = new Map((await repo.buscarVarios([...idsQuadros])).map((x) => [x.id, x]));
  const nomesBot = new Map((await deps.repos.agentes.listar({ incluirOcultos: true, incluirExcluidos: true })).map((a) => [a.id, a.nome]));
  const nomeDoBot = (id: string | null): string | null => (id === null ? null : nomesBot.get(id) ?? null);
  const nomeDoQuadro = (id: string | null): string | null => {
    const outro = id === null ? undefined : quadros.get(id);
    return outro ? nomeDoBot(outro.agenteId) : null;
  };
  const nomeDaColuna = (quadroId: string | undefined, id: string | null): string | null => {
    if (id === null) return null;
    const daqui = quadroId !== undefined ? quadros.get(quadroId) : undefined;
    const c = colunasDe(daqui ?? q).find((x) => x.id === id);
    if (c) return c.nome;
    for (const outro of quadros.values()) { const x = colunasDe(outro).find((y) => y.id === id); if (x) return x.nome; }
    return COLUNAS_PADRAO.find((x) => x.id === id)?.nome ?? (id === "voce" ? NOME_DA_ESPERA : id);
  };
  const historico: EntradaHistoricoDto[] = [];
  // No mover, a linha de status vem logo depois da de quadro: o `de` dela é uma coluna da origem.
  let origemDoMover: string | undefined;
  for (const l of linhas) {
    const deQuadro = l.campo === "status" && origemDoMover !== undefined ? origemDoMover : l.quadroId;
    origemDoMover = l.campo === "quadro" && ehId(l.de) ? l.de : undefined;
    const nome = (v: string | null, quadroId: string) => (l.campo === "agente" ? nomeDoBot(v) : l.campo === "quadro" ? nomeDoQuadro(v) : l.campo === "linear" ? v : nomeDaColuna(quadroId, v));
    const { quadroId: _quadroId, ...linha } = l;
    historico.push({ ...linha, deNome: nome(l.de, deQuadro), paraNome: nome(l.para, l.quadroId), autorNome: l.autor === "agente" ? nomeDoBot(l.autorAgenteId) : null });
  }
  return { data: { historico } };
};

/** NOD-416: os quadros da pessoa, para o "Mover para…" da tarefa aberta. */
export const listarQuadros: CasoDeUso<Record<string, never>, { quadros: QuadroDaPessoaDto[] }> = async (deps) => {
  await exigirQuadroLigado(deps);
  // Revisão 3 do PR #623: uma leitura dos bots (ocultos e excluídos também, como o buscar de antes), não uma por quadro.
  const nomes = new Map((await deps.repos.agentes.listar({ incluirOcultos: true, incluirExcluidos: true })).map((a) => [a.id, a.nome]));
  const quadros: QuadroDaPessoaDto[] = (await deps.repos.quadros.listar()).map((q) => ({ id: q.id, agenteId: q.agenteId, agenteNome: nomes.get(q.agenteId) ?? "", prefixo: q.prefixo }));
  return { data: { quadros } };
};
