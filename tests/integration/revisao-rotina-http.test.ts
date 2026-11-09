import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { criarRotasDecisoes } from "../../src/adapters/http/rotas/decisoes.ts";
import type { ErroDto } from "../../src/contracts/api.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { TEXTO_ROTINA_MUDOU } from "../../src/use-cases/aplicar-proposta-rotina.ts";
import { criarRotinaPelaPessoa } from "../../src/use-cases/criar-rotina.ts";
import { atualizarRotinaPeloAgente, excluirRotinaPeloAgente } from "../../src/use-cases/rotinas-do-agente.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { MARLON, servicosDeTeste } from "../helpers/deps-l6.ts";
import { contexto, depsSobre, rotinaValida } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-159 pela rota: POST decisoes/:id/decidir num card de mudar/excluir rotina cuja rotina mudou no meio responde
 * 409 estado_invalido (cause rotina_mudou) E deixa gravado o que o caso fez — proposta recusada, decisão fechada uma
 * vez, um aviso na conversa. Cada requisição roda num SAVEPOINT da transação do teste (fio-da-pergunta.test.ts):
 * se o erro saísse de DENTRO do comoDona, o savepoint desfaria a recusa e o aviso, e este teste quebraria.
 */
describeIntegracao("revisão da rotina pela rota de decidir (NOD-159): commit primeiro, 409 depois", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;
  const saida = vi.spyOn(console, "log");
  afterEach(() => saida.mockClear());
  const linhas = () => saida.mock.calls.flatMap((c) => { try { return [JSON.parse(String(c[0])) as Record<string, unknown>]; } catch { return []; } });

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
    const dentro = <T,>(escopo: Escopo, fn: (d: Deps) => Promise<T>): Promise<T> => noSavepoint(escopo, (sp) => fn(depsSobre(sp, escopo).deps));
    servidor = await servidorDeTeste([...criarRotasDecisoes({ dentro, services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON), prazoDecisaoMs: 60_000, executor: "catcher" })]);
  });
  afterAll(() => servidor.close());

  async function rotinaAtiva(trx: Tx) {
    const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
    const { deps, repos } = depsSobre(trx, MARLON);
    const a = rotinaValida();
    const { data } = await criarRotinaPelaPessoa(deps, { agenteId, cron: a.cron, fusoIana: a.fuso_iana, instrucao: a.instrucao, fonte: a.fonte, entregavel: a.entregavel, limitesAprovacao: a.limites_aprovacao, politicaSemDado: a.politica_sem_dado });
    const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "mexe na rotina", entradaConfianca: "confiavel", modelo: "m" });
    return { deps, repos, ctx: contexto(agenteId, conversaId, turno?.id), rotina: data.rotina };
  }

  /** O que a rota tem de ter deixado gravado depois do 409. */
  async function conferirGravado(trx: Tx, repos: ReturnType<typeof depsSobre>["repos"], propostaId: string, rotinaConversaId: string) {
    expect((await repos.propostas.buscar(propostaId))?.estado).toBe("recusada");
    expect(await repos.decisoes.buscar(propostaId)).toMatchObject({ estado: "decidida" });
    const avisos = (await repos.mensagens.listarDaConversa(rotinaConversaId)).filter((m) => m.texto === TEXTO_ROTINA_MUDOU);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ kind: "sistema", confianca: "confiavel" });
    // A decisão fecha UMA vez (a rota fecha antes do caso; o caso não fecha de novo) e o frame diz recusada.
    const frames = await trx<{ dados: Record<string, unknown> }[]>`select dados from events_outbox where tipo = 'decisao_decidida' and (dados->>'decisao_id' = ${propostaId} or dados->>'decisaoId' = ${propostaId})`;
    expect(frames).toHaveLength(1);
    expect(frames[0]?.dados).toMatchObject({ recusada: true });
  }

  function conferirLog(propostaId: string, rotinaId: string) {
    expect(linhas()).toEqual(expect.arrayContaining([
      expect.objectContaining({ evento: "proposta_rotina_obsoleta", proposta_id: propostaId, rotina_id: rotinaId }),
      expect.objectContaining({ evento: "requisicao_recusada", codigo: "estado_invalido", status: 409, causa: "rotina_mudou" }),
    ]));
  }

  it("rotina_atualizacao: confirmar com a rotina mudada → 409 estado_invalido/rotina_mudou; rotina intacta, proposta recusada, decisão fechada, aviso gravado", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { repos, deps, ctx, rotina } = await rotinaAtiva(trx);
      const p = await atualizarRotinaPeloAgente(deps, { ...ctx, rotina_id: rotina.id, cron: "0 10 * * 1-5" });
      if ("erro" in p.data) throw new Error(p.data.erro);
      await repos.rotinas.atualizar(rotina.id, { instrucao: "mudada pela tela enquanto o card esperava" });
      const antes = await repos.rotinas.buscar(rotina.id);

      const sessao = await servidor.entrar("marlon");
      const r = await servidor.chamar(sessao, "POST", `decisoes/${p.data.proposta_id}/decidir`, {});
      expect(r.status).toBe(409);
      expect(((await r.json()) as ErroDto).codigo).toBe("estado_invalido");

      expect(await repos.rotinas.buscar(rotina.id)).toEqual(antes);
      await conferirGravado(trx, repos, p.data.proposta_id, rotina.conversaId);
      conferirLog(p.data.proposta_id, rotina.id);

      // O segundo clique no card já fechado não reaplica nem avisa de novo.
      expect((await servidor.chamar(sessao, "POST", `decisoes/${p.data.proposta_id}/decidir`, {})).status).toBe(409);
      expect((await repos.mensagens.listarDaConversa(rotina.conversaId)).filter((m) => m.texto === TEXTO_ROTINA_MUDOU)).toHaveLength(1);
      trxAtual = null;
    });
  });

  it("rotina_exclusao: confirmar com a rotina mudada → 409; a rotina não ganha excluidoEm e o resto fica gravado igual", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { repos, deps, ctx, rotina } = await rotinaAtiva(trx);
      const p = await excluirRotinaPeloAgente(deps, { ...ctx, rotina_id: rotina.id });
      if ("erro" in p.data) throw new Error(p.data.erro);
      await repos.rotinas.atualizar(rotina.id, { instrucao: "mudada pela tela enquanto o card esperava" });

      const sessao = await servidor.entrar("marlon");
      const r = await servidor.chamar(sessao, "POST", `decisoes/${p.data.proposta_id}/decidir`, {});
      expect(r.status).toBe(409);
      expect(((await r.json()) as ErroDto).codigo).toBe("estado_invalido");

      expect((await repos.rotinas.buscar(rotina.id))?.excluidoEm).toBeNull();
      await conferirGravado(trx, repos, p.data.proposta_id, rotina.conversaId);
      conferirLog(p.data.proposta_id, rotina.id);
      trxAtual = null;
    });
  });

  it("caminho feliz pela rota: sem mudança no meio, confirmar responde 200 e aplica", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { repos, deps, ctx, rotina } = await rotinaAtiva(trx);
      const p = await atualizarRotinaPeloAgente(deps, { ...ctx, rotina_id: rotina.id, cron: "0 10 * * 1-5" });
      if ("erro" in p.data) throw new Error(p.data.erro);

      const sessao = await servidor.entrar("marlon");
      const r = await servidor.chamar(sessao, "POST", `decisoes/${p.data.proposta_id}/decidir`, {});
      expect(r.status).toBe(200);
      expect((await repos.rotinas.buscar(rotina.id))?.cron).toBe("0 10 * * 1-5");
      expect((await repos.propostas.buscar(p.data.proposta_id))?.estado).toBe("confirmada");
      trxAtual = null;
    });
  });
});
