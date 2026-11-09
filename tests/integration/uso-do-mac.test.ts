import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { criarRotasRaioX } from "../../src/adapters/http/rotas/raio-x.ts";
import type { OrigemTrabalho } from "../../src/contracts/trabalho.ts";
import type { Tx } from "../../src/shared/types.ts";
import { ESPERA_MAXIMA_FUNDO_MS } from "../../src/domain/memoria-mac.ts";
import { gravarPreferencias, lerPreferencias } from "../../src/use-cases/raio-x.ts";
import { criarTrabalho, listarTrabalhos } from "../../src/use-cases/trabalhos.ts";
import { esperarErro } from "../helpers/deps-l6.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-085 (definido em 2026-10-08): com o Mac apertado, o `reivindicar` segura só trabalho NOVO em segundo plano —
 * rotina e pedido de colega que ainda não começaram. Conversa, task aberta pela pessoa e trabalho já iniciado seguem.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

async function montar(trx: Tx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const turno = async (trabalhoId: string | null, origem: "conversa" | "rotina" = "conversa") => {
    const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId });
    if (!t) throw new Error("turno");
    return t;
  };
  const task = async (origem: OrigemTrabalho, titulo: string, pessoaEsperando = false) => (await criarTrabalho(deps, { agenteId: base.agenteId, conversaId: base.conversaId, titulo, origem, pessoaEsperando })).trabalho;
  /** Todos os turnos que o reivindicar entrega, um por faixa, até a fila (desta pessoa) não ter mais o que dar. */
  const reivindicarTudo = async (segurarFundo: boolean, meus: ReadonlySet<string>, espacarFundo = false, segurarNovo = false, fundoSemPrazo = false) => {
    const pegos: string[] = [];
    for (let i = 0; i < 40; i++) {
      const r = await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now(), segurarFundo, espacarFundo, segurarNovo, fundoSemPrazo });
      if (!r) break;
      if (meus.has(r.id)) pegos.push(r.id);
    }
    return pegos;
  };
  return { ...base, deps, repos, turno, task, reivindicarTudo };
}

describeIntegracao("uso do Mac (ADR-085)", () => {
  it("Mac apertado: rotina e pedido de colega novos esperam; conversa, task da pessoa e trabalho já iniciado seguem", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const rotina = await m.task("rotina", "Verificar o Slack");
      const colega = await m.task("colega", "Revisar o PR do Dev 2");
      const daPessoa = await m.task("pessoa", "Liberar espaço no Mac");
      const rotinaIniciada = await m.task("rotina", "Orquestrar a etapa de engenharia");
      await m.repos.trabalhos.mudarEstado(rotinaIniciada.id, "rodando", Date.now());
      const tConversa = await m.turno(null);
      const tRotina = await m.turno(rotina.id, "rotina");
      const tColega = await m.turno(colega.id);
      const tPessoa = await m.turno(daPessoa.id);
      const tIniciada = await m.turno(rotinaIniciada.id, "rotina");
      const meus = new Set([tConversa.id, tRotina.id, tColega.id, tPessoa.id, tIniciada.id]);

      const comMacApertado = await m.reivindicarTudo(true, meus);
      expect(new Set(comMacApertado)).toEqual(new Set([tConversa.id, tPessoa.id, tIniciada.id]));
      expect((await m.repos.turnos.buscar(tRotina.id))?.estado).toBe("pendente");
      expect((await m.repos.turnos.buscar(tColega.id))?.estado).toBe("pendente");

      // O Mac aliviou: os que esperavam saem na ordem de sempre.
      expect(new Set(await m.reivindicarTudo(false, meus))).toEqual(new Set([tRotina.id, tColega.id]));
    });
  });

  it("revisão do #209: quem a pessoa espera não é segurado; a espera máxima solta o antigo; o espaço segura até ele", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const agora = await m.task("rotina", "Executar agora", true);
      const antiga = await m.task("rotina", "Rotina das 9h");
      await trx`update trabalhos set criado_em = now() - make_interval(secs => ${(ESPERA_MAXIMA_FUNDO_MS + 60_000) / 1000}) where id = ${antiga.id}`;
      const nova = await m.task("colega", "Pedido de um bot");
      const tAgora = await m.turno(agora.id, "rotina");
      const tAntiga = await m.turno(antiga.id, "rotina");
      const tNova = await m.turno(nova.id);
      const meus = new Set([tAgora.id, tAntiga.id, tNova.id]);

      // Logo depois de um trabalho em segundo plano começar: só o que a pessoa espera sai, nem o antigo.
      expect(await m.reivindicarTudo(false, meus, true)).toEqual([tAgora.id]);
      // Mac apertado, sem o espaço: o antigo passou da espera máxima e sai; o novo espera.
      expect(await m.reivindicarTudo(true, meus)).toEqual([tAntiga.id]);
      expect(await m.reivindicarTudo(false, meus)).toEqual([tNova.id]);
    });
  });

  it("revisão do #224: a volta marcada vencida da task já começada não espera o Mac apertado nem o espaço — só o disco crítico", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const daPessoa = await m.task("pessoa", "Acompanhar o CI");
      await m.repos.trabalhos.mudarEstado(daPessoa.id, "rodando", Date.now());
      const volta = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "volta", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: daPessoa.id, acordarEm: Date.now() - 1_000 });
      const meus = new Set([volta!.id]);
      expect(await m.reivindicarTudo(true, meus, true, true)).toEqual([]);
      expect(await m.reivindicarTudo(true, meus, true)).toEqual([volta!.id]);
    });
  });

  it("a rota PUT preferencias avisa o puxar depois de gravar — só quando o uso do Mac vem, e não quando a gravação falha", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps } = depsSobre(trx, MARLON);
      const trocou = vi.fn();
      const services = { ...deps.services, trabalhosVivos: { ultimaFerramenta: () => null, memoria: () => null, trocouUsoDoMac: trocou } };
      const put = criarRotasRaioX({ abrirTx: () => (fn) => fn(trx), services, useCases: deps.useCases }).find((r) => r.metodo === "PUT" && r.padrao.test("/preferencias"))!;
      const chamar = (corpo: unknown) => put.handler({ escopo: MARLON, params: {}, corpo: async () => corpo, json: () => undefined } as never);
      await chamar({ modoDev: true });
      expect(trocou).not.toHaveBeenCalled();
      await chamar({ usoDoMac: "pouco" });
      expect(trocou).toHaveBeenCalledWith(PESSOA_MARLON);
      await esperarErro(() => chamar({ usoDoMac: "turbo" }), "entrada_invalida");
      expect(trocou).toHaveBeenCalledTimes(1);
    });
  });

  it("a preferência: padrão 'equilibrado', grava 'pouco' e 'livre', recusa valor fora do tipo e não apaga o resto", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps } = depsSobre(trx, MARLON);
      expect((await lerPreferencias(deps, {})).data.usoDoMac).toBe("equilibrado");
      await gravarPreferencias(deps, { modoDev: true });
      expect((await gravarPreferencias(deps, { usoDoMac: "pouco" })).data).toMatchObject({ usoDoMac: "pouco", modoDev: true });
      expect((await gravarPreferencias(deps, { usoDoMac: "livre" })).data.usoDoMac).toBe("livre");
      for (const usoDoMac of ["muito", 3, null, ""]) await esperarErro(() => gravarPreferencias(deps, { usoDoMac }), "entrada_invalida");
      expect((await lerPreferencias(deps, {})).data.usoDoMac).toBe("livre");
    });
  });

  it("a lista de Trabalhos: memória só de quem tem processo vivo; processador e 'segurando' pelo pior Mac e pela preferência", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const parada = await m.task("pessoa", "Esperando você responder");
      await m.repos.trabalhos.atualizarMemoria([]);
      await trx`update trabalhos set memoria_mb = 400 where id = ${parada.id}`;
      let leitura: { nivel: "verde" | "amarela" | "vermelha"; totalMb: number; processador: "verde" | "amarela" | "vermelha" | null; carga: number | null } | null = { nivel: "verde", totalMb: 600, processador: "vermelha", carga: 1.4 };
      const deps = { ...m.deps, services: { ...m.deps.services, trabalhosVivos: { ultimaFerramenta: () => null, memoria: () => leitura } } };

      const rotina = await m.task("rotina", "Verificar o Slack");
      // ADR-097: no equilibrado (o padrão) o processador cheio não segura; no "pouco", segura.
      expect((await listarTrabalhos(deps, {})).data.segurando).toBe(false);
      await gravarPreferencias(m.deps, { usoDoMac: "pouco" });
      const dto = (await listarTrabalhos(deps, {})).data;
      expect(dto.trabalhos.find((t) => t.id === parada.id)?.memoriaMb).toBeNull();
      // A linha diz "esperando o Mac aliviar" pela marca do servidor (a mesma regra do reivindicar).
      expect(dto.trabalhos.find((t) => t.id === rotina.id)?.seguravel).toBe(true);
      expect(dto.trabalhos.find((t) => t.id === parada.id)?.seguravel).toBe(false);
      expect(dto).toMatchObject({ pressao: "verde", processador: "vermelha", cargaProcessador: 1.4, segurando: true });

      await gravarPreferencias(m.deps, { usoDoMac: "livre" });
      expect((await listarTrabalhos(deps, {})).data.segurando).toBe(false);
      leitura = null;
      expect((await listarTrabalhos(deps, {})).data).toMatchObject({ processador: null, segurando: false });
    });
  });
  it("#219: disco crítico — nenhum trabalho novo começa (nem o da pessoa, o 'Executar agora' ou o antigo); conversa e o que já começou seguem", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const rotina = await m.task("rotina", "Verificar o Slack");
      const daPessoa = await m.task("pessoa", "Liberar espaço no Mac");
      const agora = await m.task("rotina", "Executar agora", true);
      const antiga = await m.task("colega", "Pedido antigo");
      await trx`update trabalhos set criado_em = now() - make_interval(secs => ${(ESPERA_MAXIMA_FUNDO_MS + 60_000) / 1000}) where id = ${antiga.id}`;
      const iniciada = await m.task("pessoa", "Migrar relatórios");
      await m.repos.trabalhos.mudarEstado(iniciada.id, "rodando", Date.now());
      const tConversa = await m.turno(null);
      const tRotina = await m.turno(rotina.id, "rotina");
      const tPessoa = await m.turno(daPessoa.id);
      const tAgora = await m.turno(agora.id, "rotina");
      const tAntiga = await m.turno(antiga.id);
      const tIniciada = await m.turno(iniciada.id);
      // A volta marcada ("me chame às 16:00") de outra task já começada: processo novo, ninguém esperando — também espera.
      const comVolta = await m.task("pessoa", "Acompanhar o CI");
      await m.repos.trabalhos.mudarEstado(comVolta.id, "rodando", Date.now());
      const volta = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "volta", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: comVolta.id, acordarEm: Date.now() - 1_000 });
      const meus = new Set([tConversa.id, tRotina.id, tPessoa.id, tAgora.id, tAntiga.id, tIniciada.id, volta!.id]);

      // O portão inteiro (o `puxar` manda os dois juntos): só a conversa e a task que já rodava.
      expect(new Set(await m.reivindicarTudo(true, meus, false, true))).toEqual(new Set([tConversa.id, tIniciada.id]));
      for (const t of [tRotina, tPessoa, tAgora, tAntiga, volta!]) expect((await m.repos.turnos.buscar(t.id))?.estado).toBe("pendente");
      // Liberou (memória normal, disco acima do mínimo): todos saem.
      expect(new Set(await m.reivindicarTudo(false, meus))).toEqual(new Set([tRotina.id, tPessoa.id, tAgora.id, tAntiga.id, volta!.id]));
    });
  });

  it("#219: memória crítica — o segundo plano novo espera mesmo passado da espera máxima; o pedido explícito da pessoa e a volta marcada da task já começada passam", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const antiga = await m.task("rotina", "Rotina das 9h");
      await trx`update trabalhos set criado_em = now() - make_interval(secs => ${(ESPERA_MAXIMA_FUNDO_MS + 60_000) / 1000}) where id = ${antiga.id}`;
      const agora = await m.task("rotina", "Executar agora", true);
      const daPessoa = await m.task("pessoa", "Task pedida na conversa");
      const comVolta = await m.task("pessoa", "Acompanhar o CI");
      await m.repos.trabalhos.mudarEstado(comVolta.id, "rodando", Date.now());
      const tAntiga = await m.turno(antiga.id, "rotina");
      const tAgora = await m.turno(agora.id, "rotina");
      const tPessoa = await m.turno(daPessoa.id);
      const volta = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "volta", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: comVolta.id, acordarEm: Date.now() - ESPERA_MAXIMA_FUNDO_MS - 60_000 });
      const meus = new Set([tAntiga.id, tAgora.id, tPessoa.id, volta!.id]);
      // Revisão do #224: a volta é o próximo passo de uma task já começada — passa com a memória crítica.
      expect(new Set(await m.reivindicarTudo(true, meus, false, false, true))).toEqual(new Set([tAgora.id, tPessoa.id, volta!.id]));
      expect(new Set(await m.reivindicarTudo(false, meus))).toEqual(new Set([tAntiga.id]));
    });
  });

  it("#219: a lista diz o motivo — disco crítico segura a task da pessoa em qualquer uso; disco em alerta e memória crítica, só o segundo plano", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      type Leitura = { nivel: "verde" | "amarela" | "vermelha"; totalMb: number; processador: "verde" | "amarela" | "vermelha" | null; carga: number | null; disco: { livreMb: number; totalMb: number } | null };
      const folgado = { livreMb: 200 * 1024, totalMb: 500 * 1024 };
      let leitura: Leitura | null = { nivel: "verde", totalMb: 600, processador: "verde", carga: 0.2, disco: { livreMb: 2 * 1024, totalMb: 466 * 1024 } };
      const deps = { ...m.deps, services: { ...m.deps.services, trabalhosVivos: { ultimaFerramenta: () => null, memoria: () => leitura } } };
      const rotina = await m.task("rotina", "Verificar o Slack");
      const daPessoa = await m.task("pessoa", "Liberar espaço no Mac");
      const iniciada = await m.task("pessoa", "Migrar relatórios");
      await m.repos.trabalhos.mudarEstado(iniciada.id, "rodando", Date.now());
      const espera = async () => {
        const dto = (await listarTrabalhos(deps, {})).data;
        const de = (id: string) => dto.trabalhos.find((t) => t.id === id)?.esperaDoMac ?? null;
        return { dto, rotina: de(rotina.id), pessoa: de(daPessoa.id), iniciada: de(iniciada.id) };
      };
      const limites = { alertaMb: 10 * 1024, criticoMb: 3 * 1024 };

      await gravarPreferencias(m.deps, { usoDoMac: "livre" });
      let r = await espera();
      expect(r.dto).toMatchObject({ segurando: true, motivoEspera: "disco", seguraTudoNovo: true, disco: { livreMb: 2 * 1024, totalMb: 466 * 1024, nivel: "vermelha", ...limites } });
      expect([r.rotina, r.pessoa, r.iniciada]).toEqual(["disco", "disco", null]);

      // Disco em alerta e memória crítica em "O quanto precisar": nada espera.
      leitura = { ...leitura, nivel: "vermelha", disco: { livreMb: 8 * 1024, totalMb: 466 * 1024 } };
      r = await espera();
      expect(r.dto).toMatchObject({ segurando: false, motivoEspera: null, seguraTudoNovo: false, disco: { nivel: "amarela" } });

      await gravarPreferencias(m.deps, { usoDoMac: "equilibrado" });
      r = await espera();
      expect(r.dto).toMatchObject({ segurando: true, motivoEspera: "memoria", seguraTudoNovo: false });
      expect([r.rotina, r.pessoa, r.iniciada]).toEqual(["memoria", null, null]);

      leitura = { ...leitura, nivel: "verde" };
      r = await espera();
      expect(r.dto).toMatchObject({ segurando: true, motivoEspera: "disco", seguraTudoNovo: false });
      expect([r.rotina, r.pessoa]).toEqual(["disco", null]);

      // Revisão do #224: a volta marcada vencida da task já começada, segurada pelo disco crítico, diz o motivo.
      const comVolta = await m.task("pessoa", "Acompanhar o CI");
      await m.repos.trabalhos.mudarEstado(comVolta.id, "rodando", Date.now());
      await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "volta", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: comVolta.id, acordarEm: Date.now() - 60_000 });
      const voltaDe = async () => (await listarTrabalhos(deps, {})).data.trabalhos.find((t) => t.id === comVolta.id)?.esperaDoMac ?? null;
      leitura = { ...leitura, disco: { livreMb: 2 * 1024, totalMb: 466 * 1024 } };
      expect(await voltaDe()).toBe("disco");
      leitura = { ...leitura, nivel: "vermelha", disco: folgado };
      expect(await voltaDe()).toBeNull();
      leitura = { ...leitura, nivel: "verde" };

      // Sem medição do disco (app anterior) e memória normal: nada espera.
      leitura = { ...leitura, disco: null };
      r = await espera();
      expect(r.dto).toMatchObject({ segurando: false, motivoEspera: null, seguraTudoNovo: false, disco: null });
      leitura = { ...leitura, disco: folgado };
      expect((await espera()).dto).toMatchObject({ segurando: false, disco: { nivel: "verde" } });
    });
  });
});
