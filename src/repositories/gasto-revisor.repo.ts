import type { Conn } from "../shared/types.ts";
import { data } from "./conversao.ts";

/**
 * O gasto do dia do revisor no servidor, somando todas as contas (definido em 2026-10-25, ADR-115 "Revisor no servidor").
 * Mora em `limites_conta` (0109): a tabela de contadores globais contra abuso, sem dado de pessoa e sem RLS, que o
 * nod_app já lê e escreve fora de escopo (`consumirLimite`). Uma linha por dia UTC (`janela`), com a chave fixa abaixo e a
 * `contagem` em MICRODÓLARES (int4: até US$ 2.147 por dia; o teto máximo configurável é US$ 1.000). No banco, e não na
 * memória, porque o deploy azul/verde troca o processo e as duas cores atendem juntas durante a drenagem: a conta do dia
 * sobrevive ao deploy e é uma só. Sem migração nova.
 */
export const CHAVE_GASTO_REVISOR = "revisor:gasto_microdolares";
/**
 * revisto em 2026-10-26 (revisão do #524, item 3): o gasto do dia de cada PESSOA, na mesma tabela. A chave é o prefixo
 * mais um HMAC do id da pessoa (`chaveDeLimite`, como as das contas: a tabela não tem RLS e não guarda id em claro);
 * quem a monta é a composição, que tem o segredo. O prefixo não colide com `revisor:` nem com os tipos das contas.
 */
export const PREFIXO_GASTO_PESSOA = "revisor_gasto";
/** O int4 da coluna; a soma satura aqui em vez de estourar (o teto já está muito abaixo). */
const CONTAGEM_MAX = 2_000_000_000;

export async function gastoDoRevisorNoDia(conn: Conn, inicioDoDia: number): Promise<number> {
  const [l] = await conn<{ contagem: number }[]>`select contagem from limites_conta where chave = ${CHAVE_GASTO_REVISOR} and janela = ${data(inicioDoDia)}`;
  return l?.contagem ?? 0;
}

/** Soma ao dia e devolve o total depois da soma; os dias anteriores da chave saem no caminho (como `consumirLimite`). */
/** O gasto do dia de uma pessoa (a chave já montada por `chaveDeLimite(segredo, PREFIXO_GASTO_PESSOA, pessoaId)`). */
export async function gastoDaPessoaNoDia(conn: Conn, chavePessoa: string, inicioDoDia: number): Promise<number> {
  const [l] = await conn<{ contagem: number }[]>`select contagem from limites_conta where chave = ${chavePessoa} and janela = ${data(inicioDoDia)}`;
  return l?.contagem ?? 0;
}

/**
 * Soma ao dia, no total de todas as contas e no da pessoa, numa transação só, e devolve os dois totais depois da soma.
 * Os dias anteriores (do total e de TODAS as pessoas) saem no caminho, antes dos upserts: assim a linha de quem não
 * voltou não fica para sempre. Ordem fixa — apaga, total, pessoa —, a mesma em toda chamada e nas duas cores: sem
 * deadlock (a linha do total serializa as somas, como antes).
 */
export async function somarGastoDoRevisor(conn: Conn, inicioDoDia: number, microdolares: number, chavePessoa: string): Promise<{ total: number; pessoa: number }> {
  const n = Math.min(CONTAGEM_MAX, Math.max(0, Math.ceil(microdolares)));
  await conn`delete from limites_conta where (chave = ${CHAVE_GASTO_REVISOR} or starts_with(chave, ${`${PREFIXO_GASTO_PESSOA}:`})) and janela < ${data(inicioDoDia)}`;
  const somar = async (chave: string) => {
    const [l] = await conn<{ contagem: number }[]>`
      insert into limites_conta (chave, janela, contagem) values (${chave}, ${data(inicioDoDia)}, ${n})
      on conflict (chave, janela) do update set contagem = least(limites_conta.contagem::bigint + ${n}, ${CONTAGEM_MAX})::int
      returning contagem`;
    return l?.contagem ?? n;
  };
  const total = await somar(CHAVE_GASTO_REVISOR);
  const pessoa = await somar(chavePessoa);
  return { total, pessoa };
}
