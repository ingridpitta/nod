import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, mensagemDoFrame, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { ATIVIDADE_VAZIA, comCabecalho, comFerramenta, comFimDaAcao, comFrentesEm, COMET_MS, comTexto, falaNoBalao, GRUPOS_A_VISTA, itensDoPensamento, PERMANENCIA_MS, primeiraLinha, PROMOCAO_CHARS, WINK_MS, type AtividadeTurno } from "../../../web/lib/atividade.ts";
import { proximaViradaDoMascote } from "../../../web/lib/mascote.ts";
import { criarRelogioDaFala, escreverEstados, TICK_CURTO_MS } from "../../../web/lib/fala-viva.ts";
import { trocarConteudo, type NoDoMorph } from "../../../web/lib/morph.ts";
import { esperaDaPessoa, fraseDoPronto, fraseFerramentas, frasePensou, renderPensar, rotuloDasFerramentas } from "../../../web/telas/conversa.ts";

/** Plano "o pensamento no chat", Parte 2 (2026-10-26, opção C): as peças puras do pensamento. */

const usa = (a: AtividadeTurno | undefined, rotulo: string, emUso = `Usando ${rotulo.split(" ").at(-1)}`, id: string | null = null): AtividadeTurno => comFerramenta(a, rotulo, { texto: emUso, frentes: false }, id);
const LONGO = `Relatório: ${"setembro fechou acima da meta em todas as contas. ".repeat(8)}`;

describe("falaNoBalao: balão só com texto definitivo, numa direção só", () => {
  it("texto curto ao vivo é pensamento, sem balão; passou do limiar, vira balão e segue em streaming", () => {
    expect(LONGO.length).toBeGreaterThan(PROMOCAO_CHARS);
    const curto = falaNoBalao(comTexto(ATIVIDADE_VAZIA, "Vou olhar o PR."), false);
    expect(curto).toMatchObject({ texto: "", pensamento: "Vou olhar o PR.", promovido: false });
    expect(curto.trechos).toEqual([]);
    const longo = falaNoBalao(comTexto(ATIVIDADE_VAZIA, LONGO), false);
    expect(longo).toMatchObject({ texto: LONGO, pensamento: "", promovido: true });
    // Exatamente no limiar ainda é curto (a mesma regra do servidor para a narração).
    const limiar = `Vou ${"x".repeat(PROMOCAO_CHARS - 8)} já.`;
    expect(limiar).toHaveLength(PROMOCAO_CHARS);
    expect(falaNoBalao(comTexto(ATIVIDADE_VAZIA, limiar), false).promovido).toBe(false);
  });

  it("no fim do turno o texto corrente entra (a regra do servidor o grava), inclusive o último bloco fechado por ferramenta", () => {
    expect(falaNoBalao(comTexto(ATIVIDADE_VAZIA, "Pronto."), true)).toMatchObject({ texto: "Pronto.", pensamento: "", promovido: true });
    const fechado = usa(comTexto(ATIVIDADE_VAZIA, "Fechei o PR."), "Consultou GitHub");
    expect(falaNoBalao(fechado, false)).toMatchObject({ texto: "", pensamento: "" });
    expect(falaNoBalao(fechado, true)).toMatchObject({ texto: "Fechei o PR.", promovido: true });
  });

  it("os relatórios longos de antes da ferramenta ficam no balão mesmo com narração curta depois; a narração curta nunca entra", () => {
    const a = comTexto(usa(comTexto(ATIVIDADE_VAZIA, LONGO), "Consultou Linear"), "Vou conferir.");
    const vivo = falaNoBalao(a, false);
    expect(vivo.texto).toBe(LONGO.trim());
    expect(vivo.pensamento).toBe("Vou conferir.");
    expect(vivo.promovido).toBe(false);
    // Outra ferramenta fecha a narração: o balão não muda (nada sai).
    expect(falaNoBalao(usa(a, "Consultou GitHub"), false).texto).toBe(LONGO.trim());
    // No fim, o final curto entra depois do relatório.
    const fim = falaNoBalao(comTexto(usa(a, "Consultou GitHub"), "Pronto."), true);
    expect(fim.texto).toBe(`${LONGO.trim()}\n\nPronto.`);
    expect(fim.trechos.map((t) => t.geracao)).toEqual([0, 1]);
  });

  it("sem atividade: nada", () => {
    expect(falaNoBalao(undefined, false)).toEqual({ texto: "", trechos: [], pensamento: "", promovido: false });
  });
});

describe("itensDoPensamento: notas e grupos na ordem em que aconteceram", () => {
  it("a narração curta fechada por ferramenta vira nota antes da ação; a mesma ferramenta seguida vira um grupo ×N com as falhas", () => {
    let a = usa(comTexto(ATIVIDADE_VAZIA, "Vou ler os arquivos."), "Leu um arquivo", "Lendo um arquivo", "r1");
    a = comFimDaAcao(a, "r1", false)!;
    a = usa(a, "Leu um arquivo", "Lendo um arquivo", "r2");
    a = comFimDaAcao(a, "r2", true)!;
    a = usa(a, "Leu um arquivo", "Lendo um arquivo", "r3");
    a = usa(comTexto(a, "Agora os testes."), "Rodou um comando", "Rodando os testes", "b1");
    expect(itensDoPensamento(a)).toEqual([
      { tipo: "nota", texto: "Vou ler os arquivos." },
      { tipo: "grupo", rotulo: "Leu um arquivo", vezes: 3, falhas: 1, rodando: false, emUso: null, frentes: false },
      { tipo: "nota", texto: "Agora os testes." },
      { tipo: "grupo", rotulo: "Rodou um comando", vezes: 1, falhas: 0, rodando: true, emUso: "Rodando os testes", frentes: false },
    ]);
    // Parado (turno acabado): nada roda.
    expect(itensDoPensamento(a, true).at(-1)).toMatchObject({ rodando: false, emUso: null });
  });

  it("a primeira ferramenta sem narração antes (sem `nota`) fica antes da nota que veio depois dela", () => {
    let a = usa(ATIVIDADE_VAZIA, "Leu um arquivo", "Lendo um arquivo", "r1");
    a = usa(comTexto(a, "Agora os testes."), "Rodou um comando", "Rodando os testes", "b1");
    expect(a.acoes[0]!.nota).toBeUndefined();
    expect(itensDoPensamento(a).map((i) => (i.tipo === "nota" ? `nota:${i.texto}` : `grupo:${i.rotulo}`))).toEqual(["grupo:Leu um arquivo", "nota:Agora os testes.", "grupo:Rodou um comando"]);
  });

  it("o relatório longo não vira nota (está no balão); a narração que ainda corre não é nota", () => {
    const a = comTexto(usa(comTexto(ATIVIDADE_VAZIA, LONGO), "Consultou Linear"), "Vou conferir.");
    // O texto que voltou fechou a ação (NOD-353): feita.
    expect(itensDoPensamento(a)).toEqual([{ tipo: "grupo", rotulo: "Consultou Linear", vezes: 1, falhas: 0, rodando: false, emUso: null, frentes: false }]);
  });

  it("renderPensar: só os últimos grupos ficam à vista; os anteriores (com as notas deles) atrás de 'N anteriores'", () => {
    let a: AtividadeTurno | undefined;
    for (let i = 0; i < GRUPOS_A_VISTA + 3; i++) a = usa(comTexto(a, `Passo ${i}.`), `Ferramenta ${i}`, `Usando ${i}`, `f${i}`);
    const itens = itensDoPensamento(a);
    const html = renderPensar({ turnoId: "t1", fase: "fazendo", cabecalho: { id: "x", texto: "Usando 10" }, anuncio: "Usando 10", desde: 1, contagem: { acoes: 11, falhas: 0 }, itens, tarefas: [] });
    expect(html).toContain('<li class="pensar-mais"><details data-disclosure="pensar-mais-t1"><summary>3 anteriores</summary>');
    const escondido = html.slice(html.indexOf("pensar-mais"), html.indexOf("</details></li>"));
    expect(escondido).toContain("Passo 0.");
    expect(escondido).toContain("Ferramenta 2");
    expect(escondido).not.toContain("Ferramenta 3");
    const aVista = html.slice(html.indexOf("</details></li>"));
    expect(aVista).toContain("Passo 3.");
    expect(aVista).toContain('<span>Usando 10</span>');
    expect(html).toContain('<span class="pensar-contagem">11 ações</span>');
  });
});

describe("comCabecalho: a permanência mínima do cabeçalho", () => {
  it("a narração corre no cabeçalho na hora; a ferramenta que chega antes de 600 ms fica pendente e a última vence", () => {
    let a = comCabecalho(comTexto(ATIVIDADE_VAZIA, "Vou olhar"), 1000);
    expect(a.cabecalho).toEqual({ id: "escrevendo", texto: "Vou olhar", desde: 1000 });
    a = comCabecalho(comTexto(a, " o PR."), 1100);
    expect(a.cabecalho).toEqual({ id: "escrevendo", texto: "Vou olhar o PR.", desde: 1000 });
    a = comCabecalho(usa(a, "Consultou GitHub"), 1200);
    expect(a.cabecalho).toEqual({ id: "escrevendo", texto: "Vou olhar o PR.", desde: 1000, pendente: { id: "ferramenta:Usando GitHub", texto: "Usando GitHub" } });
    a = comCabecalho(usa(a, "Consultou Linear"), 1300);
    expect(a.cabecalho?.pendente).toEqual({ id: "ferramenta:Usando Linear", texto: "Usando Linear" });
    a = comCabecalho(a, 1000 + PERMANENCIA_MS);
    expect(a.cabecalho).toEqual({ id: "ferramenta:Usando Linear", texto: "Usando Linear", desde: 1000 + PERMANENCIA_MS });
    // A mesma troca de novo não mexe (a referência fica).
    expect(comCabecalho(a, 1700)).toBe(a);
  });

  it("escreverEstados: o relógio da tela escreve a troca pendente quando a permanência deu, e conta as que ainda esperam", () => {
    const feito: string[] = [];
    const el = (desde: number, texto: string) => {
      const attrs: Record<string, string> = { "data-estado-pendente": texto, "data-estado-desde": String(desde) };
      const alvo = { textContent: "Velho" };
      return { getAttribute: (n: string) => attrs[n] ?? null, removeAttribute: (n: string) => { delete attrs[n]; feito.push(`tira:${n}`); }, querySelector: () => alvo, alvo, attrs };
    };
    const cedo = el(1000, "Usando Linear");
    const tarde = el(100, "Pensando");
    expect(escreverEstados({ querySelectorAll: () => [cedo, tarde] }, 1300)).toBe(1);
    expect(cedo.alvo.textContent).toBe("Velho");
    expect(tarde.alvo.textContent).toBe("Pensando");
    expect(tarde.attrs).toEqual({});
    expect(escreverEstados(null, 0)).toBe(0);
  });

  it("revisão de engenharia (27/10): o relógio bate a cada TICK_CURTO_MS enquanto uma troca espera, e volta ao segundo depois", () => {
    const agendados: number[] = [];
    let pendentes = 1;
    const relogio = criarRelogioDaFala(() => 1, (_fn, ms) => { agendados.push(ms); return () => undefined; }, () => false, () => (pendentes > 0 ? TICK_CURTO_MS : 1000));
    relogio.tocar();
    pendentes = 0;
    relogio.tocar();
    expect(agendados).toEqual([TICK_CURTO_MS, 1000]);
    expect(TICK_CURTO_MS).toBeLessThan(PERMANENCIA_MS);
  });

  it("promovido ao balão, o cabeçalho diz só 'Escrevendo' (o texto não sai duas vezes)", () => {
    const longo = comCabecalho(comTexto(ATIVIDADE_VAZIA, LONGO), 1000);
    expect(longo.cabecalho).toEqual({ id: "escrevendo", texto: "Escrevendo", desde: 1000 });
    expect(comCabecalho(comTexto(ATIVIDADE_VAZIA, "Vou olhar."), 1000).cabecalho?.texto).toBe("Vou olhar.");
  });

  it("primeiraLinha: a primeira linha sem marcação, com o texto da pessoa escapado depois pela tela", () => {
    expect(primeiraLinha("**Vou** olhar o `PR`\n\nJá volto.")).toBe("Vou olhar o PR");
    expect(primeiraLinha("\n\n- Primeira <parte>\nsegunda")).toBe("Primeira <parte>");
    expect(primeiraLinha("> citação")).toBe("citação");
  });
});

describe("o morph e o <details>", () => {
  it("trocarConteudo não tira nem põe o `open`: é da pessoa", () => {
    type NoFalso = NoDoMorph & { attrs: Record<string, string>; filhos: unknown[] };
    const no = (attrs: Record<string, string>): NoFalso => {
      const falso: NoFalso = {
        attrs, filhos: [], className: "", firstElementChild: null, nextElementSibling: null, parentNode: null, childNodes: [],
        getAttribute: (n: string) => attrs[n] ?? null, getAttributeNames: () => Object.keys(attrs), setAttribute: (n: string, v: string) => { attrs[n] = v; }, removeAttribute: (n: string) => { delete attrs[n]; },
        replaceChildren: (...nos: never[]) => { falso.filhos = nos; }, querySelector: () => null, insertBefore: () => null, remove: () => {},
      };
      return falso;
    };
    const velho = no({ class: "pensar", open: "", "data-fase": "pensando" });
    trocarConteudo(velho, no({ class: "pensar", "data-fase": "fazendo" }));
    expect(velho.attrs).toEqual({ class: "pensar", open: "", "data-fase": "fazendo" });
    const fechado = no({ class: "pensar" });
    trocarConteudo(fechado, no({ class: "pensar", open: "" }));
    expect(fechado.attrs).toEqual({ class: "pensar", open: "" });
  });
});

describe("o cabeçalho pronto e a espera", () => {
  it("frasePensou: tempo, ações e falhas, o que houver", () => {
    expect(frasePensou(9_400, { acoes: 2, falhas: 1 })).toBe("Pensou por 9 s · 2 ações · 1 falhou");
    expect(frasePensou(null, { acoes: 1, falhas: 0 })).toBe("1 ação");
    expect(frasePensou(70_000, { acoes: 105, falhas: 3 })).toBe("Pensou por 1 min 10 s · 105 ações · 3 falharam");
  });

  it("ADA-2 F5 (#290): fraseFerramentas conta as chamadas, no singular e no plural, com as falhas", () => {
    expect(fraseFerramentas({ acoes: 1, falhas: 0 })).toBe("Usou 1 ferramenta");
    expect(fraseFerramentas({ acoes: 3, falhas: 0 })).toBe("Usou 3 ferramentas");
    expect(fraseFerramentas({ acoes: 3, falhas: 1 })).toBe("Usou 3 ferramentas · 1 falhou");
    expect(fraseFerramentas({ acoes: 5, falhas: 2 })).toBe("Usou 5 ferramentas · 2 falharam");
  });

  it("ADA-2 F5 (S2): o pronto sem ferramenta (só pensou) mantém 'Pensou por N s'", () => {
    expect(fraseDoPronto(12_000, { acoes: 0, falhas: 0 })).toBe("Pensou por 12 s");
    expect(fraseDoPronto(12_000, { acoes: 3, falhas: 0 })).toBe("Usou 3 ferramentas");
  });

  it("ADA-2 F5 (#290): o cabeçalho pronto com ferramenta é a linha com chave e ›, a duração no title/aria", () => {
    expect(rotuloDasFerramentas(12_000, { acoes: 3, falhas: 1 })).toBe("Ver as 3 ferramentas usadas, 1 falhou, pensou por 12 s");
    expect(rotuloDasFerramentas(null, { acoes: 1, falhas: 0 })).toBe("Ver a ferramenta usada");
    const html = renderPensar({ turnoId: "t1", fase: "pronto", cabecalho: { id: "pronto", texto: fraseDoPronto(12_000, { acoes: 3, falhas: 0 }) }, anuncio: "Respondeu", desde: null, contagem: { acoes: 3, falhas: 0 }, itens: [{ tipo: "grupo", rotulo: "Consultou Linear", vezes: 3, falhas: 0, rodando: false, emUso: null, frentes: false }], tarefas: [], duracaoMs: 12_000 });
    expect(html).toContain('<summary class="pensar-cab pensar-ferr" aria-label="Ver as 3 ferramentas usadas, pensou por 12 s" title="Pensou por 12 s"><svg class="pensar-ferr-ic"');
    expect(html).toContain('<span class="fala-viva-estado">Usou 3 ferramentas</span>');
    expect(html).not.toContain("Pensou por 12 s</span>");
    expect(html).not.toContain("pensar-meta");
    // A lista continua a mesma dentro do <details>.
    expect(html).toContain("<span>Consultou Linear</span>");
    // Só pensou: o cabeçalho antigo, sem a chave.
    const soPensou = renderPensar({ turnoId: "t2", fase: "pronto", cabecalho: { id: "pronto", texto: fraseDoPronto(12_000, { acoes: 0, falhas: 0 }) }, anuncio: "Respondeu", desde: null, contagem: { acoes: 0, falhas: 0 }, itens: [{ tipo: "nota", texto: "Pensei." }], tarefas: [], duracaoMs: 12_000 });
    expect(soPensou).toContain('<summary class="pensar-cab"><span class="fala-viva-estado">Pensou por 12 s</span>');
  });

  it("ADA-2 F5 (#290): o CSS da linha é 14 px --ink-3 sem fundo, e a › gira 90° ao abrir", () => {
    const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.pensar\[data-fase="pronto"\] > \.pensar-cab\.pensar-ferr \{[^}]*color: var\(--ink-3\); background: none; border: 0;/);
    expect(css).toMatch(/\.pensar-ferr \.fala-viva-estado \{ font-size: 14px;/);
    expect(css).toContain('.pensar[open] > .pensar-ferr .pensar-seta { transform: rotate(90deg); }');
  });

  it("esperaDaPessoa: a decisão pendente do turno diz aprovação ou resposta; vencida ou de outro turno, nada", () => {
    const item = (turnoId: string, tipo: string, estadoColuna = "pendente", estado = "pendente") => ({ decisao: { turnoId, tipo, estado }, estadoColuna }) as unknown as SuaVezDto["itens"][number];
    expect(esperaDaPessoa({ suaVez: { itens: [item("t1", "aprovacao")] } as never }, "t1")).toBe("Esperando sua aprovação");
    expect(esperaDaPessoa({ suaVez: { itens: [item("t1", "pergunta")] } as never }, "t1")).toBe("Esperando sua resposta");
    expect(esperaDaPessoa({ suaVez: { itens: [item("t2", "pergunta")] } as never }, "t1")).toBeNull();
    expect(esperaDaPessoa({ suaVez: { itens: [item("t1", "pergunta", "vencido")] } as never }, "t1")).toBeNull();
    expect(esperaDaPessoa({ suaVez: null }, "t1")).toBeNull();
  });
});

describe("Parte 3: os disparos do mascote (wink quando a fala entra, comet quando as frentes saem)", () => {
  it("comFrentesEm marca o instante em que as frentes saíram, uma vez", () => {
    const antes = usa(undefined, "Consultou Linear");
    const frentes = comFerramenta(antes, "Abriu frentes", { texto: "Abrindo frentes", frentes: true });
    const marcada = comFrentesEm(antes, frentes, 5000);
    expect(marcada.frentesEm).toBe(5000);
    // O frame seguinte das mesmas frentes não remarca.
    expect(comFrentesEm(marcada, { ...marcada }, 6000).frentesEm).toBe(5000);
    expect(comFrentesEm(undefined, antes, 5000).frentesEm).toBeUndefined();
    // Revisão do PR (27/10): a segunda frente aberta logo depois (outro `comFerramenta`) não apaga o instante — o comet
    // dura COMET_MS, não até o frame seguinte.
    const segunda = comFerramenta(marcada, "Abriu frentes", { texto: "Abrindo frentes", frentes: true });
    expect(comFrentesEm(marcada, segunda, 5200).frentesEm).toBe(5000);
  });

  it("proximaViradaDoMascote: o fim do wink e do comet redesenham a tela na hora", () => {
    const base = { turnosVivos: {}, falasSaindo: { c1: { "t1:100:0": { turno: {} as never, atividade: ATIVIDADE_VAZIA, em: 100 } } } };
    expect(proximaViradaDoMascote(base, 150)).toBe(100 + WINK_MS);
    const comFrentes = { turnosVivos: {}, atividades: { c1: { t2: { ...ATIVIDADE_VAZIA, frentesEm: 200 } } } };
    expect(proximaViradaDoMascote(comFrentes, 250)).toBe(200 + COMET_MS);
    expect(proximaViradaDoMascote(comFrentes, 200 + COMET_MS + 1)).toBeNull();
  });
});

describe("Parte 4: a fala da pergunta vem no frame decisao.nova", () => {
  const C = "c1";
  const AGORA = 1_000_000;
  const pergunta: Mensagem = { tenantId: "t", id: "mp", conversaId: C, turnoId: "t1", autoria: { autor_tipo: "agente", autor_id: "a" } as Mensagem["autoria"], kind: "texto", texto: "Qual horário eu marco?", payload: { kind: "pedido_a_pessoa", decisaoId: "d1", opcoes: ["Quinta, 10h", "Sexta, 9h"], recomendada: 0 }, confianca: "confiavel", parcial: false, criadoEm: AGORA };
  function comConversa(): Estado {
    const conversa: ConversaDto = { conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never, mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [] };
    return reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  }
  const frame = (dados: Record<string, unknown>) => ({ tipo: "frame", frame: { tipo: "decisao.nova", dados: { conversaId: C, turnoId: "t1", decisao_id: "d1", ...dados } }, agora: AGORA }) as never;

  it("mensagemDoFrame só aceita a fala de pergunta com a forma esperada", () => {
    expect(mensagemDoFrame(JSON.stringify(pergunta))).toEqual(pergunta);
    expect(mensagemDoFrame(JSON.stringify({ ...pergunta, payload: null }))).toBeNull();
    expect(mensagemDoFrame(JSON.stringify({ ...pergunta, kind: "sistema" }))).toBeNull();
    // Revisão de engenharia (27/10): sem a autoria a tela quebraria no render (`autoria.autor_tipo`).
    expect(mensagemDoFrame(JSON.stringify({ ...pergunta, autoria: undefined }))).toBeNull();
    // Revisão do PR (27/10): o cartão faz `.map` nas opções; fora de lista, nada entra (sem opções, entra).
    expect(mensagemDoFrame(JSON.stringify({ ...pergunta, payload: { ...pergunta.payload, opcoes: "x" } }))).toBeNull();
    expect(mensagemDoFrame(JSON.stringify({ ...pergunta, payload: { kind: "pedido_a_pessoa", decisaoId: "d1" } }))).not.toBeNull();
    expect(mensagemDoFrame("{não é json")).toBeNull();
    expect(mensagemDoFrame(undefined)).toBeNull();
    expect(mensagemDoFrame("x".repeat(64_001))).toBeNull();
  });

  it("a fala entra na conversa carregada, uma vez, e a releitura continua pedida; sem o campo (servidor de antes), só relê", () => {
    const e = reduzir(comConversa(), frame({ mensagem_json: JSON.stringify(pergunta) }));
    expect(e.conversas[C]?.mensagens.map((m) => m.id)).toEqual(["mp"]);
    expect(e.invalidacoes).toContain(`conversa:${C}`);
    expect(e.invalidacoes).toContain("sua-vez");
    const deNovo = reduzir(e, frame({ mensagem_json: JSON.stringify(pergunta) }));
    expect(deNovo.conversas[C]?.mensagens).toHaveLength(1);
    const antigo = reduzir(comConversa(), frame({}));
    expect(antigo.conversas[C]?.mensagens).toEqual([]);
    expect(antigo.invalidacoes).toContain(`conversa:${C}`);
    // Conversa que não está carregada: nada a inserir.
    expect(reduzir(estadoInicial, frame({ mensagem_json: JSON.stringify(pergunta) })).conversas).toEqual({});
  });
});
