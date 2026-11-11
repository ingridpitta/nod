import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import type { Tx } from "../../src/shared/types.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { aplicarLoteQuadro, type PedidoLote } from "../../src/use-cases/quadro.ts";
import { trabalhoDaTarefa, trabalhosParaBot, verTrabalhos } from "../../src/use-cases/quadro-execucoes.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADA-10 (0165, emenda da ADR-163 §3): as etapas seguidas da tarefa com o mesmo bot são UMA sessão. O mesmo trabalho, o
 * mesmo --resume e o mesmo número na tela ("Trabalho #1" em Plano e em Implementando); a sessão nova só vem quando muda
 * o responsável ou quando a pessoa pede (Repetir, que larga a sessão do motor e abre o número seguinte).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const sucesso = (sessaoCli: string) => ({ desfecho: "sucesso", texto: "feito", sessaoCli, sinais: SINAIS, custoUsd: 0.1, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] }) as unknown as ResultadoTurno;

async function montar(trx: Tx) {
  const sufixo = Math.random().toString(36).slice(2, 7);
  const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${sufixo}` });
  const beto = await agenteComConversa(trx, MARLON, { nome: `Beto ${sufixo}` });
  const caio = await agenteComConversa(trx, MARLON, { nome: `Caio ${sufixo}` });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => Date.now() });
  await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const nomes = { beto: `Beto ${sufixo}`, caio: `Caio ${sufixo}` };
  const p: PedidoLote = { autor: { tipo: "pessoa" }, anfitriaoId: ana.agenteId, executor: "catcher", ops: [] };
  const lote = async (o: OpQuadro[]) => {
    const r = await aplicarLoteQuadro(m.deps, { ...p, ops: o });
    if (!r.data.ok) throw new Error(r.data.detalhe);
    return r.data;
  };
  const m = { ana, beto, caio, nomes, deps, repos, p, lote };
  // As etapas de um quadro de engenharia: colunas de andamento com passagem para o mesmo bot (é a passagem que aciona na troca de coluna).
  await lote([
    { tipo: "criar_quadro" },
    { tipo: "criar_coluna", nome: "Pronto para engenharia", grupo: "iniciado" },
    { tipo: "criar_coluna", nome: "Plano de engenharia", grupo: "iniciado", depois_de: "Pronto para engenharia" },
    { tipo: "renomear_coluna", coluna: "fazendo", nome: "Implementando" },
  ]);
  await lote(["Pronto para engenharia", "Plano de engenharia", "fazendo", "revisao"].map((coluna) => ({ tipo: "definir_passagem", coluna, agente: nomes.beto }) as OpQuadro));
  const tarefa = async () => {
    const q = await repos.quadros.doAgente(ana.agenteId);
    return (await repos.quadros.tarefas(q!.id)).find((t) => t.titulo === "T")!;
  };
  /** O turno atual da tarefa roda numa máquina e assenta com a sessão dada (o que o motor faria). */
  const rodar = async (sessaoCli: string) => {
    const maquina = randomUUID();
    const turno = await repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
    if (!turno) throw new Error("nada na fila");
    const plano = (await emitirPlanoTurno(deps, { turnoId: turno.id, machineId: maquina, executor: "catcher" })).data;
    await assentarTurno(deps, { turnoId: turno.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso(sessaoCli), executor: "catcher" });
    return { turno: (await repos.turnos.buscar(turno.id))!, retomou: plano.entrada.sessaoCli };
  };
  const linhas = async () => (await verTrabalhos(deps, { agenteId: ana.agenteId, tarefaId: (await tarefa()).id })).data.execucoes.slice().reverse();
  return { ...m, tarefa, rodar, linhas };
}

describeIntegracao("etapas seguidas com o mesmo bot continuam na mesma sessão (ADA-10)", () => {
  it("Pronto → Plano → Implementando com o mesmo bot: um trabalho, o mesmo --resume e o mesmo número, com a etapa na linha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote([{ tipo: "criar_tarefa", titulo: "T", status: "Pronto para engenharia", agente: m.nomes.beto }]);
      const pronto = await m.rodar("sessao-beto");
      expect(pronto.retomou).toBeNull();

      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "Plano de engenharia" }]);
      const plano = await m.rodar("sessao-beto");
      expect(plano.turno.trabalhoId).toBe(pronto.turno.trabalhoId);
      expect(plano.retomou).toBe("sessao-beto");

      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "fazendo" }]);
      const impl = await m.rodar("sessao-beto");
      expect(impl.turno.trabalhoId).toBe(pronto.turno.trabalhoId);
      expect(impl.retomou).toBe("sessao-beto");

      const ls = await m.linhas();
      expect(ls.map((l) => l.numero)).toEqual([1, 2, 3]);
      expect(ls.map((l) => l.sessao)).toEqual([1, 1, 1]);
      expect(ls.map((l) => l.colunaNome)).toEqual(["Pronto para engenharia", "Plano de engenharia", "Implementando"]);
      // O bot lê a sessão, não o gatilho.
      expect((await trabalhosParaBot(m.deps, [(await m.tarefa()).id])).get((await m.tarefa()).id)?.numero).toBe(1);
    });
  });

  it("muda o responsável: sessão nova (o trabalho do outro bot); voltar ao primeiro retoma a sessão dele", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote([{ tipo: "criar_tarefa", titulo: "T", status: "fazendo", agente: m.nomes.beto }]);
      const doBeto = await m.rodar("sessao-beto");

      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", agente: m.nomes.caio }]);
      const doCaio = await m.rodar("sessao-caio");
      expect(doCaio.turno.trabalhoId).not.toBe(doBeto.turno.trabalhoId);
      expect(doCaio.retomou).toBeNull();

      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", agente: m.nomes.beto }]);
      const deVolta = await m.rodar("sessao-beto");
      expect(deVolta.turno.trabalhoId).toBe(doBeto.turno.trabalhoId);
      expect(deVolta.retomou).toBe("sessao-beto");

      expect((await m.linhas()).map((l) => l.sessao)).toEqual([1, 2, 1]);
    });
  });

  it("Repetir: a sessão do motor sai (o turno vai sem --resume), o trabalho e a pasta ficam, e o número é o seguinte", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote([{ tipo: "criar_tarefa", titulo: "T", status: "fazendo", agente: m.nomes.beto }]);
      const antes = await m.rodar("sessao-velha");

      const r = await trabalhoDaTarefa(m.deps, m.p, { tipo: "repetir_trabalho", tarefa: "T" });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      // O que o bot e a pessoa leem: "Trabalho #2 aberto".
      expect(r.data.trabalho).toMatchObject({ numero: 2, estado: "fila" });
      expect((await m.repos.trabalhos.buscar(antes.turno.trabalhoId!))?.sessaoCli).toBeNull();
      const repetido = await m.rodar("sessao-nova");
      expect(repetido.turno.trabalhoId).toBe(antes.turno.trabalhoId);
      expect(repetido.retomou).toBeNull();

      // A etapa seguinte continua a sessão nova, com o número dela.
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "revisao" }]);
      const seguinte = await m.rodar("sessao-nova");
      expect(seguinte.retomou).toBe("sessao-nova");
      expect((await m.linhas()).map((l) => [l.origem, l.sessao])).toEqual([["inicio", 1], ["repetir", 2], ["inicio", 2]]);
    });
  });

  it("Repetir que não abre turno (o bot sem conversa própria) não larga a sessão do motor", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote([{ tipo: "criar_tarefa", titulo: "T", status: "fazendo", agente: m.nomes.beto }]);
      const antes = await m.rodar("sessao-velha");
      // O caminho do `null` do abrirTurno: sem a conversa própria do bot, nenhum turno nasce.
      const conversas = m.deps.repos.conversas;
      m.deps.repos.conversas = { ...conversas, buscarPropriaDoAgente: async () => null };
      const r = await trabalhoDaTarefa(m.deps, m.p, { tipo: "repetir_trabalho", tarefa: "T" });
      m.deps.repos.conversas = conversas;
      expect(r.data.ok).toBe(false);
      // A etapa seguinte do bot ainda retoma a sessão dele: o Repetir que falhou não apagou o contexto.
      expect((await m.repos.trabalhos.buscar(antes.turno.trabalhoId!))?.sessaoCli).toBe("sessao-velha");
    });
  });

  // QA do PR marlonwlv/nod#11: Cancelar e Repetir antes de a máquina entregar o turno cancelado. A entrega tardia trazia
  // a sessão velha de volta ao trabalho (propagarSessaoDoTurno) e o turno do Repetir saía com --resume dela.
  const turnoNoAr = async (m: Awaited<ReturnType<typeof montar>>) => {
    const maquina = randomUUID();
    const turno = await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
    if (!turno) throw new Error("nada na fila");
    await emitirPlanoTurno(m.deps, { turnoId: turno.id, machineId: maquina, executor: "catcher" });
    const entregar = (sessaoCli: string) => assentarTurno(m.deps, { turnoId: turno.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "x" }, resultado: sucesso(sessaoCli), executor: "catcher" });
    return { trabalhoId: turno.trabalhoId!, entregar };
  };
  const op = async (m: Awaited<ReturnType<typeof montar>>, o: Parameters<typeof trabalhoDaTarefa>[2]) => {
    const r = await trabalhoDaTarefa(m.deps, m.p, o);
    if (!r.data.ok) throw new Error(r.data.detalhe);
  };

  it("Cancelar e Repetir antes da entrega do turno cancelado: a entrega tardia não devolve a sessão velha ao Repetir", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote([{ tipo: "criar_tarefa", titulo: "T", status: "fazendo", agente: m.nomes.beto }]);
      await m.rodar("sessao-velha");
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "revisao" }]);
      const noAr = await turnoNoAr(m);
      await op(m, { tipo: "cancelar_trabalho", tarefa: "T" });
      await op(m, { tipo: "repetir_trabalho", tarefa: "T" });
      await noAr.entregar("sessao-velha");
      expect((await m.repos.trabalhos.buscar(noAr.trabalhoId))?.sessaoCli).toBeNull();
      expect((await m.rodar("sessao-nova")).retomou).toBeNull();
      // Só o turno de antes do Repetir fica de fora: os de depois seguem gravando a sessão deles.
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "fazendo" }]);
      expect((await m.rodar("sessao-depois")).retomou).toBe("sessao-nova");
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "revisao" }]);
      expect((await m.rodar("sessao-depois")).retomou).toBe("sessao-depois");
    });
  });

  it("Cancelar sem Repetir: a entrega tardia ainda guarda a sessão, e a etapa seguinte a retoma", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote([{ tipo: "criar_tarefa", titulo: "T", status: "fazendo", agente: m.nomes.beto }]);
      await m.rodar("sessao-1");
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "revisao" }]);
      const noAr = await turnoNoAr(m);
      await op(m, { tipo: "cancelar_trabalho", tarefa: "T" });
      await noAr.entregar("sessao-2");
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "fazendo" }]);
      expect((await m.rodar("sessao-2")).retomou).toBe("sessao-2");
    });
  });

  it("linha gravada por um servidor de antes da 0165 (sem sessão): vale o número dela e a próxima não colide", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote([{ tipo: "criar_tarefa", titulo: "T", status: "fazendo", agente: m.nomes.beto }]);
      await m.rodar("s");
      await trx`update quadro_execucoes set sessao = null, agente_id = null, coluna = null where tarefa_id = ${(await m.tarefa()).id}`;
      expect((await m.linhas())[0]).toMatchObject({ numero: 1, sessao: 1, colunaNome: null });
      await m.lote([{ tipo: "mudar_tarefa", tarefa: "T", status: "revisao" }]);
      // Sem o bot na linha antiga, a nova não acha a sessão dele: abre a 2 (nunca repete um número de outra).
      expect((await m.linhas()).map((l) => l.sessao)).toEqual([1, 2]);
    });
  });
});
