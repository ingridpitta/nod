type Lembranca = { lidas: Map<PropertyKey, unknown>; extras: readonly unknown[]; valor: unknown };
const lembrancas = new Map<string, Lembranca>();

/**
 * O desenho de uma parte da tela sem refazê-lo quando nada do que ele lê mudou (definido em 2026-09-30).
 * `desenhar` recebe o estado por um Proxy que anota as chaves do PRIMEIRO nível que leu; a lembrança vale
 * enquanto cada uma tiver a mesma referência (o reducer nunca muda um objeto no lugar) e os `extras` — o que
 * o desenho lê de fora do estado — forem os mesmos. Ler a mais só custa um redesenho a mais; nunca deixa a
 * tela velha. Quem desenha precisa ler o estado SÓ pelo parâmetro: o que ele ler por fora não é anotado.
 * medido em 2026-09-30 (bancada em Node das funções de string da timeline): mesmo com o markdown e as datas em
 * cache, refazer o histórico de 200 mensagens custa ~5 ms, e era o que sobrava a cada quadro de streaming.
 */
export function lembrar<E extends object, R>(id: string, estado: E, extras: readonly unknown[], desenhar: (estado: E) => R): R {
  const l = lembrancas.get(id);
  if (l && valeAinda(l, estado, extras)) return l.valor as R;
  const lidas = new Map<PropertyKey, unknown>();
  const anotar = (alvo: E, k: PropertyKey): void => {
    if (!lidas.has(k)) lidas.set(k, Reflect.get(alvo, k));
  };
  const espiao = new Proxy(estado, {
    get(alvo, k) {
      anotar(alvo, k);
      return Reflect.get(alvo, k);
    },
    has(alvo, k) {
      anotar(alvo, k);
      return Reflect.has(alvo, k);
    },
    ownKeys(alvo) {
      for (const k of Reflect.ownKeys(alvo)) anotar(alvo, k);
      return Reflect.ownKeys(alvo);
    },
    getOwnPropertyDescriptor(alvo, k) {
      anotar(alvo, k);
      return Reflect.getOwnPropertyDescriptor(alvo, k);
    },
  });
  const valor = desenhar(espiao);
  lembrancas.set(id, { lidas, extras, valor });
  return valor;
}

function valeAinda<E extends object>(l: Lembranca, estado: E, extras: readonly unknown[]): boolean {
  if (l.extras.length !== extras.length || l.extras.some((x, i) => !Object.is(x, extras[i]))) return false;
  for (const [k, v] of l.lidas) if (Reflect.get(estado, k) !== v) return false;
  return true;
}
