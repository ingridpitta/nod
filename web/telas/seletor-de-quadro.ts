/**
 * ADA-14 (ADR-153): o seletor de quadro do app Quadro. No computador, um popover preso ao nome do quadro; no celular, a
 * mesma marcação vira folha de baixo (web/quadro.css, alvos de 44pt). Os quadros vêm agrupados por projeto (os soltos por
 * último), com busca a partir de 6 quadros, e "+ Novo quadro" e "+ Novo projeto" no pé quando a flag NOD_QUADROS_N deixa.
 *
 * Só desenha: o estado (aberto, busca, o formulário em curso) mora em web/lib/quadro-na-tela.ts. Todo nome é TEXTO e passa
 * por `esc`.
 */
import { esc } from "../lib/escape.ts";
import { confiar, type Html } from "./quadro.ts";
import type { QuadroDoBotDto, QuadrosDoBotDto } from "../../src/contracts/quadros-do-bot.ts";

/** O teto do nome (LIMITES_QUADROS.nome em src/contracts/quadros-do-bot.ts; a web não importa valor de lá, ADR-018). */
const LIMITE_NOME = 60;

/** A partir de quantos quadros o seletor mostra a busca (S6 do plano). */
export const BUSCA_A_PARTIR_DE = 6;

export type GrupoDoSeletor = { projeto: { id: string; nome: string } | null; quadros: QuadroDoBotDto[] };
export type CriandoNoSeletor = { tipo: "quadro"; projeto: string | null } | { tipo: "projeto" } | null;
export type EstadoDoSeletor = { aberto: boolean; busca: string; criando: CriandoNoSeletor; erro?: string | null };

const normal = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** O seletor só aparece quando há o que escolher (mais de um quadro) ou o que criar (a flag deixa o 2º quadro). */
export const mostraSeletor = (d: QuadrosDoBotDto | null): d is QuadrosDoBotDto => !!d && (d.quadros.length > 1 || d.podeCriarOutro);

/**
 * Os grupos: os projetos ativos na ordem deles (só os que têm quadro que passa na busca) e, por último, os soltos. A busca
 * casa o nome do quadro ou o do projeto, sem acento nem caixa.
 */
export function gruposDoSeletor(d: QuadrosDoBotDto, busca = ""): GrupoDoSeletor[] {
  const termo = normal(busca);
  const projetos = [...d.projetos].filter((p) => p.arquivadoEm === null).sort((a, b) => a.posicao - b.posicao);
  const nomeDo = new Map(projetos.map((p) => [p.id, p.nome]));
  const passa = (q: QuadroDoBotDto): boolean => !termo || normal(q.nome).includes(termo) || (q.projetoId !== null && normal(nomeDo.get(q.projetoId) ?? "").includes(termo));
  const grupos: GrupoDoSeletor[] = [];
  for (const p of projetos) {
    const qs = d.quadros.filter((q) => q.projetoId === p.id && passa(q));
    if (qs.length) grupos.push({ projeto: { id: p.id, nome: p.nome }, quadros: qs });
  }
  // O quadro de projeto arquivado (ou que a lista não trouxe) cai nos soltos: some do grupo, não da lista.
  const soltos = d.quadros.filter((q) => (q.projetoId === null || !nomeDo.has(q.projetoId)) && passa(q));
  if (soltos.length) grupos.push({ projeto: null, quadros: soltos });
  return grupos;
}

/** O quadro aberto (o `aberto` do servidor, senão o padrão, senão o primeiro). */
export function quadroAbertoDe(d: QuadrosDoBotDto): QuadroDoBotDto | null {
  return d.quadros.find((q) => q.id === d.aberto) ?? d.quadros.find((q) => q.padrao) ?? d.quadros[0] ?? null;
}

/**
 * O quadro que a tela abre: o que o link pediu (se ainda está no bot; sem a lista, confia no link), senão o último aberto
 * que o servidor guardou. `gravar` = o link trocou o aberto, e o servidor deve guardar.
 */
export function quadroQueAbre(d: QuadrosDoBotDto | null, pedido: string | null): { alvo: string | null; gravar: boolean } {
  if (pedido && (!d || d.quadros.some((x) => x.id === pedido))) return { alvo: pedido, gravar: !!d && d.aberto !== pedido };
  return { alvo: d?.aberto ?? null, gravar: false };
}

const CHEVRON = '<svg class="qd-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';

function itemDoQuadro(q: QuadroDoBotDto, atual: string | null): string {
  const n = q.meta ? `${q.feitas} de ${q.total}` : q.abertas === 1 ? "1 aberta" : `${q.abertas} abertas`;
  const outros = q.bots.filter((b) => !b.dono).length;
  return `<li><button type="button" class="qd-qs-it" data-act="quadro-escolher" data-id="${esc(q.id)}"${q.id === atual ? ' aria-current="true"' : ""}>` +
    `<span class="qd-qs-nome">${esc(q.nome)}</span>` +
    (q.padrao ? '<span class="qd-qs-tag">padrão</span>' : "") +
    (outros ? `<span class="qd-qs-tag" title="Também em outros bots">+${outros} ${outros === 1 ? "bot" : "bots"}</span>` : "") +
    `<span class="qd-qs-n">${esc(n)}</span></button></li>`;
}

function formNovo(d: QuadrosDoBotDto, c: NonNullable<CriandoNoSeletor>, erro: string | null | undefined): string {
  const msg = erro ? `<p class="qd-qs-erro" role="alert">${esc(erro)}</p>` : "";
  if (c.tipo === "projeto") {
    return `<form class="qd-qs-novo" data-form="novo-projeto"><label class="qd-sr" for="qd-qs-novo-in">Nome do projeto</label>` +
      `<input id="qd-qs-novo-in" name="nome" maxlength="${LIMITE_NOME}" placeholder="Nome do projeto" autocomplete="off" required>` +
      `<button type="submit" class="qd-bt">Criar projeto</button><button type="button" class="qd-link" data-act="quadro-novo-cancelar">Cancelar</button>${msg}</form>`;
  }
  const ativos = d.projetos.filter((p) => p.arquivadoEm === null).sort((a, b) => a.posicao - b.posicao);
  const opcoes = [`<option value=""${c.projeto === null ? " selected" : ""}>Sem projeto</option>`, ...ativos.map((p) => `<option value="${esc(p.id)}"${c.projeto === p.id ? " selected" : ""}>${esc(p.nome)}</option>`)].join("");
  return `<form class="qd-qs-novo" data-form="novo-quadro"><label class="qd-sr" for="qd-qs-novo-in">Nome do quadro</label>` +
    `<input id="qd-qs-novo-in" name="nome" maxlength="${LIMITE_NOME}" placeholder="Nome do quadro" autocomplete="off" required>` +
    `<label class="qd-sr" for="qd-qs-novo-proj">Projeto</label><select id="qd-qs-novo-proj" name="projeto">${opcoes}</select>` +
    `<button type="submit" class="qd-bt">Criar quadro</button><button type="button" class="qd-link" data-act="quadro-novo-cancelar">Cancelar</button>${msg}</form>`;
}

/**
 * O botão com o nome do quadro aberto ("Projeto / Quadro") e, aberto, o painel: busca (≥6), os grupos e o pé de criar.
 * Vazio quando não há o que escolher nem criar (com a flag desligada, a tela fica como antes).
 */
export function seletorDeQuadro(d: QuadrosDoBotDto | null, e: EstadoDoSeletor): Html {
  if (!mostraSeletor(d)) return confiar("");
  const atual = quadroAbertoDe(d);
  const projeto = atual?.projetoId ? d.projetos.find((p) => p.id === atual.projetoId) ?? null : null;
  const rotulo = `${projeto ? `<span class="qd-qs-proj">${esc(projeto.nome)} /</span> ` : ""}<span class="qd-qs-atual">${esc(atual?.nome ?? "Quadro")}</span>`;
  const botao = `<button type="button" class="qd-qs-bt" data-act="quadro-seletor" aria-haspopup="dialog" aria-expanded="${e.aberto}"${e.aberto ? ' aria-controls="qd-qs-pop"' : ""} title="Trocar de quadro">${rotulo}${CHEVRON}</button>`;
  if (!e.aberto) return confiar(`<div class="qd-qs">${botao}</div>`);
  const busca = d.quadros.length >= BUSCA_A_PARTIR_DE
    ? `<label class="qd-sr" for="qd-qs-busca">Buscar quadro</label><input type="search" id="qd-qs-busca" class="qd-qs-busca" data-campo="busca-quadro" value="${esc(e.busca)}" placeholder="Buscar quadro" autocomplete="off">`
    : "";
  const grupos = gruposDoSeletor(d, e.busca);
  const lista = grupos.length
    ? grupos.map((g) => `<div class="qd-qs-grupo" role="group" aria-label="${esc(g.projeto?.nome ?? "Sem projeto")}">` +
      (g.projeto || grupos.length > 1 ? `<p class="qd-qs-gt">${esc(g.projeto?.nome ?? "Sem projeto")}</p>` : "") +
      `<ul class="qd-qs-ul">${g.quadros.map((q) => itemDoQuadro(q, atual?.id ?? null)).join("")}</ul></div>`).join("")
    : `<p class="qd-qs-vazio">Nenhum quadro com “${esc(e.busca.trim())}”.</p>`;
  const pe = d.podeCriarOutro
    ? (e.criando ? formNovo(d, e.criando, e.erro) : `<div class="qd-qs-pe"><button type="button" class="qd-link" data-act="quadro-novo">+ Novo quadro</button><button type="button" class="qd-link" data-act="projeto-novo">+ Novo projeto</button></div>`)
    : "";
  const pop = `<div id="qd-qs-pop" class="qd-qs-pop" role="dialog" aria-label="Trocar de quadro">` +
    `<div class="qd-qs-cab"><span class="qd-qs-tit">Quadros</span><button type="button" class="qd-qs-fechar" data-act="quadro-seletor-fechar" aria-label="Fechar">×</button></div>` +
    `${busca}<div class="qd-qs-lista">${lista}</div>${pe}</div>`;
  return confiar(`<div class="qd-qs qd-qs-aberto">${botao}<div class="qd-qs-fundo" data-act="quadro-seletor-fechar" aria-hidden="true"></div>${pop}</div>`);
}
