import type { Concessao } from "../contracts/concessao.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  agente_id: string;
  conector_id: string;
  capacidade: string;
  mensagem_id: string;
  criado_em: Date;
}

const COLUNAS = "tenant_id, id, owner_id, agente_id, conector_id, capacidade, mensagem_id, criado_em";

const paraConcessao = (l: Linha): Concessao => ({
  tenantId: l.tenant_id,
  id: l.id,
  ownerId: l.owner_id,
  agenteId: l.agente_id,
  conectorId: l.conector_id,
  capacidade: l.capacidade,
  mensagemId: l.mensagem_id,
  criadoEm: ms(l.criado_em),
});

export type NovaConcessao = { id?: string; agenteId: string; conectorId: string; capacidade: string; mensagemId: string };

/**
 * Concessão por agente e por capacidade (E6, ADR-013). mensagem_id aponta para a mensagem de
 * consentimento imutável e citável; a concessão e a mensagem nascem na MESMA tx (caso de uso).
 */
export function concessoesRepo(conn: Conn, escopo: Escopo) {
  return {
    /** null quando a mesma (agente, conector, capacidade) já existe: conceder duas vezes não duplica. */
    async conceder(c: NovaConcessao): Promise<Concessao | null> {
      const [l] = await conn<Linha[]>`
        insert into concessoes (tenant_id, id, owner_id, agente_id, conector_id, capacidade, mensagem_id)
        values (${escopo.tenantId}, ${c.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${c.agenteId}, ${c.conectorId}, ${c.capacidade}, ${c.mensagemId})
        on conflict (tenant_id, agente_id, conector_id, capacidade) do nothing
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraConcessao(l) : null;
    },

    async buscar(id: string): Promise<Concessao | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from concessoes where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraConcessao(l) : null;
    },

    /** Insumo do plano de turno: conector ∩ concessão do agente (src/domain/plano-turno.ts). */
    async doAgente(agenteId: string): Promise<Concessao[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from concessoes where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} order by criado_em`;
      return linhas.map(paraConcessao);
    },

    /** Quantas concessões cada agente tem, numa consulta (a frota mostra só o número, definido em 2026-09-30). Agente sem nenhuma fica de fora. */
    async contarPorAgente(agenteIds: readonly string[]): Promise<Map<string, number>> {
      if (agenteIds.length === 0) return new Map();
      const linhas = await conn<{ agente_id: string; n: number }[]>`
        select agente_id, count(*)::int as n from concessoes
        where tenant_id = ${escopo.tenantId} and agente_id = any(${[...agenteIds]}::uuid[])
        group by agente_id`;
      return new Map(linhas.map((l) => [l.agente_id, l.n]));
    },

    /**
     * Trava (agente, conector) até o fim da tx (definido em 2026-09-24, emenda da ADR-044). O pré-voo da
     * rotina (lê concessões → abre ou reaproveita o card) e o clique que concede (decidir-acesso.ts)
     * passam aqui: sem a trava, o pré-voo lia "sem concessão", o clique commitava concessão + proposta
     * confirmada, e o pré-voo — sem ver mais proposta pendente — abria um card novo para um acesso já
     * dado. Advisory lock transacional, como agentes.excluir; a chave leva o tenant e o par.
     */
    async travar(agenteId: string, conectorId: string): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext(${`acesso:${agenteId}:${conectorId}`}))`;
    },

    /**
     * definido em 2026-09-24 (ADR-048): o conector trocou de nomes (Composio → GitHub nativo, mesmo id).
     * Cada concessão com nome antigo vira as capacidades novas COM A MESMA mensagem de consentimento
     * (é o mesmo acesso, dado pela mesma pessoa) e a linha antiga sai — ela nomeia o que não existe mais.
     */
    async migrarCapacidades(conectorId: string, mapa: Readonly<Record<string, readonly string[]>>): Promise<number> {
      const pares = Object.entries(mapa).flatMap(([antiga, novas]) => novas.map((nova) => [antiga, nova] as const));
      if (pares.length === 0) return 0;
      const criadas = await conn`
        insert into concessoes (tenant_id, owner_id, agente_id, conector_id, capacidade, mensagem_id)
        select c.tenant_id, ${escopo.pessoaId}, c.agente_id, c.conector_id, m.nova, c.mensagem_id
        from concessoes c join unnest(${pares.map((p) => p[0])}::text[], ${pares.map((p) => p[1])}::text[]) as m(antiga, nova) on m.antiga = c.capacidade
        where c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId} and c.conector_id = ${conectorId}
        on conflict (tenant_id, agente_id, conector_id, capacidade) do nothing`;
      await conn`delete from concessoes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and conector_id = ${conectorId} and capacidade = any(${Object.keys(mapa)}::text[])`;
      return criadas.count;
    },

    async revogar(id: string): Promise<boolean> {
      const r = await conn`delete from concessoes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },
  };
}
