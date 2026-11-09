import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { trechoAplicavel } from "../../src/db/migrar.ts";
import type { Tx } from "../../src/shared/types.ts";
import { withRollbackDono } from "../helpers/db-dono.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

const ARQUIVO = new URL("../../src/db/migrations/0057_mensagem_id_envio.sql", import.meta.url);

/** As linhas comentadas depois de `-- ROLLBACK:`, já sem o `-- ` da frente. */
function trechoDeReverter(conteudo: string): string {
  const depois = conteudo.slice(trechoAplicavel(conteudo).length).split("\n").slice(1);
  return depois.map((l) => l.replace(/^-- ?/, "")).join("\n");
}

async function estado(trx: Tx): Promise<{ coluna: string | null; indice: string | null }> {
  const [c] = await trx<{ tipo: string }[]>`
    select data_type as tipo from information_schema.columns where table_name = 'mensagens' and column_name = 'id_envio'`;
  const [i] = await trx<{ def: string }[]>`select indexdef as def from pg_indexes where tablename = 'mensagens' and indexname = 'mensagens_id_envio_unico'`;
  return { coluna: c?.tipo ?? null, indice: i?.def ?? null };
}

/**
 * NOD-156, critério 8: a 0057 está aplicada no banco de teste, o ROLLBACK escrito no arquivo a desfaz limpa e ela volta
 * a aplicar por cima — tudo numa transação de nod_dono que termina em ROLLBACK (DDL é transacional no Postgres).
 */
describeIntegracao("migração 0057_mensagem_id_envio: aplica, reverte e reaplica", () => {
  it("coluna uuid + índice único parcial; o ROLLBACK do arquivo remove os dois; reaplicar devolve o mesmo estado", async () => {
    const conteudo = await readFile(ARQUIVO, "utf8");
    await withRollbackDono(async (trx) => {
      const aplicada = await estado(trx);
      expect(aplicada.coluna).toBe("uuid");
      expect(aplicada.indice).toMatch(/CREATE UNIQUE INDEX mensagens_id_envio_unico ON public\.mensagens USING btree \(tenant_id, conversa_id, id_envio\) WHERE \(id_envio IS NOT NULL\)/);

      await trx.unsafe(trechoDeReverter(conteudo));
      expect(await estado(trx)).toEqual({ coluna: null, indice: null });

      await trx.unsafe(trechoAplicavel(conteudo));
      expect(await estado(trx)).toEqual(aplicada);
    });
  });
});
