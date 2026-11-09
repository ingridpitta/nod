import { ICONE } from "./icones.ts";
import { esc } from "./render.ts";

/**
 * NOD-367 (protótipo v2 do Gil, aprovado em 2026-10-26): a linha única das Configurações. Toda lista das 6 seções usa
 * esta linha — título, detalhe, status com um ponto de cor e um controle à direita — e o mesmo switch, o mesmo seletor
 * (`<select>` nativo), o mesmo "…" (`.cl-mais`/`.cl-menu`) e a mesma linha recolhida (botão com `aria-expanded`, sem
 * `<details>`). A cor fica só no ponto; o texto sempre diz o estado.
 */

export type TomStatus = "ok" | "atencao" | "erro" | "neutro";

export type OpcaoSeletor = { valor: string; rotulo: string; selecionado?: boolean; desabilitado?: boolean };

export type ControleLinha =
  /** O switch: `data-act` no clique; `desabilitado` trava na posição guardada. */
  | { tipo: "switch"; ligado: boolean; acao: string; dados?: Record<string, string>; desabilitado?: boolean; descritoPor?: string }
  /** O `<select>`: a ação vai em `data-act-change` (o clique não dispara nada; só a troca). */
  | { tipo: "seletor"; acao: string; rotulo: string; opcoes: readonly OpcaoSeletor[]; dados?: Record<string, string> }
  /** O "…": `aberto` mostra os itens (HTML de botões) num `.cl-menu`. */
  | { tipo: "menu"; acao: string; aberto: boolean; rotulo: string; itens: string; dados?: Record<string, string> }
  /** A linha inteira vira um botão, com a seta. */
  | { tipo: "link"; acao: string; dados?: Record<string, string>; desabilitado?: boolean }
  /** A linha inteira abre e fecha o que vem embaixo dela (`id` estável: vira o `aria-controls`). */
  | { tipo: "recolhe"; id: string; acao: string; aberto: boolean; conteudo: string; dados?: Record<string, string> }
  /** Qualquer coisa à direita (atalhos, um botão de texto). */
  | { tipo: "html"; html: string };

export type LinhaConfig = {
  titulo: string;
  /** Texto simples (escapado). */
  detalhe?: string;
  /** HTML já escapado no lugar do detalhe (quando o detalhe precisa de marcação). */
  detalheHtml?: string;
  /** HTML do ícone (SVG ou mascote). */
  icone?: string;
  /** HTML focável antes do ícone (a alça de arrastar de Provedores, NOD-373): o `.lc-ic` é aria-hidden, então ela fica fora. */
  antes?: string;
  /** `vivo`: o status é lido quando muda (role="status"). */
  status?: { texto: string; tom: TomStatus; vivo?: boolean };
  /** A data numa coluna à direita (Feedback). */
  quando?: string;
  classe?: string;
  /** Excluir: o perigo fica no texto e no ícone, sem fundo. */
  perigo?: boolean;
  controle?: ControleLinha;
  /** Atributos extras na linha (ex.: `id`), já montados. */
  attrs?: string;
};

const dadosAttr = (dados: Record<string, string> | undefined): string =>
  dados ? Object.entries(dados).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("") : "";

export function statusLinha(s: { texto: string; tom: TomStatus; vivo?: boolean }): string {
  return `<span class="lc-status lc-tom-${s.tom}"${s.vivo ? ' role="status"' : ""}><i aria-hidden="true"></i>${esc(s.texto)}</span>`;
}

export function switchLinha(c: Extract<ControleLinha, { tipo: "switch" }>, rotulo: string): string {
  return `<button type="button" class="lc-switch" role="switch" aria-checked="${c.ligado}" aria-label="${esc(rotulo)}" data-act="${esc(c.acao)}"${dadosAttr(c.dados)}${c.descritoPor ? ` aria-describedby="${esc(c.descritoPor)}"` : ""}${c.desabilitado ? " disabled" : ""}><span></span></button>`;
}

/**
 * NOD-119: o seletor segmentado (radiogroup com foco itinerante). Só a opção marcada entra no Tab; setas, Home e End
 * mudam a escolha (proximoDoSegmentado); o clique vai em `data-act` com `data-valor`.
 */
export function segmentado(c: { acao: string; rotulo: string; opcoes: readonly OpcaoSeletor[]; descritoPor?: string }): string {
  const botoes = c.opcoes.map((o) => `<button type="button" role="radio" class="seg-opcao" aria-checked="${o.selecionado ? "true" : "false"}" tabindex="${o.selecionado ? "0" : "-1"}" data-act="${esc(c.acao)}" data-valor="${esc(o.valor)}">${esc(o.rotulo)}</button>`).join("");
  return `<div class="segmentado" role="radiogroup" aria-label="${esc(c.rotulo)}"${c.descritoPor ? ` aria-describedby="${esc(c.descritoPor)}"` : ""}>${botoes}</div>`;
}

/** A tecla no segmentado: o índice da próxima opção (setas giram, Home/End vão às pontas) ou null se a tecla não é dele. */
export function proximoDoSegmentado(atual: number, total: number, tecla: string): number | null {
  if (total <= 0) return null;
  if (tecla === "ArrowRight" || tecla === "ArrowDown") return (atual + 1) % total;
  if (tecla === "ArrowLeft" || tecla === "ArrowUp") return (atual - 1 + total) % total;
  if (tecla === "Home") return 0;
  if (tecla === "End") return total - 1;
  return null;
}

export function seletorLinha(c: Extract<ControleLinha, { tipo: "seletor" }>): string {
  const opcoes = c.opcoes.map((o) => `<option value="${esc(o.valor)}"${o.selecionado ? " selected" : ""}${o.desabilitado ? " disabled" : ""}>${esc(o.rotulo)}</option>`).join("");
  return `<select class="lc-seletor" aria-label="${esc(c.rotulo)}" data-act-change="${esc(c.acao)}"${dadosAttr(c.dados)}>${opcoes}</select>`;
}

export function menuLinha(c: Extract<ControleLinha, { tipo: "menu" }>): string {
  const menu = c.aberto ? `<div class="cl-menu" role="menu" aria-label="${esc(c.rotulo)}">${c.itens}</div>` : "";
  return `<div class="cl-mais"><button type="button" class="cl-mais-bt" data-act="${esc(c.acao)}"${dadosAttr(c.dados)} aria-haspopup="menu" aria-expanded="${c.aberto}" aria-label="Mais ações de ${esc(c.rotulo)}">${ICONE.pontos}</button>${menu}</div>`;
}

/** Um item do "…" (o mesmo `.cl-menu` de Provedores e Máquinas). */
export function itemMenu(acao: string, icone: string, rotulo: string, extra: { nota?: string; dados?: Record<string, string>; perigo?: boolean; papel?: "menuitem" | "menuitemradio"; marcado?: boolean } = {}): string {
  const papel = extra.papel ?? "menuitem";
  const marcado = papel === "menuitemradio" ? ` aria-checked="${extra.marcado ?? false}"` : "";
  return `<button type="button" role="${papel}"${marcado}${extra.perigo ? ' class="perigo"' : ""} data-act="${esc(acao)}"${dadosAttr(extra.dados)}>${icone}<span>${esc(rotulo)}${extra.nota ? `<small>${esc(extra.nota)}</small>` : ""}</span></button>`;
}

/**
 * NOD-367 (a11y do "…", APG menu): setas, Home e End movem o foco entre os itens do `.cl-menu`, em volta. Devolve o
 * índice do próximo item, ou null quando a tecla não é de navegação. Os itens `aria-disabled` (a leitura da máquina)
 * entram na volta: é assim que o leitor de tela chega neles.
 */
export function proximoItemDoMenu(qtd: number, atual: number, tecla: string): number | null {
  if (qtd === 0) return null;
  if (tecla === "Home") return 0;
  if (tecla === "End") return qtd - 1;
  if (tecla !== "ArrowDown" && tecla !== "ArrowUp") return null;
  if (atual < 0) return tecla === "ArrowDown" ? 0 : qtd - 1;
  return (atual + (tecla === "ArrowDown" ? 1 : -1) + qtd) % qtd;
}

/** Um texto dentro do "…" (a leitura, uma nota): item desabilitado, focável pelas setas e lido pelo leitor de tela. */
export function textoNoMenu(html: string, chave: string, classe = "cfg-leitura"): string {
  // `data-menu-texto`: a chave estável do item, para o foco voltar a ele quando a leitura muda e o "…" é redesenhado
  // aberto (revisão 4: um div sem data-* deixava o foco cair no <body> a cada releitura de 30 s).
  return `<div class="${esc(classe)}" role="menuitem" aria-disabled="true" tabindex="-1" data-menu-texto="${esc(chave)}">${html}</div>`;
}

/** Normaliza para busca: sem acento e sem caixa ("Téo" acha "teo"). */
export function normalizarBusca(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").trim();
}

/**
 * NOD-383 (critério 7, Gil item 4): no celular o detalhe tem uma linha só (o CSS corta com reticências). O que passa disso
 * mora num "Saiba mais" que abre na própria linha, sem modal. Quem desenha as Configurações diz se é celular e o que está
 * aberto (o `configUi.abertos` da seção, com a chave `saiba:<título>`); sem isso (desktop, outras telas) nada muda.
 * A auditoria de toque (`scripts/alvos-44px/`) acusa todo detalhe cortado sem o "Saiba mais": o limite abaixo é uma
 * estimativa conservadora, conferida no Chrome em 390 px.
 */
export const LIMITE_DETALHE_CELULAR = 36;
type ContextoSaiba = { celular: boolean; abertos: readonly string[] };
let contextoSaiba: ContextoSaiba = { celular: false, abertos: [] };
/** Quantas vezes cada chave já saiu neste desenho: dois bots com o mesmo nome ganham chaves (e ids) diferentes. */
let chavesUsadas = new Map<string, number>();

/** Desenha `render` com o contexto do "Saiba mais" e volta ao de antes (desktop), mesmo se `render` lançar. */
export function comSaibaMais<T>(ctx: ContextoSaiba, render: () => T): T {
  const antes = contextoSaiba;
  const usadasAntes = chavesUsadas;
  contextoSaiba = ctx;
  chavesUsadas = new Map();
  try {
    return render();
  } finally {
    contextoSaiba = antes;
    chavesUsadas = usadasAntes;
  }
}

/** A chave estável do "Saiba mais" de uma linha ou nota (a ação é a mesma `config-recolhe` das linhas recolhidas). */
export function chaveSaiba(texto: string): string {
  return `saiba:${normalizarBusca(texto).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/** A chave do texto neste desenho: a primeira é `chaveSaiba(texto)`, as repetidas ganham `-2`, `-3`… na ordem. */
function chaveUnica(texto: string): string {
  const base = chaveSaiba(texto);
  const n = (chavesUsadas.get(base) ?? 0) + 1;
  chavesUsadas.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

/**
 * Quantos caracteres cabem numa linha do detalhe, em 14 px e 390 px, com o que fica à direita: o seletor come quase
 * metade da linha; o status, o próprio texto. A conta é por caracteres (o detalhe é texto simples).
 */
export function limiteDoDetalhe(l: Pick<LinhaConfig, "controle" | "status" | "quando">): number {
  const c = l.controle?.tipo;
  const base = c === "seletor" ? 14 : c === "html" ? 22 : c === "switch" ? 30 : c === "menu" ? 32 : LIMITE_DETALHE_CELULAR;
  const direita = (l.status ? l.status.texto.length + 3 : 0) + (l.quando ? l.quando.length + 2 : 0);
  return Math.max(10, base - direita);
}

/** O texto passa de uma linha no celular? */
function passaDeUmaLinha(texto: string, limite = LIMITE_DETALHE_CELULAR): boolean {
  return contextoSaiba.celular && texto.length > limite;
}

function botaoSaiba(chave: string, aberto: boolean, controla: string, fora = false): string {
  return `<button type="button" class="lc-saiba${fora ? " lc-saiba-fora" : ""}" data-act="config-recolhe" data-recolhe="${esc(chave)}" aria-expanded="${aberto}" aria-controls="${esc(controla)}">${aberto ? "Menos" : "Saiba mais"}</button>`;
}

type Detalhe = { html: string; saiba: string };

/**
 * O detalhe (já em HTML) e, quando passa de uma linha no celular, o "Saiba mais". Nas linhas que já são um botão inteiro
 * (link e recolhe) o "Saiba mais" não pode morar dentro dele: vai à parte (`saiba`), logo abaixo da linha.
 */
function detalheDaLinha(l: LinhaConfig, html: string): Detalhe {
  const texto = l.detalhe ?? html.replace(/<[^>]*>/g, "");
  if (!passaDeUmaLinha(texto, limiteDoDetalhe(l))) return { html: `<small>${html}</small>`, saiba: "" };
  const chave = chaveUnica(l.titulo);
  const id = `lc-det-${chave.slice(6)}`;
  const aberto = contextoSaiba.abertos.includes(chave);
  const small = `<small id="${esc(id)}"${aberto ? ' class="lc-aberto"' : ""}>${html}</small>`;
  const tipo = l.controle?.tipo;
  return tipo === "link" || tipo === "recolhe" ? { html: small, saiba: botaoSaiba(chave, aberto, id, true) } : { html: small + botaoSaiba(chave, aberto, id), saiba: "" };
}

function miolo(l: LinhaConfig): Detalhe {
  const detalhe = l.detalheHtml ?? (l.detalhe ? esc(l.detalhe) : "");
  const d = detalhe ? detalheDaLinha(l, detalhe) : { html: "", saiba: "" };
  return { html: `${l.antes ?? ""}${l.icone ? `<span class="lc-ic" aria-hidden="true">${l.icone}</span>` : ""}<span class="lc-txt"><b>${esc(l.titulo)}</b>${d.html}</span>${l.status ? statusLinha(l.status) : ""}${l.quando ? `<span class="lc-quando">${esc(l.quando)}</span>` : ""}`, saiba: d.saiba };
}

const SETA = `<span class="lc-seta" aria-hidden="true">${ICONE.seta}</span>`;

export function linhaConfig(l: LinhaConfig): string {
  const c = l.controle;
  const classes = ["lc-linha", l.classe ?? "", l.perigo ? "lc-perigo" : ""].filter(Boolean).join(" ");
  const attrs = l.attrs ? ` ${l.attrs}` : "";
  const m = miolo(l);
  if (c?.tipo === "link") {
    const bt = `<button type="button" class="${classes} lc-link" data-act="${esc(c.acao)}"${dadosAttr(c.dados)}${c.desabilitado ? " disabled" : ""}${attrs}>${m.html}${SETA}</button>`;
    return m.saiba ? `<div class="lc-bloco lc-com-saiba">${bt}${m.saiba}</div>` : bt;
  }
  if (c?.tipo === "recolhe") {
    const sub = `lc-sub-${c.id}`;
    return `<div class="lc-bloco${m.saiba ? " lc-com-saiba" : ""}"><button type="button" class="${classes} lc-link lc-recolhe" data-act="${esc(c.acao)}" data-recolhe="${esc(c.id)}"${dadosAttr(c.dados)} aria-expanded="${c.aberto}" aria-controls="${esc(sub)}"${attrs}>${m.html}<span class="lc-seta${c.aberto ? " aberta" : ""}" aria-hidden="true">${ICONE.seta}</span></button>${m.saiba}<div class="lc-sub" id="${esc(sub)}"${c.aberto ? "" : " hidden"}>${c.aberto ? c.conteudo : ""}</div></div>`;
  }
  const ctrl = !c ? ""
    : c.tipo === "switch" ? switchLinha(c, l.titulo)
      : c.tipo === "seletor" ? seletorLinha(c)
        : c.tipo === "menu" ? menuLinha(c)
          : c.html;
  return `<div class="${classes}"${attrs}>${m.html}${ctrl ? `<span class="lc-ctrl">${ctrl}</span>` : ""}</div>`;
}

/** Um grupo de linhas com título (opcional), contagem e nota embaixo. `linhas` já em HTML. */
export function grupoConfig(titulo: string | null, linhas: readonly string[], extra: { contagem?: number; nota?: string; notaHtml?: string; id?: string; classe?: string; aninhada?: boolean; listaAttrs?: string } = {}): string {
  const tit = titulo ? `<h3 class="lc-grupo-tit"${extra.id ? ` id="${esc(extra.id)}" tabindex="-1"` : ""}>${esc(titulo)}${extra.contagem !== undefined ? `<span>${extra.contagem}</span>` : ""}</h3>` : "";
  const nota = extra.notaHtml ?? (extra.nota ? esc(extra.nota) : "");
  const lista = linhas.length ? `<div class="lc-lista${extra.aninhada ? " lc-aninhada" : ""}"${extra.listaAttrs ? ` ${extra.listaAttrs}` : ""}>${linhas.join("")}</div>` : "";
  return `<section class="lc-grupo${extra.classe ? ` ${extra.classe}` : ""}">${tit}${lista}${nota ? notaDoGrupo(titulo, extra.nota ?? textoDoHtml(extra.notaHtml), nota) : ""}</section>`;
}

/** O texto visível de uma nota em HTML (só tags simples, como <b>), para medir se passa de uma linha. */
function textoDoHtml(html: string | undefined): string | null {
  return html === undefined ? null : html.replace(/<[^>]*>/g, "");
}

/** A nota embaixo do grupo; no celular, a nota longa (texto simples) fica numa linha com o "Saiba mais". */
function notaDoGrupo(titulo: string | null, texto: string | null, html: string): string {
  if (texto === null || !passaDeUmaLinha(texto)) return `<p class="lc-nota">${html}</p>`;
  const chave = chaveUnica(`nota ${titulo ?? texto.slice(0, 24)}`);
  const id = `lc-nota-${chave.slice(6)}`;
  const aberto = contextoSaiba.abertos.includes(chave);
  return `<p class="lc-nota lc-nota-curta${aberto ? " lc-aberto" : ""}" id="${esc(id)}">${html}</p>${botaoSaiba(chave, aberto, id)}`;
}

/** A lista aninhada de dentro de uma linha recolhida (Avançado, Chaves revogadas, Ocultos). */
export function listaAninhada(linhas: readonly string[]): string {
  return `<div class="lc-lista lc-aninhada">${linhas.join("")}</div>`;
}
