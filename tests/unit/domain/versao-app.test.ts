import { expect, it } from "vitest";
import { versaoAceita } from "../../../src/domain/versao-app.ts";

it("candidata mais nova conecta ao servidor anterior; candidata não satisfaz mínimo estável da mesma versão", () => {
  expect(versaoAceita("0.2.0-rc.1", "0.1.0")).toBe(true);
  expect(versaoAceita("0.2.0-rc.1", "0.2.0")).toBe(false);
  expect(versaoAceita("0.2.0", "0.2.0-rc.1")).toBe(true);
  expect(versaoAceita("0.2.0-rc.2", "0.2.0-rc.1")).toBe(true);
  expect(versaoAceita("0.2.0-rc.1", "0.2.0-rc.2")).toBe(false);
  expect(versaoAceita("0.2.0-rc.1", "0.2.0-rc.1")).toBe(true);
});

it("atual e mínima inválidas falham fechado", () => {
  for (const v of [null, "", "1.2", "01.2.0", "1.2.0-rc.01", "1.2.0-rc.x", "1.2.0-beta.1", "1.2.0-rc.9007199254740992"]) {
    expect(versaoAceita(v, "0.1.0")).toBe(false);
    if (typeof v === "string") expect(versaoAceita("1.2.0", v)).toBe(false);
  }
});

it("NOD-297: minor e patch sem -rc sobem acima das candidatas anteriores", () => {
  expect(versaoAceita("0.5.0", "0.1.0")).toBe(true);
  expect(versaoAceita("0.5.0", "0.4.0-rc.13")).toBe(true);
  expect(versaoAceita("0.4.0-rc.13", "0.5.0")).toBe(false);
  expect(versaoAceita("0.5.1", "0.5.0")).toBe(true);
});
