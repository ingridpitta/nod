import type { Inventario } from "../contracts/inventario.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

interface Linha {
  motor: string;
  estado: Inventario["estado"];
  motivo: string | null;
  versao_cli: string | null;
  visto_em: Date;
}

function paraInventario(l: Linha): Inventario {
  const em = ms(l.visto_em);
  if (l.estado === "pronto") return { estado: "pronto", versao: l.versao_cli ?? "", em };
  if (l.estado === "nao_autenticado") return l.versao_cli ? { estado: "nao_autenticado", motivo: l.motivo ?? "", versao: l.versao_cli, em } : { estado: "nao_autenticado", motivo: l.motivo ?? "", em };
  return { estado: "ausente", motivo: l.motivo ?? "", em };
}

/** Inventário de motores por pessoa (ADR-019): três estados, motivo, versão do CLI, instante. SEM email. */
export function inventarioRepo(conn: Conn, escopo: Escopo) {
  return {
    /** Upsert por (pessoa, motor): a sonda mais recente vence. */
    async registrar(motor: string, inv: Inventario): Promise<Inventario | null> {
      const versao = "versao" in inv ? (inv.versao ?? null) : null;
      const motivo = "motivo" in inv ? inv.motivo : null;
      const [l] = await conn<Linha[]>`
        insert into inventario_motores (tenant_id, owner_id, pessoa_id, motor, estado, motivo, versao_cli, visto_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${escopo.pessoaId}, ${motor}, ${inv.estado}, ${motivo}, ${versao}, ${data(inv.em)})
        on conflict (tenant_id, pessoa_id, motor) do update set estado = excluded.estado, motivo = excluded.motivo, versao_cli = excluded.versao_cli, visto_em = excluded.visto_em
        returning motor, estado, motivo, versao_cli, visto_em`;
      return l ? paraInventario(l) : null;
    },

    async buscar(motor: string): Promise<Inventario | null> {
      const [l] = await conn<Linha[]>`
        select motor, estado, motivo, versao_cli, visto_em from inventario_motores
        where tenant_id = ${escopo.tenantId} and pessoa_id = ${escopo.pessoaId} and motor = ${motor}`;
      return l ? paraInventario(l) : null;
    },

    async listar(): Promise<{ motor: string; inventario: Inventario }[]> {
      const linhas = await conn<Linha[]>`
        select motor, estado, motivo, versao_cli, visto_em from inventario_motores where tenant_id = ${escopo.tenantId} and pessoa_id = ${escopo.pessoaId} order by motor`;
      return linhas.map((l) => ({ motor: l.motor, inventario: paraInventario(l) }));
    },
  };
}
