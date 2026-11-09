import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasRotinas, type DepsRotasL7 } from "../../src/adapters/http/rotas/rotinas.ts";
import type { PayloadRotinaRitmo } from "../../src/contracts/rotina-ritmo.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { SILENCIO_DO_DEIXAR_MS } from "../../src/domain/ritmo-rotina.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Transacao, Tx } from "../../src/shared/types.ts";
import { contarRitmo } from "../../src/use-cases/ritmo-rotina.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * definido em 2026-10-23 (NOD-313): a migração 0108 (`rotina_ritmo`) no Postgres — a contagem por upsert, UM card aberto
 * por rotina (reivindicado de forma condicional), o silêncio de 30 dias, o RLS da dona — e a rota POST rotinas/:id/ritmo.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const TZ = "America/Sao_Paulo";

let trxAtual: Tx | null = null;
const txPara = (escopo: Escopo): Transacao => async (fn) => {
  if (!trxAtual) throw new Error("teste sem transação aberta");
  await vincularEscopo(trxAtual, escopo);
  return fn(trxAtual);
};

async function rotinaDeMeiaHora(trx: Tx) {
  const { agenteId, conversaId, repos } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
  const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "*/30 * * * *", fusoIana: TZ, instrucao: "Olhar PRs abertos", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() + 60_000 });
  if (!rotina) throw new Error("rotina não criada");
  return { repos, rotina, conversaId };
}

describeIntegracao("ritmo da rotina (0108, NOD-313)", () => {
  let srv: ServidorDeTeste;
  let sessao: { cookie: string; tenantId: string; pessoaId: string };

  beforeAll(async () => {
    const semTrx = depsSobre({} as never, MARLON);
    const deps: DepsRotasL7 = { txPara, services: semTrx.deps.services, useCases: semTrx.deps.useCases, agora: () => Date.now() };
    srv = await servidorDeTeste(criarRotasRotinas(deps));
    sessao = await srv.entrar("marlon");
  });
  afterAll(() => srv.close());

  it("conta por upsert, reivindica UM card, o silêncio barra o próximo e só a dona vê a linha", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, rotina } = await rotinaDeMeiaHora(trx);
      const agora = Date.now();
      for (let i = 0; i < 19; i++) await repos.rotinaRitmo.contar(rotina.id, "soma");
      expect(await repos.rotinaRitmo.reivindicarCard(rotina.id, agora, 20)).toBe(false);
      expect((await repos.rotinaRitmo.contar(rotina.id, "soma"))?.semNovidadeSeguidas).toBe(20);
      expect(await repos.rotinaRitmo.reivindicarCard(rotina.id, agora, 20)).toBe(true);
      expect(await repos.rotinaRitmo.reivindicarCard(rotina.id, agora, 20)).toBe(false);
      await repos.rotinaRitmo.fecharCard(rotina.id, { silenciadaAte: agora + SILENCIO_DO_DEIXAR_MS, desfazer: null });
      expect(await repos.rotinaRitmo.buscar(rotina.id)).toMatchObject({ semNovidadeSeguidas: 0, sugeridaEm: null, silenciadaAte: agora + SILENCIO_DO_DEIXAR_MS });
      for (let i = 0; i < 20; i++) await repos.rotinaRitmo.contar(rotina.id, "soma");
      expect(await repos.rotinaRitmo.reivindicarCard(rotina.id, agora + 1000, 20)).toBe(false);
      expect(await repos.rotinaRitmo.reivindicarCard(rotina.id, agora + SILENCIO_DO_DEIXAR_MS, 20)).toBe(true);
      // Fechar sem silêncio novo mantém o que já havia (coalesce).
      await repos.rotinaRitmo.fecharCard(rotina.id, { silenciadaAte: null, desfazer: null });
      expect((await repos.rotinaRitmo.buscar(rotina.id))?.silenciadaAte).toBe(agora + SILENCIO_DO_DEIXAR_MS);
      expect((await repos.rotinaRitmo.contar(rotina.id, "zera"))?.semNovidadeSeguidas).toBe(0);
      // A contagem nunca fica negativa nem o "desfazer" vira lixo grande (CHECKs da 0108).
      await expect(trx.savepoint((s) => s`update rotina_ritmo set sem_novidade_seguidas = -1 where rotina_id = ${rotina.id}`)).rejects.toMatchObject({ code: "23514" });
      await expect(trx.savepoint((s) => s`update rotina_ritmo set desfazer = '[]'::jsonb where rotina_id = ${rotina.id}`)).rejects.toMatchObject({ code: "23514" });

      await vincularEscopo(trx, ANA);
      expect(await criarRepos(trx, ANA).rotinaRitmo.buscar(rotina.id)).toBeNull();
      await vincularEscopo(trx, MARLON);
    });
  });

  it("20 sem novidade escrevem o card; a rota aplica o clique uma vez, desfaz e recusa opção ou card desconhecidos", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { repos, rotina, conversaId } = await rotinaDeMeiaHora(trx);
      const { deps } = depsSobre(trx, MARLON);
      for (let i = 0; i < 25; i++) await contarRitmo(deps, (await repos.rotinas.buscar(rotina.id))!, "sem_novidade", null);
      const cards = (await repos.mensagens.listarDaConversa(conversaId, 50)).filter((m) => m.payload?.kind === "rotina_ritmo");
      expect(cards).toHaveLength(1);
      const card = cards[0]!;
      expect((card.payload as PayloadRotinaRitmo).seguidas).toBe(20);
      // A regra: 25 sem novidade e a rotina segue igual.
      expect(await repos.rotinas.buscar(rotina.id)).toMatchObject({ cron: "*/30 * * * *", estado: "ativa" });

      const ruim = await srv.chamar(sessao, "POST", `rotinas/${rotina.id}/ritmo`, { mensagemId: card.id, opcao: "apagar" });
      expect(ruim.status).toBe(400);
      const outro = await srv.chamar(sessao, "POST", `rotinas/${rotina.id}/ritmo`, { mensagemId: rotina.id, opcao: "pausar" });
      expect(outro.status).toBe(404);

      const ok = await srv.chamar(sessao, "POST", `rotinas/${rotina.id}/ritmo`, { mensagemId: card.id, opcao: "espacar" });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ ok: true, ids: { rotinaId: rotina.id, aplicada: "true" } });
      expect((await repos.rotinas.buscar(rotina.id))?.cron).toBe("0 */2 * * *");
      const resolvido = await repos.mensagens.buscar(card.id);
      expect(resolvido?.texto).toContain("espaçada para a cada 2 h (ajuste sugerido pelo nod, aceito por você)");

      const dupla = await srv.chamar(sessao, "POST", `rotinas/${rotina.id}/ritmo`, { mensagemId: card.id, opcao: "pausar" });
      expect(await dupla.json()).toEqual({ ok: true, ids: { rotinaId: rotina.id, aplicada: "false", motivo: "ja_decidido" } });
      expect((await repos.rotinas.buscar(rotina.id))?.estado).toBe("ativa");

      const volta = await srv.chamar(sessao, "POST", `rotinas/${rotina.id}/ritmo`, { mensagemId: card.id, opcao: "desfazer" });
      expect(volta.status).toBe(200);
      expect((await repos.rotinas.buscar(rotina.id))?.cron).toBe("*/30 * * * *");
      expect(((await repos.mensagens.buscar(card.id))?.payload as PayloadRotinaRitmo).decisao).toBeNull();
    });
  });

  it("outra pessoa do tenant não decide o card da rotina alheia", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { repos, rotina, conversaId } = await rotinaDeMeiaHora(trx);
      const { deps } = depsSobre(trx, MARLON);
      for (let i = 0; i < 20; i++) await contarRitmo(deps, rotina, "sem_novidade", null);
      const card = (await repos.mensagens.listarDaConversa(conversaId, 50)).find((m) => m.payload?.kind === "rotina_ritmo")!;
      const ana = await srv.entrar("ana");
      const r = await srv.chamar(ana, "POST", `rotinas/${rotina.id}/ritmo`, { mensagemId: card.id, opcao: "pausar" });
      expect(r.status).toBe(404);
      await vincularEscopo(trx, MARLON);
      expect((await repos.rotinas.buscar(rotina.id))?.estado).toBe("ativa");
    });
  });
});
