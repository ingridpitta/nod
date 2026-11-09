import type { LinhaTrilha } from "../db/schema/trilha.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { MOTIVOS_DE_CONECTOR_FORA, MOTIVOS_FORA_DA_DECISAO } from "../domain/decisoes.ts";
import { data, iso } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  agente_id: string;
  turno_id: string | null;
  conector_id: string | null;
  ferramenta: string;
  kind: string;
  motivo: string | null;
  regra: string;
  regra_versao: number;
  em: Date;
}

/**
 * definido em 2026-10-29 (NOD-70): o recorte da decisão de autorização, igual a `ehDecisao` (src/domain/decisoes.ts).
 * O predicado é o MESMO do índice parcial 0128 (um teste compara os dois): mudar aqui exige migração nova do índice.
 * Texto fixo, só com os enums de MOTIVOS_FORA_DA_DECISAO (^[a-z_]+$), sem valor de fora.
 */
export const FILTRO_DECISAO =
  "kind in ('tool_call', 'negacao', 'cartao') and (conector_id is not null or regra <> 'regra:chamar_ferramenta') and coalesce(motivo, '') not in (" +
  MOTIVOS_FORA_DA_DECISAO.map((m) => `'${m}'`).join(", ") +
  ")";

const COLUNAS = "tenant_id, id, owner_id, agente_id, turno_id, conector_id, ferramenta, kind, motivo, regra, regra_versao, em";

const paraLinha = (l: Linha): LinhaTrilha => ({
  tenantId: l.tenant_id,
  id: l.id,
  ownerId: l.owner_id,
  agenteId: l.agente_id,
  turnoId: l.turno_id,
  conectorId: l.conector_id,
  ferramenta: l.ferramenta,
  kind: l.kind,
  motivo: l.motivo,
  regra: l.regra,
  regraVersao: l.regra_versao,
  em: iso(l.em),
});

export type NovaLinhaTrilha = {
  agenteId: string;
  turnoId?: string | null;
  conectorId?: string | null;
  ferramenta: string;
  /** ^[a-z0-9_]+$ (CHECK trilha_sem_texto_livre): 'tool_call', 'negacao', 'aprovacao_executada'… */
  kind: string;
  /** ^[a-z_]+$ ou null: os motivos de src/contracts/motivos.ts. */
  motivo?: string | null;
  /** ^[a-z0-9_:]+$: 'regra:montagem-ferramentas' NÃO passa (hífen); use 'regra:montagem_ferramentas'. */
  regra: string;
  regraVersao: number;
  em?: number;
};

/** Trilha imutável (ADR-004): só INSERT para nod_app; texto livre é recusado pelo CHECK, prosa vai em trilha_prosa. */
export function trilhaRepo(conn: Conn, escopo: Escopo) {
  return {
    async registrar(t: NovaLinhaTrilha): Promise<LinhaTrilha | null> {
      const [l] = await conn<Linha[]>`
        insert into trilha (tenant_id, owner_id, agente_id, turno_id, conector_id, ferramenta, kind, motivo, regra, regra_versao, em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${t.agenteId}, ${t.turnoId ?? null}, ${t.conectorId ?? null}, ${t.ferramenta}, ${t.kind},
          ${t.motivo ?? null}, ${t.regra}, ${t.regraVersao}, ${t.em === undefined ? conn`now()` : data(t.em)})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraLinha(l) : null;
    },

    /** As linhas de UM turno, na ordem em que aconteceram (ADR-047: o turno leu conteúdo de fora?). */
    async doTurno(turnoId: string): Promise<LinhaTrilha[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trilha where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} order by em, id`;
      return linhas.map(paraLinha);
    },

    /** As linhas de vários turnos de uma vez (a conversa inteira, na delegação com sessão retomada). */
    async doTurnos(turnoIds: readonly string[]): Promise<LinhaTrilha[]> {
      if (turnoIds.length === 0) return [];
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trilha where tenant_id = ${escopo.tenantId} and turno_id = any(${[...turnoIds]}::uuid[]) order by em, id`;
      return linhas.map(paraLinha);
    },

    /**
     * definido em 2026-10-26 (NOD-374): os bots que tiveram negação daquele app desde `desde` — a recuperação automática vai
     * à trilha de cada um (agente_id é NOT NULL). Usa o índice parcial das negações.
     */
    async agentesComNegacaoDoConector(conectorId: string, desde: number): Promise<string[]> {
      const linhas = await conn<{ agente_id: string }[]>`
        select distinct t.agente_id from agentes a
        join trilha t on t.tenant_id = a.tenant_id and t.agente_id = a.id and t.kind = 'negacao' and t.em >= ${data(desde)}
          and t.motivo = any(${[...MOTIVOS_DE_CONECTOR_FORA]}::text[])
        where a.tenant_id = ${escopo.tenantId} and a.owner_id = ${escopo.pessoaId} and t.owner_id = ${escopo.pessoaId} and t.conector_id = ${conectorId}
        order by t.agente_id limit 50`;
      return linhas.map((l) => l.agente_id);
    },

    /**
     * definido em 2026-10-29 (NOD-70): as decisões de autorização de UM bot em [desde, ate), as mais novas primeiro.
     * Decisão = tool_call, negacao ou cartao; a chamada de ferramenta do próprio nod (sem conector, regra legada) não
     * entra. `cursor` é o id da última linha da página anterior: a comparação (em, id) é feita no banco, sem perder os
     * microssegundos. Devolve até `limite` linhas (quem chama pede limite+1 para saber se há próxima). Índice 0128.
     */
    async decisoesDoAgente(f: { agenteId: string; desde: number; ate: number; kinds: readonly string[]; cursor?: string | null; limite: number }): Promise<LinhaTrilha[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trilha
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${f.agenteId}
          and em >= ${data(f.desde)} and em < ${data(f.ate)}
          and ${conn.unsafe(FILTRO_DECISAO)} and kind = any(${[...f.kinds]}::text[])
          ${f.cursor ? conn`and (em, id) < (select c.em, c.id from trilha c where c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId} and c.agente_id = ${f.agenteId} and c.id = ${f.cursor})` : conn``}
        order by em desc, id desc limit ${f.limite}`;
      return linhas.map(paraLinha);
    },

    /** As contagens por kind das decisões do bot no período (os chips "Permitidas · Negadas · Cartões"). */
    async contarDecisoesDoAgente(f: { agenteId: string; desde: number; ate: number }): Promise<Record<string, number>> {
      const linhas = await conn<{ kind: string; n: number }[]>`
        select kind, count(*)::int as n from trilha
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${f.agenteId}
          and em >= ${data(f.desde)} and em < ${data(f.ate)}
          and ${conn.unsafe(FILTRO_DECISAO)}
        group by kind`;
      return Object.fromEntries(linhas.map((l) => [l.kind, l.n]));
    },

    /** Há alguma decisão do bot antes de `antes`? ("Dia anterior" e a primeira vez da aba Decisões; índice 0128.) */
    async temDecisaoAntes(f: { agenteId: string; antes: number }): Promise<boolean> {
      const [l] = await conn<{ um: number }[]>`
        select 1 as um from trilha
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${f.agenteId}
          and em < ${data(f.antes)} and ${conn.unsafe(FILTRO_DECISAO)}
        limit 1`;
      return !!l;
    },

    /**
     * GET trilha?dia&agente&conector (E8.4). `dia` é 'AAAA-MM-DD' no fuso dado (default UTC):
     * a comparação é feita no banco com a coluna em timestamptz.
     */
    async filtrar(f: { dia?: string; agenteId?: string; conectorId?: string; fuso?: string; limite?: number } = {}): Promise<LinhaTrilha[]> {
      const fuso = f.fuso ?? "UTC";
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trilha
        where tenant_id = ${escopo.tenantId}
          ${f.dia ? conn`and (em at time zone ${fuso})::date = ${f.dia}::date` : conn``}
          ${f.agenteId ? conn`and agente_id = ${f.agenteId}` : conn``}
          ${f.conectorId ? conn`and conector_id = ${f.conectorId}` : conn``}
        order by em desc, id desc limit ${f.limite ?? 500}`;
      return linhas.map(paraLinha);
    },
  };
}
