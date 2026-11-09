import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { trechoAplicavel, trechoDeRollback } from "../../src/db/migrar.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const ARQUIVO = new URL("../../src/db/migrations/0096_corporativa_na_fila.sql", import.meta.url);
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

/** O UPDATE do backfill apontado para cópias temporárias (sem RLS e sem travar as tabelas de verdade), como na 0080. */
function backfill(conteudo: string): string {
  const ida = trechoAplicavel(conteudo);
  const inicio = ida.indexOf("UPDATE contas_ia c");
  const fim = ida.indexOf("ALTER TABLE preferencias FORCE", inicio);
  return ida.slice(inicio, fim).trim().replaceAll("contas_ia ", "pg_temp.contas_ia_0096 ").replaceAll("preferencias p", "pg_temp.preferencias_0096 p");
}

/**
 * 0096 (NOD-308): a corporativa segue a regra da pessoal. Entra na fila a corporativa que estaria nela se fosse pessoal:
 * a primeira na fila da IA, ou toda corporativa de quem estava no "Trocar sozinho". O schema ida e volta é do
 * rollback-ida-e-volta.test.ts; o RLS religado, do rls.test.ts.
 */
describeIntegracao("migração 0096_corporativa_na_fila: a corporativa volta para a fila pelo critério da pessoal", () => {
  it("Perguntar antes não cria duas contas na fila; Trocar sozinho entra todas; rollback preserva as que já estavam", async () => {
    const conteudo = await readFile(ARQUIVO, "utf8");
    const sql = backfill(conteudo);
    expect(sql).toMatch(/^UPDATE pg_temp\.contas_ia_0096 c SET entra_na_troca_automatica = true/);
    // O arquivo desliga e religa o FORCE no mesmo bloco (a regra das migrações de dado em tabela escopada).
    expect(trechoAplicavel(conteudo)).toMatch(/ALTER TABLE contas_ia NO FORCE ROW LEVEL SECURITY;\nALTER TABLE preferencias NO FORCE ROW LEVEL SECURITY;\nUPDATE contas_ia c[\s\S]+?;\nALTER TABLE preferencias FORCE ROW LEVEL SECURITY;\nALTER TABLE contas_ia FORCE ROW LEVEL SECURITY;/);
    // Só dado: nada de DDL na ida.
    expect(trechoAplicavel(conteudo)).not.toMatch(/\b(CREATE|DROP|ADD COLUMN|ALTER COLUMN)\b/);

    await withRollback(MARLON, async (trx) => {
      await trx`create temp table contas_ia_0096 (id uuid primary key, nome text unique not null, tenant_id uuid not null, owner_id uuid not null, ia text not null, posicao int not null,
        corporativa boolean not null, entra_na_troca_automatica boolean not null, removida_em timestamptz) on commit drop`;
      await trx`create temp table preferencias_0096 (tenant_id uuid not null, owner_id uuid not null, contas_modo text not null) on commit drop`;
      const t = TENANT_PADRAO;
      const ana = "aaaaaaaa-0000-4000-8000-00000000000a";
      const bia = "bbbbbbbb-0000-4000-8000-00000000000b";
      const linhas: [string, string, string, string, number, boolean, boolean, boolean][] = [
        // Ana (Perguntar antes): a pessoal na pos. 2 já está na fila; a corporativa de pos. 1 não cria uma segunda.
        ["00000000-0000-4000-8000-000000000001", "ana-c-corp-1", ana, "claude-cli", 1, true, false, false],
        ["00000000-0000-4000-8000-000000000002", "ana-c-pessoal", ana, "claude-cli", 2, false, true, false],
        // A corporativa na pos. 3 também fica fora porque a fila dessa IA já está ocupada.
        ["00000000-0000-4000-8000-000000000003", "ana-c-corp-3", ana, "claude-cli", 3, true, false, false],
        // Corporativa já na fila não muda; removida não muda (nem conta como "antes").
        ["00000000-0000-4000-8000-000000000004", "ana-c-corp-ligada", ana, "claude-cli", 4, true, true, false],
        ["00000000-0000-4000-8000-000000000005", "ana-g-removida", ana, "codex-cli", 0, true, false, true],
        // Codex independente: duas corporativas empatam na menor posição; só o menor id entra na fila.
        ["00000000-0000-4000-8000-000000000006", "ana-g-pessoal", ana, "codex-cli", 1, false, false, false],
        ["00000000-0000-4000-8000-000000000008", "ana-g-corp-empate-maior-id", ana, "codex-cli", 3, true, false, false],
        ["00000000-0000-4000-8000-000000000007", "ana-g-corp-empate-menor-id", ana, "codex-cli", 3, true, false, false],
        ["00000000-0000-4000-8000-000000000009", "ana-g-corp-pos-5", ana, "codex-cli", 5, true, false, false],
        // Bia (Trocar sozinho): todas as corporativas entram; a pessoal fora continua fora (a 0080 já tratou dela).
        ["00000000-0000-4000-8000-000000000010", "bia-c-um", bia, "claude-cli", 1, false, true, false],
        ["00000000-0000-4000-8000-000000000011", "bia-c-corp-2", bia, "claude-cli", 2, true, false, false],
        ["00000000-0000-4000-8000-000000000012", "bia-c-corp-3", bia, "claude-cli", 3, true, false, false],
        ["00000000-0000-4000-8000-000000000013", "bia-c-pessoal-fora", bia, "claude-cli", 4, false, false, false],
      ];
      for (const [id, nome, dona, ia, posicao, corporativa, flag, removida] of linhas) {
        await trx`insert into contas_ia_0096 values (${id}, ${nome}, ${t}, ${dona}, ${ia}, ${posicao}, ${corporativa}, ${flag}, ${removida ? new Date() : null})`;
      }
      await trx`insert into preferencias_0096 values (${t}, ${ana}, 'perguntar'), (${t}, ${bia}, 'automatico')`;
      const foto = async () => Object.fromEntries((await trx<{ nome: string; entra_na_troca_automatica: boolean }[]>`select nome, entra_na_troca_automatica from contas_ia_0096`).map((l) => [l.nome, l.entra_na_troca_automatica]));

      await trx.unsafe(sql);
      const esperado = {
        "ana-c-corp-1": false, "ana-c-pessoal": true, "ana-c-corp-3": false, "ana-c-corp-ligada": true, "ana-g-removida": false,
        "ana-g-pessoal": false, "ana-g-corp-empate-maior-id": false, "ana-g-corp-empate-menor-id": true, "ana-g-corp-pos-5": false,
        "bia-c-um": true, "bia-c-corp-2": true, "bia-c-corp-3": true, "bia-c-pessoal-fora": false,
      };
      expect(await foto()).toEqual(esperado);
      // Rodar de novo não muda nada (idempotente).
      await trx.unsafe(sql);
      expect(await foto()).toEqual(esperado);
      await trx.unsafe(trechoDeRollback(conteudo) ?? "");
      expect(await foto()).toEqual(esperado);
    });
  });
});
