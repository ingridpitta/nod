import type { MudancaTarefa } from "../contracts/quadro.ts";
import type { Autoria } from "../contracts/evento.ts";
import type { EventoTrilhaQuadro } from "../contracts/trilha-quadro.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { STATUS_TAREFA } from "../contracts/quadro.ts";
import { MAPA_DE_ESTADOS } from "../domain/importar-linear.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * A trilha do quadro (definido em 2026-11-02, NOD-422, PR 2) para medir o dogfood (scripts/dogfood-quadro.sql). Só ids
 * (ADR-004) e só em `events`, sem outbox (o molde da telemetria das linhas, ADR-083): nenhum frame sai daqui.
 * - `tarefa_movida`: toda mudança de coluna que entra no histórico (lote, Desfazer, mover de quadro, importação), com o
 *   autor (pessoa, agente ou regra), de e para (ids das colunas). O tempo em coluna sai do histórico, sem evento novo.
 * - `tarefa_aberta` e `conversa_aberta`: o que só a tela sabe, pela rota POST telemetria/quadro. Com o quadro desligado
 *   nos experimentos, nada é gravado.
 */

/**
 * Revisão 2 do PR #630 (achado baixo, ADR-004): a coluna criada pela pessoa tem o id `c-<nome digitado>`; na trilha ela vira
 * "outra", e só as colunas fixas (ids do sistema) saem pelo id. Revisão 4: as que a importação do Linear cria
 * (MAPA_DE_ESTADOS, como `c-qa`) também são do sistema e saem pelo id; sem isso o tempo em QA ou em Prototipando do
 * dogfood virava "outra". A pessoa que digitar exatamente um desses nomes cai no mesmo id, que não diz nada dela.
 */
const COLUNAS_DO_SISTEMA: ReadonlySet<string> = new Set<string>([...STATUS_TAREFA, ...MAPA_DE_ESTADOS.map((e) => e.coluna)]);
export const colunaNaTrilha = (id: string | null): string | null => (id === null || COLUNAS_DO_SISTEMA.has(id) ? id : "outra");

/** Grava o histórico do lote e, para cada mudança de coluna, a `tarefa_movida`. Substitui o registrarHistorico cru. */
export async function registrarHistoricoComTrilha(deps: Deps, quadroId: string, historico: readonly MudancaTarefa[], loteId: string | null): Promise<void> {
  await deps.repos.quadros.registrarHistorico(quadroId, historico, loteId);
  const movidas = historico.filter((m) => m.campo === "status" && m.de !== m.para);
  if (movidas.length === 0) return;
  const agora = deps.agora();
  await deps.repos.events.gravarSemOutbox(movidas.map((m) => evento(deps.escopo, {
    kind: "tarefa_movida",
    autoria: m.autor.tipo === "agente" ? autoriaDoAgente(deps.escopo, m.autor.agenteId) : autoriaPessoa(deps.escopo),
    agora,
    dados: { quadro_id: quadroId, tarefa_id: m.tarefaId, de: colunaNaTrilha(m.de), para: colunaNaTrilha(m.para), autor: m.autor.tipo, autor_agente_id: m.autor.tipo === "agente" ? m.autor.agenteId : null, lote_id: loteId },
  })));
}

/** definido em 2026-11-02: a web manda em lote (o mesmo teto da telemetria das linhas). */
export const EVENTOS_TRILHA_MAX = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

function validar(v: unknown): EventoTrilhaQuadro {
  const o = typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  if (o.acao === "quadro_aberto" && id(o.quadroId) && (o.via === "tela" || o.via === "link")) return { acao: o.acao, quadroId: o.quadroId, via: o.via };
  if (o.acao === "tarefa_aberta" && id(o.quadroId) && id(o.tarefaId) && (o.via === "card" || o.via === "link")) return { acao: o.acao, quadroId: o.quadroId, tarefaId: o.tarefaId, via: o.via };
  if (o.acao === "conversa_aberta" && id(o.agenteId) && id(o.conversaId)) return { acao: o.acao, agenteId: o.agenteId, conversaId: o.conversaId };
  throw new ErroDeDominio("entrada_invalida", { cause: "evento da trilha do quadro" });
}

/** POST telemetria/quadro {eventos}: valida tudo antes de gravar (um inválido recusa o lote inteiro). */
export const registrarTrilhaQuadro: CasoDeUso<{ eventos: unknown }, { gravados: number }> = async (deps, input) => {
  if (!Array.isArray(input.eventos) || input.eventos.length === 0 || input.eventos.length > EVENTOS_TRILHA_MAX) throw new ErroDeDominio("entrada_invalida", { cause: "eventos" });
  const eventos = input.eventos.map(validar);
  // O mesmo teste do experimentoLigado (src/use-cases/quadro.ts), sem importar de lá: o quadro.ts importa este arquivo.
  if ((await deps.repos.preferencias.buscar()).experimentos?.quadro !== true) return { data: { gravados: 0 } };
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const gravados = await deps.repos.events.gravarSemOutbox(eventos.map((e) => e.acao === "quadro_aberto"
    ? evento(deps.escopo, { kind: "quadro_aberto", autoria, agora, dados: { quadro_id: e.quadroId, via: e.via } })
    : e.acao === "tarefa_aberta"
      ? evento(deps.escopo, { kind: "tarefa_aberta", autoria, agora, dados: { quadro_id: e.quadroId, tarefa_id: e.tarefaId, via: e.via } })
      : evento(deps.escopo, { kind: "conversa_aberta", autoria, agora, dados: { agente_id: e.agenteId, conversa_id: e.conversaId } })));
  return { data: { gravados } };
};

export type TipoAvisoDoQuadro = "decisao" | "atraso" | "escalada" | "freio" | "risco";

/** Telemetria do servidor: só ids, enum e contagem (ADR-004/047), sem frame SSE. */
export async function registrarConsultaDoQuadro(deps: Deps, quadroId: string, agenteId: string): Promise<void> {
  await deps.repos.events.gravarSemOutbox([evento(deps.escopo, {
    kind: "quadro_consultado", autoria: autoriaDoAgente(deps.escopo, agenteId), agora: deps.agora(),
    dados: { quadro_id: quadroId, agente_id: agenteId },
  })]);
}

export async function registrarAvisoDoQuadro(deps: Deps, p: { quadroId: string; tipo: TipoAvisoDoQuadro; tarefas: number; mensagemId: string; autoria: Autoria }): Promise<void> {
  await deps.repos.events.gravarSemOutbox([evento(deps.escopo, {
    kind: "quadro_avisou", autoria: p.autoria, agora: deps.agora(),
    dados: { quadro_id: p.quadroId, tipo: p.tipo, tarefas: p.tarefas, mensagem_id: p.mensagemId },
  })]);
}
