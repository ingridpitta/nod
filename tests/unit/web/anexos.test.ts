import { describe, expect, it } from "vitest";
import { ANEXOS_POR_MENSAGEM, MIME_PDF as MIME_PDF_SRC, MIMES_IMAGEM as IMAGEM_SRC, MIMES_TEXTO as TEXTO_SRC, TAMANHO_MAX_ANEXO } from "../../../src/contracts/anexo.ts";
import { MIME_PDF, MIMES_IMAGEM, MIMES_TEXTO, mimeDe, motivoRecusa, POR_MENSAGEM, renderAnexosDaMensagem, renderCardArquivo, renderItens, resumo, retirarDaFila, contarNaFila, prontosDaFila, soltarEhDoChat, seletorDoClipe, TAMANHO_MAX, type ItemAnexo } from "../../../web/lib/anexos.ts";
import { htmlComposer } from "../../../web/telas/conversa.ts";

describe("anexos na web (ADR-046)", () => {
  it("o espelho da web é igual ao contrato do servidor", () => {
    expect(TAMANHO_MAX).toBe(TAMANHO_MAX_ANEXO);
    expect(POR_MENSAGEM).toBe(ANEXOS_POR_MENSAGEM);
    expect([...MIMES_IMAGEM]).toEqual([...IMAGEM_SRC]);
    expect([...MIMES_TEXTO]).toEqual([...TEXTO_SRC]);
    expect(MIME_PDF).toBe(MIME_PDF_SRC);
  });

  it("tipo vazio do navegador cai na extensão; recusas dizem o porquê", () => {
    expect(mimeDe({ name: "notas.md", type: "" })).toBe("text/markdown");
    expect(mimeDe({ name: "x.bin", type: "application/octet-stream" })).toBe("application/octet-stream");
    expect(motivoRecusa({ name: "v.mov", type: "video/quicktime", size: 10 }, "tudo")).toBe("Tipo não aceito. Use imagem, PDF ou texto.");
    expect(motivoRecusa({ name: "c.pdf", type: "application/pdf", size: 10 }, "sem_pdf")).toBe("Este agente roda no Codex, que não lê PDF.");
    expect(motivoRecusa({ name: "g.png", type: "image/png", size: TAMANHO_MAX + 1 }, "tudo")).toBe("Acima de 10 MB.");
    expect(motivoRecusa({ name: "g.png", type: "image/png", size: 100 }, "tudo")).toBeNull();
  });

  it("cartões escapam o nome e mostram progresso, erro e resumo", () => {
    const html = renderItens([
      { chave: "k1", nome: "<b>x</b>.pdf", mime: "application/pdf", tamanho: 312 * 1024, estado: "pronto", progresso: 1 },
      { chave: "k2", nome: "n.md", mime: "text/markdown", tamanho: 10, estado: "enviando", progresso: 0.62 },
      { chave: "k3", nome: "v.mov", mime: "video/quicktime", tamanho: 10, estado: "erro", progresso: 0, erro: "Tipo não aceito." },
    ]);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;.pdf");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("312 KB");
    expect(html).toContain("width:62%");
    expect(html).toContain('role="alert"');
    expect(html.match(/data-act="remover-anexo"/g)).toHaveLength(3);
    expect(resumo([{ chave: "a", nome: "a", mime: "image/png", tamanho: 1024 * 1024, estado: "pronto", progresso: 1 }])).toBe(`1 de ${POR_MENSAGEM} · 1,0 MB`);
  });

  it("mensagem enviada: imagem vira miniatura em aba nova; PDF vira card com prévia e Baixar (NOD-327)", () => {
    const html = renderAnexosDaMensagem([{ id: "i", nome: "p.png", mime: "image/png", tamanho: 1 }, { id: "d", nome: "c.pdf", mime: "application/pdf", tamanho: 2048 }], (id) => `/u/${id}`);
    expect(html).toContain('<img src="/u/i" alt="p.png"');
    expect(html.match(/target="_blank" rel="noopener"/g)).toHaveLength(1);
    expect(html).toContain('<button type="button" class="msg-arquivo-abrir" data-act="previa-arquivo" data-id="d" data-url="/u/d" data-nome="c.pdf" data-mime="application/pdf" aria-haspopup="dialog"');
    expect(html).toContain('<a class="msg-arquivo-baixar" href="/u/d" download="c.pdf" aria-label="Baixar c.pdf"');
    expect(html).toContain('class="arq-ic arq-pdf"');
    expect(html).toContain("2 KB");
  });

  it("card de arquivo (NOD-327): CSV abre prévia; txt, md e json só com Baixar; nome hostil sai escapado", () => {
    const csv = renderCardArquivo({ id: "c", nome: "vendas.csv", mime: "text/csv", tamanho: 10 }, "/u/c");
    expect(csv).toContain('data-act="previa-arquivo"');
    expect(csv).toContain('class="arq-ic arq-planilha"');
    for (const [nome, mime] of [["n.txt", "text/plain"], ["n.md", "text/markdown"], ["n.json", "application/json"]] as const) {
      const html = renderCardArquivo({ id: "x", nome, mime, tamanho: 10 }, "/u/x");
      expect(html).not.toContain("data-act=");
      expect(html).toContain('class="msg-arquivo-abrir sem-previa"');
      expect(html).toContain(`download="${nome}"`);
    }
    const hostil = renderCardArquivo({ id: 'x"y', nome: '<img src=x onerror=1>".csv', mime: "text/csv", tamanho: 1 }, "/u/x");
    expect(hostil).not.toContain("<img");
    expect(hostil).toContain('data-id="x&quot;y"');
  });

  it("composer: clipe só com anexos; Codex aceita sem PDF; sala segue sem clipe", () => {
    expect(htmlComposer("x")).not.toContain('data-act="anexar"');
    const tudo = htmlComposer("x", [], { anexos: "tudo" });
    expect(tudo).toContain('data-act="anexar"');
    expect(tudo).toContain("application/pdf");
    const codex = htmlComposer("x", [], { anexos: "sem_pdf" });
    expect(codex).not.toContain("application/pdf");
    expect(codex).toContain("Este agente roda no Codex");
  });
});

describe("retirarDaFila (ADA-5: o envio da pílula tira os anexos antes do await e devolve na falha)", () => {
  const item = (id: string, estado: ItemAnexo["estado"] = "pronto"): ItemAnexo => ({ chave: id, nome: `${id}.png`, mime: "image/png", tamanho: 1, estado, progresso: 1, ...(estado === "pronto" ? { meta: { id, nome: `${id}.png`, mime: "image/png", tamanho: 1 } as NonNullable<ItemAnexo["meta"]> } : {}) });
  it("tira só os ids pedidos, da mesma lista e só da conversa dada", () => {
    const a = item("a"); const b = item("b"); const subindo = item("c", "enviando"); const outra = item("x");
    const lista = [a, subindo, b];
    const filas = new Map([["c1", lista], ["c2", [outra]]]);
    const r = retirarDaFila(filas, "c1", ["a", "b"]);
    expect(r.saem).toEqual([a, b]);
    expect(filas.get("c1")).toBe(lista);
    expect(lista).toEqual([subindo]);
    expect(filas.get("c2")).toEqual([outra]);
  });
  it("devolver põe de volta na frente, sem perder o que chegou durante o voo nem duplicar", () => {
    const a = item("a"); const novo = item("n");
    const filas = new Map([["c1", [a]]]);
    const r = retirarDaFila(filas, "c1", ["a"]);
    filas.get("c1")!.push(novo);
    r.devolver();
    r.devolver();
    expect(filas.get("c1")).toEqual([a, novo]);
  });
  it("devolver recria a fila da conversa que foi limpa durante o voo", () => {
    const a = item("a");
    const filas = new Map([["c1", [a]]]);
    const r = retirarDaFila(filas, "c1", ["a"]);
    filas.delete("c1");
    r.devolver();
    expect(filas.get("c1")).toEqual([a]);
  });
});

describe("revisão 5 do ADA-5: as regras da fila que a pílula pede ao main", () => {
  const item = (estado: ItemAnexo["estado"], id?: string): ItemAnexo => ({ chave: id ?? estado, nome: "a.png", mime: "image/png", tamanho: 1, estado, progresso: 1,
    ...(id ? { meta: { id, nome: "a.png", mime: "image/png", tamanho: 1 } as unknown as NonNullable<ItemAnexo["meta"]> } : {}) });
  it("o chip com erro não conta (não esconde o Parar)", () => {
    expect(contarNaFila([item("erro"), item("pronto", "a"), item("enviando")])).toBe(2);
  });
  it("prontos: com upload em curso, null; senão só os ids prontos", () => {
    expect(prontosDaFila([item("pronto", "a"), item("enviando")])).toBeNull();
    expect(prontosDaFila([item("pronto", "a"), item("erro"), item("pronto", "b")])).toEqual(["a", "b"]);
  });
  it("o soltar do chat cede ao da pílula (defaultPrevented) e pede o campo do chat e arquivos", () => {
    const ev = (defaultPrevented: boolean, types = ["Files"]) => ({ defaultPrevented, dataTransfer: { types } });
    expect(soltarEhDoChat(ev(false), true)).toBe(true);
    expect(soltarEhDoChat(ev(true), true)).toBe(false);
    expect(soltarEhDoChat(ev(false), false)).toBe(false);
    expect(soltarEhDoChat(ev(false, ["text/plain"]), true)).toBe(false);
  });
  it("o clipe no Quadro abre o seletor da pílula; fora, o do chat", () => {
    expect(seletorDoClipe({ closest: (s) => (s === "#quadro" ? {} : null) })).toBe('#quadro .qc-pil [data-composer="arquivos"]');
    expect(seletorDoClipe({ closest: () => null })).toBe("#composer-arquivos");
  });
});
