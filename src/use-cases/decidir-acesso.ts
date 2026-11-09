import { randomUUID } from "node:crypto";
import type { Proposta } from "../contracts/conversa.ts";
import type { Decisao } from "../contracts/decisao.ts";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { nomeDoApp } from "../domain/pedido-acesso.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { concederLote, fecharCardAtendido } from "./conceder.ts";
import { dispararRotina } from "./disparar-rotina.ts";
import type { PorRegra } from "./confirmar-pelo-modo.ts";
import { avisarFalhaDelegacao } from "./entregar-resposta-peer.ts";
import { fecharGemeas } from "./fechar-gemeas.ts";
import { pausarRotina } from "./pausar-rotina.ts";
import { recusarProposta } from "./recusar-proposta.ts";
import { retomarAposAcesso } from "./retomar-apos-acesso.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { sincronizarDasDecisoes } from "./trabalhos.ts";
import { fecharPedidoDeCredencial } from "./guardar-credencial.ts";
import { decidirAssumirQuadro } from "./assumir-quadro.ts";
import { decidirColunasDoQuadro } from "./colunas-do-quadro.ts";
import { decidirQuadroExclusao } from "./quadro-exclusao.ts";
import { decidirImportacaoLinear } from "./importar-linear.ts";

export type EntradaDecidirAcesso = {
  decisaoId: string;
  recusar: boolean;
  /** Executor do turno que a rotina dispara ao ser liberada (o interruptor da máquina, lido na hora). */
  executor: Executor;
  /** Quem clicou; a rota roda como a DONA (comoDona), mas grava a pessoa da sessão. Default: o escopo. */
  por?: string;
  /**
   * definido em 2026-09-25: os grupos que a pessoa deixou marcados no card. Só estreita — tem de ser
   * parte do que o pedido mostrou, nunca algo a mais; ausente = tudo o que foi pedido.
   */
  capacidades?: readonly string[];
  /**
   * ADR-059 (emenda de 2026-09-30): o modo do bot concede, sem clique — chamado por pedirAcesso na conversa. A
   * decisão fecha pela regra (decidida_por nulo), o consentimento diz que foi o modo, e a retomada também.
   */
  porRegra?: PorRegra;
  /**
   * definido em 2026-10-01 (ADR-066): o pré-voo concede pelo modo no MEIO de um disparo da rotina — disparar de novo
   * daria dois turnos da mesma janela. Concede e devolve; quem chamou segue com o disparo.
   */
  semDisparar?: boolean;
  /**
   * definido em 2026-10-09 (NOD-202): a recusa veio da conversa (POST propostas/:id/recusar), não de "Sua vez". Lá a
   * proposta já decidida dá 409, como sempre deu: a recusa da conversa nunca fecha sozinha a decisão de um card que
   * a conversa já não mostra com botões.
   */
  pelaConversa?: boolean;
};

export type SaidaDecidirAcesso = { decisao: Decisao; concessoes: number; consentimentoId: string | null; rotinaId: string | null; turnoId: string | null };

const REGRA_VARREDOR = "regra:varredor-expiracao" as const;

/**
 * O pedido de acesso de uma ROTINA venceu sem ninguém liberar (definido em 2026-09-24, emenda da ADR-044,
 * "rotina se trava sozinha"): a proposta sai como recusada e a rotina PAUSA, com a linha que diz por quê —
 * sem isto ela seguiria parada janela após janela, com um card que já saiu da tela. Chamado pelo varredor
 * de expiração na transação que venceu a decisão. Reativar depois faz o pré-voo abrir um card novo;
 * "Reabrir" no card vencido continua valendo (decidirAcesso não exige a proposta pendente).
 * `pausada` null = não era pedido de rotina, ou a rotina já não estava ativa: o varredor escreve a
 * mensagem de vencimento de sempre.
 */
export async function vencerPedidoDaRotina(deps: Deps, decisao: Decisao): Promise<{ pausada: Rotina | null; atendido?: true; events: RuntimeEvent[] }> {
  if (decisao.tipo !== "acesso") return { pausada: null, events: [] };
  const proposta = await deps.repos.propostas.buscar(decisao.id);
  if (proposta?.payload.kind !== "acesso" || !proposta.payload.rotinaId) return { pausada: null, events: [] };
  // revisto em 2026-10-15 (NOD-270, I4): antes de pausar, relê as concessões — o acesso dado por outro caminho (a tela
  // Conectores) fecha o card como atendido e a rotina segue ativa; sem isto ela pausava "porque ninguém liberou".
  const atendido = await fecharCardAtendido(deps, proposta, { tambemVencida: true });
  if (atendido) return { pausada: null, atendido: true, events: atendido };
  if (proposta.estado === "pendente") await deps.repos.propostas.decidir(proposta.id, "recusada");
  const rotina = await rotinaDoPedido(deps, proposta.agenteId, proposta.payload.rotinaId);
  if (!rotina || rotina.estado !== "ativa") return { pausada: null, events: [] };
  const agora = deps.agora();
  const conector = await deps.repos.conectores.buscarPorSlug(proposta.payload.conector);
  // O prazo com que TODO card de acesso nasce (abrirDecisaoDeAcesso): criado_em é relógio do banco e o
  // prazo, do servidor — a diferença entre os dois não é o que a pessoa teve para decidir.
  const prazo = `${Math.round(PRAZO_DECISAO_PADRAO_MS / 3_600_000)}h`;
  const autoria = { ...autoriaPessoa(deps.escopo), decidido_por: REGRA_VARREDOR };
  const texto = redigir("rotina-pausada-sem-acesso", agora, { app: nomeDoApp(proposta.payload.conector, conector?.nome), prazo });
  const pausada = (await pausarRotina(deps, { rotinaId: rotina.id, estado: "pausada", autoria, texto })).data.rotina;
  const events = [evento(deps.escopo, { kind: "rotina_atualizada", autoria, agora, conversaId: pausada.conversaId, dados: { rotina_id: pausada.id, estado: "pausada", motivo: "acesso_nao_liberado", decisao_id: decisao.id } })];
  return { pausada, events };
}

/** A rotina do pedido só vale se ainda é DESTE agente e não foi excluída; senão o pedido é da conversa. */
async function rotinaDoPedido(deps: Deps, agenteId: string, rotinaId: string | undefined): Promise<Rotina | null> {
  if (!rotinaId) return null;
  const rotina = await deps.repos.rotinas.buscar(rotinaId);
  return rotina && rotina.agenteId === agenteId && rotina.excluidoEm === null ? rotina : null;
}

/**
 * O botão da decisão 'acesso' (definido em 2026-09-24, ADR-044; antes o miolo morava na rota
 * decisoes.ts). Permitir: fecha a decisão → marca a proposta confirmada (o card da conversa sai; antes
 * quem fazia isso era o confirmar) → concede o lote com UM consentimento → continua. Pedido de rotina
 * reativa a rotina se estava pausada e a dispara AGORA, em modo rotina; pedido da conversa retoma o
 * turno que pediu, como antes. Recusar: recusa a proposta e, se veio de rotina, pausa a rotina — sem o
 * acesso ela pediria de novo a cada disparo.
 */
export const decidirAcesso: CasoDeUso<EntradaDecidirAcesso, SaidaDecidirAcesso> = async (deps, input) => {
  const r = await decidirAcessoDaDona(deps, input);
  // Revisão do épico (S2, 2026-10-08): o trabalho do turno que pediu relê o estado (com a retomada, se nasceu, na fila).
  return { ...r, events: [...(r.events ?? []), ...(await sincronizarDasDecisoes(deps, [r.data.decisao]))] };
};

/**
 * definido em 2026-10-09 (NOD-202): "Deixar de lado" no card de acesso da conversa. Com a decisão de mesmo id aberta
 * em "Sua vez" (pendente ou reaberta), a recusa vai pelo caminho da decisão (decidirAcesso), na ordem única do card
 * de acesso: concessão (agente, conector) → decisão → proposta — a do varredor, que vence as decisões em lote antes
 * de mexer nas propostas, e a das gêmeas. Assim a recusa fecha a decisão, as gêmeas, avisa o remetente da delegação,
 * pausa a rotina e solta a task do turno, igual à de "Sua vez". Sem decisão aberta (pedido de antes da ADR-044,
 * card de conexão, decisão vencida), segue o recusarProposta de sempre.
 * Só a DONA vai pelo caminho da decisão: é ela quem recusa a proposta pela conversa (propostas.decidir filtra
 * owner_id), e quem não é dona continua recebendo o 409 de antes.
 */
export const recusarPropostaPelaConversa: CasoDeUso<{ propostaId: string; executor: Executor }, { proposta: Proposta; decisao: Decisao | null }> = async (deps, input) => {
  const lida = await deps.repos.propostas.buscar(input.propostaId);
  // NOD-50: "Agora não" no cartão de credencial fecha o pedido e retoma o turno com `recusada`.
  if (lida?.payload.kind === "credencial") {
    const r = await fecharPedidoDeCredencial(deps, { propostaId: lida.id, resultado: "recusada" });
    const proposta = await deps.repos.propostas.buscar(lida.id);
    if (!proposta) throw new ErroDeDominio("nao_encontrado");
    return { data: { proposta, decisao: await deps.repos.decisoes.buscar(lida.id) }, events: r.events ?? [] };
  }
  if (lida?.payload.kind === "acesso" && !lida.payload.conectar && lida.estado === "pendente") {
    const aberta = await deps.repos.decisoes.buscar(lida.id);
    if (aberta?.tipo === "acesso" && aberta.ownerId === deps.escopo.pessoaId && (aberta.estado === "pendente" || aberta.estado === "reaberta")) {
      const r = await decidirAcesso(deps, { decisaoId: lida.id, recusar: true, executor: input.executor, pelaConversa: true });
      const proposta = await deps.repos.propostas.buscar(lida.id);
      if (!proposta) throw new ErroDeDominio("nao_encontrado");
      return { data: { proposta, decisao: r.data.decisao }, events: r.events ?? [] };
    }
  }
  // Revisão 4 do PR #627: os cards do quadro (colunas e exclusão) recusam pelo caso deles, que fecha a decisão de mesmo id
  // em "Sua vez" na ordem deles (a exclusão trava o QUADRO antes da proposta). Pelo recusarProposta genérico a decisão
  // ficava aberta e o card pendente para sempre. Só a dona (a mesma regra da rota da decisão); quem não é dona segue o 409.
  // Revisão 7 do PR #630: a importação do Linear também (decidirImportacaoLinear com recusa fecha a decisão de mesmo id).
  const kind = lida?.payload.kind;
  if ((kind === "quadro_exclusao" || kind === "colunas_quadro" || kind === "assumir_quadro" || kind === "importacao_linear") && lida?.estado === "pendente") {
    const aberta = await deps.repos.decisoes.buscar(lida.id);
    if (aberta && aberta.ownerId === deps.escopo.pessoaId && (aberta.estado === "pendente" || aberta.estado === "reaberta")) {
      const r = lida.payload.kind === "quadro_exclusao"
        ? await decidirQuadroExclusao(deps, { decisaoId: lida.id, recusar: true, executor: input.executor })
        : lida.payload.kind === "assumir_quadro" ? await decidirAssumirQuadro(deps, { decisaoId: lida.id, recusar: true })
        : lida.payload.kind === "importacao_linear" ? await decidirImportacaoLinear(deps, { decisaoId: lida.id, recusar: true })
        : await decidirColunasDoQuadro(deps, { decisaoId: lida.id, recusar: true, executor: input.executor });
      const proposta = await deps.repos.propostas.buscar(lida.id);
      if (!proposta) throw new ErroDeDominio("nao_encontrado");
      return { data: { proposta, decisao: await deps.repos.decisoes.buscar(lida.id) }, events: r.events ?? [] };
    }
  }
  const r = await recusarProposta(deps, { propostaId: input.propostaId });
  return { data: { proposta: r.data.proposta, decisao: null }, events: r.events ?? [] };
};

const decidirAcessoDaDona: CasoDeUso<EntradaDecidirAcesso, SaidaDecidirAcesso> = async (deps, input) => {
  const agora = deps.agora();
  // Lida sem trava: só serve para achar o par (agente, conector) da trava. O estado vale o da leitura travada abaixo.
  const lidaSemTrava = await deps.repos.propostas.buscar(input.decisaoId);
  // definido em 2026-09-24 (emenda da ADR-044): trava (agente, conector) ANTES de mexer em qualquer linha —
  // o pré-voo da rotina trava o mesmo par para ler concessões e abrir o card; sem isto, um tick no meio
  // do clique via "sem concessão" e "sem card pendente" ao mesmo tempo e abria um card novo.
  const doPedido = lidaSemTrava?.payload.kind === "acesso" ? await deps.repos.conectores.buscarPorSlug(lidaSemTrava.payload.conector) : null;
  if (lidaSemTrava && doPedido) await deps.repos.concessoes.travar(lidaSemTrava.agenteId, doPedido.id);
  if (input.capacidades && !input.recusar) {
    const pedidas = new Set(lidaSemTrava?.payload.kind === "acesso" ? lidaSemTrava.payload.capacidades : []);
    if (input.capacidades.length === 0 || input.capacidades.some((c) => !pedidas.has(c))) throw new ErroDeDominio("entrada_invalida", { cause: "capacidades fora do pedido" });
  }
  // NOD-202: o estado de ANTES do fechamento, para a guarda abaixo. Lido depois da trava da concessão; quem disputa o
  // mesmo card (recusa, Permitir) passa pela mesma trava, e o varredor só leva a decisão a `vencida`, de onde o
  // `decidir` não fecha.
  const antes = await deps.repos.decisoes.buscar(input.decisaoId);
  const decisao = input.porRegra
    ? await deps.repos.decisoes.fecharPorRegra(input.decisaoId, { ...input.porRegra, agora })
    : await deps.repos.decisoes.decidir(input.decisaoId, { por: input.por ?? deps.escopo.pessoaId, agora });
  if (!decisao) throw new ErroDeDominio("estado_invalido", { cause: "decisão já fechada ou inexistente" });
  // definido em 2026-10-09 (NOD-202): ordem única do card de acesso — concessão → DECISÃO → PROPOSTA (a do varredor e a
  // das gêmeas). A proposta é relida TRAVADA depois da decisão, e é esta leitura que vale daqui em diante: lida antes e
  // sem trava, ela saía `pendente` enquanto a conversa a recusava, e o Permitir concedia com a proposta recusada.
  const proposta = await deps.repos.propostas.buscarParaAtualizar(input.decisaoId);
  if (decisao.tipo !== "acesso" || !proposta || proposta.payload.kind !== "acesso" || proposta.payload.conectar) throw new ErroDeDominio("estado_invalido", { cause: "decisão de acesso sem proposta" });
  // NOD-202: a conversa só recusa o que ainda está pendente — o 409 de sempre do recusarProposta.
  if (input.pelaConversa && proposta.estado !== "pendente") throw new ErroDeDominio("estado_invalido", { cause: `proposta ${proposta.estado}` });
  // NOD-202: Permitir com a proposta já recusada PELA PESSOA (decisão ainda pendente: legado de antes desta correção, ou
  // pedido sem a recusa pela decisão) não concede — o erro desfaz a tx e a decisão não fecha. Reaberta, quem recusou
  // foi o varredor ao vencer, e "Reabrir" continua concedendo (vencerPedidoDaRotina).
  if (!input.recusar && proposta.estado === "recusada" && antes?.estado === "pendente") throw new ErroDeDominio("estado_invalido", { cause: "proposta recusada pela pessoa" });
  const p = proposta.payload;
  const autoria = input.porRegra ? { ...autoriaPessoa(deps.escopo), decidido_por: input.porRegra.regra, regra_versao: input.porRegra.regraVersao } : autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: decisao.conversaId, turnoId: decisao.turnoId, dados: { decisao_id: decisao.id, tipo: decisao.tipo, recusada: input.recusar } })];
  // definido em 2026-09-24: o card "×N" prometia "decidir aqui resolve todos" — os pedidos iguais
  // abertos fecham por regra na MESMA transação, e as propostas deles seguem este clique.
  events.push(...(await fecharGemeas(deps, decisao, input.recusar ? "recusada" : "confirmada")).events);
  const rotina = await rotinaDoPedido(deps, proposta.agenteId, p.rotinaId);

  if (input.recusar) {
    if (proposta.estado === "pendente") events.push(...((await recusarProposta(deps, { propostaId: proposta.id })).events ?? []));
    // Revisão da ADR-047: o alvo de uma tarefa delegada não vai seguir sem o acesso — o remetente fica sabendo.
    if (decisao.turnoId) {
      const pessoa = (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? "a pessoa";
      events.push(...((await avisarFalhaDelegacao(deps, { turnoId: decisao.turnoId, motivo: `${pessoa} não permitiu o acesso a ${p.conector}` })).events ?? []));
    }
    if (rotina) await pausarRotina(deps, { rotinaId: rotina.id, estado: "pausada" });
    return { data: { decisao, concessoes: 0, consentimentoId: null, rotinaId: rotina?.id ?? null, turnoId: null }, events };
  }

  if (proposta.estado === "pendente") await deps.repos.propostas.decidir(proposta.id, "confirmada");
  const conector = doPedido;
  if (!conector) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
  // Chat limpo (PR 4): o consentimento leva o pedido, e o cartão encolhe na âncora do turno que pediu. A frase do pedido
  // só vai quando tudo o que foi pedido foi concedido: com grupos desmarcados, "Ada quer ler e alterar seu Gmail" sobre
  // "Acesso permitido" diria mais do que foi concedido (ADR-044) — sem a frase, o cartão diz o que foi liberado.
  const concedidas = input.capacidades ?? p.capacidades;
  const inteiro = p.capacidades.every((c) => concedidas.includes(c));
  const pedido = { decisaoId: decisao.id, turnoId: decisao.turnoId, ...(inteiro ? { frase: decisao.frase } : {}) };
  const lote = await concederLote(deps, { agenteId: proposta.agenteId, conectorId: conector.id, capacidades: concedidas, autorTipo: "pessoa", pedido, ...(input.porRegra ? { porRegra: input.porRegra } : {}) });
  events.push(...(lote.events ?? []));

  let turnoId: string | null = null;
  if (rotina && input.semDisparar) return { data: { decisao, concessoes: lote.data.concessoes.length, consentimentoId: lote.data.mensagemId, rotinaId: rotina.id, turnoId: null }, events };
  if (rotina) {
    // Agente excluído ou de outra geração (ADR-034) não roda sozinho — a mesma trava de
    // retomarAposAcesso: a concessão fica registrada, o disparo não acontece. O card do pré-voo nasce sem
    // turno (definido em 2026-09-24, emenda da ADR-044) e carrega a geração do agente no payload.
    const outraGeracao = decisao.turnoId !== null ? await deps.repos.agentes.execucaoBloqueada(decisao.turnoId) : p.geracao !== undefined && (await deps.repos.agentes.geracaoExecucao(proposta.agenteId)) !== p.geracao;
    if (outraGeracao) {
      return { data: { decisao, concessoes: lote.data.concessoes.length, consentimentoId: lote.data.mensagemId, rotinaId: rotina.id, turnoId: null }, events };
    }
    const ativa = rotina.estado === "pausada" ? (await pausarRotina(deps, { rotinaId: rotina.id, estado: "ativa" })).data.rotina : rotina;
    // `agora` em ms, SEM arredondar ao minuto (executar-rotina-agora.ts arredonda): o minuto cheio pode
    // ser a janela que o scheduler já reivindicou, e aí o disparo voltaria janelaDeOutro, sem turno.
    // `aposConceder`: a pessoa acabou de liberar — este disparo não passa pelo pré-voo.
    const disparo = await dispararRotina(deps, { rotina: ativa, instanteAgendado: deps.agora(), machineId: randomUUID(), executor: input.executor, preservarAgenda: true, aposConceder: true });
    events.push(...(disparo.events ?? []));
    if ("turno" in disparo.data) turnoId = disparo.data.turno.id;
  } else {
    const retomada = await retomarAposAcesso(deps, { decisao, proposta, peloModo: input.porRegra !== undefined });
    events.push(...(retomada.events ?? []));
    turnoId = retomada.data.turnoId;
  }
  return { data: { decisao, concessoes: lote.data.concessoes.length, consentimentoId: lote.data.mensagemId, rotinaId: rotina?.id ?? null, turnoId }, events };
};
