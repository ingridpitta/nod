import type { EsforcoAgente } from "./agente.ts";
import { MODELO_LUNA_CODEX, type IdHarness } from "./harness.ts";

/**
 * definido em 2026-09-17: agentes usam o alias Sonnet do CLI. NOD-164 (2026-10-05): as sondas saem do Haiku 4.5
 * (aposentadoria não antes de 2026-10-15) e usam o Sonnet 4.6 pelo id.
 */
export const MODELO_AGENTE_PADRAO = "sonnet";
export const MODELO_SONDA_PADRAO = "claude-sonnet-4-6";

/**
 * NOD-164 (emenda à ADR-072): o modelo da ligação, por harness, resolvido no SERVIDOR (`NOD_MODELO_LIGACAO_CLAUDE`/
 * `_CODEX`, lidas por `lerModelosLigacao`) e levado no plano; a troca por env no app saiu (a denylist `NOD_` a
 * apagava). Fixo pelo id (um alias pode mudar de modelo sem aviso). As opções de voz só existem no Claude: `esforco`
 * vira `--effort` e `pensamentoAdaptativo:false` vira `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` no driver. O padrão é
 * o Sonnet 5.5 com esforço low e sem thinking adaptativo, escolhido pela sonda paga de 2026-10-05 (docs/uat-modo-ligacao.md,
 * "Sonda de modelos"): o único candidato com TTFT quente perto de 1 s e custo abaixo de 3x o Haiku; o Sonnet 4.6 ficou
 * mais lento e mais caro. Trocar ou reverter é uma linha no `infra/gcp/config.env` mais o redeploy. O Codex usa o Luna
 * do catálogo (MODELO_LUNA_CODEX, NOD-167).
 */
export type ConfigModeloLigacaoClaude = { modelo: string; esforco?: EsforcoAgente; pensamentoAdaptativo: boolean };
export type ModelosLigacao = { "claude-cli": ConfigModeloLigacaoClaude; "codex-cli": { modelo: string } };
export const MODELOS_LIGACAO_PADRAO: ModelosLigacao = {
  "claude-cli": { modelo: "claude-sonnet-5-5", esforco: "low", pensamentoAdaptativo: false },
  "codex-cli": { modelo: MODELO_LUNA_CODEX },
};

/**
 * definido em 2026-10-04: a guia do onboarding no "auto" roda no modelo mais potente do harness no chat (revisto em
 * 2026-10-05, NOD-164: na ligação ela usa o modelo de voz das outras, MODELOS_LIGACAO_PADRAO/config).
 * No Claude é o alias `fable` (Claude Code 2.1.289: resolve para claude-fable-5-1), que acompanha o Fable mais novo sem
 * release; medido no mesmo dia, `--model fable` com MAX_THINKING_TOKENS=0 respondeu em 1,8 s, como o Haiku. No Codex é
 * o topo do catálogo editorial. Harness fora da tabela (ainda sem catálogo) não tem mais potente: a guia fica no modelo
 * escolhido (NOD-207: a tabela decide, não o id).
 */
export const MODELO_MAIS_POTENTE: Partial<Record<IdHarness, string>> = { "claude-cli": "fable", "codex-cli": "gpt-6-astra" };

/**
 * NOD-9 (definido em 2026-10-22, plano do Arquiteto de 20/10, passo 2): a versão mínima do CLI para os apelidos que não
 * estão no catálogo (MODELO_MAIS_POTENTE). O `fable` só existe a partir do Claude Code 2.1.289 (medido em 2026-10-04);
 * abaixo disso o CLI recusa o `--model`. A atualização mira a maior entre o piso (PISO_CLI) e esta.
 */
export const VERSAO_MINIMA_POR_APELIDO: Partial<Record<IdHarness, Readonly<Record<string, string>>>> = { "claude-cli": { fable: "2.1.289" } };
