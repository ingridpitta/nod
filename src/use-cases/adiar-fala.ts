import type { Autoria, Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Turno } from "../contracts/turno.ts";
import { LACO_JANELA_MS, reenvioEmLaco } from "../domain/inteligencia.ts";
import { log } from "../obs/log.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";

/**
 * A fala da pessoa que não pode ser reenviada agora (definido em 2026-10-15, NOD-268): passou do teto de reenvios, todas
 * as IAs da máquina do bot estão no limite, ou a nota das contas já está aberta na conversa. Nunca volta a 'pendente'
 * (ADR-009/010): nasce uma cópia da fala com `acordar_em` na hora do limite, e a conversa ganha no máximo UMA linha.
 *
 * - Uma fala nova da pessoa absorve a adiada (absorverPendentes pega a pendente com `mensagem_origem_id`, acorde ela quando
 *   for); Parar a cancela como a qualquer pendente.
 * - A fala que JÁ esperou (`acordarEm` gravado) não espera de novo: quem chama devolve null e vale o aviso de sempre. Assim
 *   o caminho todo tem fim — no máximo um reenvio e uma espera.
 */
export async function adiarFala(
  deps: Deps,
  p: { turno: Turno; executor: Executor; acordarEm: number; autoria: Autoria; agora: number; texto: string | null; causa: string },
): Promise<RuntimeEvent[] | null> {
  const { turno, agora } = p;
  if (turno.origem !== "conversa" || turno.pararSolicitadoEm !== null || (turno.acordarEm ?? null) !== null) return null;
  const acordarEm = Math.max(p.acordarEm, agora);
  const novo = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "conversa",
    // O prazo da fila conta a partir da hora em que acorda (senão o varredor de órfãos a tiraria antes de ela sair).
    prazoEm: acordarEm + Math.max(60_000, turno.prazoEm - turno.criadoEm),
    profundidade: turno.profundidade,
    entradaTexto: turno.entradaTexto,
    mensagemOrigemId: turno.mensagemOrigemId,
    entradaAnexos: turno.entradaAnexos,
    entradaConfianca: turno.entradaConfianca,
    modelo: turno.modelo,
    harness: turno.harness,
    reenvios: turno.reenvios + 1,
    executor: p.executor,
    trabalhoId: turno.trabalhoId ?? null,
    acordarEm,
  });
  if (!novo) return null;
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo, p.executor), agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id, acordar_em: acordarEm } }),
  ];
  if (p.texto) {
    const linha = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria: p.autoria, kind: "sistema", assunto: "ia.fala_espera", texto: p.texto, confianca: "confiavel" });
    if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria: p.autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  }
  // Só códigos e ids.
  log("info", "fala_adiada_no_limite", { turno_id: turno.id, novo_turno_id: novo.id, acordar_em: acordarEm, causa: p.causa, reenvios: novo.reenvios });
  return events;
}

/**
 * NOD-268: o alarme (não freio) de reenvio em laço — mais de 3 turnos da mesma fala (`mensagem_origem_id`; sem ela, a
 * mesma conversa e a mesma origem de rotina) em menos de 5 min. Só olha o turno que já é repetição ou rotina: a fala nova
 * comum não paga a consulta.
 */
export async function vigiarLaco(deps: Pick<Deps, "repos">, turno: Turno, agora: number): Promise<boolean> {
  if (turno.reenvios === 0 && turno.origem !== "rotina") return false;
  const recentes = (await deps.repos.turnos.listarDaConversa(turno.conversaId, 20)).filter((t) =>
    agora - t.criadoEm < LACO_JANELA_MS && (turno.mensagemOrigemId ? t.mensagemOrigemId === turno.mensagemOrigemId : t.origem === turno.origem && t.mensagemOrigemId === null));
  if (!reenvioEmLaco(recentes.map((t) => t.criadoEm), agora)) return false;
  log("aviso", "reenvio_em_laco", { turno_id: turno.id, conversa_id: turno.conversaId, mensagem_origem_id: turno.mensagemOrigemId ?? null, origem: turno.origem, turnos: recentes.length, janela_ms: LACO_JANELA_MS });
  return true;
}
