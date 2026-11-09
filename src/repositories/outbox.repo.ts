import type { Conn, Escopo } from "../shared/types.ts";

export interface ItemOutbox {
  id: string;
  eventoId: string;
  tipo: string;
  dados: Record<string, unknown>;
  tentativas: number;
  criadoEm: string;
  /** Do evento (LEFT JOIN em events): a web sabe QUAL conversa/turno o frame toca (definido em 2026-09-16, L9). */
  conversaId: string | null;
  turnoId: string | null;
}

interface Linha {
  id: string;
  evento_id: string;
  tipo: string;
  dados: Record<string, unknown>;
  tentativas: number;
  criado_em: string;
  conversa_id: string | null;
  turno_id: string | null;
}

export function outboxRepo(conn: Conn, escopo: Escopo) {
  return {
    async pendentes(limite = 100): Promise<ItemOutbox[]> {
      const linhas = await conn<Linha[]>`
        select o.id, o.evento_id, o.tipo, o.dados, o.tentativas, o.criado_em, e.conversa_id, e.turno_id
        from events_outbox o
        left join events e on e.tenant_id = o.tenant_id and e.id = o.evento_id
        where o.tenant_id = ${escopo.tenantId} and o.owner_id = ${escopo.pessoaId}
          and o.entregue_em is null and o.abandonado_em is null and o.cancelado_em is null
        order by o.criado_em limit ${limite}`;
      return linhas.map((l) => ({ id: l.id, eventoId: l.evento_id, tipo: l.tipo, dados: l.dados, tentativas: l.tentativas, criadoEm: l.criado_em, conversaId: l.conversa_id, turnoId: l.turno_id }));
    },

    /**
     * NOD-218 (despachante "só ligações" da drenagem azul/verde): os pendentes E os que outro processo entregou desde
     * `desde` (hora do banco), menos os ids já publicados aqui. A cor ativa marca entregue logo que a linha nasce (o
     * despertador do outbox é do processo que grava); só com `pendentes()` a ligação viva na cor velha perderia a
     * corrida e nunca veria a decisão nem o fim da tarefa.
     */
    async paraPublicar(p: { desde: Date; excluir: readonly string[]; limite?: number }): Promise<ItemOutbox[]> {
      const linhas = await conn<Linha[]>`
        select o.id, o.evento_id, o.tipo, o.dados, o.tentativas, o.criado_em, e.conversa_id, e.turno_id
        from events_outbox o
        left join events e on e.tenant_id = o.tenant_id and e.id = o.evento_id
        where o.tenant_id = ${escopo.tenantId} and o.owner_id = ${escopo.pessoaId}
          and (o.entregue_em is null or o.entregue_em >= ${p.desde}) and o.abandonado_em is null and o.cancelado_em is null
          and o.id <> all(${[...p.excluir]}::uuid[])
        order by o.criado_em limit ${p.limite ?? 100}`;
      return linhas.map((l) => ({ id: l.id, eventoId: l.evento_id, tipo: l.tipo, dados: l.dados, tentativas: l.tentativas, criadoEm: l.criado_em, conversaId: l.conversa_id, turnoId: l.turno_id }));
    },

    async marcarEntregue(id: string): Promise<boolean> {
      const r = await conn`update events_outbox set entregue_em = now() where tenant_id = ${escopo.tenantId} and id = ${id} and entregue_em is null`;
      return r.count === 1;
    },

    async incrementarTentativa(id: string): Promise<number | null> {
      const [l] = await conn<{ tentativas: number }[]>`
        update events_outbox set tentativas = tentativas + 1 where tenant_id = ${escopo.tenantId} and id = ${id} returning tentativas`;
      return l?.tentativas ?? null;
    },

    /**
     * Abandona só com as DUAS condições (Práticas §7): tentativas >= teto E criado_em < agora - idadeMin.
     * Só o teto esvaziaria a fila numa queda curta; só a idade nunca abandonaria a linha envenenada.
     * Devolve quantas linhas abandonou; elas ficam na tabela para serem contadas (métrica outbox_abandonados).
     */
    async abandonar(p: { teto: number; idadeMinMs: number; agora: number }): Promise<number> {
      const agora = new Date(p.agora);
      const limite = new Date(p.agora - p.idadeMinMs);
      const r = await conn`
        update events_outbox set abandonado_em = ${agora}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
          and entregue_em is null and abandonado_em is null and cancelado_em is null
          and tentativas >= ${p.teto} and criado_em < ${limite}`;
      return r.count;
    },

    async contarAbandonados(): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from events_outbox where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and abandonado_em is not null`;
      return l?.n ?? 0;
    },

    /**
     * Parar (E5.4): frames ainda não entregues da pessoa deixam de sair. Com `conversaId` (NOD-265), só os da conversa
     * parada — o outbox não guarda a conversa, ela vem do evento (mesmo join de `pendentes()`); frame cujo evento não
     * tem conversa não é cancelado. Sem conversa ("Parar tudo"), todos da pessoa.
     */
    async cancelarPendentesDaPessoa(agora: number, conversaId: string | null = null, opcoes: { soDoChat?: true } = {}): Promise<number> {
      const daConversa = conversaId === null
        ? conn``
        : conn`and exists (select 1 from events e where e.tenant_id = o.tenant_id and e.id = o.evento_id and e.conversa_id = ${conversaId})`;
      // definido em 2026-10-22 (NOD-311): o Parar do chat não cancela o que é das frentes — nem o frame `trabalho_mudou`
      // nem o de evento de turno de trabalho; os delas seguem saindo.
      const soDoChat = opcoes.soDoChat
        ? conn`and o.tipo <> 'trabalho_mudou' and not exists (
            select 1 from events e2 join turnos t on t.tenant_id = e2.tenant_id and t.id = e2.turno_id
            where e2.tenant_id = o.tenant_id and e2.id = o.evento_id and t.trabalho_id is not null)`
        : conn``;
      const r = await conn`
        update events_outbox o set cancelado_em = ${new Date(agora)}
        where o.tenant_id = ${escopo.tenantId} and o.owner_id = ${escopo.pessoaId}
          and o.entregue_em is null and o.abandonado_em is null and o.cancelado_em is null ${daConversa} ${soDoChat}`;
      return r.count;
    },
  };
}
