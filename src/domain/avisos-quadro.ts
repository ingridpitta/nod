import type { ColunaQuadro, IdColuna, TarefaQuadro } from "../contracts/quadro.ts";
import { exigePessoa, grupoDe, prazoLegivelMin } from "./colunas.ts";

export { exigePessoa };

/**
 * NOD-420 (definido em 2026-11-02): o quadro só chama a pessoa quando precisa dela. Puro: quem chama lê as marcas da
 * tarefa (migração 0141) e grava o que saiu.
 * 1. Espera da pessoa (Bloqueado, a pergunta do bot — ADR-162: a tarefa fica na coluna, marcada `voce` — e a coluna "só
 *    uma pessoa tira daqui" da NOD-419): um aviso por entrada na espera. As que entram perto uma da outra chegam juntas: a primeira ainda não avisada abre uma janela
 *    curta (JANELA_AGRUPAR_MS) e, ao fim dela, tudo o que ainda não foi avisado sai numa mensagem só.
 * 2. Prazo (SLA) da coluna: a tarefa parada além dele numa coluna onde o trabalho anda faz o quadro cobrar o responsável
 *    uma vez; se depois de mais um prazo ela continuar ali, a pessoa é avisada (uma vez).
 * Tarefa andando normal não avisa ninguém. O texto não leva nada que veio de fora (ADR-047): a tarefa `deFora` aparece
 * pelo identificador do Linear (ou "uma tarefa") e "a pergunta está no quadro".
 */

export const JANELA_AGRUPAR_MS = 2 * 60_000;
/** Quantas tarefas a mensagem lista; o resto vira "e mais N no quadro". */
export const MAX_NA_MENSAGEM = 8;
/** A pergunta entra no aviso cortada aqui: a inteira está no card. */
const MAX_PERGUNTA_NO_AVISO = 200;

/**
 * A tarefa espera só porque a coluna é "só a pessoa tira daqui" (não Bloqueado nem uma pergunta do bot): não há pergunta a
 * responder, a pessoa decide e move (revisão 4 do PR #624).
 */
export function soAPessoaTira(colunas: readonly ColunaQuadro[], id: IdColuna): boolean {
  return id !== "voce" && id !== "bloqueado" && exigePessoa(colunas.find((c) => c.id === id));
}

/** A tarefa espera a pessoa (e só por isso o quadro a chama): a pergunta do bot (ADR-162), Bloqueado ou a trava "só a pessoa". */
export function esperaPessoa(colunas: readonly ColunaQuadro[], id: IdColuna): boolean {
  return id === "voce" || id === "bloqueado" || exigePessoa(colunas.find((c) => c.id === id));
}

/** As marcas da estadia na coluna atual (0141); epoch ms. */
export type MarcasAviso = { naColunaDesde: number; avisadaEm: number | null; cobradaEm: number | null; escaladaEm: number | null };
export type TarefaComMarcas = Pick<TarefaQuadro, "id" | "titulo" | "status" | "pergunta" | "agenteId" | "deFora" | "linearId"> & MarcasAviso;

/**
 * As decisões que saem agora, juntas: nada enquanto a mais antiga ainda não avisada não completou a janela (as que
 * chegarem nela entram na mesma mensagem); depois, todas as ainda não avisadas.
 */
export function decisoesParaAvisar<T extends TarefaComMarcas>(tarefas: readonly T[], colunas: readonly ColunaQuadro[], agora: number): T[] {
  const novas = tarefas.filter((t) => t.avisadaEm === null && esperaPessoa(colunas, t.status));
  if (novas.length === 0) return [];
  const primeira = Math.min(...novas.map((t) => t.naColunaDesde));
  return agora - primeira >= JANELA_AGRUPAR_MS ? novas : [];
}

export type Atraso<T> = { tarefa: T; acao: "cobrar" | "escalar"; prazoMin: number };

/**
 * As tarefas paradas além do prazo da coluna: a cobrança ao responsável primeiro, a pessoa depois de mais um prazo.
 * ADA-232 (ADR-155): `ocupadas` = as tarefas com trabalho vivo ou volta marcada; não estão paradas e não são cobradas.
 */
export function atrasosDePrazo<T extends TarefaComMarcas>(tarefas: readonly T[], colunas: readonly ColunaQuadro[], agora: number, ocupadas: ReadonlySet<string> = new Set()): Atraso<T>[] {
  const saida: Atraso<T>[] = [];
  for (const t of tarefas) {
    const c = colunas.find((x) => x.id === t.status);
    if (!c?.prazoMin || grupoDe(colunas, t.status) !== "iniciado" || esperaPessoa(colunas, t.status) || ocupadas.has(t.id)) continue;
    const prazoMs = c.prazoMin * 60_000;
    if (agora - t.naColunaDesde < prazoMs) continue;
    if (t.cobradaEm === null) saida.push({ tarefa: t, acao: "cobrar", prazoMin: c.prazoMin });
    else if (t.escaladaEm === null && agora - t.cobradaEm >= prazoMs) saida.push({ tarefa: t, acao: "escalar", prazoMin: c.prazoMin });
  }
  return saida;
}

const nomeDaColuna = (colunas: readonly ColunaQuadro[], id: IdColuna) => colunas.find((c) => c.id === id)?.nome ?? id;

/** Como a tarefa aparece no aviso: o título entre aspas; a de fora, só pelo identificador do Linear (ADR-047). */
function rotulo(t: Pick<TarefaComMarcas, "titulo" | "deFora" | "linearId">): string {
  if (t.deFora) return t.linearId ?? "uma tarefa";
  return `"${t.titulo}"`;
}

function cortar(texto: string): string {
  return texto.length > MAX_PERGUNTA_NO_AVISO ? `${texto.slice(0, MAX_PERGUNTA_NO_AVISO - 1).trimEnd()}…` : texto;
}

/** Uma linha por tarefa: qual, onde (fora da pergunta do bot), quem, e a pergunta (a de fora fica no quadro). */
function linha(t: TarefaComMarcas, colunas: readonly ColunaQuadro[], nomes: ReadonlyMap<string, string>): string {
  const quem = t.agenteId ? nomes.get(t.agenteId) : undefined;
  const onde = t.status === "voce" ? "" : ` (${nomeDaColuna(colunas, t.status)})`;
  const semPergunta = soAPessoaTira(colunas, t.status) ? "só você tira daqui" : t.status === "bloqueado" ? "travou e espera você" : "espera você";
  const pergunta = t.deFora ? "a pergunta está no quadro" : cortar(t.pergunta?.trim() || semPergunta);
  return `${rotulo(t)}${onde}${quem ? `, ${quem}` : ""}: ${pergunta}`;
}

const COMO_RESPONDER = "Responda na tarefa (um comentário) ou aqui mesmo: o responsável segue.";
/** A coluna "só a pessoa tira daqui" não tem pergunta: responder não a tira de lá, a pessoa move (revisão 4 do PR #624). */
const SO_VOCE_UMA = "Só você tira esta tarefa daqui: mova-a quando decidir.";
const SO_VOCE_VARIAS = "Só você tira estas tarefas daqui: mova cada uma quando decidir.";
const SO_VOCE_MISTO = "As que estão numa coluna só sua não têm resposta: mova-as quando decidir.";

/** O fecho da mensagem: como responder, como mover, ou os dois quando a lista mistura. */
function fecho(tarefas: readonly TarefaComMarcas[], colunas: readonly ColunaQuadro[]): string {
  const so = tarefas.filter((t) => soAPessoaTira(colunas, t.status)).length;
  if (so === 0) return COMO_RESPONDER;
  if (so === tarefas.length) return so === 1 ? SO_VOCE_UMA : SO_VOCE_VARIAS;
  return `${COMO_RESPONDER}\n${SO_VOCE_MISTO}`;
}

function lista<T>(itens: readonly T[], item: (x: T) => string): string {
  const linhas = itens.slice(0, MAX_NA_MENSAGEM).map((x) => `• ${item(x)}`);
  const sobra = itens.length - linhas.length;
  if (sobra > 0) linhas.push(`• e mais ${sobra} no quadro`);
  return linhas.join("\n");
}

/**
 * "no quadro" ou "no quadro de <anfitrião>": o aviso que cai na conversa de outro bot diz de qual quadro é (revisão do
 * PR #624), para a pessoa saber onde olhar e o bot passar `quadro` no gerir_quadro.
 */
const noQuadro = (quadroDe?: string) => (quadroDe ? `no quadro de ${quadroDe}` : "no quadro");

/** A mensagem das decisões pendentes: uma frase com uma, a lista com várias (até MAX_NA_MENSAGEM). */
export function textoDasDecisoes(tarefas: readonly TarefaComMarcas[], colunas: readonly ColunaQuadro[], nomes: ReadonlyMap<string, string>, quadroDe?: string): string {
  if (tarefas.length === 1) return `Preciso de você ${noQuadro(quadroDe)}, em ${linha(tarefas[0]!, colunas, nomes)}\n\n${fecho(tarefas, colunas)}`;
  return `${tarefas.length} decisões esperam você ${noQuadro(quadroDe)}:\n${lista(tarefas, (t) => linha(t, colunas, nomes))}\n\n${fecho(tarefas, colunas)}`;
}

/** A entrada do turno que cobra o responsável (curta: o que está parado, há quanto, o que fazer). */
export function entradaDaCobranca(a: { quadroId: string; tarefa: Pick<TarefaQuadro, "id" | "titulo" | "status">; colunaNome: string; prazoMin: number }): string {
  return [
    `[Quadro ${a.quadroId}] A tarefa "${a.tarefa.titulo}" (id ${a.tarefa.id}) está parada em ${a.colunaNome} há mais de ${prazoLegivelMin(a.prazoMin)}, o prazo da coluna.`,
    "Dê andamento agora: avance a tarefa com gerir_quadro; se travou numa decisão da pessoa, pergunte (mudar_tarefa só com a pergunta: a tarefa fica na coluna); se depende de algo de fora, mova para bloqueado com a pergunta.",
    "Se continuar parada, o quadro avisa a pessoa.",
  ].join("\n");
}

/** A mensagem à pessoa quando a cobrança não destravou (juntas, como as decisões). */
export function textoDosAtrasos(atrasos: readonly Atraso<TarefaComMarcas>[], colunas: readonly ColunaQuadro[], nomes: ReadonlyMap<string, string>, quadroDe?: string): string {
  const item = (a: Atraso<TarefaComMarcas>) => {
    const quem = a.tarefa.agenteId ? nomes.get(a.tarefa.agenteId) : undefined;
    return `${rotulo(a.tarefa)} em ${nomeDaColuna(colunas, a.tarefa.status)}${quem ? `, com ${quem}` : ""} (prazo de ${prazoLegivelMin(a.prazoMin)})`;
  };
  if (atrasos.length === 1) return `${item(atrasos[0]!)} continua parada depois da cobrança. Vale dar uma olhada ${noQuadro(quadroDe)}.`;
  return `${atrasos.length} tarefas ${quadroDe ? `do quadro de ${quadroDe} ` : ""}continuam paradas depois da cobrança:\n${lista(atrasos, item)}`;
}
