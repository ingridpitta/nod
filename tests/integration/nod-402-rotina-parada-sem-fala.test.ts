import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { dispararRotina, registrarDesfechoRotina } from "../../src/use-cases/disparar-rotina.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { pedirAPessoa } from "../../src/use-cases/pedir-a-pessoa.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const parado = (texto: string) => ({ desfecho: "interrompido" as const, motivoInterrupcao: "parado_pela_pessoa" as const, texto, sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] });

/**
 * NOD-402: o Parar do chat também para a rotina em curso (NOD-252), mas a fala cortada dela não vira mensagem no chat —
 * a rotina roda em segundo plano e não tem nada para a pessoa. A execução continua no histórico.
 */
describeIntegracao("NOD-402: rotina parada pela pessoa não deixa fala cortada no chat", () => {
  it("rotina em curso, Parar, assentamento com texto parcial: só a linha 'Parei também a rotina'; a execução fica no histórico", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Cecília" });
      const { deps, repos } = depsSobre(trx, MARLON);
      const agora = Date.now();
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "slack", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: agora });
      const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: agora, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in r.data)) throw new Error("deveria disparar");
      const turnoId = r.data.turno.id;
      const maquina = randomUUID();
      for (let i = 0; i < 10; i++) {
        const t = await repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
        if (!t || t.id === turnoId) break;
      }
      expect((await repos.turnos.buscar(turnoId))?.bastidores).toBe(true);
      await repos.turnos.pedirInterrupcao([turnoId], Date.now());

      await assentarTurno(deps, { turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "Abri o Slack e comecei a ler o" }, resultado: parado("Abri o Slack e comecei a ler o"), executor: "catcher" });
      expect(await repos.turnos.buscar(turnoId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      const textos = (await repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.kind === "texto");
      // Só a linha que diz que o Parar parou a rotina junto (revisão 12); a fala cortada não entra.
      expect(textos.map((m) => m.texto)).toEqual(["Parei também a rotina que rodava em segundo plano."]);
      // O histórico (a ponte interna registra o desfecho depois do assentamento) segue mostrando a execução.
      await registrarDesfechoRotina(deps, { turnoId, desfecho: "interrompida", motivo: "parado_pela_pessoa" });
      const execucoes = await repos.rotinaExecucoes.listar(rotina!.id);
      expect(execucoes.map((e) => [e.desfecho, e.turnoId])).toEqual([["interrompida", turnoId]]);
    });
  });
});

describeIntegracao("NOD-402: a frente da rotina parada guarda a fala cortada", () => {
  it("turno dos bastidores com trabalho (a frente): o Parar segue o de sempre — a fala parcial fica, sem a linha 'Parei também'", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Cecília" });
      const { deps, repos } = depsSobre(trx, MARLON);
      const agora = Date.now();
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "slack", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: agora });
      const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: agora, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in r.data)) throw new Error("deveria disparar");
      const turnoId = r.data.turno.id;
      const maquina = randomUUID();
      for (let i = 0; i < 10; i++) {
        const t = await repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
        if (!t || t.id === turnoId) break;
      }
      const { trabalho } = await criarTrabalho(deps, { agenteId, conversaId, titulo: "frente", origem: "rotina", pessoaEsperando: false });
      await trx`update turnos set trabalho_id = ${trabalho.id} where id = ${turnoId}`;
      await repos.turnos.pedirInterrupcao([turnoId], Date.now());
      await assentarTurno(deps, { turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "Abri o Slack e comecei a ler o" }, resultado: parado("Abri o Slack e comecei a ler o"), executor: "catcher" });
      const textos = (await repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.kind === "texto" && m.turnoId === turnoId).map((m) => m.texto);
      expect(textos).not.toContain("Parei também a rotina que rodava em segundo plano.");
    });
  });
});

describeIntegracao("NOD-402: a pergunta da rotina sai no frame com a marca dos bastidores", () => {
  it("decisao_criada leva mensagem_json com bastidores: true (a web a segura fora do turno da pessoa)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Cecília" });
      const { deps, repos } = depsSobre(trx, MARLON);
      const agora = Date.now();
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "slack", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: agora });
      const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: agora, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in r.data)) throw new Error("deveria disparar");
      const turnoId = r.data.turno.id;
      const pergunta = await pedirAPessoa(deps, { turnoId, conversaId, agenteId, tipo: "falta_de_dado", texto: "falta a planilha", dado: "planilha" });
      const json = pergunta.events?.[0]?.dados.mensagem_json;
      expect(typeof json).toBe("string");
      expect(JSON.parse(json as string)).toMatchObject({ turnoId, bastidores: true, payload: { kind: "pedido_a_pessoa" } });
    });
  });
});
