/**
 * Os campos de uma decisão (a resposta, o texto de cada item, a marca de cada item) atravessam a
 * regravação da timeline: o que a pessoa mexeu é guardado antes e devolvido ao campo novo, desde que o
 * HTML dele não tenha mudado — se o servidor mudou o padrão, vale o do servidor.
 */

/** O campo como o DOM o expõe (o HTMLInputElement satisfaz; o teste usa um falso). */
export type CampoDeDecisao = {
  readonly type: string;
  readonly disabled: boolean;
  readonly defaultValue: string;
  readonly defaultChecked: boolean;
  value: string;
  checked: boolean;
};

export type CampoGuardado = { tipo: string; valor: string; marcado: boolean; inicial: string; marcadoInicial: boolean };

export function guardarCampo(el: CampoDeDecisao): CampoGuardado {
  return { tipo: el.type, valor: el.value, marcado: el.checked, inicial: el.defaultValue, marcadoInicial: el.defaultChecked };
}

/**
 * Devolve ao campo novo o que a pessoa tinha mexido; false quando o campo mudou e o guardado não vale.
 * definido em 2026-10-01: checkbox e radio voltam só pelo `checked`. Atribuir `value` a um checkbox grava o
 * atributo value (modo "default/on" do HTML) e troca o defaultValue; no redesenho seguinte a comparação com
 * o HTML falhava e o item desmarcado de uma aprovação voltava marcado (o PR #99 mediu no WebKit e no Chromium).
 */
export function restaurarCampo(el: CampoDeDecisao, guardado: CampoGuardado): boolean {
  if (el.disabled || el.type !== guardado.tipo) return false;
  if (el.type === "checkbox" || el.type === "radio") {
    if (el.defaultChecked !== guardado.marcadoInicial) return false;
    el.checked = guardado.marcado;
    return true;
  }
  if (el.defaultValue !== guardado.inicial) return false;
  el.value = guardado.valor;
  return true;
}
