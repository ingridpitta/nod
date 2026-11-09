import type { ConversaNaoLida } from "../../src/contracts/nao-lidos.ts";
import type { Estado } from "../estado/reducer.ts";
import { assinatura } from "../lib/assinatura.ts";
import { botao, dataHora, esc, hora, iconeAgente } from "../lib/render.ts";
import { htmlDaPrevia } from "../lib/previa-nao-lida.ts";
import { nomesDe } from "./conversa.ts";
import { abertasPorAgente, perguntasPorAgente } from "./sua-vez.ts";

/**
 * Não lidos (definido em 2026-09-29, 0039; canvas "Nod — tela do agente", página "Não lidos"). Toda fala que
 * chega numa conversa que a pessoa não está vendo marca não lido: o ponto cinza do mascote (o mesmo de antes),
 * a prévia em tinta escura e, na sala, o ponto à direita. Com algo não lido, o ícone entre a busca e o + abre
 * esta tela, a conversa mais recente em cima. Ler aqui não marca como lido: só "Marcar como lido" ou abrir.
 */

export const BANDEJA = '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3 11.5 5.2 4.5h9.6L17 11.5v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 11.5h4.2l1 2h3.6l1-2H17"/></svg>';

export function naoLidaDe(estado: Pick<Estado, "naoLidos">, conversaId: string): ConversaNaoLida | undefined {
  return estado.naoLidos?.conversas.find((c) => c.conversaId === conversaId);
}

function conversas(n: number): string {
  return `${n} ${n === 1 ? "conversa" : "conversas"}`;
}

/** "hoje, 08:00", "ontem, 18:40" ou a data: a pessoa lê quando chegou sem fazer conta. */
export function quando(instante: number, agora: number): string {
  const dia = (t: number) => new Date(t).toDateString();
  if (dia(instante) === dia(agora)) return `hoje, ${hora(instante)}`;
  if (dia(instante) === dia(agora - 86_400_000)) return `ontem, ${hora(instante)}`;
  return dataHora(instante);
}

/** O rótulo do ícone do topo da barra ("Não lidos: 4 conversas"). */
export function rotuloNaoLidos(estado: Pick<Estado, "naoLidos">): string {
  const n = estado.naoLidos?.conversas.length ?? 0;
  return n ? `Não lidos: ${conversas(n)}` : "Não lidos: nada novo";
}

export const CHECK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';

/** "11:03" hoje, "ontem" ou "12/10": a hora curta da linha, ao lado da contagem. */
export function horaCurta(instante: number, agora: number): string {
  const dia = (t: number) => new Date(t).toDateString();
  if (dia(instante) === dia(agora)) return hora(instante);
  if (dia(instante) === dia(agora - 86_400_000)) return "ontem";
  return new Date(instante).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** O subtítulo: "4 conversas · desde as 11:02" (hoje), "· desde ontem, 18:40" ou "· desde 12/10/2026, 09:00". */
export function subtitulo(n: number, maisAntigo: number, agora: number): string {
  const q = quando(maisAntigo, agora);
  return `${conversas(n)} · desde ${q.startsWith("hoje, ") ? `as ${q.slice(6)}` : q}`;
}

/** O nome que a linha mostra (e que o aviso "X marcada como lida" usa). */
export function nomeDaConversa(c: ConversaNaoLida, estado: Pick<Estado, "frota" | "salas">): string {
  if (c.tipo === "sala") return `# ${estado.salas.find((s) => s.sala.id === c.salaId)?.sala.nome ?? "sala"}`;
  return estado.frota?.agentes.find((a) => a.id === c.agenteId)?.nome ?? "bot";
}

/**
 * NOD-449 (protótipo aprovado): uma linha por conversa. A linha inteira abre a conversa; o ✓ fica no lugar da hora e
 * aparece com o mouse ou o foco (no toque, sempre); deslizar para a direita no celular também marca (web/lib/deslize-lida.ts).
 */
function linha(c: ConversaNaoLida, estado: Estado, decisoes: Map<string, number>, perguntas: Map<string, number>): string {
  const agente = c.agenteId ? estado.frota?.agentes.find((a) => a.id === c.agenteId) : undefined;
  const nomes = nomesDe(estado);
  const esperando = c.agenteId && (decisoes.get(c.agenteId) ?? 0) > 0 ? "decisao" : c.agenteId && (perguntas.get(c.agenteId) ?? 0) > 0 ? "pergunta" : "";
  const marca = c.tipo === "sala" ? '<span class="nl-sala" aria-hidden="true">#</span>' : agente ? iconeAgente(agente, "sm", "disponivel", esperando ? `data-aviso="${esperando}"` : "") : '<span class="nl-sala" aria-hidden="true"></span>';
  const nome = nomeDaConversa(c, estado);
  const chip = agente?.titulo ? `<i class="chip" title="${esc(agente.titulo)}">${esc(agente.titulo)}</i>` : "";
  const novas = `${c.total} ${c.total === 1 ? "nova" : "novas"}`;
  const h = horaCurta(c.ultimaEm, estado.agora);
  const previa = htmlDaPrevia(c.mensagens, c.tipo === "sala" ? (m) => assinatura(m.autoria, nomes) : undefined);
  const abrir = c.tipo === "sala" && c.salaId
    ? `data-act="abrir-sala" data-sala="${esc(c.salaId)}" data-conversa="${esc(c.conversaId)}"`
    : `data-act="abrir-conversa" data-conversa="${esc(c.conversaId)}" data-agente="${esc(c.agenteId ?? "")}"`;
  return `<li class="nl-item" data-conversa="${esc(c.conversaId)}" data-nome="${esc(nome)}">
    <span class="nl-deslize" aria-hidden="true">${CHECK}Lido</span>
    <div class="nl-linha"><button type="button" class="nl-abrir" ${abrir} aria-label="${esc(`${nome}, ${novas}, ${quando(c.ultimaEm, estado.agora)}. Abrir conversa`)}">${marca}<span class="nl-l1"><b>${esc(nome)}</b>${chip}<span class="nl-meta"><span>${esc(novas)}</span> · <time>${esc(h)}</time></span></span><span class="nl-previa">${previa}</span></button>
    <button type="button" class="nl-check" data-act="marcar-lida" data-conversa="${esc(c.conversaId)}" data-nome="${esc(nome)}" aria-label="${esc(`Marcar ${nome} como lido`)}" aria-keyshortcuts="E" title="Marcar como lido · E">${CHECK}</button></div>
  </li>`;
}

export function renderNaoLidos(estado: Estado): string {
  if (!estado.naoLidos) return '<div class="tela-nao-lidos"><p class="mudo">carregando…</p></div>';
  const lista = estado.naoLidos.conversas;
  if (!lista.length) {
    return `<div class="tela-nao-lidos"><header class="nl-topo"><div><h1>Não lidos</h1><p>Nada novo</p></div></header><div class="nl-vazio"><span class="nl-vazio-ic">${CHECK}</span><b>Tudo em dia</b><p>Quando um bot falar com você, aparece aqui.</p></div></div>`;
  }
  const maisAntigo = lista.reduce((min, c) => Math.min(min, c.desde), Infinity);
  const decisoes = abertasPorAgente(estado);
  const perguntas = perguntasPorAgente(estado);
  const itens = lista.map((c) => linha(c, estado, decisoes, perguntas)).join("");
  return `<div class="tela-nao-lidos"><header class="nl-topo"><div><h1>Não lidos</h1><p>${esc(subtitulo(lista.length, maisAntigo, estado.agora))}</p></div>${botao("marcar-tudo-lido", "Marcar tudo como lido", { classe: "link sm mudo-bt nl-tudo" })}</header><ul class="nl-lista" aria-label="Conversas com mensagens novas para você">${itens}</ul><p class="nl-kbd" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> anda · <kbd>Enter</kbd> abre · <kbd>E</kbd> marca como lido</p></div>`;
}
