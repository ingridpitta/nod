import type { Visibilidade } from "../contracts/agente.ts";
import type { EstadoOrcamento, MembroSala, PoliticaSala, Sala } from "../contracts/sala.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  visibility: Visibilidade;
  nome: string;
  conversa_id: string;
  politica: PoliticaSala;
  lead_agente_id: string | null;
  orcamento: EstadoOrcamento;
  criado_em: Date;
}

interface LinhaMembro {
  tenant_id: string;
  sala_id: string;
  agente_id: string;
  pessoa_leitora_id: string;
  log_inteiro: boolean;
  removido_em: Date | null;
}

const COLUNAS = "tenant_id, id, owner_id, visibility, nome, conversa_id, politica, lead_agente_id, orcamento, criado_em";

const paraSala = (l: Linha): Sala => ({
  tenantId: l.tenant_id,
  id: l.id,
  ownerId: l.owner_id,
  visibility: l.visibility,
  nome: l.nome,
  conversaId: l.conversa_id,
  politica: l.politica,
  leadAgenteId: l.lead_agente_id,
  orcamento: l.orcamento,
  criadoEm: ms(l.criado_em),
});

const paraMembro = (l: LinhaMembro): MembroSala => ({
  tenantId: l.tenant_id,
  salaId: l.sala_id,
  agenteId: l.agente_id,
  pessoaLeitoraId: l.pessoa_leitora_id,
  logInteiro: true,
  removidoEm: msOuNull(l.removido_em),
});

export type NovaSala = {
  id?: string;
  nome: string;
  conversaId: string;
  politica?: PoliticaSala;
  leadAgenteId?: string | null;
  orcamento?: EstadoOrcamento;
};

export type NovoMembro = { agenteId: string; pessoaLeitoraId: string };

/**
 * Salas de 2 a 6 bots (ADR-027): membership é grant explícito de leitura ao dono do bot, inserido
 * na MESMA tx da criação/convite (criarComMembros). O tamanho é regra do caso de uso (sala_tamanho).
 * Sala e conversa da sala se referenciam (FK cíclica DEFERRABLE INITIALLY DEFERRED na 0002): quem
 * chama gera o id da sala com randomUUID, cria a conversa tipo 'sala' com ele e depois a sala, na
 * mesma tx, em qualquer ordem.
 */
export function salasRepo(conn: Conn, escopo: Escopo) {
  async function inserirMembro(salaId: string, m: NovoMembro): Promise<MembroSala | null> {
    const [l] = await conn<LinhaMembro[]>`
      insert into sala_membros (tenant_id, owner_id, sala_id, agente_id, pessoa_leitora_id)
      values (${escopo.tenantId}, ${escopo.pessoaId}, ${salaId}, ${m.agenteId}, ${m.pessoaLeitoraId})
      on conflict (tenant_id, sala_id, agente_id) do update set removido_em = null, pessoa_leitora_id = excluded.pessoa_leitora_id
      returning tenant_id, sala_id, agente_id, pessoa_leitora_id, log_inteiro, removido_em`;
    return l ? paraMembro(l) : null;
  }

  return {
    async criarComMembros(s: NovaSala, membros: readonly NovoMembro[]): Promise<{ sala: Sala; membros: MembroSala[] } | null> {
      const [l] = await conn<Linha[]>`
        insert into salas (tenant_id, id, owner_id, nome, conversa_id, politica, lead_agente_id, orcamento)
        values (${escopo.tenantId}, ${s.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${s.nome}, ${s.conversaId}, ${s.politica ?? "lead"},
          ${s.leadAgenteId ?? null}, ${s.orcamento ? conn.json(s.orcamento) : conn`default`})
        returning ${conn.unsafe(COLUNAS)}`;
      if (!l) return null;
      const sala = paraSala(l);
      const criados: MembroSala[] = [];
      for (const m of membros) {
        const membro = await inserirMembro(sala.id, m);
        if (membro) criados.push(membro);
      }
      return { sala, membros: criados };
    },

    async buscar(id: string): Promise<Sala | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from salas where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraSala(l) : null;
    },

    async buscarPorConversa(conversaId: string): Promise<Sala | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from salas where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId}`;
      return l ? paraSala(l) : null;
    },

    /** O que a pessoa vê: as suas e as onde tem grant (perna extra da policy). */
    async listar(): Promise<Sala[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from salas where tenant_id = ${escopo.tenantId} order by criado_em`;
      return linhas.map(paraSala);
    },

    /** Membros ativos (removido_em IS NULL). */
    async membros(salaId: string): Promise<MembroSala[]> {
      const linhas = await conn<LinhaMembro[]>`
        select tenant_id, sala_id, agente_id, pessoa_leitora_id, log_inteiro, removido_em from sala_membros
        where tenant_id = ${escopo.tenantId} and sala_id = ${salaId} and removido_em is null order by criado_em`;
      return linhas.map(paraMembro);
    },

    async adicionarMembro(salaId: string, m: NovoMembro): Promise<MembroSala | null> {
      return inserirMembro(salaId, m);
    },

    async removerMembro(salaId: string, agenteId: string, agora: number): Promise<boolean> {
      const r = await conn`
        update sala_membros set removido_em = ${data(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and sala_id = ${salaId} and agente_id = ${agenteId} and removido_em is null`;
      return r.count === 1;
    },

    /** Orçamento persistido na SALA, na mesma tx do post (GRUPO.orcamento-sala). */
    async atualizarOrcamento(id: string, orcamento: EstadoOrcamento): Promise<boolean> {
      const r = await conn`update salas set orcamento = ${conn.json(orcamento)} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    async atualizarPolitica(id: string, p: { politica?: PoliticaSala; leadAgenteId?: string | null }): Promise<Sala | null> {
      const [l] = await conn<Linha[]>`
        update salas set politica = coalesce(${p.politica ?? null}, politica),
          lead_agente_id = case when ${p.leadAgenteId === undefined} then lead_agente_id else ${p.leadAgenteId ?? null}::uuid end
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraSala(l) : null;
    },
  };
}
