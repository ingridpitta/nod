import type { IaComConta } from "../contracts/contas-ia.ts";
import { IAS_COM_CONTA } from "../contracts/contas-ia.ts";
import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import type { IdHarness } from "../contracts/harness.ts";
import type { InteligenciaBot } from "../contracts/inteligencia.ts";
import type { Preferencias } from "../contracts/raio-x.ts";
import type { ContaDaTroca, DecisaoDaPessoa, DecisaoDaTroca, PayloadTrocaDeIa, TrocaDeIa } from "../contracts/troca-de-ia.ts";
import { DECISOES_DA_PESSOA } from "../contracts/troca-de-ia.ts";
import type { UsoDoPlano } from "../contracts/uso-do-plano.ts";
import { filaLivre, naFila, voltaDaIa } from "../domain/contas-da-pessoa.ts";
import { contasPelaCota, cotaDasContas, cotaDasIas, cotaSegura, entradaDaTrocaDeContaSemSessao, entradaDaTrocaDeIa, situacaoDaIa, type TipoParaCota } from "../domain/cota-da-ia.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { quandoDaFrase } from "../domain/erro-fornecedor.ts";
import { derivadosDa, iaDoAutomatico, iasNoLimite, inteligenciaDoAgente, ordemEfetiva, proximaIaNoLimite } from "../domain/inteligencia.ts";
import { aplicarEmDaTroca, fraseDaTroca, nomeDoProvedor, recomendacaoDaTroca } from "../domain/troca-de-ia.ts";
import { log } from "../obs/log.ts";
import { alvoDoBot } from "./alvo-do-bot.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { contasDaMaquinaDe, escolherContaDoTurno, lerContas, type ContasDaMaquina, type LeituraDasContas } from "./contas-do-turno.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import type { Isolar } from "./turnos-orfaos.ts";

/**
 * A troca de IA das tasks no limite (definido em 2026-10-16, ADR-108 R4/R5/R6). O aviso é um por bot e IA que parou
 * (`trocas_de_ia`, índice único parcial): a task que para na IA da sessão dela espera a volta da conta e ganha o aviso com
 * a recomendação (esperar / levar); a pessoa decide pela rota `POST /agentes/:id/troca-de-ia`, e o varredor de 30 s aplica
 * o "levar" vencido, fecha o aviso quando a conta volta e devolve o bot fixo que seguiu noutra IA (R6 b).
 *
 * Revisão do PR 2 (16/10): "parou" e "voltou" são a MESMA regra (`estadoDaIa`), medida nas contas logadas na máquina-alvo
 * das tasks do bot (`maquinaDasTasks`, gravada no aviso), com a cota medida do plano por cima (C1/C2); a outra IA
 * oferecida precisa estar pronta nessa máquina (C5).
 */

const ehIaComConta = (ia: string): ia is IaComConta => (IAS_COM_CONTA as readonly string[]).includes(ia);

/**
 * definido em 2026-10-16 (revisão do PR 2, C2): o aviso do mesmo bot e da mesma IA que reabre até 30 min depois de fechar
 * reaproveita a linha dele na conversa (atualiza, sem linha nova): a IA que oscila não enche a conversa de avisos.
 */
export const JANELA_DO_AVISO_MS = 30 * 60_000;

/**
 * definido em 2026-10-16 (revisão do PR 2, C3): a decisão "esperar"/"conta" que ainda espera a IA voltar vale no máximo um
 * dia; depois o varredor a dá por encerrada (a máquina pode ter saído da conta e nunca mais "voltar").
 */
export const ESPERA_DECIDIDA_VALE_MS = 24 * 60 * 60_000;

/**
 * C2/C5: a máquina-alvo das tasks do bot — a dele, senão a padrão da pessoa (com a chave viva, `alvoDoBot`), senão a que
 * pegou o turno. null = nenhuma (o caminho sem máquina vale o limite da IA).
 */
export async function maquinaDasTasks(deps: Pick<Deps, "repos">, agenteId: string, machineId: string | null): Promise<string | null> {
  return (await alvoDoBot(deps, agenteId))?.id ?? machineId;
}

/** O que a regra da IA lê do banco: as contas e as máquinas, as preferências e o uso do plano (uma vez por tique, I5). */
export type LeituraDasIas = LeituraDasContas & { preferencias: Preferencias; usos: readonly UsoDoPlano[]; usosPorConta: readonly UsoDoPlano[] };

export async function lerIas(deps: Pick<Deps, "repos">): Promise<LeituraDasIas> {
  const [contas, preferencias, usos, usosPorConta] = await Promise.all([lerContas(deps), deps.repos.preferencias.buscar(), deps.repos.usoDoPlano.listar(), deps.repos.usoDoPlano.listarPorConta()]);
  return { ...contas, preferencias, usos, usosPorConta };
}

/**
 * NOD-401 (definido em 2026-10-28): as contas com a cota medida POR CONTA (uso_do_plano_contas) aplicada — a conta que a
 * cota segura para `tipo` conta como no limite até a janela dela renovar. A mesma visão no estado, no aviso e no varredor.
 */
export function contasComCota(l: LeituraDasIas, agora: number, tipo: TipoParaCota = "fundo_seguindo"): LeituraDasIas["contas"] {
  return contasPelaCota(l.contas, cotaDasContas({ usos: l.usosPorConta, agora }), tipo);
}

/**
 * A IA `ia` parou para as tasks do bot na máquina `machineId`, e quando volta? Uma regra só para o despacho (a guarda E1),
 * o aviso (a volta) e o varredor ("voltou"):
 * - com `contaDe` (I1, ChatGPT): só a conta da sessão conta — parou enquanto ela estiver no limite;
 * - com conta da IA logada na máquina: a conta em uso dela (`contaDoTurno`, a fila); a volta pela mesma regra
 *   (`voltaDaIa`). Uma conta livre só noutra máquina não traz a IA de volta para o bot (C2);
 * - sem conta dela na máquina (ou sem máquina): o limite da IA (`preferencias.ias_no_limite`);
 * - a cota medida do plano (C1): POR CONTA (NOD-401, `uso_do_plano_contas`) nos dois primeiros casos — a conta que a cota
 *   segura para este tipo de trabalho (`cotaSegura`; a task com sessão é `fundo_seguindo`, que só o limite segura) conta
 *   como no limite até a janela dela renovar; a linha por IA (`uso_do_plano`) só no terceiro (sem conta na máquina).
 * `voltaEm` null = ninguém disse quando (I6: nada inventa 1 h aqui).
 */
export function estadoDaIa(l: LeituraDasIas, p: { ia: IdHarness; machineId: string | null; ordemDoBot: readonly IdHarness[] | null; agora: number; contaDe?: string | null; tipo?: TipoParaCota }): { parou: boolean; voltaEm: number | null } {
  const { ia, agora } = p;
  let parou = false;
  let voltaEm: number | null = null;
  const tipo = p.tipo ?? "fundo_seguindo";
  // NOD-401: a cota medida POR CONTA (uso_do_plano_contas, a regra de cotaDasIasComContas): a conta que a cota segura para
  // este tipo de trabalho conta como no limite até a janela dela renovar. A leitura de uma conta não pesa nas outras.
  const contas = contasComCota(l, agora, tipo);
  const daConta = p.contaDe ? contas.find((c) => c.id === p.contaDe && c.removidaEm === null) : undefined;
  const daMaquinaLida = p.machineId && ehIaComConta(ia) ? contasDaMaquinaDe(l, p.machineId, agora) : null;
  const daMaquina = daMaquinaLida ? { ...daMaquinaLida, contas } : null;
  const temContaAqui = daMaquina !== null && daMaquina.contas.some((c) => c.ia === ia && c.removidaEm === null && daMaquina.naMaquina.has(c.id));
  if (daConta) {
    parou = daConta.noLimiteAte !== null && daConta.noLimiteAte > agora;
    voltaEm = parou ? daConta.noLimiteAte : null;
  } else if (daMaquina && temContaAqui && ehIaComConta(ia)) {
    const r = escolherContaDoTurno(daMaquina, p.ordemDoBot, agora);
    parou = r !== null && r.porIa[ia] === null;
    voltaEm = parou ? voltaDaIa(daMaquina.contas, ia, agora, { naMaquina: daMaquina.naMaquina, escolhida: daMaquina.escolhidas[ia] ?? null }) : null;
  } else {
    parou = iasNoLimite(l.preferencias.iasNoLimite, agora).includes(ia);
    const renova = l.preferencias.iasNoLimite?.[ia]?.renovaEm;
    voltaEm = parou && renova !== undefined ? renova : null;
    // C1: a cota medida por IA (uso_do_plano, a leitura da última conta que rodou) só vale para a IA sem conta logada na
    // máquina (motor, app antigo). Com conta logada, a linha por IA é a de UMA conta e não segura as outras (NOD-401).
    const cota = cotaDasIas({ usos: l.usos, limites: null, agora }).find((c) => c.ia === ia);
    if (cota && cotaSegura(tipo, situacaoDaIa([cota], ia))) {
      parou = true;
      voltaEm = Math.max(voltaEm ?? 0, cota.voltaEm);
    }
  }
  return { parou, voltaEm };
}

/**
 * NOD-401 (definido em 2026-10-28): a conta da IA que parou na máquina-alvo, para o cartão dizer o apelido. É a conta cuja
 * volta é a do aviso (`voltaEm`, pela cota por conta) — o cartão nunca junta o apelido de uma com a volta de outra; sem
 * ela, a escolhida da pessoa logada ali, senão a primeira da fila ali, senão a primeira da IA ali. null = sem conta da IA
 * na máquina (o cartão diz só a IA).
 */
export function contaQueParou(l: LeituraDasIas, p: { ia: IdHarness; machineId: string | null; agora: number; voltaEm: number | null; tipo?: TipoParaCota }): { id: string; apelido: string } | null {
  if (!p.machineId || !ehIaComConta(p.ia)) return null;
  const daMaquina = contasDaMaquinaDe(l, p.machineId, p.agora);
  const contas = contasComCota(l, p.agora, p.tipo);
  const daIa = contas.filter((c) => c.ia === p.ia && c.removidaEm === null && daMaquina.naMaquina.has(c.id)).sort((a, b) => a.posicao - b.posicao);
  const escolhida = daMaquina.escolhidas[p.ia];
  const daVolta = p.voltaEm !== null ? daIa.filter((c) => c.noLimiteAte === p.voltaEm) : [];
  const conta = daVolta.find((c) => c.id === escolhida) ?? daVolta.find(naFila) ?? daVolta[0] ?? daIa.find((c) => c.id === escolhida) ?? daIa.find(naFila) ?? daIa[0];
  return conta ? { id: conta.id, apelido: conta.apelido } : null;
}

export type NovoAvisoDeTroca = {
  agenteId: string;
  /** A conversa do turno, se o bot não tiver a própria (a linha mora na conversa do bot). */
  conversaId: string;
  /** Só o turno da CONVERSA (o "Continuar na conta" refaz ele); o da task levaria a linha para a tela da task. */
  turnoId: string | null;
  iaDe: IdHarness;
  iaPara: IdHarness | null;
  voltaEm: number | null;
  fixo: boolean;
  /** C2: a máquina-alvo das tasks do bot (a regra do "voltou" é medida nela). */
  machineId: string | null;
  conta?: ContaDaTroca | null;
  /** I1: no ChatGPT, a conta da sessão que parou ("levar" = outra conta do ChatGPT; `iaPara` = `iaDe`). */
  contaDe?: { id: string; apelido: string } | null;
  /** NOD-401: a conta da IA que parou na máquina-alvo (o cartão diz o apelido, não só a IA). */
  contaQueParou?: { id: string; apelido: string } | null;
  /** C5: a outra IA só está pronta fora da máquina do bot (o cartão explica por que não oferece "levar"). */
  foraDaMaquina?: { ia: IdHarness; maquina: string | null } | null;
  autoria: Autoria;
  agora: number;
};

/**
 * Cria ou atualiza o aviso de troca do bot para a IA que parou (R4/R6) e a linha de sistema dele na conversa do bot: uma
 * linha por aviso; a task seguinte que para na mesma IA atualiza a mesma (o número de tasks, a volta e a recomendação).
 * Revisão do PR 2:
 * - C3: a pessoa já escolheu "esperar" para esta IA e ela ainda não voltou — a task nova herda a escolha: nenhum aviso,
 *   nenhum prazo novo; só a contagem da linha da decisão sobe;
 * - C2: o aviso que reabre dentro de `JANELA_DO_AVISO_MS` reaproveita a linha do anterior (sem linha nova);
 * - C5: sem outra IA pronta na máquina do bot, a recomendação é esperar e não há prazo.
 */
export async function avisarTrocaDeIa(deps: Deps, p: NovoAvisoDeTroca): Promise<RuntimeEvent[]> {
  const agente = await deps.repos.agentes.buscar(p.agenteId);
  if (!agente) return [];
  const tasks = await deps.repos.turnos.contarTasksNaIa(p.agenteId, p.iaDe);
  if (p.turnoId === null && !p.fixo) {
    const espera = await deps.repos.trocasDeIa.esperaDecidida(p.agenteId, p.iaDe);
    if (espera) {
      const m = espera.mensagemId ? await deps.repos.mensagens.buscar(espera.mensagemId) : null;
      if (m?.payload?.kind === "troca_de_ia" && m.payload.tasks !== tasks) await deps.repos.mensagens.atualizarSistema(m.id, { texto: m.texto, payload: { ...m.payload, tasks } });
      log("info", "troca_de_ia_herdou_espera", { troca_id: espera.id, agente_id: p.agenteId, de: p.iaDe, tasks });
      return [];
    }
  }
  const propria = await deps.repos.conversas.buscarPropriaDoAgente(p.agenteId);
  const conversaId = propria?.id ?? p.conversaId;
  // O bot fixo não tem recomendação para aplicar: ele volta sozinho, e os dois caminhos são escolha da pessoa (R6). Sem
  // para onde levar (C5), só esperar.
  const recomendacao = p.fixo || !p.iaPara ? "esperar" : recomendacaoDaTroca({ voltaEm: p.voltaEm, agora: p.agora });
  const { troca, nova } = await deps.repos.trocasDeIa.abrir({
    agenteId: p.agenteId,
    conversaId,
    iaDe: p.iaDe,
    iaPara: p.iaPara,
    recomendacao,
    voltaEm: p.voltaEm,
    aplicarEm: p.fixo || !p.iaPara ? null : aplicarEmDaTroca(recomendacao, p.agora),
    fixo: p.fixo,
    machineId: p.machineId,
    contaDe: p.contaDe?.id ?? null,
    agora: p.agora,
  });
  const contaPara = await contaParaDoAviso(deps, p);
  const payload: PayloadTrocaDeIa = payloadDaTroca(troca, tasks, { conta: p.conta ?? null, contaDe: p.contaDe ?? null, foraDaMaquina: p.foraDaMaquina ?? null, contaPara, contaQueParou: p.contaQueParou ?? null });
  const texto = fraseDaTroca({
    nomeDe: nomeDoProvedor(troca.iaDe),
    nomePara: troca.iaPara ? nomeDoProvedor(troca.iaPara) : null,
    nomeDoBot: agente.nome,
    recomendacao: troca.recomendacao,
    tasks,
    fixo: troca.fixo,
    voltaEm: troca.voltaEm,
    quando: (t) => quandoDaFrase(t, p.agora),
    contaDe: p.contaDe?.apelido ?? null,
    contaQueParou: p.contaQueParou?.apelido ?? null,
    foraDaMaquina: p.foraDaMaquina ? { nome: nomeDoProvedor(p.foraDaMaquina.ia), maquina: p.foraDaMaquina.maquina } : null,
  });
  const events: RuntimeEvent[] = [];
  // C2: reabriu logo depois de fechar — a linha do anterior volta a ser a do aviso. Só no aviso das tasks: o da fala da
  // conversa (bot fixo) leva o turno dela, que o "Continuar na conta" refaz — a linha velha apontaria a fala velha.
  const recente = nova && !troca.mensagemId && p.turnoId === null ? await deps.repos.trocasDeIa.fechadaRecente(p.agenteId, p.iaDe, p.agora - JANELA_DO_AVISO_MS) : null;
  const linhaRecente = recente?.mensagemId ? await deps.repos.mensagens.buscar(recente.mensagemId) : null;
  const reaproveitada = linhaRecente && linhaRecente.turnoId === null ? recente : null;
  if (reaproveitada?.mensagemId) await deps.repos.trocasDeIa.definirMensagem(troca.id, reaproveitada.mensagemId);
  const mensagemId = troca.mensagemId ?? reaproveitada?.mensagemId ?? null;
  if (mensagemId && (await deps.repos.mensagens.atualizarSistema(mensagemId, { texto, payload, turnoId: p.turnoId }))) {
    events.push(evento(deps.escopo, { kind: "agente_atualizado", autoria: p.autoria, agora: p.agora, conversaId: troca.conversaId, dados: { agente_id: p.agenteId, acao: "troca_de_ia" } }));
  } else {
    const linha = await deps.repos.mensagens.criar({ conversaId: troca.conversaId, turnoId: p.turnoId, autoria: p.autoria, kind: "sistema", texto, payload, confianca: "confiavel" });
    if (linha) {
      await deps.repos.trocasDeIa.definirMensagem(troca.id, linha.id);
      events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria: p.autoria, agora: p.agora, conversaId: troca.conversaId, turnoId: p.turnoId, dados: { mensagem_id: linha.id, kind: "sistema" } }));
    }
  }
  // Só códigos e ids (o "pronto quando" do R4 se mede por aqui).
  log("info", nova ? "troca_de_ia_aberta" : "troca_de_ia_atualizada", { troca_id: troca.id, agente_id: p.agenteId, de: troca.iaDe, para: troca.iaPara, recomendacao: troca.recomendacao, volta_em: troca.voltaEm, tasks, fixo: troca.fixo, machine_id: troca.machineId, reaproveitou_linha: reaproveitada !== null });
  return events;
}

/**
 * NOD-390: a conta para onde a conversa segue na outra IA — a conta em uso dela na máquina-alvo do bot, pela fila
 * (`contaDoTurno`, a mesma regra do despacho). Só no aviso das tasks no Automático; null = sem máquina, a IA não tem conta
 * logada ali, ou nenhuma utilizável agora (o cartão diz só a IA, como antes).
 */
async function contaParaDoAviso(deps: Deps, p: NovoAvisoDeTroca): Promise<{ id: string; apelido: string } | null> {
  if (p.fixo || !p.iaPara || p.iaPara === p.iaDe || !p.machineId || !ehIaComConta(p.iaPara)) return null;
  const conta = escolherContaDoTurno(contasDaMaquinaDe(await lerContas(deps), p.machineId, p.agora), null, p.agora)?.porIa[p.iaPara] ?? null;
  return conta ? { id: conta.id, apelido: conta.apelido } : null;
}

function payloadDaTroca(t: TrocaDeIa, tasks: number, extra: { conta: ContaDaTroca | null; contaDe: { id: string; apelido: string } | null; foraDaMaquina: { ia: IdHarness; maquina: string | null } | null; contaPara: { id: string; apelido: string } | null; contaQueParou?: { id: string; apelido: string } | null }): PayloadTrocaDeIa {
  return {
    kind: "troca_de_ia",
    trocaId: t.id,
    agenteId: t.agenteId,
    iaDe: t.iaDe,
    iaPara: t.iaPara,
    recomendacao: t.recomendacao,
    voltaEm: t.voltaEm,
    tasks,
    aplicarEm: t.aplicarEm,
    ...(t.fixo ? { fixo: true as const, conta: extra.conta } : {}),
    ...(extra.contaDe ? { contaDe: extra.contaDe } : {}),
    ...(extra.contaPara ? { contaPara: extra.contaPara } : {}),
    ...(extra.contaQueParou && !extra.contaDe ? { contaQueParou: extra.contaQueParou } : {}),
    ...(extra.foraDaMaquina ? { foraDaMaquina: extra.foraDaMaquina } : {}),
    ...(t.decisao ? { decisao: t.decisao, decididoEm: t.decididoEm ?? undefined } : {}),
  };
}

/** A linha do aviso ganha o desfecho (a tela troca os botões pelo que aconteceu). */
async function marcarDesfechoNaLinha(deps: Deps, t: TrocaDeIa): Promise<void> {
  if (!t.mensagemId || !t.decisao) return;
  const m = await deps.repos.mensagens.buscar(t.mensagemId);
  if (m?.payload?.kind !== "troca_de_ia") return;
  await deps.repos.mensagens.atualizarSistema(t.mensagemId, { texto: m.texto, payload: { ...m.payload, decisao: t.decisao, ...(t.decididoEm !== null ? { decididoEm: t.decididoEm } : {}) } });
}

/**
 * A fala da conversa que parou no limite do bot fixo (o turno da linha do aviso) volta à fila, uma vez, com a
 * inteligência que o bot tem agora. Nada a refazer (aviso de task, turno já refeito, ou não parou): nada.
 */
async function refazerFalaDoAviso(deps: Deps, t: TrocaDeIa, agora: number): Promise<RuntimeEvent[]> {
  const linha = t.mensagemId ? await deps.repos.mensagens.buscar(t.mensagemId) : null;
  const turno = linha?.turnoId ? await deps.repos.turnos.buscar(linha.turnoId) : null;
  if (!turno || turno.origem !== "conversa" || turno.estado !== "interrompido" || turno.trabalhoId) return [];
  const depois = (await deps.repos.mensagens.listarDaConversa(turno.conversaId, 30)).filter((m) => m.criadoEm > (linha?.criadoEm ?? 0));
  if (depois.some((m) => m.autoria.autor_tipo === "agente")) return [];
  const novo = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "conversa",
    prazoEm: agora + Math.max(60_000, turno.prazoEm - turno.criadoEm),
    profundidade: turno.profundidade,
    entradaTexto: turno.entradaTexto,
    mensagemOrigemId: turno.mensagemOrigemId,
    entradaAnexos: turno.entradaAnexos,
    entradaConfianca: turno.entradaConfianca,
    modelo: "auto",
    harness: "auto",
    reenvios: turno.reenvios + 1,
    executor: turno.executor,
    trabalhoId: null,
  });
  return novo ? [evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo, turno.executor), agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id } })] : [];
}

/**
 * "Levar as tasks" (R4/R6 b): os turnos pendentes das tasks do bot na IA que parou passam à IA nova (fixa naquele turno;
 * o modelo e o raciocínio vêm da escolha do bot para ela) e as esperas da cota acordam agora, com a entrada que diz que a
 * task mudou de IA. I1: com `iaPara = iaDe` (ChatGPT, outra conta), o turno fica fixo no ChatGPT e acorda com a entrada que
 * diz que a sessão ficou na outra conta (o plano escolhe a conta livre da fila). Devolve quantos turnos mudaram.
 */
async function levar(deps: Deps, t: Pick<TrocaDeIa, "agenteId" | "iaDe" | "iaPara">): Promise<number> {
  if (!t.iaPara) return 0;
  const entradaDaVolta = t.iaPara === t.iaDe ? entradaDaTrocaDeContaSemSessao(nomeDoProvedor(t.iaDe)) : entradaDaTrocaDeIa(nomeDoProvedor(t.iaDe), nomeDoProvedor(t.iaPara));
  const ids = await deps.repos.turnos.levarTasksDoBot({ agenteId: t.agenteId, iaDe: t.iaDe, harness: t.iaPara, modelo: "auto", entradaDaVolta });
  return ids.length;
}

export type SaidaDaDecisao = { decisao: DecisaoDaTroca; aplicada: boolean; tasks: number };

/**
 * `POST /agentes/:id/troca-de-ia {decisao, trocaId?}` (R4/R6): a pessoa escolhe. Quem chega primeiro vence (o fechar é
 * condicional): o segundo clique, outra aba ou o varredor que já aplicou recebem `aplicada: false` com a decisão que valeu.
 * I2: com dois avisos abertos no bot (uma IA cada), `trocaId` diz qual; sem ele, só vale quando há um.
 */
export const decidirTrocaDeIa: CasoDeUso<{ agenteId: string; decisao: unknown; trocaId?: unknown }, SaidaDaDecisao> = async (deps, input) => {
  const decisao = DECISOES_DA_PESSOA.find((d) => d === input.decisao);
  if (!decisao) throw new ErroDeDominio("entrada_invalida", { cause: "decisao" });
  if (input.trocaId !== undefined && typeof input.trocaId !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "trocaId" });
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado");
  if (agente.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  const agora = deps.agora();
  let aberta: TrocaDeIa | null;
  if (typeof input.trocaId === "string") {
    const t = await deps.repos.trocasDeIa.buscar(input.trocaId);
    if (!t || t.agenteId !== agente.id) throw new ErroDeDominio("nao_encontrado", { cause: "troca" });
    if (t.decididoEm !== null) return { data: { decisao: t.decisao ?? decisao, aplicada: false, tasks: 0 } };
    aberta = t;
  } else {
    const abertas = await deps.repos.trocasDeIa.abertasDoAgente(agente.id);
    if (abertas.length > 1) throw new ErroDeDominio("entrada_invalida", { cause: "trocaId" });
    aberta = abertas[0] ?? null;
  }
  if (!aberta) return { data: { decisao, aplicada: false, tasks: 0 } };
  if ((decisao === "levar" && (aberta.fixo || !aberta.iaPara)) || (decisao === "outra_ia" && (!aberta.fixo || !aberta.iaPara))) throw new ErroDeDominio("entrada_invalida", { cause: "decisao" });
  const antes = inteligenciaDoAgente(agente);
  const fechada = await deps.repos.trocasDeIa.fechar(aberta.id, decisao, agora, decisao === "outra_ia" ? antes : undefined);
  if (!fechada) {
    const valeu = await deps.repos.trocasDeIa.buscar(aberta.id);
    return { data: { decisao: valeu?.decisao ?? decisao, aplicada: false, tasks: 0 } };
  }
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [];
  let tasks = 0;
  if (decisao === "outra_ia") {
    // R6 b: o bot vai ao Automático até a conta voltar (o varredor devolve `volta_ao_fixo`); a IA que parou está no
    // limite, então o Automático escolhe a outra. As tasks vão junto.
    await deps.repos.agentes.atualizarPerfil(agente.id, { inteligencia: inteligenciaDoOutraIa(antes) });
    const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
    if (conversa) await deps.repos.conversas.atualizarSessaoCli(conversa.id, null);
  }
  if (decisao === "levar" || decisao === "outra_ia") tasks = await levar(deps, fechada);
  // R6 b na conversa: a fala que parou no limite é refeita no Automático (a outra IA), como o "Seguir com" refaz na conta.
  if (decisao === "outra_ia") events.push(...(await refazerFalaDoAviso(deps, fechada, agora)));
  await marcarDesfechoNaLinha(deps, fechada);
  events.push(evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: fechada.conversaId, dados: { agente_id: agente.id, acao: "troca_de_ia", decisao, tasks } }));
  log("info", "troca_de_ia_decidida", { troca_id: fechada.id, agente_id: agente.id, decisao, tasks, quem: "pessoa" });
  return { data: { decisao, aplicada: true, tasks }, events };
};

/** R6 b: o que o "Continuar no <outra> até a volta" grava no bot — o Automático, o resto da inteligência como estava. */
const inteligenciaDoOutraIa = (antes: InteligenciaBot): InteligenciaBot => ({ ...antes, modo: "auto", fixa: null });

/** I3: a inteligência do bot ainda é a que o "outra_ia" gravou? (a pessoa não mexeu nela depois) */
function aindaDoOutraIa(atual: InteligenciaBot, antes: InteligenciaBot): boolean {
  const gravada = inteligenciaDoOutraIa(antes);
  const chave = (i: InteligenciaBot) => JSON.stringify([i.modo, i.fixa, i.ordem, Object.entries(i.escolhas ?? {}).sort(([a], [b]) => a.localeCompare(b))]);
  return chave(atual) === chave(gravada);
}

/**
 * R5 (E8): a pessoa trocou a IA do bot pelo seletor com "Levar as tasks também": as tasks pendentes do bot (em qualquer
 * IA) passam à inteligência nova e as esperas da cota acordam. Os avisos abertos do bot fecham como "levar" (já foi feito).
 * C6: com destino Automático, quem chama passa a IA que o Automático escolheria agora (`harness` fixo).
 */
export async function levarTasksParaAInteligencia(deps: Deps, p: { agenteId: string; harness: string; modelo: string; nomeDe: string; nomePara: string; agora: number }): Promise<number> {
  const ids = await deps.repos.turnos.levarTasksDoBot({ agenteId: p.agenteId, iaDe: null, harness: p.harness, modelo: p.modelo, entradaDaVolta: entradaDaTrocaDeIa(p.nomeDe, p.nomePara) });
  const fechadas: string[] = [];
  for (const aberta of await deps.repos.trocasDeIa.abertasDoAgente(p.agenteId)) {
    const fechada = await deps.repos.trocasDeIa.fechar(aberta.id, "levar", p.agora);
    if (!fechada) continue;
    await marcarDesfechoNaLinha(deps, fechada);
    fechadas.push(fechada.id);
  }
  log("info", "inteligencia_levou_tasks", { agente_id: p.agenteId, tasks: ids.length, harness: p.harness, trocas: fechadas.length });
  return ids.length;
}

/**
 * C6: a IA que o Automático escolheria AGORA para as tasks do bot na máquina dele — a primeira da ordem pronta lá, fora do
 * limite e com conta utilizável lá (com contas anunciadas). null = nenhuma (não leva).
 */
export async function iaDoAutomaticoNaMaquina(deps: Deps, p: { agenteId: string; inteligencia: InteligenciaBot; prontosPorMaquina: Readonly<Record<string, readonly IdHarness[]>>; agora: number }): Promise<IdHarness | null> {
  const alvo = await maquinaDasTasks(deps, p.agenteId, null);
  const prontos = alvo ? (p.prontosPorMaquina[alvo] ?? []) : [...new Set(Object.values(p.prontosPorMaquina).flat())];
  const l = await lerIas(deps);
  const ordem = ordemEfetiva({ doBot: p.inteligencia.ordem, daPessoa: l.preferencias.ordemIas ?? null });
  const parada = prontos.filter((ia) => estadoDaIa(l, { ia, machineId: alvo, ordemDoBot: p.inteligencia.ordem, agora: p.agora }).parou);
  const ia = iaDoAutomatico({ ordem, prontos, noLimite: parada });
  return ia && !parada.includes(ia) ? ia : null;
}

/** R6 a ("Continuar na conta …"): a conta escolhida acorda as tasks do bot que esperavam a IA dela e fecha o aviso dela. */
export async function seguirNaContaFechaATroca(deps: Deps, p: { agenteId: string; ia: IaComConta; agora: number }): Promise<{ acordadas: number; fechou: boolean }> {
  const acordadas = await deps.repos.turnos.acordarEsperasDaCota(p.agenteId, p.ia);
  const aberta = await deps.repos.trocasDeIa.abertaDoAgente(p.agenteId, p.ia);
  const fechada = aberta ? await deps.repos.trocasDeIa.fechar(aberta.id, "conta", p.agora) : null;
  if (fechada) await marcarDesfechoNaLinha(deps, fechada);
  return { acordadas, fechou: fechada !== null };
}

/** Quando a IA volta para as tasks do bot na máquina dele (a mesma regra do "parou", `estadoDaIa`). null = ninguém disse. */
export async function quandoAIaVolta(deps: Pick<Deps, "repos">, p: { ia: IdHarness; machineId: string | null; agenteId: string; agora: number; contaDe?: string | null; leitura?: LeituraDasIas }): Promise<number | null> {
  const l = p.leitura ?? (await lerIas(deps));
  const agente = await deps.repos.agentes.buscar(p.agenteId);
  const e = estadoDaIa(l, { ia: p.ia, machineId: p.machineId, ordemDoBot: agente ? inteligenciaDoAgente(agente).ordem : null, agora: p.agora, contaDe: p.contaDe });
  return e.voltaEm !== null && e.voltaEm > p.agora ? e.voltaEm : null;
}

/**
 * A outra IA que levaria as tasks do bot (C5): a próxima da ordem dele pronta NA MÁQUINA-ALVO do bot (`prontosDoAlvo`),
 * fora do limite e, com contas anunciadas lá, com uma conta em uso lá. `ia` null = nenhuma (o aviso não oferece "levar":
 * as tasks só esperam); `noutraMaquina` = a que serviria se a máquina do bot a tivesse (pelas prontas da pessoa), para o
 * cartão dizer por que não oferece.
 */
export async function outraIaParaAsTasks(deps: Pick<Deps, "repos">, p: { agenteId: string; iaDe: IdHarness; prontosDoAlvo: readonly string[]; prontosDaPessoa: readonly string[]; daMaquina: ContasDaMaquina | null; agora: number }): Promise<{ ia: IdHarness | null; noutraMaquina: IdHarness | null }> {
  const [agente, preferencias, usosPorConta] = await Promise.all([deps.repos.agentes.buscar(p.agenteId), deps.repos.preferencias.buscar(), deps.repos.usoDoPlano.listarPorConta()]);
  if (!agente) return { ia: null, noutraMaquina: null };
  const inteligencia = inteligenciaDoAgente(agente);
  const ordem = ordemEfetiva({ doBot: inteligencia.ordem, daPessoa: preferencias.ordemIas ?? null });
  // NOD-401 (definido em 2026-10-28): a outra IA também se mede pela cota POR CONTA (a mesma visão de estadoDaIa) — a IA
  // cuja única conta a leitura dela segura não é oferecida para "levar"; a IA com conta na máquina não usa o limite por IA.
  const daMaquina = p.daMaquina ? { ...p.daMaquina, contas: contasPelaCota(p.daMaquina.contas, cotaDasContas({ usos: usosPorConta, agora: p.agora }), "fundo_seguindo") } : null;
  const r = daMaquina ? escolherContaDoTurno(daMaquina, inteligencia.ordem, p.agora) : null;
  const governada = (ia: IdHarness) => r !== null && ia in r.porIa;
  const semConta = IAS_COM_CONTA.filter((ia) => governada(ia) && r!.porIa[ia] === null);
  const noLimite = [...new Set([...iasNoLimite(preferencias.iasNoLimite, p.agora).filter((ia) => !governada(ia)), ...semConta, p.iaDe])];
  const ia = proximaIaNoLimite({ ordem, prontos: p.prontosDoAlvo as IdHarness[], noLimite, atual: p.iaDe });
  const noutraMaquina = ia ? null : proximaIaNoLimite({ ordem, prontos: p.prontosDaPessoa as IdHarness[], noLimite: [...iasNoLimite(preferencias.iasNoLimite, p.agora), p.iaDe], atual: p.iaDe });
  return { ia, noutraMaquina };
}

/** A conta fora da fila, livre, da IA do bot fixo, na máquina do turno (R6 a). */
export function contaForaDaFila(c: ContasDaMaquina | null, ia: IdHarness, agora: number): ContaDaTroca | null {
  if (!c) return null;
  const conta = c.contas
    .filter((x) => x.removidaEm === null && x.ia === ia && !naFila(x) && c.naMaquina.has(x.id) && (x.noLimiteAte === null || x.noLimiteAte <= agora))
    .sort((a, b) => a.posicao - b.posicao)[0];
  return conta ? { id: conta.id, apelido: conta.apelido, corporativa: conta.corporativa } : null;
}

type ResultadoDaVarredura = { events: RuntimeEvent[]; fechadas: number; aplicadas: number; restaurados: number; voltaram: number };

/**
 * O bloco do varredor de expiração (30 s, por pessoa): a IA voltou na máquina do bot → fecha o aviso ("voltou") e acorda
 * as esperas da cota; o "levar" recomendado venceu sem resposta → aplica ("expirou"); o bot fixo que seguiu noutra IA (R6
 * b) volta à inteligência de antes quando a conta dele volta; a decisão "esperar"/"conta" acorda as esperas quando a IA
 * volta (C3). Idempotente: cada passo é condicional (`decidido_em`/`restaurado_em`/`voltou_em`). Revisão do PR 2 (I5):
 * as contas, as preferências e o uso são lidos uma vez por pessoa no tique, e cada aviso roda isolado (`isolar`, um
 * SAVEPOINT no varredor): o que lança volta sozinho e os outros seguem.
 */
export async function varrerTrocasDeIa(deps: Deps, o: { isolar?: Isolar } = {}): Promise<ResultadoDaVarredura> {
  const agora = deps.agora();
  const r: ResultadoDaVarredura = { events: [], fechadas: 0, aplicadas: 0, restaurados: 0, voltaram: 0 };
  const trocas = await deps.repos.trocasDeIa.paraVarrer();
  if (trocas.length === 0) return r;
  const leitura = await lerIas(deps);
  const isolar: Isolar = o.isolar ?? ((fn) => fn());
  for (const t of trocas) {
    try {
      await isolar(() => varrerUma(deps, t, leitura, agora, r));
    } catch (e) {
      log("erro", "troca_de_ia_varredura_falhou", { troca_id: t.id, erro: e instanceof Error ? ((e as { codigo?: string }).codigo ?? e.name) : "desconhecido" });
    }
  }
  return r;
}

async function varrerUma(deps: Deps, t: TrocaDeIa, l: LeituraDasIas, agora: number, r: ResultadoDaVarredura): Promise<void> {
  const autoria = { ...autoriaPessoa(deps.escopo), decidido_por: "regra:varredor-troca-de-ia" as const };
  const agente = await deps.repos.agentes.buscar(t.agenteId);
  const estado = () => estadoDaIa(l, { ia: t.iaDe, machineId: t.machineId, ordemDoBot: agente ? inteligenciaDoAgente(agente).ordem : null, agora, contaDe: t.contaDe });
  if (t.decididoEm === null) {
    const voltou = !estado().parou;
    const decisao: DecisaoDaTroca | null = voltou ? "voltou" : t.recomendacao === "levar" && t.aplicarEm !== null && t.aplicarEm <= agora && t.iaPara ? "expirou" : null;
    if (!decisao) return;
    const fechada = await deps.repos.trocasDeIa.fechar(t.id, decisao, agora);
    if (!fechada) return;
    r.fechadas++;
    const tasks = decisao === "expirou" ? await levar(deps, fechada) : await deps.repos.turnos.acordarEsperasDaCota(fechada.agenteId, fechada.iaDe);
    if (decisao === "expirou") r.aplicadas++;
    if (decisao === "voltou") await soltarEscolhidaForaDaFila(deps, l, t, agora);
    await marcarDesfechoNaLinha(deps, fechada);
    r.events.push(evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: fechada.conversaId, dados: { agente_id: fechada.agenteId, acao: "troca_de_ia", decisao, tasks } }));
    log("info", "troca_de_ia_decidida", { troca_id: fechada.id, agente_id: fechada.agenteId, decisao, tasks, quem: "varredor" });
    return;
  }
  if (t.voltaAoFixo && t.restauradoEm === null) {
    if (estado().parou) return;
    if (!(await deps.repos.trocasDeIa.marcarRestaurada(t.id, agora))) return;
    await restaurarFixo(deps, t, t.voltaAoFixo, agora, autoria, r);
    return;
  }
  if ((t.decisao === "esperar" || t.decisao === "conta") && t.voltouEm === null) {
    // C3: "esperar" acorda as esperas quando a IA volta (a mesma regra do aviso aberto). I4: "conta" só espera a fila
    // daquela IA voltar a ter conta livre na máquina, para soltar a escolhida fora da fila.
    const daMaquina = t.machineId ? contasDaMaquinaDe(l, t.machineId, agora) : null;
    const voltou = t.decisao === "conta" ? ehIaComConta(t.iaDe) && filaLivre(contasComCota(l, agora), t.iaDe, agora, daMaquina?.naMaquina) : !estado().parou;
    const vencida = agora - (t.decididoEm ?? agora) >= ESPERA_DECIDIDA_VALE_MS;
    if (!voltou && !vencida) return;
    if (!(await deps.repos.trocasDeIa.marcarVoltou(t.id, agora))) return;
    r.voltaram++;
    const tasks = t.decisao === "esperar" ? await deps.repos.turnos.acordarEsperasDaCota(t.agenteId, t.iaDe) : 0;
    if (voltou) await soltarEscolhidaForaDaFila(deps, l, t, agora);
    if (tasks > 0) r.events.push(evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: t.conversaId, dados: { agente_id: t.agenteId, acao: "troca_de_ia", decisao: "voltou", tasks } }));
    log("info", "troca_de_ia_voltou", { troca_id: t.id, agente_id: t.agenteId, decisao: t.decisao, tasks, vencida: !voltou });
  }
}

/**
 * I4: o "Seguir com" / "Continuar na conta" de um aviso grava a escolhida da pessoa inteira; quando a fila da IA volta a
 * ter conta livre na máquina do bot, a escolhida FORA da fila sai — senão ela viraria o caminho silencioso da próxima vez
 * que a fila acabar (a corporativa, sem o consentimento dos termos). A escolhida que está na fila fica.
 */
async function soltarEscolhidaForaDaFila(deps: Deps, l: LeituraDasIas, t: TrocaDeIa, agora: number): Promise<void> {
  if (!ehIaComConta(t.iaDe)) return;
  const escolhida = l.escolhidas[t.iaDe];
  const conta = escolhida ? l.contas.find((c) => c.id === escolhida) : undefined;
  if (!conta || naFila(conta)) return;
  const daMaquina = t.machineId ? contasDaMaquinaDe(l, t.machineId, agora) : null;
  if (!filaLivre(contasComCota(l, agora), t.iaDe, agora, daMaquina?.naMaquina)) return;
  await deps.repos.contasIa.definirEscolhida(t.iaDe, null);
  delete l.escolhidas[t.iaDe];
  log("info", "escolhida_fora_da_fila_solta", { troca_id: t.id, ia: t.iaDe, conta_id: conta.id });
}

/**
 * R6 b, revisão do PR 2 (I3): o bot fixo volta à IA dele quando a conta volta — só o modo e a IA fixa, e só se a
 * inteligência ainda for a que o "Continuar no <outra> até a volta" gravou (a pessoa não mexeu nela depois). As tasks que
 * esse caminho fixou na outra IA voltam à inteligência do bot (`trazerTasksDeVolta`).
 */
async function restaurarFixo(deps: Deps, t: TrocaDeIa, antes: InteligenciaBot, agora: number, autoria: Autoria, r: ResultadoDaVarredura): Promise<void> {
  const agente = await deps.repos.agentes.buscar(t.agenteId);
  if (!agente) return;
  const atual = inteligenciaDoAgente(agente);
  if (!aindaDoOutraIa(atual, antes)) {
    log("info", "troca_de_ia_fixo_mantido", { troca_id: t.id, agente_id: t.agenteId, modo: atual.modo });
    return;
  }
  const restaurada: InteligenciaBot = { ...atual, modo: antes.modo, fixa: antes.fixa };
  await deps.repos.agentes.atualizarPerfil(t.agenteId, { inteligencia: restaurada });
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(t.agenteId);
  if (conversa) await deps.repos.conversas.atualizarSessaoCli(conversa.id, null);
  const d = derivadosDa(restaurada);
  const trazidas = t.iaPara ? await deps.repos.turnos.trazerTasksDeVolta({ agenteId: t.agenteId, de: t.iaPara, harness: d.harness, modelo: d.modelo }) : [];
  r.restaurados++;
  r.events.push(evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: t.conversaId, dados: { agente_id: t.agenteId, acao: "inteligencia", modo: restaurada.modo, fixa: restaurada.fixa, tasks: trazidas.length } }));
  log("info", "troca_de_ia_restaurou_fixo", { troca_id: t.id, agente_id: t.agenteId, ia: restaurada.fixa, tasks: trazidas.length });
}

export type { DecisaoDaPessoa };
