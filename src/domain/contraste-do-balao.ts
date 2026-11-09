/**
 * NOD-431 e NOD-436, definido em 2026-10-30: o balão da pessoa ganha a cor do bot da conversa, com o texto sempre legível (WCAG AA, 4,5:1).
 *
 * As cores moram como literais em web/tokens.css (o único arquivo da web com cor literal, ADR-070); esta função é a
 * fonte de onde esses literais saem e o teste tests/unit/domain/contraste-do-balao.test.ts confere, para as 12 skins nos
 * dois temas, que o tokens.css tem exatamente o que ela calcula e que o contraste passa. Determinística: mesma entrada,
 * mesma saída, sem aleatório nem relógio.
 *
 * Regra (correção de 2026-10-30, pedido do Marlon comparando com o Grok): o texto do balão é sempre branco. O fundo é a
 * cor do bot ou, quando o branco não passa de 4,5:1 nela, a cor mais próxima no mesmo tom (só a luminosidade anda, em
 * passos de 1%) em que passa; ele também precisa se separar da página e do balão do bot por SEPARACAO_MINIMA. O fundo
 * do código é o balão 10% para o preto (ou para o branco, nas pontas em que o preto não separa o chip), também
 * com o branco ≥ 4,5:1.
 */

export const CONTRASTE_MINIMO = 4.5;
/** Razão mínima entre o fundo do balão da pessoa e o do bot: abaixo disso as duas vozes voltam a parecer uma. */
export const SEPARACAO_MINIMA = 1.2;
/** Quanto o fundo do chip de comando se afasta do balão (para longe da tinta). */
export const MISTURA_DO_CODIGO = 0.1;
export const TINTA_CLARA = "#ffffff";
export const TINTA_PRETA = "#000000";

export interface CoresDoBalao {
  fundo: string;
  tinta: string;
  /** Fundo do chip de comando dentro do balão. */
  codigo: string;
}

type Rgb = readonly [number, number, number];

const hexParaRgb = (hex: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`cor inválida: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const rgbParaHex = (rgb: Rgb): string => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;

/** Luminância relativa da WCAG 2.x. */
export function luminancia(hex: string): number {
  const [r, g, b] = hexParaRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste da WCAG entre duas cores, de 1 a 21. */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Mistura em sRGB, como `color-mix(in srgb, b p, a)`. */
export function misturar(a: string, b: string, p: number): string {
  const [x, y] = [hexParaRgb(a), hexParaRgb(b)];
  const canal = (i: 0 | 1 | 2): number => x[i] * (1 - p) + y[i] * p;
  return rgbParaHex([canal(0), canal(1), canal(2)]);
}

const paraHsl = (hex: string): [number, number, number] => {
  const [r, g, b] = hexParaRgb(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
};

const deHsl = (h: number, s: number, l: number): string => {
  if (s === 0) return rgbParaHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t0: number): number => {
    const t = t0 < 0 ? t0 + 1 : t0 > 1 ? t0 - 1 : t0;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbParaHex([canal(h + 1 / 3) * 255, canal(h) * 255, canal(h - 1 / 3) * 255]);
};

/** A mesma cor (matiz e saturação HSL) com outra luminosidade, de 0 a 1. */
export const comLuminosidade = (hex: string, l: number): string => {
  const [h, s] = paraHsl(hex);
  return deHsl(h, s, Math.min(1, Math.max(0, l)));
};

/** Razão mínima entre o chip e o balão, para o chip não sumir. */
const SEPARACAO_DO_CHIP = 1.1;

/**
 * O fundo do chip: 10% para longe da tinta (com a tinta branca, para o preto), o que nunca tira contraste. Nas pontas
 * (balão quase preto) esse lado não separa o chip do balão, e ele vai 10% para o lado da tinta; coresDoBalao confere
 * o contraste do chip em todo candidato.
 */
const codigoDe = (fundo: string, tinta: string): string => {
  const longe = misturar(fundo, luminancia(tinta) < 0.5 ? TINTA_CLARA : TINTA_PRETA, MISTURA_DO_CODIGO);
  return contraste(longe, fundo) >= SEPARACAO_DO_CHIP ? longe : misturar(fundo, tinta, MISTURA_DO_CODIGO);
};

/** Luminosidade HSL, de 0 a 1. */
export function luminosidade(hex: string): number {
  return paraHsl(hex)[2];
}

/** Matiz HSL em graus (0 a 360); um cinza devolve 0. */
export function matiz(hex: string): number {
  return paraHsl(hex)[0] * 360;
}

/**
 * As cores do balão da pessoa para uma cor de bot, contra o que está em volta dele no tema: a página (`surface`) e o
 * balão do bot (`surface-raised`). A tinta é sempre branca, como no Grok; o fundo é a cor do bot com a menor mudança de
 * luminosidade (HSL: matiz e saturação ficam) que faz o branco passar de 4,5:1 (no texto e no chip) e separa o balão do
 * que está em volta. Lança se não achar: uma skin nova que caia aqui precisa de decisão de design.
 */
export function coresDoBalao(corDoBot: string, balaoDoBot: string, pagina: string): CoresDoBalao {
  const tinta = TINTA_CLARA;
  const separa = (f: string): boolean => Math.min(contraste(f, balaoDoBot), contraste(f, pagina)) >= SEPARACAO_MINIMA;
  const serve = (f: string): boolean => separa(f) && contraste(f, tinta) >= CONTRASTE_MINIMO && contraste(codigoDe(f, tinta), tinta) >= CONTRASTE_MINIMO;
  const [, , l0] = paraHsl(corDoBot);
  // A cor do bot fica se já serve; senão, a luminosidade mais perto dela que serve. Escurecer vem antes de clarear
  // (clarear só ajuda o preto a se separar da página escura).
  for (let i = 0; i <= 100; i++) {
    for (const l of i === 0 ? [l0] : [l0 - i / 100, l0 + i / 100]) {
      if (l < 0 || l > 1) continue;
      const fundo = i === 0 ? corDoBot.toLowerCase() : comLuminosidade(corDoBot, l);
      if (serve(fundo)) return { fundo, tinta, codigo: codigoDe(fundo, tinta) };
    }
  }
  throw new Error(`sem contraste para ${corDoBot}`);
}
