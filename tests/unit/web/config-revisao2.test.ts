import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Relato } from "../../../src/contracts/relato.ts";
import { estadoInicial, reduzir } from "../../../web/estado/reducer.ts";
import { seletorDoFocoNaRegiao } from "../../../web/lib/foco-do-bloco.ts";
import { textoNoMenu } from "../../../web/lib/linha-config.ts";
import { mudancaSujaAGaveta, reporSeletor, salvarOuRepor } from "../../../web/lib/salvar-ou-repor.ts";

/** NOD-367, revisão 2: Feedback relê ao entrar, o foco volta pelo controle, o seletor não guarda valor não salvo. */
const el = (tag: string, dataset: Record<string, string>, attrs: Record<string, string> = {}) => ({ tagName: tag.toUpperCase(), dataset, getAttribute: (n: string) => attrs[n] ?? null });

describe("NOD-367 revisão 2", () => {
  it("entrar em Feedback zera a lista e o erro (o relato.criado não invalida nada); ficar nela não relê", () => {
    const comLista = { ...estadoInicial, espaco: { secao: "geral" as const }, relatos: [{ id: "r1" } as Relato], relatosErro: true };
    const entrou = reduzir(comLista, { tipo: "espaco", secao: "feedback" });
    expect(entrou.relatos).toBeNull();
    expect(entrou.relatosErro).toBe(false);
    const jaEstava = { ...comLista, espaco: { secao: "feedback" as const } };
    expect(reduzir(jaEstava, { tipo: "espaco", secao: "feedback" }).relatos).toEqual([{ id: "r1" }]);
    expect(reduzir(comLista, { tipo: "espaco", secao: "maquinas" }).relatos).toEqual([{ id: "r1" }]);
  });

  it("a chave do foco é o controle (ação, alvo, nome), não a posição; sem chave, nada volta", () => {
    expect(seletorDoFocoNaRegiao(el("select", { actChange: "maquina-do-bot", id: "b1" }))).toBe('select[data-act-change="maquina-do-bot"][data-id="b1"]');
    expect(seletorDoFocoNaRegiao(el("button", { act: "alternar-modo-dev" }))).toBe('button[data-act="alternar-modo-dev"]');
    expect(seletorDoFocoNaRegiao(el("button", { secao: "maquinas" }))).toBe('button[data-secao="maquinas"]');
    expect(seletorDoFocoNaRegiao(el("input", {}, { type: "radio", name: "uso", value: "sempre" }))).toBe('input[name="uso"][value="sempre"]');
    expect(seletorDoFocoNaRegiao(el("button", { id: "x" }))).toBeNull();
    expect(seletorDoFocoNaRegiao(el("div", {}))).toBeNull();
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const reabrindo = main.slice(main.indexOf("function regiaoReabrindo"), main.indexOf("const CHAVE_CODIGO_MAQUINA"));
    expect(reabrindo).toContain("seletorDoFocoNaRegiao(focado)");
    expect(reabrindo).toMatch(/!focado\.isConnected && seletorFoco/);
  });

  it("se salvar o seletor falha, a região é esquecida (o próximo render volta ao valor salvo); se dá certo, não", async () => {
    const repor = vi.fn();
    await expect(salvarOuRepor(repor, async () => { throw new Error("409"); })()).rejects.toThrow("409");
    expect(repor).toHaveBeenCalledTimes(1);
    await salvarOuRepor(repor, async () => undefined)();
    expect(repor).toHaveBeenCalledTimes(1);
  });

  it("revisão 3: o seletor volta à opção salva (a marcada pelo render), também o da máquina do bot na gaveta", async () => {
    const seletor = { value: "mac-novo", options: [{ value: "", defaultSelected: false }, { value: "mac-salvo", defaultSelected: true }, { value: "mac-novo", defaultSelected: false }] };
    await expect(salvarOuRepor(() => reporSeletor(seletor), async () => { throw new Error("409"); })()).rejects.toThrow();
    expect(seletor.value).toBe("mac-salvo");
    const semMarcada = { value: "mac-novo", options: [{ value: "", defaultSelected: false }, { value: "mac-novo", defaultSelected: false }] };
    reporSeletor(semMarcada);
    expect(semMarcada.value).toBe("");
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main.match(/agir\(salvarOuRepor\(\(\) => reporSeletor\(el\)/g)).toHaveLength(2);
  });

  it("revisão 3: duas linhas com a mesma ação não se confundem (o foco volta ao \"…\" da 2ª máquina, ao 2º experimento)", () => {
    expect(seletorDoFocoNaRegiao(el("button", { act: "maq-menu", maquina: "m2" }))).toBe('button[data-act="maq-menu"][data-maquina="m2"]');
    expect(seletorDoFocoNaRegiao(el("button", { act: "alternar-experimento", experimento: "x2" }))).toBe('button[data-act="alternar-experimento"][data-experimento="x2"]');
    expect(seletorDoFocoNaRegiao(el("input", { manterFoco: "a", act: "b" }))).toBe('input[data-act="b"]');
  });

  it("revisão 3: Esc no \"…\" devolve o foco a quem abriu; o nome da chave à mão atravessa a releitura de Máquinas", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const gatilho = main.slice(main.indexOf("function gatilhoDoDialogo"), main.indexOf("function focarGatilho"));
    expect(gatilho).toContain('if (u.maquinaMenu) return `[data-act="maq-menu"][data-maquina=');
    expect(gatilho).toContain('if (u.menu) return `[data-act="cl-menu"][data-id=');
    const maquinas = readFileSync(new URL("../../../web/telas/maquinas.ts", import.meta.url), "utf8");
    expect(maquinas).toMatch(/data-form="emitir-chave"[^`]*data-manter-foco="emitir-chave-nome"/);
  });

  it("a busca de Agentes não redesenha no meio de uma composição (acento, IME)", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/\[data-config-busca\]"\)\) \{ if \(!\(ev as InputEvent\)\.isComposing\) buscarAgentes/);
    expect(main).toMatch(/addEventListener\("compositionend"[\s\S]{0,200}data-config-busca[\s\S]{0,40}buscarAgentes/);
    // revisão 3: o resultado é dito por um nó vivo fixo, não pelo role=status recriado a cada tecla.
    const html = readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8");
    expect(html).toContain('id="anuncio-config" class="sr-only" role="status" aria-live="polite"');
    // revisão 4: fora da .app (inerte com as Configurações abertas, some da árvore de acessibilidade) e fora do #espaco.
    const corpo = html.slice(html.indexOf("<body>"));
    expect(corpo.indexOf('id="anuncio-config"')).toBeLessThan(corpo.indexOf('<div class="app">'));
    expect(corpo.indexOf('id="anuncio-config"')).toBeGreaterThan(0);
    expect(main).toMatch(/getElementById\("anuncio-config"\)/);
  });
  it("revisão 4: o seletor que salva sozinho não suja a gaveta; o campo de texto suja", () => {
    expect(mudancaSujaAGaveta({ matches: (q: string) => q === "[data-act-change]" })).toBe(false);
    expect(mudancaSujaAGaveta({ matches: () => false })).toBe(true);
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/closest\?\.\("#detalhes"\) && estado\.gaveta && mudancaSujaAGaveta\(ta\)\) gavetaSuja/);
  });

  it("revisão 4: o texto do \"…\" (a leitura que muda a cada 30 s) tem chave estável e o foco volta a ele", () => {
    const html = textoNoMenu("Agora: 12%", "leitura-m1");
    expect(html).toContain('data-menu-texto="leitura-m1"');
    const dataset = { menuTexto: "leitura-m1" };
    expect(seletorDoFocoNaRegiao(el("div", dataset))).toBe('div[data-menu-texto="leitura-m1"]');
  });

  it("QA: a 320px a pilha de Provedores some da aba (as abas cabem em duas linhas)", () => {
    const css = readFileSync(new URL("../../../web/configuracoes.css", import.meta.url), "utf8");
    const celular = css.slice(css.indexOf("/* ---------- Celular ---------- */"));
    expect(celular).toContain(".cfg-espaco .espaco-item > .prov-pilha");
  });

  it("QA: revogar a chave pelo \"…\" devolve o foco ao \"…\" da máquina", () => {
    const maquinas = readFileSync(new URL("../../../web/telas/maquinas.ts", import.meta.url), "utf8");
    expect(maquinas).toContain("dados: { id: chave.id, nome: chave.nome, maquina: m.id }");
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const revogar = main.slice(main.indexOf('"revogar-chave": (el) => {'), main.indexOf('"fechar-chave-emitida"'));
    expect(revogar).toContain('[data-act="maq-menu"][data-maquina=');
    expect(revogar.match(/focarGatilho\(gatilho\)/g)).toHaveLength(2);
  });
});
