import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasRotinas, type DepsRotasL7 } from "../../src/adapters/http/rotas/rotinas.ts";
import type { AgendaDto } from "../../src/contracts/agenda.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Escopo, Transacao, Tx } from "../../src/shared/types.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const TZ = "America/Sao_Paulo";
const DIA = 86_400_000;
const AGORA = Date.parse("2026-10-29T13:40Z"); // 10:40 em São Paulo
const DE = Date.parse("2026-10-26T03:00Z");
const ATE = DE + 7 * DIA;

let trxAtual: Tx | null = null;
const txPara = (escopo: Escopo): Transacao => async (fn) => {
  if (!trxAtual) throw new Error("teste sem transação aberta");
  await vincularEscopo(trxAtual, escopo);
  return fn(trxAtual);
};

const base = { fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", fusoIana: TZ, proximaExecucao: AGORA + DIA };

describeIntegracao("GET rotinas/agenda (NOD-85)", () => {
  let srv: ServidorDeTeste;
  let sessao: { cookie: string; tenantId: string; pessoaId: string };

  beforeAll(async () => {
    const semTrx = depsSobre({} as never, MARLON);
    const deps: DepsRotasL7 = { txPara, services: semTrx.deps.services, useCases: semTrx.deps.useCases, agora: () => AGORA };
    srv = await servidorDeTeste(criarRotasRotinas(deps));
    sessao = await srv.entrar("marlon");
  });
  afterAll(() => srv.close());

  const agenda = async (q: string) => srv.chamar(sessao, "GET", `rotinas/agenda?${q}`);

  it("passado guardado + previstas; pausada sem previstas; excluída e a de outra pessoa fora; filtro por agente", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const { repos } = vera;
      const diaria = await repos.rotinas.criar({ ...base, agenteId: vera.agenteId, conversaId: vera.conversaId, cron: "0 9 * * *", instrucao: "resumo" });
      const pausada = await repos.rotinas.criar({ ...base, agenteId: tuca.agenteId, conversaId: tuca.conversaId, cron: "0 17 * * 5", instrucao: "semanal", estado: "pausada" });
      const excluida = await repos.rotinas.criar({ ...base, agenteId: vera.agenteId, conversaId: vera.conversaId, cron: "0 8 * * *", instrucao: "velha" });
      if (!diaria || !pausada || !excluida) throw new Error("rotinas não criadas");
      await repos.rotinas.excluir(excluida.id, AGORA - DIA);
      await repos.rotinaExecucoes.registrar({ rotinaId: diaria.id, instanteAgendado: Date.parse("2026-10-28T12:00Z"), desfecho: "falhou", motivo: "erro_tecnico", em: Date.parse("2026-10-28T12:01Z") });
      await repos.rotinaExecucoes.registrar({ rotinaId: pausada.id, instanteAgendado: Date.parse("2026-10-23T20:00Z"), desfecho: "executou", em: Date.parse("2026-10-23T20:01Z") });
      await repos.rotinaExecucoes.registrar({ rotinaId: excluida.id, instanteAgendado: Date.parse("2026-10-28T11:00Z"), desfecho: "executou", em: Date.parse("2026-10-28T11:01Z") });

      // A Ana tem a própria rotina; a policy não deixa o Marlon vê-la (não é 'equipe').
      await vincularEscopo(trx, ANA);
      const daAna = await agenteComConversa(trx, ANA, { nome: "Lia" });
      await daAna.repos.rotinas.criar({ ...base, agenteId: daAna.agenteId, conversaId: daAna.conversaId, cron: "0 10 * * *", instrucao: "da ana" });
      await vincularEscopo(trx, MARLON);

      const r = await agenda(`de=${DE}&ate=${ATE}&fuso=${encodeURIComponent(TZ)}`);
      expect(r.status).toBe(200);
      const dto = (await r.json()) as AgendaDto;
      expect(dto).toMatchObject({ de: DE, ate: ATE, agora: AGORA, fuso: TZ });
      expect(dto.rotinas.map((x) => x.id).sort()).toEqual([diaria.id, pausada.id].sort());
      expect(dto.rotinas.find((x) => x.id === diaria.id)).toMatchObject({ conversaId: vera.conversaId, estado: "ativa", registroDesde: null, cortado: false, minha: true });
      const daDiaria = dto.itens.filter((i) => i.rotinaId === diaria.id);
      expect(daDiaria.filter((i) => i.tipo === "execucao")).toEqual([expect.objectContaining({ dia: "2026-10-28", desfecho: "falhou", problema: true })]);
      expect(daDiaria.filter((i) => i.tipo === "prevista").map((i) => i.dia)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
      expect(dto.itens.filter((i) => i.rotinaId === pausada.id)).toEqual([]); // pausada: sem previstas (e a execução é de antes do intervalo)

      const soTuca = (await (await agenda(`de=${DE}&ate=${ATE}&fuso=${encodeURIComponent(TZ)}&agente=${tuca.agenteId}`)).json()) as AgendaDto;
      expect(soTuca.rotinas.map((x) => x.id)).toEqual([pausada.id]);
      trxAtual = null;
    });
  });

  it("400 entrada_invalida: mais de 42 dias, intervalo invertido, sem parâmetro, agente fora do formato; fuso por offset → fuso_invalido", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      // 42 dias + 2 h (a troca de horário de verão no meio; Troll muda 2 h) ainda passa; um ms a mais, não (revisões 1 e 3 do PR 595).
      expect((await agenda(`de=${DE}&ate=${DE + 42 * DIA + 7_200_000}`)).status).toBe(200);
      for (const q of [`de=${DE}&ate=${DE + 42 * DIA + 7_200_001}`, `de=${ATE}&ate=${DE}`, `de=${DE}`, `de=abc&ate=${ATE}`, `de=${DE}&ate=${ATE}&agente=abc`]) {
        const r = await agenda(q);
        expect([q, r.status]).toEqual([q, 400]);
        expect(((await r.json()) as { codigo: string }).codigo).toBe("entrada_invalida");
      }
      const fuso = await agenda(`de=${DE}&ate=${ATE}&fuso=${encodeURIComponent("-03:00")}`);
      expect(fuso.status).toBe(400);
      expect(((await fuso.json()) as { codigo: string }).codigo).toBe("fuso_invalido");
      trxAtual = null;
    });
  });

  it("não é capturada por /rotinas/:id: 'agenda' nunca vira id", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      expect((await srv.chamar(sessao, "GET", "rotinas/agenda/execucoes")).status).toBe(404);
      trxAtual = null;
    });
  });
});
