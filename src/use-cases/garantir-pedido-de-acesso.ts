import type { Conector } from "../contracts/conector.ts";
import type { PayloadPropostaAcesso, Proposta } from "../contracts/conversa.ts";
import type { Decisao } from "../contracts/decisao.ts";
import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { capacidadesDeLeitura, fraseDoPedidoDeAcesso } from "../domain/pedido-acesso.ts";
import { evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";

type ConectorDoPedido = Pick<Conector, "id" | "slug" | "nome" | "catalogo" | "habilitado">;

/**
 * A decisão 'acesso' de MESMO id da proposta (ADR-044): o card da conversa e "Sua vez" decidem pelo
 * mesmo botão, num clique. A frase é do domínio, nunca do modelo.
 */
export async function abrirDecisaoDeAcesso(
  deps: Deps,
  p: { proposta: Proposta; payload: PayloadPropostaAcesso; conector: Pick<Conector, "slug" | "nome" | "catalogo">; instrucaoDaRotina: string | null; turnoId: string | null },
): Promise<Decisao> {
  const agente = await deps.repos.agentes.buscar(p.proposta.agenteId);
  const decisao = await deps.repos.decisoes.criar({
    id: p.proposta.id,
    tipo: "acesso",
    agenteId: p.proposta.agenteId,
    conversaId: p.proposta.conversaId,
    turnoId: p.turnoId,
    prazoDecisaoEm: deps.agora() + PRAZO_DECISAO_PADRAO_MS,
    frase: fraseDoPedidoDeAcesso({ agente: agente?.nome ?? "O agente", slug: p.conector.slug, nomeConector: p.conector.nome, capacidades: p.payload.capacidades, catalogo: p.conector.catalogo, rotina: p.instrucaoDaRotina }),
  });
  if (!decisao) throw new ErroDeDominio("nao_permitido");
  return decisao;
}

/** proposta_criada (+ decisao_criada quando o card é o de um clique), com a autoria de quem abriu. */
export function eventosDoPedido(deps: Deps, p: { proposta: Proposta; payload: PayloadPropostaAcesso; decisao: Decisao | null; autoria: Autoria; turnoId: string | null }): RuntimeEvent[] {
  const ref = { autoria: p.autoria, agora: deps.agora(), conversaId: p.proposta.conversaId, turnoId: p.turnoId };
  const events = [evento(deps.escopo, { kind: "proposta_criada", ...ref, dados: { proposta_id: p.proposta.id, kind: "acesso", conector: p.payload.conector, capacidades: p.payload.capacidades.length, nivel: p.payload.nivel } })];
  if (p.decisao) events.push(evento(deps.escopo, { kind: "decisao_criada", ...ref, dados: { decisao_id: p.decisao.id, tipo: "acesso", proposta_id: p.proposta.id } }));
  return events;
}

export type EntradaGarantirPedido = {
  agenteId: string;
  conversaId: string;
  rotinaId: string;
  /** A instrução da rotina, que vira o nome dela na frase; null = rotina excluída (a frase fica sem ela). */
  instrucaoDaRotina: string | null;
  slug: string;
  /** O conector registrado; null = o app ainda não foi registrado (só dá para pedir a conexão). */
  conector: ConectorDoPedido | null;
  /** Falta conectar: o card é o de conexão, sem decisão. App ausente ou desligado também é conexão. */
  conectar: boolean;
  /** As capacidades exatas (declaradas, ou pedidas pelo agente); null = as de leitura do catálogo, resolvidas AGORA. */
  capacidades: readonly string[] | null;
  naoPedido?: readonly string[];
  turnoId: string | null;
  autoria: Autoria;
};

export type SaidaGarantirPedido = { proposta: Proposta; decisao: Decisao | null; criada: boolean; events: RuntimeEvent[] };

const aberta = (d: Decisao | null): d is Decisao => d !== null && (d.estado === "pendente" || d.estado === "reaberta");

/**
 * EXATAMENTE um pedido de acesso aberto por (agente, app) vindo de rotina (definido em 2026-09-24, emenda
 * da ADR-044, "rotina se trava sozinha"): proposta + decisão de mesmo id — ou só a proposta, no card de
 * conexão —, com `rotinaId`, reaproveitada enquanto estiver aberta. Quem chama: o pré-voo da rotina, o
 * pedir_acesso de um turno de rotina e o "Continuar tarefa" do card de conexão. Todo INSERT passa por
 * propostas.criarAcessoDeRotina (ON CONFLICT no índice da 0026): nunca 23505 numa chamada de ferramenta.
 *
 * - card de conexão aberto e o app ficou pronto → ele sai (confirmada) e nasce, no lugar, o de um clique,
 *   da MESMA rotina e do mesmo turno — é o que a pessoa conectou para destravar;
 * - card de um clique cuja decisão fechou (vencida antes desta emenda, sem decisão de mesmo id) → morto:
 *   sai (recusada) e nasce um novo — senão ele travaria a rotina sem botão nenhum;
 * - as capacidades são resolvidas na criação do card (as de leitura do catálogo sondado), nunca depois.
 *
 * Trava (agente, conector) quando o app está registrado: o clique que concede (decidir-acesso.ts) trava
 * o mesmo par, e o card nunca nasce para um acesso que acabou de ser dado. A trava é reentrante na tx.
 */
export async function garantirPedidoDeAcesso(deps: Deps, e: EntradaGarantirPedido): Promise<SaidaGarantirPedido> {
  if (e.conector) await deps.repos.concessoes.travar(e.agenteId, e.conector.id);
  const querConectar = e.conectar || !e.conector || !e.conector.habilitado;
  let origem = { rotinaId: e.rotinaId, turnoId: e.turnoId, instrucao: e.instrucaoDaRotina, conversaId: e.conversaId };

  const existente = await deps.repos.propostas.acessoDeRotinaAberto(e.agenteId, e.slug);
  if (existente?.payload.kind === "acesso") {
    const p = existente.payload;
    if (p.conectar && querConectar) return { proposta: existente, decisao: null, criada: false, events: [] };
    const decisao = p.conectar ? null : await deps.repos.decisoes.buscar(existente.id);
    if (aberta(decisao)) return { proposta: existente, decisao, criada: false, events: [] };
    await deps.repos.propostas.decidir(existente.id, p.conectar ? "confirmada" : "recusada");
    if (p.conectar && p.rotinaId && p.rotinaId !== e.rotinaId) {
      const daRotina = await deps.repos.rotinas.buscar(p.rotinaId);
      origem = { rotinaId: p.rotinaId, turnoId: p.turnoId ?? null, instrucao: daRotina && daRotina.excluidoEm === null ? daRotina.instrucao : null, conversaId: existente.conversaId };
    } else if (p.conectar) {
      origem = { ...origem, turnoId: p.turnoId ?? e.turnoId, conversaId: existente.conversaId };
    }
  }

  const conector = querConectar ? null : e.conector;
  const capacidades = conector ? (e.capacidades !== null ? [...new Set(e.capacidades)] : capacidadesDeLeitura(conector.catalogo)) : [];
  if (conector && capacidades.length === 0) throw new ErroDeDominio("entrada_invalida", { cause: "o app não tem ferramenta de leitura" });
  const porNome = new Map((conector?.catalogo ?? []).map((c) => [c.nome, c]));
  const nivel = capacidades.some((c) => porNome.get(c)?.readOnlyHint !== true) ? "escrita" : "leitura";
  const geracao = origem.turnoId === null ? await deps.repos.agentes.geracaoExecucao(e.agenteId) : null;
  const payload: PayloadPropostaAcesso & { rotinaId: string } = {
    kind: "acesso",
    ...(origem.turnoId !== null ? { turnoId: origem.turnoId } : {}),
    ...(conector ? {} : { conectar: true as const }),
    conector: e.slug,
    capacidades,
    nivel,
    naoPedido: [...(e.naoPedido ?? [])],
    rotinaId: origem.rotinaId,
    ...(geracao !== null ? { geracao } : {}),
  };

  const r = await deps.repos.propostas.criarAcessoDeRotina({ conversaId: origem.conversaId, agenteId: e.agenteId, payload });
  if (!r) throw new ErroDeDominio("estado_invalido", { cause: "pedido de acesso da rotina não criado" });
  // Perdeu a corrida no índice para outra tx que já commitou: o card dela serve.
  if (!r.criada) return { proposta: r.proposta, decisao: r.proposta.payload.kind === "acesso" && r.proposta.payload.conectar ? null : await deps.repos.decisoes.buscar(r.proposta.id), criada: false, events: [] };
  const decisao = conector ? await abrirDecisaoDeAcesso(deps, { proposta: r.proposta, payload, conector, instrucaoDaRotina: origem.instrucao, turnoId: origem.turnoId }) : null;
  return { proposta: r.proposta, decisao, criada: true, events: eventosDoPedido(deps, { proposta: r.proposta, payload, decisao, autoria: e.autoria, turnoId: origem.turnoId }) };
}
