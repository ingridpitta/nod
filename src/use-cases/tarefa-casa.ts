import type { Decisao } from "../contracts/decisao.ts";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { ColunaQuadro, OpQuadro, Quadro, TarefaQuadro } from "../contracts/quadro.ts";
import { colunasDe, grupoDe } from "../domain/colunas.ts";
import { codigoDaTarefa } from "../domain/codigo-tarefa.ts";
import { ehDarDone } from "../domain/dar-done.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { LIMITES_QUADRO } from "../domain/quadro.ts";
import { tarefaCasaLigada } from "../shared/tarefa-casa.ts";
import { evento } from "./apoio-l7.ts";
import { aplicarLoteQuadro, comentarPergunta } from "./quadro.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import { PRAZO_DECISAO_MS } from "./pedir-a-pessoa.ts";
import { fecharComResposta, retomarComResposta, TIPOS_RESPONDIVEIS } from "./responder-decisao.ts";
import type { Deps } from "./tipos.ts";

/**
 * ADA-28 (ADR-159, "a tarefa é a casa do trabalho"), escopo A: um único "Precisa de você". A pergunta ou a aprovação que o
 * bot faz durante uma tarefa é a espera DA TAREFA: a decisão leva o `tarefa_id`, a tarefa fica esperando a pessoa (ADR-162:
 * na coluna, com a pergunta em comentário; sem
 * o aviso "Preciso de você no quadro", que seria o segundo) e o chat ganha a linha "ADA-28 precisa de você". Responder no
 * card ou na Sua vez resolve as duas, e só a retomada da decisão acorda o bot (uma vez). Tudo atrás de NOD_TAREFA_CASA.
 */

/** A frase da resposta que veio de fora do card (a Sua vez, o cartão): o card mostra que já foi respondida. */
export const RESPONDIDA_FORA_DO_CARD = "Respondida na Sua vez.";

/** O texto da linha no chat. A web põe o código como botão que abre a tarefa (web/telas/conversa.ts, linhaDaTarefa). */
export function textoDaLinha(motivo: "precisa" | "resultado", codigo: string, botNome: string | null, coluna?: string): string {
  if (motivo === "precisa") return `${codigo} precisa de você`;
  return coluna ? `${botNome ?? "O bot"} moveu ${codigo} para ${coluna}` : `${botNome ?? "O bot"} terminou ${codigo}`;
}

async function tarefaEQuadro(deps: Deps, tarefaId: string): Promise<{ t: TarefaQuadro; q: Quadro } | null> {
  const t = await deps.repos.quadros.tarefa(tarefaId);
  const q = t ? await deps.repos.quadros.buscar(t.quadroId) : null;
  return t && q ? { t, q } : null;
}

/** A linha `tarefa.*` na conversa do bot (sem turno: nunca é escondida com o turno de tarefa). */
export async function gravarLinhaDaTarefa(deps: Deps, p: { motivo: "precisa" | "resultado"; t: TarefaQuadro; q: Quadro; conversaId: string; agenteId: string; texto: string }): Promise<RuntimeEvent[]> {
  const codigo = codigoDaTarefa(p.q.prefixo, p.t);
  const autoria = autoriaDoAgente(deps.escopo, p.agenteId);
  const m = await deps.repos.mensagens.criar({
    conversaId: p.conversaId, turnoId: null, autoria, kind: "sistema", texto: p.texto, confianca: "confiavel",
    payload: { kind: "tarefa_linha", motivo: p.motivo, tarefaId: p.t.id, quadroId: p.q.id, codigo, agenteId: p.q.agenteId },
  });
  return m ? [evento(deps, "mensagem_criada", autoria, { mensagem_id: m.id, kind: "sistema", mensagem_json: JSON.stringify(m) }, { conversaId: p.conversaId })] : [];
}

/**
 * Logo depois de criar a decisão (pedir_a_pessoa, pedir_aprovacao que parou na pessoa): se o turno é de uma tarefa, liga
 * a decisão a ela, põe a tarefa em "Precisa de você" pelo lote comum (autor = o bot, a pergunta = a frase da decisão) e
 * grava a linha no chat. revisto em 2026-11-10 (P6): o lote recusado (a coluna travada, o freio) não liga a decisão — ela
 * segue solta, na Sua vez, e a tarefa não muda. Fora de tarefa (ou com a flag desligada), nada: o caminho de hoje.
 */
export async function ligarDecisaoATarefa(deps: Deps, decisao: Decisao, executor: Executor = "catcher"): Promise<RuntimeEvent[]> {
  if (!tarefaCasaLigada() || !decisao.turnoId) return [];
  const tarefaId = await deps.repos.quadros.tarefaDoTurno(decisao.turnoId);
  if (!tarefaId) return [];
  const tq = await tarefaEQuadro(deps, tarefaId);
  if (!tq) return [];
  const events: RuntimeEvent[] = [];
  // P6 (2026-11-10): a marca primeiro; o lote recusado (a coluna travada "só a pessoa", o freio) deixa a decisão solta, no
  // caminho de sempre (a Sua vez), em vez de ligada a uma tarefa que não espera ninguém.
  if (tq.t.status !== "voce" && tq.t.status !== "bloqueado") {
    const pergunta = [...decisao.frase].slice(0, LIMITES_QUADRO.pergunta).join("");
    const r = await aplicarLoteQuadro(deps, { autor: { tipo: "agente", agenteId: decisao.agenteId }, quadro: tq.q.id, executor, turnoId: decisao.turnoId, conversaId: decisao.conversaId, limite: "normal", ops: [{ tipo: "mudar_tarefa", tarefa: tq.t.id, status: "voce", pergunta }] });
    if (!r.data.ok) return [];
    events.push(...(r.events ?? []));
  }
  if (!(await deps.repos.decisoes.ligarATarefa(decisao.id, tarefaId))) return events;
  events.push(...(await gravarLinhaDaTarefa(deps, { motivo: "precisa", ...tq, conversaId: decisao.conversaId, agenteId: decisao.agenteId, texto: textoDaLinha("precisa", codigoDaTarefa(tq.q.prefixo, tq.t), null) })));
  return events;
}

/**
 * A decisão ligada foi respondida ou decidida fora do card (Sua vez, cartão): sem outra decisão aberta da tarefa, ela
 * sai de "Precisa de você" pela resposta do lote comum, SEM abrir o turno da resposta — a retomada da decisão (quando há)
 * já é o turno que continua. Chamada pelo sincronizarDasDecisoes, que todo fechamento de decisão já chama.
 */
export async function tarefasDasDecisoesFechadas(deps: Deps, decisoes: readonly Pick<Decisao, "tarefaId" | "estado" | "desfecho">[]): Promise<RuntimeEvent[]> {
  if (!tarefaCasaLigada()) return [];
  // Só a decisão que uma pessoa respondeu ou decidiu: a vencida, a dispensada e a fechada por regra não retomam o bot, e a
  // tarefa segue em "Precisa de você" (responder no card abre o turno da resposta, o caminho de hoje).
  const respondidas = decisoes.filter((d) => d.estado === "decidida" && d.desfecho?.tipo === "decidida");
  const ids = [...new Set(respondidas.flatMap((d) => (d.tarefaId ? [d.tarefaId] : [])))];
  if (ids.length === 0) return [];
  const abertas = new Set((await deps.repos.decisoes.abertasDasTarefas(ids)).map((d) => d.tarefaId));
  const events: RuntimeEvent[] = [];
  for (const id of ids) {
    if (abertas.has(id)) continue;
    const tq = await tarefaEQuadro(deps, id);
    if (tq?.t.status !== "voce") continue;
    const r = await aplicarLoteQuadro(deps, { autor: { tipo: "pessoa" }, quadro: tq.q.id, executor: "catcher", respostaJaRetomada: true, ops: [{ tipo: "responder", tarefa: id, resposta: RESPONDIDA_FORA_DO_CARD }] });
    if (r.data.ok) events.push(...(r.events ?? []));
  }
  return events;
}

/**
 * A resposta pelo card de uma tarefa cuja espera é uma decisão ligada: resolve a decisão (as duas fases da Sua vez) e é a
 * retomada dela que continua o trabalho. Devolve null quando a tarefa não tem decisão ligada aberta (o caminho de hoje:
 * o turno da resposta). Aprovação não se responde com texto: recusa, para não deixar a decisão aberta com a tarefa andando.
 */
export async function responderPelaDecisao(deps: Deps, p: { tarefaId: string; resposta: string; pessoaNome: string; executor: Executor }): Promise<RuntimeEvent[] | null> {
  if (!tarefaCasaLigada()) return null;
  // O pedido de Done não é a espera de "Precisa de você": a resposta do card não o fecha (nem move a tarefa por ele).
  const abertas = (await deps.repos.decisoes.abertasDasTarefas([p.tarefaId])).filter((d) => !d.tarefaPedeDone);
  if (abertas.length === 0) return null;
  const respondivel = abertas.find((d) => TIPOS_RESPONDIVEIS.has(d.tipo));
  if (!respondivel) throw new ErroDeDominio("estado_invalido", { cause: "a tarefa espera uma aprovação: aprove ou recuse no cartão" });
  const fechada = await fecharComResposta(deps, { decisaoId: respondivel.id, texto: p.resposta });
  const retomada = await retomarComResposta(deps, { decisao: fechada.data.decisao, texto: p.resposta, respondidaPor: { id: deps.escopo.pessoaId, nome: p.pessoaNome }, executor: p.executor });
  // QA do PR #702 (plano, bordas): com outra decisão ainda aberta, a tarefa fica em "Precisa de você" até a última fechar —
  // o lote da resposta já a tirou de lá; ela volta, com a pergunta seguinte e o retorno para onde ia.
  const seguinte = abertas.find((d) => d.id !== respondivel.id);
  const t = seguinte ? await deps.repos.quadros.tarefa(p.tarefaId) : null;
  if (seguinte && t && t.status !== "voce") {
    const salva = await deps.repos.quadros.salvarTarefa(t.id, { ...t, status: "voce", voltarPara: t.status, pergunta: [...seguinte.frase].slice(0, LIMITES_QUADRO.pergunta).join(""), resposta: null });
    // ADR-162: a pergunta seguinte também vira comentário (o card fica na coluna, esperando a pessoa).
    if (salva) await comentarPergunta(deps, salva, { tipo: "agente", agenteId: seguinte.agenteId });
  }
  return [...(fechada.events ?? []), ...(retomada.events ?? [])];
}

/**
 * ADA-28 (ADR-159, escopo E): no quadro em que a pessoa dá o Done, o `terminei` da última etapa (e o merge do PR) não
 * leva a Feito: nasce a decisão "CÓDIGO está pronta para o Done", ligada à tarefa (`tarefa_pede_done`), na conversa do
 * responsável, com as opções "Dar Done" / "Voltar para <coluna anterior>". Sem turno: responder não retoma ninguém; quem
 * leva a Feito é a resposta (retomarComResposta → responderPedidoDeDone). Uma por tarefa (idempotente). Não passa pela
 * flag NOD_TAREFA_CASA: com quem_fecha bot (o padrão) nada disto acontece.
 */
export const DAR_DONE = "Dar Done";
export const fraseDoDone = (codigo: string) => `${codigo} está pronta para o Done`;

function colunaAnterior(q: Quadro, status: string): { id: string; nome: string } | null {
  const colunas = colunasDe(q);
  const i = colunas.findIndex((c) => c.id === status);
  const antes = colunas.slice(0, Math.max(0, i)).reverse().find((c) => c.grupo === "iniciado" && c.id !== "voce" && c.id !== "bloqueado");
  return antes ? { id: antes.id, nome: antes.nome } : null;
}

/** A primeira coluna do grupo feito depois da atual (senão a primeira do grupo feito, como o merge). */
function colunaFeitoSeguinte(colunas: readonly ColunaQuadro[], status: string): string | null {
  const i = colunas.findIndex((c) => c.id === status);
  return (colunas.slice(i + 1).find((c) => c.grupo === "feito") ?? colunas.find((c) => c.grupo === "feito"))?.id ?? null;
}

export async function pedirODone(deps: Deps, p: { quadroId: string; tarefaIds: readonly string[]; agenteId?: string | null; conversaId?: string | null }): Promise<RuntimeEvent[]> {
  if (p.tarefaIds.length === 0) return [];
  const ja = new Set((await deps.repos.decisoes.abertasDasTarefas(p.tarefaIds)).filter((d) => d.tarefaPedeDone).map((d) => d.tarefaId));
  const events: RuntimeEvent[] = [];
  for (const id of p.tarefaIds) {
    if (ja.has(id)) continue;
    const tq = await tarefaEQuadro(deps, id);
    if (!tq || tq.q.id !== p.quadroId) continue;
    const agenteId = p.agenteId ?? tq.t.agenteId ?? tq.q.agenteId;
    const conversaId = p.conversaId ?? (await deps.repos.conversas.buscarPropriaDoAgente(agenteId))?.id ?? null;
    if (!conversaId) continue;
    const codigo = codigoDaTarefa(tq.q.prefixo, tq.t);
    const voltar = colunaAnterior(tq.q, tq.t.status);
    const decisao = await deps.repos.decisoes.criar({ tipo: "pergunta", decisorId: deps.escopo.pessoaId, agenteId, conversaId, turnoId: null, prazoDecisaoEm: deps.agora() + PRAZO_DECISAO_MS, frase: fraseDoDone(codigo), fioId: null, tarefaId: id, tarefaPedeDone: true });
    if (!decisao) continue;
    const autoria = autoriaDoAgente(deps.escopo, agenteId);
    const opcoes = [DAR_DONE, ...(voltar ? [`Voltar para ${voltar.nome}`] : [])];
    const m = await deps.repos.mensagens.criar({ conversaId, turnoId: null, autoria, kind: "texto", texto: fraseDoDone(codigo), payload: { kind: "pedido_a_pessoa", decisaoId: decisao.id, opcoes, recomendada: 0 }, confianca: "confiavel" });
    events.push(evento(deps, "decisao_criada", autoria, { decisao_id: decisao.id, tipo: "pergunta", decisor_id: deps.escopo.pessoaId, prazo_decisao_em: decisao.prazoDecisaoEm, ...(m ? { mensagem_json: JSON.stringify(m) } : {}) }, { conversaId }));
  }
  return events;
}

/**
 * A resposta à "pronta para o Done": "Dar Done" (ou a variação escrita, ehDarDone) leva a tarefa à coluna Feito seguinte
 * (lote da pessoa, com Desfazer); qualquer outra resposta a devolve à coluna anterior do andamento e vira comentário na tarefa, que aciona quem cuida
 * dela (o porquê de voltar). A tarefa que já saiu dali (a pessoa a moveu na tela) fica como está.
 */
export async function responderPedidoDeDone(deps: Deps, d: Pick<Decisao, "tarefaId" | "tarefaPedeDone">, texto: string, executor: Executor = "catcher"): Promise<RuntimeEvent[]> {
  if (!d.tarefaPedeDone || !d.tarefaId) return [];
  const tq = await tarefaEQuadro(deps, d.tarefaId);
  if (!tq) return [];
  const colunas = colunasDe(tq.q);
  if (grupoDe(colunas, tq.t.status) === "feito" || grupoDe(colunas, tq.t.status) === "fechado") return [];
  // P7 (2026-11-10): o botão e as variações escritas ("pode fechar", "fecha", "done"); na dúvida, não fecha.
  const darDone = ehDarDone(texto);
  // QA do PR #702: Dar Done vai à coluna Feito seguinte, não à próxima — o merge pede o Done com a tarefa ainda em Fazendo.
  const destino = darDone ? colunaFeitoSeguinte(colunas, tq.t.status) : colunaAnterior(tq.q, tq.t.status)?.id ?? null;
  const ops: OpQuadro[] = [];
  if (destino && destino !== tq.t.status) ops.push({ tipo: "mudar_tarefa", tarefa: tq.t.id, status: destino });
  const events: RuntimeEvent[] = [];
  if (ops.length > 0) {
    const r = await aplicarLoteQuadro(deps, { autor: { tipo: "pessoa" }, quadro: tq.q.id, executor, ops });
    if (r.data.ok) events.push(...(r.events ?? []));
  }
  if (!darDone && !texto.trim().toLocaleLowerCase().startsWith("voltar para ")) {
    const r = await aplicarLoteQuadro(deps, { autor: { tipo: "pessoa" }, quadro: tq.q.id, executor, ops: [{ tipo: "comentar", tarefa: tq.t.id, texto }] });
    if (r.data.ok) events.push(...(r.events ?? []));
  }
  return events;
}

/** A pessoa levou a tarefa a Feito por outro caminho (a tela, o chat): a "pronta para o Done" aberta se resolve. */
export async function fecharPedidosDeDone(deps: Deps, tarefaIds: readonly string[]): Promise<void> {
  if (tarefaIds.length === 0) return;
  for (const d of await deps.repos.decisoes.abertasDasTarefas(tarefaIds)) {
    if (d.tarefaPedeDone) await deps.repos.decisoes.decidir(d.id, { por: deps.escopo.pessoaId, agora: deps.agora() });
  }
}
