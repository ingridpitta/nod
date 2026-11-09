import type { EpochMs } from "./ids.ts";
import type { EstadoRotina } from "./rotina.ts";

/**
 * definido em 2026-10-23 (NOD-313): a sugestão de ritmo da rotina que roda muitas vezes sem novidade. A rotina NUNCA
 * muda sozinha: o card só sugere, e a mudança é o clique da pessoa.
 */
export type OpcaoRitmo = "espacar" | "uteis" | "pausar" | "deixar";

/** O que o "desfazer" do card restaura: o cron e o estado de antes do clique, e o que o clique deixou. */
export type DesfazerRitmo = { opcao: Exclude<OpcaoRitmo, "deixar">; cronAntes: string; cronDepois: string; fusoAntes: string; fusoDepois: string; estadoAntes: EstadoRotina };

/** A linha de `rotina_ritmo`. `sugeridaEm` não nulo = card aberto. */
export type RitmoRotina = {
  rotinaId: string;
  semNovidadeSeguidas: number;
  sugestaoMensagemId: string | null;
  sugeridaEm: EpochMs | null;
  silenciadaAte: EpochMs | null;
  desfazer: DesfazerRitmo | null;
};

/**
 * O payload do card (mensagem kind 'sistema'). `decisao` nula = esperando o clique; preenchida, a web desenha a linha
 * "✓ … · desfazer". `invalida`: a rotina mudou, foi pausada ou excluída antes do clique — o card fecha sem aplicar nada.
 * `espacar`/`uteis` nulos: a opção não se aplica a este cron (já roda uma vez por dia, já roda só em dias úteis).
 */
export type PayloadRotinaRitmo = {
  kind: "rotina_ritmo";
  rotinaId: string;
  nome: string;
  seguidas: number;
  /** "a cada 30 min". */
  hoje: string;
  cronAtual: string;
  /** A revisão da rotina quando o card nasceu (domain/revisao-rotina.ts): o clique só aplica se ela não mudou. */
  revisao?: string;
  espacar: { cron: string; rotulo: string } | null;
  /** `fusoIana`: o da rotina; o fuso padrão da pessoa quando a rotina está em UTC. */
  uteis: { cron: string; fusoIana: string } | null;
  decisao: { opcao: OpcaoRitmo; em: EpochMs; desfazivel: boolean } | null;
  invalida?: true;
};
