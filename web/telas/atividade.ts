import type { ItemDeAtividade } from "../../src/contracts/atividade.ts";
import type { Estado } from "../estado/reducer.ts";
import { chaveDaAtividade, diaLocal, diaSeguinte, FILTROS_DA_ATIVIDADE, fusoLocal, itensDoFiltro, rotuloDoDia, type FiltroAtividade, type VistaDaAtividade } from "../lib/atividade-do-bot.ts";
import { agruparRepeticoes, chaveDasDecisoes, DESFECHO, diaAnterior, FILTROS_DAS_DECISOES, nomeDoCsv, oQueTentou, PERIODOS_DO_CSV, periodoDoCsv, rotuloDoFuso, totalDoFiltro, VAZIO_DO_FILTRO, type FiltroDecisoes, type GrupoDeDecisoes } from "../lib/decisoes-do-bot.ts";
import { esc, hora } from "../lib/render.ts";
import { memoriaDoMac } from "./linha-do-dono.ts";

type Bot = NonNullable<Estado["frota"]>["agentes"][number];

/**
 * A Atividade do bot, um nível da gaveta (definido em 2026-10-18, chat limpo, PR 2; ADR-114; protótipo "Atividade aberta no
 * drawer"): o que saiu do chat, um dia por página. Os filtros Tudo / Sem aprovação / Frentes / Bloqueios / Máquina e IA (botões com
 * `aria-pressed`; item sem categoria só em "Tudo"), a lista com a hora à esquerda, o título e o detalhe em cinza, e "Dia
 * anterior ›" no fim. O clique leva ao alvo: a frente abre a tela dela; a mensagem abre o texto inteiro ali mesmo, com o
 * "Relatar" (ADR-041). A linha da trilha (app indisponível) não tem mensagem e não leva "Relatar" na v1 (decisão 14).
 *
 * A memória não é fonte da rota (decisão 13): no topo de hoje, enquanto vale, a linha "Agora" do estado que a tela já tem.
 */
export function renderAtividade(estado: Estado, bot: Bot): string {
  const vista = estado.atividadeVista?.agenteId === bot.id ? estado.atividadeVista : null;
  // NOD-70: as abas Atividade | Decisões, só no bot da pessoa (a rota das decisões é do dono).
  const dono = bot.ownerId === estado.sessao?.pessoaId;
  const aba = dono && vista?.aba === "decisoes" ? "decisoes" : "atividade";
  const abas = dono ? abasDaAtividade(aba) : "";
  if (aba === "decisoes" && vista) return `<div class="atv">${abas}${renderDecisoes(estado, bot, vista)}</div>`;
  return renderDaAtividade(estado, bot, vista, abas, dono);
}

function abasDaAtividade(aba: "atividade" | "decisoes"): string {
  const tab = (qual: "atividade" | "decisoes", rotulo: string) =>
    `<button type="button" role="tab" class="atv-aba" id="atv-aba-${qual}" data-act="atividade-aba" data-aba="${qual}" aria-selected="${aba === qual}" aria-controls="atv-painel" tabindex="${aba === qual ? 0 : -1}">${rotulo}</button>`;
  return `<div class="atv-abas" role="tablist" aria-label="Atividade do bot">${tab("atividade", "Atividade")}${tab("decisoes", "Decisões")}</div>`;
}

function renderDaAtividade(estado: Estado, bot: Bot, vista: VistaDaAtividade | null, abas: string, dono: boolean): string {
  const hoje = diaLocal(estado.agora > 0 ? estado.agora : Date.now());
  const dia = vista?.dia ?? hoje;
  const filtro: FiltroAtividade = vista?.filtro ?? "tudo";
  const chave = chaveDaAtividade(bot.id, dia);
  const filtros = `<div class="atv-filtros" role="group" aria-label="Filtrar a atividade">${FILTROS_DA_ATIVIDADE.map((f) => `<button type="button" class="atv-filtro" data-act="atividade-filtro" data-filtro="${f.filtro}" aria-pressed="${f.filtro === filtro}">${esc(f.rotulo)}</button>`).join("")}</div>`;
  // Um bloco só, com o espaçamento do protótipo (12 px entre filtros, dia e lista): solto, cada parte pegava o vão de 22 px
  // da gaveta e o `.detalhes h3` (QA do PR 2).
  const bloco = (corpo: string): string => `<div class="atv">${abas}${abas ? `<div id="atv-painel" role="tabpanel" aria-labelledby="atv-aba-atividade">${corpo}</div>` : corpo}</div>`;
  if (!(chave in estado.atividadeDoBot)) return bloco(`${filtros}<p class="mudo atv-vazio">carregando…</p>`);
  const dto = estado.atividadeDoBot[chave];
  if (!dto) return bloco(`${filtros}<p class="mudo atv-vazio">A atividade deste bot não está disponível agora.</p>`);
  const itens = itensDoFiltro(dto.itens, filtro);
  const agora = dia === hoje && (filtro === "tudo" || filtro === "maquina_ia") ? linhaAgora(estado, bot) : "";
  const vazio = itens.length === 0 && !agora ? `<p class="mudo atv-vazio">${filtro === "tudo" ? "Nada neste dia." : filtro === "sem_aprovacao" ? "Nada rodou sem aprovação neste dia." : "Nada deste tipo neste dia."}</p>` : "";
  const lista = itens.length || agora ? `<ol class="atv-lista" aria-label="${esc(`Atividade · ${rotuloDoDia(dia, hoje)}`)}">${agora}${itens.map((i) => linhaDoItem(i, vista?.aberta ?? null, dono ? { agenteId: bot.id, dia } : null)).join("")}</ol>` : "";
  const truncados = dto.truncados > 0 ? `<p class="mudo atv-mais">e mais ${dto.truncados} ${dto.truncados === 1 ? "item" : "itens"} deste dia, no Raio-X</p>` : "";
  const seguinte = dia < hoje ? `<button type="button" class="atv-dia" data-act="atividade-dia" data-dia="${esc(diaSeguinte(dia))}">‹ Dia seguinte</button>` : "<span></span>";
  const anterior = dto.diaAnterior ? `<button type="button" class="atv-dia" data-act="atividade-dia" data-dia="${esc(dto.diaAnterior)}">Dia anterior ›</button>` : "";
  const navegacao = anterior || dia < hoje ? `<div class="atv-navegacao">${seguinte}${anterior}</div>` : "";
  return bloco(`${filtros}<h3 class="atv-dia-titulo" tabindex="-1">${esc(rotuloDoDia(dia, hoje))}</h3>${lista}${vazio}${truncados}${navegacao}`);
}

/**
 * "Agora · Pouca memória no seu Mac · 2 rodando aqui · ver": a linha do estado de agora (não vem da rota). Como o ponto da
 * linha do dono, a memória só entra quando o bot tem trabalho rodando no Mac (NOD-372; QA do PR 2: sem ele, a linha dizia
 * "0 trabalhos abertos"); o disco cheio que segura tudo entra sempre, porque nenhuma task nova começa.
 */
function linhaAgora(estado: Estado, bot: Bot): string {
  const m = memoriaDoMac(estado, bot.id, bot.conversaId);
  if (!m || (m.abertos === 0 && !m.disco)) return "";
  const [titulo, ...resto] = m.texto.split(" · ");
  return `<li class="atv-item atv-agora atv-${m.nivel}"><span class="atv-hora">Agora</span><span class="atv-texto"><span class="atv-titulo">${esc(titulo ?? "")}</span><span class="atv-detalhe">${esc(resto.join(" · "))}${resto.length ? " · " : ""}<button type="button" class="atv-link" ${m.alvo}>ver</button></span></span></li>`;
}

/** Uma linha da lista. A mensagem aberta mostra o texto inteiro e o "Relatar"; a frente abre a tela dela. */
function linhaDoItem(i: ItemDeAtividade, aberta: string | null, decisoes: { agenteId: string; dia: string } | null): string {
  // NOD-70: embaixo da negação, o atalho para as Decisões do dia no filtro Negadas (a regra que negou mora lá).
  const ver = i.negacao && decisoes ? `<div class="atv-revisor"><button type="button" class="atv-link" data-act="decisoes-negadas" data-agente="${esc(decisoes.agenteId)}" data-dia="${esc(decisoes.dia)}">ver nas decisões</button></div>` : "";
  return linhaSemAtalho(i, aberta).replace(/<\/li>$/, `${ver}</li>`);
}

function linhaSemAtalho(i: ItemDeAtividade, aberta: string | null): string {
  const vezes = i.vezes && i.vezes > 1 ? ` <span class="atv-vezes">${i.vezes} vezes</span>` : "";
  // PR 6 dos modos de aprovação (tela Y3): o comando ou o caminho do que rodou sem aprovação vai em fonte de código.
  const corpo = `<span class="atv-hora">${esc(hora(i.em))}</span><span class="atv-texto"><span class="atv-titulo">${esc(i.titulo)}${vezes}</span>${i.detalhe ? `<span class="atv-detalhe${i.codigo ? " atv-codigo" : ""}"${i.codigo ? ` title="${esc(i.detalhe)}"` : ""}>${esc(i.detalhe)}</span>` : ""}</span>`;
  if (i.revisor) return `<li class="atv-item atv-do-revisor"><div class="atv-botao estatico">${corpo}</div>${linhaDoRevisor(i.revisor)}</li>`;
  const alvo = i.alvo;
  if (alvo && "trabalhoId" in alvo) return `<li class="atv-item"><button type="button" class="atv-botao" data-act="abrir-trabalho" data-id="${esc(alvo.trabalhoId)}">${corpo}</button></li>`;
  if (alvo && "mensagemId" in alvo) {
    const aberto = aberta === i.id;
    const texto = i.texto ?? i.detalhe ?? "";
    const inteiro = aberto ? `<div class="atv-inteiro" id="atv-${esc(i.id)}">${texto && texto !== i.detalhe ? `<p>${esc(texto)}</p>` : ""}<button type="button" class="atv-link" data-act="relatar-mensagem" data-id="${esc(alvo.mensagemId)}">Relatar</button></div>` : "";
    return `<li class="atv-item${aberto ? " aberto" : ""}"><button type="button" class="atv-botao" data-act="atividade-abrir" data-id="${esc(i.id)}" aria-expanded="${aberto}"${aberto ? ` aria-controls="atv-${esc(i.id)}"` : ""}>${corpo}</button>${inteiro}</li>`;
  }
  return `<li class="atv-item"><div class="atv-botao estatico">${corpo}</div></li>`;
}

/**
 * PR 4 dos modos de aprovação: embaixo da ação que o revisor liberou, o motivo dele e "Devia ter perguntado". O clique grava
 * a contestação (não desfaz nada) e a linha vira "Você marcou: devia ter perguntado". A hora fica alinhada à de cima.
 */
function linhaDoRevisor(r: NonNullable<ItemDeAtividade["revisor"]>): string {
  const motivo = r.motivo ? `<span class="atv-revisor-motivo"><b>Revisor:</b> ${esc(r.motivo)}</span>` : "";
  const acao = r.contestada
    ? `<span class="atv-contestada" data-acao="${esc(r.acaoId)}" tabindex="-1">Você marcou: devia ter perguntado</span>`
    : `<button type="button" class="atv-link atv-contestar" data-act="contestar-revisor" data-id="${esc(r.acaoId)}">Devia ter perguntado</button>`;
  return `<div class="atv-revisor">${motivo}${acao}</div>`;
}

// ---------------------------------------------------------------------------------------------
// NOD-70: a aba Decisões (protótipo v2, W2/C2).

/**
 * A aba Decisões: os filtros Tudo/Permitidas/Negadas/Cartões com a contagem do dia, a lista (hora · o que tentou · a frase
 * em cinza · o desfecho à direita; repetições em "N vezes"), a decisão aberta com a regra e "Rever acesso", "Carregar
 * mais", a troca de dia e o Exportar CSV. Carregando, os filtros já ficam no lugar; a primeira vez tem texto próprio.
 */
export function renderDecisoes(estado: Estado, bot: Bot, vista: VistaDaAtividade): string {
  const hoje = diaLocal(estado.agora > 0 ? estado.agora : Date.now());
  const dia = vista.dia;
  const filtro = vista.desfecho;
  const pagina = estado.decisoesDoBot[chaveDasDecisoes(bot.id, dia, filtro)];
  const painel = (corpo: string) => `<div id="atv-painel" class="dec" role="tabpanel" aria-labelledby="atv-aba-decisoes"${pagina !== undefined && pagina !== null && pagina !== "erro" ? "" : ' aria-busy="' + (pagina === undefined) + '"'}>${corpo}</div>`;
  const contagem = pagina && pagina !== "erro" ? pagina.contagem : null;
  const filtros = `<div class="atv-filtros dec-filtros" role="group" aria-label="Filtrar as decisões">${FILTROS_DAS_DECISOES.map((f) => {
    const n = contagem ? ` <span class="dec-n">${totalDoFiltro(contagem, f.filtro)}</span>` : "";
    return `<button type="button" class="atv-filtro" data-act="decisoes-filtro" data-filtro="${f.filtro}" aria-pressed="${f.filtro === filtro}">${esc(f.rotulo)}${n}</button>`;
  }).join("")}</div>`;
  const titulo = `<h3 class="atv-dia-titulo" tabindex="-1">${esc(rotuloDoDia(dia, hoje))}</h3>`;
  if (pagina === undefined) return painel(`${filtros}${titulo}<p class="mudo atv-vazio">carregando…</p>`);
  if (pagina === null) return painel(`<p class="mudo atv-vazio">As decisões deste bot não estão disponíveis agora.</p>`);
  if (pagina === "erro") {
    return painel(`${filtros}${titulo}<div class="dec-erro" role="alert"><span class="dec-erro-icone" aria-hidden="true">!</span><span>Não deu para carregar as decisões.</span> <button type="button" class="atv-link" data-act="decisoes-tentar">Tentar de novo</button></div>`);
  }
  const total = pagina.contagem.permitida + pagina.contagem.negada + pagina.contagem.cartao;
  if (dia === hoje && total === 0 && !pagina.haAntes) {
    return painel(`<p class="dec-primeira">Nenhuma decisão ainda. Quando o ${esc(bot.nome)} usar um app, cada permissão aparece aqui, com a regra que decidiu.</p>`);
  }
  const grupos = agruparRepeticoes(pagina.linhas);
  const doFiltro = totalDoFiltro(pagina.contagem, filtro);
  const vazio = grupos.length === 0
    ? `<p class="mudo atv-vazio">${esc(VAZIO_DO_FILTRO[filtro])}${filtro !== "tudo" && total > 0 ? ` <button type="button" class="atv-link" data-act="decisoes-ver-tudo">Ver tudo</button>` : ""}</p>`
    : "";
  const lista = grupos.length ? `<ol class="atv-lista dec-lista" aria-label="${esc(`Decisões · ${rotuloDoDia(dia, hoje)}`)}">${grupos.map((g) => linhaDaDecisao(g, vista.decisao, bot)).join("")}</ol>` : "";
  const mais = pagina.proximo
    ? `<div class="dec-mais"><span class="mudo">Mostrando ${pagina.linhas.length} de ${doFiltro}</span> ${pagina.erroMais ? `<span class="dec-erro"><span class="dec-erro-icone" aria-hidden="true">!</span> Não carregou.</span> ` : ""}<button type="button" class="atv-link" data-act="decisoes-mais"${pagina.carregandoMais ? ' aria-busy="true" disabled' : ""}>${pagina.carregandoMais ? "Carregando…" : pagina.erroMais ? "Tentar de novo" : "Carregar mais"}</button></div>`
    : "";
  const seguinte = dia < hoje ? `<button type="button" class="atv-dia" data-act="decisoes-dia" data-direcao="seguinte" data-dia="${esc(diaSeguinte(dia))}">‹ Dia seguinte</button>` : "<span></span>";
  const anterior = pagina.haAntes ? `<button type="button" class="atv-dia" data-act="decisoes-dia" data-direcao="anterior" data-dia="${esc(diaAnterior(dia))}">Dia anterior ›</button>` : "";
  const navegacao = anterior || dia < hoje ? `<div class="atv-navegacao">${seguinte}${anterior}</div>` : "";
  return painel(`${filtros}${titulo}<div class="dec-dia" data-deslize-dia>${lista}${vazio}${mais}</div>${navegacao}${exportarCsv(bot, vista)}`);
}

/** Uma decisão: hora · "Github · create issue" · a frase em cinza · o desfecho à direita. Aberta: a regra e "Rever acesso". */
function linhaDaDecisao(g: GrupoDeDecisoes, aberta: string | null, bot: Bot): string {
  const l = g.linha;
  const d = DESFECHO[l.desfecho];
  const aberto = aberta === l.id;
  const vezes = g.vezes > 1 ? ` <span class="atv-vezes">${g.vezes} vezes</span>` : "";
  const corpo = `<span class="atv-hora">${esc(hora(l.em))}</span><span class="atv-texto"><span class="atv-titulo">${esc(oQueTentou(l))}${vezes}</span><span class="atv-detalhe">${esc(l.frase)}</span></span><span class="dec-desfecho dec-${l.desfecho}"><span aria-hidden="true">${d.simbolo}</span> ${d.rotulo}</span>`;
  const detalhe = aberto
    ? `<div class="atv-inteiro dec-detalhe" id="dec-${esc(l.id)}"><p><span class="mudo">Regra</span> <code class="dec-regra">${esc(l.regra)} · v${l.regraVersao}</code></p>${l.motivo ? `<p><span class="mudo">Motivo</span> <code class="dec-regra">${esc(l.motivo)}</code></p>` : ""}<p><span class="mudo">Ferramenta</span> <code class="dec-regra">${esc(l.ferramenta)}</code></p>${l.conectorId && l.app ? `<button type="button" class="atv-link" data-act="gaveta" data-nivel="acesso" data-agente="${esc(bot.id)}" data-id="${esc(l.app)}">Rever acesso</button>` : ""}</div>`
    : "";
  return `<li class="atv-item dec-item${aberto ? " aberto" : ""}"><button type="button" class="atv-botao" data-act="decisoes-abrir" data-id="${esc(l.id)}" aria-expanded="${aberto}"${aberto ? ` aria-controls="dec-${esc(l.id)}"` : ""}>${corpo}</button>${detalhe}</li>`;
}

/** "Exportar CSV": o link quieto; aberto, o período, o nome e o total do arquivo e "Baixar CSV" (gerando, baixado, erro). */
function exportarCsv(bot: Bot, vista: VistaDaAtividade): string {
  const ex = vista.exportar;
  const link = `<button type="button" class="atv-link dec-exportar" data-act="exportar-csv" aria-expanded="${!!ex && ex.fase !== "baixado"}" aria-controls="dec-csv">Exportar CSV</button>`;
  if (!ex) return `<div class="dec-csv-linha">${link}</div>`;
  if (ex.fase === "baixado") {
    return `<div class="dec-csv-linha">${link} <span class="mudo dec-baixado" role="status">✓ arquivo baixado · ${ex.linhas ?? 0} ${ex.linhas === 1 ? "decisão" : "decisões"}${ex.cortado ? " (o limite do arquivo; escolha um período menor para ver o resto)" : ""}</span></div>`;
  }
  const { de, ate } = periodoDoCsv(vista.dia, ex.periodo);
  const filtroTxt: Record<FiltroDecisoes, string> = { tudo: "todas as decisões", permitida: "só as permitidas", negada: "só as negadas", cartao: "só os cartões" };
  const periodos = `<div class="atv-filtros dec-periodos" role="radiogroup" aria-label="Período do arquivo">${PERIODOS_DO_CSV.map((p) => `<button type="button" class="atv-filtro" role="radio" data-act="exportar-periodo" data-dias="${p.dias}" aria-checked="${p.dias === ex.periodo}">${esc(p.rotulo)}</button>`).join("")}</div>`;
  const previa = ex.previa === null ? "contando…" : `${ex.previa} ${ex.previa === 1 ? "decisão" : "decisões"}`;
  const gerando = ex.fase === "gerando";
  const erro = ex.fase === "erro" ? `<p class="dec-erro" role="alert"><span class="dec-erro-icone" aria-hidden="true">!</span> O arquivo não saiu. <button type="button" class="atv-link" data-act="baixar-csv">Tentar de novo</button></p>` : "";
  const baixar = ex.fase === "erro" ? "" : `<button type="button" class="dec-baixar" data-act="baixar-csv"${gerando ? ' aria-busy="true" disabled' : ""}>${gerando ? "Gerando…" : "Baixar CSV"}</button>`;
  return `<div class="dec-csv-linha">${link}</div><div class="dec-csv" id="dec-csv">${periodos}<p class="dec-csv-arquivo"><code>${esc(nomeDoCsv(bot.nome, de, ate))}</code> · <span class="mudo">${previa}, ${filtroTxt[vista.desfecho]}, ${esc(rotuloDoFuso(fusoLocal()))}</span></p>${erro}${baixar}</div>`;
}
