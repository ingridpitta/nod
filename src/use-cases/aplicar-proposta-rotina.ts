import { createHash } from "node:crypto";
import type { Proposta } from "../contracts/conversa.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { revisaoDaRotina } from "../domain/revisao-rotina.ts";
import { quandoDaRotina, proximaDaRotina } from "../domain/rotina-texto.ts";
import { log } from "../obs/log.ts";
import { evento, eventoDeRotina, exigir, textoRotinaAtiva } from "./apoio-l7.ts";
import { concederAcessosDaRotina } from "./conceder-acessos-da-rotina.ts";
import { autoriaDeQuemConfirma, fecharDecisaoDaProposta, type PorRegra } from "./confirmar-pelo-modo.ts";
import { invalidarCardDeRitmo } from "./ritmo-card.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/** `obsoleta` (NOD-159): a rotina mudou depois da proposta; nada foi aplicado e a proposta saiu recusada. */
export type SaidaAplicarPropostaRotina = { rotina: Rotina; jaAplicada: boolean; obsoleta?: true };

/**
 * Confirmação das propostas 'rotina_atualizacao' e 'rotina_exclusao' pela pessoa (L9, decidir).
 * Aplica a operação NORMALIZADA guardada no payload — nenhum modelo reinterpreta o pedido (E7.1).
 *
 * Diferente de ativarRotina, aqui a rotina já existe e tem id próprio: a ligação
 * proposta↔rotina é o campo `rotinaId` do payload, não a igualdade de ids.
 */

export const TEXTO_ROTINA_MUDOU = "Esta mudança não foi aplicada: a rotina mudou depois da proposta. Peça de novo ao bot.";

/** A revisão que vai no payload ao propor e que a confirmação confere (sha256 em hex). */
export function revisaoAtual(rotina: Rotina): string {
  return revisaoDaRotina(rotina, (texto) => createHash("sha256").update(texto).digest("hex"));
}

/** O erro que quem chama devolve DEPOIS do commit, quando o caso respondeu `obsoleta`. */
export function erroRotinaMudou(): ErroDeDominio {
  return new ErroDeDominio("estado_invalido", { cause: "rotina_mudou" });
}

/**
 * definido em 2026-10-06 (NOD-159): o card foi montado sobre uma rotina que já não existe assim. Falha fechada sem
 * LANÇAR: a confirmação roda dentro da transação da rota (comoDona) ou do turno (porRegra), e um throw aqui
 * desfaria a recusa, a decisão fechada e o aviso. Quem chama traduz `obsoleta` em erroRotinaMudou().
 * Não reusa recusarProposta: ela grava a frase genérica de recusa, e aqui o aviso é um só, o da revisão.
 */
async function recusarObsoleta(deps: Deps, proposta: Proposta, atual: Rotina, porRegra: PorRegra | undefined): Promise<{ data: SaidaAplicarPropostaRotina; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  await deps.repos.propostas.decidir(proposta.id, "recusada");
  const autoria = autoriaDeQuemConfirma(deps, proposta.agenteId, porRegra);
  const mensagem = await deps.repos.mensagens.criar({ conversaId: atual.conversaId, autoria, kind: "sistema", texto: TEXTO_ROTINA_MUDOU, payload: eventoDeRotina(atual, "nao_aplicada"), confianca: "confiavel" });
  log("aviso", "proposta_rotina_obsoleta", { proposta_id: proposta.id, rotina_id: atual.id });
  const events: RuntimeEvent[] = [];
  if (mensagem) events.push(evento(deps, "mensagem_criada", autoria, { mensagem_id: mensagem.id, kind: "sistema" }, { conversaId: atual.conversaId }));
  // Na rota a decisão já foi fechada por quem clicou (decisoes.ts): aqui volta null e não fecha duas vezes.
  const { decisao, sincronizar } = await fecharDecisaoDaProposta(deps, proposta.id, agora, porRegra);
  if (decisao) events.push(evento(deps, "decisao_decidida", autoria, { decisaoId: decisao.id, tipo: proposta.kind }, { conversaId: atual.conversaId }), ...sincronizar);
  return { data: { rotina: atual, jaAplicada: false, obsoleta: true }, events };
}

/** Proposta sem `revisao` nasceu antes da NOD-159 e aplica como antes, para não travar card já aberto. */
function mudouDesdeAProposta(revisao: string | undefined, atual: Rotina): boolean {
  return revisao !== undefined && revisao !== revisaoAtual(atual);
}

/** Idempotente pelo estado da proposta: confirmada duas vezes não aplica duas vezes. */
function jaDecidida(estado: string): boolean {
  return estado === "confirmada";
}

/**
 * definido em 2026-10-06 (NOD-182): trava a rotina (FOR UPDATE) e relê a proposta. Duas confirmações concorrentes da
 * mesma revisão liam a rotina antes de qualquer uma gravar e as duas aplicavam; travada, a segunda espera a primeira
 * e relê a rotina já mudada. O mesmo card confirmado duas vezes acorda com a proposta já `confirmada` e volta
 * jaAplicada, em vez do aviso falso de "rotina mudou".
 * definido em 2026-10-07 (NOD-197): a PROPOSTA é travada primeiro, e a rotina depois. Só lida, ela saía `pendente`
 * enquanto a conversa a recusava, e a mudança era aplicada com a proposta recusada. A ordem é a de todos os caminhos
 * do card — proposta, decisão, rotina —: a rota de "Sua vez" já chega com a proposta travada (decisoes.ts), e o
 * modo do bot (porRegra) trava aqui a proposta antes da rotina e da decisão. Propostas diferentes sobre a mesma rotina
 * seguem serializadas pela rotina, sem ciclo: cada uma trava a sua proposta e depois a rotina.
 */
async function travarRotinaEReler(deps: Deps, propostaId: string, rotinaId: string): Promise<{ proposta: Proposta; atual: Rotina }> {
  const proposta = await deps.repos.propostas.buscarParaAtualizar(propostaId);
  if (!proposta) {
    exigir(await deps.repos.propostas.buscar(propostaId), "nao_encontrado", "proposta");
    throw new ErroDeDominio("nao_permitido", { cause: "só a dona decide a proposta" });
  }
  if (proposta.estado === "recusada") throw new ErroDeDominio("estado_invalido", { cause: "proposta recusada" });
  const atual = await deps.repos.rotinas.buscarParaAtualizar(rotinaId);
  if (!atual) {
    // O FOR UPDATE só enxerga a rotina da dona; a de outra pessoa do tenant existe, mas não é dela para mudar.
    exigir(await deps.repos.rotinas.buscar(rotinaId), "nao_encontrado", "rotina");
    throw new ErroDeDominio("nao_permitido", { cause: "só a dona muda a rotina" });
  }
  return { proposta, atual };
}

/** NOD-197: `decidir` só sai de pendente; null = a proposta já não estava pendente. Aborta (rollback, 409) sem aplicar. */
async function confirmarOuAbortar(deps: Deps, propostaId: string): Promise<void> {
  if (!(await deps.repos.propostas.decidir(propostaId, "confirmada"))) throw new ErroDeDominio("estado_invalido", { cause: "proposta já não está pendente" });
}

/** `porRegra` (ADR-059): o modo do bot confirmou no turno — sem clique; autoria do agente e decisão fechada por regra. */
export const aplicarAtualizacaoRotina: CasoDeUso<{ propostaId: string; porRegra?: PorRegra }, SaidaAplicarPropostaRotina> = async (deps, input) => {
  const lida = exigir(await deps.repos.propostas.buscar(input.propostaId), "nao_encontrado", "proposta");
  if (lida.payload.kind !== "rotina_atualizacao") throw new ErroDeDominio("estado_invalido", { cause: "proposta não é de atualização de rotina" });
  if (lida.estado === "recusada") throw new ErroDeDominio("estado_invalido", { cause: "proposta recusada" });
  const p = lida.payload;
  const { proposta, atual } = await travarRotinaEReler(deps, input.propostaId, p.rotinaId);
  if (atual.excluidoEm !== null) {
    // NOD-182: a exclusão venceu a corrida (ou veio antes). Com revisão é o mesmo caso de "a rotina mudou": recusa e
    // avisa sem lançar, para a transação guardar a recusa. Proposta sem revisão (antes da NOD-159) mantém o erro.
    if (p.revisao !== undefined && proposta.estado === "pendente") return recusarObsoleta(deps, proposta, atual, input.porRegra);
    throw new ErroDeDominio("estado_invalido", { cause: "rotina excluída" });
  }
  if (jaDecidida(proposta.estado)) return { data: { rotina: atual, jaAplicada: true } };
  if (mudouDesdeAProposta(p.revisao, atual)) return recusarObsoleta(deps, proposta, atual, input.porRegra);

  const agora = deps.agora();
  // O instante guardado na proposta pode ter passado enquanto ninguém confirmava (mesma regra de
  // ativarRotina): recalcula do cron JÁ VALIDADO do payload, sem reinterpretar texto.
  const proximaExecucao = proximaDaRotina({ ...atual, cron: p.cron ?? atual.cron, fusoIana: p.fusoIana ?? atual.fusoIana }, agora);
  await confirmarOuAbortar(deps, proposta.id);
  const rotina = await deps.repos.rotinas.atualizar(p.rotinaId, {
    cron: p.cron,
    fusoIana: p.fusoIana,
    instrucao: p.instrucao,
    fonte: p.fonte,
    entregavel: p.entregavel,
    limitesAprovacao: p.limitesAprovacao,
    politicaSemDado: p.politicaSemDado,
    proximaExecucao,
    // revisto em 2026-10-20 (NOD-317): o flag do "A fazer" de proposta antiga, se vier no payload, é ignorado — a
    // proposta aplica o resto e não falha.
    acessos: p.acessos,
  });
  if (!rotina) throw new ErroDeDominio("nao_permitido", { cause: "só a dona atualiza a rotina" });
  // NOD-313 (2026-10-23): editar a rotina zera a contagem de execuções sem novidade e fecha o card aberto como inválido
  // (a trava da rotina vem antes).
  await deps.repos.rotinaRitmo.contar(rotina.id, "zera");
  const ritmo = await invalidarCardDeRitmo(deps, rotina);
  const autoria = autoriaDeQuemConfirma(deps, proposta.agenteId, input.porRegra);
  await deps.repos.mensagens.criar({
    conversaId: rotina.conversaId,
    autoria,
    kind: "sistema",
    texto: `Rotina atualizada. ${textoRotinaAtiva(rotina, agora)}`,
    payload: eventoDeRotina(rotina, "mudada"),
    confianca: "confiavel",
  });
  const events: RuntimeEvent[] = [
    evento(deps, "rotina_atualizada", autoria, { rotinaId: rotina.id, propostaId: proposta.id, proximaExecucao: rotina.proximaExecucao, fusoIana: rotina.fusoIana }, { conversaId: rotina.conversaId }),
    ...ritmo,
  ];
  // definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): a mudança que traz `acessos`
  // concede, na mesma transação, o que ainda não estava concedido — o que já estava não vira mensagem
  // nova (concederLote é idempotente). App que saiu da lista NÃO é revogado aqui: revogar é pela tela.
  if (p.acessos) events.push(...((await concederAcessosDaRotina(deps, { agenteId: rotina.agenteId, acessos: p.acessos, ...(input.porRegra ? { porRegra: input.porRegra } : {}) })).events ?? []));
  const { decisao, sincronizar } = await fecharDecisaoDaProposta(deps, proposta.id, agora, input.porRegra);
  if (decisao) events.push(evento(deps, "decisao_decidida", autoria, { decisaoId: decisao.id, tipo: "rotina_atualizacao" }, { conversaId: rotina.conversaId }), ...sincronizar);
  return { data: { rotina, jaAplicada: false }, events };
};

/**
 * Exclusão RECUPERÁVEL (ADR-034): carimba excluido_em, some das listagens/teto/tick e para de
 * disparar. Turno já em execução pode terminar — mesmo limite do resto do nod.
 */
export const aplicarExclusaoRotina: CasoDeUso<{ propostaId: string; porRegra?: PorRegra }, SaidaAplicarPropostaRotina> = async (deps, input) => {
  const lida = exigir(await deps.repos.propostas.buscar(input.propostaId), "nao_encontrado", "proposta");
  if (lida.payload.kind !== "rotina_exclusao") throw new ErroDeDominio("estado_invalido", { cause: "proposta não é de exclusão de rotina" });
  if (lida.estado === "recusada") throw new ErroDeDominio("estado_invalido", { cause: "proposta recusada" });
  const p = lida.payload;
  const { proposta, atual } = await travarRotinaEReler(deps, input.propostaId, p.rotinaId);
  if (jaDecidida(proposta.estado)) return { data: { rotina: atual, jaAplicada: true } };
  const agora = deps.agora();
  if (atual.excluidoEm !== null) {
    // Outra proposta já excluiu a rotina: o pedido desta está cumprido. Sem fechá-la, ela ficava pendente e o card
    // "Excluir rotina" voltava na conversa com a decisão já fechada. Fecha sem segundo aviso de "Rotina excluída".
    await confirmarOuAbortar(deps, proposta.id);
    const { decisao, sincronizar } = await fecharDecisaoDaProposta(deps, proposta.id, agora, input.porRegra);
    const autoria = autoriaDeQuemConfirma(deps, proposta.agenteId, input.porRegra);
    const events = decisao ? [evento(deps, "decisao_decidida", autoria, { decisaoId: decisao.id, tipo: "rotina_exclusao" }, { conversaId: atual.conversaId }), ...sincronizar] : [];
    return { data: { rotina: atual, jaAplicada: true }, events };
  }
  if (mudouDesdeAProposta(p.revisao, atual)) return recusarObsoleta(deps, proposta, atual, input.porRegra);

  await confirmarOuAbortar(deps, proposta.id);
  const rotina = await deps.repos.rotinas.excluir(p.rotinaId, agora);
  if (!rotina) throw new ErroDeDominio("nao_permitido", { cause: "só a dona exclui a rotina" });
  // NOD-84: excluir revoga o endereço do webhook na mesma transação (a chamada seguinte é 401, como endereço errado).
  await deps.repos.rotinaGatilhos.revogarDaRotina(rotina.id, agora);
  const ritmo = await invalidarCardDeRitmo(deps, rotina); // NOD-313: o card de ritmo aberto fecha sem aplicar nada.
  const autoria = autoriaDeQuemConfirma(deps, proposta.agenteId, input.porRegra);
  await deps.repos.mensagens.criar({
    conversaId: rotina.conversaId,
    autoria,
    kind: "sistema",
    texto: `Rotina excluída: ${quandoDaRotina(rotina)}. Nada mais será disparado por ela.`,
    payload: eventoDeRotina(rotina, "excluida"),
    confianca: "confiavel",
  });
  const events: RuntimeEvent[] = [
    evento(deps, "rotina_excluida", autoria, { rotinaId: rotina.id, propostaId: proposta.id }, { conversaId: rotina.conversaId }),
    ...ritmo,
  ];
  const { decisao, sincronizar } = await fecharDecisaoDaProposta(deps, proposta.id, agora, input.porRegra);
  if (decisao) events.push(evento(deps, "decisao_decidida", autoria, { decisaoId: decisao.id, tipo: "rotina_exclusao" }, { conversaId: rotina.conversaId }), ...sincronizar);
  return { data: { rotina, jaAplicada: false }, events };
};
