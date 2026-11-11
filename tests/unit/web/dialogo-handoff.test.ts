import { describe, expect, it } from "vitest";
import { haQuanto, htmlDoHandoff, linhaDoResponsavel, type DadosDoHandoff } from "../../../web/telas/dialogo-handoff.ts";

const AGORA = Date.parse("2026-11-10T12:00:00Z");
const base: DadosDoHandoff = { codigo: "ENG-9", coluna: "Em revisão", agenteId: "z", passa: true, aciona: true, deNome: "Dev 1", paraNome: "Ze 1", anterior: null, texto: null };

describe("diálogo de handoff (2026-11-10, o confirm do Multica)", () => {
  it("o título e a linha de quem pega: troca e começa, só troca, o mesmo começa", () => {
    const h = htmlDoHandoff(base, AGORA);
    expect(h).toContain("Mover ENG-9 para Em revisão?");
    expect(h).toContain("O responsável muda de Dev 1 para Ze 1, que começa na hora.");
    expect(h).toContain(">Mover para Em revisão<");
    expect(h).toContain(">Cancelar<");
    expect(linhaDoResponsavel({ ...base, aciona: false })).toBe("O responsável muda de Dev 1 para Ze 1.");
    expect(linhaDoResponsavel({ ...base, passa: false, deNome: "Ze 1" })).toBe("Ze 1 continua responsável e começa nesta etapa.");
  });
  it("o run de quem estava: rodando oferece Parar; na fila, Cancelar; sem run, nada", () => {
    const rodando = htmlDoHandoff({ ...base, anterior: { agenteNome: "Dev 1", estado: "rodando", desde: AGORA - 3 * 60_000 } }, AGORA);
    expect(rodando).toContain("Dev 1 ainda está trabalhando (há 3 min)");
    expect(rodando).toContain("Parar o run do Dev 1");
    expect(rodando).toContain("se não parar, os dois trabalham na tarefa ao mesmo tempo");
    const fila = htmlDoHandoff({ ...base, anterior: { agenteNome: "Dev 1", estado: "fila", desde: AGORA } }, AGORA);
    expect(fila).toContain("Cancelar o run na fila do Dev 1");
    expect(fila).toContain("Se não cancelar, ele ainda começa depois.");
    expect(htmlDoHandoff(base, AGORA)).not.toContain('name="parar"');
  });
  it("o que o próximo recebe fica recolhido, escapado", () => {
    const h = htmlDoHandoff({ ...base, texto: "Etapa: Em revisão. <b>x</b>" }, AGORA);
    expect(h).toContain("<details class=\"qd-ho-recebe\"><summary>O que o Ze 1 recebe</summary>");
    expect(h).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
  it("haQuanto", () => {
    expect(haQuanto(AGORA - 10_000, AGORA)).toBe("há menos de 1 min");
    expect(haQuanto(AGORA - 125 * 60_000, AGORA)).toBe("há 2 h");
  });
});
