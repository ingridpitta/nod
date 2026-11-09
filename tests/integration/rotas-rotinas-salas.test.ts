import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasRotinas, type DepsRotasL7 } from "../../src/adapters/http/rotas/rotinas.ts";
import { criarRotasSalas } from "../../src/adapters/http/rotas/salas.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ROTINAS_POR_AGENTE } from "../../src/shared/constantes.ts";
import type { Escopo, Transacao, Tx } from "../../src/shared/types.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const TZ = "America/Sao_Paulo";

/**
 * Servidor real em porta 0 (EMENDA 34) com as rotas da L7 sobre o envelope do withRollback: `txPara`
 * devolve a transação corrente do teste (vinculando o escopo da sessão), então nada é commitado
 * em nod_test. As requisições de cada `it` rodam em sequência sobre a mesma conexão.
 */
let trxAtual: Tx | null = null;
const txPara = (escopo: Escopo): Transacao => async (fn) => {
  if (!trxAtual) throw new Error("teste sem transação aberta");
  await vincularEscopo(trxAtual, escopo);
  return fn(trxAtual);
};

describeIntegracao("rotas de rotinas e salas (tabela ROTAS, L7): códigos da tabela fixa de erros", () => {
  let srv: ServidorDeTeste;
  let sessao: { cookie: string; tenantId: string; pessoaId: string };

  beforeAll(async () => {
    const semTrx = depsSobre({} as never, MARLON);
    const deps: DepsRotasL7 = { txPara, services: semTrx.deps.services, useCases: semTrx.deps.useCases, agora: () => Date.now() };
    srv = await servidorDeTeste([...criarRotasRotinas(deps), ...criarRotasSalas(deps)]);
    sessao = await srv.entrar("marlon");
  });
  afterAll(() => srv.close());

  it("POST rotinas: 400 fuso_invalido para '+03:00' (antes de exigir os outros campos), 201 quando válida, 429 limite_atingido na 51ª, 404 agente desconhecido", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { agenteId, repos } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const ruim = await srv.chamar(sessao, "POST", "rotinas", { cron: "0 8 * * *", fusoIana: "+03:00" });
      expect(ruim.status).toBe(400);
      expect(await ruim.json()).toEqual({ codigo: "fuso_invalido", mensagem: "Fuso horário inválido. Use o nome de uma região, como America/Sao_Paulo, e não uma diferença de horas." });

      const corpo = { agenteId, cron: "0 8 * * 1-5", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p" };
      const ok = await srv.chamar(sessao, "POST", "rotinas", corpo);
      expect(ok.status).toBe(201);
      const criada = (await ok.json()) as { ok: true; ids: { rotinaId: string } };
      expect(criada.ok).toBe(true);
      expect((await repos.rotinas.buscar(criada.ids.rotinaId))?.exigeAprovacao).toBe(true);

      const lista = await srv.chamar(sessao, "GET", "rotinas");
      expect(lista.status).toBe(200);
      const dto = (await lista.json()) as { rotinas: { rotina: { id: string }; proximaExecucao: number }[] };
      expect(dto.rotinas.map((r) => r.rotina.id)).toEqual([criada.ids.rotinaId]);

      for (let i = 1; i < ROTINAS_POR_AGENTE; i++) expect((await srv.chamar(sessao, "POST", "rotinas", corpo)).status).toBe(201);
      const teto = await srv.chamar(sessao, "POST", "rotinas", corpo);
      expect(teto.status).toBe(429);
      expect(((await teto.json()) as { codigo: string }).codigo).toBe("limite_atingido");

      const semFuturo = await srv.chamar(sessao, "POST", "rotinas", { ...corpo, cron: "0 8 31 2 *" });
      expect(((await semFuturo.json()) as { codigo: string }).codigo).toBe("cron_sem_futuro");
      expect((await srv.chamar(sessao, "POST", "rotinas", { ...corpo, agenteId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);

      const pausar = await srv.chamar(sessao, "POST", `rotinas/${criada.ids.rotinaId}/pausar`);
      expect(pausar.status).toBe(200);
      expect((await repos.rotinas.buscar(criada.ids.rotinaId))?.estado).toBe("pausada");
      expect((await srv.chamar(sessao, "POST", `rotinas/${criada.ids.rotinaId}/ativar`)).status).toBe(200);
      const execucoes = await srv.chamar(sessao, "GET", `rotinas/${criada.ids.rotinaId}/execucoes`);
      expect(await execucoes.json()).toEqual({ execucoes: [] });
      expect((await srv.chamar(sessao, "GET", "rotinas/00000000-0000-4000-8000-000000000000/execucoes")).status).toBe(404);
      trxAtual = null;
    });
  });

  it("ids fora do formato uuid: no CORPO → 400 entrada_invalida; no PATH → 404 (roteador, EMENDA-L9 §2); agenteId ausente → 400; nunca 500", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { agenteId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const corpo = { cron: "0 8 * * 1-5", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p" };
      const esperado = { codigo: "entrada_invalida", mensagem: "Algum dado do pedido não está certo. Confira e tente de novo." };
      const semAgente = await srv.chamar(sessao, "POST", "rotinas", corpo);
      expect(semAgente.status).toBe(400);
      expect(await semAgente.json()).toEqual(esperado);
      expect((await srv.chamar(sessao, "POST", "rotinas", { ...corpo, agenteId: "abc" })).status).toBe(400);
      // definido em 2026-09-16 (L9): id de PATH fora do formato é rota inexistente (404, roteador); id de CORPO é entrada inválida (400).
      for (const [metodo, caminho, c, status] of [
        ["POST", "rotinas/abc/pausar", undefined, 404],
        ["POST", "rotinas/abc/ativar", undefined, 404],
        ["GET", "rotinas/abc/execucoes", undefined, 404],
        ["POST", "salas", { nome: "x", agenteIds: ["abc", agenteId] }, 400],
        ["POST", "salas/abc/membros", { agenteId }, 404],
        ["POST", "salas/00000000-0000-4000-8000-000000000000/membros", { agenteId: "abc" }, 400],
        ["POST", "salas/abc/mensagens", { texto: "oi" }, 404],
        ["POST", "salas/abc/parar", undefined, 404],
      ] as const) {
        const r = await srv.chamar(sessao, metodo, caminho, c);
        expect([metodo, caminho, r.status]).toEqual([metodo, caminho, status]);
        if (status === 400) expect(await r.json()).toEqual(esperado);
        else expect(((await r.json()) as { codigo: string }).codigo).toBe("nao_encontrado");
      }
      trxAtual = null;
    });
  });

  it("salas: POST com 1 bot → 400 sala_tamanho; 2 bots → 201; membros, mensagens (turnos por menção) e parar", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const bia = await agenteComConversa(trx, MARLON, { nome: "Bia" });
      const pequena = await srv.chamar(sessao, "POST", "salas", { nome: "x", agenteIds: [vera.agenteId] });
      expect(pequena.status).toBe(400);
      expect(await pequena.json()).toEqual({ codigo: "sala_tamanho", mensagem: "Uma sala tem de 2 a 6 bots." });
      expect((await srv.chamar(sessao, "POST", "salas", { nome: "x" })).status).toBe(400);

      const criada = await srv.chamar(sessao, "POST", "salas", { nome: "revisão", agenteIds: [vera.agenteId, tuca.agenteId] });
      expect(criada.status).toBe(201);
      const { ids } = (await criada.json()) as { ok: true; ids: { salaId: string; conversaId: string } };

      const lista = (await (await srv.chamar(sessao, "GET", "salas")).json()) as { salas: { sala: { id: string; nome: string }; membros: { agenteId: string }[] }[] };
      expect(lista.salas.map((s) => [s.sala.nome, s.membros.length])).toEqual([["revisão", 2]]);

      const convite = await srv.chamar(sessao, "POST", `salas/${ids.salaId}/membros`, { agenteId: bia.agenteId });
      expect(convite.status).toBe(200);
      expect((await srv.chamar(sessao, "POST", `salas/${ids.salaId}/membros`, {})).status).toBe(400);

      const post = await srv.chamar(sessao, "POST", `salas/${ids.salaId}/mensagens`, { texto: "@Tuca o que acha do PR 42?" });
      expect(post.status).toBe(201);
      const resposta = (await post.json()) as { ok: true; ids: Record<string, string> };
      expect(Object.keys(resposta.ids).sort()).toEqual(["mensagemId", "turnoId0"]);
      expect((await vera.repos.turnos.buscar(resposta.ids.turnoId0 ?? ""))?.agenteId).toBe(tuca.agenteId);
      expect((await srv.chamar(sessao, "POST", `salas/${ids.salaId}/mensagens`, { texto: "  " })).status).toBe(400);

      const parar = await srv.chamar(sessao, "POST", `salas/${ids.salaId}/parar`);
      expect(parar.status).toBe(200);
      expect(await parar.json()).toEqual({ faixa: { interrompidas: 1, naoInterrompidas: [], jaEntregues: [], nadaRodando: false } });
      expect((await srv.chamar(sessao, "POST", "salas/00000000-0000-4000-8000-000000000000/parar")).status).toBe(404);
      trxAtual = null;
    });
  });
});
