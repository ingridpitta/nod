import { describe, expect, it } from "vitest";
import { RESUMO_DO_PASSO_MAX } from "../../../src/contracts/quadro-comentarios.ts";
import { classeDaFerramenta, nomeCurtoDaFerramenta, redigirResumo, resumoDaFerramenta, RESUMO_NO_EXECUTOR_MAX, semInvolucroShell } from "../../../src/domain/resumo-do-passo.ts";
import { frameDaFerramenta, frameVivoDoEvento, repassarAcaoDoEvento } from "../../../src/domain/rotulo-ferramenta.ts";

/** Chaves de mentira com o formato das de verdade (montadas por partes: o gitleaks do repositório não as confunde). */
const SK = ["sk", "ant-api03-AbCdEfGhIjKlMnOpQrStUv"].join("-");
const GHP = ["ghp", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join("_");
const PAT = ["github", "pat", "11ABCDEFG0123456789_abcdefghijKLMNOP"].join("_");
const XOX = ["xoxb", "123456789012-abcdefghijkl"].join("-");
const AKIA = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
const GLPAT = ["glpat", "abcdefghij0123456789"].join("-");
const BASE64 = "aGVsbG8gd29ybGQgdGhpcyBpcyBhIHNlY3JldCBrZXkgMTIzNDU2Nzg5MA";
const HEX = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

describe("redigirResumo (ADR-165): segredo não passa no resumo do passo", () => {
  it.each([
    ["chave sk-", `export ANTHROPIC=${SK}`],
    ["ghp_", `git clone https://${GHP}@github.com/x/y`],
    ["github_pat_", `gh auth login --with-token ${PAT}`],
    ["xox", `curl -d token=${XOX} slack`],
    ["AKIA", `aws configure set id ${AKIA}`],
    ["glpat-", `glab auth ${GLPAT}`],
    ["Bearer", `curl -H "Authorization: ${"Bear" + "er"} abc.def-ghi_jkl123456"`],
    ["token=", "curl https://api.x.com/v1?token=abc123def"],
    ["senha:", "senha: hunter22"],
    ["password=", 'psql "password=minhasenha host=db"'],
    ["secret=", "deploy --secret=s3gr3d0"],
    ["--api-key", "cli --api-key chave-curta"],
    ["base64 longo", `echo ${BASE64} | base64 -d`],
    ["hex longo", `sha ${HEX}`],
    ["URL com credencial", "psql postgres://nod_dono:segredo@127.0.0.1:5440/nod"],
    ["KEY=valor de env", "OPENAI_API_KEY=abc PGPASSWORD=xyz psql"],
    ["JWT", `curl -H 'x: ${["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"].join(".")}'`],
  ])("%s", (_, texto) => {
    const r = redigirResumo(texto, RESUMO_DO_PASSO_MAX);
    expect(r).toContain("••••");
    for (const segredo of [SK, GHP, PAT, XOX, AKIA, GLPAT, BASE64, HEX, "abc.def-ghi_jkl123456", "abc123def", "hunter22", "minhasenha", "s3gr3d0", "chave-curta", ":segredo@", "=abc", "=xyz", "dozjgNryP4J3"]) expect(r).not.toContain(segredo);
  });

  it("o segredo sai ANTES do corte: a chave no limite não deixa o começo dela", () => {
    const r = redigirResumo(`${"a ".repeat(70)}${SK}`, 150);
    expect(r).not.toContain("sk-ant");
  });

  it("corta em `max` (pontos de código, com reticências dentro do teto) e põe tudo numa linha", () => {
    const r = redigirResumo(`${"x".repeat(300)}`, RESUMO_DO_PASSO_MAX);
    expect(Array.from(r)).toHaveLength(RESUMO_DO_PASSO_MAX);
    expect(r.endsWith("…")).toBe(true);
    expect(redigirResumo("linha 1\n\n  linha\t2  ", 160)).toBe("linha 1 linha 2");
    expect(Array.from(redigirResumo("😀".repeat(200), 10))).toHaveLength(10);
  });

  it("texto comum e caminhos compridos (sem cara de chave) passam inteiros", () => {
    expect(redigirResumo("npm run -s typecheck", 160)).toBe("npm run -s typecheck");
    expect(redigirResumo("ls /home/nod/nod/Dante/tarefa-aberta-mais-multica-15bcdb/nod-passos", 160)).toBe("ls /home/nod/nod/Dante/tarefa-aberta-mais-multica-15bcdb/nod-passos");
    expect(redigirResumo("o token expirou", 160)).toBe("o token expirou");
  });
});

describe("resumoDaFerramenta (ADR-165): a prioridade do Multica, montada no executor", () => {
  it("busca (query; num Grep/Glob o pattern) → arquivo (só o nome) → padrão → descrição → comando sem o invólucro", () => {
    expect(resumoDaFerramenta("WebSearch", { query: "multica trace", description: "x" })).toBe("multica trace");
    expect(resumoDaFerramenta("Grep", { pattern: "turno\\.atividade", path: "/Users/ana/repo/src" })).toBe("turno\\.atividade");
    expect(resumoDaFerramenta("Read", { file_path: "/Users/ana/repo/src/contracts/ponte.ts" })).toBe("ponte.ts");
    expect(resumoDaFerramenta("Write", { file_path: "/tmp/a/b.md", content: "o conteúdo inteiro do arquivo" })).toBe("b.md");
    expect(resumoDaFerramenta("mcp__x__y", { pattern: "*.ts", description: "d" })).toBe("*.ts");
    expect(resumoDaFerramenta("Bash", { command: "ls -la", description: "Lista os arquivos" })).toBe("Lista os arquivos");
    expect(resumoDaFerramenta("Bash", { command: "bash -lc 'npm test -- --run'" })).toBe("npm test -- --run");
    expect(resumoDaFerramenta("mcp__nod__computador_terminal", { comando: "git status" })).toBe("git status");
    expect(resumoDaFerramenta("mcp__nod__buscar_conversas", { consulta: "fatura de outubro" })).toBe("fatura de outubro");
    expect(resumoDaFerramenta("WebFetch", { url: "https://u:p@exemplo.com/docs/a?token=abc#x", prompt: "resuma" })).toBe("exemplo.com/docs/a");
  });

  it("o comando é cortado em 120 e redigido antes de sair; o Codex manda o input como JSON e o comando como lista", () => {
    const r = resumoDaFerramenta("Bash", { command: `curl -H "Authorization: Bearer ${GHP}" ${"x".repeat(300)}` })!;
    expect(Array.from(r).length).toBeLessThanOrEqual(RESUMO_NO_EXECUTOR_MAX);
    expect(r).not.toContain(GHP.slice(4));
    expect(resumoDaFerramenta("mcp__linear__get_issue", JSON.stringify({ query: "NOD-12" }))).toBe("NOD-12");
    expect(resumoDaFerramenta("shell", { command: ["bash", "-lc", "git log"] })).toBe("bash -lc git log");
  });

  it("nada a dizer: undefined (o input sem campo conhecido, ou que não é objeto; nunca o primeiro texto qualquer)", () => {
    expect(resumoDaFerramenta("Agent", { prompt: "o prompt inteiro do subagente" })).toBeUndefined();
    expect(resumoDaFerramenta("Bash", null)).toBeUndefined();
    expect(resumoDaFerramenta("Bash", "não é json")).toBeUndefined();
    expect(semInvolucroShell("sh -c \"echo oi\"")).toBe("echo oi");
  });

  it("classe e nome curto saem do nome da ferramenta", () => {
    expect(["Bash", "Read", "Edit", "Grep", "WebSearch", "mcp__nod__lembrar", "mcp__linear__get_issue", "mcp__nod__computador_terminal", "TodoWrite"].map(classeDaFerramenta))
      .toEqual(["comando", "arquivo", "arquivo", "busca", "busca", "app", "app", "comando", "outro"]);
    expect(nomeCurtoDaFerramenta("mcp__nod__lembrar")).toBe("lembrar");
    expect(nomeCurtoDaFerramenta("Bash")).toBe("Bash");
  });
});

describe("o frame turno.atividade (ADR-165) leva resumo, classe e ferramenta", () => {
  it("frameDaFerramenta corta em 160 e redige de novo no servidor; o app antigo (sem resumo) dá null", () => {
    expect(frameDaFerramenta("Bash", "u1", `deploy token=${"a".repeat(10)} ${"y".repeat(400)}`)).toMatchObject({ nome: "Bash", id: "u1", classe: "comando", ferramenta: "Bash", rotulo: "Rodou um comando" });
    const f = frameDaFerramenta("Bash", "u1", `deploy token=abcdefghij ${"y".repeat(400)}`);
    expect(f.resumo).not.toContain("abcdefghij");
    expect(Array.from(f.resumo!)).toHaveLength(RESUMO_DO_PASSO_MAX);
    expect(frameDaFerramenta("Read").resumo).toBeNull();
  });

  it("o laço local tira o resumo do input; o desktop e o motor repassam o resumo à ponte", () => {
    const ev = { tipo: "tool_use" as const, id: "u1", nome: "Read", input: { file_path: "/a/b/c.ts" } };
    expect(frameVivoDoEvento(ev)).toMatchObject({ tipo: "turno.atividade", dados: { resumo: "c.ts", classe: "arquivo" } });
    const chamadas: unknown[][] = [];
    repassarAcaoDoEvento({ ferramenta: (...a: unknown[]) => void chamadas.push(a), fimDaFerramenta: () => undefined }, "T", ev);
    expect(chamadas).toEqual([["T", "Read", "u1", "c.ts"]]);
  });
});
