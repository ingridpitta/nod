import type { Decisao, TipoDecisao } from "../contracts/decisao.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import { TIPOS_PEDIDO_A_PESSOA, type FioDaPergunta, type FioDoItem } from "../contracts/pedido.ts";
import type { EstadoTurno, Turno } from "../contracts/turno.ts";
import { agruparFios, chaveDoFio, estadoDoFio, mensagensDoFio, rodadaNoFio } from "../domain/fio-da-pergunta.ts";
import type { Repos } from "../repositories/tipos.ts";
import { SALTOS_DE_RETOMADA } from "./apoio-l7.ts";

/**
 * O fio da pergunta lido do banco (emenda da ADR-045, definido em 2026-09-24): o que a conversa e "Sua
 * vez" mandam para a web. As regras moram no domínio (src/domain/fio-da-pergunta.ts); aqui só se junta
 * o que elas pedem — as rodadas (decisoes.dosFios), as mensagens e o turno que a última resposta criou.
 */

const PEDIDOS: ReadonlySet<TipoDecisao> = new Set<TipoDecisao>(TIPOS_PEDIDO_A_PESSOA);

/**
 * O estado do turno que a resposta criou (`turnoRetomadaId`). Se ele caiu no meio e a pessoa retomou,
 * quem está lendo agora é o "Retomar" — a busca desce pela retomada da retomada. Sem o id (resposta
 * anterior ao fio) ou com o turno fora dos recentes da conversa (terminou há muito), null: o domínio dá o
 * fio por resolvido.
 */
function estadoDaRetomada(turnos: readonly Turno[], mensagens: readonly Mensagem[], decisaoId: string): EstadoTurno | null {
  const [turnoId] = mensagens.flatMap((m) => (m.payload?.kind === "resposta_a_pedido" && m.payload.decisaoId === decisaoId && m.payload.turnoRetomadaId ? [m.payload.turnoRetomadaId] : []));
  let turno = turnoId ? turnos.find((t) => t.id === turnoId) : undefined;
  for (let saltos = 0; turno?.estado === "interrompido" && saltos < SALTOS_DE_RETOMADA; saltos++) {
    const pai = turno.id;
    const seguinte = turnos.filter((t) => t.retomaTurnoId === pai).at(-1);
    if (!seguinte) break;
    turno = seguinte;
  }
  return turno?.estado ?? null;
}

/** definido em 2026-09-24: os 50 turnos mais recentes da conversa bastam — a retomada que ainda lê é recente. */
const TURNOS_RECENTES = 50;

/**
 * Os fios com mensagem na janela carregada da conversa (ConversaDto.fios): as perguntas e respostas
 * citadas nas mensagens levam às raízes, e as raízes ao fio inteiro.
 */
export async function fiosDaConversa(repos: Repos, mensagens: readonly Mensagem[]): Promise<FioDaPergunta[]> {
  const citadas = new Set(mensagens.flatMap((m) => (m.payload?.kind === "pedido_a_pessoa" || m.payload?.kind === "resposta_a_pedido" ? [m.payload.decisaoId] : [])));
  if (citadas.size === 0) return [];
  const raizes = new Set((await repos.decisoes.dosFios([...citadas])).filter((d) => citadas.has(d.id)).map(chaveDoFio));
  const fios: FioDaPergunta[] = [];
  // Uma leitura só dos turnos, e só se algum fio terminou numa resposta (é quando "lendo" é possível).
  let turnos: readonly Turno[] | null = null;
  for (const [id, rodadas] of agruparFios(await repos.decisoes.dosFios([...raizes]))) {
    const ultima = rodadas.at(-1);
    const doFio = mensagensDoFio(rodadas, mensagens);
    if (!ultima || doFio.length === 0) continue;
    if (ultima.estado === "decidida" && turnos === null) turnos = await repos.turnos.listarDaConversa(ultima.conversaId, TURNOS_RECENTES);
    const retomada = ultima.estado === "decidida" ? estadoDaRetomada(turnos ?? [], mensagens, ultima.id) : null;
    fios.push({ id, agenteId: ultima.agenteId, estado: estadoDoFio(ultima, retomada), rodada: rodadas.length, decisoes: rodadas.map((d) => d.id), mensagens: doFio.map((m) => m.id), decisorId: ultima.decisorId });
  }
  return fios;
}

/** O fio e a rodada de cada pergunta de "Sua vez" (id da decisão → fio); os outros tipos ficam fora do mapa. */
export async function fiosDosItens(repos: Repos, decisoes: readonly Decisao[]): Promise<Map<string, FioDoItem>> {
  const pedidos = decisoes.filter((d) => PEDIDOS.has(d.tipo));
  const fios = agruparFios(await repos.decisoes.dosFios([...new Set(pedidos.flatMap((d) => (d.fioId ? [d.fioId] : [])))]));
  return new Map(pedidos.map((d) => [d.id, { id: chaveDoFio(d), rodada: d.fioId ? rodadaNoFio(fios.get(d.fioId) ?? [], d.id) : 1 }]));
}
