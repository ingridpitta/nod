import { encerrarGruposOrfaos } from "../../src/adapters/executor/grupos-orfaos.ts";

/**
 * ADR-089 (revisão do #223): o "servidor" que um bot da mesma instância subiu sem setsid — nasce no grupo do bot, com a
 * marca herdada — roda a limpeza de órfãos. tests/unit/executor/grupos-orfaos.test.ts confere que ele não se mata.
 */
const r = await encerrarGruposOrfaos({ arquivo: process.argv[2] ?? "" });
process.stdout.write(`limpeza ${JSON.stringify(r)}\n`);
setTimeout(() => undefined, 300_000);
