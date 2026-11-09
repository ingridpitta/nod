import { ehNod } from "../../domain/nod.ts";
import { garantirTime } from "./times.ts";
import { aplicarPadroes } from "./acessos.ts";
import type { Agente } from "../../contracts/agente.ts";
import type { IdAcao } from "../../domain/acoes/index.ts";
import { criarAgente, type EntradaCriarAgente, type SaidaCriarAgente } from "../criar-agente.ts";
import { duplicarAgente } from "../duplicar-agente.ts";
import { editarPerfil } from "../editar-perfil.ts";
import { gerirAgente } from "../gerir-agente.ts";
import { mudarModoAprovacao } from "../mudar-modo-aprovacao.ts";
import type { CasoDeUso } from "../tipos.ts";
import { restaurarVersaoDoPerfil } from "../versoes-perfil.ts";

/**
 * Os executores únicos do piloto `bots.*` (definido em 2026-10-28, NOD-391, ADR-135): a rota de pessoa
 * (src/adapters/http/rotas/agentes.ts) e o lote do Nod (gerir-bots.ts) chamam a MESMA função do id. O que cada caminho
 * escolhe é parâmetro escrito: o lote cria já na seção, duplica com as rotinas pausadas e confirma o total só com o
 * cartão aprovado pela pessoa.
 */

/** bots.criar: cria o bot e, com `secao`, já o põe nela (o lote; a tela organiza depois, pelo bots.mover). */
export const criarBot: CasoDeUso<EntradaCriarAgente & { secao?: string }, SaidaCriarAgente> = async (deps, input) => {
  const { secao, ...entrada } = input;
  const criado = await criarAgente(deps, { ...entrada, modelo: entrada.modelo ?? deps.modeloPadrao });
  // ADA-241: o bot novo nasce com o padrão de cada app ligado (sem padrão, nada muda).
  const r = { data: criado.data, events: [...(criado.events ?? []), ...(await aplicarPadroes(deps, criado.data.agente.id))] };
  if (secao === undefined || secao.trim() === "") return r;
  // NOD-437: a seção é um time; o nome vira o do time (criado no fim se não existe).
  const { nome } = await garantirTime(deps, secao);
  const organizado = await gerirAgente(deps, { agenteId: r.data.agente.id, acao: "organizar", secao: nome });
  return { data: r.data, events: [...(r.events ?? []), ...(organizado.events ?? [])] };
};

/**
 * bots.mover: o time (`secao`, o nome dele), e na tela também o não lido, o fixado e a ordem da barra (o arrastar é um
 * pedido só). NOD-437: o nome vira o do time que casa pela chave ("producao" → "Produção"); sem time, ele é criado no fim.
 */
export const moverBot: CasoDeUso<{ agenteId: string; secao?: string; naoLido?: boolean; fixado?: boolean; ordem?: string[] }, { agente: Agente }> = async (deps, input) => {
  if (typeof input.secao !== "string") return gerirAgente(deps, { ...input, acao: "organizar" });
  const alvo = await deps.repos.agentes.buscar(input.agenteId);
  // Revisão 1 (M3): todo bot da pessoa passa pelo time (nome longo dá o erro do nome, não uma seção sem time).
  // O Nod e o bot de outro dono seguem para o gerirAgente, que os recusa como antes (sem criar time no caminho).
  const secao = alvo && alvo.ownerId === deps.escopo.pessoaId && !ehNod(alvo) ? (await garantirTime(deps, input.secao)).nome : input.secao;
  return gerirAgente(deps, { ...input, secao, acao: "organizar" });
};

/**
 * bots.excluir: exclui e, depois do commit, desliga o computador do bot (ADR-135 §4). Antes do NOD-391 só a rota
 * desligava; pelo Nod o computador ficava ligado. O desligamento abre a própria transação e exige o bot já excluído no
 * banco, por isso é efeito pós-commit e não chamada aqui dentro.
 */
export const excluirBot: CasoDeUso<{ agenteId: string }, { agente: Agente }> = async (deps, input) => {
  const r = await gerirAgente(deps, { agenteId: input.agenteId, acao: "excluir" });
  deps.aposCommit?.({ tipo: "desligar_computador", agenteId: r.data.agente.id });
  return r;
};

/** A tabela id → executor do piloto; o registro aponta para ela por `casoDeUso` (o teste de paridade confere). */
export const EXECUTORES_BOTS = {
  "bots.criar": criarBot,
  "bots.duplicar": duplicarAgente,
  "bots.editar": editarPerfil,
  "bots.mover": moverBot,
  "bots.excluir": excluirBot,
  "bots.mudar_modo": mudarModoAprovacao,
  "bots.restaurar_versao": restaurarVersaoDoPerfil,
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;
