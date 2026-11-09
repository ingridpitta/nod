import type { RuntimeEvent } from "../contracts/evento.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigir } from "../domain/redacao.ts";
import { avaliarEncaminhar, HANDOFFS_POR_RODADA } from "../domain/rodada-sala.ts";
import { agenteVisivel, autoriaAgente, evento, exigir, fecharRodadaSeAssentou, PRAZO_DECISAO_MS, rodadaDaSala } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";

/**
 * Ferramenta `encaminhar` (sala): handoff VISÍVEL — mensagem kind 'handoff' {de, para, motivo},
 * turno do destinatário (origem 'sala', serial por conversa) e evento sala_handoff. EMENDA 14
 * (eixo 2 de profundidade): o quarto encaminhar da mesma rodada sem fala humana não acontece —
 * vira passe `negado_fail_closed` com causa `teto_canal` (a causa vai numa mensagem `negacao`
 * do mesmo agente e turno, porque o payload de passe não a carrega), e assentar() reconhece o
 * teto por essa causa. O destinatário é resolvido por NOME entre os membros da sala.
 */
export const encaminhar: CasoNod<Deps, "encaminhar"> = async (deps, input) => {
  const sala = exigir(await deps.repos.salas.buscarPorConversa(input.conversaId), "estado_invalido", "encaminhar só existe em sala");
  const de = await agenteVisivel(deps.repos, input.agenteId);
  const membros = await deps.repos.salas.membros(sala.id);
  const alvoNome = input.para_agente.trim().replace(/^@/, "").toLowerCase();
  let para = null;
  for (const m of membros) {
    const a = await deps.repos.agentes.buscar(m.agenteId);
    if (a && a.nome.toLowerCase() === alvoNome) para = a;
  }
  if (!para) throw new ErroDeDominio("nao_encontrado", { cause: "destinatário não é membro da sala" });
  if (para.id === de.id) throw new ErroDeDominio("entrada_invalida", { cause: "encaminhar para si mesmo" });
  const agora = deps.agora();
  const autoria = autoriaAgente(de.id, deps.escopo.pessoaId);
  const events: RuntimeEvent[] = [];

  const avaliacao = avaliarEncaminhar(sala.orcamento);
  if (!avaliacao.ok) {
    const antes = (await rodadaDaSala(deps.repos, input.conversaId)).desfecho;
    await deps.repos.mensagens.criar({
      conversaId: input.conversaId,
      turnoId: input.turnoId,
      autoria,
      kind: "negacao",
      texto: `Encaminhar negado: ${HANDOFFS_POR_RODADA} encaminhamentos já aconteceram nesta rodada sem fala humana. ${de.nome} passa a vez.`,
      payload: { kind: "negacao", classe: "ferramenta_negada", nome: "encaminhar", motivo: avaliacao.motivo, terminal: false },
      confianca: "confiavel",
    });
    const passe = await deps.repos.mensagens.criar({
      conversaId: input.conversaId,
      turnoId: input.turnoId,
      autoria,
      kind: "passe",
      texto: redigir("passe", agora, { agente: de.nome, motivo: "teto do canal" }),
      payload: { kind: "passe", motivo: avaliacao.passe },
      confianca: "confiavel",
    });
    events.push(evento(deps, "negacao", autoria, { ferramenta: "encaminhar", motivo: avaliacao.motivo, salaId: sala.id, mensagemId: passe?.id ?? null }, { conversaId: input.conversaId, turnoId: input.turnoId }));
    await fecharRodadaSeAssentou(deps, input.conversaId, antes);
    return { data: { ok: true }, events };
  }

  if (!(await deps.repos.salas.atualizarOrcamento(sala.id, avaliacao.estado))) throw new ErroDeDominio("nao_permitido", { cause: "orçamento é da dona da sala" });
  const handoff = await deps.repos.mensagens.criar({
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    autoria,
    kind: "handoff",
    texto: redigir("handoff", agora, { de: de.nome, para: para.nome, motivo: input.motivo }),
    payload: { kind: "handoff", de: de.id, para: para.id, motivo: input.motivo },
    confianca: "confiavel",
  });
  // NOD-206: o turno de quem encaminha roda no mesmo executor que o do destinatário vai rodar; o plano grava o real.
  const deQuem = await deps.repos.turnos.buscar(input.turnoId);
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: input.conversaId,
    agenteId: para.id,
    origem: "sala",
    prazoEm: agora + PRAZO_DECISAO_MS,
    profundidade: 0,
    entradaTexto: `${de.nome} passou a rodada para você: ${input.motivo}`,
    entradaConfianca: "nao_confiavel",
    modelo: para.modelo,
    harness: para.harness,
    executor: deQuem?.executor ?? "catcher",
  });
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "turno do destinatário não criado" });
  events.push(evento(deps, "sala_handoff", autoria, { de: de.id, para: para.id, salaId: sala.id, mensagemId: handoff?.id ?? null, turnoId: turno.id }, { conversaId: input.conversaId, turnoId: input.turnoId }));
  events.push(evento(deps, "turno_criado", autoria, { turnoId: turno.id, agenteId: para.id, origem: "sala", salaId: sala.id }, { conversaId: input.conversaId, turnoId: turno.id }));
  return { data: { ok: true }, events };
};
