/**
 * A linha do tempo da tarefa aberta, como a issue do Multica (definido em 2026-11-10): os comentários em threads de um
 * nível, cada run (o trabalho de um agente) como um bloco na thread que o acionou, na hora em que entrou na fila, e os
 * movimentos (NOD-419) e as linhas de sistema como eventos discretos. HTML puro; todo texto de fora passa por `esc`, e o
 * texto de agente (frase, motivo, passo) passa antes por `redigir` (segredo sai antes de cortar).
 */
import type { ColunaDto, ComentarioDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { ChipDoComentario, ModoAcionar, PreviaComentarioDto, RunDaTarefa } from "../../src/contracts/quadro-comentarios.ts";
import { esc } from "../lib/escape.ts";
import { porqueNaoDesfaz } from "../lib/freios.ts";
import type { AgenteDoQuadro } from "./quadro-real.ts";
import { anel } from "./quadro.ts";

export const LIMITE_COMENTARIO = 4000;

/* ---------- Pequenos formatos ---------- */

/** "agora", "há 3 min", "há 2 h", "ontem", "12/11". */
export function tempoRelativo(em: number, agora: number): string {
  const s = Math.max(0, Math.round((agora - em) / 1000));
  if (s < 45) return "agora";
  const min = Math.round(s / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  if (h < 48) return "ontem";
  return new Date(em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** "40 s", "3 min", "1 h 5 min". */
export function duracao(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

/** "US$ 0,12 · 18 mil tokens" (só o que o nod registrou; nada = vazio). */
export function gasto(r: Pick<RunDaTarefa, "custoUsd" | "tokens">): string {
  const custo = r.custoUsd !== null && r.custoUsd > 0 ? `US$ ${r.custoUsd.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: r.custoUsd < 0.1 ? 3 : 2 })}` : "";
  const tk = r.tokens !== null && r.tokens > 0 ? (r.tokens >= 1000 ? `${Math.round(r.tokens / 1000).toLocaleString("pt-BR")} mil tokens` : `${r.tokens} tokens`) : "";
  return [custo, tk].filter(Boolean).join(" · ");
}

/** O tempo do run: do começo (ou da fila) ao fim (ou agora). */
export const tempoDoRun = (r: Pick<RunDaTarefa, "criadoEm" | "comecouEm" | "terminouEm">, agora: number): number => (r.terminouEm ?? agora) - (r.comecouEm ?? r.criadoEm);

/**
 * Segredo sai antes de cortar o texto (a frase do agente pode trazer a saída de um comando): chaves conhecidas (sk-, ghp_,
 * xox, AKIA, glpat-), Bearer, e trechos longos de base64/hex.
 */
export function redigir(texto: string): string {
  return texto
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|glpat-[A-Za-z0-9_-]{16,})/g, "••••")
    .replace(/\b(Bearer|token|senha|password|secret)(\s*[:=]?\s*)[A-Za-z0-9._~+/=-]{16,}/gi, "$1$2••••")
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, "••••");
}

/** Redige e corta numa linha (a última não vazia, se `ultima`). */
export function trecho(texto: string | null | undefined, max: number, ultima = false): string {
  const limpo = redigir((texto ?? "").trim());
  const linha = ultima ? limpo.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "" : limpo;
  return linha.length > max ? `${linha.slice(0, max)}…` : linha;
}

/** @Nome dos bots e @todos em destaque, sobre o texto já escapado. */
export function comMencoes(textoEscapado: string, nomes: readonly string[]): string {
  let s = textoEscapado;
  for (const n of [...new Set(["todos", ...nomes])].filter((x) => x.trim()).sort((a, b) => b.length - a.length)) {
    const alvo = `@${esc(n)}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`${alvo}(?![\\p{L}\\p{N}_])`, "giu"), (m) => `<span class="ta-men">${m}</span>`);
  }
  return s;
}

/** Os links https que os comentários do agente entregaram (as Entregas da lateral), o mais novo primeiro, sem repetir. */
export function entregasDe(comentarios: readonly ComentarioDto[]): { url: string; rotulo: string; em: number; autor: string | null }[] {
  const vistos = new Set<string>();
  const out: { url: string; rotulo: string; em: number; autor: string | null }[] = [];
  for (const c of [...comentarios].reverse()) {
    if (c.autor.tipo !== "agente" || c.apagado) continue;
    for (const m of c.texto.matchAll(/https:\/\/[^\s<>"')\]]+/g)) {
      const url = m[0].replace(/[.,;:!?]+$/, "");
      if (vistos.has(url)) continue;
      vistos.add(url);
      out.push({ url, rotulo: rotuloDoLink(url), em: c.criadoEm, autor: c.autorNome });
    }
  }
  return out;
}

function rotuloDoLink(url: string): string {
  const pr = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  if (pr) return `${pr[1]} #${pr[2]}`;
  try {
    const u = new URL(url);
    const arq = u.pathname.split("/").filter(Boolean).pop();
    return arq && arq.includes(".") ? decodeURIComponent(arq) : `${u.host}${u.pathname.length > 1 ? u.pathname : ""}`.slice(0, 60);
  } catch { return url.slice(0, 60); }
}

/* ---------- Quem é quem ---------- */

type Autor = { avatar: string; nome: string; meu: boolean; agenteId: string | null };

export function autorDoComentario(c: ComentarioDto, agente: AgenteDoQuadro): Autor {
  if (c.autor.tipo === "linear") return { avatar: anel((c.autorNome ?? "L").slice(0, 1), c.autorNome ?? "Linear", false), nome: `${c.autorNome ?? "Linear"} · no Linear`, meu: false, agenteId: null };
  if (c.autor.tipo === "pessoa") return { avatar: anel("V", "Você", true), nome: "Você", meu: true, agenteId: null };
  // ADR-162: a espera que o próprio quadro deixou (o bot parou sem saída, o freio) é do quadro, não de um bot.
  if (c.autor.tipo === "sistema") return { avatar: anel("Q", "Quadro", false), nome: "Quadro", meu: false, agenteId: null };
  const a = agente(c.autor.agenteId) ?? { avatar: anel((c.autorNome ?? "?").slice(0, 1), c.autorNome ?? "Bot", false), nome: c.autorNome ?? "Bot" };
  // NOD-430: o bot que comentou a pedido da pessoa assina "Você, pela Ada" (e é dela: edita e apaga).
  return c.pedidoPor ? { avatar: a.avatar, nome: `Você, pela ${a.nome}`, meu: true, agenteId: c.autor.agenteId } : { avatar: a.avatar, nome: a.nome, meu: false, agenteId: c.autor.agenteId };
}

const avatarDoRun = (r: RunDaTarefa, agente: AgenteDoQuadro): { avatar: string; nome: string } =>
  agente(r.agenteId) ?? { avatar: anel((r.agenteNome ?? "?").slice(0, 1), r.agenteNome ?? "Bot", false), nome: r.agenteNome ?? "Bot" };

/* ---------- Os chips do campo ---------- */

export const ROTULO_DO_MODO: Readonly<Record<ModoAcionar, string>> = {
  acionar: "vai começar",
  agora: "manda agora",
  depois: "depois que terminar",
  no_lugar: "no lugar do atual",
  nao: "não aciona",
};
const DESCRICAO_DO_MODO: Readonly<Record<ModoAcionar, string>> = {
  acionar: "Começa um run com este comentário.",
  agora: "Entra no turno em andamento, no próximo passo.",
  depois: "Espera o run atual terminar (ou junta ao que está na fila desta thread).",
  no_lugar: "Cancela o run atual e começa com isto.",
  nao: "Fica só registrado para este agente.",
};
const ESTADO_DO_CHIP: Readonly<Record<ChipDoComentario["estado"], string>> = { parado: "parado", fila: "na fila", rodando: "trabalhando" };
const CHEVRON = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Os chips de quem o comentário aciona, antes de enviar (a prévia do servidor). Cada chip abre um menu com as escolhas;
 * o que não vai rodar é um aviso com o motivo. `chave` = a thread (ou "nova").
 */
export function chipsDoCampo(o: { chave: string; previa: PreviaComentarioDto | null; escolhas: Readonly<Record<string, ModoAcionar>>; aberto: string | null; agente: AgenteDoQuadro }): string {
  const p = o.previa;
  if (!p) return "";
  const chips = p.chips.map((c) => {
    const a = o.agente(c.agenteId) ?? { avatar: anel(c.nome.slice(0, 1), c.nome, false), nome: c.nome };
    if (c.aviso) return `<span class="ta-chip ta-chip-aviso" title="${esc(c.aviso)}"><span class="ta-chip-av" aria-hidden="true">${a.avatar}</span><span>${esc(c.nome)} · ${esc(c.aviso)}</span></span>`;
    const modo = o.escolhas[c.agenteId] && c.opcoes.includes(o.escolhas[c.agenteId]!) ? o.escolhas[c.agenteId]! : c.padrao;
    const aberto = o.aberto === c.agenteId;
    const menu = aberto ? `<div class="ta-chip-menu" role="menu" aria-label="${esc(`Como acionar ${c.nome}`)}"><p class="ta-chip-menu-cab">${esc(c.nome)} · ${esc(ESTADO_DO_CHIP[c.estado])}</p>` +
      c.opcoes.map((m) => `<button type="button" role="menuitemradio" aria-checked="${m === modo}" class="ta-chip-op" data-act="chip-modo" data-chave="${esc(o.chave)}" data-agente="${esc(c.agenteId)}" data-modo="${m}">` +
        `<span class="ta-chip-op-rot">${esc(ROTULO_DO_MODO[m])}</span><span class="ta-chip-op-desc">${esc(DESCRICAO_DO_MODO[m])}</span></button>`).join("") + `</div>` : "";
    return `<span class="ta-chip-g"><button type="button" class="ta-chip" data-modo="${modo}" data-act="chip-menu" data-chave="${esc(o.chave)}" data-agente="${esc(c.agenteId)}" aria-haspopup="menu" aria-expanded="${aberto}" aria-label="${esc(`${c.nome}: ${ROTULO_DO_MODO[modo]}`)}">` +
      `<span class="ta-chip-av" aria-hidden="true">${a.avatar}</span><span class="ta-chip-nome">${esc(c.nome)}</span><span class="ta-chip-modo">${esc(ROTULO_DO_MODO[modo])}</span>${CHEVRON}</button>${menu}</span>`;
  }).join("");
  const pessoas = p.pessoas.length ? `<span class="ta-chip-nota">avisa ${esc(p.pessoas.join(", "))}</span>` : "";
  const nada = p.nada && !p.chips.some((c) => !c.aviso) ? `<span class="ta-chip-nota">${esc(p.nada)}</span>` : "";
  return chips + pessoas + nada;
}

/** O campo de comentário (o do fim e o da resposta na thread). O Enter e o ⌘↵ enviam; a linha dos chips fica embaixo. */
export function campoDeComentario(o: { tarefaId: string; raiz: string | null; chips: string; ocupado?: boolean }): string {
  const id = o.raiz ? `qd-com-${esc(o.tarefaId)}-${esc(o.raiz)}` : `qd-com-${esc(o.tarefaId)}`;
  const chave = o.raiz ?? "nova";
  return `<form class="qd-com-form ta-campo${o.raiz ? " ta-campo-resp" : ""}" data-form="comentar-tarefa" data-id="${esc(o.tarefaId)}"${o.raiz ? ` data-responder="${esc(o.raiz)}"` : ""}>` +
    `<label class="qd-sr" for="${id}">${o.raiz ? "Responder na thread" : "Comentar"}</label>` +
    `<textarea id="${id}" class="qd-com-in" name="texto" rows="1" maxlength="${LIMITE_COMENTARIO}" required data-chave="${esc(chave)}" placeholder="${o.raiz ? "Responder…" : "Comentar… @nome chama um bot, @todos avisa sem acionar"}"></textarea>` +
    `<div class="ta-campo-pe"><div class="ta-chips" data-chips="${esc(chave)}" data-previa="${esc(o.tarefaId)}" aria-live="polite">${o.chips}</div>` +
    (o.raiz ? `<button type="button" class="qd-link ta-campo-fechar" data-act="com-responder-fechar" data-raiz="${esc(o.raiz)}">Cancelar</button>` : "") +
    `<button type="submit" class="qd-com-bt ta-enviar"${o.ocupado ? " disabled" : ""}>Enviar <kbd>⌘↵</kbd></button></div></form>`;
}

/* ---------- Os itens da linha ---------- */

export type EventoDaLinha = { id: string; em: number; html: string };

/** Os movimentos (NOD-419) e as linhas de sistema como eventos discretos; o Desfazer só no último que ainda vale. */
export function eventosDaTarefa(t: TarefaDto, cs: readonly ColunaDto[], agora: number): EventoDaLinha[] {
  const nome = (id: string) => cs.find((c) => c.id === id)?.nome ?? id;
  const evs: EventoDaLinha[] = [];
  for (const m of t.movimentos ?? []) {
    if (m.tipo === "acionou") continue; // o run aparece no lugar
    const quem = m.autor.tipo === "agente" ? m.autorNome ?? "Um agente" : m.autor.tipo === "pessoa" ? "Você" : "O quadro";
    const oque = m.de !== m.para ? `moveu de ${nome(m.de)} para ${nome(m.para)}`
      : m.agenteAntes !== m.agenteDepois ? `passou para ${m.agenteDepoisNome ?? "ninguém"}`
      : m.tipo === "freio" ? "freio" : m.tipo;
    const extra = m.tipo === "nao_e_comigo" ? " (não é comigo)" : m.tipo === "laco" ? " (laço)" : m.tipo === "desfazer" ? " (desfez)" : "";
    const porque = porqueNaoDesfaz(t, m, cs);
    const desfeito = m.desfeitoEm !== null;
    const bt = !porque ? ` <button type="button" class="qd-link ta-ev-acao" data-act="tarefa-desfazer-movimento" data-id="${esc(m.id)}">Desfazer</button>` : "";
    const motivo = m.motivo ? `<span class="ta-ev-motivo"> · ${esc(trecho(m.motivo, 160))}</span>` : "";
    evs.push({ id: m.id, em: m.criadoEm, html: `<li class="ta-ev${desfeito ? " ta-ev-desfeito" : ""}"><span class="ta-ev-ponto" aria-hidden="true"></span><span><b>${esc(quem)}</b> ${esc(oque + extra)}${motivo}${desfeito ? `<span class="qd-sr"> (desfeito)</span>` : ""}</span>${horaEv(m.criadoEm, agora)}${bt}</li>` });
  }
  for (const l of t.linhas ?? []) evs.push({ id: `l-${l.criadoEm}-${l.texto.slice(0, 12)}`, em: l.criadoEm, html: `<li class="ta-ev"><span class="ta-ev-ponto" aria-hidden="true"></span><span>${esc(l.texto)}</span>${horaEv(l.criadoEm, agora)}</li>` });
  return evs;
}

const horaEv = (em: number, agora: number): string => `<time class="ta-ev-hora" datetime="${new Date(em).toISOString()}" title="${esc(new Date(em).toLocaleString("pt-BR"))}">${esc(tempoRelativo(em, agora))}</time>`;

export type PassoAoVivo = { ultimo: string | null; n: number; lista: readonly { rotulo: string; estado: string }[] };

export type DadosDaLinha = {
  t: TarefaDto;
  colunas: readonly ColunaDto[];
  comentarios: readonly ComentarioDto[];
  runs: readonly RunDaTarefa[];
  agente: AgenteDoQuadro;
  agora: number;
  /** Os nomes dos bots (o destaque das @menções). */
  nomes: readonly string[];
  /** A thread com o campo de resposta aberto. */
  respondendo: string | null;
  editando: string | null;
  /** Os runs abertos (o cabeçalho compacto expandido). */
  abertos: ReadonlySet<string>;
  /** Os passos ao vivo de um run (o turno que roda agora); null = ninguém escuta. */
  passos: (turnoAtual: string) => PassoAoVivo | null;
  /** O HTML dos chips de cada campo (por chave: a raiz ou "nova"). */
  chips: (chave: string) => string;
  pendente: { texto: string; falhou: boolean; duvida?: boolean; paiId?: string | null } | null;
  criadaPor: string | null;
  criadaEm: number | null;
  carga: "carregando" | "ok" | "erro";
  /** A pessoa fechou o reply que abre sozinho embaixo da pergunta do bot. */
  fechouPergunta?: boolean;
};

/**
 * 2026-11-10 (pedido do Marlon, como o Multica): a tarefa que espera a pessoa (ADR-162) não tem bloco próprio; a pergunta
 * é o comentário do bot (ou do quadro) que a trouxe: o mais novo da raiz, de agente ou do sistema, que termina com o
 * texto da pergunta (o quadro põe a @menção na frente). Sem um que case, o último de agente na raiz. null = não espera.
 */
export function comentarioDaPergunta(t: Pick<TarefaDto, "esperaPessoa" | "pergunta">, comentarios: readonly ComentarioDto[]): string | null {
  if (!t.esperaPessoa) return null;
  const raizes = comentarios.filter((c) => !c.paiId && !c.apagado && (c.autor.tipo === "agente" || c.autor.tipo === "sistema")).reverse();
  const p = (t.pergunta ?? "").trim();
  return (p ? raizes.find((c) => c.texto.trim().endsWith(p)) : undefined)?.id ?? raizes[0]?.id ?? null;
}

const vivo = (r: RunDaTarefa): boolean => r.estado === "fila" || r.estado === "rodando";

/** O run concluído que deu origem a este comentário de agente (o bloco compacta no cabeçalho dele). */
function casarRuns(itens: readonly ComentarioDto[], runs: readonly RunDaTarefa[]): Map<string, RunDaTarefa> {
  const usados = new Set<string>();
  const porComentario = new Map<string, RunDaTarefa>();
  for (const r of runs) {
    if (r.estado !== "concluido") continue;
    const c = itens.find((x) => !porComentario.has(x.id) && x.autor.tipo === "agente" && x.autor.agenteId === r.agenteId && x.criadoEm >= r.criadoEm && x.criadoEm <= (r.terminouEm ?? Infinity) + 120_000);
    if (c && !usados.has(r.turnoId)) { porComentario.set(c.id, r); usados.add(r.turnoId); }
  }
  return porComentario;
}

function blocoDoRun(r: RunDaTarefa, d: DadosDaLinha): string {
  const a = avatarDoRun(r, d.agente);
  const t = duracao(tempoDoRun(r, d.agora));
  const ao = d.passos(r.turnoAtual);
  const estado = r.estado === "rodando" ? `está trabalhando · ${t}` : r.estado === "fila" ? "na fila" : r.estado === "falhou" ? "falhou" : r.estado === "cancelado" ? "cancelado" : `terminou · ${t}`;
  const titulo = r.estado === "falhou" && r.motivo ? ` title="${esc(trecho(r.motivo, 300))}"` : "";
  const ultimo = vivo(r) ? (ao?.ultimo ? trecho(ao.ultimo, 140) : r.estado === "rodando" ? "Começando…" : "") : r.estado === "falhou" ? trecho(r.motivo, 200) : trecho(r.ultimaFrase, 200, true);
  const linhaVivo = `<p class="ta-run-passo"${vivo(r) ? ` data-run-vivo="${esc(r.turnoAtual)}"` : ""}>${esc(ultimo)}</p>`;
  const aberto = d.abertos.has(r.turnoId);
  const lista = aberto && ao?.lista.length ? `<ol class="ta-run-passos">${ao.lista.slice(-40).map((p) => `<li data-estado="${esc(p.estado)}">${esc(trecho(p.rotulo, 140))}</li>`).join("")}</ol>` : "";
  const tg = ao?.n ? `<button type="button" class="qd-link ta-run-tg" data-act="run-abrir" data-turno="${esc(r.turnoId)}" aria-expanded="${aberto}">${aberto ? "▾" : "›"} ${ao.n} ${ao.n === 1 ? "passo" : "passos"}</button>` : "";
  const g = gasto(r);
  return `<li class="ta-run" data-ancora="run-${esc(r.turnoId)}" data-estado="${r.estado}" data-turno="${esc(r.turnoId)}"><span class="ta-run-av" aria-hidden="true">${a.avatar}</span><div class="ta-run-corpo">` +
    `<p class="ta-run-cab"${titulo}><b>${esc(a.nome)}</b> <span class="ta-run-est">${esc(estado)}</span>${g && !vivo(r) ? `<span class="ta-run-gasto"> · ${esc(g)}</span>` : ""}${horaEv(r.criadoEm, d.agora)}</p>` +
    (ultimo || vivo(r) ? linhaVivo : "") + tg + lista + `</div></li>`;
}

/** O cabeçalho compacto do run que respondeu (expansível: o tempo, o gasto e a última frase). */
function runNoCabecalho(r: RunDaTarefa, d: DadosDaLinha): string {
  const aberto = d.abertos.has(r.turnoId);
  return `<button type="button" class="ta-run-mini" data-act="run-abrir" data-turno="${esc(r.turnoId)}" aria-expanded="${aberto}">trabalhou ${esc(duracao(tempoDoRun(r, d.agora)))} ${aberto ? "▾" : "›"}</button>`;
}

function detalheDoRun(r: RunDaTarefa, d: DadosDaLinha): string {
  if (!d.abertos.has(r.turnoId)) return "";
  const ao = d.passos(r.turnoAtual);
  const g = gasto(r);
  const lista = ao?.lista.length ? `<ol class="ta-run-passos">${ao.lista.slice(-40).map((p) => `<li data-estado="${esc(p.estado)}">${esc(trecho(p.rotulo, 140))}</li>`).join("")}</ol>` : "";
  return `<div class="ta-run-det"><p>${esc([`${duracao(tempoDoRun(r, d.agora))}`, g || "sem custo registrado"].join(" · "))}</p>${lista}</div>`;
}

function cardDoComentario(c: ComentarioDto, d: DadosDaLinha, run: RunDaTarefa | undefined, raiz: string, aguardando = false): string {
  const a = autorDoComentario(c, d.agente);
  const quando = `<time datetime="${new Date(c.criadoEm).toISOString()}" title="${esc(new Date(c.criadoEm).toLocaleString("pt-BR"))}">${esc(tempoRelativo(c.criadoEm, d.agora))}</time>`;
  if (c.apagado) return `<article class="ta-com ta-com-apagado" id="com-${esc(c.id)}"><p class="ta-com-txt">Comentário apagado</p></article>`;
  const editado = c.editadoEm ? `<span class="ta-com-editado" title="${esc(new Date(c.editadoEm).toLocaleString("pt-BR"))}">editado</span>` : "";
  const acoes = `<span class="ta-com-acoes">` +
    `<button type="button" class="ta-com-ac" data-act="com-responder" data-raiz="${esc(raiz)}">Responder</button>` +
    `<button type="button" class="ta-com-ac" data-act="com-link" data-id="${esc(c.id)}">Copiar link</button>` +
    (a.meu ? `<button type="button" class="ta-com-ac" data-act="com-editar" data-id="${esc(c.id)}">Editar</button><button type="button" class="ta-com-ac" data-act="com-apagar" data-id="${esc(c.id)}">Apagar</button>` : "") + `</span>`;
  const corpo = d.editando === c.id
    ? `<form class="ta-editar" data-form="editar-comentario" data-id="${esc(c.id)}" data-tarefa="${esc(c.tarefaId)}"><label class="qd-sr" for="ta-ed-${esc(c.id)}">Editar comentário</label><textarea id="ta-ed-${esc(c.id)}" class="qd-com-in ta-editar-in" name="texto" maxlength="${LIMITE_COMENTARIO}" required>${esc(c.texto)}</textarea>` +
      `<span class="ta-editar-pe"><button type="button" class="qd-link" data-act="com-editar-cancelar">Cancelar</button><button type="submit" class="qd-com-bt">Salvar</button></span></form>`
    : `<p class="ta-com-txt">${comMencoes(esc(c.texto), d.nomes)}</p>`;
  const acionou = c.acionados.length ? `<p class="ta-com-acao">acionou ${esc(c.acionados.join(", "))}</p>` : "";
  return `<article class="ta-com" id="com-${esc(c.id)}"><span class="ta-com-av" aria-hidden="true">${a.avatar}</span><div class="ta-com-corpo">` +
    `<p class="ta-com-cab"><span class="ta-com-nome">${esc(a.nome)}</span>${run ? runNoCabecalho(run, d) : ""}${quando}${editado}${aguardando ? `<span class="ta-aguarda">aguardando sua resposta</span>` : ""}${acoes}</p>` +
    (run ? detalheDoRun(run, d) : "") + corpo + acionou + `</div></article>`;
}

function pendenteDe(p: NonNullable<DadosDaLinha["pendente"]>): string {
  const est = p.falhou && p.duvida ? `<span class="qd-com-est">Sem resposta: pode ter saído. Confira a lista antes de mandar de novo.</span>`
    : p.falhou ? `<span class="qd-com-est">Não saiu.</span> <button type="button" class="qd-link qd-com-tentar" data-act="com-tentar">Tentar de novo</button>`
    : `<span class="qd-com-est">enviando</span>`;
  return `<article class="ta-com qd-com-pendente${p.falhou ? " qd-com-falhou" : ""}"><span class="ta-com-av" aria-hidden="true">${anel("V", "Você", true)}</span><div class="ta-com-corpo">` +
    `<p class="ta-com-cab"><span class="ta-com-nome">Você</span>${est}</p><p class="ta-com-txt">${esc(p.texto)}</p></div></article>`;
}

/**
 * A linha do tempo inteira: "Criada por …", os eventos, as threads (raiz, respostas, runs na posição em que entraram na
 * fila, o campo de resposta) e os runs do trabalho da tarefa que não vieram de comentário. Em ordem de tempo.
 */
export function linhaDoTempo(d: DadosDaLinha): string {
  const porId = new Map(d.comentarios.map((c) => [c.id, c]));
  const raizDe = (c: ComentarioDto): string => (c.paiId && porId.has(c.paiId) ? c.paiId : c.id);
  const casados = casarRuns(d.comentarios, d.runs);
  const compactados = new Set([...casados.values()].map((r) => r.turnoId));
  // A pergunta do bot: o reply dela já vem aberto (até a pessoa fechar) e o cabeçalho diz "aguardando sua resposta".
  const pergunta = comentarioDaPergunta(d.t, d.comentarios);
  const respondendo = d.respondendo ?? (pergunta && !d.fechouPergunta ? pergunta : null);
  type Item = { em: number; html: string };
  const topo: Item[] = eventosDaTarefa(d.t, d.colunas, d.agora).map((e) => ({ em: e.em, html: e.html }));
  if (d.criadaPor && d.criadaEm) topo.push({ em: d.criadaEm - 1, html: `<li class="ta-ev"><span class="ta-ev-ponto" aria-hidden="true"></span><span><b>${esc(d.criadaPor)}</b> criou a tarefa</span>${horaEv(d.criadaEm, d.agora)}</li>` });
  const threads = new Map<string, Item[]>();
  for (const c of d.comentarios) {
    const r = raizDe(c);
    if (r === c.id) continue;
    if (!threads.has(r)) threads.set(r, []);
    threads.get(r)!.push({ em: c.criadoEm, html: `<li class="ta-resp">${cardDoComentario(c, d, casados.get(c.id), r)}</li>` });
  }
  for (const run of d.runs) {
    if (compactados.has(run.turnoId)) continue;
    const c = run.comentarioId ? porId.get(run.comentarioId) : undefined;
    const item = { em: run.criadoEm, html: blocoDoRun(run, d) };
    if (!c) { topo.push(item); continue; }
    const r = raizDe(c);
    if (!threads.has(r)) threads.set(r, []);
    threads.get(r)!.push(item);
  }
  if (d.pendente?.paiId && porId.has(d.pendente.paiId)) {
    const r = d.pendente.paiId;
    if (!threads.has(r)) threads.set(r, []);
    threads.get(r)!.push({ em: Infinity, html: `<li class="ta-resp">${pendenteDe(d.pendente)}</li>` });
  }
  for (const c of d.comentarios) {
    if (raizDe(c) !== c.id) continue;
    const resps = (threads.get(c.id) ?? []).sort((a, b) => a.em - b.em).map((i) => i.html).join("");
    const aberta = respondendo === c.id;
    const pe = aberta ? campoDeComentario({ tarefaId: d.t.id, raiz: c.id, chips: d.chips(c.id) })
      : resps ? `<button type="button" class="qd-link ta-th-responder" data-act="com-responder" data-raiz="${esc(c.id)}">Responder</button>` : "";
    topo.push({ em: c.criadoEm, html: `<li class="ta-th${c.id === pergunta ? " ta-th-pergunta" : ""}">${cardDoComentario(c, d, casados.get(c.id), c.id, c.id === pergunta)}${resps || pe ? `<ol class="ta-resps">${resps}</ol>${pe}` : ""}</li>` });
  }
  if (d.pendente && !(d.pendente.paiId && porId.has(d.pendente.paiId))) topo.push({ em: Infinity, html: `<li class="ta-th">${pendenteDe(d.pendente)}</li>` });
  const itens = topo.sort((a, b) => a.em - b.em).map((i) => i.html).join("");
  const estado = d.carga === "carregando" && !itens ? `<p class="qd-com-vazio">Carregando…</p>` : d.carga === "erro" ? `<p class="qd-com-vazio">Não consegui ler os comentários.</p>` : "";
  return `<section class="ta-tempo qd-coms" aria-labelledby="ta-tempo-tit"><h2 class="ta-sec" id="ta-tempo-tit">Atividade</h2>${estado}` +
    (itens ? `<ol class="ta-lista">${itens}</ol>` : "") +
    `<div class="ta-pe">${campoDeComentario({ tarefaId: d.t.id, raiz: null, chips: d.chips("nova"), ocupado: !!d.pendente && !d.pendente.falhou })}</div></section>`;
}
