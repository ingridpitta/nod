import { iniciarProcesso, registrarGruposEm } from "../../src/adapters/executor/processo.ts";

/**
 * ADR-089 (#217): um "servidor" que anota os grupos em arquivo e abre um bot com um neto no mesmo grupo — o `claude -p`
 * com o `while … sleep` do Bash. O neto é um node (e não /bin/sleep) porque o macOS não mostra o ambiente dos binários da
 * Apple, e o teste do líder morto precisa ler a marca NOD_GRUPO nele. tests/unit/executor/grupos-orfaos.test.ts o mata com SIGKILL (o `exit` não roda) e
 * confere que o boot seguinte leva o grupo.
 */
const arquivo = process.argv[2] ?? "";
registrarGruposEm(arquivo);
const BOT = `
const { spawn } = require("node:child_process");
const neto = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)"], { stdio: "ignore" });
process.stdout.write("neto " + neto.pid + "\\n");
setInterval(() => {}, 1000);
`;
const bot = iniciarProcesso({
  bin: process.execPath,
  args: ["-e", BOT],
  env: { PATH: process.env.PATH ?? "" },
  cwd: process.cwd(),
  aoLinha: (linha) => {
    if (linha.startsWith("neto ")) process.stdout.write(`bot ${bot.pid} ${linha}\n`);
  },
});
setInterval(() => undefined, 1_000);
