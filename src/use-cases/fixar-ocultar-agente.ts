import type { Agente } from "../contracts/agente.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { ehNod } from "../domain/nod.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

async function alternar(
  deps: Deps,
  agenteId: string,
  campo: "fixado" | "oculto",
  valor: boolean | undefined,
): Promise<{ data: { agente: Agente }; events: ReturnType<typeof evento>[] }> {
  if (valor !== undefined && typeof valor !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: campo });
  const existente = await deps.repos.agentes.buscar(agenteId);
  if (!existente) throw new ErroDeDominio("nao_encontrado");
  const novo = valor ?? !existente[campo];
  // ADR-081: o Nod fica — desafixar o leva à barra de cima (discreto), mas ocultar não existe para ele.
  if (campo === "oculto" && novo && ehNod(existente)) throw new ErroDeDominio("nod_protegido", { cause: "ocultar" });
  const agente = campo === "fixado" ? await deps.repos.agentes.fixar(agenteId, novo) : await deps.repos.agentes.ocultar(agenteId, novo);
  if (!agente) throw new ErroDeDominio("nao_permitido");
  const agora = deps.agora();
  return {
    data: { agente },
    events: [evento(deps.escopo, { kind: "agente_atualizado", autoria: autoriaPessoa(deps.escopo), agora, dados: { agente_id: agente.id, acao: campo, valor: novo } })],
  };
}

/** Pin (Grok Bot): sem `fixado` no corpo, alterna. */
export const fixarAgente: CasoDeUso<{ agenteId: string; fixado?: boolean }, { agente: Agente }> = (deps, input) => alternar(deps, input.agenteId, "fixado", input.fixado);

/** Hide (Grok Bot): oculto sai da frota mas continua existindo; sem `oculto` no corpo, alterna. */
export const ocultarAgente: CasoDeUso<{ agenteId: string; oculto?: boolean }, { agente: Agente }> = (deps, input) => alternar(deps, input.agenteId, "oculto", input.oculto);
