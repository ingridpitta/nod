import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { ENTRADA_DA_VOLTA_DA_COTA } from "../../src/domain/cota-da-ia.ts";
import { autoriaAgente } from "../../src/use-cases/apoio-l7.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const TZ = "America/Sao_Paulo";
const H = 60 * 60_000;
const T0 = Date.parse("2026-10-16T09:00:00-03:00");

/**
 * NOD-274 C9/C7/C10 contra o Postgres: o SQL de `filhaAbertaDaRotina(rotinaId, colegaAntesDe)` e o de
 * `esperaDaCotaDe` (os testes unitários só cobrem os repositórios em memória).
 */
async function cenario(
  trx: Tx,
  agora: { v: number },
  o: { turnoVivo?: boolean; decisao?: boolean; colegaTerminou?: boolean } = {},
) {
  const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, {
    nome: "Ada",
  });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora.v });
  const rotina = await repos.rotinas.criar({
    agenteId,
    conversaId,
    cron: "0 * * * *",
    fusoIana: TZ,
    instrucao: "acompanhe",
    fonte: "f",
    entregavel: "e",
    limitesAprovacao: "l",
    politicaSemDado: "p",
    proximaExecucao: T0,
  });
  if (!rotina) throw new Error("rotina");
  const mae = await repos.trabalhos.criar({
    agenteId,
    conversaId,
    titulo: "Mãe",
    origem: "rotina",
    rotinaId: rotina.id,
  });
  const filha = await repos.trabalhos.criar({
    agenteId,
    conversaId,
    titulo: "Orquestrar",
    origem: "rotina",
    rotinaId: rotina.id,
    trabalhoMaeId: mae!.id,
  });
  if (!filha) throw new Error("filha");
  await repos.trabalhos.mudarEstado(filha.id, "rodando", T0);
  const turno = await repos.turnos.enfileirar({
    executor: "catcher",
    conversaId,
    agenteId,
    origem: "conversa",
    prazoEm: T0 + H,
    profundidade: 0,
    entradaTexto: "x",
    entradaConfianca: "confiavel",
    modelo: "sonnet",
    harness: "claude-cli",
    trabalhoId: filha.id,
  });
  if (!turno) throw new Error("turno");
  if (!o.turnoVivo)
    await repos.turnos.assentar(turno.id, { estado: "concluido" });
  const eng = await agenteComConversa(trx, MARLON, { nome: "Eng 1" });
  const colega = await repos.trabalhos.criar({
    agenteId: eng.agenteId,
    conversaId: eng.conversaId,
    titulo: "Task do colega",
    origem: "pessoa",
  });
  await repos.mensagens.criar({
    conversaId,
    turnoId: turno.id,
    autoria: autoriaAgente(agenteId, PESSOA_MARLON),
    kind: "handoff",
    texto: "Ada pediu a Eng 1",
    payload: {
      kind: "handoff",
      de: agenteId,
      para: eng.agenteId,
      motivo: "faça",
      tarefaId: turno.id,
      trabalhoId: colega!.id,
    } as never,
    confianca: "nao_confiavel",
  });
  await trx`update mensagens set criado_em = ${new Date(T0)} where conversa_id = ${conversaId} and kind = 'handoff'`;
  if (o.colegaTerminou)
    await repos.trabalhos.mudarEstado(colega!.id, "terminado", T0 + 1);
  if (o.decisao)
    await repos.decisoes.criar({
      tipo: "pergunta",
      agenteId,
      conversaId,
      turnoId: turno.id,
      prazoDecisaoEm: T0 + 48 * H,
      frase: "e agora?",
    } as never);
  return { deps, repos, rotina, filha, turno, agenteId, conversaId };
}

describeIntegracao(
  "NOD-274 C9 no Postgres: frente esperando colega não segura a rotina para sempre",
  () => {
    it("o SQL só solta a frente rodando, sem turno vivo, cujo pedido ao colega é anterior ao corte", async () => {
      await withRollback(MARLON, async (trx) => {
        const agora = { v: T0 };
        const c = await cenario(trx, agora);
        expect(
          (await c.repos.trabalhos.filhaAbertaDaRotina(c.rotina.id))?.id,
        ).toBe(c.filha.id);
        expect(
          (await c.repos.trabalhos.filhaAbertaDaRotina(c.rotina.id, T0 - 1))
            ?.id,
        ).toBe(c.filha.id);
        expect(
          await c.repos.trabalhos.filhaAbertaDaRotina(c.rotina.id, T0 + 1),
        ).toBeNull();
      });
    });

    it("turno vivo, pergunta pendente ou colega já terminado seguem segurando", async () => {
      for (const o of [
        { turnoVivo: true },
        { decisao: true },
        { colegaTerminou: true },
      ]) {
        await withRollback(MARLON, async (trx) => {
          const c = await cenario(trx, { v: T0 }, o);
          expect(
            (
              await c.repos.trabalhos.filhaAbertaDaRotina(
                c.rotina.id,
                T0 + 10 * H,
              )
            )?.id,
            JSON.stringify(o),
          ).toBe(c.filha.id);
        });
      }
    });

    // revisto em 2026-10-16 (integração no #335): a janela pulada é a 'adiada' da NOD-243 — reivindicada, sem turno.
    it("dentro do prazo: 'adiada'/'frente_aberta' sem turno, janela reivindicada; passado o prazo, dispara", async () => {
      await withRollback(MARLON, async (trx) => {
        const agora = { v: T0 + H };
        const c = await cenario(trx, agora);
        const pulada = await dispararRotina(c.deps, {
          rotina: c.rotina,
          instanteAgendado: T0 + H,
          machineId: randomUUID(),
          executor: "catcher",
        });
        expect(pulada.data).toMatchObject({
          adiada: "frente_aberta",
          trabalhoAbertoId: c.filha.id,
        });
        expect(
          (await c.repos.rotinaExecucoes.listar(c.rotina.id)).map((e) => [
            e.instanteAgendado,
            e.desfecho,
            e.motivo,
            e.turnoId,
          ]),
        ).toEqual([[T0 + H, "adiada", "frente_aberta", null]]);
        expect((await c.repos.rotinaJanelas.listar(c.rotina.id)).map((j) => [j.instanteAgendado, j.turnoId])).toEqual([[T0 + H, null]]);
        await dispararRotina(c.deps, {
          rotina: c.rotina,
          instanteAgendado: T0 + H,
          machineId: randomUUID(),
          executor: "catcher",
        });
        expect(await c.repos.rotinaExecucoes.listar(c.rotina.id)).toHaveLength(
          1,
        );

        agora.v = T0 + 2 * H + 60_000;
        const rodou = await dispararRotina(c.deps, {
          rotina: c.rotina,
          instanteAgendado: T0 + 2 * H,
          machineId: randomUUID(),
          executor: "catcher",
        });
        expect("turno" in rodou.data, JSON.stringify(rodou.data)).toBe(true);
        expect((await c.repos.trabalhos.buscar(c.filha.id))?.estado).toBe(
          "rodando",
        );
      });
    });
  },
);

describeIntegracao(
  "NOD-274 C7/C10 no Postgres: esperaDaCotaDe segue a cadeia de retomadas",
  () => {
    it("acha a volta pendente da cota na cadeia, ignora a vencida e a de outro prefixo", async () => {
      await withRollback(MARLON, async (trx) => {
        const agora = Date.now();
        const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, {
          nome: "Ada",
        });
        const { repos } = depsSobre(trx, MARLON, { agora: () => agora });
        const base = {
          executor: "catcher" as const,
          conversaId,
          agenteId,
          prazoEm: agora + H,
          profundidade: 0 as const,
          entradaConfianca: "confiavel" as const,
          modelo: "sonnet",
          harness: "claude-cli" as const,
        };
        const raiz = await repos.turnos.enfileirar({
          ...base,
          origem: "conversa",
          entradaTexto: "faça",
        });
        await repos.turnos.assentar(raiz!.id, { estado: "concluido" });
        expect(
          await repos.rotinaJanelas.esperaDaCotaDe(
            raiz!.id,
            ENTRADA_DA_VOLTA_DA_COTA,
            agora,
          ),
        ).toBeNull();
        // 1º elo vencido (já acordou), 2º elo com a volta da cota daqui a 2 h.
        const elo1 = await repos.turnos.enfileirar({
          ...base,
          origem: "retomada",
          retomaTurnoId: raiz!.id,
          entradaTexto: `${ENTRADA_DA_VOLTA_DA_COTA}Claude voltou`,
          acordarEm: agora - 1_000,
        });
        await repos.turnos.assentar(elo1!.id, { estado: "concluido" });
        const outro = await repos.turnos.enfileirar({
          ...base,
          origem: "retomada",
          retomaTurnoId: elo1!.id,
          entradaTexto: "lembrete",
          acordarEm: agora + H,
        });
        expect(
          await repos.rotinaJanelas.esperaDaCotaDe(
            raiz!.id,
            ENTRADA_DA_VOLTA_DA_COTA,
            agora,
          ),
        ).toBeNull();
        await repos.turnos.assentar(outro!.id, { estado: "concluido" });
        await repos.turnos.enfileirar({
          ...base,
          origem: "retomada",
          retomaTurnoId: outro!.id,
          entradaTexto: `${ENTRADA_DA_VOLTA_DA_COTA}Claude voltou`,
          acordarEm: agora + 2 * H,
        });
        const achou = await repos.rotinaJanelas.esperaDaCotaDe(
          raiz!.id,
          ENTRADA_DA_VOLTA_DA_COTA,
          agora,
        );
        expect(achou).toMatchObject({ harness: "claude-cli" });
        expect(Math.abs((achou?.voltaEm ?? 0) - (agora + 2 * H))).toBeLessThan(
          1_000,
        );
        expect(
          await repos.rotinaJanelas.esperaDaCotaDe(
            raiz!.id,
            ENTRADA_DA_VOLTA_DA_COTA,
            agora + 3 * H,
          ),
        ).toBeNull();
      });
    });
  },
);
