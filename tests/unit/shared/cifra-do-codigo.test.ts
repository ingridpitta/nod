import { describe, expect, it } from "vitest";
import { decifrarCodigo, gerarParDoLogin } from "../../../src/shared/cifra-do-codigo.ts";
import { cifrarCodigo } from "../../../web/lib/cifra.ts";

/**
 * ADR-102 item 3: o código do Claude cifrado no navegador (WebCrypto) e decifrado na máquina (node:crypto). O que passa
 * pelo servidor não contém o código em claro; outra chave ou texto alterado não decifram.
 */
describe("o código do login, do navegador à máquina", () => {
  it("ida e volta: o navegador cifra com a chave pública, a máquina decifra; o código não aparece no que viaja", async () => {
    const par = gerarParDoLogin();
    const codigo = "AbCdEf123456#estado-do-oauth_xyz";
    const cifrado = await cifrarCodigo(par.publica, codigo);
    expect(JSON.stringify(cifrado)).not.toContain(codigo);
    expect(decifrarCodigo(par.privada, cifrado)).toBe(codigo);
  });

  it("outra chave, texto alterado ou formato errado não decifram", async () => {
    const par = gerarParDoLogin();
    const cifrado = await cifrarCodigo(par.publica, "codigo-de-teste-123");
    expect(decifrarCodigo(gerarParDoLogin().privada, cifrado)).toBeNull();
    const dados = Buffer.from(cifrado.dados, "base64");
    dados[0] = dados[0]! ^ 0xff;
    expect(decifrarCodigo(par.privada, { ...cifrado, dados: dados.toString("base64") })).toBeNull();
    expect(decifrarCodigo(par.privada, { chave: "QUJD", iv: "QUJD", dados: "QUJD" })).toBeNull();
  });
});
