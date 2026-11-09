/** definido em 2026-09-17: versões major.minor.patch e candidatas -rc.N; entrada inválida falha fechado. */
function componentes(valor: unknown): number[] | null {
  if (typeof valor !== "string") return null;
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/.exec(valor);
  if (!m) return null;
  const partes = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!partes.every(Number.isSafeInteger)) return null;
  if (m[4] === undefined) return [...partes, Infinity];
  const rc = Number(m[4]);
  return Number.isSafeInteger(rc) ? [...partes, rc] : null;
}

/** Ordem entre duas versões do app: >0 se `a` é maior, 0 se iguais, <0 se menor; null se alguma é inválida (NOD-132). */
export function compararVersoesDoApp(a: unknown, b: unknown): number | null {
  const x = componentes(a), y = componentes(b);
  if (!x || !y) return null;
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return x[i]! > y[i]! ? 1 : -1;
  }
  return 0;
}

export function versaoAceita(atual: unknown, minima: string): boolean {
  const c = compararVersoesDoApp(atual, minima);
  return c !== null && c >= 0;
}

/** NOD-132: a versão tem o formato que o app e o servidor entendem (x.y.z ou x.y.z-rc.N). */
export function versaoDoAppValida(valor: unknown): valor is string {
  return componentes(valor) !== null;
}
