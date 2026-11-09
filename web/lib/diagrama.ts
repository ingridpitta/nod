import { esc } from "./escape.ts";

/**
 * Diagrama mermaid no balão do bot (NOD-328, emenda à ADR-053): funções PURAS — o documento do renderizador, a config
 * travada, o filtro do postMessage, a checagem do SVG, o rótulo acessível e o nome do arquivo — para o teste unitário
 * provar o isolamento sem DOM. O código do diagrama é do bot e é NÃO CONFIÁVEL:
 *  - o mermaid nunca roda na página do nod: roda num iframe `sandbox="allow-scripts"` (sem allow-same-origin, como o
 *    artefato da ADR-051), com CSP que só deixa carregar o módulo do renderizador e os chunks dele, sem rede;
 *  - o iframe devolve só o TEXTO do SVG; o pai confere (`svgSeguro`) e mostra como `<img src="blob:">`, onde SVG não
 *    executa script nem faz requisição. O blob nunca é aberto, navegado nem posto em object/embed/iframe;
 *  - qualquer falha deixa o card de código de hoje, sem aviso.
 */

/** definido em 2026-10-22 (spec da NOD-328): acima disso fica o código. O mermaid confere de novo (maxTextSize). */
export const LIMITE_CARACTERES = 20_000;
/** definido em 2026-10-22 (spec da NOD-328): o mermaid confere de novo (maxEdges). */
export const LIMITE_ARESTAS = 300;
/** definido em 2026-10-22 (spec da NOD-328): sem resposta em 8 s, fica o código. */
export const PRAZO_MS = 8_000;

/**
 * QA da NOD-328: o renderizador desenha um pedido por vez (fila serial, FIFO). O prazo vale para a VEZ de cada diagrama:
 * conta do envio, se a fila estava vazia, ou da resposta do anterior. Contar da entrada na fila fazia a mensagem com
 * muitos diagramas, em aparelho lento, largar os últimos no card sem que o renderizador estivesse preso.
 */
export class VezDoRenderizador {
  private fila: string[] = [];
  private desde = 0;

  enviou(id: string, agora: number): void {
    if (this.fila.length === 0) this.desde = agora;
    this.fila.push(id);
  }

  respondeu(id: string, agora: number): void {
    const i = this.fila.indexOf(id);
    if (i < 0) return;
    this.fila.splice(i, 1);
    if (i === 0) this.desde = agora;
  }

  daVez(): string | null {
    return this.fila[0] ?? null;
  }

  /** ms até o da vez estourar (0 = já estourou); null sem nada na fila. */
  restante(agora: number): number | null {
    return this.fila.length === 0 ? null : Math.max(0, this.desde + PRAZO_MS - agora);
  }

  limpar(): void {
    this.fila = [];
  }
}
/** definido em 2026-10-22: um fluxograma de 300 arestas fica bem abaixo; acima disso é lixo ou ataque de memória. */
export const SVG_MAX_BYTES = 2 * 1024 * 1024;
/** allow-scripts e mais NADA (nunca allow-same-origin). */
export const SANDBOX_DIAGRAMA = "allow-scripts";

/**
 * A CSP do renderizador. O script só sai do nonce (o inline que carrega o módulo) e das pastas do renderizador e dos
 * chunks: mesmo que algo escape do DOMPurify do mermaid, um `onerror` inline não roda. Sem connect, sem fonte, sem
 * imagem de fora: o mermaid não precisa de rede.
 */
export function cspDoDiagrama(nonce: string, fontes: readonly string[]): string {
  return `default-src 'none'; script-src 'nonce-${nonce}' ${fontes.join(" ")}; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'`;
}

/**
 * O srcdoc do renderizador. Um script com nonce cria o `<script type="module">` do renderizador (também com o nonce)
 * para ouvir a falha de carga: offline, o sw.js não cobre o iframe de origem opaca e o pai fica sabendo na hora, em vez
 * de esperar o prazo. NUNCA src=blob: — o app do Mac bloqueia navegação de subframe que não seja about:srcdoc/blank.
 */
export function documentoDoRenderizador(p: { nonce: string; canal: string; urlModulo: string; fontes: readonly string[] }): string {
  const dados = JSON.stringify({ canal: p.canal, url: p.urlModulo }).replaceAll("<", "\\u003c");
  const carregar = `(function(){var d=${dados};document.documentElement.dataset.canal=d.canal;var s=document.createElement("script");s.type="module";s.nonce=${JSON.stringify(p.nonce)};s.src=d.url;s.onerror=function(){try{parent.postMessage({nod:"diagrama-indisponivel",canal:d.canal},"*")}catch(e){}};document.head.appendChild(s)})();`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="x-dns-prefetch-control" content="off"><meta http-equiv="Content-Security-Policy" content="${esc(cspDoDiagrama(p.nonce, p.fontes))}"><meta name="referrer" content="no-referrer"><script nonce="${esc(p.nonce)}">${carregar}</script></head><body></body></html>`;
}

/** O iframe oculto. `srcdoc` vai escapado como atributo; nada dele vem do bot. */
export function iframeDoRenderizador(documento: string): string {
  return `<iframe class="diagrama-renderizador" sandbox="${SANDBOX_DIAGRAMA}" referrerpolicy="no-referrer" aria-hidden="true" tabindex="-1" title="Renderizador de diagramas" srcdoc="${esc(documento)}"></iframe>`;
}

/** As cores do nod, resolvidas no pai (getComputedStyle): o sandbox não lê o CSS da página. */
export interface TemaDoDiagrama {
  escuro: boolean;
  fundo: string;
  superficie: string;
  tinta: string;
  tinta2: string;
  linha: string;
  linhaForte: string;
  fonte: string;
}

/**
 * Primeira barreira, no pai: tira `%%{…}%%` (em qualquer linha) e, do frontmatter, tudo menos o `title:`. O mermaid
 * também ignora as chaves travadas; isto só garante que nem chegam lá.
 */
export function limparDiretivas(codigo: string): string {
  let texto = codigo.replace(/%%\{[\s\S]*?\}%%/g, "");
  const frente = /^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*---[ \t]*(?:\r?\n|$)/.exec(texto);
  if (frente) {
    const titulo = (frente[1] ?? "").split(/\r?\n/).find((l) => /^title\s*:/.test(l));
    texto = (titulo ? `---\n${titulo}\n---\n` : "") + texto.slice(frente[0].length);
  }
  return texto.replace(/^\s*\n/, "");
}

/** Conta as setas (`-->`, `-.->`, `==>`, `->>`, `--x`, `---`…): um pré-filtro barato; o mermaid conta de verdade. */
export function contarArestas(codigo: string): number {
  return (codigo.match(/<?(?:--|==|-\.)[-.=]*(?:>>|>|x\b|o\b)?|->>?/g) ?? []).length;
}

/** Quem pode ver o diagrama: tamanho e arestas conferidos antes de acordar o renderizador. */
export function cabeNoLimite(codigo: string): boolean {
  return codigo.length <= LIMITE_CARACTERES && contarArestas(codigo) <= LIMITE_ARESTAS;
}

export type MensagemDoDiagrama =
  | { tipo: "pronto" }
  | { tipo: "indisponivel" }
  | { tipo: "svg"; id: string; svg: string; largura: number; altura: number }
  | { tipo: "falhou"; id: string; motivo: "invalido" | "limite" | "erro" };

/**
 * O filtro do postMessage: só vale a mensagem cuja `source` é a janela DESTE iframe, com a origem opaca do sandbox
 * ("null"), o canal sorteado para ele e, nas respostas, um id que o pai pediu. Fora disso, descarta em silêncio.
 */
export function lerMensagemDoDiagrama(ev: { source: unknown; origin: string; data: unknown }, janela: unknown, canal: string, pendentes: { has(id: string): boolean }): MensagemDoDiagrama | null {
  if (janela === null || janela === undefined || ev.source !== janela) return null;
  if (ev.origin !== "null") return null;
  const d = ev.data;
  if (typeof d !== "object" || d === null) return null;
  const m = d as Record<string, unknown>;
  if (m.canal !== canal || typeof m.nod !== "string") return null;
  if (m.nod === "diagrama-pronto") return { tipo: "pronto" };
  if (m.nod === "diagrama-indisponivel") return { tipo: "indisponivel" };
  if (typeof m.id !== "string" || !pendentes.has(m.id)) return null;
  if (m.nod === "diagrama-falhou") {
    const motivo = m.motivo === "invalido" || m.motivo === "limite" ? m.motivo : "erro";
    return { tipo: "falhou", id: m.id, motivo };
  }
  if (m.nod !== "diagrama-svg") return null;
  if (typeof m.svg !== "string" || m.svg.length > SVG_MAX_BYTES || !/^\s*<svg[\s>]/.test(m.svg)) return null;
  const largura = medida(m.largura);
  const altura = medida(m.altura);
  if (largura === null || altura === null) return null;
  return { tipo: "svg", id: m.id, svg: m.svg, largura, altura };
}

function medida(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100_000 ? Math.round(v) : null;
}

/**
 * Segunda barreira, no pai (também protege o Baixar do PR B): o SVG que tiver script, HTML embutido, handler, link
 * para fora ou CSS que busca rede volta para o card de código. O mermaid com `strict` e `htmlLabels:false` não produz
 * nada disso; se produzir, é porque algo escapou.
 */
export function svgSeguro(svg: string): boolean {
  if (svg.length > SVG_MAX_BYTES || !/^\s*<svg[\s>]/.test(svg)) return false;
  if (/<\s*(?:script|foreignObject|iframe|object|embed|image|a)[\s>/]/i.test(svg)) return false;
  // Só as tags e o CSS mandam: o texto de um rótulo ("url(x)", "javascript:") é texto no desenho e não roda.
  const tags = svg.match(/<[^>]*>/g) ?? [];
  const estilos = [...svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? "");
  for (const trecho of [...tags, ...estilos]) {
    if (/\son[a-z]+\s*=/i.test(trecho) && trecho.startsWith("<")) return false;
    if (/javascript:|@import/i.test(trecho)) return false;
    for (const url of trecho.matchAll(/url\(\s*(["']?)([^)"']*)\1\s*\)/gi)) if (!(url[2] ?? "").startsWith("#")) return false;
  }
  for (const tag of tags) for (const href of tag.matchAll(/\s(?:xlink:)?href\s*=\s*(["']?)([^"'\s>]*)\1/gi)) if (!(href[2] ?? "").startsWith("#")) return false;
  return true;
}

const TIPOS: readonly [RegExp, string][] = [
  [/^(?:flowchart|graph)\b/, "fluxograma"],
  [/^sequenceDiagram\b/, "sequência"],
  [/^classDiagram\b/, "classes"],
  [/^stateDiagram\b/, "estados"],
  [/^erDiagram\b/, "entidades"],
  [/^gantt\b/, "cronograma"],
  [/^pie\b/, "pizza"],
  [/^mindmap\b/, "mapa mental"],
  [/^timeline\b/, "linha do tempo"],
  [/^journey\b/, "jornada"],
  [/^gitGraph\b/, "git"],
];

/**
 * O que o leitor de tela diz (spec da NOD-328): o `accTitle` se houver; no fluxograma em linha reta, a sequência
 * ("Diagrama: Verde, depois Amarelo, depois Azul"); senão o tipo ("Diagrama (sequência)").
 */
export function rotuloDoDiagrama(codigo: string): string {
  const limpo = limparDiretivas(codigo);
  const titulo = /^\s*accTitle\s*:\s*(.+?)\s*$/m.exec(limpo)?.[1];
  if (titulo) return `Diagrama: ${titulo}`;
  const linhas = limpo.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("%%") && !/^---|^title\s*:/.test(l));
  const cabeca = linhas[0] ?? "";
  const tipo = TIPOS.find(([re]) => re.test(cabeca))?.[1];
  if (tipo === "fluxograma") {
    const sequencia = sequenciaLinear(linhas.slice(1));
    if (sequencia) return `Diagrama: ${sequencia.join(", depois ")}`;
  }
  return tipo ? `Diagrama (${tipo})` : "Diagrama";
}

const NO = /^([A-Za-z0-9_]+)\s*(?:[[({>]+\s*"?(.*?)"?\s*[\])}]+)?$/;
const SETA = /\s*(?:<?(?:--|==|-\.)[-.=]*(?:>>|>|x|o)?)(?:\|[^|]*\|)?\s*/;

/** O fluxograma é uma fila só (cada nó com no máximo uma entrada e uma saída)? Devolve os rótulos em ordem. */
function sequenciaLinear(linhas: readonly string[]): string[] | null {
  const rotulos = new Map<string, string>();
  const proximo = new Map<string, string>();
  const entradas = new Map<string, number>();
  for (const linha of linhas) {
    if (/^(?:style|classDef|class|linkStyle|click|subgraph|end|direction|acc)/.test(linha)) {
      if (/^(?:subgraph|click)/.test(linha)) return null;
      continue;
    }
    const pecas = linha.split(SETA).filter((p) => p.trim() !== "");
    const ids: string[] = [];
    for (const peca of pecas) {
      const no = NO.exec(peca.trim().replace(/;$/, ""));
      if (!no?.[1]) return null;
      const id = no[1];
      const rotulo = (no[2] ?? "").trim();
      if (rotulo) rotulos.set(id, rotulo);
      else if (!rotulos.has(id)) rotulos.set(id, id);
      ids.push(id);
    }
    for (let i = 0; i + 1 < ids.length; i++) {
      const de = ids[i]!;
      const para = ids[i + 1]!;
      if (proximo.has(de) && proximo.get(de) !== para) return null;
      if (proximo.get(de) === para) continue;
      proximo.set(de, para);
      entradas.set(para, (entradas.get(para) ?? 0) + 1);
    }
  }
  if (proximo.size === 0 || [...entradas.values()].some((n) => n > 1)) return null;
  const inicios = [...rotulos.keys()].filter((id) => !entradas.has(id));
  if (inicios.length !== 1) return null;
  const ordem: string[] = [];
  const vistos = new Set<string>();
  for (let id: string | undefined = inicios[0]; id !== undefined && !vistos.has(id); id = proximo.get(id)) {
    vistos.add(id);
    ordem.push(rotulos.get(id) ?? id);
  }
  return vistos.size === rotulos.size ? ordem : null;
}

/** O nome do Baixar (PR B): o primeiro da mensagem é `diagrama.svg`, o segundo `diagrama-2.svg`. */
export function nomeDoSvg(indice: number): string {
  return indice <= 0 ? "diagrama.svg" : `diagrama-${indice + 1}.svg`;
}

/** A chave do cache: o mesmo código no mesmo tema desenha uma vez, em qualquer mensagem. */
export function chaveDoDiagrama(tema: TemaDoDiagrama, codigo: string): string {
  return `${JSON.stringify(tema)}\n${codigo}`;
}

