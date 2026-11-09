import { createHash } from "node:crypto";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { PEDIDOS_BARRA, type ErroAjustarBarraLateral, type PedidoBarraLateral, type ResultadoAjustarBarraLateral } from "../contracts/ferramentas-barra.ts";
import type { CasoNod, SaidaCasoDeUso } from "../contracts/servicos.ts";
import { autoriaAgente, evento } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";

/**
 * ajustar_barra_lateral (NOD-119, C1): grava o card que pergunta à pessoa se muda a barra lateral. Cercas:
 * 1. o turno é do próprio bot e é conversa ou criação (onde a pessoa está olhando o chat; os modos com a ferramenta);
 * 2. um card por turno: a chave de envio deriva do turno (índice único por conversa), como o avisar_pessoa.
 * 3. só a pedido da pessoa: pedido de colega (sob procuração), entrada não confiável ou turno contaminado (ADR-026) não
 *    põem o card no chat. O card não
 *    muda nada sozinho, mas uma proposta com o selo confiável não pode nascer de conteúdo de fora.
 */

const RECUSA: Record<ErroAjustarBarraLateral, string> = {
  fora_do_turno: "ajustar_barra_lateral só vale numa conversa com a pessoa. Nada foi mostrado.",
  pedido_invalido: "O pedido deve ser compacta, so_avatares ou normal. Nada foi mostrado.",
  entrada_nao_confiavel: "Este turno leu conteúdo de fora: o card da barra só sai a pedido direto da pessoa. Nada foi mostrado.",
  ja_mostrou_neste_turno: "Você já mostrou o card da barra neste turno. Nada foi mostrado de novo.",
};

const MODOS = new Set(["conversa", "criacao"]);

/** O texto da linha (o que lê quem não desenha o card: a Atividade, o histórico, o próximo turno do bot). */
export const PERGUNTA_DO_PEDIDO: Record<PedidoBarraLateral, string> = {
  compacta: "Deixar a barra lateral compacta?",
  so_avatares: "Mostrar só os avatares na barra lateral?",
  normal: "Voltar a barra lateral ao normal?",
};

function recusa(erro: ErroAjustarBarraLateral): SaidaCasoDeUso<ResultadoAjustarBarraLateral> {
  return { data: { ok: false, erro, instrucao: RECUSA[erro] } };
}

export function chaveDoCardDaBarra(turnoId: string): string {
  const h = createHash("sha256").update(`ajuste-barra:${turnoId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const ajustarBarraLateral: CasoNod<Deps, "ajustar_barra_lateral"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  const modo = input.plano?.modoTurno ?? turno?.origem ?? null;
  if (!turno || turno.agenteId !== input.agenteId || turno.conversaId !== input.conversaId || !modo || !MODOS.has(modo)) return recusa("fora_do_turno");
  if (!(PEDIDOS_BARRA as readonly string[]).includes(input.pedido)) return recusa("pedido_invalido");
  if (turno.sobProcuracaoDe || turno.entradaConfianca !== "confiavel" || input.plano?.confiancaEntrada === "nao_confiavel" || (await deps.repos.turnos.contaminado(turno.id))) return recusa("entrada_nao_confiavel");
  const autoria = autoriaAgente(input.agenteId, deps.escopo.pessoaId);
  const m = await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria,
    kind: "sistema",
    texto: PERGUNTA_DO_PEDIDO[input.pedido],
    payload: { kind: "ajuste_barra", pedido: input.pedido },
    confianca: "confiavel",
    idEnvio: chaveDoCardDaBarra(turno.id),
  });
  if (!m) return recusa("ja_mostrou_neste_turno");
  const events: RuntimeEvent[] = [evento(deps, "mensagem_criada", autoria, { mensagem_id: m.id, kind: "sistema" }, { conversaId: turno.conversaId, turnoId: turno.id })];
  return { data: { ok: true, mensagem_id: m.id, instrucao: "O card está no chat. Nada mudou ainda: a pessoa confirma nele. Diga numa frase que deixou o card." }, events };
};
