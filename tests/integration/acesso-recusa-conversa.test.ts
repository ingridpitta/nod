import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import { criarRotasPropostas } from "../../src/adapters/http/rotas/propostas.ts";
import type { ErroDto, RespostaMutacao } from "../../src/contracts/api.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { decidirAcesso, recusarPropostaPelaConversa } from "../../src/use-cases/decidir-acesso.ts";
import { reabrirDecisao } from "../../src/use-cases/reabrir-decisao.ts";
import { criarTrabalho, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-202: o card de acesso recusado PELA CONVERSA (POST propostas/:id/recusar, "Deixar de lado") fecha a decisão de
 * mesmo id em "Sua vez", igual à recusa de lá — pelo caminho da decisão (decidirAcesso), na ordem única do card de
 * acesso: concessão → decisão → proposta. E o Permitir não concede com a proposta já recusada pela pessoa.
 */
const MARLON: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const concluido = { desfecho: "sucesso" as const, texto: "feito", sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };

async function gmail(repos: Repos) {
  const c = await repos.conectores.criar({ nome: "Gmail", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!c) throw new Error("conector");
  await repos.conectores.registrarSonda(c.id, { ok: true, agora: Date.now(), catalogo: [{ nome: "GMAIL_FETCH_EMAILS", descricao: "ler", schema: { type: "object" }, readOnlyHint: true }] });
  return c;
}

async function montar(trx: Tx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Nina" });
  const { deps, repos } = depsSobre(trx, MARLON);
  await repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const conector = await gmail(repos);
  /** Um card de acesso da conversa (proposta + decisão de mesmo id), opcionalmente de um turno ou de uma rotina. */
  const card = async (extra: { turnoId?: string; rotinaId?: string; frase?: string; prazo?: number } = {}) => {
    const payload = { kind: "acesso" as const, conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "leitura" as const, naoPedido: [], ...(extra.turnoId ? { turnoId: extra.turnoId } : {}) };
    const p = extra.rotinaId
      ? (await repos.propostas.criarAcessoDeRotina({ conversaId: base.conversaId, agenteId: base.agenteId, payload: { ...payload, rotinaId: extra.rotinaId } }))?.proposta
      : await repos.propostas.criar({ conversaId: base.conversaId, agenteId: base.agenteId, payload });
    if (!p) throw new Error("proposta");
    const d = await repos.decisoes.criar({ id: p.id, tipo: "acesso", agenteId: base.agenteId, conversaId: base.conversaId, turnoId: extra.turnoId ?? null, prazoDecisaoEm: extra.prazo ?? Date.now() + 600_000, frase: extra.frase ?? "Nina precisa ler seu Gmail" });
    if (!d) throw new Error("decisão");
    return p.id;
  };
  const concessoes = async () => (await repos.concessoes.doAgente(base.agenteId)).filter((c) => c.conectorId === conector.id);
  return { ...base, deps, repos, card, concessoes };
}

describeIntegracao("card de acesso recusado pela conversa (NOD-202)", () => {
  it("critério 1: recusar pela conversa com a decisão aberta fecha a decisão (decisao_decidida, recusada) e leva a task do turno a terminado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const w = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Resumo do Gmail", origem: "pessoa" })).trabalho;
      const t = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "resuma", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: w.id });
      if (!t) throw new Error("turno");
      const machineId = randomUUID();
      for (let i = 0; i < 10; i++) {
        const r = await m.repos.turnos.reivindicar({ machineId, agora: Date.now() });
        if (!r || r.id === t.id) break;
      }
      await assentarTurno(m.deps, { turnoId: t.id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "preciso do Gmail" }, resultado: concluido, executor: "catcher" });
      const id = await m.card({ turnoId: t.id });
      await sincronizarTrabalho(m.deps, w.id);
      expect((await m.repos.trabalhos.buscar(w.id))?.estado).toBe("precisa_de_voce");

      const r = await recusarPropostaPelaConversa(m.deps, { propostaId: id, executor: "catcher" });
      expect(r.data.decisao?.id).toBe(id);
      expect((await m.repos.decisoes.buscar(id))?.estado).toBe("decidida");
      expect((await m.repos.propostas.buscar(id))?.estado).toBe("recusada");
      expect(r.events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "decisao_decidida", dados: expect.objectContaining({ decisao_id: id, tipo: "acesso", recusada: true }) })]));
      expect((r.events ?? []).map((e) => e.kind)).toContain("trabalho_mudou");
      expect((await m.repos.trabalhos.buscar(w.id))?.estado).toBe("terminado");
      expect(await m.concessoes()).toHaveLength(0);
    });
  });

  it("pedido de rotina recusado pela conversa pausa a rotina, como a recusa de \"Sua vez\"", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const rotina = await m.repos.rotinas.criar({ agenteId: m.agenteId, conversaId: m.conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resumo do Gmail", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() + 3_600_000 });
      if (!rotina) throw new Error("rotina");
      const id = await m.card({ rotinaId: rotina.id });

      await recusarPropostaPelaConversa(m.deps, { propostaId: id, executor: "catcher" });
      expect((await m.repos.decisoes.buscar(id))?.estado).toBe("decidida");
      expect((await m.repos.propostas.buscar(id))?.estado).toBe("recusada");
      expect((await m.repos.rotinas.buscar(rotina.id))?.estado).toBe("pausada");
    });
  });

  it("gêmeas \"×N\": recusar um item pela conversa fecha as gêmeas abertas e recusa as propostas delas", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = await m.card();
      const b = await m.card();
      await recusarPropostaPelaConversa(m.deps, { propostaId: a, executor: "catcher" });
      expect((await m.repos.decisoes.buscar(b))?.estado).toBe("decidida");
      expect((await m.repos.propostas.buscar(b))?.estado).toBe("recusada");
    });
  });

  it("guarda: Permitir com a proposta recusada pela pessoa e a decisão ainda pendente (legado) dá estado_invalido e não concede", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const id = await m.card();
      await m.repos.propostas.decidir(id, "recusada");
      await expect(decidirAcesso(m.deps, { decisaoId: id, recusar: false, executor: "catcher" })).rejects.toMatchObject({ codigo: "estado_invalido" });
      expect(await m.concessoes()).toHaveLength(0);
      // A recusa pela conversa de proposta já decidida segue dando 409, sem fechar nada.
      await expect(recusarPropostaPelaConversa(m.deps, { propostaId: id, executor: "catcher" })).rejects.toMatchObject({ codigo: "estado_invalido" });
    });
  });

  it("não muda: reabrir o card vencido (proposta recusada pelo varredor) continua concedendo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const agora = Date.now();
      const id = await m.card({ prazo: agora + 1_000 });
      await m.repos.decisoes.vencerPendentes(agora + 2_000);
      await m.repos.propostas.decidir(id, "recusada");
      await reabrirDecisao(m.deps, { decisaoId: id });
      const r = await decidirAcesso(m.deps, { decisaoId: id, recusar: false, executor: "catcher" });
      expect(r.data.concessoes).toBe(1);
      expect(await m.concessoes()).toHaveLength(1);
    });
  });

  it("a decisão já vencida: \"Deixar de lado\" pela conversa segue o recusarProposta de sempre e não reabre nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const agora = Date.now();
      const id = await m.card({ prazo: agora + 1_000 });
      await m.repos.decisoes.vencerPendentes(agora + 2_000);
      const r = await recusarPropostaPelaConversa(m.deps, { propostaId: id, executor: "catcher" });
      expect(r.data.decisao).toBeNull();
      expect((await m.repos.propostas.buscar(id))?.estado).toBe("recusada");
      expect((await m.repos.decisoes.buscar(id))?.estado).toBe("vencida");
    });
  });
});

describeIntegracao("POST propostas/:id/recusar no card de acesso (NOD-202)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx:
        (escopo: Escopo) =>
        async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: T } = {};
          await trx.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(sp);
          });
          return caixa.valor as T;
        },
      services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON),
      useCases: useCasesDeTeste(),
      prazoDecisaoMs: 60_000,
      executor: "catcher",
    };
    servidor = await servidorDeTeste(criarRotasPropostas(deps));
  });
  afterAll(() => servidor.close());

  it("recusa pela rota fecha a decisão e devolve o id dela; a segunda recusa dá 409", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const id = await m.card();
      const sessao = await servidor.entrar("marlon");
      const r = await servidor.chamar(sessao, "POST", `propostas/${id}/recusar`);
      expect(r.status).toBe(200);
      expect(((await r.json()) as RespostaMutacao).ids).toEqual({ proposta: id, decisao: id });
      expect((await m.repos.decisoes.buscar(id))?.estado).toBe("decidida");
      const deNovo = await servidor.chamar(sessao, "POST", `propostas/${id}/recusar`);
      expect(deNovo.status).toBe(409);
      expect(((await deNovo.json()) as ErroDto).codigo).toBe("estado_invalido");
      trxAtual = null;
    });
  });
});
