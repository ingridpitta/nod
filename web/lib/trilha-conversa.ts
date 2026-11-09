import type { EventoTrilhaQuadro } from "../../src/contracts/trilha-quadro.ts";

/**
 * NOD-422 (PR 2, revisão do PR #630): a métrica "conversa de membro aberta" conta só quando a CONVERSA do bot fica à vista,
 * não quando a pessoa vai ao Quadro dele. Navegar até a conversa e logo abrir o Quadro (o link da tarefa, o código num chat,
 * o "ir para a tarefa" depois de mover) não conta; voltar da aba Quadro para a Conversa conta.
 *
 * `aVista` diz a conversa que está na tela no modo Conversa (null = outra tela, ou o Quadro à vista ou a caminho). A conta
 * sai adiada (`adiar`): quem navega e em seguida abre o Quadro o faz no mesmo passo, e o adiado relê `aVista` antes de contar.
 */
export type ConversaAVista = { agenteId: string; conversaId: string };
/**
 * Revisão 3 do PR #630: "encoberta" = a conversa escolhida segue aberta, mas algo cobre a tela (a inicial do celular, Seu
 * espaço, o perfil em tela cheia). Não conta e não encerra a visita: ao descobrir, a mesma visita não conta de novo.
 */
export type VisaoDaConversa = ConversaAVista | "encoberta" | null;

/**
 * Revisão 2 do PR #630 (achado médio): a conversa conta só se a pessoa a escolheu (o último `navegar` até ela) e se ela está
 * à vista de verdade: nem a inicial do celular nem o menu da conta por cima, e no modo Conversa, sem o Quadro do bot a caminho.
 * A conversa que o reducer põe sozinho ao abrir o app (resolverInicio) não é uma escolha da pessoa e não conta. Suposição: o
 * app ao fundo (naFrente) não entra aqui, para o Alt-Tab não recontar a mesma visita.
 */
export function conversaDaTrilha(o: {
  tela: { tipo: string; agenteId?: string | null; conversaId?: string };
  escolhida: string | null;
  botsAbertos: boolean;
  espaco: boolean;
  perfil: boolean;
  modo: "conversa" | "quadro";
  aCaminhoDoQuadro: (agenteId: string) => boolean;
}): VisaoDaConversa {
  const t = o.tela;
  if (t.tipo !== "conversa" || !t.agenteId || !t.conversaId || t.conversaId !== o.escolhida) return null;
  if (o.modo !== "conversa" || o.aCaminhoDoQuadro(t.agenteId)) return null;
  if (o.botsAbertos || o.espaco || o.perfil) return "encoberta";
  return { agenteId: t.agenteId, conversaId: t.conversaId };
}

export interface TrilhaDaConversa {
  /** Depois de cada desenho e de cada troca Conversa ↔ Quadro. Idempotente: a mesma conversa à vista conta uma vez. */
  observar(): void;
  /**
   * Uma visita nova à mesma conversa (a pessoa a escolheu de novo vindo da inicial do celular): pode contar outra vez.
   * Com uma conta ainda adiada, não faz nada: aquela conta já é desta visita (revisão 4 do PR #630).
   */
  nova(): void;
}

export function criarTrilhaDaConversa(o: {
  aVista: () => VisaoDaConversa;
  emitir: (e: EventoTrilhaQuadro) => void;
  adiar?: (fn: () => void) => void;
}): TrilhaDaConversa {
  const adiar = o.adiar ?? ((fn: () => void) => { setTimeout(fn, 0); });
  /** A conversa já contada nesta visita (zera quando ela sai da vista: outra tela ou o Quadro). */
  let contada: string | null = null;
  /**
   * Revisão 4 do PR #630 (achado alto: conversa_aberta contava 2 vezes no celular): a conta adiada que ainda não rodou. Só a
   * última agendada emite; uma anterior, ao rodar, vê que não é mais a pendente e sai sem contar.
   */
  let pendente: { conversaId: string; geracao: number } | null = null;
  let geracao = 0;
  return {
    observar(): void {
      const v = o.aVista();
      if (!v) { contada = null; return; }
      if (v === "encoberta" || contada === v.conversaId) return;
      contada = v.conversaId;
      const minha = { conversaId: v.conversaId, geracao: ++geracao };
      pendente = minha;
      adiar(() => {
        if (pendente !== minha) return;
        pendente = null;
        const agora = o.aVista();
        if (agora && agora !== "encoberta" && agora.conversaId === v.conversaId) o.emitir({ acao: "conversa_aberta", agenteId: v.agenteId, conversaId: v.conversaId });
        else if (contada === v.conversaId) contada = null;
      });
    },
    nova(): void {
      if (pendente) return;
      contada = null;
    },
  };
}
