/** Um campo de texto do bloco (input ou textarea); o mínimo que `levarCampos` usa, para testar sem DOM. */
export type CampoDoBloco = { name: string; type: string; value: string; defaultValue: string };
type ComCampos = { querySelectorAll(seletor: string): Iterable<unknown> };
const NAO_LEVA = new Set(["hidden", "checkbox", "radio", "submit", "button", "file"]);
const camposDe = (raiz: ComCampos) => [...raiz.querySelectorAll("input[name], textarea[name]")].map((c) => c as CampoDoBloco).filter((c) => !NAO_LEVA.has(c.type));

/**
 * NOD-345 (revisão do PR 504): o bloco refeito (o botão "Conferindo…", o erro do código) não apaga o que a pessoa
 * digitou. O valor passa do campo velho para o novo de mesmo nome, só no DOM (nunca vai para estado, HTML ou servidor),
 * e só quando o HTML novo não traz valor próprio.
 */
export function levarCampos(velho: ComCampos, novo: ComCampos): void {
  const valores = new Map<string, string>();
  for (const c of camposDe(velho)) if (c.value) valores.set(c.name, c.value);
  if (valores.size === 0) return;
  for (const c of camposDe(novo)) {
    const v = valores.get(c.name);
    if (v !== undefined && !c.value && !c.defaultValue) c.value = v;
  }
}
