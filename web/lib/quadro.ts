import type { Experimentos } from "../../src/contracts/raio-x.ts";
import type { TipoFrame } from "../../src/contracts/frame.ts";
/**
 * NOD-429 (definido em 2026-10-30, protótipo base v3 aprovado pelo Marlon): o vocabulário do quadro-agente, sem DOM.
 * Os componentes (web/telas/quadro.ts) e a troca Conversa ↔ Quadro na pílula (web/lib/quadro-na-tela.ts) leem daqui;
 * as NOD-415 a 422 e 430 só acrescentam. A TAREFA é o objeto; o CARD é como ela aparece no quadro; a LINHA, na lista do celular.
 */

/** Os status padrão de um quadro, na ordem das colunas. A forma do ícone diz o grupo; a cor fica só nele. */
export const STATUS = ["backlog", "afazer", "fazendo", "revisao", "bloqueado", "voce", "feito", "cancelado"] as const;
export type Status = (typeof STATUS)[number];

/** Os 4 grupos: vazio = não iniciado, meio = iniciado, cheio = feito ou fechado. */
export type Grupo = "nao_iniciado" | "iniciado" | "feito" | "fechado";

export const GRUPO_DO_STATUS: Readonly<Record<Status, Grupo>> = {
  backlog: "nao_iniciado", afazer: "nao_iniciado",
  fazendo: "iniciado", voce: "iniciado", revisao: "iniciado", bloqueado: "iniciado",
  feito: "feito", cancelado: "fechado",
};

export const NOME_DO_STATUS: Readonly<Record<Status, string>> = {
  backlog: "Backlog", afazer: "A fazer", fazendo: "Fazendo", voce: "Precisa de você", revisao: "Em revisão", bloqueado: "Bloqueado",
  feito: "Feito", cancelado: "Cancelado",
};

/** Decisão aprovada na v1 da NOD-429: Backlog, Feito e Cancelado nascem recolhidos numa tira com a contagem; um clique abre. */
export const RECOLHIDAS_PADRAO: ReadonlySet<Status> = new Set<Status>(["backlog", "feito", "cancelado"]);

export interface ColunaPadrao { status: Status; nome: string; recolhida: boolean }

/** As colunas de um quadro novo, sem tarefa nenhuma (o modo Quadro da NOD-429, antes dos dados da NOD-415). */
export function colunasPadrao(): ColunaPadrao[] {
  // ADR-162: `voce` segue no tipo (o ícone, o servidor de antes), mas não é coluna.
  return STATUS.filter((s) => s !== "voce").map((status) => ({ status, nome: NOME_DO_STATUS[status], recolhida: RECOLHIDAS_PADRAO.has(status) }));
}

/** Como a coluna se encaixa na grade: tira estreita, as outras iguais. */
export function trilhaDaColuna(c: { status?: string; recolhida?: boolean }): string {
  if (c.recolhida) return "var(--qd-tira)";
  return "minmax(var(--qd-col-min), 1fr)";
}

/* ---------- A troca Conversa ↔ Quadro na pílula ---------- */

export type ModoDaConversa = "conversa" | "quadro";
export const MODOS: readonly ModoDaConversa[] = ["conversa", "quadro"];

/**
 * A ordem segue o gesto (NOD-42): Conversa à esquerda, Quadro à direita. Na ida o Quadro entra pela direita e a conversa
 * sai pela esquerda; na volta, o contrário.
 */
export type Direcao = "ida" | "volta";
export function direcaoDaTroca(de: ModoDaConversa, para: ModoDaConversa): Direcao | null {
  if (de === para) return null;
  return para === "quadro" ? "ida" : "volta";
}

/**
 * Comentário final do Marlon na j7-1 (definido em 2026-10-30): deslize suave nos dois sentidos, ~200–250 ms ease-out.
 * 220 ms com a curva de saída do nod; o indicador do segmento usa a mesma duração e a mesma curva (web/quadro.css).
 * Com "Reduzir movimento", um fade curto sem deslocamento.
 */
export const TROCA_MS = 220;
export const TROCA_CURVA = "cubic-bezier(.2, .8, .2, 1)";
export const FADE_MS = 120;
/** Quanto o conteúdo anda de lado: o bastante para ler a direção, sem atravessar a tela inteira. */
export const DESLIZE_PX = 48;

export type QuadroChave = { opacity: number; transform?: string };
export interface Movimento { sai: QuadroChave[]; entra: QuadroChave[]; ms: number; curva: string }

/** Os quadros-chave (Web Animations) de quem sai e de quem entra. Reduzido: só opacidade, sem `transform`. */
export function movimentoDaTroca(direcao: Direcao, reduzido: boolean): Movimento {
  if (reduzido) {
    return { sai: [{ opacity: 1 }, { opacity: 0 }], entra: [{ opacity: 0 }, { opacity: 1 }], ms: FADE_MS, curva: "ease-out" };
  }
  const lado = direcao === "ida" ? 1 : -1;
  return {
    sai: [{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: `translateX(${-lado * DESLIZE_PX}px)` }],
    entra: [{ opacity: 0, transform: `translateX(${lado * DESLIZE_PX}px)` }, { opacity: 1, transform: "translateX(0)" }],
    ms: TROCA_MS,
    curva: TROCA_CURVA,
  };
}

/** O teclado do tablist (APG): ← → trocam, Home e End vão às pontas. Devolve o modo escolhido ou null. */
export function modoPelaTecla(atual: ModoDaConversa, tecla: string): ModoDaConversa | null {
  const i = MODOS.indexOf(atual);
  if (tecla === "ArrowRight") return MODOS[(i + 1) % MODOS.length] ?? null;
  if (tecla === "ArrowLeft") return MODOS[(i - 1 + MODOS.length) % MODOS.length] ?? null;
  if (tecla === "Home") return MODOS[0] ?? null;
  if (tecla === "End") return MODOS[MODOS.length - 1] ?? null;
  return null;
}

/** O par Conversa | Quadro só aparece com o experimento Quadro ligado (Configurações › Avançado) e num bot da própria pessoa (nunca no de outra). */
/** NOD-429: as chaves que a ação `alternar-experimento` aceita (o `data-experimento` do switch). */
export function ehChaveDeExperimento(v: unknown): v is keyof Experimentos {
  return v === "calibracao" || v === "memoriaLonga" || v === "whatsapp" || v === "quadro";
}

/** NOD-429: o que o main.ts pergunta para a conversa aberta: o experimento Quadro da pessoa e o dono do bot. */
export function quadroDoEstado(e: { experimentos: Pick<Experimentos, "quadro">; sessao?: { pessoaId?: string | null } | null }, donoDoBot: string | null | undefined): boolean {
  return quadroNaConversa({ ligado: e.experimentos.quadro, pessoaId: e.sessao?.pessoaId, donoDoBot });
}

export function quadroNaConversa(o: { ligado: boolean; pessoaId: string | null | undefined; donoDoBot: string | null | undefined }): boolean {
  return o.ligado && !!o.pessoaId && o.donoDoBot === o.pessoaId;
}

/**
 * A conversa aberta está sendo lida? Não com o app ao fundo, nem com a inicial do celular por cima (NOD-379), nem no modo
 * Quadro, em que ela fica por baixo, invisível (NOD-429). Quem marca como lida e quem acende "mensagem nova" leem daqui.
 */
export function conversaAVista(o: { naFrente: boolean; botsAbertos: boolean; modo: ModoDaConversa }): boolean {
  return o.naFrente && !o.botsAbertos && o.modo !== "quadro";
}

export function ehModo(v: unknown): v is ModoDaConversa {
  return v === "conversa" || v === "quadro";
}

/** ADA-7: os frames de turno que mudam a execução de um card (e por isso releem o quadro à vista). */
export const TURNO_MUDA_A_EXECUCAO: ReadonlySet<string> = new Set<TipoFrame>(["turno.iniciado", "turno.encerrado", "turno.interrompido"]);

/**
 * ADA-7: quanto tempo depois da última rolagem o gesto ainda conta, e o máximo que a releitura de um frame espera por ele.
 * definido em 2026-11-03: 150 ms, folga sobre o intervalo de um quadro (16 ms) entre eventos de scroll do embalo; 3 s
 * é o teto para a tela não ficar velha com a pessoa rolando sem parar (o dedo que segue mexendo segura até soltar).
 */
export const GESTO_MS = 150;
export const ADIAR_ATE_MS = 3000;
/** ADA-7, definido em 2026-11-03: o dedo parado (sem mexer nem rolar) além disso não segura mais a releitura. */
export const TOQUE_PARADO_MS = 1000;
/**
 * ADA-12: quanto tempo a vista guarda a altura do conteúdo que encolheu no redesenho ao vivo antes de soltar; dentro dele a
 * tela não pula.
 * definido em 2026-11-03: o caso mais longo é o trabalho novo, que aparece com o log vazio e só enche com os passos do
 * turno (o primeiro passo de um turno costuma chegar em poucos segundos); 10 s cobre isso, e o espaço em branco do
 * conteúdo que encolheu de verdade some no prazo. Revisão 3: o prazo não foi medido no app; o branco possível é pequeno
 * porque a reserva só guarda até o fundo da tela, quem está colada no fim não reserva e a rolagem da pessoa solta.
 */
export const RESERVA_MS = 10_000;
/**
 * ADA-12 (QA, bug 1): depois de uma ação da pessoa na tarefa aberta (status, responsável), por quanto tempo o redesenho
 * dos comentários e do trabalho relidos é eco dela (sem alvo nem reserva), não ao vivo.
 * definido em 2026-11-03: a releitura que a ação dispara sai junto da resposta dela (um GET a mais); 2 s cobre a rede
 * lenta sem engolir o comentário ao vivo que chega depois.
 */
export const ECO_DA_PESSOA_MS = 2000;
/** ADA-7, definido em 2026-11-03: o arrasto de card ou de coluna segura a releitura até soltar; este teto só cobre um fim perdido. */
export const ARRASTO_ATE_MS = 30_000;

/**
 * 2026-11-10 (card preso em "começando"): a resposta de uma mudança traz o quadro do commit, com o turno recém-criado ainda
 * pendente ("fila"). Quando ela chega depois da releitura do frame do despacho, regrava o quadro velho. Um quadro que não
 * veio de frame e tem na fila um dos cards que a mudança mexeu (`mexidas`) pede uma releitura a mais (a de frame não pede
 * outra: sem laço). revisto em 2026-11-10 (T10): só os mexidos — o card que espera na fila há tempo (fila longa legítima)
 * e a releitura da importação a cada 2 s não pedem GET extra.
 */
export function releComecando(novo: { tarefas: readonly { id: string; execucao?: string | null }[] } | null, doFrame: boolean, mexidas: readonly string[]): boolean {
  if (doFrame || !novo || mexidas.length === 0) return false;
  const ids = new Set(mexidas);
  return novo.tarefas.some((t) => ids.has(t.id) && t.execucao === "fila");
}

/** 2026-11-10: de quanto em quanto o quadro confere se precisa da releitura de segurança. */
export const VIGIA_DO_QUADRO_MS = 5_000;
/** Sem nenhum dado ao vivo (frame ou ping; o servidor manda ping a cada 15 s) por este tempo, o stream está mudo. */
export const AO_VIVO_MUDO_MS = 20_000;

/**
 * 2026-11-10 (Marlon: o quadro não mostrava o que os agentes faziam, só o que ele fazia): o quadro se atualiza pelo SSE
 * (`quadro.mudou`, frames de turno). Quando o stream está mudo (um proxy que segura o stream, como o túnel rápido do
 * Cloudflare), o quadro à vista, com trabalho vivo ou com a tarefa aberta, relê sozinho. Com o SSE entregando, nada muda.
 */
export function deveVigiarQuadro(o: { agora: number; ultimoDado: number; visivel: boolean; comVivo: boolean; aberta: boolean }): boolean {
  if (!o.visivel || (!o.comVivo && !o.aberta)) return false;
  return o.agora - o.ultimoDado >= AO_VIVO_MUDO_MS;
}
