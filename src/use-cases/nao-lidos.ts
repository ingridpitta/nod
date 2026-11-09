import type { ConversaNaoLida, LeituraMarcada, NaoLidosDto } from "../contracts/nao-lidos.ts";
import { lerLeituras } from "../domain/nao-lidos.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { ResumoNaoLida } from "../repositories/leituras.repo.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * Não lidos (definido em 2026-09-29, 0039; canvas "Nod — tela do agente", página "Não lidos"): o que chegou
 * depois do "lido até" de cada conversa. Bot oculto ou excluído não está na barra lateral, então o que ele
 * fala também não entra aqui; sala entra sempre que a pessoa a lê.
 */
async function visiveis(deps: Deps): Promise<ResumoNaoLida[]> {
  const resumo = await deps.repos.leituras.resumo();
  if (resumo.length === 0) return [];
  const naBarra = new Set((await deps.repos.agentes.listar()).map((a) => a.id));
  return resumo.filter((r) => r.tipo === "sala" || (r.agenteId !== null && naBarra.has(r.agenteId)));
}

export const listarNaoLidos: CasoDeUso<Record<string, never>, NaoLidosDto> = async (deps) => {
  const conversas = await visiveis(deps);
  const mensagens = await deps.repos.leituras.mensagens(conversas.map((c) => c.conversaId));
  const saida: ConversaNaoLida[] = conversas.flatMap((c) => {
    const m = mensagens.get(c.conversaId);
    return m ? [{ ...c, primeiraId: m.primeira.id, mensagens: m.ultimas, ...(m.avisos.length > 0 ? { avisos: m.avisos } : {}), daRotina: m.daRotina }] : [];
  });
  return { data: { conversas: saida } };
};

async function conversaDaPessoa(deps: Deps, conversaId: string): Promise<string> {
  const conversa = await deps.repos.conversas.buscar(conversaId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado");
  return conversa.id;
}

/**
 * Abrir a conversa, ou "Marcar como lido" na tela Não lidos: lida até a última mensagem. NOD-449: devolve a leitura de
 * antes e de depois, para o Desfazer.
 */
export const marcarConversaLida: CasoDeUso<{ conversaId: string }, { leituras: LeituraMarcada[] }> = async (deps, input) => {
  return { data: { leituras: [await deps.repos.leituras.marcarLida(await conversaDaPessoa(deps, input.conversaId))] } };
};

/** "Marcar como não lido" do menu do bot: a última fala dele volta a ser nova. */
export const marcarConversaNaoLida: CasoDeUso<{ conversaId: string }, { marcada: boolean }> = async (deps, input) => {
  return { data: { marcada: await deps.repos.leituras.marcarNaoLida(await conversaDaPessoa(deps, input.conversaId)) } };
};

/** "Marcar tudo como lido": as conversas que a tela Não lidos mostra. NOD-449: com as leituras, para o Desfazer. */
export const marcarTudoLido: CasoDeUso<Record<string, never>, { marcadas: number; leituras: LeituraMarcada[] }> = async (deps) => {
  const conversas = await visiveis(deps);
  const leituras: LeituraMarcada[] = [];
  for (const c of conversas) leituras.push(await deps.repos.leituras.marcarLida(c.conversaId));
  return { data: { marcadas: conversas.length, leituras } };
};

/**
 * NOD-449 (decisão 5): o Desfazer de qualquer "marcar como lido" (uma, todas, pela tela ou pelo chat). Cada leitura volta
 * ao `antes` só se o "lido até" ainda é o `depois` (restaurarLeituras): o que a pessoa leu depois não reabre. A conversa
 * tem de ser dela (o mesmo conversaDaPessoa das marcações; RLS por baixo). Repetir não muda nada.
 */
export const desfazerLeitura: CasoDeUso<{ leituras: unknown }, { restauradas: number }> = async (deps, input) => {
  const leituras = lerLeituras(input.leituras);
  if (!leituras) throw new ErroDeDominio("entrada_invalida");
  // Uma busca por conversa distinta (a cerca da dona) e um UPDATE para o lote. A mesma conversa repetida no lote: vale a
  // primeira leitura (o Desfazer de uma marcação nunca repete conversa).
  const porConversa = new Map<string, LeituraMarcada>();
  for (const l of leituras) if (!porConversa.has(l.conversaId)) porConversa.set(l.conversaId, { ...l, conversaId: await conversaDaPessoa(deps, l.conversaId) });
  return { data: { restauradas: await deps.repos.leituras.restaurarLeituras([...porConversa.values()]) } };
};
