import type { DonoDto, EsperaDoDonoDto, EstadoDoDono, PedidoNaFilaDto } from "../../src/contracts/dono.ts";
import type { TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { Estado } from "../estado/reducer.ts";
import { duracaoCurta } from "./relogio.ts";
import { hora } from "./render.ts";
import { quandoVolta } from "./trabalhos.ts";

/**
 * O dono de cada bot na tela (definido em 2026-10-12, ADR-099 item 10, parte 5; protótipo docs/prototipos/um-dono-por-bot/).
 * O servidor resume o que o bot tem em andamento (`EstadoDoDono`, src/domain/estado-do-dono.ts); aqui só as frases: a
 * linha acima do campo, o sinal da barra lateral e a linha do bot em Trabalhos dizem UMA coisa — a de maior prioridade —
 * e contam o resto ao lado. Puro: recebe o estado (ou o dono) e devolve dados e texto, sem DOM e sem HTML.
 *
 * A prioridade: Esperando você > Trabalhando em N frentes > Esperando X > N na fila > livre (nada).
 */

/** O dono que a tela conhece: o da conversa (relida a cada fala do bot) e, sem ela, o de `GET trabalhos`. */
export function donoDoBot(estado: Pick<Estado, "conversas" | "trabalhos">, agenteId: string, conversaId?: string | null): DonoDto | null {
  const daConversa = conversaId ? estado.conversas[conversaId]?.dono : undefined;
  if (daConversa && daConversa.estado.agenteId === agenteId) return daConversa;
  return estado.trabalhos?.donos?.find((d) => d.estado.agenteId === agenteId) ?? null;
}

/** O servidor já manda o dono (ADR-099, I10)? Sem ele (servidor anterior), as telas de antes. */
export const temDonos = (estado: Pick<Estado, "trabalhos">): boolean => Array.isArray(estado.trabalhos?.donos);

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

/** "1 pedido na fila", "2 pedidos na fila"; com frentes esperando a vez misturadas, "3 na fila". */
export function textoDaFila(e: Pick<EstadoDoDono, "fila">, pedidos: number): string {
  return pedidos === e.fila ? plural(e.fila, "pedido na fila", "pedidos na fila") : `${e.fila} na fila`;
}

/** "esperando a CI do #845" (uma espera, com o motivo) ou "3 esperando". */
export function textoDasEsperas(e: Pick<EstadoDoDono, "esperando" | "motivoEspera">): string {
  return e.esperando === 1 && e.motivoEspera ? `esperando ${e.motivoEspera}` : `${e.esperando} esperando`;
}

/** O sinal da linha: azul (você), vivo na cor do bot (frentes), vazado (espera) ou o número (só fila). */
export type SinalDoDono = "voce" | "vivo" | "espera" | "fila";

export type LinhaDoDono = {
  sinal: SinalDoDono;
  /** O texto principal, em negrito: "Esperando você", "Trabalhando em 3 frentes", "Esperando a CI do #845". */
  texto: string;
  /** O resto, em contagem ao lado: "38 min", "2 frentes trabalhando", "1 pedido na fila". */
  extras: string[];
  /** Quantos pontos vivos (um por frente, até 3) e, acima disso, o número; na fila, o número de pedidos. */
  quantos: number;
};

/**
 * NOD-260 (definido em 2026-10-15): "trabalhando na conversa" é só a conversa PRÓPRIA do bot. `conversaTrabalhando`
 * conta também o turno numa sala; o servidor que manda `conversaPropriaTrabalhando` decide por ele, o de antes (sem o
 * campo) fica no de sempre.
 */
const conversaPropria = (e: DonoDto["estado"]): boolean => e.conversaPropriaTrabalhando ?? e.conversaTrabalhando;

/**
 * A linha de um dono. `comConversa`: o turno da própria conversa conta como trabalhando — na barra e em Trabalhos sim; na
 * linha acima do campo não (a conversa já mostra o turno ao vivo, e "Trabalhando" ali repetiria o balão que escreve).
 * null = nada a dizer (a linha some).
 */
export function linhaDoDono(dono: DonoDto, agora: number, opcoes: { comConversa?: boolean } = {}): LinhaDoDono | null {
  const e = dono.estado;
  const conversa = opcoes.comConversa === true && conversaPropria(e);
  const fila = e.fila > 0 ? textoDaFila(e, dono.fila.length) : "";
  const esperas = e.esperando > 0 ? textoDasEsperas(e) : "";
  const trabalhando = e.frentes > 0 ? plural(e.frentes, "frente trabalhando", "frentes trabalhando") : conversa ? "trabalhando na conversa" : "";
  if (e.esperandoVoce > 0) return { sinal: "voce", texto: "Esperando você", extras: [trabalhando, esperas, fila].filter(Boolean), quantos: e.esperandoVoce };
  if (e.frentes > 0 || conversa) {
    const texto = e.frentes > 0 ? `Trabalhando em ${plural(e.frentes, "frente", "frentes")}` : "Trabalhando na conversa";
    return { sinal: "vivo", texto, extras: [esperas, fila].filter(Boolean), quantos: Math.max(1, e.frentes) };
  }
  if (e.esperando > 0) {
    const texto = e.motivoEspera ? `Esperando ${e.motivoEspera}` : `${plural(e.esperando, "espera", "esperas")}`;
    const desde = e.desde !== null ? duracaoCurta(agora - e.desde) : "";
    const mais = e.esperando > 1 && e.motivoEspera ? `mais ${e.esperando - 1} esperando` : "";
    return { sinal: "espera", texto, extras: [desde, mais, fila].filter(Boolean), quantos: e.esperando };
  }
  if (e.fila > 0) return { sinal: "fila", texto: fila, extras: [], quantos: e.fila };
  return null;
}

/**
 * A frase inteira do dono, para o `title` do sinal da barra lateral: "1 trabalhando · 10 esperando · 1 pedido na fila",
 * "precisa de você · 2 trabalhando". Livre: "".
 */
export function fraseDoDono(dono: DonoDto): string {
  const e = dono.estado;
  const trabalhando = e.frentes > 0 ? e.frentes : conversaPropria(e) ? 1 : 0;
  return [
    e.esperandoVoce > 0 ? "precisa de você" : "",
    trabalhando > 0 ? `${trabalhando} trabalhando` : "",
    e.esperando > 0 ? textoDasEsperas(e) : "",
    e.fila > 0 ? textoDaFila(e, dono.fila.length) : "",
  ].filter(Boolean).join(" · ");
}

/** O grupo do bot em Trabalhos, pelo sinal da linha: quem só tem fila espera junto (esperar não é trabalhar). */
export type GrupoDoBot = "precisa" | "trabalhando" | "esperando";

export function grupoDaLinha(l: Pick<LinhaDoDono, "sinal"> | null): GrupoDoBot | null {
  if (!l) return null;
  return l.sinal === "voce" ? "precisa" : l.sinal === "vivo" ? "trabalhando" : "esperando";
}

/**
 * A conversa do bot trabalha agora (um turno dela rodando, fora de frente), pelos frames ao vivo. O `conversaTrabalhando`
 * do servidor é de quando a lista foi lida, e `GET trabalhos` só é relido quando um trabalho muda: o turno da conversa que
 * acabou continuaria "trabalhando" em Trabalhos.
 */
export function conversaViva(estado: Pick<Estado, "turnosVivos">, conversaId: string | null | undefined): boolean {
  if (!conversaId) return false;
  return Object.values(estado.turnosVivos).some((v) => v.conversaId === conversaId && !v.trabalhoId && v.estado === "rodando");
}

/**
 * NOD-377: a espera de colega com prazo. `resumo` = "sem resposta há 26h" (vencida) ou "cobrado agora" (cobrada no prazo);
 * `acoes` = a tela oferece Desistir (e Cobrar, com `podeCobrar`).
 */
export type ColegaNaTela = { tarefaId: string; nome: string; vencida: boolean; podeCobrar: boolean; resumo: string; acoes: boolean };

/** Uma espera na linha aberta: o que espera (o comando, em fonte fixa), as linhas de baixo e há quanto tempo. */
export type EsperaNaTela = { titulo: string; comando: boolean; linhas: string[]; tempo: string; colega?: ColegaNaTela };

/** "às 13:38" (hoje), "ontem às 13:38", "em 21/10 às 13:38": quando o pedido saiu. */
export function quandoPediu(desde: number, agora: number): string {
  const dia = (t: number): number => new Date(new Date(t).getFullYear(), new Date(t).getMonth(), new Date(t).getDate()).getTime();
  const dias = Math.round((dia(agora) - dia(desde)) / 86_400_000);
  if (dias <= 0) return `às ${hora(desde)}`;
  if (dias === 1) return `ontem às ${hora(desde)}`;
  const d = new Date(desde);
  return `em ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} às ${hora(desde)}`;
}

/** "cobrado agora" (no primeiro minuto) ou "cobrado há 5 min". */
function cobradoHa(em: number, agora: number): string {
  return agora - em < 60_000 ? "cobrado agora" : `cobrado há ${duracaoCurta(agora - em)}`;
}

/** O colega da espera com o prazo (NOD-377); undefined = o servidor de antes, sem o pedido. */
function colegaNaTela(e: EsperaDoDonoDto, agora: number): ColegaNaTela | undefined {
  const c = e.colega;
  if (!c?.tarefaId) return undefined;
  const vencida = c.vencida === true;
  const resumo = vencida ? `sem resposta há ${duracaoCurta(agora - e.desde)}` : c.cobradoEm ? cobradoHa(c.cobradoEm, agora) : "";
  return { tarefaId: c.tarefaId, nome: e.motivo, vencida, podeCobrar: c.podeCobrar === true && !c.removido, resumo, acoes: !c.removido && (vencida || Boolean(c.cobradoEm)) };
}

/**
 * A espera aberta (quadro 03): o comando e "última linha: …" e "volta sozinho quando terminar · tentativa 2 de 3"; a volta
 * marcada com a hora e o motivo; o colega com a hora do pedido. `frente`: o título da frente que espera, quando não é a
 * conversa.
 */
export function esperaNaTela(e: EsperaDoDonoDto, agora: number, frente?: string | null): EsperaNaTela {
  const tempo = duracaoCurta(agora - e.desde);
  const daFrente = frente ? `da frente ${frente}` : "";
  if (e.tipo === "comando") {
    const tentativa = e.tentativa && e.tentativas ? `tentativa ${e.tentativa} de ${e.tentativas}` : "";
    const linhas = [
      e.ultimaLinha ? `última linha: ${e.ultimaLinha}` : "",
      [`${e.motivo ? `volta quando ${e.motivo} terminar` : "volta sozinho quando terminar"}`, tentativa, daFrente].filter(Boolean).join(" · "),
    ].filter(Boolean);
    return { titulo: e.comando ?? e.motivo, comando: Boolean(e.comando), linhas, tempo };
  }
  if (e.tipo === "volta") {
    const quando = e.acordaEm ? `Volta ${quandoVolta(e.acordaEm, agora)}` : "Volta marcada";
    return { titulo: quando, comando: false, linhas: [[e.motivo !== "a volta marcada" ? e.motivo : "", daFrente].filter(Boolean).join(" · ")].filter(Boolean), tempo };
  }
  const linhas = [[`pedido enviado ${quandoPediu(e.desde, agora)}`, daFrente].filter(Boolean).join(" · ")];
  const c = colegaNaTela(e, agora);
  const estado = e.colega ? estadoDoColega(e.colega, e.motivo) : "";
  // NOD-377: vencida, "sem resposta há 26h" no lugar de "Leo está livre" (e o tempo à direita sai); cobrada, "cobrado
  // agora · Leo está trabalhando".
  const primeira = c?.vencida && !e.colega?.removido ? c.resumo : [c?.resumo, estado].filter(Boolean).join(" · ");
  const titulo = `Esperando ${e.motivo}`;
  return { titulo, comando: false, linhas: primeira ? [primeira, ...linhas] : linhas, tempo: c?.vencida ? "" : tempo, ...(c ? { colega: c } : {}) };
}

/**
 * NOD-260 (definido em 2026-10-15): o estado do bot esperado no painel "Esperando <bot>" — "Leonardo está trabalhando ·
 * 2 pedidos na fila", "Ada ainda não começou · 1 pedido na fila" (neutro, revisão do Gil no #336), "Leonardo está livre".
 * Excluído (ou que não existe mais): "Leonardo foi removido · a resposta não vem".
 */
export function estadoDoColega(c: NonNullable<EsperaDoDonoDto["colega"]>, nome: string): string {
  if (c.removido) return `${nome} foi removido · a resposta não vem`;
  const fila = c.fila > 0 ? plural(c.fila, "pedido na fila", "pedidos na fila") : "";
  return [c.trabalhando ? `${nome} está trabalhando` : c.fila > 0 ? `${nome} ainda não começou` : `${nome} está livre`, fila].filter(Boolean).join(" · ");
}

/** Quem pediu o que está na fila: "seu pedido", "pedido do Leonardo", "rotina Triagem do Slack". */
export function quemPediu(p: Pick<PedidoNaFilaDto, "de" | "nome">): string {
  if (p.de === "pessoa") return "seu pedido";
  if (p.de === "rotina") return p.nome ? `rotina ${p.nome}` : "uma rotina";
  return `pedido do ${p.nome ?? "colega"}`;
}

/** As frentes da linha aberta e de Trabalhos: as abertas do bot, as que trabalham primeiro; depois as terminadas hoje. */
export function frentesDoBot(lista: readonly TrabalhoDto[], agenteId: string, desdeMeiaNoite: number): { abertas: TrabalhoDto[]; terminadas: TrabalhoDto[] } {
  const doBot = lista.filter((t) => t.agenteId === agenteId);
  const ordem = (t: TrabalhoDto): number => (t.estado === "precisa_de_voce" || t.estado === "fechado_ocioso" ? 0 : t.estado === "rodando" && t.turnoVivoId ? 1 : t.estado === "rodando" ? 2 : 3);
  const abertas = doBot.filter((t) => ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"].includes(t.estado)).sort((a, b) => ordem(a) - ordem(b) || a.criadoEm - b.criadoEm);
  const terminadas = doBot.filter((t) => !abertas.includes(t) && (t.terminadoEm ?? t.criadoEm) >= desdeMeiaNoite).sort((a, b) => (a.terminadoEm ?? a.criadoEm) - (b.terminadoEm ?? b.criadoEm));
  return { abertas, terminadas };
}
