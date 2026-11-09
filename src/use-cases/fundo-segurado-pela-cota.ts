import type { CotaDaIa } from "../contracts/cota.ts";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import { IAS_COM_CONTA } from "../contracts/contas-ia.ts";
import type { Turno } from "../contracts/turno.ts";
import { contasPelaCota, cotaDasContas, fraseDaEsperaDaCota, situacaoDaIa, tipoParaCota } from "../domain/cota-da-ia.ts";
import { ehIaComConta } from "../domain/contas-da-pessoa.ts";
import { harnessFixado } from "../domain/harness.ts";
import { inteligenciaDoAgente } from "../domain/inteligencia.ts";
import { idDeterministico } from "../db/seed/id-deterministico.ts";
import { log } from "../obs/log.ts";
import { autoriaAgente, evento } from "./autoria-evento.ts";
import { criarNotaDeContas, escolherContaDoTurno, lerContasDaMaquina, notaIgualAberta, semContaParaOTurno, voltaDaNota, type ContasDaMaquina } from "./contas-do-turno.ts";
import { portaoDoDespacho, type EntradaDespacharTurno } from "./despachar-turno.ts";
import type { Deps } from "./tipos.ts";

/**
 * O fundo que a cota segura não fica em silêncio (definido em 2026-10-16, NOD-302, continuação da NOD-253, passos 4 e 5 do
 * plano da Ada). Quando o `reivindicar` desta máquina não acha nada para fazer e a cota segura turnos de fundo:
 *
 * - cada bot com fundo segurado ganha UMA nota "Seguir com…" (a mesma da conversa, `limite_do_plano`) na conversa do turno
 *   segurado mais antigo — a conta corporativa fora da troca, "Perguntar antes" e todas as contas no limite viram a mesma
 *   nota que a conversa mostraria, sem outra IA para o bot de IA fixa. Repetida (a mesma conta e a mesma volta, aberta),
 *   não sai de novo (`notaIgualAberta`, NOD-268);
 * - cada pedido de colega sem task segurado ganha UMA linha na conversa de onde saiu ("a cota do Claude Code está no fim;
 *   o pedido espera na fila até ela renovar, às 14:30"), pelo payload `pedido_na_fila_da_cota` do turno.
 *
 * Roda numa tx própria depois do despacho (ponte-interna.ts), no máximo uma vez por leitura da cota: uma falha aqui não
 * desfaz nem atrasa o despacho.
 */

export const REGRA_FUNDO_SEGURADO = "regra:fundo-segurado-pela-cota" as const;

export type EntradaFundoSegurado = Pick<EntradaDespacharTurno, "machineId" | "executor" | "harnessesProntos" | "harnessesDaPessoa" | "noLimite" | "cota">;

export async function avisarFundoSeguradoPelaCota(deps: Deps, input: EntradaFundoSegurado): Promise<RuntimeEvent[]> {
  const { cota: portao, harnessesAuto } = portaoDoDespacho(input);
  if (!portao || !input.cota) return [];
  const agora = deps.agora();
  const executor = input.executor ?? "catcher";
  const segurados = await deps.repos.turnos.seguradosPelaCota({ machineId: input.machineId, agora, cota: portao });
  if (segurados.length === 0) return [];
  const events: RuntimeEvent[] = [];

  const contas = (await deps.repos.contasIa.temContaNaMaquina(input.machineId)) ? await lerContasDaMaquina(deps, input.machineId) : null;
  if (contas && contas.naMaquina.size > 0) {
    const porConta = cotaDasContas({ usos: await deps.repos.usoDoPlano.listarPorConta(), agora });
    const maisAntigo = new Map<string, Turno>();
    for (const t of segurados) if (!maisAntigo.has(t.agenteId)) maisAntigo.set(t.agenteId, t);
    for (const turno of maisAntigo.values()) {
      events.push(...(await notaDoBot(deps, { turno, contas, porConta, machineId: input.machineId, executor, iasDoAutomatico: harnessesAuto ?? input.harnessesProntos ?? IAS_COM_CONTA, agora })));
    }
  }

  for (const turno of segurados) {
    if (turno.trabalhoId || (turno.origem !== "delegacao" && turno.origem !== "peer")) continue;
    events.push(...(await linhaAQuemPediu(deps, { turno, cota: input.cota, iasDoAutomatico: harnessesAuto ?? input.harnessesProntos ?? [], executor, agora })));
  }
  return events;
}

async function notaDoBot(
  deps: Deps,
  p: { turno: Turno; contas: ContasDaMaquina; porConta: ReturnType<typeof cotaDasContas>; machineId: string; executor: Executor; iasDoAutomatico: readonly string[]; agora: number },
): Promise<RuntimeEvent[]> {
  const { turno, agora } = p;
  const trabalho = turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  // As contas como o turno de fundo as vê: a que a cota segura para ele fica "no limite" até renovar (contasPelaCota).
  const c: ContasDaMaquina = { ...p.contas, contas: contasPelaCota(p.contas.contas, p.porConta, tipoParaCota(turno, trabalho)) };
  const agente = await deps.repos.agentes.buscar(turno.agenteId);
  const ordemDoBot = agente ? inteligenciaDoAgente(agente).ordem : null;
  const fixo = harnessFixado(turno.harness, turno.modelo);
  const sem = semContaParaOTurno(c, escolherContaDoTurno(c, ordemDoBot, agora), fixo ? [fixo] : p.iasDoAutomatico, agora, { iaFixa: fixo && ehIaComConta(fixo) ? fixo : null, ordemDoBot });
  // A IA sem conta da lista nesta máquina (motor, app antigo) segue a regra de antes: a pílula de Trabalhos, sem nota.
  if (!sem) return [];
  const voltaEm = voltaDaNota(sem.decisao, sem.voltaEm, agora);
  if (await notaIgualAberta(deps, { conversaId: turno.conversaId, contaId: sem.de.id, voltaEm })) return [];
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: p.executor, decididoPor: REGRA_FUNDO_SEGURADO });
  const nota = await criarNotaDeContas(deps, { turno, autoria, agora, de: sem.de, decisao: sem.decisao, maquina: c.nomeDaMaquina ? { id: p.machineId, nome: c.nomeDaMaquina } : null, voltaEm: sem.voltaEm });
  log("info", "fundo_segurado_nota", { turno_id: turno.id, agente_id: turno.agenteId, conta_id: sem.de.id, decisao: sem.decisao.tipo, volta_em: voltaEm });
  return nota;
}

async function linhaAQuemPediu(
  deps: Deps,
  p: { turno: Turno; cota: readonly CotaDaIa[]; iasDoAutomatico: readonly string[]; executor: Executor; agora: number },
): Promise<RuntimeEvent[]> {
  const { turno, agora } = p;
  const pedido = await deps.repos.mensagens.pedidoDaTarefa(turno.id);
  if (pedido?.payload?.kind !== "peer_pedido") return [];
  const origem = pedido.payload.conversaOrigemId;
  // A conversa de quem pediu tem de ser do mesmo dono do turno: a linha nunca vaza para a conversa de outra pessoa.
  const conversa = await deps.repos.conversas.buscar(origem);
  if (!conversa || conversa.ownerId !== turno.ownerId) return [];
  const espera = esperaDaIaDoTurno(turno, p.cota, p.iasDoAutomatico);
  if (!espera) return [];
  const agente = await deps.repos.agentes.buscar(turno.agenteId);
  const texto = `Pedido para ${agente?.nome ?? "o colega"} na fila: ${fraseDaEsperaDaCota({ ...espera, agora })}.`;
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: p.executor, decididoPor: REGRA_FUNDO_SEGURADO });
  const linha = await deps.repos.mensagens.criar({
    conversaId: origem,
    turnoId: null,
    autoria,
    kind: "sistema",
    texto,
    payload: { kind: "pedido_na_fila_da_cota", turnoId: turno.id, agenteId: turno.agenteId, ia: espera.ia, voltaEm: espera.voltaEm },
    confianca: "confiavel",
    // Uma linha por turno, garantida no banco (on conflict do id de envio), mesmo com dois avisos ao mesmo tempo.
    idEnvio: idDeterministico(`pedido_na_fila_da_cota:${turno.id}`),
  });
  if (!linha) return [];
  log("info", "pedido_na_fila_da_cota", { turno_id: turno.id, conversa_origem_id: origem, ia: espera.ia, volta_em: espera.voltaEm });
  return [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: origem, turnoId: null, dados: { mensagem_id: linha.id, kind: "sistema" } })];
}

/** A IA que segura o turno e quando ela renova: a fixa, ou (Automático) a primeira das IAs que podem pegá-lo que segura. */
function esperaDaIaDoTurno(turno: Turno, cota: readonly CotaDaIa[], iasDoAutomatico: readonly string[]): CotaDaIa | null {
  const fixo = harnessFixado(turno.harness, turno.modelo);
  const ias = fixo ? [fixo] : iasDoAutomatico;
  const seguram = cota.filter((c) => ias.includes(c.ia) && situacaoDaIa(cota, c.ia) !== "livre");
  return seguram.sort((a, b) => a.voltaEm - b.voltaEm)[0] ?? null;
}
