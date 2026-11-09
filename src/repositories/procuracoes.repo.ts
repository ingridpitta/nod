import type { Procuracao } from "../contracts/concessao.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  agente_concedente_id: string;
  agente_beneficiario_id: string;
  classes_permitidas: string[];
  teto_diario: number;
  criado_em: Date;
}

const COLUNAS = "tenant_id, id, owner_id, agente_concedente_id, agente_beneficiario_id, classes_permitidas, teto_diario, criado_em";

const paraProcuracao = (l: Linha): Procuracao => ({
  tenantId: l.tenant_id,
  id: l.id,
  ownerId: l.owner_id,
  agenteConcedenteId: l.agente_concedente_id,
  agenteBeneficiarioId: l.agente_beneficiario_id,
  classesPermitidas: l.classes_permitidas,
  tetoDiario: l.teto_diario,
  criadoEm: ms(l.criado_em),
});

export type NovaProcuracao = { id?: string; agenteConcedenteId: string; agenteBeneficiarioId: string; classesPermitidas: string[]; tetoDiario: number };

/** Procuração entre agentes de donos diferentes (ADR-025): sem rota nesta rodada; autorizarDelegacao é fail-closed. */
export function procuracoesRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(p: NovaProcuracao): Promise<Procuracao | null> {
      const [l] = await conn<Linha[]>`
        insert into procuracoes (tenant_id, id, owner_id, agente_concedente_id, agente_beneficiario_id, classes_permitidas, teto_diario)
        values (${escopo.tenantId}, ${p.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${p.agenteConcedenteId}, ${p.agenteBeneficiarioId},
          ${p.classesPermitidas}::text[], ${p.tetoDiario})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraProcuracao(l) : null;
    },

    async listarDoBeneficiario(agenteBeneficiarioId: string): Promise<Procuracao[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from procuracoes where tenant_id = ${escopo.tenantId} and agente_beneficiario_id = ${agenteBeneficiarioId} order by criado_em`;
      return linhas.map(paraProcuracao);
    },
  };
}
