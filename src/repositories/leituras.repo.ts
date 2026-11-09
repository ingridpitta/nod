import type { EpochMs } from "../contracts/ids.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { LeituraMarcada } from "../contracts/nao-lidos.ts";
import type { OrigemTurno } from "../contracts/turno.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";
import { COLUNAS_MENSAGEM, paraMensagem, type LinhaMensagem } from "./mensagens.repo.ts";

/** Uma conversa com fala nova para a pessoa: quantas, desde quando, a mais recente. */
export type ResumoNaoLida = { conversaId: string; tipo: "propria" | "sala"; agenteId: string | null; salaId: string | null; total: number; desde: EpochMs; ultimaEm: EpochMs };

/** O instante em texto exato (µs, UTC), a forma que o Desfazer devolve; -infinity e null viram null. */
const textoUtc = (conn: Conn, expr: string) => conn.unsafe(`(case when isfinite(${expr}) then to_char(${expr} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') end)`);

/** A primeira não lida (onde a linha "Novas" entra), as últimas e se alguma veio de rotina. */
export type NaoLidasDaConversa = { primeira: Mensagem; ultimas: Mensagem[]; avisos: Mensagem[]; daRotina: boolean };

/**
 * NOD-114 (revisão 2): as falas que são aviso por si (o avisar_pessoa e a linha da rotina que falhou ou não rodou). Saem
 * mesmo fora das `por` mais recentes — até `AVISOS_FORA_DA_JANELA` —, senão três falas depois do aviso o apagavam do
 * navegador sem a pessoa ter lido.
 */
const AVISOS_FORA_DA_JANELA = 10;

/** Até onde a pessoa leu cada conversa (0039). Uma linha por pessoa e conversa; sem linha, tudo é novo. */
export function leiturasRepo(conn: Conn, escopo: Escopo) {
  /**
   * "Não lido" (definido em 2026-09-29, 0039): conta texto e artefato de quem não é a pessoa. Aviso do sistema,
   * execução de rotina e a troca interna entre bots (handoff, peer_ask) ficam de fora: não são fala para ela.
   * A mesma condição nas três consultas; a coluna é comparada com o lido_ate do banco, nunca com um ms da borda.
   * revisto em 2026-10-28 (NOD-114): a linha da rotina que falhou ou não rodou também conta — é o aviso de que algo que a
   * pessoa esperava não aconteceu, e o navegador e o desktop avisam a partir desta lista. Ela sai com a autoria da pessoa
   * pela regra que decidiu (disparar-rotina.ts), então não passa pelo filtro da fala da própria pessoa. A interrompida fica
   * de fora: é o Parar dela; a bloqueada não escreve no chat.
   */
  const avisa = () => conn`(coalesce(m.payload->>'kind', '') = 'aviso_pessoa' or (m.kind = 'rotina_execucao' and m.payload->>'desfecho' in ('falhou', 'nao_rodou')))`;
  /**
   * definido em 2026-11-01 (NOD-449, decisões 1 e 8): a fala entre bots não é fala para a pessoa. Fica de fora o pedido de
   * um colega (`peer_pedido`, a fala do remetente na conversa do destinatário) e o que o bot diz no turno que esse pedido
   * abriu: origem peer, delegação com um `peer_pedido` no próprio turno (a triagem; o pedir_a_bot grava os dois juntos),
   * a frente aberta para um trabalho que um colega pediu (`trabalhos.pedido_por_agente_id`) e as retomadas de qualquer um
   * deles (a raiz da cadeia, como delegacaoDoTurno; revisão 2 do PR #616). A
   * delegação sem pedido de colega — a tarefa que a pessoa moveu no quadro — é trabalho dela e conta (revisão do PR #616:
   * `sob_procuracao_de` é sempre a própria pessoa e não separa nada). Sai do badge, da lista e dos pontos, que usam esta
   * mesma condição; continua na conversa. O aviso (avisar_pessoa, rotina que falhou) conta sempre: é dirigido a ela.
   * As subconsultas vão pelo índice (pkey de turnos e trabalhos, mensagens_por_turno), só rodam para mensagem com turno, e a
   * cadeia só para turno de retomada.
   * Medido em 2026-11-01 (32 conversas, 14,4 mil mensagens, um terço com turno): resumo() 16 → 22 ms; o listar da tela
   * fica igual ao da main (~380 ms, quem pesa são as janelas de mensagens()). Pior caso (revisão 3 do PR #616): uma
   * delegação de colega com retomada e N mensagens na mesma conversa — N = 100/400/1600/3200 dá resumo() 19/14/18/18 ms;
   * o Postgres memoiza a subconsulta por turno (Memoize), então não é quadrático e não precisa de índice novo.
   */
  /** A raiz de um turno é de pedido de colega: `peer`, ou delegação com peer_pedido (a triagem) ou aberta para o trabalho que um colega pediu (a frente). */
  const deColega = (t: string) =>
    conn.unsafe(`(${t}.origem = 'peer' or (${t}.origem = 'delegacao' and (exists (select 1 from mensagens pp where pp.tenant_id = ${t}.tenant_id and pp.turno_id = ${t}.id and pp.payload->>'kind' = 'peer_pedido') or exists (select 1 from trabalhos w where w.tenant_id = ${t}.tenant_id and w.id = ${t}.trabalho_id and w.pedido_por_agente_id is not null))))`);
  const entreBots = () =>
    conn`(coalesce(m.payload->>'kind', '') = 'peer_pedido' or (m.turno_id is not null and exists (
      select 1 from turnos tb where tb.tenant_id = m.tenant_id and tb.id = m.turno_id and (${deColega("tb")} or (tb.origem = 'retomada' and exists (
        -- A retomada (cartão, reenvio, espera de colega) é da raiz: o mesmo delegacaoDoTurno, com o teto SALTOS_DE_RETOMADA.
        with recursive c(id, origem, retoma, n) as (
          select tb.id, tb.origem, tb.retoma_turno_id, 0
          union all
          select p.id, p.origem, p.retoma_turno_id, c.n + 1 from c join turnos p on p.tenant_id = tb.tenant_id and p.id = c.retoma
          where c.origem = 'retomada' and c.n < 10
        ) select 1 from c join turnos rz on rz.tenant_id = tb.tenant_id and rz.id = c.id where c.origem <> 'retomada' and ${deColega("rz")}))))))`;
  const nova = () =>
    conn`(((m.kind in ('texto', 'artefato') and not (m.autor_tipo = 'pessoa' and m.autor_id = ${escopo.pessoaId})) or (m.kind = 'rotina_execucao' and m.payload->>'desfecho' in ('falhou', 'nao_rodou'))) and (${avisa()} or not ${entreBots()}))`;
  return {
    /**
     * As conversas da pessoa (os bots dela e as salas que ela lê) com fala nova, a mais recente primeiro.
     *
     * revisto em 2026-09-30: o "lido até" sai pronto da subconsulta (o `offset 0` a impede de ser achatada) e entra no
     * LATERAL como coluna. Escrito como coalesce(l.lido_ate, …) dentro do LATERAL, sob RLS ele ficava no filtro depois
     * das policies em vez de limitar a busca no índice mensagens_por_conversa, e a conta lia todas as mensagens de cada
     * conversa: medido em 2026-09-30 (banco efêmero, 32 conversas, 14,5 mil mensagens), 11.441 buffers e custo 173 mil
     * (acima do limiar do JIT) contra 4.360 buffers e custo 58,6 mil assim; dentro do GET frota, já com jit=off, de 57
     * para 25 ms.
     */
    async resumo(): Promise<ResumoNaoLida[]> {
      const linhas = await conn<{ conversa_id: string; tipo: "propria" | "sala"; agente_id: string | null; sala_id: string | null; total: number; desde: Date; ultima: Date }[]>`
        select c.id as conversa_id, c.tipo, c.agente_id, c.sala_id, x.total, x.desde, x.ultima
        from (
          select c.tenant_id, c.id, c.tipo, c.agente_id, c.sala_id, coalesce(l.lido_ate, '-infinity'::timestamptz) as lido_ate
          from conversas c
          left join leituras l on l.tenant_id = c.tenant_id and l.owner_id = ${escopo.pessoaId} and l.conversa_id = c.id
          where c.tenant_id = ${escopo.tenantId} and (c.tipo = 'sala' or c.owner_id = ${escopo.pessoaId})
          offset 0
        ) c
        cross join lateral (
          select count(*)::int as total, min(m.criado_em) as desde, max(m.criado_em) as ultima
          from mensagens m
          where m.tenant_id = c.tenant_id and m.conversa_id = c.id and m.criado_em > c.lido_ate and ${nova()}
        ) x
        where x.total > 0
        order by x.ultima desc, c.id`;
      return linhas.map((l) => ({ conversaId: l.conversa_id, tipo: l.tipo, agenteId: l.agente_id, salaId: l.sala_id, total: l.total, desde: ms(l.desde), ultimaEm: ms(l.ultima) }));
    },

    /** Para cada conversa pedida: a primeira não lida e as `por` mais recentes, em ordem de criação. */
    async mensagens(conversaIds: readonly string[], por = 3): Promise<Map<string, NaoLidasDaConversa>> {
      const saida = new Map<string, NaoLidasDaConversa>();
      if (conversaIds.length === 0) return saida;
      const colunas = COLUNAS_MENSAGEM.split(", ").map((c) => `m.${c}`).join(", ");
      const linhas = await conn<(LinhaMensagem & { origem: OrigemTurno | null; trabalho_id: string | null; fim_do_turno: boolean | null; recente: number; ordem: number; avisa: boolean; raiz_id: string | null; raiz_origem: OrigemTurno | null })[]>`
        select r.*, rz.raiz_id, rz.raiz_origem::text as raiz_origem from (
          select ${conn.unsafe(colunas)}, t.origem::text as origem, t.trabalho_id, t.retoma_turno_id as retoma,
            -- NOD-114: a última fala de texto do bot num turno concluído ("terminou"). A fala final é sempre a mais nova do
            -- turno, então está entre as não lidas sempre que alguma fala dele estiver; o aviso (avisar_pessoa) não conta.
            (t.estado = 'concluido' and m.kind = 'texto' and m.autor_tipo = 'agente' and coalesce(m.payload->>'kind', '') <> 'aviso_pessoa'
              and m.criado_em = max(case when m.kind = 'texto' and m.autor_tipo = 'agente' and coalesce(m.payload->>'kind', '') <> 'aviso_pessoa' then m.criado_em end) over (partition by m.turno_id)) as fim_do_turno,
            ${avisa()} as avisa,
            row_number() over (partition by m.conversa_id order by m.criado_em desc, m.id desc)::int as recente,
            row_number() over (partition by m.conversa_id, ${avisa()} order by m.criado_em desc, m.id desc)::int as recente_do_tipo,
            row_number() over (partition by m.conversa_id order by m.criado_em, m.id)::int as ordem
          from mensagens m
          left join leituras l on l.tenant_id = m.tenant_id and l.owner_id = ${escopo.pessoaId} and l.conversa_id = m.conversa_id
          left join turnos t on t.tenant_id = m.tenant_id and t.id = m.turno_id
          where m.tenant_id = ${escopo.tenantId} and m.conversa_id = any(${[...conversaIds]}::uuid[])
            and m.criado_em > coalesce(l.lido_ate, '-infinity'::timestamptz) and ${nova()}
        ) r
        -- NOD-114 (revisão 2): a origem da raiz da retomada (a mesma cadeia de mensagens.repo.ts, ADR-099), para o "terminou"
        -- da conversa que a pessoa aprovou e deixou rodando. Roda depois do corte: só nas poucas linhas que saem.
        left join lateral (
          with recursive c(id, origem, retoma, n) as (
            select null::uuid, r.origem::origem_turno, r.retoma, 0 where r.origem = 'retomada'
            union all
            select p.id, p.origem, p.retoma_turno_id, c.n + 1 from c join turnos p on p.tenant_id = ${escopo.tenantId} and p.id = c.retoma
            where c.origem = 'retomada' and c.n < 10
          ) select c.id as raiz_id, c.origem as raiz_origem from c where c.n > 0 order by c.n desc limit 1
        ) rz on true
        where r.recente <= ${por} or r.ordem = 1 or (r.avisa and r.recente_do_tipo <= ${AVISOS_FORA_DA_JANELA})
        order by r.conversa_id, r.criado_em, r.id`;
      for (const l of linhas) {
        // NOD-114: a origem, a task e o fim do turno de cada uma, para o aviso do navegador e do desktop escolher o tipo e o alvo.
        const m: Mensagem = { ...paraMensagem(l), origemTurno: l.origem, trabalhoId: l.trabalho_id, fimDoTurno: l.fim_do_turno === true, ...(l.raiz_id && l.raiz_origem ? { raiz: { turnoId: l.raiz_id, origem: l.raiz_origem } } : {}) };
        const atual = saida.get(m.conversaId) ?? { primeira: m, ultimas: [], avisos: [], daRotina: false };
        if (l.recente <= por) atual.ultimas.push(m);
        else if (l.avisa) atual.avisos.push(m);
        if (l.origem === "rotina") atual.daRotina = true;
        saida.set(m.conversaId, atual);
      }
      return saida;
    },

    /**
     * Lida até a última mensagem da conversa. Nunca anda para trás (duas abas, um clique atrasado).
     * NOD-449: devolve o "lido até" de antes e o de depois (texto exato em µs, UTC; null = sem leitura), a chave do
     * Desfazer: os dois saem do mesmo instantâneo (CTE), então o antes é o valor que o upsert substituiu.
     */
    async marcarLida(conversaId: string): Promise<LeituraMarcada> {
      const [l] = await conn<{ antes: string | null; depois: string | null }[]>`
        with antes as (
          select lido_ate from leituras where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and conversa_id = ${conversaId}
        ), feito as (
          insert into leituras (tenant_id, owner_id, conversa_id, lido_ate)
          values (${escopo.tenantId}, ${escopo.pessoaId}, ${conversaId}, coalesce(
            (select max(criado_em) from mensagens where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId}), clock_timestamp()))
          on conflict (tenant_id, owner_id, conversa_id)
          do update set lido_ate = greatest(leituras.lido_ate, excluded.lido_ate), atualizado_em = clock_timestamp()
          returning lido_ate
        )
        select ${textoUtc(conn, "(select lido_ate from antes)")} as antes, ${textoUtc(conn, "feito.lido_ate")} as depois from feito`;
      return { conversaId, antes: l?.antes ?? null, depois: l?.depois ?? null };
    },

    /**
     * NOD-449: o Desfazer de um "marcar como lido". Volta o "lido até" ao `antes` só se ele ainda é o `depois` que a marcação
     * gravou: se a pessoa leu a conversa de novo (outra aba, abriu a conversa), o Desfazer não reabre essa leitura. `antes`
     * null = a conversa não tinha leitura (tudo novo, '-infinity'). Devolve quantas mudaram. Os instantes vão como text[] de
   * propósito: com o parâmetro tipado como timestamp, o driver o serializa por Date e corta os microssegundos (a
   * comparação nunca bateria).
     */
    async restaurarLeituras(ls: readonly LeituraMarcada[]): Promise<number> {
      // Um UPDATE só para o lote (revisão 3 e CI do PR #616: uma query por leitura deixava o Desfazer de 5000 leituras em
      // ~10 mil idas ao banco). Quem chama já tirou as conversas repetidas: com duas linhas para a mesma leitura, o
      // UPDATE … FROM aplicaria uma qualquer.
      const validas = ls.filter((l) => l.depois !== null);
      if (!validas.length) return 0;
      const r = await conn`
        update leituras set lido_ate = case when u.antes is null then '-infinity'::timestamptz else (u.antes::timestamp at time zone 'UTC') end, atualizado_em = clock_timestamp()
        from unnest(${validas.map((l) => l.conversaId)}::uuid[], ${validas.map((l) => l.antes)}::text[], ${validas.map((l) => l.depois)}::text[]) as u(conversa_id, antes, depois)
        where leituras.tenant_id = ${escopo.tenantId} and leituras.owner_id = ${escopo.pessoaId} and leituras.conversa_id = u.conversa_id
          and leituras.lido_ate = (u.depois::timestamp at time zone 'UTC')`;
      return r.count;
    },

    /**
     * "Marcar como não lido": a última fala de quem não é a pessoa volta a ser nova (a linha "Novas" fica acima
     * dela). Sem fala nenhuma na conversa, não há o que marcar: devolve false.
     */
    async marcarNaoLida(conversaId: string): Promise<boolean> {
      // Só reabre o que está lido de fato (lido até ≥ a última fala nova). Sem leitura, ou já com fala depois do "lido
      // até", a conversa já está em Não lidos: mexer aqui baixaria a contagem (2 novas virariam 1). QA do PR #616.
      const r = await conn`
        update leituras l set lido_ate = u.ultima - interval '1 microsecond', atualizado_em = clock_timestamp()
        from (select max(m.criado_em) as ultima from mensagens m
              where m.tenant_id = ${escopo.tenantId} and m.conversa_id = ${conversaId} and ${nova()}) u
        where l.tenant_id = ${escopo.tenantId} and l.owner_id = ${escopo.pessoaId} and l.conversa_id = ${conversaId}
          and u.ultima is not null and l.lido_ate >= u.ultima`;
      return r.count === 1;
    },
  };
}
