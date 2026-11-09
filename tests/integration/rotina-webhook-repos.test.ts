import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { CRON_SENTINELA_WEBHOOK, PROXIMA_WEBHOOK } from "../../src/domain/rotina-webhook.ts";
import { cunharTokenGatilho } from "../../src/services/token-gatilho.ts";
import type { Tx } from "../../src/shared/types.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { listarRotinas } from "../../src/use-cases/listar-rotinas.ts";

/**
 * NOD-84 (ADR-139, 0130) no SQL: um endereço vivo por rotina, o dedupe pelo id de entrega, o "!" da recusa pendente,
 * a poda (50 + 72 h), a contagem de execuções abertas e o agendador que não vê a rotina webhook. RLS: a Ana não vê o
 * endereço nem o log do Marlon.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-10-30T12:00:00Z");
const H = 3_600_000;

async function montar(trx: Tx) {
  const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
  const { repos } = depsSobre(trx, MARLON);
  const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: CRON_SENTINELA_WEBHOOK, fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: PROXIMA_WEBHOOK, gatilho: "webhook", provedor: "Stripe", eventos: ["payment_intent.succeeded"] });
  if (!rotina) throw new Error("rotina");
  return { repos, rotina, agenteId, conversaId };
}

const novoGatilho = (rotinaId: string) => {
  const c = cunharTokenGatilho(MARLON, rotinaId);
  return { rotinaId, prefixo: c.prefixo, hash: c.hash, tokenCifrado: "cifrado-token", segredoHmacCifrado: "cifrado-hmac" };
};

describeIntegracao("rotina webhook: endereço, log de chamadas e execuções abertas (NOD-84)", () => {
  it("a rotina webhook guarda gatilho, provedor e eventos, e o agendador não a vê", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect(m.rotina).toMatchObject({ gatilho: "webhook", provedor: "Stripe", eventos: ["payment_intent.succeeded"], proximaExecucao: PROXIMA_WEBHOOK });
      // Mesmo com a próxima no passado, ativasVencidas filtra gatilho = 'horario'.
      await trx`update rotinas set proxima_execucao = ${new Date(AGORA - H)} where id = ${m.rotina.id}`;
      expect((await m.repos.rotinas.ativasVencidas(AGORA)).map((r) => r.id)).not.toContain(m.rotina.id);
    });
  });

  it("o banco recusa a rotina incoerente: webhook sem provedor, provedor ou filtro na de horário (revisão da NOD-84)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const tenta = async (sql: () => Promise<unknown>) => {
        await trx`savepoint coerencia`;
        try {
          await sql();
          await trx`release savepoint coerencia`;
          return "gravou";
        } catch (e) {
          await trx`rollback to savepoint coerencia`;
          return (e as { constraint_name?: string }).constraint_name ?? String(e);
        }
      };
      expect(await tenta(() => trx`update rotinas set provedor = null where id = ${m.rotina.id}`)).toBe("rotinas_webhook_tem_provedor");
      expect(await tenta(() => trx`update rotinas set gatilho = 'horario', eventos = null where id = ${m.rotina.id}`)).toBe("rotinas_webhook_tem_provedor");
      expect(await tenta(() => trx`update rotinas set gatilho = 'horario', provedor = null where id = ${m.rotina.id}`)).toBe("rotinas_eventos_so_webhook");
      expect(await tenta(() => trx`update rotinas set eventos = null where id = ${m.rotina.id}`)).toBe("gravou");
    });
  });

  it("gerar novo endereço revoga o anterior; só um vivo; a Ana não vê o do Marlon", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = await m.repos.rotinaGatilhos.criar(novoGatilho(m.rotina.id), AGORA);
      const b = await m.repos.rotinaGatilhos.criar(novoGatilho(m.rotina.id), AGORA + 1000);
      expect(a?.id).not.toBe(b?.id);
      const vivo = await m.repos.rotinaGatilhos.vivoDaRotina(m.rotina.id, { travar: true });
      expect(vivo?.id).toBe(b?.id);
      expect(vivo?.hash.length).toBe(32);
      const [vivos] = await trx<{ n: number }[]>`select count(*)::int as n from rotina_gatilhos where rotina_id = ${m.rotina.id} and revogado_em is null`;
      expect(vivos?.n).toBe(1);

      expect(await m.repos.rotinaGatilhos.marcarAssinado(b?.id ?? "", AGORA + 2000)).toBe(true);
      await m.repos.rotinaGatilhos.marcarAssinado(b?.id ?? "", AGORA + 9000);
      expect((await m.repos.rotinaGatilhos.vivoDaRotina(m.rotina.id))?.assinadoEm).toBe(AGORA + 2000);

      const ana = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
      await vincularEscopo(trx, ana);
      const daAna = depsSobre(trx, ana).repos;
      expect(await daAna.rotinaGatilhos.vivoDaRotina(m.rotina.id)).toBeNull();
      const [visiveis] = await trx<{ v: number }[]>`select count(*)::int as v from rotina_gatilhos`;
      expect(visiveis?.v).toBe(0);
      await vincularEscopo(trx, MARLON);

      expect(await m.repos.rotinaGatilhos.revogarDaRotina(m.rotina.id, AGORA + 3000)).toBe(1);
      expect(await m.repos.rotinaGatilhos.vivoDaRotina(m.rotina.id)).toBeNull();
    });
  });

  it("dedupe: o mesmo id de entrega grava uma vez; sem id, grava sempre", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const primeira = await m.repos.rotinaChamadas.registrar({ rotinaId: m.rotina.id, em: AGORA, desfecho: "rodou", evento: "payment_intent.succeeded", entregaId: "evt_1" });
      expect(primeira).toMatchObject({ desfecho: "rodou", evento: "payment_intent.succeeded" });
      expect(await m.repos.rotinaChamadas.registrar({ rotinaId: m.rotina.id, em: AGORA + 1, desfecho: "rodou", entregaId: "evt_1" })).toBeNull();
      expect(await m.repos.rotinaChamadas.jaEntregue(m.rotina.id, "evt_1")).toBe(true);
      await m.repos.rotinaChamadas.registrar({ rotinaId: m.rotina.id, em: AGORA + 2, desfecho: "ignorada" });
      await m.repos.rotinaChamadas.registrar({ rotinaId: m.rotina.id, em: AGORA + 3, desfecho: "ignorada" });
      expect((await m.repos.rotinaChamadas.listar(m.rotina.id, 50)).map((c) => c.em)).toEqual([AGORA + 3, AGORA + 2, AGORA]);
      expect(await m.repos.rotinaChamadas.contarDesde(m.rotina.id, AGORA + 1)).toBe(2);
    });
  });

  it("o '!' da lista: recusa mais nova que a aceita mais nova; some quando chega uma aceita", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.rotinaChamadas.registrar({ rotinaId: m.rotina.id, em: AGORA, desfecho: "rodou" });
      await m.repos.rotinaChamadas.registrar({ rotinaId: m.rotina.id, em: AGORA + 1000, desfecho: "recusada", motivo: "assinatura" });
      expect(await m.repos.rotinaChamadas.comRecusaPendente()).toContain(m.rotina.id);
      // O "Enviar teste" da dona não conta como aceita (revisão 3).
      await m.repos.rotinaChamadas.registrar({ rotinaId: m.rotina.id, em: AGORA + 1500, desfecho: "teste" });
      expect(await m.repos.rotinaChamadas.comRecusaPendente()).toContain(m.rotina.id);
      await m.repos.rotinaChamadas.registrar({ rotinaId: m.rotina.id, em: AGORA + 2000, desfecho: "ignorada" });
      expect(await m.repos.rotinaChamadas.comRecusaPendente()).not.toContain(m.rotina.id);
      // Só recusas, sem nenhuma aceita: pendente.
      const outra = await montar(trx);
      await outra.repos.rotinaChamadas.registrar({ rotinaId: outra.rotina.id, em: AGORA, desfecho: "recusada", motivo: "endereco" });
      expect(await outra.repos.rotinaChamadas.comRecusaPendente()).toContain(outra.rotina.id);
    });
  });

  it("poda: ficam as 50 mais novas e tudo das últimas 72 h", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      // 60 velhas (mais de 72 h) e 5 recentes.
      for (let i = 0; i < 60; i++) await m.repos.rotinaChamadas.registrar({ rotinaId: m.rotina.id, em: AGORA - 100 * H - i * 1000, desfecho: "rodou" });
      for (let i = 0; i < 5; i++) await m.repos.rotinaChamadas.registrar({ rotinaId: m.rotina.id, em: AGORA - i * 1000, desfecho: "rodou" });
      expect(await m.repos.rotinaChamadas.podar(m.rotina.id, AGORA, 50)).toBe(15);
      const ficou = await m.repos.rotinaChamadas.listar(m.rotina.id, 100);
      expect(ficou).toHaveLength(50);
      // 60 recentes (dentro de 72 h) não saem mesmo passando de 50.
      const outra = await montar(trx);
      for (let i = 0; i < 60; i++) await outra.repos.rotinaChamadas.registrar({ rotinaId: outra.rotina.id, em: AGORA - i * 1000, desfecho: "rodou" });
      expect(await outra.repos.rotinaChamadas.podar(outra.rotina.id, AGORA, 50)).toBe(0);
    });
  });

  it("poda: das recusadas ficam só as 10 mais novas, mesmo dentro das 72 h (revisão da NOD-84)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      for (let i = 0; i < 30; i++) await m.repos.rotinaChamadas.registrar({ rotinaId: m.rotina.id, em: AGORA - i * 1000, desfecho: "recusada", motivo: "endereco" });
      for (let i = 0; i < 3; i++) await m.repos.rotinaChamadas.registrar({ rotinaId: m.rotina.id, em: AGORA - 50_000 - i * 1000, desfecho: "rodou" });
      expect(await m.repos.rotinaChamadas.podar(m.rotina.id, AGORA, 50)).toBe(20);
      const ficou = await m.repos.rotinaChamadas.listar(m.rotina.id, 100);
      expect(ficou.filter((c) => c.desfecho === "recusada")).toHaveLength(10);
      expect(ficou.filter((c) => c.desfecho === "rodou")).toHaveLength(3);
      expect(ficou[0]?.em).toBe(AGORA);
    });
  });

  it("contarAbertas: conta as execuções com turno vivo nos últimos 7 dias", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const turno = async () => {
        const t = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "rotina", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "nao_confiavel", modelo: "sonnet" });
        if (!t) throw new Error("turno");
        return t;
      };
      const janela = async (instante: number, turnoId: string) => {
        expect(await m.repos.rotinaJanelas.reivindicar({ rotinaId: m.rotina.id, instanteAgendado: instante, machineId: randomUUID(), executor: "catcher" })).toBe(true);
        expect(await m.repos.rotinaJanelas.vincularTurno({ rotinaId: m.rotina.id, instanteAgendado: instante, turnoId })).toBe(true);
      };
      const a = await turno();
      const b = await turno();
      const c = await turno();
      await janela(AGORA - 2, a.id);
      await janela(AGORA - 1, b.id);
      await janela(AGORA, c.id);
      expect(await m.repos.rotinaJanelas.contarAbertas(m.rotina.id, AGORA)).toBe(3);
      await m.repos.turnos.assentar(a.id, { estado: "concluido" });
      expect(await m.repos.rotinaJanelas.contarAbertas(m.rotina.id, AGORA)).toBe(2);
    });
  });

  it("GET rotinas: a rotina webhook traz prefixo, chamadas e recusadas de hoje, o '!' e as últimas; a de horário não", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const agora = Date.now();
      const g = await m.repos.rotinaGatilhos.criar(novoGatilho(m.rotina.id), agora);
      await m.repos.rotinaChamadas.registrar({ rotinaId: m.rotina.id, em: agora - 5 * 24 * H, desfecho: "rodou" });
      await m.repos.rotinaChamadas.registrar({ rotinaId: m.rotina.id, em: agora - 2000, desfecho: "rodou", evento: "payment_intent.succeeded" });
      await m.repos.rotinaChamadas.registrar({ rotinaId: m.rotina.id, em: agora - 1000, desfecho: "recusada", motivo: "assinatura" });
      const { deps } = depsSobre(trx, MARLON);
      const { data } = await listarRotinas(deps, {});
      const dto = data.rotinas.find((r) => r.rotina.id === m.rotina.id);
      expect(dto?.webhook).toMatchObject({ prefixo: g?.prefixo, provedor: "Stripe", eventos: ["payment_intent.succeeded"], recusadasHoje: 1, recusaPendente: true });
      // "Hoje" no fuso da rotina: a de 5 dias atrás não conta; as duas de agora contam (salvo virada exata de meia-noite).
      expect(dto?.webhook?.chamadasHoje).toBeGreaterThanOrEqual(1);
      expect(dto?.webhook?.chamadasHoje).toBeLessThanOrEqual(2);
      expect(dto?.webhook?.ultimas.map((c) => c.desfecho)).toEqual(["recusada", "rodou", "rodou"]);
      expect(JSON.stringify(dto)).not.toContain("cifrado-token");
      const hora = await m.repos.rotinas.criar({ agenteId: m.agenteId, conversaId: m.conversaId, cron: "0 9 * * *", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: agora + H });
      const { data: d2 } = await listarRotinas(deps, {});
      expect(d2.rotinas.find((r) => r.rotina.id === hora?.id)?.webhook).toBeUndefined();
    });
  });
});
