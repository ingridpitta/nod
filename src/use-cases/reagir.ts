import type { ReacaoNaFala } from "../contracts/reacao.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { emojiDeReacao } from "../domain/reacao.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaReagir = { mensagemId: string; emoji: unknown; marcada: boolean };

/**
 * Pôr ou tirar a reação da pessoa numa fala (definido em 2026-10-18, ADR-113, plano "pergunta com botões", Parte 5).
 * Idempotente: pôr de novo ou tirar a que não existe não muda nada e não publica frame. A fala tem de ser visível para a
 * pessoa (a RLS de `mensagens`: a conversa própria dela ou a sala de que ela é membro); senão, 404. O bot não lê reações
 * na v1 (decisão 2 do plano): nada aqui toca turno, entrada ou histórico.
 */
export const reagir: CasoDeUso<EntradaReagir, { reacoes: ReacaoNaFala[] }> = async (deps, input) => {
  if (!emojiDeReacao(input.emoji)) throw new ErroDeDominio("entrada_invalida", { cause: "emoji" });
  const emoji = input.emoji;
  const fala = await deps.repos.mensagens.buscar(input.mensagemId);
  if (!fala) throw new ErroDeDominio("nao_encontrado");
  const mudou = input.marcada
    ? await deps.repos.reacoes.por({ conversaId: fala.conversaId, mensagemId: fala.id, emoji })
    : await deps.repos.reacoes.tirar({ mensagemId: fala.id, emoji });
  const reacoes = await deps.repos.reacoes.dasMensagens([fala.id]);
  if (!mudou) return { data: { reacoes }, events: [] };
  const agora = deps.agora();
  const events = [evento(deps.escopo, { kind: "reacao_mudou", autoria: autoriaPessoa(deps.escopo), agora, conversaId: fala.conversaId, dados: { mensagem_id: fala.id, emoji, acao: input.marcada ? "pos" : "tirou" } })];
  return { data: { reacoes }, events };
};
