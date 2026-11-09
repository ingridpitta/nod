import { describe, expect, it, vi } from "vitest";
import type { EsperaDoDonoDto } from "../../../src/contracts/dono.ts";
import { esperaNaTela, quandoPediu } from "../../../web/lib/dono.ts";
import { aoColega, comAcaoLocal, criarAcaoLocal, criarAcoesDaEspera, htmlDasAcoes } from "../../../web/lib/esperas-de-colega.ts";

/** NOD-377 (definido em 2026-10-27; protótipo aprovado): a espera de colega vencida, com Cobrar e Desistir. */
const H = 3_600_000;
const AGORA = new Date(2026, 9, 28, 15, 38).getTime();
const colega = (c: Partial<NonNullable<EsperaDoDonoDto["colega"]>> = {}): NonNullable<EsperaDoDonoDto["colega"]> => ({ id: "l", removido: false, trabalhando: false, fila: 0, tarefaId: "t1", vencida: true, cobradoEm: null, podeCobrar: true, ...c });
const espera = (c = colega(), desde = AGORA - 26 * H): EsperaDoDonoDto => ({ tipo: "colega", trabalhoId: null, motivo: "Leo", desde, colega: c });

describe("esperaNaTela, espera vencida", () => {
  it("vencida: 'sem resposta há 26h' no lugar de 'Leo está livre', 'pedido enviado ontem às 13:38', sem o tempo à direita, com Cobrar", () => {
    const v = esperaNaTela(espera(), AGORA);
    expect(v.linhas).toEqual(["sem resposta há 26h", "pedido enviado ontem às 13:38"]);
    expect(v.tempo).toBe("");
    expect(v.colega).toMatchObject({ tarefaId: "t1", vencida: true, podeCobrar: true, acoes: true });
  });

  it("no prazo: o estado do colega e o tempo de sempre, sem ações", () => {
    const v = esperaNaTela(espera(colega({ vencida: false, podeCobrar: false }), AGORA - 2 * H), AGORA);
    expect(v.linhas[0]).toBe("Leo está livre");
    expect(v.tempo).toBe("2h");
    expect(v.colega?.acoes).toBe(false);
  });

  it("cobrada no prazo: 'cobrado agora · Leo está trabalhando', só Desistir", () => {
    const v = esperaNaTela(espera(colega({ vencida: false, podeCobrar: false, cobradoEm: AGORA - 10_000, trabalhando: true })), AGORA);
    expect(v.linhas[0]).toBe("cobrado agora · Leo está trabalhando");
    expect(v.colega).toMatchObject({ acoes: true, podeCobrar: false });
    expect(htmlDasAcoes({ agenteId: "a", tarefaId: "t1", colega: "Leo", podeCobrar: false })).not.toContain("Cobrar");
  });

  it("colega removido: sem ações (o servidor avisa sozinho)", () => {
    expect(esperaNaTela(espera(colega({ removido: true, id: null })), AGORA).colega?.acoes).toBe(false);
  });

  it("quandoPediu: hoje, ontem e outro dia", () => {
    expect(quandoPediu(AGORA - H, AGORA)).toBe("às 14:38");
    expect(quandoPediu(AGORA - 26 * H, AGORA)).toBe("ontem às 13:38");
    expect(quandoPediu(new Date(2026, 9, 21, 9, 5).getTime(), AGORA)).toBe("em 21/10 às 09:05");
  });
});

describe("htmlDasAcoes", () => {
  const base = { agenteId: "a", tarefaId: "t1", colega: "Leo", podeCobrar: true };
  it("Cobrar e Desistir, com o pedido no botão", () => {
    const h = htmlDasAcoes(base);
    expect(h).toContain('data-act="espera-cobrar" aria-label="Cobrar Leo" data-agente="a" data-tarefa="t1" data-colega="Leo">Cobrar</button>');
    expect(h).toContain('aria-label="Desistir do pedido ao Leo" data-agente="a" data-tarefa="t1" data-colega="Leo">Desistir</button>');
  });
  it("sem nome: 'ao colega', nunca 'ao o colega' (revisão do PR #544)", () => {
    expect(aoColega("")).toBe("ao colega");
    expect(htmlDasAcoes({ ...base, colega: "" })).toContain('aria-label="Desistir do pedido ao colega"');
  });
  it("Cobrando…: desabilitado e aria-busy, Desistir continua", () => {
    const h = htmlDasAcoes({ ...base, fase: { fase: "cobrando" } });
    expect(h).toContain('disabled aria-busy="true">Cobrando…');
    expect(h).toContain(">Desistir</button>");
  });
  it("erro: 'Tentar de novo' e o aviso em role=status", () => {
    const h = htmlDasAcoes({ ...base, fase: { fase: "erro" } });
    expect(h).toContain(">Tentar de novo</button>");
    expect(h).toContain('role="status">Não deu para cobrar agora.');
  });
  it("escapa o nome do colega", () => {
    expect(htmlDasAcoes({ ...base, colega: 'L"<x>' })).toContain('data-colega="L&quot;&lt;x&gt;"');
  });
});

describe("as ações", () => {
  const el = { dataset: { agente: "a", tarefa: "t1", colega: "Leo" } };
  const montar = (cobrar = vi.fn(async () => ({})), desistir = vi.fn(async () => ({}))) => {
    const local = criarAcaoLocal();
    const deps = { cobrar, desistir, invalidar: vi.fn(), render: vi.fn(), anunciar: vi.fn(), focarCampo: vi.fn(), local };
    return { local, deps, acoes: criarAcoesDaEspera(deps) };
  };

  it("Cobrar: chama a rota, anuncia 'Pedido reentregue ao Leo', marca cobrado e relê; a tela tira o Cobrar até o servidor reler", async () => {
    const { local, deps, acoes } = montar();
    await acoes["espera-cobrar"]!(el);
    expect(deps.cobrar).toHaveBeenCalledWith("a", "t1");
    expect(deps.anunciar).toHaveBeenCalledWith("Pedido reentregue ao Leo");
    expect(deps.invalidar).toHaveBeenCalled();
    const visto = comAcaoLocal(espera(), local);
    expect(visto?.colega).toMatchObject({ vencida: false, podeCobrar: false });
    // O servidor releu com a cobrança: a marca local sai.
    // Revisão 7 (L4): o relógio do servidor 5 min atrás do navegador não segura a marca.
    const doServidor = espera(colega({ vencida: false, podeCobrar: false, cobradoEm: Date.now() - 5 * 60_000 }));
    expect(comAcaoLocal(doServidor, local)).toBe(doServidor);
    expect(local.fase("t1")).toBeUndefined();
  });

  it("Cobrar que falha: fica em erro (Tentar de novo), sem anunciar a reentrega", async () => {
    const { local, deps, acoes } = montar(vi.fn(async () => { throw new Error("500"); }));
    await acoes["espera-cobrar"]!(el);
    expect(local.fase("t1")).toEqual({ fase: "erro" });
    expect(deps.anunciar).not.toHaveBeenCalled();
  });

  it("Cobrar duas vezes seguidas: uma chamada só", async () => {
    let soltar: () => void = () => undefined;
    const cobrar = vi.fn(() => new Promise<object>((r) => { soltar = () => r({}); }));
    const { acoes } = montar(cobrar);
    const a = acoes["espera-cobrar"]!(el);
    await acoes["espera-cobrar"]!(el);
    soltar();
    await a;
    expect(cobrar).toHaveBeenCalledTimes(1);
  });

  it("Desistir: sem confirmação, some na hora, anuncia 'Pedido ao Leo encerrado' e foca o campo", async () => {
    const { local, deps, acoes } = montar();
    await acoes["espera-desistir"]!(el);
    expect(deps.desistir).toHaveBeenCalledWith("a", "t1");
    expect(comAcaoLocal(espera(), local)).toBeNull();
    expect(deps.anunciar).toHaveBeenCalledWith("Pedido ao Leo encerrado");
    expect(deps.focarCampo).toHaveBeenCalled();
  });

  it("Desistir que falha: a espera volta", async () => {
    const { local, acoes } = montar(undefined, vi.fn(async () => { throw new Error("500"); }));
    await acoes["espera-desistir"]!(el);
    expect(comAcaoLocal(espera(), local)).not.toBeNull();
  });
});
