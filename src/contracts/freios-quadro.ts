import type { AutorLote, IdColuna } from "./quadro.ts";

/**
 * Os freios e as travas da esteira do quadro (definido em 2026-11-02, NOD-419). Só tipos (EMENDA 26): o domínio puro mora
 * em src/domain/freios-quadro.ts, o banco na 0140.
 */

/**
 * As travas opcionais de uma coluna. `saiPara`: a tarefa só sai daqui para estas colunas (vale para a pessoa e para o
 * agente). `soPessoa`: só a pessoa tira a tarefa daqui (o agente não). "Precisa de você" e Bloqueado são saída sempre:
 * pedir ajuda nunca fica travado.
 */
export type TravaColuna = { saiPara?: IdColuna[]; soPessoa?: boolean };

/**
 * O que aconteceu na tarefa. `mover` = mudou de coluna ou de responsável; `nao_e_comigo` = o agente recusou (com o
 * motivo); `laco` = ida e volta demais entre as mesmas colunas (foi para Bloqueado sem acionar); `freio` = acionamentos
 * demais na hora (foi para Bloqueado sem acionar; no comentário de bot, fica na coluna sem acionar); `desfazer` = um
 * movimento desfeito; `acionou` = um bot foi acionado sem a tarefa mudar (o recomeço no lote, ou o comentário e o
 * pedir_a_bot com a tarefa, sem lote: aí `agenteDepois` é o bot acionado). O agente não desfaz `laco`, `freio` nem o
 * `nao_e_comigo` além do limite que levou a Bloqueado (paradaDaPessoa em src/domain/freios-quadro.ts); a pessoa desfaz.
 */
export const TIPOS_MOVIMENTO = ["mover", "nao_e_comigo", "laco", "freio", "desfazer", "acionou"] as const;
export type TipoMovimento = (typeof TIPOS_MOVIMENTO)[number];

export type MovimentoTarefa = {
  id: string;
  tarefaId: string;
  tipo: TipoMovimento;
  de: IdColuna;
  para: IdColuna;
  agenteAntes: string | null;
  agenteDepois: string | null;
  autor: AutorLote;
  motivo: string | null;
  /** Este movimento abriu um turno do responsável (o freio conta estes). */
  acionou: boolean;
  /** O lote em que aconteceu (o Desfazer do lote marca os dele como desfeitos). */
  loteId: string | null;
  /** `desfazer`: o movimento que este desfez (o Desfazer do lote que o trouxe tira a marca de desfeito dele). */
  desfaz: string | null;
  /** O motivo foi escrito por um agente (ADR-047): texto de bot é dado de fora. */
  deFora: boolean;
  desfeitoEm: number | null;
  criadoEm: number;
};

/** O movimento que o plano manda gravar (a tarefa nova ainda tem o id `novo:N`). */
export type NovoMovimento = Omit<MovimentoTarefa, "id" | "loteId" | "desfeitoEm" | "criadoEm" | "desfaz" | "deFora"> & { desfaz?: string; deFora?: true };

/** Como a tela mostra (os nomes já resolvidos; o histórico discreto da tarefa aberta). */
export type MovimentoDto = MovimentoTarefa & { autorNome: string | null; agenteAntesNome: string | null; agenteDepoisNome: string | null };

/** NOD-419: as ops dos freios no gerir_quadro (entram em OpQuadro, src/contracts/quadro.ts). */
export type OpFreio =
  | { tipo: "travar_coluna"; coluna: string; sai_para?: string[] | null; so_pessoa?: boolean }
  | { tipo: "nao_e_comigo"; tarefa: string; motivo: string }
  /** Sem `movimento`: o último movimento desfazível da tarefa (o resumo do gerir_quadro traz os ids). */
  | { tipo: "desfazer_movimento"; tarefa: string; movimento?: string };

/**
 * Revisão do PR #629: os últimos movimentos que ainda valem (o mais novo primeiro), com o id que o desfazer_movimento
 * recebe. Sem o motivo (texto de bot; o histórico da tela mostra). `por` = o bot que moveu, ou "pessoa".
 */
export type MovimentoParaBot = { id: string; de: IdColuna; para: IdColuna; por: string; /** Laço, freio ou 4º passe em Bloqueado: o agente não desfaz (revisões 3 e 10 do PR #629). */ so_a_pessoa_desfaz?: true };
