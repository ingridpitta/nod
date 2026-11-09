import type { Agente } from "../contracts/agente.ts";
import type { PayloadPropostaAcesso, Proposta } from "../contracts/conversa.ts";
import type { Decisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { capacidadesDoNivel } from "../domain/grupos-de-acesso.ts";
import { fraseDoPedidoDeAcesso } from "../domain/pedido-acesso.ts";
import { redigir } from "../domain/redacao.ts";
import type { ConectorGuardado } from "../contracts/conector.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { garantirPedidoDeAcesso } from "./garantir-pedido-de-acesso.ts";
import { payloadDaPropostaDecidida } from "./proposta-decidida.ts";
import { abrirPedidoDeAcesso } from "./pedir-acesso.ts";
import { decidirPropostaDeBot } from "./onboarding.ts";
import { confirmarPerfil } from "./confirmar-perfil.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/** `obsoleta` (NOD-190): só no perfil — ele mudou depois do card, nada foi aplicado e quem chama lança erroPerfilMudou(). */
export type SaidaConfirmarProposta = { proposta: Proposta; agente: Agente | null; rotina: Rotina | null; decisao: Decisao | null; obsoleta?: true };

/** definido em 2026-09-24 (ADR-044): confirmar um pedido de acesso NÃO concede — "Confirmado… vale" mentia. */
export const PEDIDO_DE_ACESSO_ABERTO = "Pedido aberto; nada foi concedido ainda.";

/**
 * definido em 2026-09-24 (ADR-044): o card "Conecte o X" sai do caminho depois da conexão. App já
 * conectado e habilitado: fecha o card de conexão e abre no lugar o de concessão (proposta + decisão,
 * um clique), com as ferramentas do NÍVEL pedido no catálogo agora sondado.
 * revisto em 2026-09-25: escrita também (capacidadesDoNivel: ler, criar, editar e comentar; apagar
 * fica de fora) — antes a web postava "Conectei…" em nome da pessoa e o agente gastava outro turno para
 * copiar nomes do catálogo. E sem a mensagem "Pedido aberto…": o próprio card mostra o passo seguinte.
 */
export async function conexaoViraPedido(deps: Deps, existente: Proposta, p: PayloadPropostaAcesso): Promise<{ data: SaidaConfirmarProposta; events: RuntimeEvent[] }> {
  const conector = await deps.repos.conectores.buscarPorSlug(p.conector);
  if (!conector?.habilitado) throw new ErroDeDominio("estado_invalido", { cause: "conecte o app antes de pedir capacidades" });
  const capacidades = capacidadesDoNivel(conector.catalogo, p.rotinaId ? "leitura" : p.nivel);
  if (capacidades.length === 0) throw new ErroDeDominio("estado_invalido", { cause: "o app não tem ferramenta para esse nível" });
  const autoria = autoriaPessoa(deps.escopo);
  if (p.rotinaId) return conexaoDaRotinaViraPedido(deps, existente, { ...p, rotinaId: p.rotinaId }, conector);
  if (!(await deps.repos.propostas.decidir(existente.id, "confirmada"))) throw new ErroDeDominio("estado_invalido", { cause: `proposta ${existente.estado}` });
  // O agente pode ter pedido de novo depois da conexão: o card de concessão que já está aberto serve.
  for (const aberta of await deps.repos.propostas.pendentesDaConversa(existente.conversaId)) {
    // revisto em 2026-09-25: só serve o card que já cobre o que este pede — um de leitura não responde a um pedido de escrita.
    if (aberta.payload.kind !== "acesso" || aberta.payload.conectar || aberta.agenteId !== existente.agenteId || aberta.payload.conector !== p.conector) continue;
    const cobre = new Set(aberta.payload.capacidades);
    if (!capacidades.every((c) => cobre.has(c))) continue;
    const decisao = await deps.repos.decisoes.buscar(aberta.id);
    if (decisao && (decisao.estado === "pendente" || decisao.estado === "reaberta")) return { data: { proposta: aberta, agente: null, rotina: null, decisao }, events: [] };
  }
  const { conectar: _conectar, ...resto } = p;
  const aberto = await abrirPedidoDeAcesso(deps, { conversaId: existente.conversaId, agenteId: existente.agenteId, turnoId: p.turnoId ?? null, payload: { ...resto, capacidades }, conector, autoria });
  return { data: { proposta: aberto.proposta, agente: null, rotina: null, decisao: aberto.decisao }, events: aberto.events };
}

/**
 * definido em 2026-09-24 (emenda da ADR-044): o card de conexão de uma ROTINA vira o de um clique por
 * garantirPedidoDeAcesso — um pedido aberto por (agente, app), pelo índice único da 0026. O pré-voo pode
 * ter feito a troca antes do clique: aí "Continuar tarefa" devolve o card de um clique que já está aberto,
 * em vez do 409 de "proposta confirmada".
 */
async function conexaoDaRotinaViraPedido(deps: Deps, existente: Proposta, p: PayloadPropostaAcesso & { rotinaId: string }, conector: ConectorGuardado): Promise<{ data: SaidaConfirmarProposta; events: RuntimeEvent[] }> {
  if (existente.estado !== "pendente") {
    const aberto = existente.estado === "confirmada" ? await deps.repos.propostas.acessoDeRotinaAberto(existente.agenteId, p.conector) : null;
    const decisao = aberto ? await deps.repos.decisoes.buscar(aberto.id) : null;
    if (!aberto || !decisao) throw new ErroDeDominio("estado_invalido", { cause: `proposta ${existente.estado}` });
    return { data: { proposta: aberto, agente: null, rotina: null, decisao }, events: [] };
  }
  const rotina = await deps.repos.rotinas.buscar(p.rotinaId);
  const autoria = autoriaPessoa(deps.escopo);
  const g = await garantirPedidoDeAcesso(deps, {
    agenteId: existente.agenteId,
    conversaId: existente.conversaId,
    rotinaId: p.rotinaId,
    instrucaoDaRotina: rotina && rotina.excluidoEm === null ? rotina.instrucao : null,
    slug: p.conector,
    conector,
    conectar: false,
    capacidades: null,
    naoPedido: p.naoPedido,
    turnoId: p.turnoId ?? null,
    autoria,
  });
  const events = [...g.events];
  if (g.criada) {
    const mensagem = await deps.repos.mensagens.criar({ conversaId: existente.conversaId, autoria, kind: "sistema", assunto: "proposta.decidida", texto: PEDIDO_DE_ACESSO_ABERTO, confianca: "confiavel" });
    if (mensagem) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId: existente.conversaId, dados: { mensagem_id: mensagem.id, kind: "sistema" } }));
  }
  return { data: { proposta: g.proposta, agente: null, rotina: null, decisao: g.decisao }, events };
}

/**
 * Nada vale antes daqui (E1.1). 'perfil': aplica nome/título/descrição e marca confirmado; 'rotina':
 * services.rotinas.ativar (L7) na MESMA tx; 'acesso': desde 2026-09-24 (ADR-044) o pedido já nasce
 * com a decisão de mesmo id (pedir-acesso.ts) e confirmar só a devolve — o ramo que cria a decisão
 * fica para as propostas anteriores, que nasceram sem ela; a concessão em si é decidir-acesso.ts.
 * Confirmar duas vezes → estado_invalido (o repositório só sai de pendente); o perfil, desde a NOD-190, volta
 * idempotente (confirmar-perfil.ts).
 */
export const confirmarProposta: CasoDeUso<{ propostaId: string; prazoMs?: number }, SaidaConfirmarProposta> = async (deps, input) => {
  const existente = await deps.repos.propostas.buscar(input.propostaId);
  if (!existente) throw new ErroDeDominio("nao_encontrado");
  if (existente.payload.kind === "acesso" && existente.payload.conectar) return conexaoViraPedido(deps, existente, existente.payload);
  // ADR-077: a proposta de bot (propor_bot) cria o bot novo do onboarding; não passa pelo caminho genérico abaixo.
  if (existente.payload.kind === "bot") {
    const r = await decidirPropostaDeBot(deps, { propostaId: existente.id, recusar: false });
    const agente = r.data.agenteId ? await deps.repos.agentes.buscar(r.data.agenteId) : null;
    return { data: { proposta: { ...existente, estado: "confirmada" }, agente, rotina: null, decisao: null }, events: r.events ?? [] };
  }
  // NOD-190: o perfil trava o agente, relê a proposta e confere a revisão ANTES de decidir; o caminho genérico abaixo
  // decide primeiro, e a recusa por perfil mudado teria de sair de `confirmada`.
  if (existente.payload.kind === "perfil") return confirmarPerfil(deps, existente);
  if (existente.payload.kind === "lote_bots") throw new ErroDeDominio("estado_invalido", { cause: "lote do Nod se decide pela decisão do card" });
  // NOD-448: a troca de colunas se decide pela decisão do card (POST decisoes/:id/decidir → decidirColunasDoQuadro).
  if (existente.payload.kind === "colunas_quadro") throw new ErroDeDominio("estado_invalido", { cause: "colunas do quadro se decidem pela decisão do card" });
  // NOD-422: a importação do Linear também (POST decisoes/:id/decidir → decidirImportacaoLinear).
  if (existente.payload.kind === "importacao_linear") throw new ErroDeDominio("estado_invalido", { cause: "a importação do Linear se decide pela decisão do card" });
  // NOD-430: excluir o quadro também (POST decisoes/:id/decidir → decidirQuadroExclusao).
  if (existente.payload.kind === "quadro_exclusao") throw new ErroDeDominio("estado_invalido", { cause: "excluir o quadro se decide pela decisão do card" });
  // NOD-422 (PR 2): o quadro assume a esteira também (POST decisoes/:id/decidir → decidirAssumirQuadro).
  if (existente.payload.kind === "assumir_quadro") throw new ErroDeDominio("estado_invalido", { cause: "assumir o quadro se decide pela decisão do card" });
  if (existente.payload.kind === "app") throw new ErroDeDominio("estado_invalido", { cause: "o app se decide pela decisão do card" });
  // NOD-50: o cartão de credencial só se resolve guardando o valor (POST propostas/:id/credencial) ou recusando; confirmar
  // sem valor não tem o que aplicar.
  if (existente.payload.kind === "credencial") throw new ErroDeDominio("estado_invalido", { cause: "credencial se guarda pelo cartão" });
  if (existente.payload.kind === "acesso" && existente.estado === "pendente") {
    const jaAberta = await deps.repos.decisoes.buscar(existente.id);
    if (jaAberta) return { data: { proposta: existente, agente: null, rotina: null, decisao: jaAberta }, events: [] };
  }
  const proposta = await deps.repos.propostas.decidir(input.propostaId, "confirmada");
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: `proposta ${existente.estado}` });

  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  const nomePessoa = pessoa?.nome ?? "você";
  const events: RuntimeEvent[] = [];
  const agente: Agente | null = null;
  let rotina: Rotina | null = null;
  let decisao: Decisao | null = null;
  let resumo = "";

  if (proposta.payload.kind === "perfil") {
    throw new ErroDeDominio("estado_invalido", { cause: "proposta de perfil se confirma por confirmarPerfil" });
  } else if (proposta.payload.kind === "rotina") {
    // definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): ativar concede os acessos
    // declarados dos apps conectados na MESMA transação (conceder-acessos-da-rotina.ts).
    rotina = await deps.tx((trx) => deps.services.rotinas.ativar(trx, proposta.id));
    resumo = proposta.payload.resumo;
    events.push(evento(deps.escopo, { kind: "rotina_criada", autoria, agora, conversaId: proposta.conversaId, dados: { rotina_id: rotina.id, proposta_id: proposta.id, proxima_execucao: rotina.proximaExecucao } }));
  } else if (proposta.payload.kind === "pasta") {
    // Proposta de pasta se autoriza pelo botão Permitir da conversa (rota workspace), que concede a
    // pasta escolhida e retoma o turno. Não vira decisão de acesso: não há conector nem capacidades.
    throw new ErroDeDominio("estado_invalido", { cause: "proposta de pasta se autoriza pelo botão Permitir na conversa" });
  } else if (proposta.payload.kind === "rotina_atualizacao" || proposta.payload.kind === "rotina_exclusao") {
    // definido em 2026-09-21: mudar/excluir rotina que já existe se confirma pela decisão em "Sua
    // vez" (POST decisoes/:id/decidir → aplicar-proposta-rotina.ts), não por este caminho, que é o
    // de propostas nascidas da conversa. Aqui seria aplicar sem a decisão correspondente.
    throw new ErroDeDominio("estado_invalido", { cause: "proposta de rotina existente se confirma pela decisão em Sua vez" });
  } else if (proposta.payload.kind === "bot") {
    throw new ErroDeDominio("estado_invalido", { cause: "proposta de bot se confirma por decidirPropostaDeBot" });
  } else if (proposta.payload.kind === "lote_bots") {
    // ADR-082: o lote do Nod se decide pela decisão de mesmo id (POST decisoes/:id/decidir → decidirLoteDeBots).
    throw new ErroDeDominio("estado_invalido", { cause: "lote do Nod se decide pela decisão do card" });
  } else if (proposta.payload.kind === "credencial") {
    throw new ErroDeDominio("estado_invalido", { cause: "credencial se guarda pelo cartão" });
  } else if (proposta.payload.kind === "colunas_quadro" || proposta.payload.kind === "quadro_exclusao" || proposta.payload.kind === "assumir_quadro") {
    throw new ErroDeDominio("estado_invalido", { cause: "o quadro se decide pela decisão do card" });
  } else if (proposta.payload.kind === "importacao_linear") {
    throw new ErroDeDominio("estado_invalido", { cause: "a importação do Linear se decide pela decisão do card" });
  } else if (proposta.payload.kind === "app") {
    throw new ErroDeDominio("estado_invalido", { cause: "o app se decide pela decisão do card" });
  } else {
    const p = proposta.payload;
    const agenteDaProposta = await deps.repos.agentes.buscar(proposta.agenteId);
    const conector = await deps.repos.conectores.buscarPorSlug(p.conector);
    const daRotina = p.rotinaId ? await deps.repos.rotinas.buscar(p.rotinaId) : null;
    // definido em 2026-09-16 (L9): a decisão 'acesso' nasce com o MESMO id da proposta — mesma convenção da
    // decisão 'rotina' (criar-rotina.ts) — para POST decisoes/:id/decidir achar o payload (decidir-acesso.ts).
    decisao = await deps.repos.decisoes.criar({
      id: proposta.id,
      tipo: "acesso",
      turnoId: p.turnoId,
      agenteId: proposta.agenteId,
      conversaId: proposta.conversaId,
      prazoDecisaoEm: agora + (input.prazoMs ?? PRAZO_DECISAO_PADRAO_MS),
      frase: fraseDoPedidoDeAcesso({ agente: agenteDaProposta?.nome ?? "O agente", slug: p.conector, nomeConector: conector?.nome ?? null, capacidades: p.capacidades, catalogo: conector?.catalogo ?? [], rotina: daRotina?.instrucao ?? null }),
    });
    if (!decisao) throw new ErroDeDominio("nao_permitido");
    events.push(evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: proposta.conversaId, dados: { decisao_id: decisao.id, tipo: "acesso", proposta_id: proposta.id } }));
  }

  // Chat limpo (PR 4): a proposta confirmada leva o payload e o cartão encolhe na âncora do turno que propôs. O pedido
  // de acesso não: confirmar só abre a decisão (o cartão continua aberto), e "Pedido aberto" fica na Atividade.
  const mensagem = await deps.repos.mensagens.criar(proposta.payload.kind === "acesso"
    ? { conversaId: proposta.conversaId, autoria, kind: "sistema", assunto: "proposta.decidida", texto: PEDIDO_DE_ACESSO_ABERTO, confianca: "confiavel" }
    : { conversaId: proposta.conversaId, autoria, kind: "sistema", texto: redigir("proposta-confirmada", agora, { pessoa: nomePessoa, resumo }), payload: await payloadDaPropostaDecidida(deps, proposta, "confirmada"), confianca: "confiavel" });
  if (mensagem) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: proposta.conversaId, dados: { mensagem_id: mensagem.id, kind: "sistema" } }));

  return { data: { proposta, agente, rotina, decisao }, events };
};
