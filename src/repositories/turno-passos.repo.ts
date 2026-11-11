import { PASSOS_POR_PAGINA, PASSOS_POR_TURNO_MAX, RESUMO_DO_PASSO_MAX, type PassoDoRun, type PassosDoRunDto } from "../contracts/quadro-comentarios.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

/** O que quem grava manda: o passo sem a ordem nem a hora (o banco dá os dois). */
export type NovoPasso = Omit<PassoDoRun, "seq" | "em">;

interface Linha {
  seq: string;
  raiz_id: string;
  tipo: PassoDoRun["tipo"];
  classe: PassoDoRun["classe"];
  ferramenta: string | null;
  rotulo: string;
  resumo: string | null;
  acao_id: string | null;
  falhou: boolean;
  criado_em: Date;
}

const COLUNAS = "seq, raiz_id, tipo, classe, ferramenta, rotulo, resumo, acao_id, falhou, criado_em";

function paraPasso(l: Linha): PassoDoRun {
  return { seq: Number(l.seq), tipo: l.tipo, classe: l.classe, ferramenta: l.ferramenta, rotulo: l.rotulo, resumo: l.resumo, acaoId: l.acao_id, falhou: l.falhou, em: ms(l.criado_em) };
}

/** Os tetos das colunas (0170): o repositório corta antes, o CHECK é a segunda camada. */
const corte = (v: string | null, max: number): string | null => (v === null ? null : Array.from(v).slice(0, max).join(""));

/**
 * Os passos do run (0170, ADR-165). Gravados pelo turno real (a retomada) e lidos pela raiz da cadeia (retoma_turno_id,
 * teto de 50 saltos contra ciclo, como turnos.raizDaCadeia): a tela lê por run = turno raiz. O resumo chega já redigido
 * (redigirResumo, no executor e de novo no compositor); aqui só se cortam os tamanhos.
 */
export function turnoPassosRepo(conn: Conn, escopo: Escopo) {
  /** A raiz da cadeia do turno, como CTE (`raiz(id)`); turno que a pessoa não vê não tem raiz. */
  const comRaiz = (turnoId: string) => conn`
    with recursive cadeia(id, retoma_turno_id, saltos) as (
      select id, retoma_turno_id, 0 from turnos where tenant_id = ${escopo.tenantId} and id = ${turnoId}
      union all
      select t.id, t.retoma_turno_id, c.saltos + 1 from turnos t join cadeia c on t.tenant_id = ${escopo.tenantId} and t.id = c.retoma_turno_id
      where c.saltos < 50
    ), raiz as (select id from cadeia order by saltos desc limit 1)`;

  return {
    /**
     * Grava os passos do turno `turnoId`, na ordem, e devolve-os com `seq` e `em`. Depois poda os mais antigos da raiz
     * além de PASSOS_POR_TURNO_MAX (o índice turno_passos_da_raiz anda só nos passos daquele run). Turno invisível: [].
     */
    async gravar(turnoId: string, passos: readonly NovoPasso[]): Promise<PassoDoRun[]> {
      if (passos.length === 0) return [];
      const col = <K extends keyof NovoPasso>(k: K) => passos.map((p) => p[k]);
      const ls = await conn<Linha[]>`
        ${comRaiz(turnoId)}
        insert into turno_passos (tenant_id, owner_id, raiz_id, turno_id, tipo, classe, ferramenta, rotulo, resumo, acao_id, falhou)
        select ${escopo.tenantId}, ${escopo.pessoaId}, raiz.id, ${turnoId}, u.tipo, u.classe, u.ferramenta, u.rotulo, u.resumo, u.acao_id, u.falhou
        from raiz, unnest(
          ${conn.array(col("tipo"))}::text[], ${conn.array(col("classe"))}::text[],
          ${conn.array(passos.map((p) => corte(p.ferramenta, 80)))}::text[], ${conn.array(passos.map((p) => corte(p.rotulo, 200) ?? ""))}::text[],
          ${conn.array(passos.map((p) => corte(p.resumo, RESUMO_DO_PASSO_MAX)))}::text[], ${conn.array(passos.map((p) => corte(p.acaoId, 200)))}::text[],
          ${conn.array(col("falhou"))}::boolean[]
        ) with ordinality as u(tipo, classe, ferramenta, rotulo, resumo, acao_id, falhou, ord)
        order by u.ord
        returning ${conn.unsafe(COLUNAS)}`;
      const raiz = ls[0]?.raiz_id;
      if (raiz) {
        await conn`
          delete from turno_passos where tenant_id = ${escopo.tenantId} and raiz_id = ${raiz}
            and seq <= (select seq from turno_passos where tenant_id = ${escopo.tenantId} and raiz_id = ${raiz} order by seq desc offset ${PASSOS_POR_TURNO_MAX} limit 1)`;
      }
      return ls.map(paraPasso).sort((a, b) => a.seq - b.seq);
    },

    /** O fim de uma chamada que falhou (`tool_result.isError`): marca o passo da ferramenta `acaoId` do turno. */
    async marcarFalha(turnoId: string, acaoId: string): Promise<boolean> {
      const r = await conn`
        ${comRaiz(turnoId)}
        update turno_passos set falhou = true
        where tenant_id = ${escopo.tenantId} and raiz_id = (select id from raiz) and turno_id = ${turnoId} and acao_id = ${acaoId} and not falhou`;
      return r.count > 0;
    },

    /** A página seguinte do run `raizId` (seq > `depois`), em ordem; `fim` = não há mais depois dela. */
    async daCadeia(raizId: string, depois: number | null, limite: number = PASSOS_POR_PAGINA): Promise<PassosDoRunDto> {
      const n = Math.max(1, Math.min(PASSOS_POR_PAGINA, Math.trunc(limite) || PASSOS_POR_PAGINA));
      const ls = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turno_passos
        where tenant_id = ${escopo.tenantId} and raiz_id = ${raizId} and seq > ${depois ?? 0}
        order by seq limit ${n + 1}`;
      return { passos: ls.slice(0, n).map(paraPasso), fim: ls.length <= n };
    },

    /** Quantos passos cada run tem e o último (RunDaTarefa.nPassos/ultimoPasso). Run sem passo: n 0, último null. */
    async resumo(raizes: readonly string[]): Promise<Map<string, { n: number; ultimo: PassoDoRun | null }>> {
      const saida = new Map<string, { n: number; ultimo: PassoDoRun | null }>(raizes.map((r) => [r, { n: 0, ultimo: null }]));
      if (raizes.length === 0) return saida;
      const ids = conn.array([...new Set(raizes)]);
      const [contas, ultimos] = await Promise.all([
        conn<{ raiz_id: string; n: number }[]>`select raiz_id, count(*)::int as n from turno_passos where tenant_id = ${escopo.tenantId} and raiz_id = any(${ids}::uuid[]) group by raiz_id`,
        conn<Linha[]>`select distinct on (raiz_id) ${conn.unsafe(COLUNAS)} from turno_passos where tenant_id = ${escopo.tenantId} and raiz_id = any(${ids}::uuid[]) order by raiz_id, seq desc`,
      ]);
      const ultimoDe = new Map(ultimos.map((l) => [l.raiz_id, paraPasso(l)]));
      for (const c of contas) saida.set(c.raiz_id, { n: c.n, ultimo: ultimoDe.get(c.raiz_id) ?? null });
      return saida;
    },

    /** Retenção (0170, ADR-165): a dona apaga os próprios passos mais velhos que `antesDe`. Devolve quantos. */
    async podar(antesDe: number): Promise<number> {
      const r = await conn`delete from turno_passos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and criado_em < ${data(antesDe)}`;
      return r.count;
    },
  };
}
