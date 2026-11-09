import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IdHarness } from "../../src/contracts/harness.ts";
import type { Entrega } from "../../src/contracts/ponte.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { lerCustoDoDia } from "../../src/use-cases/custo-do-dia.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Pacote E3 (definido em 2026-10-15): o custo que o Nod mostra passa a ser confiável.
 * - NOD-273: o custo do dia soma `gastos` pelo instante do gasto; o Codex (sem custo informado) aparece com tokens e
 *   deixa o total, a frente e o Raio-X "parciais".
 * - NOD-291: o turno numa cópia da sessão (`--fork-session`) desconta o total da sessão-mãe.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const DIA = 86_400_000;
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
type Resultado = Entrega["resultado"];

const resultado = (o: { custoUsd: number | null; sessaoCli?: string | null; entrada?: number; saida?: number }): Resultado => ({
  desfecho: "sucesso",
  texto: "feito",
  sessaoCli: o.sessaoCli ?? null,
  sinais: SINAIS,
  custoUsd: o.custoUsd,
  tokens: { entrada: o.entrada ?? 100, saida: o.saida ?? 10, cacheLeitura: 0, cacheCriacao: 0 },
  ferramentasChamadas: [],
  negacoesPermissao: [],
});

/** `agora` fixo (o relógio parado) ou o de verdade: o gasto entra na janela [meia-noite, agora) só se for antes de agora. */
async function cenario(trx: Trx, fixo?: number) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Eng 1" });
  const relogio = () => fixo ?? Date.now();
  const agora = relogio();
  const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx, agora: relogio });
  /** Um turno da conversa (ou do trabalho) que roda e assenta com o resultado dado. */
  const rodar = async (r: Resultado, o: { trabalhoId?: string; origemDaCopia?: string; harness?: IdHarness } = {}) => {
    const t = await repos.turnos.enfileirar({ executor: "local", conversaId, agenteId, origem: o.trabalhoId ? "retomada" : "conversa", prazoEm: agora + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "m", harness: o.harness ?? "claude-cli", trabalhoId: o.trabalhoId ?? null });
    if (!t) throw new Error("turno");
    if (o.origemDaCopia) await repos.turnos.registrarSessaoOrigem(t.id, o.origemDaCopia);
    const machineId = randomUUID();
    const pego = await repos.turnos.reivindicar({ machineId, agora: Date.now() });
    if (pego?.id !== t.id) throw new Error("reivindicar");
    await assentarTurno(deps, { turnoId: t.id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: r, executor: "local" });
    return t.id;
  };
  return { repos, deps, agenteId, conversaId, rodar };
}

describeIntegracao("NOD-291: o turno numa cópia da sessão desconta o total da mãe", () => {
  it("mãe com US$ 162,55 e a cópia com US$ 164,22: a cópia custa US$ 1,67 (turno e gastos)", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const mae = `mae-${randomUUID()}`;
      const copia = `copia-${randomUUID()}`;
      await c.rodar(resultado({ custoUsd: 162.55, sessaoCli: mae }));
      const id = await c.rodar(resultado({ custoUsd: 164.22, sessaoCli: copia }), { origemDaCopia: mae });
      const turno = await c.repos.turnos.buscar(id);
      expect(turno?.custoUsd).toBeCloseTo(1.67, 7);
      const [gasto, ...outros] = await c.repos.gastos.doTurno(id);
      expect(outros).toHaveLength(0);
      expect(gasto?.custoUsd).toBeCloseTo(1.67, 7);
      // O próximo turno da cópia segue a regra de antes: a diferença para o total anterior DELA.
      const seguinte = await c.rodar(resultado({ custoUsd: 165, sessaoCli: copia }));
      expect((await c.repos.turnos.buscar(seguinte))?.custoUsd).toBeCloseTo(0.78, 7);
    });
  });

  it("o que a mãe gastou DEPOIS da cópia não entra no anterior; sem origem, a regra é a de antes", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const mae = `mae-${randomUUID()}`;
      await c.rodar(resultado({ custoUsd: 10, sessaoCli: mae }));
      const copiaId = await c.rodar(resultado({ custoUsd: 12, sessaoCli: `copia-${randomUUID()}` }), { origemDaCopia: mae });
      // A mãe segue no trabalho promovido e cresce depois da cópia.
      await c.rodar(resultado({ custoUsd: 40, sessaoCli: mae }));
      const copia = await c.repos.turnos.buscar(copiaId);
      expect(copia?.custoUsd).toBeCloseTo(2, 7);
      expect(await c.repos.turnos.totalAnteriorDaSessao(`outra-${randomUUID()}`, copiaId)).toBe(10);
      // Turno sem cópia nem anterior: custo = total (a regra da 0035).
      const novo = await c.rodar(resultado({ custoUsd: 3, sessaoCli: `nova-${randomUUID()}` }));
      expect((await c.repos.turnos.buscar(novo))?.custoUsd).toBe(3);
    });
  });
});

describeIntegracao("NOD-273: o custo do dia vem de gastos, pelo instante do gasto", () => {
  it("o bot do Codex aparece com tokens e deixa o dia parcial; o misto é parcial", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await c.rodar(resultado({ custoUsd: null, entrada: 12_000, saida: 1_500 }), { harness: "codex-cli" });
      await new Promise((r) => setTimeout(r, 5));
      const { data } = await lerCustoDoDia(c.deps, { fuso: "UTC" });
      const bot = data.bots.find((b) => b.agenteId === c.agenteId);
      expect(bot).toMatchObject({ hojeUsd: 0, tokens: 13_500, parcial: true });
      expect(data.parcial).toBe(true);
      // O mesmo bot gasta em dólar no Claude: o valor entra e segue parcial.
      await c.rodar(resultado({ custoUsd: 0.5, sessaoCli: `s-${randomUUID()}` }));
      await new Promise((r) => setTimeout(r, 5));
      const depois = (await lerCustoDoDia(c.deps, { fuso: "UTC" })).data.bots.find((b) => b.agenteId === c.agenteId);
      expect(depois).toMatchObject({ hojeUsd: 0.5, tokens: 13_610, parcial: true });
    });
  });

  it("o turno criado às 23h que gasta às 2h conta no dia em que gastou", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const meiaNoite = Math.floor(agora / DIA) * DIA;
      const c = await cenario(trx, agora);
      const t = await c.repos.turnos.enfileirar({ executor: "local", conversaId: c.conversaId, agenteId: c.agenteId, origem: "conversa", prazoEm: agora + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m", harness: "claude-cli" as IdHarness });
      await trx`update turnos set criado_em = ${new Date(meiaNoite - 3_600_000)} where id = ${t!.id}`;
      const gastouEm = meiaNoite + Math.min(2 * 3_600_000, Math.floor((agora - meiaNoite) / 2));
      await c.repos.gastos.registrar({ turnoId: t!.id, executor: "local", tokensEntrada: 1, tokensSaida: 1, custoUsd: 4, modelo: "m", em: gastouEm });
      const { data } = await lerCustoDoDia(c.deps, { fuso: "UTC" });
      expect(data.bots.find((b) => b.agenteId === c.agenteId)).toMatchObject({ hojeUsd: 4, parcial: false });
    });
  });

  it("a frente com turno do Codex fica com o custo parcial; o Raio-X conta o turno e marca parcial", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const w = (await criarTrabalho(c.deps, { agenteId: c.agenteId, conversaId: c.conversaId, titulo: "Migrar relatórios", origem: "pessoa" })).trabalho;
      await c.rodar(resultado({ custoUsd: 0.3, sessaoCli: `s-${randomUUID()}` }), { trabalhoId: w.id });
      expect((await c.repos.trabalhos.buscar(w.id))?.custoParcial).toBeUndefined();
      await c.rodar(resultado({ custoUsd: null, entrada: 5_000, saida: 100 }), { trabalhoId: w.id, harness: "codex-cli" });
      const frente = await c.repos.trabalhos.buscar(w.id);
      expect(frente).toMatchObject({ custoUsd: 0.3, custoParcial: true });

      const desde = Date.now() - DIA;
      await c.rodar(resultado({ custoUsd: null, entrada: 800, saida: 50 }), { harness: "codex-cli" });
      const total = await c.repos.raioX.totalDesde(c.conversaId, desde);
      expect(total.turnos).toBe(3);
      expect(total.custoUsd).toBeCloseTo(0.3, 7);
      expect(total.parcial).toBe(true);
    });
  });

  // Re-QA do #346 (Teodora, 2026-10-17): o turno que acaba sem custo E sem consumo (0 tokens — caiu antes de rodar)
  // não tem nada fora da soma: não deixa parcial o bot, o dia, a frente nem o Raio-X.
  it("turno sem custo e sem tokens não deixa nada parcial: bot, dia, frente e Raio-X", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const w = (await criarTrabalho(c.deps, { agenteId: c.agenteId, conversaId: c.conversaId, titulo: "Revisar contrato", origem: "pessoa" })).trabalho;
      const desde = Date.now() - DIA;
      await c.rodar(resultado({ custoUsd: 0.4, sessaoCli: `s-${randomUUID()}` }), { trabalhoId: w.id });
      await c.rodar(resultado({ custoUsd: null, entrada: 0, saida: 0 }), { trabalhoId: w.id, harness: "codex-cli" });
      await new Promise((r) => setTimeout(r, 5));
      expect((await c.repos.trabalhos.buscar(w.id))?.custoParcial).toBeUndefined();
      const { data } = await lerCustoDoDia(c.deps, { fuso: "UTC" });
      expect(data.bots.find((b) => b.agenteId === c.agenteId)).toMatchObject({ hojeUsd: 0.4, tokens: 110, parcial: false });
      expect(data.parcial).toBe(false);
      const total = await c.repos.raioX.totalDesde(c.conversaId, desde);
      expect(total.turnos).toBe(1);
      expect(total.custoUsd).toBeCloseTo(0.4, 7);
      expect(total.parcial).toBeUndefined();
    });
  });
});
