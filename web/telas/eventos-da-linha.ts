/**
 * 2026-11-10 (a issue do Multica, views/issues/components/issue-detail.tsx ~1795-1893): os eventos discretos da linha do
 * tempo que não são movimento. As mudanças de prioridade, prazo e labels que os lotes fizeram ("Você mudou a prioridade
 * para Alta", "tirou o prazo", "pôs a label X"); os pedidos de quem participa como itens só de leitura; e o arranjo:
 * eventos seguidos do mesmo autor e da mesma ação em 2 min viram um só com "×N", e mais de 5 eventos seguidos (sem
 * comentário entre eles) recolhem os antigos em "N atividades". O Desfazer do último movimento nunca recolhe.
 * HTML puro; todo texto de fora passa por `esc`.
 */
import type { ComentarioQuadroDto } from "../../src/contracts/quadro.ts";
import type { LabelDto } from "../../src/contracts/quadro-labels.ts";
import type { AtividadeTarefa, MudancaDeCampo } from "../../src/contracts/quadro-pela-conversa.ts";
import type { Prioridade } from "../../src/contracts/quadro-opcoes.ts";
import { esc } from "../lib/escape.ts";
import { NOME_DA_PRIORIDADE } from "../lib/opcoes-do-quadro.ts";
import { anel } from "./quadro.ts";

/** A janela do "×N" (a mesma do Multica). */
export const JANELA_DO_JUNTAR_MS = 2 * 60 * 1000;
/** Mais que isto de eventos seguidos recolhe; ficam à vista os últimos `A_VISTA`. */
export const LIMITE_SEM_RECOLHER = 5;
export const A_VISTA = 3;

type Evento = { id: string; em: number; html: string; chave: string };

/** "12/11/2026" a partir de AAAA-MM-DD (sem fuso: o prazo é uma data). */
const data = (d: string): string => d.split("-").reverse().join("/");
const lista = (xs: readonly string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs.at(-1)}`);
const nomeDaPrioridade = (p: string): string => NOME_DA_PRIORIDADE[p as Prioridade] ?? p;

/** O texto de uma mudança de campo (sem o autor): uma ou duas frases (labels postas e tiradas no mesmo lote). */
export function frasesDaMudanca(m: MudancaDeCampo, labels: readonly LabelDto[]): { acao: string; texto: string }[] {
  if (m.campo === "prioridade") return [{ acao: "prioridade", texto: m.para === "sem" ? "tirou a prioridade" : `mudou a prioridade para ${nomeDaPrioridade(m.para)}` }];
  if (m.campo === "prazo") return [{ acao: "prazo", texto: m.para === null ? "tirou o prazo" : m.de === null ? `pôs o prazo em ${data(m.para)}` : `mudou o prazo para ${data(m.para)}` }];
  const nome = (id: string): string => labels.find((l) => l.id === id)?.nome ?? "uma label apagada";
  const out: { acao: string; texto: string }[] = [];
  if (m.postas.length) out.push({ acao: "labels-por", texto: `pôs ${m.postas.length === 1 ? "a label" : "as labels"} ${lista(m.postas.map(nome))}` });
  if (m.tiradas.length) out.push({ acao: "labels-tirar", texto: `tirou ${m.tiradas.length === 1 ? "a label" : "as labels"} ${lista(m.tiradas.map(nome))}` });
  return out;
}

/** As mudanças de prioridade, prazo e labels dos lotes, como eventos discretos (quem · o quê · quando). */
export function eventosDeCampos(atividade: readonly AtividadeTarefa[], labels: readonly LabelDto[], hora: (em: number) => string): Evento[] {
  const evs: Evento[] = [];
  for (const l of atividade) {
    for (const [i, m] of (l.campos ?? []).entries()) {
      for (const [j, f] of frasesDaMudanca(m, labels).entries()) {
        evs.push({
          id: `c-${l.loteId}-${i}-${j}`, em: l.criadoEm, chave: `${l.quem}|${f.acao}`,
          html: `<li class="ta-ev ta-ev-campo"><span class="ta-ev-ponto" aria-hidden="true"></span><span><b>${esc(l.quem)}</b> ${esc(f.texto)}</span>${hora(l.criadoEm)}</li>`,
        });
      }
    }
  }
  return evs;
}

/** Um pedido de quem participa (quadro_tarefa_comentarios) na linha do tempo: o nome e o texto, só leitura. */
export function pedidoNaLinha(p: ComentarioQuadroDto, hora: (em: number) => string): string {
  const nome = p.assinatura || "Quem participa";
  return `<li class="ta-th ta-th-pedido"><article class="ta-com ta-com-pedido" id="pedido-${esc(p.id)}"><span class="ta-com-av" aria-hidden="true">${anel(nome.slice(0, 1).toUpperCase(), nome, false)}</span><div class="ta-com-corpo">` +
    `<p class="ta-com-cab"><span class="ta-com-nome">${esc(nome)}</span>${hora(p.criadoEm)}<span class="ta-com-editado">pedido de quem participa</span></p>` +
    `<p class="ta-com-txt">${esc(p.texto)}</p></div></article></li>`;
}

type Item = { em: number; html: string; ev?: { id: string; chave: string } };

/** O "×N" entra antes da hora do evento (ou no fim, sem hora). */
function comVezes(html: string, n: number): string {
  const marca = `<span class="ta-ev-n" title="${n} vezes"><span aria-hidden="true">×${n}</span><span class="qd-sr"> (${n} vezes)</span></span>`;
  const i = html.indexOf('<time class="ta-ev-hora"');
  return i >= 0 ? `${html.slice(0, i)}${marca}${html.slice(i)}` : html.replace(/<\/li>$/, `${marca}</li>`);
}

/** O evento que não pode sumir num bloco recolhido (o Desfazer do último movimento). */
const fixo = (html: string): boolean => html.includes('data-act="tarefa-desfazer-movimento"');

/**
 * Os itens já em ordem de tempo, como HTML: junta os eventos seguidos de mesma chave em 2 min (fica o mais novo, com
 * "×N") e recolhe os antigos de um bloco de mais de 5 eventos seguidos (`abertos` = os blocos que a pessoa abriu, pela id
 * do primeiro evento). Comentários, runs e pedidos quebram o bloco.
 */
export function juntarAtividades(itens: readonly Item[], abertos: ReadonlySet<string>): string {
  // 1. Juntar: mesmo autor e mesma ação, seguidos, em 2 min.
  const juntos: (Item & { n: number; primeiro: string })[] = [];
  for (const it of itens) {
    const ant = juntos.at(-1);
    if (it.ev && ant?.ev && ant.ev.chave === it.ev.chave && Math.abs(it.em - ant.em) <= JANELA_DO_JUNTAR_MS) {
      juntos[juntos.length - 1] = { ...it, n: ant.n + 1, primeiro: ant.primeiro };
      continue;
    }
    juntos.push({ ...it, n: 1, primeiro: it.ev?.id ?? "" });
  }
  // 2. Recolher: os blocos de eventos seguidos.
  const out: string[] = [];
  let bloco: typeof juntos = [];
  const fechar = (): void => {
    const html = bloco.map((e) => (e.n > 1 ? comVezes(e.html, e.n) : e.html));
    if (bloco.length > LIMITE_SEM_RECOLHER) {
      const id = bloco[0]!.primeiro;
      const aberto = abertos.has(id);
      const escondidos = bloco.slice(0, -A_VISTA).filter((e) => !fixo(e.html)).length;
      const bt = (exp: boolean): string => `<li class="ta-ev ta-ev-mais"><span class="ta-ev-ponto" aria-hidden="true"></span><button type="button" class="qd-link ta-ev-mais-bt" data-act="ativ-abrir" data-bloco="${esc(id)}" aria-expanded="${exp}">${exp ? "Recolher" : `${escondidos} ${escondidos === 1 ? "atividade" : "atividades"}`}</button></li>`;
      if (aberto) out.push(bt(true), ...html);
      else {
        let pos = -1;
        bloco.forEach((e, i) => {
          if (i >= bloco.length - A_VISTA || fixo(e.html)) out.push(html[i]!);
          else if (pos < 0) { pos = out.length; out.push(bt(false)); }
        });
      }
    } else out.push(...html);
    bloco = [];
  };
  for (const it of juntos) {
    if (it.ev) { bloco.push(it); continue; }
    fechar();
    out.push(it.html);
  }
  fechar();
  return out.join("");
}
