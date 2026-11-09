import type { EstadoImportacao, FiltroImportacao, ImportacaoDto } from "../contracts/quadro-importacao.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";

interface LinhaImportacao {
  id: string;
  quadro_id: string;
  time: string;
  filtro: FiltroImportacao | null;
  estado: EstadoImportacao;
  total: number;
  trazidas: number;
  erro: string | null;
  lote_id: string | null;
  colunas: number | null;
  conversa_id: string | null;
  criado_em: Date;
  atualizado_em: Date;
}

const COLUNAS = "id, quadro_id, time, filtro, estado, total, trazidas, erro, lote_id, colunas, conversa_id, criado_em, atualizado_em";

export type Importacao = ImportacaoDto & { conversaId: string | null };

const paraImportacao = (l: LinhaImportacao): Importacao => ({
  id: l.id, quadroId: l.quadro_id, time: l.time, filtro: l.filtro, estado: l.estado, total: l.total, trazidas: l.trazidas,
  erro: l.erro, loteId: l.lote_id, colunas: l.colunas, conversaId: l.conversa_id, criadoEm: ms(l.criado_em), atualizadoEm: ms(l.atualizado_em),
});

/** Um comentário trazido do Linear (autor 'linear', o nome de quem escreveu lá e o id para reimportar sem duplicar). */
export type ComentarioDoLinear = { quadroId: string; tarefaId: string; linearId: string; autorNome: string; texto: string; criadoEm: number };

/**
 * definido em 2026-11-02 (NOD-422, 0148): a importação de um time do Linear (o progresso, o resultado e o lote), os
 * comentários e as linhas do histórico que ela traz. Só primitivas: quem decide é src/use-cases/importar-linear.ts.
 */
export function quadroImportacoesRepo(conn: Conn, escopo: Escopo) {
  const dona = () => conn`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
  return {
    /** null = já há uma importação trazendo neste quadro (o índice parcial de 'trazendo'). */
    async criar(i: { id: string; quadroId: string; time: string; filtro: FiltroImportacao | null; total: number; conversaId: string | null }): Promise<Importacao | null> {
      const [l] = await conn<LinhaImportacao[]>`
        insert into quadro_importacoes (tenant_id, owner_id, id, quadro_id, time, filtro, estado, total, conversa_id)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${i.id}, ${i.quadroId}, ${i.time}, ${i.filtro}, 'trazendo', ${i.total}, ${i.conversaId})
        on conflict do nothing
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraImportacao(l) : null;
    },
    /**
     * Revisão do PR #630: a 'trazendo' sem progresso há mais de `paradaMs` caiu (o processo reiniciou no meio da busca) e
     * vira 'falhou', liberando o índice parcial para a próxima. Se a busca de fato seguir viva, o progresso e o aplicar
     * dela já não mudam nada (só tocam a que ainda está 'trazendo'). Devolve quantas venceram.
     */
    async vencerParadas(quadroId: string, paradaMs: number, erro: string): Promise<number> {
      const r = await conn`update quadro_importacoes set estado = 'falhou', erro = ${erro.slice(0, 300)}, atualizado_em = clock_timestamp()
        where ${dona()} and quadro_id = ${quadroId} and estado = 'trazendo' and atualizado_em < clock_timestamp() - make_interval(secs => ${paradaMs / 1000}::double precision)`;
      return r.count;
    },
    /**
     * Revisão do PR #630: quando cada tarefa foi escrita por uma importação aplicada (não desfeita) pela última vez: o
     * criado_em do lote dela, gravado depois da tarefa. O que mudou depois disso foi mexido aqui, não pela importação.
     */
    async escritasPelaImportacao(quadroId: string): Promise<Map<string, number>> {
      const ls = await conn<{ tarefa_id: string; em: Date }[]>`
        select t.tarefa_id, max(l.criado_em) as em
          from quadro_importacoes i
          join quadro_lotes l on l.tenant_id = i.tenant_id and l.id = i.lote_id
          cross join lateral unnest(l.tarefa_ids) as t(tarefa_id)
         where i.tenant_id = ${escopo.tenantId} and i.owner_id = ${escopo.pessoaId} and i.quadro_id = ${quadroId} and i.estado = 'aplicada' and l.desfeito_em is null
         group by t.tarefa_id`;
      return new Map(ls.map((l) => [l.tarefa_id, ms(l.em)]));
    },
    /**
     * Revisão 4 do PR #630 (decisão 3 da Ada): as tarefas do quadro que uma importação aplicada (não desfeita) criou: a
     * linha 'criada' do histórico leva o lote dela. Ficam fora da meta (tarefasDaMeta).
     */
    async importadas(quadroId: string): Promise<Set<string>> {
      const ls = await conn<{ id: string }[]>`
        select distinct t.id from quadro_tarefas t
          join quadro_tarefa_historico h on h.tenant_id = t.tenant_id and h.tarefa_id = t.id and h.campo = 'criada'
          join quadro_importacoes i on i.tenant_id = h.tenant_id and i.lote_id = h.lote_id and i.estado = 'aplicada'
         where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.quadro_id = ${quadroId}`;
      return new Set(ls.map((l) => l.id));
    },
    /**
     * Revisão 4 do PR #630: há uma importação aplicada deste quadro com lote (não desfeito) mais novo que `loteId`? O
     * Desfazer da importação antiga diz que a mais nova se desfaz primeiro.
     */
    async maisNovaQue(quadroId: string, loteId: string): Promise<boolean> {
      const [l] = await conn<{ ha: boolean }[]>`
        select exists (
          select 1 from quadro_importacoes i
            join quadro_lotes l on l.tenant_id = i.tenant_id and l.id = i.lote_id
            join quadro_lotes p on p.tenant_id = i.tenant_id and p.id = ${loteId}
           where i.tenant_id = ${escopo.tenantId} and i.owner_id = ${escopo.pessoaId} and i.quadro_id = ${quadroId} and i.estado = 'aplicada'
             and l.desfeito_em is null and l.id <> p.id and l.criado_em > p.criado_em) as ha`;
      return l?.ha ?? false;
    },
    /**
     * Revisão 4 do PR #630: das tarefas, as que ganharam um PR ligado (quadro_tarefa_prs, NOD-421) depois do lote. O
     * laço dos PRs grava o pr_url sem mexer no mudado_em (definirPrUrlSeVazio): sem isto o Desfazer apagaria o vínculo.
     */
    async comPrDepois(loteId: string, tarefaIds: readonly string[]): Promise<Set<string>> {
      if (tarefaIds.length === 0) return new Set();
      const ls = await conn<{ tarefa_id: string }[]>`
        select distinct p.tarefa_id from quadro_tarefa_prs p
          join quadro_lotes l on l.tenant_id = p.tenant_id and l.owner_id = p.owner_id and l.id = ${loteId}
         where p.tenant_id = ${escopo.tenantId} and p.owner_id = ${escopo.pessoaId}
           and p.tarefa_id = any(${conn.array([...tarefaIds])}::uuid[]) and p.criado_em > l.criado_em`;
      return new Set(ls.map((l) => l.tarefa_id));
    },
    async buscar(id: string): Promise<Importacao | null> {
      const [l] = await conn<LinhaImportacao[]>`select ${conn.unsafe(COLUNAS)} from quadro_importacoes where ${dona()} and id = ${id}`;
      return l ? paraImportacao(l) : null;
    },
    async trazendo(quadroId: string): Promise<Importacao | null> {
      const [l] = await conn<LinhaImportacao[]>`select ${conn.unsafe(COLUNAS)} from quadro_importacoes where ${dona()} and quadro_id = ${quadroId} and estado = 'trazendo'`;
      return l ? paraImportacao(l) : null;
    },
    /** A mais recente do quadro (a linha de progresso e o resultado na tela). */
    async ultima(quadroId: string): Promise<Importacao | null> {
      const [l] = await conn<LinhaImportacao[]>`select ${conn.unsafe(COLUNAS)} from quadro_importacoes where ${dona()} and quadro_id = ${quadroId} order by criado_em desc, id desc limit 1`;
      return l ? paraImportacao(l) : null;
    },
    async doLote(loteId: string): Promise<Importacao | null> {
      const [l] = await conn<LinhaImportacao[]>`select ${conn.unsafe(COLUNAS)} from quadro_importacoes where ${dona()} and lote_id = ${loteId}`;
      return l ? paraImportacao(l) : null;
    },
    /** Só a que ainda traz muda (a que falhou ou foi aplicada não volta). false = já não estava trazendo. */
    async progresso(id: string, p: { trazidas: number; total: number }): Promise<boolean> {
      const r = await conn`update quadro_importacoes set trazidas = ${p.trazidas}, total = greatest(${p.total}::int, ${p.trazidas}::int), atualizado_em = clock_timestamp()
        where ${dona()} and id = ${id} and estado = 'trazendo'`;
      return r.count > 0;
    },
    async falhar(id: string, erro: string): Promise<boolean> {
      const r = await conn`update quadro_importacoes set estado = 'falhou', erro = ${erro.slice(0, 300)}, atualizado_em = clock_timestamp()
        where ${dona()} and id = ${id} and estado = 'trazendo'`;
      return r.count > 0;
    },
    async aplicar(id: string, r: { loteId: string | null; trazidas: number; colunas: number }): Promise<boolean> {
      const x = await conn`update quadro_importacoes set estado = 'aplicada', lote_id = ${r.loteId}, trazidas = ${r.trazidas}, total = ${r.trazidas}, colunas = ${r.colunas}, atualizado_em = clock_timestamp()
        where ${dona()} and id = ${id} and estado = 'trazendo'`;
      return x.count > 0;
    },
    async desfazer(id: string): Promise<void> {
      await conn`update quadro_importacoes set estado = 'desfeita', atualizado_em = clock_timestamp() where ${dona()} and id = ${id} and estado = 'aplicada'`;
    },
    /** O PR 2 (o quadro assume, use-cases/assumir-quadro.ts) marca assumido_em; assumido, a importação não roda mais. */
    async assumido(quadroId: string): Promise<boolean> {
      return (await this.assumidoEm(quadroId)) !== null;
    },
    async assumidoEm(quadroId: string): Promise<number | null> {
      const [l] = await conn<{ assumido_em: Date | null }[]>`select assumido_em from quadros where ${dona()} and id = ${quadroId}`;
      return l?.assumido_em ? ms(l.assumido_em) : null;
    },
    /** Assumir grava o instante; o Desfazer limpa (null). Só a dona. */
    async marcarAssumido(quadroId: string, em: number | null): Promise<boolean> {
      const r = await conn`update quadros set assumido_em = ${em === null ? null : new Date(em)} where ${dona()} and id = ${quadroId}`;
      return r.count > 0;
    },
    /**
     * Troca o prefixo do quadro pela chave do time (o NOD-422 do Linear continua NOD-422 no quadro). Quem chama garante que
     * toda tarefa atual já tem o número da issue dela (revisão 10 do PR #630): senão o código mostrado não a abriria.
     */
    async trocarPrefixo(quadroId: string, prefixo: string): Promise<void> {
      await conn`update quadros set prefixo = ${prefixo} where ${dona()} and id = ${quadroId}`;
    },
    /** O próximo número do quadro nunca volta: só sobe até `proximo`. */
    async subirProximo(quadroId: string, proximo: number): Promise<void> {
      await conn`update quadros set proximo_numero = greatest(proximo_numero, ${proximo}::int) where ${dona()} and id = ${quadroId}`;
    },
    async proximo(quadroId: string): Promise<number> {
      const [l] = await conn<{ proximo_numero: number }[]>`select proximo_numero from quadros where ${dona()} and id = ${quadroId}`;
      return l?.proximo_numero ?? 1;
    },

    /** Os comentários do Linear; o repetido (mesma tarefa, mesmo id no Linear) não duplica. Devolve quantos entraram. */
    async inserirComentarios(cs: readonly ComentarioDoLinear[], loteId: string): Promise<number> {
      if (cs.length === 0) return 0;
      const r = await conn`
        insert into quadro_comentarios (tenant_id, owner_id, quadro_id, tarefa_id, autor, autor_nome, linear_id, lote_id, texto, de_fora, criado_em)
        select ${escopo.tenantId}, ${escopo.pessoaId}, c.quadro_id, c.tarefa_id, 'linear', c.autor_nome, c.linear_id, ${loteId}, c.texto, true, c.criado_em
          from unnest(${conn.array(cs.map((c) => c.quadroId))}::uuid[], ${conn.array(cs.map((c) => c.tarefaId))}::uuid[], ${conn.array(cs.map((c) => c.linearId))}::text[],
                      ${conn.array(cs.map((c) => c.autorNome.slice(0, 200)))}::text[], ${conn.array(cs.map((c) => c.texto))}::text[],
                      ${conn.array(cs.map((c) => new Date(c.criadoEm).toISOString()))}::timestamptz[])
            as c(quadro_id, tarefa_id, linear_id, autor_nome, texto, criado_em)
        on conflict (tenant_id, tarefa_id, linear_id) where linear_id is not null do nothing`;
      return r.count;
    },
    /**
     * Revisão 3 do PR #630: das tarefas, as que ganharam um comentário que não veio do Linear (da pessoa ou de um bot)
     * depois do lote: contam como mexidas, e o Desfazer da importação não as apaga com o comentário. Revisão 6: também os
     * comentários de quem participa do quadro (quadro_tarefa_comentarios, da 0146), que saem em cascata com a tarefa.
     */
    async comentadasDepois(loteId: string, tarefaIds: readonly string[]): Promise<Set<string>> {
      if (tarefaIds.length === 0) return new Set();
      const ids = conn.array([...tarefaIds]);
      const ls = await conn<{ tarefa_id: string }[]>`
        select distinct c.tarefa_id from quadro_comentarios c
          join quadro_lotes l on l.tenant_id = c.tenant_id and l.owner_id = c.owner_id and l.id = ${loteId}
         where c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId} and c.autor <> 'linear'
           and c.tarefa_id = any(${ids}::uuid[]) and c.criado_em > l.criado_em
        union
        select distinct tc.tarefa_id from quadro_tarefa_comentarios tc
          join quadro_lotes l on l.tenant_id = tc.tenant_id and l.owner_id = tc.owner_id and l.id = ${loteId}
         where tc.tenant_id = ${escopo.tenantId} and tc.owner_id = ${escopo.pessoaId}
           and tc.tarefa_id = any(${ids}::uuid[]) and tc.criado_em > l.criado_em`;
      return new Set(ls.map((l) => l.tarefa_id));
    },
    /** O Desfazer da importação tira só os comentários que ela trouxe. */
    async apagarComentariosDoLote(loteId: string): Promise<void> {
      await conn`delete from quadro_comentarios where ${dona()} and lote_id = ${loteId} and autor = 'linear'`;
    },
    /** As linhas 'linear' do histórico, com a data do Linear (o início do tempo em coluna). */
    async registrarLinhas(quadroId: string, ls: readonly { tarefaId: string; de: string | null; para: string | null; em: number }[], loteId: string): Promise<void> {
      if (ls.length === 0) return;
      await conn`
        insert into quadro_tarefa_historico (tenant_id, owner_id, tarefa_id, quadro_id, campo, de, para, autor, autor_agente_id, lote_id, criado_em)
        select ${escopo.tenantId}, ${escopo.pessoaId}, h.tarefa_id, ${quadroId}, 'linear', nullif(h.de, ''), nullif(h.para, ''), 'regra', null, ${loteId}, h.em
          from unnest(${conn.array(ls.map((l) => l.tarefaId))}::uuid[], ${conn.array(ls.map((l) => l.de ?? ""))}::text[], ${conn.array(ls.map((l) => l.para ?? ""))}::text[],
                      ${conn.array(ls.map((l) => new Date(l.em).toISOString()))}::timestamptz[]) as h(tarefa_id, de, para, em)`;
    },
    /**
     * A última linha do Linear de cada tarefa do quadro (`para` = o estado; null = "fechada no Linear"): a reimportação
     * não repete a mesma linha. "Última" pela ordem em que foram gravadas (o lote de cada uma), não pelo criado_em: o da
     * linha do estado é a data do Linear e o da "fechada" é a hora da importação, e misturar os dois repetia a linha a cada
     * reimportação (revisão do PR #630).
     */
    async ultimasLinhas(quadroId: string): Promise<Map<string, string | null>> {
      const ls = await conn<{ tarefa_id: string; para: string | null }[]>`
        select distinct on (h.tarefa_id) h.tarefa_id, h.para from quadro_tarefa_historico h
          left join quadro_lotes l on l.tenant_id = h.tenant_id and l.id = h.lote_id
        where h.tenant_id = ${escopo.tenantId} and h.owner_id = ${escopo.pessoaId} and h.quadro_id = ${quadroId} and h.campo = 'linear'
        order by h.tarefa_id, l.criado_em desc nulls last, h.criado_em desc, h.id desc`;
      return new Map(ls.map((l) => [l.tarefa_id, l.para]));
    },
    /** O Desfazer de uma reimportação tira as linhas que ela pôs nas tarefas que já existiam. */
    async apagarLinhasDoLote(loteId: string): Promise<void> {
      await conn`delete from quadro_tarefa_historico where ${dona()} and lote_id = ${loteId} and campo = 'linear'`;
    },
  };
}
