import type { Memoria, TipoMemoria } from "../contracts/memoria.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { falaDeCapacidadeDoTurno, RECUSA_CAPACIDADE_DO_TURNO } from "../domain/memoria-de-capacidade.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaAgente, autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso, UseCasesNod } from "./tipos.ts";

const TIPOS: readonly TipoMemoria[] = ["preferencia", "fato", "resumo"];
/** definido em 2026-10-03: a linha da conversa dizia "Anotei como preferencia" — o enum cru, sem acento. */
const TIPO_NA_FRASE: Record<TipoMemoria, string> = { preferencia: "uma preferência", fato: "um fato", resumo: "um resumo" };

export type EntradaRegistrarMemoria = {
  agenteId: string;
  /** Onde escrever a mensagem 'anotei' (null = sem mensagem, ex.: POST memoria pela pessoa sem conversa). */
  conversaId: string | null;
  turnoId: string | null;
  tipo: TipoMemoria;
  texto: string;
  origem: "pessoa" | "agente";
};

/**
 * Memória por bot (Grok Bot: memória não é fonte). Grava a linha e, quando há conversa, a mensagem de
 * sistema 'anotei' na MESMA tx. A memória entra no prompt de sistema com "não substitui fonte autoritativa".
 */
export const registrarMemoria: CasoDeUso<EntradaRegistrarMemoria, { memoria: Memoria; mensagem: Mensagem | null }> = async (deps, input) => {
  if (!TIPOS.includes(input.tipo)) throw new ErroDeDominio("entrada_invalida", { cause: "tipo" });
  const texto = typeof input.texto === "string" ? input.texto.trim() : "";
  if (texto === "") throw new ErroDeDominio("texto_vazio");
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado");

  const memoria = await deps.repos.memorias.criar({ agenteId: agente.id, tipo: input.tipo, texto, origem: input.origem });
  if (!memoria) throw new ErroDeDominio("nao_permitido");

  const agora = deps.agora();
  const autoria = input.origem === "agente" ? autoriaAgente({ agenteId: agente.id, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher" }) : autoriaPessoa(deps.escopo);
  const events = [evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { agente_id: agente.id, acao: "memoria_criada", memoria_id: memoria.id, tipo: memoria.tipo } })];
  let mensagem: Mensagem | null = null;
  if (input.conversaId) {
    mensagem = await deps.repos.mensagens.criar({
      conversaId: input.conversaId,
      turnoId: input.turnoId,
      autoria,
      kind: "sistema",
      assunto: "memoria.anotada",
      texto: redigir("anotei", agora, { tipo: TIPO_NA_FRASE[memoria.tipo], texto: memoria.texto }),
      confianca: "confiavel",
    });
    if (mensagem) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { mensagem_id: mensagem.id, kind: "sistema" } }));
  }
  return { data: { memoria, mensagem }, events };
};

/**
 * Ferramenta nod `lembrar` (EMENDA 5): o agente do token grava na própria memória; origem 'agente'.
 * definido em 2026-10-01 (ADR-065): a frase que diz que falta terminal, pasta ou colega neste turno não grava — é do
 * turno, não do bot. Só o bot passa por aqui; a pessoa grava pela tela o que quiser.
 */
export const lembrar: UseCasesNod["lembrar"] = async (deps, input) => {
  if (falaDeCapacidadeDoTurno(input.texto)) return { data: { ok: false, recusado: RECUSA_CAPACIDADE_DO_TURNO } };
  const r = await registrarMemoria(deps, {
    agenteId: input.agenteId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    tipo: input.tipo,
    texto: input.texto,
    origem: "agente",
  });
  return { data: { ok: true, id: r.data.memoria.id }, events: r.events };
};
