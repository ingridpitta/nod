import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IdHarness } from "../../src/contracts/harness.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { promoverNaRede } from "../../src/use-cases/coordenar-trabalhos.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** Revisão do épico #188 (2026-10-08): S13 (toda task tem pasta própria) e S14 (a sessão da task confere o executor). */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
const harnesses: Partial<Record<IdHarness, typeof pronto>> = { "claude-cli": pronto };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const sucesso = (sessaoCli: string): ResultadoTurno => ({ desfecho: "sucesso", texto: "feito", sessaoCli, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] });

describeIntegracao("revisão #188 — pasta e sessão das tasks", () => {
  it("S13: a task da rede ganha pasta própria; o turno promovido segue, e o seguinte roda nela", async () => {
    await withRollback(MARLON, async (trx) => {
      let relogio = Date.now();
      const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
      const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora: () => relogio, tokens: criarTokenTurno({ agora: () => relogio }) }), agora: () => relogio, trx });
      const turno = async (trabalhoId: string | null = null) => (await base.repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: relogio + 600_000, profundidade: 0, entradaTexto: "monte o relatório", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId }))!;
      const vivo = await turno();
      await base.repos.turnos.reivindicar({ machineId: randomUUID(), agora: relogio });
      const em = relogio;
      relogio += 121_000;
      const r = await promoverNaRede(deps, { turnoId: vivo.id, despachadoEm: em, fezFerramenta: true, harness: "claude-cli", sessaoCli: "s-1", sessaoExecutor: "local", maquinaBifurca: true });
      const w = r.data.trabalho!;
      expect(w.pasta).toMatch(/^~\/nod\/Ada\/monte-o-relatorio-[a-z0-9]{6}$/);
      expect(w.sessaoExecutor).toBe("local");
      const seguinte = await turno(w.id);
      const p = (await emitirPlanoTurno(deps, { turnoId: seguinte.id, machineId: randomUUID(), executor: "local", harnesses })).data;
      expect(p.pastaDoBot).toBe(w.pasta!.slice("~/nod/".length));
      expect(p.entrada.sessaoCli).toBe("s-1");
    });
  });

  it("S14: a sessão da task só é retomada pelo executor que a criou", async () => {
    await withRollback(MARLON, async (trx) => {
      const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
      const agora = () => Date.now();
      const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
      const w = (await criarTrabalho(deps, { agenteId: base.agenteId, conversaId: base.conversaId, titulo: "Login", origem: "pessoa" })).trabalho;
      const turno = async () => (await base.repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: w.id }))!;
      const t1 = await turno();
      const maquina = randomUUID();
      await base.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
      await assentarTurno(deps, { turnoId: t1.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso("sessao-do-catcher"), executor: "catcher" });
      expect(await base.repos.trabalhos.buscar(w.id)).toMatchObject({ sessaoCli: "sessao-do-catcher", sessaoExecutor: "catcher" });

      const t2 = await turno();
      const local = (await emitirPlanoTurno(deps, { turnoId: t2.id, machineId: randomUUID(), executor: "local", harnesses })).data;
      expect(local.entrada.sessaoCli).toBeNull();
      expect(local.promptSistema).toContain('"historico"');
      const catcher = (await emitirPlanoTurno(deps, { turnoId: t2.id, machineId: randomUUID(), executor: "catcher" })).data;
      expect(catcher.entrada.sessaoCli).toBe("sessao-do-catcher");
    });
  });
});

describeIntegracao("revisão #188 — a sessão do turno promovido (S16)", () => {
  const montarRede = async (trx: Parameters<Parameters<typeof withRollback>[1]>[0]) => {
    const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
    await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
    const agora = () => Date.now();
    const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
    const vivo = (await base.repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "monte", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
    const maquina = randomUUID();
    await base.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
    // O turno bifurcou (ou começou sessão nova): a promoção não sabe a sessão dele.
    const w = (await criarTrabalho(deps, { agenteId: base.agenteId, conversaId: base.conversaId, titulo: "Promovido", origem: "rede", estado: "rodando", sessaoCli: null, pasta: null })).trabalho;
    await base.repos.turnos.vincularTrabalho(vivo.id, w.id);
    const entregar = () => assentarTurno(deps, { turnoId: vivo.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso("sessao-nova-f"), executor: "local", harness: "claude-cli" });
    return { ...base, deps, w, entregar };
  };

  it("a sessão que o promovido devolve vira também a da conversa (senão a próxima bifurcava a antiga e perdia o turno)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montarRede(trx);
      await m.entregar();
      expect((await m.repos.conversas.buscar(m.conversaId))?.sessaoCli).toBe("sessao-nova-f");
      expect((await m.repos.trabalhos.buscar(m.w.id))?.sessaoCli).toBe("sessao-nova-f");
    });
  });

  it("a conversa que ganhou sessão nova depois da promoção fica com a dela", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montarRede(trx);
      await new Promise((r) => setTimeout(r, 15));
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, "sessao-da-conversa-depois", "local", "claude-cli");
      await m.entregar();
      expect((await m.repos.conversas.buscar(m.conversaId))?.sessaoCli).toBe("sessao-da-conversa-depois");
      expect((await m.repos.trabalhos.buscar(m.w.id))?.sessaoCli).toBe("sessao-nova-f");
    });
  });
});
