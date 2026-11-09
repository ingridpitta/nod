import { describe, expect, it } from "vitest";
import { CAPACIDADES_GITHUB } from "../../../src/contracts/github.ts";
import { ArgumentoGithubInvalido, escolherJeitoGithub, marcarExecucaoNaMaquina, migracaoDoComposio, validarArgsGithub, validarRepositorio } from "../../../src/domain/github.ts";

describe("escolha do jeito de conectar o GitHub, por turno (ADR-048)", () => {
  it("o gh da máquina do turno (já cruzado com a posse) ganha de tudo, inclusive do App em rotina", () => {
    expect(escolherJeitoGithub({ ghNaMaquina: true, prontos: { token: true, composio: true, app: true }, rotina: true })).toEqual({ ok: true, jeito: "gh" });
  });

  it("sem gh: token da pessoa → Composio da pessoa → App só em rotina", () => {
    expect(escolherJeitoGithub({ ghNaMaquina: false, prontos: { token: true, composio: true, app: true }, rotina: true })).toEqual({ ok: true, jeito: "token" });
    expect(escolherJeitoGithub({ ghNaMaquina: false, prontos: { composio: true, app: true }, rotina: true })).toEqual({ ok: true, jeito: "composio" });
    expect(escolherJeitoGithub({ ghNaMaquina: false, prontos: { app: true }, rotina: true })).toEqual({ ok: true, jeito: "app" });
  });

  it("B: o App da organização NUNCA atende turno interativo, nem como último recurso", () => {
    const r = escolherJeitoGithub({ ghNaMaquina: false, prontos: { app: true }, rotina: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.frase).toContain("gh auth login");
    const rotina = escolherJeitoGithub({ ghNaMaquina: false, prontos: {}, rotina: true });
    if (!rotina.ok) expect(rotina.frase).toContain("conecte o GitHub da organização");
  });

  it("marca para a máquina só as ferramentas do conector github indicado", () => {
    const f = (nome: string, conectorId: string | null, origem: "nod" | "conector" = "conector") => ({ nome, nomeMcp: `mcp__nod__${nome}` as const, origem, conectorId, readOnlyHint: true, tocaDadoPessoal: true, schema: {} });
    const marcadas = marcarExecucaoNaMaquina([f("github__pr_ver", "g1"), f("gmail__GMAIL_FETCH", "m1"), f("lembrar", null, "nod")], "g1");
    expect(marcadas.map((x) => x.execucao ?? null)).toEqual(["maquina", null, null]);
    expect(marcarExecucaoNaMaquina([f("github__pr_ver", "g1")], null)[0]?.execucao).toBeUndefined();
  });

  it("G: acessos do github do Composio viram os nomes estáveis — só o par direto migra (sem par não vira o nível inteiro), e 'Sempre permitir' só do par exato", () => {
    const m = migracaoDoComposio([
      { nome: "GITHUB_GET_A_PULL_REQUEST", readOnlyHint: true },
      { nome: "GITHUB_LIST_ISSUE_COMMENTS", readOnlyHint: true },
      { nome: "GITHUB_CREATE_AN_ISSUE_COMMENT", readOnlyHint: false },
      { nome: "GITHUB_LIST_BRANCHES", readOnlyHint: true },
      { nome: "GITHUB_MERGE_A_PULL_REQUEST", readOnlyHint: false },
    ]);
    expect(m.concessoes).toEqual({
      GITHUB_GET_A_PULL_REQUEST: ["pr_ver"],
      GITHUB_LIST_ISSUE_COMMENTS: ["pr_comentarios"],
      GITHUB_CREATE_AN_ISSUE_COMMENT: ["pr_comentar"],
      GITHUB_LIST_BRANCHES: [],
      GITHUB_MERGE_A_PULL_REQUEST: [],
    });
    expect(m.permanentes).toEqual({ GITHUB_CREATE_AN_ISSUE_COMMENT: "pr_comentar" });
  });
});

describe("argumentos do conector github", () => {
  it("aceita dono/nome e tira o .git", () => {
    expect(validarRepositorio("acme/nod")).toEqual({ dono: "acme", repo: "nod" });
    expect(validarRepositorio("marlonwlv/nod.git")).toEqual({ dono: "marlonwlv", repo: "nod" });
  });

  it.each(["x/...git", "x/..git", "x/.git", "x/.", "x/..", "foo/bar;rm -rf ~", "--repo=x", "--repo=x/y", "foo", "a/b/c", "-x/y", "foo/..", "foo/ bar", "foo/bar$(id)", "foo/`id`", "", "foo/bar\nbaz"])("recusa repositório %j antes de qualquer processo", (r) => {
    expect(() => validarRepositorio(r)).toThrow(ArgumentoGithubInvalido);
  });

  it("número só inteiro positivo; string, fração e negativo caem", () => {
    for (const n of ["466", 1.5, -1, 0, Number.NaN, 1e12]) expect(() => validarArgsGithub("pr_ver", { repositorio: "acme/nod", numero: n })).toThrow(ArgumentoGithubInvalido);
    expect(validarArgsGithub("pr_ver", { repositorio: "acme/nod", numero: 466 })).toEqual({ capacidade: "pr_ver", alvo: { dono: "acme", repo: "nod" }, numero: 466 });
  });

  it("arquivo_ler recusa .. no caminho e ref que parece opção", () => {
    expect(validarArgsGithub("arquivo_ler", { repositorio: "acme/nod", caminho: "/src/index.ts", ref: "feat/x" })).toMatchObject({ caminho: "src/index.ts", ref: "feat/x" });
    expect(() => validarArgsGithub("arquivo_ler", { repositorio: "acme/nod", caminho: "../../etc/passwd" })).toThrow(ArgumentoGithubInvalido);
    expect(() => validarArgsGithub("arquivo_ler", { repositorio: "acme/nod", caminho: "a", ref: "--output=x" })).toThrow(ArgumentoGithubInvalido);
    expect(() => validarArgsGithub("arquivo_ler", { repositorio: "acme/nod", caminho: "a", ref: "main..dev" })).toThrow(ArgumentoGithubInvalido);
  });

  it("pr_revisar: approve aceita sem texto; comment e request_changes exigem; evento fora da lista cai", () => {
    expect(validarArgsGithub("pr_revisar", { repositorio: "acme/nod", numero: 1, evento: "approve" })).toMatchObject({ evento: "approve", texto: null });
    expect(() => validarArgsGithub("pr_revisar", { repositorio: "acme/nod", numero: 1, evento: "comment" })).toThrow(ArgumentoGithubInvalido);
    expect(() => validarArgsGithub("pr_revisar", { repositorio: "acme/nod", numero: 1, evento: "merge", texto: "x" })).toThrow(ArgumentoGithubInvalido);
  });

  it("os nomes são estáveis e só as duas escritas não são readOnly", () => {
    expect(CAPACIDADES_GITHUB.map((c) => c.nome)).toEqual(["pr_ver", "pr_diff", "pr_arquivos", "pr_comentarios", "pr_checks", "arquivo_ler", "issue_ver", "pr_comentar", "pr_revisar"]);
    expect(CAPACIDADES_GITHUB.filter((c) => !c.readOnlyHint).map((c) => c.nome)).toEqual(["pr_comentar", "pr_revisar"]);
  });
});
