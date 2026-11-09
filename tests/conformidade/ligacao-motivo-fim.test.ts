import { expect, it } from "vitest";
import { MOTIVOS_FIM_LIGACAO } from "../../src/contracts/voz.ts";
import { db } from "../helpers/db.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * `ligacoes.motivo_fim` é text com CHECK (0048, refeito na 0055), não enum — então o gate motivos-enum não o cobre. Este
 * compara a lista de src/contracts/voz.ts com o CHECK que o banco aplica, nos dois sentidos e na ORDEM declarada: um
 * motivo novo sem migração (ou o contrário) falha aqui, e não na primeira ligação que tentar encerrar com ele.
 * definido em 2026-10-05, junto com o motivo `sem_ia` (a IA do Mac caiu e ninguém escolheu a saída).
 */
describeIntegracao("gate: MOTIVOS_FIM_LIGACAO == CHECK ligacao_motivo_fim", () => {
  it("o CHECK aceita exatamente os motivos de voz.ts, na mesma ordem", async () => {
    const [c] = await db<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'ligacoes'::regclass and conname = 'ligacao_motivo_fim'`;
    expect(c?.def).toBeDefined();
    const noBanco = [...(c?.def ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(noBanco).toEqual([...MOTIVOS_FIM_LIGACAO]);
    expect(noBanco).toContain("sem_ia");
  });
});
