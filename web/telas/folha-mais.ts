import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import { esc } from "../lib/escape.ts";
import { MODOS } from "./aprovacoes.ts";

/**
 * NOD-381 (protótipo nod-381, aprovado em 2026-10-27): no celular o campo tem três peças (+ | texto | mic/enviar/parar) e
 * o que antes eram três botões dentro dele (clipe, modo de aprovação e seletor de IA) mora na folha que o + abre. Cada
 * linha faz exatamente o que o botão de antes fazia (main.ts chama o mesmo input de arquivo, o mesmo menu de modo e o
 * mesmo menu de IA): dois toques até o que já existia. Bot de outra pessoa: só Anexar (o modo e a IA são da dona).
 * Puro, para o teste ler o HTML; no computador o + não aparece (web/mobile.css).
 */
export type LinhasDaFolhaMais = {
  /** O campo aceita arquivo (conversa própria com harness que lê anexo). */
  anexar: boolean;
  /** O modo de aprovação atual, só para a dona; `atencao` = "Ignorar todas as aprovações" (texto em --warning). */
  modo: { valor: string; atencao: boolean } | null;
  /** O rótulo curto da IA atual (o mesmo do seletor), só para a dona. */
  ia: string | null;
};

/** Qual linha a pessoa tocou (o `data-mais` da linha). */
export type EscolhaDaFolhaMais = "anexar" | "modo" | "ia";

const CHEVRON = '<svg class="fm-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const ICONE: Record<EscolhaDaFolhaMais, string> = {
  anexar: "M21 11.5 12.6 19.9a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8",
  modo: "M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z",
  ia: "M12 3v3M12 18v3M3 12h3M18 12h3M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M6.3 17.7l2.1-2.1M15.6 8.4l2.1-2.1",
};
const icone = (q: EscolhaDaFolhaMais) => `<svg class="fm-ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONE[q]}"/></svg>`;

/** As linhas que a folha mostra, na ordem do protótipo. Vazia = o + não tem o que abrir. */
export function linhasVisiveis(l: LinhasDaFolhaMais): EscolhaDaFolhaMais[] {
  return [l.anexar ? "anexar" : null, l.modo ? "modo" : null, l.ia !== null ? "ia" : null].filter((x): x is EscolhaDaFolhaMais => x !== null);
}

export function renderFolhaMais(l: LinhasDaFolhaMais): string {
  const linha = (q: EscolhaDaFolhaMais, titulo: string, valor: string | null, atencao = false) =>
    `<button type="button" role="menuitem" class="fm-linha" data-mais="${q}">${icone(q)}<span class="fm-txt"><b>${esc(titulo)}</b>${valor !== null ? `<small${atencao ? ' class="fm-atencao"' : ""}>${esc(valor)}</small>` : ""}</span>${CHEVRON}</button>`;
  const linhas = linhasVisiveis(l).map((q) =>
    q === "anexar" ? linha("anexar", "Anexar", "Foto ou arquivo")
    : q === "modo" ? linha("modo", "Modo de aprovação", l.modo!.valor, l.modo!.atencao)
    : linha("ia", "IA", l.ia));
  return `<div role="menu" aria-label="Anexar, modo e IA"><span class="fm-alca" aria-hidden="true"></span>${linhas.join("")}</div>`;
}

/**
 * As linhas da folha para o bot da tela: Anexar quando o campo aceita arquivo; Modo e IA só para a dona (bot de outra
 * pessoa: só Anexar, como pede a NOD-381 — a emenda da ADR-059 registra que, no celular, o colega vê o modo na gaveta).
 */
export function linhasDoBot(p: { temArquivo: boolean; dona: boolean; modo: ModoAprovacao | undefined; ia: string | null }): LinhasDaFolhaMais {
  const modo = p.modo ?? "manual";
  return {
    anexar: p.temArquivo,
    modo: p.dona ? { valor: MODOS[modo].titulo, atencao: modo === "total" } : null,
    ia: p.dona ? p.ia : null,
  };
}

/**
 * O que acontece entre o toque numa linha e a ação (revisão 1 do PR 545). Anexar abre o seletor de arquivo no próprio
 * toque (o navegador só abre o input com o gesto da pessoa). Modo e IA esperam a folha fechar: o `close` do <dialog> chega
 * depois do toque, e se o menu abrisse antes, o `aria-expanded="false"` da folha que fecha apagava o "true" do menu.
 * `valido` é falso quando o campo já é de outra conversa: nada grava no bot errado.
 */
export function controleDaFolha(mais: { setAttribute(nome: string, valor: string): void }, agir: { anexar(): void; modo(): void; ia(): void; valido(): boolean }): {
  escolher(q: EscolhaDaFolhaMais): void;
  fechou(): void;
} {
  let pendente: "modo" | "ia" | null = null;
  mais.setAttribute("aria-expanded", "true");
  return {
    escolher(q) {
      pendente = null;
      if (!agir.valido()) return;
      if (q === "anexar") agir.anexar();
      else pendente = q;
    },
    fechou() {
      mais.setAttribute("aria-expanded", "false");
      const q = pendente;
      pendente = null;
      if (!q || !agir.valido()) return;
      if (q === "modo") agir.modo();
      else agir.ia();
    },
  };
}

/** O nome do + para leitor de tela: o que a folha tem e, no modo total, o aviso (revisão 2 do PR 545). */
export function rotuloDoMais(l: LinhasDaFolhaMais, modoTotal = l.modo?.atencao === true): string {
  const base = l.modo || l.ia ? "Anexar, modo e IA" : "Anexar";
  return modoTotal ? `${base} · ${MODOS.total.titulo}` : base;
}

/** Quanto o menu de Modo/IA aberto pela folha ignora toques: o 2º de um toque duplo cai onde as linhas da folha estavam. */
export const MS_TOQUE_DUPLO = 500;

/**
 * Revisão 3 do PR 545: o clique que chega cedo demais no menu aberto pela folha é o 2º toque de um toque duplo e não
 * conta (escolheria "Aprovar automaticamente" ou outra IA sem querer). Teclado (Enter/Espaço, `detail` 0) sempre conta.
 */
export function toqueCedoDemais(msDesdeQueAbriu: number, detalhe: number): boolean {
  return detalhe > 0 && msDesdeQueAbriu < MS_TOQUE_DUPLO;
}

/** O clique que `travarToqueDuploEm` recebe (o MouseEvent, reduzido ao que a trava usa). */
interface CliqueTravavel { detail: number; preventDefault(): void; stopImmediatePropagation(): void }

/**
 * Pendura no menu recém-aberto, em captura (antes dos ouvintes dos itens), a trava de `toqueCedoDemais`. `agora` é o
 * relógio (os testes passam um falso).
 */
export function travarToqueDuploEm(d: { addEventListener(tipo: "click", f: (e: CliqueTravavel) => void, o: { capture: true }): void }, agora: () => number = () => performance.now()): void {
  const desde = agora();
  d.addEventListener("click", (e) => {
    if (!toqueCedoDemais(agora() - desde, e.detail)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true });
}
