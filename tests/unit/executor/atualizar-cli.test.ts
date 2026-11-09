import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ambienteDoAtualizador, classificarFalhaAtualizar, criarAtualizadorDeCli, type ExecutarAtualizador } from "../../../src/adapters/executor/atualizar-cli.ts";
import type { executarColetando } from "../../../src/adapters/executor/processo.ts";

type Fim = Awaited<ReturnType<typeof executarColetando>>;
const fim = (o: Partial<Fim>): Fim => ({ exitCode: 0, signal: null, stderr: "", erroSpawn: null, stdout: "", estourouTempo: false, ...o });

/** Um "CLI" de mentira: a versão sobe para `depois` quando o atualizador roda. */
function falso(o: { antes: string | null; depois: string | null; saida?: Partial<Fim> }) {
  let versao = o.antes;
  const chamadas: { args: readonly string[]; env: Record<string, string> }[] = [];
  const executar: ExecutarAtualizador = async (p) => { chamadas.push(p); versao = o.depois; return fim(o.saida ?? {}); };
  return { executar, chamadas, lerVersao: async () => versao };
}

describe("atualizarCli (NOD-9)", () => {
  it("ok: lê antes e depois e diz se chegou ao alvo", async () => {
    const f = falso({ antes: "2.1.280", depois: "2.1.300" });
    const r = await criarAtualizadorDeCli(f.executar)({ bin: "/b/claude", args: ["update"], env: {}, alvo: "2.1.290", lerVersao: f.lerVersao });
    expect(r).toEqual({ resultado: "ok", antes: "2.1.280", depois: "2.1.300", atende: true });
    expect(f.chamadas[0]?.args).toEqual(["update"]);
  });

  it("subiu pouco: ok sem atender (a tela diz insuficiente)", async () => {
    const f = falso({ antes: "2.1.280", depois: "2.1.285" });
    expect(await criarAtualizadorDeCli(f.executar)({ bin: "/b", args: ["update"], env: {}, alvo: "2.1.290", lerVersao: f.lerVersao })).toMatchObject({ resultado: "ok", atende: false });
  });

  it("sem atualizador conhecido: nao_suportado, sem rodar nada", async () => {
    const f = falso({ antes: "0.150.0", depois: "0.150.0" });
    expect((await criarAtualizadorDeCli(f.executar)({ bin: "/b", args: null, env: {}, alvo: "0.159.0", lerVersao: f.lerVersao })).resultado).toBe("nao_suportado");
    expect(f.chamadas).toHaveLength(0);
  });

  it("classifica a falha, o prazo e a versão ilegível", async () => {
    const rodar = async (saida: Partial<Fim>, depois: string | null = "2.1.280") => {
      const f = falso({ antes: "2.1.280", depois, saida });
      return (await criarAtualizadorDeCli(f.executar)({ bin: "/b", args: ["update"], env: {}, alvo: "2.1.290", lerVersao: f.lerVersao })).resultado;
    };
    expect(await rodar({ exitCode: 1, stderr: "Error: EACCES: permission denied" })).toBe("sem_permissao");
    expect(await rodar({ exitCode: 1, stdout: "npm error code ENOSPC" })).toBe("sem_espaco");
    expect(await rodar({ exitCode: 1, stderr: "getaddrinfo ENOTFOUND registry.npmjs.org" })).toBe("sem_internet");
    expect(await rodar({ exitCode: 1, stderr: "deu ruim" })).toBe("falhou");
    expect(await rodar({ exitCode: null, signal: "SIGKILL", estourouTempo: true })).toBe("tempo_esgotado");
    expect(await rodar({}, null)).toBe("versao_ilegivel");
  });

  it("uma por binário: o segundo pedido espera o mesmo processo", async () => {
    let soltar: () => void = () => undefined;
    let vezes = 0;
    const executar: ExecutarAtualizador = async () => { vezes++; await new Promise<void>((r) => { soltar = r; }); return fim({}); };
    const atualizar = criarAtualizadorDeCli(executar);
    const pedido = { bin: "/b", args: ["update"], env: {}, alvo: "2.1.290", lerVersao: async () => "2.1.300" };
    const a = atualizar(pedido);
    const b = atualizar(pedido);
    expect(a).toBe(b);
    await new Promise((r) => setTimeout(r, 0));
    soltar();
    await a;
    expect(vezes).toBe(1);
  });

  it("o ambiente sai sem as variáveis do nod, das contas e do DISABLE_AUTOUPDATER", () => {
    expect(ambienteDoAtualizador({ PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "x", CLAUDE_CODE_OAUTH_TOKEN: "x", NOD_HOME: "x", OPENAI_API_KEY: "x", CODEX_API_KEY: "x", DISABLE_AUTOUPDATER: "1", CLAUDE_CONFIG_DIR: "/c" })).toEqual({ PATH: "/bin", HOME: "/h", CLAUDE_CONFIG_DIR: "/c" });
  });

  it("classificarFalhaAtualizar tira as cores antes", () => {
    expect(classificarFalhaAtualizar("\u001b[31mEPERM\u001b[0m")).toBe("sem_permissao");
  });
});

describe("atualizarCli com processo de verdade", () => {
  let pasta = "";
  afterEach(async () => { if (pasta) await rm(pasta, { recursive: true, force: true }); });

  it("roda o binário com os argumentos e o ambiente limpo", async () => {
    pasta = await mkdtemp(join(tmpdir(), "nod9-"));
    const bin = join(pasta, "claude");
    const saida = join(pasta, "saida");
    await writeFile(bin, `#!/bin/sh\necho "$1 \${NOD_HOME:-limpo}" > "${saida}"\n`);
    await chmod(bin, 0o755);
    const r = await criarAtualizadorDeCli()({ bin, args: ["update"], env: { PATH: process.env.PATH ?? "", NOD_HOME: "/x" }, alvo: "1.0.0", lerVersao: async () => "1.0.0" });
    expect(r.resultado).toBe("ok");
    expect((await readFile(saida, "utf8")).trim()).toBe("update limpo");
  });
});
