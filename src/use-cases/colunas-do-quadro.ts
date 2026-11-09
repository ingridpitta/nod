import type { PayloadPropostaColunasQuadro } from "../contracts/conversa.ts";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { ColunaQuadro, OpQuadro } from "../contracts/quadro.ts";
import { colunasDe, substituirColunas } from "../domain/colunas.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { log } from "../obs/log.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { aplicarLoteQuadro, preverLoteQuadro, type FalhaQuadro, type PedidoLote } from "./quadro.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * Trocar o conjunto de colunas pela conversa (definido em 2026-11-01, NOD-448, ADR-140; decisão 3 do Gil). Criar,
 * renomear, mover e remover saem na hora com Desfazer; substituir o conjunto inteiro é o único passo de coluna que a
 * conversa não aplica sozinha: vira um card compacto (proposta + decisão 'colunas_quadro', mesmo id) com o antes, o
 * depois e para onde vão as tarefas. Confirmar aplica pelo mesmo aplicarLoteQuadro da tela, com a pessoa como autora.
 */

type OpSubstituir = Extract<OpQuadro, { tipo: "substituir_colunas" }>;
const enxuta = (cs: readonly ColunaQuadro[]) => cs.map((c) => ({ id: c.id, nome: c.nome, grupo: c.grupo }));
/** A impressão das colunas de quando o card nasceu: mudou depois, o card não vale mais. */
export const revisaoDasColunas = (cs: readonly ColunaQuadro[]): string => JSON.stringify(enxuta(cs));

const nomeDe = (cs: readonly ColunaQuadro[], id: string) => cs.find((c) => c.id === id)?.nome ?? id;

export type PropostaDeColunas = { ok: true; propostaId: string; payload: PayloadPropostaColunasQuadro } | { ok: false; erro: FalhaQuadro; detalhe: string };

/** O bot pediu substituir_colunas: valida como o lote validaria e abre o card. Nada muda até a pessoa confirmar. */
export async function proporColunas(deps: Deps, p: PedidoLote & { op: OpSubstituir; agenteId: string; conversaId: string; turnoId: string }): Promise<{ data: PropostaDeColunas; events: RuntimeEvent[] }> {
  const previa = await preverLoteQuadro(deps, { ...p, ops: [p.op] });
  if (!previa.ok) return { data: previa, events: [] };
  const antes = colunasDe(previa.quadro);
  const troca = substituirColunas(antes, p.op, previa.tarefas);
  if ("erro" in troca) return { data: { ok: false, erro: "entrada_invalida", detalhe: troca.erro }, events: [] };
  const contagem = new Map<string, number>();
  for (const m of troca.movidas) contagem.set(`${m.de}\u0000${m.para}`, (contagem.get(`${m.de}\u0000${m.para}`) ?? 0) + 1);
  const anfitriao = await deps.repos.agentes.buscar(previa.quadro.agenteId);
  const payload: PayloadPropostaColunasQuadro = {
    kind: "colunas_quadro",
    quadroId: previa.quadro.id,
    anfitriaoId: previa.quadro.agenteId,
    anfitriaoNome: anfitriao?.nome ?? "quadro",
    colunas: p.op.colunas,
    ...(p.op.destinos ? { destinos: p.op.destinos } : {}),
    antes: enxuta(antes),
    depois: enxuta(troca.colunas),
    // Pelos nomes: é o que o card mostra ("1 tarefa vai de Fazendo para Compras").
    movidas: [...contagem].map(([k, n]) => { const [de, para] = k.split("\u0000"); return { de: nomeDe(antes, de!), para: nomeDe(troca.colunas, para!), tarefas: n }; }),
    revisao: revisaoDasColunas(antes),
    turnoId: p.turnoId,
  };
  const proposta = await deps.repos.propostas.criar({ conversaId: p.conversaId, agenteId: p.agenteId, payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const agora = deps.agora();
  const frase = `Trocar as colunas do quadro de ${payload.anfitriaoNome}: ${troca.colunas.map((c) => c.nome).join(" → ")}`;
  const decisao = await deps.repos.decisoes.criar({ id: proposta.id, tipo: "colunas_quadro", agenteId: p.agenteId, conversaId: p.conversaId, turnoId: p.turnoId, prazoDecisaoEm: agora + PRAZO_DECISAO_PADRAO_MS, frase: frase.slice(0, 500) });
  const autoria = autoriaDoAgente(deps.escopo, p.agenteId);
  const events: RuntimeEvent[] = [evento(deps.escopo, { kind: "proposta_criada", autoria, agora, conversaId: p.conversaId, turnoId: p.turnoId, dados: { proposta_id: proposta.id, kind: "colunas_quadro" } })];
  if (decisao) events.push(evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: p.conversaId, turnoId: p.turnoId, dados: { decisao_id: decisao.id, tipo: "colunas_quadro" } }));
  return { data: { ok: true, propostaId: proposta.id, payload }, events };
}

/**
 * O card decidido (POST decisoes/:id/decidir, ou o Confirmar da conversa). Recusar fecha sem mudar nada; confirmar trava o
 * quadro, confere que as colunas são as de quando o card nasceu e aplica o substituir como a pessoa (um lote com Desfazer).
 */
export const decidirColunasDoQuadro: CasoDeUso<{ decisaoId: string; recusar: boolean; executor: Executor }, { aplicado: boolean; loteId: string | null; obsoleta?: true }> = async (deps, input) => {
  // Travada: dois Confirmar ao mesmo tempo fazem fila aqui, e o segundo já vê a proposta fechada (revisão do PR #615).
  const proposta = await deps.repos.propostas.buscarParaAtualizar(input.decisaoId);
  if (!proposta || proposta.payload.kind !== "colunas_quadro") throw new ErroDeDominio("nao_encontrado", { cause: "colunas do quadro" });
  if (proposta.estado !== "pendente") throw new ErroDeDominio("estado_invalido", { cause: `proposta ${proposta.estado}` });
  const payload = proposta.payload;
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [];
  let aplicado = false;
  let loteId: string | null = null;
  let texto: string;
  if (input.recusar) {
    texto = `Colunas do quadro de ${payload.anfitriaoNome} mantidas.`;
  } else {
    const travado = await deps.repos.quadros.buscarTravado(payload.quadroId);
    // O quadro sumiu (removido, NOD-415) ou mudou depois do card: aplicar seria trocar outra coisa. Fecha como recusada e avisa.
    if (!travado || revisaoDasColunas(colunasDe(travado)) !== payload.revisao) {
      const fechada = await deps.repos.decisoes.decidir(input.decisaoId, { por: deps.escopo.pessoaId, agora });
      if (!fechada) throw new ErroDeDominio("estado_invalido", { cause: "decisão já fechada" });
      await deps.repos.propostas.decidir(proposta.id, "recusada");
      await registrar(deps, proposta.conversaId, travado ? "As colunas mudaram depois desta proposta: nada foi trocado. Peça de novo se ainda quiser." : "O quadro foi removido depois desta proposta: nada foi trocado.", events);
      // As outras abas e a Sua vez fecham o card também (revisão 3 do PR #615): o mesmo evento, como recusa.
      events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: proposta.conversaId, turnoId: fechada.turnoId, dados: { decisao_id: fechada.id, tipo: "colunas_quadro", recusada: true } }));
      // Sem lançar: a recusa precisa ficar gravada; a rota devolve 409 depois do commit (o molde da NOD-159).
      return { data: { aplicado: false, loteId: null, obsoleta: true }, events };
    }
    // As tarefas podem ter mudado depois do card: o recibo conta as que mudaram de coluna agora, não as do card.
    const antesDe = new Map((await deps.repos.quadros.tarefas(payload.quadroId)).map((t) => [t.id, t.status]));
    const r = await aplicarLoteQuadro(deps, { autor: { tipo: "pessoa" }, quadro: payload.quadroId, executor: input.executor, ops: [{ tipo: "substituir_colunas", colunas: payload.colunas, ...(payload.destinos ? { destinos: payload.destinos } : {}) }] });
    if (!r.data.ok) throw new ErroDeDominio(r.data.erro === "entrada_invalida" ? "entrada_invalida" : "nao_encontrado", { cause: r.data.detalhe });
    events.push(...(r.events ?? []));
    aplicado = true;
    loteId = r.data.lote?.id ?? null;
    const n = (await deps.repos.quadros.tarefas(payload.quadroId)).filter((t) => antesDe.has(t.id) && antesDe.get(t.id) !== t.status).length;
    texto = `Colunas trocadas no quadro de ${payload.anfitriaoNome}${n ? ` · ${n} ${n === 1 ? "tarefa mudou" : "tarefas mudaram"} de coluna` : ""}. Desfazer está no quadro.`;
  }
  const decidida = await deps.repos.decisoes.decidir(input.decisaoId, { por: deps.escopo.pessoaId, agora });
  if (!decidida) throw new ErroDeDominio("estado_invalido", { cause: "decisão já fechada" });
  await deps.repos.propostas.atualizarPayload(proposta.id, { ...payload, loteId });
  await deps.repos.propostas.decidir(proposta.id, input.recusar ? "recusada" : "confirmada");
  await registrar(deps, proposta.conversaId, texto, events);
  events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: proposta.conversaId, turnoId: decidida.turnoId, dados: { decisao_id: decidida.id, tipo: "colunas_quadro", recusada: input.recusar } }));
  log("info", "nod_colunas_decididas", { aplicado });
  return { data: { aplicado, loteId }, events };
};

async function registrar(deps: Deps, conversaId: string, texto: string, events: RuntimeEvent[]): Promise<void> {
  const autoria = autoriaPessoa(deps.escopo);
  const msg = await deps.repos.mensagens.criar({ conversaId, autoria, kind: "sistema", assunto: "aprovacao.recibo", texto, confianca: "confiavel" });
  if (msg) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId, dados: { mensagem_id: msg.id, kind: "sistema" } }));
}
