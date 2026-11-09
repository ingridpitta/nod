/**
 * O marcador que o Claude Code entende como fim da parte cacheável do prompt de sistema: o que vem antes vira prefixo
 * de cache; o que vem depois muda à vontade sem invalidar esse prefixo. Só vale no `--system-prompt` (o
 * `--append-system-prompt` o ignora; medido no CLI 2.1.290, ADR-080). Usado pelo prompt de voz (ADR-072) e, desde a
 * NOD-183, pelo driver de texto do claude-cli.
 */
export const MARCADOR_PARTE_DINAMICA = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";
