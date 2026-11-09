import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { trechoAplicavel } from "../../src/db/migrar.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const ARQUIVO = new URL("../../src/db/migrations/0072_tasks_viram_frentes.sql", import.meta.url);
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

/** As linhas comentadas depois de `-- ROLLBACK:`, já sem o `-- ` da frente (o padrão de migracao-id-envio.test.ts). */
function trechoDeReverter(conteudo: string): string {
  const depois = conteudo.slice(trechoAplicavel(conteudo).length).split("\n").slice(1);
  return depois.map((l) => l.replace(/^-- ?/, "")).join("\n");
}

/** Só os comandos de dados, apontados para uma cópia temporária (sem RLS e sem travar a tabela de verdade). */
const soDados = (sql: string) =>
  sql.split("\n").filter((l) => !l.startsWith("--") && !/^\s*(ALTER TABLE|SET LOCAL)\b/.test(l)).join("\n").replaceAll("UPDATE trabalhos ", "UPDATE pg_temp.trabalhos_0072 ");

/**
 * 0072 (ADR-099, I10, 2026-10-12): as tasks abertas viram frentes sem lote; as fechadas e as frentes de lote ficam como
 * estão; o ROLLBACK escrito no arquivo devolve exatamente o estado anterior. O schema ida e volta é do
 * rollback-ida-e-volta.test.ts; o RLS religado, do rls.test.ts.
 */
describeIntegracao("migração 0072_tasks_viram_frentes: só as tasks abertas mudam, e o ROLLBACK as devolve", () => {
  it("abertas viram frente sem lote; terminadas, paradas, falhas e frentes de lote não mudam; o rollback desfaz", async () => {
    const conteudo = await readFile(ARQUIVO, "utf8");
    const ida = soDados(trechoAplicavel(conteudo));
    const volta = soDados(trechoDeReverter(conteudo));
    expect(ida).toContain("UPDATE pg_temp.trabalhos_0072 SET forma = 'frente'");
    expect(volta).toContain("UPDATE pg_temp.trabalhos_0072 SET forma = 'task'");
    // O arquivo desliga e religa o FORCE no mesmo bloco (a regra das migrações de dado em tabela escopada).
    expect(conteudo).toMatch(/ALTER TABLE trabalhos NO FORCE ROW LEVEL SECURITY;\nUPDATE trabalhos[\s\S]+;\nALTER TABLE trabalhos FORCE ROW LEVEL SECURITY;/);

    await withRollback(MARLON, async (trx) => {
      await trx`create temp table trabalhos_0072 (nome text primary key, forma text not null, lote_id uuid, estado text not null) on commit drop`;
      const lote = "11111111-1111-4111-8111-111111111111";
      const linhas: [string, string, string | null, string][] = [
        ["na_fila", "task", null, "na_fila"],
        ["rodando", "task", null, "rodando"],
        ["precisa", "task", null, "precisa_de_voce"],
        ["ociosa", "task", null, "fechado_ocioso"],
        ["terminada", "task", null, "terminado"],
        ["parada", "task", null, "parado"],
        ["falhou", "task", null, "falhou"],
        ["frente_de_lote", "frente", lote, "rodando"],
        ["frente_de_lote_fechada", "frente", lote, "terminado"],
      ];
      for (const [nome, forma, loteId, estado] of linhas) await trx`insert into trabalhos_0072 (nome, forma, lote_id, estado) values (${nome}, ${forma}, ${loteId}, ${estado})`;
      const foto = async () => Object.fromEntries((await trx<{ nome: string; forma: string; lote_id: string | null }[]>`select nome, forma, lote_id from trabalhos_0072`).map((l) => [l.nome, `${l.forma}${l.lote_id ? "+lote" : ""}`]));
      const antes = await foto();

      await trx.unsafe(ida);
      expect(await foto()).toEqual({
        na_fila: "frente", rodando: "frente", precisa: "frente", ociosa: "frente",
        terminada: "task", parada: "task", falhou: "task",
        frente_de_lote: "frente+lote", frente_de_lote_fechada: "frente+lote",
      });
      // Rodar de novo não muda nada (a migração é idempotente sobre o próprio resultado).
      await trx.unsafe(ida);
      expect((await foto()).na_fila).toBe("frente");

      await trx.unsafe(volta);
      expect(await foto()).toEqual(antes);
    });
  });
});
