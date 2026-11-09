import type { AtualizacaoDaIa } from "./estado-ia.ts";

/**
 * NOD-8 (definido em 2026-10-22): o passo 1 do login de uma conta numa máquina (ADR-102 item 3). Quando a IA falta ou está
 * abaixo do piso (`PISO_CLI`), a máquina relata a fase `preparando` com este preparo antes de `abrindo`; a tela mostra
 * "Instalando…"/"Atualizando… antes → depois" e, no concluído, a versão que ficou.
 *  - `acao`: instalar (a IA falta) ou atualizar (abaixo do piso);
 *  - `antes`/`depois`: as versões (só dígitos, pontos e o sufixo de pré-release), quando a máquina sabe;
 *  - `linha`: a etapa em curso, em palavras curtas da máquina (sem quebra de linha; a tela escapa).
 *  - `atualizacao` (passo 9, NOD-9 PR 1): o estado do orquestrador da máquina (o mesmo `AtualizacaoDaIa` do inventário),
 *    com o motivo da falha (`sem_espaco` + `espaco`, `sem_internet`, `sem_permissao`…) e o caminho tentado.
 * A falha do preparo termina o login com `erro: "preparo_falhou"` e o motivo em `atualizacao.motivo`. Servidor antigo
 * recusa `preparando` com 400 e o motor repete com `abrindo`; motor antigo nunca o manda.
 */
export type PreparoDoLogin = { acao: "instalar" | "atualizar"; linha?: string; antes?: string; depois?: string; atualizacao?: AtualizacaoDaIa };

export const ACOES_DO_PREPARO = ["instalar", "atualizar"] as const satisfies readonly PreparoDoLogin["acao"][];
