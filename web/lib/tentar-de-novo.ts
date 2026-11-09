/**
 * Nova tentativa só onde é seguro (definido em 2026-10-13, NOD-215). Quando o servidor reinicia (deploy) ou a rede do
 * dispositivo cai, o `fetch` rejeita por alguns segundos; repetir uma LEITURA nesse intervalo é inofensivo, e repetir o
 * envio da fala também, porque ele leva a chave de idempotência do compositor (envio-idempotente.ts, NOD-156): o
 * servidor devolve a mensagem já gravada em vez de duplicar. POST/PATCH/PUT/DELETE sem chave NUNCA repetem — uma
 * resposta perdida não prova que a mutação não aconteceu.
 *
 * Função pura: a espera é injetada (o teste não dorme) e só as duas falhas de rede repetem; qualquer resposta do nod
 * (4xx, 5xx com código) sobe na hora.
 */

/** Os dois códigos que a web dá à falha de transporte (web/lib/api.ts). Não vêm do servidor: ele não respondeu. */
export const FALHAS_DE_REDE = ["sem_internet", "servidor_indisponivel"] as const;
export type FalhaDeRede = (typeof FALHAS_DE_REDE)[number];

export function ehCodigoDeRede(codigo: string | null | undefined): codigo is FalhaDeRede {
  return (FALHAS_DE_REDE as readonly (string | null | undefined)[]).includes(codigo);
}

/** Vale para o `ErroApi` (sem importá-lo: api.ts importa este arquivo) e para o erro já traduzido da tela. */
export function ehFalhaDeRede(e: unknown): boolean {
  return typeof e === "object" && e !== null && ehCodigoDeRede((e as { codigo?: string }).codigo);
}

/**
 * definido em 2026-10-13: três novas tentativas depois da primeira, 0,5 s → 2 s → 6 s (8,5 s de espera, abaixo do teto
 * de 10 s da issue). A NOD-215 estima o servidor fora por ~5 s num deploy: a última tentativa já o pegaria de pé.
 * Gatilho de reversão: deploy que passe de 8 s fora, ou alguém reclamar de clique "pendurado" por 10 s.
 */
export const ESPERAS_MS: readonly number[] = [500, 2_000, 6_000];
export const TETO_ESPERA_MS = 10_000;

/** GET sempre pode repetir; mutação só com chave de idempotência. */
export function podeRepetir(metodo: string, chaveIdempotencia?: string | null): boolean {
  return metodo.toUpperCase() === "GET" || (typeof chaveIdempotencia === "string" && chaveIdempotencia !== "");
}

export type OpcoesNovaTentativa = {
  esperar?: (ms: number) => Promise<void>;
  esperas?: readonly number[];
  /** Cada falha de rede que ainda vai repetir: a tela mostra "Reconectando…" a partir daqui. */
  aoFalhar?: (e: unknown, tentativa: number) => void;
  /** Relógio (ms). O teto vale para o tempo de parede: uma tentativa que demorou a falhar consome o teto. */
  agora?: () => number;
};

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function tentarDeNovo<T>(fn: () => Promise<T>, opcoes: OpcoesNovaTentativa = {}): Promise<T> {
  const esperar = opcoes.esperar ?? dormir;
  const esperas = opcoes.esperas ?? ESPERAS_MS;
  const agora = opcoes.agora ?? Date.now;
  const inicio = agora();
  // Revisão NOD-215: o teto de 10 s vale para a soma das esperas E para o tempo de parede (fetch que demora a falhar),
  // e nenhuma espera sozinha passa dele: a nova espera só começa se terminar dentro do teto.
  let esperado = 0;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const espera = esperas[i];
      if (!ehFalhaDeRede(e) || espera === undefined || espera < 0) throw e;
      const gasto = Math.max(esperado, agora() - inicio);
      if (espera > TETO_ESPERA_MS || gasto + espera > TETO_ESPERA_MS) throw e;
      opcoes.aoFalhar?.(e, i + 1);
      esperado += espera;
      await esperar(espera);
    }
  }
}
