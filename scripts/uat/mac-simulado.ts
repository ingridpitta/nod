/**
 * Mac simulado para o UAT de harnesses no modo compartilhado (NOD-171) — `node scripts/uat/mac-simulado.ts`.
 *
 * Faz o que o app do Mac faz ao conectar (desktop/main.ts, `conectar`), sem Electron: troca a chave de máquina pela
 * sessão, sonda os CLIs REAIS deste Mac (NOD_CLAUDE_BIN / NOD_CODEX_BIN valem, como no app), anuncia os inventários
 * de cada harness e sobe o pool de laços que puxa turnos pela ponte HTTP. Ficam de fora o que é só do app: janela,
 * vigia das IAs (re-sonda a cada 3 s), GitHub local e ligação. Para trocar o CLI anunciado, pare e suba de novo.
 *
 * Env: NOD_UAT_URL (ex.: http://127.0.0.1:8890) e NOD_UAT_CHAVE (a chave crua de POST /maquinas/chaves). Imprime uma
 * linha JSON `mac_simulado_no_ar` com os inventários anunciados e segue puxando até SIGTERM.
 */
import { hostname } from "node:os";
import { criarClaudeCliDriver } from "../../src/adapters/executor/drivers/claude-cli.ts";
import { criarCodexCliDriver } from "../../src/adapters/executor/drivers/codex-cli.ts";
import { iniciarLaco } from "../../src/adapters/executor/laco.ts";
import { criarPonteHttp } from "../../src/adapters/executor/ponte-http.ts";
import { iniciarPoolDeLacos } from "../../src/adapters/executor/pool-lacos.ts";
import { configDosDrivers, criarRegistryDetalhado } from "../../src/adapters/executor/registry.ts";
import { prazoSondaDoEnv } from "../../src/adapters/executor/sonda.ts";
import { CAMINHO_HOOK, CAMINHO_PROXY } from "../../src/adapters/http/boot.ts";

const url = process.env.NOD_UAT_URL ?? "";
const chave = process.env.NOD_UAT_CHAVE ?? "";
if (!url || !chave) { process.stderr.write("NOD_UAT_URL e NOD_UAT_CHAVE são obrigatórios\n"); process.exit(2); }
const versao = "9.9.9"; // versaoAceita só aceita major.minor.patch(-rc.N); um sufixo daria 426 atualize_app

const r = await fetch(`${url}/api/maquina/sessao`, { method: "POST", headers: { authorization: `Bearer ${chave}`, "x-nod-versao": versao, "content-type": "application/json" }, body: "{}" });
if (!r.ok) { process.stderr.write(`sessão da máquina recusada: HTTP ${r.status}\n`); process.exit(1); }
const dados = (await r.json()) as { escopo: { pessoaId: string }; machineId: string };

const lig = { urlNod: url, proxyPath: CAMINHO_PROXY, hookPath: CAMINHO_HOOK, nodePath: process.execPath, sondaSemTurno: true, prazoSondaMs: prazoSondaDoEnv(process.env) };
const cfg = await configDosDrivers(process.env);
const { registry, inventarios } = await criarRegistryDetalhado(process.env, [criarClaudeCliDriver(lig), criarCodexCliDriver(lig)], { cfg });
const ponteHttp = criarPonteHttp({ url, chave, versao, aoFalhar: (codigo) => process.stderr.write(`${JSON.stringify({ evento: "mac_simulado_falha", codigo })}\n`) });
const principal = inventarios["claude-cli"]?.estado === "pronto" ? inventarios["claude-cli"] : (inventarios["codex-cli"] ?? inventarios["claude-cli"]);
if (!principal) { process.stderr.write("nenhum harness sondado\n"); process.exit(1); }
await ponteHttp.ponte.conectar({ machineId: dados.machineId, nome: `${hostname()} (UAT)`, inventario: principal, versaoContrato: 1, harnesses: inventarios, ligacao: false });

const pool = iniciarPoolDeLacos((ponte) => iniciarLaco({ ponte, registry, pessoaId: dados.escopo.pessoaId, machineId: dados.machineId, relogio: () => Date.now(), renovacaoMs: 1_000, esperaVaziaMs: 1_000 }), ponteHttp.ponte);
process.stdout.write(`${JSON.stringify({ evento: "mac_simulado_no_ar", machineId: dados.machineId, inventarios: Object.fromEntries(Object.entries(inventarios).map(([h, i]) => [h, { estado: i?.estado, causa: i && "causa" in i ? i.causa : undefined, versao: i && "versao" in i ? i.versao : undefined }])) })}\n`);

const sair = () => { void Promise.resolve(pool.parar()).finally(() => process.exit(0)); };
process.on("SIGTERM", sair);
process.on("SIGINT", sair);
