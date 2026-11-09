import { createHash } from "node:crypto";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { ColunaQuadro, Quadro, TarefaQuadro } from "../contracts/quadro.ts";
import { chaveDoRisco, riscoDoQuadro, textoDoRisco, type TarefaParaRisco } from "../domain/risco-quadro.ts";
import { tarefasDaMeta } from "../domain/quadro.ts";
import { colunasDe, grupoDe } from "../domain/colunas.ts";
import { autoriaAgente, evento } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";
import { registrarAvisoDoQuadro } from "./trilha-quadro.ts";

/**
 * NOD-415 (ADR-141): o aviso de risco de prazo do quadro. Sai na conversa do bot anfitrião, como o avisar_pessoa (o sino
 * e o push da web), UMA vez por (quadro, meta, prazo): o id de envio deriva da chave, e o índice único de
 * mensagens (tenant, conversa, id_envio) segura a repetição — inclusive dois avisos ao mesmo tempo (o lote e o varredor).
 */

/** O grupo da tarefa pelo grupo da coluna (ADR-140): Não iniciado, Iniciado, Feito, Fechado. */
export function tarefaParaRisco(t: Pick<TarefaQuadro, "titulo" | "status" | "deFora">, colunas: readonly ColunaQuadro[]): TarefaParaRisco {
  const g = grupoDe(colunas, t.status);
  return { titulo: t.titulo, feita: g === "feito", fechada: g === "fechado", naoIniciada: g === "nao_iniciado", deFora: t.deFora };
}

function idEnvioDe(chave: string): string {
  const h = createHash("sha256").update(chave).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Avisa se o quadro está em risco e ainda não avisou nesta (meta, prazo). null = sem risco, já avisado ou sem conversa. */
export async function avisarRiscoDoQuadro(deps: Deps, q: Quadro, tarefas: readonly TarefaQuadro[], importadas?: ReadonlySet<string>): Promise<RuntimeEvent | null> {
  const colunas = colunasDe(q);
  // Revisão 4 do PR #630 (decisão 3 da Ada): o que veio do Linear fica fora da meta, e do risco dela.
  const fora = importadas ?? (await deps.repos.quadroImportacoes.importadas(q.id));
  const r = riscoDoQuadro(q, tarefasDaMeta(tarefas, q.metaDesde, colunas, fora).map((t) => tarefaParaRisco(t, colunas)), deps.agora());
  if (!r || !q.meta || !q.prazo) return null;
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(q.agenteId);
  if (!conversa) return null;
  const autoria = autoriaAgente(q.agenteId, deps.escopo.pessoaId);
  const m = await deps.repos.mensagens.criar({
    conversaId: conversa.id,
    turnoId: null,
    autoria,
    kind: "texto",
    texto: textoDoRisco({ meta: q.meta, prazo: q.prazo }, r),
    payload: { kind: "aviso_pessoa" },
    // Os títulos podem ter vindo do Linear ou de um bot que leu conteúdo de fora: o aviso é dado, não instrução.
    confianca: "nao_confiavel",
    idEnvio: idEnvioDe(chaveDoRisco({ id: q.id, meta: q.meta, prazo: q.prazo })),
  });
  if (m) await registrarAvisoDoQuadro(deps, { quadroId: q.id, tipo: "risco", tarefas: tarefas.length, mensagemId: m.id, autoria });
  return m ? evento(deps, "mensagem_criada", autoria, { mensagem_id: m.id, kind: "texto", aviso: true }, { conversaId: conversa.id, turnoId: null }) : null;
}

/** A volta do varredor: o risco chega com o tempo, sem ninguém mexer no quadro. Experimento desligado = nada. */
export async function varrerRiscosDosQuadros(deps: Deps): Promise<{ avisos: number; events: RuntimeEvent[] }> {
  // A mesma leitura do quadro.ts (a chave da pessoa já com a flag NOD_QUADROS aplicada).
  if ((await deps.repos.preferencias.buscar()).experimentos?.quadro !== true) return { avisos: 0, events: [] };
  const events: RuntimeEvent[] = [];
  for (const q of await deps.repos.quadros.listar()) {
    if (!q.meta || !q.prazo || q.cumpridoEm !== null) continue;
    // Com a trava do quadro (revisão 1): um lote concorrente termina antes, e o aviso sai com a meta e as tarefas de agora.
    const travado = await deps.repos.quadros.buscarTravado(q.id);
    if (!travado) continue;
    const ev = await avisarRiscoDoQuadro(deps, travado, await deps.repos.quadros.tarefas(q.id));
    if (ev) events.push(ev);
  }
  return { avisos: events.length, events };
}
