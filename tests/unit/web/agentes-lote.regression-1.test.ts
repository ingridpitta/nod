import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { LOTE_INICIAL } from "../../../web/lib/lote-agentes.ts";
import { barraDoLote, htmlDaPrevia, topoDaSelecao } from "../../../web/telas/agentes-lote.ts";

/**
 * NOD-368, QA: a barra e o topo do lote só podem herdar o estilo de agentes-lote.css.
 * Achado no navegador: `.lote-acoes` já existia em interface.css (o card de aprovação em lote, card-lote.ts) com
 * `flex-direction: column` e `border-top`, e empilhava "Mudar máquina" e "Mudar IA" na barra, no computador e no celular;
 * o protótipo (NOD-367 j5-6/j5-7, NOD-368) põe os dois lado a lado.
 */
const WEB = new URL("../../../web/", import.meta.url);
const css = (nome: string) => readFileSync(new URL(nome, WEB), "utf8");
const classes = (html: string) => new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/)).filter((c) => c.startsWith("lote-")));

const bot = (id: string, nome: string) => ({ id, nome, titulo: "Dev", ownerId: "p", cor: "c-red", forma: "shape-square", conversaId: `c-${id}`, maquinaId: null, excluidoEm: null, oculto: false });
const estado = (): Estado => ({
  ...estadoInicial,
  sessao: { tenantId: "t", pessoaId: "p" },
  gestao: { agentes: [bot("ada", "Ada"), bot("gil", "Gil")] } as never,
  configUi: { ...estadoInicial.configUi, lote: { ...LOTE_INICIAL, selecionando: true, selecionados: ["ada", "gil"] } },
});

describe("NOD-368 QA · regressão 1: o estilo da barra e do topo", () => {
  it("nenhuma classe da barra ou do topo é estilizada por outra folha de estilo", () => {
    const html = barraDoLote(estado(), estado().gestao!.agentes as never) + topoDaSelecao(estado().configUi.lote, ["ada", "gil"]);
    const outras = readdirSync(WEB).filter((f) => f.endsWith(".css") && f !== "agentes-lote.css");
    // Fora de agentes-lote.css, só vale o encaixe na grade da própria linha do lote (configuracoes.css, `.lote-linha .lote-cb`).
    const seletores = new Map(outras.map((f) => [f, [...css(f).matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => s.includes(".lote-") && !s.includes(".lote-linha"))]));
    const colisoes = [...classes(html)].flatMap((c) => outras.filter((f) => seletores.get(f)!.some((s) => new RegExp(`\\.${c}(?![\\w-])`).test(s))).map((f) => `${c} em ${f}`));
    expect(colisoes).toEqual([]);
  });

  it("Selecionar todos põe a caixa e o texto na mesma linha (não a grade de uma célula da caixa das linhas)", () => {
    const base = css("agentes-lote.css").split("@media")[0]!;
    const regra = /\.lote-todos\s*\{([^}]*)\}/.exec(base)?.[1] ?? "";
    expect(regra).toMatch(/display:\s*inline-flex/);
    expect(regra).toMatch(/align-items:\s*center/);
  });

  it("o texto da prévia, que o leitor de tela anuncia (textContent), separa as frases", () => {
    const bots = [{ id: "ada", nome: "Ada", valor: "claude-cli", ocupado: true }, { id: "gil", nome: "Gil", valor: "codex-cli", ocupado: false }];
    const { html } = htmlDaPrevia(estado(), { tipo: "ia", destino: "auto" }, bots);
    const texto = html.replace(/<[^>]+>/g, "");
    expect(texto).not.toMatch(/\.\S/);
    expect(texto).toContain("Automático. Ada está no meio");
  });
});
