import { afterEach, describe, expect, it, vi } from "vitest";
import { avisoMaisForte, cabecalhoSecao, chaveDaSecao, CHAVE_SECOES_RECOLHIDAS, definirSecaoRecolhida, estadoDaSecao, lerSecoesRecolhidas, type BotNaSecao } from "../../../web/lib/secoes.ts";

/** Seções da barra que recolhem (definido em 2026-10-04). */
describe("quem some da seção recolhida e o ponto do título", () => {
  const bots: BotNaSecao[] = [
    { conversaId: "c1", aviso: "decisao", alerta: false },
    { conversaId: "c2", aviso: "pergunta", alerta: false },
    { conversaId: "c3", aviso: "", alerta: false },
  ];
  const base = { chave: "p:secao:Devs", recolhidas: new Set(["p:secao:Devs"]), conversaAberta: "c1", bots };

  it("recolhida, some todo mundo menos o bot da conversa aberta; o ponto vem só dos que sumiram", () => {
    const s = estadoDaSecao(base);
    expect(s.recolhida).toBe(true);
    expect(s.escondidos).toEqual([false, true, true]);
    // A decisão do c1 está à vista na linha dele: o título não a repete.
    expect(s.aviso).toBe("pergunta");
  });

  it("o ponto é o aviso mais forte entre os escondidos", () => {
    expect(estadoDaSecao({ ...base, conversaAberta: null }).aviso).toBe("decisao");
    expect(estadoDaSecao({ ...base, conversaAberta: "c2", bots: [bots[1]!, bots[2]!, { conversaId: "c4", aviso: "nao-lido", alerta: false }] }).aviso).toBe("nao-lido");
  });

  it("computador fora do ar ou em ligação nunca some, e o aviso dele não sobe (está à vista)", () => {
    const s = estadoDaSecao({ ...base, conversaAberta: null, bots: [{ ...bots[0]!, alerta: true }, bots[2]!] });
    expect(s.escondidos).toEqual([false, true]);
    expect(s.aviso).toBe("");
  });

  it("chave fora do conjunto: aberta, nada some, sem ponto", () => {
    const s = estadoDaSecao({ ...base, recolhidas: new Set(["p:secao:Outra"]) });
    expect(s).toEqual({ recolhida: false, escondidos: [false, false, false], aviso: "" });
  });
});

describe("o título da seção", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("é um botão com aria-expanded; aberta, sem contagem nem ponto", () => {
    const html = cabecalhoSecao("Devs", "p:secao:Devs", { recolhida: false, total: 4, aviso: "decisao" });
    expect(html).toContain('<button type="button" class="secao-cab" data-act="recolher-secao" data-chave="p:secao:Devs" aria-expanded="true" aria-label="Devs" title="Recolher Devs"><span class="secao-nome">Devs</span><svg');
    expect(html).not.toContain("<small");
    expect(html).not.toContain("secao-aviso");
  });

  it("recolhida, diz quantos bots tem e mostra o ponto; o leitor de tela ouve com vírgulas", () => {
    const html = cabecalhoSecao("Devs", "p:secao:Devs", { recolhida: true, total: 4, aviso: "decisao" });
    expect(html).toContain('aria-expanded="false" aria-label="Devs, 4 bots, esperando sua decisão" title="Mostrar Devs"');
    expect(html).toContain('<small aria-hidden="true">4</small>');
    expect(html).toContain('<i class="secao-aviso" data-aviso="decisao" aria-hidden="true"></i>');
    expect(cabecalhoSecao("Devs", "p:secao:Devs", { recolhida: true, total: 1, aviso: "" })).toContain('aria-label="Devs, 1 bot"');
  });

  it("recolhida e vazia (\"Meus agentes\" sem bots soltos), sem contagem zero", () => {
    expect(cabecalhoSecao("Meus agentes", "p:secao:", { recolhida: true, total: 0, aviso: "" })).not.toContain("<small");
  });

  it("o nome da seção (texto livre da pessoa) é escapado em todo lugar: texto, title, aria-label e data-chave", () => {
    const nome = '<b>"x"</b>';
    const html = cabecalhoSecao(nome, chaveDaSecao("p", nome), { recolhida: false, total: 1, aviso: "" });
    expect(html).not.toContain("<b>");
    expect(html).not.toContain('"x"');
    expect(html.match(/&lt;b&gt;&quot;x&quot;&lt;\/b&gt;/g)).toHaveLength(4);
  });
});

describe("guardado neste navegador", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a chave é da pessoa: 'Meus agentes' (seção \"\"), as seções dela e a equipe não se misturam, nem entre pessoas", () => {
    expect(chaveDaSecao("p", "")).toBe("p:secao:");
    expect(chaveDaSecao("p", "Devs")).toBe("p:secao:Devs");
    expect(chaveDaSecao("p", null)).toBe("p:equipe");
    expect(chaveDaSecao("ana", "Devs")).not.toBe(chaveDaSecao("p", "Devs"));
  });

  it("o aviso mais forte: decisão, depois pergunta, depois mensagem nova", () => {
    expect(avisoMaisForte(["nao-lido", "pergunta", ""])).toBe("pergunta");
    expect(avisoMaisForte(["nao-lido", "decisao", "pergunta"])).toBe("decisao");
    expect(avisoMaisForte([])).toBe("");
  });

  it("recolher e abrir devolvem um conjunto novo, gravam, e partem do que está gravado (outra aba)", () => {
    const guardado = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) });
    const antes = new Set<string>();
    const depois = definirSecaoRecolhida(antes, "p:secao:Devs", true);
    expect(depois).not.toBe(antes);
    expect([...lerSecoesRecolhidas()]).toEqual(["p:secao:Devs"]);
    // Outra aba recolheu a equipe; esta, que não viu, abre Devs: a equipe continua recolhida.
    guardado.set(CHAVE_SECOES_RECOLHIDAS, JSON.stringify(["p:secao:Devs", "p:equipe"]));
    expect([...definirSecaoRecolhida(depois, "p:secao:Devs", false)]).toEqual(["p:equipe"]);
    expect(JSON.parse(guardado.get(CHAVE_SECOES_RECOLHIDAS) ?? "[]")).toEqual(["p:equipe"]);
  });

  it("sem storage, vale só nesta aba; lixo gravado vira nada recolhido", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } });
    expect(lerSecoesRecolhidas().size).toBe(0);
    expect([...definirSecaoRecolhida(new Set(["p:secao:A"]), "p:equipe", true)]).toEqual(["p:secao:A", "p:equipe"]);
    vi.stubGlobal("localStorage", { getItem: () => '{"x":1}', setItem: () => undefined });
    expect(lerSecoesRecolhidas().size).toBe(0);
    vi.stubGlobal("localStorage", { getItem: () => '["p:secao:Devs",1,null]', setItem: () => undefined });
    expect([...lerSecoesRecolhidas()]).toEqual(["p:secao:Devs"]);
  });
});
