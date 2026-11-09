import type { Decisao } from "../contracts/decisao.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { EstadoFio } from "../contracts/pedido.ts";
import type { EstadoTurno } from "../contracts/turno.ts";

/**
 * O fio da pergunta (emenda da ADR-045, definido em 2026-09-24): a pergunta de pedir_a_pessoa fica
 * aberta enquanto o agente ainda precisa da pessoa, e fecha sozinha quando ele segue. Cada rodada é uma
 * decisão (prazo e opções próprios) com `fioId` apontando a primeira; o estado do fio é DERIVADO da
 * última rodada e do turno que a resposta dela criou — sem coluna nova de estado. Quem decide se uma
 * mensagem é resposta ou pedido de explicação é o agente (perguntando de novo ou não), nunca a tela.
 */

/** A primeira decisão do fio: a própria, quando ela o começa. */
export function chaveDoFio(d: Pick<Decisao, "id" | "fioId">): string {
  return d.fioId ?? d.id;
}

/** Decisões agrupadas por fio, cada fio da primeira rodada para a última. */
export function agruparFios<T extends Pick<Decisao, "id" | "fioId" | "criadoEm">>(decisoes: readonly T[]): Map<string, T[]> {
  const fios = new Map<string, T[]>();
  for (const d of decisoes) fios.set(chaveDoFio(d), [...(fios.get(chaveDoFio(d)) ?? []), d]);
  for (const rodadas of fios.values()) rodadas.sort((a, b) => Date.parse(a.criadoEm) - Date.parse(b.criadoEm) || (a.fioId === null ? -1 : b.fioId === null ? 1 : 0));
  return fios;
}

/** A rodada de uma decisão no fio (1 = a primeira pergunta); fora do fio, 1. */
export function rodadaNoFio(rodadas: readonly Pick<Decisao, "id">[], decisaoId: string): number {
  return Math.max(0, rodadas.findIndex((d) => d.id === decisaoId)) + 1;
}

/**
 * O estado do fio pela ÚLTIMA rodada. Aberta = esperando você. Respondida: enquanto o turno de retomada
 * que a resposta criou estiver na fila ou rodando, o agente está lendo; terminado (ou desconhecido —
 * resposta anterior ao fio, ou decisão de sala sem turno), a pergunta está resolvida. Terminado inclui
 * o turno interrompido: a pessoa já respondeu e não deve nada; a queda tem o seu próprio aviso e, se o
 * "Retomar" perguntar de novo, a pergunta volta a este fio (pedir-a-pessoa.ts).
 */
export function estadoDoFio(ultima: Pick<Decisao, "estado" | "desfecho">, retomada: EstadoTurno | null): EstadoFio {
  switch (ultima.estado) {
    // ADR-115: em revisão ainda espera (nunca acontece com pergunta, mas o estado existe desde a 0093).
    case "pendente":
    case "reaberta":
    case "em_revisao":
      return "esperando_voce";
    case "vencida":
      return "vencida";
    case "decidida":
      if (ultima.desfecho?.tipo === "dispensada") return "deixada_pra_la";
      return retomada === "pendente" || retomada === "despachando" ? "lendo_sua_mensagem" : "resolvida";
  }
}

/**
 * As mensagens do fio, na ordem da conversa: as perguntas (payload pedido_a_pessoa), as respostas
 * (resposta_a_pedido) e as falas de TEXTO do agente nos turnos que abriram a 2ª rodada em diante — as
 * retomadas que explicaram e perguntaram de novo. O turno da primeira pergunta fica de fora (é o trabalho
 * de antes do fio), e a retomada que seguiu sem perguntar também: a fala dela é o resultado, não o fio.
 */
export function mensagensDoFio(rodadas: readonly Pick<Decisao, "id" | "turnoId">[], mensagens: readonly Mensagem[]): Mensagem[] {
  const ids = new Set(rodadas.map((d) => d.id));
  const turnos = new Set(rodadas.slice(1).flatMap((d) => (d.turnoId ? [d.turnoId] : [])));
  return mensagens.filter((m) => {
    const p = m.payload;
    if (p?.kind === "pedido_a_pessoa" || p?.kind === "resposta_a_pedido") return ids.has(p.decisaoId);
    // NOD-353: a fala com o resumo das ações (payload acoes_do_turno) continua fala — é a explicação da retomada que usou ferramentas.
    return (p === null || p.kind === "acoes_do_turno") && m.kind === "texto" && m.autoria.autor_tipo === "agente" && m.turnoId !== null && turnos.has(m.turnoId);
  });
}

/** definido em 2026-09-24: o histórico do fio na entrada da retomada leva as 10 últimas mensagens. */
export const HISTORICO_DO_FIO_MAX = 10;
/** definido em 2026-09-24: cada mensagem do histórico cabe em 400 caracteres — o bastante para uma explicação curta. */
export const HISTORICO_CARACTERES = 400;

function aparar(texto: string, max: number): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  const letras = [...limpo];
  return letras.length <= max ? limpo : `${letras.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * As linhas do histórico que a retomada recebe (responder-decisao.ts): a retomada de rotina roda em
 * sessão nova e só sabe o que a entrada diz, então a 2ª rodada em diante leva as perguntas, as respostas
 * e as explicações anteriores — as últimas HISTORICO_DO_FIO_MAX, cada uma aparada.
 */
export function historicoDoFio(mensagens: readonly Mensagem[], nomeDaPessoa: (id: string) => string): string[] {
  return mensagens.slice(-HISTORICO_DO_FIO_MAX).map((m) => {
    const quem = m.autoria.autor_tipo === "pessoa" ? `${nomeDaPessoa(m.autoria.autor_id)} respondeu` : m.payload?.kind === "pedido_a_pessoa" ? "Você perguntou" : "Você explicou";
    return `- ${quem}: ${aparar(m.texto, HISTORICO_CARACTERES)}`;
  });
}
