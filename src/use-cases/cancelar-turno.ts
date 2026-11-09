import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";
import { sincronizarDoTurno } from "./trabalhos.ts";

/**
 * Cancelar UMA mensagem da fila (definido em 2026-09-24): interrompe só o turno pendente que ela
 * disparou, sem abrir parada nem mexer no que está rodando — isso continua sendo o Parar. Turno que
 * já saiu do pendente (reivindicado, absorvido, encerrado) responde estado_invalido: não há como
 * "descancelar" o que já rodou. RLS garante que só a dona enxerga o turno.
 */
export const cancelarTurno: CasoDeUso<{ turnoId: string }, { turno: Turno }> = async (deps, input) => {
  const atual = await deps.repos.turnos.buscar(input.turnoId);
  if (!atual) throw new ErroDeDominio("nao_encontrado");
  if (atual.estado !== "pendente") throw new ErroDeDominio("estado_invalido", { cause: `turno ${atual.estado}` });
  const turno = await deps.repos.turnos.cancelarPendente(atual.id);
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "turno saiu do pendente" });
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  return {
    data: { turno },
    events: [evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "parado_pela_pessoa", estava: "pendente" } }), ...(await sincronizarDoTurno(deps, turno))],
  };
};
