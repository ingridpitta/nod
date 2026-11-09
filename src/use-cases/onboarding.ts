import type { Agente } from "../contracts/agente.ts";
import { CORES_AGENTE, FORMAS_AGENTE, type CorAgente, type FormaAgente } from "../contracts/agente.ts";
import type { PayloadPropostaBot } from "../contracts/conversa.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { ArgsAnotarEntrevista, ArgsProporBot, ResultadoAnotarEntrevista, ResultadoConcluirEntrevista, ResultadoProporBot } from "../contracts/ferramentas-ligacao.ts";
import type { Ligacao, MotivoRecusaLigacao } from "../contracts/ligacao.ts";
import type { BotDoOnboarding, EstadoOnboarding, EtapaOnboarding, IaNoMac, PendentesOnboarding } from "../contracts/onboarding.ts";
import type { ContextoFerramenta, SaidaCasoDeUso } from "../contracts/servicos.ts";
import { ehIdVoz } from "../domain/vozes.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { DESCRICAO_DO_NOD, ehNod, NOME_DO_NOD, TITULO_DO_NOD } from "../domain/nod.ts";
import { camposQueFaltam, modeloDoObjetivo, normalizarCampo, passoDaConfiguracao, PERGUNTAS_ENTREVISTA, resumoDaEntrevista } from "../domain/roteiro-onboarding.ts";
import { log } from "../obs/log.ts";
import type { LinhaOnboarding } from "../repositories/onboarding.repo.ts";
import { aplicarPadroes } from "./acoes/acessos.ts";
import { autoriaAgente, autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { criarAgente, criarAgenteSemReserva } from "./criar-agente.ts";
import { criarRotinaPelaPessoa } from "./criar-rotina.ts";
import { botComConversa, botDe, contextoDoOnboarding } from "./onboarding-contexto.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export { alvoDoParaBot, contextoDoOnboarding } from "./onboarding-contexto.ts";

/**
 * Onboarding por ligação (definido em 2026-10-04, ADR-077). Aqui mora o que lê e grava o banco: o estado que a web
 * desenha, o Nod (a guia, ADR-081; antes a Nina), as três ferramentas do laço de voz (anotar_entrevista, concluir_entrevista, propor_bot)
 * e os atalhos do caminho sem voz (criar o bot e a rotina direto, a pessoa clicando). Quem liga a ligação e fala é a
 * composição (rotas/onboarding.ts) e o orquestrador de voz.
 */

/** O app do modelo está conectado e o bot novo tem alguma ferramenta dele concedida. */
async function appDoBotConectado(deps: Deps, botId: string, slug: string): Promise<boolean> {
  const conector = await deps.repos.conectores.buscarPorSlug(slug);
  if (!conector?.habilitado) return false;
  return (await deps.repos.concessoes.doAgente(botId)).some((c) => c.conectorId === conector.id);
}

async function pendentesDoOnboarding(deps: Deps, guia: BotDoOnboarding | null, bot: BotDoOnboarding | null): Promise<PendentesOnboarding> {
  const vazio: PendentesOnboarding = { bot: null, acesso: null, rotina: null };
  const abertas = await deps.repos.decisoes.listarSuaVez(deps.agora());
  const pendentes = { ...vazio };
  if (guia) {
    const d = abertas.filter((x) => x.tipo === "bot" && x.conversaId === guia.conversaId).at(-1);
    const p = d ? await deps.repos.propostas.buscar(d.id) : null;
    if (d && p?.payload.kind === "bot" && p.estado === "pendente") pendentes.bot = { decisaoId: d.id, nome: p.payload.nome, descricao: p.payload.descricao, forma: p.payload.forma, cor: p.payload.cor, voz: p.payload.voz };
  }
  if (bot) {
    const acesso = abertas.filter((x) => x.tipo === "acesso" && x.agenteId === bot.id).at(-1);
    const pa = acesso ? await deps.repos.propostas.buscar(acesso.id) : null;
    if (acesso && pa?.payload.kind === "acesso") pendentes.acesso = { decisaoId: acesso.id, app: pa.payload.conector, conectar: false };
    else {
      // O card "Conecte o X" (app ainda sem login) é só proposta, sem decisão (pedir-acesso.ts).
      const conectar = (await deps.repos.propostas.pendentesDaConversa(bot.conversaId)).filter((p) => p.payload.kind === "acesso" && p.payload.conectar === true && p.agenteId === bot.id).at(-1);
      if (conectar?.payload.kind === "acesso") pendentes.acesso = { decisaoId: conectar.id, app: conectar.payload.conector, conectar: true };
    }
    const rotina = abertas.filter((x) => x.tipo === "rotina" && x.agenteId === bot.id).at(-1);
    const pr = rotina ? await deps.repos.propostas.buscar(rotina.id) : null;
    if (rotina && pr?.payload.kind === "rotina") pendentes.rotina = { decisaoId: rotina.id, resumo: pr.payload.resumo };
  }
  return pendentes;
}

export type EntradaEstadoOnboarding = {
  executor: { pronto: boolean; ias: IaNoMac[] };
  recusa?: { motivo: MotivoRecusaLigacao; texto: string } | null;
};

/** GET onboarding: o que a web desenha, montado do banco a cada pedido (o passo nunca é guardado). */
export const estadoOnboarding: CasoDeUso<EntradaEstadoOnboarding, EstadoOnboarding> = async (deps, input) => {
  const linha = await deps.repos.onboarding.buscar();
  const [guia, bot] = await Promise.all([botComConversa(deps, linha.guiaId), botComConversa(deps, linha.botId)]);
  const modelo = modeloDoObjetivo(linha.campos.objetivo);
  const appConectado = bot ? await appDoBotConectado(deps, bot.id, modelo.app.slug) : false;
  const rotinas = bot ? (await deps.repos.rotinas.listarDoAgente(bot.id)).filter((r) => r.excluidoEm === null) : [];
  const viva = await deps.repos.ligacoes.viva();
  const ligacao: Ligacao | null = viva && guia && viva.agenteId === guia.id ? viva : null;
  // Pessoa nova = nenhum bot confirmado dela além da guia. Quem chegou depois da 0049 com bots (seed, outro caminho)
  // não vê o onboarding sem pedir ("Ver o onboarding de novo").
  const meus = linha.etapa === null ? (await deps.repos.agentes.listar()).filter((a) => a.ownerId === deps.escopo.pessoaId && a.confirmado && a.dono === "pessoa" && a.id !== linha.guiaId) : [];
  // definido em 2026-10-04 (teste do Marlon em produção): a pessoa excluiu a guia no meio do onboarding — ele sai da frente
  // (sem a guia, a configuração virava uma tela cheia sem saída). "Ver o onboarding de novo" cria outra guia.
  const guiaExcluida = linha.guiaId !== null && guia === null && (linha.etapa === "chamando" || linha.etapa === "entrevista" || linha.etapa === "configurando");
  const mostrar = linha.concluidoEm === null && linha.etapa !== "concluido" && (linha.etapa !== null || meus.length === 0) && !guiaExcluida;
  return {
    data: {
      etapa: linha.etapa,
      mostrar,
      campos: linha.campos,
      modelo,
      guia,
      bot,
      passo: passoDaConfiguracao({ temBot: bot !== null, appConectado, temRotina: rotinas.length > 0 }),
      pendentes: await pendentesDoOnboarding(deps, guia, bot),
      appConectado,
      rotinaCriada: rotinas[0] ? { resumo: rotinas[0].instrucao } : null,
      concluidoEm: linha.concluidoEm,
      ligacao,
      recusa: input.recusa ?? null,
      executor: input.executor,
    },
  };
};

/** A linha de sistema da conversa nova do Nod (quem chega depois do onboarding também lê). */
const APRESENTACAO_DO_NOD = "O Nod é o seu bot fixo: tira dúvidas sobre o produto, cria e ajusta seus bots, inclusive vários de uma vez, e anota bugs e ideias para o time do Nod.";

/**
 * O Nod da pessoa (definido em 2026-10-07, ADR-081): o que já existe ou um novo, marcado como o Nod e fixado no topo, e
 * ele vira a guia do onboarding. Roda em todo `GET /onboarding` (a web chama ao entrar), então toda pessoa tem o seu —
 * inclusive quem concluiu o onboarding antes dele existir. A trava da pessoa (travarNod) segura duas abas abrindo juntas.
 *
 * Guia viva que não é o Nod (criada pelo código antigo durante a drenagem do deploy da 0061) vira o Nod aqui.
 */
export const garantirNod: CasoDeUso<Record<string, never>, { nod: BotDoOnboarding; criado: boolean }> = async (deps) => {
  const existente = await deps.repos.agentes.travarNod();
  const linha = await deps.repos.onboarding.buscar();
  if (existente) {
    const nod = await botComConversa(deps, existente.id);
    // Revisão de 2026-10-07: um Nod sem conversa (ou excluído por SQL) não ganha um segundo — o índice único recusaria e
    // toda entrada no app viraria 500. A falha fica escrita; a web abre sem o onboarding.
    if (!nod) throw new ErroDeDominio("estado_invalido", { cause: "o Nod da pessoa está sem conversa" });
    if (linha.guiaId !== existente.id) await deps.repos.onboarding.definirGuia(existente.id);
    return { data: { nod, criado: false } };
  }
  const guia = linha.guiaId ? await deps.repos.agentes.buscar(linha.guiaId) : null;
  if (guia && !ehNod(guia) && guia.dono === "pessoa" && guia.ownerId === deps.escopo.pessoaId) {
    const marcado = await deps.repos.agentes.marcarComoNod(guia.id, { nome: NOME_DO_NOD, titulo: TITULO_DO_NOD, descricao: DESCRICAO_DO_NOD });
    const nod = marcado ? await botComConversa(deps, marcado.id) : null;
    if (nod) return { data: { nod, criado: false } };
  }
  const r = await criarAgenteSemReserva(deps, { dono: "pessoa", nome: NOME_DO_NOD, titulo: TITULO_DO_NOD, descricao: DESCRICAO_DO_NOD, forma: "shape-square", cor: "c-black", mensagem: APRESENTACAO_DO_NOD });
  const marcado = await deps.repos.agentes.marcarComoNod(r.data.agente.id, { nome: NOME_DO_NOD, titulo: TITULO_DO_NOD, descricao: DESCRICAO_DO_NOD });
  if (!marcado) throw new ErroDeDominio("estado_invalido", { cause: "nod não marcado" });
  await deps.repos.agentes.definirVoz(marcado.id, { voz: "bento" });
  await deps.repos.onboarding.definirGuia(marcado.id);
  const nod = botDe(marcado, r.data.conversa.id);
  if (!nod) throw new ErroDeDominio("estado_invalido", { cause: "nod não criado" });
  log("info", "nod_criado", {});
  return { data: { nod, criado: true }, events: r.events };
};

export const definirEtapaOnboarding: CasoDeUso<{ etapa: unknown }, LinhaOnboarding> = async (deps, input) => {
  const etapa = input.etapa;
  if (etapa === "ola") return { data: await deps.repos.onboarding.reiniciar() };
  if (etapa !== "executor" && etapa !== "chamando" && etapa !== "entrevista" && etapa !== "configurando") throw new ErroDeDominio("entrada_invalida", { cause: "etapa" });
  const linha = await deps.repos.onboarding.buscar();
  // Concluído só volta pelo "olá" (Ver o onboarding de novo): um clique atrasado não reabre o onboarding.
  if (linha.etapa === "concluido") throw new ErroDeDominio("estado_invalido", { cause: "onboarding concluído" });
  return { data: await deps.repos.onboarding.definirEtapa(etapa) };
};

/**
 * ADA-242 (spec onboarding-jornada-a §4; NOD_ONBOARDING_TEXTO): a conversa por TEXTO com o Nod faz só duas perguntas
 * (apelido e objetivo, sem o tamanho do time) e manda as respostas junto com a etapa 'configurando'. Grava como a
 * entrevista por voz gravaria (o objetivo vira memória da guia); valor vazio ou ausente fica de fora (o "Pular").
 */
export const anotarRespostasDeTexto: CasoDeUso<{ apelido?: unknown; objetivo?: unknown }, LinhaOnboarding> = async (deps, input) => {
  let linha = await deps.repos.onboarding.buscar();
  if (linha.etapa === "concluido") throw new ErroDeDominio("estado_invalido", { cause: "onboarding concluído" });
  for (const campo of ["apelido", "objetivo"] as const) {
    const bruto = input[campo];
    const valor = typeof bruto === "string" ? normalizarCampo(campo, bruto) : null;
    if (valor === null) continue;
    linha = await deps.repos.onboarding.anotar(campo, valor);
    if (campo === "objetivo" && linha.guiaId) await deps.repos.memorias.criar({ agenteId: linha.guiaId, tipo: "fato", texto: `${linha.campos.apelido ?? "A pessoa"} quer que os bots: ${valor}`, origem: "agente" });
    log("info", "onboarding_campo", { campo, canal: "texto" });
  }
  return { data: linha };
};

export const concluirOnboarding: CasoDeUso<Record<string, never>, LinhaOnboarding> = async (deps) => {
  const linha = await deps.repos.onboarding.concluir(deps.agora());
  log("info", "onboarding_concluido", { tamanho_time: linha.campos.tamanhoTime, com_bot: linha.botId !== null });
  return { data: linha };
};

// ---- o bot novo ----------------------------------------------------------------------------------------------------

function forma(v: unknown, padrao: FormaAgente): FormaAgente {
  return typeof v === "string" && (FORMAS_AGENTE as readonly string[]).includes(v) ? (v as FormaAgente) : padrao;
}
function cor(v: unknown, padrao: CorAgente): CorAgente {
  return typeof v === "string" && (CORES_AGENTE as readonly string[]).includes(v) ? (v as CorAgente) : padrao;
}

export type EntradaCriarBot = { nome: unknown; descricao: unknown; forma?: unknown; cor?: unknown; voz?: unknown };

/**
 * Cria o bot novo do onboarding (o card "Novo bot", confirmado pela pessoa por clique ou voz, ou o caminho sem voz):
 * criar-agente com o nome e o que ele faz já confirmados, o mascote e a voz, e ele vira o `onboarding_bot_id` — o
 * único que aceita o `para_bot`.
 */
export const criarBotDoOnboarding: CasoDeUso<EntradaCriarBot, { bot: BotDoOnboarding; agente: Agente }> = async (deps, input) => {
  const linha = await deps.repos.onboarding.buscar();
  const jaTem = await botComConversa(deps, linha.botId);
  if (jaTem) throw new ErroDeDominio("estado_invalido", { cause: "o onboarding já criou o bot" });
  const nome = typeof input.nome === "string" ? input.nome.trim() : "";
  const descricao = typeof input.descricao === "string" ? input.descricao.trim() : "";
  if (nome === "" || nome.length > 60 || descricao === "" || descricao.length > 2000) throw new ErroDeDominio("entrada_invalida", { cause: "nome e descrição do bot" });
  const modelo = modeloDoObjetivo(linha.campos.objetivo);
  const r = await criarAgente(deps, { dono: "pessoa", nome, titulo: modelo.papel, descricao, forma: forma(input.forma, modelo.forma), cor: cor(input.cor, modelo.cor) });
  if (typeof input.voz === "string" && ehIdVoz(input.voz)) await deps.repos.agentes.definirVoz(r.data.agente.id, { voz: input.voz });
  await deps.repos.onboarding.definirBot(r.data.agente.id);
  const bot = botDe(r.data.agente, r.data.conversa.id);
  if (!bot) throw new ErroDeDominio("estado_invalido", { cause: "bot não criado" });
  // ADA-241: o bot do onboarding também nasce com os padrões dos apps (em geral ainda não há nenhum).
  return { data: { bot, agente: r.data.agente }, events: [...(r.events ?? []), ...(await aplicarPadroes(deps, r.data.agente.id))] };
};

/**
 * A decisão 'bot' (propor_bot) decidida pela dona: recusar deixa a proposta de lado; confirmar cria o bot com o que o
 * card mostra — a pessoa pode ter editado nome e descrição antes do clique (a voz confirma o que a Nina propôs).
 */
export const decidirPropostaDeBot: CasoDeUso<{ propostaId: string; recusar: boolean; nome?: unknown; descricao?: unknown }, { agenteId: string | null }> = async (deps, input) => {
  const proposta = await deps.repos.propostas.buscar(input.propostaId);
  if (!proposta || proposta.payload.kind !== "bot") throw new ErroDeDominio("nao_encontrado", { cause: "proposta de bot" });
  if (proposta.estado !== "pendente") throw new ErroDeDominio("estado_invalido", { cause: `proposta ${proposta.estado}` });
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  if (input.recusar) {
    await deps.repos.propostas.decidir(proposta.id, "recusada");
    return { data: { agenteId: null }, events: [evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: proposta.conversaId, dados: { agente_id: proposta.agenteId, acao: "proposta_recusada", proposta_id: proposta.id, kind: "bot" } })] };
  }
  const p = proposta.payload;
  const nome = typeof input.nome === "string" && input.nome.trim() !== "" ? input.nome : p.nome;
  const descricao = typeof input.descricao === "string" && input.descricao.trim() !== "" ? input.descricao : p.descricao;
  const r = await criarBotDoOnboarding(deps, { nome, descricao, forma: p.forma, cor: p.cor, voz: p.voz });
  await deps.repos.propostas.decidir(proposta.id, "confirmada");
  const events: RuntimeEvent[] = [...(r.events ?? [])];
  const linha = await deps.repos.mensagens.criar({ conversaId: proposta.conversaId, autoria, kind: "sistema", assunto: "bot.criado", texto: `Bot ${r.data.agente.nome} criado.`, confianca: "confiavel" });
  if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: proposta.conversaId, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  return { data: { agenteId: r.data.agente.id }, events };
};

/** "Rotina do {bot}" pelo clique numa das três opções do modelo: a pessoa é a confirmação (criarRotinaPelaPessoa). */
export const criarRotinaDoOnboarding: CasoDeUso<{ indice: unknown; fusoIana: string }, { rotinaId: string }> = async (deps, input) => {
  const linha = await deps.repos.onboarding.buscar();
  const bot = await botComConversa(deps, linha.botId);
  if (!bot) throw new ErroDeDominio("estado_invalido", { cause: "o onboarding ainda não criou o bot" });
  const modelo = modeloDoObjetivo(linha.campos.objetivo);
  const indice = typeof input.indice === "number" && Number.isInteger(input.indice) ? input.indice : -1;
  const r = modelo.rotinas[indice];
  if (!r) throw new ErroDeDominio("entrada_invalida", { cause: "indice" });
  const saida = await criarRotinaPelaPessoa(deps, {
    agenteId: bot.id,
    cron: r.cron,
    fusoIana: input.fusoIana,
    instrucao: r.instrucao,
    fonte: modelo.app.nome,
    entregavel: "Uma mensagem curta na conversa do bot.",
    limitesAprovacao: modelo.nao,
    politicaSemDado: "Diga em uma linha que não houve nada.",
  });
  return { data: { rotinaId: saida.data.rotina.id }, events: saida.events };
};

// ---- as ferramentas do laço de voz ------------------------------------------------------------------------------------

export async function anotarEntrevista(deps: Deps, input: ContextoFerramenta & ArgsAnotarEntrevista): Promise<SaidaCasoDeUso<ResultadoAnotarEntrevista>> {
  const ctx = await contextoDoOnboarding(deps, input.turnoId);
  if (!ctx) return { data: { ok: false, erro: "fora_do_onboarding", instrucao: "Esta ferramenta só existe na primeira ligação." } };
  const valor = normalizarCampo(input.campo, input.valor);
  if (valor === null) return { data: { ok: false, erro: "valor_invalido", instrucao: input.campo === "tamanho_time" ? "tamanho_time aceita so_eu, 2_10, 11_50 ou 51_mais (ou o número de pessoas)." : "Valor vazio." } };
  if (ctx.linha.etapa === "chamando") await deps.repos.onboarding.definirEtapa("entrevista");
  const linha = await deps.repos.onboarding.anotar(input.campo, valor);
  // O objetivo vira memória da guia; origem e tamanho viram log sem texto (o valor dito nunca vai para log).
  if (input.campo === "objetivo") await deps.repos.memorias.criar({ agenteId: ctx.turno.agenteId, tipo: "fato", texto: `${linha.campos.apelido ?? "A pessoa"} quer que os bots: ${valor}`, origem: "agente" });
  log("info", "onboarding_campo", { campo: input.campo, ...(input.campo === "tamanho_time" ? { tamanho_time: valor } : {}) });
  const falta = camposQueFaltam(linha.campos);
  const proxima = falta[0];
  // A guia fala antes de anotar: se a pergunta já saiu, ela fecha com "ok" (que não é falado); se não, pergunta agora.
  const instrucao = proxima
    ? `Anotado. Se você já fez a próxima pergunta nesta resposta, escreva só "ok". Senão, pergunte: ${PERGUNTAS_ENTREVISTA[proxima]}`
    : `Tudo respondido. Leia o resumo e espere o sim: "${resumoDaEntrevista(linha.campos)}"`;
  return { data: { ok: true, campos: linha.campos, falta, instrucao } };
}

export async function concluirEntrevista(deps: Deps, input: ContextoFerramenta): Promise<SaidaCasoDeUso<ResultadoConcluirEntrevista>> {
  const ctx = await contextoDoOnboarding(deps, input.turnoId);
  if (!ctx) return { data: { ok: false, erro: "fora_do_onboarding", instrucao: "Esta ferramenta só existe na primeira ligação." } };
  const falta = camposQueFaltam(ctx.linha.campos);
  if (falta.length > 0) return { data: { ok: false, erro: "entrevista_incompleta", falta, instrucao: `Ainda falta perguntar: ${falta.map((c) => PERGUNTAS_ENTREVISTA[c]).join(" ")}` } };
  await deps.repos.onboarding.definirEtapa("configurando");
  const modelo = modeloDoObjetivo(ctx.linha.campos.objetivo);
  return { data: { ok: true, instrucao: `A tela virou a configuração. Se você já disse a frase de transição, não repita; senão, diga agora. Em seguida chame propor_bot (sugestão: ${modelo.nome}).` } };
}

export async function proporBot(deps: Deps, input: ContextoFerramenta & ArgsProporBot): Promise<SaidaCasoDeUso<ResultadoProporBot>> {
  const ctx = await contextoDoOnboarding(deps, input.turnoId);
  if (!ctx) return { data: { ok: false, erro: "fora_do_onboarding", instrucao: "Esta ferramenta só existe na primeira ligação." } };
  if (await botComConversa(deps, ctx.linha.botId)) return { data: { ok: false, erro: "ja_tem_bot", instrucao: "O bot novo já foi criado: siga para o app e a rotina dele." } };
  const nome = input.nome.trim();
  const descricao = input.descricao.trim();
  if (nome === "" || descricao === "") return { data: { ok: false, erro: "entrada_invalida", instrucao: "Nome e descrição não podem ser vazios." } };
  const modelo = modeloDoObjetivo(ctx.linha.campos.objetivo);
  const payload: PayloadPropostaBot = { kind: "bot", nome, descricao, forma: forma(input.forma, modelo.forma), cor: cor(input.cor, modelo.cor), voz: input.voz && ehIdVoz(input.voz) ? input.voz : null, turnoId: input.turnoId };
  const agora = deps.agora();
  const autoria = autoriaAgente({ agenteId: input.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "local" });
  const events: RuntimeEvent[] = [];
  // Uma proposta por vez: a nova (a pessoa pediu outro nome) tira a anterior da tela.
  for (const p of await deps.repos.propostas.pendentesDaConversa(input.conversaId)) {
    if (p.payload.kind !== "bot") continue;
    await deps.repos.propostas.decidir(p.id, "recusada");
    const d = await deps.repos.decisoes.decidir(p.id, { por: deps.escopo.pessoaId, agora });
    if (d) events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: input.conversaId, dados: { decisao_id: d.id, tipo: "bot", recusada: true } }));
  }
  const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: input.agenteId, payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const decisao = await deps.repos.decisoes.criar({ id: proposta.id, tipo: "bot", agenteId: input.agenteId, conversaId: input.conversaId, turnoId: input.turnoId, prazoDecisaoEm: agora + PRAZO_DECISAO_PADRAO_MS, frase: nome });
  events.push(evento(deps.escopo, { kind: "proposta_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { proposta_id: proposta.id, kind: "bot" } }));
  if (decisao) events.push(evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { decisao_id: decisao.id, tipo: "bot" } }));
  return { data: { ok: true, proposta_id: proposta.id, instrucao: "O card está na tela. Pergunte se ela quer mudar algo; ela confirma clicando ou dizendo \"pode criar\". Espere o aviso [nod] antes de seguir." }, events };
}

/**
 * O que o orquestrador de voz precisa do onboarding (ADR-077): a etapa, os campos, o passo da configuração, o nome do
 * bot (o criado, o proposto ou o do modelo) e o nome da pessoa, para os chips "Diga algo como".
 */
export const estadoOnboardingParaVoz: CasoDeUso<Record<string, never>, { etapa: EtapaOnboarding | null; campos: EstadoOnboarding["campos"]; passo: EstadoOnboarding["passo"]; nomeBot: string | null; pessoaNome: string | null }> = async (deps) => {
  const e = await estadoOnboarding(deps, { executor: { pronto: true, ias: [] } });
  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  const nomeBot = e.data.bot?.nome ?? e.data.pendentes.bot?.nome ?? e.data.modelo.nome;
  return { data: { etapa: e.data.etapa, campos: e.data.campos, passo: e.data.passo, nomeBot, pessoaNome: pessoa?.nome ?? null } };
};

