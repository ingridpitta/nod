import type { CatalogoHarness } from "./harness.ts";
import type { Inventario } from "./inventario.ts";

/** Os dois executores do SPI (ADR-012/014): catcher (sem CLI, sem custo) e claude-cli (real, na assinatura da pessoa). */
export type IdExecutor = "catcher" | "claude-cli" | "codex-cli";

/** Uma opção do interruptor: o que a sonda daquele driver disse por último (ADR-019/029: estado escrito, nunca ícone). */
export type OpcaoExecutor = { id: IdExecutor; custo: "zero" | "real"; inventario: Inventario };

/**
 * Estado do interruptor de executor (definido em 2026-09-16): é da MÁQUINA (um processo, um registry),
 * não da pessoa. `recusa` é o motivo escrito quando a última troca pedida não pôde acontecer.
 */
/**
 * `trocavel` (definido em 2026-10-10, teste do Breno): false no modo compartilhado, onde não existe `POST /executor` —
 * a IA de cada bot é escolhida na Inteligência dele (e o Automático segue a ordem da pessoa). O botão "usar Codex"
 * chamava a rota e recebia 404. Ausente = true (o interruptor do modo local).
 */
export type EstadoExecutor = { atual: IdExecutor; opcoes: OpcaoExecutor[]; recusa: string | null; harnesses?: CatalogoHarness; trocavel?: boolean };
