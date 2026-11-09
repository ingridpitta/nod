import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { agenteComConversa } from "../../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

// Regression: re-QA do PR #329 (m39) — o INSERT do turno podia perder maquina_desta_vez sem nenhum teste de integração falhar
// Found by /qa on 2026-10-16
// Report: comentário de re-QA no PR #329 (6373dfc2)
describeIntegracao("turnosRepo.enfileirar: maquina_desta_vez (NOD-280) e contaminado_em (NOD-287) no mesmo INSERT", () => {
  it("o refazer de 'Rodar no X desta vez' nasce preso à máquina escolhida e com a marca da web da origem", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const base = { conversaId, agenteId, origem: "conversa" as const, executor: "catcher" as const, prazoEm: agora + 86_400_000, profundidade: 0 as const, entradaTexto: "oi", entradaConfianca: "confiavel" as const, modelo: "claude-haiku-4-5-20251001", harness: "claude-cli" as const };
      const origem = (await repos.turnos.enfileirar(base))!;
      await repos.turnos.contaminar(origem.id, agora);
      const maquina = randomUUID();

      const refeito = (await repos.turnos.enfileirar({ ...base, retomaTurnoId: origem.id, reenvios: 1, maquinaDestaVez: maquina, contaminadoDe: origem.id }))!;
      const semAlvo = (await repos.turnos.enfileirar(base))!;

      const linhas = await trx<{ id: string; maquina_desta_vez: string | null }[]>`select id, maquina_desta_vez from turnos where id in (${refeito.id}, ${semAlvo.id})`;
      expect(linhas.find((l) => l.id === refeito.id)?.maquina_desta_vez).toBe(maquina);
      expect(linhas.find((l) => l.id === semAlvo.id)?.maquina_desta_vez).toBeNull();
      expect(await repos.turnos.contaminado(refeito.id)).toBe(true);
      expect(await repos.turnos.contaminado(semAlvo.id)).toBe(false);
    });
  });
});
