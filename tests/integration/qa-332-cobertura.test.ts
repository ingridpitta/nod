import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IdHarness } from "../../src/contracts/harness.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * QA do PR #332 (NOD-281, ADR-107): cobre duas regras que as mutações mostraram sem teste —
 * a máquina na retomada da cadeia (ADR-107 §3) e o "no trabalho só larga a sessão" (ADR-107 §4).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto: Inventario = { estado: "pronto", versao: "teste", em: Date.now() };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const TOKENS = { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 };
const rejeitada: ResultadoTurno = {
  desfecho: "interrompido", motivoInterrupcao: "sessao_rejeitada", texto: "", sessaoCli: null, sinais: { ...SINAIS, rejected: true, promptSubmitted: false, producedOutput: false },
  custoUsd: null, tokens: TOKENS, ferramentasChamadas: [], negacoesPermissao: [],
};

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Eng 1" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const agora = () => Date.now();
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const enfileirar = (extra: Record<string, unknown> = {}) =>
    base.repos.turnos.enfileirar({ executor: "local", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "roda os testes", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", ...extra });
  const plano = async (turnoId: string, machineId: string, ias: readonly IdHarness[] = ["claude-cli"]) =>
    (await emitirPlanoTurno(deps, { turnoId, machineId, executor: "local", harnesses: Object.fromEntries(ias.map((ia) => [ia, pronto])), sessaoPorMaquina: true })).data;
  return { ...base, deps, enfileirar, plano };
}

describeIntegracao("QA #332: cobertura da ADR-107", () => {
  it("na ponte, a retomada da cadeia só continua a sessão na máquina em que o pedido rodou", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const [a, b] = [randomUUID(), randomUUID()];
      const delegacao = (extra: Record<string, unknown> = {}) => m.enfileirar({ origem: "delegacao", sobProcuracaoDe: PESSOA_MARLON, profundidade: 1, ...extra });

      const pedido = (await delegacao())!;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(pedido.id);
      expect((await m.plano(pedido.id, a)).harness).toBe("claude-cli");
      await m.repos.turnos.assentar(pedido.id, { estado: "concluido", sessaoCli: "sessao-na-a" });
      expect(await m.repos.turnos.sessaoDoTurno(pedido.id)).toMatchObject({ sessaoCli: "sessao-na-a", machineId: a });

      const retomada = (await delegacao({ origem: "retomada", retomaTurnoId: pedido.id }))!;
      // Na máquina B a sessão não existe: sem resume.
      expect((await m.plano(retomada.id, b)).entrada.sessaoCli).toBeNull();
      // Na A, continua.
      expect((await m.plano(retomada.id, a)).entrada.sessaoCli).toBe("sessao-na-a");
    });
  });

  it("no trabalho, sessao_rejeitada larga a sessão do trabalho (a próxima volta vem sem resume)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      const w = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Login do app", origem: "pessoa" })).trabalho;
      await m.repos.trabalhos.atualizarSessao(w.id, "sessao-do-trabalho", "claude-cli", "local", a);
      const t = (await m.enfileirar({ trabalhoId: w.id }))!;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(t.id);
      expect((await m.plano(t.id, a)).entrada.sessaoCli).toBe("sessao-do-trabalho");

      await assentarTurno(m.deps, { turnoId: t.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: rejeitada, executor: "local", harness: "claude-cli" });
      const depois = await m.repos.trabalhos.buscar(w.id);
      expect(depois?.sessaoCli).toBeNull();
      expect(await m.repos.trabalhos.maquinaDaSessao(w.id)).toBeNull();
    });
  });
});
