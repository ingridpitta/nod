import { esc } from "../lib/render.ts";
import type { NivelPedido } from "../lib/acessos-otimistas.ts";

/**
 * ADA-241 (ADR-158), sem protótipo do Gil (suposições no PR #706): a gaveta "Quem pode usar o {App}?" ganha, no mesmo
 * desenho minimalista do segmentado por bot,
 * - "Bots novos começam com": o padrão do app (Nenhum / Ler / Ler e alterar), que também leva quem ainda segue o padrão;
 * - uma caixinha por bot e "Selecionar todos"; a barra "Aplicar a todos | a N selecionados: Nenhum · Ler · Ler e alterar";
 * - Ler e alterar para vários bots (no lote ou no padrão) pede confirmação ali mesmo, sem modal (Esc cancela).
 *
 * O estado da tela (seleção, padrão carregado, confirmação aberta) mora aqui, fora do reducer: é da gaveta aberta e some
 * com ela. Quem desenha é marketplace.ts; quem age é main.ts (os data-act).
 */

export type AcessosDoApp = { padrao: NivelPedido; seguePadrao: ReadonlySet<string> };
export type Confirmacao = { conectorId: string; alvo: "lote" | "padrao"; bots: "todos" | string[] };

export const ROTULO: Record<NivelPedido, string> = { nenhum: "Nenhum", leitura: "Ler", escrita: "Ler e alterar" };

/** Ler e alterar para vários bots pede confirmação ali mesmo (critério 5); um bot só é o mesmo clique da linha. */
export function loteDeEscritaPedeConfirmacao(nivel: NivelPedido, bots: "todos" | readonly string[], totalDeBots: number): boolean {
  return nivel === "escrita" && (bots === "todos" ? totalDeBots > 1 : bots.length > 1);
}

const selecoes = new Map<string, Set<string>>();
const carregados = new Map<string, AcessosDoApp>();
const carregando = new Set<string>();
let confirmacao: Confirmacao | null = null;
let aberta: string | null = null;

export const gavetaDeAcessos = {
  selecao(conectorId: string): ReadonlySet<string> {
    return selecoes.get(conectorId) ?? new Set();
  },
  alternar(conectorId: string, agenteId: string): void {
    const s = new Set(selecoes.get(conectorId) ?? []);
    if (s.has(agenteId)) s.delete(agenteId);
    else s.add(agenteId);
    selecoes.set(conectorId, s);
  },
  /** "Selecionar todos": marca todos, ou limpa se todos já estavam marcados. */
  alternarTodos(conectorId: string, todos: readonly string[]): void {
    const s = selecoes.get(conectorId);
    selecoes.set(conectorId, s && todos.every((id) => s.has(id)) ? new Set() : new Set(todos));
  },
  limpar(conectorId: string): void {
    selecoes.delete(conectorId);
  },
  acessos(conectorId: string): AcessosDoApp | null {
    return carregados.get(conectorId) ?? null;
  },
  /**
   * A gaveta aberta agora (null = fechada). Ao abrir outra, ou reabrir a mesma, esquece o carregado: o padrão pode ter
   * mudado pelo chat ou por outra aba enquanto ela estava fechada (revisão do PR #706).
   */
  abrir(conectorId: string | null): void {
    if (conectorId !== aberta && conectorId !== null) {
      carregando.delete(conectorId);
      carregados.delete(conectorId);
    }
    aberta = conectorId;
  },
  /** Devolve true se é para buscar agora (nem carregado nem buscando). */
  precisaCarregar(conectorId: string): boolean {
    if (carregados.has(conectorId) || carregando.has(conectorId)) return false;
    carregando.add(conectorId);
    return true;
  },
  guardar(conectorId: string, a: AcessosDoApp): void {
    carregando.delete(conectorId);
    carregados.set(conectorId, a);
  },
  /** Esquece o carregado (depois de um lote, do padrão ou do Desfazer): o próximo desenho busca de novo. */
  esquecer(conectorId: string): void {
    carregando.delete(conectorId);
    carregados.delete(conectorId);
  },
  confirmacao(): Confirmacao | null {
    return confirmacao;
  },
  pedirConfirmacao(c: Confirmacao | null): void {
    confirmacao = c;
  },
};

function seg(act: string, conectorId: string, n: NivelPedido, ativo: boolean, extra = ""): string {
  return `<button type="button" class="seg${ativo ? " ativo" : ""}" data-act="${act}" data-conector="${esc(conectorId)}" data-nivel="${n}"${act === "padrao-app" ? ` aria-pressed="${ativo}"` : ""}${extra}>${esc(ROTULO[n])}</button>`;
}

/** "Bots novos começam com": o padrão do app. Até carregar, mostra Nenhum apagado (o padrão de sempre). */
export function linhaDoPadrao(conectorId: string, nomeApp: string): string {
  const a = gavetaDeAcessos.acessos(conectorId);
  const atual = a?.padrao ?? null;
  const ops = (["nenhum", "leitura", "escrita"] as const).map((n) => seg("padrao-app", conectorId, n, n === atual)).join("");
  return `<div class="acessos-padrao"><div><b id="padrao-${esc(conectorId)}">Bots novos começam com</b><small>Vale também para quem ainda não foi definido no ${esc(nomeApp)}.</small></div>
    <div class="segmentado sm" role="group" aria-labelledby="padrao-${esc(conectorId)}"${a ? "" : ' aria-busy="true"'}>${ops}</div></div>`;
}

/** A caixinha do bot na linha. */
export function caixaDoBot(conectorId: string, agenteId: string, nome: string): string {
  const marcado = gavetaDeAcessos.selecao(conectorId).has(agenteId);
  // O label em volta é o alvo de toque (44×44 no celular, ADR-094); a caixinha visível fica pequena.
  return `<label class="acessos-caixa-alvo"><input type="checkbox" class="acessos-caixa" data-act="selecionar-acesso" data-conector="${esc(conectorId)}" data-id="${esc(agenteId)}"${marcado ? " checked" : ""} aria-label="${esc(`Selecionar ${nome}`)}" /></label>`;
}

/** "Segue o padrão" na linha do bot que ainda não foi definido (herda o padrão do app). */
export function seguePadrao(conectorId: string, agenteId: string): boolean {
  return gavetaDeAcessos.acessos(conectorId)?.seguePadrao.has(agenteId) ?? false;
}

/**
 * A barra de lote: sem seleção, "Aplicar a todos"; com seleção, "Aplicar a N selecionados". A confirmação de Ler e
 * alterar aparece no lugar da barra (role=alertdialog, o foco vai para "Liberar"; Esc ou Cancelar fecham).
 */
export function barraDeLote(conectorId: string, nomeApp: string, ids: readonly string[]): string {
  if (ids.length === 0) return "";
  const sel = gavetaDeAcessos.selecao(conectorId);
  const marcados = ids.filter((id) => sel.has(id));
  const todos = marcados.length === ids.length;
  const c = gavetaDeAcessos.confirmacao();
  if (c && c.conectorId === conectorId) {
    const quantos = c.bots === "todos" ? ids.length : c.bots.length;
    const quem = c.alvo === "padrao" ? `os bots novos e quem segue o padrão` : quantos === 1 ? "1 bot" : `${quantos} bots`;
    return `<div class="acessos-confirma" role="alertdialog" aria-labelledby="confirma-${esc(conectorId)}" aria-describedby="confirma-d-${esc(conectorId)}">
      <p id="confirma-${esc(conectorId)}"><b>Liberar Ler e alterar no ${esc(nomeApp)} para ${esc(quem)}?</b></p>
      <p id="confirma-d-${esc(conectorId)}" class="mudo">Eles poderão criar, editar e comentar sem perguntar. Apagar fica de fora.</p>
      <div class="acessos-confirma-acoes"><button type="button" class="pri sm" data-act="confirmar-escrita" data-conector="${esc(conectorId)}" data-foco-inicial>Liberar</button><button type="button" class="link sm" data-act="cancelar-escrita" data-conector="${esc(conectorId)}" aria-keyshortcuts="Escape">Cancelar</button></div>
    </div>`;
  }
  const alvo = marcados.length === 0 ? "todos" : marcados.length === 1 ? "1 selecionado" : `${marcados.length} selecionados`;
  const ops = (["nenhum", "leitura", "escrita"] as const).map((n) => seg("lote-acesso", conectorId, n, false)).join("");
  return `<div class="acessos-lote">
    <label class="acessos-todos"><input type="checkbox" data-act="selecionar-todos-acessos" data-conector="${esc(conectorId)}"${todos ? " checked" : ""}${marcados.length > 0 && !todos ? ' data-misto="1"' : ""} /> Selecionar todos</label>
    <div class="acessos-lote-acao"><span class="mudo" id="lote-${esc(conectorId)}">Aplicar a ${esc(alvo)}:</span><div class="segmentado sm" role="group" aria-labelledby="lote-${esc(conectorId)}">${ops}</div></div>
  </div>`;
}
