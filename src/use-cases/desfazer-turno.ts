import type { CheckpointDaFala, DesfazerParaRodar, RelatoDesfazer } from "../contracts/checkpoint.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { checkpointDaFala, resultadoParaGuardar, textoDoDesfeito } from "../domain/checkpoints.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { log } from "../obs/log.ts";
import type { Checkpoint, RecusaDesfazer } from "../repositories/checkpoints.repo.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";

type DepsDesfazer = Pick<Deps, "repos" | "escopo" | "agora">;

const mudou = (deps: DepsDesfazer, c: Checkpoint): RuntimeEvent =>
  evento(deps.escopo, { kind: "checkpoint_mudou", autoria: autoriaPessoa(deps.escopo), agora: deps.agora(), conversaId: c.conversaId, turnoId: c.turnoId, dados: { mensagem_id: c.mensagemId, estado: c.estado } });

/**
 * O "Desfazer N arquivos" da fala (definido em 2026-10-28, NOD-54, ADR-134). Grava o pedido; a máquina do turno o puxa
 * (ADR-021) e relata. `forcar` = "Voltar mesmo assim" sobre os conflitos do desfazer anterior. O turno tem de ser da
 * conversa da rota (a RLS já limita à dona; a conversa amarra a URL ao que a tela mostrou).
 */
export async function pedirDesfazerTurno(deps: DepsDesfazer, p: { conversaId: string; turnoId: string; forcar: boolean }): Promise<{ data: { ok: true; checkpoint: CheckpointDaFala } | { ok: false; recusa: Exclude<RecusaDesfazer, "nao_encontrado"> }; events: RuntimeEvent[] }> {
  const atual = await deps.repos.checkpoints.doTurno(p.turnoId);
  if (!atual || atual.conversaId !== p.conversaId) throw new ErroDeDominio("nao_encontrado");
  const r = await deps.repos.checkpoints.pedirDesfazer(p.turnoId, p.forcar, deps.agora());
  if (!r.ok) {
    if (r.recusa === "nao_encontrado") throw new ErroDeDominio("nao_encontrado");
    return { data: { ok: false, recusa: r.recusa }, events: [] };
  }
  log("info", "desfazer_pedido", { turno_id: p.turnoId, total: r.checkpoint.total, forcar: r.checkpoint.forcar.length });
  return { data: { ok: true, checkpoint: checkpointDaFala(r.checkpoint) }, events: [mudou(deps, r.checkpoint)] };
}

/** O que a máquina deve desfazer agora. */
export async function desfazeresDaMaquina(deps: DepsDesfazer, maquinaId: string): Promise<DesfazerParaRodar[]> {
  return deps.repos.checkpoints.paraAMaquina(maquinaId);
}

/**
 * O relato da máquina: progresso enquanto desfaz e, no fim, o resultado ou a falha (uma vez). O fim com resultado deixa
 * uma linha na conversa para o bot ler no próximo turno ("Desfeito: N arquivos voltaram"); a pessoa vê o resultado na fala.
 * Relato de outra máquina ou atrasado (já saiu de `desfazendo`) é ignorado.
 */
export async function relatarDesfazer(deps: DepsDesfazer, p: { maquinaId: string; relato: RelatoDesfazer }): Promise<{ data: { ok: boolean }; events: RuntimeEvent[] }> {
  const r = p.relato;
  if (!r.resultado && !r.falha) {
    // total 0 é o sinal de vida do desfazer que espera um turno da máquina: só renova o prazo, a tela não muda.
    const sinal = r.total === 0;
    const c = await deps.repos.checkpoints.progresso(r.turnoId, p.maquinaId, r.tentativa, sinal ? null : Math.min(r.feitos, r.total), deps.agora());
    return { data: { ok: c !== null }, events: c && !sinal ? [mudou(deps, c)] : [] };
  }
  const agora = deps.agora();
  const fim = r.resultado ? { resultado: resultadoParaGuardar(r.resultado) } : { falha: r.falha! };
  const c = await deps.repos.checkpoints.finalizar(r.turnoId, p.maquinaId, r.tentativa, fim, agora);
  if (!c) return { data: { ok: false }, events: [] };
  log("info", "desfazer_terminou", { turno_id: c.turnoId, estado: c.estado, ...(c.resultado ? c.resultado.contagem : {}) });
  const events: RuntimeEvent[] = [mudou(deps, c)];
  if (c.resultado) {
    const autoria = autoriaPessoa(deps.escopo);
    const linha = await deps.repos.mensagens.criar({ conversaId: c.conversaId, autoria, kind: "sistema", assunto: "arquivos.desfeitos", texto: textoDoDesfeito(c.resultado), confianca: "confiavel" });
    if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: c.conversaId, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  }
  return { data: { ok: true }, events };
}
