import type { LinhaMuralDto, QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import { esc } from "../lib/escape.ts";
import { comColunas, iconeDaColuna } from "../lib/colunas.ts";
import { codigoDaTarefa, opcoesDeStatus, tarefasPorStatus } from "../lib/quadro-dados.ts";
import {
  assinaturaDoCard, campoDePedir, linhaDaTarefaAlheia, nomeDaDona, podeDesfazer, podeEditar, podeMudarStatus, podeResponder, rotuloCurtoDoModo, soComenta, textoDoVazio,
} from "../lib/quadro-compartilhado.ts";
import { cardDaTarefa, esperandoOutro, type AgenteDoQuadro } from "./quadro-real.ts";
import { anel, card, confiar, ICONE, linha, lista, quadro, type Coluna, type Html } from "./quadro.ts";

/**
 * NOD-455 (ADR-143): o quadro da dona na tela de quem participa. Só leitura do que é da dona: sem pessoas, modo, colunas,
 * meta editável, PR nem o aviso do GitHub (nem o botão: ausente, não desligado). O que se faz (pedir, mudar o status,
 * editar e excluir a própria tarefa, responder quando decide, comentar, desfazer o próprio lote) sai do gate puro
 * (web/lib/quadro-compartilhado.ts), espelho do servidor. As ações são `qcp-*`, tratadas por
 * web/lib/quadro-compartilhado-na-tela.ts no contêiner `#qcp`.
 */

export type CargaDoCompartilhado =
  | { tipo: "carregando" }
  | { tipo: "erro" }
  | { tipo: "fora" }
  | { tipo: "pronto"; q: QuadroDto; mural: readonly LinhaMuralDto[] | null };

export type VistaDoCompartilhado = {
  carga: CargaDoCompartilhado;
  /** A tarefa aberta (o detalhe). */
  aberta: string | null;
  /** A tarefa em edição (título e descrição). */
  editando: string | null;
  /** NOD-455 (revisão 4): o que a pessoa digitou na edição que o servidor recusou (o formulário reabre com ele). */
  rascunho?: { titulo: string; descricao: string } | null;
  /** A recusa do servidor, na tarefa (ou no quadro, com tarefa null). */
  recusa: { tarefaId: string | null; texto: string } | null;
  /** As colunas que a pessoa abriu ou fechou (a diferença do padrão). */
  alternadas: ReadonlySet<string>;
  /** Uma ação em andamento (o botão espera). */
  ocupado: boolean;
};

export function esqueletoDoCompartilhado(): Html {
  const col = `<div class="qcp-esq-col"><i></i><i></i><i class="curto"></i></div>`;
  return confiar(`<div class="qcp-esqueleto" role="status" aria-busy="true"><span class="qd-sr">Carregando o quadro</span>${col}${col}${col}</div>`);
}

export function erroDoCompartilhado(): Html {
  return confiar(`<div class="qd-sem-quadro" role="alert"><p class="qd-sem-tit">Não deu para carregar o quadro</p>` +
    `<button type="button" class="qd-link" data-act="qcp-reler">Tentar de novo</button></div>`);
}

/** Quem não participa (ou o quadro que sumiu): sem nome nenhum, nem da dona, nem do bot. */
export function semAcessoAoCompartilhado(): Html {
  return confiar(`<div class="qd-sem-quadro" role="alert"><p class="qd-sem-tit">Você não participa deste quadro.</p>` +
    `<p class="qd-sem-txt">Se precisar voltar, peça a quem cuida dele</p>` +
    `<button type="button" class="qd-link" data-act="qcp-inicio">Voltar para o início</button></div>`);
}

function recusaEm(v: VistaDoCompartilhado, tarefaId: string | null): string {
  return v.recusa && v.recusa.tarefaId === tarefaId ? `<p class="qd-t-saiu qcp-recusa" role="alert">${esc(v.recusa.texto)}</p>` : "";
}

function topo(q: QuadroDto): string {
  const dona = nomeDaDona(q);
  const modo = soComenta(q) ? `<span class="qd-meta-falta">Só ${esc(dona)} conversa · você comenta</span>` : "";
  const meta = q.meta ? `<p class="qcp-meta">${esc(q.meta)}${q.prazo ? ` · até ${esc(q.prazo)}` : ""}</p>` : "";
  const gente = [dona, ...(q.membros ?? []).map((m) => (m.pessoaId === q.voce?.pessoaId ? "você" : m.nome))];
  return `<header class="qcp-topo"><h1 class="qcp-tit">${esc(`Quadro do ${dona}`)} <span class="qcp-sub">· compartilhado com você</span></h1>${meta}` +
    `<p class="qcp-gente">${esc(`${q.agenteNome} · ${gente.join(", ")}`)} ${modo}</p></header>`;
}

/** O bot do quadro, mesmo quando não é um dos bots de quem lê (o Responsável não fica vazio). */
function comOBotDaDona(q: QuadroDto, agente: AgenteDoQuadro): AgenteDoQuadro {
  return (id) => agente(id) ?? (id === q.agenteId ? { avatar: anel((q.agenteNome.trim()[0] ?? "?").toUpperCase(), q.agenteNome), nome: q.agenteNome } : null);
}

/** O card assinado: "<pessoa>, pela <bot>" quando foi pedido por alguém. */
function cardAssinado(t: TarefaDto, agente: AgenteDoQuadro, m: readonly LinhaMuralDto[] | null): ReturnType<typeof cardDaTarefa> {
  const c = cardDaTarefa(t, agente);
  const a = assinaturaDoCard(t, m);
  return a ? { ...c, quando: a } : c;
}

function grade(q: QuadroDto, v: VistaDoCompartilhado, agente: AgenteDoQuadro, m: readonly LinhaMuralDto[] | null): string {
  const por = tarefasPorStatus(q);
  const cs = comColunas(q).colunas;
  const cols = cs.map((c) => {
    const ts = por[c.id] ?? [];
    const padrao = c.recolhida && ts.length === 0;
    return { c, ts, recolhida: padrao !== v.alternadas.has(c.id) };
  });
  const colunas: Coluna[] = cols.map(({ c, ts, recolhida }) => ({
    status: c.id, nome: c.nome, grupo: c.grupo, icone: iconeDaColuna(c), pessoa: c.daPessoa, recolhida, recolhivel: true,
    n: ts.length, cards: ts.map((t) => card(cardAssinado(t, agente, m))),
  }));
  const rotulo = `Quadro do ${nomeDaDona(q)}`;
  return quadro({ rotulo, classe: "qd-so-largo", colunas }) +
    `<div class="qd-so-estreito">${lista({ rotulo, grupos: cols.map(({ c, ts, recolhida }) => ({ status: c.id, nome: c.nome, icone: iconeDaColuna(c), pessoa: c.daPessoa, recolhido: recolhida, linhas: ts.map((t) => linha(cardAssinado(t, agente, m))) })) })}</div>`;
}

function campoDoStatus(q: QuadroDto, t: TarefaDto, ocupado: boolean): string {
  const cs = comColunas(q).colunas;
  const atual = cs.find((c) => c.id === t.status);
  if (!podeMudarStatus(q, t)) return `<span id="qcp-status">${esc(atual?.nome ?? t.status)}</span>`;
  const op = (id: string, nome: string, sel: boolean) => `<option value="${esc(id)}"${sel ? " selected" : ""}>${esc(nome)}</option>`;
  return `<select id="qcp-status" class="qd-sel" data-campo="qcp-status" data-id="${esc(t.id)}"${ocupado ? " disabled" : ""}>` +
    opcoesDeStatus(cs).map((g) => `<optgroup label="${esc(g.grupo)}">${g.colunas.map((c) => op(c.id, c.nome, c.id === t.status)).join("")}</optgroup>`).join("") +
    (atual ? "" : op(t.status, t.status, true)) + `</select>`;
}

function detalhe(q: QuadroDto, t: TarefaDto, v: VistaDoCompartilhado, agente: AgenteDoQuadro): string {
  const id = esc(t.id);
  const meu = podeEditar(q, t);
  const alheia = linhaDaTarefaAlheia(q, t);
  const outro = esperandoOutro(t);
  const resp = t.agenteId ? agente(t.agenteId)?.nome ?? t.agenteNome : null;
  const corpo = v.editando === t.id && meu
    ? `<form class="qcp-editar" data-form="qcp-editar" data-id="${id}"><label class="qd-sr" for="qcp-ed-tit">Título</label>` +
      `<input id="qcp-ed-tit" class="qd-meta-in" name="titulo" maxlength="200" required value="${esc(v.rascunho?.titulo ?? t.titulo)}">` +
      `<label class="qd-sr" for="qcp-ed-desc">Descrição</label><textarea id="qcp-ed-desc" class="qd-resp-in" name="descricao" rows="3" maxlength="4000">${esc(v.rascunho?.descricao ?? t.descricao)}</textarea>` +
      `<button type="submit" class="qd-bt qd-bt-pri"${v.ocupado ? " disabled" : ""}>Salvar</button> <button type="button" class="qd-link" data-act="qcp-cancelar-edicao">Cancelar</button></form>`
    : `<h1 class="qd-t-tit" id="qcp-t-tit" tabindex="-1">${esc(t.titulo)}</h1>` +
      (t.descricao.trim() ? `<div class="qd-t-desc">${esc(t.descricao)}</div>` : `<div class="qd-t-desc qd-t-desc-vazia">Sem descrição.</div>`);
  const acoes = meu && v.editando !== t.id
    ? `<p class="qcp-acoes"><button type="button" class="qd-link" data-act="qcp-editar" data-id="${id}">Editar</button> · <button type="button" class="qd-link" data-act="qcp-excluir" data-id="${id}"${v.ocupado ? " disabled" : ""}>Excluir</button></p>` : "";
  const pergunta = t.pergunta && (t.esperaPessoa || t.status === "bloqueado")
    ? `<h2 class="qd-t-sec">${t.esperaPessoa ? (outro ? `Esperando ${esc(outro)}` : `${esc(t.agenteNome ?? "O bot")} te perguntou`) : "Bloqueada"}</h2><p class="qd-voce-frase">${esc(t.pergunta)}</p>` +
      (podeResponder(q, t)
        ? `<form class="qd-resp-form" data-form="qcp-responder" data-id="${id}"><label class="qd-sr" for="qcp-resp">Sua resposta</label>` +
          `<textarea id="qcp-resp" class="qd-resp-in" name="resposta" rows="2" maxlength="4000" required placeholder="Sua resposta"></textarea>` +
          `<button type="submit" class="qd-bt qd-bt-leve"${v.ocupado ? " disabled" : ""}>Responder</button></form>` : "") : "";
  const comentarios = (q.comentarios ?? []).filter((c) => c.tarefaId === t.id);
  const lista = comentarios.length
    ? `<ol class="qd-hist">${comentarios.map((c) => `<li><span class="qd-hist-quem">${esc(c.assinatura)}</span> <span class="qd-hist-oque">${esc(c.texto)}</span></li>`).join("")}</ol>` : "";
  const comentar = `<form class="qcp-comentar" data-form="qcp-comentar" data-id="${id}"><label class="qd-sr" for="qcp-com">Comentar</label>` +
    `<input id="qcp-com" class="qd-meta-in" name="texto" maxlength="2000" required placeholder="Comentar" autocomplete="off">` +
    `<button type="submit" class="qd-link"${v.ocupado ? " disabled" : ""}>Comentar</button></form>`;
  return `<article class="qd-tarefa qcp-tarefa" aria-labelledby="qcp-t-tit" data-tarefa="${id}">` +
    `<div class="qd-t-cab"><button type="button" class="qd-voltar" data-act="qcp-voltar">${ICONE.voltar}<span>${esc(`Quadro do ${nomeDaDona(q)}`)}</span></button><span class="qd-t-sep" aria-hidden="true">/</span><span class="qd-id">${esc(codigoDaTarefa(t))}</span></div>` +
    `${corpo}${alheia ? `<p class="qcp-alheia">${esc(alheia)}</p>` : ""}${acoes}${recusaEm(v, t.id)}` +
    `<dl class="qd-props"><dt><label for="qcp-status">Status</label></dt><dd>${campoDoStatus(q, t, v.ocupado)}</dd><dt>Responsável</dt><dd>${esc(resp ?? "ninguém")}</dd></dl>` +
    `${pergunta}<h2 class="qd-t-sec">Comentários</h2>${lista}${comentar}</article>`;
}

function mural(q: QuadroDto, m: readonly LinhaMuralDto[] | null, hora: (em: number) => string, v: VistaDoCompartilhado): string {
  const desfazer = podeDesfazer(q) && q.ultimoLote
    ? `<button type="button" class="qd-link" data-act="qcp-desfazer" data-id="${esc(q.ultimoLote.id)}"${v.ocupado ? " disabled" : ""}>Desfazer o seu último pedido</button>` : "";
  const recados = (q.comentarios ?? []).filter((c) => c.tarefaId === null);
  const linhas = m === null ? `<p class="qd-lado-vazio">Carregando…</p>`
    : !m.length && !recados.length ? `<p class="qd-lado-vazio">Nada ainda.</p>`
    : `<ol class="qd-hist">${recados.map((c) => `<li><span class="qd-hist-quem">${esc(c.assinatura)}</span> <span class="qd-hist-oque">${esc(`deixou um recado: ${c.texto}`)}</span> <time class="qd-hist-quando" datetime="${esc(new Date(c.criadoEm).toISOString())}">${esc(hora(c.criadoEm))}</time></li>`).join("")}` +
      `${m.map((l) => `<li${l.desfeito ? ' class="qd-desfeito"' : ""}><span class="qd-hist-quem">${esc(l.assinatura)}</span> <span class="qd-hist-oque">${esc(l.resumo)}${l.desfeito ? " (desfeito)" : ""}</span> <time class="qd-hist-quando" datetime="${esc(new Date(l.criadoEm).toISOString())}">${esc(hora(l.criadoEm))}</time></li>`).join("")}</ol>`;
  return `<section class="qcp-mural" aria-label="Atividade"><h2 class="qd-rotulo">Atividade</h2>${desfazer}${recusaEm(v, null)}${linhas}</section>`;
}

function pedir(q: QuadroDto, v: VistaDoCompartilhado): string {
  const c = campoDePedir(q);
  return `<form class="qcp-pedir" data-form="qcp-${c.tipo}"><label class="qd-sr" for="qcp-pedir-in">${esc(c.placeholder)}</label>` +
    `<input id="qcp-pedir-in" class="qd-meta-in" name="texto" maxlength="${c.tipo === "recado" ? 2000 : 200}" required placeholder="${esc(c.placeholder)}" autocomplete="off">` +
    `<button type="submit" class="qd-bt"${v.ocupado ? " disabled" : ""}>${esc(c.botao)}</button></form>`;
}

/** A tela inteira do quadro compartilhado (o conteúdo do `#qcp`). */
export function quadroCompartilhado(v: VistaDoCompartilhado, o: { agente: AgenteDoQuadro; hora: (em: number) => string }): Html {
  const c = v.carga;
  if (c.tipo === "carregando") return esqueletoDoCompartilhado();
  if (c.tipo === "erro") return erroDoCompartilhado();
  if (c.tipo === "fora") return semAcessoAoCompartilhado();
  const q = c.q;
  const agente = comOBotDaDona(q, o.agente);
  const aberta = v.aberta ? q.tarefas.find((t) => t.id === v.aberta) ?? null : null;
  if (aberta) return confiar(`<div class="qcp">${detalhe(q, aberta, v, agente)}</div>`);
  const vazio = q.tarefas.length === 0 ? `<p class="qcp-vazio" role="status">${esc(textoDoVazio(q))}</p>` : "";
  return confiar(`<div class="qcp">${topo(q)}${vazio}${q.tarefas.length ? grade(q, v, agente, c.mural) : ""}${mural(q, c.mural, o.hora, v)}${pedir(q, v)}</div>`);
}

/**
 * NOD-455: a seção "Compartilhados com você" da barra lateral. Some quando a lista é vazia. Cada linha abre o quadro
 * (`abrir-quadro-compartilhado`, /quadros/:qid). No celular, o modo "só a dona" aparece curto ("Só a <dona>").
 */
export function secaoDosCompartilhados(
  lista: readonly { id: string; agenteNome: string; donaNome: string; modo: string }[],
  o: { aberto: string | null; celular: boolean },
): string {
  if (!lista.length) return "";
  const linhaDe = (c: (typeof lista)[number]): string => {
    const curto = o.celular ? rotuloCurtoDoModo({ modo: c.modo, donaNome: c.donaNome }) : null;
    const atual = o.aberto === c.id ? ' aria-current="page"' : "";
    const inicial = esc((c.agenteNome.trim()[0] ?? "?").toUpperCase());
    return `<div class="bot-row qcp-linha"><button class="row" data-act="abrir-quadro-compartilhado" data-quadro="${esc(c.id)}"${atual} aria-label="Abrir o quadro de ${esc(c.agenteNome)}, da ${esc(c.donaNome)}">` +
      `<span class="qd-anel" aria-hidden="true">${inicial}</span><span class="txt"><span class="nome-linha"><b>${esc(c.agenteNome)}</b><i class="chip">Quadro</i></span>` +
      `<span class="sub">da ${esc(c.donaNome)}${curto ? ` · ${esc(curto)}` : ""}</span></span></button></div>`;
  };
  return `<section class="section qcp-secao" aria-label="Compartilhados com você"><h3><span class="secao-nome">Compartilhados com você</span></h3>${lista.map(linhaDe).join("")}</section>`;
}
