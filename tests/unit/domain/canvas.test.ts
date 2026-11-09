import { describe, expect, it } from "vitest";
import {
  conteudosDe,
  hashesDe,
  lerEndereco,
  mesclarComentarios,
  normalizarEstrutura,
  trocarPorHashes,
  validarComentario,
  type EstruturaCanvas,
  type EstruturaEntrada,
} from "../../../src/domain/canvas.ts";

const h = (s: string) => `h:${s}`;
const norm = (b: unknown): EstruturaEntrada => {
  const r = normalizarEstrutura(b);
  if (!r.ok) throw new Error(r.erro);
  return r.estrutura;
};
const comHash = (e: EstruturaEntrada, antes: EstruturaCanvas<string> | null = null): EstruturaCanvas<string> => {
  const r = trocarPorHashes(e, h, antes);
  if (!r.ok) throw new Error(r.erro);
  return r.estrutura;
};
const ids = (e: EstruturaCanvas<unknown>) => e.jornadas.flatMap((j) => j.telas.map((t) => t.id));

describe("canvas: estrutura (ADA-13)", () => {
  it("gera os ids como o motor do Gil: Hoje é Jn-0, as outras contam de 1, o explícito reposiciona", () => {
    const e = norm({
      titulo: "T",
      issue: "ada-13",
      jornadas: [
        { titulo: "A", telas: [{ hoje: true, html: "a0" }, { html: "a1" }, { id: "J1-5", html: "a5" }, { html: "a6" }] },
        { id: "J7", telas: [{ html: "b1" }, { tamanho: "cel", html: "b2" }] },
      ],
    });
    expect(e.issue).toBe("ADA-13");
    expect(e.jornadas.map((j) => j.id)).toEqual(["J1", "J7"]);
    expect(e.jornadas[1]?.titulo).toBe("J7");
    expect(e.jornadas.flatMap((j) => j.telas.map((t) => t.id))).toEqual(["J1-0", "J1-1", "J1-5", "J1-6", "J7-1", "J7-2"]);
    expect(e.jornadas[1]?.telas[1]?.tamanho).toBe("cel");
  });

  it("id de tela em colisão vira 90 + as telas antes dela, como no motor do Gil (revisão 3 M1)", () => {
    const e = norm({ titulo: "T", jornadas: [{ telas: [{ html: "1" }, { id: "J1-1", html: "2" }] }] });
    expect(e.jornadas[0]?.telas.map((t) => t.id)).toEqual(["J1-1", "J1-91"]);
  });

  it("revisão 1 do #649 (M8): id explícito com o prefixo de outra jornada vira o automático", () => {
    const e = norm({ titulo: "T", jornadas: [{ telas: [{ id: "J3-2", html: "1" }] }, { telas: [{ html: "2" }] }] });
    expect(ids(e)).toEqual(["J1-1", "J2-1"]);
    expect(normalizarEstrutura({ titulo: "T", jornadas: [{ telas: [{ id: "J3-2" }] }] }).ok).toBe(false); // sem html e sem id válido
  });

  it("revisão 4 do #649 (baixo 4): o contador anda com o Jx-y de outra jornada, como no Gil", () => {
    const e = norm({ titulo: "T", jornadas: [{ telas: [{ id: "J3-5", html: "1" }, { html: "2" }] }] });
    expect(ids(e)).toEqual(["J1-1", "J1-6"]);
  });

  it("recusa o que não dá para mostrar", () => {
    expect(normalizarEstrutura(null).ok).toBe(false);
    expect(normalizarEstrutura({ jornadas: [{ telas: [{ html: "x" }] }] }).ok).toBe(false); // sem título
    expect(normalizarEstrutura({ titulo: "T", jornadas: [] }).ok).toBe(false);
    expect(normalizarEstrutura({ titulo: "T", jornadas: [{ telas: [] }] }).ok).toBe(false);
    expect(normalizarEstrutura({ titulo: "T", jornadas: [{ telas: [{ titulo: "sem html" }] }] }).ok).toBe(false);
    expect(normalizarEstrutura({ titulo: "T", jornadas: [{ telas: [{ html: "x".repeat(2_000_001) }] }] }).ok).toBe(false);
    expect(normalizarEstrutura({ titulo: "T", jornadas: Array.from({ length: 41 }, () => ({ telas: [{ html: "x" }] })) }).ok).toBe(false);
    expect(normalizarEstrutura({ titulo: "T", jornadas: [{ telas: Array.from({ length: 241 }, () => ({ html: "x" })) }] }).ok).toBe(false);
  });

  it("links só http(s) ou relativos; miniatura só data:image em base64", () => {
    const e = norm({
      titulo: "T",
      links: [{ rotulo: "ok", href: "https://x.y" }, { rotulo: "rel", href: "../outro/" }, { rotulo: "js", href: "javascript:alert(1)" }, { rotulo: "data", href: "data:text/html,x" }, { rotulo: "proto", href: "//evil.com" }, { rotulo: "nl", href: "java\nscript:alert(1)" }, { rotulo: "c0", href: "\u0001javascript:alert(1)" }, { rotulo: "tab", href: "java\tscript:x" }],
      jornadas: [{ telas: [{ html: "x", miniatura: "data:image/webp;base64,AAAA" }, { html: "y", miniatura: "data:text/html;base64,AAAA" }] }],
    });
    expect(e.links.map((l) => l.rotulo)).toEqual(["ok", "rel"]);
    expect(e.jornadas[0]?.telas.map((t) => t.miniatura)).toEqual(["data:image/webp;base64,AAAA", null]);
  });

  it("notas só com texto, presas a jornada que existe", () => {
    const e = norm({ titulo: "T", notas: [{ texto: "a", jornada: "j1" }, { texto: "" }, { texto: "b", jornada: "J9" }], jornadas: [{ telas: [{ html: "x" }] }] });
    expect(e.notas).toEqual([{ titulo: null, texto: "a", jornada: "J1" }, { titulo: null, texto: "b", jornada: null }]);
  });
});

describe("canvas: versão e hashes", () => {
  const v1 = comHash(norm({ titulo: "T", css: ["c"], jornadas: [{ telas: [{ html: "a", miniatura: "data:image/png;base64,AA" }, { html: "b" }] }] }));

  it("tela sem html reusa o hash e a miniatura da anterior; css vazio reusa o anterior", () => {
    const v2 = comHash(norm({ titulo: "T", jornadas: [{ telas: [{ id: "J1-1" }, { id: "J1-2", html: "b2" }] }] }), v1);
    expect(v2.jornadas[0]?.telas.map((t) => [t.html, t.miniatura])).toEqual([["h:a", "h:data:image/png;base64,AA"], ["h:b2", null]]);
    expect(v2.css).toEqual(["h:c"]);
    expect(hashesDe(v2).sort()).toEqual(["h:a", "h:b2", "h:c", "h:data:image/png;base64,AA"]);
  });

  it("tela sem html que não existia é erro", () => {
    expect(trocarPorHashes(norm({ titulo: "T", jornadas: [{ telas: [{ id: "J1-9" }] }] }), h, v1).ok).toBe(false);
    expect(trocarPorHashes(norm({ titulo: "T", jornadas: [{ telas: [{ id: "J1-1" }] }] }), h, null).ok).toBe(false);
  });

  it("html novo não leva a miniatura velha", () => {
    const v2 = comHash(norm({ titulo: "T", jornadas: [{ telas: [{ id: "J1-1", html: "a2" }] }] }), v1);
    expect(v2.jornadas[0]?.telas[0]?.miniatura).toBeNull();
  });

  it("conteudosDe lista o que vira blob", () => {
    expect(conteudosDe(norm({ titulo: "T", css: ["c"], js: ["j"], jornadas: [{ telas: [{ html: "a", miniatura: "data:image/png;base64,AA" }] }] })).sort()).toEqual(["a", "c", "data:image/png;base64,AA", "j"]);
  });
});

describe("canvas: comentários", () => {
  const v = comHash(norm({ titulo: "T", jornadas: [{ telas: [{ html: "a" }, { html: "b" }] }, { telas: [{ html: "c" }] }] }));

  it("versão nova arquiva o que saiu, desarquiva o que voltou, não mexe no resto", () => {
    const so1 = comHash(norm({ titulo: "T", jornadas: [{ telas: [{ html: "a" }] }] }));
    expect(ids(so1)).toEqual(["J1-1"]);
    const cs = [
      { id: "p1", telaId: "J1-1", jornada: "J1", arquivado: false },
      { id: "p2", telaId: "J1-2", jornada: "J1", arquivado: false },
      { id: "n2", telaId: null, jornada: "J2", arquivado: false },
      { id: "volta", telaId: "J1-1", jornada: "J1", arquivado: true },
    ];
    expect(mesclarComentarios(so1, cs)).toEqual({ arquivar: ["p2", "n2"], desarquivar: ["volta"] });
    expect(mesclarComentarios(v, cs)).toEqual({ arquivar: [], desarquivar: ["volta"] });
  });

  it("lê #Jx-y e #Jx", () => {
    expect(lerEndereco("#j1-2")).toEqual({ tela: "J1-2", jornada: "J1" });
    expect(lerEndereco("J3")).toEqual({ tela: null, jornada: "J3" });
    expect(lerEndereco("#X1")).toBeNull();
    expect(lerEndereco("J1-2-3")).toBeNull();
  });

  it("pino precisa de tela que existe e x,y em [0,1]; nota vai na jornada; resposta herda", () => {
    expect(validarComentario(v, { endereco: "#J1-2", texto: "oi", x: 0.1, y: 0.9 })).toEqual({ ok: true, comentario: { telaId: "J1-2", jornada: "J1", tipo: "pino", x: 0.1, y: 0.9, texto: "oi", paiId: null } });
    expect(validarComentario(v, { endereco: "#J1-2", texto: "oi" })).toMatchObject({ ok: true, comentario: { x: 0.5, y: 0.5 } });
    expect(validarComentario(v, { endereco: "#J1-2", texto: "oi", x: 2 }).ok).toBe(false);
    expect(validarComentario(v, { endereco: "#J1-2", texto: "oi", x: Number.NaN }).ok).toBe(false);
    expect(validarComentario(v, { endereco: "#J1-9", texto: "oi" }).ok).toBe(false);
    expect(validarComentario(v, { endereco: "#J5", texto: "oi" }).ok).toBe(false);
    expect(validarComentario(v, { endereco: "#J2", texto: "post-it" })).toMatchObject({ ok: true, comentario: { tipo: "nota", jornada: "J2", telaId: null } });
    expect(validarComentario(v, { endereco: "#J1-1", tipo: "nota", texto: "n" })).toMatchObject({ ok: true, comentario: { tipo: "nota", jornada: "J1", telaId: null } });
    expect(validarComentario(v, { paiId: "abc", texto: "resp" })).toMatchObject({ ok: true, comentario: { paiId: "abc" } });
    expect(validarComentario(v, { endereco: "#J1-1", texto: "  " }).ok).toBe(false);
    expect(validarComentario(v, { endereco: "#J1-1", texto: "x".repeat(4001) }).ok).toBe(false);
    expect(validarComentario(v, { texto: "sem endereço" }).ok).toBe(false);
  });
});
