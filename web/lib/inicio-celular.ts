import { formatoData } from "./formato-data.ts";
import { horaMinuto } from "./relogio.ts";
import type { AvisoBot } from "./secoes.ts";

/**
 * NOD-379 (protótipo nod-379 v3, aprovado em 2026-10-28): a tela inicial do nod no celular. A barra de bots deixa de ser
 * gaveta e vira a tela em que o app abre — topo do web, favoritos em grade, conversas em lista de mensageiro e a barra
 * flutuante com Buscar. Aqui fica o que é puro (sem DOM), para os testes lerem sem janela.
 */

const DIA = 86_400_000;
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
const IDX_SEMANA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function diaNoFuso(t: number, fusoIana: string): string {
  return formatoData("en-CA", { timeZone: fusoIana, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}

/**
 * A hora da linha, como num mensageiro: "14:02" hoje, "ontem", o dia da semana nos últimos 7 dias ("seg") e "12/10"
 * antes disso. Futuro (relógio da máquina adiantado) conta como hoje.
 */
export function horaDaLinha(instante: number, agora: number, fusoIana = "UTC"): string {
  const dia = diaNoFuso(instante, fusoIana);
  if (instante >= agora || dia === diaNoFuso(agora, fusoIana)) return horaMinuto(instante, fusoIana);
  if (dia === diaNoFuso(agora - DIA, fusoIana)) return "ontem";
  // "Últimos 7 dias" em dias de calendário: de anteontem até 6 dias atrás o nome do dia não se repete.
  for (let k = 2; k < 7; k++) {
    if (dia === diaNoFuso(agora - k * DIA, fusoIana)) {
      const nome = formatoData("en-US", { timeZone: fusoIana, weekday: "short" }).format(new Date(instante));
      return SEMANA[IDX_SEMANA[nome] ?? 0]!;
    }
  }
  const [, mes = "", d = ""] = dia.split("-");
  return `${d}/${mes}`;
}

/** O prefixo da prévia quando o bot pede algo (o pedido troca a última mensagem na linha). */
export const PREFIXO_DO_PEDIDO: Partial<Record<AvisoBot, string>> = { decisao: "Decisão:", pergunta: "Pergunta:" };

/** Favoritos visíveis antes de "Ver todos": duas linhas de quatro. */
export const FAVORITOS_VISIVEIS = 8;

/**
 * A seção recolhida no celular (critério de design do Gil): mostra quantos bots tem e mantém à vista os que pedem algo —
 * decisão, pergunta ou mensagem nova — e os com alerta. A conversa aberta não conta: na inicial nenhuma está à vista. No computador a regra segue a de
 * `estadoDaSecao` (o aviso sobe para o título); aqui ele fica na própria linha.
 */
export function escondidosNoCelular(recolhida: boolean, bots: readonly { aviso: AvisoBot; alerta: boolean }[]): boolean[] {
  return bots.map((b) => recolhida && !b.aviso && !b.alerta);
}

/**
 * Buscando, a seção (ou a grade de favoritos) sem nenhum resultado some inteira — antes ficava o cabeçalho vazio
 * (critério 6, celular e computador). Recebe, por grupo, se cada item casa e devolve quais grupos esconder.
 */
export function gruposSemResultado(buscando: boolean, grupos: readonly (readonly boolean[])[]): boolean[] {
  return grupos.map((itens) => buscando && !itens.some(Boolean));
}

/** O que a inicial mostra no lugar da lista: a frota ainda não chegou, falhou sem nada em cache, ou não há bots. */
export type EstadoDaLista = "carregando" | "erro" | "vazia" | "lista";

export function estadoDaLista(o: { temFrota: boolean; falhou: boolean; bots: number }): EstadoDaLista {
  if (!o.temFrota) return o.falhou ? "erro" : "carregando";
  return o.bots === 0 ? "vazia" : "lista";
}

/**
 * O voltar da inicial (critério 2): ao entrar numa conversa a partir da inicial, o app empilha uma entrada no histórico
 * do navegador; o ‹ e o voltar do navegador desempilham e mostram a inicial na mesma rolagem. Abrir a conversa direto
 * (link, recarregar) não tem entrada nossa: o ‹ só mostra a inicial, sem `history.back()` (que sairia do app).
 */
export const MARCA_HISTORICO = "nodInicio";

export function voltarPeloHistorico(estadoDoHistorico: unknown): boolean {
  return typeof estadoDoHistorico === "object" && estadoDoHistorico !== null && (estadoDoHistorico as Record<string, unknown>)[MARCA_HISTORICO] === "conversa";
}
