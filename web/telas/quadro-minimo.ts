/**
 * Quadro minimalista (definido em 2026-11-10, pedido do Marlon; referência: o board do Multica). A ponte entre o quadro de
 * verdade (QuadroDto) e os pedaços de web/telas/opcoes-quadro.ts: a barra (funil, busca, quem trabalha, Opções, Nova
 * tarefa), os valores dos filtros, o card com as propriedades ligadas e o modal de Nova tarefa. Quem chama é
 * `quadroDaMeta` (web/telas/quadro-real.ts).
 */
import type { ColunaDto, QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import { acionaNaColuna, iconeDaColuna } from "../lib/colunas.ts";
import { agentesComTarefa, ehComigo, trabalhandoAgora, type Filtro } from "../lib/vista-do-quadro.ts";
import { esc } from "../lib/escape.ts";
import { NOME_DA_PRIORIDADE, PRIORIDADES, chipsDosFiltros, haQuantoTempo, opcoesAjustadas, prioridadeDe, CAMPOS_PADRAO, prazoEmMs, prazoDa, type CampoDoFiltro, type DescritorDeCampo, type TarefaDoFiltro, type CondicaoDoFiltro, type ContextoDoFiltro, type OpcoesEfetivas } from "../lib/opcoes-do-quadro.ts";
import type { UiDaBarra } from "./opcoes-quadro.ts";
import { barraMinima, chipsDosFiltrosHtml, iconeDaPrioridade, modalDaNovaTarefa, pilulaDosAtivos, popoverDasOpcoes, popoverDosFiltros, type QuemNoQuadro, type ValorDoFiltro, type ValoresDoFiltro } from "./opcoes-quadro.ts";
import { anel, confiar, iconeDe, type Card, type Html } from "./quadro.ts";

type AgenteDoQuadro = (agenteId: string) => { avatar: Html; nome: string } | null;

const VOCE_AV = (): Html => anel("V", "Você", true);
const SEM_AV = (): Html => anel("–", "Sem responsável");

/** O nome e o avatar de um responsável ("sem" ou o id do bot; ADR-162: a espera da pessoa não é responsável). */
export function nomeDoResponsavel(chave: string, q: QuadroDto, agente: AgenteDoQuadro): { nome: string; avatar: Html } {
  if (chave === "sem") return { nome: "Sem responsável", avatar: SEM_AV() };
  const a = agente(chave);
  if (a) return a;
  const nome = q.tarefas.find((t) => t.agenteId === chave)?.agenteNome ?? "Agente";
  return { nome, avatar: anel(nome.slice(0, 1).toUpperCase(), nome) };
}

/** Quem lê o quadro (a dona ou quem participa) e o relógio, para "Relação comigo" e "Data". */
export function contextoDoFiltro(q: QuadroDto, agora: number): ContextoDoFiltro {
  return { pessoaId: q.voce?.pessoaId ?? q.dona?.pessoaId ?? null, dona: !q.voce || q.voce.papel === "dona", agora, colunas: q.colunas };
}

const nomeDaPessoa = (q: QuadroDto, id: string): string =>
  id === q.voce?.pessoaId ? "Você" : id === q.dona?.pessoaId ? q.dona.nome : q.membros?.find((m) => m.pessoaId === id)?.nome ?? "Pessoa";

/**
 * Os valores de cada campo do funil, a partir dos descritores (web/lib/campos-do-filtro.ts): só os campos com dado (Label
 * e Prazo ficam de fora sem eles), com os nomes de colunas, bots e pessoas trocados aqui e o ícone ou avatar de cada um.
 */
export function valoresDoFiltro(q: QuadroDto, cs: readonly ColunaDto[], agente: AgenteDoQuadro, campos: readonly DescritorDeCampo[] = CAMPOS_PADRAO): ValoresDoFiltro {
  const ts = q.tarefas as readonly TarefaDoFiltro[];
  const ordemResp = (k: string): number => (k === "sem" ? 1 : 0);
  const r: Partial<Record<CampoDoFiltro, ValorDoFiltro[]>> = {};
  for (const d of campos) {
    if (d.temDado && !d.temDado(ts)) continue;
    const vs = d.valores(ts);
    if (d.campo === "status") r.status = cs.map((c) => ({ valor: c.id, nome: c.nome, icone: iconeDe({ status: c.id, icone: iconeDaColuna(c), pessoa: c.daPessoa }) }));
    else if (d.campo === "prioridade") r.prioridade = vs.map((v) => ({ ...v, icone: iconeDaPrioridade(v.valor as TarefaDto["prioridade"], false) }));
    else if (d.campo === "responsavel") r.responsavel = [...vs].sort((a, b) => ordemResp(a.valor) - ordemResp(b.valor)).map((v) => { const x = nomeDoResponsavel(v.valor, q, agente); return { valor: v.valor, nome: x.nome, avatar: x.avatar }; });
    else if (d.campo === "criador") r.criador = vs.map((v) => (v.valor === "bot" ? { valor: "bot", nome: "Um bot" } : { valor: v.valor, nome: nomeDaPessoa(q, v.valor) }));
    else r[d.campo] = vs;
  }
  return r;
}

/** O texto do filtro rápido ligado (a pílula de quem trabalha), para o chip removível. */
function chipDoFiltroRapido(f: Filtro, q: QuadroDto, agente: AgenteDoQuadro): string | null {
  if (f === "todos") return null;
  if (f === "comigo") return "Esperando por mim";
  if (f === "trabalhando") return "Trabalhando agora";
  return `Responsável: ${nomeDoResponsavel(f.slice("agente:".length), q, agente).nome}`;
}

/** A barra do quadro minimalista, com os popovers e os chips dos filtros ligados. */
export function barraDoQuadroMinimo(o: { q: QuadroDto; cs: readonly ColunaDto[]; agente: AgenteDoQuadro; filtro: Filtro; busca: string; ui: UiDaBarra; op: OpcoesEfetivas; recolhidas: boolean; compacto: boolean; podeCriar: boolean; /** O nome e o menu do quadro (menu-do-quadro.ts), à esquerda do funil. */ cab?: Html }): Html {
  const { q, ui } = o;
  const valores = valoresDoFiltro(q, o.cs, o.agente);
  const nomeDoValor = (c: CondicaoDoFiltro): string => valores[c.campo]?.find((v) => v.valor === c.valor)?.nome ?? c.valor;
  const rodando = new Set(q.tarefas.filter((t) => trabalhandoAgora(t) && t.agenteId).map((t) => t.agenteId!));
  const quem: QuemNoQuadro[] = agentesComTarefa(q.tarefas).map((c) => {
    const r = nomeDoResponsavel(c.agenteId, q, o.agente);
    return { filtro: `agente:${c.agenteId}`, nome: r.nome, avatar: r.avatar, n: c.n, rodando: rodando.has(c.agenteId), ativo: o.filtro === `agente:${c.agenteId}` };
  });
  const comigo = q.tarefas.filter((t) => ehComigo(t, q.colunas)).length;
  if (comigo) quem.push({ filtro: "comigo", nome: "Você", avatar: VOCE_AV(), n: comigo, rodando: false, ativo: o.filtro === "comigo" });
  // Quem roda primeiro (a pílula mostra quem está trabalhando).
  quem.sort((a, b) => Number(b.rodando) - Number(a.rodando));
  const rapido = chipDoFiltroRapido(o.filtro, q, o.agente);
  const chips = chipsDosFiltrosHtml(chipsDosFiltros(ui.filtros, nomeDoValor, ui.negados), rapido ? { texto: rapido, act: "filtro-do-quadro", filtro: "todos" } : undefined);
  return barraMinima({
    nFiltros: ui.filtros.length + (rapido ? 1 : 0),
    filtroAberto: ui.aberto === "filtros",
    popFiltros: ui.aberto === "filtros" ? popoverDosFiltros({ filtros: ui.filtros, valores, campo: ui.campo, busca: ui.buscaFiltro, negados: ui.negados }) : "",
    busca: o.busca,
    ativos: pilulaDosAtivos({ quem, aberta: ui.aberto === "ativos", total: q.tarefas.length }),
    opAberto: ui.aberto === "opcoes",
    opAjustadas: opcoesAjustadas(o.op) || !o.recolhidas || o.compacto,
    popOpcoes: ui.aberto === "opcoes" ? popoverDasOpcoes({ op: o.op, colunas: o.cs.map((c) => ({ id: c.id, nome: c.nome, icone: iconeDe({ status: c.id, icone: iconeDaColuna(c), pessoa: c.daPessoa }) })), recolhidas: o.recolhidas, compacto: o.compacto, comDado: { labels: !!valores.label, prazo: !!valores.prazo } }) : "",
    podeCriar: o.podeCriar,
    chips,
    ...(o.cab ? { cab: o.cab } : {}),
  });
}

/** Até onde a descrição entra no card (o CSS corta em duas linhas; o resto não precisa ir ao DOM). */
const DESCRICAO_NO_CARD = 240;

/**
 * O card com as propriedades ligadas nas Opções: prioridade (as barrinhas antes do código), descrição, responsável,
 * datas ("Atualizado há…"), Linear, PR e comentários. O "parada há" da coluna (prazo) fica sempre: é aviso, não enfeite.
 */
export function ajustarCard(c: Card, t: TarefaDto, op: OpcoesEfetivas, q: QuadroDto, agora: number): Card {
  const p = op.props;
  const r: Card = { ...c };
  if (p.has("prioridade")) { r.prioridade = iconeDaPrioridade(prioridadeDe(t)); r.prioridadeNome = NOME_DA_PRIORIDADE[prioridadeDe(t)]; }
  if (p.has("descricao") && t.descricao.trim()) r.descricao = t.descricao.trim().slice(0, DESCRICAO_NO_CARD);
  if (!p.has("responsavel")) delete r.responsavel;
  if (p.has("datas")) r.atualizado = `Atualizado ${haQuantoTempo(t.mudadoEm, agora)}`;
  if (!p.has("pr")) { delete r.pr; if (r.tags) r.tags = r.tags.filter((x) => !/^PR\b/.test(x)); }
  if (!p.has("linear") && r.tags) r.tags = r.tags.filter((x) => x !== "Linear");
  if (r.tags && !r.tags.length) delete r.tags;
  // Labels e Prazo: só quando a tarefa os traz (a outra frente cria os campos; até lá o DTO não tem).
  const tf = t as TarefaDoFiltro;
  if (p.has("labels") && tf.labels?.length) r.labels = tf.labels.slice(0, 3).map((l): { nome: string; cor: string | null } => ({ nome: l.nome, cor: l.cor ?? null })).concat(tf.labels.length > 3 ? [{ nome: `+${tf.labels.length - 3}`, cor: null }] : []);
  const prazo = p.has("prazo") ? prazoEmMs(prazoDa(tf)) : null;
  if (prazo !== null) r.prazo = { texto: new Date(prazo).toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", ""), vencida: prazo < new Date(new Date(agora).setHours(0, 0, 0, 0)).getTime() };
  if (p.has("comentarios")) { const n = (q.comentarios ?? []).filter((x) => x.tarefaId === t.id).length; if (n) r.comentarios = n; }
  return r;
}

const ehMac = (): boolean => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** O modal de Nova tarefa sobre o quadro, com a dica de quem começa logo após criar (a coluna aciona e tem quem pegue). */
export function modalDoQuadro(o: { ui: UiDaBarra; q: QuadroDto; cs: readonly ColunaDto[]; nome: string; agente: AgenteDoQuadro; agentes?: readonly { id: string; nome: string }[] }): Html {
  const m = o.ui.modal;
  if (!m) return confiar("");
  const col = o.cs.find((c) => c.id === m.coluna);
  // ADR-142: a coluna que aciona (A fazer e as de andamento) chama quem está na passagem dela; sem passagem, o escolhido.
  const quem = col && acionaNaColuna(col) ? col.responsavel ?? (m.agente || null) : null;
  const dica = quem ? nomeDoResponsavel(quem, o.q, o.agente) : null;
  const lista = o.agentes ?? agentesComTarefa(o.q.tarefas).map((c) => ({ id: c.agenteId, nome: nomeDoResponsavel(c.agenteId, o.q, o.agente).nome }));
  return modalDaNovaTarefa({
    m, quadro: o.q.nome?.trim() || o.q.meta?.trim() || `Quadro de ${o.nome}`, mac: ehMac(),
    colunas: o.cs.map((c) => ({ id: c.id, nome: c.nome, icone: iconeDe({ status: c.id, icone: iconeDaColuna(c), pessoa: c.daPessoa }) })),
    agentes: lista.map((a) => ({ ...a, avatar: o.agente(a.id)?.avatar ?? anel(a.nome.slice(0, 1).toUpperCase(), a.nome) })),
    dica,
  });
}

/** NOD-463: a Prioridade nas Propriedades da tarefa aberta (o select nativo; quem ouve a troca é web/lib/quadro-na-tela.ts). */
/** 2026-11-10: o seletor de prioridade do card (as barrinhas); a atual vem marcada. Mesmo menu do "Mover para…". */
export function menuDePrioridade(t: Pick<TarefaDto, "id" | "titulo" | "prioridade">): Html {
  const atual = prioridadeDe(t);
  const itens = PRIORIDADES.map((p) => `<button type="button" role="menuitem" class="qd-menu-it${p === atual ? " qm-pri-atual" : ""}" data-act="tarefa-prioridade-para" data-tarefa="${esc(t.id)}" data-valor="${p}"${p === atual ? ' aria-current="true"' : ""}>` +
    `${iconeDaPrioridade(p, false)}<span>${esc(NOME_DA_PRIORIDADE[p])}</span></button>`).join("");
  return confiar(`<div class="qd-menu qd-menu-mover qd-menu-pri" role="menu" id="qd-menu" aria-label="${esc(`Prioridade de ${t.titulo}`)}">${itens}</div>`);
}

export function campoDePrioridade(t: Pick<TarefaDto, "id" | "prioridade">): string {
  const atual = prioridadeDe(t);
  return `<span class="qm-t-pri">${iconeDaPrioridade(atual, false)}<select id="qd-t-pri" class="qd-sel" data-campo="prioridade" data-id="${esc(t.id)}">` +
    PRIORIDADES.map((p) => `<option value="${p}"${p === atual ? " selected" : ""}>${esc(NOME_DA_PRIORIDADE[p])}</option>`).join("") + `</select></span>`;
}
