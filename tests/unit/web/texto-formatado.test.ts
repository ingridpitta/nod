import { describe, expect, it } from "vitest";
import { soLinks, tabelaComo, textoFormatado } from "../../../web/lib/texto-formatado.ts";

/** NOD-45: o card do bloco de código. `codigo` já vem escapado; o Copiar só aparece com a cerca fechada. */
const COPIAR = '<button type="button" data-act="copiar-codigo" aria-label="Copiar código" aria-live="polite"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg><span class="md-codigo-estado">Copiar</span></button>';
const card = (codigo: string, linguagem = "", fechado = true): string =>
  `<div class="md-codigo"><div class="md-codigo-topo">${linguagem ? `<span class="md-codigo-ling">${linguagem}</span>` : ""}${fechado ? COPIAR : ""}</div><pre><code>${codigo}</code></pre></div>`;

describe("texto do modelo na conversa", () => {
  it("mostra ênfase e quebras sem transformar HTML ou URLs em elementos ativos", () => {
    expect(textoFormatado('**Dica:** use *clareza*\n<script>alert(1)</script> [abrir](javascript:alert(1))')).toBe('<strong>Dica:</strong> use <em>clareza</em><br>&lt;script&gt;alert(1)&lt;/script&gt; [abrir](javascript:alert(1))');
  });
  it("preserva código e escapa conteúdo em blocos e trechos inline", () => {
    expect(textoFormatado('```html\n<img onerror="alert(1)">\n```\n`**literal**`')).toBe(`${card("&lt;img onerror=&quot;alert(1)&quot;&gt;", "html")}<br><code>**literal**</code>`);
  });
});

/** ADR-053, conforme o canvas "Links nas mensagens". */
describe("links no texto do bot", () => {
  it("URL solta vira o chip, que abre fora e sem contar de onde veio", () => {
    const html = textoFormatado("Os planos estão em https://zoom.us/pricing.");
    expect(html).toContain('<a class="lk-chip" href="https://zoom.us/pricing" data-lk target="_blank" rel="noopener noreferrer nofollow">');
    expect(html).toContain('<span class="lk-rotulo">zoom.us/pricing</span></a>.');
  });

  it("parêntese e ponto final ficam fora do link", () => {
    expect(textoFormatado("(veja https://zoom.us/pricing).")).toMatch(/^\(veja <a [^>]+href="https:\/\/zoom\.us\/pricing"[^>]*>.*<\/a>\)\.$/);
  });

  it("[nome](link) fica na frase; dentro de negrito também", () => {
    expect(textoFormatado("Comece pelo [PR #481](https://github.com/acme-edtech/acme/pull/481).")).toContain('>PR #481</a>.');
    expect(textoFormatado("**veja https://zoom.us/pricing**")).toMatch(/^<strong>veja <a class="lk-chip"[^>]*>.*<\/a><\/strong>$/);
  });

  it("URL dentro de código continua código", () => {
    expect(textoFormatado("rode `curl https://zoom.us/pricing`")).toBe("rode <code>curl https://zoom.us/pricing</code>");
  });

  it("endereço entre < > vira chip sem os sinais", () => {
    expect(textoFormatado("<https://zoom.us/pricing>")).toMatch(/^<a class="lk-chip"[^>]*>.*<\/a>$/);
  });
});

/** ADR-053, conforme o canvas "Tabelas nas mensagens". */
describe("tabelas no texto do bot", () => {
  const tabela = [
    "**Mais recentes**",
    "| PR | Título | Data |",
    "|---|---|---|",
    "| #481 | fix(coletas): barra contrato vencido | 28/09 |",
    "| #480 | Tarefa: criar uma página de dados… | 28/09 |",
    "",
    "**Antigos**",
  ].join("\n");

  it("cabeçalho e linha |---| viram tabela; o texto em volta segue como antes", () => {
    const html = textoFormatado(tabela);
    expect(html.startsWith("<strong>Mais recentes</strong>")).toBe(true);
    expect(html).toContain('<div class="md-tabela"><div class="md-tabela-rolagem"><table><thead><tr><th class="curta">PR</th><th class="curta">Título</th><th class="curta">Data</th></tr></thead>');
    expect(html).toContain('<tr><td class="curta">#481</td><td>fix(coletas): barra contrato vencido</td><td class="curta">28/09</td></tr>');
    expect(html).not.toContain("|---|");
    expect(html.endsWith("<br><strong>Antigos</strong>")).toBe(true);
  });

  it("os dois-pontos alinham a coluna", () => {
    const html = textoFormatado("| Pacote | De | Para |\n|---|--:|:-:|\n| vitest | 2 | 4 |");
    expect(html).toContain('<td class="al-direita curta">2</td><td class="al-centro curta">4</td>');
  });

  it("negrito, código e link funcionam na célula; HTML não", () => {
    const html = textoFormatado("| PR | Por quê | Link |\n|---|---|---|\n| **#417** | IDOR em `tenants` <b>x</b> | [abrir](https://github.com/acme-edtech/acme/pull/417) |");
    expect(html).toContain("<td class=\"curta\"><strong>#417</strong></td>");
    expect(html).toContain("<code>tenants</code> &lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain('href="https://github.com/acme-edtech/acme/pull/417"');
  });

  it("linha torta não quebra a tabela; \\| é barra dentro da célula", () => {
    const html = textoFormatado("| PR | Título | Data |\n|---|---|---|\n| #480 | a \\| b |");
    expect(html).toContain('<td class="curta">#480</td><td class="curta">a | b</td><td class="curta"></td>');
  });

  it("sem a linha |---| não é tabela", () => {
    expect(textoFormatado("| PR | Título |\n| #481 | fix |")).toBe("| PR | Título |<br>| #481 | fix |");
  });

  it("tabela dentro de bloco de código continua código", () => {
    expect(textoFormatado("```\n| a | b |\n|---|---|\n```")).toBe(card("| a | b |\n|---|---|"));
  });

  it("mais de 10 linhas: 8 à vista e \"mostrar mais\", que sobrevive ao re-render pela chave", () => {
    const linhas = Array.from({ length: 12 }, (_, i) => `| #${400 + i} | x |`);
    const html = textoFormatado(["| PR | Grupo |", "|---|---|", ...linhas].join("\n"), { chave: "m1" });
    expect(html.match(/<tr class="md-extra">/g)).toHaveLength(4);
    expect(html).toContain('<details class="md-tabela-mais" data-disclosure="tabela:m1:0"><summary><span class="md-mais">Mostrar as outras 4 linhas</span>');
    const dez = textoFormatado(["| PR | Grupo |", "|---|---|", ...linhas.slice(0, 10)].join("\n"));
    expect(dez).not.toContain("md-tabela-mais");
  });

  const dadosDaTabela = (html: string): string[][] => JSON.parse(html.match(/data-tabela="([^"]*)"/)![1]!.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")) as string[][];

  it("Copiar como Planilha leva colunas separadas por tabulação, com o que a pessoa lê", () => {
    const html = textoFormatado("| PR | Link |\n|---|---|\n| **#417** | [abrir](https://github.com/x/y/pull/417) |\n| `#418` | https://zoom.us/pricing |");
    expect(tabelaComo("tsv", dadosDaTabela(html))).toBe("PR\tLink\n#417\tabrir\n#418\thttps://zoom.us/pricing");
  });

  it("rodapé da tabela: quantas linhas e colunas e Copiar como Planilha · CSV · JSON (2026-10-03)", () => {
    const html = textoFormatado("| Região | Receita |\n|---|--:|\n| Sul | R$ 98 mil |\n| Norte, Nordeste | R$ \"132\" mil |");
    expect(html).toContain('<div class="md-tabela-rodape"><span>2 linhas · 2 colunas</span>');
    expect(html.match(/data-act="copiar-tabela"/g)).toHaveLength(3);
    expect(html).toContain('data-formato="csv"');
    expect(html).not.toContain("md-tabela-copiar");
    const dados = dadosDaTabela(html);
    expect(tabelaComo("csv", dados)).toBe('Região,Receita\nSul,R$ 98 mil\n"Norte, Nordeste","R$ ""132"" mil"');
    expect(JSON.parse(tabelaComo("json", dados))).toEqual([{ Região: "Sul", Receita: "R$ 98 mil" }, { Região: "Norte, Nordeste", Receita: 'R$ "132" mil' }]);
  });
});

describe("listas e títulos no texto do bot (2026-10-03)", () => {
  it("'-' e '1.' viram lista; '##' vira título; o texto em volta vira parágrafo sem <br> sobrando", () => {
    const html = textoFormatado("## Resumo\nFechei setembro:\n\n- receita **R$ 482 mil**\n- 12% acima de agosto\n\n1. Sul\n2. Norte\n\nPosso mandar?");
    expect(html).toBe('<p class="md-titulo">Resumo</p><p class="md-paragrafo">Fechei setembro:</p><ul class="md-lista"><li>receita <strong>R$ 482 mil</strong></li><li>12% acima de agosto</li></ul><ol class="md-lista"><li>Sul</li><li>Norte</li></ol><p class="md-paragrafo">Posso mandar?</p>');
  });

  it("lista numerada guarda o número de início; linha recuada continua o item", () => {
    expect(textoFormatado("3. terceiro\n   continua\n4. quarto")).toBe('<ol class="md-lista" start="3"><li>terceiro continua</li><li>quarto</li></ol>');
  });

  it("sem lista nem título, o texto sai exatamente como antes", () => {
    expect(textoFormatado("um *dois*\n\ntrês")).toBe("um <em>dois</em><br><br>três");
  });

  it("*itálico* no começo da linha não vira lista; HTML continua texto dentro do item", () => {
    expect(textoFormatado("*ênfase* aqui")).toBe("<em>ênfase</em> aqui");
    expect(textoFormatado("- <b>x</b>")).toBe('<ul class="md-lista"><li>&lt;b&gt;x&lt;/b&gt;</li></ul>');
  });
});

describe("soLinks: a linha 'agora' do cartão de atividade (2026-10-03)", () => {
  it("o link vira chip e o resto continua texto escapado", () => {
    const html = soLinks("Lendo <os> arquivos de https://github.com/acme/loja/pull/481.");
    expect(html.startsWith("Lendo &lt;os&gt; arquivos de ")).toBe(true);
    expect(html).toContain('href="https://github.com/acme/loja/pull/481"');
    expect(html.endsWith(".")).toBe(true);
  });
});

/** NOD-201: bloco certo durante o streaming e sem a linha da linguagem. */
describe("bloco de código aberto e linha da linguagem (NOD-201)", () => {
  const bloco = (html: string): string[] => html.match(/<pre><code>[\s\S]*?<\/code><\/pre>/g) ?? [];

  it("cerca aberta até o fim vira código: nada dentro vira lista, tabela ou negrito; o texto antes segue igual", () => {
    const html = textoFormatado("antes\n```ts\n- a\n| x | y |\n|---|---|\n**b**");
    expect(html).toContain(card("- a\n| x | y |\n|---|---|\n**b**", "ts", false));
    for (const proibido of ["<ul>", "<li>", "md-tabela", "<strong>"]) expect(html).not.toContain(proibido);
    expect(html).toBe(`${textoFormatado("antes\n")}${card("- a\n| x | y |\n|---|---|\n**b**", "ts", false)}`);
    expect(html).not.toContain("copiar-codigo");
  });

  // NOD-45: a última quebra sai nos dois modos, e o card só ganha o Copiar quando a cerca fecha.
  it("sem salto: o bloco aberto e o mesmo bloco fechado têm o mesmo <pre><code>; o fechado só ganha o Copiar", () => {
    const aberto = textoFormatado("x\n```ts\nconst a = 1\n");
    const fechado = textoFormatado("x\n```ts\nconst a = 1\n```");
    expect(bloco(aberto)).toEqual(["<pre><code>const a = 1</code></pre>"]);
    expect(bloco(aberto)).toEqual(bloco(fechado));
    expect(aberto).not.toContain("copiar-codigo");
    expect(fechado.replace(COPIAR, "")).toBe(aberto);
  });

  it("segurança: HTML na cerca aberta sai escapado", () => {
    const html = textoFormatado("```\n<img src=x onerror=alert(1)>");
    expect(html).toBe(card("&lt;img src=x onerror=alert(1)&gt;", "", false));
    expect(html).not.toContain("<img");
  });

  it("dois blocos: o primeiro fechado, o meio formatado e o segundo aberto como código", () => {
    expect(textoFormatado("```\na\n```\nmeio **m**\n```\nb")).toBe(`${card("a")}<br>meio <strong>m</strong><br>${card("b", "", false)}`);
  });

  it("linguagem com +, - e #: a linha sai do código; primeira linha que não é linguagem fica (escapada)", () => {
    expect(textoFormatado("```c++\nint x;\n```")).toBe(card("int x;", "c++"));
    expect(textoFormatado("```objective-c\n@interface A\n```")).toBe(card("@interface A", "objective-c"));
    expect(textoFormatado("```shell-session\n$ ls\n```")).toBe(card("$ ls", "shell-session"));
    expect(textoFormatado("```c#\nvar a;\n```")).toBe(card("var a;", "c#"));
    const html = textoFormatado("```\"><img src=x>\nx\n```");
    expect(html).toBe(card("&quot;&gt;&lt;img src=x&gt;\nx"));
    expect(html).not.toContain("<img");
  });

  it("cerca recém-aberta só com a linguagem, sem \\n: o corpo sai vazio, sem a palavra piscar", () => {
    expect(textoFormatado("```ts")).toBe(card("", "", false));
    expect(textoFormatado("x\n```ty")).toBe(`x<br>${card("", "", false)}`);
    expect(textoFormatado("x\n```")).toBe(`x<br>${card("", "", false)}`);
  });

  it("primeira linha com espaço não é linguagem e continua dentro do código", () => {
    expect(textoFormatado("```não é linguagem\nx\n```")).toBe(card("não é linguagem\nx"));
  });

  it("crases dentro do bloco aberto ficam literais", () => {
    expect(textoFormatado("```\nuse `x` e *y*")).toBe(card("use `x` e *y*", "", false));
  });

  it("texto sem cerca sai idêntico ao de antes (esperado gerado com o formatar da main 43a4b3b)", () => {
    expect(textoFormatado("um *dois*\n\ntrês")).toBe("um <em>dois</em><br><br>três");
    expect(textoFormatado("## Resumo\n- a\n- b")).toBe('<p class="md-titulo">Resumo</p><ul class="md-lista"><li>a</li><li>b</li></ul>');
    expect(textoFormatado("| a | b |\n|---|---|\n| 1 | 2 |")).toMatch(/^<div class="md-tabela"><div class="md-tabela-rolagem"><table><thead><tr><th class="curta">a<\/th>/);
    expect(textoFormatado("use `x` aqui")).toBe("use <code>x</code> aqui");
    expect(textoFormatado("dois `` crases")).toBe("dois `` crases");
  });

  it("cerca de fechamento partida (1 ou 2 crases no fim) não pisca dentro do código", () => {
    expect(textoFormatado("```ts\nconst a = 1\n`")).toBe(card("const a = 1", "ts", false));
    expect(textoFormatado("```ts\nconst a = 1\n``")).toBe(card("const a = 1", "ts", false));
    expect(textoFormatado("```\nuse `x`")).toBe(card("use `x`", "", false));
  });

  // NOD-204: o mesmo teste roda também com aoVivo (o esperado da versão normal não muda).
  it.each([false, true])("streaming caractere a caractere: o código de cada quadro é prefixo do código final (aoVivo: %s)", (aoVivo) => {
    const final = "Segue:\n```ts\n- a\n- b\n| x | y |\n|---|---|\n**n**\nconst a: number = 1;\n```\nPronto, **ok**.";
    const codigoDe = (texto: string): string | undefined => /<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(textoFormatado(texto, { aoVivo }))?.[1];
    const doFinal = codigoDe(final) ?? "";
    expect(doFinal).toBe("- a\n- b\n| x | y |\n|---|---|\n**n**\nconst a: number = 1;");
    for (let i = final.indexOf("```") + 3; i <= final.length; i++) {
      const quadro = final.slice(0, i);
      expect(doFinal.startsWith(codigoDe(quadro) ?? "∅"), JSON.stringify(quadro)).toBe(true);
    }
  });
});

/** NOD-204: ao vivo, a cerca partida (colada no código ou ainda abrindo) não aparece por um quadro. */
describe("cerca partida só ao vivo (NOD-204)", () => {
  const vivo = (texto: string): string => textoFormatado(texto, { aoVivo: true });

  it("A e B: bloco aberto com 1 ou 2 crases coladas no código, ao vivo, não as mostra", () => {
    expect(vivo("```ts\nfoo()`")).toBe(card("foo()", "ts", false));
    expect(vivo("```ts\nfoo()``")).toBe(card("foo()", "ts", false));
  });

  it("C e D: prosa terminando em começo de linha + 1 ou 2 crases, ao vivo, não as mostra", () => {
    expect(vivo("Segue:\n`")).toBe("Segue:<br>");
    expect(vivo("Segue:\n``")).toBe("Segue:<br>");
  });

  it("E e F: sem aoVivo, igual à main 2f05de3", () => {
    expect(textoFormatado("```ts\nfoo()`")).toBe(card("foo()`", "ts", false));
    expect(textoFormatado("```ts\nfoo()``")).toBe(card("foo()``", "ts", false));
    expect(textoFormatado("Segue:\n`")).toBe("Segue:<br>`");
    expect(textoFormatado("Segue:\n``")).toBe("Segue:<br>``");
    expect(textoFormatado("```ts\nfoo()`", { aoVivo: false })).toBe(card("foo()`", "ts", false));
    expect(textoFormatado("Segue:\n`", { aoVivo: false })).toBe("Segue:<br>`");
  });

  it("G: streaming caractere a caractere, ao vivo: nenhum quadro tem crase e o código de cada quadro é prefixo do final", () => {
    const final = "Segue:\n```ts\nconst a = 1;\nfoo()```\nPronto.";
    const codigoDe = (html: string): string | undefined => /<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(html)?.[1];
    const htmlFinal = vivo(final);
    expect(htmlFinal).not.toContain("`");
    expect(htmlFinal).toBe(textoFormatado(final));
    const doFinal = codigoDe(htmlFinal) ?? "";
    expect(doFinal).toBe("const a = 1;\nfoo()");
    for (let i = 1; i <= final.length; i++) {
      const quadro = final.slice(0, i);
      const html = vivo(quadro);
      expect(html, JSON.stringify(quadro)).not.toContain("`");
      const codigo = codigoDe(html);
      if (codigo !== undefined) expect(doFinal.startsWith(codigo), JSON.stringify(quadro)).toBe(true);
    }
  });

  // QA da NOD-204: a cerca dentro de item de lista vem indentada ("1. Instale:\n   ```bash") e a crase aparecia por
  // um quadro ("<li>Instale: `</li>") antes da terceira chegar.
  it.each([
    ["lista numerada, 3 espaços", "1. Instale:\n   ```bash\nnpm i\n   ```\n2. Rode."],
    ["lista com hífen, 2 espaços", "- Passo:\n  ```sh\nmake\n  ```\nFim."],
    ["1 espaço", "Segue:\n ```ts\nconst a = 1;\n```\nPronto."],
  ])("cerca indentada (%s), ao vivo: nenhum quadro tem crase e o código de cada quadro é prefixo do final", (_nome, final) => {
    const codigoDe = (html: string): string | undefined => /<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(html)?.[1];
    const htmlFinal = vivo(final);
    expect(htmlFinal).not.toContain("`");
    expect(htmlFinal).toBe(textoFormatado(final));
    const doFinal = codigoDe(htmlFinal) ?? "";
    for (let i = 1; i <= final.length; i++) {
      const quadro = final.slice(0, i);
      const html = vivo(quadro);
      expect(html, JSON.stringify(quadro)).not.toContain("`");
      const codigo = codigoDe(html);
      if (codigo !== undefined) expect(doFinal.startsWith(codigo), JSON.stringify(quadro)).toBe(true);
    }
  });

  it("cerca indentada partida, sem aoVivo: as crases continuam aparecendo (só o streaming esconde)", () => {
    expect(textoFormatado("1. Instale:\n   `")).toContain("`");
    expect(textoFormatado("- Passo:\n  ``")).toContain("``");
  });

  it("cache: mesma chave e mesmo texto, com e sem aoVivo, cada chamada devolve o próprio HTML (nas duas ordens)", () => {
    const texto = "Segue:\n`";
    expect(textoFormatado(texto, { chave: "nod-204:a", aoVivo: true })).toBe("Segue:<br>");
    expect(textoFormatado(texto, { chave: "nod-204:a" })).toBe("Segue:<br>`");
    expect(textoFormatado(texto, { chave: "nod-204:a", aoVivo: true })).toBe("Segue:<br>");

    expect(textoFormatado(texto, { chave: "nod-204:b" })).toBe("Segue:<br>`");
    expect(textoFormatado(texto, { chave: "nod-204:b", aoVivo: true })).toBe("Segue:<br>");
    expect(textoFormatado(texto, { chave: "nod-204:b" })).toBe("Segue:<br>`");
  });

  it("suposição aceita: \"```\\nuse `x`\" ao vivo mostra \"use `x\" por um quadro; sem aoVivo continua \"use `x`\"", () => {
    expect(vivo("```\nuse `x`")).toBe(card("use `x", "", false));
    expect(textoFormatado("```\nuse `x`")).toBe(card("use `x`", "", false));
  });

  it("cerca com linguagem e crase colada, ou quatro crases: corpo vazio, sem piscar e sem quebrar", () => {
    expect(vivo("```ts`")).toBe(card("", "", false));
    expect(vivo("````")).toBe(card("", "", false));
    expect(vivo("x\n````")).toBe(`x<br>${card("", "", false)}`);
  });

  it("prosa: crase no fim mas fora do começo da linha não muda; prosa no meio do texto não muda", () => {
    expect(vivo("use `x`")).toBe(textoFormatado("use `x`"));
    expect(vivo("use `x")).toBe(textoFormatado("use `x"));
    expect(vivo("a\n`\n```\nb\n```\nfim")).toBe(textoFormatado("a\n`\n```\nb\n```\nfim"));
  });

  it("lista seguida de cerca abrindo: ao vivo, só a lista, sem <br> sobrando", () => {
    expect(vivo("- item\n`")).toBe('<ul class="md-lista"><li>item</li></ul>');
    expect(vivo("- item\n``")).toBe('<ul class="md-lista"><li>item</li></ul>');
  });

  it("texto que fica vazio depois de tirar a crase: string vazia, sem erro", () => {
    expect(vivo("`")).toBe("");
    expect(vivo("``")).toBe("");
  });

  it("bloco fechado e texto sem crase no fim: ao vivo, igual ao normal", () => {
    for (const t of ["```ts\nfoo()```", "Segue:\n```ts\na\n```\nPronto, **ok**.", "um *dois*\n\ntrês", "## Resumo\n- a\n- b"]) {
      expect(vivo(t), JSON.stringify(t)).toBe(textoFormatado(t));
    }
  });
});

/** NOD-45: bloco de código vira card com rótulo e Copiar; task list só de leitura. */
describe("card do bloco de código (NOD-45)", () => {
  it("bloco ts fechado vira card com rótulo, botão Copiar e código sem a última quebra", () => {
    const html = textoFormatado("```ts\nconst a = 1\n```");
    expect(html).toBe(card("const a = 1", "ts"));
    expect(html).toContain('<button type="button" data-act="copiar-codigo" aria-label="Copiar código" aria-live="polite">');
    expect(html).toContain("<pre><code>const a = 1</code></pre>");
  });

  it("sem linguagem: card sem rótulo; c++ e objective-c saem como rótulo", () => {
    expect(textoFormatado("```\nx\n```")).toBe(card("x"));
    expect(textoFormatado("```\nx\n```")).not.toContain("md-codigo-ling");
    expect(textoFormatado("```c++\nint x;\n```")).toContain('<span class="md-codigo-ling">c++</span>');
    expect(textoFormatado("```objective-c\n@interface A\n```")).toContain('<span class="md-codigo-ling">objective-c</span>');
  });

  it("linguagem fora da regex não vira rótulo nem aparece crua", () => {
    const html = textoFormatado("```\"><img src=x onerror=alert(1)>\nx\n```");
    expect(html).not.toContain("md-codigo-ling");
    expect(html).not.toContain("<img");
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;\nx");
    // Mais de 20 caracteres também não é rótulo: a linha continua no código, como hoje.
    const longa = "a".repeat(21);
    expect(textoFormatado(`\`\`\`${longa}\nx\n\`\`\``)).toBe(card(`${longa}\nx`));
  });

  it("cerca aberta: mesmo <pre><code> do fechado e sem botão", () => {
    const aberto = textoFormatado("```ts\nconst a = 1");
    expect(aberto).toBe(card("const a = 1", "ts", false));
    expect(aberto).not.toContain("<button");
    expect(textoFormatado("```ts\nconst a = 1\n```")).toBe(card("const a = 1", "ts"));
  });

  it("streaming da spec: cerca aberta com lista e tabela dentro sai literal e sem Copiar; fechada, o Copiar aparece", () => {
    const aberto = textoFormatado("antes\n```ts\n- a\n| x | y |\n|---|---|");
    expect(aberto).toContain("<pre><code>- a\n| x | y |\n|---|---|</code></pre>");
    for (const proibido of ["<ul", "md-tabela", "copiar-codigo"]) expect(aberto).not.toContain(proibido);
    expect(textoFormatado("antes\n```ts\n- a\n| x | y |\n|---|---|\n```")).toContain("copiar-codigo");
  });

  it("tira só uma quebra final: linha em branco no fim do código continua", () => {
    expect(textoFormatado("```\na\n\n```")).toBe(card("a\n"));
  });
});

describe("task list só de leitura (NOD-45)", () => {
  const tarefa = (texto: string, feito: boolean): string =>
    `<li class="md-tarefa"><span class="md-caixa${feito ? " feita" : ""}" aria-hidden="true"></span><span class="sr-only">${feito ? "feito" : "a fazer"}</span>${texto}</li>`;

  it("task list: [ ], [x], [X] e 1. [ ] com caixa e \"a fazer\"/\"feito\", sem <input>", () => {
    const html = textoFormatado("- [ ] a\n- [x] b\n- [X] c\n1. [ ] d");
    expect(html).toBe(`<ul class="md-lista">${tarefa("a", false)}${tarefa("b", true)}${tarefa("c", true)}</ul><ol class="md-lista">${tarefa("d", false)}</ol>`);
    expect(html).not.toContain("<input");
    expect(textoFormatado("* [ ] e\n+ [x] **f**")).toBe(`<ul class="md-lista">${tarefa("e", false)}${tarefa("<strong>f</strong>", true)}</ul>`);
  });

  it("[x](url) continua link; \"- [ ]\" isolado não quebra; lista sem caixa idêntica a hoje", () => {
    const link = textoFormatado("- [x](https://exemplo.com)");
    expect(link).not.toContain("md-tarefa");
    expect(link).toContain("exemplo.com");
    expect(textoFormatado("- [ ]")).toBe(`<ul class="md-lista">${tarefa("", false)}</ul>`);
    expect(textoFormatado("- a\n- b")).toBe('<ul class="md-lista"><li>a</li><li>b</li></ul>');
  });

  it("lista mista: tarefa e item comum, item a item", () => {
    expect(textoFormatado("- [x] feito\n- comum")).toBe(`<ul class="md-lista">${tarefa("feito", true)}<li>comum</li></ul>`);
  });

  // QA da NOD-45 (Teodora, 16/10): mutações que sobreviviam. Sem o ^ na regex, "[x]" no meio do item virava caixa; com
  // \s? no lugar de \s*, o espaço a mais depois da caixa ia para o texto.
  it("só [ ]/[x] no começo do item vira caixa; os espaços depois da caixa saem todos; HTML no texto sai escapado", () => {
    expect(textoFormatado("- veja [x] isso\n- e [ ] aquilo")).toBe('<ul class="md-lista"><li>veja [x] isso</li><li>e [ ] aquilo</li></ul>');
    expect(textoFormatado("- [ ]   a\n- [x]\tb")).toBe(`<ul class="md-lista">${tarefa("a", false)}${tarefa("b", true)}</ul>`);
    const xss = textoFormatado("- [ ] <img src=x onerror=alert(1)>");
    expect(xss).toBe(`<ul class="md-lista">${tarefa("&lt;img src=x onerror=alert(1)&gt;", false)}</ul>`);
    expect(xss).not.toContain("<img");
  });
});

/** NOD-328 (PR A): a cerca ```mermaid do histórico ganha a figure que o diagramas-vivos.ts desenha; o card fica dentro. */
describe("diagrama no texto do bot", () => {
  const MERMAID = "```mermaid\nflowchart LR\n  A-->B\n```";
  const figura = (i: number, codigo = "flowchart LR\n  A--&gt;B") => `<figure class="md-diagrama" data-diagrama-indice="${i}">${card(codigo, "mermaid")}</figure>`;

  it("só com `diagramas` e cerca fechada vira figure com o card dentro", () => {
    expect(textoFormatado(MERMAID, { diagramas: true })).toBe(figura(0));
    expect(textoFormatado(MERMAID)).toBe(card("flowchart LR\n  A--&gt;B", "mermaid"));
    expect(textoFormatado("```Mermaid\nflowchart LR\n  A-->B\n```", { diagramas: true })).toContain('class="md-diagrama"');
    expect(textoFormatado("```mermaid\nflowchart LR\n  A-->B", { diagramas: true })).not.toContain("md-diagrama");
  });

  it("ao vivo fica no card, mesmo com diagramas", () => {
    expect(textoFormatado(MERMAID, { diagramas: true, aoVivo: true })).not.toContain("md-diagrama");
  });

  it("vazio, outra linguagem ou acima de 20.000 caracteres ficam no card", () => {
    expect(textoFormatado("```mermaid\n\n```", { diagramas: true })).not.toContain("md-diagrama");
    expect(textoFormatado("```js\nflowchart LR\n```", { diagramas: true })).not.toContain("md-diagrama");
    const grande = `flowchart LR\n%%${"x".repeat(20_001)}`;
    expect(textoFormatado(`\`\`\`mermaid\n${grande}\n\`\`\``, { diagramas: true })).not.toContain("md-diagrama");
  });

  it("cada diagrama da mensagem leva o seu índice", () => {
    const html = textoFormatado(`${MERMAID}\nentre\n${MERMAID}`, { diagramas: true });
    expect(html).toContain('data-diagrama-indice="0"');
    expect(html).toContain('data-diagrama-indice="1"');
  });

  it("o HTML do bot dentro do diagrama sai escapado", () => {
    expect(textoFormatado('```mermaid\nflowchart LR\n  A["<img src=x onerror=alert(1)>"]\n```', { diagramas: true })).not.toContain("<img");
  });

  it("a memória separa com e sem diagramas", () => {
    const sem = textoFormatado(MERMAID, { chave: "nod328-memo" });
    const com = textoFormatado(MERMAID, { chave: "nod328-memo", diagramas: true });
    expect(sem).not.toBe(com);
    expect(textoFormatado(MERMAID, { chave: "nod328-memo" })).toBe(sem);
  });
});

describe("NOD-455: o link 'Abrir no quadro' do aviso", () => {
  const ID = "0B6F1C1E-1D2A-4C3B-9A8E-1234567890AB";
  it("vira o botão que abre /quadros/:id, com o uuid em minúsculas e o rótulo escapado", () => {
    const h = textoFormatado(`Com você. [Abrir <b>no</b> quadro](nod-quadro:${ID})`);
    expect(h).toContain(`data-act="abrir-quadro-compartilhado" data-quadro="${ID.toLowerCase()}"`);
    expect(h).toContain("Abrir &lt;b&gt;no&lt;/b&gt; quadro");
    expect(h).not.toContain("<b>");
  });
  it("fora do padrão (não uuid, com sobra) continua texto", () => {
    for (const alvo of ["nod-quadro:nao-e-uuid", `nod-quadro:${ID}/x`, `nod-quadro:${ID}"onclick="x`]) {
      expect(textoFormatado(`[Abrir](${alvo})`)).not.toContain("abrir-quadro-compartilhado");
    }
  });
});
