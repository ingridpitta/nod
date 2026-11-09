import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import { entrega } from "../../src/adapters/http/rotas/ponte-validacao.ts";
import { criarRotasUsoDoPlano } from "../../src/adapters/http/rotas/uso-do-plano.ts";
import type { IdHarness } from "../../src/contracts/harness.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import type { UsoDoPlano, UsoDoPlanoDto } from "../../src/contracts/uso-do-plano.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { USO_FORA_DO_CLAUDE } from "../../src/domain/comandos.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { lerUsoDoPlano } from "../../src/use-cases/uso-do-plano.ts";
import { ANA, depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const HORA = 3_600_000;
const resultado = (extra: Partial<ResultadoTurno> = {}): ResultadoTurno => ({
  desfecho: "sucesso", texto: "ok", sessaoCli: randomUUID(), sinais: SINAIS, custoUsd: 0, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 },
  ferramentasChamadas: [], negacoesPermissao: [], ...extra,
});
const uso = (medidoEm: number, utilizacao = 0.1, harness: IdHarness = "claude-cli"): UsoDoPlano => ({
  harness, situacao: "normal", cincoHoras: { utilizacao, renovaEm: medidoEm + HORA }, semana: { utilizacao: 0.03, renovaEm: medidoEm + 48 * HORA }, medidoEm,
});

type Deps = ReturnType<typeof depsSobreTrx>;
/** Um turno do bot da pessoa até a entrega, com o uso do plano que o Mac informou. */
async function entregar(deps: Deps, conversaId: string, extra: Partial<ResultadoTurno>, harness: IdHarness | null = "claude-cli", texto = "oi", fala = "ok") {
  const maquina = randomUUID();
  await executar(deps, enviarMensagem, { conversaId, texto, inventario: PRONTO });
  const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
  await executar(deps, emitirPlanoTurno, { turnoId, machineId: maquina, executor: "catcher" });
  return (await executar(deps, assentarTurno, { turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: fala }, resultado: resultado(extra), harness })).data;
}

describeIntegracao("uso do plano (NOD-179, 0056): gravado por pessoa e CLI a cada turno, nunca gate", () => {
  it("a entrega grava a linha; leitura mais antiga não sobrescreve; a mais nova vence; outra pessoa lê zero", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      expect((await executar(deps, lerUsoDoPlano, {})).data.planos).toEqual([]);

      const t0 = Date.now() - 60_000;
      await entregar(deps, criado.conversa.id, { usoDoPlano: uso(t0, 0.4) });
      expect((await executar(deps, lerUsoDoPlano, {})).data.planos).toEqual([uso(t0, 0.4)]);

      await entregar(deps, criado.conversa.id, { usoDoPlano: uso(t0 - 30_000, 0.1) });
      expect((await executar(deps, lerUsoDoPlano, {})).data.planos).toEqual([uso(t0, 0.4)]);

      await entregar(deps, criado.conversa.id, { usoDoPlano: uso(t0 + 30_000, 0.85) });
      expect((await executar(deps, lerUsoDoPlano, {})).data.planos).toEqual([uso(t0 + 30_000, 0.85)]);

      await vincularEscopo(trx, ANA);
      expect((await executar(depsSobreTrx(trx, ANA), lerUsoDoPlano, {})).data.planos).toEqual([]);
      expect(await trx`select count(*)::int as n from uso_do_plano`).toEqual([{ n: 0 }]);
    });
  });

  it("harness diferente do que rodou o turno, ou turno sem harness conhecido, é descartado sem recusar a entrega", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const agora = Date.now();
      const r1 = await entregar(deps, criado.conversa.id, { usoDoPlano: uso(agora - 1000) }, "codex-cli");
      expect(r1.mensagem?.texto).toBe("ok");
      const r2 = await entregar(deps, criado.conversa.id, { usoDoPlano: uso(agora - 1000) }, null);
      expect(r2.mensagem?.texto).toBe("ok");
      expect((await executar(deps, lerUsoDoPlano, {})).data.planos).toEqual([]);
    });
  });

  it("NOD-12: a leitura do Codex (account/rateLimits/read) entregue por um turno do Codex é gravada como a do Claude", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const agora = Date.now() - 60_000;
      const r = await entregar(deps, criado.conversa.id, { usoDoPlano: uso(agora, 0.42, "codex-cli") }, "codex-cli");
      expect(r.mensagem?.texto).toBe("ok");
      expect((await executar(deps, lerUsoDoPlano, {})).data.planos).toEqual([uso(agora, 0.42, "codex-cli")]);
      // E passa pela ponte HTTP (Mac remoto) sem ser descartada.
      const e = entrega({ turnoId: randomUUID(), seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: resultado({ usoDoPlano: uso(agora, 0.42, "codex-cli") }) }, "maq", agora + 60_000);
      expect(e.resultado.usoDoPlano).toEqual(uso(agora, 0.42, "codex-cli"));
    });
  });

  it("utilização NaN, −1 ou 5 é descartada na ponte e no assentar; a entrega é aceita", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const agora = Date.now();
      for (const utilizacao of [Number.NaN, -1, 5]) {
        const ruim = uso(agora - 1000, utilizacao);
        // Pela ponte HTTP (Mac remoto): o campo some na validação e a entrega passa.
        const e = entrega({ turnoId: randomUUID(), seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: resultado({ usoDoPlano: ruim }) }, "maq", agora);
        expect("usoDoPlano" in e.resultado).toBe(false);
        // Pela entrega local (sem ponte HTTP): o assentar revalida e não grava.
        const r = await entregar(deps, criado.conversa.id, { usoDoPlano: ruim });
        expect(r.mensagem?.texto).toBe("ok");
      }
      expect((await executar(deps, lerUsoDoPlano, {})).data.planos).toEqual([]);
    });
  });

  it("/uso entregue pelo Codex vira a frase fixa, diga o modelo o que disser; pelo Claude Code segue a saída do /cost", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const codex = await entregar(deps, criado.conversa.id, {}, "codex-cli", "/uso", "Não tenho acesso ao seu plano.");
      expect(codex.mensagem?.texto).toBe(USO_FORA_DO_CLAUDE);
      const claude = await entregar(deps, criado.conversa.id, {}, "claude-cli", "/uso", "Current session: 10% used · resets Sep 28 at 11:20pm");
      expect(claude.mensagem?.texto).toContain("**10%**");
    });
  });
});

/** A rota sobre o servidor-de-teste: cada requisição abre um SAVEPOINT no withRollback do teste (molde de artefatos). */
describeIntegracao("GET /api/uso-do-plano (NOD-179)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx:
        (escopo: Escopo) =>
        async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: T } = {};
          await trx.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(sp);
          });
          return caixa.valor as T;
        },
      services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON),
      useCases: useCasesDeTeste(),
      executor: "catcher",
    };
    servidor = await servidorDeTeste(criarRotasUsoDoPlano(deps));
  });
  afterAll(() => servidor.close());

  it("devolve só as linhas da pessoa logada, em dados crus", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const agora = Date.now() - 5000;
      await criarRepos(trx, MARLON).usoDoPlano.gravar(uso(agora), randomUUID());
      await vincularEscopo(trx, ANA);
      await criarRepos(trx, ANA).usoDoPlano.gravar(uso(agora, 0.9), null);

      const marlon = await servidor.entrar("marlon");
      const resp = await servidor.chamar(marlon, "GET", "uso-do-plano");
      expect(resp.status).toBe(200);
      expect((await resp.json()) as UsoDoPlanoDto).toEqual({ planos: [uso(agora)] });

      const ana = await servidor.entrar("ana");
      expect((await (await servidor.chamar(ana, "GET", "uso-do-plano")).json()) as UsoDoPlanoDto).toEqual({ planos: [uso(agora, 0.9)] });
      trxAtual = null;
    });
  });
});
