import type { EpochMs } from "./ids.ts";

/**
 * definido em 2026-10-28 (NOD-54, ADR-134): checkpoints de arquivos por turno — o que um turno mudou nos arquivos da
 * máquina dele e o desfazer. A foto mora na máquina (git sombra em `~/nod/.checkpoints/<bot>.git`); o servidor só guarda o
 * resumo, o estado e o pedido de desfazer, que a máquina PUXA (ADR-021, molde das esperas da ADR-099).
 */

/** O que o turno fez com o arquivo. */
export type AcaoNoArquivo = "criado" | "mudado" | "apagado";

/** Um arquivo do checkpoint: `caminho` como a tela mostra, relativo à casa (`~/nod/Bot/x.md`, `~/Documents/x.md`). */
export type ArquivoDoCheckpoint = { caminho: string; acao: AcaoNoArquivo };

/** Teto da lista que viaja (a tela mostra 5 e "mais N"); `total` é o número real. */
export const TETO_ARQUIVOS_DO_CHECKPOINT = 200;

/** O resumo que a máquina manda na entrega do turno (`ResultadoTurno.checkpoint`): só quando houve mudança coberta. */
export type ResumoCheckpoint = { arquivos: ArquivoDoCheckpoint[]; total: number };

/** Os estados do checkpoint no servidor (0120). */
export const ESTADOS_CHECKPOINT = ["disponivel", "desfazendo", "desfeito", "vencido", "falhou"] as const;
export type EstadoCheckpoint = (typeof ESTADOS_CHECKPOINT)[number];

/**
 * O que o desfazer fez com cada arquivo:
 * - `voltou`: está como antes do turno;
 * - `mesclado`: outro turno mudou outra parte depois; a parte deste turno saiu e a outra ficou;
 * - `conflito`: mudou depois nas mesmas linhas (ou não dá para mesclar): ficou como está, a pessoa pode forçar;
 * - `erro`: não deu para ler ou gravar (permissão, objeto sumido) — ficou como está.
 */
export const DESFECHOS_ARQUIVO = ["voltou", "mesclado", "conflito", "erro"] as const;
export type DesfechoArquivo = (typeof DESFECHOS_ARQUIVO)[number];

export type ResultadoDesfazer = { arquivos: { caminho: string; desfecho: DesfechoArquivo }[] };

/**
 * O resultado como o servidor o guarda e a web o lê: os arquivos com teto (os que pedem atenção primeiro: conflito, erro,
 * mesclado, voltou) e a contagem real de cada desfecho.
 */
export type ResultadoGuardado = ResultadoDesfazer & { contagem: Record<DesfechoArquivo, number> };

/** Por que o desfazer não rodou: a máquina não tem mais a foto (venceu, outra máquina) ou caiu num erro. */
export type FalhaDesfazer = "sem_checkpoint" | "erro";

/**
 * O que a máquina deve desfazer agora (GET maquina/:chave/desfazeres). `forcar`: caminhos em conflito que a pessoa mandou
 * voltar. `tentativa`: o número do pedido (sobe a cada pedido do mesmo turno) — o relato o devolve, e o relato de uma
 * tentativa velha (a resposta que se perdeu e foi reenviada) não fecha a nova.
 */
export type DesfazerParaRodar = { turnoId: string; pastaDoBot: string; forcar: string[]; tentativa: number };

/** O relato da máquina: progresso (`feitos` de `total`) e, no fim, o resultado ou a falha, da `tentativa` que ela puxou. */
export type RelatoDesfazer = { turnoId: string; tentativa: number; feitos: number; total: number; resultado?: ResultadoDesfazer; falha?: FalhaDesfazer };

/** O checkpoint da fala final de um turno, como a web o recebe na leitura da conversa. */
export type CheckpointDaFala = {
  estado: EstadoCheckpoint;
  arquivos: ArquivoDoCheckpoint[];
  total: number;
  /** Desfazendo: quantos já foram. */
  feitos?: number;
  desfeitoEm?: EpochMs;
  resultado?: ResultadoGuardado;
  falha?: FalhaDesfazer;
};

/**
 * definido em 2026-10-28 (NOD-54, ADR-134): o que o turno mudou nos arquivos desta máquina (a foto mora nela, no git
 * sombra), parte do `ResultadoTurno`. Ausente = nada mudou, a foto não coube no prazo ou o hook não guardou um original:
 * o turno fica sem "Desfazer".
 */
export type CheckpointDoResultado = { checkpoint?: ResumoCheckpoint };
