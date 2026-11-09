import type { Agente } from "../../contracts/agente.ts";
import type { Autoria, RuntimeEvent } from "../../contracts/evento.ts";
import { MAX_BOTS_POR_ACAO } from "../../contracts/ferramentas-times.ts";
import type { Time, TimeNaLista } from "../../contracts/time.ts";
import type { IdAcao } from "../../domain/acoes/index.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { ehNod } from "../../domain/nod.ts";
import { chaveDaSecao, chaveDoTime, emOrdem, nomeLimpo, problemaDoNome, reconciliarTimes, reordenar } from "../../domain/times.ts";
import { autoriaPessoa, evento } from "../autoria-evento.ts";
import type { CasoDeUso, Deps } from "../tipos.ts";

/**
 * Os executores únicos dos times (definido em 2026-11-02, NOD-437, ADR-135): a rota da tela (rotas/times.ts) e o lote
 * do chat (gerir-times.ts) chamam a MESMA função. Toda mudança trava os times da pessoa (times.travar) e começa
 * sincronizando: o que só existe em agentes.secao (o servidor de antes, o criar_bots) vira time antes de decidir.
 *
 * Quem está em cada time continua em agentes.secao, com o nome do time; o time casa com o bot pela chave do nome.
 * `autoria` vem do chat (o bot que pediu, em nome da pessoa: "pedido por Marlon via Edu"); sem ela, é a pessoa.
 */

type ComAutoria = { autoria?: Autoria };

/** Os bots da pessoa que podem estar num time: dela, não o Nod (o Nod nunca entra num time, ADR-081). */
async function botsDaPessoa(deps: Deps, incluirExcluidos = false): Promise<Agente[]> {
  const todos = await deps.repos.agentes.listar({ incluirOcultos: true, incluirExcluidos });
  return todos.filter((b) => b.ownerId === deps.escopo.pessoaId && b.dono === "pessoa" && !ehNod(b));
}

/**
 * Materializa o que falta (as seções que só existem em agentes.secao: o servidor de antes) e devolve os times em ordem
 * (posições 0..n-1). Trava antes de ler, sempre: os bots são lidos depois da trava, então um excluir ou renomear que
 * acabou de commitar não volta como time fantasma (revisão do PR #632, B2). Só as mudanças e o POST /times/sincronizar
 * chamam isto; a leitura da barra (a frota) não grava nada.
 */
async function sincronizar(deps: Deps): Promise<Time[]> {
  await deps.repos.times.travar();
  let times = await deps.repos.times.listar();
  const secoes = (await botsDaPessoa(deps)).filter((b) => b.excluidoEm === null).map((b) => b.secao ?? "");
  const { faltam } = reconciliarTimes(times, secoes);
  for (const f of faltam) await deps.repos.times.criar({ nome: f.nome, chave: chaveDoTime(f.nome), posicao: f.posicao });
  if (faltam.length > 0) times = await deps.repos.times.listar();
  return emOrdem(times);
}

const naLista = (times: readonly Time[]): TimeNaLista[] => times.map((t) => ({ ...t, semTime: t.nome === "" }));

/**
 * Os times como a barra lateral os mostra (a frota os leva: o outro aparelho atualiza com o agente.mudou). Só leitura,
 * sem trava (o GET mais quente do app; revisão do PR #632, A1): a seção que ainda não virou time a barra desenha como
 * provisória e pede o POST /times/sincronizar uma vez.
 */
export async function timesDaBarra(deps: Deps): Promise<TimeNaLista[]> {
  return naLista(emOrdem(await deps.repos.times.listar()));
}

function exigir(times: readonly Time[], id: string): Time {
  const t = times.find((x) => x.id === id);
  if (!t) throw new ErroDeDominio("nao_encontrado", { cause: "time" });
  return t;
}

function erroDoNome(nome: unknown, times: readonly Time[], proprio?: string): never | void {
  if (typeof nome !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "nome" });
  const p = problemaDoNome(nome, times, proprio);
  if (p) throw new ErroDeDominio(p.problema === "nome_repetido" ? "estado_invalido" : "entrada_invalida", { cause: p.problema });
}

function mudou(deps: Deps, acao: string, autoria?: Autoria, extra: Record<string, string | number | boolean | null> = {}): RuntimeEvent {
  return evento(deps.escopo, { kind: "agente_atualizado", autoria: autoria ?? autoriaPessoa(deps.escopo), agora: deps.agora(), dados: { times: true, acao, ...extra } });
}

async function gravarOrdem(deps: Deps, ids: readonly string[]): Promise<void> {
  await deps.repos.times.ordenar(ids);
}

/** Os bots (vivos e excluídos) que estão no time de chave `chave`. */
async function membros(deps: Deps, chave: string, incluirExcluidos: boolean): Promise<Agente[]> {
  return (await botsDaPessoa(deps, incluirExcluidos)).filter((b) => chaveDaSecao(b.secao) === chave);
}

/** POST /times/sincronizar (e o começo do gerir_times): as seções antigas viram times, sob a trava; devolve a lista. */
export const listarTimes: CasoDeUso<Record<string, never>, { times: TimeNaLista[] }> = async (deps) => ({ data: { times: naLista(await sincronizar(deps)) } });

/**
 * Garante o time do nome (o mover para um time que ainda não existe o cria no fim) e devolve o nome canônico dele —
 * o que vai para agentes.secao. "" ou "Sem time" = Sem time ("").
 */
export async function garantirTime(deps: Deps, pedido: string): Promise<{ nome: string; criado: Time | null }> {
  const chave = chaveDoTime(pedido);
  const times = await sincronizar(deps);
  const existente = times.find((t) => chaveDoTime(t.nome) === chave);
  if (chave === "" || existente?.nome === "") return { nome: "", criado: null };
  if (chaveDoTime(pedido) === chaveDoTime("Sem time")) return { nome: "", criado: null };
  if (existente) return { nome: existente.nome, criado: null };
  erroDoNome(pedido, times);
  const nome = nomeLimpo(pedido);
  const criado = await deps.repos.times.criar({ nome, chave, posicao: times.length });
  if (!criado) throw new ErroDeDominio("estado_invalido", { cause: "nome_repetido" });
  return { nome, criado };
}

/**
 * A seção que um caminho fora do times.* grava (o criar_bots, o duplicar) com a linha do time garantida, como o
 * criarBot e o moverBot fazem (revisão 3 do PR #632): sem ela o time ficava provisório na barra até recarregar. O nome
 * que o time não aceita (longo demais) segue como antes, só como seção.
 */
export async function secaoComTime(deps: Deps, secao: string): Promise<string> {
  if (problemaDoNome(secao, [])?.problema === "nome_longo") return secao;
  return (await garantirTime(deps, secao)).nome;
}

/**
 * times.criar: o time novo, na posição pedida (0 = topo; sem ela, no fim), já recolhido ou não, e com os bots
 * indicados (o Desfazer de um excluir recria o time com o nome, o lugar e os bots de antes).
 */
export const criarTime: CasoDeUso<{ nome: string; posicao?: number; recolhido?: boolean; bots?: string[] } & ComAutoria, { time: Time; movidos: string[] }> = async (deps, input) => {
  if (typeof input.nome !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "nome" });
  if (input.posicao !== undefined && (!Number.isInteger(input.posicao) || input.posicao < 0)) throw new ErroDeDominio("entrada_invalida", { cause: "posicao" });
  if (input.recolhido !== undefined && typeof input.recolhido !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: "recolhido" });
  if (input.bots !== undefined && (!Array.isArray(input.bots) || input.bots.length > MAX_BOTS_POR_ACAO || !input.bots.every((b) => typeof b === "string"))) throw new ErroDeDominio("entrada_invalida", { cause: "bots" });
  const times = await sincronizar(deps);
  erroDoNome(input.nome, times);
  const nome = nomeLimpo(input.nome);
  const criado = await deps.repos.times.criar({ nome, chave: chaveDoTime(nome), posicao: times.length, recolhido: input.recolhido ?? false });
  if (!criado) throw new ErroDeDominio("estado_invalido", { cause: "nome_repetido" });
  if (input.posicao !== undefined) await gravarOrdem(deps, reordenar([...times.map((t) => t.id), criado.id], criado.id, input.posicao));
  const movidos = input.bots?.length ? await poorNoTime(deps, input.bots, nome) : [];
  // O Desfazer de um excluir manda os bots na ordem em que estavam: ela volta junto (agentes.posicao).
  if (input.bots?.length) await deps.repos.agentes.ordenar([...new Set(input.bots)]);
  const time = exigir(emOrdem(await deps.repos.times.listar()), criado.id);
  return { data: { time, movidos }, events: [mudou(deps, "criar", input.autoria, { time_id: time.id })] };
};

/** Põe os bots (ids) no time de nome canônico `nome`; devolve os ids que mudaram. Bot que não é da pessoa = erro. */
async function poorNoTime(deps: Deps, ids: readonly string[], nome: string): Promise<string[]> {
  const bots = await botsDaPessoa(deps, true);
  const alvos = [...new Set(ids)].map((id) => {
    const b = bots.find((x) => x.id === id && x.excluidoEm === null);
    if (!b) throw new ErroDeDominio("nao_encontrado", { cause: "bot" });
    return b;
  });
  const mudar = alvos.filter((b) => (b.secao ?? "") !== nome).map((b) => b.id);
  if (!mudar.length) return mudar;
  // QA do PR #632 (bug 5): quem chega vai para o FIM do time, na ordem pedida (a posição antiga colidia com a de lá).
  const chave = chaveDaSecao(nome);
  const ficam = bots.filter((b) => b.excluidoEm === null && !mudar.includes(b.id) && chaveDaSecao(b.secao) === chave).sort((a, b) => (a.posicao ?? Infinity) - (b.posicao ?? Infinity) || a.criadoEm - b.criadoEm);
  await deps.repos.agentes.mudarSecao(mudar, nome);
  await deps.repos.agentes.ordenar([...ficam.map((b) => b.id), ...mudar]);
  return mudar;
}

/** times.renomear: o nome novo vale para o time e para os bots dele (agentes.secao), na mesma transação. */
export const renomearTime: CasoDeUso<{ timeId: string; nome: string } & ComAutoria, { time: Time }> = async (deps, input) => {
  if (typeof input.nome !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "nome" });
  const times = await sincronizar(deps);
  const atual = exigir(times, input.timeId);
  if (atual.nome === "") throw new ErroDeDominio("nao_permitido", { cause: "sem_time" });
  erroDoNome(input.nome, times, atual.id);
  const nome = nomeLimpo(input.nome);
  if (nome === atual.nome) return { data: { time: atual } };
  const dele = await membros(deps, chaveDoTime(atual.nome), true);
  const time = await deps.repos.times.renomear(atual.id, { nome, chave: chaveDoTime(nome) });
  if (!time) throw new ErroDeDominio("estado_invalido", { cause: "time" });
  await deps.repos.agentes.mudarSecao(dele.map((b) => b.id), nome);
  return { data: { time: { ...time, posicao: atual.posicao } }, events: [mudou(deps, "renomear", input.autoria, { time_id: time.id })] };
};

/**
 * times.excluir: os bots do time vão para o FIM do Sem time, na ordem em que estavam entre si (agentes.posicao é
 * regravada: os do Sem time primeiro, depois os que chegaram), e nenhum bot é excluído. Devolve o que o Desfazer precisa
 * para recriar o time igual (nome, posição, recolhido e os bots vivos, na ordem).
 */
export const excluirTime: CasoDeUso<{ timeId: string } & ComAutoria, { time: Time; bots: { id: string; nome: string }[] }> = async (deps, input) => {
  const times = await sincronizar(deps);
  const atual = exigir(times, input.timeId);
  if (atual.nome === "") throw new ErroDeDominio("nao_permitido", { cause: "sem_time" });
  const dele = await membros(deps, chaveDoTime(atual.nome), true);
  const naOrdem = (l: readonly Agente[]) => l.filter((b) => b.excluidoEm === null && !b.fixado).sort((a, b) => (a.posicao ?? Infinity) - (b.posicao ?? Infinity) || a.criadoEm - b.criadoEm);
  const vivos = dele.filter((b) => b.excluidoEm === null).sort((a, b) => (a.posicao ?? Infinity) - (b.posicao ?? Infinity) || a.criadoEm - b.criadoEm);
  const jaNoSemTime = naOrdem(await membros(deps, "", false));
  await deps.repos.agentes.mudarSecao(dele.map((b) => b.id), "");
  await deps.repos.agentes.ordenar([...jaNoSemTime, ...naOrdem(dele)].map((b) => b.id));
  if (!(await deps.repos.times.excluir(atual.id))) throw new ErroDeDominio("estado_invalido", { cause: "time" });
  await gravarOrdem(deps, times.filter((t) => t.id !== atual.id).map((t) => t.id));
  return { data: { time: atual, bots: vivos.map((b) => ({ id: b.id, nome: b.nome })) }, events: [mudou(deps, "excluir", input.autoria, { time_id: atual.id })] };
};

/** times.ordenar: o time vai para a posição pedida (0 = topo), os outros andam. O Sem time também se move. */
export const ordenarTime: CasoDeUso<{ timeId: string; posicao: number } & ComAutoria, { time: Time }> = async (deps, input) => {
  if (!Number.isInteger(input.posicao) || input.posicao < 0) throw new ErroDeDominio("entrada_invalida", { cause: "posicao" });
  const times = await sincronizar(deps);
  exigir(times, input.timeId);
  const ordem = reordenar(times.map((t) => t.id), input.timeId, input.posicao);
  await gravarOrdem(deps, ordem);
  const time = exigir(emOrdem(await deps.repos.times.listar()), input.timeId);
  return { data: { time: { ...time, posicao: ordem.indexOf(time.id) } }, events: [mudou(deps, "ordenar", input.autoria, { time_id: time.id })] };
};

/** times.recolher: recolhido ou aberto, salvo na conta (os outros dispositivos recebem pelo agente.mudou). */
export const recolherTime: CasoDeUso<{ timeId: string; recolhido: boolean } & ComAutoria, { time: Time }> = async (deps, input) => {
  if (typeof input.recolhido !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: "recolhido" });
  const times = await sincronizar(deps);
  const atual = exigir(times, input.timeId);
  if (atual.recolhido === input.recolhido) return { data: { time: atual } };
  const time = await deps.repos.times.recolher(atual.id, input.recolhido);
  if (!time) throw new ErroDeDominio("estado_invalido", { cause: "time" });
  return { data: { time: { ...time, posicao: atual.posicao } }, events: [mudou(deps, "recolher", input.autoria, { time_id: time.id })] };
};

/**
 * bots.mover em lote (a multisseleção da tela): os bots vão para o time do nome (criado se não existe; "" = Sem time),
 * numa transação. Cada bot passa pelo mesmo bots.mover, que já normaliza o nome do time.
 */
export const moverBotsParaTime: CasoDeUso<{ bots: string[]; time: string } & ComAutoria, { time: string; movidos: string[] }> = async (deps, input) => {
  if (!Array.isArray(input.bots) || input.bots.length === 0 || input.bots.length > MAX_BOTS_POR_ACAO || !input.bots.every((b) => typeof b === "string")) throw new ErroDeDominio("entrada_invalida", { cause: "bots" });
  if (typeof input.time !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "time" });
  const { nome } = await garantirTime(deps, input.time);
  const movidos = await poorNoTime(deps, input.bots, nome);
  return { data: { time: nome, movidos }, events: [mudou(deps, "mover", input.autoria, { time: nome, bots: movidos.length })] };
};

/** A tabela id → executor dos times; o registro aponta para ela por `casoDeUso`. */
export const EXECUTORES_TIMES = {
  "times.criar": criarTime,
  "times.renomear": renomearTime,
  "times.excluir": excluirTime,
  "times.ordenar": ordenarTime,
  "times.recolher": recolherTime,
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;
