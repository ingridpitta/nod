/**
 * Render por REGIÕES (plano L9): cada região é um nó fixo do index.html cujo innerHTML só é trocado
 * quando o HTML mudou — e o composer NUNCA é regravado enquanto a conversa é a mesma (o textarea
 * preserva texto, foco e cursor entre frames). Sem framework: strings + delegação de eventos por
 * `data-act` em main.ts. ADR-029 (render por classe): estados de falha viram texto com relógio.
 */
import { levarCampos } from "./levar-campos.ts";
import { trocarEmVolta } from "./varredura-da-busca.ts";
import { alvoDoFoco } from "./foco-do-bloco.ts";
import { aplicarMorph, decidirBloco, type Morph, type NoDoMorph } from "./morph.ts";

/**
 * NOD-348 (gatilho da ADR-114): `nod.medir=1` grava `nod:fala:morph` e `nod:fala:recriada` (performance.measure, que o
 * scripts/carga-tela agrega) para cada fala viva trocada; `nod.semMorph=1` força a recriação, a outra ponta da
 * comparação. Desligados, nada é medido (o buffer de medidas não cresce num turno longo).
 */
function flag(nome: string): boolean {
  try { return localStorage.getItem(nome) === "1"; } catch { return false; }
}
const MEDIR = typeof localStorage !== "undefined" && flag("nod.medir");
const SEM_MORPH = typeof localStorage !== "undefined" && flag("nod.semMorph");

const ultimoHtml = new Map<string, string>();

export function regiao(id: string, html: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  if (ultimoHtml.get(id) === html) return;
  ultimoHtml.set(id, html);
  el.innerHTML = html;
}

/**
 * NOD-42 (definido em 2026-10-28, revisão do #560): como `regiao`, mas o filho `manter` não sai do DOM — o resto é
 * trocado em volta dele (o campo da busca guarda foco, acento no meio e animação). Sem `manter` (ou fora da região), é o
 * `regiao` de sempre.
 */
export function regiaoEmVoltaDe(id: string, html: string, manter: Element | null): void {
  const el = document.getElementById(id);
  if (!manter || !el || manter.parentNode !== el) { regiao(id, html); return; }
  if (ultimoHtml.get(id) === html) return;
  ultimoHtml.set(id, html);
  const molde = document.createElement("template");
  molde.innerHTML = html;
  trocarEmVolta<ChildNode>(el, Array.from(molde.content.childNodes), manter);
}

/**
 * A região seria regravada com este HTML? definido em 2026-09-28 (ADR-051): quem guarda nó VIVO dentro
 * dela (o iframe do artefato) só o tira antes quando o innerHTML vai mesmo ser trocado.
 */
export function regiaoMudaria(id: string, html: string): boolean {
  return ultimoHtml.get(id) !== html;
}

/** Zera o cache de uma região (quando o nó foi trocado por fora). */
export function esquecerRegiao(id: string): void {
  ultimoHtml.delete(id);
  blocosAplicados.delete(id);
}

type Bloco = { chave: string; html: string; morfar?: Morph };
type BlocoNaTela = Bloco & { el: Element };
const blocosAplicados = new Map<string, BlocoNaTela[]>();

/** A região seria mexida por estes blocos? Mesmas chaves, na mesma ordem e com o mesmo HTML = nada a fazer. */
export function blocosMudariam(id: string, blocos: readonly Bloco[]): boolean {
  const raiz = document.getElementById(id);
  const antes = blocosAplicados.get(id);
  if (!raiz || !antes || antes.length !== blocos.length) return true;
  return antes.some((b, i) => b.el.parentNode !== raiz || b.chave !== blocos[i]?.chave || b.html !== blocos[i]?.html);
}

/**
 * Região por BLOCOS com chave (definido em 2026-09-30): cada bloco é um `<div class="bloco">` (display: contents no
 * CSS) e só os blocos cujo HTML mudou são refeitos; os que saíram são tirados e os novos entram no lugar. Os que
 * ficam não são tocados — nem o mascote, nem o <details> aberto, nem o campo com texto. medido em 2026-09-30 (Chrome
 * headless com o main.ts real): no fim de um turno na conversa aberta, regravar o histórico inteiro de 200 mensagens
 * (~28 mil nós) custava 381 ms e recriava 80 mascotes; em blocos, as duas escritas somaram 0,3 ms.
 */
export function regiaoPorBlocos(id: string, blocos: readonly Bloco[]): void {
  const raiz = document.getElementById(id);
  if (!raiz) return;
  const focado = document.activeElement instanceof HTMLElement && raiz.contains(document.activeElement) ? document.activeElement : null;
  // O disclosure do <summary> focado é lido ANTES do morph (revisão do PR do pensamento no chat, 27/10): `trocarConteudo`
  // tira o summary antigo do <details> que fica (`data-no-lugar`), e depois o `closest` dele não acha mais o pai.
  const disclosureFocado = focado?.tagName === "SUMMARY" ? focado.closest<HTMLElement>("details[data-disclosure]")?.dataset.disclosure : undefined;
  const porChave = new Map((blocosAplicados.get(id) ?? []).filter((b) => b.el.parentNode === raiz).map((b) => [b.chave, b]));
  const vistos = new Set<string>();
  const novos: BlocoNaTela[] = blocos.map((b) => {
    // Chave repetida não reaproveita nada: o segundo bloco com a mesma chave sempre nasce de novo.
    const antes = vistos.has(b.chave) ? undefined : porChave.get(b.chave);
    vistos.add(b.chave);
    const decisao = decidirBloco(antes, b, SEM_MORPH);
    if (decisao.tipo === "manter" && antes) return { ...b, el: antes.el };
    const medir = MEDIR && antes && b.morfar ? performance.now() : null;
    if (decisao.tipo === "morfar" && antes && aplicarMorph(antes.el as unknown as NoDoMorph, decisao.plano, criarDoHtml)) {
      if (medir !== null) performance.measure("nod:fala:morph", { start: medir, end: performance.now() });
      return { ...b, el: antes.el };
    }
    const el = document.createElement("div");
    el.className = "bloco";
    el.innerHTML = b.html;
    if (antes) levarCampos(antes.el, el);
    if (medir !== null && antes) { antes.el.replaceWith(el); performance.measure("nod:fala:recriada", { start: medir, end: performance.now() }); }
    return { ...b, el };
  });
  const ficam = new Set(novos.map((b) => b.el));
  for (const filho of [...raiz.children]) if (!ficam.has(filho)) filho.remove();
  // Na ordem nova: quem já está no lugar fica; o que falta entra (ou muda de lugar, o caso raro).
  let cursor = raiz.firstElementChild;
  for (const { el } of novos) {
    if (el === cursor) cursor = cursor.nextElementSibling;
    else raiz.insertBefore(el, cursor);
  }
  blocosAplicados.set(id, novos);
  ultimoHtml.delete(id);
  // O botão focado morava num bloco refeito (o chip ou a barra da fala que acabou de reagir): o foco volta ao mesmo
  // botão no bloco novo, em vez de cair no <body> e perder o lugar na conversa (revisão do PR 392, em 2026-10-18).
  if (focado && !focado.isConnected) {
    const nome = focado instanceof HTMLInputElement || focado instanceof HTMLTextAreaElement ? focado.name : "";
    const campo = nome ? [...raiz.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input[name], textarea[name]")].find((c) => c.name === nome) : undefined;
    if (campo) { campo.focus({ preventScroll: true }); return; }
    alvoDoFoco<HTMLElement>(disclosureFocado ? { disclosure: disclosureFocado } : focado.dataset, raiz, document)?.focus({ preventScroll: true });
  }
}

function criarDoHtml(html: string): NoDoMorph | null {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.childElementCount === 1 ? (t.content.firstElementChild as unknown as NoDoMorph) : null;
}
