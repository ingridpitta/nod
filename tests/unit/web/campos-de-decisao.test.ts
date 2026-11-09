import { describe, expect, it } from "vitest";
import { guardarCampo, restaurarCampo, type CampoDeDecisao } from "../../../web/lib/campos-de-decisao.ts";

/**
 * Checkbox como o HTML o define (modo "default/on" do value): sem o atributo, `value` lê "on";
 * atribuir `value` grava o atributo, que é o que `defaultValue` devolve. É essa regra que fazia
 * a segunda regravação descartar a marca da pessoa.
 */
class CheckboxFalso implements CampoDeDecisao {
  readonly type = "checkbox";
  disabled = false;
  checked: boolean;
  readonly defaultChecked: boolean;
  private atributo: string | null = null;
  constructor(marcadoNoHtml: boolean) {
    this.defaultChecked = marcadoNoHtml;
    this.checked = marcadoNoHtml;
  }
  get value(): string {
    return this.atributo ?? "on";
  }
  set value(v: string) {
    this.atributo = v;
  }
  get defaultValue(): string {
    return this.atributo ?? "";
  }
}

/** Campo de texto: `value` é só o que se digitou; `defaultValue` é o atributo do HTML. */
class TextoFalso implements CampoDeDecisao {
  readonly type = "text";
  disabled = false;
  checked = false;
  readonly defaultChecked = false;
  readonly defaultValue: string;
  value: string;
  constructor(textoNoHtml: string) {
    this.defaultValue = textoNoHtml;
    this.value = textoNoHtml;
  }
}

describe("campos de uma decisão atravessam a regravação da timeline", () => {
  it("o item desmarcado continua desmarcado depois de duas regravações seguidas", () => {
    const antes = new CheckboxFalso(true);
    antes.checked = false;
    const primeira = new CheckboxFalso(true);
    expect(restaurarCampo(primeira, guardarCampo(antes))).toBe(true);
    expect(primeira.defaultValue).toBe("");
    const segunda = new CheckboxFalso(true);
    expect(restaurarCampo(segunda, guardarCampo(primeira))).toBe(true);
    expect(segunda.checked).toBe(false);
  });

  it("o texto digitado volta enquanto o texto do servidor é o mesmo", () => {
    const antes = new TextoFalso("Enviar o relatório");
    antes.value = "Enviar o relatório amanhã";
    const depois = new TextoFalso("Enviar o relatório");
    expect(restaurarCampo(depois, guardarCampo(antes))).toBe(true);
    expect(depois.value).toBe("Enviar o relatório amanhã");
  });

  it("quando o servidor muda o padrão, vale o do servidor", () => {
    const marca = new CheckboxFalso(true);
    marca.checked = false;
    const marcaNova = new CheckboxFalso(false);
    expect(restaurarCampo(marcaNova, guardarCampo(marca))).toBe(false);
    const texto = new TextoFalso("antigo");
    texto.value = "editado";
    const textoNovo = new TextoFalso("outro");
    expect(restaurarCampo(textoNovo, guardarCampo(texto))).toBe(false);
    expect(textoNovo.value).toBe("outro");
  });

  it("campo desabilitado ou de outro tipo não recebe nada", () => {
    const antes = new CheckboxFalso(true);
    antes.checked = false;
    const desabilitado = new CheckboxFalso(true);
    desabilitado.disabled = true;
    expect(restaurarCampo(desabilitado, guardarCampo(antes))).toBe(false);
    expect(desabilitado.checked).toBe(true);
    expect(restaurarCampo(new TextoFalso(""), guardarCampo(antes))).toBe(false);
  });
});
