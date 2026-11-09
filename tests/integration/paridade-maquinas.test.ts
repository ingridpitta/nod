import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { rotasMaquinas } from "../../src/adapters/http/rotas/maquinas.ts";
import type { ArgsGerirMaquinas } from "../../src/contracts/ferramentas-maquinas.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { REGISTRO_DE_ACOES } from "../../src/domain/acoes/index.ts";
import { criarPareamentoDispositivo } from "../../src/services/pareamento-dispositivo.ts";
import { criarPareamentoMaquina } from "../../src/services/pareamento-maquina.ts";
import type { Tx } from "../../src/shared/types.ts";
import { gerirMaquinas } from "../../src/use-cases/gerir-maquinas.ts";
import { depsSobreTrx, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADA-243 (ADR-135): o teste de contrato do `maquinas.definir_padrao`. A mesma escolha pela tela (PUT /maquinas/padrao,
 * o seletor "Máquina padrão" e o "Trabalhar neste computador" da tela B) e pelo chat (gerir_maquinas de um bot comum)
 * leva o mesmo estado inicial ao mesmo `maquina_padrao_id`. Cada lado roda numa transação própria. É o arquivo que o
 * registro cita como `contrato` (src/domain/acoes/maquinas.ts).
 */

describeIntegracao("paridade tela × chat do maquinas.definir_padrao (ADA-243, ADR-135)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  beforeAll(async () => {
    servidor = await servidorDeTeste(
      rotasMaquinas({
        dentro: async (escopo, fn) => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: Awaited<ReturnType<typeof fn>> } = {};
          await trx.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(depsSobreTrx(sp, escopo));
          });
          return caixa.valor as Awaited<ReturnType<typeof fn>>;
        },
        pareamento: criarPareamentoMaquina(),
        dispositivo: criarPareamentoDispositivo(),
      }),
    );
  });
  afterAll(() => servidor.close());

  /** O mesmo começo dos dois lados: o MacBook (padrão de hoje), o Windows novo, um só-computador e um revogado. */
  async function montar(trx: Tx, o: { contaminado?: boolean } = {}) {
    const d = depsSobreTrx(trx, MARLON);
    const chave = async (nome: string, papel?: "computador") => (await d.repos.maquinaTokens.criar({ nome, prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32), ...(papel ? { papel } : {}) }))!.id;
    const mac = await chave("MacBook de Marlon");
    const windows = await chave("Windows de Marlon");
    const soComputador = await chave("Computador do Edu", "computador");
    const revogada = await chave("Velho");
    await d.repos.maquinaTokens.revogar(revogada, Date.now());
    await d.repos.preferencias.definirMaquinaPadrao(mac);
    const bot = await agenteComConversa(trx, MARLON, { nome: "Bruna", modo: "manual" });
    const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversaId, agenteId: bot.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "trabalha aqui", entradaConfianca: o.contaminado ? "nao_confiavel" : "confiavel", modelo: "auto" });
    if (!turno) throw new Error("turno");
    return { d, ids: { mac, windows, soComputador, revogada }, ctx: { turnoId: turno.id, agenteId: bot.agenteId, conversaId: bot.conversaId } };
  }
  const padrao = async (m: Awaited<ReturnType<typeof montar>>) => (await m.d.repos.preferencias.buscar()).maquinaPadraoId ?? null;

  type Cenario = { nome: string; tela: (ids: Record<string, string>) => string | null; chat: ArgsGerirMaquinas };
  const CENARIOS: Cenario[] = [
    { nome: "Trabalhar neste computador (o Windows vira a padrão)", tela: (ids) => ids.windows ?? "", chat: { acao: "definir_padrao", maquina: "windows de marlon" } },
    { nome: "qualquer uma (tira a padrão)", tela: () => null, chat: { acao: "definir_padrao", qualquer_uma: true } },
  ];

  it("a ação está viva no registro, pelo gerir_maquinas, citando este arquivo", () => {
    const a = REGISTRO_DE_ACOES.find((x) => x.id === "maquinas.definir_padrao");
    expect(a?.chat).toEqual({ estado: "vivo", via: { ferramenta: "gerir_maquinas" }, contrato: "tests/integration/paridade-maquinas.test.ts" });
  });

  it.each(CENARIOS)("$nome: a rota e o gerir_maquinas chegam ao mesmo padraoId", async (c) => {
    let pelaTela: string | null | undefined;
    let pelaTelaNome: string | null = null;
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const r = await servidor.chamar(await servidor.entrar("marlon"), "PUT", "/maquinas/padrao", { maquinaId: c.tela(m.ids) });
      expect(r.status).toBe(200);
      pelaTela = await padrao(m);
      pelaTelaNome = pelaTela === m.ids.windows ? "windows" : pelaTela === null ? null : "outra";
      expect(pelaTela).not.toBe(m.ids.mac);
    });
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const r = await gerirMaquinas(m.d, { ...m.ctx, ...c.chat });
      expect(r.data).toMatchObject({ ok: true });
      const agora = await padrao(m);
      expect(agora === m.ids.windows ? "windows" : agora === null ? null : "outra").toBe(pelaTelaNome);
    });
  });

  it("nem a tela nem o chat aceitam o só-computador nem a chave revogada (NOD-94)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const sessao = await servidor.entrar("marlon");
      for (const id of [m.ids.soComputador, m.ids.revogada]) expect((await servidor.chamar(sessao, "PUT", "/maquinas/padrao", { maquinaId: id })).status).toBe(404);
      for (const nome of ["Computador do Edu", "Velho"]) expect((await gerirMaquinas(m.d, { ...m.ctx, acao: "definir_padrao", maquina: nome })).data).toMatchObject({ ok: false, erro: "nao_encontrado" });
      expect(await padrao(m)).toBe(m.ids.mac);
    });
  });

  it("chat: turno com conteúdo de fora não muda a padrão; listar diz onde a Bruna trabalha", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx, { contaminado: true });
      expect((await gerirMaquinas(m.d, { ...m.ctx, acao: "definir_padrao", maquina: "Windows de Marlon" })).data).toMatchObject({ ok: false, erro: "fora_da_conversa" });
      expect(await padrao(m)).toBe(m.ids.mac);
      const l = await gerirMaquinas(m.d, { ...m.ctx, acao: "listar", bot: "Bruna" });
      expect(l.data).toMatchObject({ ok: true, padrao: "MacBook de Marlon", bot: { nome: "Bruna", trabalha_em: "MacBook de Marlon" } });
      if (l.data.ok && "maquinas" in l.data) expect(l.data.maquinas.map((x) => x.nome).sort()).toEqual(["MacBook de Marlon", "Windows de Marlon"]);
    });
  });
});
