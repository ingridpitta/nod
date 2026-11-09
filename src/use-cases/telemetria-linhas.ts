import type { EventoLinha, TaxaDeAbertura, TipoLinha } from "../contracts/trabalho.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * Telemetria das linhas do chat (definido em 2026-10-07, ADR-083, #191): a web conta o que mostrou e o que a pessoa
 * abriu; o gatilho de reversão da ADR-083 é um tipo de linha aberto em mais de 30% das vezes em 2 semanas. Vai só para
 * `events` (sem outbox): nenhum frame sai daqui.
 */

/** definido em 2026-10-07: até 200 eventos por chamada (a web manda em lote, uma linha mostrada por carga da tela). */
export const EVENTOS_LINHA_MAX = 200;
/** A janela da taxa no Modo dev. */
export const JANELA_TAXA_MS = 14 * 86_400_000;
const TIPOS: readonly TipoLinha[] = ["rotina", "bots", "task", "atividade", "troca", "frentes", "revisor"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A chave é da web (ids e números juntos por ":"), nunca texto da conversa: curta e fechada. */
export const CHAVE_LINHA = /^[A-Za-z0-9:_-]{1,200}$/;

function validar(v: unknown): EventoLinha {
  const o = typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  if ((o.acao !== "mostrada" && o.acao !== "aberta") || !TIPOS.includes(o.tipo as TipoLinha) || typeof o.agenteId !== "string" || !UUID.test(o.agenteId) || typeof o.chaveLinha !== "string" || !CHAVE_LINHA.test(o.chaveLinha)) {
    throw new ErroDeDominio("entrada_invalida", { cause: "evento de linha" });
  }
  return { acao: o.acao, tipo: o.tipo as TipoLinha, agenteId: o.agenteId, chaveLinha: o.chaveLinha };
}

/** POST telemetria/linhas {eventos}: valida tudo antes de gravar (um inválido recusa o lote inteiro). */
export const registrarLinhas: CasoDeUso<{ eventos: unknown }, { gravados: number }> = async (deps, input) => {
  if (!Array.isArray(input.eventos) || input.eventos.length === 0 || input.eventos.length > EVENTOS_LINHA_MAX) throw new ErroDeDominio("entrada_invalida", { cause: "eventos" });
  const eventos = input.eventos.map(validar);
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const gravados = await deps.repos.events.gravarSemOutbox(eventos.map((e) => evento(deps.escopo, {
    kind: e.acao === "mostrada" ? "linha_mostrada" : "linha_aberta",
    autoria,
    agora,
    dados: { tipo: e.tipo, agente_id: e.agenteId, chave_linha: e.chaveLinha },
  })));
  return { data: { gravados } };
};

/** GET telemetria/linhas: a taxa de abertura por tipo nos últimos 14 dias (distintas por chave); sem mostrada, null. */
export const taxasDasLinhas: CasoDeUso<Record<string, never>, TaxaDeAbertura[]> = async (deps) => {
  const contagem = await deps.repos.events.contarLinhas(deps.agora() - JANELA_TAXA_MS);
  return {
    data: TIPOS.map((tipo) => {
      const c = contagem.find((x) => x.tipo === tipo);
      const mostradas = c?.mostradas ?? 0;
      const abertas = c?.abertas ?? 0;
      return { tipo, mostradas, abertas, taxa: mostradas > 0 ? abertas / mostradas : null };
    }),
  };
};
