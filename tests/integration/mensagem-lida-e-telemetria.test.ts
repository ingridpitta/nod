import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { registrarLinhas, taxasDasLinhas } from "../../src/use-cases/telemetria-linhas.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { agenteComConversa, autoriaAgente, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

describeIntegracao("mensagem lida com o turno e telemetria das linhas (#191, S2)", () => {
  it("GET da conversa: origemTurno, trabalhoId e fimDoTurno certos; as tasks abertas do bot e o trabalho do turno em curso", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const deps = depsSobre(repos, MARLON, { trx });
      const bot = autoriaAgente(agenteId, PESSOA_MARLON);
      const pessoa = autoriaPessoa(PESSOA_MARLON);
      const base = { conversaId, agenteId, prazoEm: Date.now() + 60_000, profundidade: 0 as const, entradaConfianca: "confiavel" as const, modelo: "m" };

      // Conversa: a pessoa fala, o bot fala no meio e no fim de um turno encerrado.
      const oi = await repos.mensagens.criar({ conversaId, autoria: pessoa, kind: "texto", texto: "oi", confianca: "confiavel" });
      const t1 = await repos.turnos.enfileirar({ executor: "catcher", ...base, origem: "conversa", entradaTexto: "oi", mensagemOrigemId: oi!.id });
      const meio = await repos.mensagens.criar({ conversaId, turnoId: t1!.id, autoria: bot, kind: "texto", texto: "Lendo o PR", confianca: "confiavel" });
      const fim = await repos.mensagens.criar({ conversaId, turnoId: t1!.id, autoria: bot, kind: "texto", texto: "Pronto: dois comentários.", confianca: "confiavel" });
      await repos.turnos.assentar(t1!.id, { estado: "concluido" });

      // Task: a fala da pessoa na tela dela e uma fala do bot num turno dela ainda rodando (nada é fim ainda).
      const w = (await criarTrabalho(deps, { agenteId, conversaId, titulo: "Login", origem: "pessoa" })).trabalho;
      const naTask = await repos.mensagens.criar({ conversaId, autoria: pessoa, kind: "texto", texto: "comece pelo Safari", confianca: "confiavel" });
      const tw = await repos.turnos.enfileirar({ executor: "catcher", ...base, origem: "conversa", entradaTexto: "x", trabalhoId: w.id, mensagemOrigemId: naTask!.id });
      await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      const doMeioDaTask = await repos.mensagens.criar({ conversaId, turnoId: tw!.id, autoria: bot, kind: "texto", texto: "Abrindo o Safari", confianca: "confiavel" });

      const r = await lerConversa(deps, { conversaId });
      const por = (id: string | undefined) => r.data.mensagens.find((m) => m.id === id);
      expect(por(oi?.id)).toMatchObject({ origemTurno: null, trabalhoId: null, fimDoTurno: false });
      expect(por(meio?.id)).toMatchObject({ origemTurno: "conversa", trabalhoId: null, fimDoTurno: false });
      expect(por(fim?.id)).toMatchObject({ origemTurno: "conversa", trabalhoId: null, fimDoTurno: true });
      expect(por(naTask?.id)).toMatchObject({ origemTurno: null, trabalhoId: w.id, fimDoTurno: false });
      expect(por(doMeioDaTask?.id)).toMatchObject({ origemTurno: "conversa", trabalhoId: w.id, fimDoTurno: false });
      expect(r.data.trabalhos?.map((t) => t.id)).toEqual([w.id]);
      expect(r.data.turnosEmCurso.find((t) => t.id === tw!.id)?.trabalhoId).toBe(w.id);

      // A janela é a mesma página lida: com limite, a última fala do turno continua sendo o fim dele.
      const curta = await lerConversa(deps, { conversaId, limite: 4 });
      expect(curta.data.mensagens.find((m) => m.id === fim?.id)?.fimDoTurno).toBe(true);
    });
  });

  it("telemetria: grava sem outbox, valida o lote e a taxa por tipo conta chaves distintas", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const deps = depsSobre(repos, MARLON, { trx });
      const ev = (acao: "mostrada" | "aberta", tipo: "rotina" | "bots" | "task" | "atividade" | "troca" | "frentes" | "revisor", chaveLinha: string) => ({ acao, tipo, agenteId, chaveLinha });
      // Chat limpo (PR 2, gatilho da ADR-114): a abertura da conversa é "mostrada" e a Atividade aberta logo depois, "aberta".
      const r = await registrarLinhas(deps, { eventos: [ev("mostrada", "rotina", "r:1"), ev("mostrada", "rotina", "r:1"), ev("mostrada", "rotina", "r:2"), ev("aberta", "rotina", "r:1"), ev("mostrada", "bots", "b:1"), ev("mostrada", "atividade", `atividade:${agenteId}:1`), ev("mostrada", "atividade", `atividade:${agenteId}:2`), ev("aberta", "atividade", `atividade:${agenteId}:2`), ev("mostrada", "troca", "troca:turno:1"), ev("aberta", "troca", "troca:turno:1"), ev("mostrada", "frentes", "frentes:m1"), ev("mostrada", "frentes", "frentes:m2"), ev("aberta", "frentes", "frentes:m2"), ev("mostrada", "revisor", "revisor:t1"), ev("mostrada", "revisor", "revisor:t2"), ev("aberta", "revisor", "revisor:t1")] });
      expect(r.data.gravados).toBe(16);
      const [linha] = await trx<{ n: number }[]>`select count(*)::int as n from events_outbox e join events v on v.id = e.evento_id where v.kind in ('linha_mostrada', 'linha_aberta') and v.owner_id = ${PESSOA_MARLON}`;
      expect(linha?.n).toBe(0);
      const taxas = (await taxasDasLinhas(deps, {})).data;
      expect(taxas).toEqual(expect.arrayContaining([
        { tipo: "rotina", mostradas: 2, abertas: 1, taxa: 0.5 },
        { tipo: "bots", mostradas: 1, abertas: 0, taxa: 0 },
        { tipo: "task", mostradas: 0, abertas: 0, taxa: null },
        { tipo: "atividade", mostradas: 2, abertas: 1, taxa: 0.5 },
        // Chat limpo (PR 3): a troca agrupada conta como as outras linhas, para o gatilho da ADR-083.
        { tipo: "troca", mostradas: 1, abertas: 1, taxa: 1 },
        // Chat limpo (PR 7): "ver as N" do progresso na fala, para o gatilho da ADR-099 (detalhe das frentes aberto).
        { tipo: "frentes", mostradas: 2, abertas: 1, taxa: 0.5 },
        // PR 4 dos modos de aprovação: "Revisor liberou … · ver" embaixo da fala.
        { tipo: "revisor", mostradas: 2, abertas: 1, taxa: 0.5 },
      ]));
      for (const ruim of [[], [{ ...ev("mostrada", "rotina", "r:1"), tipo: "outra" }], [{ ...ev("mostrada", "rotina", "texto com espaço") }], Array.from({ length: 201 }, () => ev("mostrada", "task", "t:1"))]) {
        await expect(registrarLinhas(deps, { eventos: ruim })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      }
    });
  });
});
