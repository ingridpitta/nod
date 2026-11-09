import { createHash } from "node:crypto";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { revisaoDaRotina } from "../domain/revisao-rotina.ts";
import { autoriaPessoa, evento } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";

/**
 * definido em 2026-10-23 (NOD-313, revisão do PR): o que o card de ritmo divide com a edição, a pausa manual e a exclusão
 * da rotina — sem importar `pausar-rotina` (que o importa), para não fechar ciclo.
 */

/** A revisão da rotina que o card guarda ao nascer: o clique só aplica se a rotina ainda for aquela (cron, fuso, texto). */
export function revisaoDoRitmo(rotina: Rotina): string {
  return revisaoDaRotina(rotina, (texto) => createHash("sha256").update(texto).digest("hex"));
}

/** O evento que faz a web (e a outra tela aberta) reler a conversa e a lista de rotinas depois de o card mudar. */
export function eventoDoCard(deps: Pick<Deps, "escopo" | "agora">, rotina: Rotina, origem: string): RuntimeEvent {
  return evento(deps, "rotina_atualizada", autoriaPessoa(deps.escopo.pessoaId), { rotinaId: rotina.id, proximaExecucao: rotina.proximaExecucao, fusoIana: rotina.fusoIana, origem }, { conversaId: rotina.conversaId });
}

/**
 * A rotina mudou por outro caminho (edição, pausa manual, exclusão): o card ABERTO fecha como inválido, sem aplicar nada,
 * e a contagem zera. Chamado por quem já travou a rotina. Sem card aberto, nada a fazer.
 */
export async function invalidarCardDeRitmo(deps: Pick<Deps, "repos" | "escopo" | "agora">, rotina: Rotina): Promise<RuntimeEvent[]> {
  const ritmo = await deps.repos.rotinaRitmo.buscar(rotina.id);
  if (!ritmo || ritmo.sugeridaEm === null || ritmo.sugestaoMensagemId === null) return [];
  await deps.repos.rotinaRitmo.fecharCard(rotina.id, { silenciadaAte: null, desfazer: null });
  const msg = await deps.repos.mensagens.buscar(ritmo.sugestaoMensagemId);
  if (msg?.payload?.kind !== "rotina_ritmo" || msg.payload.decisao !== null) return [];
  await deps.repos.mensagens.atualizarSistema(msg.id, { texto: textoInvalido(msg.payload.nome), payload: { ...msg.payload, invalida: true } });
  return [eventoDoCard(deps, rotina, "ritmo_invalidado")];
}

export const textoInvalido = (nome: string) => `A rotina “${nome}” mudou desde esta sugestão; nada foi alterado.`;
