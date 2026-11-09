import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { MotivoRecomeco } from "../../src/contracts/turno.ts";
import { esc } from "./render.ts";

/**
 * NOD-312: quando o bot recomeça sem a memória da sessão (o servidor grava `turnos.motivo_recomeco` no turno; a listagem
 * traz `Mensagem.motivoRecomeco` em cada fala dele). Recomeçar é informação, não erro: nada de âmbar nem de vermelho.
 * - carona "· relê o necessário" na linha da troca (conta, IA) entre a fala da pessoa e a 1ª fala do turno. No caso
 *   encadeado (troca de conta e de IA no mesmo pedido), uma carona só, na linha da troca de IA;
 * - sem linha onde pegar carona: a marca "↺ recomeçou" ao lado da hora da 1ª fala, para qualquer motivo (a IA ou a
 *   conta que volta sozinha não deixa linha). A marca fica no histórico.
 */
export type AlvoDoRecomeco = { tipo: "carona" | "marca"; motivo: MotivoRecomeco; nomeDoBot: string | null };

/** A lista do contrato, repetida aqui (a web só importa tipos de src/contracts, ADR-018); o Record trava a exaustão. */
const MOTIVOS: Record<MotivoRecomeco, true> = { troca_de_conta: true, troca_de_ia: true, troca_de_maquina: true, sessao_recusada: true };
export function ehMotivoRecomeco(v: unknown): v is MotivoRecomeco {
  return typeof v === "string" && Object.hasOwn(MOTIVOS, v);
}

const LINHAS_DE_CONTA = new Set(["conta_trocada", "conta_seguiu", "conta_escolhida"]);

/**
 * Que troca a linha do chat descreve: "ia", "conta" ou null (não é linha de troca). O cartão "Uma IA só" já decidido
 * (revisão 2 do #550) vira uma linha de desfecho: "outra_ia" é troca de IA; "conta" é troca de conta; "levar" e
 * "expirou" são de conta quando havia conta de origem (seguiu noutra conta da mesma IA), senão de IA.
 */
function trocaDaLinha(m: Mensagem): "ia" | "conta" | null {
  const p = m.payload;
  if (!p) return null;
  if (p.kind === "ia_trocada") return "ia";
  if (LINHAS_DE_CONTA.has(p.kind)) return "conta";
  if (p.kind !== "troca_de_ia" || !p.decisao) return null;
  if (p.decisao === "outra_ia") return "ia";
  if (p.decisao === "conta") return "conta";
  if (p.decisao === "levar" || p.decisao === "expirou") return p.contaDe ? "conta" : "ia";
  return null;
}

/**
 * Por id de mensagem, onde vai a carona ou a marca. Pura: só lê as mensagens, em ordem cronológica. `noChat`: a linha
 * aparece no chat (no chat limpo, as trocas moram na Atividade — revisão 3 do #550); oculta, não leva carona.
 */
export function alvosDoRecomeco(mensagens: readonly Mensagem[], nomeDe: (agenteId: string) => string | null = () => null, noChat: (m: Mensagem) => boolean = () => true): Map<string, AlvoDoRecomeco> {
  const alvos = new Map<string, AlvoDoRecomeco>();
  const turnosVistos = new Set<string>();
  for (let i = 0; i < mensagens.length; i++) {
    const m = mensagens[i]!;
    // Revisão 8: um motivo que esta web não conhece (servidor mais novo, web em cache) não vira "undefined" na tela.
    const motivo = ehMotivoRecomeco(m.motivoRecomeco) ? m.motivoRecomeco : null;
    if (!motivo || m.kind !== "texto" || m.autoria.autor_tipo !== "agente") continue;
    // Uma vez por turno: só a 1ª fala dele (as mensagens do mesmo turno trazem o mesmo motivo).
    const chave = m.turnoId ?? m.id;
    if (turnosVistos.has(chave)) continue;
    turnosVistos.add(chave);
    const nomeDoBot = nomeDe(m.autoria.autor_id);
    let deIa: Mensagem | null = null;
    let deConta: Mensagem | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const a = mensagens[j]!;
      if (a.autoria.autor_tipo === "pessoa" && a.kind === "texto") break;
      if (a.kind === "texto" && a.autoria.autor_tipo === "agente") break;
      const troca = noChat(a) ? trocaDaLinha(a) : null;
      if (troca === "ia" && !deIa) deIa = a;
      else if (troca === "conta" && !deConta) deConta = a;
    }
    // Revisão 2: a carona só vai na linha que descreve o motivo — na troca de IA, a linha de IA (no encadeado, só ela)
    // ou a de conta (a conta que seguiu noutra IA); na troca de conta, só a de conta. Máquina e sessão recusada não
    // têm linha. Revisão 1: sem linha, a marca, para qualquer motivo (a IA ou a conta que volta sozinha não deixa linha).
    const linha = motivo === "troca_de_ia" ? (deIa ?? deConta) : motivo === "troca_de_conta" ? deConta : null;
    if (linha) alvos.set(linha.id, { tipo: "carona", motivo, nomeDoBot });
    else alvos.set(m.id, { tipo: "marca", motivo, nomeDoBot });
  }
  return alvos;
}

/** As explicações abertas (por id de mensagem): sobrevivem ao re-render da timeline, como o `details[data-disclosure]`. */
const abertas = new Set<string>();
export function explicacaoAberta(id: string): boolean {
  return abertas.has(id);
}
export function alternarExplicacao(id: string, aberta?: boolean): boolean {
  const vai = aberta ?? !abertas.has(id);
  if (vai) abertas.add(id);
  else abertas.delete(id);
  return vai;
}

/** Ícones de recomeço (↺) e de troca (↻): SVG 24×24, traço 1.6, cor do texto. */
export const ICONE_RECOMECO = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6l-2.5 2.5"/><path d="M3.5 3.5v5h5"/></svg>';
export const ICONE_TROCA = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20.5 12a8.5 8.5 0 1 1-2.5-6l2.5 2.5"/><path d="M20.5 3.5v5h-5"/></svg>';

const QUEM_NAO_TRAZ: Record<MotivoRecomeco, string> = {
  troca_de_conta: "A outra conta",
  troca_de_ia: "A outra IA",
  troca_de_maquina: "A outra máquina",
  sessao_recusada: "A IA",
};

const idDaExplicacao = (id: string): string => `recomeco-explica-${id}`;

/** A explicação "Por que reler?" da carona (no fluxo, logo abaixo da linha). */
export function explicacaoDaCarona(id: string, alvo: AlvoDoRecomeco): string {
  const bot = alvo.nomeDoBot ?? "o bot";
  return `<div class="p312-explica" id="${esc(idDaExplicacao(id))}" role="region" aria-label="Por que reler?"${explicacaoAberta(id) ? "" : " hidden"}><b>Por que reler?</b><p>${esc(QUEM_NAO_TRAZ[alvo.motivo])} não traz o que ${esc(bot)} já leu e testou nesta conversa. A conversa vai junto, com um resumo do trabalho; ${esc(bot)} relê só o que precisar, então o próximo passo pode demorar um pouco mais.</p></div>`;
}

/** A carona clicável (linhas de conta): "· relê o necessário", que abre a explicação. */
export function caronaClicavel(id: string): string {
  const aberta = explicacaoAberta(id);
  // QA: o botão é inline-block e o nbsp sozinho não segura a quebra; o span sem quebra leva o "·" junto para a linha de baixo.
  return ` <span class="p312-junto"><span class="p312-sep" aria-hidden="true">·</span>&nbsp;<button type="button" class="linha-link p312-carona" data-act="recomeco-explicar" data-id="${esc(id)}" aria-expanded="${aberta}" aria-controls="${esc(idDaExplicacao(id))}">relê o necessário</button></span>`;
}

/** A carona em texto (troca de IA, dentro do summary do details: um botão lá dentro seria um controle aninhado). */
export const CARONA_TEXTO = '<span class="p312-junto"><span class="p312-sep" aria-hidden="true">·</span>&nbsp;<span class="p312-carona-txt">relê o necessário</span></span>';

/**
 * QA: a carona da troca de IA mora no summary (sem botão próprio), então o Esc fecha o details aberto que a leva, como
 * fecha a explicação da marca e da carona de conta. Só esse details: os outros seguem o comportamento nativo.
 */
type DetailsLike = { open: boolean; querySelector: (s: string) => unknown };
export function detailsParaFecharComEsc<D extends DetailsLike>(alvo: { closest?: (s: string) => unknown }): D | null {
  const d = (alvo.closest?.("details.linha-ia-troca") ?? null) as D | null;
  return d && d.open && d.querySelector(".p312-carona-txt") ? d : null;
}

/** A frase a mais no detalhe da troca de IA. */
export function fraseDoDetalheDaIa(de: string, para: string, nomeDoBot: string | null): string {
  const bot = nomeDoBot ?? "o bot";
  return ` <span class="p312-det">O ${esc(para)} não traz o que ${esc(bot)} já leu e testou no ${esc(de)}: a conversa vai junto, com um resumo do trabalho, e ${esc(bot)} relê só o que precisar.</span>`;
}

/** A marca "↺ recomeçou" ao lado da hora e a explicação logo abaixo do nome. */
export function marcaDoRecomeco(id: string, alvo: AlvoDoRecomeco): { marca: string; explicacao: string } {
  const bot = alvo.nomeDoBot ?? "O bot";
  const aberta = explicacaoAberta(id);
  const marca = `<button type="button" class="p312-marca" data-act="recomeco-explicar" data-id="${esc(id)}" aria-expanded="${aberta}" aria-controls="${esc(idDaExplicacao(id))}" aria-label="recomeçou: ${esc(bot)} não continuou de onde parou. Ver por quê"><span class="p312-marca-ic" aria-hidden="true">${ICONE_RECOMECO}</span><span class="p312-marca-txt">recomeçou</span></button>`;
  const porque: Record<MotivoRecomeco, string> = {
    troca_de_maquina: `Desta vez ${esc(bot)} respondeu de outra máquina e não conseguiu continuar de onde parou.`,
    troca_de_ia: `Desta vez ${esc(bot)} respondeu por outra IA, que não traz o que ele já leu e testou.`,
    troca_de_conta: `Desta vez ${esc(bot)} respondeu por outra conta da IA, que não traz o que ele já leu e testou.`,
    sessao_recusada: `Desta vez a IA não conseguiu continuar de onde ${esc(bot)} parou.`,
  };
  const explicacao = `<div class="p312-explica" id="${esc(idDaExplicacao(id))}" role="region" aria-label="${esc(bot)} recomeçou"${aberta ? "" : " hidden"}><b>${esc(bot)} recomeçou</b><p>${porque[alvo.motivo]} Ele recomeçou pela conversa e por um resumo do trabalho, e releu só o necessário.</p></div>`;
  return { marca, explicacao };
}

/** A nota no topo das etapas, no turno ao vivo que recomeçou. */
export function notaDasEtapas(motivo: MotivoRecomeco, nomeDoBot: string | null): string {
  const bot = nomeDoBot ?? "O bot";
  const onde: Record<MotivoRecomeco, string> = {
    troca_de_conta: "em outra conta",
    troca_de_ia: "em outra IA",
    troca_de_maquina: "em outra máquina",
    sessao_recusada: "sem a sessão anterior",
  };
  return `<p class="p312-etapa-nota">${esc(bot)} recomeçou ${onde[motivo]} e relê o necessário antes de seguir.</p>`;
}
