import type { Agente } from "../contracts/agente.ts";
import type { Ligacao } from "../contracts/ligacao.ts";
import type { BotDoOnboarding, EtapaOnboarding } from "../contracts/onboarding.ts";
import type { Turno } from "../contracts/turno.ts";
import type { LinhaOnboarding } from "../repositories/onboarding.repo.ts";
import type { Deps } from "./tipos.ts";

/**
 * O contexto do onboarding por ligação (definido em 2026-10-04, ADR-077) que as ferramentas consultam: separado de
 * onboarding.ts para pedir-acesso e criar-rotina (o `para_bot`) não importarem o resto do onboarding em ciclo.
 */

/** Etapas em que a ligação de onboarding está viva e as ferramentas do onboarding valem. */
const ETAPAS_DA_LIGACAO: readonly EtapaOnboarding[] = ["chamando", "entrevista", "configurando"];

export function botDe(a: Agente | null, conversaId: string | null): BotDoOnboarding | null {
  if (!a || a.excluidoEm !== null || !conversaId) return null;
  return { id: a.id, nome: a.nome, conversaId, forma: a.forma, cor: a.cor };
}

export async function botComConversa(deps: Deps, id: string | null): Promise<BotDoOnboarding | null> {
  if (!id) return null;
  const a = await deps.repos.agentes.buscar(id);
  if (!a || a.excluidoEm !== null) return null;
  const c = await deps.repos.conversas.buscarPropriaDoAgente(a.id);
  return botDe(a, c?.id ?? null);
}

/**
 * O turno está numa ligação de onboarding viva: turno-cérebro (origem 'ligacao') da guia, ligação iniciada pelo produto
 * e o onboarding da pessoa numa das etapas da ligação. Fora disso as três ferramentas recusam.
 */
export async function contextoDoOnboarding(deps: Deps, turnoId: string): Promise<{ linha: LinhaOnboarding; turno: Turno; ligacao: Ligacao } | null> {
  const turno = await deps.repos.turnos.buscar(turnoId);
  if (!turno || turno.origem !== "ligacao" || !turno.ligacaoId) return null;
  const ligacao = await deps.repos.ligacoes.buscar(turno.ligacaoId);
  if (!ligacao || ligacao.iniciadaPor !== "produto") return null;
  const linha = await deps.repos.onboarding.buscar();
  if (!linha.etapa || !ETAPAS_DA_LIGACAO.includes(linha.etapa) || linha.guiaId !== turno.agenteId) return null;
  return { linha, turno, ligacao };
}

/**
 * `para_bot` de pedir_acesso e criar_rotina (ADR-077): só no turno da ligação de onboarding e só para o bot que o
 * onboarding criou (por nome ou id). Devolve o bot e a conversa dele; null = não vale (a ferramenta recusa).
 */
export async function alvoDoParaBot(deps: Deps, turnoId: string, paraBot: string): Promise<{ agenteId: string; conversaId: string; nome: string } | null> {
  const ctx = await contextoDoOnboarding(deps, turnoId);
  if (!ctx) return null;
  const bot = await botComConversa(deps, ctx.linha.botId);
  if (!bot) return null;
  const alvo = paraBot.trim().toLowerCase();
  if (alvo !== bot.id && alvo !== bot.nome.trim().toLowerCase()) return null;
  return { agenteId: bot.id, conversaId: bot.conversaId, nome: bot.nome };
}
