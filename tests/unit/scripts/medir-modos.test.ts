import { describe, expect, it } from "vitest";
import { classificar, imprimir, imprimirRevisor, juntarLinha, resumir, resumirRevisor, tipoDoPedido, type LinhaAprovacao } from "../../../scripts/medir-modos.ts";

const AGORA = 1_760_000_000_000;
const HORA = 60 * 60_000;
const base: LinhaAprovacao = { id: "d", agente_id: "a", semana: "2026-10-12", criado: AGORA - 10 * HORA, fim: null, estado: "pendente", desfecho: null, rotina: false, motivo: "destino_terminal", conector: "terminal", eh_arquivo: false, frase_app: false, algum_marcado: true };

describe("medir-modos (a linha de base dos modos de aprovação)", () => {
  it("o tipo do pedido: comando, gravar arquivo e MCP da pessoa são do Mac; app e computador, não", () => {
    expect(tipoDoPedido(base)).toBe("comando");
    expect(tipoDoPedido({ ...base, eh_arquivo: true })).toBe("arquivo");
    expect(tipoDoPedido({ ...base, frase_app: true })).toBe("mcp");
    expect(tipoDoPedido({ ...base, conector: "clickup" })).toBe("app");
    expect(tipoDoPedido({ ...base, conector: "computador" })).toBe("computador");
    expect(tipoDoPedido({ ...base, conector: null })).toBe("app");
  });

  it("desfecho e horas: aprovada, negada (nenhum item marcado), venceu, dispensada, aberta até agora; a regra na hora não é espera", () => {
    expect(classificar({ ...base, desfecho: "decidida", estado: "decidida", fim: AGORA - 8 * HORA }, AGORA)).toMatchObject({ desfecho: "aprovada", ms: 2 * HORA });
    expect(classificar({ ...base, desfecho: "decidida", estado: "decidida", fim: AGORA - 9 * HORA, algum_marcado: false }, AGORA)).toMatchObject({ desfecho: "negada", ms: HORA });
    expect(classificar({ ...base, estado: "vencida", fim: AGORA - 7 * HORA }, AGORA)).toMatchObject({ desfecho: "venceu", ms: 3 * HORA });
    expect(classificar({ ...base, desfecho: "expirou_sem_ninguem_ver", estado: "vencida", fim: AGORA - 7 * HORA }, AGORA)).toMatchObject({ desfecho: "venceu" });
    expect(classificar({ ...base, desfecho: "dispensada", estado: "decidida", fim: AGORA - 9 * HORA }, AGORA)).toMatchObject({ desfecho: "dispensada" });
    expect(classificar(base, AGORA)).toMatchObject({ desfecho: "aberta", ms: 10 * HORA });
    expect(classificar({ ...base, estado: "reaberta" }, AGORA)).toMatchObject({ desfecho: "aberta" });
    expect(classificar({ ...base, desfecho: "decidida_por_regra", estado: "decidida", fim: base.criado + 1_000 }, AGORA)).toBeNull();
    expect(classificar({ ...base, desfecho: "decidida_por_regra", estado: "decidida", fim: base.criado + HORA }, AGORA)).toMatchObject({ desfecho: "regra_depois", ms: HORA });
    expect(classificar({ ...base, motivo: null }, AGORA)).toMatchObject({ motivo: "-" });
  });

  it("resumo: auto/total pelo modo de hoje, no Mac à parte do app, rotina com as horas dela, credencial do hook por bot", () => {
    const linhas: LinhaAprovacao[] = [
      { ...base, id: "1", agente_id: "auto", motivo: "acao_arriscada" },
      { ...base, id: "2", agente_id: "manual", rotina: true, estado: "vencida", fim: AGORA - 6 * HORA },
      { ...base, id: "3", agente_id: "manual", conector: "email", motivo: "sem_regra_permanente", desfecho: "decidida", estado: "decidida", fim: AGORA - 9 * HORA, algum_marcado: false },
      { ...base, id: "4", agente_id: "manual", desfecho: "decidida_por_regra", estado: "decidida", fim: base.criado },
      { ...base, id: "5", agente_id: "total", semana: "2026-10-05", motivo: "toca_credencial" },
    ];
    const bots = [{ id: "auto", nome: "Clarice", modo: "automatico", nod: false }, { id: "manual", nome: "Milton", modo: "manual", nod: false }, { id: "total", nome: "Nod", modo: "total", nod: true }];
    const r = resumir(linhas, bots, [{ semana: "2026-10-12", agente_id: "auto", n: 3 }], AGORA);
    expect(r.porModo).toEqual(new Map([["automatico", 1], ["manual", 1], ["total (Nod)", 1]]));
    expect(r.porSemana.get("2026-10-12")).toMatchObject({ cartoes: 3, emAutoOuTotal: 1, negados: 1, rotina: 1, msRotina: 4 * HORA, semEspera: 1, credencialNegada: 3 });
    expect(r.porSemana.get("2026-10-05")).toMatchObject({ cartoes: 1, emAutoOuTotal: 1 });
    expect(r.porMotivo.get("2026-10-12|sem_regra_permanente")).toMatchObject({ cartoes: 1, negados: 1 });
    // O app (e-mail) não entra nos comandos do Mac.
    expect([...r.noMac.keys()].sort()).toEqual(["2026-10-05|comando|toca_credencial", "2026-10-12|comando|acao_arriscada", "2026-10-12|comando|destino_terminal"]);
    expect(r.porBot.get("2026-10-12|manual")).toMatchObject({ cartoes: 2, noMac: 1, negados: 1, rotina: 1 });
    expect(r.porBot.get("2026-10-12|auto")).toMatchObject({ cartoes: 1, credencialNegada: 3 });

    const saida: string[] = [];
    imprimir(r, bots, (s) => saida.push(s));
    const texto = saida.join("\n");
    expect(texto).toContain("auto");
    // Só contagens e o começo do id: o nome que a pessoa deu ao bot não sai (revisão do PR #402).
    expect(texto).not.toContain("Clarice");
    expect(texto).not.toContain("Milton");
    expect(texto).toMatch(/2026-10-12\s+3\s+1\s+1/);
  });

  it("a mesma decisão lida por duas pessoas: a rotina que a dona viu fica, em qualquer ordem (revisão do PR #402)", () => {
    for (const ordem of [[true, false], [false, true]]) {
      const m = new Map<string, LinhaAprovacao>();
      for (const rotina of ordem) juntarLinha(m, { ...base, rotina });
      expect(m.get("d")?.rotina).toBe(true);
    }
    const m = new Map<string, LinhaAprovacao>();
    juntarLinha(m, base);
    juntarLinha(m, { ...base });
    expect(m.get("d")?.rotina).toBe(false);
  });

  it("PR 4: o revisor por semana — veredito, cartões que a pessoa negou e liberadas contestadas ('Devia ter perguntado')", () => {
    const r = resumirRevisor([
      { semana: "2026-10-26", veredito: "libera", desfecho_pessoa: null, contestada: false, n: 7 },
      { semana: "2026-10-26", veredito: "libera", desfecho_pessoa: null, contestada: true, n: 1 },
      { semana: "2026-10-26", veredito: "pede", desfecho_pessoa: "negou", contestada: false, n: 1 },
      { semana: "2026-10-26", veredito: "pede", desfecho_pessoa: "aprovou", contestada: false, n: 2 },
      { semana: "2026-10-26", veredito: "falhou", desfecho_pessoa: "venceu", contestada: false, n: 1 },
      { semana: "2026-10-26", veredito: null, desfecho_pessoa: null, contestada: false, n: 1 },
    ]);
    expect(r.get("2026-10-26")).toEqual({ revisoes: 13, libera: 8, pede: 3, falhou: 1, naoRevisado: 0, cartoes: 4, negados: 1, contestadas: 1 });
    const saida: string[] = [];
    imprimirRevisor(r, (s) => saida.push(s));
    expect(saida[2]).toContain("8 62%");
    expect(saida[2]).toContain("1 25%");
    expect(saida[2]).toContain("1 13%");
  });
});
