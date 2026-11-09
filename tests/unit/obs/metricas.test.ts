import { describe, expect, it } from "vitest";
import { AJUDA, TIPO_METRICA, criarMetricas, type NomeMetrica, type Rotulo } from "../../../src/obs/metricas.ts";

const T = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";

describe("métricas do ADR-017: sete rótulos, union fechado, texto Prometheus", () => {
  it("são exatamente sete métricas, com tipo e ajuda declarados", () => {
    const nomes = Object.keys(TIPO_METRICA).sort();
    expect(nomes).toEqual(["custo_servidor_mes", "expiracao", "outbox_abandonados", "pendencia_mais_velha_s", "polls_abertos", "pos_restart", "turno_velho_na_fila"]);
    for (const n of nomes as NomeMetrica[]) expect(AJUDA[n].length).toBeGreaterThan(10);
  });

  it("rótulo fora do union não compila (nenhuma string livre)", () => {
    const m = criarMetricas();
    // @ts-expect-error métrica inventada
    const invalida: Rotulo = { metrica: "latencia_pool", tenant_id: T };
    // @ts-expect-error causa fora dos dois rótulos de expiração
    m.incrementar({ metrica: "expiracao", causa: "sei_la", tenant_id: T });
    // @ts-expect-error tenant_id é obrigatório no tipo (ADR-017: já declarado)
    m.registrar({ metrica: "polls_abertos", pessoa_id: P }, 1);
    // @ts-expect-error contador não aceita registrar (só sobe)
    m.registrar({ metrica: "pos_restart", desfecho: "retomado", origem: "restart_servidor", tenant_id: T }, 3);
    // @ts-expect-error gauge não aceita incrementar
    m.incrementar({ metrica: "polls_abertos", tenant_id: T });
    // @ts-expect-error rótulo livre não existe
    m.registrar({ metrica: "polls_abertos", tenant_id: T, email: "x@y" }, 1);
    expect(invalida).toBeDefined();
  });

  it("gauge define, contador soma, séries por rótulo ficam separadas", () => {
    const m = criarMetricas();
    m.registrar({ metrica: "polls_abertos", tenant_id: T, pessoa_id: P }, 2);
    m.registrar({ metrica: "polls_abertos", tenant_id: T, pessoa_id: P }, 1);
    m.incrementar({ metrica: "expiracao", causa: "expirou_sem_ninguem_ver", tenant_id: T });
    m.incrementar({ metrica: "expiracao", causa: "expirou_sem_ninguem_ver", tenant_id: T }, 2);
    m.incrementar({ metrica: "expiracao", causa: "expirou_com_alguem_ciente", tenant_id: T });
    m.incrementar({ metrica: "pos_restart", desfecho: "perdido", origem: "maquina_sumida", tenant_id: T });
    expect(m.ler({ metrica: "polls_abertos", tenant_id: T, pessoa_id: P })).toBe(1);
    expect(m.ler({ metrica: "expiracao", causa: "expirou_sem_ninguem_ver", tenant_id: T })).toBe(3);
    expect(m.ler({ metrica: "expiracao", causa: "expirou_com_alguem_ciente", tenant_id: T })).toBe(1);
    expect(m.ler({ metrica: "outbox_abandonados", tenant_id: T })).toBeUndefined();
  });

  it("renderiza texto Prometheus com HELP/TYPE, rótulos ordenados e valores escapados", () => {
    const m = criarMetricas();
    m.registrar({ metrica: "pendencia_mais_velha_s", tenant_id: T, pessoa_id: P }, 21600);
    m.incrementar({ metrica: "expiracao", causa: "expirou_com_alguem_ciente", tenant_id: 'a"b\\c\nd' });
    const texto = m.renderizarPrometheus();
    expect(texto).toContain("# HELP nod_pendencia_mais_velha_s ");
    expect(texto).toContain("# TYPE nod_pendencia_mais_velha_s gauge");
    expect(texto).toContain(`nod_pendencia_mais_velha_s{pessoa_id="${P}",tenant_id="${T}"} 21600`);
    expect(texto).toContain("# TYPE nod_expiracao counter");
    expect(texto).toContain('nod_expiracao{causa="expirou_com_alguem_ciente",tenant_id="a\\"b\\\\c\\nd"} 1');
    expect(texto.endsWith("\n")).toBe(true);
    expect(criarMetricas().renderizarPrometheus()).toBe("");
  });

  it("zerar esvazia o registro (uso em teste)", () => {
    const m = criarMetricas();
    m.registrar({ metrica: "outbox_abandonados", tenant_id: T }, 4);
    m.zerar();
    expect(m.renderizarPrometheus()).toBe("");
  });
});
