import type { Conn, Escopo } from "../shared/types.ts";
import { jsonb, ms } from "./conversao.ts";

export interface RegistroCatcher {
  id: string;
  turnoId: string;
  tipo: string;
  dados: Record<string, unknown>;
  em: number;
}

interface Linha {
  id: string;
  turno_id: string;
  tipo: string;
  dados: Record<string, unknown>;
  em: Date;
}

const paraRegistro = (l: Linha): RegistroCatcher => ({ id: l.id, turnoId: l.turno_id, tipo: l.tipo, dados: l.dados, em: ms(l.em) });

/**
 * Catcher (Práticas §11): o que o proxy decidiu e o que o executor teria chamado, por turno,
 * visível a toda a equipe em dev (visibility DEFAULT 'equipe' na 0002). `tipo` é snake_case (CHECK).
 */
export function catcherRepo(conn: Conn, escopo: Escopo) {
  return {
    async registrar(r: { turnoId: string; tipo: string; dados: Record<string, unknown> }): Promise<RegistroCatcher | null> {
      const [l] = await conn<Linha[]>`
        insert into catcher_registros (tenant_id, owner_id, turno_id, tipo, dados)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${r.turnoId}, ${r.tipo}, ${jsonb(conn, r.dados)})
        returning id, turno_id, tipo, dados, em`;
      return l ? paraRegistro(l) : null;
    },

    async listar(turnoId: string): Promise<RegistroCatcher[]> {
      const linhas = await conn<Linha[]>`select id, turno_id, tipo, dados, em from catcher_registros where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} order by em, id`;
      return linhas.map(paraRegistro);
    },

    async listarRecentes(limite = 100): Promise<RegistroCatcher[]> {
      const linhas = await conn<Linha[]>`select id, turno_id, tipo, dados, em from catcher_registros where tenant_id = ${escopo.tenantId} order by em desc, id desc limit ${limite}`;
      return linhas.map(paraRegistro);
    },
  };
}
