import type { Executor } from "../contracts/evento.ts";
import type { OrigemTurno, Turno } from "../contracts/turno.ts";
import { ehComandoDeTurno } from "../domain/comandos.ts";
import { ateOPrimeiroAnexo, ateOPrimeiroComando } from "../domain/ordem-das-falas.ts";
import { autoriaAgente, autoriaPessoa, evento } from "./autoria-evento.ts";
import { contaminarSeAbsorveuDeFora } from "./coordenar-trabalhos.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { avisosDeRecadoLido } from "./quadro-execucoes.ts";

/**
 * Sessão viva (definido em 2026-10-01, ADR-067): o turno do Claude Code não acaba na primeira resposta. Enquanto há
 * comando em segundo plano, ou a pessoa manda mensagem, o CLI fica aberto e o modelo volta a trabalhar sozinho — como
 * no terminal. Estes dois casos de uso são o lado do servidor, chamados pela renovação do lease.
 */

/** O turno ainda roda: uma fala da sessão só entra na conversa enquanto ele não foi assentado. */
const vivo = (t: Turno | null): t is Turno => t !== null && t.estado === "despachando";

/**
 * Uma volta do modelo que não encerrou o turno vira fala na conversa na hora, com a autoria e a confiança da fala final
 * (assentarTurno). Fala de sala nunca chega aqui: o driver a junta na entrega, que passa pelos responders.
 */
export const gravarFalasDaSessao: CasoDeUso<{ turnoId: string; machineId: string; executor: Executor; textos: readonly string[] }, { gravadas: number }> = async (deps, e) => {
  const turno = await deps.repos.turnos.buscar(e.turnoId);
  if (!vivo(turno) || turno.origem === "sala" || (turno.machineId !== null && turno.machineId !== e.machineId)) return { data: { gravadas: 0 } };
  // NOD-402 (ADR-130): o turno dos bastidores da conversa não fala no meio — o driver não manda a fala na hora
  // (`PlanoTurno.bastidores`) e o texto todo vai na entrega. Se ainda chegar uma aqui, é de um motor anterior, que já a
  // tirou da entrega (`rodadasJaFaladas`): gravar é o que não perde o texto (definido em 2026-10-28).
  const agora = deps.agora();
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: e.executor, machineId: e.machineId });
  const events = [];
  for (const texto of e.textos) {
    if (texto.trim() === "") continue;
    const m = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "texto", texto, payload: null, confianca: turno.entradaConfianca });
    if (m) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: m.id, kind: "texto", parcial: false } }));
  }
  return { data: { gravadas: events.length }, events };
};

/** A raiz de uma retomada que veio de um destes não recebe mensagem da pessoa: o trabalho não é a conversa com ela. */
const RAIZES_SEM_MENSAGEM: readonly OrigemTurno[] = ["rotina", "delegacao", "peer"];

/**
 * Quem recebe mensagem no meio do trabalho: o turno vivo da conversa da pessoa com o bot, ou a retomada de um. Pedido
 * de colega (delegação, peer, e o que corre sob procuração), sala e ligação ficam de fora: a resposta deles vai a outro
 * bot ou passa pelos responders, e uma fala da pessoa no meio a misturaria.
 *
 * revisto em 2026-10-07 (ADR-083 §6, #189): rotina e turno de trabalho (`trabalhoId`) também ficam de fora — a
 * mensagem esperava dentro da rotina (uma esperou 71 min no diário) e a resposta virava passo do card. A mensagem fica
 * `pendente` e vira turno de conversa próprio. A retomada cuja raiz é rotina, delegação ou peer é conferida em
 * `aceitaNaSessao`, que sobe a cadeia.
 */
export function aceitaMensagemNaSessao(t: Turno): boolean {
  return t.estado === "despachando" && t.sobProcuracaoDe === null && !t.trabalhoId && (t.origem === "conversa" || t.origem === "retomada");
}

/** `aceitaMensagemNaSessao` mais a cadeia da retomada (`retoma_turno_id` até a raiz). */
export async function aceitaNaSessao(deps: Deps, t: Turno): Promise<boolean> {
  if (!aceitaMensagemNaSessao(t)) return false;
  if (t.origem !== "retomada") return true;
  const raiz = await deps.repos.turnos.raizDaCadeia(t.id);
  return raiz !== null && !raiz.trabalhoId && !RAIZES_SEM_MENSAGEM.includes(raiz.origem) && raiz.sobProcuracaoDe == null;
}

/**
 * As falas da pessoa que esperavam na fila desta conversa e podem entrar no turno vivo, na ordem: só fala dela (com
 * mensagem de origem), de conversa, sem anexo (o anexo espera o próximo turno, que o baixa inteiro) e fora de trabalho.
 * NOD-286 (2026-10-15): só as que vieram antes da primeira com anexo — a posterior espera com o print, na ordem.
 *
 * definido em 2026-10-07 (#189): com `confirma` (o app confirma o que escreveu na sessão) elas NÃO saem da fila aqui —
 * só quando o app as confirma (`confirmarNaSessao`); a que o CLI não recebeu continua `pendente` e vira turno próprio,
 * em vez de sumir como `interrompido/absorvido` (`laco_mensagem_sem_sessao`). `jaOferecidas` evita entregá-las de novo
 * enquanto a confirmação não volta. Sem `confirma` (app antigo), saem `absorvido` na hora, como antes.
 */
export const absorverNaSessao: CasoDeUso<{ turnoId: string; executor: Executor; confirma?: boolean; jaOferecidas?: readonly string[] }, { textos: string[]; ids: string[] }> = async (deps, e) => {
  const nada = { data: { textos: [], ids: [] } };
  const turno = await deps.repos.turnos.buscar(e.turnoId);
  if (!turno || !(await aceitaNaSessao(deps, turno))) return nada;
  // NOD-286: corta na primeira fala pendente com anexo (a que veio depois do print espera com ele). NOD-23: e na
  // primeira que é comando da conversa com turno próprio (ateOPrimeiroComando).
  const daSessao = (await deps.repos.turnos.pendentesDaPessoa(turno.conversaId)).filter((t) => t.id !== turno.id && t.agenteId === turno.agenteId && t.origem === "conversa" && Boolean(t.mensagemOrigemId) && !t.trabalhoId);
  const absorviveis = ateOPrimeiroComando(ateOPrimeiroAnexo(daSessao), ehComandoDeTurno);
  if (e.confirma) {
    // A já oferecida sai depois do corte: ela nunca tem anexo nem é comando, então não muda onde a fila para.
    const fora = new Set(e.jaOferecidas ?? []);
    const fila = absorviveis.filter((t) => !fora.has(t.id));
    return { data: { textos: fila.map((t) => t.entradaTexto), ids: fila.map((t) => t.id) } };
  }
  // App que não confirma: absorve só as que passaram pelos cortes (o repositório refaz o corte do anexo no SQL).
  const absorvidos = await deps.repos.turnos.absorverNaSessao(turno, absorviveis.map((t) => t.id));
  if (absorvidos.length === 0) return nada;
  return { data: { textos: absorvidos.map((a) => a.entradaTexto), ids: absorvidos.map((a) => a.id) }, events: eventosDeAbsorcao(deps, e.executor, turno.id, absorvidos) };
};

/**
 * #189: o app escreveu estas mensagens na sessão do turno vivo. Só agora cada uma sai interrompido/'absorvido'
 * apontando para ele (a tela tira o "na fila"). A que já não está pendente (Cancelar chegou antes) fica como está.
 */
export const confirmarNaSessao: CasoDeUso<{ turnoId: string; executor: Executor; ids: readonly string[] }, { confirmadas: number }> = async (deps, e) => {
  if (e.ids.length === 0) return { data: { confirmadas: 0 } };
  const turno = await deps.repos.turnos.buscar(e.turnoId);
  if (!turno) return { data: { confirmadas: 0 } };
  // NOD-418 (emenda da ADR-083): os recados da tarefa do quadro oferecidos pela renovação saem lidos na confirmação.
  // Os ids são de quadro_recados: os de turno não casam lá, e os de recado não casam nos turnos.
  await deps.repos.quadroExecucoes.entregarRecados(e.ids, turno.id);
  const lidos = await avisosDeRecadoLido(deps, e.ids);
  // Revisão do épico (S18, 2026-10-08): no turno de um trabalho, as confirmadas são os recados da faixa DELE (a fala da
  // pessoa na tela da task, o mandar_para_task) — o absorverNaSessao só olha a conversa (`trabalho_id is null`).
  const absorvidos = turno.trabalhoId ? await deps.repos.turnos.absorverDoTrabalho(turno, e.ids) : await deps.repos.turnos.absorverNaSessao(turno, e.ids);
  if (turno.trabalhoId) await contaminarSeAbsorveuDeFora(deps, turno.id, absorvidos);
  return { data: { confirmadas: absorvidos.length }, events: [...eventosDeAbsorcao(deps, e.executor, turno.id, absorvidos), ...lidos] };
};

function eventosDeAbsorcao(deps: Deps, executor: Executor, turnoId: string, absorvidos: readonly Turno[]) {
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo, executor);
  return absorvidos.map((a) => evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: a.conversaId, turnoId: a.id, dados: { motivo: "absorvido", absorvido_por: turnoId } }));
}
