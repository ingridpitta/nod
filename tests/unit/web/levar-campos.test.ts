import { describe, expect, it } from "vitest";
import { levarCampos, type CampoDoBloco } from "../../../web/lib/levar-campos.ts";

/** NOD-345 (revisão do PR 504): refazer o bloco do cartão ("Conferindo…", "Restam N") não apaga o que foi digitado. */
const campo = (name: string, value = "", type = "text", defaultValue = ""): CampoDoBloco => ({ name, type, value, defaultValue });
const bloco = (...campos: CampoDoBloco[]) => ({ querySelectorAll: () => campos });

describe("levarCampos", () => {
  it("o código errado e o e-mail ficam no bloco novo (só no DOM)", () => {
    const novoCodigo = campo("codigo");
    const novoEmail = campo("email", "", "email");
    levarCampos(bloco(campo("codigo", "123456"), campo("email", "a@b.com", "email")), bloco(novoCodigo, novoEmail));
    expect(novoCodigo.value).toBe("123456");
    expect(novoEmail.value).toBe("a@b.com");
  });

  it("a senha também fica (é o mesmo campo, a pessoa só corrige)", () => {
    const nova = campo("senha", "", "password");
    levarCampos(bloco(campo("senha", "segredo-longo-1", "password")), bloco(nova));
    expect(nova.value).toBe("segredo-longo-1");
  });

  it("não leva para campo de outro nome, nem por cima de valor do HTML novo, nem campo escondido", () => {
    const outro = campo("nova");
    const comValor = campo("codigo", "", "text", "999999");
    const escondido = campo("token", "", "hidden");
    levarCampos(bloco(campo("senha", "x"), campo("codigo", "123456"), campo("token", "t", "hidden")), bloco(outro, comValor, escondido));
    expect(outro.value).toBe("");
    expect(comValor.value).toBe("");
    expect(escondido.value).toBe("");
  });
});
