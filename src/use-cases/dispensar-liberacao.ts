import { ErroDeDominio } from "../domain/erro.ts";
import type { CasoDeUso } from "./tipos.ts";

/** Teto de apps por pedido do cartão (liberar e dispensar): o cartão lista os conectados nas últimas 24 h. */
export const MAX_APPS_POR_LIBERACAO = 20;

/**
 * definido em 2026-10-05: o "Agora não" do cartão que oferece liberar apps recém-conectados para o bot da conversa
 * (web/telas/card-liberar.ts). Guarda a dispensa por pessoa, bot e app (0054) — no banco, como `preferencias`, porque
 * o app do Mac apaga o localStorage a cada conexão e a dispensa tem de sobreviver a recarregar a página. Não é
 * `dispensar-decisao.ts`: o cartão não é uma decisão nem uma proposta, é desenhado do que já existe, e não há linha
 * dele para fechar. Só a dona do bot e do app dispensa; os dois viram 404 para as demais, como no nível (rotas/concessoes.ts).
 * Nenhum acesso muda aqui: a pessoa continua podendo liberar pelo painel do bot.
 */
export const dispensarLiberacao: CasoDeUso<{ agenteId: string; conectorIds: readonly string[] }, { dispensadas: number }> = async (deps, input) => {
  const ids = [...new Set(input.conectorIds)];
  if (ids.length === 0 || ids.length > MAX_APPS_POR_LIBERACAO) throw new ErroDeDominio("entrada_invalida", { cause: "conectorIds" });
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente || agente.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "agente" });
  for (const id of ids) {
    const conector = await deps.repos.conectores.buscar(id);
    if (!conector || conector.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
  }
  await deps.repos.liberacoesDispensadas.dispensar(agente.id, ids, deps.agora());
  return { data: { dispensadas: ids.length } };
};
