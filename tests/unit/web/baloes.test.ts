import { describe, expect, it } from "vitest";
import { BALOES_MAX, dividirEmBaloes, dividirSemMemoria } from "../../../web/lib/baloes.ts";
import { PRAZO_GUARDA, RAZAO_MAXIMA_LINEAR, razaoDeCrescimento } from "../../helpers/crescimento.ts";

/** NOD-358: um balão por parágrafo, sem dividir listas, código nem tabela. */
describe("dividirEmBaloes", () => {
  it("texto vazio não tem balão; sem linha em branco, um balão byte a byte", () => {
    expect(dividirEmBaloes("")).toEqual([]);
    expect(dividirEmBaloes("  \n \n")).toEqual([]);
    const um = "  Oi.\nTudo certo por aqui.\n";
    expect(dividirEmBaloes(um)).toEqual([um]);
  });

  it("cada parágrafo vira um balão", () => {
    expect(dividirEmBaloes("Oi, Mateus.\n\nO PR está aprovado.\n \nFalta só o deploy.")).toEqual(["Oi, Mateus.", "O PR está aprovado.", "Falta só o deploy."]);
  });

  it("linhas em branco no começo ou no fim não criam balão", () => {
    expect(dividirEmBaloes("\n\nOi.\n\nTchau.\n\n")).toEqual(["\n\nOi.", "Tchau."]);
    // Revisão do PR #522: a quebra do fim sai também na fala gravada, como na viva (a troca não ganha uma linha).
    expect(dividirEmBaloes("A.\n\nB.\n")).toEqual(dividirEmBaloes("A.\n\nB.\n", { parcial: true }));
  });

  it("a frase com dois-pontos fica com a lista que ela apresenta (protótipo j3-2)", () => {
    const texto = "Fechei a revisão.\n\nFaltam quatro coisas para sexta:\n\n- deploy\n- teste\n- doc\n- aviso\n\nTe aviso quando sair.";
    expect(dividirEmBaloes(texto)).toEqual(["Fechei a revisão.", "Faltam quatro coisas para sexta:\n\n- deploy\n- teste\n- doc\n- aviso", "Te aviso quando sair."]);
  });

  it("a lista solta (itens separados por linha em branco) e a continuação recuada não se dividem", () => {
    expect(dividirEmBaloes("Antes.\n\n1. um\n\n2. dois\n   com detalhe\n\n   mais detalhe\n\n3. três\n\nDepois.")).toEqual(["Antes.", "1. um\n\n2. dois\n   com detalhe\n\n   mais detalhe\n\n3. três", "Depois."]);
    expect(dividirEmBaloes("- a\n  - sub\n\n- b")).toEqual(["- a\n  - sub\n\n- b"]);
    // Revisão 3 do PR #522: o tab também recua.
    expect(dividirEmBaloes("- a\n\n\t- sub")).toEqual(["- a\n\n\t- sub"]);
    // Revisão 8: a linha só de espaço Unicode é em branco, como no trim(); o balão ao vivo não encolhe.
    expect(dividirEmBaloes("a\n\n\u00A0\n\nb")).toEqual(["a", "b"]);
    expect(dividirEmBaloes("a\n\n\u00A0", { parcial: true })).toEqual(["a"]);
    expect(dividirEmBaloes("a\n\n\u3000\ufeffx", { parcial: true })).toEqual(["a", "\u3000\ufeffx"]);
    // A linha nova solta no fim ao vivo aparece logo (sem esperar o fim do turno).
    expect(dividirEmBaloes("- a\n\n1\nfoo", { parcial: true })).toEqual(["- a", "1\nfoo"]);
    // Um espaço só não é recuo.
    expect(dividirEmBaloes("- a\n\n x")).toEqual(["- a", " x"]);
  });

  it("depois da lista, a prosa vira outro balão", () => {
    expect(dividirEmBaloes("- a\n- b\n\nPronto.")).toEqual(["- a\n- b", "Pronto."]);
  });

  it("a citação continua no mesmo balão", () => {
    expect(dividirEmBaloes("> um\n\n> dois\n\nFim.")).toEqual(["> um\n\n> dois", "Fim."]);
  });

  it("a linha em branco dentro do código não corta; o código pode abrir sem fechar", () => {
    const codigo = "```ts\nconst a = 1;\n\nconst b = 2;\n```";
    expect(dividirEmBaloes(`Veja o trecho.\n\n${codigo}\n\nFeito.`)).toEqual(["Veja o trecho.", codigo, "Feito."]);
    expect(dividirEmBaloes("Olha.\n\n```\nx\n\ny")).toEqual(["Olha.", "```\nx\n\ny"]);
  });

  it("a tabela fica inteira", () => {
    const tabela = "| a | b |\n|---|---|\n| 1 | 2 |";
    expect(dividirEmBaloes(`Os números.\n\n${tabela}\n\nSó isso.`)).toEqual(["Os números.", tabela, "Só isso."]);
  });

  it("o título abre o documento: dali até o fim é um balão só", () => {
    expect(dividirEmBaloes("Segue o relatório.\n\n## Resumo\n\nTudo bem.\n\n## Riscos\n\nNenhum.")).toEqual(["Segue o relatório.", "## Resumo\n\nTudo bem.\n\n## Riscos\n\nNenhum."]);
    expect(dividirEmBaloes("# Título\n\nA.\n\nB.")).toHaveLength(1);
  });

  it("revisão 5 do PR #522: o título é o mesmo do texto formatado", async () => {
    const { TITULO } = await import("../../../web/lib/texto-formatado.ts");
    for (const linha of ["# a", "###### a", "#  ", "#\t\t", "   # a", "#", "#\t", "####### a", "    # a", "#a", "## a ##"]) {
      expect(dividirEmBaloes(`${linha}\n\nA.\n\nB.`).length === 1, linha).toBe(TITULO.test(linha));
    }
  });

  it("o # de um comentário no código não é título", () => {
    expect(dividirEmBaloes("A.\n\n```sh\n# instala\nnpm i\n```\n\nB.")).toHaveLength(3);
  });

  it(`no máximo ${BALOES_MAX} balões; o resto fica no último`, () => {
    const paragrafos = Array.from({ length: 8 }, (_, i) => `P${i}.`);
    const baloes = dividirEmBaloes(paragrafos.join("\n\n"));
    expect(baloes).toHaveLength(BALOES_MAX);
    expect(baloes.at(-1)).toBe("P4.\n\nP5.\n\nP6.\n\nP7.");
  });

  it("revisão do PR #522: a frase em negrito com dois-pontos também apresenta a lista", () => {
    expect(dividirEmBaloes("Fechei.\n\n**Próximos passos:**\n\n- a\n- b")).toEqual(["Fechei.", "**Próximos passos:**\n\n- a\n- b"]);
    expect(dividirEmBaloes("_Veja:_\n\n1. um")).toHaveLength(1);
    expect(dividirEmBaloes("Faltam isto: 👇\n\n- a")).toHaveLength(1);
    // Revisão 5: o emoji com ZWJ também.
    expect(dividirEmBaloes("Etapas: 🧑‍💻\n\n- a\n- b")).toHaveLength(1);
  });

  it("revisão do PR #522: o passo a passo com código entre os itens fica num balão", () => {
    const passos = "1. Instale:\n\n```bash\nnpm i\n```\n\n2. Rode:\n\n```bash\nnpm start\n```\n\n3. Abra o navegador.";
    expect(dividirEmBaloes(`Para subir:\n\n${passos}\n\nQualquer coisa, me chama.`)).toEqual([`Para subir:\n\n${passos}`, "Qualquer coisa, me chama."]);
    // Revisão 4: o item sem ":" seguido de código também é passo a passo.
    const semDoisPontos = "1. Instale as dependências\n\n```bash\nnpm i\n```\n\n2. Rode os testes\n\n```bash\nnpm test\n```";
    expect(dividirEmBaloes(`Para rodar:\n\n${semDoisPontos}\n\nPronto.`)).toEqual([`Para rodar:\n\n${semDoisPontos}`, "Pronto."]);
    // Sem lista antes, o código entre parágrafos continua o seu balão.
    expect(dividirEmBaloes("Veja.\n\n```\nx\n```\n\n- a")).toHaveLength(3);
  });

  it("revisão do PR #522: CRLF também separa e sai como LF, ao vivo e no final", () => {
    expect(dividirEmBaloes("Um.\r\n\r\nDois.")).toEqual(["Um.", "Dois."]);
    expect(dividirEmBaloes("- a\r\n\r\n- b")).toEqual(["- a\n\n- b"]);
    expect(dividirEmBaloes("Um.\r\nDois.")).toEqual(["Um.\nDois."]);
    expect(dividirEmBaloes("Um.\r\nDo", { parcial: true })).toEqual(["Um.\nDo"]);
  });

  it("revisão do PR #522: CRLF ao vivo, o \\r do fim não aparece (e não some depois)", () => {
    expect(dividirEmBaloes("A.\r\n\r", { parcial: true })).toEqual(["A."]);
    expect(dividirEmBaloes("A.\r", { parcial: true })).toEqual(["A."]);
    // Revisão 3: o "\r" solto também é quebra (a lista não se divide por ele).
    expect(dividirEmBaloes("- a\r\n\r\n- b\r")).toEqual(["- a\n\n- b"]);
  });

  it("revisão 2 do PR #522: a memória separa o modo ao vivo do final (o mesmo texto, nas duas ordens)", () => {
    expect(dividirEmBaloes("- x\n\n-", { parcial: true })).toEqual(["- x"]);
    expect(dividirEmBaloes("- x\n\n-")).toEqual(["- x", "-"]);
    expect(dividirEmBaloes("- y\n\n-")).toEqual(["- y", "-"]);
    expect(dividirEmBaloes("- y\n\n-", { parcial: true })).toEqual(["- y"]);
  });

  it("revisão do PR #522: lista solta e parágrafos crescem em tempo linear", PRAZO_GUARDA, () => {
    const lista = (n: number) => `Itens:\n\n${Array.from({ length: Math.ceil(n / 12) }, (_, i) => `- item ${i}`).join("\n\n")}\n\nFim.`;
    expect(razaoDeCrescimento(lista, (t) => dividirSemMemoria(t), 4000)).toBeLessThan(RAZAO_MAXIMA_LINEAR);
    const passos = (n: number) => `Passos:\n\n${Array.from({ length: Math.ceil(n / 30) }, (_, i) => `${i + 1}. Rode:\n\n\`\`\`\nx\n\`\`\``).join("\n\n")}`;
    expect(razaoDeCrescimento(passos, (t) => dividirSemMemoria(t, { parcial: true }), 4000)).toBeLessThan(RAZAO_MAXIMA_LINEAR);
    // Revisão 4: as continuações recuadas separadas por linha em branco (o neto com 4 espaços) não relêem o balão a
    // cada corte. medido em 2026-10-26: razão ~17 com a releitura (o mutante), abaixo do teto com o bloco a bloco.
    const netos = (n: number) => `- A\n  - B\n\n${Array.from({ length: Math.ceil(n / 14) }, (_, i) => `    - neto ${i}`).join("\n\n")}`;
    expect(razaoDeCrescimento(netos, (t) => dividirSemMemoria(t), 4000)).toBeLessThan(RAZAO_MAXIMA_LINEAR);
    // Revisão 5: o ":" e o "#" seguidos de milhares de espaços. medido em 2026-10-26: razão ~16 com as regex inteiras.
    const espacos = (n: number) => `Oi.\n\nVeja:${" \t".repeat(n / 2)}x\n\n# a${" ".repeat(n / 2)}b\n\nFim.`;
    expect(razaoDeCrescimento(espacos, (t) => dividirSemMemoria(t), 4000)).toBeLessThan(RAZAO_MAXIMA_LINEAR);
    // Revisão 6: milhares de quebras num código aberto (ao vivo) e no último balão (gravada). medido em 2026-10-26: razão
    // ~13,8 com o regex de aparar.
    const quebras = (n: number) => `Oi.\n\n\`\`\`\n${"\n".repeat(n)}x`;
    expect(razaoDeCrescimento(quebras, (t) => dividirSemMemoria(t, { parcial: true }), 4000)).toBeLessThan(RAZAO_MAXIMA_LINEAR);
    // Revisão 7: espaços com um NBSP no começo do bloco depois da lista, e o começo só de NBSP e linhas em branco.
    // medido em 2026-10-26: 47 → 2958 ms de 5 para 40 mil espaços com as varreduras antigas.
    const nbsp = (n: number) => `- a\n\n${" ".repeat(n)}\u00A0\nB`;
    expect(razaoDeCrescimento(nbsp, (t) => dividirSemMemoria(t), 4000)).toBeLessThan(RAZAO_MAXIMA_LINEAR);
    const comeco = (n: number) => `${"\u00A0\n\n".repeat(Math.ceil(n / 3))}x\n\ny`;
    expect(razaoDeCrescimento(comeco, (t) => dividirSemMemoria(t), 4000)).toBeLessThan(RAZAO_MAXIMA_LINEAR);
    const brancas = (n: number) => `A\n\nB\n\nC\n\nD\n\nE\n\n${"\n \n".repeat(Math.ceil(n / 3))}F`;
    expect(razaoDeCrescimento(brancas, (t) => dividirSemMemoria(t), 4000)).toBeLessThan(RAZAO_MAXIMA_LINEAR);
  });

  it("juntar os balões com linha em branco devolve o texto", () => {
    const texto = "A.\n\nB:\n\n- x\n\n- y\n\nC.";
    expect(dividirEmBaloes(texto).join("\n\n")).toBe(texto);
  });
});

/** Fala viva: com o texto chegando, os balões só crescem — o anterior nunca muda e nada se junta de volta. */
describe("dividirEmBaloes parcial", () => {
  const textos = [
    "Fechei a revisão.\n\nFaltam quatro coisas para sexta:\n\n- deploy\n- teste\n\nTe aviso.",
    "Lista:\n\n1. um\n\n2. dois\n\n10. dez\n\nFim do texto.",
    "- a\n- b\n\n- c\n\nE depois.\n\n1.5 milhão de linhas.",
    "Olha.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nFeito.",
    "> cita\n\n> mais\n\nOk.\n\n## Resumo\n\nTudo.\n\nCerto.",
    Array.from({ length: 7 }, (_, i) => `Parágrafo ${i}.`).join("\n\n"),
    "- item\n  continua\n\n  mais\n\n-- não é item\n\nfim",
    "Rodar:\n\n1. Instale\n\n```bash\nnpm i\n```\n\n2. Rode\n\n```\nx\n```\n\nPronto.",
    "- a\n  - b\n\n    - c\n\n    - d\n\nFim.",
    "Para subir:\n\n1. Instale:\n\n```bash\nnpm i\n```\n\n2. Rode:\n\n```\nx\n```\n\nPronto.\n\n**Passos:**\n\n- a",
  ];
  it.each(textos.map((t, i) => [i, t] as const))("texto %i: todo prefixo é monótono", (_, texto) => {
    const final = dividirEmBaloes(texto);
    let antes: string[] = [];
    for (let n = 1; n <= texto.length; n++) {
      const agora = dividirEmBaloes(texto.slice(0, n), { parcial: true });
      expect(agora.length).toBeGreaterThanOrEqual(antes.length);
      expect(agora.length).toBeLessThanOrEqual(final.length);
      // Os balões fechados não mudam; o último só cresce.
      agora.forEach((balao, i) => {
        if (i < agora.length - 1) expect(balao).toBe(final[i]);
        else expect((final[i] ?? "").startsWith(balao)).toBe(true);
      });
      antes.forEach((balao, i) => expect((agora[i] ?? "").startsWith(balao)).toBe(true));
      antes = agora;
    }
    expect(dividirEmBaloes(texto, { parcial: true })).toEqual(final);
  });

  it("o começo de item depois da lista espera decidir", () => {
    expect(dividirEmBaloes("- a\n\n1", { parcial: true })).toEqual(["- a"]);
    expect(dividirEmBaloes("- a\n\n- b", { parcial: true })).toEqual(["- a\n\n- b"]);
    expect(dividirEmBaloes("- a\n\nE", { parcial: true })).toEqual(["- a", "E"]);
    expect(dividirEmBaloes("Oi.\n\n`", { parcial: true })).toEqual(["Oi."]);
  });
});
