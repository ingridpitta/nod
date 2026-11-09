import type { EpochMs } from "./ids.ts";

/**
 * Artefato do nod (ADR-051): HTML que o bot publica e que aparece DENTRO da conversa, interativo e com
 * estado salvo por pessoa. O HTML é do bot e é não confiável: a web o roda em iframe sandbox sem
 * allow-same-origin e sem rede. Os tetos abaixo são os CHECKs da 0031 — a web repete os números (só
 * importa tipos de src) e tests/unit/web/artefato.test.ts confere que batem.
 */

/** definido em 2026-09-28: um título de card, uma linha. */
export const TITULO_MAX_ARTEFATO = 120;
/** definido em 2026-09-28: 500 000 caracteres — um relatório grande com CSS e JS inline cabe folgado. */
export const HTML_MAX_ARTEFATO = 500_000;
/** definido em 2026-09-28: 64 KB do JSON do estado (texto do jsonb) — marcações de checklist ocupam centenas de bytes. */
export const ESTADO_MAX_BYTES_ARTEFATO = 65_536;
/** definido em 2026-09-28: o quanto de HTML ler_artefato devolve ao modelo; o resto vira marca de corte. */
export const HTML_MAX_LEITURA_ARTEFATO = 60_000;
/*
 * O resultado de ler_artefato passa pelo corte do proxy como todo resultado (ORCAMENTO_RESULTADO_CHARS, 75 000
 * desde 2026-09-28, com o resto em ler_mais). O estado vem antes do HTML no JSON: se algo for cortado, é o
 * fim do HTML, nunca o que a pessoa marcou.
 */

export type Artefato = {
  id: string;
  agenteId: string;
  conversaId: string;
  titulo: string;
  versaoAtual: number;
  criadoEm: EpochMs;
  atualizadoEm: EpochMs;
};

export type VersaoArtefato = {
  artefatoId: string;
  versao: number;
  html: string;
  mensagemId: string | null;
  criadoEm: EpochMs;
};

/** O estado é da pessoa que marcou (RLS por owner_id): outra pessoa não o lê nem o escreve. */
export type EstadoArtefato = { artefatoId: string; dados: unknown; atualizadoEm: EpochMs };

/** GET artefatos/:id (versão atual) e GET artefatos/:id/versoes/:versao: o HTML chega aqui, nunca na mensagem. */
export type ArtefatoDto = {
  artefato: Artefato;
  versao: { versao: number; html: string; criadoEm: EpochMs };
  estado: { dados: unknown; atualizadoEm: EpochMs } | null;
};
