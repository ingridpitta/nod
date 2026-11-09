import type { Visibilidade } from "../contracts/agente.ts";
import type { Conversa, TipoConversa } from "../contracts/conversa.ts";
import type { Executor } from "../contracts/evento.ts";
import { HARNESSES, type IdHarness } from "../contracts/harness.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms, msOuNull } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  visibility: Visibilidade;
  tipo: TipoConversa;
  agente_id: string | null;
  sala_id: string | null;
  sessao_cli: string | null;
  sessao_executor: string | null;
  sessao_harness: string | null;
  sessao_em: Date | null;
  recomeco_em: Date | null;
  criado_em: Date;
}

const COLUNAS = "tenant_id, id, owner_id, visibility, tipo, agente_id, sala_id, sessao_cli, sessao_executor, sessao_harness, sessao_em, recomeco_em, criado_em";

const paraConversa = (l: Linha): Conversa => ({
  tenantId: l.tenant_id,
  id: l.id,
  ownerId: l.owner_id,
  visibility: l.visibility,
  tipo: l.tipo,
  agenteId: l.agente_id,
  salaId: l.sala_id,
  sessaoCli: l.sessao_cli,
  sessaoExecutor: l.sessao_executor === "local" || l.sessao_executor === "catcher" ? l.sessao_executor : null,
  sessaoHarness: HARNESSES.find((h) => h.id === l.sessao_harness)?.id ?? null,
  sessaoEm: msOuNull(l.sessao_em),
  recomecoEm: msOuNull(l.recomeco_em),
  criadoEm: ms(l.criado_em),
});

export type NovaConversa =
  | { id?: string; tipo: "propria"; agenteId: string; visibility?: Visibilidade }
  | { id?: string; tipo: "sala"; salaId: string; visibility?: Visibilidade };

/** Conversa própria do bot ou da sala. sessao_cli = session_id do `claude -p` (1º --session-id, depois --resume). */
export function conversasRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(c: NovaConversa): Promise<Conversa | null> {
      const agenteId = c.tipo === "propria" ? c.agenteId : null;
      const salaId = c.tipo === "sala" ? c.salaId : null;
      const [l] = await conn<Linha[]>`
        insert into conversas (tenant_id, id, owner_id, visibility, tipo, agente_id, sala_id)
        values (${escopo.tenantId}, ${c.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${c.visibility ?? "privado"}, ${c.tipo}, ${agenteId}, ${salaId})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraConversa(l) : null;
    },

    async buscar(id: string): Promise<Conversa | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from conversas where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraConversa(l) : null;
    },

    async buscarPropriaDoAgente(agenteId: string): Promise<Conversa | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from conversas where tenant_id = ${escopo.tenantId} and tipo = 'propria' and agente_id = ${agenteId}
        order by criado_em limit 1`;
      return l ? paraConversa(l) : null;
    },

    /** buscarPropriaDoAgente de vários agentes numa consulta (a frota, definido em 2026-09-30): agenteId → a conversa mais antiga. */
    async propriasDosAgentes(agenteIds: readonly string[]): Promise<Map<string, Conversa>> {
      if (agenteIds.length === 0) return new Map();
      const linhas = await conn<Linha[]>`
        select distinct on (agente_id) ${conn.unsafe(COLUNAS)} from conversas
        where tenant_id = ${escopo.tenantId} and tipo = 'propria' and agente_id = any(${[...agenteIds]}::uuid[])
        order by agente_id, criado_em`;
      return new Map(linhas.map((l) => [l.agente_id as string, paraConversa(l)]));
    },

    async buscarDaSala(salaId: string): Promise<Conversa | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from conversas where tenant_id = ${escopo.tenantId} and tipo = 'sala' and sala_id = ${salaId} order by criado_em limit 1`;
      return l ? paraConversa(l) : null;
    },

    async listar(): Promise<Conversa[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from conversas where tenant_id = ${escopo.tenantId} order by criado_em`;
      return linhas.map(paraConversa);
    },

    /**
     * Grava sessão, executor e harness juntos (0005, 0030): sessão sem dono não vale --resume. `sessao_em`
     * marca até onde a sessão viu a conversa; o que chegar depois entra no plano como "desde a sua última vez".
     */
    /** /nova-sessao (0038): sem sessão para retomar, e o histórico do prompt recomeça agora. */
    async recomecar(id: string): Promise<boolean> {
      const r = await conn`update conversas set sessao_cli = null, sessao_executor = null, sessao_harness = null, sessao_em = null, sessao_conta_id = null, sessao_maquina_id = null,
        recomeco_em = clock_timestamp() where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count > 0;
    },

    async atualizarSessaoCli(
      id: string, sessaoCli: string | null, sessaoExecutor: Executor | null = null, sessaoHarness: IdHarness | null = null, maquinaId: string | null = null,
    ): Promise<boolean> {
      // ADR-102 (R1): a conta da sessão é gravada por definirContaDaSessao logo depois; aqui volta a nenhuma.
      // ADR-107 (NOD-281): a máquina onde a sessão nasceu — no modo compartilhado só ela retoma.
      const r = await conn`update conversas set sessao_cli = ${sessaoCli}, sessao_executor = ${sessaoCli ? sessaoExecutor : null},
        sessao_harness = ${sessaoCli ? sessaoHarness : null}, sessao_em = ${sessaoCli ? conn`clock_timestamp()` : null}, sessao_conta_id = null,
        sessao_maquina_id = ${sessaoCli ? maquinaId : null}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /** ADR-102 (R1): a conta em que a sessão do CLI foi criada (a sessão do Codex mora na pasta da conta). */
    async definirContaDaSessao(id: string, contaId: string | null): Promise<void> {
      await conn`update conversas set sessao_conta_id = ${contaId} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },

    async contaDaSessao(id: string): Promise<string | null> {
      const [l] = await conn<{ sessao_conta_id: string | null }[]>`select sessao_conta_id from conversas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return l?.sessao_conta_id ?? null;
    },

    /** ADR-107 (NOD-281): a máquina em que a sessão do CLI foi criada (null = desconhecida, de antes da 0079). */
    async maquinaDaSessao(id: string): Promise<string | null> {
      const [l] = await conn<{ sessao_maquina_id: string | null }[]>`select sessao_maquina_id from conversas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return l?.sessao_maquina_id ?? null;
    },
  };
}
