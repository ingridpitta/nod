/**
 * Cabeçalho do quadro mínimo (definido em 2026-11-10, pedido do Marlon: "todo esse cabeçalho tem que sumir"; referência:
 * o board do Multica). Uma linha só: o nome do quadro com um chevron discreto, que abre o menu do quadro, e, quando
 * existem, a meta e o prazo em cinza ao lado ("Engenharia · até 20 nov"). O menu leva tudo o que morava na faixa de cima
 * (Meta, Prazo, Pessoas, Atividade, Trazer do Linear, Remover quadro) e o aviso "Em teste · só você vê" no rodapé.
 *
 * Só desenha: o aberto e o passo (o campo do prazo) moram em web/lib/barra-do-quadro.ts; as ações (data-act) são as de
 * sempre, tratadas em web/lib/quadro-na-tela.ts. Todo texto é dado e passa por `esc`.
 */
import { esc } from "../lib/escape.ts";
import { confiar, type Html } from "./quadro.ts";

/** Teto da meta (o mesmo do campo de antes; LIMITES do contrato). */
const LIMITE_META = 200;

const CHEVRON = '<svg class="qd-ic qm-cab-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';

export type PassoDoMenu = "prazo" | null;

export interface CabecalhoDoQuadro {
  /** O nome do quadro (ou "Quadro de <bot>"). */
  nome: string;
  meta: string | null;
  /** "até 20 nov", ou null sem prazo. */
  prazoFrase: string | null;
  /** O progresso da meta e quanto falta ("3 de 8 feitas · faltam 4 dias"), para a linha de cima do menu. */
  progresso: string | null;
  /** A linha da importação do Linear (andando, ok ou erro), em cinza ao lado do nome. */
  importacao: { texto: string; tipo: "andando" | "ok" | "erro" } | null;
  aberto: boolean;
  passo: PassoDoMenu;
  editandoMeta: boolean;
  /** O select do prazo (menuDePrazo de quadro-real.ts), já pronto: o menu só o encaixa. */
  campoPrazo: Html | string;
  /** Pessoas e Atividade só com a API das pessoas (NOD-443). */
  pessoas: boolean;
  /** "Pessoas · 2" quando há gente no quadro. */
  nPessoas: number;
  /** Trazer do Linear: só a dona e sem importação andando. */
  trazer: boolean;
  /** Trocar de quadro (ADA-14): só quando o seletor tem o que escolher ou criar. */
  trocar: boolean;
  /** O popover do seletor (sem o botão: quem o abre é o item do menu). */
  seletor?: Html | string;
}

const item = (act: string, texto: string, sub: string | null, extra = "", classe = ""): string =>
  `<button type="button" role="menuitem" class="qm-it qm-qm-it${classe}" data-act="${act}"${extra}><span class="qm-it-txt">${esc(texto)}</span>${sub ? `<span class="qm-qm-sub">${esc(sub)}</span>` : ""}</button>`;

/** O campo da meta (Enter salva, Esc desiste, vazio tira a meta); no menu do computador e sozinho no celular. */
export function formDaMeta(meta: string | null, classe = ""): string {
  return `<form class="qd-meta-form${classe}" data-form="editar-meta" role="none"><label class="qd-sr" for="qd-meta-in">Meta do quadro (vazio tira)</label>` +
    `<input id="qd-meta-in" class="qd-meta-in" name="meta" maxlength="${LIMITE_META}" value="${esc(meta ?? "")}" placeholder="Qual é a meta? (opcional)" autocomplete="off"></form>`;
}

/** O menu do quadro (role=menu; as setas, Home/End e o Esc moram em barra-do-quadro.ts). */
export function menuDoQuadro(c: CabecalhoDoQuadro): Html {
  const meta = c.editandoMeta ? formDaMeta(c.meta, " qm-qm-campo") : item("editar-meta", "Meta…", c.meta);
  const prazo = c.passo === "prazo"
    ? `<div class="qm-qm-campo" role="none">${c.campoPrazo}</div>`
    : item("qmenu-prazo", "Prazo…", c.prazoFrase, ' aria-haspopup="true"');
  const itens = [
    c.progresso ? `<p class="qm-nota qm-qm-prog" role="none">${esc(c.progresso)}</p>` : "",
    meta,
    prazo,
    c.pessoas ? `<div class="qm-qm-sep" role="separator"></div>${item("painel-pessoas", c.nPessoas ? `Pessoas · ${c.nPessoas}` : "Pessoas", null)}${item("painel-atividade", "Atividade", null)}` : "",
    c.trocar || c.trazer ? `<div class="qm-qm-sep" role="separator"></div>` : "",
    c.trocar ? item("quadro-seletor", "Trocar de quadro…", null) : "",
    c.trazer ? item("trazer-linear", "Trazer do Linear…", null) : "",
    `<div class="qm-qm-sep" role="separator"></div>`,
    item("remover-quadro", "Remover quadro", null, ' title="O bot volta a ser um agente comum; a conversa e a memória ficam"', " qm-qm-perigo"),
    `<p class="qm-nota qm-qm-teste" role="none" title="Recurso em teste, liberado só para a sua conta">Em teste · só você vê</p>`,
  ].join("");
  return confiar(`<div class="qm-pop qm-pop-quadro" id="qm-pop-quadro" role="menu" aria-label="${esc(`Menu do quadro ${c.nome}`)}">${itens}</div>`);
}

/**
 * O pedaço da esquerda da barra: o nome com o chevron, a meta e o prazo em cinza (o clique abre o menu no item Meta), a
 * linha da importação e o menu aberto. Sem meta e sem prazo, só o nome.
 */
export function cabecalhoDoQuadro(c: CabecalhoDoQuadro): Html {
  const resumo = [c.meta, c.prazoFrase].filter((x): x is string => !!x).join(" · ");
  const botao = `<button type="button" class="qm-cab-bt" data-act="qmenu-abrir" aria-haspopup="menu" aria-expanded="${c.aberto}"${c.aberto ? ' aria-controls="qm-pop-quadro"' : ""} title="Menu do quadro">` +
    `<span class="qm-cab-nome">${esc(c.nome)}</span>${CHEVRON}</button>`;
  const meta = resumo ? `<button type="button" class="qm-cab-meta" data-act="qmenu-abrir" data-foco="meta" aria-label="${esc(`${resumo}. Mudar no menu do quadro`)}">${esc(resumo)}</button>` : "";
  // role=status também na falha (revisão 5 do PR #630): o topo é redesenhado a cada releitura e role=alert re-anunciaria.
  const imp = c.importacao ? `<span class="qd-imp qd-imp-${c.importacao.tipo} qm-cab-imp" role="status">${esc(c.importacao.texto)}</span>` : "";
  return confiar(`<span class="qm-cab-l">${botao}${meta}${imp}${c.aberto ? menuDoQuadro(c) : ""}${c.seletor ?? ""}</span>`);
}
