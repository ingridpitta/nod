import type { Agente, FormaAgente } from "../../src/contracts/agente.ts";
import type { Estado, TurnoVivo } from "../estado/reducer.ts";
import { esc } from "./escape.ts";
import { COMET_MS, WINK_MS } from "./atividade.ts";
import { FALA_SAINDO_MS } from "./fala-viva.ts";

/**
 * Adaptador do motor SVG temporário Bloub/GrokBot.
 * Mantém forma, estado e desenho isolados para a identidade definitiva poder substituí-lo sem
 * alterar contratos, banco ou telas. Referência e licença registradas em THIRD_PARTY_NOTICES.md.
 */
/**
 * `na_fila` (definido em 2026-10-13, NOD-216): o bot tem pedido esperando a vez, sem nada rodando. Fica PARADO (a pose
 * de disponível) e diz "na fila" no tooltip: só o turno rodando anima. Antes a fila animava "pensando" — um turno
 * pendente esquecido no servidor deixava o mascote pensando por horas.
 */
export type EstadoMascote = "disponivel" | "pensando" | "trabalhando" | "aguardando" | "pausado" | "na_fila";

export const FORMAS_MASCOTE = ["shape-square", "shape-hex", "shape-circle", "shape-pebble", "shape-capsule", "shape-triangle", "shape-cloud", "shape-drop"] as const satisfies readonly FormaAgente[];
export const CORES_MASCOTE = ["c-red", "c-pink", "c-purple", "c-blue", "c-teal", "c-green", "c-orange", "c-black", "c-brown", "c-amber", "c-gray", "c-cream"] as const;

export const ESTADOS_BLOUB = { disponivel: "idle", pensando: "thinking", trabalhando: "orbit", aguardando: "notify", pausado: "sleep", na_fila: "idle" } as const;
/** `xxl` (definido em 2026-10-04): o mascote da tela cheia da ligação, o maior da interface. */
export type TamanhoMascote = "" | "sm" | "md" | "lg" | "xl" | "xxl";
const ROTULOS = { disponivel: "disponível", pensando: "pensando", trabalhando: "trabalhando", aguardando: "aguardando você", pausado: "pausado (reservado)", na_fila: "na fila" };
export function htmlMascote(a: Pick<Agente, "nome" | "cor" | "forma">, tamanho: TamanhoMascote = "", estado: EstadoMascote = "disponivel", extra = ""): string {
  return `<nod-mascote class="icon mascote ${esc(a.cor)} ${esc(a.forma)}${tamanho ? ` ${tamanho}` : ""}" data-mascote data-estado="${estado}" state="${ESTADOS_BLOUB[estado]}" shape="${a.forma}" role="img" aria-label="${esc(a.nome)} · ${ROTULOS[estado]}" title="${esc(a.nome)} · ${ROTULOS[estado]}" ${extra}></nod-mascote>`;
}
type ElementoMascote = {
  classList: Iterable<string> & { remove(...tokens: string[]): void; add(...tokens: string[]): void };
  setAttribute(nome: string, valor: string): void;
};
export function atualizarMascote(elemento: ElementoMascote, forma: FormaAgente, cor: string): void {
  for (const classe of [...elemento.classList]) {
    if (classe.startsWith("shape-") || classe.startsWith("c-")) elemento.classList.remove(classe);
  }
  elemento.classList.add(forma, cor);
  elemento.setAttribute("shape", forma);
}

/**
 * NOD-216: o pedido que acabou de entrar na fila ainda mostra "pensando" (o bot recebeu e está para começar); passado
 * isto, a fila fica parada. Sem esta janela, mandar uma mensagem deixaria o mascote imóvel até o despacho.
 */
export const JANELA_PENSANDO_MS = 5_000;

/**
 * Os turnos vivos DA CONVERSA do bot (NOD-216: a fonte única da barra, dos fixados, do cabeçalho, da presença e da linha
 * "na fila"). Fora: o turno de uma task (`trabalhoId`, ou o `turnoVivoId` que `GET trabalhos` aponta) — quem diz que o
 * bot tem task rodando é o chip com o número; e o de outra conversa — um bot nunca anima pelo trabalho de outro.
 */
export function turnosVivosDaConversa(estado: Pick<Estado, "turnosVivos" | "trabalhos">, conversaId: string): TurnoVivo[] {
  const deTask = turnosDeTask(estado.trabalhos);
  return Object.values(estado.turnosVivos).filter((turno) => turno.conversaId === conversaId && !turno.trabalhoId && !deTask.has(turno.turnoId));
}

/**
 * NOD-402 (ADR-130): os turnos vivos que aparecem NO CHAT da conversa — os da conversa menos os dos bastidores (rotina,
 * colega). Fonte do ao vivo (fala viva, pensamento) e do Parar do campo. A rotina roda em segundo plano: só a mensagem
 * gravada, quando há algo para a pessoa, entra no chat. A presença (barra, mascote, pílula) segue `turnosVivosDaConversa`.
 */
export function turnosVivosDoChat(estado: Pick<Estado, "turnosVivos" | "trabalhos">, conversaId: string): TurnoVivo[] {
  return turnosVivosDaConversa(estado, conversaId).filter((turno) => !turno.bastidores);
}

/** Revisão NOD-216: o conjunto dos turnos de task, um por leitura de `GET trabalhos` — a barra o pede uma vez por bot. */
const DE_TASK = new WeakMap<object, ReadonlySet<string>>();
const SEM_TASK: ReadonlySet<string> = new Set();
function turnosDeTask(trabalhos: Estado["trabalhos"]): ReadonlySet<string> {
  if (!trabalhos) return SEM_TASK;
  let deTask = DE_TASK.get(trabalhos);
  if (!deTask) DE_TASK.set(trabalhos, (deTask = new Set((trabalhos.trabalhos ?? []).flatMap((t) => (t.turnoVivoId ? [t.turnoVivoId] : [])))));
  return deTask;
}

/** Quando a janela de "pensando" do turno começou: o relógio da web (`chegouEm`); o `desde` do banco só sem ele. */
const inicioDaJanela = (turno: Pick<TurnoVivo, "desde" | "chegouEm">): number => turno.chegouEm ?? turno.desde;

/** O pedido na fila é recente o bastante para ainda contar como "pensando" (`JANELA_PENSANDO_MS`). */
export const filaRecente = (turno: Pick<TurnoVivo, "estado" | "desde" | "chegouEm">, agora: number): boolean => turno.estado === "na_fila" && agora - inicioDaJanela(turno) < JANELA_PENSANDO_MS;

/**
 * Revisão NOD-216: o instante em que o primeiro pedido "pensando" passa a "na fila" (null = nenhum). O relógio da web só
 * anda no tick de 15 s; sem um re-render aqui, o mascote ficava pensando de 5 a 20 s. A main agenda um timer só para ele.
 */
export function proximaViradaDoMascote(estado: Pick<Estado, "turnosVivos" | "falasSaindo"> & Partial<Pick<Estado, "atividades">>, agora: number): number | null {
  let proxima: number | null = null;
  const considerar = (fim: number) => { if (fim > agora && (proxima === null || fim < proxima)) proxima = fim; };
  for (const t of Object.values(estado.turnosVivos)) if (t.estado === "na_fila") considerar(inicioDaJanela(t) + JANELA_PENSANDO_MS);
  // NOD-348 (revisão 4 do #508): a fala parada sai aos 15 s mesmo sem releitura, e não no tick seguinte (até 30 s).
  // Parte 3 do plano "o pensamento no chat": e o `wink` da fala que entrou acaba em WINK_MS.
  for (const daConversa of Object.values(estado.falasSaindo ?? {})) for (const s of Object.values(daConversa)) { considerar(s.em + WINK_MS); considerar(s.em + FALA_SAINDO_MS); }
  // Parte 3: o `comet` das frentes que saíram acaba em COMET_MS.
  for (const daConversa of Object.values(estado.atividades ?? {})) for (const a of Object.values(daConversa)) if (a.frentesEm !== undefined) considerar(a.frentesEm + COMET_MS);
  return proxima;
}

/**
 * Traduz somente fatos já tipados da web em expressão visual; o estado não é persistido no avatar.
 * definido em 2026-10-08 (QA do épico #188, K8 variante 3: "um sinal por bot"): o turno de uma task não anima o mascote —
 * quem diz que o bot tem task rodando é o chip com o número ao lado do nome. Antes, com uma task rodando, o mascote
 * girava (a variante 1, recusada) e o chip piscava ao mesmo tempo. A lista de `GET trabalhos` diz qual turno é de task
 * (`turnoVivoId`), além do `trabalhoId` que o turno vivo já traz; `conversas` fica de fora (a barra relê pelo que lê).
 */
export function estadoMascoteNaConversa(estado: Pick<Estado, "turnosVivos" | "trabalhos" | "suaVez" | "agora">, conversaId: string): EstadoMascote {
  const vivos = turnosVivosDaConversa(estado, conversaId);
  if (vivos.some((t) => t.estado === "rodando")) return "trabalhando";
  // NOD-216: só o pedido recém-chegado pensa; a fila antiga fica parada (abaixo de "Sua vez", que pede a pessoa).
  if (vivos.some((t) => filaRecente(t, estado.agora))) return "pensando";
  const aguarda = estado.suaVez?.itens.some((item) => item.decisao.conversaId === conversaId && item.estadoColuna !== "vencido");
  if (aguarda) return "aguardando";
  return vivos.some((t) => t.estado === "na_fila") ? "na_fila" : "disponivel";
}

/** O mascote anima (gira ou pensa)? Para a presença do cabeçalho e para quem só precisa do sim ou não. */
export const mascoteAnimado = (e: EstadoMascote): boolean => e === "trabalhando" || e === "pensando";

/** Revisão NOD-216: o aviso do bot (fora do ar, pergunta, rotina parada) ganha do mascote parado — disponível ou na fila. */
export const mascoteComAviso = (e: EstadoMascote, aviso: unknown): EstadoMascote => (aviso && !mascoteAnimado(e) && e !== "aguardando" && e !== "pausado" ? "aguardando" : e);
