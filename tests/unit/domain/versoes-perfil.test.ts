import { describe, expect, it } from "vitest";
import type { PerfilVersionavel } from "../../../src/contracts/versoes-perfil.ts";
import { camposQueMudaram, perfilDoAgente, redigirPerfil, temRedacao } from "../../../src/domain/versoes-perfil.ts";

const base: PerfilVersionavel = { nome: "Vera", titulo: "Vendas", descricao: "Cuida do funil.", forma: "shape-hex", cor: "c-purple", voz: null, vozVelocidade: 1 };

describe("versões do perfil (NOD-20)", () => {
  it("perfilDoAgente completa voz e velocidade ausentes", () => {
    const p = perfilDoAgente({ ...base, voz: undefined, vozVelocidade: undefined } as never);
    expect(p.voz).toBeNull();
    expect(p.vozVelocidade).toBe(1);
  });

  it("camposQueMudaram lista só o que difere, na ordem fixa", () => {
    expect(camposQueMudaram(base, base)).toEqual([]);
    expect(camposQueMudaram(base, { ...base, vozVelocidade: 1.5, nome: "Vê" })).toEqual(["nome", "vozVelocidade"]);
    expect(camposQueMudaram(base, { ...base, voz: "luna" })).toEqual(["voz"]);
  });

  it("velocidade igual com ruído de ponto flutuante não conta como mudança", () => {
    expect(camposQueMudaram(base, { ...base, vozVelocidade: 1.0000001 })).toEqual([]);
  });

  it("redigirPerfil tira segredo dos textos e temRedacao percebe", () => {
    const comSegredo = { ...base, descricao: "Use a chave sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCD para chamar." };
    const r = redigirPerfil(comSegredo);
    expect(r.descricao).not.toContain("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCD");
    expect(temRedacao(r)).toBe(true);
    expect(temRedacao(base)).toBe(false);
    expect(redigirPerfil(base)).toEqual(base);
  });

  it("senha= também sai redigida (critério 3) e redigir de novo não muda o marcador", () => {
    const r = redigirPerfil({ ...base, descricao: "Entre com senha=Sup3rSecreta!2026 no painel." });
    expect(r.descricao).not.toContain("Sup3rSecreta!2026");
    expect(temRedacao(r)).toBe(true);
    expect(redigirPerfil(r)).toEqual(r);
  });
});
