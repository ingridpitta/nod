import type { ComandosDto } from "../../src/contracts/comandos.ts";
import { comandoNoTexto, listaDaBarra, nomeDigitado, type ItemDaBarra } from "./barra.ts";
import { enterEnvia } from "./celular.ts";
import { esc } from "./escape.ts";
import { renderDicaBarra, renderListaBarra } from "../telas/barra.ts";

/**
 * ADA-5: o composer, um só. O campo do chat (#composer) e a pílula do Quadro (.qc-pil) usam as mesmas peças: a altura
 * que acompanha o texto, a menção @, a lista "/", a decisão do Enter/Esc e a colagem de arquivo. O chat chama as funções
 * pelos handlers que já tinha; a pílula liga tudo por `ligarComposer`.
 */

/** A altura do campo acompanha o texto, até 170 px (o mesmo teto no chat e na pílula; definido em 2026-11-04, ADA-5). */
export const ALTURA_MAX_CAMPO = 170;

type Campo = { value: string; selectionStart: number | null; selectionEnd: number | null; focus(): void };

export function ajustarAltura(ta: { style: { height: string }; scrollHeight: number }, max = ALTURA_MAX_CAMPO): void {
  ta.style.height = "auto";
  ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
}

/** O que vem depois do "@" logo antes do cursor (null = o cursor não está numa menção). */
export function mencaoNoCursor(valor: string, cursor: number): string | null {
  const m = /(^|\s)@([\p{L}\d_-]*)$/u.exec(valor.slice(0, cursor));
  return m ? m[2] ?? "" : null;
}

export function sugestoesDaMencao(valor: string, cursor: number, nomes: readonly string[]): string[] {
  const m = mencaoNoCursor(valor, cursor);
  if (m === null) return [];
  const f = m.toLowerCase();
  return nomes.filter((n) => n.toLowerCase().startsWith(f));
}

export function htmlSugestoes(lista: readonly string[]): string {
  return lista.map((n) => `<button type="button" class="sug" data-nome="${esc(n)}">@${esc(n)}</button>`).join("");
}

/** Troca o "@parcial" do cursor pelo nome escolhido, com um espaço depois, e deixa o cursor ali. */
export function escolherMencao(ta: Campo, nome: string): void {
  const cursor = ta.selectionStart ?? ta.value.length;
  const antes = ta.value.slice(0, cursor).replace(/@[\p{L}\d_-]*$/u, `@${nome} `);
  ta.value = antes + ta.value.slice(cursor);
  ta.selectionStart = ta.selectionEnd = antes.length;
  ta.focus();
}

/** O contexto da lista "/" no momento: o catálogo, as recentes da conversa, se mostra os atalhos e de quem é o bot. */
export interface ContextoDaBarra {
  dto: ComandosDto | null;
  recentes: readonly string[];
  atalhos: boolean;
  botProprio: boolean;
  bot: string;
}

type Caixa = { innerHTML: string; hidden: boolean; querySelector(s: string): { scrollIntoView?(o: { block: "nearest" }): void } | null };

export interface Barra {
  /** Abre, filtra ou fecha a lista pelo que está no campo; sem lista, a dica diz o que o comando escrito faz. */
  atualizar(ta: Campo): void;
  fechar(): void;
  /** Troca o nome digitado pelo escolhido, deixa o cursor depois dele e mostra a dica. */
  escolher(ta: Campo, item: ItemDaBarra): void;
  escolherIndice(ta: Campo, i: number): void;
  /** Com a lista aberta, as setas andam, Enter e Tab escolhem, Esc fecha. true = tratou a tecla. */
  tecla(ev: { key: string; shiftKey: boolean }, ta: Campo): boolean;
  aberta(): boolean;
}

/**
 * A lista "/" de um composer (definido em 2026-09-28, canvas "Comandos /"; ADA-5: o estado sai dos globais do main, cada
 * composer tem o seu). `recarregar` devolve a promessa da releitura do catálogo, ou null quando ele está fresco.
 */
export function criarBarra(o: { lista(): Caixa | null; dica(): Caixa | null; contexto(): ContextoDaBarra; recarregar?(): Promise<void> | null }): Barra {
  let itens: ItemDaBarra[] = [];
  let selecionado = 0;
  const b: Barra = {
    atualizar(ta) {
      const lista = o.lista();
      const dica = o.dica();
      if (!lista || !dica) return;
      const c = o.contexto();
      const filtro = nomeDigitado(ta.value, ta.selectionStart ?? ta.value.length);
      if (filtro !== null) {
        const l = listaDaBarra(c.dto, filtro, c.recentes, c.atalhos, c.botProprio);
        itens = l.itens;
        selecionado = Math.min(selecionado, Math.max(0, l.itens.length - 1));
        lista.innerHTML = renderListaBarra(l, { filtro, selecionado, bot: c.bot, doMacEm: c.dto?.doMacEm ?? null });
        lista.hidden = false;
        dica.hidden = true;
        // A primeira abertura busca a lista; quando ela chega, redesenha com o que estiver no campo.
        void o.recarregar?.()?.then(() => { if (!lista.hidden) b.atualizar(ta); });
        return;
      }
      b.fechar();
      const cmd = comandoNoTexto(c.dto, ta.value);
      dica.innerHTML = cmd ? renderDicaBarra(cmd, c.bot) : "";
      dica.hidden = !cmd;
    },
    fechar() {
      const lista = o.lista();
      if (lista) lista.hidden = true;
      itens = [];
      selecionado = 0;
    },
    escolher(ta, item) {
      const cursor = ta.selectionStart ?? ta.value.length;
      const depois = ta.value.slice(cursor).replace(/^\S*/, "");
      // ADR-125: o atalho vira o começo do pedido (sem o "/"), e a pessoa completa.
      const inicio = item.texto ?? `/${item.nome} `;
      ta.value = inicio + depois.trimStart();
      ta.selectionStart = ta.selectionEnd = inicio.length;
      b.fechar();
      b.atualizar(ta);
      ta.focus();
    },
    escolherIndice(ta, i) {
      const item = itens[i];
      if (item) b.escolher(ta, item);
    },
    tecla(ev, ta) {
      const lista = o.lista();
      if (!lista || lista.hidden) return false;
      if (ev.key === "Escape") { b.fechar(); return true; }
      if (itens.length === 0) return false;
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        selecionado = (selecionado + (ev.key === "ArrowDown" ? 1 : itens.length - 1)) % itens.length;
        b.atualizar(ta);
        lista.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
        return true;
      }
      if ((ev.key === "Enter" && !ev.shiftKey) || ev.key === "Tab") {
        b.escolherIndice(ta, selecionado);
        return true;
      }
      return false;
    },
    aberta() {
      const lista = o.lista();
      return !!lista && !lista.hidden;
    },
  };
  return b;
}

type Tecla = { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean; keyCode?: number };

/**
 * O que a tecla faz num campo do composer, depois das listas: "enviar" (Enter no computador; no celular o Enter quebra a
 * linha e envia pelo botão), "sair" (Esc com texto: o foco sai do campo e o rascunho fica; não fecha a tarefa nem a
 * tela) ou null. A composição do IME (keyCode 229, o Safari antes do isComposing) nunca envia.
 */
export function teclaDoCampo(ev: Tecla, o: { celular: boolean; valor: string }): "enviar" | "sair" | null {
  // QA do ADA-5: o Esc da composição do IME (acentos, japonês) é do IME: não tira o foco do campo.
  if (ev.isComposing || ev.keyCode === 229) return null;
  if (ev.key === "Escape") return o.valor.trim() ? "sair" : null;
  return enterEnvia(ev, o.celular) ? "enviar" : null;
}

/** Os arquivos de uma colagem (print, arquivo copiado no Finder); vazio = colagem de texto, que segue para o campo. */
export function arquivosDaColagem(dados: { files?: ArrayLike<File> | null; items?: ArrayLike<{ kind: string; getAsFile(): File | null }> | null } | null): File[] {
  if (!dados) return [];
  const dosItens = Array.from(dados.items ?? []).filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => !!f);
  return dosItens.length > 0 ? dosItens : Array.from(dados.files ?? []);
}
