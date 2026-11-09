import type { CatalogoDeComandos } from "../contracts/comandos.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { jsonb, ms } from "./conversao.ts";

/** O catálogo do "/" do Mac da pessoa (0038): uma linha por pessoa, trocada inteira quando o app manda outra. */
export function comandosRepo(conn: Conn, escopo: Escopo) {
  return {
    async gravar(catalogo: CatalogoDeComandos): Promise<void> {
      await conn`
        insert into catalogo_comandos (tenant_id, owner_id, catalogo)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${jsonb(conn, catalogo)})
        on conflict (tenant_id, owner_id) do update set catalogo = excluded.catalogo, atualizado_em = clock_timestamp()`;
    },

    async buscar(): Promise<{ catalogo: CatalogoDeComandos; em: number } | null> {
      const [l] = await conn<{ catalogo: CatalogoDeComandos; atualizado_em: Date }[]>`
        select catalogo, atualizado_em from catalogo_comandos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
      return l ? { catalogo: l.catalogo, em: ms(l.atualizado_em) } : null;
    },
  };
}
