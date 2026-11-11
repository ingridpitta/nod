/**
 * O diálogo de handoff (definido em 2026-11-10, decisão do Marlon: o confirm do Multica, board-view.tsx MUL-7420, textos
 * de locales/en/issues.json "workflows.confirm.*"). Soltar ou mover a tarefa para uma coluna com responsável pergunta
 * antes: quem pega e se começa, o run de quem estava (parar ou cancelar a fila, opcional) e o que o próximo recebe. Vale
 * para o arrasto, o "Mover para…", o Status da tarefa aberta e o celular; coluna sem responsável move direto.
 * Visual do nod: parece mensagem, não alerta — sem fundo chapado, botão principal discreto.
 */
import type { PreviaDoMoverDto } from "../../src/contracts/previa-mover.ts";
import { esc } from "../lib/escape.ts";

export type DadosDoHandoff = PreviaDoMoverDto & { codigo: string; coluna: string };

/** "há 3 min", "há 2 h", "há menos de 1 min" (a duração do run de quem estava). */
export function haQuanto(desde: number, agora: number): string {
  const min = Math.floor(Math.max(0, agora - desde) / 60_000);
  if (min < 1) return "há menos de 1 min";
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)} h`;
}

/** A linha de quem pega (o "reassign_run"/"reassign"/"same_handler_run" do Multica). */
export function linhaDoResponsavel(d: Pick<DadosDoHandoff, "passa" | "aciona" | "deNome" | "paraNome">): string {
  const para = d.paraNome ?? "o responsável da coluna";
  if (d.passa) return `O responsável muda de ${d.deNome ?? "ninguém"} para ${para}${d.aciona ? ", que começa na hora" : ""}.`;
  return d.aciona ? `${para} continua responsável e começa nesta etapa.` : `${para} continua responsável.`;
}

/** O corpo do diálogo (texto escapado aqui). `agora` = Date.now() de quem abre. */
export function htmlDoHandoff(d: DadosDoHandoff, agora: number): string {
  const a = d.anterior && d.passa ? d.anterior : null;
  const run = !a ? ""
    : a.estado === "rodando"
      ? `<div class="qd-ho-run"><p class="qd-ho-run-tit">${esc(`${a.agenteNome} ainda está trabalhando (${haQuanto(a.desde, agora)})`)}</p>` +
        `<label class="qd-ho-op"><input type="checkbox" name="parar"> ${esc(`Parar o run do ${a.agenteNome}`)}</label>` +
        `<p class="qd-ho-dica">O que ele já fez fica; se não parar, os dois trabalham na tarefa ao mesmo tempo.</p></div>`
      : `<div class="qd-ho-run"><p class="qd-ho-run-tit">${esc(`O run do ${a.agenteNome} está na fila`)}</p>` +
        `<label class="qd-ho-op"><input type="checkbox" name="parar"> ${esc(`Cancelar o run na fila do ${a.agenteNome}`)}</label>` +
        `<p class="qd-ho-dica">Se não cancelar, ele ainda começa depois.</p></div>`;
  const recebe = d.texto && d.paraNome
    ? `<details class="qd-ho-recebe"><summary>${esc(`O que o ${d.paraNome} recebe`)}</summary><pre class="qd-ho-texto">${esc(d.texto)}</pre></details>`
    : "";
  return `<form method="dialog" class="qd-ho-form">` +
    `<h2 id="qd-ho-titulo" class="qd-ho-tit">${esc(`Mover ${d.codigo} para ${d.coluna}?`)}</h2>` +
    `<p id="qd-ho-linha" class="qd-ho-linha">${esc(linhaDoResponsavel(d))}</p>${run}${recebe}` +
    `<div class="qd-ho-bts"><button type="button" class="qd-bt" data-ho="cancelar">Cancelar</button>` +
    `<button type="submit" class="qd-bt qd-bt-pri" data-ho="mover">${esc(`Mover para ${d.coluna}`)}</button></div></form>`;
}

// Tipos estruturais (como confirmar-criar-bot.ts): web/telas também compila sem a lib DOM.
type No = { closest(sel: string): unknown };
type Caixa = { checked: boolean };
type Foco = { focus(): void };
type Dialogo = {
  id: string; className: string; innerHTML: string;
  setAttribute(nome: string, valor: string): void;
  addEventListener(tipo: string, fn: (e: { target: unknown }) => void, o?: { once?: boolean }): void;
  querySelector(sel: string): unknown;
  showModal(): void; close(): void; remove(): void;
};
type DocDoDialogo = { body: { append(el: unknown): void }; createElement(tag: "dialog"): unknown; getElementById(id: string): { remove(): void } | null };

/** Abre o diálogo e responde a escolha: null = Cancelar (Esc, fora); senão mover, com ou sem parar o anterior. */
export function abrirDialogoDeHandoff(doc: DocDoDialogo, d: DadosDoHandoff, agora = Date.now()): Promise<{ parar: boolean } | null> {
  doc.getElementById("qd-handoff")?.remove();
  const dlg = doc.createElement("dialog") as Dialogo;
  dlg.id = "qd-handoff";
  dlg.className = "qd-handoff";
  dlg.setAttribute("aria-labelledby", "qd-ho-titulo");
  dlg.setAttribute("aria-describedby", "qd-ho-linha");
  dlg.innerHTML = htmlDoHandoff(d, agora);
  doc.body.append(dlg);
  return new Promise((resolver) => {
    let escolha: { parar: boolean } | null = null;
    dlg.addEventListener("click", (ev) => {
      const el = ev.target as No | null;
      if (el?.closest?.("[data-ho='cancelar']")) dlg.close();
    });
    (dlg.querySelector("form") as Dialogo | null)?.addEventListener("submit", () => {
      escolha = { parar: !!(dlg.querySelector("input[name='parar']") as Caixa | null)?.checked };
    });
    dlg.addEventListener("close", () => { dlg.remove(); resolver(escolha); }, { once: true });
    dlg.showModal();
    (dlg.querySelector("[data-ho='mover']") as Foco | null)?.focus();
  });
}
