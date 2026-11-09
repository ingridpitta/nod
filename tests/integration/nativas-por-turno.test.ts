import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Confianca } from "../../src/contracts/mensagem.ts";
import { NATIVAS_DE_ARQUIVO } from "../../src/domain/nativas.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const PASTAS = { ativa: "/Users/marlon/code/nod", aprovadas: ["/Users/marlon/code/nod"] };

/**
 * Brecha medida em 2026-09-28: com pasta autorizada, `montarArgs` ligava Write/Edit nativos em QUALQUER turno
 * da conversa — inclusive a continuação com a resposta de um colega (não confiável), que não passa pelo proxy.
 * E o prompt sempre negava as nativas, mesmo quando ligadas.
 */
describeIntegracao("nativas só em turno de conversa confiável (2026-09-28)", () => {
  async function plano(confianca: Confianca) {
    return withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Dev 1" });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "revise o PR", entradaConfianca: confianca, modelo: "sonnet" });
      const agora = () => Date.now();
      const workspaces = { id: async () => randomUUID(), pastasDoHarness: async () => PASTAS };
      const deps = depsSobre(repos, MARLON, { services: { ...servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), workspaces }, agora, trx });
      return (await emitirPlanoTurno(deps, { turnoId: turno?.id ?? "", machineId: randomUUID(), executor: "catcher" })).data;
    });
  }

  it("turno confiável recebe as pastas e as nativas, e o prompt diz isso", async () => {
    const p = await plano("confiavel");
    expect(p.nativas).toEqual(NATIVAS_DE_ARQUIVO);
    expect(p.workspacePastas).toEqual(PASTAS);
    expect(p.promptSistema).toContain("Também há as ferramentas nativas Read");
    expect(p.promptSistema).not.toContain("Não há Read");
  });

  it("turno não confiável na mesma conversa não recebe pastas nem nativas; o prompt nega", async () => {
    const p = await plano("nao_confiavel");
    expect(p.nativas).toEqual([]);
    expect(p.workspacePastas).toBeNull();
    // O vínculo com o projeto continua (as ferramentas workspace_* passam pelo proxy e pela moldura).
    expect(p.workspaceId).toBeTruthy();
    expect(p.promptSistema).toContain("Não há Read, Edit, Write, Glob nem Grep.");
  });
});
