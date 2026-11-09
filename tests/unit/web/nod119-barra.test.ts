import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VALORES_BARRA_DESKTOP } from "../../../src/contracts/desktop-barra.ts";
import { CONSULTA_CELULAR } from "../../../web/lib/celular.ts";
import {
  aplicarBarra, arrastar, BARRA_PADRAO, CHAVE_DENSIDADE, desserializar, escolherDensidade, lerBarra, mover, extremo, pedidoDoChat, pintarBarra,
  pxDaBarra, restaurar, rotuloDaLargura, serializar, valorDaLargura, type Barra,
} from "../../../web/lib/densidade.ts";
import { cartaoAjusteBarra, gravarDecisao, lerDecisao, PREFIXO_DECISAO, versaoDasDecisoesDaBarra } from "../../../web/telas/card-barra.ts";
import { proximoDoSegmentado } from "../../../web/lib/linha-config.ts";
import { AJUDA_DENSIDADE, renderGeral, type DadosGeral } from "../../../web/telas/config-geral.ts";
import { CONFIG_UI_INICIAL } from "../../../web/estado/reducer.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";

const raiz = () => {
  const props = new Map<string, string>();
  return { dataset: {} as Record<string, string | undefined>, style: { setProperty: (n: string, v: string) => void props.set(n, v), removeProperty: (n: string) => void props.delete(n) }, props };
};
const armazem = (inicial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(inicial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
const B = (densidade: Barra["densidade"], largura: Barra["largura"] = "padrao"): Barra => ({ densidade, largura });

describe("NOD-119: densidade e largura da barra (web/lib/densidade.ts)", () => {
  it("as larguras da tabela: Confortável 340 ↔ 72; Compacta 200 ↔ 56 e 340 alargada", () => {
    expect(pxDaBarra(B("confortavel"))).toBe(340);
    expect(pxDaBarra(B("confortavel", "recolhida"))).toBe(72);
    expect(pxDaBarra(B("compacta"))).toBe(200);
    expect(pxDaBarra(B("compacta", "recolhida"))).toBe(56);
    expect(pxDaBarra(B("compacta", "larga"))).toBe(340);
    // A Confortável não tem a alargada: vira a aberta.
    expect(pxDaBarra(B("confortavel", "larga"))).toBe(340);
  });

  it("serializa só os valores do contrato, e o padrão não grava nada", () => {
    expect(serializar(BARRA_PADRAO)).toBeNull();
    const todas = [B("compacta"), B("compacta", "recolhida"), B("compacta", "larga"), B("confortavel", "recolhida")].map(serializar);
    expect(todas.sort()).toEqual([...VALORES_BARRA_DESKTOP].sort());
    for (const v of VALORES_BARRA_DESKTOP) expect(serializar(desserializar(v))).toBe(v);
  });

  it("valor guardado estranho volta ao padrão (inclusive as chaves do protótipo)", () => {
    for (const v of ["", "x", "compacta:", "confortavel", "confortavel:larga", "__proto__", "constructor", "toString", null, undefined]) {
      expect(desserializar(v)).toEqual(BARRA_PADRAO);
    }
    expect(lerBarra({ getItem: () => { throw new Error("bloqueado"); } })).toEqual(BARRA_PADRAO);
    expect(lerBarra(armazem({ [CHAVE_DENSIDADE]: "compacta:larga" }))).toEqual(B("compacta", "larga"));
  });

  it("← e → param nas pontas; Home e End vão aos extremos da densidade", () => {
    expect(mover(B("confortavel"), -1)).toEqual(B("confortavel", "recolhida"));
    expect(mover(B("confortavel", "recolhida"), -1)).toEqual(B("confortavel", "recolhida"));
    expect(mover(B("confortavel"), 1)).toEqual(B("confortavel"));
    expect(mover(B("compacta"), 1)).toEqual(B("compacta", "larga"));
    expect(mover(B("compacta", "larga"), 1)).toEqual(B("compacta", "larga"));
    expect(extremo(B("compacta", "recolhida"), "max")).toEqual(B("compacta", "larga"));
    expect(extremo(B("confortavel"), "min")).toEqual(B("confortavel", "recolhida"));
  });

  it("o arrasto encaixa a cada 40 px inteiros, nos dois sentidos", () => {
    expect(arrastar(B("compacta"), 39)).toEqual(B("compacta"));
    expect(arrastar(B("compacta"), 40)).toEqual(B("compacta", "larga"));
    expect(arrastar(B("compacta"), -39)).toEqual(B("compacta"));
    expect(arrastar(B("compacta"), -40)).toEqual(B("compacta", "recolhida"));
    expect(arrastar(B("compacta", "recolhida"), 80)).toEqual(B("compacta", "larga"));
    expect(arrastar(B("confortavel"), -400)).toEqual(B("confortavel", "recolhida"));
  });

  it("dois cliques restauram; a densidade escolhida mantém a recolhida", () => {
    expect(restaurar(B("compacta", "larga"))).toEqual(B("compacta"));
    expect(escolherDensidade(B("confortavel", "recolhida"), "compacta")).toEqual(B("compacta", "recolhida"));
    expect(escolherDensidade(B("compacta", "larga"), "confortavel")).toEqual(B("confortavel"));
  });

  it("o pedido do chat: compacta → 200; só avatares recolhe na densidade atual; normal → Confortável 340", () => {
    expect(pxDaBarra(pedidoDoChat(B("confortavel", "recolhida"), "compacta"))).toBe(200);
    expect(pedidoDoChat(B("compacta", "larga"), "so_avatares")).toEqual(B("compacta", "recolhida"));
    expect(pedidoDoChat(B("confortavel"), "so_avatares")).toEqual(B("confortavel", "recolhida"));
    expect(pedidoDoChat(B("compacta", "recolhida"), "normal")).toEqual(BARRA_PADRAO);
  });

  it("o aria do separador fala em palavras", () => {
    expect(rotuloDaLargura(B("compacta", "recolhida"))).toBe("Só avatares, compacta");
    expect(valorDaLargura(B("compacta", "larga"))).toBe(100);
    expect(valorDaLargura(B("confortavel", "recolhida"))).toBe(0);
  });

  it("pintarBarra: o padrão e o celular não deixam atributo; a recolhida com a busca vira sobreposta", () => {
    const r = raiz();
    pintarBarra(B("compacta", "recolhida"), r, false);
    expect(r.dataset).toEqual({ densidade: "compacta", largura: "recolhida" });
    expect(r.props.get("--largura-barra")).toBe("56px");
    pintarBarra(B("compacta", "recolhida"), r, false, true);
    expect(r.dataset).toEqual({ densidade: "compacta", sobreposta: "200" });
    expect(r.props.get("--largura-barra")).toBe("56px");
    pintarBarra(B("compacta", "recolhida"), r, true, true);
    expect(r.dataset).toEqual({});
    expect(r.props.has("--largura-barra")).toBe(false);
    pintarBarra(B("confortavel", "recolhida"), r, false);
    pintarBarra(BARRA_PADRAO, r, false);
    expect(r.dataset).toEqual({});
  });

  it("aplicarBarra grava neste computador e manda para fora; o padrão apaga", () => {
    const a = armazem();
    const fora: (string | null)[] = [];
    aplicarBarra(B("compacta", "larga"), raiz(), false, a, (v) => fora.push(v));
    expect(a.m.get(CHAVE_DENSIDADE)).toBe("compacta:larga");
    aplicarBarra(BARRA_PADRAO, raiz(), false, a, (v) => fora.push(v));
    expect(a.m.has(CHAVE_DENSIDADE)).toBe(false);
    expect(fora).toEqual(["compacta:larga", null]);
  });
});

describe("NOD-119: o script do index.html pinta igual a pintarBarra antes do primeiro quadro", () => {
  const html = readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8");
  const script = /<script>(try \{ var d = localStorage\.getItem\("nod\.densidade"\)[\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  const rodar = (valor: string | null, celular: boolean) => {
    const r = raiz();
    const consultas: string[] = [];
    const fn = new Function("localStorage", "matchMedia", "document", script);
    fn({ getItem: () => valor }, (q: string) => { consultas.push(q); return { matches: celular }; }, { documentElement: r });
    return { r, consultas };
  };

  it("usa a mesma chave e a mesma consulta do celular", () => {
    expect(script).toContain(`"${CHAVE_DENSIDADE}"`);
    expect(rodar("compacta", false).consultas).toEqual([CONSULTA_CELULAR]);
  });

  it.each([null, "x", "__proto__", "constructor", ...VALORES_BARRA_DESKTOP])("valor %s: mesmos atributos que pintarBarra", (v) => {
    for (const celular of [false, true]) {
      const { r } = rodar(v, celular);
      const esperado = raiz();
      pintarBarra(desserializar(v), esperado, celular);
      expect(r.dataset).toEqual(esperado.dataset);
      expect([...r.props]).toEqual([...esperado.props]);
    }
  });
});

describe("NOD-119: a borda da barra", () => {
  it("borda e etiqueta somem no celular (mobile.css)", () => {
    const css = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.borda-barra,\s*\.etiqueta-barra\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });
});

describe("NOD-119: Configurações › Aparência", () => {
  const d: DadosGeral = { tema: "claro", avisos: { onde: "mac", situacao: "ligados", som: true }, modoDev: false, experimentos: { calibracao: false, memoriaLonga: false, whatsapp: false, quadro: false } };
  it("o segmentado Confortável · Compacta, com a frase da borda, fora do celular", () => {
    const html = renderGeral({ ...d, densidade: "compacta" }, CONFIG_UI_INICIAL, false);
    expect(html).toContain('role="radiogroup" aria-label="Barra lateral"');
    expect(html).toContain(AJUDA_DENSIDADE);
    expect(html).toMatch(/aria-checked="true" tabindex="0" data-act="escolher-densidade" data-valor="compacta">Compacta</);
    expect(html).toMatch(/aria-checked="false" tabindex="-1" data-act="escolher-densidade" data-valor="confortavel">Confortável</);
  });
  it("no celular a linha não aparece", () => {
    expect(renderGeral(d, CONFIG_UI_INICIAL, true)).not.toContain("escolher-densidade");
  });
  it("as setas giram no segmentado", () => {
    expect(proximoDoSegmentado(0, 2, "ArrowRight")).toBe(1);
    expect(proximoDoSegmentado(1, 2, "ArrowRight")).toBe(0);
    expect(proximoDoSegmentado(0, 2, "ArrowLeft")).toBe(1);
    expect(proximoDoSegmentado(1, 2, "Home")).toBe(0);
    expect(proximoDoSegmentado(0, 2, "End")).toBe(1);
    expect(proximoDoSegmentado(0, 2, "Tab")).toBeNull();
  });
});

describe("NOD-119 (C1): o card do chat", () => {
  const msg = (pedido: string, id = "m1"): Mensagem => ({ id, kind: "sistema", texto: "Deixar a barra lateral compacta?", payload: { kind: "ajuste_barra", pedido } } as unknown as Mensagem);

  it("pergunta, Antes → Depois, nota, o verbo e Agora não", () => {
    const html = cartaoAjusteBarra(msg("compacta"), { barra: BARRA_PADRAO, celular: false, decisao: null })!;
    expect(html).toContain('<p class="ab-titulo">Deixar a barra lateral compacta?</p>');
    expect(html).toMatch(/<span>Confortável<\/span>.*→.*<b>Compacta<\/b>/);
    expect(html).toContain('data-act="aplicar-barra" data-mensagem="m1" data-pedido="compacta">Compactar</button>');
    expect(html).toContain('data-act="recusar-barra"');
    expect(html).toContain(">Agora não<");
  });

  it("os verbos e o Depois de cada pedido", () => {
    expect(cartaoAjusteBarra(msg("so_avatares"), { barra: B("compacta"), celular: false, decisao: null })).toMatch(/<b>Só avatares, compacta<\/b>.*>Recolher</);
    expect(cartaoAjusteBarra(msg("normal"), { barra: B("compacta", "recolhida"), celular: false, decisao: null })).toMatch(/<b>Confortável<\/b>.*>Voltar ao normal</);
  });

  it("no celular, sem o botão de aplicar", () => {
    const html = cartaoAjusteBarra(msg("compacta"), { barra: BARRA_PADRAO, celular: true, decisao: null })!;
    expect(html).not.toContain("aplicar-barra");
    expect(html).toContain("Abra no computador");
  });

  it("decidido vira uma linha; pedido estranho não vira botão", () => {
    expect(cartaoAjusteBarra(msg("compacta"), { barra: BARRA_PADRAO, celular: false, decisao: "aplicada" })).toContain("✓ Barra lateral compacta");
    expect(cartaoAjusteBarra(msg("so_avatares"), { barra: BARRA_PADRAO, celular: false, decisao: "aplicada" })).toContain("✓ Barra lateral só com avatares");
    expect(cartaoAjusteBarra(msg("normal"), { barra: BARRA_PADRAO, celular: false, decisao: "recusada" })).toContain("Barra lateral sem mudança");
    const estranho = cartaoAjusteBarra(msg("<img src=x>"), { barra: BARRA_PADRAO, celular: false, decisao: null })!;
    expect(estranho).not.toContain("<img");
    expect(estranho).not.toContain("aplicar-barra");
    expect(cartaoAjusteBarra({ ...msg("compacta"), payload: null } as unknown as Mensagem, { barra: BARRA_PADRAO, celular: false })).toBeNull();
  });

  it("sem decisão guardada (app do Mac reaberto, outro computador) e a barra já como o pedido: vira a linha feita", () => {
    expect(cartaoAjusteBarra(msg("compacta"), { barra: B("compacta"), celular: false, decisao: null })).toContain("A barra lateral já está compacta");
    expect(cartaoAjusteBarra(msg("so_avatares"), { barra: B("confortavel", "recolhida"), celular: false, decisao: null })).toContain("A barra lateral já está só com avatares");
    expect(cartaoAjusteBarra(msg("normal"), { barra: BARRA_PADRAO, celular: false, decisao: null })).toContain("A barra lateral já está no normal");
    expect(cartaoAjusteBarra(msg("compacta"), { barra: B("compacta"), celular: false, decisao: null })).not.toContain("✓");
    // A recusa guardada continua valendo mesmo que a barra tenha mudado por outro caminho.
    expect(cartaoAjusteBarra(msg("compacta"), { barra: B("compacta"), celular: false, decisao: "recusada" })).toContain("sem mudança");
  });

  it("sem decisão no contexto, o card lê a decisão gravada (QA, mutante 12)", () => {
    const id = "m-lida";
    expect(cartaoAjusteBarra({ ...msg("compacta"), id }, { barra: BARRA_PADRAO, celular: false })).toContain("aplicar-barra");
    gravarDecisao(id, "aplicada", null);
    const html = cartaoAjusteBarra({ ...msg("compacta"), id }, { barra: BARRA_PADRAO, celular: false })!;
    expect(html).toContain("✓ Barra lateral compacta");
    expect(html).not.toContain("aplicar-barra");
  });

  it("a decisão fica neste computador e muda a versão do histórico lembrado", () => {
    const a = armazem();
    const antes = versaoDasDecisoesDaBarra();
    gravarDecisao("m9", "aplicada", a);
    expect(a.m.get(PREFIXO_DECISAO + "m9")).toBe("aplicada");
    expect(lerDecisao("m9", a)).toBe("aplicada");
    expect(lerDecisao("m9", armazem({ [PREFIXO_DECISAO + "m9"]: "outra" }))).toBeNull();
    expect(versaoDasDecisoesDaBarra()).toBe(antes + 1);
    // Sem armazenamento, a memória da página segura a decisão.
    gravarDecisao("m10", "recusada", { getItem: () => null, setItem: () => { throw new Error("cheio"); } });
    expect(cartaoAjusteBarra(msg("compacta", "m10"), { barra: BARRA_PADRAO, celular: false })).toContain("sem mudança");
  });
});

describe("NOD-119: o CSS da densidade (revisão)", () => {
  const css = readFileSync(new URL("../../../web/densidade.css", import.meta.url), "utf8");
  it("o painel fechado e o raio-x tiram a 3ª coluna também com a barra escolhida", () => {
    const bloco = /@media \(min-width: 1100px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(bloco).toContain("html[data-densidade] .app.com-detalhes.detalhes-ocultos:not(.sem-sessao)");
    expect(bloco).toContain("html[data-densidade] body.com-raio-x .app.com-detalhes:not(.sem-sessao)");
    expect(bloco).toMatch(/grid-template-columns: var\(--largura-barra\) minmax\(360px, 1fr\);/);
    expect(bloco).not.toContain("380px");
  });
  it("o número de trabalhos (chip-trab) some do fixado na Compacta e na recolhida", () => {
    expect(css.match(/\.fixado-bt :is\(\.chip, \.chip-trab\)/g)).toHaveLength(2);
  });
});

describe("NOD-119 (revisão 5): o preload do app do Mac repõe as mesmas chaves que a web lê", () => {
  it("nod.densidade e o prefixo das decisões do card", () => {
    const preload = readFileSync(new URL("../../../desktop/preload-web.ts", import.meta.url), "utf8");
    expect(preload).toContain(`localStorage.setItem("${CHAVE_DENSIDADE}"`);
    expect(preload).toContain(`localStorage.removeItem("${CHAVE_DENSIDADE}")`);
    expect(preload).toContain(`localStorage.setItem(\`${PREFIXO_DECISAO}\${id}\``);
  });
});

describe("NOD-119 (revisão 6): na Compacta, os avisos que pedem ação continuam na linha", () => {
  it("a regra que esconde a prévia exclui cada aviso (todos são span, e a especificidade empataria contra eles)", () => {
    const css = readFileSync(new URL("../../../web/densidade.css", import.meta.url), "utf8");
    const esconde = /\.txt > span:not\(([^)]*)\) \{ display: none; \}/.exec(css)?.[1] ?? "";
    const mostra = /\.txt > :is\(([^)]*)\) \{ display: block;/.exec(css)?.[1] ?? "";
    const avisos = mostra.split(",").map((x) => x.trim()).filter(Boolean);
    expect(avisos).toEqual([".sub-fora-do-ar", ".sub-esperando", ".sub-rotina-parada", ".sub-em-ligacao"]);
    for (const a of avisos) expect(esconde, a).toContain(a);
  });
});

describe("NOD-119 (revisão 6): o mascote redondo continua redondo na Compacta e na recolhida", () => {
  it("cada bloco que muda o raio do ícone devolve 50% ao shape-circle", () => {
    const css = readFileSync(new URL("../../../web/densidade.css", import.meta.url), "utf8");
    expect(css.match(/& :is\(\.row, \.fixado-bt\) \.icon\.shape-circle \{ border-radius: 50%; \}/g)).toHaveLength(2);
  });
});


describe("NOD-119 (revisão 7): o arrasto só chega à conversa e ao Mac quando para", () => {
  it("adiar roda uma vez, com o último valor, depois da última chamada", async () => {
    const { vi } = await import("vitest");
    const { adiar } = await import("../../../web/lib/densidade.ts");
    vi.useFakeTimers();
    try {
      const vistos: string[] = [];
      const f = adiar<string>(250, (v) => vistos.push(v));
      f("a"); vi.advanceTimersByTime(100); f("b"); vi.advanceTimersByTime(100); f("c");
      expect(vistos).toEqual([]);
      vi.advanceTimersByTime(250);
      expect(vistos).toEqual(["c"]);
    } finally { vi.useRealTimers(); }
  });
  it("a conversa não depende da barra a cada passo, só da barra acompanhada", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).not.toMatch(/versaoDasDecisoesDaBarra\(\), serializar\(barraAtual\)/);
    expect(main.match(/versaoDasDecisoesDaBarra\(\), barraNaConversa/g)?.length).toBe(2);
  });
});

describe("NOD-119 (revisão 9): o clique vence o arrasto que ainda não gravou", () => {
  it("agora cancela o pendente: o valor velho não chega depois do novo", async () => {
    const { vi } = await import("vitest");
    const { adiar } = await import("../../../web/lib/densidade.ts");
    vi.useFakeTimers();
    try {
      const gravados: string[] = [];
      const gravar = adiar<string>(250, (v) => gravados.push(v));
      gravar("arrasto");
      gravar.agora("card");
      vi.advanceTimersByTime(1000);
      expect(gravados).toEqual(["card"]);
    } finally { vi.useRealTimers(); }
  });
  it("o caminho imediato do main.ts passa pelo agora (não chama definirBarra direto)", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/naHora \? gravarNoMac\.agora : gravarNoMac/);
    expect(main.match(/definirBarra\?\.\(/g)?.length).toBe(1);
  });
});
