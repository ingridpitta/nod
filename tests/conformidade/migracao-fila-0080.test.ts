import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { trechoAplicavel } from "../../src/db/migrar.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const ARQUIVO = new URL("../../src/db/migrations/0080_fila_e_trocas_de_ia.sql", import.meta.url);
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

/**
 * Os UPDATEs do backfill (a fila e, desde a revisão do PR 2, a corporativa fora para quem não estava no automático),
 * apontados para cópias temporárias (sem RLS e sem travar as tabelas de verdade), como na 0072.
 */
function backfill(conteudo: string): string {
  const ida = trechoAplicavel(conteudo);
  const inicio = ida.indexOf("UPDATE contas_ia c");
  const fim = ida.indexOf("ALTER TABLE preferencias FORCE", inicio);
  return ida.slice(inicio, fim).trim().replaceAll("contas_ia ", "pg_temp.contas_ia_0080 ").replaceAll("preferencias p", "pg_temp.preferencias_0080 p");
}

/**
 * 0080 (ADR-108, 2026-10-16): o backfill da fila. Por pessoa e IA, liga a conta pessoal não removida de menor posição;
 * quem usava "Trocar sozinho" já consentiu: todas as pessoais. A corporativa e a removida não mudam. O schema ida e volta
 * é do rollback-ida-e-volta.test.ts; o RLS religado, do rls.test.ts.
 */
describeIntegracao("migração 0080_fila_e_trocas_de_ia: o backfill da fila", () => {
  it("a 1ª pessoal de cada IA entra na fila; com 'Trocar sozinho', todas as pessoais; a corporativa só fica com 'Trocar sozinho'", async () => {
    const conteudo = await readFile(ARQUIVO, "utf8");
    const sql = backfill(conteudo);
    expect(sql).toMatch(/^UPDATE pg_temp\.contas_ia_0080 c SET entra_na_troca_automatica = true/);
    // O arquivo desliga e religa o FORCE no mesmo bloco (a regra das migrações de dado em tabela escopada).
    expect(conteudo).toMatch(/ALTER TABLE contas_ia NO FORCE ROW LEVEL SECURITY;\nALTER TABLE preferencias NO FORCE ROW LEVEL SECURITY;\nUPDATE contas_ia c[\s\S]+?;\nALTER TABLE preferencias FORCE ROW LEVEL SECURITY;\nALTER TABLE contas_ia FORCE ROW LEVEL SECURITY;/);

    await withRollback(MARLON, async (trx) => {
      await trx`create temp table contas_ia_0080 (nome text primary key, tenant_id uuid not null, owner_id uuid not null, ia text not null, posicao int not null,
        corporativa boolean not null, entra_na_troca_automatica boolean not null, removida_em timestamptz) on commit drop`;
      await trx`create temp table preferencias_0080 (tenant_id uuid not null, owner_id uuid not null, contas_modo text not null) on commit drop`;
      const t = TENANT_PADRAO;
      const ana = "aaaaaaaa-0000-4000-8000-00000000000a";
      const bia = "bbbbbbbb-0000-4000-8000-00000000000b";
      const linhas: [string, string, string, number, boolean, boolean, boolean][] = [
        // Ana (Perguntar antes): a corporativa vem primeiro; a 1ª PESSOAL do Claude é a de posição 2.
        ["ana-c-corp", ana, "claude-cli", 1, true, false, false],
        ["ana-c-pessoal", ana, "claude-cli", 2, false, false, false],
        ["ana-c-segunda", ana, "claude-cli", 3, false, false, false],
        ["ana-g-pessoal", ana, "codex-cli", 4, false, false, false],
        // Removida não conta nem entra.
        ["ana-g-removida", ana, "codex-cli", 0, false, false, true],
        // Revisão do PR 2 (C4): a corporativa marcada de quem estava no "Perguntar antes" sai da fila (a marca não trocava
        // nada sozinha; agora trocaria, sem o consentimento dos termos).
        ["ana-c-corp-marcada", ana, "claude-cli", 5, true, true, false],
        // Bia (Trocar sozinho): todas as pessoais; a corporativa marcada antes fica marcada, a desmarcada fica fora.
        ["bia-c-um", bia, "claude-cli", 1, false, false, false],
        ["bia-c-dois", bia, "claude-cli", 2, false, false, false],
        ["bia-c-corp", bia, "claude-cli", 3, true, false, false],
        ["bia-c-corp-marcada", bia, "claude-cli", 4, true, true, false],
      ];
      for (const [nome, dona, ia, posicao, corporativa, flag, removida] of linhas) {
        await trx`insert into contas_ia_0080 values (${nome}, ${t}, ${dona}, ${ia}, ${posicao}, ${corporativa}, ${flag}, ${removida ? new Date() : null})`;
      }
      await trx`insert into preferencias_0080 values (${t}, ${ana}, 'perguntar'), (${t}, ${bia}, 'automatico')`;
      const foto = async () => Object.fromEntries((await trx<{ nome: string; entra_na_troca_automatica: boolean }[]>`select nome, entra_na_troca_automatica from contas_ia_0080`).map((l) => [l.nome, l.entra_na_troca_automatica]));

      await trx.unsafe(sql);
      expect(await foto()).toEqual({
        "ana-c-corp": false, "ana-c-pessoal": true, "ana-c-segunda": false, "ana-g-pessoal": true, "ana-g-removida": false, "ana-c-corp-marcada": false,
        "bia-c-um": true, "bia-c-dois": true, "bia-c-corp": false, "bia-c-corp-marcada": true,
      });
      // Rodar de novo não muda nada (idempotente sobre o próprio resultado).
      await trx.unsafe(sql);
      expect((await foto())["ana-c-segunda"]).toBe(false);
    });
  });
});
