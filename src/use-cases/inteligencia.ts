import type { Agente } from "../contracts/agente.ts";
import type { IdHarness } from "../contracts/harness.ts";
import type { IasDaPessoa, InteligenciaBot } from "../contracts/inteligencia.ts";
import type { Inventario } from "../contracts/inventario.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { inventarioHarnessSemSonda } from "../domain/harness.ts";
import { aplicarPedidoInteligencia, derivadosDa, iasDaPessoa, inteligenciaDoAgente } from "../domain/inteligencia.ts";
import { nomeDoProvedor } from "../domain/troca-de-ia.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { log } from "../obs/log.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { iaDoAutomaticoNaMaquina, levarTasksParaAInteligencia } from "./trocas-de-ia.ts";

/**
 * `GET /agentes/:id/inteligencia` (definido em 2026-10-10, emenda da ADR-036): o modo, a IA fixa, a ordem própria e as
 * escolhas por IA do bot. Ver é de quem vê o bot (a policy); mudar é só da dona (definirInteligenciaDoBot).
 */
export const lerInteligenciaDoBot: CasoDeUso<{ agenteId: string }, { inteligencia: InteligenciaBot }> = async (deps, input) => {
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado");
  return { data: { inteligencia: inteligenciaDoAgente(agente) } };
};

/**
 * `PUT /agentes/:id/inteligencia`: a tela 2B (e a gaveta, 2A) mudam o modo, a ordem própria e o modelo e o raciocínio
 * de cada IA. Só a dona; o Nod também (ADR-081: modelo e esforço continuam livres). Grava os derivados junto
 * (harness/modelo/esforco) e, se a IA ou o modelo que o turno copia mudou, a próxima mensagem começa sessão nova do CLI,
 * como no PATCH de antes (outro modelo não retoma a sessão do anterior).
 * ADR-108 (R5, E8): `levarTasks: true` leva também as tasks pendentes do bot para a inteligência nova (e acorda as que
 * esperavam a cota); ausente ou false = só daqui em diante. O campo sai do pedido ANTES de `aplicarPedidoInteligencia`,
 * que recusa chave desconhecida.
 * Revisão do PR 2 (C6): com destino Automático, cada turno levado fica fixo na IA que o Automático escolheria AGORA na
 * máquina do bot (`iaDoAutomaticoNaMaquina`, pelas prontas de `prontosPorMaquina`, fora a IA que parou) — "auto" de novo
 * deixaria a task presa na guarda da sessão. Sem nenhuma, nada é levado e a conversa do bot ganha a linha que diz isso.
 */
export const definirInteligenciaDoBot: CasoDeUso<{ agenteId: string; pedido: unknown; prontosPorMaquina?: Readonly<Record<string, readonly IdHarness[]>> }, { agente: Agente; tasksLevadas?: number; semIaParaLevar?: true }> = async (deps, input) => {
  const existente = await deps.repos.agentes.buscar(input.agenteId);
  if (!existente) throw new ErroDeDominio("nao_encontrado");
  if (existente.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  const { levarTasks, pedido } = separarLevarTasks(input.pedido);
  const antes = inteligenciaDoAgente(existente);
  const nova = aplicarPedidoInteligencia(antes, pedido);
  const agente = await deps.repos.agentes.atualizarPerfil(input.agenteId, { inteligencia: nova });
  if (!agente) throw new ErroDeDominio("nao_permitido");
  const de = derivadosDa(antes);
  const para = derivadosDa(nova);
  const sessaoMudou = de.harness !== para.harness || de.modelo !== para.modelo || de.esforco !== para.esforco || JSON.stringify(antes.escolhas) !== JSON.stringify(nova.escolhas);
  if (sessaoMudou) {
    const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
    if (conversa) await deps.repos.conversas.atualizarSessaoCli(conversa.id, null);
  }
  // NOD-277 (definido em 2026-10-15): a IA nova vale para o fundo que já está na fila (rotina, pedido de colega, task e as
  // retomadas deles), na mesma transação; a espera da cota desse fundo acorda (o portão segura de novo se a IA nova também
  // estiver no limite). A conversa, a sala e a ligação seguem na IA que a pessoa viu (ADR-036). Só o raciocínio mudou: a
  // fila fica como está.
  const reescritos = de.harness !== para.harness || de.modelo !== para.modelo ? await deps.repos.turnos.reescreverFundoDoBot(agente.id, para) : 0;
  if (reescritos > 0) log("info", "fundo_reescrito_na_troca_de_ia", { agente_id: agente.id, turnos: reescritos, harness: para.harness, modelo: para.modelo });
  const autoria = autoriaPessoa(deps.escopo);
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  let tasksLevadas: number | undefined;
  let semIaParaLevar = false;
  if (levarTasks) {
    const destino = para.harness === "auto" ? await iaDoAutomaticoNaMaquina(deps, { agenteId: agente.id, inteligencia: nova, prontosPorMaquina: input.prontosPorMaquina ?? {}, agora }) : para.harness;
    if (destino) {
      tasksLevadas = await levarTasksParaAInteligencia(deps, { agenteId: agente.id, harness: destino, modelo: para.harness === "auto" ? "auto" : para.modelo, nomeDe: nomeDaInteligencia(de.harness), nomePara: nomeDaInteligencia(destino), agora });
    } else {
      tasksLevadas = 0;
      semIaParaLevar = true;
      events.push(...(await avisarSemIaParaLevar(deps, { agenteId: agente.id, nomeDoBot: agente.nome, agora })));
    }
  }
  events.unshift(evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, dados: { agente_id: agente.id, acao: "inteligencia", modo: nova.modo, fixa: nova.fixa, nome: agente.nome, ...(tasksLevadas !== undefined ? { tasks_levadas: tasksLevadas } : {}) } }));
  return { data: { agente, ...(tasksLevadas !== undefined ? { tasksLevadas } : {}), ...(semIaParaLevar ? { semIaParaLevar: true as const } : {}) }, events };
};

/** C6: o "Levar as tasks também" para o Automático sem IA pronta na máquina do bot — uma linha na conversa dele. */
async function avisarSemIaParaLevar(deps: Deps, p: { agenteId: string; nomeDoBot: string; agora: number }): Promise<RuntimeEvent[]> {
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(p.agenteId);
  if (!conversa) return [];
  const autoria = autoriaPessoa(deps.escopo);
  const texto = `Nenhuma IA está pronta agora na máquina do ${p.nomeDoBot}: as tasks em andamento ficaram onde estavam. Daqui em diante ele usa o Automático.`;
  const linha = await deps.repos.mensagens.criar({ conversaId: conversa.id, autoria, kind: "sistema", assunto: "inteligencia", texto, confianca: "confiavel" });
  log("info", "inteligencia_sem_ia_para_levar", { agente_id: p.agenteId });
  return linha ? [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: p.agora, conversaId: conversa.id, dados: { mensagem_id: linha.id, kind: "sistema" } })] : [];
}

const nomeDaInteligencia = (harness: string): string => (harness === "auto" ? "Automático" : nomeDoProvedor(harness));

/** R5: tira `levarTasks` (boolean) do corpo; o resto segue para `aplicarPedidoInteligencia`, que valida estrito. */
function separarLevarTasks(corpo: unknown): { levarTasks: boolean; pedido: unknown } {
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo) || !("levarTasks" in corpo)) return { levarTasks: false, pedido: corpo };
  const { levarTasks, ...pedido } = corpo as Record<string, unknown>;
  if (typeof levarTasks !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: "levarTasks" });
  return { levarTasks, pedido };
}

/**
 * `GET /ias`: as IAs da pessoa como Provedores de IA e a tela 2B mostram — a ordem dela (efetiva), o inventário das
 * máquinas vivas com o limite em vigor por cima, e os modelos com os níveis de raciocínio e o recomendado. O inventário
 * vem da composição (a ponte em memória); a ordem e os limites, do banco.
 */
export const lerIasDaPessoa: CasoDeUso<{ inventarios: Partial<Record<IdHarness, Inventario>> }, IasDaPessoa> = async (deps, input) => {
  const agora = deps.agora();
  const p = await deps.repos.preferencias.buscar();
  return { data: iasDaPessoa({ ordem: p.ordemIas ?? null, limites: p.iasNoLimite ?? {}, inventarios: input.inventarios, agora, semSonda: () => inventarioHarnessSemSonda(agora) }) };
};
