import { idDeterministico } from "../../src/db/seed/id-deterministico.ts";
import { TENANT_PADRAO } from "../../src/db/seed/index.ts";

// Só ids de IDENTIDADE (EMENDA 9). Agentes/salas/conversas de teste são criados pelo próprio
// teste dentro do withRollback com randomUUID — nunca dependem do seed.
export { TENANT_PADRAO };
export const PESSOA_MARLON = idDeterministico("pessoa:marlon");
export const PESSOA_ANA = idDeterministico("pessoa:ana");
