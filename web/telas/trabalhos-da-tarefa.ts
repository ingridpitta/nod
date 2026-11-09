/**
 * NOD-418 (definido em 2026-11-02, direção C "só o atual"): o trabalho da tarefa aberta. Uma linha do trabalho atual
 * (o selo, o estado em texto, a última frase do agente), "› N passos" abre o log ao vivo e "› N anteriores" os trabalhos
 * de antes. As ações são links de texto: rodando, só Cancelar; esperando (a pessoa, o CI), Cancelar e Repetir; Repetir
 * no falhou, no concluído e na tarefa Bloqueada.
 * Tudo em cinza; vermelho só no ⊗ da falha. Todo texto de fora (frase, motivo, recado, rótulo de ferramenta) passa por `esc`.
 */
import type { EstadoExecucao, ExecucaoDto, ExecucoesDaTarefa, OrigemExecucao } from "../../src/contracts/quadro-execucoes.ts";
import { linhasDoResumo, SEM_NOME_DA_FERRAMENTA, type AtividadeTurno } from "../lib/atividade.ts";
import { esc } from "../lib/escape.ts";

/** O teto do recado (o RECADO_MAX do contrato; a web não importa valor de src). */
export const RECADO_MAX = 4000;
/** As novas tentativas sozinhas (TENTATIVAS_AUTOMATICAS_MAX do contrato). */
const TENTATIVAS_MAX = 2;

export const NOME_DO_ESTADO: Readonly<Record<EstadoExecucao, string>> = {
  fila: "na fila",
  rodando: "rodando",
  concluido: "concluído",
  falhou: "falhou",
  cancelado: "cancelado",
};

/** O selo de cada estado (cinza; o ⊗ da falha é o único vermelho, no CSS). */
export const SELO_DO_ESTADO: Readonly<Record<EstadoExecucao, string>> = {
  fila: "○",
  rodando: "◐",
  concluido: "✓",
  falhou: "⊗",
  cancelado: "⊘",
};

const NOME_DA_ORIGEM: Readonly<Record<OrigemExecucao, string>> = {
  inicio: "Início",
  resposta: "Sua resposta",
  comentario: "Comentário",
  repetir: "Repetir",
  automatica: "Nova tentativa",
  recado: "Seu recado",
};

export const vivo = (e: Pick<ExecucaoDto, "estado">): boolean => e.estado === "rodando" || e.estado === "fila";

export type VistaDoTrabalho = {
  tarefaId: string;
  /** ADA-4: o recado que foi e não voltou (ou que não saiu). */
  recadoPendente?: { texto: string; falhou: boolean; motivo?: "duvida" | "recusado" } | null;
  /** null = lendo. */
  dados: ExecucoesDaTarefa | null;
  erro: boolean;
  /** A tarefa está Bloqueada (ou em "Precisa de você" com a coluna de antes guardada): Repetir aparece e a devolve. */
  bloqueada: boolean;
  /** O bot responsável (para "Ver na conversa" em outra conversa). */
  agenteId: string | null;
  /** A conversa à vista atrás do quadro: "Ver na conversa" nela só troca para a Conversa. */
  conversaAtual: string | null;
  atividade: AtividadeTurno | undefined;
  passosAbertos: boolean;
  anterioresAbertos: boolean;
  aviso: string | null;
  ocupado: boolean;
};

/** A frase do anúncio de estado (a mesma palavra da linha do trabalho). */
export const anuncioDoTrabalho = (e: Pick<ExecucaoDto, "numero" | "estado" | "esperando">): string =>
  `Trabalho #${e.numero}: ${e.esperando ? "esperando" : NOME_DO_ESTADO[e.estado] ?? e.estado}`;

const ultimaLinha = (t: string | null | undefined): string => (t ?? "").trim().split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";

/** Os passos do turno atual (as mesmas linhas da conversa), desde que a tarefa abriu. */
export function passosDoTrabalho(a: AtividadeTurno | undefined, parado: boolean) {
  return linhasDoResumo(a?.acoes ?? [], parado);
}

/** O pedaço que o frame troca sozinho: o toggle "› N passos" e o log. Não tem campo, o rascunho do recado fica. */
export function logDoTrabalho(e: ExecucaoDto, a: AtividadeTurno | undefined, aberto: boolean): string {
  const linhas = passosDoTrabalho(a, !vivo(e));
  if (!linhas.length) return e.estado === "rodando" ? `<p class="qd-trab-nota">Começando… os passos aparecem aqui.</p>` : "";
  const toggle = `<button type="button" class="qd-link qd-trab-tg" data-act="trab-passos" aria-expanded="${aberto}">› ${linhas.length} ${linhas.length === 1 ? "passo" : "passos"}</button>`;
  if (!aberto) return toggle;
  const lis = linhas.slice(-40).map((l) => {
    const rotulo = l.emUso && l.emUso !== SEM_NOME_DA_FERRAMENTA.texto ? l.emUso : l.rotulo;
    return `<li class="qd-trab-passo" data-estado="${l.estado}">${esc(rotulo)}${l.vezes && l.vezes > 1 ? ` <span class="qd-n">×${l.vezes}</span>` : ""}</li>`;
  }).join("");
  return `${toggle}<ol class="qd-trab-passos">${lis}</ol>`;
}

function linhaDoTrabalho(e: ExecucaoDto, hora: (em: number) => string): string {
  const tentativa = e.origem === "automatica" && e.tentativa ? ` · Nova tentativa ${e.tentativa} de ${TENTATIVAS_MAX}` : e.numero > 1 ? ` · ${esc(NOME_DA_ORIGEM[e.origem] ?? e.origem)}` : "";
  return `<span class="qd-trab-selo" data-estado="${e.estado}" aria-hidden="true">${SELO_DO_ESTADO[e.estado]}</span>` +
    `<span class="qd-trab-est">#${e.numero} · ${esc(e.esperando ? "esperando" : NOME_DO_ESTADO[e.estado] ?? e.estado)}${tentativa}</span>` +
    `<time class="qd-trab-hora" datetime="${new Date(e.criadoEm).toISOString()}">${esc(hora(e.criadoEm))}</time>`;
}

/**
 * A nota do recado diz para onde ele vai de verdade: o trabalho vivo mais recente que roda (pode ser o de um comentário,
 * não o que a tarefa guarda). Só esperando (a pessoa, o CI): entra quando ele voltar a rodar.
 */
function notasDosRecados(d: ExecucoesDaTarefa): string {
  const alvo = d.execucoes.find((e) => vivo(e) && !e.esperando);
  // Revisão 5 do PR #625: nada vivo (Backlog, o Parar de fora) = o recado fica guardado; nada abre sozinho.
  const quando = alvo?.estado === "rodando" ? "entra no próximo passo"
    : alvo ? "entra quando o trabalho começar"
    : d.execucoes.some(vivo) ? "entra quando o trabalho voltar a rodar" : "fica guardado: vai no próximo trabalho (Repetir ou início)";
  return d.recados.map((r) => {
    const t = `“${esc(r.texto.length > 80 ? `${r.texto.slice(0, 80)}…` : r.texto)}”`;
    if (r.entregue) return `<p class="qd-trab-nota">Leu seu recado ${t}</p>`;
    return `<p class="qd-trab-nota">Seu recado ${t} · ${quando}</p>`;
  }).join("");
}

/** ADA-232: o "Volto quando…" do trabalho que marcou a volta (a CI do PR, a hora ou só o motivo). */
export function fraseDaVolta(v: NonNullable<ExecucaoDto["volta"]>, hora: (em: number) => string): string {
  const pr = v.prUrl ? (/\/pull\/(\d+)/.exec(v.prUrl)?.[1] ?? null) : null;
  const quando = v.quando === "ci" ? `Volto quando a CI ${pr ? `do PR #${pr}` : "do PR"} terminar` : v.em !== null ? `Volto às ${hora(v.em)}` : "Volto depois";
  return v.motivo ? `${quando} · ${v.motivo}` : quando;
}

export function secaoDoTrabalho(v: VistaDoTrabalho, hora: (em: number) => string): string {
  const titulo = `<h2 class="qd-t-sec" id="qd-trab-tit">Execuções</h2>`;
  const abre = `<section class="qd-trab" aria-labelledby="qd-trab-tit" data-tarefa="${esc(v.tarefaId)}">${titulo}`;
  if (v.erro) return `${abre}<p class="qd-trab-nota">Não consegui ler os trabalhos · <button type="button" class="qd-link" data-act="trab-reler">Tentar de novo</button></p></section>`;
  if (!v.dados) return `${abre}<p class="qd-trab-nota">Lendo…</p></section>`;
  const d = v.dados;
  if (d.semAgente) return `${abre}<p class="qd-trab-nota">Sem agente responsável</p></section>`;
  const [atual, ...anteriores] = d.execucoes;
  const des = v.ocupado ? " disabled" : "";
  let corpo = "";
  if (!atual) corpo = `<p class="qd-trab-nota">Nenhum trabalho ainda</p>`;
  else {
    const frase = atual.estado === "falhou" ? (atual.motivo ?? "O trabalho falhou.") : ultimaLinha(atual.ultimaFrase);
    const fraseHtml = frase ? `<p class="qd-trab-frase">${esc(frase.length > 280 ? `${frase.slice(0, 280)}…` : frase)}</p>` : "";
    const acoes: string[] = [];
    if (vivo(atual)) {
      acoes.push(`<button type="button" class="qd-link" data-act="trab-cancelar"${des}>Cancelar</button>`);
      // Esperando a pessoa ou o CI: o Repetir cancela a espera e abre outro trabalho.
      if (atual.esperando) acoes.push(`<button type="button" class="qd-link" data-act="trab-repetir"${des}>Repetir</button>`);
    } else {
      if (atual.estado === "concluido" && d.conversaId) {
        acoes.push(d.conversaId === v.conversaAtual
          ? `<button type="button" class="qd-link" data-act="qc-abrir-conversa">Ver na conversa</button>`
          : `<button type="button" class="qd-link" data-act="abrir-conversa" data-conversa="${esc(d.conversaId)}" data-agente="${esc(v.agenteId ?? "")}">Ver na conversa</button>`);
      }
      if (atual.estado === "falhou" || atual.estado === "concluido" || v.bloqueada) acoes.push(`<button type="button" class="qd-link" data-act="trab-repetir"${des}>Repetir</button>`);
    }
    // Revisão 5 do PR #625: a nova tentativa sozinha agendada (depois da queda), com a hora.
    const agenda = atual.novaTentativaEm !== null && !vivo(atual)
      ? `<p class="qd-trab-nota">Nova tentativa sozinha às <time datetime="${new Date(atual.novaTentativaEm).toISOString()}">${esc(hora(atual.novaTentativaEm))}</time></p>` : "";
    // Sem hora (em null) é a espera de um comando de fundo: termina sozinha, o servidor recusa o acordar.
    const acordar = atual.volta?.em != null ? `<span aria-hidden="true"> · </span><button type="button" class="qd-link" data-act="trab-acordar"${des}>Acordar agora</button>` : "";
    const volta = atual.volta ? `<p class="qd-trab-nota qd-trab-volta">${esc(fraseDaVolta(atual.volta, hora))}${acordar}</p>` : "";
    const log = `<div class="qd-trab-log" data-trabalho="${esc(atual.id)}">${logDoTrabalho(atual, v.atividade, v.passosAbertos)}</div>`;
    corpo = `<div class="qd-trab-atual" data-estado="${atual.estado}"><p class="qd-trab-linha">${linhaDoTrabalho(atual, hora)}</p>${fraseHtml}${volta}${agenda}${log}` +
      (acoes.length ? `<p class="qd-trab-acoes">${acoes.join(`<span aria-hidden="true"> · </span>`)}</p>` : "") + `</div>`;
  }
  if (anteriores.length) {
    corpo += `<button type="button" class="qd-link qd-trab-tg" data-act="trab-anteriores" aria-expanded="${v.anterioresAbertos}">› ${anteriores.length} ${anteriores.length === 1 ? "anterior" : "anteriores"}</button>`;
    if (v.anterioresAbertos) {
      corpo += `<ol class="qd-trab-anteriores">${anteriores.map((e) => {
        const f = e.estado === "falhou" ? e.motivo : ultimaLinha(e.ultimaFrase);
        return `<li data-estado="${e.estado}"><p class="qd-trab-linha">${linhaDoTrabalho(e, hora)}</p>${f ? `<p class="qd-trab-frase">${esc(f.length > 160 ? `${f.slice(0, 160)}…` : f)}</p>` : ""}</li>`;
      }).join("")}</ol>`;
    }
  }
  const recado = `<form class="qd-trab-form" data-form="recado-trabalho" data-id="${esc(v.tarefaId)}"><label class="qd-sr" for="qd-trab-recado">Recado ao agente</label>` +
    `<textarea id="qd-trab-recado" class="qd-com-in" name="recado" rows="1" maxlength="${RECADO_MAX}" required placeholder="${atual && vivo(atual) ? "Recado ao agente (entra no próximo passo)" : "Recado ao agente (vira um trabalho novo)"}"></textarea>` +
    `<button type="submit" class="qd-com-bt"${des}>Mandar</button></form>`;
  // Revisão 5 do PR #625: nenhuma região role=status aqui (o bloco é recriado a cada desenho e o leitor de tela não lê
  // a região nova). O anúncio do estado e do aviso vai à região persistente do quadro (#qd-trab-anuncio).
  const aviso = v.aviso ? `<p class="qd-trab-nota">${esc(v.aviso)}</p>` : "";
  const p = v.recadoPendente;
  const pend = p ? `<p class="qd-trab-nota qd-trab-pend">Seu recado <span class="qd-trab-pend-txt">“${esc(p.texto.length > 80 ? `${p.texto.slice(0, 80)}…` : p.texto)}”</span> · ` +
    (p.falhou && p.motivo === "duvida" ? "sem resposta: pode ter saído" : p.falhou && p.motivo === "recusado" ? "não entrou" : p.falhou ? `não saiu · <button type="button" class="qd-link" data-act="trab-recado-tentar">Tentar de novo</button>` : "enviando") + `</p>` : "";
  // Revisão 1 do #646: o aviso (o porquê) fica à vista também com o recado que não saiu.
  return `${abre}${corpo}${notasDosRecados(d)}${pend}${aviso}${recado}</section>`;
}
