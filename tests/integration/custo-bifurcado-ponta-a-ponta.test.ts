import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { REDE_MS } from "../../src/domain/trabalho.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { promoverNaRede } from "../../src/use-cases/coordenar-trabalhos.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * QA do PR #346 (NOD-291, definido em 2026-10-16): os testes do PR gravam a sessão-mãe chamando
 * `registrarSessaoOrigem` direto. Aqui o caminho real: a rede de 2 min promove o turno numa máquina que bifurca, a
 * próxima fala sai com `bifurcar`, o `emitirPlanoTurno` grava `sessao_origem_cli` e o assentar desconta o total da mãe.
 * E a mãe com mais de um total antes da cópia: o anterior é o MAIOR deles (o último), não o primeiro.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const sucesso = (sessaoCli: string, custoUsd: number): ResultadoTurno => ({ desfecho: "sucesso", texto: "feito", sessaoCli, sinais: SINAIS, custoUsd, tokens: { entrada: 100, saida: 10, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] });

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const agora = () => Date.now();
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const maquina = randomUUID();
  const turno = async () =>
    (await base.repos.turnos.enfileirar({ executor: "local", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "levante os números", entradaConfianca: "confiavel", modelo: "auto", harness: "claude-cli" }))!;
  /** Puxa o turno e devolve o plano, como a ponte. A frente que assenta enfileira a retomada do dono antes: ela é encerrada. */
  const despachar = async (turnoId: string) => {
    let pego = await base.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
    for (let i = 0; pego && pego.id !== turnoId && i < 5; i++) {
      await base.repos.turnos.assentar(pego.id, { estado: "concluido" });
      pego = await base.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
    }
    expect(pego?.id).toBe(turnoId);
    return (await emitirPlanoTurno(deps, { turnoId, machineId: maquina, executor: "local", harnesses: { "claude-cli": pronto } })).data;
  };
  const assentar = (turnoId: string, r: ResultadoTurno) =>
    assentarTurno(deps, { turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: r, executor: "local", harness: "claude-cli", maquinaBifurca: true });
  const origemGravada = async (turnoId: string) =>
    ((await trx`select sessao_origem_cli from turnos where id = ${turnoId}`) as unknown as { sessao_origem_cli: string | null }[])[0]?.sessao_origem_cli ?? null;
  return { ...base, deps, maquina, turno, despachar, assentar, origemGravada };
}

describeIntegracao("QA #346: o turno bifurcado pela rede grava a sessão-mãe e custa só a diferença", () => {
  it("rede promove na máquina que bifurca → a próxima fala sai com bifurcar, grava sessao_origem_cli e custa 164,22 − 162,55", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const mae = `mae-${randomUUID()}`;
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, mae, "local", "claude-cli");

      // O turno vivo vira frente pela rede, na máquina que bifurca: a sessão vai com a frente e fica na conversa.
      const vivo = await m.turno();
      expect((await m.despachar(vivo.id)).entrada.sessaoCli).toBe(mae);
      await promoverNaRede(m.deps, { turnoId: vivo.id, despachadoEm: Date.now() - REDE_MS, fezFerramenta: true, harness: "claude-cli", sessaoCli: mae, sessaoExecutor: "local", maquinaBifurca: true, modo: "conversa" });
      await m.assentar(vivo.id, sucesso(mae, 162.55));
      expect(await m.origemGravada(vivo.id)).toBeNull();

      // A próxima fala da pessoa bifurca a sessão da frente: o plano grava a mãe no turno.
      const copia = await m.turno();
      expect((await m.despachar(copia.id)).entrada).toMatchObject({ sessaoCli: mae, bifurcar: true });
      expect(await m.origemGravada(copia.id)).toBe(mae);

      // O CLI cria um id novo cujo total carrega o histórico da mãe: o turno custa só a diferença.
      await m.assentar(copia.id, sucesso(`copia-${randomUUID()}`, 164.22));
      expect((await m.repos.turnos.buscar(copia.id))?.custoUsd).toBeCloseTo(1.67, 7);
      const gastos = await m.repos.gastos.doTurno(copia.id);
      expect(gastos).toHaveLength(1);
      expect(gastos[0]?.custoUsd).toBeCloseTo(1.67, 7);
    });
  });

  it("a mãe com dois totais antes da cópia: o anterior é o maior (50), não o primeiro (10)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const mae = `mae-${randomUUID()}`;
      for (const total of [10, 50]) {
        const t = await m.turno();
        await m.despachar(t.id);
        await m.assentar(t.id, sucesso(mae, total));
      }
      const copia = await m.turno();
      await m.repos.turnos.registrarSessaoOrigem(copia.id, mae);
      await m.despachar(copia.id);
      await m.assentar(copia.id, sucesso(`copia-${randomUUID()}`, 52));
      expect((await m.repos.turnos.buscar(copia.id))?.custoUsd).toBeCloseTo(2, 7);
    });
  });
});
