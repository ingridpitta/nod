import { describe, expect, it } from "vitest";
import { perfilMudou, type PerfilDaFrota } from "../../../web/lib/perfil-mudou.ts";

// definido em 2026-10-30 (NOD-20, revisão 2 M6): mudança de fora no perfil faz o Histórico aberto reler.
const base: PerfilDaFrota = { nome: "Vera", titulo: "Revisora", descricao: "Revisa", forma: "shape-square", cor: "c-blue", voz: null, vozVelocidade: 1 };

describe("perfilMudou", () => {
  it("igual (null e vazio, voz ausente e null) não muda", () => {
    expect(perfilMudou(base, { ...base })).toBe(false);
    expect(perfilMudou({ ...base, titulo: null }, { ...base, titulo: "" })).toBe(false);
    expect(perfilMudou({ ...base, voz: undefined, vozVelocidade: undefined }, base)).toBe(false);
  });
  it("cada campo versionável muda", () => {
    for (const d of [{ nome: "X" }, { titulo: "X" }, { descricao: "X" }, { forma: "shape-circle" }, { cor: "c-red" }, { voz: "luna" }, { vozVelocidade: 1.25 }]) {
      expect(perfilMudou(base, { ...base, ...d }), JSON.stringify(d)).toBe(true);
    }
  });
  it("sem um dos lados (bot novo ou saiu da frota) não relê", () => {
    expect(perfilMudou(undefined, base)).toBe(false);
    expect(perfilMudou(base, undefined)).toBe(false);
  });
});
