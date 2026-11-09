import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Repos } from "../../src/repositories/tipos.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const INICIO = Date.parse("2026-09-01T12:00:00Z");
const CNPJ = "o CNPJ da Lumen é 12.345.678/0001-90";

/** 60 memórias do bot: a 1ª (a mais antiga) é o CNPJ; as outras falam de outros assuntos; a última é "fato 59". */
async function semearSessenta(repos: Repos, agenteId: string): Promise<void> {
  await repos.memorias.criar({ agenteId, tipo: "fato", texto: CNPJ, origem: "pessoa", criadoEm: INICIO });
  for (let i = 1; i < 60; i++) {
    await repos.memorias.criar({ agenteId, tipo: "fato", texto: `fato ${i}: reunião semanal número ${i} sobre roadmap`, origem: "pessoa", criadoEm: INICIO + i * 60_000 });
  }
}

describeIntegracao("NOD-60 (ADR-136): recall de memória por busca léxica", () => {
  it("buscarPorTexto acha a memória antiga pela pergunta (um termo basta), só do próprio bot; stopwords não acham nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const outro = await agenteComConversa(trx, MARLON, { nome: "Outro" });
      const { repos } = depsSobre(trx, MARLON);
      await semearSessenta(repos, agenteId);
      await repos.memorias.criar({ agenteId: outro.agenteId, tipo: "fato", texto: "o CNPJ da Lumen (do outro bot)", origem: "pessoa" });

      const achadas = await repos.memorias.buscarPorTexto(agenteId, "qual o CNPJ da Lumen?", 40);
      expect(achadas.map((m) => m.texto)).toEqual([CNPJ]);
      // Sem acento e com flexão (nod_pt = portuguese + unaccent): "reuniao" e "semanais" acham "reunião semanal".
      expect(await repos.memorias.buscarPorTexto(agenteId, "reuniao semanais", 100)).toHaveLength(59);
      expect(await repos.memorias.buscarPorTexto(agenteId, "reuniao", 5)).toHaveLength(5);
      expect(await repos.memorias.buscarPorTexto(agenteId, "o que é de da", 40)).toEqual([]);
      expect(await repos.memorias.buscarPorTexto(agenteId, "?!&|()'", 40)).toEqual([]);
      expect(await repos.memorias.buscarPorTexto(outro.agenteId, "CNPJ", 40)).toHaveLength(1);
    });
  });

  it("buscarPorTexto ordena por relevância: a que casa mais termos vem antes, mesmo mais antiga", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { repos } = depsSobre(trx, MARLON);
      await repos.memorias.criar({ agenteId, tipo: "fato", texto: "o CNPJ da Lumen fica no contrato", origem: "pessoa", criadoEm: INICIO });
      await repos.memorias.criar({ agenteId, tipo: "fato", texto: "a Lumen paga no dia 10", origem: "pessoa", criadoEm: INICIO + 1000 });
      expect((await repos.memorias.buscarPorTexto(agenteId, "CNPJ da Lumen", 40)).map((m) => m.texto)).toEqual(["o CNPJ da Lumen fica no contrato", "a Lumen paga no dia 10"]);
    });
  });

  it("a 0123 cria search_tsv gerada com nod_pt", async () => {
    await withRollback(MARLON, async (trx) => {
      const [col] = await trx<{ is_generated: string; generation_expression: string }[]>`
        select is_generated, generation_expression from information_schema.columns where table_name = 'agente_memorias' and column_name = 'search_tsv'`;
      expect(col).toMatchObject({ is_generated: "ALWAYS", generation_expression: expect.stringContaining("nod_pt") });
    });
  });

  it("turno com 60 memórias: o prompt leva a mais recente e a antiga achada pela mensagem; o Raio-X conta núcleo e busca", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON);
      await semearSessenta(repos, agenteId);

      const pergunta = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "Qual o CNPJ da Lumen?", entradaConfianca: "confiavel", modelo: "m" });
      const comBusca = await emitirPlanoTurno(deps, { turnoId: pergunta!.id, machineId: randomUUID() });
      expect(comBusca.data.promptSistema).toContain(`- [fato] ${CNPJ}`);
      expect(comBusca.data.promptSistema).toContain("- [fato] fato 59:");
      expect(comBusca.data.promptSistema).not.toContain("- [fato] fato 1:");
      expect((await repos.raioX.doTurno(pergunta!.id))?.composicao?.memoria).toEqual({ total: 60, nucleo: 39, recall: 1 });

      // Mensagem sem relação: o CNPJ não entra (as vagas vão para as mais recentes).
      const outra = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "bom dia", entradaConfianca: "confiavel", modelo: "m" });
      const semBusca = await emitirPlanoTurno(deps, { turnoId: outra!.id, machineId: randomUUID() });
      expect(semBusca.data.promptSistema).not.toContain(CNPJ);
      expect(semBusca.data.promptSistema).toContain("- [fato] fato 59:");
      expect((await repos.raioX.doTurno(outra!.id))?.composicao?.memoria).toEqual({ total: 60, nucleo: 40, recall: 0 });
    });
  });

  it("achadas que já estão no núcleo não gastam a busca: a antiga com um termo só ainda entra atrás de 20 recentes que casam mais", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON);
      await repos.memorias.criar({ agenteId, tipo: "fato", texto: "o CNPJ antigo era 98.765.432/0001-10", origem: "pessoa", criadoEm: INICIO });
      for (let i = 1; i < 40; i++) await repos.memorias.criar({ agenteId, tipo: "fato", texto: `fato ${i}: roadmap ${i}`, origem: "pessoa", criadoEm: INICIO + i * 60_000 });
      for (let i = 40; i < 60; i++) await repos.memorias.criar({ agenteId, tipo: "fato", texto: `fato ${i}: o CNPJ da Lumen aparece na nota ${i}`, origem: "pessoa", criadoEm: INICIO + i * 60_000 });
      const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "qual o CNPJ da Lumen?", entradaConfianca: "confiavel", modelo: "m" });
      const { data } = await emitirPlanoTurno(deps, { turnoId: t!.id, machineId: randomUUID() });
      expect(data.promptSistema).toContain("- [fato] o CNPJ antigo era");
    });
  });

  it("retomada (depois de uma aprovação) busca pela fala que começou a cadeia, não pelo texto do sistema", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON);
      await semearSessenta(repos, agenteId);
      const raiz = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "Emita a nota com o CNPJ da Lumen", entradaConfianca: "confiavel", modelo: "m" });
      const retomada = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "retomada", retomaTurnoId: raiz!.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "Continuando a tarefa: a pessoa decidiu a aprovação.", entradaConfianca: "confiavel", modelo: "m" });
      const buscarRaiz = repos.turnos.raizDaCadeia;
      let buscasDaRaiz = 0;
      repos.turnos.raizDaCadeia = async (id) => { buscasDaRaiz++; return await buscarRaiz(id); };
      const { data } = await emitirPlanoTurno(deps, { turnoId: retomada!.id, machineId: randomUUID() });
      expect(data.promptSistema).toContain(`- [fato] ${CNPJ}`);
      expect(buscasDaRaiz).toBe(1);

      // A resposta da pessoa vem na retomada ("qual empresa?" → "Lumen"): ela também entra na busca.
      const pergunta = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "Emita a nota fiscal", entradaConfianca: "confiavel", modelo: "m" });
      const resposta = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "retomada", retomaTurnoId: pergunta!.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "Resposta de Marlon ao seu pedido (qual empresa?): Lumen", entradaConfianca: "confiavel", modelo: "m" });
      const comResposta = await emitirPlanoTurno(deps, { turnoId: resposta!.id, machineId: randomUUID() });
      expect(comResposta.data.promptSistema).toContain(`- [fato] ${CNPJ}`);
    });
  });

  it("memória que cabe inteira não roda a busca; a busca que falha não derruba o turno (savepoint)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON);
      let buscas = 0;
      repos.memorias.buscarPorTexto = async () => {
        buscas++;
        await trx`select 1/0`;
        return [];
      };
      for (let i = 0; i < 30; i++) await repos.memorias.criar({ agenteId, tipo: "fato", texto: `fato ${i}: CNPJ`, origem: "pessoa", criadoEm: INICIO + i });
      const curto = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "qual o CNPJ?", entradaConfianca: "confiavel", modelo: "m" });
      await emitirPlanoTurno(deps, { turnoId: curto!.id, machineId: randomUUID() });
      expect(buscas).toBe(0);

      for (let i = 30; i < 60; i++) await repos.memorias.criar({ agenteId, tipo: "fato", texto: `fato ${i}: CNPJ`, origem: "pessoa", criadoEm: INICIO + i });
      const longo = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "qual o CNPJ?", entradaConfianca: "confiavel", modelo: "m" });
      const { data } = await emitirPlanoTurno(deps, { turnoId: longo!.id, machineId: randomUUID() });
      expect(buscas).toBe(1);
      expect(data.promptSistema).toContain("- [fato] fato 59: CNPJ");
      expect((await repos.raioX.doTurno(longo!.id))?.composicao?.memoria).toEqual({ total: 60, nucleo: 40, recall: 0 });
    });
  });

  it("rotina busca pela instrução; retomada soma a resposta da pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.parse("2026-09-24T08:00:30-03:00");
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Nina" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true, descricao: "Cuida do faturamento" });
      await semearSessenta(repos, agenteId);
      // "planilha" está no embrulho da entrada (a fonte), não na instrução: não pode virar recall.
      await repos.memorias.criar({ agenteId, tipo: "fato", texto: "a planilha de custos fica no Drive", origem: "pessoa", criadoEm: INICIO - 60_000 });
      const projeto = "o projeto Mercury usa a conta do banco 4321";
      await repos.memorias.criar({ agenteId, tipo: "fato", texto: projeto, origem: "pessoa", criadoEm: INICIO - 120_000 });
      const criada = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "Emitir a nota com o CNPJ da Lumen", fonte: "planilha", entregavel: "nota", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: agora - 30_000 });
      const rotina = await repos.rotinas.buscar(criada!.id);
      const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: agora - 30_000, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in r.data)) throw new Error("janela de outro");
      const { data } = await emitirPlanoTurno(deps, { turnoId: r.data.turno.id, machineId: randomUUID() });
      expect(data.promptSistema).toContain(`- [fato] ${CNPJ}`);
      expect(data.promptSistema).not.toContain("planilha de custos");
      expect(data.promptSistema).not.toContain(projeto);
      expect((await repos.raioX.doTurno(r.data.turno.id))?.composicao?.memoria).toEqual({ total: 62, nucleo: 39, recall: 1 });

      const retomada = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "retomada", retomaTurnoId: r.data.turno.id, prazoEm: agora + 600_000, profundidade: 0, entradaTexto: "Resposta de Marlon: o projeto é o Mercury", entradaConfianca: "confiavel", modelo: "m" });
      const retomadaEmitida = await emitirPlanoTurno(deps, { turnoId: retomada!.id, machineId: randomUUID() });
      expect(retomadaEmitida.data.promptSistema).toContain(`- [fato] ${CNPJ}`);
      expect(retomadaEmitida.data.promptSistema).toContain(`- [fato] ${projeto}`);
      expect((await repos.raioX.doTurno(retomada!.id))?.composicao?.memoria).toEqual({ total: 62, nucleo: 38, recall: 2 });
    });
  });
});
