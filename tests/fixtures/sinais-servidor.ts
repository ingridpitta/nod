import { ouvirSinaisDeEncerramento } from "../../src/adapters/http/server.ts";

/**
 * X7 (revisão do épico #188): o processo do servidor com os ouvintes de sinal de verdade e uma drenagem que nunca
 * acaba. tests/unit/http/sinais-encerramento.test.ts manda dois sinais e confere que o segundo sai pelo `exit`.
 */
process.on("exit", (codigo) => {
  process.stdout.write(`exit ${codigo}\n`);
});
ouvirSinaisDeEncerramento((sinal) => {
  process.stdout.write(`drenando ${sinal}\n`);
});
process.stdout.write("pronto\n");
setInterval(() => undefined, 1_000);
