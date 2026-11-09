import type { RotinaNaAgenda } from "../../src/contracts/agenda.ts";
import type { RotinaDto } from "../../src/contracts/api.ts";
import type { Estado } from "../estado/reducer.ts";
import type { AgendaUi } from "../estado/agenda.ts";
import {
  diaCurto, diaDaSemana, diaDe, gradeDoMes, hora, itemComProblema, LIMIAR_MUITOS, MASCOTES_NA_REGUA, MASCOTES_NO_BLOCO, MAX_PAUSADAS_SOLTAS,
  montarAgenda, nomeDoDia, nomeDoMes, resumoDoBloco, rotuloDaLinha, semana, somarDias, tituloDaRotina,
  type BotDaAgenda, type DiaAgenda, type EntradaAgenda, type LinhaAgenda, type VisaoAgenda,
} from "../lib/agenda.ts";
import { botaoDaParada, desdeDaParada, motivoDaExecucao } from "../lib/execucao.ts";
import { ICONE } from "../lib/icones.ts";
import { esc, iconeAgente } from "../lib/render.ts";

/**
 * NOD-85 (protótipo v2 do Gil, aprovado em 2026-10-29): Configurações › Rotinas é uma agenda que rola. Abre no agora; para
 * cima o que rodou, para baixo o que vem. No computador só a régua da semana fica presa (sticky no scroller que já existe);
 * no celular, a mesma agenda em tela cheia, com o dia grudado, folha de baixo ao tocar e menu ao segurar. A cor fica só no
 * ponto de 6 px; a única exceção é a linha do agora, em --signal.
 */

type Ctx = { estado: Estado; ui: AgendaUi; hoje: string; foco: string; celular: boolean; bots: BotDaAgenda[] };

const SETA_BAIXO = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const ID_DO_DIA = (dia: string) => `ag-dia-${dia}`;

/** O tom do ponto: a única cor da linha. */
function tomDoPonto(l: Pick<LinhaAgenda, "item" | "parada">): string {
  const i = l.item;
  if (i.tipo === "prevista") return l.parada ? "atencao" : "prev";
  if (i.tipo === "faixa") return i.problemas > 0 ? "erro" : "neutro";
  if (i.desfecho === "executou") return "ok";
  if (i.desfecho === "bloqueada") return "atencao";
  return itemComProblema(i) ? "erro" : "neutro";
}
const ponto = (tom: string) => `<i class="ag-ponto ag-t-${tom}" aria-hidden="true"></i>`;

const mascote = (bot: BotDaAgenda | null, classe = "") => (bot ? iconeAgente(bot, "sm").replace('class="', `class="${classe ? `${classe} ` : ""}`) : "");

const link = (act: string, rotulo: string, dados: Record<string, string> = {}, aria?: string) =>
  `<button type="button" class="ag-link" data-act="${esc(act)}"${Object.entries(dados).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("")}${aria ? ` aria-label="${esc(aria)}"` : ""}>${esc(rotulo)}</button>`;

/** Os bots com rotina: os da agenda lida e, sem ela, os das rotinas que a pessoa já tem (a régua do carregando). */
function botsDaPessoa(estado: Estado, visao: VisaoAgenda | null): BotDaAgenda[] {
  if (visao) return visao.bots;
  const ids = new Set(estado.rotinas.map((r) => r.rotina.agenteId));
  return (estado.frota?.agentes ?? []).filter((a) => ids.has(a.id)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export function renderAgendaRotinas(estado: Estado, celular = false): string {
  const a = estado.agenda;
  const hoje = diaDe(estado.agora);
  const foco = a.ui.foco ?? hoje;
  const parados = new Set(estado.rotinas.filter((r) => r.bloqueio).map((r) => r.rotina.id));
  const visao = a.dto ? montarAgenda({ dto: a.dto, agentes: estado.frota?.agentes ?? [], parados, filtro: { bots: a.ui.bots, soProblema: a.ui.soProblema }, agora: estado.agora, manter: a.ui.alvo ?? a.ui.foco }) : null;
  const ctx: Ctx = { estado, ui: a.ui, hoje, foco, celular, bots: botsDaPessoa(estado, visao) };
  const semRotina = !!a.dto && a.dto.rotinas.length === 0 && estado.rotinas.length === 0;
  const corpo = a.erro ? renderErro(celular) : !visao ? renderCarregando(celular) : semRotina ? renderVazio(celular) : renderDias(ctx, visao);
  if (celular) {
    return `<section class="ag-agenda ag-cel" aria-label="Agenda das rotinas">${semRotina || a.erro ? "" : chipsDoCelular(ctx)}<div class="ag-corpo">${corpo}</div>${folhaDoCelular(ctx, visao)}</section>`;
  }
  return `<section class="espaco-secao cfg-secao ag-agenda" aria-labelledby="ag-titulo">
    <div class="ag-cab"><h2 id="ag-titulo">Rotinas</h2>${link("navegar", "+ Nova rotina", { tela: "nova-rotina" })}</div>
    <p class="intro">O que seus bots fazem sozinhos, num horário.</p>
    ${semRotina ? "" : `<div class="ag-preso">${regua(ctx, visao)}${ctx.ui.mes ? miniMes(ctx, visao, false) : ""}</div>`}
    <div class="ag-corpo">${corpo}</div>
  </section>`;
}

/* ---------- A régua (computador) ---------- */

function regua(ctx: Ctx, visao: VisaoAgenda | null): string {
  const dias = semana(ctx.foco);
  const mes = ctx.foco.slice(0, 7);
  const botoesDias = dias.map((d) => {
    const problema = !!visao?.comProblema.has(d);
    const rotulo = `${diaCurto(d)}${d === ctx.hoje ? ", hoje" : ""}${problema ? ", com problema" : ""}`;
    return `<button type="button" class="ag-rdia" data-act="agenda-ir" data-dia="${d}"${d === ctx.hoje ? ' aria-current="date"' : ""}${d === ctx.foco ? ' data-foco=""' : ""} aria-label="${esc(rotulo)}"><small aria-hidden="true">${esc(diaDaSemana(d))}</small><b aria-hidden="true">${Number(d.slice(8))}</b>${problema ? ponto("erro") : '<i class="ag-ponto-vazio" aria-hidden="true"></i>'}</button>`;
  }).join("");
  return `<div class="ag-regua" role="toolbar" aria-label="${esc(`Semana de ${Number(dias[0]!.slice(8))} a ${Number(dias[6]!.slice(8))}`)}">
    <button type="button" class="ag-mes" data-act="agenda-mes" aria-haspopup="dialog" aria-expanded="${ctx.ui.mes !== null}" aria-controls="ag-mini">${esc(nomeDoMes(mes))}${SETA_BAIXO}</button>
    <div class="ag-dias">${botoesDias}</div>
    ${ctx.ui.soProblema ? `<button type="button" class="ag-fprob" data-act="agenda-so-problema" aria-label="Tirar o filtro Só com problema">Só com problema <span class="ag-x" aria-hidden="true">✕</span></button>` : ""}
    ${filtroDeBots(ctx)}
  </div>`;
}

/** Os mascotes do filtro; com 6 ou mais bots, os 5 primeiros (os escolhidos na frente), "+N" e a busca. */
function filtroDeBots(ctx: Ctx): string {
  if (ctx.bots.length < 2 && ctx.ui.bots.length === 0) return "";
  const botao = (b: BotDaAgenda) => {
    const ligado = ctx.ui.bots.includes(b.id);
    const apagado = ctx.ui.bots.length > 0 && !ligado;
    return `<button type="button" class="ag-fbot${apagado ? " ag-apagado" : ""}" data-act="agenda-bot" data-id="${esc(b.id)}" aria-pressed="${ligado}" aria-label="${esc(`Só as rotinas de ${b.nome}`)}" title="${esc(b.nome)}">${mascote(b)}</button>`;
  };
  // QA do PR #595 (B2): na busca, o mascote vem com o nome (é por ele que a pessoa procurou).
  const botaoComNome = (b: BotDaAgenda) => {
    const ligado = ctx.ui.bots.includes(b.id);
    return `<button type="button" class="ag-fbot ag-fbot-nome" data-act="agenda-bot" data-id="${esc(b.id)}" aria-pressed="${ligado}">${mascote(b)}<span class="ag-fbot-txt">${esc(b.nome)}</span></button>`;
  };
  if (ctx.ui.busca !== null) {
    const termo = ctx.ui.busca.trim().toLocaleLowerCase("pt-BR");
    const achados = ctx.bots.filter((b) => !termo || b.nome.toLocaleLowerCase("pt-BR").includes(termo));
    return `<div class="ag-bots ag-bots-busca" role="group" aria-label="Filtrar por bot">
      <label class="ag-busca"><span class="ag-sr">Buscar bot</span><input type="search" data-agenda-busca data-manter-foco="agenda-busca" value="${esc(ctx.ui.busca)}" placeholder="Buscar bot" autocomplete="off"><button type="button" class="ag-busca-x" data-act="agenda-busca-fechar" aria-label="Fechar a busca">✕</button></label>
      <div class="ag-busca-res" role="list">${achados.length ? achados.slice(0, 12).map((b) => `<span role="listitem">${botaoComNome(b)}</span>`).join("") : '<span class="ag-mudo">Nenhum bot com esse nome.</span>'}</div>
    </div>`;
  }
  const ordenados = [...ctx.bots.filter((b) => ctx.ui.bots.includes(b.id)), ...ctx.bots.filter((b) => !ctx.ui.bots.includes(b.id))];
  const muitos = ordenados.length >= LIMIAR_MUITOS;
  const visiveis = muitos ? ordenados.slice(0, MASCOTES_NA_REGUA) : ordenados;
  const resto = ordenados.length - visiveis.length;
  const mais = muitos ? `<button type="button" class="ag-buscar" data-act="agenda-busca-abrir" aria-label="${esc(`Buscar entre os ${ordenados.length} bots`)}">+${resto}<span>Buscar</span></button>` : "";
  return `<div class="ag-bots" role="group" aria-label="Filtrar por bot">${visiveis.map(botao).join("")}${mais}</div>`;
}

/* ---------- O mês (popover no computador, folha no celular) ---------- */

function miniMes(ctx: Ctx, visao: VisaoAgenda | null, celular: boolean): string {
  const mes = ctx.ui.mes ?? ctx.foco.slice(0, 7);
  const daSemana = new Set(semana(ctx.foco));
  const cab = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((d) => `<abbr title="${d}">${d[0]!.toUpperCase()}</abbr>`).join("");
  const dias = gradeDoMes(mes).map((d) => {
    if (!d) return "<span></span>";
    const problema = !!visao?.comProblema.has(d);
    return `<button type="button" class="ag-mm-dia${daSemana.has(d) ? " ag-mm-semana" : ""}" data-act="agenda-ir" data-dia="${d}"${d === ctx.hoje ? ' aria-current="date"' : ""} aria-label="${esc(`${diaCurto(d)}${problema ? ", com problema" : ""}`)}">${Number(d.slice(8))}${problema ? ponto("erro") : ""}</button>`;
  }).join("");
  const [ano, m] = mes.split("-").map(Number) as [number, number];
  const anterior = `${m === 1 ? ano - 1 : ano}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const proximo = `${m === 12 ? ano + 1 : ano}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  return `<div class="ag-mini${celular ? " ag-folha ag-folha-mes" : ""}" id="ag-mini" role="dialog" aria-label="Escolher um dia">
    <div class="ag-mm-cab"><b>${esc(`${nomeDoMes(mes)} ${ano}`)}</b><span class="ag-mm-nav"><button type="button" class="ag-mm-seta" data-act="agenda-mes" data-mes="${anterior}" aria-label="Mês anterior">‹</button><button type="button" class="ag-mm-seta" data-act="agenda-mes" data-mes="${proximo}" aria-label="Próximo mês">›</button></span></div>
    <div class="ag-mm-grade">${cab}${dias}</div>
    <p class="ag-mm-nota">${ponto("erro")}dia com problema</p>
  </div>`;
}

/* ---------- Os dias ---------- */

function renderDias(ctx: Ctx, visao: VisaoAgenda): string {
  return visao.dias.map((d) => renderDia(ctx, d, visao)).join("");
}

function renderDia(ctx: Ctx, d: DiaAgenda, visao: VisaoAgenda): string {
  const ehHoje = d.dia === ctx.hoje;
  const itens: string[] = d.entradas.map((e) => entrada(ctx, e));
  if (d.entradas.length === 0) itens.push(`<li class="ag-sem">${esc(visao.filtrado ? fraseDoFiltroVazio(ctx, d.dia) : "Nada agendado.")}${visao.filtrado ? ` ${link("agenda-todos", ctx.ui.bots.length ? "Ver todos os bots" : "Ver tudo")}` : ""}</li>`);
  if (d.agora !== null) itens.splice(d.agora, 0, linhaDoAgora(ctx.estado.agora) + abaixoDoAgora(ctx));
  return `<section class="ag-dia${ehHoje ? " ag-hoje" : ""}" id="${ID_DO_DIA(d.dia)}" aria-labelledby="ag-h-${d.dia}"><h3 class="ag-dia-cab" id="ag-h-${d.dia}">${esc(nomeDoDia(d.dia, ctx.hoje))}</h3><ul class="ag-lista">${itens.join("")}</ul></section>`;
}

const EXTENSO: Record<string, string> = { seg: "na segunda", ter: "na terça", qua: "na quarta", qui: "na quinta", sex: "na sexta", "sáb": "no sábado", dom: "no domingo" };

/** "O Otto não tem nada no sábado." — o filtro que deixou o dia vazio diz o que filtrou. */
export function fraseDoFiltroVazio(ctx: Pick<Ctx, "ui" | "bots" | "hoje">, dia: string): string {
  const quando = dia === ctx.hoje ? "hoje" : dia === somarDias(ctx.hoje, 1) ? "amanhã" : dia === somarDias(ctx.hoje, -1) ? "ontem" : (EXTENSO[diaDaSemana(dia)] ?? `em ${dia}`);
  const escolhidos = ctx.bots.filter((b) => ctx.ui.bots.includes(b.id));
  const problema = ctx.ui.soProblema ? " com problema" : "";
  if (escolhidos.length === 1) return `${escolhidos[0]!.nome} não tem nada${problema} ${quando}.`;
  if (escolhidos.length > 1) return `Esses bots não têm nada${problema} ${quando}.`;
  return `Nada${problema} ${quando}.`;
}

function linhaDoAgora(agora: number): string {
  return `<li class="ag-agora" role="separator" aria-label="${esc(`Agora, ${hora(agora)}`)}"><span class="ag-agora-h" aria-hidden="true">${esc(hora(agora))}</span><b class="ag-agora-bola" aria-hidden="true"></b><i aria-hidden="true"></i></li>`;
}

/** Logo abaixo do agora: as paradas (falta acesso) e as pausadas, que não têm hora na agenda. */
function abaixoDoAgora(ctx: Ctx): string {
  // Revisão 2 do PR 595: Ativar e Conectar só na rotina da própria pessoa; a de um colega não aparece aqui.
  const passa = (r: RotinaDto) => r.rotina.ownerId === ctx.estado.sessao?.pessoaId && (ctx.ui.bots.length === 0 || ctx.ui.bots.includes(r.rotina.agenteId));
  const botDe = (r: RotinaDto) => ctx.estado.frota?.agentes.find((a) => a.id === r.rotina.agenteId) ?? null;
  const paradas = ctx.estado.rotinas.filter((r) => r.bloqueio && r.rotina.estado === "ativa" && passa(r));
  const pausadas = ctx.ui.soProblema ? [] : ctx.estado.rotinas.filter((r) => r.rotina.estado === "pausada" && passa(r));
  const nota = (r: RotinaDto, desf: string, tom: string, acao: string) =>
    `<li class="ag-item ag-nota"><div class="ag-linha ag-linha-muda"><span class="ag-hora ag-hora-ic" aria-hidden="true">${ICONE.relogioMini}</span>${mascote(botDe(r))}<span class="ag-nome">${esc(tituloDaRotina(r.rotina.instrucao))}</span><span class="ag-desf">${ponto(tom)}${esc(desf)}</span>${acao}</div></li>`;
  const linhasParadas = paradas.map((r) => {
    const b = r.bloqueio!;
    const falta = `${b.motivo === "sem_conexao" ? `Falta conectar o ${b.app}` : `Falta acesso ao ${b.app}`} ${desdeDaParada(b, ctx.estado.agora)}`;
    return nota(r, falta, "atencao", botaoDaParada(b, "ag-link"));
  });
  const ativar = (r: RotinaDto) => link("ativar-rotina", "Ativar", { id: r.rotina.id }, `Ativar a rotina ${tituloDaRotina(r.rotina.instrucao)}`);
  let linhasPausadas = pausadas.map((r) => nota(r, "Pausada", "neutro", ativar(r)));
  if (pausadas.length > MAX_PAUSADAS_SOLTAS) {
    const aberto = ctx.ui.pausadasAbertas;
    const cab = `<li class="ag-item"><button type="button" class="ag-linha ag-pausadas" data-act="agenda-pausadas" aria-expanded="${aberto}"><span class="ag-hora ag-hora-ic" aria-hidden="true">${ICONE.relogioMini}</span><span class="ag-nome">${pausadas.length} rotinas pausadas</span>${SETA_BAIXO}</button></li>`;
    linhasPausadas = [cab, ...(aberto ? linhasPausadas : [])];
  }
  return [...linhasParadas, ...linhasPausadas].join("");
}

function entrada(ctx: Ctx, e: EntradaAgenda): string {
  if (e.tipo === "linha") return linha(ctx, e.linha);
  if (e.tipo === "sem-registro") {
    return `<li class="ag-item ag-sem-registro"><div class="ag-linha ag-linha-muda"><span class="ag-hora" aria-hidden="true"></span>${mascote(e.bot)}<span class="ag-nome">${esc(tituloDaRotina(e.rotina.instrucao))}</span><span class="ag-desf ag-mudo">sem registro</span></div></li>`;
  }
  const aberto = ctx.ui.bloco === e.chave;
  const comBot = e.linhas.filter((l) => l.bot);
  const pilha = comBot.slice(0, MASCOTES_NO_BLOCO).map((l) => mascote(l.bot)).join("");
  const problema = e.linhas.some((l) => itemComProblema(l.item));
  const id = `ag-bl-${e.instante}`;
  const cab = `<button type="button" class="ag-linha ag-bloco" data-act="agenda-bloco" data-chave="${esc(e.chave)}" aria-expanded="${aberto}" aria-controls="${id}"><span class="ag-hora">${esc(hora(e.instante))}</span><span class="ag-pilha" aria-hidden="true">${pilha}</span><span class="ag-nome">${e.linhas.length} rotinas${e.linhas.length > MASCOTES_NO_BLOCO ? `<span class="ag-mais"> +${e.linhas.length - MASCOTES_NO_BLOCO}</span>` : ""}</span><span class="ag-desf">${ponto(problema ? "erro" : e.linhas.every((l) => l.item.tipo === "prevista") ? "prev" : "ok")}${esc(resumoDoBloco(e.linhas))}</span>${ctx.celular ? "" : SETA_BAIXO}</button>`;
  return `<li class="ag-item${aberto ? " ag-aberta" : ""}">${cab}${aberto ? `<ul class="ag-bloco-lista" id="${id}">${e.linhas.map((l) => linha(ctx, l)).join("")}</ul>` : ""}</li>`;
}

function linha(ctx: Ctx, l: LinhaAgenda): string {
  const aberta = !ctx.celular && ctx.ui.aberto === l.chave;
  const det = `ag-det-${l.item.tipo}-${l.item.instante}-${l.rotina.id.slice(0, 8)}`;
  const esmaecida = l.parada && l.item.tipo === "prevista";
  const horaHtml = l.item.tipo === "faixa" ? `<span class="ag-hora ag-hora-ic" aria-hidden="true">${ICONE.relogioMini}</span><span class="ag-sr">O dia todo, </span>` : `<span class="ag-hora">${esc(hora(l.item.instante))}</span>`;
  const nome = `<span class="ag-sr">${esc(l.bot?.nome ?? "bot")}: </span>${esc(tituloDaRotina(l.rotina.instrucao))}`;
  const desf = `<span class="ag-desf">${ponto(tomDoPonto(l))}${esc(rotuloDaLinha(l))}</span>`;
  const corpo = ctx.celular ? `${horaHtml}${mascote(l.bot, "ag-masc")}<span class="ag-txt"><span class="ag-nome">${nome}</span>${desf}</span>` : `${horaHtml}${mascote(l.bot)}<span class="ag-nome">${nome}</span>${desf}`;
  return `<li class="ag-item${aberta ? " ag-aberta" : ""}${esmaecida ? " ag-esmaecida" : ""}"><button type="button" class="ag-linha" data-act="agenda-linha" data-chave="${esc(l.chave)}" aria-expanded="${aberta}"${ctx.celular ? ' aria-haspopup="dialog"' : ` aria-controls="${det}"`}>${corpo}</button>${aberta ? `<div class="ag-det" id="${det}">${detalhe(ctx, l)}</div>` : ""}</li>`;
}

/* ---------- O detalhe (no lugar, ou na folha do celular) ---------- */

function textosDoDetalhe(ctx: Ctx, l: LinhaAgenda): { frase: string; meta: string[] } {
  const i = l.item;
  const r = l.rotina;
  const meta: string[] = [];
  if (i.tipo === "execucao") {
    const motivo = motivoDaExecucao({ motivo: i.motivo as Parameters<typeof motivoDaExecucao>[0]["motivo"] });
    meta.push(`Agendada ${hora(i.instante)} · registrada ${hora(i.em)}${motivo ? ` · ${motivo}` : ""}`);
  } else if (i.tipo === "prevista") {
    meta.push(l.parada ? `Prevista ${hora(i.instante)}, mas a rotina está parada` : `Prevista ${hora(i.instante)}`);
  } else {
    meta.push(rotuloDaLinha(l));
  }
  if (r.resumo) meta.push(r.resumo);
  if (ctx.estado.agenda.dto && r.fusoIana !== ctx.estado.agenda.dto.fuso) meta.push(`no fuso ${r.fusoIana}`);
  return { frase: r.instrucao, meta };
}

function acoesDaRotina(ctx: Ctx, r: RotinaNaAgenda): { act: string; rotulo: string; dados: Record<string, string> }[] {
  const pausada = r.estado === "pausada";
  const conversa = { act: "abrir-conversa", rotulo: "Ver na conversa", dados: { conversa: r.conversaId, agente: r.agenteId } };
  // Revisão 1 do PR #595: rotina de outra pessoa (equipe) só se vê; pausar, ativar e testar são da dona. Revisão 3: nem a
  // conversa, que é dela e a pessoa não abre.
  if (!r.minha) return [];
  return [
    conversa,
    ...(ctx.estado.ocupado ? [] : [{ act: "executar-rotina", rotulo: "Testar agora", dados: { id: r.id, agente: r.agenteId } }]),
    { act: pausada ? "ativar-rotina" : "pausar-rotina", rotulo: pausada ? "Ativar" : ctx.celular ? "Pausar a rotina" : "Pausar", dados: { id: r.id } },
  ];
}

function bloqueioDe(ctx: Ctx, rotinaId: string) {
  return ctx.estado.rotinas.find((x) => x.rotina.id === rotinaId)?.bloqueio ?? null;
}

function detalhe(ctx: Ctx, l: LinhaAgenda): string {
  const { frase, meta } = textosDoDetalhe(ctx, l);
  const b = bloqueioDe(ctx, l.rotina.id);
  const acoes = acoesDaRotina(ctx, l.rotina).map((a) => link(a.act, a.rotulo, a.dados)).join("");
  return `<p class="ag-frase">${esc(frase)}</p><p class="ag-meta">${meta.map(esc).join("<br>")}</p><p class="ag-acoes">${b ? botaoDaParada(b, "ag-link") : ""}${acoes}</p>`;
}

/* ---------- Celular ---------- */

/** O título da seção no celular: o mês é o botão que abre a folha do mês. */
export function tituloDaAgendaCelular(estado: Estado): string {
  const foco = estado.agenda.ui.foco ?? diaDe(estado.agora);
  return `<button type="button" class="ag-mes-bt" data-act="agenda-mes" aria-haspopup="dialog" aria-expanded="${estado.agenda.ui.mes !== null}"><small>Rotinas</small><span>${esc(nomeDoMes(foco.slice(0, 7)))}${SETA_BAIXO}</span></button>`;
}

/** Os chips no topo do scroller: ficam acima do agora, então só aparecem puxando a lista para baixo. */
function chipsDoCelular(ctx: Ctx): string {
  const prob = ctx.ui.soProblema ? `<button type="button" class="ag-chip ag-chip-prob" data-act="agenda-so-problema" aria-label="Tirar o filtro Só com problema">Só com problema <span aria-hidden="true">✕</span></button>` : "";
  const bots = ctx.bots.length < 2 ? "" : ctx.bots.map((b) => `<button type="button" class="ag-chip" data-act="agenda-bot" data-id="${esc(b.id)}" aria-pressed="${ctx.ui.bots.includes(b.id)}">${mascote(b, "ag-masc")}${esc(b.nome)}</button>`).join("");
  return prob || bots ? `<div class="ag-chips" role="group" aria-label="Filtrar">${prob}${bots}</div>` : "";
}

function linhaPorChave(visao: VisaoAgenda | null, chave: string | null): LinhaAgenda | null {
  if (!visao || !chave) return null;
  for (const d of visao.dias) {
    for (const e of d.entradas) {
      if (e.tipo === "linha" && e.linha.chave === chave) return e.linha;
      if (e.tipo === "bloco") for (const l of e.linhas) if (l.chave === chave) return l;
    }
  }
  return null;
}

/** A folha de baixo (toque), o menu (toque longo) ou a folha do mês. Uma por vez; o véu fecha. */
function folhaDoCelular(ctx: Ctx, visao: VisaoAgenda | null): string {
  const veu = '<div class="ag-veu" data-act="agenda-fechar" aria-hidden="true"></div>';
  if (ctx.ui.mes !== null) return `${veu}${miniMes(ctx, visao, true)}`;
  const menu = linhaPorChave(visao, ctx.ui.menu);
  if (menu) {
    const itens = acoesDaRotina(ctx, menu.rotina).map((a) => `<button type="button" role="menuitem" class="ag-folha-item" data-act="${esc(a.act)}"${Object.entries(a.dados).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("")}>${esc(a.rotulo)}</button>`).join("");
    return `${veu}<div class="ag-folha ag-menu" role="menu" aria-label="${esc(`Ações da rotina ${tituloDaRotina(menu.rotina.instrucao)}`)}">${itens}</div>`;
  }
  const l = linhaPorChave(visao, ctx.ui.aberto);
  if (!l) return "";
  const { frase, meta } = textosDoDetalhe(ctx, l);
  const titulo = tituloDaRotina(l.rotina.instrucao);
  const b = bloqueioDe(ctx, l.rotina.id);
  const itens = acoesDaRotina(ctx, l.rotina).map((a) => `<button type="button" class="ag-folha-item" data-act="${esc(a.act)}"${Object.entries(a.dados).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("")}>${esc(a.rotulo)}</button>`).join("");
  return `${veu}<div class="ag-folha" role="dialog" aria-modal="true" tabindex="-1" aria-label="${esc(`${titulo}, ${nomeDoDia(l.item.dia, ctx.hoje)}`)}">
    <div class="ag-fcab">${mascote(l.bot, "ag-masc")}<div><h3>${esc(titulo)}</h3><p class="ag-fquando">${ponto(tomDoPonto(l))}${esc(`${rotuloDaLinha(l)} · ${nomeDoDia(l.item.dia, ctx.hoje)}${l.item.tipo === "faixa" ? "" : ` ${hora(l.item.instante)}`}`)}</p></div></div>
    <p class="ag-frase">${esc(frase)}</p><p class="ag-meta">${meta.map(esc).join("<br>")}</p>
    ${b ? `<div class="ag-folha-parada">${botaoDaParada(b, "pri")}</div>` : ""}${itens}
  </div>`;
}

/* ---------- Carregando, erro, vazio ---------- */

function renderCarregando(celular: boolean): string {
  const linha = '<div class="ag-esq-linha" aria-hidden="true"><span class="ag-esq" style="width:40px"></span><span class="ag-esq redondo"></span><span class="ag-esq" style="width:46%"></span></div>';
  return `<div class="ag-carregando${celular ? " ag-cel-pad" : ""}" role="status" aria-label="Carregando a agenda">${linha.repeat(6)}</div>`;
}

function renderErro(celular: boolean): string {
  return `<div class="ag-erro${celular ? " ag-cel-pad" : ""}" role="alert"><p><b>Não deu para carregar a agenda.</b> As rotinas continuam rodando.</p>${link("agenda-tentar", "Tentar de novo")}</div>`;
}

function renderVazio(celular: boolean): string {
  return `<div class="ag-vazio${celular ? " ag-cel-pad" : ""}"><p class="ag-vazio-tit">Nenhuma rotina ainda</p><p>Peça na conversa de um bot, do seu jeito: «todo dia útil às 8, me mande os PRs abertos». Ele propõe e você confirma.</p>${link("navegar", "+ Nova rotina", { tela: "nova-rotina" })}</div>`;
}

/**
 * O dia que recebe o foco ao abrir o mês: hoje (aria-current) ou, se hoje não está nesse mês, o primeiro. Duas consultas,
 * porque um seletor com vírgula devolve o primeiro na ordem do documento (o dia 1), não o da primeira alternativa.
 */
export function diaParaFocarNoMes<T>(achar: (seletor: string) => T | null): T | null {
  return achar("#ag-mini .ag-mm-dia[aria-current]") ?? achar("#ag-mini .ag-mm-dia");
}

/** O valor curto de Rotinas na lista do celular: as falhas de ontem e de hoje ("1 falha"), ou nada. */
export function valorDaAgenda(estado: Estado): string {
  const dto = estado.agenda.dto;
  if (!dto) {
    // QA do PR #595 (B6): sem a agenda lida (ela só lê ao abrir), as paradas de GET rotinas já dizem algo.
    const paradas = estado.rotinas.filter((r) => r.bloqueio !== null && r.rotina.ownerId === estado.sessao?.pessoaId).length;
    return paradas === 0 ? "" : paradas === 1 ? "1 parada" : `${paradas} paradas`;
  }
  const hoje = diaDe(estado.agora);
  const ontem = somarDias(hoje, -1);
  const n = dto.itens.filter((i) => (i.dia === hoje || i.dia === ontem) && itemComProblema(i)).length;
  return n === 0 ? "" : n === 1 ? "1 falha" : `${n} falhas`;
}

export { ID_DO_DIA };
