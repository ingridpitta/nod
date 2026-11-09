import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado, type FalaPendente } from "../../../web/estado/reducer.ts";

/**
 * NOD-363 (revisão 2, achado 4), critérios 5 a 7: a releitura com `?ate=` troca a janela de 200 pela crescida inteira.
 * Sem mescla no reducer: o DTO novo é a verdade — em ordem, sem fala repetida — e o que é só da web (a fala pendente, o
 * texto do turno vivo) atravessa a troca.
 */
const C = "c1";
const AGORA = Date.parse("2026-10-28T12:00:00Z");
const msg = (n: number): Mensagem => ({
  tenantId: "t", id: `m${n}`, conversaId: C, turnoId: null, autoria: { autor_tipo: "pessoa", autor_id: "p" } as Mensagem["autoria"],
  kind: "texto", texto: `fala ${n}`, payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA - 1_000_000 + n,
});
const faixa = (de: number, ate: number): Mensagem[] => Array.from({ length: ate - de + 1 }, (_, i) => msg(de + i));
const dto = (mensagens: Mensagem[]): ConversaDto => ({
  conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
  mensagens, turnosPendentes: [], turnosEmCurso: [{ id: "t1", estado: "despachando", desde: AGORA - 5000, despachadoEm: AGORA - 4000 } as never], turnosCancelados: [], propostas: [], fios: [],
});
const hidratar = (e: Estado, mensagens: Mensagem[], agora = AGORA): Estado => reduzir(e, { tipo: "hidratar-conversa", conversa: dto(mensagens), agora });
const pendente: FalaPendente = { idEnvio: "e1", texto: "e agora?", anexos: [], em: AGORA + 10, estado: "enviando", mensagemId: null, turnoId: null };
const ids = (e: Estado): string[] => (e.conversas[C]?.mensagens ?? []).map((m) => m.id);

describe("NOD-363: a janela crescida pelo ?ate= no reducer", () => {
  it("critérios 5–7: 200 → janela até a fala antiga, em ordem e sem repetir; pendente e texto do turno vivo ficam", () => {
    let e = hidratar(estadoInicial, faixa(301, 500));
    expect(ids(e)).toHaveLength(200);
    e = reduzir(e, { tipo: "fala-pendente", conversaId: C, pendente });
    const atividade = { texto: "pensando…" } as never;
    e = { ...e, atividades: { ...e.atividades, [C]: { t1: atividade } } };

    // A releitura com `ate=m20`: a janela vai de m20 ao fim (mais a folga), contínua.
    e = hidratar(e, faixa(1, 500), AGORA + 100);
    const depois = ids(e);
    expect(depois).toHaveLength(500);
    expect(new Set(depois).size).toBe(500);
    expect(depois.slice(0, 3)).toEqual(["m1", "m2", "m3"]);
    expect(depois.at(-1)).toBe("m500");
    expect(depois).toEqual([...depois].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
    expect(e.conversas[C]?.pendentes?.map((p) => p.idEnvio)).toEqual(["e1"]);
    expect(e.atividades[C]?.t1).toBe(atividade);

    // Critério 5: fala nova (SSE) relê com o mesmo `ate` — a janela segue crescida e ganha a nova no fim.
    e = hidratar(e, faixa(1, 501), AGORA + 200);
    expect(ids(e)[0]).toBe("m1");
    expect(ids(e).at(-1)).toBe("m501");
    expect(new Set(ids(e)).size).toBe(501);
  });
});
