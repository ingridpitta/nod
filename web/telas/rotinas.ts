import type { Estado } from "../estado/reducer.ts";
import { avatarAgente, botao, dataHora, esc } from "../lib/render.ts";
import { ATALHO_SEMPRE_LIGADA, botaoDaParada, desdeDaParada, linhaDaEspera, linhaNaoRodaram, linhaOndeRoda, linhaPerguntaPendente, motivoDaExecucao, rotuloDoDesfecho, rotuloExecucao, rotuloVerEspera, TAG_ESPERANDO, tagDaParada, tagEsperaDaCota, tagParadaPergunta } from "../lib/execucao.ts";
import { interpolar } from "../lib/relogio.ts";

/**
 * definido em 2026-10-15 (pacote A3): a execução anterior ainda aberta faz o agendador pular os horários seguintes
 * (ADR-045). O servidor só manda o número a partir de 3 e só na rotina ativa (src/domain/janelas-puladas.ts); a linha
 * diz quantos e por quê, embaixo da próxima execução.
 */
export function avisoDasJanelasPuladas(n: number | undefined): string {
  if (n === undefined || n < 3) return "";
  return `<div class="rt-linha rt-aviso" role="status">${n} horários pulados: a execução anterior ainda não saiu</div>`;
}

/**
 * NOD-89 (corte 1): a frase "O nod precisa estar aberto…" sai quando nenhuma rotina depende do Mac; quando alguma depende,
 * o atalho "Conectar uma máquina sempre ligada" vem aqui, uma vez na tela (as linhas "Roda em" ficam só com o texto).
 * Sem `ondeRoda` em nenhuma (modo local, só rotinas de outros), a frase de sempre.
 */
export function introDasRotinas(rotinas: Estado["rotinas"]): string {
  const comOnde = rotinas.filter((r) => r.ondeRoda);
  const dependem = comOnde.some((r) => r.ondeRoda?.dependeDoMac);
  if (comOnde.length && !dependem) return '<p class="intro">Seu bot cuida do que se repete.</p>';
  return `<p class="intro">Seu bot cuida do que se repete. O nod precisa estar aberto para executar os agendamentos.${dependem ? ` ${ATALHO_SEMPRE_LIGADA}` : ""}</p>`;
}

/**
 * Rotinas (E7): cada uma com a PRÓXIMA execução no fuso nomeado (o servidor calcula, ADR-011), o
 * gate de aprovação, pausar/ativar e as últimas 20 execuções com desfecho tipado — passou_em_branco ≠
 * falhou (E7.5). Rotinas nascem por texto na conversa (criar_rotina → proposta → decisão em Sua vez).
 */
export function renderRotinas(estado: Estado): string {
  const linhas = estado.rotinas
    .map(({ rotina: r, proximaExecucao, bloqueio, espera, perguntaPendente, esperaDaCota, janelasPuladas, ondeRoda }) => {
      const a = estado.frota?.agentes.find((x) => x.id === r.agenteId);
      const exec = estado.execucoes[r.id];
      // definido em 2026-09-24 (emenda da ADR-044): a janela parada lê "parada (sem acesso)", sem o motivo cru ao lado.
      const rotulo = (e: NonNullable<typeof exec>[number]) => (e.desfecho === "bloqueada" || e.desfecho === "nao_rodou" ? rotuloExecucao(e, r.fusoIana) : rotuloDoDesfecho(e.desfecho));
      const motivo = (e: NonNullable<typeof exec>[number]) => (e.motivo && e.desfecho !== "bloqueada" && e.desfecho !== "nao_rodou" ? ` · ${esc(motivoDaExecucao(e) ?? e.motivo)}` : "");
      const execucoes = exec
        ? exec.length
          ? `<ul class="execucoes">${exec.map((e) => `<li class="exec exec-${esc(e.desfecho)}"><b>${esc(rotulo(e))}</b> · agendada ${esc(dataHora(e.instanteAgendado, r.fusoIana))} · registrada ${esc(dataHora(e.em, r.fusoIana))}${motivo(e)}</li>`).join("")}</ul>`
          : '<p class="mudo">nunca executou</p>'
        : "";
      return `<li class="rotina rotina-${esc(r.estado)}${bloqueio || perguntaPendente ? " rotina-parada" : ""}" data-rotina="${esc(r.id)}">
        <div class="rt-cab">${a ? avatarAgente(a, "sm") : ""}<b>${esc(a?.nome ?? "agente")}</b> · <code>${esc(r.cron)}</code> (${esc(r.fusoIana)}) <span class="tag ${r.estado === "ativa" ? "tag-ok" : "tag-cinza"}">${esc(r.estado)}</span>${bloqueio ? tagDaParada(bloqueio) : perguntaPendente ? tagParadaPergunta(perguntaPendente) : esperaDaCota ? tagEsperaDaCota(esperaDaCota, r.fusoIana, estado.agora) : ""}${r.estado === "ativa" && !bloqueio && !perguntaPendente && !esperaDaCota && espera ? TAG_ESPERANDO : ""}${r.exigeAprovacao ? '<span class="tag tag-ambar" title="efeito externo só por item aprovado (E7.3)">gate de aprovação ligado</span>' : ""}</div>
        <div class="rt-linha"><b>próxima execução:</b> ${esc(dataHora(proximaExecucao, r.fusoIana))} (${esc(r.fusoIana)}) · ${esc(interpolar(proximaExecucao, estado.agora))}</div>
        ${linhaOndeRoda(ondeRoda)}
        ${avisoDasJanelasPuladas(r.estado === "ativa" && !espera ? janelasPuladas : undefined)}
        <div class="rt-linha"><b>instrução:</b> ${esc(r.instrucao)}</div>
        <div class="rt-linha mudo">fonte: ${esc(r.fonte)} · entregável: ${esc(r.entregavel)} · limites: ${esc(r.limitesAprovacao)} · sem dado: ${esc(r.politicaSemDado)}</div>
        ${bloqueio ? `<div class="rt-linha">${esc(`Parada ${desdeDaParada(bloqueio, estado.agora)}.`)}</div>${linhaNaoRodaram(bloqueio, estado.agora)}` : perguntaPendente ? linhaPerguntaPendente(perguntaPendente, estado.agora, r.fusoIana) : ""}
        ${r.estado === "ativa" && !bloqueio && !perguntaPendente ? linhaDaEspera(espera ?? null, estado.agora, r.fusoIana) : ""}
        <div class="acoes">
          ${bloqueio ? botaoDaParada(bloqueio) : perguntaPendente ? botao("ver-pergunta-da-rotina", rotuloVerEspera(perguntaPendente), { classe: "pri", id: perguntaPendente.decisaoId, dados: { conversa: r.conversaId, agente: r.agenteId } }) : ""}
          ${r.estado === "ativa" ? botao("pausar-rotina", "Pausar", { id: r.id }) : botao("ativar-rotina", "Ativar", { classe: bloqueio || perguntaPendente ? "" : "pri", id: r.id })}
          ${botao("executar-rotina", "Testar agora", { id: r.id, dados: { agente: r.agenteId }, desabilitado: estado.ocupado })}
          ${botao("ver-execucoes", exec ? "atualizar execuções" : "últimas 20 execuções", { id: r.id })}
          ${botao("abrir-conversa", "conversa", { dados: { conversa: r.conversaId, agente: r.agenteId } })}
        </div>
        ${execucoes}
      </li>`;
    })
    .join("");
  return `<section class="tela tela-rotinas">
    <header class="tela-cab"><h1>Rotinas</h1><span class="chip">${estado.rotinas.length} rotinas</span>${botao("navegar", "+ Nova rotina", { classe: "pri", dados: { tela: "nova-rotina" } })}</header>
    ${introDasRotinas(estado.rotinas)}
    ${estado.rotinas.length ? `<ul class="lista">${linhas}</ul>` : '<p class="mudo">Nenhuma rotina. Diga na conversa do bot, por exemplo: «todo dia útil às 8:00 de São Paulo poste aqui um resumo dos PRs abertos». O bot propõe; você confirma em Sua vez.</p>'}
  </section>`;
}
