import type { Projeto } from "../contracts/quadros-do-bot.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms, msOuNull } from "./conversao.ts";

interface LinhaProjeto {
  id: string;
  nome: string;
  descricao: string;
  meta: string | null;
  prazo: string | null;
  posicao: number;
  arquivado_em: Date | null;
  criado_em: Date;
  atualizado_em: Date;
}

const COLUNAS_P = "id, nome, descricao, meta, to_char(prazo, 'YYYY-MM-DD') as prazo, posicao, arquivado_em, criado_em, atualizado_em";

const paraProjeto = (l: LinhaProjeto): Projeto => ({
  id: l.id,
  nome: l.nome,
  descricao: l.descricao,
  meta: l.meta,
  prazo: l.prazo,
  posicao: l.posicao,
  arquivadoEm: msOuNull(l.arquivado_em),
  criadoEm: ms(l.criado_em),
  atualizadoEm: ms(l.atualizado_em),
});

/** O resultado de gravar: o nome (pela chave) já é de outro projeto ativo da pessoa. */
export type GravarProjeto = { ok: Projeto } | { emUso: true } | null;

/**
 * ADA-14 (ADR-153): os projetos da pessoa (agrupam quadros de qualquer bot). O nome não repete entre os ativos (pela chave
 * sem caixa e sem acento, índice projetos_um_por_nome); quem chama passa `chave` já calculada pelo domínio.
 */
export function projetosRepo(conn: Conn, escopo: Escopo) {
  const dona = () => conn`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
  const r = {
    /** Todos (ativos e arquivados), na ordem do seletor. */
    async listar(): Promise<Projeto[]> {
      const ls = await conn<LinhaProjeto[]>`select ${conn.unsafe(COLUNAS_P)} from projetos where ${dona()} order by posicao, nome, criado_em`;
      return ls.map(paraProjeto);
    },
    async buscar(id: string): Promise<Projeto | null> {
      const [l] = await conn<LinhaProjeto[]>`select ${conn.unsafe(COLUNAS_P)} from projetos where ${dona()} and id = ${id}`;
      return l ? paraProjeto(l) : null;
    },
    async contarAtivos(): Promise<number> {
      const [l] = await conn<{ n: number }[]>`select count(*)::int as n from projetos where ${dona()} and arquivado_em is null`;
      return l?.n ?? 0;
    },
    /** Cria no fim da lista. `emUso` = já há um ativo com esse nome (o `on conflict` sem alvo não aborta a transação). */
    async criar(p: { nome: string; chave: string; descricao: string; meta: string | null; prazo: string | null }): Promise<GravarProjeto> {
      const [l] = await conn<LinhaProjeto[]>`
        insert into projetos (tenant_id, owner_id, nome, nome_chave, descricao, meta, prazo, posicao)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.nome}, ${p.chave}, ${p.descricao}, ${p.meta}, ${p.prazo}::date,
          coalesce((select max(posicao) + 1 from projetos where ${dona()}), 0))
        on conflict do nothing
        returning ${conn.unsafe(COLUNAS_P)}`;
      return l ? { ok: paraProjeto(l) } : { emUso: true };
    },
    /** Muda o que vier (undefined = mantém). null = não existe; `emUso` = o nome novo é de outro ativo. */
    async editar(id: string, c: { nome?: string; chave?: string; descricao?: string; meta?: string | null; prazo?: string | null }): Promise<GravarProjeto> {
      const atual = await r.buscar(id);
      if (!atual) return null;
      if (c.chave !== undefined && atual.arquivadoEm === null) {
        const [outro] = await conn<{ id: string }[]>`select id from projetos where ${dona()} and nome_chave = ${c.chave} and arquivado_em is null and id <> ${id} limit 1`;
        if (outro) return { emUso: true };
      }
      const [l] = await conn<LinhaProjeto[]>`
        update projetos set
          nome = coalesce(${c.nome ?? null}, nome), nome_chave = coalesce(${c.chave ?? null}, nome_chave),
          descricao = coalesce(${c.descricao ?? null}, descricao),
          meta = case when ${c.meta !== undefined}::boolean then ${c.meta ?? null} else meta end,
          prazo = case when ${c.prazo !== undefined}::boolean then ${c.prazo ?? null}::date else prazo end,
          atualizado_em = clock_timestamp()
        where ${dona()} and id = ${id}
        returning ${conn.unsafe(COLUNAS_P)}`;
      return l ? { ok: paraProjeto(l) } : null;
    },
    /** Arquivar não apaga nem tira os quadros: eles aparecem em "Sem projeto" até restaurar. */
    async arquivar(id: string, arquivar: boolean): Promise<GravarProjeto> {
      if (!arquivar) {
        const [conflito] = await conn<{ id: string }[]>`
          select o.id from projetos o join projetos p on p.tenant_id = o.tenant_id and p.owner_id = o.owner_id and p.nome_chave = o.nome_chave
          where p.tenant_id = ${escopo.tenantId} and p.owner_id = ${escopo.pessoaId} and p.id = ${id} and o.id <> p.id and o.arquivado_em is null limit 1`;
        if (conflito) return { emUso: true };
      }
      const [l] = await conn<LinhaProjeto[]>`
        update projetos set arquivado_em = case when ${arquivar}::boolean then coalesce(arquivado_em, clock_timestamp()) else null end, atualizado_em = clock_timestamp()
        where ${dona()} and id = ${id}
        returning ${conn.unsafe(COLUNAS_P)}`;
      return l ? { ok: paraProjeto(l) } : null;
    },
    /** Serializa criar e renomear projeto da pessoa (o nome não repete). */
    async travar(): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtextextended(${`projetos:${escopo.tenantId}:${escopo.pessoaId}`}, 0))`;
    },
  };
  return r;
}
