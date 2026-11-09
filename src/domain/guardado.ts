import { CACHES_DE_FERRAMENTA } from "./limpeza-das-tasks.ts";

// Saiu de limpeza-das-tasks.ts em 2026-10-12 (ADR-099, I5), sem mudar nada, para aquele arquivo caber nas 200 linhas.

/**
 * ADR-096 §4 (definido em 2026-10-11): o que a limpeza não pode apagar sem perder (worktree suja, ignorado valioso, HEAD
 * solto, repositório dentro, as sobras da task fora de worktree) é GUARDADO compactado em `~/nod/.guardado/<bot>/`, sem
 * o que se refaz, e só então a pasta sai. Na VM dos bots em 11/10 isso era ~3 GB de `pgdata`, logs e ferramentas, mais
 * 5 worktrees com alterações por commitar, todos parados para sempre.
 *
 * - o guardado vence em 30 dias, ou em 7 com o disco apertado;
 * - acima de 2 GB compactado, a pasta fica (`grande_demais`): guardar não pode encher o disco que se quer liberar;
 * - a worktree órfã da raiz do bot (ADR-088 §5) sai parada há 30 dias, ou há 7 com o disco apertado, nunca com um turno
 *   daquele bot rodando. Limpa, sai como a da task; com algo a guardar, é guardada antes.
 */
export const GUARDADO_VENCE_MS = 30 * 24 * 3_600_000;
export const GUARDADO_VENCE_APERTADO_MS = 7 * 24 * 3_600_000;
export const GUARDADO_MAX_BYTES = 2 * 1024 ** 3;
export const ORFA_SAI_MS = 30 * 24 * 3_600_000;
export const ORFA_SAI_APERTADO_MS = 7 * 24 * 3_600_000;

/**
 * O que nunca entra no guardado: dependência e cache de ferramenta, em qualquer nível (o nome basta para o `tar`).
 * NOD-295 A (2026-10-19): também o Postgres de teste descartável do gamefik (`.local-output/disposable-pg-*`), que o
 * próprio nome diz que se joga fora — o guardado só é feito sem processo vivo na pasta (`processo_vivo`).
 */
export const FORA_DO_GUARDADO: readonly string[] = ["node_modules", ...CACHES_DE_FERRAMENTA, "disposable-pg-*"];

/** O guardado venceu? (pela hora da última mudança do arquivo) */
export function guardadoVencido(mtime: number, agora: number, apertado: boolean): boolean {
  return agora - mtime >= (apertado ? GUARDADO_VENCE_APERTADO_MS : GUARDADO_VENCE_MS);
}

/** A órfã parada há tempo bastante para sair? */
export function orfaSai(ultimaMudanca: number, agora: number, apertado: boolean): boolean {
  return agora - ultimaMudanca >= (apertado ? ORFA_SAI_APERTADO_MS : ORFA_SAI_MS);
}

/**
 * Um nome seguro para uma referência git (`refs/nod/guardado/<rotulo>/<nome>`): só letras, números, `.`, `_` e `-`, sem
 * começar por `.` nem terminar em `.lock`, nunca vazio.
 */
export function pedacoDeRef(nome: string): string {
  const limpo = nome.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/\.{2,}/g, ".").replace(/^[.-]+|[.-]+$/g, "").replace(/\.lock$/i, "-lock").slice(0, 80);
  return limpo === "" ? "x" : limpo;
}
