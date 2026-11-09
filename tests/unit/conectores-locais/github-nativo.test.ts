import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configGithubNativo, criarDetectorGh, sondaGithubNativa } from "../../../src/adapters/conectores-locais/github/nativo.ts";

/**
 * O lado do SERVIDOR do conector github (ADR-048): o processo que a composição spawna para os jeitos
 * que rodam no servidor (token, Composio, App) e a "sonda" estática. O gh nunca aparece aqui.
 */
const AMBIENTE = { PATH: "/usr/bin:/bin", HOME: "/Users/m", USER: "m", NOD_CREDENTIAL_KEY: "chave-do-servidor", DATABASE_URL: "postgres://x" };
const COMPOSIO = { COMPOSIO_URL: "https://backend.composio.dev/tool_router/v3/trs/mcp", COMPOSIO_API_KEY: "ak_x" };
const APP = { token: "ghs_instalacao", expiraEm: 1_000 };

/**
 * medido em 2026-09-24: sob a suíte inteira com outra suíte rodando na mesma máquina, spawnar o
 * servidor stdio + o gh falso passou dos 5 s padrão do projeto unit (4 de 779 testes, uma rodada em
 * três). O teto por teste sobe só aqui, onde há processo de verdade.
 * NOD-194: o detector tem prazo FIXO de 5 s no `gh auth status` (criarDetectorGh, maquina.ts). Com o Mac em load
 * ~1000 (duas `test:unit` em paralelo) o gh falso, um `sh`, passou disso, o detector leu "deslogado" e o teste
 * caiu sem defeito nenhum (medido em 2026-10-07). O teste mede o cache, não o prazo: o execFile deste arquivo
 * sobe esse prazo para PRAZO_GH_MS; o resto do child_process fica intacto. O código não muda.
 * medido em 2026-10-09 (QA da NOD-194, duas `test:unit` em paralelo, load de 5 min ~1000): este arquivo levou 54,2 s
 * e o `github-gh` vizinho estourou os 60 s do mesmo padrão com um gh falso que não espera nada. Daí 120 s.
 */
const { PRAZO_GH_MS } = vi.hoisted(() => ({ PRAZO_GH_MS: 120_000 }));
vi.mock("node:child_process", async (original) => {
  const m = await original<typeof import("node:child_process")>();
  const execFile = (bin: string, args: string[], opcoes: { timeout?: number }, cb: (...r: unknown[]) => void) => m.execFile(bin, args, { ...opcoes, timeout: opcoes.timeout ? Math.max(opcoes.timeout, PRAZO_GH_MS) : opcoes.timeout }, cb);
  return { ...m, execFile };
});
/** Duas chamadas ao gh no pior caso, cada uma no PRAZO_GH_MS. */
const PROCESSO = { timeout: 2 * PRAZO_GH_MS + 10_000 };

describe("configGithubNativo: jeitos do servidor, por turno", () => {
  it("token da pessoa primeiro, sem nada do Composio nem segredo do servidor no ambiente", () => {
    const r = configGithubNativo({ envConector: { GITHUB_TOKEN: "ghp_x", ...COMPOSIO }, app: APP, rotina: true, ambiente: AMBIENTE });
    if (!r.ok) throw new Error("jeito");
    expect(r.cfg).toMatchObject({ jeito: "token", env: { NOD_GITHUB_JEITO: "token", NOD_GITHUB_TOKEN: "ghp_x" } });
    expect(Object.values(r.cfg.env).join(" ")).not.toMatch(/ak_x|ghs_|chave-do-servidor|postgres/);
  });

  it("B: sem token, o Composio da pessoa ganha do App mesmo em rotina", () => {
    const r = configGithubNativo({ envConector: COMPOSIO, app: APP, rotina: true, ambiente: AMBIENTE });
    expect(r.ok && r.cfg.env).toMatchObject({ NOD_GITHUB_JEITO: "composio", NOD_COMPOSIO_CHAVE: "ak_x" });
  });

  it("B: o App só em rotina e só sem credencial da pessoa; em turno interativo, nunca", () => {
    const rotina = configGithubNativo({ envConector: {}, app: APP, rotina: true, ambiente: AMBIENTE });
    expect(rotina.ok && rotina.cfg).toMatchObject({ jeito: "app", expiraEm: 1_000, env: { NOD_GITHUB_JEITO: "app", NOD_GITHUB_TOKEN: "ghs_instalacao" } });
    const interativo = configGithubNativo({ envConector: {}, app: APP, rotina: false, ambiente: AMBIENTE });
    expect(interativo).toEqual({ ok: false, frase: expect.stringContaining("gh auth login") });
  });
});

describe("sonda estática do conector nativo", () => {
  it("gh do Mac, token ou App = catálogo inteiro; só Composio = sem diff nem checks; nada = indisponível", () => {
    const nomes = (r: ReturnType<typeof sondaGithubNativa>) => (r.ok ? r.ferramentas.map((f) => f.nome) : r.motivo);
    expect(nomes(sondaGithubNativa({ ghNaMaquina: true, envChaves: [], appConfigurado: false }))).toHaveLength(9);
    expect(nomes(sondaGithubNativa({ ghNaMaquina: false, envChaves: ["GITHUB_TOKEN"], appConfigurado: false }))).toHaveLength(9);
    expect(nomes(sondaGithubNativa({ ghNaMaquina: false, envChaves: ["COMPOSIO_API_KEY", "COMPOSIO_URL"], appConfigurado: false }))).toEqual(["pr_ver", "pr_arquivos", "pr_comentarios", "arquivo_ler", "issue_ver", "pr_comentar", "pr_revisar"]);
    expect(nomes(sondaGithubNativa({ ghNaMaquina: false, envChaves: [], appConfigurado: false }))).toBe("conector_indisponivel");
  });
});

describe("detector do gh desta máquina", PROCESSO, () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("`gh auth status` com saída 0 = logado; cache curto, o deslogado expira antes; chamadas juntas viram uma", async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-ghdet-"));
    const gh = join(dir, "gh");
    writeFileSync(gh, `#!/bin/sh\necho "$@" >> "${dir}/chamadas"\n[ "$1 $2" = "auth status" ] && exit $(cat "${dir}/saida")\nexit 9\n`);
    chmodSync(gh, 0o755);
    writeFileSync(join(dir, "saida"), "1");
    let agora = 0;
    const d = criarDetectorGh({ ambiente: { PATH: "/usr/bin:/bin", HOME: dir }, bin: gh, agora: () => agora });
    expect(await Promise.all([d.logado(), d.logado(), d.logado()])).toEqual([false, false, false]);
    writeFileSync(join(dir, "saida"), "0");
    agora = 5_000;
    expect(await d.logado()).toBe(false);
    agora = 11_000;
    expect(await d.logado()).toBe(true);
    agora = 60_000;
    expect(await d.logado()).toBe(true);
  });
});
