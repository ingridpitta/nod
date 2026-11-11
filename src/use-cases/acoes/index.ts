import { EXECUTORES_ACESSOS } from "./acessos.ts";
import { EXECUTORES_APPS } from "./apps.ts";
import { EXECUTORES_BOTS } from "./bots.ts";
import { EXECUTORES_CANVAS } from "./canvas.ts";
import { EXECUTORES_CONVERSA } from "./conversa.ts";
import { EXECUTORES_MAQUINAS } from "./maquinas.ts";
import { EXECUTORES_QUADRO } from "./quadro.ts";
import { EXECUTORES_ROTINAS } from "./rotinas.ts";
import { EXECUTORES_TIMES } from "./times.ts";

/** A união das tabelas id → executor único (ADR-135): o teste dos executores compara as chaves com as ações `vivo`. */
export const EXECUTORES = { ...EXECUTORES_BOTS, ...EXECUTORES_QUADRO, ...EXECUTORES_CONVERSA, ...EXECUTORES_APPS, ...EXECUTORES_TIMES, ...EXECUTORES_CANVAS, ...EXECUTORES_ACESSOS, ...EXECUTORES_MAQUINAS, ...EXECUTORES_ROTINAS } as const;
