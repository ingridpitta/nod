import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Design system do Nod (definido em 2026-10-04): a cor da web mora em web/tokens.css e o resto usa var(--…). Antes
 * desta regra os três CSS juntavam ~700 literais — uns 30 cinzas quase iguais e três azuis sem papel — e não havia
 * modo escuro possível. Este teste é o que impede a volta: uma cor nova entra como token, ou numa linha marcada com
 * "cor-fixa: <motivo>" quando for de propósito igual nos dois temas.
 */
const RAIZ = new URL("../../../web/", import.meta.url);
const CSS = ["estilos.css", "interface.css", "navegacao.css", "ligacao.css", "onboarding.css", "computador-do-bot.css", "conta.css", "configuracoes.css", "agentes-lote.css", "quadro.css", "quadro-celular.css", "mobile.css", "celular-base.css", "tab-bar-celular.css"] as const;
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;
const ler = (nome: string): string => readFileSync(new URL(nome, RAIZ), "utf8");

describe("cores só por token", () => {
  for (const nome of CSS) {
    it(`${nome} não tem cor literal fora de linha marcada com cor-fixa`, () => {
      const soltas = ler(nome)
        .split("\n")
        .map((linha, i) => ({ linha, n: i + 1 }))
        .filter(({ linha }) => LITERAL.test(linha) && !linha.includes("cor-fixa:"))
        .map(({ linha, n }) => `${nome}:${n} ${linha.trim().slice(0, 120)}`);
      expect(soltas).toEqual([]);
    });
  }

  it("todo var(--…) usado nos CSS existe em tokens.css ou é declarado no próprio CSS", () => {
    const tokens = ler("tokens.css");
    const todos = CSS.map(ler).join("\n");
    const declarados = new Set([...`${tokens}\n${todos}`.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    // Variáveis que o TS escreve no elemento (style="--x: …") ou que têm fallback no próprio var().
    // NOD-323: as medidas da mídia do bot (web/lib/midia.ts) e o progresso da trilha (midia-dom.ts).
    const doTs = new Set(["--nod-aviso", "--ms-segurar", "--x", "--altura-visivel", "--topo-visivel", "--w", "--ar", "--k", "--soma", "--n", "--r", "--p", "--qc-faixa-alto"]);
    // ADA-6: a altura da faixa do quadro (quadro-na-tela.ts, medirFaixa).
    const usados = [...todos.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
    const faltam = [...new Set(usados)].filter((v) => v !== undefined && !declarados.has(v) && !doTs.has(v));
    expect(faltam).toEqual([]);
  });

  const mapa = (texto: string): Record<string, string> => Object.fromEntries([...texto.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]));
  const blocoDe = (texto: string, inicio: string): string => {
    const i = texto.indexOf(inicio);
    expect(i).toBeGreaterThan(-1);
    return texto.slice(i, texto.indexOf("}", i));
  };

  it("os dois blocos do escuro (sistema e escolha manual) têm exatamente os mesmos valores", () => {
    const tokens = ler("tokens.css");
    expect(mapa(blocoDe(tokens, ':root:not([data-theme="light"])'))).toEqual(mapa(blocoDe(tokens, ':root[data-theme="dark"]')));
  });

  it("a cópia em desktop/setup.css (tela de conexão do Mac) tem os mesmos valores de tokens.css", () => {
    const tokens = ler("tokens.css");
    const setup = readFileSync(new URL("../../../desktop/setup.css", import.meta.url), "utf8");
    const claro = mapa(blocoDe(tokens, ":root {"));
    const escuro = mapa(blocoDe(tokens, ':root[data-theme="dark"]'));
    const setupClaro = mapa(blocoDe(setup, ":root{"));
    const setupEscuro = mapa(blocoDe(setup, "@media (prefers-color-scheme:dark){:root{"));
    for (const [nome, valor] of Object.entries(setupClaro)) expect(`${nome} ${valor}`).toBe(`${nome} ${claro[nome]}`);
    for (const [nome, valor] of Object.entries(setupEscuro)) expect(`${nome} ${valor}`).toBe(`${nome} ${escuro[nome]}`);
  });

  it("os tokens de cor do tema claro são todos redefinidos nos dois blocos do escuro", () => {
    const tokens = ler("tokens.css");
    const bloco = (inicio: string): string => {
      const i = tokens.indexOf(inicio);
      return tokens.slice(i, tokens.indexOf("}", i));
    };
    const nomes = (texto: string): string[] => [...texto.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] ?? "");
    // --balao-* (NOD-431) são calculados de --agent-* e só mudam no escuro onde o cálculo muda (creme); o teste
    // tests/unit/domain/contraste-do-balao.test.ts confere os dois temas.
    // --cel-* (ADA-2, ADR-148) são medidas do celular (alvo, campo, corpo), não cor: iguais nos dois temas.
    const fixos = /^--(agent-|font-|balao-|cel-)/;
    const claro = nomes(bloco(":root {")).filter((n) => !fixos.test(n) && n !== "--focus-ring");
    for (const escuro of [bloco(':root:not([data-theme="light"])'), bloco(':root[data-theme="dark"]')]) {
      expect(claro.filter((n) => !nomes(escuro).includes(n))).toEqual([]);
    }
  });
});
