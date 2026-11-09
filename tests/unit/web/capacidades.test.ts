import { describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import { HARNESS_LEGADO, type CatalogoHarness } from "../../../src/contracts/harness.ts";
import { opcoesDoCatalogo } from "../../../src/domain/harness.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { aceitaDoBot, capacidadesDoBot, mostraCaminhoDaPasta } from "../../../web/lib/capacidades.ts";
import { caminhoDaPastaDoBot } from "../../../web/lib/pasta-do-bot.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";

const catalogo: CatalogoHarness = { padrao: "claude-cli", simulacao: false, legado: HARNESS_LEGADO, opcoes: opcoesDoCatalogo(() => ({ estado: "pronto", versao: "1", em: 0 })) };

describe("NOD-207: a web decide anexo e pasta pelas capacidades do catálogo (ADR-083)", () => {
  it.each([
    [undefined, "tudo"],
    ["auto", "tudo"],
    ["claude-cli", "tudo"],
    ["codex-cli", "sem_pdf"],
    ["cursor-cli", undefined],
    ["hermes", undefined],
    ["grok", undefined],
  ])("com o catálogo, o composer do bot %j aceita %j (igual à regra antiga por id)", (harness, aceita) => {
    expect(aceitaDoBot(catalogo, harness)).toBe(aceita);
  });

  it("sem o catálogo: o bot auto/sem harness segue anexando tudo; o fixo não ganha anexo até o catálogo chegar", () => {
    for (const c of [null, undefined]) {
      expect(aceitaDoBot(c, undefined)).toBe("tudo");
      expect(aceitaDoBot(c, "auto")).toBe("tudo");
      for (const h of ["claude-cli", "codex-cli", "cursor-cli"]) expect(aceitaDoBot(c, h)).toBeUndefined();
      expect(capacidadesDoBot(c, "claude-cli")).toBeNull();
    }
  });

  it.each([
    [undefined, true],
    ["auto", true],
    ["claude-cli", true],
    ["codex-cli", true],
    ["cursor-cli", false],
    ["hermes", false],
  ])("a gaveta do bot %j mostra o caminho da pasta: %j", (harness, mostra) => {
    expect(mostraCaminhoDaPasta(catalogo, harness)).toBe(mostra);
  });

  it("sem o catálogo, só o bot auto/sem harness mostra o caminho", () => {
    expect(mostraCaminhoDaPasta(null, "auto")).toBe(true);
    expect(mostraCaminhoDaPasta(undefined, undefined)).toBe(true);
    expect(mostraCaminhoDaPasta(null, "claude-cli")).toBe(false);
    expect(mostraCaminhoDaPasta(null, "codex-cli")).toBe(false);
  });

  describe("a gaveta (renderDetalhes)", () => {
    type AgenteFrota = FrotaDto["agentes"][number];
    const bot = (harness: string): AgenteFrota => ({ tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Nina", titulo: "", descricao: "", dono: "pessoa", forma: "shape-square", cor: "c-purple", fixado: false, oculto: false, confirmado: true, modelo: "auto", harness, duplicadoDe: null, criadoEm: 0, conversaId: "c1", descricaoEstado: "", computadorForaDoAr: null, ultimaMensagem: null }) as AgenteFrota;
    const com = (harness: string): Estado => ({ ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" }, executor: { atual: "claude-cli", opcoes: [], recusa: null, harnesses: catalogo }, frota: { agentes: [bot(harness)], inventario: { estado: "pronto", versao: "1", em: 0 }, negacoes: [] }, tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" }, abaGaveta: { a1: "biblioteca" } } as Estado);
    // ADR-125 (emenda NOD-326): a Pasta de trabalho mora no topo da aba Biblioteca, para a dona.
    const caminho = `<code>${caminhoDaPastaDoBot("Nina")}</code>`;

    // ADR-103: o Codex trabalha na pasta do bot como o Claude; o Cursor (sem driver) mostra só a linha.
    it("Claude, Codex e auto mostram o caminho; Cursor mostra só a linha", () => {
      for (const h of ["claude-cli", "codex-cli", "auto"]) expect(renderDetalhes(com(h))).toContain(caminho);
      const html = renderDetalhes(com("cursor-cli"));
      expect(html).toContain("Pasta de trabalho");
      expect(html).not.toContain(caminho);
    });
  });
});
