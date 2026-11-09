import { describe, expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { CANVAS, paginasDoDto } from "../../../web/lib/paginas.ts";
import { renderMensagem } from "../../../web/telas/conversa.ts";
import { renderMarketplace } from "../../../web/telas/marketplace.ts";
import { configurarAppCanvas, guardarAppCanvas, nivelCanvasDe } from "../../../web/telas/marketplace-canvas.ts";

/** ADA-13 (ADR-150): o cartão "Canvas · Do nod", a gaveta com o nível por bot, a pílula e o card no chat. */
const agente = { id: "a1", tenantId: "t", ownerId: "p", nome: "Gil", titulo: "UI/UX", descricao: "", cor: "c-black", forma: "quadrado", conversaId: "c1", confirmado: true } as never;
const base: Estado = { ...estadoInicial, agora: 10_000, sessao: { tenantId: "t", pessoaId: "p" }, tela: { tipo: "conectores" }, frota: { agentes: [agente], negacoes: [] } as never, marketplace: [], composioConfigurado: true };
configurarAppCanvas({ ler: () => null, aoMudar: () => undefined });

describe("Marketplace: Canvas · Do nod", () => {
  it("não instalado: o cartão oferece Instalar e a gaveta explica os dois níveis", () => {
    guardarAppCanvas({ instalado: false, acessos: [] });
    const html = renderMarketplace(base);
    expect(html).toContain('id="app-canvas"');
    expect(html).toContain('data-act="instalar-canvas"');
    const g = renderMarketplace({ ...base, tela: { tipo: "conectores", gaveta: { slug: "canvas", passo: "detalhes" } } });
    expect(g).toContain("Instalar Canvas");
    expect(g).toContain("Ver e comentar");
    expect(g).toContain("Criar e publicar");
    expect(g).not.toContain('data-act="nivel-canvas"');
  });
  it("instalado: o segmentado por bot marca o nível atual; Desinstalar no rodapé", () => {
    guardarAppCanvas({ instalado: true, acessos: [{ agenteId: "a1", nivel: "criar_publicar" }] });
    const g = renderMarketplace({ ...base, tela: { tipo: "conectores", gaveta: { slug: "canvas", passo: "detalhes" } } });
    expect(g).toContain('data-act="nivel-canvas" data-id="a1" data-nivel="criar_publicar" aria-pressed="true"');
    expect(g).toContain('data-nivel="nenhum" aria-pressed="false"');
    expect(g).toContain('data-act="desinstalar-canvas"');
    expect(renderMarketplace(base)).toContain("Gil usa");
    expect(nivelCanvasDe({ instalado: true, acessos: [] }, "a1")).toBe("nenhum");
  });
});

describe("Canvas na pílula e no chat", () => {
  it("a página Canvas entra depois de Tarefas quando o bot tem acesso", () => {
    const dto = { agenteId: "a1", ordem: [], apps: [], temTarefas: true, temCanvas: true, cabeMais: true, limite: 12 };
    expect(paginasDoDto(dto).map((p) => p.id)).toEqual(["conversa", "tarefas", CANVAS.id]);
    expect(paginasDoDto({ ...dto, temCanvas: false }).map((p) => p.id)).toEqual(["conversa", "tarefas"]);
  });
  it("o card do canvas publicado tem o título escapado, as contagens e Abrir", () => {
    const m = {
      id: "m1", conversaId: "c1", kind: "sistema", texto: "", criadoEm: 1, parcial: false,
      autoria: { autor_tipo: "agente", autor_id: "a1" },
      payload: { kind: "canvas", canvasId: "cv1", agenteId: "a1", versao: 2, titulo: "<b>NOD-1</b>", jornadas: 3, telas: 1, importado: true },
    } as unknown as Mensagem;
    const html = renderMensagem(m, { ...base, tela: { tipo: "conversa", conversaId: "c1" } } as never);
    expect(html).toContain("&lt;b&gt;NOD-1&lt;/b&gt;");
    expect(html).toContain("v2 · 3 jornadas · 1 tela · importado");
    expect(html).toContain('data-act="abrir-canvas"');
    expect(html).toContain('data-id="cv1"');
    expect(html).not.toContain("não confiável");
  });
  it("revisão 1 do #649 (A3): o card da versão de turno com conteúdo de fora diz não confiável", () => {
    const m = {
      id: "m2", conversaId: "c1", kind: "sistema", texto: "", criadoEm: 1, parcial: false,
      autoria: { autor_tipo: "agente", autor_id: "a1" },
      payload: { kind: "canvas", canvasId: "cv1", agenteId: "a1", versao: 3, titulo: "X", jornadas: 1, telas: 1, importado: false, confiavel: false },
    } as unknown as Mensagem;
    expect(renderMensagem(m, { ...base, tela: { tipo: "conversa", conversaId: "c1" } } as never)).toContain("não confiável");
  });
});
