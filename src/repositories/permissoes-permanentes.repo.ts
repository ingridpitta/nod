import type { PermissaoPermanente } from "../contracts/permissao-permanente.ts";
import type { MotivoInatividadePermissao } from "../contracts/motivos.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { dataOuNull, ms, msOuNull } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  agente_id: string;
  conector_id: string;
  capacidade: string;
  item_origem_id: string;
  mensagem_id: string;
  regra_versao: number;
  criado_em: Date;
  inativo_em: Date | null;
  inativo_motivo: MotivoInatividadePermissao | null;
}

const COLUNAS =
  "tenant_id, id, owner_id, agente_id, conector_id, capacidade, item_origem_id, mensagem_id, regra_versao, criado_em, inativo_em, inativo_motivo";

const paraPermissao = (l: Linha): PermissaoPermanente => ({
  tenantId: l.tenant_id,
  id: l.id,
  ownerId: l.owner_id,
  agenteId: l.agente_id,
  conectorId: l.conector_id,
  capacidade: l.capacidade,
  itemOrigemId: l.item_origem_id,
  mensagemId: l.mensagem_id,
  regraVersao: l.regra_versao,
  criadoEm: ms(l.criado_em),
  inativoEm: msOuNull(l.inativo_em),
  inativoMotivo: l.inativo_motivo,
});

export type NovaPermissaoPermanente = {
  id?: string;
  agenteId: string;
  conectorId: string;
  capacidade: string;
  itemOrigemId: string;
  mensagemId: string;
  regraVersao: number;
};

/**
 * "Sempre permitir isto" (ADR-042). Separada de `concessoes`: aquela alimenta o CATÁLOGO do plano,
 * esta a EXECUÇÃO. Revogação aqui é MARCA (`inativo_em` + motivo tipado), nunca DELETE — uma
 * permissão de efeito externo que some sem rastro é o oposto do que o produto vende.
 */
export function permissoesPermanentesRepo(conn: Conn, escopo: Escopo) {
  return {
    /** null quando já existe regra ATIVA para a mesma chave: clicar duas vezes não duplica. */
    async criar(p: NovaPermissaoPermanente): Promise<PermissaoPermanente | null> {
      const [l] = await conn<Linha[]>`
        insert into permissoes_permanentes (tenant_id, id, owner_id, agente_id, conector_id, capacidade, item_origem_id, mensagem_id, regra_versao)
        values (${escopo.tenantId}, ${p.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${p.agenteId}, ${p.conectorId}, ${p.capacidade}, ${p.itemOrigemId}, ${p.mensagemId}, ${p.regraVersao})
        on conflict do nothing
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraPermissao(l) : null;
    },

    /**
     * Insumo do plano de turno (emitir-plano-turno.ts): só as ATIVAS, e o domínio ainda cruza com o
     * catálogo — a regra nunca amplia alcance, só evita a pergunta.
     */
    async ativasDoAgente(agenteId: string): Promise<PermissaoPermanente[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from permissoes_permanentes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${agenteId} and inativo_em is null
        order by criado_em`;
      return linhas.map(paraPermissao);
    },

    /** Listagem da tela: inativa NUNCA some, aparece com o motivo de ter parado de valer. */
    async listar(agenteId?: string): Promise<PermissaoPermanente[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from permissoes_permanentes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
          ${agenteId ? conn`and agente_id = ${agenteId}` : conn``}
        order by inativo_em nulls first, criado_em desc`;
      return linhas.map(paraPermissao);
    },

    async buscar(id: string): Promise<PermissaoPermanente | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from permissoes_permanentes where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraPermissao(l) : null;
    },

    /**
     * definido em 2026-09-24 (ADR-048): o mesmo "Sempre permitir" sob o nome novo (Composio → GitHub
     * nativo, mesmo conector). A regra nova carrega o MESMO consentimento e o mesmo item de origem; a
     * antiga fica inativa com motivo, nunca some (ADR-042).
     */
    async migrarCapacidades(conectorId: string, mapa: Readonly<Record<string, string>>, agora: number): Promise<number> {
      const antigas = Object.keys(mapa);
      if (antigas.length === 0) return 0;
      const criadas = await conn`
        insert into permissoes_permanentes (tenant_id, owner_id, agente_id, conector_id, capacidade, item_origem_id, mensagem_id, regra_versao)
        select p.tenant_id, p.owner_id, p.agente_id, p.conector_id, m.nova, p.item_origem_id, p.mensagem_id, p.regra_versao
        from permissoes_permanentes p join unnest(${antigas}::text[], ${antigas.map((a) => mapa[a] ?? a)}::text[]) as m(antiga, nova) on m.antiga = p.capacidade
        where p.tenant_id = ${escopo.tenantId} and p.owner_id = ${escopo.pessoaId} and p.conector_id = ${conectorId} and p.inativo_em is null
        on conflict do nothing`;
      await conn`
        update permissoes_permanentes set inativo_em = ${dataOuNull(agora)}, inativo_motivo = 'capacidade_fora_do_catalogo'
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and conector_id = ${conectorId} and inativo_em is null and capacidade = any(${antigas}::text[])`;
      return criadas.count;
    },

    /** Marca UMA regra como inativa. Só a dona; segunda chamada devolve false (idempotência na rota). */
    async desativar(id: string, motivo: MotivoInatividadePermissao, agora: number): Promise<boolean> {
      const r = await conn`
        update permissoes_permanentes set inativo_em = ${dataOuNull(agora)}, inativo_motivo = ${motivo}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and inativo_em is null`;
      return r.count === 1;
    },

    /**
     * Reconciliação (ADR-042 claim 7): o mundo mudou e a regra para de valer. Sem isto a permissão
     * dorme e acorda — revogar o acesso e reconceder meses depois traria a regra de volta viva, que
     * é escalada silenciosa. Não reativa nada: o precedente do ADR-034 é que estado permissivo não volta
     * sozinho (duplicar leva só as ATIVAS, por clique da dona e com consentimento novo).
     */
    async desativarPor(
      filtro: { agenteId?: string; conectorId?: string; capacidade?: string },
      motivo: MotivoInatividadePermissao,
      agora: number,
    ): Promise<number> {
      const r = await conn`
        update permissoes_permanentes set inativo_em = ${dataOuNull(agora)}, inativo_motivo = ${motivo}
        where tenant_id = ${escopo.tenantId} and inativo_em is null
          ${filtro.agenteId ? conn`and agente_id = ${filtro.agenteId}` : conn``}
          ${filtro.conectorId ? conn`and conector_id = ${filtro.conectorId}` : conn``}
          ${filtro.capacidade ? conn`and capacidade = ${filtro.capacidade}` : conn``}`;
      return r.count;
    },
  };
}
