import { LIMITE_ARESTAS, LIMITE_CARACTERES, type TemaDoDiagrama } from "./diagrama.ts";

/**
 * A parte do diagrama (NOD-328) que só o renderizador sandbox usa (web/sandbox/diagrama.ts): a config travada do mermaid
 * e o tamanho do SVG. Mora fora de web/lib/diagrama.ts para não entrar no bundle principal (teto de +5 KB gzip).
 */

/**
 * Chaves que nenhum `%%{init}%%` nem frontmatter muda. O default do mermaid só protege securityLevel, startOnLoad,
 * maxTextSize, suppressErrorRendering e maxEdges: htmlLabels ligaria foreignObject (HTML do bot dentro do SVG) e
 * themeCSS aceita `url(https://…)`, que o sanitizeDirective não tira. `flowchart` inteiro sai porque o htmlLabels
 * antigo mora lá.
 */
export const CHAVES_TRAVADAS = [
  "secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering",
  "htmlLabels", "flowchart", "themeCSS", "themeVariables", "theme", "darkMode", "fontFamily", "altFontFamily",
  "dompurifyConfig", "layout", "look", "elk", "deterministicIds", "deterministicIDSeed", "arrowMarkerAbsolute",
] as const;

/** A config do `mermaid.initialize` dentro do sandbox. Função pura para o teste conferir cada trava. */
export function configDoMermaid(tema: TemaDoDiagrama): Record<string, unknown> {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    maxTextSize: LIMITE_CARACTERES,
    maxEdges: LIMITE_ARESTAS,
    suppressErrorRendering: true,
    deterministicIds: true,
    layout: "dagre",
    look: "classic",
    theme: "base",
    darkMode: tema.escuro,
    fontFamily: tema.fonte,
    themeVariables: {
      darkMode: tema.escuro,
      fontFamily: tema.fonte,
      background: tema.fundo,
      primaryColor: tema.superficie,
      primaryTextColor: tema.tinta,
      primaryBorderColor: tema.linhaForte,
      secondaryColor: tema.superficie,
      tertiaryColor: tema.fundo,
      lineColor: tema.tinta2,
      textColor: tema.tinta,
      mainBkg: tema.superficie,
      nodeBorder: tema.linhaForte,
      clusterBkg: tema.fundo,
      clusterBorder: tema.linha,
      edgeLabelBackground: tema.fundo,
      noteBkgColor: tema.superficie,
      noteBorderColor: tema.linha,
      noteTextColor: tema.tinta,
      actorBkg: tema.superficie,
      actorBorder: tema.linhaForte,
      actorTextColor: tema.tinta,
      signalColor: tema.tinta2,
      signalTextColor: tema.tinta,
    },
    secure: [...CHAVES_TRAVADAS],
  };
}

/**
 * O tamanho do desenho, pelo viewBox, gravado na raiz do SVG: o mermaid sai com `width="100%"` e `max-width` no style,
 * que dentro de um `<img>` não dizem o tamanho natural. Sem viewBox válido, não há desenho.
 */
export function svgComTamanho(svg: string): { svg: string; largura: number; altura: number } | null {
  const raiz = /^\s*<svg\b[^>]*>/.exec(svg)?.[0];
  if (!raiz) return null;
  const caixa = /\sviewBox\s*=\s*["']\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/.exec(raiz);
  const largura = Math.ceil(Number(caixa?.[3]));
  const altura = Math.ceil(Number(caixa?.[4]));
  if (!(largura > 0 && altura > 0 && largura <= 100_000 && altura <= 100_000)) return null;
  const nova = raiz
    .replace(/\s(?:width|height)\s*=\s*(["'])[^"']*\1/g, "")
    .replace(/\sstyle\s*=\s*(["'])[^"']*\1/, "")
    .replace(/^(\s*<svg\b)/, `$1 width="${largura}" height="${altura}"`);
  return { svg: nova + svg.slice(svg.indexOf(raiz) + raiz.length), largura, altura };
}
