import { expect, it } from "vitest";
import { coletarGauges } from "../../src/adapters/fundo/despachar-outbox.ts";
import { criarRotaEventos } from "../../src/adapters/http/rotas/eventos.ts";
import { criarRotaMetricas, TIPO_PROMETHEUS } from "../../src/adapters/http/rotas/metricas.ts";
import { criarMetricas, type Rotulo } from "../../src/obs/metricas.ts";
import { criarBarramento } from "../../src/services/barramento.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const H = 60 * 60 * 1000;

/**
 * ADR-017 sobre banco e servidor reais: os gauges por pessoa saem de coluna (idade da pendência
 * mais velha), o contador de expiração usa os DOIS rótulos que o repo devolve, polls_abertos segue
 * a conexão SSE e o /metrics expõe tudo em texto Prometheus. Seis rótulos, nenhuma string livre.
 */
describeIntegracao("métricas: coleta por pessoa e exposição em /metrics", () => {
  it("pendencia_mais_velha_s vem da decisão aberta mais antiga (coluna criado_em); sem pendência é 0; custo_servidor_mes é 0 por construção", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = criarMetricas();
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      await coletarGauges(trx, MARLON, Date.now(), m);
      expect(m.ler({ metrica: "pendencia_mais_velha_s", tenant_id: TENANT_PADRAO, pessoa_id: PESSOA_MARLON })).toBe(0);

      const velha = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: Date.now() + 10 * H, frase: "velha" });
      const nova = await repos.decisoes.criar({ tipo: "pergunta", agenteId, conversaId, prazoDecisaoEm: Date.now() + 10 * H, frase: "nova" });
      const [linha] = await trx<{ criado_em: Date }[]>`select criado_em from decisoes where id = ${velha?.id ?? ""}`;
      const agora = (linha?.criado_em.getTime() ?? 0) + 6 * H;
      await coletarGauges(trx, MARLON, agora, m);
      expect(m.ler({ metrica: "pendencia_mais_velha_s", tenant_id: TENANT_PADRAO, pessoa_id: PESSOA_MARLON })).toBe(21_600);
      expect(m.ler({ metrica: "custo_servidor_mes", tenant_id: TENANT_PADRAO })).toBe(0);

      // Decidida deixa de contar; vencida também (o que conta é o que ainda espera decisão). O que sobra é a "nova",
      // e a idade dela é exata: numa máquina rápida as duas nascem no mesmo segundo e "menor que 21 600" caía
      // (CI no Blacksmith, 2026-11-04) — a métrica arredonda para baixo em segundos.
      await repos.decisoes.decidir(velha?.id ?? "", { por: PESSOA_MARLON, agora });
      await coletarGauges(trx, MARLON, agora, m);
      const [linhaNova] = await trx<{ criado_em: Date }[]>`select criado_em from decisoes where id = ${nova?.id ?? ""}`;
      expect(m.ler({ metrica: "pendencia_mais_velha_s", tenant_id: TENANT_PADRAO, pessoa_id: PESSOA_MARLON })).toBe(Math.floor((agora - (linhaNova?.criado_em.getTime() ?? 0)) / 1000));
    });
  });

  it("expiração: o varredor incrementa pelos dois rótulos que decisoesRepo.vencerPendentes devolve", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = criarMetricas();
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const vista = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: agora + 1_000, frase: "a" });
      await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: agora + 1_000, frase: "b" });
      await repos.decisoes.marcarVista(vista?.id ?? "", agora + 100);
      for (const d of await repos.decisoes.vencerPendentes(agora + 2_000)) {
        const causa = d.desfecho?.tipo;
        if (causa === "expirou_sem_ninguem_ver" || causa === "expirou_com_alguem_ciente") m.incrementar({ metrica: "expiracao", causa, tenant_id: TENANT_PADRAO });
      }
      expect(m.ler({ metrica: "expiracao", causa: "expirou_sem_ninguem_ver", tenant_id: TENANT_PADRAO })).toBe(1);
      expect(m.ler({ metrica: "expiracao", causa: "expirou_com_alguem_ciente", tenant_id: TENANT_PADRAO })).toBe(1);
    });
  });

  it("/metrics expõe as seis em texto Prometheus; polls_abertos sobe com a conexão SSE e desce ao fechar", async () => {
    const m = criarMetricas();
    const barramento = criarBarramento();
    const srv = await servidorDeTeste([criarRotaEventos(barramento, { metricas: m }), criarRotaMetricas(m)]);
    try {
      const marlon = await srv.entrar("marlon");
      const rotulos: Rotulo[] = [
        { metrica: "pendencia_mais_velha_s", tenant_id: marlon.tenantId, pessoa_id: marlon.pessoaId },
        { metrica: "expiracao", causa: "expirou_sem_ninguem_ver", tenant_id: marlon.tenantId },
        { metrica: "pos_restart", desfecho: "retomado", origem: "restart_servidor", tenant_id: marlon.tenantId },
        { metrica: "custo_servidor_mes", tenant_id: marlon.tenantId },
        { metrica: "polls_abertos", tenant_id: marlon.tenantId, pessoa_id: marlon.pessoaId },
        { metrica: "outbox_abandonados", tenant_id: marlon.tenantId, pessoa_id: marlon.pessoaId },
      ];
      expect(new Set(rotulos.map((r) => r.metrica)).size).toBe(6);
      m.registrar({ metrica: "pendencia_mais_velha_s", tenant_id: marlon.tenantId, pessoa_id: marlon.pessoaId }, 7);
      m.incrementar({ metrica: "expiracao", causa: "expirou_sem_ninguem_ver", tenant_id: marlon.tenantId });
      m.incrementar({ metrica: "pos_restart", desfecho: "retomado", origem: "restart_servidor", tenant_id: marlon.tenantId });
      m.registrar({ metrica: "custo_servidor_mes", tenant_id: marlon.tenantId }, 0);
      m.registrar({ metrica: "outbox_abandonados", tenant_id: marlon.tenantId, pessoa_id: marlon.pessoaId }, 0);

      const ac = new AbortController();
      const sse = await fetch(`${srv.url}/api/t/${marlon.tenantId}/eventos`, { headers: { cookie: marlon.cookie }, signal: ac.signal });
      expect(sse.status).toBe(200);
      const aberto = await fetch(`${srv.url}/api/metrics`);
      expect(aberto.headers.get("content-type")).toBe(TIPO_PROMETHEUS);
      const texto = await aberto.text();
      for (const nome of ["pendencia_mais_velha_s", "expiracao", "pos_restart", "custo_servidor_mes", "polls_abertos", "outbox_abandonados"]) {
        expect(texto).toContain(`# TYPE nod_${nome} `);
      }
      expect(texto).toContain(`nod_polls_abertos{pessoa_id="${marlon.pessoaId}",tenant_id="${marlon.tenantId}"} 1`);
      expect(texto).toContain('nod_pos_restart{desfecho="retomado",origem="restart_servidor"');
      expect(texto).not.toMatch(/@/);

      ac.abort();
      for (let i = 0; i < 50 && barramento.inscritos(marlon.pessoaId) > 0; i += 1) await new Promise((r) => setTimeout(r, 20));
      expect(await (await fetch(`${srv.url}/api/metrics`)).text()).toContain(`nod_polls_abertos{pessoa_id="${marlon.pessoaId}",tenant_id="${marlon.tenantId}"} 0`);
    } finally {
      await srv.close();
    }
  });
});
