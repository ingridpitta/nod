import type { ComandosDto } from "../contracts/comandos.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import { COMANDOS_DA_CONVERSA } from "../domain/comandos.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

/** O "/" do chat (0038): o catálogo do Mac da pessoa (null antes do primeiro turno no Claude Code) e os da conversa. */
export const lerComandos: CasoDeUso<Record<string, never>, ComandosDto> = async (deps) => {
  const doMac = await deps.repos.comandos.buscar();
  return { data: { doMac: doMac?.catalogo ?? null, doMacEm: doMac?.em ?? null, daConversa: [...COMANDOS_DA_CONVERSA] } };
};

/**
 * /nova-sessao (0038): o bot começa do zero e a conversa continua na tela. É do nod, não do CLI: medido na 2.1.284,
 * o /clear numa sessão retomada deixa a sessão original lembrando de tudo. Zera a sessão, marca o recomeço (o
 * histórico do prompt só leva o que vier depois) e escreve a linha na conversa. Só na conversa própria com um bot.
 */
export const novaSessao: CasoDeUso<{ conversaId: string }, { mensagem: Mensagem | null }> = async (deps, input) => {
  const conversa = await deps.repos.conversas.buscar(input.conversaId);
  if (!conversa || conversa.tipo === "sala" || !conversa.agenteId) throw new ErroDeDominio("nao_encontrado", { cause: "conversa" });
  if (!(await deps.repos.conversas.recomecar(conversa.id))) throw new ErroDeDominio("nao_permitido");
  const agente = await deps.repos.agentes.buscar(conversa.agenteId);
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: conversa.id,
    autoria,
    kind: "sistema",
    assunto: "sessao.nova",
    texto: `Nova sessão · ${agente?.nome ?? "O bot"} começa sem o que vocês conversaram até aqui. As mensagens continuam aqui para você.`,
    confianca: "confiavel",
  });
  const events = mensagem ? [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, turnoId: null, dados: { mensagem_id: mensagem.id, kind: "sistema" } })] : [];
  return { data: { mensagem }, events };
};
