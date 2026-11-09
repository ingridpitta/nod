import { describe, expect, it } from "vitest";
import { CAMINHO_ILEGIVEL, RETEM_MS, checkpointsVencidos, juntarForcado, ordemDoDesfazer, resumoCheckpointValido, decidirArquivo, diferencas, ehPastaDeFrente, foraDoCheckpoint, resumoDoCheckpoint, type EntradaDaFoto } from "../../../src/domain/checkpoints.ts";
import { TETO_ARQUIVOS_DO_CHECKPOINT } from "../../../src/contracts/checkpoint.ts";

const b = (blob: string): EntradaDaFoto => ({ modo: "100644", blob });

describe("checkpoints, regras puras (NOD-54)", () => {
  it("o desfazer passa nos criados primeiro: Notes.md -> notes.md no Mac não apaga o arquivo (revisão 11, A1)", () => {
    const difs = [{ chave: "Notes.md", acao: "apagado" as const }, { chave: "a.md", acao: "mudado" as const }, { chave: "notes.md", acao: "criado" as const }];
    expect(ordemDoDesfazer(difs).map((d) => d.chave)).toEqual(["notes.md", "Notes.md", "a.md"]);
  });

  it("o resultado do forçado entra no anterior: troca o desfecho só dos caminhos forçados (revisão 11, M2)", () => {
    const anterior = { arquivos: [{ caminho: "~/b", desfecho: "conflito" as const }, { caminho: "~/a", desfecho: "voltou" as const }], contagem: { conflito: 1, erro: 0, mesclado: 0, voltou: 4 } };
    const novo = { arquivos: [{ caminho: "~/b", desfecho: "voltou" as const }], contagem: { conflito: 0, erro: 0, mesclado: 0, voltou: 1 } };
    expect(juntarForcado(anterior, novo)).toEqual({ arquivos: [{ caminho: "~/b", desfecho: "voltou" }, { caminho: "~/a", desfecho: "voltou" }], contagem: { conflito: 0, erro: 0, mesclado: 0, voltou: 5 } });
  });

  it("fica fora: .git, node_modules, caches e o Postgres descartável", () => {
    for (const n of [".git", "node_modules", ".next", "__pycache__", "disposable-pg-123"]) expect(foraDoCheckpoint(n)).toBe(true);
    for (const n of ["src", ".github", "gitignore", "modules"]) expect(foraDoCheckpoint(n)).toBe(false);
  });

  it("pasta de frente: o sufixo de 6 hex do slug", () => {
    expect(ehPastaDeFrente("nod-54-implementar-58cf71")).toBe(true);
    expect(ehPastaDeFrente("relatorios")).toBe(false);
    expect(ehPastaDeFrente("plano-2026")).toBe(false);
  });

  it("diferenças: criado, mudado, apagado; a entrada marcada (grande) nunca conta", () => {
    const antes = new Map([["a", b("1")], ["b", b("2")], ["g", b("9")], ["m", { marca: "fora" } as const]]);
    const depois = new Map([["a", b("1")], ["c", b("3")], ["g", { marca: "fora" } as const], ["b", b("22")]]);
    expect(diferencas(antes, depois)).toEqual([{ chave: "b", acao: "mudado" }, { chave: "c", acao: "criado" }]);
    expect(diferencas(new Map([["x", b("1")]]), new Map([["x", { modo: "100755", blob: "1" }]]))).toEqual([{ chave: "x", acao: "mudado" }]);
    expect(diferencas(new Map([["x", b("1")]]), new Map())).toEqual([{ chave: "x", acao: "apagado" }]);
  });

  it("resumo: null sem mudança; teto na lista e o total real", () => {
    expect(resumoDoCheckpoint([])).toBeNull();
    const muitos = Array.from({ length: TETO_ARQUIVOS_DO_CHECKPOINT + 5 }, (_, i) => ({ chave: `nod/B/${i}`, acao: "criado" as const }));
    const r = resumoDoCheckpoint(muitos)!;
    expect(r.total).toBe(TETO_ARQUIVOS_DO_CHECKPOINT + 5);
    expect(r.arquivos).toHaveLength(TETO_ARQUIVOS_DO_CHECKPOINT);
    expect(r.arquivos[0]).toEqual({ caminho: "~/nod/B/0", acao: "criado" });
  });

  it("resumo: nome que o servidor recusaria vira o marcador, e o resumo continua válido (revisão 2, B5)", () => {
    const r = resumoDoCheckpoint([{ chave: "nod/B/a\tb.md", acao: "criado" }, { chave: "nod/B/ok.md", acao: "mudado" }])!;
    expect(r.arquivos.map((a) => a.caminho)).toEqual([CAMINHO_ILEGIVEL, "~/nod/B/ok.md"]);
    expect(resumoCheckpointValido(r)).toEqual(r);
  });

  it("decisão por arquivo: a regra do 'mudou depois'", () => {
    expect(decidirArquivo({ antes: "A", depois: "D", agora: "D", forcar: false })).toBe("restaurar");
    expect(decidirArquivo({ antes: null, depois: "D", agora: "D", forcar: false })).toBe("restaurar");
    expect(decidirArquivo({ antes: "A", depois: null, agora: null, forcar: false })).toBe("restaurar");
    expect(decidirArquivo({ antes: "A", depois: "D", agora: "A", forcar: false })).toBe("ja_esta");
    expect(decidirArquivo({ antes: null, depois: "D", agora: null, forcar: false })).toBe("ja_esta");
    expect(decidirArquivo({ antes: "A", depois: "D", agora: "X", forcar: false })).toBe("mesclar");
    expect(decidirArquivo({ antes: "A", depois: "D", agora: "X", forcar: true })).toBe("restaurar");
    expect(decidirArquivo({ antes: null, depois: "D", agora: "X", forcar: false })).toBe("conflito");
    expect(decidirArquivo({ antes: "A", depois: "D", agora: null, forcar: false })).toBe("conflito");
    expect(decidirArquivo({ antes: "A", depois: null, agora: "X", forcar: false })).toBe("conflito");
  });

  it("retenção: os 20 mais novos, de até 7 dias", () => {
    const agora = 100 * RETEM_MS;
    const lista = Array.from({ length: 21 }, (_, i) => ({ id: `t${String(i).padStart(2, "0")}`, em: agora - (21 - i) * 1000 }));
    expect(checkpointsVencidos(lista, agora)).toEqual(["t00"]);
    expect(checkpointsVencidos([{ id: "velho", em: agora - RETEM_MS - 1 }, { id: "novo", em: agora }], agora)).toEqual(["velho"]);
  });
});
