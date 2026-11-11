import type { TarefaDto } from "../contracts/quadro.ts";
import { USO_DO_MAC_PADRAO } from "../contracts/raio-x.ts";
import { esperaDoMac } from "../domain/memoria-mac.ts";
import { portaoDoTopo } from "./trabalhos.ts";
import type { Deps } from "./tipos.ts";

export type MotivoFilaDaTarefa = NonNullable<TarefaDto["motivoFila"]>;

/**
 * definido em 2026-11-10 (ADA-16, ADR-163, "não quero limites"): a tarefa do quadro não tem teto próprio, então o card
 * só diz "na fila há X min" por um motivo real, e diz qual:
 * - `mesma_tarefa`: outro turno do mesmo bot na mesma tarefa está rodando (a mesma tarefa segue em série);
 * - `memoria` / `processador` / `disco`: o portão da máquina (ADR-085) segura a primeira etapa dela.
 * Fora disso a tarefa só está esperando a máquina pegar, e o card mostra "na fila" sem a hora. Sem o serviço das
 * máquinas (teste antigo, leitura pela porta), só a série.
 */
export async function motivosDaFila(
  deps: Pick<Deps, "repos" | "agora" | "escopo"> & { services?: Pick<Deps["services"], "trabalhosVivos" | "maquinas"> },
  naFila: readonly { id: string; agenteId: string | null }[],
): Promise<Map<string, MotivoFilaDaTarefa>> {
  const saida = new Map<string, MotivoFilaDaTarefa>();
  if (naFila.length === 0) return saida;
  const filas = await deps.repos.quadros.filaDasTarefas(naFila);
  const semSerie = [...filas].filter(([, f]) => !f.emSerie);
  for (const [id, f] of filas) if (f.emSerie) saida.set(id, "mesma_tarefa");
  if (semSerie.length === 0 || !deps.services?.trabalhosVivos) return saida;
  const preferencias = await deps.repos.preferencias.buscar();
  const portao = portaoDoTopo({ escopo: deps.escopo, services: deps.services }, preferencias.usoDoMac ?? USO_DO_MAC_PADRAO);
  if (portao.fundo === null && portao.tudoNovo === null) return saida;
  const agora = deps.agora();
  for (const [id, f] of semSerie) {
    const motivo = esperaDoMac(f.trabalho, portao, agora);
    if (motivo) saida.set(id, motivo);
  }
  return saida;
}
