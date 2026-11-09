import type { AtualizacaoDaIa } from "./estado-ia.ts";
import type { EpochMs } from "./ids.ts";

/**
 * Por que uma IA com login feito não serve (definido em 2026-10-05, emenda da ADR-019). A sonda de login diz só
 * "logado"; o TESTE (um turno de uma frase) é o que mostra que a conta responde. Código fechado, nunca o texto do
 * fornecedor: o servidor aceita só estes valores de um Mac e escreve ele mesmo a frase.
 *  - `conta_sem_acesso`: a conta entrou, mas a organização dela desativou o uso por assinatura (medido em produção em
 *    2026-10-05: "Your organization has disabled Claude subscription access for Claude Code");
 *  - `teste_falhou`: o teste não teve resposta por outro motivo (sem rede, limite, erro do fornecedor).
 */
export const CAUSAS_SEM_IA = ["conta_sem_acesso", "teste_falhou"] as const;
export type CausaSemIa = (typeof CAUSAS_SEM_IA)[number];

/**
 * Por que a sonda não chegou a 'pronto' quando a razão não é o binário nem a conta (NOD-178). O estado continua
 * fail-closed (ADR-019, sem quarto estado); a causa é o que a UI e as mensagens leem para não dizer "Instale".
 * `sonda_lenta`: o `--version`/`--help`/`auth status` estourou o prazo (Mac carregado).
 * `cli_antigo` (NOD-171): o CLI está instalado, mas abaixo do piso testado (`PISO_CLI`); só em `ausente`, com `versao` e
 * `minima`, para a frase dizer "Atualize", não "Instale".
 * `atualizando` (NOD-9, definido em 2026-10-22): o nod está atualizando o CLI naquela máquina; só em `ausente`. O servidor
 * a trata como `sonda_lenta` na fila: o turno fixado nessa IA espera, não é recusado (o app antigo nunca a manda).
 */
export type CausaInventario = "sonda_lenta" | "cli_antigo" | "atualizando" | CausaDoMac;

/**
 * Causas que só o app do Mac distingue (definido em 2026-10-09, teste do Breno). revisto em 2026-10-10 (PR 2 do plano das
 * IAs): o servidor as aceita no anúncio (`ponte-validacao.ts`) e escreve a frase dele (MOTIVO_DA_CAUSA_DO_MAC); antes as
 * reduzia ao estado sem causa. A tela do Mac lê as duas pelo estado único da IA (src/contracts/estado-ia.ts).
 *  - `sem_node`: o CLI é um script `#!/usr/bin/env node` e não há node no PATH (o "env: node: No such file" do
 *    `--version`); antes aparecia como "Atualize o Codex";
 *  - `config_invalida`: o CLI recusou a própria configuração (`~/.codex/config.toml` com erro ou chave desconhecida);
 *    não é falta de login, e entrar de novo não resolve. Vai em `ausente` (o CLI não serve como está), nunca em
 *    `nao_autenticado`, para não se confundir com "falta entrar".
 */
export const CAUSAS_DO_MAC = ["sem_node", "config_invalida"] as const;
export type CausaDoMac = (typeof CAUSAS_DO_MAC)[number];

/**
 * A IA chegou ao limite da assinatura (definido em 2026-10-10, emenda da ADR-036). Nunca vem do Mac: o SERVIDOR grava
 * o limite quando um turno volta com `limite_do_plano` (ou o texto de limite do Codex) e o sobrepõe ao inventário que o
 * Mac anunciou, em `nao_autenticado` com `renovaEm` (a conta entrou, mas não responde até lá). Passado `renovaEm`, a IA
 * volta a valer pelo que o Mac anuncia.
 */
export const CAUSA_LIMITE = "limite";

/**
 * Snapshot da sonda (ADR-019): três estados, motivo escrito, versão do CLI e instante.
 * SEM email nem identidade do fornecedor — proibida para autorização e não gravada.
 * `causa` em `nao_autenticado`: um teste de verdade reprovou uma IA logada (CausaSemIa) ou a sonda só demorou
 * (`sonda_lenta`); sem causa = não há login, que é o `nao_autenticado` de sempre. Em `ausente`, `sonda_lenta` ou
 * `cli_antigo` (este com a `versao` instalada e a `minima` exigida). `limite` (só do servidor) traz `renovaEm`.
 * `atualizacao` (NOD-9): a fase da atualização do CLI naquela máquina, validada e reescrita pelo servidor (ponte-validacao).
 */
export type Inventario =
  | { estado: "ausente"; motivo: string; causa?: CausaInventario; versao?: string; minima?: string; atualizacao?: AtualizacaoDaIa; em: EpochMs }
  | { estado: "nao_autenticado"; motivo: string; versao?: string; causa?: CausaSemIa | "sonda_lenta" | typeof CAUSA_LIMITE; renovaEm?: EpochMs; atualizacao?: AtualizacaoDaIa; em: EpochMs }
  | { estado: "pronto"; versao: string; atualizacao?: AtualizacaoDaIa; em: EpochMs };

/** A frase de cada causa, para quem só tem o código (o servidor, ao receber o anúncio de um Mac). */
export const MOTIVO_DA_CAUSA: Record<CausaSemIa, string> = {
  conta_sem_acesso: "A conta entrou, mas está sem acesso: a organização dela desativou o uso por assinatura.",
  teste_falhou: "A conta entrou, mas não respondeu ao teste.",
};

/** A frase das causas do Mac, escrita pelo servidor (`{nome}` = o nome da IA). Texto do Mac nunca vira motivo. */
export const MOTIVO_DA_CAUSA_DO_MAC: Record<CausaDoMac, string> = {
  sem_node: "{nome} precisa do Node, e este computador não tem o Node instalado.",
  config_invalida: "A configuração do {nome} neste computador tem um erro; entrar de novo não resolve.",
};
