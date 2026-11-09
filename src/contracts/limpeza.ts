/**
 * Os tipos da limpeza das tasks (ADR-088, ADR-096, ADR-099 I5), saídos de ponte.ts em 2026-10-12 para ela caber nas 200
 * linhas da cerca. ponte.ts os reexporta: quem importava de lá segue igual.
 */

/**
 * Uma pasta de task encerrada que o Mac pode limpar (definido em 2026-10-09, ADR-088). `pasta` é relativa a `~/nod`
 * (`<bot>/<slug>`, a forma de `trabalhos.pasta` sem o `~/nod/`). `quando`: `encerrada` = acabou há mais de 3 dias e as
 * worktrees limpas saem; `so_com_pr_mergeado` = acabou há menos, e só sai a worktree cujo PR já foi mergeado.
 * `sem_trabalho` (definido em 2026-10-12, ADR-099 item 9, I5) = frente terminada: a pasta sai na hora só com prova de que
 * não há trabalho nela, senão fica para o caminho da ADR-088/096. App antigo descarta o valor (ponte-http.ts).
 */
export type PastaParaLimpar = { trabalhoId: string; pasta: string; quando: "encerrada" | "so_com_pr_mergeado" | "sem_trabalho" };

/**
 * O que o Mac relata de uma passada da limpeza (ADR-088): só números e motivos, nunca caminho (o slug da pasta vem do
 * título da task). `liberadoBytes` é a diferença do espaço livre do volume antes e depois de cada remoção (o `du`
 * mente com os clones APFS do pnpm). `orfas`: worktrees na raiz das pastas dos bots, fora de qualquer task — contadas,
 * nunca apagadas; `orfasParadas` as sem mexer há 2 dias ou mais.
 */
export type RelatoLimpeza = {
  pastas: number;
  removidas: number;
  pastasApagadas: number;
  liberadoBytes: number;
  puladas: Partial<Record<MotivoPuladaLimpeza, number>>;
  orfas: number;
  orfasParadas: number;
  duracaoMs: number;
  /**
   * Revisão do #225 (`NOD_LIMPEZA_TASKS=simular`): a passada fez todas as checagens e não apagou nada. `removidas` e
   * `pastasApagadas` contam o que sairia; `estimadoBytes` é o `du` das worktrees que sairiam.
   */
  simulada?: boolean;
  estimadoBytes?: number;
  /** Segunda revisão do #225: o Docker está instalado e não respondeu — a passada não mexeu em nada. */
  adiada?: boolean;
  /** ADR-099 (I5): a passada só da frente que acabou de terminar (`limparAgora`), fora das 6 h. */
  imediata?: boolean;
  /** ADR-096: a passada foi disparada pelo disco apertado (fora das 6 h). */
  apertada?: boolean;
  /** ADR-096: o que os caches de pacote (npm, pnpm) liberaram na passada apertada, pelo `statfs`. */
  cachesBytes?: number;
  /**
   * ADR-096 §4: pastas (de task ou órfãs) guardadas compactadas em `~/nod/.guardado` e apagadas, o tamanho dos guardados,
   * os guardados vencidos apagados e as órfãs da raiz que saíram (limpas, sem guardar).
   */
  guardadas?: number;
  guardadoBytes?: number;
  guardadosVencidos?: number;
  orfasRemovidas?: number;
  /**
   * NOD-295 A (definido em 2026-10-19): clones (`.git` pasta) dentro da pasta da task provados idênticos ao remoto e
   * apagados sem guardar (na simulação, os que sairiam). `puladas.clone` passa a contar só os que ficaram.
   */
  clonesApagados?: number;
  /**
   * ADR-106: quantas pastas a máquina mandou (como código), quantas ficaram de fora pelo teto e quantas o servidor
   * ofereceu. O bug de 15/10 passou 3 dias calado ("1 pasta"); com estes números o log mostra o corte.
   */
  pastasEnviadas?: number;
  pastasCortadas?: number;
  candidatos?: number;
};
/**
 * Revisão do #225: `aninhado` (outra worktree ou repositório dentro dela), `ignorado_valioso` (arquivo ignorado que não
 * se refaz), `head_solto` (commit fora de qualquer branch, remoto ou tag), `em_uso` (um turno deste Mac roda na pasta) e
 * `nao_reconfirmada` (o servidor não confirmou de novo logo antes de apagar). ADR-096 §4: `processo_vivo` (um `*.pid`
 * da pasta aponta para um processo vivo, como um Postgres de teste) e `grande_demais` (o guardado passaria de 2 GB).
 * ADR-099 (I5): `sem_prova` (a pasta `sem_trabalho` não provou que não há trabalho; fica, o detalhe vai no log).
 * ADR-106: `clone_sumiu` (a worktree aponta para um clone dentro de `~/nod` que já foi apagado; o git não a enxerga mais
 * e ela só sai guardando antes) e `clone_em_uso` (a pasta tem um clone com worktree viva, travada ou num disco que não
 * está montado fora dela; a pasta fica). NOD-295 A (2026-10-19): `clone` conta os clones achados na pasta que NÃO
 * provaram ser idênticos ao remoto (o detalhe vai no log `limpeza_clone_fica`); o clone provado sai e conta em
 * `clonesApagados`. ADR-128 (2026-10-26): `sem_espaco` (guardar levaria o disco abaixo do vermelho de 3 GB; a pasta fica
 * até sobrar espaço).
 */
export type MotivoPuladaLimpeza = "suja" | "travada" | "montagem" | "pr_nao_mergeado" | "clone" | "fora_da_pasta" | "aninhado" | "ignorado_valioso" | "head_solto" | "em_uso" | "nao_reconfirmada" | "erro" | "processo_vivo" | "grande_demais" | "sem_prova" | "clone_sumiu" | "clone_em_uso" | "sem_espaco";
