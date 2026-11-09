import { decisaoEmAberto } from "../domain/revisor.ts";
import type { AcessoPedido, ResultadoPedirAcesso } from "../contracts/acesso.ts";
import type { Conector } from "../contracts/conector.ts";
import type { PayloadPropostaAcesso, Proposta } from "../contracts/conversa.ts";
import type { Decisao } from "../contracts/decisao.ts";
import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import type { CasoNod, ContextoFerramenta } from "../contracts/servicos.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { SLUG_GITHUB } from "../contracts/github.ts";
import { capacidadesDoNivel } from "../domain/grupos-de-acesso.ts";
import { normalizarPedidoAcesso } from "../domain/pedido-acesso.ts";
import { acaoArriscadaNoApp } from "../domain/aprovacao-permanente.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { evento } from "./autoria-evento.ts";
import { confirmacaoPeloModo, semCard } from "./confirmar-pelo-modo.ts";
import { decidirAcesso } from "./decidir-acesso.ts";
import { garantirGithubSemConfiguracao } from "./conectar-github.ts";
import { abrirDecisaoDeAcesso, eventosDoPedido, garantirPedidoDeAcesso } from "./garantir-pedido-de-acesso.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import { alvoDoParaBot } from "./onboarding-contexto.ts";
import type { Deps } from "./tipos.ts";

function aguardandoPessoa(propostaId: string): ResultadoPedirAcesso {
  return { proposta_id: propostaId, estado: "aguardando_pessoa", instrucao: "o acesso ainda NÃO foi concedido: diga que pediu e encerre o turno" };
}

function concedidoPeloModo(propostaId: string): ResultadoPedirAcesso {
  return { proposta_id: propostaId, estado: "concedido", instrucao: "o acesso foi concedido pela aprovação automática: encerre o turno agora; a tarefa retoma sozinha com a ferramenta nova" };
}

/**
 * Proposta + decisão 'acesso' com o MESMO id (definido em 2026-09-24, ADR-044; a ligação de propor()
 * em rotinas-do-agente.ts): o card da conversa e "Sua vez" decidem pelo MESMO botão, num clique.
 * Antes a pessoa confirmava a proposta e só então nascia a decisão de conceder — e a pessoa e o
 * agente entendiam que o primeiro clique já tinha dado o acesso. A frase é do domínio, nunca do modelo.
 * Só o pedido da CONVERSA desde 2026-09-24 (emenda da ADR-044): o de rotina nasce por
 * garantirPedidoDeAcesso, que passa pelo índice único da 0026 — um INSERT daqui com `rotinaId` daria 23505.
 */
export async function abrirPedidoDeAcesso(
  deps: Deps,
  p: { conversaId: string; agenteId: string; turnoId: string | null; payload: PayloadPropostaAcesso; conector: Pick<Conector, "slug" | "nome" | "catalogo">; autoria: Autoria },
): Promise<{ proposta: Proposta; decisao: Decisao; events: RuntimeEvent[] }> {
  const proposta = await deps.repos.propostas.criar({ conversaId: p.conversaId, agenteId: p.agenteId, payload: p.payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const decisao = await abrirDecisaoDeAcesso(deps, { proposta, payload: p.payload, conector: p.conector, instrucaoDaRotina: null, turnoId: p.turnoId });
  return { proposta, decisao, events: eventosDoPedido(deps, { proposta, payload: p.payload, decisao, autoria: p.autoria, turnoId: p.turnoId }) };
}

/**
 * O pedido PENDENTE da CONVERSA que este repete, se houver (definido em 2026-09-21): mesmo turno,
 * conector e capacidades — a Cecília chamou pedir_acesso três vezes em 3 s e cada chamada virou um
 * card. Pedido cuja decisão já venceu não conta: devolvê-lo deixaria o agente apontando para um card
 * que saiu da tela. O de ROTINA não passa aqui desde 2026-09-24 (emenda da ADR-044): é um por (agente,
 * app), de qualquer rotina, e quem garante é garantirPedidoDeAcesso, pelo índice único da 0026.
 */
async function pedidoRepetido(deps: Deps, ctx: ContextoFerramenta, pedido: AcessoPedido): Promise<Proposta | null> {
  const mesmas = [...pedido.capacidades].sort().join(",");
  for (const p of await deps.repos.propostas.pendentesDaConversa(ctx.conversaId)) {
    if (p.payload.kind !== "acesso" || p.agenteId !== ctx.agenteId || p.payload.conector !== pedido.conector || p.payload.rotinaId) continue;
    // revisto em 2026-09-25: o nível também — com [] as capacidades são iguais e um pedido de escrita virava o card de leitura.
    const repete = p.payload.turnoId === ctx.turnoId && p.payload.nivel === pedido.nivel && [...new Set(p.payload.capacidades)].sort().join(",") === mesmas;
    if (!repete) continue;
    const decisao = await deps.repos.decisoes.buscar(p.id);
    if (decisao && !decisaoEmAberto(decisao.estado)) continue;
    return p;
  }
  return null;
}

/**
 * Pedido de acesso em português com escopo nomeado (E6.2). A validação é do domínio
 * (normalizarPedidoAcesso); aqui mora a ligação com o turno. App ainda não conectado vira só o card
 * de conexão; app pronto vira proposta + decisão de mesmo id, que a pessoa decide com um clique
 * (decidir-acesso.ts concede). O pedido do turno de rotina carrega a rotina: permitir roda a rotina de novo,
 * recusar a pausa — e, desde 2026-09-24 (emenda da ADR-044), é UM por (agente, app) com o pré-voo
 * (garantirPedidoDeAcesso).
 * revisto em 2026-10-01 (ADR-066, "o bot tem o que você deu; o modo decide"): a rotina pede leitura ou escrita como
 * qualquer turno, e o modo concede como na conversa e no pedido de colega. Antes a rotina só pedia leitura (ou a
 * escrita declarada) e nunca passava pelo modo: era o único lugar em que o total ainda esperava um clique, e cada
 * janela seguinte saía bloqueada até ele.
 */
export const pedirAcesso: CasoNod<Deps, "pedir_acesso"> = async (deps, input) => {
  if (input.para_bot !== undefined) return pedirAcessoParaBot(deps, input);
  const ligacao = await rotinaDoTurno(deps.repos, input.turnoId);
  let conector = await deps.repos.conectores.buscarPorSlug(input.conector);
  let entrada = input;
  if (input.conector === SLUG_GITHUB && !conector?.habilitado) {
    // definido em 2026-09-24 (ADR-048): com o gh desta máquina logado (ou o App da organização no
    // servidor), o GitHub nasce aqui mesmo e o
    // card já sai com o botão de permitir — nada de card de conexão nem passo de configuração. Sem
    // capacidades nomeadas, o nível decide: leitura = as de leitura, escrita = o catálogo inteiro.
    const r = await garantirGithubSemConfiguracao(deps, { pelaPessoa: false });
    if (r.ok) {
      conector = r.conector;
      // revisto em 2026-09-25 (ADR-049): o mesmo nível de todo app — escrita sem o grupo apagar.
      if (input.capacidades.length === 0) entrada = { ...input, capacidades: capacidadesDoNivel(r.conector.catalogo, input.nivel) };
    }
  }
  const pedido = normalizarPedidoAcesso({ pedido: entrada, conector, emRotina: false, declaradas: [] });
  const rotina = ligacao?.rotina ?? null;
  const autoria = autoriaDoAgente(deps.escopo, input.agenteId);
  if (rotina) {
    // definido em 2026-09-24 (emenda da ADR-044): o card da rotina é UM por (agente, app) — o pré-voo pode
    // já tê-lo aberto, e o INSERT direto bateria no índice único (23505) no meio da ferramenta.
    const g = await garantirPedidoDeAcesso(deps, {
      agenteId: input.agenteId,
      conversaId: input.conversaId,
      rotinaId: rotina.id,
      instrucaoDaRotina: rotina.instrucao,
      slug: pedido.conector,
      conector,
      conectar: pedido.conectar === true,
      capacidades: pedido.conectar ? null : pedido.capacidades,
      naoPedido: pedido.naoPedido,
      turnoId: input.turnoId,
      autoria,
    });
    // ADR-066: o modo concede também na rotina. A concessão roda a rotina de novo (decidir-acesso.ts), já com a
    // ferramenta; o card de conexão (login do app) continua sendo da pessoa.
    if (conector && g.decisao && (g.decisao.estado === "pendente" || g.decisao.estado === "reaberta")) {
      const arriscadaNaRotina = pedido.capacidades.some((nome) => {
        const cap = conector.catalogo.find((c) => c.nome === nome);
        return cap ? acaoArriscadaNoApp(cap) : true;
      });
      const porRegraNaRotina = await confirmacaoPeloModo(deps, input, { arriscada: arriscadaNaRotina });
      if (porRegraNaRotina) {
        const decidido = await decidirAcesso(deps, { decisaoId: g.decisao.id, recusar: false, executor: input.plano?.executor ?? "catcher", porRegra: porRegraNaRotina });
        return { data: concedidoPeloModo(g.proposta.id), events: [...semCard(g.events), ...(decidido.events ?? [])] };
      }
    }
    return { data: aguardandoPessoa(g.proposta.id), events: g.events };
  }
  const repetido = await pedidoRepetido(deps, entrada, pedido);
  if (repetido) return { data: aguardandoPessoa(repetido.id), events: [] };

  const payload: PayloadPropostaAcesso = {
    kind: "acesso",
    turnoId: input.turnoId,
    ...(pedido.conectar ? { conectar: true as const } : {}),
    conector: pedido.conector,
    capacidades: pedido.capacidades,
    nivel: pedido.nivel,
    naoPedido: pedido.naoPedido,
    ...(pedido.para ? { para: pedido.para } : {}),
  };
  if (pedido.conectar || !conector) {
    // O app ainda não está pronto: só o card de conexão. A concessão vem depois (confirmar-proposta.ts).
    const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: input.agenteId, payload });
    if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
    const criada = evento(deps.escopo, { kind: "proposta_criada", autoria, agora: deps.agora(), conversaId: input.conversaId, turnoId: input.turnoId, dados: { proposta_id: proposta.id, kind: "acesso", conector: pedido.conector, capacidades: 0, nivel: pedido.nivel } });
    return { data: aguardandoPessoa(proposta.id), events: [criada] };
  }
  const aberto = await abrirPedidoDeAcesso(deps, { conversaId: input.conversaId, agenteId: input.agenteId, turnoId: input.turnoId, payload, conector, autoria });
  // ADR-059 (emenda de 2026-09-30): no automático e no total o modo concede na hora, pelo mesmo decidirAcesso do
  // botão. O que é "Apagar e desfazer" só sai sozinho na conversa com a pessoa (merge de PR não, ADR-066); conectar
  // um app (login) continua sendo dela, porque o card de conexão nem chega aqui.
  const arriscada = pedido.capacidades.some((nome) => {
    const cap = conector.catalogo.find((c) => c.nome === nome);
    return cap ? acaoArriscadaNoApp(cap) : true;
  });
  const porRegra = await confirmacaoPeloModo(deps, input, { arriscada });
  if (porRegra) {
    // `executor` só serve ao disparo de rotina, e o pedido da rotina sai pelo ramo de cima (garantirPedidoDeAcesso).
    const decidido = await decidirAcesso(deps, { decisaoId: aberto.proposta.id, recusar: false, executor: "catcher", porRegra });
    return { data: concedidoPeloModo(aberto.proposta.id), events: [...semCard(aberto.events), ...(decidido.events ?? [])] };
  }
  return { data: aguardandoPessoa(aberto.proposta.id), events: aberto.events };
};

/**
 * `pedir_acesso` com `para_bot` (definido em 2026-10-04, ADR-077): no onboarding por ligação a Nina pede o app PARA o bot
 * novo. O card nasce na conversa do bot novo, com o agente dele e SEM turno (a retomada do acesso é do turno de quem
 * pediu, e quem pediu foi a Nina, noutra conversa: retomar-apos-acesso recusaria). Sem modo automático: o bot acabou de
 * nascer manual, e o login do app é sempre da pessoa.
 */
async function pedirAcessoParaBot(deps: Deps, input: ContextoFerramenta & Parameters<CasoNod<Deps, "pedir_acesso">>[1]): ReturnType<CasoNod<Deps, "pedir_acesso">> {
  const alvo = await alvoDoParaBot(deps, input.turnoId, input.para_bot ?? "");
  if (!alvo) throw new ErroDeDominio("entrada_invalida", { cause: "para_bot só vale para o bot novo do onboarding" });
  let conector = await deps.repos.conectores.buscarPorSlug(input.conector);
  let entrada = input;
  if (input.conector === SLUG_GITHUB && !conector?.habilitado) {
    const r = await garantirGithubSemConfiguracao(deps, { pelaPessoa: false });
    if (r.ok) {
      conector = r.conector;
      if (input.capacidades.length === 0) entrada = { ...input, capacidades: capacidadesDoNivel(r.conector.catalogo, input.nivel) };
    }
  }
  const pedido = normalizarPedidoAcesso({ pedido: entrada, conector, emRotina: false, declaradas: [] });
  const autoria = autoriaDoAgente(deps.escopo, input.agenteId);
  const payload: PayloadPropostaAcesso = {
    kind: "acesso",
    ...(pedido.conectar ? { conectar: true as const } : {}),
    conector: pedido.conector,
    capacidades: pedido.capacidades,
    nivel: pedido.nivel,
    naoPedido: pedido.naoPedido,
    para: pedido.para ?? `Usado pelo ${alvo.nome}`,
  };
  // O mesmo pedido já aberto para o bot (a Nina repetiu): devolve o card que está na tela.
  for (const p of await deps.repos.propostas.pendentesDaConversa(alvo.conversaId)) {
    if (p.payload.kind === "acesso" && p.agenteId === alvo.agenteId && p.payload.conector === pedido.conector && !p.payload.rotinaId) return { data: aguardandoPessoa(p.id), events: [] };
  }
  if (pedido.conectar || !conector) {
    const proposta = await deps.repos.propostas.criar({ conversaId: alvo.conversaId, agenteId: alvo.agenteId, payload });
    if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
    return { data: aguardandoPessoa(proposta.id), events: [evento(deps.escopo, { kind: "proposta_criada", autoria, agora: deps.agora(), conversaId: alvo.conversaId, dados: { proposta_id: proposta.id, kind: "acesso", conector: pedido.conector, capacidades: 0, nivel: pedido.nivel, para_bot: alvo.agenteId } })] };
  }
  const aberto = await abrirPedidoDeAcesso(deps, { conversaId: alvo.conversaId, agenteId: alvo.agenteId, turnoId: null, payload, conector, autoria });
  return { data: aguardandoPessoa(aberto.proposta.id), events: aberto.events };
}
