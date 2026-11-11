/**
 * Quadro minimalista (definido em 2026-11-10, pedido do Marlon; referência: o board do Multica). Os pedaços da barra do
 * quadro em tela cheia: o funil dos Filtros (com submenus), a pílula de quem trabalha agora, o popover das Opções, os
 * chips dos filtros ligados, o modal de Nova tarefa e o ícone de prioridade do card. Só desenham: o estado e os cliques
 * moram em web/lib/barra-do-quadro.ts. O par de CSS é web/quadro-min.css (classes `qm-`).
 *
 * Todo texto (nome de bot, de coluna, título) é dado e passa por `esc`; só entra como HTML o que tem o tipo `Html`.
 */
import { esc } from "../lib/escape.ts";
import type { Prioridade } from "../../src/contracts/quadro-opcoes.ts";
import { NOME_DA_PRIORIDADE, ORDENS_DO_QUADRO, AGRUPAMENTOS_DO_QUADRO, PRIORIDADES, PROPRIEDADES_DO_CARD, CAMPOS_DO_FILTRO, NOME_DA_ORDEM, NOME_DA_PROPRIEDADE, NOME_DO_AGRUPAMENTO, NOME_DO_CAMPO, casaComBusca, type CampoDoFiltro, type CondicaoDoFiltro, type OpcoesEfetivas } from "../lib/opcoes-do-quadro.ts";
import { confiar, type Html } from "./quadro.ts";

const svg = (d: string, classe: string, w = 16, sw = 1.6): string =>
  `<svg class="qd-ic ${classe}" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONE_MIN = {
  funil: svg('<path d="M4 6h16M7 12h10M10 18h4"/>', "qm-ic-funil"),
  opcoes: svg('<rect x="4" y="4.5" width="16" height="15" rx="2.5"/><path d="M9.5 4.5v15M14.5 4.5v15"/>', "qm-ic-opcoes"),
  nova: svg('<path d="M12 20h8"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', "qm-ic-nova"),
  chev: svg('<path d="m9 6 6 6-6 6"/>', "qm-ic-chev", 12, 2),
  fechar: svg('<path d="M6 6l12 12M18 6 6 18"/>', "qm-ic-fechar", 14, 1.8),
  inverter: svg('<path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4"/>', "qm-ic-inverter", 14, 1.7),
  check: svg('<path d="m6 12.5 4 4 8-9"/>', "qm-ic-check", 13, 2.2),
  busca: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>', "qm-ic-busca", 14, 1.8),
  pessoas: svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3.2 3.2 0 0 1 0 6.2M17.5 14a5.5 5.5 0 0 1 3 5"/>', "qm-ic-pessoas", 15),
  comentario: svg('<path d="M4.5 18.5V6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2H8z"/>', "qm-ic-com", 12, 1.8),
} as const;

/**
 * As barrinhas da prioridade (como no Multica/Linear): três barras que enchem com o nível; urgente é o quadrado com "!"
 * (a única com cor: perigo); sem prioridade, três traços. O nome vai no title e para o leitor de tela.
 */
export function iconeDaPrioridade(p: Prioridade, comRotulo = true): Html {
  const nome = NOME_DA_PRIORIDADE[p];
  const rot = comRotulo ? ` role="img" aria-label="${esc(`Prioridade: ${nome}`)}" title="${esc(nome)}"` : ' aria-hidden="true"';
  if (p === "urgente") {
    return confiar(`<span class="qm-pri qm-pri-urgente"${rot}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor"/><path d="M7 4v3.6" stroke="var(--qd-card, var(--surface))" stroke-width="1.6" stroke-linecap="round"/><circle cx="7" cy="10" r=".9" fill="var(--qd-card, var(--surface))"/></svg></span>`);
  }
  if (p === "sem") {
    return confiar(`<span class="qm-pri qm-pri-sem"${rot}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7h1.6M6.2 7h1.6M9.9 7h1.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span>`);
  }
  const cheias = p === "alta" ? 3 : p === "media" ? 2 : 1;
  const barra = (i: number): string => `<rect x="${1.5 + i * 4}" y="${9 - i * 3}" width="2.6" height="${3.5 + i * 3}" rx=".9" fill="currentColor"${i < cheias ? "" : ' opacity=".25"'}/>`;
  return confiar(`<span class="qm-pri qm-pri-${p}"${rot}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">${barra(0)}${barra(1)}${barra(2)}</svg></span>`);
}

/* ---------- Filtros ---------- */

/** Um valor possível de um campo (o nome e, para bots e pessoas, o avatar). */
export interface ValorDoFiltro { valor: string; nome: string; avatar?: Html; icone?: Html }
/** Os valores de cada campo que o painel mostra; campo ausente (ou vazio) não aparece (Label e Prazo sem dado). */
export type ValoresDoFiltro = Readonly<Partial<Record<CampoDoFiltro, readonly ValorDoFiltro[]>>>;

const ligado = (filtros: readonly CondicaoDoFiltro[], campo: CampoDoFiltro, valor: string): boolean => filtros.some((f) => f.campo === campo && f.valor === valor);

function itemDoValor(campo: CampoDoFiltro, v: ValorDoFiltro, on: boolean, comCampo = false): string {
  const visual = v.avatar ? `<span class="qm-av" aria-hidden="true">${v.avatar}</span>` : v.icone ?? "";
  const texto = comCampo ? `<span class="qm-it-campo">${esc(NOME_DO_CAMPO[campo])}</span><span class="qm-it-sep" aria-hidden="true">›</span>${esc(v.nome)}` : esc(v.nome);
  return `<button type="button" role="menuitemcheckbox" class="qm-it" data-act="fil-alternar" data-campo="${campo}" data-valor="${esc(v.valor)}" aria-checked="${on}">` +
    `<span class="qm-caixa" aria-hidden="true">${on ? ICONE_MIN.check : ""}</span>${visual}<span class="qm-it-txt">${texto}</span></button>`;
}

/**
 * O popover do funil: o campo de busca e a lista de campos (cada um abre o submenu dos valores, com caixas). Com texto na
 * busca, a lista vira os valores que casam, de qualquer campo. "Limpar filtros" quando há algum ligado.
 */
export function popoverDosFiltros(o: { filtros: readonly CondicaoDoFiltro[]; valores: ValoresDoFiltro; campo: CampoDoFiltro | null; busca: string; negados?: readonly CampoDoFiltro[] }): Html {
  const campos = CAMPOS_DO_FILTRO.filter((c) => o.valores[c]?.length);
  const vs = (c: CampoDoFiltro): readonly ValorDoFiltro[] => o.valores[c] ?? [];
  const nao = (c: CampoDoFiltro): boolean => !!o.negados?.includes(c);
  const busca = `<label class="qm-fil-busca">${ICONE_MIN.busca}<span class="qd-sr">Filtrar por campo ou valor</span>` +
    `<input id="qm-fil-busca" class="qm-fil-in" data-campo="fil-busca" placeholder="Filtrar por campo ou valor…" value="${esc(o.busca)}" maxlength="80" autocomplete="off" spellcheck="false"></label>`;
  let corpo: string;
  if (o.busca.trim()) {
    const achados = campos.flatMap((c) => vs(c).filter((v) => casaComBusca(o.busca, NOME_DO_CAMPO[c], v.nome)).map((v) => itemDoValor(c, v, ligado(o.filtros, c, v.valor), true)));
    corpo = achados.length ? `<div class="qm-lista" role="menu" aria-label="Valores">${achados.join("")}</div>` : `<p class="qm-vazio">Nada com “${esc(o.busca.trim())}”.</p>`;
  } else {
    const itens = campos.map((c) => {
      const n = o.filtros.filter((f) => f.campo === c).length;
      const aberto = o.campo === c;
      // O modo do campo no topo do submenu ("é / não é", como no Multica).
      const modo = (m: "e" | "nao", rot: string): string => `<button type="button" class="qm-seg-bt" data-act="fil-modo" data-campo="${c}" data-modo="${m}" aria-pressed="${(m === "nao") === nao(c)}">${rot}</button>`;
      const sub = aberto ? `<div class="qm-sub" id="qm-sub-${c}" role="menu" aria-label="${esc(NOME_DO_CAMPO[c])}"><div class="qm-seg qm-seg-modo" role="group" aria-label="${esc(`${NOME_DO_CAMPO[c]}: é ou não é`)}">${modo("e", "é")}${modo("nao", "não é")}</div>${vs(c).map((v) => itemDoValor(c, v, ligado(o.filtros, c, v.valor))).join("")}</div>` : "";
      return `<div class="qm-campo-l"><button type="button" class="qm-it qm-campo${aberto ? " qm-aberto" : ""}" data-act="fil-campo" data-campo="${c}" aria-haspopup="menu" aria-expanded="${aberto}"${aberto ? ` aria-controls="qm-sub-${c}"` : ""}>` +
        `<span class="qm-it-txt">${esc(NOME_DO_CAMPO[c])}</span>${n ? `<span class="qm-n">${nao(c) ? "não é · " : ""}${n}</span>` : ""}${ICONE_MIN.chev}</button>${sub}</div>`;
    }).join("");
    corpo = `<div class="qm-lista">${itens}</div>`;
  }
  const limpar = o.filtros.length ? `<div class="qm-rodape"><button type="button" class="qd-link" data-act="fil-limpar">Limpar filtros</button></div>` : "";
  return confiar(`<div class="qm-pop qm-pop-fil" id="qm-pop-fil" role="dialog" aria-label="Filtros">${busca}${corpo}${limpar}</div>`);
}

/** Os filtros ligados, um chip discreto por campo, cada um com o × que tira aquele campo inteiro. */
export function chipsDosFiltrosHtml(chips: readonly { campo: string; texto: string }[], extra?: { texto: string; act: string; filtro?: string }): Html {
  const todos = [
    ...(extra ? [`<span class="qm-chip">${esc(extra.texto)}<button type="button" class="qm-chip-x" data-act="${esc(extra.act)}"${extra.filtro ? ` data-filtro="${esc(extra.filtro)}"` : ""} aria-label="${esc(`Tirar o filtro ${extra.texto}`)}">${ICONE_MIN.fechar}</button></span>`] : []),
    ...chips.map((c) => `<span class="qm-chip">${esc(c.texto)}<button type="button" class="qm-chip-x" data-act="fil-tirar" data-campo="${esc(c.campo)}" aria-label="${esc(`Tirar o filtro ${c.texto}`)}">${ICONE_MIN.fechar}</button></span>`),
  ];
  if (!todos.length) return confiar("");
  return confiar(`<div class="qm-chips" role="group" aria-label="Filtros ligados">${todos.join("")}${todos.length > 1 ? `<button type="button" class="qd-link qm-chips-limpar" data-act="fil-limpar">Limpar</button>` : ""}</div>`);
}

/* ---------- Agentes ativos ---------- */

export interface QuemNoQuadro { filtro: string; nome: string; avatar: Html; n: number; rodando: boolean; ativo: boolean }

/**
 * A pílula do topo direito: os avatares de quem trabalha agora (até três, empilhados) e quantos; sem ninguém rodando, os
 * avatares dos bots do quadro, apagados. O clique abre a lista de quem tem tarefa no quadro, com a contagem: um clique
 * filtra (o mesmo filtro rápido `agente:` da NOD-460; de novo, desliga).
 */
export function pilulaDosAtivos(o: { quem: readonly QuemNoQuadro[]; aberta: boolean; total: number }): Html {
  const rodam = o.quem.filter((q) => q.rodando && q.filtro.startsWith("agente:"));
  const mostra = (rodam.length ? rodam : o.quem.filter((q) => q.filtro.startsWith("agente:"))).slice(0, 3);
  const pilha = mostra.length ? `<span class="qm-pilha${rodam.length ? "" : " qm-pilha-quieta"}" aria-hidden="true">${mostra.map((q) => `<span class="qm-av">${q.avatar}</span>`).join("")}</span>` : ICONE_MIN.pessoas;
  const rot = rodam.length ? `${rodam.length} ${rodam.length === 1 ? "agente trabalhando" : "agentes trabalhando"} agora. Ver quem está no quadro` : "Ninguém trabalhando agora. Ver quem está no quadro";
  const ativo = o.quem.some((q) => q.ativo);
  const bt = `<button type="button" class="qm-ativos${rodam.length ? " qm-ativos-on" : ""}${ativo ? " qm-ligado" : ""}" data-act="ativos-abrir" aria-haspopup="menu" aria-expanded="${o.aberta}"${o.aberta ? ' aria-controls="qm-pop-ativos"' : ""} aria-label="${esc(rot)}" title="${esc(rot)}">` +
    `${pilha}${rodam.length ? `<span class="qm-ativos-n">${rodam.length}</span>` : ""}</button>`;
  if (!o.aberta) return confiar(`<span class="qm-ativos-l">${bt}</span>`);
  const item = (q: QuemNoQuadro): string => `<button type="button" role="menuitemradio" class="qm-it" data-act="filtro-do-quadro" data-filtro="${esc(q.filtro)}" aria-checked="${q.ativo}">` +
    `<span class="qm-av" aria-hidden="true">${q.avatar}</span><span class="qm-it-txt">${esc(q.nome)}</span>${q.rodando ? '<span class="qm-rodando" title="Trabalhando agora"><i aria-hidden="true"></i><span class="qd-sr">trabalhando agora</span></span>' : ""}<span class="qm-n">${q.n}</span></button>`;
  const lista = o.quem.length ? o.quem.map(item).join("") : `<p class="qm-vazio">Ninguém com tarefa neste quadro.</p>`;
  const todos = `<button type="button" role="menuitemradio" class="qm-it" data-act="filtro-do-quadro" data-filtro="todos" aria-checked="${!ativo}"><span class="qm-it-txt">Todas as tarefas</span><span class="qm-n">${o.total}</span></button>`;
  return confiar(`<span class="qm-ativos-l">${bt}<div class="qm-pop qm-pop-ativos" id="qm-pop-ativos" role="menu" aria-label="Quem está no quadro">` +
    `<p class="qm-sec">No quadro</p>${todos}${lista}</div></span>`);
}

/* ---------- Opções do quadro ---------- */

export interface ColunaDasOpcoes { id: string; nome: string; icone: Html }

/** O popover das Opções: visão, agrupar, ordenar (com o inverter), as colunas à mostra, as tiras, o compacto e as propriedades do card. */
export function popoverDasOpcoes(o: { op: OpcoesEfetivas; colunas: readonly ColunaDasOpcoes[]; recolhidas: boolean; compacto: boolean; /** Labels e Prazo só entram com dado no quadro. */ comDado?: { labels: boolean; prazo: boolean } }): Html {
  const seg = (v: "quadro" | "lista", rot: string, ic: string): string =>
    `<button type="button" class="qm-seg-bt" data-act="op-vista" data-valor="${v}" aria-pressed="${o.op.vista === v}">${ic}<span>${rot}</span></button>`;
  const visao = `<div class="qm-seg" role="group" aria-label="Visão">${seg("quadro", "Quadro", ICONE_MIN.opcoes)}${seg("lista", "Lista", svg('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', "qm-ic-lista"))}</div>`;
  const opcao = (v: string, rot: string, sel: boolean): string => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(rot)}</option>`;
  const agrupar = `<div class="qm-linha"><label for="qm-agrupar">Agrupar por</label><select id="qm-agrupar" class="qm-sel" data-campo="op-agrupar">${AGRUPAMENTOS_DO_QUADRO.map((a) => opcao(a, NOME_DO_AGRUPAMENTO[a], o.op.agrupar === a)).join("")}</select></div>`;
  const ordenar = `<div class="qm-linha"><label for="qm-ordenar">Ordenar por</label><span class="qm-linha-dir">` +
    `<button type="button" class="qm-inv" data-act="op-inverter" aria-pressed="${o.op.inverter}" aria-label="${o.op.inverter ? "Ordem invertida. Voltar ao sentido normal" : "Inverter a ordem"}" title="Inverter a ordem"${o.op.ordenar === "manual" ? " disabled" : ""}>${ICONE_MIN.inverter}</button>` +
    `<select id="qm-ordenar" class="qm-sel" data-campo="op-ordenar">${ORDENS_DO_QUADRO.map((x) => opcao(x, NOME_DA_ORDEM[x], o.op.ordenar === x)).join("")}</select></span></div>`;
  const chip = (act: string, dado: string, valor: string, on: boolean, conteudo: string, rot: string): string =>
    `<button type="button" class="qm-tog" data-act="${act}" data-${dado}="${esc(valor)}" aria-pressed="${on}" aria-label="${esc(rot)}">${conteudo}</button>`;
  const colunas = o.op.agrupar === "status"
    ? `<p class="qm-sec">Colunas</p><div class="qm-togs">${o.colunas.map((c) => chip("op-coluna", "coluna", c.id, !o.op.ocultas.has(c.id), `${c.icone}<span>${esc(c.nome)}</span>`, `${c.nome}: ${o.op.ocultas.has(c.id) ? "escondida" : "à mostra"}`)).join("")}</div>` +
      `<div class="qm-togs qm-togs-ex">${chip("exibir-alternar", "chave", "recolhidas", o.recolhidas, "<span>Tiras das recolhidas</span>", `Tiras das colunas recolhidas: ${o.recolhidas ? "à mostra" : "escondidas"}`)}${chip("exibir-alternar", "chave", "compacto", o.compacto, "<span>Compacto</span>", `Compacto: ${o.compacto ? "ligado" : "desligado"}`)}</div>`
    : `<div class="qm-togs qm-togs-ex">${chip("exibir-alternar", "chave", "compacto", o.compacto, "<span>Compacto</span>", `Compacto: ${o.compacto ? "ligado" : "desligado"}`)}</div>`;
  const props = `<p class="qm-sec">Propriedades do card</p><div class="qm-togs">${PROPRIEDADES_DO_CARD.filter((p) => (p !== "labels" && p !== "prazo") || !!o.comDado?.[p]).map((p) => chip("op-prop", "prop", p, o.op.props.has(p), `<span>${esc(NOME_DA_PROPRIEDADE[p])}</span>`, `${NOME_DA_PROPRIEDADE[p]}: ${o.op.props.has(p) ? "à mostra" : "escondida"}`)).join("")}</div>`;
  return confiar(`<div class="qm-pop qm-pop-op" id="qm-pop-op" role="dialog" aria-label="Opções do quadro">${visao}${agrupar}${ordenar}${colunas}${props}` +
    `<p class="qm-nota">Vale para você, neste quadro, em todo aparelho.</p></div>`);
}

/* ---------- A barra ---------- */

/**
 * A barra do quadro minimalista: à esquerda o funil (com quantos filtros ligados) e a busca; à direita a pílula de quem
 * trabalha, as Opções e a Nova tarefa. Embaixo, os chips dos filtros ligados. Os popovers vêm prontos de fora.
 */
export function barraMinima(o: { nFiltros: number; filtroAberto: boolean; popFiltros: Html | ""; busca: string; ativos: Html; opAberto: boolean; opAjustadas: boolean; popOpcoes: Html | ""; podeCriar: boolean; chips: Html | ""; /** O nome e o menu do quadro (menu-do-quadro.ts): a mesma linha, à esquerda. */ cab?: Html }): Html {
  const funil = `<span class="qm-fil-l"><button type="button" class="qm-icbt${o.nFiltros ? " qm-ligado" : ""}" data-act="fil-abrir" aria-haspopup="dialog" aria-expanded="${o.filtroAberto}"${o.filtroAberto ? ' aria-controls="qm-pop-fil"' : ""} aria-label="${esc(o.nFiltros ? `Filtros, ${o.nFiltros} ligados` : "Filtros")}" title="Filtros">${ICONE_MIN.funil}${o.nFiltros ? `<span class="qm-icbt-n">${o.nFiltros}</span>` : ""}</button>${o.popFiltros}</span>`;
  const busca = `<span class="qd-busca-l"><label class="qd-busca">${ICONE_MIN.busca}<span class="qd-sr">Buscar tarefa por título ou código</span>` +
    `<input type="search" id="qd-busca" class="qd-busca-in" data-campo="busca" placeholder="Buscar" value="${esc(o.busca)}" maxlength="200" autocomplete="off" spellcheck="false" aria-keyshortcuts="/">` +
    `${o.busca ? "" : `<kbd class="qd-kbd" title="Atalho: /" aria-hidden="true">/</kbd>`}</label>` +
    `${o.busca ? `<button type="button" class="qd-busca-limpar" data-act="busca-limpar" aria-label="Limpar busca">×</button>` : ""}</span>`;
  const op = `<span class="qm-op-l"><button type="button" class="qm-icbt" data-act="op-abrir" aria-haspopup="dialog" aria-expanded="${o.opAberto}"${o.opAberto ? ' aria-controls="qm-pop-op"' : ""} aria-label="${o.opAjustadas ? "Opções do quadro (ajustadas)" : "Opções do quadro"}" title="Opções do quadro">${ICONE_MIN.opcoes}${o.opAjustadas ? '<i class="qd-ponto" aria-hidden="true"></i>' : ""}</button>${o.popOpcoes}</span>`;
  const nova = o.podeCriar ? `<button type="button" class="qm-icbt" data-act="nt-abrir" aria-label="Nova tarefa" title="Nova tarefa (C)" aria-keyshortcuts="C">${ICONE_MIN.nova}</button>` : "";
  return confiar(`<div class="qd-barra-q qm-barra"><span class="qm-esq">${o.cab ?? ""}${funil}${busca}</span><span class="qd-barra-dir">${o.ativos}${op}${nova}</span></div>${o.chips}`);
}

/* ---------- Nova tarefa ---------- */

export type PopoverDaBarra = "filtros" | "opcoes" | "ativos" | "quadro" | null;
/** O que o desenho da barra precisa (o estado mora em web/lib/barra-do-quadro.ts). */
export interface UiDaBarra {
  aberto: PopoverDaBarra;
  campo: CampoDoFiltro | null;
  buscaFiltro: string;
  filtros: readonly CondicaoDoFiltro[];
  /** Os campos em "não é" (por quadro, na memória da tela, como os filtros). */
  negados: readonly CampoDoFiltro[];
  modal: ModalDaNovaTarefa | null;
  /** O campo aberto dentro do menu do quadro (o Prazo; a Meta é o editandoMeta de quadro-na-tela.ts). */
  passo?: "prazo" | null;
}

export interface ModalDaNovaTarefa {
  titulo: string;
  descricao: string;
  coluna: string;
  prioridade: Prioridade;
  /** "" = sem responsável (ou o da passagem da coluna, quando houver). */
  agente: string;
  criarOutra: boolean;
  enviando?: boolean;
  erro?: string | null;
}

/**
 * O modal centrado de Nova tarefa, com o fundo desfocado: o título grande, a descrição, os chips (coluna, prioridade,
 * responsável), a dica de quem começa logo após criar, "Criar outra" e o Criar (⌘↵). Esc fecha. Os chips são selects
 * nativos com cara de chip (teclado e leitor de tela de graça).
 */
export function modalDaNovaTarefa(o: { m: ModalDaNovaTarefa; quadro: string; colunas: readonly { id: string; nome: string; icone: Html }[]; agentes: readonly { id: string; nome: string; avatar?: Html }[]; dica: { nome: string; avatar?: Html } | null; mac: boolean }): Html {
  const { m } = o;
  const opcao = (v: string, rot: string, sel: boolean): string => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(rot)}</option>`;
  const col = o.colunas.find((c) => c.id === m.coluna);
  const ag = o.agentes.find((a) => a.id === m.agente);
  const chipSel = (campo: string, rot: string, visual: string, texto: string, opcoes: string): string =>
    `<label class="qm-nt-chip">${visual}<span class="qm-nt-chip-txt">${esc(texto)}</span><select class="qm-nt-sel" data-nt="${campo}" aria-label="${esc(rot)}">${opcoes}</select></label>`;
  const chips = [
    chipSel("coluna", "Coluna", col?.icone ?? "", col?.nome ?? "Coluna", o.colunas.map((c) => opcao(c.id, c.nome, c.id === m.coluna)).join("")),
    chipSel("prioridade", "Prioridade", iconeDaPrioridade(m.prioridade, false), NOME_DA_PRIORIDADE[m.prioridade], PRIORIDADES.map((p) => opcao(p, NOME_DA_PRIORIDADE[p], p === m.prioridade)).join("")),
    chipSel("agente", "Responsável", ag?.avatar ? `<span class="qm-av" aria-hidden="true">${ag.avatar}</span>` : ICONE_MIN.pessoas, ag?.nome ?? "Responsável", opcao("", "Sem responsável", !m.agente) + o.agentes.map((a) => opcao(a.id, a.nome, a.id === m.agente)).join("")),
  ].join("");
  const dica = o.dica ? `<p class="qm-nt-dica">${o.dica.avatar ? `<span class="qm-av" aria-hidden="true">${o.dica.avatar}</span>` : ""}<span>${esc(`${o.dica.nome} vai começar logo após criar.`)}</span></p>` : "";
  const erro = m.erro ? `<p class="qm-nt-erro" role="alert">${esc(m.erro)}</p>` : "";
  const atalho = o.mac ? "⌘" : "Ctrl";
  return confiar(`<div class="qm-modal-fundo" data-act="nt-fora"></div><div class="qm-modal" role="dialog" aria-modal="true" aria-labelledby="qm-nt-cab">` +
    `<form class="qm-nt" data-form="nova-tarefa-modal"><div class="qm-nt-cab" id="qm-nt-cab"><span class="qm-nt-quadro">${esc(o.quadro)}</span><span aria-hidden="true">${ICONE_MIN.chev}</span><span class="qm-nt-onde">Nova tarefa</span>` +
    `<button type="button" class="qm-icbt qm-nt-x" data-act="nt-fechar" aria-label="Fechar (Esc)" title="Fechar (Esc)">${ICONE_MIN.fechar}</button></div>` +
    `<label class="qd-sr" for="qm-nt-tit">Título da tarefa</label><input id="qm-nt-tit" class="qm-nt-tit" name="titulo" maxlength="200" required autocomplete="off" placeholder="Título da tarefa" value="${esc(m.titulo)}"${m.erro ? ' aria-describedby="qm-nt-erro"' : ""}>` +
    `<label class="qd-sr" for="qm-nt-desc">Descrição</label><textarea id="qm-nt-desc" class="qm-nt-desc" name="descricao" maxlength="4000" rows="4" placeholder="Adicionar descrição…">${esc(m.descricao)}</textarea>` +
    `${dica}<div class="qm-nt-chips">${chips}</div>${erro}` +
    `<div class="qm-nt-pe"><label class="qm-nt-outra"><input type="checkbox" data-nt="outra"${m.criarOutra ? " checked" : ""}><span class="qm-switch" aria-hidden="true"></span>Criar outra</label>` +
    `<button type="submit" class="qm-nt-criar"${m.enviando ? " disabled" : ""}>${m.enviando ? "Criando…" : "Criar tarefa"}<kbd aria-hidden="true">${atalho}</kbd><kbd aria-hidden="true">↵</kbd></button></div></form></div>`);
}
