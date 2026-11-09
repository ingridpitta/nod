import type { RuntimeEvent } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { Tx } from "../shared/types.ts";
import { encaminhar } from "./encaminhar.ts";
import { passar } from "./passar.ts";
import { pedirABot } from "./pedir-a-bot.ts";
import type { Deps, Services } from "./tipos.ts";

/**
 * Adapta os três casos de uso de sala ao contrato `Services.sala` (EMENDA 18) para quem só tem o
 * turnoId (a L9 compõe; chamar-ferramenta despacha direto por UseCasesNod, EMENDA 5). Arquivo
 * extra da lane: o contrato pede `(trx, {turnoId, ...})` e o caso de uso pede o ContextoFerramenta
 * inteiro — a resolução turno → agente/conversa mora aqui, uma vez.
 */
export function servicoSala(depsSobre: (trx: Tx) => Deps, aoGravar?: (trx: Tx, events: RuntimeEvent[]) => Promise<void>): Services["sala"] {
  async function contexto(deps: Deps, turnoId: string) {
    const turno = await deps.repos.turnos.buscar(turnoId);
    if (!turno) throw new ErroDeDominio("nao_encontrado", { cause: "turno" });
    return { turnoId: turno.id, agenteId: turno.agenteId, conversaId: turno.conversaId };
  }
  return {
    async encaminhar(trx, p) {
      const deps = depsSobre(trx);
      const r = await encaminhar(deps, { ...(await contexto(deps, p.turnoId)), para_agente: p.paraAgente, motivo: p.motivo });
      if (aoGravar && r.events?.length) await aoGravar(trx, r.events);
      return r.data;
    },
    async passar(trx, p) {
      const deps = depsSobre(trx);
      const r = await passar(deps, { ...(await contexto(deps, p.turnoId)), motivo: p.motivo });
      if (aoGravar && r.events?.length) await aoGravar(trx, r.events);
      return r.data;
    },
    async pedir(trx, p) {
      const deps = depsSobre(trx);
      const r = await pedirABot(deps, { ...(await contexto(deps, p.turnoId)), agente: p.agente, pedido: p.pedido, ...(p.contexto ? { contexto: p.contexto } : {}) });
      // ADR-099 (I7 revista): a espera circular volta como recusa tipada para o bot; aqui, sem modelo para ler, é erro.
      if (!r.data.ok) throw new ErroDeDominio("nao_permitido", { cause: r.data.erro });
      if (aoGravar && r.events?.length) await aoGravar(trx, r.events);
      return { tarefaId: r.data.tarefa_id };
    },
  };
}
