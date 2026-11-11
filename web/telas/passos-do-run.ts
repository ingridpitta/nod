/**
 * A lista de passos do run (definido em 2026-11-10, Passo 2; como o inline-comment-run do Multica): um ícone por classe
 * (comando, arquivo, busca, app, texto, erro), 3 ou mais chamadas seguidas da mesma ferramenta num grupo "×N", os 12
 * últimos à vista e "mostrar N anteriores". O passo mostra só o rótulo e o resumo redigido do argumento (ADR-165: nunca a
 * saída). O "Você acrescentou · resumo" do manda agora entra no ponto em que o agente leu. Texto de fora por `esc`.
 */
import type { PassoDoRun } from "../../src/contracts/quadro-comentarios.ts";
import { esc } from "../lib/escape.ts";
import type { PassoNaTela } from "../lib/passos-do-run.ts";

export const PASSOS_A_VISTA = 12;
const GRUPO_MIN = 3;

const SVG = (d: string): string => `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICONE: Readonly<Record<PassoDoRun["classe"], string>> = {
  comando: SVG("m3 5 3 3-3 3M8 11h5"),
  arquivo: SVG("M4 2.5h5l3 3v8H4zM9 2.5v3h3"),
  busca: SVG("M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm3.5-1.5L14 14"),
  app: SVG("M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z"),
  texto: SVG("M3 4h10M3 8h10M3 12h6"),
  erro: SVG("M8 2.5 14 13H2zM8 6.5v3M8 11.5v.01"),
  outro: SVG("M8 3v10M3 8h10"),
};

/** Um item da lista: um passo, um grupo de chamadas iguais seguidas ou o recado lido. */
export type ItemDosPassos = { tipo: "passo"; p: PassoNaTela } | { tipo: "grupo"; ps: PassoNaTela[] } | { tipo: "recado"; em: number; texto: string };

/** Puro: agrupa 3 ou mais chamadas seguidas da mesma ferramenta (o texto e o erro nunca agrupam). */
export function agruparPassos(lista: readonly PassoNaTela[]): ItemDosPassos[] {
  const out: ItemDosPassos[] = [];
  let i = 0;
  while (i < lista.length) {
    const p = lista[i]!;
    let j = i + 1;
    if (p.tipo === "ferramenta" && p.ferramenta) while (j < lista.length && lista[j]!.tipo === "ferramenta" && lista[j]!.ferramenta === p.ferramenta) j++;
    if (j - i >= GRUPO_MIN) out.push({ tipo: "grupo", ps: lista.slice(i, j) });
    else for (let k = i; k < j; k++) out.push({ tipo: "passo", p: lista[k]! });
    i = j;
  }
  return out;
}

/** Puro: os recados lidos entram antes do primeiro passo que veio depois da leitura. */
export function comRecados(itens: readonly ItemDosPassos[], recados: readonly { em: number; texto: string }[]): ItemDosPassos[] {
  if (!recados.length) return [...itens];
  const em = (i: ItemDosPassos): number => (i.tipo === "passo" ? i.p.em : i.tipo === "grupo" ? i.ps[0]!.em : i.em);
  return [...itens, ...recados.map((r) => ({ tipo: "recado" as const, ...r }))].sort((a, b) => em(a) - em(b));
}

const estadoDe = (p: PassoNaTela): string => (p.falhou || p.tipo === "erro" ? "falhou" : p.aberto ? "vivo" : "ok");

function linhaDoPasso(p: PassoNaTela): string {
  const classe = p.falhou || p.tipo === "erro" ? "erro" : p.classe;
  return `<li class="ta-passo" data-estado="${estadoDe(p)}" data-classe="${esc(classe)}"><span class="ta-passo-ic">${ICONE[classe] ?? ICONE.outro}</span>` +
    `<span class="ta-passo-txt"><span class="ta-passo-rot">${esc(p.rotulo)}</span>${p.resumo ? `<span class="ta-passo-res"> ${esc(p.resumo)}</span>` : ""}</span></li>`;
}

function linhaDoItem(i: ItemDosPassos): string {
  if (i.tipo === "passo") return linhaDoPasso(i.p);
  if (i.tipo === "recado") return `<li class="ta-passo ta-passo-recado" data-classe="texto"><span class="ta-passo-ic">${ICONE.texto}</span><span class="ta-passo-txt"><span class="ta-passo-rot">Você acrescentou</span><span class="ta-passo-res"> ${esc(i.texto)}</span></span><span class="ta-passo-lido">lido</span></li>`;
  const p = i.ps[0]!;
  const falhou = i.ps.some((x) => x.falhou);
  return `<li class="ta-passo ta-passo-grupo" data-estado="${falhou ? "falhou" : i.ps.some((x) => x.aberto) ? "vivo" : "ok"}" data-classe="${esc(p.classe)}"><details><summary><span class="ta-passo-ic">${ICONE[p.classe] ?? ICONE.outro}</span>` +
    `<span class="ta-passo-txt"><span class="ta-passo-rot">${esc(p.rotulo)}</span> <span class="qd-n">×${i.ps.length}</span></span></summary><ol class="ta-passos-sub">${i.ps.map(linhaDoPasso).join("")}</ol></details></li>`;
}

/**
 * A lista: os 12 últimos itens (grupo conta como um) e "mostrar N anteriores" (`todos` abre o resto). `turno` é o run
 * (o botão alterna). Vazia com o run ainda lendo: "Lendo os passos…".
 */
export function listaDePassos(o: { turno: string; lista: readonly PassoNaTela[]; recados?: readonly { em: number; texto: string }[]; todos: boolean; lendo?: boolean }): string {
  const itens = comRecados(agruparPassos(o.lista), o.recados ?? []);
  if (!itens.length) return o.lendo ? `<p class="ta-run-nota">Lendo os passos…</p>` : "";
  const escondidos = o.todos ? 0 : Math.max(0, itens.length - PASSOS_A_VISTA);
  const mais = escondidos ? `<li class="ta-passo-mais"><button type="button" class="qd-link" data-act="run-passos-todos" data-turno="${esc(o.turno)}">mostrar ${escondidos} ${escondidos === 1 ? "anterior" : "anteriores"}</button></li>` : "";
  return `<ol class="ta-run-passos">${mais}${itens.slice(escondidos).map(linhaDoItem).join("")}</ol>`;
}
