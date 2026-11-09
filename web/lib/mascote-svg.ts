import type { BotFrame } from "../vendor/bloub/engine.ts";
import { DEMI_VIEWBOX as V, RAYON } from "../vendor/bloub/repere.ts";
import { mixHex } from "../vendor/bloub/skins.ts";
import { esc } from "./escape.ts";

const PAPEL = "#ffffff";
/**
 * A tinta pode ser CSS (`var(--mascote-cor)`), e aí vai em `style`: o elemento não precisa de getComputedStyle para
 * pintar. medido em 2026-09-30: o Chrome 148 também resolve var() em atributo de apresentação (getComputedStyle de um
 * rect com fill="var(--x)"); `style` é o que vale em qualquer motor.
 */
const doCss = (cor: string) => cor.startsWith("var(") || cor.startsWith("color-mix(");
const preencher = (cor: string) => (doCss(cor) ? `style="fill:${cor}"` : `fill="${cor}"`);
function corDoPonto(d: BotFrame["dots"][number], ink: string, paper: string): string {
  if (d.color) return d.color;
  if (d.depth === undefined) return ink;
  // Brume das partículas (só `burst`, fora do catálogo ativo): com tinta CSS, a mistura fica com o CSS.
  return doCss(ink) ? `color-mix(in srgb, ${ink} ${Math.round(d.depth * 100)}%, ${paper})` : mixHex(paper, ink, d.depth);
}
const transformDoPonto = (d: BotFrame["dots"][number]) => `translate(${d.x} ${d.y}) rotate(${d.rot ?? 0}) scale(${RAYON})`;

export function svgMascote(f: BotFrame, id: string, ink: string, paper = PAPEL): string {
  const dots = f.dots.map(d => {
    const fill = preencher(corDoPonto(d, ink, paper));
    return d.d ? `<path d="${esc(d.d)}" ${fill} opacity="${d.opacity}" transform="${transformDoPonto(d)}"/>`
      : `<circle cx="${d.x}" cy="${d.y}" r="${d.r}" ${fill} opacity="${d.opacity}"/>`;
  }).join("");
  const arcs = (side: "front" | "back") => f.arcs.map((a, i) => `<path d="${esc(a[side])}" fill="none" stroke="url(#${id}-a${i})" stroke-width="${a.width}" stroke-linecap="round" opacity="${a.opacity}"/>`).join("");
  return `<svg viewBox="-${V} -${V} ${2*V} ${2*V}" aria-hidden="true"><defs>
    <mask id="${id}" maskUnits="userSpaceOnUse" x="-${V}" y="-${V}" width="${2*V}" height="${2*V}"><path d="${esc(f.bodyPath)}" fill="white"/>
    ${f.eyes.map(e => `<path d="${esc(e.d)}" transform="${e.matrix}" fill="black" opacity="${e.alpha}"/>`).join("")}
    ${f.notch ? `<circle cx="${f.notch.x}" cy="${f.notch.y}" r="${f.notch.r}" fill="black"/>` : ""}</mask>
    ${f.arcs.map((a,i) => `<linearGradient id="${id}-a${i}" gradientUnits="userSpaceOnUse" x1="${a.grad.x1}" y1="${a.grad.y1}" x2="${a.grad.x2}" y2="${a.grad.y2}">${a.grad.stops.map((c,j) => `<stop offset="${j/(a.grad.stops.length-1)}" stop-color="${c}"/>`).join("")}</linearGradient>`).join("")}
    </defs>${arcs("back")}${f.dotsBehind ? dots : ""}
    <g opacity="${f.bodyAlpha}"><path d="${esc(f.bodyPath)}" fill="${paper}"/><g mask="url(#${id})"><rect x="-${V}" y="-${V}" width="${2*V}" height="${2*V}" ${preencher(ink)}/></g></g>
    ${f.dotsBehind ? "" : dots}${f.notif ? `<circle cx="${f.notif.x}" cy="${f.notif.y}" r="${f.notif.r}" style="fill: var(--nod-aviso, var(--signal))"/>` : ""}${arcs("front")}</svg>`;
}

/** O que muda o ESQUELETO do SVG. Igual ao do quadro anterior, os nós servem e só atributos mudam. */
function esqueleto(f: BotFrame): string {
  return `${f.eyes.length}|${f.notch ? 1 : 0}|${f.arcs.length}|${f.dotsBehind ? 1 : 0}|${f.dots.map(d => (d.d ? "p" : "c")).join("")}|${f.notif ? 1 : 0}`;
}

/** O pedaço do DOM que o pintor usa. Estrutural, como ElementoMascote em mascote.ts: o teste passa um DOM mínimo. */
type NoSvg = { readonly children: ArrayLike<NoSvg>; readonly firstElementChild: NoSvg | null; setAttribute(nome: string, valor: string): void };
type Hospedeiro = { innerHTML: string; readonly firstElementChild: NoSvg | null };

/** Um nó e o último valor escrito em cada atributo: só o que mudou vai ao DOM. */
class No {
  private readonly el: NoSvg;
  private readonly ultimo = new Map<string, string>();
  constructor(el: NoSvg | null | undefined) {
    this.el = el!;
  }
  por(nome: string, valor: string | number): void {
    const texto = String(valor);
    if (this.ultimo.get(nome) === texto) return;
    this.ultimo.set(nome, texto);
    this.el.setAttribute(nome, texto);
  }
}

/**
 * Pinta quadros seguidos no mesmo elemento. Quando o esqueleto muda (entra um anel, some um olho) reescreve o SVG;
 * senão remenda atributos — o DOM final é o mesmo que svgMascote daria. medido em 2026-09-30: zero divergências em
 * 40.432 quadros (8 formas x 14 estados, 6 s a 60 fps), SVG reescrito em 0,8% deles (bancada no chrome-headless-shell 148).
 */
export class PintorMascote {
  private readonly host: Hospedeiro;
  private readonly id: string;
  private readonly ink: string;
  private forma = "";
  private corpo: No[] = [];
  private grupo: No | null = null;
  private olhos: No[] = [];
  private entalhe: No | null = null;
  private pastilha: No | null = null;
  private pontos: No[] = [];
  private arcos: Array<{ tras: No; frente: No; grad: No }> = [];

  constructor(host: Hospedeiro, id: string, ink: string) {
    this.host = host;
    this.id = id;
    this.ink = ink;
  }

  pintar(f: BotFrame): void {
    const forma = esqueleto(f);
    if (forma !== this.forma) {
      this.host.innerHTML = svgMascote(f, this.id, this.ink);
      this.forma = forma;
      this.ligar(f);
      return;
    }
    for (const no of this.corpo) no.por("d", f.bodyPath);
    this.grupo!.por("opacity", f.bodyAlpha);
    f.eyes.forEach((e, i) => {
      const no = this.olhos[i]!;
      no.por("d", e.d);
      no.por("transform", e.matrix);
      no.por("opacity", e.alpha);
    });
    for (const [no, c] of [[this.entalhe, f.notch], [this.pastilha, f.notif]] as const) {
      if (!no || !c) continue;
      no.por("cx", c.x);
      no.por("cy", c.y);
      no.por("r", c.r);
    }
    f.dots.forEach((d, i) => {
      const no = this.pontos[i]!;
      if (d.d) {
        no.por("d", d.d);
        no.por("transform", transformDoPonto(d));
      } else {
        no.por("cx", d.x);
        no.por("cy", d.y);
        no.por("r", d.r);
      }
      no.por("opacity", d.opacity);
      const cor = corDoPonto(d, this.ink, PAPEL);
      no.por(doCss(cor) ? "style" : "fill", doCss(cor) ? `fill:${cor}` : cor);
    });
    f.arcs.forEach((a, i) => {
      const { tras, frente, grad } = this.arcos[i]!;
      for (const [no, d] of [[tras, a.back], [frente, a.front]] as const) {
        no.por("d", d);
        no.por("stroke-width", a.width);
        no.por("opacity", a.opacity);
      }
      grad.por("x1", a.grad.x1);
      grad.por("y1", a.grad.y1);
      grad.por("x2", a.grad.x2);
      grad.por("y2", a.grad.y2);
    });
  }

  /** Referências na ordem em que svgMascote escreve os nós. */
  private ligar(f: BotFrame): void {
    const svg = this.host.firstElementChild!;
    const defs = svg.firstElementChild!;
    const mascara = Array.from(defs.firstElementChild!.children);
    const grads = Array.from(defs.children).slice(1);
    const topo = Array.from(svg.children).slice(1);
    let i = 0;
    const proximo = () => new No(topo[i++]);
    const tras = f.arcs.map(proximo);
    if (f.dotsBehind) this.pontos = f.dots.map(proximo);
    const g = topo[i++]!;
    if (!f.dotsBehind) this.pontos = f.dots.map(proximo);
    this.pastilha = f.notif ? proximo() : null;
    const frente = f.arcs.map(proximo);
    this.grupo = new No(g);
    this.corpo = [new No(mascara[0]), new No(g.firstElementChild)];
    this.olhos = f.eyes.map((_, k) => new No(mascara[1 + k]));
    this.entalhe = f.notch ? new No(mascara[1 + f.eyes.length]) : null;
    this.arcos = f.arcs.map((_, k) => ({ tras: tras[k]!, frente: frente[k]!, grad: new No(grads[k]) }));
  }
}
