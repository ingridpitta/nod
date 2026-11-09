import { describe, expect, it } from "vitest";
import { estadoDoMicrofone, lerEmLigacao, permitirChecagemDeMidia, permitirPedidoDeMidia } from "../../../desktop/permissoes-midia.ts";

/**
 * O microfone da janela web (definido em 2026-10-04, ADR-071): a página remota ganha só `media` de áudio, na origem do
 * servidor configurado e no frame de topo. Todo o resto continua negado, como antes do modo ligação.
 */
const servidor = "https://nod.acme.com.br";

describe("pedido de mídia (setPermissionRequestHandler)", () => {
  const base = { permissao: "media", tiposDeMidia: ["audio"], urlDoPedido: "https://nod.acme.com.br/", frameDeTopo: true, servidor };

  it("libera só áudio, na origem do servidor, no frame de topo", () => {
    expect(permitirPedidoDeMidia(base)).toBe(true);
  });

  it("recusa vídeo, áudio com vídeo e pedido sem tipo", () => {
    expect(permitirPedidoDeMidia({ ...base, tiposDeMidia: ["video"] })).toBe(false);
    expect(permitirPedidoDeMidia({ ...base, tiposDeMidia: ["audio", "video"] })).toBe(false);
    expect(permitirPedidoDeMidia({ ...base, tiposDeMidia: [] })).toBe(false);
    expect(permitirPedidoDeMidia({ ...base, tiposDeMidia: undefined })).toBe(false);
  });

  it("recusa outro frame (o iframe do artefato), outra origem e sem servidor configurado", () => {
    expect(permitirPedidoDeMidia({ ...base, frameDeTopo: false })).toBe(false);
    expect(permitirPedidoDeMidia({ ...base, urlDoPedido: "https://nod.acme.com.br.evil.com/" })).toBe(false);
    expect(permitirPedidoDeMidia({ ...base, urlDoPedido: "http://nod.acme.com.br/" })).toBe(false);
    expect(permitirPedidoDeMidia({ ...base, urlDoPedido: "about:srcdoc" })).toBe(false);
    expect(permitirPedidoDeMidia({ ...base, servidor: undefined })).toBe(false);
  });

  it("recusa qualquer outra permissão, mesmo na origem certa", () => {
    for (const permissao of ["notifications", "geolocation", "display-capture", "clipboard-read", "openExternal"]) expect(permitirPedidoDeMidia({ ...base, permissao })).toBe(false);
  });
});

describe("checagem de mídia (setPermissionCheckHandler)", () => {
  const base = { permissao: "media", tipoDeMidia: "audio", origem: "https://nod.acme.com.br", frameDeTopo: true, servidor };

  it("só áudio, origem do servidor, frame de topo", () => {
    expect(permitirChecagemDeMidia(base)).toBe(true);
    expect(permitirChecagemDeMidia({ ...base, tipoDeMidia: "video" })).toBe(false);
    expect(permitirChecagemDeMidia({ ...base, tipoDeMidia: "unknown" })).toBe(false);
    expect(permitirChecagemDeMidia({ ...base, frameDeTopo: false })).toBe(false);
    expect(permitirChecagemDeMidia({ ...base, origem: "https://outro.com" })).toBe(false);
    expect(permitirChecagemDeMidia({ ...base, permissao: "notifications" })).toBe(false);
  });
});

describe("acesso do macOS e argumentos da ponte", () => {
  it("o status do sistema vira três palavras; 'not-determined' pede", () => {
    expect(estadoDoMicrofone("granted")).toBe("concedido");
    expect(estadoDoMicrofone("denied")).toBe("negado");
    expect(estadoDoMicrofone("restricted")).toBe("restrito");
    expect(estadoDoMicrofone("not-determined")).toBeNull();
    expect(estadoDoMicrofone("unknown")).toBe("negado");
  });

  it("emLigacao só aceita boolean", () => {
    expect(lerEmLigacao(true)).toBe(true);
    expect(lerEmLigacao(false)).toBe(false);
    expect(lerEmLigacao("true")).toBeNull();
    expect(lerEmLigacao(1)).toBeNull();
    expect(lerEmLigacao(undefined)).toBeNull();
  });
});
