import { randomUUID } from "node:crypto";
import type { Executor } from "../contracts/evento.ts";
import type { MotivoBloqueioRotina } from "../contracts/motivos.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { dispararRotina } from "./disparar-rotina.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * `bloqueio` (definido em 2026-09-24, emenda da ADR-044): o pré-voo parou o teste — falta conexão ou
 * acesso. Sem turno; a rota devolve o motivo e o card para a web levar a pessoa até o botão.
 */
export type SaidaExecutarAgora = {
  conversaId: string;
  turnoId: string | null;
  bloqueio: { motivo: MotivoBloqueioRotina; propostaId: string | null } | null;
  /**
   * definido em 2026-10-15 (NOD-272): já há uma execução aberta desta rotina e a pessoa não confirmou — nada foi criado.
   * `instanteAgendado` é a janela dela, para a web perguntar "Já há uma execução na fila (agendada para hh:mm). Rodar mais
   * uma?". A pendente nunca é cancelada.
   */
  jaNaFila?: { turnoId: string; instanteAgendado: number; fusoIana: string };
};

/** definido em 2026-09-17: testar não altera agenda nem pausa; a janela por minuto deduplica cliques e disputa com o scheduler. */
export const executarRotinaAgora: CasoDeUso<{ rotinaId: string; executor: Executor; confirmar?: boolean }, SaidaExecutarAgora> = async (deps, input) => {
  const rotina = await deps.repos.rotinas.buscar(input.rotinaId);
  if (!rotina) throw new ErroDeDominio("nao_encontrado");
  if (rotina.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  if (input.confirmar !== true) {
    const aberto = await deps.repos.rotinaJanelas.turnoAberto(rotina.id, deps.agora());
    if (aberto) return { data: { conversaId: rotina.conversaId, turnoId: null, bloqueio: null, jaNaFila: { turnoId: aberto.turnoId, instanteAgendado: aberto.instanteAgendado, fusoIana: rotina.fusoIana } } };
  }
  // definido em 2026-10-15 (NOD-256, NOD-225): "Executar agora" é a pessoa voltando — encerra a parada que cobre a
  // conversa da rotina (como o Retomar, retomar-turno.ts) e deixa uma linha dizendo isso; sem ela o turno nascia e o
  // despacho o interrompia de novo.
  const agora = deps.agora();
  const antes: RuntimeEvent[] = [];
  if ((await deps.repos.paradas.encerrarAbertas({ conversaId: rotina.conversaId, agora })) > 0) {
    const autoria = autoriaPessoa(deps.escopo, input.executor);
    const linha = await deps.repos.mensagens.criar({ conversaId: rotina.conversaId, autoria, kind: "sistema", assunto: "parada", texto: "Parada encerrada: você usou Executar agora e a rotina voltou a rodar.", confianca: "confiavel" });
    if (linha) antes.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: rotina.conversaId, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  }
  const r = await dispararRotina(deps, { rotina, instanteAgendado: Math.floor(deps.agora() / 60_000) * 60_000, machineId: randomUUID(), executor: input.executor, preservarAgenda: true });
  const bloqueio = "bloqueada" in r.data ? { motivo: r.data.bloqueada, propostaId: r.data.propostaId } : null;
  return { data: { conversaId: rotina.conversaId, turnoId: "turno" in r.data ? r.data.turno.id : null, bloqueio }, events: [...antes, ...(r.events ?? [])] };
};
