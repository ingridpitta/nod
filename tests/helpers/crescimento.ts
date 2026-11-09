/**
 * Guarda de complexidade sem relógio de parede (NOD-194). Mede quanto o custo cresce quando a entrada
 * fica 4x maior: linear dá ~4x, quadrático dá ~16x. O teto fica no meio do caminho (geométrico: 8x).
 *
 * Por que não `performance.now() < N`: com o Mac em load 600–950 (vários bots rodando a suíte), o
 * relógio de parede mede a fila do escalonador, não o código, e as guardas de 500 ms / 3 s caíam sem
 * regressão nenhuma. Aqui:
 * - o tempo é de CPU do processo (`process.cpuUsage`), que não anda enquanto o processo espera a vez;
 * - o resultado é uma RAZÃO entre duas medidas tiradas lado a lado, então a lentidão da máquina se cancela;
 * - cada medida repete `executar` até somar pelo menos `CPU_MINIMO_MS` na entrada pequena (as duas entradas com
 *   o mesmo número de voltas): sem isso, os casos que levam ~0,2 ms ficavam no ruído do relógio de CPU e uma
 *   medida pequena baixa demais inflava a razão (falso positivo sem regressão);
 * - cada tamanho roda `repeticoes` vezes intercaladas e vale o MENOR tempo, que descarta GC e interrupções.
 */
export const FATOR_ENTRADA = 4;
/** Linear dá ~4, quadrático ~16. 8 = √(4·16): a mesma folga (2x) para cada lado. */
export const RAZAO_MAXIMA_LINEAR = 8;
/**
 * CPU mínima de cada medida da entrada pequena. medido em 2026-10-08 (Mac, load ~620): os casos de `segredos`
 * que não dependem do teto levam 0,2–0,5 ms com 4000 caracteres, com variação de 2x entre medidas; com ≥ 5 ms
 * por medida a variação cai abaixo de 20%. Os casos quadráticos já passam disso numa volta só.
 */
export const CPU_MINIMO_MS = 5;
/**
 * Prazo do `it` que chama `razaoDeCrescimento`: as voltas até `CPU_MINIMO_MS` e as `repeticoes` dão segundos de
 * CPU, e o padrão de 5 s do projeto `unit` não cobre isso com o Mac carregado. medido em 2026-10-08 (QA da NOD-194,
 * duas `test:unit` em paralelo, load ~700–1000): 2,5–5,6 s por guarda no código linear, e a de `processo-linhas`,
 * que estava sem prazo, caiu em 5,2 s por "Test timed out in 5000ms". 30 s é ~5x o pior medido. Não esconde
 * regressão: a medida é síncrona, então quem pega o código quadrático é a razão (> 8), não o prazo.
 * `tests/unit/helpers/crescimento-prazo.test.ts` exige este prazo em toda guarda.
 */
export const PRAZO_GUARDA = { timeout: 30_000 };
const VOLTAS_MAXIMAS = 4096;

function cpuMs(f: () => unknown, voltas: number): number {
  const antes = process.cpuUsage();
  for (let i = 0; i < voltas; i++) f();
  const d = process.cpuUsage(antes);
  return (d.user + d.system) / 1000;
}

/**
 * Razão custo(gerar(4n)) / custo(gerar(n)), com o menor tempo de `repeticoes` rodadas de cada tamanho.
 * revisto em 2026-10-19 (main vermelha duas vezes no runner da GCP, razões 8,04 / 9,1 / 11,9 em código linear que aloca
 * muito): uma medida acima do teto é refeita até `TENTATIVAS` vezes e vale a menor razão. O código linear às vezes passa
 * de 8 numa rodada (GC e vizinhos no runner); o quadrático dá ~16 em toda rodada, então refazer não esconde regressão.
 */
export function razaoDeCrescimento(gerar: (n: number) => string, executar: (entrada: string) => unknown, n: number, repeticoes = 5): number {
  let menor = Infinity;
  for (let t = 0; t < TENTATIVAS && menor >= RAZAO_MAXIMA_LINEAR; t++) menor = Math.min(menor, umaRazao(gerar, executar, n, repeticoes));
  return menor;
}

/** Quantas vezes uma razão acima do teto é medida de novo antes de valer (ver `razaoDeCrescimento`). */
export const TENTATIVAS = 3;

function umaRazao(gerar: (n: number) => string, executar: (entrada: string) => unknown, n: number, repeticoes: number): number {
  const pequena = gerar(n);
  const grande = gerar(n * FATOR_ENTRADA);
  // Calibra as voltas na entrada pequena; de quebra, aquece o JIT e o cache de regex antes de medir.
  let voltas = 1;
  while (voltas < VOLTAS_MAXIMAS && cpuMs(() => executar(pequena), voltas) < CPU_MINIMO_MS) voltas *= 2;
  let menorPequena = Infinity;
  let menorGrande = Infinity;
  for (let i = 0; i < repeticoes; i++) {
    menorPequena = Math.min(menorPequena, cpuMs(() => executar(pequena), voltas));
    menorGrande = Math.min(menorGrande, cpuMs(() => executar(grande), voltas));
  }
  return menorGrande / Math.max(menorPequena, 0.001);
}
