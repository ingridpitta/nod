/**
 * Fim de turno, backchannel e interrupção na ligação (plano do modo ligação, "Camada de conversa pt-BR"). Puro: só
 * texto e números entram; quem mede silêncio é o VAD (ligacao-vad.ts) e quem decide o que fazer é o orquestrador.
 */

/**
 * Forma comparável de uma fala transcrita: sem acento, sem pontuação, minúscula e com espaços simples.
 * definido em 2026-10-04: letra repetida 3 vezes ou mais vira uma ("uhuuum" → "uhum", "simmm" → "sim"); com 2 fica,
 * porque "isso" e "pessoa" são palavras de verdade.
 */
export function normalizarFala(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/(\p{L})\1{2,}/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function palavrasDaFala(texto: string): string[] {
  const n = normalizarFala(texto);
  return n === "" ? [] : n.split(" ");
}

/** Tira repetição seguida da mesma palavra ("uhum uhum" → "uhum", "para para para" → "para"). */
function semRepeticao(palavras: readonly string[]): string[] {
  return palavras.filter((p, i) => i === 0 || palavras[i - 1] !== p);
}

/** definido em 2026-10-04: base de 600 ms de silêncio antes de fechar a vez da pessoa; teto 3 s, piso 250 ms. */
export const ESPERA_FIM_DE_TURNO = { baseMs: 600, suspensaMs: 800, fechoMs: -300, ditadoMs: 1000, tetoMs: 3000, pisoMs: 250 } as const;

/**
 * Palavras que deixam a frase em suspenso: conjunção, preposição, artigo e hesitação. Já normalizadas ("é…" vira "e",
 * "aí" vira "ai"). definido em 2026-10-04: lista do plano mais as contrações comuns (pro, pra, num, numa).
 */
const SUSPENSAS = new Set([
  "e", "mas", "que", "pra", "pro", "para", "de", "do", "da", "dos", "das", "o", "a", "os", "as", "um", "uma",
  "tipo", "entao", "ai", "porque", "com", "no", "na", "nos", "nas", "num", "numa", "eh", "ahn", "hum", "hm", "em",
  "ou", "se", "quando", "como", "pelo", "pela", "ao", "sobre",
]);

/** Fechos de frase e confirmações que pedem resposta logo. Normalizados. */
const FECHOS = new Set(["ne", "ta", "beleza", "valeu", "obrigado", "obrigada", "certo", "ok"]);

/** definido em 2026-10-04: "tipo assim" e "e tal" no fim também são hesitação — a pessoa vai continuar. */
const SUSPENSAS_DUPLAS = new Set(["tipo assim", "sei la"]);
const FECHOS_DUPLOS = new Set(["e isso", "so isso", "por favor"]);

/**
 * Quantos ms de silêncio esperar antes de fechar a vez da pessoa.
 * definido em 2026-10-04: +800 se termina em suspenso (inclusive reticências), −300 com fecho, pergunta ou resposta
 * curta (≤3 palavras) a uma pergunta do bot, +1000 em ditado; o resultado fica entre 250 e 3000.
 */
export function esperaDeFimDeTurno(p: { texto: string; botPerguntou: boolean; ditado: boolean }): number {
  const e = ESPERA_FIM_DE_TURNO;
  const bruto = p.texto.trim();
  const palavras = palavrasDaFala(bruto);
  let ms: number = e.baseMs;
  const ultima = palavras[palavras.length - 1] ?? "";
  const dupla = palavras.slice(-2).join(" ");
  const pergunta = /\?\s*$/.test(bruto);
  const reticencias = /(\.\.\.|…)\s*$/.test(bruto);
  const suspensa = !pergunta && palavras.length > 0 && (SUSPENSAS.has(ultima) || SUSPENSAS_DUPLAS.has(dupla) || reticencias);
  const fecho = pergunta || FECHOS.has(ultima) || FECHOS_DUPLOS.has(dupla);
  const respostaCurta = p.botPerguntou && palavras.length > 0 && palavras.length <= 3;
  if (suspensa) ms += e.suspensaMs;
  else if (fecho || respostaCurta) ms += e.fechoMs;
  if (p.ditado) ms += e.ditadoMs;
  return Math.min(e.tetoMs, Math.max(e.pisoMs, ms));
}

/** Uma palavra só que é concordância de quem está ouvindo. */
const PALAVRAS_BACKCHANNEL = new Set([
  "uhum", "aham", "hum", "hm", "humhum", "ta", "sei", "isso", "ok", "okay", "certo", "beleza", "entendi", "sim",
  "claro", "ah", "oh", "aha", "show", "perfeito", "exato", "blz", "tranquilo", "joia", "uhu", "ahan", "unhum",
]);

/** Duas palavras que, juntas, são concordância ("pois é", "tá bom"). */
const DUPLAS_BACKCHANNEL = new Set([
  "pois e", "ta bom", "ah ta", "ta certo", "e mesmo", "e verdade", "com certeza", "faz sentido", "ah sim", "ta ok",
  "e isso", "ah entendi", "sei sei", "ah e", "uhum sim", "aham sim",
]);

/**
 * Todas as palavras são concordância, uma a uma ou em duplas.
 * definido em 2026-10-04: até 6 palavras depois de tirar a repetição — mais que isso é fala, não reação.
 */
function consumirBackchannel(palavras: readonly string[]): boolean {
  if (palavras.length === 0 || palavras.length > 6) return false;
  let i = 0;
  while (i < palavras.length) {
    const dupla = `${palavras[i]} ${palavras[i + 1] ?? ""}`;
    if (i + 1 < palavras.length && DUPLAS_BACKCHANNEL.has(dupla)) i += 2;
    else if (PALAVRAS_BACKCHANNEL.has(palavras[i] ?? "")) i += 1;
    else return false;
  }
  return true;
}

/** "uhum", "tá", "pois é", "aham sim"…: a pessoa está ouvindo, não pedindo a vez. */
export function ehBackchannel(texto: string): boolean {
  const palavras = semRepeticao(palavrasDaFala(texto));
  // definido em 2026-10-04: "é" sozinho concorda, mas normalizado vira "e" — e "e amanhã?" é pergunta. Só vale só.
  if (palavras.length === 1 && palavras[0] === "e") return true;
  return consumirBackchannel(palavras);
}

/** Palavras vazias que podem vir antes de uma palavra de parada ("ei, para"). */
const ANTES_DA_PARADA = new Set(["ei", "opa", "o", "po", "ah", "oh", "hum", "nina"]);
const PARADAS = new Set(["para", "pera", "espera", "nao", "cancela", "chega", "repete", "perai", "calma", "parou"]);
const PARADAS_DUPLAS = new Set(["como assim", "pera ai", "espera ai", "para ai", "calma ai", "para tudo"]);
const PARADAS_DURAS = new Set(["para", "cancela", "espera", "chega", "parou"]);

/**
 * definido em 2026-10-04: "para" é preposição tanto quanto é ordem ("para o João"). Só vale como parada sozinho ou
 * seguido do que acompanha a ordem ("para aí", "para tudo", "para de falar", "para, para").
 */
const DEPOIS_DE_PARA = new Set(["ai", "tudo", "para", "de", "com", "isso", "ja", "por", "pera", "espera", "nao", "calma", "ei", "agora", "ae"]);

function primeirasSemVazias(texto: string): string[] {
  const palavras = semRepeticao(palavrasDaFala(texto));
  let i = 0;
  while (i < palavras.length && ANTES_DA_PARADA.has(palavras[i] ?? "")) i++;
  return palavras.slice(i);
}

function comecaComParada(palavras: readonly string[], conjunto: ReadonlySet<string>, duplas: ReadonlySet<string>): boolean {
  const [a, b] = palavras;
  if (a === undefined) return false;
  if (b !== undefined && duplas.has(`${a} ${b}`)) return true;
  if (!conjunto.has(a)) return false;
  return a !== "para" || b === undefined || DEPOIS_DE_PARA.has(b);
}

/**
 * A fala começa por uma palavra de parada ("para", "pera", "espera", "não", "cancela", "chega", "repete",
 * "como assim", "peraí", "calma"), depois de interjeições ("ei, para").
 */
export function ehPalavraDeParada(texto: string): boolean {
  return comecaComParada(primeirasSemVazias(texto), PARADAS, PARADAS_DUPLAS);
}

/** Só "para", "cancela", "espera", "chega": as que derrubam a ferramenta em curso (modo duro). */
export function ehParadaDura(texto: string): boolean {
  return comecaComParada(primeirasSemVazias(texto), PARADAS_DURAS, new Set(["para ai", "para tudo", "espera ai"]));
}

/** definido em 2026-10-04: 600 ms de fala contínua confirmam a interrupção mesmo sem texto (o STT ainda não fechou). */
export const FALA_QUE_INTERROMPE_MS = 600;

/**
 * definido em 2026-10-04 (análise do Buzz: com fone, o começo confirmado da fala já toma a vez; no alto-falante, 320 ms):
 * com fone não há eco para confundir, então 300 ms de fala bastam; no alto-falante e sem saber, os 600 ms de sempre.
 */
export const FALA_QUE_INTERROMPE_COM_FONE_MS = 300;

/** Fator do limiar do VAD com o bot falando: 2,5× no alto-falante (o eco não dispara), 1,5× com fone. */
export const FATOR_VAD_BOT_FALANDO = { fone: 1.5, outro: 2.5 } as const;

/**
 * A fala da pessoa sobre a do bot é mesmo uma interrupção?
 * definido em 2026-10-04: eco nunca; lendo conteúdo não confiável, só palavra de parada; backchannel puro nunca
 * (mesmo longo — "uhuuum" de 700 ms não é pedir a vez); senão 2 palavras fora do backchannel, 1 de parada ou 600 ms.
 */
export function confirmaInterrupcao(p: { texto: string; falaMs: number; ehEco: boolean; lendoConteudoNaoConfiavel: boolean; falaQueInterrompeMs?: number }): boolean {
  if (p.ehEco) return false;
  const parada = ehPalavraDeParada(p.texto);
  if (p.lendoConteudoNaoConfiavel) return parada;
  if (parada) return true;
  if (ehBackchannel(p.texto)) return false;
  const fora = palavrasDaFala(p.texto).filter((w) => !PALAVRAS_BACKCHANNEL.has(w));
  return fora.length >= 2 || p.falaMs >= (p.falaQueInterrompeMs ?? FALA_QUE_INTERROMPE_MS);
}

/**
 * Como interromper o cérebro: duro mata a geração (control_request interrupt); suave só avisa na próxima vez.
 * definido em 2026-10-04: sem ferramenta rodando é sempre duro; com ferramenta, só "para/cancela/espera/chega".
 */
export function modoDeInterrupcao(p: { texto: string; ferramentaRodando: boolean }): "duro" | "suave" {
  if (!p.ferramentaRodando) return "duro";
  return ehParadaDura(p.texto) ? "duro" : "suave";
}
