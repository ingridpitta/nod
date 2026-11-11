/**
 * ADA-17 (ADR-148, F2; protótipo nod-prototipos/ada-2 v2, jornada 4): a tarefa aberta no celular.
 *
 * Conteúdo primeiro, sem cartão dentro de cartão: o código e o título grande na largura toda, a bandeja de chips que rola
 * de lado (Status, Responsável, Branch, Ajustes — cada um abre uma folha, sem select), a descrição, a pergunta (quando
 * trava na pessoa), uma ATIVIDADE só por hora (eventos com ponto de 6 px, execuções do bot como linha — #294 —, comentários
 * em cartão cinza sem borda) e um composer só, embaixo, acima do teclado. Responder a um comentário é contextual
 * ("Respondendo a Ana ✕"), no mesmo composer.
 *
 * Mesmos dados e mesmos handlers do computador (`tarefaAberta`, web/telas/quadro-real.ts): só a árvore muda, escolhida
 * pela forma em web/lib/quadro-na-tela.ts. Todo texto de fora passa por `esc`.
 */
import type { ComentarioDto, EntradaHistoricoDto, QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { AtividadeTarefa } from "../../src/contracts/quadro-pela-conversa.ts";
import type { ExecucaoDto } from "../../src/contracts/quadro-execucoes.ts";
import { comColunas, iconeDaColuna } from "../lib/colunas.ts";
import { esc } from "../lib/escape.ts";
import { fraseDoMovimento, porqueNaoDesfaz } from "../lib/freios.ts";
import { NOME_DO_STATUS, type Status } from "../lib/quadro.ts";
import { codigoDaTarefa, linhaDoHistorico } from "../lib/quadro-dados.ts";
import type { CargaDosComentarios } from "./comentarios-tarefa.ts";
import { LIMITE_COMENTARIO } from "./comentarios-tarefa.ts";
import { esperandoOutro, formResposta, fusoDoAparelho, type AgenteDoQuadro } from "./quadro-real.ts";
import { secaoDeLabelEPrazoCelular } from "./campos-da-tarefa.ts";
import { anel, avatar, confiar, ICONE, ICONE_DO_STATUS, type Html } from "./quadro.ts";
import { logDoTrabalho, passosDoTrabalho, vivo, type VistaDoTrabalho } from "./trabalhos-da-tarefa.ts";

/** S1 (ADA-17): a tarefa não tem prazo no modelo; o chip Prazo fica atrás desta flag, desligada, até o follow-up. */
export const PRAZO_DA_TAREFA = false;

export type DadosDosComentarios = {
  lista: readonly ComentarioDto[];
  carga: CargaDosComentarios;
  atividade: readonly AtividadeTarefa[];
  criadaPor: string | null;
  pendente: { texto: string; falhou: boolean; duvida?: boolean } | null;
};

/** `raiz` (2026-11-10): a thread do comentário respondido; a resposta vai nela (responder_a) além da citação. */
export type Respondendo = { comentario: string; nome: string; trecho: string; raiz?: string };

export type VistaDaTarefaCelular = {
  t: TarefaDto;
  q: QuadroDto;
  agente: AgenteDoQuadro;
  hora: (em: number) => string;
  responsaveis?: readonly { id: string; nome: string }[];
  historico?: readonly EntradaHistoricoDto[] | null;
  coms?: DadosDosComentarios;
  trabalho?: VistaDoTrabalho;
  respondendo?: Respondendo | null;
  /** A mudança de status/responsável que ainda não voltou (troca otimista no chip). */
  otimista?: { status?: string; agente?: string | null } | null;
  /** A mudança que não salvou (status ou responsável): "Não salvou. Voltou para Fazendo." + Tentar de novo. */
  naoSalvou?: QualTroca | null;
  agora?: number;
  /** 0159: o fuso de quem lê (o prazo da tarefa). Sem ele, o do aparelho. */
  fuso?: string;
};

const ENVIAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
const AJUSTES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
const BRANCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-11 7"/></svg>';

/** O trecho da citação de quem a pessoa responde (S2: vai no próprio texto do comentário, sem schema novo). */
export const TRECHO_MAX = 80;
export function trechoDe(texto: string): string {
  const limpo = texto.replace(/^(>.*\n)+/, "").replace(/\s+/g, " ").trim();
  return limpo.length > TRECHO_MAX ? `${limpo.slice(0, TRECHO_MAX - 1)}…` : limpo;
}
/** O texto que vai ao quadro.comentar quando a pessoa responde: "> Ana: trecho" + linha em branco + a resposta. */
export function textoDaResposta(r: Pick<Respondendo, "nome" | "trecho">, resposta: string): string {
  const comCita = `${prefixoDaResposta(r)}${resposta}`;
  // Revisão do PR #699: a citação não pode empurrar o comentário além do limite (o servidor recusaria e "Tentar de novo"
  // falharia sempre). Sem espaço para ela, vai só a resposta.
  return comCita.length <= LIMITE_COMENTARIO ? comCita : resposta;
}
/** "> Ana: trecho" + linha em branco: o que a citação ocupa no texto do comentário. */
export function prefixoDaResposta(r: Pick<Respondendo, "nome" | "trecho">): string {
  return `> ${r.nome.replace(/[\r\n]+/g, " ")}: ${r.trecho.replace(/[\r\n]+/g, " ")}\n\n`;
}

/** A troca otimista do celular (status ou responsável), marcada pela vez em que saiu. */
export type TrocaCel = { tarefa: string; seq: number; status?: string; agente?: string | null };
export type QualTroca = "status" | "resp";
export type NaoSalvouCel = { tarefa: string; qual: QualTroca; refazer: () => void };
/**
 * "Não salvou. Voltou para Fazendo." / "Não salvou. Continua com Vera." QA do PR #699: a frase sai da tarefa de AGORA, no
 * desenho; a falha por "o quadro mudou" relê o quadro, e o valor de antes do toque pode não ser mais o da tarefa.
 */
export function fraseDoNaoSalvou(v: Pick<VistaDaTarefaCelular, "t" | "q" | "agente">, qual: QualTroca): string {
  const { t } = v;
  if (qual === "status") {
    const col = comColunas(v.q).colunas.find((c) => c.id === t.status);
    return `Não salvou. Voltou para ${col?.nome ?? NOME_DO_STATUS[t.status as Status] ?? t.status}.`;
  }
  return t.agenteId ? `Não salvou. Continua com ${v.agente(t.agenteId)?.nome ?? t.agenteNome ?? "outro bot"}.` : "Não salvou. Continua sem responsável.";
}
/**
 * Revisão do PR #699: o fim de uma troca otimista. Só a troca dona do estado decide: a resposta que chega depois de outra
 * troca começar, ou depois de a pessoa sair (fechar zera o estado), não apaga o chip novo nem grava um "Não salvou" de algo
 * que pode ter salvado. Deu certo: o "Não salvou" antigo da mesma tarefa sai.
 */
export function fimDaTrocaCel(estado: { otimista: TrocaCel | null; naoSalvou: NaoSalvouCel | null }, minha: TrocaCel, ok: boolean, falha: () => NaoSalvouCel): { otimista: TrocaCel | null; naoSalvou: NaoSalvouCel | null } {
  if (estado.otimista?.seq !== minha.seq) return estado;
  return { otimista: null, naoSalvou: ok ? (estado.naoSalvou?.tarefa === minha.tarefa ? null : estado.naoSalvou) : falha() };
}
/** Separa a citação do começo do comentário (S2). */
export function citacaoDe(texto: string): { cita: { nome: string; trecho: string } | null; corpo: string } {
  const m = /^> ([^:\n]{1,80}): ([^\n]*)\n\n?([\s\S]*)$/.exec(texto);
  return m ? { cita: { nome: m[1]!, trecho: m[2]! }, corpo: m[3]! } : { cita: null, corpo: texto };
}

/** Quem escreveu o comentário (o mesmo critério da lista do computador, NOD-422/NOD-430). */
export function autorDoComentario(c: ComentarioDto, agente: AgenteDoQuadro): { avatar: string; nome: string } {
  if (c.autor.tipo === "linear") return { avatar: anel((c.autorNome ?? "L").slice(0, 1), c.autorNome ?? "Linear", false), nome: `${c.autorNome ?? "Linear"} · no Linear` };
  if (c.autor.tipo === "pessoa") return { avatar: anel("V", "Você", true), nome: "Você" };
  // ADR-162: a explicação do próprio quadro (a espera que ele deixou com você).
  if (c.autor.tipo === "sistema") return { avatar: anel("Q", "Quadro", false), nome: "Quadro" };
  const a = agente(c.autor.agenteId) ?? { avatar: anel((c.autorNome ?? "?").slice(0, 1), c.autorNome ?? "Bot", false), nome: c.autorNome ?? "Bot" };
  return c.pedidoPor ? { avatar: a.avatar, nome: `Você, pela ${a.nome}` } : a;
}

type Item = { em: number; ordem: number; html: string };
const tempo = (em: number): string => esc(new Date(em).toISOString());

const evento = (texto: string, em: number, hora: (em: number) => string, extra = ""): string =>
  `<li class="qd-ev"><span class="qd-ev-txt">${texto}</span> <time datetime="${tempo(em)}">${esc(hora(em))}</time>${extra}</li>`;

const minutos = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 1 ? "menos de 1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/** #294: a execução como uma linha (mascote 28, "Vera está trabalhando", "N passos · 2 min", ›), não um bloco. */
export function linhaDaExecucao(e: ExecucaoDto, o: { nome: string; avatar: string; hora: (em: number) => string; agora: number; atual: boolean; v?: VistaDoTrabalho }): string {
  const verbo = e.esperando ? "está esperando" : e.estado === "rodando" ? "está trabalhando" : e.estado === "fila" ? "vai começar" : e.estado === "concluido" ? "concluiu" : e.estado === "falhou" ? "falhou" : "parou";
  const passos = o.atual ? passosDoTrabalho(o.v?.atividade, !vivo(e)).length : 0;
  const meta = [passos ? `${passos} ${passos === 1 ? "passo" : "passos"}` : "", e.estado === "rodando" && e.comecouEm ? minutos(o.agora - e.comecouEm) : ""].filter(Boolean).join(" · ");
  const frase = e.estado === "falhou" ? (e.motivo ?? "") : "";
  let extra = "";
  if (o.atual && o.v) {
    const des = o.v.ocupado ? " disabled" : "";
    const acoes: string[] = [];
    if (vivo(e)) {
      acoes.push(`<button type="button" class="qd-link" data-act="trab-cancelar"${des}>Cancelar</button>`);
      if (e.esperando) acoes.push(`<button type="button" class="qd-link" data-act="trab-repetir"${des}>Repetir</button>`);
    } else {
      if (e.estado === "concluido" && o.v.dados?.conversaId) {
        acoes.push(o.v.dados.conversaId === o.v.conversaAtual
          ? `<button type="button" class="qd-link" data-act="qc-abrir-conversa">Ver na conversa</button>`
          : `<button type="button" class="qd-link" data-act="abrir-conversa" data-conversa="${esc(o.v.dados.conversaId)}" data-agente="${esc(o.v.agenteId ?? "")}">Ver na conversa</button>`);
      }
      if (e.estado === "falhou" || e.estado === "concluido" || o.v.bloqueada) acoes.push(`<button type="button" class="qd-link" data-act="trab-repetir"${des}>Repetir</button>`);
    }
    extra = `<div class="qd-trab-log" data-trabalho="${esc(e.id)}">${logDoTrabalho(e, o.v.atividade, o.v.passosAbertos)}</div>` +
      (acoes.length ? `<p class="qd-exec-acoes">${acoes.join(`<span aria-hidden="true"> · </span>`)}</p>` : "");
  }
  return `<li class="qd-exec" data-estado="${esc(e.estado)}"><span class="qd-exec-av" aria-hidden="true">${o.avatar}</span><div class="qd-exec-corpo">` +
    `<p class="qd-exec-l"><span class="qd-exec-txt"><strong>${esc(o.nome)}</strong> ${esc(verbo)}${meta ? ` <span class="qd-exec-meta">· ${esc(meta)}</span>` : ""}</span>` +
    `<time datetime="${tempo(e.criadoEm)}">${esc(o.hora(e.criadoEm))}</time></p>` +
    (frase ? `<p class="qd-exec-frase">${esc(frase.length > 160 ? `${frase.slice(0, 160)}…` : frase)}</p>` : "") + `${extra}</div></li>`;
}

function cardDoComentario(c: ComentarioDto, agente: AgenteDoQuadro, hora: (em: number) => string): string {
  const a = autorDoComentario(c, agente);
  const { cita, corpo } = citacaoDe(c.texto);
  const citaHtml = cita ? `<blockquote class="qd-com-cita"><span class="qd-com-cita-nome">${esc(cita.nome)}</span> ${esc(cita.trecho)}</blockquote>` : "";
  const acionou = c.acionados.length ? `<p class="qd-com-acao">acionou ${esc(c.acionados.join(", "))}</p>` : "";
  const nomeCurto = a.nome.replace(/ · no Linear$/, "");
  // 2026-11-10: a resposta numa thread fica recuada sob a raiz (a linha do tempo do celular já vem em ordem de tempo).
  return `<li class="qd-com${c.paiId ? " qd-com-resposta" : ""}" id="c-${esc(c.id)}" data-com="${esc(c.id)}" data-autor="${esc(nomeCurto)}"><span class="qd-com-av" aria-hidden="true">${a.avatar}</span><div class="qd-com-corpo">` +
    `<p class="qd-com-cab"><span class="qd-com-nome">${esc(a.nome)}</span><time datetime="${tempo(c.criadoEm)}">${esc(hora(c.criadoEm))}</time>` +
    `<button type="button" class="qd-link qd-com-resp" data-act="cel-responder" data-com="${esc(c.id)}">Responder<span class="qd-sr"> a ${esc(nomeCurto)}</span></button></p>` +
    `${citaHtml}<p class="qd-com-txt">${esc(corpo)}</p>${acionou}</div></li>`;
}

function pendente(p: NonNullable<DadosDosComentarios["pendente"]>): string {
  const est = p.falhou && p.duvida
    ? `<span class="qd-com-est">Sem resposta: pode ter saído. Confira a lista antes de mandar de novo.</span>`
    : p.falhou ? `<span class="qd-com-est">Não saiu.</span> <button type="button" class="qd-link qd-com-tentar" data-act="com-tentar">Tentar de novo</button>`
    : `<span class="qd-com-est">enviando</span>`;
  const { cita, corpo } = citacaoDe(p.texto);
  return `<li class="qd-com qd-com-pendente${p.falhou ? " qd-com-falhou" : ""}"><span class="qd-com-av" aria-hidden="true">${anel("V", "Você", true)}</span><div class="qd-com-corpo">` +
    `<p class="qd-com-cab"><span class="qd-com-nome">Você</span>${est}</p>${cita ? `<blockquote class="qd-com-cita"><span class="qd-com-cita-nome">${esc(cita.nome)}</span> ${esc(cita.trecho)}</blockquote>` : ""}<p class="qd-com-txt">${esc(corpo)}</p></div></li>`;
}

/** S6: as execuções do dia da mais recente ficam à vista; as de antes recolhem em "Ver N execuções anteriores". */
export function separarExecucoes(execs: readonly ExecucaoDto[]): { vistas: ExecucaoDto[]; antigas: ExecucaoDto[] } {
  const [atual] = execs;
  if (!atual) return { vistas: [], antigas: [] };
  const dia = new Date(atual.criadoEm).toDateString();
  const vistas: ExecucaoDto[] = [];
  const antigas: ExecucaoDto[] = [];
  for (const e of execs) (e === atual || new Date(e.criadoEm).toDateString() === dia ? vistas : antigas).push(e);
  return { vistas, antigas };
}

/** A linha do tempo única, por hora (a mais antiga em cima, a mais nova perto do composer). */
export function linhaDoTempo(v: VistaDaTarefaCelular): string {
  const { t, hora } = v;
  const cs = comColunas(v.q).colunas;
  const agora = v.agora ?? Date.now();
  const itens: Item[] = [];
  const add = (em: number, html: string, ordem = 0): void => { itens.push({ em, ordem, html }); };
  const movs = t.movimentos ?? [];
  const lotesDosMovimentos = new Set(movs.map((m) => m.loteId).filter(Boolean));
  if (v.coms?.criadaPor) add(t.criadoEm, evento(`${esc(v.coms.criadaPor)} criou a tarefa`, t.criadoEm, hora), -1);
  for (const l of v.coms?.atividade ?? []) {
    if (lotesDosMovimentos.has(l.loteId)) continue; // o movimento do mesmo lote já diz isso (com o Desfazer)
    add(l.criadoEm, evento(`<strong>${esc(l.quem)}</strong> ${esc(l.resumo.charAt(0).toLowerCase() + l.resumo.slice(1))}`, l.criadoEm, hora));
  }
  for (const m of movs) {
    const porque = porqueNaoDesfaz(t, m, cs);
    const desfeito = m.desfeitoEm !== null;
    const bt = !porque ? ` <button type="button" class="qd-link qd-hist-desfazer" data-act="tarefa-desfazer-movimento" data-id="${esc(m.id)}">Desfazer</button>` : "";
    add(m.criadoEm, evento(`${esc(fraseDoMovimento(m, cs))}${desfeito ? " <span class=\"qd-ev-desfeito\">(desfeito)</span>" : ""}`, m.criadoEm, hora, bt));
  }
  for (const e of v.historico ?? []) {
    // O movimento já conta a troca de coluna e de responsável (com o Desfazer): o histórico não repete.
    if ((e.campo === "status" || e.campo === "agente") && movs.some((m) => Math.abs(m.criadoEm - e.criadoEm) < 5000)) continue;
    const l = linhaDoHistorico(e, agora);
    add(e.criadoEm, evento(`<strong>${esc(l.quem)}</strong> ${esc(l.oque)}`, e.criadoEm, hora));
  }
  for (const l of t.linhas ?? []) add(l.criadoEm, evento(esc(l.texto), l.criadoEm, hora));
  let antigasHtml = "";
  const d = v.trabalho?.dados;
  if (d && !d.semAgente) {
    const quem = t.agenteId ? v.agente(t.agenteId) : null;
    const nome = quem?.nome ?? t.agenteNome ?? "Bot";
    const av = quem?.avatar ?? anel(nome.slice(0, 1), nome, false);
    const { vistas, antigas } = separarExecucoes(d.execucoes);
    const mostrar = v.trabalho!.anterioresAbertos ? d.execucoes : vistas;
    for (const e of mostrar) add(e.criadoEm, linhaDaExecucao(e, { nome, avatar: av, hora, agora, atual: e === d.execucoes[0], v: v.trabalho! }), 1);
    if (antigas.length) {
      antigasHtml = `<button type="button" class="qd-link qd-ativ-antigas" data-act="trab-anteriores" aria-expanded="${v.trabalho!.anterioresAbertos}">` +
        `${v.trabalho!.anterioresAbertos ? "Esconder" : "Ver"} ${antigas.length} ${antigas.length === 1 ? "execução anterior" : "execuções anteriores"}</button>`;
    }
  }
  for (const c of v.coms?.lista ?? []) add(c.criadoEm, cardDoComentario(c, v.agente, hora), 2);
  itens.sort((a, b) => a.em - b.em || a.ordem - b.ordem);
  const fim = v.coms?.pendente ? pendente(v.coms.pendente) : "";
  const estado = v.trabalho?.erro ? `<p class="qd-ativ-nota">Não consegui ler as execuções · <button type="button" class="qd-link" data-act="trab-reler">Tentar de novo</button></p>`
    : v.coms?.carga === "erro" ? `<p class="qd-ativ-nota">Não consegui ler os comentários.</p>`
    : !itens.length && !fim ? `<p class="qd-ativ-nota">${v.coms?.carga === "carregando" ? "Carregando…" : "Nada por aqui ainda."}</p>` : "";
  const aviso = v.trabalho?.aviso ? `<p class="qd-ativ-nota">${esc(v.trabalho.aviso)}</p>` : "";
  return `<section class="qd-ativ-cel" aria-labelledby="qd-ativ-tit"><h2 class="qd-t-sec" id="qd-ativ-tit">Atividade</h2>${antigasHtml}${estado}` +
    (itens.length || fim ? `<ol class="qd-linha-tempo">${itens.map((i) => i.html).join("")}${fim}</ol>` : "") + `${aviso}</section>`;
}

/** A bandeja de chips: rola de lado; cada chip é um botão que abre a folha dele (ids iguais aos do select do computador). */
export function bandejaDeChips(v: VistaDaTarefaCelular): string {
  const { t } = v;
  const cs = comColunas(v.q).colunas;
  const status = v.otimista?.status ?? t.status;
  const col = cs.find((c) => c.id === status);
  const nomeSt = col?.nome ?? NOME_DO_STATUS[status as Status] ?? status;
  const icSt = ICONE_DO_STATUS[col ? iconeDaColuna(col) : (status as Status)] ?? ICONE_DO_STATUS.afazer;
  const agenteId = v.otimista && "agente" in v.otimista ? v.otimista.agente ?? null : t.agenteId;
  const resp = agenteId ? v.agente(agenteId) ?? { avatar: anel((t.agenteNome ?? "?").slice(0, 1), t.agenteNome ?? "Bot"), nome: t.agenteNome ?? "Outro bot" } : null;
  const podeResp = !!v.responsaveis;
  const chip = (id: string, folha: string, conteudo: string, rotulo: string, vazio = false, desligado = false): string =>
    `<button type="button" class="qd-chip qd-chip-cel${vazio ? " qd-chip-vazio" : ""}" id="${id}" data-act="cel-folha" data-folha="${folha}" data-id="${esc(t.id)}" aria-haspopup="dialog" aria-label="${esc(rotulo)}"${desligado ? " disabled" : ""}>${conteudo}</button>`;
  const chips = [
    chip("qd-t-status", "status", `${icSt}<span>${esc(nomeSt)}</span>`, `Status: ${nomeSt}`),
    resp ? chip("qd-t-resp", "resp", `${avatar({ avatar: resp.avatar, nome: resp.nome, estado: t.execucao })}<span>${esc(resp.nome)}</span>`, `Responsável: ${resp.nome}`, false, !podeResp)
      : chip("qd-t-resp", "resp", `<span>Sem responsável</span>`, "Responsável: ninguém", true, !podeResp),
    PRAZO_DA_TAREFA ? chip("qd-t-prazo", "prazo", `<span>Sem prazo</span>`, "Prazo: nenhum", true) : "",
    t.branch ? chip("qd-t-branch", "branch", `${BRANCH}<span class="qd-chip-branch">${esc(t.branch)}</span>`, `Branch: ${t.branch}`) : "",
    chip("qd-t-ajustes", "ajustes", `${AJUSTES}<span>Ajustes</span>`, "Ajustes da tarefa"),
  ].join("");
  return `<div class="qd-bandeja" role="toolbar" aria-label="Propriedades da tarefa">${chips}</div>`;
}

/** O composer único: comentar (o comentário da pessoa aciona o responsável, NOD-417) ou responder a um comentário. */
export function composerDaTarefa(v: Pick<VistaDaTarefaCelular, "t" | "agente" | "respondendo">): string {
  const { t } = v;
  const id = `qd-com-${esc(t.id)}`;
  const nome = t.agenteId ? v.agente(t.agenteId)?.nome ?? t.agenteNome : null;
  const ph = nome ? `Comentar ou pedir para ${nome}…` : "Comentar…";
  const resp = v.respondendo
    ? `<div class="qd-cel-resp"><span>Respondendo a <strong>${esc(v.respondendo.nome)}</strong></span>` +
      `<button type="button" class="qd-cel-resp-x" data-act="cel-responder-sair" aria-label="Não responder a ${esc(v.respondendo.nome)}">✕</button></div>` : "";
  const thread = v.respondendo?.raiz ? ` data-responder="${esc(v.respondendo.raiz)}"` : "";
  return `<form class="qd-com-form qd-cel-composer" data-form="comentar-tarefa" data-id="${esc(t.id)}"${thread}>${resp}<div class="qd-cel-caixa">` +
    `<label class="qd-sr" for="${id}">${v.respondendo ? `Resposta a ${esc(v.respondendo.nome)}` : "Comentar"}</label>` +
    `<textarea id="${id}" class="qd-com-in" name="texto" rows="1" maxlength="${v.respondendo ? LIMITE_COMENTARIO - prefixoDaResposta(v.respondendo).length : LIMITE_COMENTARIO}" required placeholder="${esc(ph)}"></textarea>` +
    `<button type="submit" class="qd-com-bt qd-cel-enviar" aria-label="Enviar">${ENVIAR}</button></div></form>`;
}

export function tarefaAbertaCelular(v: VistaDaTarefaCelular): Html {
  const { t } = v;
  const codigo = codigoDaTarefa(t);
  const desc = t.descricao.trim() ? `<div class="qd-t-desc" data-ancora="desc">${esc(t.descricao)}</div>` : `<div class="qd-t-desc qd-t-desc-vazia" data-ancora="desc">Sem descrição.</div>`;
  const outro = esperandoOutro(t);
  const saiu = t.esperaPessoa && t.decide?.saiu ? `<p class="qd-t-saiu">Era de ${esc(t.decide.saiu)}, que saiu do quadro.</p>` : "";
  // ADR-162: a pergunta do bot ("Ada te perguntou"); responder aqui ou comentar dá no mesmo.
  // 2026-11-10 (pedido do Marlon, como o Multica): com os comentários na tela, a pergunta é o comentário do bot; aqui fica
  // só a linha discreta "Esperando você responder" (o composer responde). Sem eles, o bloco de antes (ADR-162).
  const esperaNaLinha = t.esperaPessoa && !outro && !!v.coms;
  const pergunta = esperaNaLinha ? `<p class="qd-t-espera"><span aria-hidden="true">🔔</span> Esperando você responder · a pergunta está nos comentários</p>`
    : t.pergunta && (t.esperaPessoa || t.status === "bloqueado")
    ? `<section class="qd-t-pergunta"><h2 class="qd-t-sec">${t.esperaPessoa ? (outro ? `Esperando ${esc(outro)}` : `${esc(t.agenteNome ?? "O bot")} te perguntou`) : "Bloqueada"}</h2><p class="qd-voce-frase">${esc(t.pergunta)}</p>${saiu}${t.esperaPessoa && outro ? "" : formResposta(t)}</section>` : "";
  const resposta = t.resposta ? `<h2 class="qd-t-sec">Sua resposta</h2><p class="qd-t-resposta">${esc(t.resposta)}</p>` : "";
  const naoSalvou = v.naoSalvou ? `<p class="qd-cel-erro" role="alert">${esc(fraseDoNaoSalvou(v, v.naoSalvou))} <button type="button" class="qd-link" data-act="cel-tentar">Tentar de novo</button></p>` : "";
  return confiar(`<article class="qd-tarefa qd-tarefa-cel" aria-labelledby="qd-t-tit" data-tarefa="${esc(t.id)}" data-titulo="${esc(`${codigo} · ${t.titulo}`)}">` +
    `<div class="qd-t-cab"><button type="button" class="qd-voltar" data-act="voltar-ao-quadro">${ICONE.voltar}<span>${esc(v.q.meta ?? "Quadro")}</span></button><span class="qd-t-sep" aria-hidden="true">/</span><span class="qd-id">${esc(codigo)}</span></div>` +
    `<div class="qd-t-principal"><h1 class="qd-t-tit" id="qd-t-tit" tabindex="-1">${esc(t.titulo)}</h1>${bandejaDeChips(v)}${secaoDeLabelEPrazoCelular(t, v.q, { agora: v.agora ?? Date.now(), fuso: v.fuso ?? fusoDoAparelho() })}` +
    `${naoSalvou}${desc}${pergunta}${resposta}${linhaDoTempo(v)}</div>` +
    `${composerDaTarefa(v)}</article>`);
}
