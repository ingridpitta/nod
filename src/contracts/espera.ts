/**
 * Esperas de comando (definido em 2026-10-12, ADR-099 item 4, parte 2 do plano "um dono por bot"). O bot pede ao Nod
 * para rodar um comando que só termina quando a espera acaba (`gh pr checks 845 --watch`); o motor da máquina do turno o
 * roda fora do CLI e o fim acorda o bot na mesma sessão, com o código de saída e as últimas linhas. Só tipos.
 *
 * - `rodando`: pedido gravado; a máquina o roda (ou ainda vai pegar);
 * - `terminou`: o comando saiu sozinho (qualquer código);
 * - `caiu`: não deu para rodar até o fim — a máquina sumiu, a pasta não existe, ou o motor teve de relançar 3 vezes;
 * - `cancelada`: a pessoa parou a task ou a conversa, ou o turno que pediu não terminou bem.
 */
export const ESTADOS_ESPERA = ["rodando", "terminou", "caiu", "cancelada"] as const;
export type EstadoEspera = (typeof ESTADOS_ESPERA)[number];

export type Espera = {
  id: string;
  agenteId: string;
  conversaId: string;
  trabalhoId: string | null;
  /** O turno que pediu; a volta o retoma (a mesma sessão, o mesmo trabalho). */
  turnoId: string;
  /** A chave da máquina do turno de origem (ADR-031): só ela roda o comando. */
  maquinaId: string;
  /** Relativa a `~/nod` (a `pastaDoBot` do plano); null = a casa da máquina. */
  pasta: string | null;
  comando: string;
  motivo: string;
  estado: EstadoEspera;
  codigoSaida: number | null;
  /** As últimas linhas de stdout e stderr juntos, até SAIDA_ESPERA_MAX. */
  saida: string | null;
  /** Por que caiu ou foi cancelada, em frase curta do servidor. */
  motivoFim: string | null;
  quedas: number;
  iniciadaEm: number | null;
  vistoEm: number | null;
  acordouEm: number | null;
  criadoEm: number;
  terminadoEm: number | null;
};

/** O que a máquina recebe ao puxar as esperas: o que ela deve estar rodando agora. `iniciada` = já rodou noutra vida. */
export type EsperaParaRodar = { id: string; comando: string; pasta: string | null; iniciada: boolean };

/**
 * O que a máquina relata de uma espera: que começou (a primeira vez, ou de novo depois de uma queda), que o comando saiu,
 * ou que não deu para rodar (`pasta_ausente`: a pasta do turno não existe mais; `nao_iniciou`: o shell não subiu).
 */
export type RelatoEspera =
  | { id: string; tipo: "iniciou" }
  | { id: string; tipo: "terminou"; codigo: number | null; saida: string }
  | { id: string; tipo: "caiu"; motivo: "pasta_ausente" | "nao_iniciou" };

/** A resposta ao relato: `seguir: false` = a espera não está mais rodando aqui (cancelada, caída, de outra máquina) — mate o grupo. */
export type RespostaRelatoEspera = { seguir: boolean };
