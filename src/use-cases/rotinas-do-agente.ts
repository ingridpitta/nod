import type { PayloadProposta, PayloadPropostaRotinaAtualizacao, PayloadPropostaRotinaExclusao } from "../contracts/conversa.ts";
import type { PayloadPropostaRotinaExecucao } from "../contracts/rotina-execucao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { EstadoRotina, Rotina } from "../contracts/rotina.ts";
import type { CasoNod, ContextoFerramenta } from "../contracts/servicos.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { nomeDoApp } from "../domain/pedido-acesso.ts";
import { mesmosAcessos } from "../domain/rotina-acessos.ts";
import { instanteLocal, textoRetomada } from "../domain/rotina-retomada.ts";
import { ehWebhook, validarAtualizacaoRotina, quandoDaRotina } from "../domain/rotina-texto.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import { agenteVisivel, assertUuid, autoriaAgente, carimbo, evento, PRAZO_DECISAO_MS } from "./apoio-l7.ts";
import { aplicarAtualizacaoRotina, aplicarExclusaoRotina, erroRotinaMudou, revisaoAtual } from "./aplicar-proposta-rotina.ts";
import { confirmacaoPeloModo, semCard } from "./confirmar-pelo-modo.ts";
import { acessosDeclarados } from "./criar-rotina.ts";
import { pausarRotina } from "./pausar-rotina.ts";
import { ehColega } from "./ver-colegas.ts";
import type { Deps } from "./tipos.ts";

/**
 * As três ferramentas que o agente usa sobre rotina que JÁ EXISTE (criar_rotina continua sendo o
 * caminho de nascimento, por proposta). Pausar e reativar aplicam DIRETO, sem proposta: são
 * reversíveis em um clique e já são ato de um botão na web — pedir confirmação aqui seria cerimônia
 * que a própria interface não pede. Atualizar e excluir, que não são reversíveis, passam por
 * proposta.
 *
 * O id vem TIPADO do inventário no prompt de sistema (prompt-sistema.ts); nenhum texto é
 * interpretado aqui — é a Regra 9 de rotina-texto.ts valendo também para o ciclo de vida.
 */

/** `listar_rotinas`: mesma forma do inventário do prompt, para o modelo não ver dois formatos. */
export const listarRotinasDoAgente: CasoNod<Deps, "listar_rotinas"> = async (deps, input) => {
  assertUuid(input.agenteId, "agenteId");
  const rotinas = await deps.repos.rotinas.listarDoAgente(input.agenteId);
  return {
    data: {
      rotinas: rotinas.map((r) => ({
        id: r.id,
        quando: quandoDaRotina(r),
        estado: r.estado,
        instrucao: r.instrucao,
      })),
    },
  };
};

/**
 * Tronco de pausar_rotina/reativar_rotina. Erro de domínio volta TIPADO em {erro} para o modelo
 * corrigir a chamada (mesmo contrato de criar_rotina), em vez de virar negação do proxy.
 * A rotina tem que ser DESTE agente, ou de um colega quando a pessoa pediu (rotinaAlternavel): o id vem
 * do modelo, e sem esse filtro um agente mexeria na rotina de qualquer outro dentro do mesmo tenant
 * (rotinas.buscar é tenant-wide, por RLS de leitura).
 */
async function alternar(deps: Deps, input: { agenteId: string; rotinaId: string; plano?: PlanoTurno; ate?: string }, estado: EstadoRotina) {
  try {
    const { rotina: atual, quem } = await rotinaAlternavel(deps, input);
    // NOD-412: `ate` é hora local no fuso DA ROTINA (a pessoa fala do horário dela); vira instante aqui, e o executor valida.
    const retomarEm = estado === "pausada" && input.ate !== undefined ? instanteLocal(input.ate, atual.fusoIana) : null;
    const jaEstava = atual.estado === estado && (estado === "ativa" || retomarEm === null || retomarEm === (atual.retomarEm ?? null));
    // Na conversa do colega fica dito quem pausou e a pedido de quem: a pessoa abre a Nina e entende.
    const ate = retomarEm !== null ? ` até ${textoRetomada(retomarEm, atual.fusoIana, deps.agora())}: volta sozinha.` : ": nada será disparado até você reativar.";
    const texto = quem && estado === "pausada" ? `${quem} pausou esta rotina a seu pedido${ate}` : undefined;
    const { data } = await pausarRotina(deps, { rotinaId: input.rotinaId, estado, retomarEm, autoria: autoriaAgente(input.agenteId, deps.escopo.pessoaId), ...(texto ? { texto } : {}) });
    return { data: { rotina_id: data.rotina.id, estado: data.rotina.estado, ja_estava: jaEstava, proxima_execucao: data.rotina.estado === "ativa" ? data.rotina.proximaExecucao : null, retomar_em: data.rotina.estado === "pausada" ? data.rotina.retomarEm ?? null : null } };
  } catch (e) {
    if (ehErroDeDominio(e)) return { data: { erro: e.codigo } };
    throw e;
  }
}

export const pausarRotinaPeloAgente: CasoNod<Deps, "pausar_rotina"> = (deps, input) =>
  alternar(deps, { agenteId: input.agenteId, rotinaId: input.rotina_id, plano: input.plano, ...(input.ate !== undefined ? { ate: input.ate } : {}) }, "pausada");

export const reativarRotinaPeloAgente: CasoNod<Deps, "reativar_rotina"> = (deps, input) =>
  alternar(deps, { agenteId: input.agenteId, rotinaId: input.rotina_id, plano: input.plano }, "ativa");

/**
 * definido em 2026-09-28 (ADR-050): a Teodora assume o que a Nina, a Ada e a Taga faziam e pergunta se
 * pausa as rotinas delas, para nada chegar em dobro. Pausar e reativar são reversíveis em um clique e a
 * pessoa está no turno; por isso a rotina de um COLEGA (mesmo dono, confirmado, visível — o filtro de
 * ver_colegas) também vale, mas só com entrada confiável: turno aberto por mensagem da pessoa. Pergunta de
 * outro bot, conteúdo de conector ou rotina acordada sozinha nunca mexem na rotina de outro agente.
 * `quem` = nome de quem pausou quando a rotina é de colega; null quando é a própria.
 */
async function rotinaAlternavel(deps: Deps, input: { agenteId: string; rotinaId: string; plano?: PlanoTurno }): Promise<{ rotina: Rotina; quem: string | null }> {
  assertUuid(input.agenteId, "agenteId");
  assertUuid(input.rotinaId, "rotina_id");
  const r = await deps.repos.rotinas.buscar(input.rotinaId);
  if (!r || r.excluidoEm !== null) throw new ErroDeDominio("nao_encontrado", { cause: "rotina excluída ou inexistente" });
  if (r.agenteId === input.agenteId) return { rotina: r, quem: null };
  if (input.plano?.confiancaEntrada !== "confiavel") throw new ErroDeDominio("nao_encontrado", { cause: "rotina de outro agente fora de pedido da pessoa" });
  const eu = await agenteVisivel(deps.repos, input.agenteId);
  const dono = await deps.repos.agentes.buscar(r.agenteId);
  if (!dono || !ehColega(eu, dono)) throw new ErroDeDominio("nao_encontrado", { cause: "rotina de quem não é colega" });
  return { rotina: r, quem: eu.nome };
}

/** A rotina tem que existir, ser DESTE agente e não estar excluída. Mesmo filtro de `alternar`. */
async function rotinaDoAgente(deps: Deps, agenteId: string, rotinaId: string): Promise<Rotina> {
  assertUuid(agenteId, "agenteId");
  assertUuid(rotinaId, "rotina_id");
  const r = await deps.repos.rotinas.buscar(rotinaId);
  if (!r || r.agenteId !== agenteId || r.excluidoEm !== null) throw new ErroDeDominio("nao_encontrado", { cause: "rotina de outro agente, excluída ou inexistente" });
  return r;
}

/** Abre proposta + decisão com o MESMO id (a ligação entre as duas, como em criar_rotina). */
async function propor(deps: Deps, input: ContextoFerramenta, payload: PayloadProposta, frase: string) {
  const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: input.agenteId, payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const decisao = await deps.repos.decisoes.criar({
    id: proposta.id,
    tipo: payload.kind === "rotina_exclusao" || payload.kind === "rotina_execucao" ? payload.kind : "rotina_atualizacao",
    agenteId: input.agenteId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    prazoDecisaoEm: deps.agora() + PRAZO_DECISAO_MS,
    frase,
  });
  const autoria = autoriaAgente(input.agenteId, deps.escopo.pessoaId);
  const events: RuntimeEvent[] = [
    evento(deps, "proposta_criada", autoria, { propostaId: proposta.id, kind: payload.kind }, { conversaId: input.conversaId, turnoId: input.turnoId }),
  ];
  if (decisao) events.push(evento(deps, "decisao_criada", autoria, { decisaoId: decisao.id, tipo: payload.kind }, { conversaId: input.conversaId, turnoId: input.turnoId }));
  return { proposta, events };
}

/**
 * NOD-159: a rotina mudou entre propor e aplicar no mesmo turno (raro, mas a regra é uma só). O caso já recusou a
 * proposta e avisou; o erro volta ao modelo SEM lançar, para a transação do turno guardar a recusa e o aviso.
 */
function obsoleta(daProposta: readonly RuntimeEvent[], daAplicacao: readonly RuntimeEvent[] | undefined) {
  return { data: { erro: erroRotinaMudou().codigo }, events: [...semCard(daProposta), ...(daAplicacao ?? [])] };
}

/**
 * `atualizar_rotina`: NADA é aplicado — nasce proposta 'rotina_atualizacao' com o payload já
 * normalizado (sobrevive a reinício sem reinterpretar, E7.1). Diferente de pausar, mudar QUANDO ou
 * O QUE a rotina faz sozinha não é reversível em um clique, então a pessoa confirma.
 * definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): `acessos` é a lista NOVA,
 * validada como em criar_rotina; só entra no payload se muda a declaração. Aplicar concede o que é novo.
 */
export const atualizarRotinaPeloAgente: CasoNod<Deps, "atualizar_rotina"> = async (deps, input) => {
  try {
    const atual = await rotinaDoAgente(deps, input.agenteId, input.rotina_id);
    const acessos = await acessosDeclarados(deps, input.acessos);
    const mudaAcessos = acessos !== undefined && !mesmosAcessos(acessos, atual.acessos);
    const { normalizada } = validarAtualizacaoRotina({
      mudaAcessos,
      atual,
      pedido: {
        cron: input.cron,
        fusoIana: input.fuso_iana,
        instrucao: input.instrucao,
        fonte: input.fonte,
        entregavel: input.entregavel,
        limitesAprovacao: input.limites_aprovacao,
        politicaSemDado: input.politica_sem_dado,
      },
      agora: deps.agora(),
    });
    const payload: PayloadPropostaRotinaAtualizacao = {
      kind: "rotina_atualizacao",
      rotinaId: atual.id,
      cron: normalizada.cron,
      fusoIana: normalizada.fusoIana,
      instrucao: normalizada.instrucao,
      fonte: normalizada.fonte,
      entregavel: normalizada.entregavel,
      limitesAprovacao: normalizada.limitesAprovacao,
      politicaSemDado: normalizada.politicaSemDado,
      proximaExecucao: normalizada.proximaExecucao,
      resumo: normalizada.resumo,
      ...(mudaAcessos && acessos ? { acessos } : {}),
      antes: { resumo: quandoDaRotina(atual), instrucao: atual.instrucao },
      ...(ehWebhook(atual) ? { gatilho: "webhook" as const } : {}),
      // NOD-159: a confirmação só aplica se a rotina ainda for a que o card mostra.
      revisao: revisaoAtual(atual),
    };
    const precisa = payload.acessos?.length ? ` · precisa de ${payload.acessos.map((a) => `${nomeDoApp(a.conector)} (${a.nivel})`).join(", ")}` : "";
    const { proposta, events } = await propor(deps, input, payload, `Mudança de rotina proposta: de ${payload.antes.resumo} para ${normalizada.resumo}${ehWebhook(atual) ? "" : ` · próxima execução ${carimbo(normalizada.proximaExecucao, normalizada.fusoIana)}`}${precisa}`);
    // ADR-059 (emenda de 2026-09-30): no automático e no total o modo confirma na hora — a proposta fica como
    // registro do que mudou, fechada pela regra, e a rotina já vale.
    const porRegra = await confirmacaoPeloModo(deps, input, { arriscada: false, gravaInstrucao: true });
    if (porRegra) {
      const aplicada = await aplicarAtualizacaoRotina(deps, { propostaId: proposta.id, porRegra });
      if (aplicada.data.obsoleta) return obsoleta(events, aplicada.events);
      return { data: { proposta_id: proposta.id, resumo: normalizada.resumo, aplicada: true }, events: [...semCard(events), ...(aplicada.events ?? [])] };
    }
    return { data: { proposta_id: proposta.id, resumo: normalizada.resumo }, events };
  } catch (e) {
    if (ehErroDeDominio(e)) return { data: { erro: e.codigo } };
    throw e;
  }
};

/** `excluir_rotina`: também só PROPÕE. A exclusão em si é recuperável (ADR-034). */
export const excluirRotinaPeloAgente: CasoNod<Deps, "excluir_rotina"> = async (deps, input) => {
  try {
    const atual = await rotinaDoAgente(deps, input.agenteId, input.rotina_id);
    const resumo = quandoDaRotina(atual);
    const payload: PayloadPropostaRotinaExclusao = { kind: "rotina_exclusao", rotinaId: atual.id, resumo, instrucao: atual.instrucao, revisao: revisaoAtual(atual) };
    const { proposta, events } = await propor(deps, input, payload, `Exclusão de rotina proposta: ${resumo} — ${atual.instrucao}`);
    // ADR-059: excluir é o "apagar" da rotina — o automático só confirma quando a pessoa pediu na conversa.
    const porRegra = await confirmacaoPeloModo(deps, input, { arriscada: true });
    if (porRegra) {
      const aplicada = await aplicarExclusaoRotina(deps, { propostaId: proposta.id, porRegra });
      if (aplicada.data.obsoleta) return obsoleta(events, aplicada.events);
      return { data: { proposta_id: proposta.id, resumo, aplicada: true }, events: [...semCard(events), ...(aplicada.events ?? [])] };
    }
    return { data: { proposta_id: proposta.id, resumo }, events };
  } catch (e) {
    if (ehErroDeDominio(e)) return { data: { erro: e.codigo } };
    throw e;
  }
};

/**
 * NOD-413: `executar_rotina` — "roda agora a rotina das 9h". Só PROPÕE, sempre: o risco é `pessoa_confirma`
 * (src/domain/acoes/rotinas.ts), então nem o modo "Ignorar todas as aprovações" dispara sem o clique em "Rodar agora".
 * Só rotina DESTE bot (rotinaDoAgente); a de um colega fica para a NOD-393. O clique roda pelo executor único do Testar
 * agora (EXECUTORES_ROTINAS), em aplicarExecucaoRotina. Pedir de novo com o card ainda aberto devolve o mesmo card.
 */
export const executarRotinaPeloAgente: CasoNod<Deps, "executar_rotina"> = async (deps, input) => {
  try {
    const atual = await rotinaDoAgente(deps, input.agenteId, input.rotina_id);
    const resumo = quandoDaRotina(atual);
    // Revisão do PR #15: só reusa o card que ainda se clica. A proposta segue `pendente` depois que a decisão de mesmo id
    // vence ou é dispensada; reusá-la devolvia, para sempre, um card morto (o clique dá 409).
    for (const p of await deps.repos.propostas.pendentesDaConversa(input.conversaId)) {
      if (p.payload.kind !== "rotina_execucao" || p.payload.rotinaId !== atual.id) continue;
      const decisao = await deps.repos.decisoes.buscar(p.id);
      if (decisao && (decisao.estado === "pendente" || decisao.estado === "reaberta")) return { data: { proposta_id: p.id, resumo } };
    }
    const fila = await deps.repos.rotinaJanelas.turnoAberto(atual.id, deps.agora());
    const payload: PayloadPropostaRotinaExecucao = {
      kind: "rotina_execucao", rotinaId: atual.id, resumo, instrucao: atual.instrucao, revisao: revisaoAtual(atual),
      ...(fila ? { naFila: { instanteAgendado: fila.instanteAgendado, fusoIana: atual.fusoIana } } : {}),
    };
    const { proposta, events } = await propor(deps, input, payload, `Rodar agora a rotina: ${resumo} — ${atual.instrucao}`);
    return { data: { proposta_id: proposta.id, resumo }, events };
  } catch (e) {
    if (ehErroDeDominio(e)) return { data: { erro: e.codigo } };
    throw e;
  }
};
