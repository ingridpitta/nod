import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-expiracao.ts";
import { criarRotasConversas } from "../../src/adapters/http/rotas/conversas.ts";
import { criarRotasDecisoes } from "../../src/adapters/http/rotas/decisoes.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import { criarRotasSuaVez } from "../../src/adapters/http/rotas/sua-vez.ts";
import type { ConversaDto, RespostaMutacao, SuaVezDto } from "../../src/contracts/api.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Transacao, Tx } from "../../src/shared/types.ts";
import { autoriaAgente } from "../../src/use-cases/apoio-l7.ts";
import { dispararRotina, registrarDesfechoRotina } from "../../src/use-cases/disparar-rotina.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { pedirAPessoa } from "../../src/use-cases/pedir-a-pessoa.ts";
import { MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Fio da pergunta (emenda da ADR-045, 0025, definido em 2026-09-24) no Postgres de verdade e pelas
 * rotas HTTP: a pergunta que a pessoa não entendeu vira um fio de rodadas — pergunta → pedido de
 * explicação → explicação e pergunta de novo → resposta — que fica aberto enquanto o agente precisa
 * dela e fecha sozinho quando ele segue. O agente (pedir_a_pessoa, ferramenta) é chamado direto; a
 * pessoa, pelas rotas. Cada requisição roda num SAVEPOINT da transação do teste (rotas-agentes-conversas).
 */
describeIntegracao("fio da pergunta: rodadas no mesmo fio, estado derivado, contadores e rotina", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  /** Roda `fn` num savepoint da transação do teste, com o escopo da sessão vinculado. */
  function noSavepoint<T>(escopo: Escopo, fn: (sp: Tx) => Promise<T>): Promise<T> {
    const trx = trxAtual;
    if (!trx) throw new Error("teste sem transação aberta");
    const caixa: { valor?: T } = {};
    return trx
      .savepoint(async (sp) => {
        await vincularEscopo(sp, escopo);
        caixa.valor = await fn(sp);
      })
      .then(() => caixa.valor as T);
  }

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx: (escopo: Escopo) => (fn) => noSavepoint(escopo, fn),
      services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON),
      useCases: useCasesDeTeste(),
      prazoDecisaoMs: 60_000,
      executor: "catcher",
    };
    const dentro = <T,>(escopo: Escopo, fn: (d: Deps) => Promise<T>): Promise<T> => noSavepoint(escopo, (sp) => fn(depsSobre(sp, escopo).deps));
    servidor = await servidorDeTeste([
      ...criarRotasConversas(deps),
      ...criarRotasDecisoes({ dentro, services: deps.services, prazoDecisaoMs: 60_000, executor: "catcher" }),
      ...criarRotasSuaVez((escopo, fn) => noSavepoint(escopo, (sp) => fn({ repos: criarRepos(sp, escopo), escopo, agora: () => Date.now(), tx: (f) => f(sp) }))),
    ]);
  });
  afterAll(() => servidor.close());

  /** O lado da pessoa, pelas rotas. */
  async function pessoa() {
    const sessao = await servidor.entrar("marlon");
    return {
      async responder(decisaoId: string, texto: string): Promise<string> {
        const r = await servidor.chamar(sessao, "POST", `decisoes/${decisaoId}/responder`, { texto });
        expect(r.status).toBe(200);
        const ids = ((await r.json()) as RespostaMutacao).ids;
        return ids.turnoRetomada ?? "";
      },
      async conversa(conversaId: string): Promise<ConversaDto> {
        const r = await servidor.chamar(sessao, "GET", `conversas/${conversaId}/mensagens`);
        expect(r.status).toBe(200);
        return (await r.json()) as ConversaDto;
      },
      async suaVez(): Promise<SuaVezDto> {
        const r = await servidor.chamar(sessao, "GET", "sua-vez");
        expect(r.status).toBe(200);
        return (await r.json()) as SuaVezDto;
      },
    };
  }

  /** O lado do agente: pergunta (a ferramenta), explica (a fala do turno) e encerra o turno. */
  function agente(trx: Tx, alvo: { agenteId: string; conversaId: string }) {
    const { deps, repos } = depsSobre(trx, MARLON);
    return {
      repos,
      deps,
      async perguntar(turnoId: string, texto: string): Promise<string> {
        return (await pedirAPessoa(deps, { turnoId, ...alvo, tipo: "pergunta", texto })).data.decisao_id;
      },
      async falar(turnoId: string, texto: string): Promise<void> {
        await repos.mensagens.criar({ ...alvo, turnoId, autoria: autoriaAgente(alvo.agenteId, PESSOA_MARLON), kind: "texto", texto, confianca: "confiavel" });
      },
      async encerrar(turnoId: string): Promise<void> {
        await repos.turnos.assentar(turnoId, { estado: "concluido" });
      },
    };
  }

  const abertas = (sv: SuaVezDto) => sv.itens.filter((i) => i.estadoColuna !== "vencido");
  const fios = (c: ConversaDto) => c.fios.map((f) => ({ id: f.id, estado: f.estado, rodada: f.rodada, mensagens: f.mensagens.length }));

  it("a migração 0025 aplicou: decisoes.fio_id (uuid, nulo) e o índice parcial (tenant_id, fio_id)", async () => {
    await withRollback(MARLON, async (trx) => {
      const [coluna] = await trx<{ data_type: string; is_nullable: string }[]>`select data_type, is_nullable from information_schema.columns where table_name = 'decisoes' and column_name = 'fio_id'`;
      expect(coluna).toEqual({ data_type: "uuid", is_nullable: "YES" });
      const [indice] = await trx<{ indexdef: string }[]>`select indexdef from pg_indexes where tablename = 'decisoes' and indexname = 'decisoes_por_fio'`;
      expect(indice?.indexdef).toContain("(tenant_id, fio_id)");
      expect(indice?.indexdef).toContain("WHERE (fio_id IS NOT NULL)");
    });
  });

  it("três rodadas pelas rotas (pergunta → 'o que é?' → explica e pergunta → 'e depois?' → explica e pergunta → resposta → o agente segue): UM fio resolvido, contador de volta a zero", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const alvo = await agenteComConversa(trx, MARLON, { nome: "Nina" });
      const nina = agente(trx, alvo);
      const eu = await pessoa();
      const t0 = await nina.repos.turnos.enfileirar({ executor: "catcher", ...alvo, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "arquive os PRs parados", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
      if (!t0) throw new Error("turno");

      const d1 = await nina.perguntar(t0.id, "Posso arquivar o PR 7? Ele está parado há duas semanas.");
      await nina.encerrar(t0.id);
      expect(abertas(await eu.suaVez()).map((i) => i.fio)).toEqual([{ id: d1, rodada: 1 }]);
      expect(fios(await eu.conversa(alvo.conversaId))).toEqual([{ id: d1, estado: "esperando_voce", rodada: 1, mensagens: 1 }]);

      // Rodada 1 → a pessoa pede explicação. A pergunta continua aberta: o agente está lendo.
      const r1 = await eu.responder(d1, "O que é arquivar?");
      expect(fios(await eu.conversa(alvo.conversaId))).toEqual([{ id: d1, estado: "lendo_sua_mensagem", rodada: 1, mensagens: 2 }]);
      expect(abertas(await eu.suaVez())).toEqual([]);

      // O agente explica e pergunta de novo: 2ª rodada do MESMO fio, com prazo próprio.
      await nina.falar(r1, "Arquivar fecha o PR sem juntar o código; dá para reabrir depois.");
      const d2 = await nina.perguntar(r1, "Então: posso arquivar o PR 7?");
      await nina.encerrar(r1);
      expect((await nina.repos.decisoes.buscar(d2))?.fioId).toBe(d1);
      expect(abertas(await eu.suaVez()).map((i) => [i.decisao.id, i.fio])).toEqual([[d2, { id: d1, rodada: 2 }]]);
      expect(fios(await eu.conversa(alvo.conversaId))).toEqual([{ id: d1, estado: "esperando_voce", rodada: 2, mensagens: 4 }]);

      const r2 = await eu.responder(d2, "E se eu precisar dele depois?");
      await nina.falar(r2, "Fica guardado e dá para reabrir.");
      const d3 = await nina.perguntar(r2, "Posso arquivar?");
      await nina.encerrar(r2);
      expect((await nina.repos.decisoes.buscar(d3))?.fioId).toBe(d1);

      // Rodada 3 → resposta de verdade. A retomada leva o histórico do fio (sessão nova não perde o contexto).
      const r3 = await eu.responder(d3, "Pode arquivar.");
      const retomada = await nina.repos.turnos.buscar(r3);
      expect(retomada?.entradaTexto).toContain("Esta pergunta é a 3ª rodada do mesmo fio.");
      // O nome vem do cadastro (pessoas); o banco de teste não depende do seed, então só o verbo é conferido.
      expect(retomada?.entradaTexto).toMatch(/\n- .+ respondeu: O que é arquivar\?\n/);
      expect(retomada?.entradaTexto).toContain("- Você explicou: Fica guardado e dá para reabrir.");
      expect(fios(await eu.conversa(alvo.conversaId))).toEqual([{ id: d1, estado: "lendo_sua_mensagem", rodada: 3, mensagens: 8 }]);

      // O agente segue sem perguntar de novo: o fio fecha sozinho. A fala dele é o resultado, fora do fio:
      // as 8 mensagens continuam sendo as 3 perguntas, as 3 respostas e as 2 explicações.
      await nina.falar(r3, "Arquivei o PR 7.");
      await nina.encerrar(r3);
      const final = await eu.conversa(alvo.conversaId);
      expect(fios(final)).toEqual([{ id: d1, estado: "resolvida", rodada: 3, mensagens: 8 }]);
      expect(final.fios[0]?.decisoes).toEqual([d1, d2, d3]);
      expect(abertas(await eu.suaVez())).toEqual([]);
      trxAtual = null;
    });
  });

  it("rotina: as rodadas são da mesma janela e o desfecho é do fio inteiro — UMA linha 'executou' quando resolve; a pergunta vencida fecha a janela como 'passou_em_branco'", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const alvo = await agenteComConversa(trx, MARLON, { nome: "Nina" });
      const nina = agente(trx, alvo);
      const eu = await pessoa();
      const JANELA = Date.parse("2026-09-24T08:00:00-03:00");
      const rotina = await nina.repos.rotinas.criar({ ...alvo, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resuma os PRs", fonte: "GitHub", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "diga que não houve", proximaExecucao: JANELA });
      if (!rotina) throw new Error("rotina");
      const disparo = await dispararRotina(nina.deps, { rotina, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in disparo.data)) throw new Error("sem turno");
      const t0 = disparo.data.turno.id;
      /** O que compor.ts (depoisDeAssentar) faz quando o turno da rotina ou a retomada dela assenta. */
      const assentar = async (turnoId: string) => {
        await nina.encerrar(turnoId);
        return (await registrarDesfechoRotina(nina.deps, { turnoId, desfecho: "executou" })).data;
      };

      const d1 = await nina.perguntar(t0, "Qual repositório?");
      expect(await assentar(t0)).toEqual({ ignorado: "aguardando_gate" });
      const r1 = await eu.responder(d1, "Como assim?");
      await nina.falar(r1, "Vocês têm dois: o do nod e o do site.");
      await nina.perguntar(r1, "O nod ou o site?");
      expect(await assentar(r1)).toEqual({ ignorado: "aguardando_gate" });
      const d2 = (await nina.repos.decisoes.pendentesDaConversa(alvo.conversaId))[0]?.id ?? "";
      const r2 = await eu.responder(d2, "O nod.");
      expect((await nina.repos.turnos.buscar(r2))?.entradaTexto).toContain("Entrada original da rotina:");
      const fim = await assentar(r2);
      expect("execucao" in fim && fim.execucao.desfecho).toBe("executou");
      expect((await nina.repos.rotinaExecucoes.listar(rotina.id)).map((e) => [e.instanteAgendado, e.desfecho, e.turnoId])).toEqual([[JANELA, "executou", t0]]);
      expect((await nina.repos.mensagens.listarDaConversa(alvo.conversaId)).filter((m) => m.kind === "rotina_execucao")).toHaveLength(1);

      // A janela seguinte pergunta e ninguém responde: o varredor fecha a janela pela pergunta vencida.
      const JANELA2 = JANELA + 86_400_000;
      const disparo2 = await dispararRotina(nina.deps, { rotina: (await nina.repos.rotinas.buscar(rotina.id)) ?? rotina, instanteAgendado: JANELA2, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in disparo2.data)) throw new Error("sem turno");
      const q = await nina.perguntar(disparo2.data.turno.id, "Qual repositório hoje?");
      expect(await assentar(disparo2.data.turno.id)).toEqual({ ignorado: "aguardando_gate" });
      const depoisDoPrazo = Date.parse((await nina.repos.decisoes.buscar(q))?.prazoDecisaoEm ?? "") + 1;
      const tx: Transacao = (fn) => fn(trx);
      const varrido = await varrerPessoa(MARLON, tx, { services: nina.deps.services, useCases: nina.deps.useCases, agora: () => depoisDoPrazo });
      expect(varrido.passaramEmBranco).toEqual([rotina.id]);
      const execucoes = await nina.repos.rotinaExecucoes.listar(rotina.id);
      expect(execucoes.map((e) => [e.instanteAgendado, e.desfecho, e.motivo]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
        [JANELA, "executou", null],
        [JANELA2, "passou_em_branco", "pergunta_sem_resposta"],
      ]);
      trxAtual = null;
    });
  });
});
