import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { criarRotasSuaVez, type ComDeps } from "../../src/adapters/http/rotas/sua-vez.ts";
import type { SuaVezDto } from "../../src/contracts/api.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { dispararRotina, registrarDesfechoRotina } from "../../src/use-cases/disparar-rotina.ts";
import { dispensarDecisao } from "../../src/use-cases/dispensar-decisao.ts";
import { REGRA_GEMEA_RESOLVIDA } from "../../src/use-cases/fechar-gemeas.ts";
import { listarSuaVez, type DepsSuaVez } from "../../src/use-cases/listar-sua-vez.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const DIA = 86_400_000;
const FRASE_QUEDA = "Turno interrompido: seu Mac parou de responder (repouso, sem rede ou nod fechado).";

const deps = (trx: Tx, escopo: Escopo, agora: () => number): DepsSuaVez => ({ repos: criarRepos(trx, escopo), escopo, agora, tx: (fn) => fn(trx) });

/** ComDeps sobre o trx condenado do withRollback: a rota roda na MESMA tx do teste (web-sem-app.test.ts). */
function comDepsSobre(trx: Tx, agora: () => number): ComDeps {
  return async (escopo, fn) => {
    await vincularEscopo(trx, escopo);
    return fn(deps(trx, escopo, agora));
  };
}

/** Um "Retomar" aberto de um turno de conversa interrompido pelo Mac. */
async function retomarAberto(trx: Tx, alvo: { agenteId: string; conversaId: string }, agora: number): Promise<string> {
  const repos = criarRepos(trx, MARLON);
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId: alvo.conversaId, agenteId: alvo.agenteId, origem: "conversa", prazoEm: agora + 60_000, profundidade: 0, entradaTexto: "revise", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001", interrompidoCom: "maquina_sem_contato" });
  const d = await repos.decisoes.criar({ tipo: "retomar_turno", agenteId: alvo.agenteId, conversaId: alvo.conversaId, turnoId: turno?.id ?? null, prazoDecisaoEm: agora + DIA, frase: FRASE_QUEDA });
  if (!d) throw new Error("decisão");
  return d.id;
}

/**
 * Fila honesta (definido em 2026-09-24) sobre o Postgres de verdade: RLS, CHECKs e as policies por
 * comando que o banco em memória não tem.
 */
describeIntegracao("fila honesta: gêmeas, dispensar o 'Retomar', janela da rotina e computador do bot", () => {
  it("HTTP: 'Sua vez' dobra os 'Retomar' iguais em UM item ×2 (e marca os dois como vistos); dispensar o grupo → 200 e a gêmea fecha por regra; aprovação aberta → 409", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const srv = await servidorDeTeste(criarRotasSuaVez(comDepsSobre(trx, () => agora)));
      try {
        const marlon = await srv.entrar("marlon");
        const alvo = await agenteComConversa(trx, MARLON, { nome: "Vera" });
        const primeiro = await retomarAberto(trx, alvo, agora);
        const segundo = await retomarAberto(trx, alvo, agora);
        const aprovacao = await alvo.repos.decisoes.criar({ tipo: "aprovacao", agenteId: alvo.agenteId, conversaId: alvo.conversaId, prazoDecisaoEm: agora + DIA, frase: "enviar 3 e-mails" });

        const fila = (await (await srv.chamar(marlon, "GET", "sua-vez")).json()) as SuaVezDto;
        expect(fila.itens.map((i) => [i.decisao.id, i.gemeas])).toEqual([
          [primeiro, [segundo]],
          [aprovacao?.id, []],
        ]);
        expect((await alvo.repos.decisoes.buscar(segundo))?.vistaEm).not.toBeNull();

        const r = await srv.chamar(marlon, "POST", `decisoes/${primeiro}/dispensar`);
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ ok: true, ids: { decisaoId: primeiro } });
        expect((await alvo.repos.decisoes.buscar(primeiro))?.desfecho).toMatchObject({ tipo: "dispensada", por: PESSOA_MARLON, antes: "pendente" });
        expect(await alvo.repos.decisoes.buscar(segundo)).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: REGRA_GEMEA_RESOLVIDA, regraVersao: 1 } });
        // Regra não é pessoa (ADR-042): decidida_por fica NULA na gêmea.
        const [linha] = await trx<{ decidida_por: string | null }[]>`select decidida_por from decisoes where id = ${segundo}`;
        expect(linha?.decidida_por).toBeNull();

        const recusa = await srv.chamar(marlon, "POST", `decisoes/${aprovacao?.id}/dispensar`);
        expect(recusa.status).toBe(409);
        expect(((await recusa.json()) as { codigo: string }).codigo).toBe("estado_invalido");
        expect((await srv.chamar(marlon, "POST", `decisoes/${randomUUID()}/dispensar`)).status).toBe(404);

        const depois = (await (await srv.chamar(marlon, "GET", "sua-vez")).json()) as SuaVezDto;
        expect(depois.itens.map((i) => i.decisao.id)).toEqual([aprovacao?.id]);
      } finally {
        await srv.close();
      }
    });
  });

  it("pedido ABERTO de uma execução de rotina, dispensado: a janela vira passou_em_branco 'pedido_dispensado' — o CHECK de rotina_execucoes aceita, sem migração", async () => {
    await withRollback(MARLON, async (trx) => {
      const JANELA = Date.parse("2026-09-24T08:00:00-03:00");
      const AGORA = JANELA + 60_000;
      const alvo = await agenteComConversa(trx, MARLON, { nome: "Nina" });
      const { deps: completo, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const rotina = await repos.rotinas.criar({ agenteId: alvo.agenteId, conversaId: alvo.conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resuma os e-mails", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "diga que não houve", proximaExecucao: JANELA });
      if (!rotina) throw new Error("rotina");
      const disparo = await dispararRotina(completo, { rotina, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in disparo.data)) throw new Error("sem turno");
      const turnoId = disparo.data.turno.id;
      const pedido = await repos.decisoes.criar({ tipo: "falta_de_dado", agenteId: alvo.agenteId, conversaId: alvo.conversaId, turnoId, prazoDecisaoEm: AGORA + DIA, frase: "falta o acesso ao Gmail" });
      await repos.turnos.assentar(turnoId, { estado: "concluido" });
      await registrarDesfechoRotina(completo, { turnoId, desfecho: "executou" });

      const r = await dispensarDecisao(deps(trx, MARLON, () => AGORA), { decisaoId: pedido?.id ?? "" });
      await repos.events.gravarComOutbox(r.events);
      expect((await repos.rotinaExecucoes.listar(rotina.id)).map((e) => [e.instanteAgendado, e.desfecho, e.motivo])).toEqual([[JANELA, "passou_em_branco", "pedido_dispensado"]]);
      const aviso = (await repos.mensagens.listarDaConversa(alvo.conversaId)).filter((m) => m.kind === "rotina_execucao").at(-1);
      expect(aviso?.texto).toContain("A rotina passou em branco: o pedido foi dispensado sem resposta. Nada foi enviado.");
    });
  });

  it("pedido de ajuda do computador do bot, dispensado: o controle volta ao bot com 'devolver' registrado; em takeover, a pessoa segue no controle (ADR-037)", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const alvo = await agenteComConversa(trx, MARLON, { nome: "Taga" });
      const c = await alvo.repos.computadores.obter(alvo.agenteId);
      if (!c) throw new Error("computador");
      const ajuda = async () => {
        const d = await alvo.repos.decisoes.criar({ tipo: "pergunta", agenteId: alvo.agenteId, conversaId: alvo.conversaId, prazoDecisaoEm: agora + DIA, frase: "Abra meu computador para concluir este passo: login no banco." });
        if (!d) throw new Error("decisão");
        return d.id;
      };

      const aguardando = await ajuda();
      await alvo.repos.computadores.configurar(c.id, { controle: "aguardando_pessoa", ajuda: "login no banco", ajudaDecisaoId: aguardando });
      await dispensarDecisao(deps(trx, MARLON, () => agora), { decisaoId: aguardando });
      expect(await alvo.repos.computadores.travar(c.id)).toMatchObject({ controle: "bot", ajuda: null, ajudaDecisaoId: null });
      expect((await alvo.repos.computadores.atividade(c.id)).map((a) => [a.autor, a.tipo, a.estado])).toEqual([["pessoa", "devolver", "concluida"]]);

      const emTakeover = await ajuda();
      await alvo.repos.computadores.configurar(c.id, { controle: "pessoa", ajuda: "login no banco", ajudaDecisaoId: emTakeover });
      await dispensarDecisao(deps(trx, MARLON, () => agora), { decisaoId: emTakeover });
      expect(await alvo.repos.computadores.travar(c.id)).toMatchObject({ controle: "pessoa", ajuda: null, ajudaDecisaoId: null });
      expect(await alvo.repos.computadores.atividade(c.id)).toHaveLength(1);
    });
  });

  it("listar = ver também para a gêmea dobrada: vencida depois, ela sai 'expirou_com_alguem_ciente' (ADR-017 #2)", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const alvo = await agenteComConversa(trx, MARLON);
      const primeiro = await retomarAberto(trx, alvo, agora);
      const segundo = await retomarAberto(trx, alvo, agora);
      const { data } = await listarSuaVez(deps(trx, MARLON, () => agora));
      expect(data.itens.map((i) => [i.decisao.id, i.gemeas])).toEqual([[primeiro, [segundo]]]);
      await alvo.repos.decisoes.vencerPendentes(agora + 2 * DIA);
      expect((await alvo.repos.decisoes.buscar(segundo))?.desfecho?.tipo).toBe("expirou_com_alguem_ciente");
    });
  });
});
