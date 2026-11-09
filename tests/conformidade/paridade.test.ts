import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DefinicaoAcao } from "../../src/contracts/acoes.ts";
import { rotasDaParidade } from "../../src/adapters/http/rotas-da-paridade.ts";
import { criarDb } from "../../src/db/client.ts";
import { REGISTRO_DE_ACOES, validarRegistro } from "../../src/domain/acoes/index.ts";
import { gerarParidadeMd, rotasQueMudam, verificarParidade, type PisoDeParidade, type RotaNaCatraca, verificarPisoSobe, baseDoPiso } from "../../src/domain/acoes/paridade.ts";

/**
 * A catraca de paridade tela × chat (NOD-391, ADR-135 §5), sobre o app composto de verdade nos dois modos.
 * A: toda rota de pessoa que muda algo declara um id do registro. B: toda ação tem rota (ou diz por que não) e quem não
 * tem caminho no chat diz a onda ou o motivo. C: as vivas não caem abaixo do piso. D: o docs/paridade.md está em dia.
 */

const raiz = join(import.meta.dirname, "../..");
const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** O piso na base do commit (`baseDoPiso`); `null` quando a base ainda não tem o arquivo. Sem base fora do CI: null. */
function pisoDaBase(cwd: string, ci: boolean): PisoDeParidade | null {
  const base = baseDoPiso({ ci, mergeBase: () => { try { return git(cwd, ["merge-base", "HEAD", "origin/main"]); } catch { return null; } } });
  if (!base) {
    if (ci) throw new Error("catraca C sem base para comparar o piso");
    return null;
  }
  try {
    return JSON.parse(git(cwd, ["show", `${base}:docs/paridade.piso.json`])) as PisoDeParidade;
  } catch (e) {
    const msg = String((e as { stderr?: unknown }).stderr ?? e);
    // A base sem o arquivo (antes da NOD-391) é o único "não há base" aceito; sem o pai no checkout, só fora do CI.
    if (!/does not exist|exists on disk, but not in/.test(msg) && ci) throw new Error(`catraca C sem a base ${base} para comparar o piso: ${msg}`);
    return null;
  }
}
const piso = JSON.parse(readFileSync(join(raiz, "docs/paridade.piso.json"), "utf8")) as PisoDeParidade;
// Compor não abre conexão: o cliente só conecta na primeira consulta, e listar rotas não consulta.
const db = criarDb("postgres://catraca@127.0.0.1:1/sem-banco", { max: 1 });
let rotas: RotaNaCatraca[] = [];

beforeAll(async () => {
  rotas = await rotasDaParidade(db);
});
afterAll(async () => {
  await db.end({ timeout: 1 });
});

describe("catraca de paridade no app real", () => {
  it("enxerga as rotas de pessoa que mudam algo nos dois modos (sanidade: não ficou vazia)", () => {
    const mudam = rotasQueMudam(rotas);
    expect(mudam.length).toBeGreaterThanOrEqual(124);
    // as famílias que só existem com flag ou num modo entraram
    for (const k of ["POST ^\\/nuvem\\/maquinas$", "POST ^\\/executor$", "DELETE ^\\/agentes\\/(?<id>[^/]+)$"]) expect(mudam.map((r) => `${r.metodo} ${r.padrao}`)).toContain(k);
    // rota interna, de máquina e pública não contam
    expect(mudam.every((r) => r.pessoa)).toBe(true);
  });

  it("A, B e C passam e o registro é válido", () => {
    expect(validarRegistro(REGISTRO_DE_ACOES)).toEqual([]);
    expect(verificarParidade(rotas, REGISTRO_DE_ACOES, piso)).toEqual([]);
  });

  it("C: o piso não cai em relação ao da base do commit (no CI, HEAD^1; fora dele, o merge-base com a origin/main)", () => {
    expect(verificarPisoSobe(piso, pisoDaBase(raiz, !!process.env.CI))).toEqual([]);
  });

  it("D: o docs/paridade.md é o gerado (rode `npm run paridade` e commite)", () => {
    expect(readFileSync(join(raiz, "docs/paridade.md"), "utf8")).toBe(gerarParidadeMd(REGISTRO_DE_ACOES, rotas, piso));
  });
});

describe("catraca de paridade: o que ela barra", () => {
  const acao: DefinicaoAcao = { id: "bots.teste", titulo: "Teste", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } };
  const rota: RotaNaCatraca = { metodo: "POST", padrao: "^\\/teste$", pessoa: true, acao: "bots.teste" };

  it("A: rota de pessoa que muda algo sem id falha; com id fora do registro também", () => {
    expect(verificarParidade([...rotas, { metodo: "POST", padrao: "^\\/nova$", pessoa: true }], REGISTRO_DE_ACOES, piso)).toEqual(["A: POST ^\\/nova$ não declara a ação (Rota.acao) — registre-a em src/domain/acoes/"]);
    expect(verificarParidade([rota, { ...rota, padrao: "^\\/x$", acao: "bots.inexistente" }], [acao], { vivo: 0 })).toEqual(["A: POST ^\\/x$ declara bots.inexistente, que não está no registro"]);
  });

  it("A: a mesma rota nos dois modos é conferida nas duas cópias (a do modo que perdeu o id não some atrás da outra)", () => {
    const semId: RotaNaCatraca = { metodo: rota.metodo, padrao: rota.padrao, pessoa: true };
    for (const ordem of [[semId, rota], [rota, semId]]) {
      expect(verificarParidade(ordem, [acao], { vivo: 0 })).toContain("A: POST ^\\/teste$ não declara a ação (Rota.acao) — registre-a em src/domain/acoes/");
    }
    expect(verificarParidade([rota, { ...rota, acao: "bots.outra" }], [acao, { ...acao, id: "bots.outra" }], { vivo: 0 })).toEqual(["A: POST ^\\/teste$ declara ações diferentes nos modos do app (bots.teste × bots.outra)"]);
  });

  it("A não cobra GET, rota interna, de máquina ou pública", () => {
    const fora: RotaNaCatraca[] = [{ metodo: "GET", padrao: "^\\/a$", pessoa: true }, { metodo: "POST", padrao: "^\\/b$", pessoa: false }];
    expect(verificarParidade([rota, ...fora], [acao], { vivo: 0 })).toEqual([]);
  });

  it("B: ação sem rota de pessoa falha, salvo semRotaDePessoa com o motivo", () => {
    expect(verificarParidade([], [acao], { vivo: 0 })).toEqual(["B: bots.teste não é usada por nenhuma rota de pessoa (sem semRotaDePessoa)"]);
    expect(verificarParidade([], [{ ...acao, semRotaDePessoa: "rota pública" }], { vivo: 0 })).toEqual([]);
  });

  it("C: menos vivas que o piso falha (uma viva que volta a falta é pega)", () => {
    const rebaixado = REGISTRO_DE_ACOES.map((a): DefinicaoAcao => (a.id === "bots.excluir" ? { ...a, chat: { estado: "falta", onda: "NOD-393" } } : a));
    expect(verificarParidade(rotas, rebaixado, piso)).toEqual([`C: ${piso.vivo - 1} ações vivas no chat, abaixo do piso de ${piso.vivo} (docs/paridade.piso.json)`]);
  });

  it("C: rerun de commit antigo da main compara com o pai dele, não com a main que já andou (run 41540469246)", () => {
    const dir = mkdtempSync(join(tmpdir(), "catraca-c-"));
    try {
      const commitar = (vivo: number, msg: string) => {
        writeFileSync(join(dir, "docs/paridade.piso.json"), JSON.stringify({ vivo }));
        git(dir, ["add", "-A"]);
        git(dir, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", msg]);
        return git(dir, ["rev-parse", "HEAD"]);
      };
      git(dir, ["init", "-q", "-b", "main"]);
      mkdirSync(join(dir, "docs"));
      commitar(40, "pai");
      const antigo = commitar(40, "o commit antigo (3162df76)");
      commitar(43, "a main andou (o #626 subiu o piso)");
      git(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
      git(dir, ["checkout", "-q", "--detach", antigo]);
      const doCommit = JSON.parse(readFileSync(join(dir, "docs/paridade.piso.json"), "utf8")) as PisoDeParidade;
      expect(verificarPisoSobe(doCommit, pisoDaBase(dir, true))).toEqual([]);
      // O de antes (a origin/main de agora) derrubava o rerun.
      expect(verificarPisoSobe(doCommit, JSON.parse(git(dir, ["show", "origin/main:docs/paridade.piso.json"])) as PisoDeParidade)).not.toEqual([]);
      // E baixar o piso em relação ao pai continua caindo.
      const baixou = commitar(39, "baixou");
      git(dir, ["checkout", "-q", "--detach", baixou]);
      expect(verificarPisoSobe({ vivo: 39 }, pisoDaBase(dir, true))).toEqual(["C: o piso de vivas caiu de 40 (main) para 39; ele só sobe (docs/paridade.piso.json)"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("C: a base é HEAD^1 no CI e o merge-base fora dele", () => {
    expect(baseDoPiso({ ci: true, mergeBase: () => "abc" })).toBe("HEAD^1");
    expect(baseDoPiso({ ci: false, mergeBase: () => "abc" })).toBe("abc");
    expect(baseDoPiso({ ci: false, mergeBase: () => null })).toBeNull();
  });

  it("C: baixar o piso em relação à main falha; manter ou subir passa", () => {
    expect(verificarPisoSobe({ vivo: 5 }, { vivo: 6 })).toEqual(["C: o piso de vivas caiu de 6 (main) para 5; ele só sobe (docs/paridade.piso.json)"]);
    expect(verificarPisoSobe({ vivo: 6 }, { vivo: 6 })).toEqual([]);
    expect(verificarPisoSobe({ vivo: 7 }, { vivo: 6 })).toEqual([]);
    expect(verificarPisoSobe({ vivo: 0 }, null)).toEqual([]);
  });

  it("D: o gerado muda quando o registro muda (o arquivo velho não passaria)", () => {
    const mudado = REGISTRO_DE_ACOES.map((a): DefinicaoAcao => (a.id === "bots.fixar" ? { ...a, titulo: "Outro título" } : a));
    expect(gerarParidadeMd(mudado, rotas, piso)).not.toBe(gerarParidadeMd(REGISTRO_DE_ACOES, rotas, piso));
  });
});
