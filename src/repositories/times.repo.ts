import type { Time } from "../contracts/time.ts";
import type { Conn, Escopo } from "../shared/types.ts";

type Linha = { id: string; nome: string; posicao: number; recolhido: boolean };
const deLinha = (l: Linha): Time => ({ id: l.id, nome: l.nome, posicao: l.posicao, recolhido: l.recolhido });

/**
 * Os times da pessoa (0147, NOD-437). A dona é a pessoa do escopo: a RLS só deixa ler e mexer nos próprios. A chave do
 * nome vem pronta do domínio (chaveDoTime): o banco só garante que ela é única por pessoa.
 */
export function timesRepo(conn: Conn, escopo: Escopo) {
  return {
    async listar(): Promise<Time[]> {
      const ls = await conn<Linha[]>`
        select id, nome, posicao, recolhido from times
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
        order by posicao, nome`;
      return ls.map(deLinha);
    },

    /**
     * Trava os times da pessoa até o fim da transação: toda mudança de time (e de quem está nele) lê a lista, decide e
     * reescreve várias linhas; dois dispositivos ao mesmo tempo esperam um pelo outro em vez de se atropelar.
     */
    async travar(): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext(${"times:" + escopo.pessoaId}))`;
    },

    /** Cria o time; null se a chave já existe (corrida com outro dispositivo). */
    async criar(p: { nome: string; chave: string; posicao: number; recolhido?: boolean }): Promise<Time | null> {
      const [l] = await conn<Linha[]>`
        insert into times (tenant_id, owner_id, nome, nome_chave, posicao, recolhido)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.nome}, ${p.chave}, ${p.posicao}, ${p.recolhido ?? false})
        on conflict (tenant_id, owner_id, nome_chave) do nothing
        returning id, nome, posicao, recolhido`;
      return l ? deLinha(l) : null;
    },

    async renomear(id: string, p: { nome: string; chave: string }): Promise<Time | null> {
      const [l] = await conn<Linha[]>`
        update times set nome = ${p.nome}, nome_chave = ${p.chave}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and nome <> ''
        returning id, nome, posicao, recolhido`;
      return l ? deLinha(l) : null;
    },

    async recolher(id: string, recolhido: boolean): Promise<Time | null> {
      const [l] = await conn<Linha[]>`
        update times set recolhido = ${recolhido}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        returning id, nome, posicao, recolhido`;
      return l ? deLinha(l) : null;
    },

    /** Grava a ordem: o i-ésimo id fica na posição i. */
    async ordenar(ids: readonly string[]): Promise<void> {
      if (ids.length === 0) return;
      await conn`
        update times t set posicao = o.posicao
        from (select id, (ord - 1)::int as posicao from unnest(${ids as string[]}::uuid[]) with ordinality as u(id, ord)) o
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.id = o.id`;
    },

    async excluir(id: string): Promise<boolean> {
      const ls = await conn`
        delete from times where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and nome <> ''
        returning id`;
      return ls.length > 0;
    },
  };
}
