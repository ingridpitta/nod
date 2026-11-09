import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { Estado } from "../estado/reducer.ts";
import { botDaFala, daPessoa, ICONE_DA_FALA, itensDoMenu, linhaDeEmojis, podeReagir, podeResponder } from "../telas/acoes-da-fala.ts";
import { inicioDaPergunta } from "./perguntas.ts";
import { esc } from "./render.ts";

/**
 * ADA-2 F5 (ADR-156 §2): no celular, segurar uma mensagem abre um menu só com tudo o que a fala tem — no topo as reações,
 * depois Responder, Copiar e Criar tarefa disto; um divisor; e os outros itens do ⋯ (Baixar tudo, Abrir task com isto,
 * Lembrar, Raio-X, Desfazer), os botões extras da barra (o Ouvir) e Reportar. Nenhuma ação some: é o conjunto da barra
 * mais o do ⋯, reunido. Puro: o main.ts monta o diálogo e liga os cliques.
 */

/** As ações do menu segurado: as do ⋯ (`data-fala`) e as da barra, que viram item. `proxy:` clica o botão da barra. */
export type AcaoSegurada = "responder" | "copiar" | "criar-tarefa" | "relatar" | ReturnType<typeof itensDoMenu>[number]["acao"] | `proxy:${string}`;

export type ItemSegurado = { acao: AcaoSegurada; icone: string; texto: string; desabilitado?: boolean } | { divisor: true };

/** Um botão extra da barra da fala (hoje, o Ouvir): o `data-act` e o rótulo dele. */
export type ExtraDaBarra = { act: string; rotulo: string };

/** Os `data-act` da barra que o menu segurado já cobre com item próprio (os outros viram `proxy:`). */
export const ACTS_COBERTOS = ["reagir-fala", "responder-fala", "relatar-mensagem", "mais-da-fala"] as const;

/**
 * Os itens do menu segurado, na ordem do protótipo. `temQuadro`: o bot da conversa aberta tem o quadro à mão (o item
 * "Criar tarefa disto" só aparece aí). `extras`: os botões da barra que não têm item próprio (o Ouvir), na ordem dela.
 */
export function itensDoMenuSegurado(m: Mensagem, estado: Estado, temQuadro: boolean, extras: readonly ExtraDaBarra[] = []): ItemSegurado[] {
  const temTexto = m.texto.trim() !== "";
  const topo: ItemSegurado[] = [];
  if (podeResponder(m, estado)) topo.push({ acao: "responder", icone: ICONE_DA_FALA.responder, texto: "Responder" });
  if (temTexto) topo.push({ acao: "copiar", icone: ICONE_DA_FALA.copiar, texto: "Copiar" });
  if (temTexto && temQuadro && botDaFala(m, estado)) topo.push({ acao: "criar-tarefa", icone: ICONE_DA_FALA.task, texto: "Criar tarefa disto" });
  const resto: ItemSegurado[] = itensDoMenu(m, estado, temQuadro)
    .filter((i) => i.acao !== "copiar" && i.acao !== "criar-tarefa")
    .map((i) => ({ acao: i.acao, icone: i.icone, texto: i.texto, ...(i.desabilitado ? { desabilitado: true } : {}) }));
  for (const x of extras) if (!(ACTS_COBERTOS as readonly string[]).includes(x.act)) resto.push({ acao: `proxy:${x.act}`, icone: "", texto: x.rotulo });
  resto.push({ acao: "relatar", icone: ICONE_DA_FALA.reportar, texto: daPessoa(m) ? "Reportar problema nesta mensagem" : "Reportar problema nesta resposta" });
  return topo.length ? [...topo, { divisor: true }, ...resto] : resto;
}

/** O HTML do menu segurado: as reações no topo (fala de bot) e os itens com `data-fala` (o mesmo clique do ⋯). */
export function htmlMenuSegurado(m: Mensagem, estado: Estado, temQuadro: boolean, extras: readonly ExtraDaBarra[] = []): string {
  const emojis = podeReagir(m) ? linhaDeEmojis(m, estado) : "";
  const itens = itensDoMenuSegurado(m, estado, temQuadro, extras).map((i) => {
    if ("divisor" in i) return '<div class="mfs-divisor" role="separator"></div>';
    const classe = i.acao === "desfazer" ? ' class="dft-mi"' : "";
    return `<button type="button" role="menuitem" data-fala="${esc(i.acao)}"${classe}${i.desabilitado ? ' aria-disabled="true"' : ""}>${i.icone}${esc(i.texto)}</button>`;
  }).join("");
  return `<div role="menu" aria-label="Ações da mensagem">${emojis}${itens}</div>`;
}

/**
 * Título da tarefa criada da fala: o começo da fala numa linha, cortado na palavra. Definido em 2026-11-07 (plano da
 * ADA-2 F5): 80, bem abaixo de `LIMITES_QUADRO.titulo` (200), para caber num card.
 */
export const TITULO_DA_TAREFA_MAX = 80;
/** O mesmo teto de `LIMITES_QUADRO.descricao` (a web só importa tipo de src/; o teste confere que batem). */
export const DESCRICAO_DA_TAREFA_MAX = 4000;

/**
 * "Criar tarefa disto": título = início da fala; descrição = a origem ("Da conversa com Ada, 07/11 14:02") e a fala
 * inteira, cortada no teto. Sem agente nem status: a tarefa cai no Backlog e ninguém começa (S5).
 */
export function tarefaDaFala(texto: string, autor: string, quando: string): { titulo: string; descricao: string } {
  const titulo = inicioDaPergunta(texto, TITULO_DA_TAREFA_MAX);
  const origem = `Da conversa com ${autor}, ${quando}`;
  const cabe = DESCRICAO_DA_TAREFA_MAX - origem.length - 2;
  const corpo = [...texto.trim()];
  const fala = corpo.length <= cabe ? corpo.join("") : `${corpo.slice(0, Math.max(0, cabe - 1)).join("")}…`;
  return { titulo, descricao: `${origem}\n\n${fala}` };
}
