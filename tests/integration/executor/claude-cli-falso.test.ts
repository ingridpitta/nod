import { existsSync } from "node:fs";
import { chmod, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ABRE_CONTEXTO_DO_TURNO, AVISO_SEM_TERMINAL, FECHA_CONTEXTO_DO_TURNO, criarClaudeCliDriver } from "../../../src/adapters/executor/drivers/claude-cli.ts";
import { PRAZO_TESTE_FALSO_MS, prazoSondaDoTeste } from "../../helpers/prazo-falso.ts";
import { configDosDrivers } from "../../../src/adapters/executor/registry.ts";
import type { ConfigDriver, Driver, Instance, SinksTurno } from "../../../src/adapters/executor/spi.ts";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import type { EventoStream, SinaisTurno, SubagenteVivo } from "../../../src/contracts/turno.ts";
import type { VigiaVivo } from "../../../src/contracts/ponte.ts";
import { criarVigiaTurno } from "../../../src/domain/vigia-turno.ts";
import { molduraMensagemNoMeio } from "../../../src/domain/mensagem-no-meio.ts";
import { capacidadesDe } from "../../../src/domain/harness.ts";
import { VERSAO_MINIMA_POR_APELIDO } from "../../../src/contracts/modelos.ts";
import { PISO_CLI } from "../../../src/adapters/executor/flag-floors.ts";
import { criarAcompanhanteDeSubagentes } from "../../../src/adapters/executor/acompanhar-subagentes.ts";

/**
 * Spawn REAL do binário falso (tests/fixtures/claude-falso.mjs, L3) por trás de um `claude` de
 * teste que grava argv/env/cwd/mcp.json e o stdin recebido, e repassa sinais. Sem custo: nenhum
 * `claude` real. Cada cenário do mapa-cli (s3, s4b, s6, s2c) é um shim com o env do cenário fixo
 * — as variáveis NOD_FALSO_* têm prefixo NOD_ e a denylist do executor as apagaria (ADR-015).
 */
const AQUI = dirname(fileURLToPath(import.meta.url));
const FALSO = join(AQUI, "..", "..", "fixtures", "claude-falso.mjs");

const WRAPPER = `
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const i = args.indexOf("--mcp-config");
let mcp = null;
if (i !== -1) {
  const p = args[i + 1];
  try { mcp = { caminho: p, modo: (statSync(p).mode & 0o777).toString(8), conteudo: JSON.parse(readFileSync(p, "utf8")) }; } catch (e) { mcp = { erro: String(e) }; }
}
if (process.env.TESTE_NOD_REGISTRO) writeFileSync(process.env.TESTE_NOD_REGISTRO, JSON.stringify({ argv: args, env: process.env, cwd: process.cwd(), mcp }));
const filho = spawn(process.execPath, [${JSON.stringify(FALSO)}, ...args], { stdio: ["pipe", "inherit", "inherit"], env: process.env });
process.stdin.on("data", (c) => { if (process.env.TESTE_NOD_STDIN) appendFileSync(process.env.TESTE_NOD_STDIN, c); filho.stdin.write(c); });
process.stdin.on("end", () => filho.stdin.end());
process.on("SIGTERM", () => filho.kill("SIGTERM"));
filho.on("exit", (code) => process.exit(code ?? 143));
`;

async function shim(dir: string, nome: string, envDoCenario: Record<string, string>): Promise<string> {
  const mjs = join(dir, `${nome}.mjs`);
  await writeFile(mjs, WRAPPER);
  const exports = Object.entries(envDoCenario)
    .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
    .join("\n");
  const sh = join(dir, nome);
  await writeFile(sh, `#!/bin/sh\n${exports}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(mjs)} "$@"\n`);
  await chmod(sh, 0o755);
  return sh;
}

function planoDeTeste(dir: string, parcial: Partial<PlanoTurno["entrada"]> = {}): PlanoTurno {
  return {
    tenantId: "t",
    turnoId: `turno-${Math.random().toString(36).slice(2, 8)}`,
    conversaId: "c",
    agenteId: "a",
    localidade: "local",
    machineId: "m",
    executor: "local",
    superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas",
    autoria: { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: "m", decidido_por: "regra:x", regra_versao: 1 },
    confiancaEntrada: "confiavel",
    profundidade: 0,
    catalogo: {
      ferramentas: [{ nome: "somar", nomeMcp: "mcp__nod__somar", origem: "conector", conectorId: "k", readOnlyHint: true, tocaDadoPessoal: false, schema: { type: "object" } }],
      servidores: [],
    },
    promptSistema: "Você é a sonda do nod.",
    entrada: { texto: `Some 17 e 25 (${dir})`, sessaoCli: null, modelo: "claude-haiku-4-5-20251001", ...parcial },
    semprePermitir: [],
    politicaExecucao: { prazoMs: 60_000, orcamentoResultadoChars: 8000 },
    tokenDeTurno: "token-de-turno-teste",
    expiraEm: Date.now() + 60_000,
  };
}

type Registro = { argv: string[]; env: Record<string, string>; cwd: string; mcp: { caminho: string; modo: string; conteudo: unknown } | null };

const valor = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : (args[i + 1] ?? null);
};

/**
 * definido em 2026-09-16: 30 s por teste — cada um spawna 3–4 processos node (shim + binário falso +
 * --version/--help) e o padrão de 5 s do vitest estourava de forma intermitente sob o projeto
 * integration inteiro. medido em 2026-09-16: até 6,4 s num teste do claude-cli-falso e 4,0 s num da
 * sonda-falsa com o projeto integration completo em paralelo (8 execuções); 1–3 s rodando só a lane.
 */
const TIMEOUT_MS = PRAZO_TESTE_FALSO_MS; // NOD-198: era 30 s; a medida sob carga está em prazo-falso.ts

/**
 * definido em 2026-09-16: 300 ms de escalada SIGTERM→SIGKILL no teste s6 (produção usa
 * SIGTERM_PARA_SIGKILL_MS = 5 s). O binário falso responde ao SIGTERM entre linhas do stream
 * (atraso de 40 ms por linha), então 300 ms já lhe dá ~7 janelas para sair sozinho.
 */
const ESCALADA_MS = 300;

/**
 * definido em 2026-09-16: o teste s6 afirma `gasto < ESCALADA_MS * 10` — folga deliberada sobre o
 * caminho feliz, para o verde medir A COISA CERTA (interromper() volta quando o filho sai, sem
 * esperar a escalada) e não a carga da máquina. medido em 2026-09-16: 7–9 ms de gasto real em 5
 * execuções do projeto integration completo em paralelo — ~330x de folga sobre o limite de 3 s.
 */
const LIMITE_EM_ESCALADAS = 10;

describe("driver claude-cli contra o binário falso (contrato empírico 2026-09-16)", { timeout: TIMEOUT_MS }, () => {
  let dir: string;
  let cfgBase: ConfigDriver;
  const lig = { urlNod: "http://127.0.0.1:65000", proxyPath: "/app/src/adapters/mcp-proxy/proxy.ts", prazoSondaMs: prazoSondaDoTeste() };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nod-cli-falso-"));
    // env do processo servidor, com a sujeira que a denylist tem que apagar
    cfgBase = await configDosDrivers(
      { HOME: dir, PATH: process.env.PATH, ANTHROPIC_API_KEY: "sk-vazou", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", NOD_HOME: join(dir, ".nod"), NOD_SESSAO_SEGREDO: "s" },
      { shellDeLogin: false, home: dir },
    );
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  async function instanciarCom(driver: Driver, cenario: string, extraShim: Record<string, string> = {}, extraEnv: Record<string, string> = {}): Promise<{ instance: Instance; registro: string; stdin: string; sessoes: string }> {
    const sessoes = join(dir, `sessoes-${cenario}-${Math.random().toString(36).slice(2, 8)}`);
    const bin = await shim(dir, `claude-${cenario}-${Math.random().toString(36).slice(2, 6)}`, { NOD_FALSO_CENARIO: cenario, NOD_FALSO_SESSOES: sessoes, ...extraShim });
    const registro = join(dir, `registro-${Math.random().toString(36).slice(2, 8)}.json`);
    const stdin = join(dir, `stdin-${Math.random().toString(36).slice(2, 8)}.txt`);
    const cfg: ConfigDriver = { ...cfgBase, bin, env: { ...cfgBase.env, TESTE_NOD_REGISTRO: registro, TESTE_NOD_STDIN: stdin, ...extraEnv } };
    const instance = await driver.create(cfg);
    return { instance, registro, stdin, sessoes };
  }

  const instanciar = (cenario: string, extraEnv: Record<string, string> = {}, extraShim: Record<string, string> = {}) => instanciarCom(criarClaudeCliDriver(lig), cenario, extraShim, extraEnv);

  function sinksEspiao(extra: Partial<SinksTurno> = {}) {
    const sinais: (keyof SinaisTurno)[] = [];
    const eventos: EventoStream[] = [];
    const deltas: string[] = [];
    const sinks: SinksTurno = {
      async sinal(s) {
        sinais.push(s);
        await extra.sinal?.(s);
      },
      evento: (e) => eventos.push(e),
      delta: (t) => deltas.push(t),
    };
    return { sinks, sinais, eventos, deltas };
  }

  it("s3: flags obrigatórias, --allowedTools exato, mcp.json 0600 no cwd mkdtemp, env sem ANTHROPIC_API_KEY/CLAUDECODE, promptSubmitted ANTES do stdin, tmpdir apagado", async () => {
    const { instance, registro, stdin } = await instanciar("s3-mcp-ok");
    const plano = planoDeTeste(dir);
    let stdinJaTinhaChegado: boolean | null = null;
    const espiao = sinksEspiao({
      async sinal(s) {
        if (s === "promptSubmitted") {
          stdinJaTinhaChegado = await stat(stdin).then(() => true, () => false);
        }
      },
    });
    const resultado = await instance.adapter(plano).rodarTurno(espiao.sinks);

    expect(resultado.desfecho).toBe("sucesso");
    expect(resultado.texto).toContain("SONDA_OK");
    expect(resultado.custoUsd).toBe(0.0207631);
    expect(resultado.ferramentasChamadas).toEqual(["mcp__nod__somar"]);
    expect(resultado.negacoesPermissao).toEqual([]);
    expect(resultado.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: true, producedOutput: true });
    expect(espiao.sinais[0]).toBe("attempted");
    expect(espiao.sinais.indexOf("promptSubmitted")).toBeLessThan(espiao.sinais.indexOf("producedOutput"));
    // cada sinal sai UMA vez, mesmo quando o init chega enquanto um `sinks.sinal` ainda está pendente
    expect(espiao.sinais).toEqual(["attempted", "promptSubmitted", "producedOutput"]);
    expect(stdinJaTinhaChegado).toBe(false);
    expect(await readFile(stdin, "utf8")).toBe(plano.entrada.texto);
    expect(espiao.deltas.join("")).toContain("SONDA_OK");
    // Modo dev (ADR-054): o driver entrega cada chamada do stream, com a ferramenta na chamada que a pediu.
    expect(resultado.execucao?.chamadas.map((c) => [c.contexto, c.ferramentas.map((f) => f.nome)])).toEqual([[7351, ["mcp__nod__somar"]], [7724, []]]);
    expect(resultado.execucao).toMatchObject({ janela: 200000, versaoCli: "2.1.272", custoSessaoUsd: 0.0207631 });

    const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
    expect(r.argv[0]).toBe("-p");
    expect(valor(r.argv, "--output-format")).toBe("stream-json");
    expect(r.argv).toContain("--verbose");
    expect(r.argv).toContain("--include-partial-messages");
    expect(r.argv).toContain("--strict-mcp-config");
    expect(valor(r.argv, "--setting-sources")).toBe("project");
    // ADR-054: sem nativas, só a busca de ferramentas — as definições do MCP entram quando o modelo as busca.
    expect(valor(r.argv, "--tools")).toBe("ToolSearch");
    expect(valor(r.argv, "--allowedTools")).toBe("mcp__nod__somar,ToolSearch");
    expect(valor(r.argv, "--permission-mode")).toBe("default");
    expect(r.argv).not.toContain("--max-turns");
    expect(valor(r.argv, "--append-system-prompt")).toBe("Você é a sonda do nod.");
    expect(valor(r.argv, "--session-id")).toBe(resultado.sessaoCli);
    expect(r.argv).not.toContain("--resume");

    // NOD-188: sem pasta, o cwd é estável por bot em NOD_HOME/turnos (nunca o repo); o mcp.json 0600 fica num mkdtemp
    // do turno, apagado no fim (realpath: no macOS o tmpdir /var/... é enxergado pelo filho como /private/var/...)
    expect(r.cwd).toBe(join(await realpath(join(dir, ".nod", "turnos")), "texto-a"));
    expect(basename(dirname(r.mcp!.caminho))).toMatch(/^turno-/);
    expect(dirname(dirname(r.mcp!.caminho))).toBe(join(dir, ".nod", "turnos"));
    expect(r.mcp?.modo).toBe("600");
    expect(r.mcp?.conteudo).toEqual({ mcpServers: { nod: { command: process.execPath, args: [lig.proxyPath], env: { NOD_URL: lig.urlNod, NOD_TOKEN_TURNO: "token-de-turno-teste" } } } });
    await expect(stat(dirname(r.mcp!.caminho))).rejects.toThrow(/ENOENT/);

    // ambiente do filho: denylist aplicada, PATH aumentado, HOME e MCP_TOOL_TIMEOUT presentes
    expect(r.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(r.env.CLAUDECODE).toBeUndefined();
    expect(r.env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(r.env.NOD_SESSAO_SEGREDO).toBeUndefined();
    expect(r.env.HOME).toBe(dir);
    expect(r.env.PATH?.split(":")).toContain(join(dir, ".local/bin"));
    expect(r.env.MCP_TOOL_TIMEOUT).toBe("60000");
  });

  it("ADR-101: a conta em uso vai pelo envPorDriver do Claude — o filho recebe o CLAUDE_CONFIG_DIR dela", async () => {
    const driver = criarClaudeCliDriver(lig);
    const sessoes = join(dir, `sessoes-conta-${Math.random().toString(36).slice(2, 8)}`);
    const bin = await shim(dir, `claude-conta-${Math.random().toString(36).slice(2, 6)}`, { NOD_FALSO_CENARIO: "s3-mcp-ok", NOD_FALSO_SESSOES: sessoes });
    const registro = join(dir, `registro-conta-${Math.random().toString(36).slice(2, 8)}.json`);
    const pasta = join(dir, "contas", "claude-cli", "c-1234abcd");
    const cfg: ConfigDriver = { ...cfgBase, bin, env: { ...cfgBase.env, TESTE_NOD_REGISTRO: registro }, envPorDriver: { "claude-cli": { CLAUDE_CONFIG_DIR: pasta }, "codex-cli": { CODEX_HOME: "/nao/vai" } } };
    const instance = await driver.create(cfg);
    const r1 = await instance.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao().sinks);
    expect(r1.desfecho).toBe("sucesso");
    const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
    expect(r.env.CLAUDE_CONFIG_DIR).toBe(pasta);
    expect(r.env.CODEX_HOME).toBeUndefined();
  });

  it("2º turno com sessaoCli do 1º: --resume o MESMO uuid, sem --session-id, e o binário falso aceita", async () => {
    const { instance, registro } = await instanciar("s3-mcp-ok");
    const primeiro = await instance.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao().sinks);
    expect(primeiro.sessaoCli).toMatch(/^[0-9a-f-]{36}$/);
    const segundo = await instance.adapter(planoDeTeste(dir, { sessaoCli: primeiro.sessaoCli })).rodarTurno(sinksEspiao().sinks);
    expect(segundo.desfecho).toBe("sucesso");
    expect(segundo.sessaoCli).toBe(primeiro.sessaoCli);
    const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
    expect(valor(r.argv, "--resume")).toBe(primeiro.sessaoCli);
    expect(r.argv).not.toContain("--session-id");
  });

  it("s6: SIGTERM no meio do streaming → 'interrompido' sem result, sem motivo (quem sabe é o servidor), tmpdir apagado", async () => {
    // Driver com a escalada SIGTERM→SIGKILL encurtada para ESCALADA_MS: o que este teste afirma é
    // que interromper() NÃO espera a escalada inteira (o falso responde ao SIGTERM sozinho), e essa
    // afirmação só é honesta contra um relógio que o teste controla — com o padrão de 5 s a
    // asserção competia com o próprio SIGTERM_PARA_SIGKILL_MS e piscava.
    const { instance, registro } = await instanciarCom(criarClaudeCliDriver({ ...lig, sigtermParaSigkillMs: ESCALADA_MS }), "s6-sigterm", { NOD_FALSO_ATRASO_MS: "40" });
    const adapter = instance.adapter(planoDeTeste(dir));
    const espiao = sinksEspiao();
    // o cronômetro começa no INSTANTE do pedido de interrupção — não na chamada de rodarTurno, que
    // ainda carrega o prelúdio de --version/--help (segundos de spawn que nada têm a ver com o SIGTERM).
    let inicioDaInterrupcao = 0;
    const promessa = adapter.rodarTurno({
      ...espiao.sinks,
      delta(t) {
        espiao.deltas.push(t);
        if (espiao.deltas.length === 3) {
          inicioDaInterrupcao = Date.now();
          void adapter.interromper();
        }
      },
    });
    const resultado = await promessa;
    const gasto = Date.now() - inicioDaInterrupcao;
    expect(inicioDaInterrupcao).toBeGreaterThan(0);
    expect(gasto).toBeLessThan(ESCALADA_MS * LIMITE_EM_ESCALADAS);
    expect(resultado.desfecho).toBe("interrompido");
    expect(resultado.motivoInterrupcao).toBeUndefined();
    expect(espiao.eventos.some((e) => e.tipo === "result")).toBe(false);
    expect(espiao.eventos[0]?.tipo).toBe("init");
    expect(resultado.sinais.promptSubmitted).toBe(true);
    expect(resultado.sinais.producedOutput).toBe(true);
    expect(resultado.texto.length).toBeGreaterThan(0);
    const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
    await expect(stat(dirname(r.mcp!.caminho))).rejects.toThrow(/ENOENT/);
  });

  it("s2c: exit 1 sem init (Session ID already in use) → 'sessao_rejeitada' com rejected=true; tmpdir apagado mesmo na falha", async () => {
    const { instance, registro } = await instanciar("s2c-session-in-use");
    const resultado = await instance.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao().sinks);
    expect(resultado.desfecho).toBe("interrompido");
    expect(resultado.motivoInterrupcao).toBe("sessao_rejeitada");
    expect(resultado.sinais.rejected).toBe(true);
    expect(resultado.sinais.producedOutput).toBe(false);
    const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
    await expect(stat(dirname(r.mcp!.caminho))).rejects.toThrow(/ENOENT/);
  });

  it("s4b: negação de permissão NÃO é erro: sucesso com negacoesPermissao = ['mcp__nod__somar']", async () => {
    const { instance } = await instanciar("s4b-negado");
    const resultado = await instance.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao().sinks);
    expect(resultado.desfecho).toBe("sucesso");
    expect(resultado.negacoesPermissao).toEqual(["mcp__nod__somar"]);
  });

  it("NOD-179: o turno entrega o uso do plano do rate_limit (duas janelas, renovação em ms); sem o evento, o campo fica ausente", async () => {
    const antes = Date.now();
    const { instance } = await instanciar("s3-mcp-ok");
    const comEvento = await instance.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao().sinks);
    expect(comEvento.usoDoPlano).toMatchObject({
      harness: "claude-cli",
      situacao: "normal",
      cincoHoras: { utilizacao: 0.1, renovaEm: 1789537800000 },
      semana: { utilizacao: 0.03, renovaEm: 1789747200000 },
    });
    expect(comEvento.usoDoPlano!.medidoEm).toBeGreaterThanOrEqual(antes);
    expect(comEvento.usoDoPlano!.medidoEm).toBeLessThanOrEqual(Date.now());

    const { instance: semRateLimit } = await instanciar("relatorio-lembrar");
    const semEvento = await semRateLimit.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao().sinks);
    expect(semEvento.desfecho).toBe("sucesso");
    expect("usoDoPlano" in semEvento).toBe(false);
  });

  it("relatório → lembrar → 'Anotado.': a fala leva o relatório e o final; o texto ao vivo sai só dos deltas, uma vez", async () => {
    const { instance } = await instanciar("relatorio-lembrar");
    const espiao = sinksEspiao();
    const resultado = await instance.adapter(planoDeTeste(dir)).rodarTurno(espiao.sinks);
    expect(resultado.desfecho).toBe("sucesso");
    expect(resultado.ferramentasChamadas).toEqual(["mcp__nod__lembrar"]);
    expect(resultado.texto.startsWith("Relatório das tasks da semana:")).toBe(true);
    expect(resultado.texto.endsWith("NOD-101 hoje.\n\nAnotado.")).toBe(true);
    // 3 deltas do relatório + 1 de "Anotado.": o bloco completo não vira delta de novo
    expect(espiao.deltas).toHaveLength(4);
    expect(espiao.deltas.join("")).toBe(`${resultado.texto.replace("\n\nAnotado.", "")}Anotado.`);
    expect(espiao.eventos.filter((e) => e.tipo === "texto_bloco")).toHaveLength(2);
  });

  it("NOD-73: 20 chamadas iguais do CLI real avisam a repetição em 5, 10 e 20, sem argumento, e o turno termina em sucesso", async () => {
    const { instance } = await instanciar("repeticao");
    const vigia = criarVigiaTurno(0);
    const avisos: VigiaVivo[] = [];
    const espiao = sinksEspiao();
    const evento = espiao.sinks.evento;
    espiao.sinks.evento = (e) => { evento(e); const a = vigia.registrar(e, 0); if (a) avisos.push(a); };
    const resultado = await instance.adapter(planoDeTeste(dir)).rodarTurno(espiao.sinks);
    expect(resultado.desfecho).toBe("sucesso");
    expect(avisos.map((a) => a.repeticao)).toEqual([5, 10, 20].map((vezes) => ({ nome: "mcp__nod__somar", vezes })));
    expect(JSON.stringify(avisos)).not.toContain("17");
  });

  it("binário que não existe → ErroDeDominio executor_indisponivel (motor_ausente) antes de qualquer spawn", async () => {
    const instance = await criarClaudeCliDriver(lig).create({ ...cfgBase, bin: "/nao/existe/claude" });
    const espiao = sinksEspiao();
    await expect(instance.adapter(planoDeTeste(dir)).rodarTurno(espiao.sinks)).rejects.toMatchObject({ codigo: "executor_indisponivel", cause: "motor_ausente" });
    expect(espiao.sinais).toEqual(["attempted"]);
  });

  it("sondar() da instância contra o binário falso: pronto 2.1.290 (stream-json, init.apiKeySource none)", async () => {
    const { instance } = await instanciar("s3-mcp-ok");
    const inv = await instance.sondar();
    expect(inv).toMatchObject({ estado: "pronto", versao: "2.1.290" });
  });
  it("descoberta automática verifica login sem submeter um prompt", async () => {
    const { instance, registro, stdin } = await instanciarCom(criarClaudeCliDriver({ ...lig, sondaSemTurno: true }), "s3-mcp-ok");
    expect(await instance.sondar()).toMatchObject({ estado: "pronto", versao: "2.1.290" });
    expect((JSON.parse(await readFile(registro, "utf8")) as Registro).argv).toEqual(["auth", "status"]);
    await expect(stat(stdin)).rejects.toMatchObject({ code: "ENOENT" });
  });

  describe("NOD-171: piso de versão do Claude Code (PISO_CLI)", () => {
    const ANTIGO = { NOD_FALSO_VERSAO: "2.1.289" };
    const CLI_ANTIGO = { estado: "ausente", causa: "cli_antigo", versao: "2.1.289", minima: "2.1.290", motivo: "O Claude Code deste Mac (2.1.289) é mais antigo que o testado pelo nod. Atualize para a versão 2.1.290 ou mais nova." };
    it("sonda completa abaixo do piso: 'ausente' com cli_antigo e as duas versões, sem gastar o turno de sonda", async () => {
      const { instance, registro } = await instanciar("s3-mcp-ok", {}, ANTIGO);
      expect(await instance.sondar()).toMatchObject(CLI_ANTIGO);
      // A última chamada ao CLI foi a leitura da versão: nenhum turno (-p) nem login.
      expect((JSON.parse(await readFile(registro, "utf8")) as Registro).argv).toEqual(["--version"]);
    });
    it("descoberta sem turno abaixo do piso: o mesmo 'ausente', sem perguntar o login", async () => {
      const { instance, registro } = await instanciarCom(criarClaudeCliDriver({ ...lig, sondaSemTurno: true }), "s3-mcp-ok", ANTIGO);
      expect(await instance.sondar()).toMatchObject(CLI_ANTIGO);
      expect((JSON.parse(await readFile(registro, "utf8")) as Registro).argv).not.toContain("auth");
    });
    it("turno abaixo do piso: executor_indisponivel com a causa cli_antigo, antes de qualquer prompt", async () => {
      const { instance, stdin } = await instanciar("s3-mcp-ok", {}, ANTIGO);
      const espiao = sinksEspiao();
      await expect(instance.adapter(planoDeTeste(dir)).rodarTurno(espiao.sinks)).rejects.toMatchObject({ codigo: "executor_indisponivel", cause: "cli_antigo" });
      expect(espiao.sinais).toEqual(["attempted"]);
      await expect(stat(stdin)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  describe("NOD-9: o portão da atualização e a versão que o modelo pede", () => {
    const apelidos = VERSAO_MINIMA_POR_APELIDO["claude-cli"] as Record<string, string>;
    beforeAll(() => { apelidos["teste-nod9"] = "2.1.999"; });
    afterAll(() => { delete apelidos["teste-nod9"]; });

    /**
     * Um `claude` que a "atualização" troca: a versão sai de um arquivo (o teste o reescreve como o npm reescreveria o
     * binário) e cada `--version` fica num log — é ele que mostra quantas vezes o driver releu.
     */
    async function cliQueAtualiza(versao: string, ligacao: Parameters<typeof criarClaudeCliDriver>[0]) {
      const id = Math.random().toString(36).slice(2, 8);
      const sessoes = join(dir, `sessoes-nod9-${id}`);
      const base = await shim(dir, `claude-nod9-base-${id}`, { NOD_FALSO_CENARIO: "s3-mcp-ok", NOD_FALSO_SESSOES: sessoes });
      const arqVersao = join(dir, `versao-${id}`);
      const log = join(dir, `versoes-lidas-${id}`);
      await writeFile(arqVersao, versao);
      await writeFile(log, "");
      const bin = join(dir, `claude-nod9-${id}`);
      await writeFile(bin, `#!/bin/sh\ncase " $* " in *" --version "*) echo v >> ${JSON.stringify(log)};; esac\nNOD_FALSO_VERSAO="$(cat ${JSON.stringify(arqVersao)})" exec ${JSON.stringify(base)} "$@"\n`);
      await chmod(bin, 0o755);
      const instance = await criarClaudeCliDriver(ligacao).create({ ...cfgBase, bin, env: { ...cfgBase.env } });
      return {
        instance,
        atualizarPara: (v: string) => writeFile(arqVersao, v),
        leituras: async () => (await readFile(log, "utf8")).split("\n").filter(Boolean).length,
      };
    }

    it("portão livre (false): o turno segue com a versão que já tinha, sem reler", async () => {
      let portoes = 0;
      const cli = await cliQueAtualiza("2.1.290", { ...lig, aguardarAtualizacao: async () => { portoes++; return false; } });
      expect((await cli.instance.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao().sinks)).desfecho).toBe("sucesso");
      expect((await cli.instance.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao().sinks)).desfecho).toBe("sucesso");
      expect(portoes).toBe(2);
      expect(await cli.leituras()).toBe(1);
    });

    it("dois turnos saem juntos do portão depois de uma atualização: uma releitura só, e nenhum vê o estado pela metade", async () => {
      let atualizou = false;
      const cli = await cliQueAtualiza("2.1.290", { ...lig, aguardarAtualizacao: async () => atualizou });
      expect((await cli.instance.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao().sinks)).desfecho).toBe("sucesso");
      expect(await cli.leituras()).toBe(1);
      await cli.atualizarPara("2.1.300");
      atualizou = true;
      const [r1, r2] = await Promise.all([
        cli.instance.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao().sinks),
        cli.instance.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao().sinks),
      ]);
      expect([r1.desfecho, r2.desfecho]).toEqual(["sucesso", "sucesso"]);
      expect(await cli.leituras()).toBe(2);
      // O turno seguinte, com o portão livre, usa o retrato novo sem reler.
      atualizou = false;
      expect((await cli.instance.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao().sinks)).desfecho).toBe("sucesso");
      expect(await cli.leituras()).toBe(2);
    });

    it("modelo acima da versão instalada: pede a atualização e, sem ela (false), recusa com modelo_requer_cli antes do prompt", async () => {
      const pedidos: string[] = [];
      const cli = await cliQueAtualiza("2.1.290", { ...lig, aoPrecisarDeVersao: async (m) => { pedidos.push(m); return false; }, aguardarAtualizacao: async () => false });
      const espiao = sinksEspiao();
      await expect(cli.instance.adapter(planoDeTeste(dir, { modelo: "teste-nod9" })).rodarTurno(espiao.sinks)).rejects.toMatchObject({ codigo: "executor_indisponivel", cause: "modelo_requer_cli" });
      expect(pedidos).toEqual(["2.1.999"]);
      expect(await cli.leituras()).toBe(1);
    });

    it("modelo acima da versão instalada: o turno espera a atualização de verdade, relê e roda", async () => {
      let cliRef: Awaited<ReturnType<typeof cliQueAtualiza>> | null = null;
      const cli = await cliQueAtualiza("2.1.290", {
        ...lig,
        aguardarAtualizacao: async () => false,
        aoPrecisarDeVersao: async (m) => {
          // A atualização demora: o turno só segue depois que ela acaba.
          await new Promise((r) => setTimeout(r, 50));
          await cliRef?.atualizarPara(m);
          return true;
        },
      });
      cliRef = cli;
      const r = await cli.instance.adapter(planoDeTeste(dir, { modelo: "teste-nod9" })).rodarTurno(sinksEspiao().sinks);
      expect(r.desfecho).toBe("sucesso");
      expect(await cli.leituras()).toBe(2);
    });

    it("sem o gancho (servidor, VM antiga), o modelo segue como antes", async () => {
      const { instance } = await instanciar("s3-mcp-ok");
      const r = await instance.adapter(planoDeTeste(dir, { modelo: "teste-nod9" })).rodarTurno(sinksEspiao().sinks);
      expect(r.desfecho).toBe("sucesso");
    });

    describe("fable (2.1.289) com o piso rebaixado — hoje o piso 2.1.290 já cobre o fable, então a regra só vale com um piso abaixo", () => {
      const pisos = PISO_CLI as Record<string, string>;
      let pisoReal = "";
      beforeAll(() => { pisoReal = pisos["claude-cli"] ?? ""; pisos["claude-cli"] = "2.1.270"; });
      afterAll(() => { pisos["claude-cli"] = pisoReal; });

      it("fable no 2.1.280 sem atualização: recusa com modelo_requer_cli", async () => {
        const pedidos: string[] = [];
        const cli = await cliQueAtualiza("2.1.280", { ...lig, aguardarAtualizacao: async () => false, aoPrecisarDeVersao: async (m) => { pedidos.push(m); return false; } });
        await expect(cli.instance.adapter(planoDeTeste(dir, { modelo: "fable" })).rodarTurno(sinksEspiao().sinks)).rejects.toMatchObject({ cause: "modelo_requer_cli" });
        expect(pedidos).toEqual(["2.1.289"]);
      });

      it("fable no 2.1.289: roda sem pedir nada", async () => {
        const pedidos: string[] = [];
        const cli = await cliQueAtualiza("2.1.289", { ...lig, aguardarAtualizacao: async () => false, aoPrecisarDeVersao: async (m) => { pedidos.push(m); return false; } });
        expect((await cli.instance.adapter(planoDeTeste(dir, { modelo: "fable" })).rodarTurno(sinksEspiao().sinks)).desfecho).toBe("sucesso");
        expect(pedidos).toEqual([]);
      });

      it("fable no 2.1.280 com a atualização para o 2.1.289: espera, relê e roda", async () => {
        let cliRef: Awaited<ReturnType<typeof cliQueAtualiza>> | null = null;
        const cli = await cliQueAtualiza("2.1.280", { ...lig, aguardarAtualizacao: async () => false, aoPrecisarDeVersao: async (m) => { await cliRef?.atualizarPara(m); return true; } });
        cliRef = cli;
        expect((await cli.instance.adapter(planoDeTeste(dir, { modelo: "fable" })).rodarTurno(sinksEspiao().sinks)).desfecho).toBe("sucesso");
      });
    });
  });

  // QA do PR #721 (NOD-480): o driver leva o orçamento do plano ao processo de verdade — env (busca forçada, teto do Read)
  // e `bashOutputMaxChars` nos settings do kit do terminal. Os testes de montarEnvDoFilho/settingsDoTerminal não pegavam
  // um driver que esquecesse de repassar o orçamento.
  describe("NOD-480: o orçamento da janela chega ao CLI", () => {
    const comTerminal = (orcamento?: PlanoTurno["orcamento"]): PlanoTurno => ({ ...planoDeTeste(dir), nativas: ["Read", "Bash"], pastaDoBot: "atlas", ...(orcamento ? { orcamento } : {}) });
    const rodar = async (plano: PlanoTurno) => {
      const driver = criarClaudeCliDriver({ ...lig, hookPath: "/app/hook-nativas.mjs", filaDoForno: false });
      const { instance, registro } = await instanciarCom(driver, "s3-mcp-ok", { NOD_FALSO_HELP: "--output-format --restricted --settings" });
      expect((await instance.adapter(plano).rodarTurno(sinksEspiao().sinks)).desfecho).toBe("sucesso");
      const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
      return { env: r.env, settings: JSON.parse(valor(r.argv, "--settings") ?? "{}") as Record<string, unknown> };
    };
    it("janela pequena: ENABLE_TOOL_SEARCH, teto do Read no env e bashOutputMaxChars nos settings", async () => {
      const { env, settings } = await rodar(comTerminal({ janela: 200_000, limiar: 144_000, parteFixa: 120_000, enxuto: true, resultadoChars: 20_160, saidaBashChars: 20_160, leituraTokens: 5_760 }));
      expect(env.ENABLE_TOOL_SEARCH).toBe("true");
      expect(env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS).toBe("5760");
      expect(settings.bashOutputMaxChars).toBe(20_160);
      expect(settings).toHaveProperty("hooks");
    });
    it("1M ou sem orçamento: nada disso", async () => {
      for (const plano of [comTerminal({ janela: 1_000_000, limiar: 784_000, parteFixa: 120_000, enxuto: false, resultadoChars: 75_000 }), comTerminal()]) {
        const { env, settings } = await rodar(plano);
        expect(env.ENABLE_TOOL_SEARCH).toBeUndefined();
        expect(env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS).toBeUndefined();
        expect(settings).toHaveProperty("hooks");
        expect(settings).not.toHaveProperty("bashOutputMaxChars");
      }
    });
  });

  describe("NOD-183 (ADR-080): prompt de texto em --system-prompt com o marcador", () => {
    const MARCADOR = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";
    const comPartes = () => ({ ...planoDeTeste(dir), promptSistema: "Você é a sonda do nod.\nQuem pediu: Ana.", promptSistemaPartes: { estavel: "Você é a sonda do nod.", volatil: "Quem pediu: Ana." } });
    it("com --system-prompt no help da versão sondada: estável e marcador no sistema, volátil no stdin do turno (NOD-188)", async () => {
      const { instance, registro, stdin } = await instanciar("s3-mcp-ok", {}, { NOD_FALSO_HELP: "--output-format --system-prompt" });
      const plano = comPartes();
      expect((await instance.adapter(plano).rodarTurno(sinksEspiao().sinks)).desfecho).toBe("sucesso");
      const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
      expect(valor(r.argv, "--system-prompt")).toBe(`Você é a sonda do nod.\n${MARCADOR}\n`);
      expect(r.argv).not.toContain("--append-system-prompt");
      expect(r.argv.join("\n")).not.toContain("Quem pediu: Ana.");
      expect(await readFile(stdin, "utf8")).toBe(`${ABRE_CONTEXTO_DO_TURNO}\nQuem pediu: Ana.\n${FECHA_CONTEXTO_DO_TURNO}\n\n${plano.entrada.texto}`);
    });
    it("sem a flag no help: o append de antes, com o prompt inteiro e sem marcador", async () => {
      const { instance, registro, stdin } = await instanciar("s3-mcp-ok", {}, { NOD_FALSO_HELP: "--output-format" });
      const plano = comPartes();
      expect((await instance.adapter(plano).rodarTurno(sinksEspiao().sinks)).desfecho).toBe("sucesso");
      const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
      expect(valor(r.argv, "--append-system-prompt")).toBe("Você é a sonda do nod.\nQuem pediu: Ana.");
      expect(r.argv).not.toContain("--system-prompt");
      expect(r.argv.join("\n")).not.toContain(MARCADOR);
      expect(await readFile(stdin, "utf8")).toBe(plano.entrada.texto);
    });
    it("plano pede o terminal e a máquina não tem o hook: o aviso vai com a volátil no turno, com o sistema intacto", async () => {
      const { instance, registro, stdin } = await instanciar("s3-mcp-ok", {}, { NOD_FALSO_HELP: "--output-format --system-prompt" });
      const plano = { ...comPartes(), nativas: ["Read", "Bash"] };
      expect((await instance.adapter(plano).rodarTurno(sinksEspiao().sinks)).desfecho).toBe("sucesso");
      const prompt = valor((JSON.parse(await readFile(registro, "utf8")) as Registro).argv, "--system-prompt")!;
      expect(prompt).toBe(`Você é a sonda do nod.\n${MARCADOR}\n`);
      expect(await readFile(stdin, "utf8")).toContain(`Quem pediu: Ana.\n${AVISO_SEM_TERMINAL}\n${FECHA_CONTEXTO_DO_TURNO}`);
    });

    // NOD-185: o CLI falso imita o snapshot (on: o --resume reusa o prompt gravado no 1º turno; off: vale o do launch).
    describe("NOD-185: --system-prompt-snapshot off no --resume", () => {
      const comVolatil = (volatil: string, sessaoCli?: string | null) => {
        const base = planoDeTeste(dir, sessaoCli ? { sessaoCli } : {});
        return { ...base, promptSistema: `Você é a sonda do nod.\n${volatil}`, promptSistemaPartes: { estavel: "Você é a sonda do nod.", volatil } };
      };
      const doisTurnos = async (help: string) => {
        const { instance, registro, sessoes } = await instanciar("s3-mcp-ok", {}, { NOD_FALSO_HELP: help });
        const primeiro = await instance.adapter(comVolatil("A palavra do dia é laranja.")).rodarTurno(sinksEspiao().sinks);
        const r1 = JSON.parse(await readFile(registro, "utf8")) as Registro;
        const segundo = await instance.adapter(comVolatil("A palavra do dia é azul.", primeiro.sessaoCli)).rodarTurno(sinksEspiao().sinks);
        expect(segundo.desfecho).toBe("sucesso");
        const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
        expect(valor(r.argv, "--resume")).toBe(primeiro.sessaoCli);
        // O falso só grava o snapshot (<sessão>.prompt) num launch sem `off`: diz se o 1º turno também foi com `off`.
        const gravouSnapshot = existsSync(join(sessoes, `${primeiro.sessaoCli}.prompt`));
        return { r1, r, gravouSnapshot, visto: await readFile(join(sessoes, `${primeiro.sessaoCli}.efetivo`), "utf8") };
      };

      it("com a flag no help: off no 1º turno (nada gravado) e no --resume, com o mesmo sistema nos dois turnos", async () => {
        const { r1, r, gravouSnapshot, visto } = await doisTurnos("--output-format --system-prompt --system-prompt-snapshot");
        expect(visto).toBe(`Você é a sonda do nod.\n${MARCADOR}\n`);
        expect(gravouSnapshot).toBe(false);
        expect(valor(r.argv, "--system-prompt-snapshot")).toBe("off");
        expect(valor(r.argv, "--system-prompt")).toBe(valor(r1.argv, "--system-prompt"));
      });

      it("sem a flag no help: os args de antes, e o --resume segue com o sistema gravado no 1º turno", async () => {
        const { r, gravouSnapshot, visto } = await doisTurnos("--output-format --system-prompt");
        expect(visto).toBe(`Você é a sonda do nod.\n${MARCADOR}\n`);
        expect(gravouSnapshot).toBe(true);
        expect(r.argv).not.toContain("--system-prompt-snapshot");
      });
    });

    // NOD-188: no --resume com histórico longo, o que mudava entre turnos (volátil no sistema e cwd) quebrava o cache do histórico.
    describe("NOD-188: volátil na mensagem do turno e cwd estável no --resume", () => {
      const comVolatil = (volatil: string, sessaoCli?: string | null) => {
        const base = planoDeTeste(dir, sessaoCli ? { sessaoCli } : {});
        return { ...base, promptSistema: `Você é a sonda do nod.\n${volatil}`, promptSistemaPartes: { estavel: "Você é a sonda do nod.", volatil } };
      };
      for (const help of ["--output-format --system-prompt --system-prompt-snapshot", "--output-format --system-prompt"]) {
        it(`o turno retomado recebe a volátil nova no stdin, com o mesmo sistema e o mesmo cwd (help: ${help})`, async () => {
          const { instance, registro, stdin } = await instanciar("s3-mcp-ok", {}, { NOD_FALSO_HELP: help });
          const primeiro = await instance.adapter(comVolatil("A palavra do dia é laranja.")).rodarTurno(sinksEspiao().sinks);
          const r1 = JSON.parse(await readFile(registro, "utf8")) as Registro;
          const stdin1 = await readFile(stdin, "utf8");
          const plano2 = comVolatil("A palavra do dia é azul.", primeiro.sessaoCli);
          expect((await instance.adapter(plano2).rodarTurno(sinksEspiao().sinks)).desfecho).toBe("sucesso");
          const r2 = JSON.parse(await readFile(registro, "utf8")) as Registro;
          expect(valor(r2.argv, "--resume")).toBe(primeiro.sessaoCli);
          expect(stdin1).toContain("laranja");
          const stdin2 = (await readFile(stdin, "utf8")).slice(stdin1.length);
          expect(stdin2).toBe(`${ABRE_CONTEXTO_DO_TURNO}\nA palavra do dia é azul.\n${FECHA_CONTEXTO_DO_TURNO}\n\n${plano2.entrada.texto}`);
          expect(valor(r2.argv, "--system-prompt")).toBe(valor(r1.argv, "--system-prompt"));
          expect(r2.argv.join("\n")).not.toMatch(/laranja|azul/);
          expect(r2.cwd).toBe(r1.cwd);
          expect(basename(r2.cwd)).toBe(`texto-${plano2.agenteId}`);
          // O tmpdir do turno (mcp.json, config do hook) continua sendo por turno.
          expect(dirname(r2.mcp!.caminho)).not.toBe(dirname(r1.mcp!.caminho));
        });
      }

      it("mensagem com '/' (skill): o texto vai intacto no stdin e a volátil fica no --system-prompt desse turno", async () => {
        const { instance, registro, stdin } = await instanciar("s3-mcp-ok", {}, { NOD_FALSO_HELP: "--output-format --system-prompt --system-prompt-snapshot" });
        const base = comVolatil("A palavra do dia é azul.");
        const plano = { ...base, entrada: { ...base.entrada, texto: "/review 420" } };
        expect((await instance.adapter(plano).rodarTurno(sinksEspiao().sinks)).desfecho).toBe("sucesso");
        const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
        expect(await readFile(stdin, "utf8")).toBe("/review 420");
        expect(valor(r.argv, "--system-prompt")).toBe(`Você é a sonda do nod.\n${MARCADOR}\nA palavra do dia é azul.`);
      });

      it("dois bots ao mesmo tempo: cada um no seu cwd estável; o tmpdir de config é de cada turno e some no fim", async () => {
        const [x, y] = await Promise.all([instanciar("s3-mcp-ok", {}, { NOD_FALSO_HELP: "--output-format --system-prompt" }), instanciar("s3-mcp-ok", {}, { NOD_FALSO_HELP: "--output-format --system-prompt" })]);
        const [rx, ry] = await Promise.all([
          x.instance.adapter({ ...comVolatil("Quem pediu: Ana."), agenteId: "bot-x" }).rodarTurno(sinksEspiao().sinks),
          y.instance.adapter({ ...comVolatil("Quem pediu: Bia."), agenteId: "bot-y" }).rodarTurno(sinksEspiao().sinks),
        ]);
        expect([rx.desfecho, ry.desfecho]).toEqual(["sucesso", "sucesso"]);
        const [regX, regY] = [JSON.parse(await readFile(x.registro, "utf8")) as Registro, JSON.parse(await readFile(y.registro, "utf8")) as Registro];
        expect([basename(regX.cwd), basename(regY.cwd)]).toEqual(["texto-bot-x", "texto-bot-y"]);
        expect(dirname(regX.cwd)).toBe(dirname(regY.cwd));
        for (const r of [regX, regY]) await expect(stat(dirname(r.mcp!.caminho))).rejects.toThrow(/ENOENT/);
        expect((await stat(regX.cwd)).isDirectory()).toBe(true);
      });

      it("QA: o cwd estável não pode ser criado (um arquivo no lugar) → o turno falha e o tmpdir de config não fica para trás", async () => {
        const cwdBase = await mkdtemp(join(dir, "base-qa-"));
        await writeFile(join(cwdBase, "texto-bot-bloqueado"), "não é pasta");
        const bin = await shim(dir, `claude-qa-${Math.random().toString(36).slice(2, 6)}`, { NOD_FALSO_CENARIO: "s3-mcp-ok", NOD_FALSO_SESSOES: join(dir, "sessoes-qa"), NOD_FALSO_HELP: "--output-format --system-prompt" });
        const instance = await criarClaudeCliDriver(lig).create({ ...cfgBase, bin, cwdBase });
        await expect(instance.adapter({ ...comVolatil("Quem pediu: Ana."), agenteId: "bot-bloqueado" }).rodarTurno(sinksEspiao().sinks)).rejects.toThrow(/EEXIST|ENOTDIR/);
        expect((await readdir(cwdBase)).filter((n) => n.startsWith("turno-"))).toEqual([]);
      });
    });
  });

  describe("sessão viva (ADR-067)", () => {
    const HELP = { NOD_FALSO_HELP: "--input-format --output-format" };

    it("comando em segundo plano segura a sessão; a volta sozinha e a mensagem nova viram falas; fecha quando nada mais roda", async () => {
      const { instance, registro, stdin } = await instanciar("sessao-viva", {}, HELP);
      const adapter = instance.adapter(planoDeTeste(dir));
      const falas: string[] = [];
      let ociosos = 0;
      const espiao = sinksEspiao({});
      const resultado = await adapter.rodarTurno({
        ...espiao.sinks,
        falaIntermediaria: (t) => falas.push(t),
        // 1ª vez que fica ocioso (depois da volta sozinha): a pessoa mandou mensagem. 2ª: nada — pode fechar.
        async ocioso() {
          ociosos += 1;
          if (ociosos === 1) return adapter.receberMensagem!("quanto é 2+2?");
          return false;
        },
      });

      // revisto em 2026-10-07 (ADR-083 §6): a resposta à mensagem nova é a primeira fala depois dela — sai na hora.
      expect(falas).toEqual(["Disparei os testes.", "Testes verdes.", "Recebi: quanto é 2+2?"]);
      expect(ociosos).toBe(2);
      expect(resultado.desfecho).toBe("sucesso");
      // As voltas anteriores e a resposta do meio já saíram como fala: a entrega não as repete.
      expect(resultado.texto).toBe("");
      // total_cost_usd é acumulado (vale o último); usage é por volta (soma).
      expect(resultado.custoUsd).toBe(0.03);
      expect(resultado.tokens).toEqual({ entrada: 3, saida: 6, cacheLeitura: 30, cacheCriacao: 0 });
      expect(adapter.aceitaMensagens!()).toBe(false);
      expect(adapter.receberMensagem!("tarde demais")).toBe(false);

      const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
      expect(valor(r.argv, "--input-format")).toBe("stream-json");
      // Sem teto de comando: o Bash do CLI espera o comando acabar (medido no 2.1.286).
      expect(r.env.BASH_DEFAULT_TIMEOUT_MS).toBe("2147483647");
      expect(r.env.BASH_MAX_TIMEOUT_MS).toBe("2147483647");
      const entradas = (await readFile(stdin, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { type: string; message: { content: { type: string; text: string }[] } });
      expect(entradas.map((e) => e.message.content[0]?.text)).toEqual([expect.stringContaining("Some 17 e 25"), "quanto é 2+2?"]);
    });

    it("NOD-350: dois subagentes em segundo plano seguram a sessão; um conclui, outro falha, e a task termina", async () => {
      const { instance } = await instanciar("subagentes-fundo", {}, HELP);
      const adapter = instance.adapter(planoDeTeste(dir));
      const falas: string[] = [];
      const espiao = sinksEspiao({});
      const publicadas: SubagenteVivo[][] = [];
      const ociosos: boolean[] = [];
      const acompanhante = criarAcompanhanteDeSubagentes((_t, l, ocioso) => { publicadas.push(l); ociosos.push(ocioso); }, { intervaloMs: 0 });
      const resultado = await adapter.rodarTurno({
        ...espiao.sinks,
        evento: (e) => {
          espiao.eventos.push(e);
          acompanhante.evento("t", e);
        },
        falaIntermediaria: (t) => falas.push(t),
        ocioso: async () => false,
      });

      expect(resultado.desfecho).toBe("sucesso");
      // As ferramentas dos subagentes (com parent_tool_use_id) não viram ferramenta do bot: só o Agent do principal.
      expect(espiao.eventos.filter((e) => e.tipo === "tool_use").map((e) => (e as { nome: string }).nome)).toEqual(["Agent", "Agent"]);
      // Durante: os dois apareceram trabalhando e com progresso (chamadas > 0).
      expect(publicadas.some((l) => l.length === 2 && l.every((s) => s.estado === "trabalhando"))).toBe(true);
      expect(publicadas.some((l) => l.some((s) => s.estado === "trabalhando" && s.chamadas > 0))).toBe(true);
      // Fim: um concluído, outro com falha, e ninguém mais trabalhando.
      const final = publicadas.at(-1)!;
      expect(final.map((s) => s.estado).sort()).toEqual(["concluido", "falhou"]);
      expect(final.map((s) => s.descricao)).toContain("Contar linhas do um.txt");
      // As voltas do principal viraram fala ou entrega; o texto dos subagentes ("Os dois comandos rodaram…", "A leitura mostrou…") nunca.
      // A última volta é a entrega do turno.
      expect(falas).toEqual(["lancei", "Um dos agentes já terminou; aguardando o segundo."]);
      expect(resultado.texto).toMatch(/^O `um\.txt` tem 3 linhas/);
      expect([...falas, resultado.texto].join("\n")).not.toMatch(/Os dois comandos rodaram|A leitura mostrou/);
      // A volta do principal acabou com eles rodando: o acompanhante avisou a tela (sem depender de fala).
      expect(ociosos.some((o) => o)).toBe(true);
    });

    it("sem o laço da sessão (sinks antigos): fecha na primeira volta sem nada em segundo plano, como antes", async () => {
      const { instance } = await instanciar("sessao-viva", {}, { ...HELP, NOD_FALSO_FUNDO_MS: "50" });
      const resultado = await instance.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao({}).sinks);
      // Sem falaIntermediaria, as voltas vão juntas na entrega; sem ocioso, fecha assim que nada roda.
      expect(resultado.desfecho).toBe("sucesso");
      expect(resultado.texto).toBe("Disparei os testes.\n\nTestes verdes.");
    });

    it("NOD-402: no turno dos bastidores (rotina) nenhuma volta vira fala do meio — vão juntas na entrega, que o sem_novidade cala", async () => {
      const { instance } = await instanciar("sessao-viva", {}, { ...HELP, NOD_FALSO_FUNDO_MS: "50" });
      const falas: string[] = [];
      const resultado = await instance.adapter({ ...planoDeTeste(dir), bastidores: true }).rodarTurno({ ...sinksEspiao({}).sinks, falaIntermediaria: (t) => falas.push(t), ocioso: async () => false });
      expect(resultado.desfecho).toBe("sucesso");
      expect(falas).toEqual([]);
      expect(resultado.texto).toBe("Disparei os testes.\n\nTestes verdes.");
    });

    it("comando da barra (/uso, /contexto) segue de uma vez só, pelo texto, mesmo com --input-format", async () => {
      const { instance, registro, stdin } = await instanciar("s3-mcp-ok", {}, HELP);
      await instance.adapter(planoDeTeste(dir, { texto: "/cost" })).rodarTurno(sinksEspiao({}).sinks);
      expect(valor((JSON.parse(await readFile(registro, "utf8")) as Registro).argv, "--input-format")).toBeNull();
      expect(await readFile(stdin, "utf8")).toBe("/cost");
    });

    it("Parar no meio: SIGTERM com a sessão aberta sai interrompido, com a fala que já tinha saído fora da entrega", async () => {
      const { instance } = await instanciar("sessao-viva", {}, { ...HELP, NOD_FALSO_FUNDO_MS: "60000" });
      const adapter = instance.adapter(planoDeTeste(dir));
      const falas: string[] = [];
      // NOD-198: espera a primeira fala (evento), não 10 s de relógio: sob carga (load 274, 2× integration) a fala
      // chegou depois dos 10 s e o teste falhou com `expected []`. Quem corta um falso travado é o prazo do teste.
      let falou!: () => void;
      const primeiraFala = new Promise<void>((r) => { falou = r; });
      const rodando = adapter.rodarTurno({ ...sinksEspiao({}).sinks, falaIntermediaria: (t) => { falas.push(t); falou(); }, ocioso: async () => false });
      await Promise.race([primeiraFala, rodando]);
      expect(falas).toEqual(["Disparei os testes."]);
      await adapter.interromper();
      const resultado = await rodando;
      // O comando em segundo plano não terminou: o turno foi cortado, não concluído. A volta já falada não entra de novo.
      expect(resultado.desfecho).toBe("interrompido");
      expect(resultado.texto).toBe("");
      expect(resultado.custoUsd).toBe(0.01);
    });
  });

  describe("mensagem no meio (ADR-083 §6, #189)", () => {
    const HELP = { NOD_FALSO_HELP: "--input-format --output-format" };

    it("a resposta curta à mensagem do meio, antes de outra ferramenta, vira fala na hora e não se repete na entrega", async () => {
      const { instance, stdin } = await instanciar("mensagem-no-meio", {}, HELP);
      const adapter = instance.adapter(planoDeTeste(dir));
      const falas: string[] = [];
      let mandou = false;
      const espiao = sinksEspiao({});
      const resultado = await adapter.rodarTurno({
        ...espiao.sinks,
        evento: (e) => {
          espiao.sinks.evento(e);
          if (e.tipo === "tool_use" && e.nome === "mcp__nod__consultar" && !mandou) mandou = adapter.receberMensagem!(molduraMensagemNoMeio("qual é o prazo?"));
        },
        falaIntermediaria: (t) => falas.push(t),
        ocioso: async () => false,
      });
      expect(mandou).toBe(true);
      // Antes desta emenda a resposta (< 280 caracteres, antes do `lembrar`) era narração e sumia.
      expect(falas).toHaveLength(1);
      expect(falas[0]).toMatch(/^Recebi: A pessoa escreveu enquanto você trabalhava: «qual é o prazo\?»/);
      expect(resultado).toMatchObject({ desfecho: "sucesso", texto: "Revisei as três." });
      const entradas = (await readFile(stdin, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { message: { content: { text: string }[] } });
      expect(entradas[1]!.message.content[0]!.text).toBe(molduraMensagemNoMeio("qual é o prazo?"));
    });

    it("X1: a mensagem escrita enquanto a narração ainda sai — a narração não vira a resposta; a fala depois do tool_result, sim", async () => {
      const { instance } = await instanciar("mensagem-no-meio", {}, { ...HELP, NOD_FALSO_MEIO_CEDO: "1" });
      const adapter = instance.adapter(planoDeTeste(dir));
      const falas: string[] = [];
      const entraram: string[] = [];
      let mandou = false;
      const espiao = sinksEspiao({});
      const resultado = await adapter.rodarTurno({
        ...espiao.sinks,
        evento: (e) => {
          espiao.sinks.evento(e);
          if (e.tipo === "delta" && !mandou) mandou = adapter.receberMensagem!(molduraMensagemNoMeio("qual é o prazo?"), "m1");
        },
        falaIntermediaria: (t) => falas.push(t),
        // X2: o stdin aceitou a escrita: a mensagem entrou.
        mensagemEntrou: (id) => entraram.push(id),
        ocioso: async () => false,
      });
      expect(mandou).toBe(true);
      expect(entraram).toEqual(["m1"]);
      expect(falas).toHaveLength(1);
      expect(falas[0]).toMatch(/^Recebi: A pessoa escreveu enquanto você trabalhava: «qual é o prazo\?»/);
      expect(resultado).toMatchObject({ desfecho: "sucesso", texto: "Revisei as três." });
    });
  });

  describe("capacidades anunciadas (X9, revisão do épico #188)", () => {
    it("CLI sem --fork-session no help: bifurcaSessao sai false; com a flag e --input-format, a promessa inteira", async () => {
      const sem = await instanciar("s3-mcp-ok", {}, { NOD_FALSO_HELP: "--output-format --input-format" });
      expect(await sem.instance.capacidades!()).toMatchObject({ bifurcaSessao: false, mensagemNoMeio: true, retomaSessao: true, processoProprio: true });
      const com = await instanciar("s3-mcp-ok", {}, { NOD_FALSO_HELP: "--output-format --input-format --fork-session" });
      expect(await com.instance.capacidades!()).toEqual(capacidadesDe("claude-cli"));
      const semEntrada = await instanciar("s3-mcp-ok", {}, { NOD_FALSO_HELP: "--output-format --fork-session" });
      expect(await semEntrada.instance.capacidades!()).toMatchObject({ bifurcaSessao: true, mensagemNoMeio: false });
    });
  });

  describe("fork da sessão (#193, rede de 2 min)", () => {
    const SESSAO = "22222222-2222-4222-8222-222222222222";

    it("com bifurcar e a flag no help: --resume <sessão> --fork-session, e o resultado traz o id NOVO", async () => {
      const { instance, registro } = await instanciar("s3-mcp-ok", {}, { NOD_FALSO_HELP: "--output-format --fork-session" });
      const resultado = await instance.adapter(planoDeTeste(dir, { sessaoCli: SESSAO, bifurcar: true })).rodarTurno(sinksEspiao({}).sinks);
      const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
      expect(valor(r.argv, "--resume")).toBe(SESSAO);
      expect(r.argv).toContain("--fork-session");
      expect(r.argv).not.toContain("--session-id");
      expect(resultado.desfecho).toBe("sucesso");
      expect(resultado.sessaoCli).toMatch(/^[0-9a-f-]{36}$/);
      expect(resultado.sessaoCli).not.toBe(SESSAO);
    });

    it("sem bifurcar, o --resume continua a mesma sessão (sem --fork-session)", async () => {
      const { instance, registro } = await instanciar("s3-mcp-ok", {}, { NOD_FALSO_HELP: "--output-format --fork-session" });
      const resultado = await instance.adapter(planoDeTeste(dir, { sessaoCli: SESSAO })).rodarTurno(sinksEspiao({}).sinks);
      expect((JSON.parse(await readFile(registro, "utf8")) as Registro).argv).not.toContain("--fork-session");
      expect(resultado.sessaoCli).toBe(SESSAO);
    });

    it("CLI sem --fork-session no help: o turno é recusado antes de rodar, nunca continua a original em dois processos", async () => {
      const { instance, registro } = await instanciar("s3-mcp-ok", {}, { NOD_FALSO_HELP: "--output-format" });
      await expect(instance.adapter(planoDeTeste(dir, { sessaoCli: SESSAO, bifurcar: true })).rodarTurno(sinksEspiao({}).sinks)).rejects.toThrow("executor_indisponivel");
      // O shim grava também o --version/--help da sonda; nenhuma chamada levou o --resume.
      if (existsSync(registro)) expect((JSON.parse(await readFile(registro, "utf8")) as Registro).argv).not.toContain("--resume");
    });
  });
});
