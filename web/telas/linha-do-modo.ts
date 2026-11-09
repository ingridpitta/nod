import type { AcaoDoModoNaFala } from "../../src/contracts/acoes-do-modo.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import { diaLocal } from "../lib/atividade-do-bot.ts";
import { esc, textoComCodigo } from "../lib/render.ts";

/**
 * A linha discreta embaixo da fala (definido em 2026-10-19, plano dos modos de aprovação, PR 6; telas Y1 e Y2 do
 * protótipo aprovado): "🔑 Usou o token do GitHub do seu Mac · ver na Atividade". No "Ignorar todas as aprovações" nada
 * pede a pessoa — nem a credencial —, e o que mais importa do que rodou sem ela fica à vista ali, sem virar mensagem.
 * As frases vêm prontas do servidor (`acoesDoModo` da conversa, `fraseNaFala`); aqui só onde a linha entra e como várias
 * viram uma.
 *
 * - **onde**: na última fala do bot do mesmo turno que está à vista (a mesma âncora do progresso das frentes e do cartão).
 *   Sem fala à vista (o turno de uma task, cujas falas moram na tela dela), não há linha — a Atividade tem tudo;
 * - **várias**: a mesma frase repetida (o `gh auth token` três vezes) conta uma; frases diferentes viram "… e mais 2 ações
 *   sem perguntar". A credencial vem antes do arriscado;
 * - **ver na Atividade**: abre a Atividade do bot no dia da ação, no filtro "Sem aprovação" (tela Y3).
 *
 * revisto em 2026-10-26 (PR 4 dos modos de aprovação, telas A1 e A2): o que o revisor do Automático liberou ganha a sua
 * linha, com o escudo: "Revisor liberou o push forçado na feat/login: você pediu · ver" (a frase da ação, PR 4b; o comando
 * sem frase em fonte de código: "Revisor liberou ⟨npm run deploy⟩: você pediu"); várias ações diferentes
 * no turno viram "Revisor liberou 3 ações · ver". O "ver" abre o mesmo filtro, onde cada liberação tem o motivo e o
 * "Devia ter perguntado", e conta na telemetria das linhas (`revisor`).
 */

/** id da mensagem-âncora → as ações dos turnos dela. `visivel` diz se a mensagem aparece como fala na tela. */
export function ancorasDoModo(mensagens: readonly Mensagem[], acoes: Readonly<Record<string, readonly AcaoDoModoNaFala[]>> | undefined, visivel: (m: Mensagem) => boolean): Map<string, AcaoDoModoNaFala[]> {
  const ancoras = new Map<string, AcaoDoModoNaFala[]>();
  if (!acoes) return ancoras;
  const ultimaDoTurno = new Map<string, string>();
  for (const m of mensagens) {
    if (m.turnoId && m.kind === "texto" && m.autoria.autor_tipo === "agente" && visivel(m)) ultimaDoTurno.set(m.turnoId, m.id);
  }
  for (const [turnoId, doTurno] of Object.entries(acoes)) {
    const alvo = ultimaDoTurno.get(turnoId);
    if (!alvo || doTurno.length === 0) continue;
    ancoras.set(alvo, [...(ancoras.get(alvo) ?? []), ...doTurno]);
  }
  return ancoras;
}

/** A frase da linha do revisor: a da ação (a mesma repetida conta uma), ou "Revisor liberou N ações". */
export function textoDaLinhaDoRevisor(acoes: readonly AcaoDoModoNaFala[]): string {
  const frases = [...new Set(acoes.map((a) => a.frase))];
  if (frases.length <= 1) return frases[0] ?? "";
  return `Revisor liberou ${new Set(acoes.map((a) => a.id)).size} ações`;
}

/** A frase da linha do total: uma ação, ou a primeira e "e mais N ações sem perguntar". */
export function textoDaLinhaDoModo(acoes: readonly AcaoDoModoNaFala[]): string {
  const frases = [...new Set(ordenadas(acoes).map((a) => a.frase))];
  const [primeira = "", ...resto] = frases;
  if (resto.length === 0) return primeira;
  return `${primeira} e mais ${resto.length} ${resto.length === 1 ? "ação" : "ações"} sem perguntar`;
}

/** A credencial antes do arriscado; dentro de cada um, na ordem em que rodaram. */
function ordenadas(acoes: readonly AcaoDoModoNaFala[]): AcaoDoModoNaFala[] {
  const peso = (a: AcaoDoModoNaFala) => (a.gatilho === "credencial" ? 0 : 1);
  return [...acoes].sort((x, y) => peso(x) - peso(y) || x.em - y.em);
}

const svg = (corpo: string) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
const ESCUDO = '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>';
/**
 * Os escudos do revisor, como nos protótipos (revisto em 2026-10-26 no QA do PR 4): na linha "Revisor liberou" (A1), o
 * escudo com o visto, no verde de "deu certo"; no cartão compacto (A3, web/telas/cartao-revisor.ts), o escudo com a
 * exclamação, no azul do cartão.
 */
export const ICONE_ESCUDO_LIBEROU = svg(`${ESCUDO}<path d="m9 12 2 2 4-4"/>`);
export const ICONE_ESCUDO_PEDE = svg(`${ESCUDO}<path d="M12 8v4"/><path d="M12 16h.01"/>`);
/** A chave do protótipo (Y1, Y2); no arriscado sem credencial, o triângulo do modo total. */
const ICONE_CHAVE = svg('<circle cx="8" cy="15" r="4"/><path d="m10.85 12.15 7.15-7.15"/><path d="m15 8 3 3"/><path d="m18 5 2 2"/>');
const ICONE_ARRISCADO = svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>');

/**
 * A linha do revisor (A1, A2): o escudo, a frase e "ver", que abre a Atividade no dia, no filtro "Sem aprovação". A chave
 * da telemetria é o turno: a linha conta uma vez por turno, e o "ver" conta como aberta.
 */
function linhaDoRevisor(acoes: readonly AcaoDoModoNaFala[], agenteId: string): string {
  const texto = textoDaLinhaDoRevisor(acoes);
  const primeira = [...acoes].sort((x, y) => x.em - y.em)[0];
  const dia = diaLocal(primeira?.em ?? Date.now());
  const chave = `revisor:${primeira?.turnoId ?? ""}`;
  // PR 4b: uma ação só, e o comando sem frase — o trecho que o servidor marcou vai em fonte de código.
  const codigo = new Set(acoes.map((a) => a.frase)).size === 1 ? acoes.find((a) => a.codigo)?.codigo : undefined;
  return `<div class="linha-modo linha-revisor">${ICONE_ESCUDO_LIBEROU}<span class="linha-modo-txt">${textoComCodigo(texto, codigo)}</span><span class="linha-modo-sep" aria-hidden="true">·</span><button type="button" class="linha-modo-ver" data-act="ver-sem-aprovacao" data-agente="${esc(agenteId)}" data-dia="${esc(dia)}" data-linha-tipo="revisor" data-linha-chave="${esc(chave)}" aria-label="${esc(`Ver na Atividade: ${texto}`)}">ver</button></div>`;
}

/** O HTML da linha (ou das duas: a do revisor e a do total, se o modo mudou no meio do turno). `agenteId`: o bot da conversa (a Atividade é dele). */
export function renderLinhaDoModo(todas: readonly AcaoDoModoNaFala[], agenteId: string): string {
  const doRevisor = todas.filter((a) => a.gatilho === "revisor");
  const acoes = todas.filter((a) => a.gatilho !== "revisor");
  const revisor = doRevisor.length ? linhaDoRevisor(doRevisor, agenteId) : "";
  if (acoes.length === 0) return revisor;
  const texto = textoDaLinhaDoModo(acoes);
  const primeira = ordenadas(acoes)[0];
  const icone = primeira?.gatilho === "credencial" ? ICONE_CHAVE : ICONE_ARRISCADO;
  const dia = diaLocal(primeira?.em ?? Date.now());
  return `<div class="linha-modo">${icone}<span class="linha-modo-txt">${esc(texto)}</span><span class="linha-modo-sep" aria-hidden="true">·</span><button type="button" class="linha-modo-ver" data-act="ver-sem-aprovacao" data-agente="${esc(agenteId)}" data-dia="${esc(dia)}" aria-label="${esc(`Ver na Atividade: ${texto}`)}">ver na Atividade</button></div>${revisor}`;
}
