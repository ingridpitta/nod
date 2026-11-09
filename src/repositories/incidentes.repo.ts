import type { Incidente, TipoIncidente } from "../contracts/incidente.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, dataOuNull, ms, msOuNull } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  tipo: TipoIncidente;
  machine_id: string | null;
  comecou_em: Date;
  voltou_em: Date | null;
  rotinas: number;
  conversas: number;
  agentes: string[];
  dispensado_em: Date | null;
  criado_em: Date;
}

const COLUNAS = "tenant_id, id, tipo, machine_id, comecou_em, voltou_em, rotinas, conversas, agentes, dispensado_em, criado_em";

const paraIncidente = (l: Linha): Incidente => ({
  tenantId: l.tenant_id,
  id: l.id,
  tipo: l.tipo,
  machineId: l.machine_id,
  comecouEm: ms(l.comecou_em),
  voltouEm: msOuNull(l.voltou_em),
  rotinas: l.rotinas,
  conversas: l.conversas,
  agentes: l.agentes,
  dispensadoEm: msOuNull(l.dispensado_em),
  criadoEm: ms(l.criado_em),
});

export type NovoIncidente = { tipo: TipoIncidente; machineId: string | null; comecouEm: number; voltouEm: number | null; rotinas: number; conversas: number; agentes: readonly string[] };
/** `voltouEm` null = a máquina desta queda ainda não voltou: o incidente fica (ou volta a ficar) em curso. */
export type MesclaIncidente = { comecouEm: number; voltouEm: number | null; rotinas: number; conversas: number; agentes: readonly string[] };

/**
 * Incidentes de infraestrutura por pessoa (ADR-045). Quem decide mesclar ou abrir é o caso de uso
 * (interromper-por-maquina.ts, com src/domain/incidente.ts); aqui só a trava e o SQL.
 */
export function incidentesRepo(conn: Conn, escopo: Escopo) {
  return {
    /**
     * Advisory lock POR PESSOA (precedente: agentesRepo.excluir) e o incidente mais recente daquele
     * tipo — o em curso primeiro. Duas transações que notam quedas ao mesmo tempo (varredor × entrega
     * tardia) se enfileiram aqui em vez de abrir dois; o índice único incidente_em_curso é a 2ª trava.
     */
    async travarUltimo(tipo: TipoIncidente): Promise<Incidente | null> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext(${`incidentes:${escopo.pessoaId}`}))`;
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from incidentes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and tipo = ${tipo}
        order by voltou_em desc nulls first, comecou_em desc limit 1
        for update`;
      return l ? paraIncidente(l) : null;
    },

    async abrir(n: NovoIncidente): Promise<Incidente | null> {
      const [l] = await conn<Linha[]>`
        insert into incidentes (tenant_id, owner_id, tipo, machine_id, comecou_em, voltou_em, rotinas, conversas, agentes)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${n.tipo}, ${n.machineId}, ${data(n.comecouEm)}, ${dataOuNull(n.voltouEm)}, ${n.rotinas}, ${n.conversas}, ${[...n.agentes]}::uuid[])
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraIncidente(l) : null;
    },

    /** Estica o intervalo, soma os contadores e junta os agentes (sem repetir). */
    async mesclar(id: string, m: MesclaIncidente): Promise<Incidente | null> {
      const voltou = dataOuNull(m.voltouEm);
      const [l] = await conn<Linha[]>`
        update incidentes set
          comecou_em = least(comecou_em, ${data(m.comecouEm)}),
          voltou_em = case when ${voltou}::timestamptz is null then null else greatest(coalesce(voltou_em, ${voltou}::timestamptz), ${voltou}::timestamptz) end,
          rotinas = rotinas + ${m.rotinas},
          conversas = conversas + ${m.conversas},
          agentes = array(select distinct unnest(agentes || ${[...m.agentes]}::uuid[]))
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraIncidente(l) : null;
    },

    /** Em curso (a máquina ainda não voltou): o varredor fecha quando ela volta a puxar. */
    async emCurso(): Promise<Incidente[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from incidentes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and voltou_em is null
        order by comecou_em`;
      return linhas.map(paraIncidente);
    },

    async marcarVolta(id: string, em: number): Promise<Incidente | null> {
      const [l] = await conn<Linha[]>`
        update incidentes set voltou_em = greatest(comecou_em, ${data(em)})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and voltou_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraIncidente(l) : null;
    },

    /** "Entendi": sai da tela; fechado e dispensado não recebe queda nova (destinoDaQueda). */
    async dispensar(id: string, em: number): Promise<Incidente | null> {
      const [l] = await conn<Linha[]>`
        update incidentes set dispensado_em = coalesce(dispensado_em, ${data(em)})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraIncidente(l) : null;
    },

    /** Não dispensados, em curso ou que voltaram depois de `desde` (o caso de uso passa agora − INCIDENTE_VISIVEL_MS). */
    async visiveis(desde: number): Promise<Incidente[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from incidentes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and dispensado_em is null and (voltou_em is null or voltou_em > ${data(desde)})
        order by comecou_em`;
      return linhas.map(paraIncidente);
    },
  };
}
