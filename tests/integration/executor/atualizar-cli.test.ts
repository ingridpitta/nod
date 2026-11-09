import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAtualizadorDeCli } from "../../../src/adapters/executor/atualizar-cli.ts";
import { lerVersao } from "../../../src/adapters/executor/sonda.ts";
import { comandoDeAtualizar } from "../../../desktop/ia-mac.ts";
import { PRAZO_TESTE_FALSO_MS } from "../../helpers/prazo-falso.ts";

/**
 * NOD-9: o atualizador contra um `claude` FALSO de verdade (um script, spawn real pelo executarColetando), sem rede e
 * sem o CLI real. O `update` do falso reescreve o arquivo de versão, como o npm/instalador nativo trocaria o binário; o
 * `--version` lê esse arquivo. Cada `update` fica num log com o ambiente que chegou, para provar a limpeza e a fila.
 */
describe("atualizarCli contra um CLI falso (NOD-9)", { timeout: PRAZO_TESTE_FALSO_MS }, () => {
  let dir: string;
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "nod-atualizar-cli-")); });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  /** `modo`: ok (sobe para `nova`), pouco (sobe abaixo do alvo), eacces, rede, lento, mudo (sai 0 e a versão some). */
  async function cliFalso(versao: string, modo: "ok" | "pouco" | "eacces" | "rede" | "lento" | "mudo", nova = "2.1.300") {
    const id = Math.random().toString(36).slice(2, 8);
    const arq = join(dir, `versao-${id}`);
    const log = join(dir, `updates-${id}`);
    await writeFile(arq, versao);
    await writeFile(log, "");
    const bin = join(dir, `claude-${id}`);
    const update = {
      ok: `printf %s ${JSON.stringify(nova)} > ${JSON.stringify(arq)}; echo "Successfully updated"; exit 0`,
      pouco: `printf %s "2.1.295" > ${JSON.stringify(arq)}; exit 0`,
      eacces: `echo "npm ERR! code EACCES" >&2; echo "npm ERR! Error: EACCES: permission denied, rename '/usr/local/lib/node_modules/@anthropic-ai/claude-code'" >&2; exit 243`,
      rede: `echo "npm ERR! code ENOTFOUND" >&2; echo "npm ERR! getaddrinfo ENOTFOUND registry.npmjs.org" >&2; exit 1`,
      lento: `sleep 30; exit 0`,
      mudo: `rm -f ${JSON.stringify(arq)}; exit 0`,
    }[modo];
    await writeFile(bin, [
      "#!/bin/sh",
      `if [ "$1" = "--version" ]; then [ -f ${JSON.stringify(arq)} ] || exit 1; printf '%s (Claude Code)\\n' "$(cat ${JSON.stringify(arq)})"; exit 0; fi`,
      `if [ "$1" = "update" ]; then`,
      `  echo "update ANTHROPIC_API_KEY=\${ANTHROPIC_API_KEY:-} NOD_HOME=\${NOD_HOME:-} DISABLE_AUTOUPDATER=\${DISABLE_AUTOUPDATER:-} CLAUDE_CODE_ENTRYPOINT=\${CLAUDE_CODE_ENTRYPOINT:-}" >> ${JSON.stringify(log)}`,
      "  sleep 0.2",
      `  ${update}`,
      "fi",
      "exit 2",
      "",
    ].join("\n"));
    await chmod(bin, 0o755);
    return { bin, updates: async () => (await readFile(log, "utf8")).split("\n").filter(Boolean) };
  }

  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY: "sk-vazou", NOD_HOME: "/x", DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_ENTRYPOINT: "cli" };
  const versaoDe = async (bin: string) => { const v = await lerVersao(bin, { PATH: process.env.PATH ?? "" }, 10_000); return "versao" in v ? v.versao : null; };
  const pedido = (bin: string, alvo = "2.1.300", prazoMs?: number) => ({ bin, args: comandoDeAtualizar("claude-cli"), env, alvo, lerVersao: versaoDe, ...(prazoMs ? { prazoMs } : {}) });

  it("ok: roda `claude update` com o ambiente limpo e lê a versão nova", async () => {
    const cli = await cliFalso("2.1.200", "ok");
    expect(await criarAtualizadorDeCli()(pedido(cli.bin))).toEqual({ resultado: "ok", antes: "2.1.200", depois: "2.1.300", atende: true });
    expect(await cli.updates()).toEqual(["update ANTHROPIC_API_KEY= NOD_HOME= DISABLE_AUTOUPDATER= CLAUDE_CODE_ENTRYPOINT="]);
  });

  it("subiu, mas abaixo do alvo: ok sem atende (a tela diz insuficiente)", async () => {
    const cli = await cliFalso("2.1.200", "pouco");
    expect(await criarAtualizadorDeCli()(pedido(cli.bin))).toMatchObject({ resultado: "ok", depois: "2.1.295", atende: false });
  });

  it("EACCES do npm global: sem_permissao (o orquestrador passa à reserva)", async () => {
    const cli = await cliFalso("2.1.200", "eacces");
    expect(await criarAtualizadorDeCli()(pedido(cli.bin))).toMatchObject({ resultado: "sem_permissao", antes: "2.1.200", depois: "2.1.200", atende: false });
  });

  it("sem rede: sem_internet", async () => {
    const cli = await cliFalso("2.1.200", "rede");
    expect((await criarAtualizadorDeCli()(pedido(cli.bin))).resultado).toBe("sem_internet");
  });

  it("saiu 0 mas a versão sumiu: versao_ilegivel", async () => {
    const cli = await cliFalso("2.1.200", "mudo");
    expect(await criarAtualizadorDeCli()(pedido(cli.bin))).toMatchObject({ resultado: "versao_ilegivel", depois: null, atende: false });
  });

  it("o prazo mata o atualizador e vira tempo_esgotado", async () => {
    const cli = await cliFalso("2.1.200", "lento");
    const t0 = Date.now();
    expect(await criarAtualizadorDeCli()(pedido(cli.bin, "2.1.300", 800))).toMatchObject({ resultado: "tempo_esgotado", depois: "2.1.200" });
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it("dois pedidos ao mesmo binário ao mesmo tempo: um `update` só, os dois com o mesmo fim", async () => {
    const cli = await cliFalso("2.1.200", "ok");
    const atualizar = criarAtualizadorDeCli();
    const [a, b] = await Promise.all([atualizar(pedido(cli.bin)), atualizar(pedido(cli.bin))]);
    expect(a).toEqual(b);
    expect(a.resultado).toBe("ok");
    expect(await cli.updates()).toHaveLength(1);
  });
});
