/**
 * ADA-32 (ADR-151): o servidor do Nod que a CI do Windows usa para rodar o instalador até o pareamento, em loopback.
 * As rotas do motor de verdade (rotasMotor) sobre o dist/motor montado, e o atalho /windows do servidor de verdade.
 * Uso: tsx scripts/windows/servidor-de-teste.ts <porta>
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { rotasMotor } from "../../src/adapters/http/rotas/motor.ts";
import { listen } from "../../src/adapters/http/servidor.ts";

const porta = Number(process.argv[2] ?? 8765);
const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };
const { port } = await listen(porta, "127.0.0.1", { rotas: rotasMotor({ pasta: resolve("dist/motor"), versao: version }), sessao: { modo: "stub" } });
process.stdout.write(`servidor de teste em http://127.0.0.1:${port}\n`);
