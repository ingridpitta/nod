import { describe, expect, it } from "vitest";
import { renderCardArquivo } from "../../../web/lib/anexos.ts";
import { acaoDoAlvo, indiceNaLuz } from "../../../web/lib/link-anexo.ts";

/** NOD-323 (Codex no #507): o link nod-anexo acha a 4ª imagem (atrás do "+N") e o cartão do PDF/zip. */
describe("o alvo do link nod-anexo", () => {
  const luz = JSON.stringify(["a", "b", "c", "d", "e"].map((id) => ({ id, nome: `${id}.png`, mime: "image/png", url: `/u/${id}` })));
  it("acha o item pela lista da tela cheia, inclusive o que não tem botão à vista", () => {
    expect(indiceNaLuz(luz, "a")).toBe(0);
    expect(indiceNaLuz(luz, "e")).toBe(4);
    expect(indiceNaLuz(luz, "x")).toBe(-1);
  });
  it("lista ausente ou quebrada: não está na tela cheia", () => {
    expect(indiceNaLuz(undefined, "a")).toBe(-1);
    expect(indiceNaLuz("{", "a")).toBe(-1);
    expect(indiceNaLuz('{"id":"a"}', "a")).toBe(-1);
    expect(indiceNaLuz("[null, 1]", "a")).toBe(-1);
  });
  it("o cartão do arquivo leva o id do anexo (o PDF e o zip da fala)", () => {
    expect(renderCardArquivo({ id: "p1", nome: "r.pdf", tamanho: 10, mime: "application/pdf" }, "/u/p1")).toMatch(/^<div class="msg-arquivo" data-anexo-id="p1">/);
  });
  it("o áudio toca pelo botão de play do memo; o cartão abre a prévia ou o link (QA 2 do #507)", () => {
    expect(acaoDoAlvo("midia-abrir", false, false)).toBe("luz");
    expect(acaoDoAlvo("midia-audio", false, false)).toBe("tocar");
    expect(acaoDoAlvo(undefined, true, true)).toBe("previa");
    expect(acaoDoAlvo(undefined, false, true)).toBe("link");
    expect(acaoDoAlvo(undefined, false, false)).toBe("focar");
  });
});
