import { ErroDeDominio } from "../domain/erro.ts";
import { assertUuid } from "./apoio-l7.ts";
import { quandoUtc } from "./conceder.ts";
import { autoriaDaPessoa } from "./registrar-negacao.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaRevogar = { concessaoId: string };
export type SaidaRevogar = { ok: true; mensagemId: string | null };

export type EntradaRevogarLote = { agenteId: string; concessaoIds: readonly string[] };
export type SaidaRevogarLote = { revogadas: number; mensagemId: string | null };

/**
 * Revogação: apaga a concessão (o plano do PRÓXIMO turno já nasce sem a ferramenta — E6.4, provado
 * em tests/concurrency/revogacao-entre-enfileirar-e-despachar.test.ts) e deixa registro escrito na
 * conversa do agente. A mensagem de consentimento original fica: é imutável e citável (E6.3).
 *
 * Em LOTE desde 2026-09-24 (ADR-044): o painel agrupa por app e nível ("Gmail · só leitura · 28
 * ações") e revogar o grupo escreve UM registro, não 28. Toda concessão tem de ser do agente pedido:
 * o id vem do corpo da requisição.
 */
export const revogarLote: CasoDeUso<EntradaRevogarLote, SaidaRevogarLote> = async (deps, input) => {
  const ids = [...new Set(input.concessaoIds)].map((id) => assertUuid(id, "concessao"));
  if (ids.length === 0) throw new ErroDeDominio("entrada_invalida", { cause: "nenhuma concessão para revogar" });
  const agora = deps.agora();
  const escopo: string[] = [];
  for (const id of ids) {
    const concessao = await deps.repos.concessoes.buscar(id);
    if (!concessao || concessao.agenteId !== input.agenteId) throw new ErroDeDominio("nao_encontrado", { cause: "concessão" });
    const apagou = await deps.repos.concessoes.revogar(concessao.id);
    if (!apagou) throw new ErroDeDominio("nao_encontrado", { cause: "concessão de outra pessoa" });
    const conector = await deps.repos.conectores.buscar(concessao.conectorId);
    escopo.push(`${conector?.slug ?? concessao.conectorId}.${concessao.capacidade}`);
  }
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(input.agenteId);
  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  let mensagemId: string | null = null;
  if (conversa) {
    const m = await deps.repos.mensagens.criar({
      conversaId: conversa.id,
      autoria: autoriaDaPessoa(deps.escopo),
      kind: "sistema",
      assunto: "acesso.revogado",
      texto: `Revogado por ${pessoa?.nome ?? "a pessoa"} em ${quandoUtc(agora)}: ${escopo.join(", ")}.`,
      confianca: "confiavel",
    });
    mensagemId = m?.id ?? null;
  }
  return { data: { revogadas: ids.length, mensagemId } };
};

export const revogar: CasoDeUso<EntradaRevogar, SaidaRevogar> = async (deps, input) => {
  const concessao = await deps.repos.concessoes.buscar(input.concessaoId);
  if (!concessao) throw new ErroDeDominio("nao_encontrado", { cause: "concessão" });
  const r = await revogarLote(deps, { agenteId: concessao.agenteId, concessaoIds: [concessao.id] });
  return { data: { ok: true, mensagemId: r.data.mensagemId } };
};
