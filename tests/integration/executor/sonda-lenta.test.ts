import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { criarClaudeCliDriver, FLAGS_DO_TURNO } from "../../../src/adapters/executor/drivers/claude-cli.ts";
import { criarCodexCliDriver, FLAGS_CODEX } from "../../../src/adapters/executor/drivers/codex-cli.ts";
import { lerFlagsDoHelp, lerVersao, sondar, sondarDetalhado } from "../../../src/adapters/executor/sonda.ts";
import type { ConfigDriver } from "../../../src/adapters/executor/spi.ts";

/**
 * NOD-178: o `--version`/`--help`/`auth status`/`login status` que estoura o prazo não é "não instalado". Os shims
 * são só de sh (sem subir node) e respondem na hora a tudo, menos ao passo do cenário, que vira `exec sleep` (o
 * processo morto pelo prazo é o próprio sleep, sem neto segurando o stdout). Enquanto o arquivo `lento` existir, o
 * passo demora; apagá-lo prova que a próxima sonda pergunta de novo.
 */
const FRASE_CLAUDE = "O Claude demorou para responder; o Mac está carregado. Tente de novo em instantes.";
const FRASE_CODEX = "O Codex demorou para responder; o Mac está carregado. Tente de novo em instantes.";
const MODELO = "claude-haiku-4-5-20251001";

/**
 * Prazo da sonda passado ao código. NOD-198: o relógio dos prazos é FALSO (`setTimeout` do vitest) e só anda quando o
 * shim avisa que chegou ao passo lento (`venceNoPassoLento`). Antes era relógio real: 15 s para os passos rápidos,
 * `sleep 60` no lento. medido em 2026-10-08 (load 914, 2× integration em paralelo): até um sh com `exit 2` passou de
 * 15 s e o arquivo falhou 5 e 3 testes, com o código certo; sem carga ele gastava ~190 s esperando prazos de verdade.
 * Agora passo rápido nunca vence o prazo, com qualquer carga, e o lento vence assim que chega lá.
 */
const PRAZO_MS = 15_000;

/** O `setTimeout` real, guardado antes do relógio falso, só para o laço de espera abaixo. */
const setTimeoutReal = globalThis.setTimeout;
const esperarReal = (ms: number) => new Promise<void>((r) => { setTimeoutReal(r, ms); });

/**
 * sh que demora no passo `quando` (padrão do `case`) enquanto `<sh>.lento` existir; o resto vai para `resto`. Ao
 * chegar no passo lento ele grava `<sh>.chegou` e dorme sem fim (`exec sleep 3600`, o processo morto pelo prazo é o
 * próprio sleep): quem acaba com ele é o prazo do código, avançado por `venceNoPassoLento`, não o fim do sleep.
 */
async function shimLento(dir: string, nome: string, quando: string, resto: string): Promise<string> {
  const sh = join(dir, nome);
  const lento = join(dir, `${nome}.lento`);
  await writeFile(lento, "");
  await writeFile(sh, `#!/bin/sh\ncase "$*" in\n  ${quando}) if [ -e ${JSON.stringify(lento)} ]; then : > ${JSON.stringify(`${sh}.chegou`)}; exec sleep 3600; fi;;\nesac\n${resto}\n`);
  await chmod(sh, 0o755);
  return sh;
}

/**
 * Espera `p` terminar; cada vez que o shim avisa que chegou ao passo lento, dispara os prazos pendentes (o da sonda
 * ou os 90 s da negociação do Codex). Passo rápido não tem aviso, então o prazo dele nunca anda.
 */
async function venceNoPassoLento<T>(sh: string, p: Promise<T>): Promise<T> {
  let acabou = false;
  const fim = p.finally(() => { acabou = true; });
  fim.catch(() => {});
  while (!acabou) {
    if (existsSync(`${sh}.chegou`)) {
      rmSync(`${sh}.chegou`);
      vi.runOnlyPendingTimers();
    }
    await esperarReal(20); // laço de espera do teste: olha o aviso do shim, não mede prazo nenhum
  }
  return fim;
}

const desligarLentidao = (sh: string) => rm(`${sh}.lento`, { force: true });

/** Claude logado: `--help` lista as flags do turno, para os pisos passarem. */
const CLAUDE_SH = `case "$*" in
  --version) echo "2.1.290 (Claude Code)";;
  --help) echo "${FLAGS_DO_TURNO.join(" ")}";;
  "auth status") echo '{"loggedIn":true}';;
esac
exit 0`;
/** Codex logado: a rodada de negociação (exec com o plano de prova) sai sem chave recusada. */
const CODEX_SH = `case "$*" in
  --version) echo "codex-cli teste";;
  "exec --help") echo "${FLAGS_CODEX.join(" ")}";;
esac
exit 0`;

describe("sonda lenta (NOD-178)", { timeout: 60_000 }, () => {
  let dir: string;
  let env: Record<string, string>;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nod-sonda-lenta-"));
    env = { HOME: dir, PATH: process.env.PATH ?? "" };
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
  afterEach(() => { vi.useRealTimers(); });

  describe("sonda pura", () => {
    it("--version que estoura o prazo → ausente com causa sonda_lenta e a frase pt-BR, nunca version_exit_null", async () => {
      const bin = await shimLento(dir, "claude-versao-lenta", "--version", CLAUDE_SH);
      expect(await venceNoPassoLento(bin, lerVersao(bin, env, PRAZO_MS))).toEqual({ erro: "sonda_lenta" });
      const s = await venceNoPassoLento(bin, sondarDetalhado(bin, env, MODELO, { relogio: () => 7, timeoutVersaoMs: PRAZO_MS }));
      expect(s.inventario).toEqual({ estado: "ausente", motivo: FRASE_CLAUDE, causa: "sonda_lenta", em: 7 });
      expect(s.binario).toBe(bin);
    });

    it("--help que estoura o prazo → ausente com causa sonda_lenta (não 'sem flags')", async () => {
      const bin = await shimLento(dir, "claude-help-lento", "--help", CLAUDE_SH);
      expect(await venceNoPassoLento(bin, lerFlagsDoHelp(bin, env, PRAZO_MS))).toEqual({ erro: "sonda_lenta" });
      expect(await venceNoPassoLento(bin, sondar(bin, env, MODELO, { relogio: () => 8, timeoutVersaoMs: PRAZO_MS }))).toEqual({ estado: "ausente", motivo: FRASE_CLAUDE, causa: "sonda_lenta", em: 8 });
    });

    it("regressão: binário inexistente e --version com exit≠0 sem estourar continuam com o motivo de hoje e sem causa", async () => {
      expect(await sondar("/nao/existe/claude", env, MODELO, { relogio: () => 1, timeoutVersaoMs: PRAZO_MS })).toEqual({ estado: "ausente", motivo: "binario_nao_encontrado", em: 1 });
      const quebrado = join(dir, "claude-quebrado");
      await writeFile(quebrado, "#!/bin/sh\nexit 2\n");
      await chmod(quebrado, 0o755);
      expect(await sondar(quebrado, env, MODELO, { relogio: () => 2, timeoutVersaoMs: PRAZO_MS })).toEqual({ estado: "ausente", motivo: "version_exit_2", em: 2 });
      expect(await lerFlagsDoHelp(quebrado, env, PRAZO_MS)).toEqual({ flags: null });
    });
  });

  describe("driver claude-cli (descoberta sem turno)", () => {
    const lig = { urlNod: "http://127.0.0.1:65000", proxyPath: "/app/src/adapters/mcp-proxy/proxy.ts", sondaSemTurno: true, prazoSondaMs: PRAZO_MS };
    const cfg = (bin: string): ConfigDriver => ({ bin, env, cwdBase: join(dir, "turnos") });

    it("auth status lento → nao_autenticado com causa e a frase de lentidão, não 'entre na sua conta'; depois responde e fica pronto", async () => {
      const bin = await shimLento(dir, "claude-auth-lento", '"auth status"', CLAUDE_SH);
      const instance = await criarClaudeCliDriver(lig).create(cfg(bin));
      const inv = await venceNoPassoLento(bin, instance.sondar());
      expect(inv).toMatchObject({ estado: "nao_autenticado", motivo: FRASE_CLAUDE, causa: "sonda_lenta", versao: "2.1.290" });
      expect(JSON.stringify(inv)).not.toContain("entre na sua conta");
      await desligarLentidao(bin);
      expect(await instance.sondar()).toMatchObject({ estado: "pronto", versao: "2.1.290" });
    });

    it("--version lento → ausente com causa, nunca 'Instale ou atualize'; a versão não fica guardada", async () => {
      const bin = await shimLento(dir, "claude-versao-lenta-driver", "--version", CLAUDE_SH);
      const instance = await criarClaudeCliDriver(lig).create(cfg(bin));
      const inv = await venceNoPassoLento(bin, instance.sondar());
      expect(inv).toEqual({ estado: "ausente", motivo: FRASE_CLAUDE, causa: "sonda_lenta", em: expect.any(Number) });
      await desligarLentidao(bin);
      expect(await instance.sondar()).toMatchObject({ estado: "pronto", versao: "2.1.290" });
    });

    it("--help lento → ausente com causa, não 'Atualize o Claude Code'", async () => {
      const bin = await shimLento(dir, "claude-help-lento-driver", "--help", CLAUDE_SH);
      const inv = await venceNoPassoLento(bin, (await criarClaudeCliDriver(lig).create(cfg(bin))).sondar());
      expect(inv).toMatchObject({ estado: "ausente", motivo: FRASE_CLAUDE, causa: "sonda_lenta" });
    });

    it("regressão: binário que não existe continua 'Instale ou atualize', sem causa", async () => {
      const inv = await (await criarClaudeCliDriver(lig).create(cfg("/nao/existe/claude"))).sondar();
      expect(inv).toEqual({ estado: "ausente", motivo: "Instale ou atualize o Claude Code neste computador.", em: expect.any(Number) });
    });
  });

  describe("driver codex-cli", () => {
    const lig = { urlNod: "http://127.0.0.1:65000", proxyPath: "/app/src/adapters/mcp-proxy/proxy.ts", prazoSondaMs: PRAZO_MS };
    const cfg = (bin: string): ConfigDriver => ({ bins: { "codex-cli": bin }, env, cwdBase: join(dir, "turnos") });

    it("exec --help lento → ausente com causa e a frase do Codex, nunca 'Atualize o Codex'; não fica no cache de 5 min", async () => {
      const bin = await shimLento(dir, "codex-help-lento", '"exec --help"', CODEX_SH);
      const instance = await criarCodexCliDriver(lig).create(cfg(bin));
      const inv = await venceNoPassoLento(bin, instance.sondar());
      expect(inv).toEqual({ estado: "ausente", motivo: FRASE_CODEX, causa: "sonda_lenta", em: expect.any(Number) });
      expect(JSON.stringify(inv)).not.toContain("Atualize");
      await desligarLentidao(bin);
      // Dentro dos 5 min do cache: a segunda sonda pergunta de novo ao CLI em vez de devolver o resultado lento.
      expect(await instance.sondar()).toMatchObject({ estado: "pronto" });
    });

    it("login status lento → nao_autenticado com causa, não 'entre na sua conta'", async () => {
      const bin = await shimLento(dir, "codex-login-lento", '"login status"', CODEX_SH);
      const inv = await venceNoPassoLento(bin, (await criarCodexCliDriver(lig).create(cfg(bin))).sondar());
      expect(inv).toMatchObject({ estado: "nao_autenticado", motivo: FRASE_CODEX, causa: "sonda_lenta", versao: "codex-cli teste" });
    });

    it("rodada da negociação de config que estoura o prazo → lenta, nunca 'pronto' sem conferir", async () => {
      const bin = await shimLento(dir, "codex-negociacao-lenta", '"exec --help") ;; exec\\ *', CODEX_SH);
      const inv = await venceNoPassoLento(bin, (await criarCodexCliDriver(lig).create(cfg(bin))).sondar());
      expect(inv).toMatchObject({ estado: "ausente", motivo: FRASE_CODEX, causa: "sonda_lenta" });
    });
  });
});
