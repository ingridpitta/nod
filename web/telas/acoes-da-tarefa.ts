/**
 * 2026-11-10 (a issue do Multica): o que a tarefa aberta ganha em volta do título e da lateral, discreto como mensagem:
 * o menu ⋯ do topo (Mudar status, Repetir, Parar, Copiar link, Mover, Concluir), o aviso "Parada no Backlog" sob o título
 * e a nota "Ada vai começar" sob os selects de Status e Responsável. HTML puro; todo texto de fora passa por `esc`.
 *
 * O menu só usa ações que já existem: `trab-repetir` e `trab-cancelar` (web/lib/trabalhos-da-tarefa.ts), o mudar_tarefa
 * do Status (`tmenu-coluna`, o mesmo caminho do select) e o "Mover para" da lateral (`tmenu-mover` leva até ele).
 */
import type { ColunaDto, TarefaDto } from "../../src/contracts/quadro.ts";
import { acionaNaColuna } from "../lib/colunas.ts";
import { esc } from "../lib/escape.ts";
import { opcoesDeStatus } from "../lib/quadro-dados.ts";

const PONTOS = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>';

/** A coluna de fim (o "Concluir"): a Feito, ou a primeira do grupo Feito. null = o quadro não tem. */
export function colunaDeFim(cs: readonly Pick<ColunaDto, "id" | "grupo">[]): string | null {
  return (cs.find((c) => c.id === "feito") ?? cs.find((c) => c.grupo === "feito"))?.id ?? null;
}

export type MenuDaTarefa = {
  t: Pick<TarefaDto, "id" | "status" | "agenteId">;
  colunas: readonly Pick<ColunaDto, "id" | "nome" | "grupo">[];
  aberto: boolean;
  /** O submenu "Mudar status" aberto. */
  status: boolean;
  /** Há um run vivo (rodando ou na fila): o Parar aparece. */
  vivo: boolean;
  /** Há outro quadro para onde mover (o "Mover para" da lateral existe). */
  podeMover: boolean;
};

/** O ⋯ do topo e, aberto, o menu. Repetir só com responsável; Parar só com run vivo; Concluir fora do grupo Feito. */
export function menuDaTarefa(m: MenuDaTarefa): string {
  const { t } = m;
  const bt = `<button type="button" class="ta-menu-bt" data-act="tmenu" aria-haspopup="menu" aria-expanded="${m.aberto}" aria-label="Mais ações da tarefa">${PONTOS}</button>`;
  if (!m.aberto) return `<span class="ta-menu">${bt}</span>`;
  const item = (act: string, rotulo: string, extra = ""): string => `<button type="button" role="menuitem" class="ta-menu-op" data-act="${act}" data-id="${esc(t.id)}"${extra}>${esc(rotulo)}</button>`;
  const sub = m.status
    ? `<div class="ta-menu-sub" role="group" aria-label="Mudar status">${opcoesDeStatus(m.colunas).map((g) => g.colunas.length ? `<p class="ta-menu-g">${esc(g.grupo)}</p>${g.colunas.map((c) => `<button type="button" role="menuitemradio" aria-checked="${c.id === t.status}" class="ta-menu-op ta-menu-col" data-act="tmenu-coluna" data-id="${esc(t.id)}" data-coluna="${esc(c.id)}">${esc(c.nome)}</button>`).join("")}` : "").join("")}</div>` : "";
  const fim = colunaDeFim(m.colunas);
  const jaNoFim = m.colunas.find((c) => c.id === t.status)?.grupo === "feito";
  const itens = [
    `<button type="button" role="menuitem" class="ta-menu-op" data-act="tmenu-status" aria-expanded="${m.status}">Mudar status <span aria-hidden="true">${m.status ? "▾" : "›"}</span></button>${sub}`,
    t.agenteId ? item("trab-repetir", "Repetir") : "",
    t.agenteId && m.vivo ? item("trab-cancelar", "Parar") : "",
    item("tmenu-link", "Copiar link"),
    m.podeMover ? item("tmenu-mover", "Mover para outro quadro…") : "",
    fim && !jaNoFim ? item("tmenu-coluna", "Concluir", ` data-coluna="${esc(fim)}"`) : "",
  ].filter(Boolean).join("");
  return `<span class="ta-menu">${bt}<div class="ta-menu-pop" role="menu" aria-label="Ações da tarefa">${itens}</div></span>`;
}

/**
 * O aviso discreto sob o título: a tarefa tem responsável, mas está numa coluna que não aciona (Backlog, ou outra de Não
 * iniciado sem passagem): "Parada no Backlog: o responsável só começa quando ela for para A fazer". Vazio nos outros casos.
 */
export function avisoDeParada(t: Pick<TarefaDto, "status" | "agenteId">, cs: readonly Pick<ColunaDto, "id" | "nome" | "grupo" | "responsavel">[]): string {
  if (!t.agenteId) return "";
  const col = cs.find((c) => c.id === t.status);
  if (!col || col.grupo !== "nao_iniciado" || acionaNaColuna(col) || col.responsavel) return "";
  const alvo = cs.find((c) => c.id === "afazer") ?? cs.find((c) => acionaNaColuna(c) && !c.responsavel);
  const onde = col.id === "backlog" ? `no ${col.nome}` : `em ${col.nome}`;
  return `<p class="ta-parada">Parada ${esc(onde)}: o responsável só começa quando ela for para ${alvo ? esc(alvo.nome) : "o andamento"}</p>`;
}

/** A nota sob o select (Status ou Responsável): "Ada vai começar". A região existe sempre (o leitor de tela ouve a troca). */
export function notaDoSelect(campo: "status" | "agente", texto: string): string {
  return `<p class="ta-nota-sel" id="qd-t-${campo}-nota" aria-live="polite"${texto ? "" : " hidden"}>${esc(texto)}</p>`;
}
