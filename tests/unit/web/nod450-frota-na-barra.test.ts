import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import type { FrameSse } from "../../../src/contracts/frame.ts";
import { acoesAoMudarConexao, aplicarFrame, estadoInicial, invalidacoesAoMudarConexao, invalidacoesAoReconectar, invalidacoesAoRetomar, reduzir, sempreRelevante, type Estado } from "../../../web/estado/reducer.ts";
import { criarLiveEvents, type EventoLive, type FonteSse } from "../../../web/lib/live-events.ts";
import { gruposDaBarra } from "../../../web/lib/secoes.ts";

/**
 * NOD-450: o bot criado pelo chat (criar_bots) só entrava na barra lateral depois do F5. O caminho frame → frota → barra
 * existe; a lacuna era o stream que cai e volta (com replay) não reler a frota. Aqui: o frame `agente.mudou` (criado)
 * pede a frota, a frota relida põe o bot na barra (com e sem seção, no computador e no celular), e a reconexão relê.
 */
type Agente = FrotaDto["agentes"][number];
const AGORA = 1_000_000;
const P = "p";

const bot = (id: string, extra: Partial<Agente> = {}): Agente => ({
  tenantId: "t", id, ownerId: P, visibility: "privado", nome: id, titulo: "", descricao: "x", dono: "pessoa", forma: "shape-square", cor: "c-pink",
  fixado: false, oculto: false, confirmado: true, modelo: "claude-haiku-4-5-20251001", duplicadoDe: null, criadoEm: 1, conversaId: `c-${id}`,
  descricaoEstado: "", computadorForaDoAr: null, ultimaMensagem: null, ...extra,
});
const frotaCom = (...agentes: Agente[]): FrotaDto => ({ agentes, inventario: { estado: "pronto", versao: "v", em: 1 }, negacoes: [] });
const frame = (dados: Record<string, unknown>, seq = 1): FrameSse => ({ streamId: "s", seq, pessoaId: P, tipo: "agente.mudou", dados: { kind: "agente_atualizado", ...dados } });

const nod = bot("nod", { papel: "nod", fixado: true } as Partial<Agente>);
const antigo = bot("antigo");

function comSessao(): Estado {
  let e = reduzir(estadoInicial, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: P } });
  e = reduzir(e, { tipo: "hidratar-frota", frota: frotaCom(nod, antigo) });
  return reduzir(e, { tipo: "invalidacoes-tratadas", quais: [...e.invalidacoes] });
}

/** O que o main.ts faz com a falta de `frota`: busca, hidrata e dá a falta por tratada. */
function releFrota(e: Estado, frota: FrotaDto): Estado {
  expect(e.invalidacoes).toContain("frota");
  const lida = reduzir(e, { tipo: "hidratar-frota", frota });
  return reduzir(lida, { tipo: "invalidacoes-tratadas", quais: ["frota"] });
}

const nomesNaBarra = (e: Estado, celular = false) => {
  const g = gruposDaBarra(e.frota?.agentes ?? [], e.sessao?.pessoaId ?? "", celular);
  return { fixados: g.fixados.map((a) => a.id), soltos: g.soltos.map((a) => a.id), secoes: g.secoes.map((s) => [s.nome, s.bots.map((a) => a.id)]) };
};

describe("NOD-450: bot criado pelo chat entra na barra sem recarregar", () => {
  it("frame agente.mudou (criado) pede a frota; a relida põe o bot sem seção em Meus agentes", () => {
    const e0 = comSessao();
    expect(nomesNaBarra(e0).soltos).toEqual(["antigo"]);
    const e1 = aplicarFrame(e0, frame({ agente_id: "novo", acao: "criado" }), AGORA);
    const e2 = releFrota(e1, frotaCom(nod, antigo, bot("novo")));
    expect(nomesNaBarra(e2)).toEqual({ fixados: ["nod"], soltos: ["antigo", "novo"], secoes: [] });
    expect(e2.invalidacoes).not.toContain("frota");
  });

  it("criar_bots com seção (criado + organizar): os bots entram na seção nova; com 2 bots, os dois", () => {
    const e0 = comSessao();
    let e = aplicarFrame(e0, frame({ agente_id: "b1", acao: "criado" }, 1), AGORA);
    e = aplicarFrame(e, frame({ agente_id: "b2", acao: "criado" }, 2), AGORA);
    e = aplicarFrame(e, frame({ agente_id: "b1", acao: "organizar" }, 3), AGORA);
    // Uma falta só, mesmo com três frames: o `invalidar` do reducer não repete a marca (os eventos vêm da mesma transação).
    expect(e.invalidacoes.filter((q) => q === "frota")).toHaveLength(1);
    const e2 = releFrota(e, frotaCom(nod, antigo, bot("b1", { secao: "Vendas" } as Partial<Agente>), bot("b2", { secao: "Vendas" } as Partial<Agente>)));
    expect(nomesNaBarra(e2)).toEqual({ fixados: ["nod"], soltos: ["antigo"], secoes: [["Vendas", ["b1", "b2"]]] });
  });

  it("no celular o bot novo também entra (o Nod segue o primeiro favorito)", () => {
    const e = releFrota(aplicarFrame(comSessao(), frame({ agente_id: "novo", acao: "criado" }), AGORA), frotaCom(bot("nod", { papel: "nod" } as Partial<Agente>), antigo, bot("novo")));
    expect(nomesNaBarra(e, true)).toEqual({ fixados: ["nod"], soltos: ["antigo", "novo"], secoes: [] });
  });

  it("gruposDaBarra: seções em ordem alfabética, fixado com seção só na grade, bots de outra pessoa na equipe", () => {
    const g = gruposDaBarra([nod, bot("z", { secao: "Zeta" } as Partial<Agente>), bot("a", { secao: "Alfa" } as Partial<Agente>), bot("f", { fixado: true, secao: "Alfa" } as Partial<Agente>), bot("dela", { ownerId: "outra" }), antigo], P, false);
    expect(g.secoes.map((s) => [s.nome, s.bots.map((a) => a.id)])).toEqual([["Alfa", ["a"]], ["Zeta", ["z"]]]);
    expect(g.fixados.map((a) => a.id)).toEqual(["nod", "f"]);
    expect(g.soltos.map((a) => a.id)).toEqual(["antigo"]);
    expect(g.equipe.map((a) => a.id)).toEqual(["dela"]);
    expect(g.meus).toHaveLength(5);
    // O Nod discreto (desafixado) sai da grade no computador e fica no celular.
    const discreto = bot("nod", { papel: "nod" } as Partial<Agente>);
    expect(gruposDaBarra([discreto], P, false).fixados).toEqual([]);
    expect(gruposDaBarra([discreto], P, true).fixados.map((a) => a.id)).toEqual(["nod"]);
    // QA: fixado (com ou sem seção) só na grade — não repete em Meus agentes nem abre cabeçalho de seção vazio.
    const soFixados = gruposDaBarra([bot("f", { fixado: true }), bot("g", { fixado: true, secao: "So" } as Partial<Agente>)], P, false);
    expect(soFixados.soltos).toEqual([]);
    expect(soFixados.secoes).toEqual([]);
  });

  it("a barra desenhada usa os grupos (renderSidebar: os comuns não fixados vão para os times, NOD-437)", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toContain("gruposDaBarra(agentes, pessoaId, ehCelular)");
    expect(main).toContain("timesComBots(comuns.filter((a) => !a.fixado), estado.frota?.times)");
    expect(main).toContain("for (const acao of acoesAoMudarConexao(estado, ev)) dispatch(acao);");
    // O elo falta → busca: a falta `frota` é buscada em qualquer tela e vira hidratar-frota.
    expect(main).toContain("if (sempreRelevante(q)) return true;");
    expect(main).toContain('if (q === "frota") return buscarFrota();');
  });

  it("a falta frota (e os não lidos) é buscada em qualquer tela; a gestão, não", () => {
    expect(sempreRelevante("frota")).toBe(true);
    expect(sempreRelevante("nao-lidos")).toBe(true);
    expect(sempreRelevante("trabalhos")).toBe(true);
    expect(sempreRelevante("gestao")).toBe(false);
    expect(sempreRelevante("conversa:c")).toBe(false);
  });
});

/** EventSource falso, uma por aba: o teste dispara open e frames à mão. */
class Fonte implements FonteSse {
  ouvintes = new Map<string, ((ev: { data?: unknown; lastEventId?: string }) => void)[]>();
  url: string;
  constructor(url: string) { this.url = url; }
  addEventListener(tipo: string, fn: (ev: { data?: unknown; lastEventId?: string }) => void): void { this.ouvintes.set(tipo, [...(this.ouvintes.get(tipo) ?? []), fn]); }
  close(): void {}
  disparar(tipo: string, ev: { data?: unknown; lastEventId?: string } = {}): void { for (const fn of this.ouvintes.get(tipo) ?? []) fn(ev); }
  frame(f: FrameSse): void { this.disparar(f.tipo, { data: JSON.stringify(f), lastEventId: `${f.streamId}:${f.seq}` }); }
}
function aba() {
  const fontes: Fonte[] = [];
  const eventos: EventoLive[] = [];
  const live = criarLiveEvents("/api/t/t/eventos", { criarFonte: (url) => { const f = new Fonte(url); fontes.push(f); return f; }, agendar: () => ({}), cancelar: () => undefined, relogio: { agora: () => AGORA, agendar: () => ({}), cancelar: () => undefined } });
  live.subscribe((ev) => eventos.push(ev));
  live.connect();
  fontes[0]!.disparar("open");
  return { fontes, frames: () => eventos.flatMap((ev) => (ev.tipo === "frame" ? [ev.frame] : [])) };
}

describe("NOD-450: bot criado em outra aba ou aparelho (critério 2)", () => {
  it("por aba: o frame recebido relê a frota e a repetição é descartada (a entrega a todos os streams da pessoa é do servidor: tests/integration/sse-replay.test.ts)", () => {
    const a = aba();
    const b = aba();
    const criado: FrameSse = { ...frame({ agente_id: "novo", acao: "criado" }, 7), streamId: "proc" };
    for (const t of [a, b]) {
      t.fontes[0]!.frame(criado);
      t.fontes[0]!.frame(criado);
      expect(t.frames()).toHaveLength(1);
      const depois = releFrota(aplicarFrame(comSessao(), t.frames()[0]!, AGORA), frotaCom(nod, antigo, bot("novo")));
      expect(nomesNaBarra(depois).soltos).toEqual(["antigo", "novo"]);
    }
  });
});

describe("NOD-450: o stream que cai e volta relê a barra (critério 2)", () => {
  it("invalidacoesAoReconectar inclui frota e não lidos; sem sessão, nada", () => {
    const q = invalidacoesAoReconectar(comSessao());
    expect(q).toContain("frota");
    expect(q).toContain("nao-lidos");
    expect(q).not.toContain("gestao");
    expect(invalidacoesAoReconectar(estadoInicial)).toEqual([]);
  });

  it("a gestão (Agentes) já lida também é relida, na reconexão e na retomada", () => {
    const e = reduzir(comSessao(), { tipo: "hidratar-gestao", gestao: frotaCom(nod, antigo) });
    expect(invalidacoesAoReconectar(e)).toContain("gestao");
    expect(invalidacoesAoRetomar(e)).toContain("gestao");
    expect(invalidacoesAoRetomar(comSessao())).not.toContain("gestao");
  });

  it("ponta a ponta: frame perdido na queda, a reconexão relê e o bot aparece", () => {
    let e = comSessao();
    // A primeira conexão não relê nada (a sessão já pediu a frota); a queda também não.
    expect(invalidacoesAoMudarConexao(e, "aberto")).toEqual([]);
    expect(invalidacoesAoMudarConexao(e, "reconectando")).toEqual([]);
    // QA: sair de `reconectando` para outro estado que não `aberto` (sessão terminou, desligado) não relê.
    const caido = reduzir(e, { tipo: "conexao", estado: "reconectando", tentativa: 1, proximaEmMs: 1000 });
    for (const outro of ["parado", "conectando", "reconectando"] as const) expect(invalidacoesAoMudarConexao(caido, outro)).toEqual([]);
    const aplicar = (x: Estado, ev: Parameters<typeof acoesAoMudarConexao>[1]) => acoesAoMudarConexao(x, ev).reduce(reduzir, x);
    e = aplicar(e, { estado: "reconectando", tentativa: 1, proximaEmMs: 1000 });
    expect(e.conexao.estado).toBe("reconectando");
    expect(e.invalidacoes).not.toContain("frota");
    // O agente.mudou e o turno.encerrado não chegaram. O stream volta: as ações que o main.ts despacha, na ordem.
    const acoes = acoesAoMudarConexao(e, { estado: "aberto", tentativa: 0, proximaEmMs: null });
    expect(acoes.map((a) => a.tipo)).toEqual(["conexao", "invalidar"]);
    e = acoes.reduce(reduzir, e);
    expect(e.conexao.estado).toBe("aberto");
    expect(e.invalidacoes).toContain("frota");
    // Já aberto, um novo `aberto` não relê de novo.
    expect(acoesAoMudarConexao(e, { estado: "aberto", tentativa: 0, proximaEmMs: null }).map((a) => a.tipo)).toEqual(["conexao"]);
    const depois = releFrota(e, frotaCom(nod, antigo, bot("novo")));
    expect(nomesNaBarra(depois).soltos).toEqual(["antigo", "novo"]);
  });
});
