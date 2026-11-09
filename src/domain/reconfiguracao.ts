import type { Agente } from "../contracts/agente.ts";

/**
 * /configurar (NOD-23): o bot já confirmado entrevista a pessoa e propõe o perfil de novo no cartão de sempre.
 *
 * definido em 2026-10-28 (NOD-23, spec da Ada): a reconfiguração é um SUBMODO da conversa, não um ModoTurno novo. Tudo o
 * que vale para `conversa` (a pessoa está falando: aprovação automática, nativas de arquivo, pedidos pendentes, recomeço,
 * triagem) continua valendo; somam-se só `atualizar_perfil` e a linha da entrevista no prompt. Emenda pequena da ADR-050:
 * `atualizar_perfil` vale na criação e, agora, na conversa em reconfiguração.
 *
 * definido em 2026-10-28 (NOD-23): a janela é de 2 h a partir do pedido. Confirmar ou recusar o cartão de perfil fecha
 * antes; passada a janela sem nada, o turno seguinte volta a ser conversa comum sem nenhum laço de fundo.
 */
export const JANELA_RECONFIGURACAO_MS = 2 * 60 * 60 * 1000;

/** O comando da conversa que liga o modo (src/domain/comandos.ts). */
export const COMANDO_CONFIGURAR = "configurar";

/**
 * Quem pode se reconfigurar: bot da própria pessoa, já confirmado (o não confirmado ainda está na criação, que tem a
 * mesma ferramenta), não excluído, e nunca o Nod (fora do escopo: o Nod não se reconfigura). O repositório repete a
 * regra no WHERE (agentes.iniciarConfiguracao).
 */
export function podeReconfigurar(agente: Pick<Agente, "ownerId" | "confirmado" | "papel" | "excluidoEm">, pessoaId: string): boolean {
  return agente.ownerId === pessoaId && agente.confirmado && !agente.papel && !agente.excluidoEm;
}

/** O modo está ligado agora: pedido há menos de 2 h e ainda sem confirmar nem recusar o cartão. */
export function emReconfiguracao(agente: Pick<Agente, "configurandoDesde">, agora: number): boolean {
  const desde = agente.configurandoDesde ?? null;
  return desde !== null && agora >= desde && agora - desde < JANELA_RECONFIGURACAO_MS;
}

/**
 * A entrada do turno que pediu /configurar: o comando vira o pedido da entrevista, com o que a pessoa escreveu depois
 * dele (o "pedido direto", que pula as perguntas). A web mostra a fala da pessoa como ela escreveu; só o modelo lê isto.
 */
export function entradaDaReconfiguracao(resto: string): string {
  const base = "A pessoa usou /configurar: quer reconfigurar você (missão, tom, o que evitar e rotinas).";
  return resto ? `${base} Ela já disse o que quer: "${resto}". Se isso basta, resuma a mudança e pergunte Certo?; senão, pergunte só o que falta.` : `${base} Comece a entrevista pela primeira pergunta.`;
}
