import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { ExecucaoRaioX } from "../../src/contracts/raio-x.ts";
import { TURNOS_DA_JANELA } from "../../src/repositories/raio-x.repo.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-480 (revisão do PR #721): a janela que o Claude Code informou (`execucao.janela`) decide o orçamento do turno. A
 * leitura roda em toda emissão de plano, então olha só os últimos TURNOS_DA_JANELA turnos do bot NESTA conversa (pelo
 * índice `turnos_por_conversa`), nunca o histórico inteiro do bot.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto: Inventario = { estado: "pronto", versao: "2.1.309", em: Date.now() };
const execucao = (janela: number | null): ExecucaoRaioX => ({ chamadas: [], chamadasOmitidas: 0, compactacoes: [], janela, modelo: "haiku", versaoCli: "2.1.309", custoSessaoUsd: null, ferramentasNoInit: 0, buscaDeFerramentas: false, duracaoMs: 1 });
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function cenario(trx: Trx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Atlas" });
  let em = Date.now() - 3_600_000;
  /** Um turno do bot com a execução gravada; `criado_em` crescente, um segundo por turno (sem empate de ms). */
  const turno = async (janela: number | null, o: { conversaId?: string; modelo?: string } = {}) => {
    const t = (await base.repos.turnos.enfileirar({ executor: "local", conversaId: o.conversaId ?? base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: o.modelo ?? "haiku", harness: "claude-cli" }))!;
    em += 1_000;
    await trx`update turnos set criado_em = ${new Date(em)}, estado = 'concluido' where id = ${t.id}`;
    await base.repos.raioX.gravarExecucao(t.id, execucao(janela));
    return t;
  };
  return { ...base, turno };
}

describeIntegracao("NOD-480: a janela observada no Raio-X", () => {
  it("vale a do turno mais recente do bot nesta conversa e com este modelo", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await c.turno(1_000_000);
      await c.turno(200_000);
      await c.turno(null);
      await c.turno(500_000, { modelo: "sonnet" });
      expect(await c.repos.raioX.ultimaJanela(c.conversaId, c.agenteId, "haiku")).toBe(200_000);
      expect(await c.repos.raioX.ultimaJanela(c.conversaId, c.agenteId, "sonnet")).toBe(500_000);
      expect(await c.repos.raioX.ultimaJanela(c.conversaId, c.agenteId, "opus")).toBeNull();
    });
  });

  it("olha só os últimos TURNOS_DA_JANELA turnos da conversa: a leitura não varre o histórico do bot", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await c.turno(200_000);
      for (let i = 0; i < TURNOS_DA_JANELA; i++) await c.turno(null);
      expect(await c.repos.raioX.ultimaJanela(c.conversaId, c.agenteId, "haiku")).toBeNull();
      // Outra conversa do mesmo bot não entra (e o recorte é por conversa, pelo índice).
      const outra = randomUUID();
      await c.repos.conversas.criar({ id: outra, tipo: "propria", agenteId: c.agenteId });
      await c.turno(1_000_000, { conversaId: outra });
      expect(await c.repos.raioX.ultimaJanela(c.conversaId, c.agenteId, "haiku")).toBeNull();
      expect(await c.repos.raioX.ultimaJanela(outra, c.agenteId, "haiku")).toBe(1_000_000);
    });
  });

  it("a emissão do plano usa a janela observada: um haiku que informou 1M não enxuga", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await c.repos.agentes.atualizarPerfil(c.agenteId, { confirmado: true });
      const agora = () => Date.now();
      const deps = depsSobre(c.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
      const emitir = async () => {
        const t = (await c.repos.turnos.enfileirar({ executor: "local", conversaId: c.conversaId, agenteId: c.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "haiku", harness: "claude-cli" }))!;
        const maquina = randomUUID();
        expect((await c.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() }))?.id).toBe(t.id);
        const plano = (await emitirPlanoTurno(deps, { turnoId: t.id, machineId: maquina, executor: "local", harnesses: { "claude-cli": pronto } })).data;
        await c.repos.turnos.assentar(t.id, { estado: "concluido" });
        return plano;
      };
      expect((await emitir()).orcamento).toMatchObject({ janela: 200_000, enxuto: true });
      await c.turno(1_000_000);
      expect((await emitir()).orcamento).toMatchObject({ janela: 1_000_000, enxuto: false });
    });
  });
});
