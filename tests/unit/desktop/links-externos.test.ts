import { expect, it } from "vitest";
import { abreNoNavegador } from "../../../desktop/links-externos.ts";

/** ADR-053: o link do bot sai do app para o navegador padrão; só http(s), e nunca com usuário e senha. */
it("só http e https saem do app para o navegador", () => {
  expect(abreNoNavegador("https://acme-workspace.slack.com/archives/D068V6P6R5X/p1790624332178009")).toBe(true);
  expect(abreNoNavegador("http://localhost:5274/")).toBe(true);
  expect(abreNoNavegador("file:///Users/marlon/.ssh/config")).toBe(false);
  expect(abreNoNavegador("javascript:alert(1)")).toBe(false);
  expect(abreNoNavegador("slack://channel?id=C1")).toBe(false);
  expect(abreNoNavegador("https://github.com@github-login.co/entrar")).toBe(false);
  expect(abreNoNavegador("não é endereço")).toBe(false);
});
