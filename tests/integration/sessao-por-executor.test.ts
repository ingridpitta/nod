import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

/**
 * Regressão do bug que o Marlon viu ao vivo em 2026-09-16: a conversa "Teste 1" nasceu com
 * NOD_EXECUTOR=catcher, que inventava um session_id; ao trocar para claude-cli, o plano montou
 * `--resume <uuid fantasma>` e o CLI falhou (erro_execucao com os três sinais true).
 * A sessão é do EXECUTOR que a criou (0005): --resume só quando o executor bate.
 */
describeIntegracao("sessão do CLI pertence ao executor (0005)", () => {
  async function planoPara(trx: Parameters<Parameters<typeof withRollback>[1]>[0], executor: "local" | "catcher", conversaId: string, agenteId: string, repos: Awaited<ReturnType<typeof agenteComConversa>>["repos"]) {
    const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "ola", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
    const agora = () => Date.now();
    const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
    const r = await emitirPlanoTurno(deps, { turnoId: turno?.id ?? "", machineId: randomUUID(), executor });
    return r.data.entrada.sessaoCli;
  }

  it("sessão gravada pelo catcher NÃO vira --resume no claude-cli; a do claude-cli não vira --resume no catcher; o mesmo executor reaproveita", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Teste 1" });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true });
      // executor 'local' exige inventário do claude-cli 'pronto' (ADR-019, fail-closed) — registra antes.
      await repos.inventario.registrar("claude-cli", { estado: "pronto", versao: "2.1.272", em: Date.now() });

      // Sem sessão: ninguém reaproveita.
      expect(await planoPara(trx, "local", conversaId, agenteId, repos)).toBeNull();

      // O catcher gravou uma sessão (o driver antigo fazia isso com randomUUID).
      const fantasma = randomUUID();
      expect(await repos.conversas.atualizarSessaoCli(conversaId, fantasma, "catcher")).toBe(true);
      expect((await repos.conversas.buscar(conversaId))?.sessaoExecutor).toBe("catcher");
      // claude-cli NÃO pode retomar uma sessão que o Claude nunca viu.
      expect(await planoPara(trx, "local", conversaId, agenteId, repos)).toBeNull();
      // O próprio catcher pode.
      expect(await planoPara(trx, "catcher", conversaId, agenteId, repos)).toBe(fantasma);

      // Agora o claude-cli grava a sessão real: ele reaproveita, o catcher não.
      const real = randomUUID();
      await repos.conversas.atualizarSessaoCli(conversaId, real, "local");
      expect(await planoPara(trx, "local", conversaId, agenteId, repos)).toBe(real);
      expect(await planoPara(trx, "catcher", conversaId, agenteId, repos)).toBeNull();

      // Sessão sem dono (linha anterior à 0005, ou gravação sem executor) nunca vale --resume.
      await repos.conversas.atualizarSessaoCli(conversaId, randomUUID());
      expect((await repos.conversas.buscar(conversaId))?.sessaoExecutor).toBeNull();
      expect(await planoPara(trx, "local", conversaId, agenteId, repos)).toBeNull();

      // Apagar a sessão limpa o executor junto.
      await repos.conversas.atualizarSessaoCli(conversaId, null, "local");
      expect((await repos.conversas.buscar(conversaId))?.sessaoExecutor).toBeNull();
    });
  });
});
