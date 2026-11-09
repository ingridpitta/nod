import { createHash } from "node:crypto";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { ErroAvisarPessoa, ResultadoAvisarPessoa } from "../contracts/ferramentas-aviso.ts";
import type { CasoNod, SaidaCasoDeUso } from "../contracts/servicos.ts";
import { autoriaAgente, evento } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";

/**
 * avisar_pessoa (definido em 2026-10-28, NOD-114): o bot avisa a pessoa sem ela ter perguntado. Cercas:
 * 1. o turno é do próprio bot e é rotina, conversa ou pedido de colega (os modos com a ferramenta no catálogo);
 * 2. a entrada do turno é confiável (ADR-026): um turno que nasceu de conteúdo de fora não escolhe o aviso, nem o pedido
 *    de colega com a marca de quem pediu (a delegação não lava a marca). Ler um app no meio da rotina ou da conversa não
 *    bloqueia — o aviso vai só para a dona, e a rotina que lê o Linear ou o Gmail é o caso de uso —,
 *    mas a fala sai marcada `nao_confiavel`;
 * 3. um aviso por turno: a chave de envio (0057, índice único por conversa) deriva do turno, então duas chamadas, mesmo
 *    concorrentes, gravam uma linha só, sem trava a mais.
 * A fala leva `turno_id`: a task herda o aviso pelo turno, e a web abre a task ao clicar.
 */

const RECUSA: Record<ErroAvisarPessoa, string> = {
  fora_do_turno: "avisar_pessoa só vale numa rotina, numa conversa (ou na criação) ou num pedido de colega deste bot. Nada foi enviado.",
  entrada_nao_confiavel: "Este turno nasceu de conteúdo de fora, que não escolhe o que vira aviso. Nada foi enviado; escreva na conversa, se precisar.",
  texto_vazio: "O aviso veio sem texto. Nada foi enviado; chame de novo com o que a pessoa precisa saber.",
  ja_avisou_neste_turno: "Você já avisou a pessoa neste turno. Nada foi enviado de novo; o resto vai na sua fala final.",
};

// A criação é a conversa do bot ainda não confirmado (ADR-050: bot novo é bot completo).
const MODOS_COM_AVISO = new Set(["rotina", "conversa", "criacao", "delegacao"]);

function recusa(erro: ErroAvisarPessoa): SaidaCasoDeUso<ResultadoAvisarPessoa> {
  return { data: { ok: false, erro, instrucao: RECUSA[erro] } };
}

/** A chave de envio do aviso do turno: um uuid v4 estável derivado do id do turno (mesma forma de turnos-orfaos.ts). */
export function chaveDoAvisoDoTurno(turnoId: string): string {
  const h = createHash("sha256").update(`aviso-pessoa:${turnoId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const avisarPessoa: CasoNod<Deps, "avisar_pessoa"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  const modo = input.plano?.modoTurno ?? turno?.origem ?? null;
  if (!turno || turno.agenteId !== input.agenteId || turno.conversaId !== input.conversaId || !modo || !MODOS_COM_AVISO.has(modo)) return recusa("fora_do_turno");
  const texto = input.texto.trim();
  if (!texto) return recusa("texto_vazio");
  if (turno.entradaConfianca !== "confiavel" || input.plano?.confiancaEntrada === "nao_confiavel") return recusa("entrada_nao_confiavel");

  const contaminado = await deps.repos.turnos.contaminado(turno.id);
  // Revisão 2 (ADR-026/062): o pedido de colega nasce `confiavel` e recebe a marca de quem pediu por `contaminar` — a
  // delegação não lava o que o outro bot leu. Ali o aviso não sai (como o responder_pedido, que leva a marca adiante).
  if (contaminado && modo === "delegacao") return recusa("entrada_nao_confiavel");
  const autoria = autoriaAgente(input.agenteId, deps.escopo.pessoaId);
  const m = await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria,
    kind: "texto",
    texto,
    payload: { kind: "aviso_pessoa" },
    confianca: contaminado ? "nao_confiavel" : "confiavel",
    idEnvio: chaveDoAvisoDoTurno(turno.id),
  });
  if (!m) return recusa("ja_avisou_neste_turno");
  const events: RuntimeEvent[] = [evento(deps, "mensagem_criada", autoria, { mensagem_id: m.id, kind: "texto", aviso: true }, { conversaId: turno.conversaId, turnoId: turno.id })];
  return { data: { ok: true, mensagem_id: m.id }, events };
};
