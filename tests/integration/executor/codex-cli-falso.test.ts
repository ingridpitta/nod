import { fileURLToPath } from "node:url";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { criarCodexCliDriver } from "../../../src/adapters/executor/drivers/codex-cli.ts";
import { PRAZO_TESTE_FALSO_MS, prazoSondaDoTeste } from "../../helpers/prazo-falso.ts";
import { planoHarness } from "../../helpers/plano-harness.ts";
import type { SinaisTurno } from "../../../src/contracts/turno.ts";
import type { ConfigDriver } from "../../../src/adapters/executor/spi.ts";
let dir: string;
let cfg: ConfigDriver;
// NOD-198: prazo por arquivo (sobe o CLI falso de verdade); a medida sob carga está em prazo-falso.ts.
vi.setConfig({ testTimeout: PRAZO_TESTE_FALSO_MS });

const lig = { urlNod: "http://127.0.0.1:8888", proxyPath: fileURLToPath(new URL("../../../src/adapters/mcp-proxy/proxy.ts", import.meta.url)), sigtermParaSigkillMs: 50, prazoSondaMs: prazoSondaDoTeste() };
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nod-codex-teste-"));
  const bin = join(dir, "codex");
  await writeFile(bin, `#!${process.execPath}\nawait import(${JSON.stringify(new URL("../../fixtures/codex-falso.mjs", import.meta.url).href)});\n`); await chmod(bin, 0o700);
  // ADR-083 §6: com o app-server, o chat roda nele (codex-chat-falso.test.ts). Este arquivo cobre o `codex exec`, a
  // reserva para Codex sem app-server.
  cfg = { bins: { "codex-cli": bin }, env: { HOME: dir, PATH: process.env.PATH ?? "", TESTE_NOD_REGISTRO: join(dir, "registro.json"), OPENAI_API_KEY: "nao-herdar", DATABASE_URL: "nao-herdar", TESTE_NOD_SEM_APP_SERVER: "1" }, cwdBase: join(dir, "turnos") };
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
it("normaliza texto, ferramentas, sinais e tokens; isola configuração e apaga o token", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  expect((await instance.sondar()).estado).toBe("pronto");
  const sinais: (keyof SinaisTurno)[] = []; const deltas: string[] = [];
  const plano = planoHarness(); plano.tokenDeTurno = "segredo-do-turno";
  const resultado = await instance.adapter(plano).rodarTurno({ sinal: async (s) => { sinais.push(s); }, delta: (d) => deltas.push(d), evento: () => {} });
  expect(resultado).toMatchObject({ desfecho: "sucesso", texto: "Resposta de teste.", custoUsd: null, sessaoCli: null, tokens: { entrada: 14, saida: 6, cacheLeitura: 4 }, ferramentasChamadas: ["mcp__nod__lembrar"] });
  expect(sinais.slice(0, 2)).toEqual(["attempted", "promptSubmitted"]); expect(deltas).toEqual(["Resposta de teste."]);
  const registro = JSON.parse(await readFile(join(dir, "registro.json"), "utf8"));
  expect(registro.args.join(" ")).not.toContain(plano.tokenDeTurno);
  expect(registro.args).toEqual(expect.arrayContaining(["--ignore-user-config", "--ignore-rules", "--ephemeral", "features.shell_tool=false", "features.plugins=false", "read-only"]));
  expect(registro.env.OPENAI_API_KEY).toBeUndefined(); expect(registro.env.DATABASE_URL).toBeUndefined();
  expect(registro.modo).toBe(0o600); expect(registro.proxy).toContain(plano.tokenDeTurno);
  expect(await readdir(cfg.cwdBase)).toEqual([]);
});
it("relatório antes da última ferramenta entra na fala; narração curta não; ao vivo segue só por delta", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const deltas: string[] = []; const blocos: string[] = [];
  const resultado = await instance.adapter(planoHarness({ texto: "relatorio" })).rodarTurno({ sinal: async () => {}, delta: (d) => deltas.push(d), evento: (e) => { if (e.tipo === "texto_bloco") blocos.push(e.texto); } });
  const relatorio = `Relatório das tasks: ${"NOD-101 aberto há 3 dias, sem revisão; ".repeat(10)}fim.`;
  expect(resultado).toMatchObject({ desfecho: "sucesso", texto: `${relatorio}\n\nAnotado.`, ferramentasChamadas: ["mcp__nod__consultar", "mcp__nod__lembrar"] });
  expect(deltas).toEqual(["Vou consultar as tasks.", relatorio, "Anotado."]);
  expect(blocos).toEqual(deltas);
});
it("conta desconectada fecha o gate antes de enviar o prompt", async () => {
  cfg.env.TESTE_NOD_SEM_LOGIN = "1";
  const instance = await criarCodexCliDriver(lig).create(cfg);
  expect((await instance.sondar()).estado).toBe("nao_autenticado");
  await expect(instance.adapter(planoHarness()).rodarTurno({ sinal: async () => {}, delta: () => {}, evento: () => {} })).rejects.toThrow("executor_indisponivel");
});
it("interrupção encerra o processo e limpa o diretório", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const adapter = instance.adapter(planoHarness({ texto: "esperar" }));
  const resultado = await adapter.rodarTurno({ sinal: async () => {}, delta: () => {}, evento: (e) => { if (e.tipo === "init") void adapter.interromper(); } });
  expect(resultado.desfecho).toBe("interrompido"); expect(await readdir(cfg.cwdBase)).toEqual([]);
});
it("erro do fornecedor vira falha: a mensagem crua vai só para o diagnóstico (erroCru), nunca para a fala", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const resultado = await instance.adapter(planoHarness({ texto: "falhar" })).rodarTurno({ sinal: async () => {}, delta: () => {}, evento: () => {} });
  expect(resultado.desfecho).toBe("falha");
  // definido em 2026-10-05: antes o erro do Codex era jogado fora e um turno que falhava não deixava pista nenhuma.
  expect(resultado.erroCru).toBe("segredo que não deve escapar");
  expect(JSON.stringify({ ...resultado, erroCru: null })).not.toContain("segredo");
});
it("as ferramentas do nod rodam sem aprovação do Codex, e o host de code mode não é desligado (2026-10-05)", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  await instance.adapter(planoHarness()).rodarTurno({ sinal: async () => {}, delta: () => {}, evento: () => {} });
  const { args } = JSON.parse(await readFile(join(dir, "registro.json"), "utf8")) as { args: string[] };
  const mcp = args.find((a) => a.startsWith("mcp_servers=")) ?? "";
  expect(mcp).toContain('default_tools_approval_mode = "approve"');
  expect(mcp).toContain("required = true");
  // Com o host desligado o 0.147.0 recusava toda chamada MCP ("code-mode host is disabled"): ver codex-comum.ts.
  expect(args.filter((a) => a.startsWith("features.code_mode"))).toEqual([]);
  expect(args).toContain('approval_policy="never"');
});
it("versão que não conhece uma chave: a sonda a descobre sem gastar turno, e o turno roda sem ela", async () => {
  cfg.env.TESTE_NOD_CHAVES_DESCONHECIDAS = "features.skip_host_skill_discovery,features.remote_plugin,mcp_servers.nod.default_tools_approval_mode";
  cfg.env.TESTE_NOD_NEGOCIACOES = join(dir, "negociacoes");
  const instance = await criarCodexCliDriver(lig).create(cfg);
  expect((await instance.sondar()).estado).toBe("pronto");
  // Três chaves recusadas, uma por rodada, e a rodada que passou parou em "No prompt provided": nenhum modelo chamado.
  expect(await readFile(join(dir, "negociacoes"), "utf8")).toBe("x");
  const resultado = await instance.adapter(planoHarness()).rodarTurno({ sinal: async () => {}, delta: () => {}, evento: () => {} });
  expect(resultado).toMatchObject({ desfecho: "sucesso", texto: "Resposta de teste." });
  const { args } = JSON.parse(await readFile(join(dir, "registro.json"), "utf8")) as { args: string[] };
  expect(args.some((a) => a.startsWith("features.skip_host_skill_discovery") || a.startsWith("features.remote_plugin"))).toBe(false);
  expect(args.find((a) => a.startsWith("mcp_servers="))).not.toContain("default_tools_approval_mode");
  // O resto do isolamento continua lá.
  expect(args).toEqual(expect.arrayContaining(["features.shell_tool=false", "features.unified_exec=false", "features.plugins=false", 'web_search="disabled"']));
});
it("versão que recusa uma chave que não pode cair: o Codex fica indisponível em vez de rodar mais solto", async () => {
  cfg.env.TESTE_NOD_CHAVES_DESCONHECIDAS = "features.shell_tool";
  const instance = await criarCodexCliDriver(lig).create(cfg);
  expect(await instance.sondar()).toMatchObject({ estado: "ausente", motivo: expect.stringContaining("Atualize o Codex") });
  await expect(instance.adapter(planoHarness()).rodarTurno({ sinal: async () => {}, delta: () => {}, evento: () => {} })).rejects.toThrow("executor_indisponivel");
});
it("chamada de ferramenta que o Codex cancela chega como erro com o motivo dele", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const resultados: { isError: boolean; texto: string }[] = [];
  const resultado = await instance.adapter(planoHarness({ texto: "aviso-e-ferramenta-cancelada" })).rodarTurno({ sinal: async () => {}, delta: () => {}, evento: (e) => { if (e.tipo === "tool_result") resultados.push({ isError: e.isError, texto: e.texto }); } });
  expect(resultados).toEqual([{ isError: true, texto: "user cancelled MCP tool call" }]);
  // O turno "deu certo" para o Codex (o modelo respondeu): o aviso dele não vira erro de um turno concluído.
  expect(resultado).toMatchObject({ desfecho: "sucesso", texto: "A ferramenta está indisponível." });
  expect(resultado.erroCru ?? null).toBeNull();
});
it("turno que morre sem result leva a última linha do stderr, sem o carimbo de hora, para o diagnóstico", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const resultado = await instance.adapter(planoHarness({ texto: "morrer-sem-evento" })).rodarTurno({ sinal: async () => {}, delta: () => {}, evento: () => {} });
  expect(resultado.desfecho).not.toBe("sucesso");
  expect(resultado.erroCru).toBe("ERROR codex_core: algo quebrou antes do primeiro evento");
});
it("teste da conta: uma frase sem servidor MCP, com o isolamento do turno; a resposta volta pronta para a tela (2026-10-05)", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const pergunta = "Diga oi para Marcelo em uma frase curta, em português. Só a frase.";
  const t = await instance.testar!(pergunta);
  expect(t).toMatchObject({ inventario: { estado: "pronto" }, resposta: "Oi, Marcelo. Tudo pronto." });
  const registro = JSON.parse(await readFile(join(dir, "registro.json"), "utf8")) as { args: string[]; env: Record<string, string>; arquivos: string[]; prompt: string };
  expect(registro.prompt).toBe(pergunta);
  // Nenhum proxy, nenhum token: o teste não fala com o nod.
  expect(registro.arquivos).toEqual([]);
  expect(registro.args).toEqual(expect.arrayContaining(["mcp_servers={}", "--ignore-user-config", "--ephemeral", "features.shell_tool=false", "read-only"]));
  expect(registro.env.OPENAI_API_KEY).toBeUndefined();
  expect(await readdir(cfg.cwdBase)).toEqual([]);
});
it("teste da conta: logada e sem responder é 'nao_autenticado' com a causa 'teste_falhou', e o erro do fornecedor não sai do driver", async () => {
  cfg.env.TESTE_NOD_TESTE_FALHA = "1";
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const t = await instance.testar!("Diga oi em uma frase curta, em português. Só a frase.");
  expect(t).toEqual({ inventario: { estado: "nao_autenticado", motivo: "A conta entrou, mas não respondeu ao teste.", versao: "codex-cli teste", causa: "teste_falhou", em: expect.any(Number) }, resposta: null });
  expect(JSON.stringify(t)).not.toContain("conta sem uso");
  // O login continua valendo: a sonda grátis segue dizendo "pronto" (quem guarda o veredito é a vigia do app).
  expect((await instance.sondar()).estado).toBe("pronto");
});
it("teste da conta sem login não gasta turno: devolve o estado da sonda", async () => {
  cfg.env.TESTE_NOD_SEM_LOGIN = "1";
  const instance = await criarCodexCliDriver(lig).create(cfg);
  expect(await instance.testar!("Diga oi.")).toMatchObject({ inventario: { estado: "nao_autenticado" }, resposta: null });
  await expect(readFile(join(dir, "registro.json"), "utf8")).rejects.toThrow();
});
it("NOD-171: Codex abaixo do piso é 'ausente' com cli_antigo e as duas versões; o turno recusa com a causa, sem rodar", async () => {
  cfg.env.TESTE_NOD_VERSAO = "0.158.9";
  const instance = await criarCodexCliDriver(lig).create(cfg);
  expect(await instance.sondar()).toMatchObject({ estado: "ausente", causa: "cli_antigo", versao: "0.158.9", minima: "0.159.0", motivo: "O Codex deste Mac (0.158.9) é mais antigo que o testado pelo nod. Atualize para a versão 0.159.0 ou mais nova." });
  const sinais: (keyof SinaisTurno)[] = [];
  await expect(instance.adapter(planoHarness()).rodarTurno({ sinal: async (s) => { sinais.push(s); }, delta: () => {}, evento: () => {} })).rejects.toMatchObject({ codigo: "executor_indisponivel", cause: "cli_antigo" });
  expect(sinais).toEqual(["attempted"]);
  await expect(readFile(join(dir, "registro.json"), "utf8")).rejects.toThrow();
});
it("NOD-171: o pré-release do piso fica abaixo dele (semver), e o piso exato passa com a versão limpa", async () => {
  cfg.env.TESTE_NOD_VERSAO = "0.159.0-alpha.3";
  expect(await criarCodexCliDriver(lig).create(cfg).then((i) => i.sondar())).toMatchObject({ estado: "ausente", causa: "cli_antigo", versao: "0.159.0-alpha.3" });
  cfg.env.TESTE_NOD_VERSAO = "0.159.0";
  expect(await criarCodexCliDriver(lig).create(cfg).then((i) => i.sondar())).toEqual({ estado: "pronto", versao: "0.159.0", em: expect.any(Number) });
});
it("2026-10-09 (teste do Breno): sem node no PATH, o Codex do npm é 'sem_node', não 'Atualize o Codex'", async () => {
  cfg.env.TESTE_NOD_SEM_NODE = "1";
  const inv = await criarCodexCliDriver(lig).create(cfg).then((i) => i.sondar());
  expect(inv).toMatchObject({ estado: "ausente", causa: "sem_node" });
  expect("motivo" in inv ? inv.motivo : "").not.toContain("Atualize");
});
it("2026-10-09: config.toml quebrado é 'config_invalida' (ausente), não 'falta entrar'", async () => {
  cfg.env.TESTE_NOD_VERSAO = "0.162.1";
  cfg.env.TESTE_NOD_CONFIG_QUEBRADA = "1";
  expect(await criarCodexCliDriver(lig).create(cfg).then((i) => i.sondar())).toMatchObject({ estado: "ausente", causa: "config_invalida" });
});
