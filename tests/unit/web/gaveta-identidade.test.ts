import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { comPendentes, criarFilaDePerfil, criarSalvarAvatar, decidirCampo, desfazerAoFalhar, proximaAba, proximoRadio, sobreporPendentes } from "../../../web/lib/identidade-regras.ts";

/** ADR-125 (NOD-349): as decisões puras da identidade editável na gaveta. */
describe("decidirCampo", () => {
  it("nome vazio (ou só espaço) é erro; subtítulo vazio pode", () => {
    expect(decidirCampo("nome", "   ", "Nina")).toEqual({ tipo: "vazio" });
    expect(decidirCampo("titulo", "", "Antigo")).toEqual({ tipo: "salvar", valor: "" });
  });
  it("igual ao salvo (com espaço em volta) não grava; diferente grava aparado", () => {
    expect(decidirCampo("nome", " Nina ", "Nina")).toEqual({ tipo: "nada" });
    expect(decidirCampo("nome", " Nina 2 ", "Nina")).toEqual({ tipo: "salvar", valor: "Nina 2" });
  });
});

describe("proximoRadio (grade de 4 colunas, 8 itens)", () => {
  it("← → andam um e dão a volta; ↑ ↓ andam uma linha; Home e End vão às pontas", () => {
    expect(proximoRadio(0, 8, 4, "ArrowRight")).toBe(1);
    expect(proximoRadio(0, 8, 4, "ArrowLeft")).toBe(7);
    expect(proximoRadio(1, 8, 4, "ArrowDown")).toBe(5);
    expect(proximoRadio(5, 8, 4, "ArrowDown")).toBe(1);
    expect(proximoRadio(1, 8, 4, "ArrowUp")).toBe(5);
    expect(proximoRadio(3, 8, 4, "Home")).toBe(0);
    expect(proximoRadio(3, 8, 4, "End")).toBe(7);
    expect(proximoRadio(3, 8, 4, "a")).toBeNull();
    expect(proximoRadio(0, 0, 4, "End")).toBeNull();
  });
});

describe("proximaAba", () => {
  it("← → dão a volta; Home e End; outra tecla não faz nada", () => {
    expect(proximaAba(2, 1, "ArrowRight")).toBe(0);
    expect(proximaAba(2, 0, "ArrowLeft")).toBe(1);
    expect(proximaAba(3, 1, "Home")).toBe(0);
    expect(proximaAba(3, 0, "End")).toBe(2);
    expect(proximaAba(3, 0, "ArrowDown")).toBeNull();
    expect(proximaAba(0, 0, "End")).toBeNull();
  });
});

describe("criarSalvarAvatar", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("junta forma e cor tocadas na mesma espera e, depois que o PATCH sai, não reenvia a escolha velha (revisão 2)", () => {
    vi.useFakeTimers();
    const salvos: unknown[] = [];
    const s = criarSalvarAvatar<{ forma?: string; cor?: string }>(async (_id, m) => { salvos.push(m); }, 300);
    s.pedir("a", { forma: "f1" });
    s.pedir("a", { cor: "c1" });
    vi.advanceTimersByTime(300);
    expect(salvos).toEqual([{ forma: "f1", cor: "c1" }]);
    // O popover fechou pelo reducer (sem agora()): o próximo toque manda só o que mudou agora.
    s.pedir("a", { cor: "c2" });
    vi.advanceTimersByTime(300);
    expect(salvos).toEqual([{ forma: "f1", cor: "c1" }, { cor: "c2" }]);
  });
  it("só o último toque de cada bot sai, depois da espera; bots diferentes não se atropelam", async () => {
    vi.useFakeTimers();
    const salvar = vi.fn(async () => {});
    const s = criarSalvarAvatar<{ cor: string }>(salvar, 300);
    s.pedir("a", { cor: "1" });
    vi.advanceTimersByTime(200);
    s.pedir("a", { cor: "2" });
    s.pedir("b", { cor: "x" });
    vi.advanceTimersByTime(299);
    expect(salvar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(salvar.mock.calls).toEqual([["a", { cor: "2" }], ["b", { cor: "x" }]]);
  });
  it("agora() manda já o pendente e não manda de novo depois; sem pendente, não faz nada", () => {
    vi.useFakeTimers();
    const salvar = vi.fn(async () => {});
    const s = criarSalvarAvatar<{ cor: string }>(salvar, 300);
    s.agora("a");
    s.pedir("a", { cor: "3" });
    s.agora("a");
    vi.advanceTimersByTime(1000);
    expect(salvar.mock.calls).toEqual([["a", { cor: "3" }]]);
  });
});

describe("criarFilaDePerfil (revisão: um PATCH antigo não chega depois do novo)", () => {
  const controlavel = () => {
    const chamadas: { agenteId: string; mudanca: Record<string, string>; ok: () => void; falha: (e: unknown) => void }[] = [];
    const salvar = (agenteId: string, mudanca: Record<string, string>) => new Promise<void>((ok, falha) => { chamadas.push({ agenteId, mudanca, ok, falha }); });
    return { chamadas, fila: criarFilaDePerfil<Record<string, string>>(salvar) };
  };
  const tique = () => new Promise((r) => setTimeout(r, 0));

  it("com um pedido em curso, os seguintes esperam e saem juntos, o último valor vencendo", async () => {
    const { chamadas, fila } = controlavel();
    void fila.enviar("a", { cor: "1" });
    void fila.enviar("a", { cor: "2" });
    void fila.enviar("a", { nome: "N" });
    expect(chamadas.map((c) => c.mudanca)).toEqual([{ cor: "1" }]);
    expect(fila.semEspera("a")).toBe(false);
    chamadas[0]!.ok();
    await tique();
    expect(chamadas.map((c) => c.mudanca)).toEqual([{ cor: "1" }, { cor: "2", nome: "N" }]);
    expect(fila.semEspera("a")).toBe(true);
  });

  it("bots diferentes não esperam um pelo outro; a falha rejeita só quem ia naquele pedido", async () => {
    const { chamadas, fila } = controlavel();
    const p1 = fila.enviar("a", { nome: "X" });
    const p2 = fila.enviar("b", { nome: "Y" });
    const p3 = fila.enviar("a", { nome: "Z" });
    expect(chamadas.map((c) => c.agenteId)).toEqual(["a", "b"]);
    chamadas[0]!.falha(new Error("500"));
    await expect(p1).rejects.toThrow("500");
    await tique();
    chamadas[1]!.ok();
    chamadas[2]!.ok();
    await expect(p2).resolves.toBeUndefined();
    await expect(p3).resolves.toBeUndefined();
  });
});

describe("desfazerAoFalhar (revisão: a falha não apaga o que a pessoa digitou depois)", () => {
  it("sem nada novo, volta ao anterior", () => {
    expect(desfazerAoFalhar({ salvo: "Nina 2", valor: "Nina 2" }, "Nina 2", "Nina")).toEqual({ salvo: "Nina", valor: "Nina" });
  });
  it("a pessoa já digita outra coisa: o salvo volta, o texto fica", () => {
    expect(desfazerAoFalhar({ salvo: "Nina 2", valor: "Nina 3 em curso" }, "Nina 2", "Nina")).toEqual({ salvo: "Nina", valor: "Nina 3 em curso" });
  });
  it("outro valor já foi salvo depois: não mexe", () => {
    expect(desfazerAoFalhar({ salvo: "Nina 3", valor: "Nina 3" }, "Nina 2", "Nina")).toBeNull();
  });
});

describe("comPendentes (revisão: a frota relida no meio do salvamento não desfaz a escolha)", () => {
  it("o pendente fica por cima só no bot dele", () => {
    const agentes = [{ id: "a", cor: "velha", nome: "A" }, { id: "b", cor: "x", nome: "B" }];
    expect(comPendentes(agentes, { a: { cor: "nova" } })).toEqual([{ id: "a", cor: "nova", nome: "A" }, { id: "b", cor: "x", nome: "B" }]);
    expect(comPendentes(agentes, {})).toEqual(agentes);
  });
  it("criarSalvarAvatar diz se há toque esperando o debounce", () => {
    vi.useFakeTimers();
    const s = criarSalvarAvatar<{ cor: string }>(async () => {}, 300);
    s.pedir("a", { cor: "1" });
    expect(s.pendente("a")).toBe(true);
    vi.advanceTimersByTime(300);
    expect(s.pendente("a")).toBe(false);
  });
});

describe("sobreporPendentes (revisão 2: a frota relida pelo SSE não desfaz a edição que ainda vai sair)", () => {
  const acao = { tipo: "hidratar-frota" as const, frota: { agentes: [{ id: "a", nome: "Velho", cor: "c0" }, { id: "b", nome: "B", cor: "c9" }], outro: 1 } };
  it("aplica o pendente do bot na frota que chega", () => {
    const r = sobreporPendentes(acao, { a: { nome: "Novo" } });
    expect(r.frota.agentes).toEqual([{ id: "a", nome: "Novo", cor: "c0" }, { id: "b", nome: "B", cor: "c9" }]);
    expect(r.frota.outro).toBe(1);
  });
  it("sem pendente ou com outra ação, devolve a mesma ação", () => {
    expect(sobreporPendentes(acao, {})).toBe(acao);
    const outra = { tipo: "hidratar-gestao", frota: acao.frota };
    expect(sobreporPendentes(outra, { a: { nome: "Novo" } })).toBe(outra);
  });
  it("main.ts passa toda ação de frota por ele: no dispatch e na releitura (reidratar reduz direto)", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toContain("estado = reduzir(estado, sobreporPendentes(acao, perfilPendente));");
    // NOD-370: o dispatch e a releitura passam por `reduzirVendoSaida`, que reduz com `sobreporPendentes`.
    expect(main).toMatch(/function reduzirVendoSaida\(acao: Acao\): boolean \{\s*const antes = estado\.tela;\s*estado = reduzir\(estado, sobreporPendentes\(acao, perfilPendente\)\);/);
    expect(main).toContain("if (acao && reduzirVendoSaida(acao)) saiu = true;");
    expect(main).toContain("const saiu = reduzirVendoSaida(acao);");
    expect(main.match(/reduzir\(estado, acao\)/g) ?? []).toEqual([]);
  });
  it("perfilPendente é declarado antes do dispatch e do primeiro dispatch do carregamento (QA: TDZ derrubava o boot)", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const declaracao = main.indexOf("let perfilPendente");
    expect(declaracao).toBeGreaterThan(-1);
    expect(declaracao).toBeLessThan(main.indexOf("function dispatch("));
    // Todo dispatch de nível superior (fora de função) vem depois da declaração.
    const primeiroDoBoot = main.split("\n").findIndex((l) => /^(try \{ )?dispatch\(|^ {2,4}dispatch\(\{ tipo: "abas-lidas"/.test(l));
    expect(primeiroDoBoot).toBeGreaterThan(main.slice(0, declaracao).split("\n").length);
  });
});
