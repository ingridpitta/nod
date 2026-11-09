import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasDecisoes } from "../../src/adapters/http/rotas/decisoes.ts";
import type { ErroDto, RespostaMutacao } from "../../src/contracts/api.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { proporApp } from "../../src/use-cases/apps-do-bot.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { MARLON, servicosDeTeste } from "../helpers/deps-l6.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-445, revisão 1 do #626: o card do app pela rota de verdade (POST decisoes/:id/decidir, src/adapters/http/rotas/
 * decisoes.ts). Criar, recusar, o card que não vale mais (409 DEPOIS do commit: a recusa e o aviso ficam gravados, o
 * molde da NOD-159) e o card de outra pessoa (404, nada muda). Cada requisição roda num SAVEPOINT da transação do teste:
 * se o 409 saísse de dentro do comoDona, o savepoint desfaria o que o caso gravou.
 */
describeIntegracao("o card do app pela rota de decidir (NOD-445)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  beforeAll(async () => {
    const dentro = <T,>(escopo: Escopo, fn: (d: Deps) => Promise<T>): Promise<T> => {
      const trx = trxAtual;
      if (!trx) throw new Error("teste sem transação aberta");
      const caixa: { valor?: T } = {};
      return trx.savepoint(async (sp) => {
        await vincularEscopo(sp, escopo);
        caixa.valor = await fn(depsSobre(sp, escopo).deps);
      }).then(() => caixa.valor as T);
    };
    servidor = await servidorDeTeste([...criarRotasDecisoes({ dentro, services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON), prazoDecisaoMs: 60_000, executor: "catcher" })]);
  });
  afterAll(() => servidor.close());

  /** Um bot do Marlon com o experimento ligado e um card de app pendente na conversa dele. */
  async function card(trx: Tx, nome = "Vagas") {
    trxAtual = trx;
    const { deps, repos } = depsSobre(trx, MARLON);
    await repos.preferencias.gravar({ experimentos: { quadro: true } });
    const bot = await agenteComConversa(trx, MARLON, { nome: `Gil ${Math.random().toString(36).slice(2, 7)}` });
    const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversaId, agenteId: bot.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "cria o app", entradaConfianca: "confiavel", modelo: "auto" });
    const p = await proporApp(deps, { agenteId: bot.agenteId, conversaId: bot.conversaId, turnoId: t!.id, nome });
    if (!p.data.ok) throw new Error(JSON.stringify(p.data));
    return { repos, bot, decisaoId: p.data.propostaId };
  }
  const recibos = async (repos: ReturnType<typeof depsSobre>["repos"], conversaId: string) => (await repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.kind === "sistema").map((m) => m.texto);

  it("aceitar: 200 com o id do app, o app nasce como a última página e a decisão fecha", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, bot, decisaoId } = await card(trx);
      const s = await servidor.entrar("marlon");
      const r = await servidor.chamar(s, "POST", `decisoes/${decisaoId}/decidir`, {});
      expect(r.status, await r.clone().text()).toBe(200);
      const appId = ((await r.json()) as RespostaMutacao).ids.app;
      expect(appId).toBeTruthy();
      expect((await repos.appsDoBot.doAgente(bot.agenteId)).map((a) => [a.id, a.nome])).toEqual([[appId, "Vagas"]]);
      expect(await repos.decisoes.buscar(decisaoId)).toMatchObject({ estado: "decidida" });
      expect((await repos.propostas.buscar(decisaoId))?.estado).toBe("confirmada");
      // O segundo clique no card fechado: 409, e nada nasce de novo.
      expect((await servidor.chamar(s, "POST", `decisoes/${decisaoId}/decidir`, {})).status).toBe(409);
      expect(await repos.appsDoBot.doAgente(bot.agenteId)).toHaveLength(1);
      trxAtual = null;
    });
  });

  it("recusar: 200 sem app, a proposta recusada e o recibo na conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, bot, decisaoId } = await card(trx);
      const s = await servidor.entrar("marlon");
      const r = await servidor.chamar(s, "POST", `decisoes/${decisaoId}/decidir`, { recusar: true });
      expect(r.status, await r.clone().text()).toBe(200);
      expect(((await r.json()) as RespostaMutacao).ids.app).toBeUndefined();
      expect(await repos.appsDoBot.doAgente(bot.agenteId)).toEqual([]);
      expect((await repos.propostas.buscar(decisaoId))?.estado).toBe("recusada");
      expect(await recibos(repos, bot.conversaId)).toEqual(["App Vagas não criado."]);
      trxAtual = null;
    });
  });

  it("obsoleto: outro app pegou o nome enquanto o card esperava → 409, e a recusa e o aviso ficam gravados (commit antes do erro)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, bot, decisaoId } = await card(trx);
      await repos.appsDoBot.criar({ agenteId: bot.agenteId, nome: "vagas", icone: "app", fonte: "bot", fonteRef: null, forma: "lista", quemVe: "so_eu", regraPede: null });
      const s = await servidor.entrar("marlon");
      const r = await servidor.chamar(s, "POST", `decisoes/${decisaoId}/decidir`, {});
      expect(r.status).toBe(409);
      // Revisão 6 do #626: o motivo da lista fechada vai no corpo (a web diz a frase do card, não o vermelho genérico).
      expect((await r.json()) as ErroDto).toMatchObject({ codigo: "estado_invalido", motivo: "nome_em_uso" });
      expect((await repos.appsDoBot.doAgente(bot.agenteId)).map((a) => a.nome)).toEqual(["vagas"]);
      expect(await repos.decisoes.buscar(decisaoId)).toMatchObject({ estado: "decidida" });
      expect((await repos.propostas.buscar(decisaoId))?.estado).toBe("recusada");
      expect((await recibos(repos, bot.conversaId)).filter((t) => t.startsWith("O app Vagas não foi criado"))).toHaveLength(1);
      trxAtual = null;
    });
  });

  it("revisão 6: o limite chegou enquanto o card esperava → 409 com motivo limite_de_apps; nada nasce", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, bot, decisaoId } = await card(trx);
      for (let i = 0; i < 11; i++) await repos.appsDoBot.criar({ agenteId: bot.agenteId, nome: `App ${i}`, icone: "app", fonte: "bot", fonteRef: null, forma: "lista", quemVe: "so_eu", regraPede: null });
      const s = await servidor.entrar("marlon");
      const r = await servidor.chamar(s, "POST", `decisoes/${decisaoId}/decidir`, {});
      expect(r.status).toBe(409);
      expect((await r.json()) as ErroDto).toMatchObject({ codigo: "estado_invalido", motivo: "limite_de_apps" });
      expect(await repos.appsDoBot.doAgente(bot.agenteId)).toHaveLength(11);
      expect((await repos.propostas.buscar(decisaoId))?.estado).toBe("recusada");
      trxAtual = null;
    });
  });

  it("de outra pessoa: 404, o card segue pendente e nenhum app nasce no bot dela", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, bot, decisaoId } = await card(trx);
      const ana = await servidor.entrar("ana");
      const r = await servidor.chamar(ana, "POST", `decisoes/${decisaoId}/decidir`, {});
      expect(r.status, await r.clone().text()).toBe(404);
      expect(((await r.json()) as ErroDto).codigo).toBe("nao_encontrado");
      const r2 = await servidor.chamar(ana, "POST", `decisoes/${decisaoId}/decidir`, { recusar: true });
      expect(r2.status).toBe(404);
      // O escopo da Ana ficou na transação do teste (set_config local sobrevive ao savepoint): volta ao do Marlon para ler.
      await vincularEscopo(trx, MARLON);
      expect(await repos.appsDoBot.doAgente(bot.agenteId)).toEqual([]);
      expect(await repos.decisoes.buscar(decisaoId)).toMatchObject({ estado: "pendente" });
      expect((await repos.propostas.buscar(decisaoId))?.estado).toBe("pendente");
      trxAtual = null;
    });
  });
});
