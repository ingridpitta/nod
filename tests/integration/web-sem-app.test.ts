import { expect, it } from "vitest";
import { despacharPessoa } from "../../src/adapters/fundo/despachar-outbox.ts";
import { criarRotaDev } from "../../src/adapters/http/rotas/dev.ts";
import { criarRotaEventos } from "../../src/adapters/http/rotas/eventos.ts";
import { criarRotaMetricas } from "../../src/adapters/http/rotas/metricas.ts";
import { criarRotasSuaVez, type ComDeps } from "../../src/adapters/http/rotas/sua-vez.ts";
import type { SuaVezDto } from "../../src/contracts/api.ts";
import type { FrameSse } from "../../src/contracts/frame.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarMetricas } from "../../src/obs/metricas.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarBarramento } from "../../src/services/barramento.ts";
import type { Tx } from "../../src/shared/types.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const DIA = 24 * 60 * 60 * 1000;

/** ComDeps sobre o trx condenado do withRollback: a rota roda o caso de uso na MESMA tx do teste. */
function comDepsSobre(trx: Tx, agora: () => number): ComDeps {
  return async (escopo, fn) => {
    await vincularEscopo(trx, escopo);
    return fn({ repos: criarRepos(trx, escopo), escopo, agora, tx: (f) => f(trx) });
  };
}

/** Lê o primeiro bloco SSE cujo `event:` case; sem parser completo — só o que este teste precisa. */
async function lerAte(res: Response, evento: string, timeoutMs = 3_000): Promise<FrameSse> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("sem corpo");
  const dec = new TextDecoder();
  let buffer = "";
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    for (const bloco of buffer.split("\n\n")) {
      if (!bloco.includes(`event: ${evento}\n`)) continue;
      const linha = bloco.split("\n").find((l) => l.startsWith("data: "));
      if (linha) {
        reader.cancel().catch(() => {});
        return JSON.parse(linha.slice(6)) as FrameSse;
      }
    }
  }
  throw new Error(`evento ${evento} não chegou`);
}

/**
 * ADR-020, a regra que separa tudo: nenhuma DECISÃO do produto exige o app aberto. O servidor sobe
 * SEM executor, sem driver, sem máquina conectada — só banco e rotas — e responde 2xx em toda
 * rota de decisão desta lane (sua-vez, reabrir), no canal de eventos, no /metrics e no dev/catcher.
 * (decidir/retomar/responder, trilha e parar são de L9/L5/L6 e entram em servidor-completo.ts.)
 */
describeIntegracao("web sem app: servidor sem executor responde às rotas da L8", () => {
  it("sua-vez, reabrir (com frame decisao.nova pelo outbox), eventos, metrics e dev/catcher — tudo 2xx sem executor", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      let relogio = agora;
      const barramento = criarBarramento();
      const metricas = criarMetricas();
      const comDeps = comDepsSobre(trx, () => relogio);
      const srv = await servidorDeTeste([
        ...criarRotasSuaVez(comDeps),
        criarRotaEventos(barramento, { metricas }),
        criarRotaMetricas(metricas),
        criarRotaDev(comDeps, { executor: "catcher" }),
      ]);
      try {
        const marlon = await srv.entrar("marlon");
        const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
        const pendente = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "3 e-mails" });
        const vencida = await repos.decisoes.criar({ tipo: "gate_rotina", agenteId, conversaId, prazoDecisaoEm: agora + 1_000, frase: "rotina" });
        relogio = agora + 2_000;
        await repos.decisoes.vencerPendentes(relogio);

        // Canal de eventos aberto ANTES da decisão: a reabertura chega como frame, sem app nenhum.
        const eventos = await fetch(`${srv.url}/api/t/${marlon.tenantId}/eventos`, { headers: { cookie: marlon.cookie } });
        expect(eventos.status).toBe(200);

        // Com o canal aberto, /metrics já conta a conexão da pessoa (ADR-017 #6), em texto Prometheus.
        const metrics = await fetch(`${srv.url}/api/metrics`);
        expect(metrics.status).toBe(200);
        expect(metrics.headers.get("content-type")).toContain("text/plain");
        const texto = await metrics.text();
        expect(texto).toContain("# TYPE nod_polls_abertos gauge");
        expect(texto).toContain(`nod_polls_abertos{pessoa_id="${marlon.pessoaId}",tenant_id="${marlon.tenantId}"} 1`);

        const fila = await srv.chamar(marlon, "GET", "sua-vez");
        expect(fila.status).toBe(200);
        const dto = (await fila.json()) as SuaVezDto;
        expect(dto.itens.map((i) => [i.decisao.id, i.estadoColuna])).toEqual([
          [pendente?.id, "pendente"],
          [vencida?.id, "vencido"],
        ]);
        expect(dto.itens[1]?.decisao.desfecho?.tipo).toBe("expirou_sem_ninguem_ver");
        expect(dto).toMatchObject({ vazio: false, foraDoAr: [] });

        const reabrir = await srv.chamar(marlon, "POST", `decisoes/${vencida?.id}/reabrir`);
        expect(reabrir.status).toBe(200);
        expect(await reabrir.json()).toEqual({ ok: true, ids: { decisaoId: vencida?.id } });

        // O evento ficou no outbox da MESMA tx; o despachante o transforma em frame decisao.nova no canal aberto.
        await despacharPessoa(trx, MARLON, barramento, { metricas, agora: () => relogio });
        const frame = await lerAte(eventos, "decisao.nova");
        expect(frame).toMatchObject({ pessoaId: marlon.pessoaId, tipo: "decisao.nova", dados: { kind: "decisao_criada", decisao_id: vencida?.id, reaberta: true } });

        const depois = (await (await srv.chamar(marlon, "GET", "sua-vez")).json()) as SuaVezDto;
        expect(depois.itens.map((i) => [i.decisao.id, i.estadoColuna])).toEqual([
          [vencida?.id, "reaberto"],
          [pendente?.id, "pendente"],
        ]);

        // Erros continuam de domínio, código fechado (ADR-002/004): pendente → 409; desconhecida → 404.
        expect((await srv.chamar(marlon, "POST", `decisoes/${pendente?.id}/reabrir`)).status).toBe(409);
        expect((await srv.chamar(marlon, "POST", "decisoes/00000000-0000-4000-8000-000000000000/reabrir")).status).toBe(404);

        const dev = await srv.chamar(marlon, "GET", "dev/catcher");
        expect(dev.status).toBe(200);
        expect(await dev.json()).toEqual({ executor: "catcher", registros: [] });
      } finally {
        await srv.close();
      }
    });
  });
});
