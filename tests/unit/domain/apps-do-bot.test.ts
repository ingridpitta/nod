import { describe, expect, it } from "vitest";
import {
  appDaPagina, appPedeVoce, cabeMaisUmApp, chaveDoNome, descreverPedeQuando, estadoDoApp, homeDoBot, idDaPaginaDoApp, itensComPede, LIMITE_DE_APPS,
  MAX_ORDEM_GUARDADA, moverPagina, moverRelativo, normalizarPedeQuando, normalizarRetrato, ordemParaGravar, ordemQueVale, paginasPadrao, validarNome,
} from "../../../src/domain/apps-do-bot.ts";

describe("apps do bot (NOD-445): nome", () => {
  it("ignora maiúsculas, acentos e espaços para o duplicado", () => {
    expect(chaveDoNome("  Vágas   Abertas ")).toBe("vagas abertas");
    expect(validarNome("VAGAS", [{ id: "a", nome: "vagas" }])).toEqual({ ok: false, motivo: "duplicado", sugestao: "VAGAS 2" });
    expect(validarNome("Vágas", [{ id: "a", nome: "Vagas" }, { id: "b", nome: "Vagas 2" }])).toMatchObject({ motivo: "duplicado", sugestao: "Vágas 3" });
  });
  it("as páginas fixas também contam", () => {
    expect(validarNome("tarefas", [])).toMatchObject({ ok: false, motivo: "duplicado" });
    expect(validarNome("Conversa", [])).toMatchObject({ ok: false, motivo: "duplicado" });
    // Revisão 2 do #626: "quadro" é o apelido de Tarefas no chat; um app com esse nome ficaria inalcançável por lá.
    expect(validarNome("Quadro", [])).toEqual({ ok: false, motivo: "duplicado", sugestao: "Quadro 2" });
    expect(validarNome("canvas", [])).toEqual({ ok: false, motivo: "duplicado", sugestao: "canvas 2" }); // #649 revisão 4: a página do app Canvas
    expect(validarNome(" QUÁDRO ", [])).toMatchObject({ ok: false, motivo: "duplicado" });
  });
  it("de 1 a 20 caracteres, aparado; renomear o próprio app não é duplicado", () => {
    expect(validarNome("   ", [])).toEqual({ ok: false, motivo: "vazio" });
    expect(validarNome("x".repeat(21), [])).toEqual({ ok: false, motivo: "longo" });
    expect(validarNome(` ${"x".repeat(20)} `, [])).toEqual({ ok: true, nome: "x".repeat(20) });
    expect(validarNome("Vagas", [{ id: "a", nome: "vagas" }], "a")).toEqual({ ok: true, nome: "Vagas" });
  });
  it("a sugestão cabe em 20 caracteres", () => {
    const r = validarNome("x".repeat(20), [{ nome: "x".repeat(20) }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect([...(r.sugestao ?? "")].length).toBeLessThanOrEqual(20);
  });
});

describe("apps do bot: limite de 12 páginas (a vaga de Tarefas fica reservada)", () => {
  it("até 11 apps, com ou sem Tarefas: o quadro criado depois nunca leva o bot a 13 páginas (revisão 3 do #626)", () => {
    expect(LIMITE_DE_APPS).toBe(12);
    expect(cabeMaisUmApp({ apps: 10 })).toBe(true);
    expect(cabeMaisUmApp({ apps: 11 })).toBe(false);
    expect(cabeMaisUmApp({ apps: 12 })).toBe(false);
  });
});

describe("apps do bot: ordem das páginas", () => {
  const apps = [{ id: "b", criadoEm: 2 }, { id: "a", criadoEm: 1 }];
  const padrao = paginasPadrao({ temTarefas: true, apps });
  it("a padrão: Conversa, Tarefas e os apps na ordem de criação", () => {
    expect(padrao).toEqual(["conversa", "tarefas", "app:a", "app:b"]);
    expect(paginasPadrao({ temTarefas: false, apps: [] })).toEqual(["conversa"]);
  });
  it("dois apps criados no mesmo milissegundo ficam na ordem em que o banco os devolveu (não por id)", () => {
    // CI em máquina rápida (2026-11-04): "Vagas" e "Leituras" nasciam no mesmo ms e o desempate por id (aleatório)
    // trocava a ordem entre bots. O banco ordena por microssegundo e id; o domínio só respeita.
    const mesmoMs = [{ id: "zzz", criadoEm: 5 }, { id: "aaa", criadoEm: 5 }];
    expect(paginasPadrao({ temTarefas: false, apps: mesmoMs })).toEqual(["conversa", "app:zzz", "app:aaa"]);
  });
  it("ADA-13: o Canvas entra depois de Tarefas no bot com acesso, e a ordem guardada antiga o recebe no fim", () => {
    expect(paginasPadrao({ temTarefas: true, temCanvas: true, apps })).toEqual(["conversa", "tarefas", "canvas", "app:a", "app:b"]);
    expect(paginasPadrao({ temTarefas: false, temCanvas: true, apps: [] })).toEqual(["conversa", "canvas"]);
    expect(ordemQueVale(["app:b", "conversa"], paginasPadrao({ temTarefas: false, temCanvas: true, apps }))).toEqual(["app:b", "conversa", "canvas", "app:a"]);
  });
  it("a guardada vale; o que sumiu sai, o que é novo entra no fim; a Conversa nunca some", () => {
    expect(ordemQueVale(["tarefas", "conversa", "app:x", "tarefas"], padrao)).toEqual(["tarefas", "conversa", "app:a", "app:b"]);
    expect(ordemQueVale(["app:b", "tarefas"], padrao)).toEqual(["conversa", "app:b", "tarefas", "app:a"]);
    expect(ordemQueVale(null, padrao)).toEqual(padrao);
  });
  it("mover qualquer página, inclusive a Conversa; a primeira é a home", () => {
    const o = moverPagina(padrao, "tarefas", 0);
    expect(o).toEqual(["tarefas", "conversa", "app:a", "app:b"]);
    expect(homeDoBot(o)).toBe("tarefas");
    expect(moverPagina(padrao, "conversa", 99)).toEqual(["tarefas", "app:a", "app:b", "conversa"]);
    expect(moverPagina(padrao, "nao-existe", 0)).toEqual(padrao);
    expect(moverRelativo(padrao, "tarefas", "conversa", "antes")).toEqual(["tarefas", "conversa", "app:a", "app:b"]);
    expect(moverRelativo(padrao, "conversa", "app:b", "depois")).toEqual(["tarefas", "app:a", "app:b", "conversa"]);
    expect(homeDoBot([])).toBe("conversa");
  });
  it("id da página do app", () => {
    expect(appDaPagina(idDaPaginaDoApp("u1"))).toBe("u1");
    expect(appDaPagina("tarefas")).toBeNull();
    expect(appDaPagina("app:")).toBeNull();
  });
});

describe("apps do bot: pede você e estados", () => {
  const base = { regraPede: "vaga sem resposta há 2 dias", pedeQuando: null, erroFonte: null, dados: { itens: [{ titulo: "Dev", pede: true }] } };
  const agora = Date.parse("2026-11-02T12:00:00Z");
  it("só com regra e com item marcado; com a fonte em erro, não acende", () => {
    expect(appPedeVoce(base, agora)).toBe(true);
    expect(appPedeVoce({ ...base, regraPede: null }, agora)).toBe(false);
    expect(appPedeVoce({ ...base, regraPede: "  " }, agora)).toBe(false);
    expect(appPedeVoce({ ...base, erroFonte: "conector revogado" }, agora)).toBe(false);
    expect(appPedeVoce({ ...base, dados: { itens: [{ titulo: "Dev" }] } }, agora)).toBe(false);
  });
  it("erro, vazio ou pronto", () => {
    expect(estadoDoApp({ forma: "lista", erroFonte: "sumiu", dados: null })).toBe("erro");
    expect(estadoDoApp({ forma: "lista", erroFonte: null, dados: null })).toBe("vazio");
    expect(estadoDoApp({ forma: "lista", erroFonte: null, dados: { itens: [] } })).toBe("vazio");
    expect(estadoDoApp({ forma: "doc", erroFonte: null, dados: { itens: [], texto: "# oi" } })).toBe("pronto");
    expect(estadoDoApp({ forma: "quadro", erroFonte: null, dados: { itens: [{ titulo: "a" }] } })).toBe("pronto");
    expect(estadoDoApp({ forma: "doc", erroFonte: null, dados: { itens: [{ titulo: "a" }] } })).toBe("pronto");
    expect(estadoDoApp({ forma: "lista", erroFonte: null, dados: { itens: [], texto: "solto" } })).toBe("vazio");
  });
  it("normaliza o retrato do bot", () => {
    expect(normalizarRetrato(null)).toBeNull();
    expect(normalizarRetrato({ itens: [{ titulo: " a ", pede: "sim", extra: 1 }, { titulo: "" }, 3], texto: " t " })).toEqual({ itens: [{ titulo: "a" }], texto: "t" });
    expect(normalizarRetrato({ itens: Array.from({ length: 500 }, (_, i) => ({ titulo: `i${i}` })) })?.itens).toHaveLength(200);
  });
});

describe("apps do bot (revisão 1 do #626): a ordem a gravar guarda o lugar dos removidos", () => {
  it("o removido volta logo depois da página que vinha antes dele; sem nenhuma antes, no começo", () => {
    expect(ordemParaGravar(["app:a", "conversa", "app:c"], ["conversa", "app:a", "app:b", "app:c"], ["app:b"])).toEqual(["app:a", "app:b", "conversa", "app:c"]);
    expect(ordemParaGravar(["conversa", "app:c"], ["app:b", "conversa", "app:c"], ["app:b"])).toEqual(["app:b", "conversa", "app:c"]);
    // Um id da guardada que não é mais de app removido (apagado de vez) sai.
    expect(ordemParaGravar(["conversa"], ["conversa", "app:x"], [])).toEqual(["conversa"]);
  });

  it("revisão 2 do #626: sem ordem guardada, a referência do lugar dos removidos é a ordem padrão com eles dentro", () => {
    const padrao = ["conversa", "tarefas", "app:a", "app:b", "app:c"];
    expect(ordemParaGravar(["app:a", "conversa", "tarefas", "app:c"], null, ["app:b"], padrao)).toEqual(["app:a", "app:b", "conversa", "tarefas", "app:c"]);
    // O removido que era o primeiro app da padrão, sem página viva antes dele na padrão além das fixas.
    expect(ordemParaGravar(["tarefas", "conversa", "app:b"], null, ["app:a"], ["conversa", "tarefas", "app:a", "app:b"])).toEqual(["tarefas", "app:a", "conversa", "app:b"]);
  });

  it("no teto de 20 só saem removidos, os mais antigos primeiro; página viva e a Conversa nunca", () => {
    const vivos = ["app:v0", "conversa", ...Array.from({ length: 12 }, (_, i) => `app:v${i + 1}`)];
    const removidos = Array.from({ length: 9 }, (_, i) => `app:r${i}`);
    const r = ordemParaGravar(vivos, ["app:v0", "conversa", ...removidos], removidos);
    expect(r).toHaveLength(MAX_ORDEM_GUARDADA);
    expect(r.filter((x) => vivos.includes(x))).toEqual(vivos);
    expect(r).not.toContain("app:r6");
    expect(r).toContain("app:r0");
  });
});

describe("apps do bot (revisão 7 do #626): o pede você calculado no servidor pela regra estruturada", () => {
  const DIA = 86_400_000;
  const agora = Date.parse("2026-11-02T12:00:00Z");
  const haDias = (n: number) => new Date(agora - n * DIA).toISOString();
  const regra = { coluna: "Sem resposta", dias_desde: 2 };
  const itens = [
    { titulo: "Dev", coluna: "sem resposta", desde: haDias(3) },
    { titulo: "Design", coluna: "Sem resposta", desde: haDias(1) },
    // O bot (ou um texto de fora) marcou `pede`: com a regra estruturada, a marca dele não vale.
    { titulo: "QA", coluna: "Respondida", desde: haDias(5), pede: true },
  ];
  const app = { regraPede: "vaga sem resposta há 2 dias", pedeQuando: regra, erroFonte: null, dados: { itens } };

  it("a regra decide item a item, sem a marca do bot; o tempo passa sem regravar o retrato", () => {
    expect(itensComPede(app, agora).map((i) => [i.titulo, i.pede === true])).toEqual([["Dev", true], ["Design", false], ["QA", false]]);
    expect(appPedeVoce(app, agora)).toBe(true);
    expect(appPedeVoce({ ...app, dados: { itens: itens.slice(1) } }, agora)).toBe(false);
    // Dois dias depois, o Design também pede.
    expect(appPedeVoce({ ...app, dados: { itens: itens.slice(1) } }, agora + 2 * DIA)).toBe(true);
    // Fonte em erro segue apagando.
    expect(appPedeVoce({ ...app, erroFonte: "conector revogado" }, agora)).toBe(false);
  });

  it("valor acima ou abaixo (número do item, com vírgula decimal) e item sem o campo não pede", () => {
    const contas = { regraPede: "conta alta", erroFonte: null, pedeQuando: { valor_acima: 1000 }, dados: { itens: [{ titulo: "Luz", valor: "R$ 1.200,50" }, { titulo: "Água", valor: "90" }, { titulo: "Gás" }] } };
    expect(itensComPede(contas, agora).map((i) => i.pede === true)).toEqual([true, false, false]);
    expect(itensComPede({ ...contas, pedeQuando: { valor_abaixo: 100 } }, agora).map((i) => i.pede === true)).toEqual([false, true, false]);
  });

  it("QA do #626: sem regra em texto, a estruturada não acende (nem a marca do bot)", () => {
    for (const regraPede of [null, "", "   "]) {
      const semRegra = { ...app, regraPede };
      expect(itensComPede(semRegra, agora).some((i) => i.pede === true)).toBe(false);
      expect(appPedeVoce(semRegra, agora)).toBe(false);
    }
  });

  it("QA do #626 (mutante): exatamente N dias ainda não é \"há mais de N dias\"; um milissegundo a mais já é", () => {
    const so = (desde: string) => itensComPede({ ...app, pedeQuando: { dias_desde: 2 }, dados: { itens: [{ titulo: "x", desde }] } }, agora)[0]?.pede === true;
    expect(so(haDias(2))).toBe(false);
    expect(so(new Date(agora - 2 * DIA - 1).toISOString())).toBe(true);
    expect(so(new Date(agora - 2 * DIA + 1).toISOString())).toBe(false);
  });

  it("QA do #626 (mutante): valor igual ao limite não está acima nem abaixo dele", () => {
    const so = (pedeQuando: { valor_acima?: number; valor_abaixo?: number }, valor: string) => itensComPede({ ...app, pedeQuando, dados: { itens: [{ titulo: "x", valor }] } }, agora)[0]?.pede === true;
    expect(so({ valor_acima: 1000 }, "1000")).toBe(false);
    expect(so({ valor_acima: 1000 }, "1000,01")).toBe(true);
    expect(so({ valor_abaixo: 100 }, "100")).toBe(false);
    expect(so({ valor_abaixo: 100 }, "99,99")).toBe(true);
  });

  it("valida a regra: ao menos uma condição, números finitos; descreve em português", () => {
    expect(normalizarPedeQuando({ coluna: " Sem resposta ", dias_desde: 2, extra: 1 })).toEqual({ coluna: "Sem resposta", dias_desde: 2 });
    expect(normalizarPedeQuando(null)).toBeNull();
    expect(normalizarPedeQuando({})).toBe(false);
    expect(normalizarPedeQuando({ dias_desde: -1 })).toBe(false);
    expect(normalizarPedeQuando({ valor_acima: "10" })).toBe(false);
    expect(descreverPedeQuando({ coluna: "Sem resposta", dias_desde: 2 })).toBe("coluna Sem resposta e há mais de 2 dias");
    // A data do item no retrato: só data válida, guardada em ISO.
    expect(normalizarRetrato({ itens: [{ titulo: "a", desde: "2026-10-30" }, { titulo: "b", desde: "ontem" }] })?.itens).toEqual([{ titulo: "a", desde: "2026-10-30T00:00:00.000Z" }, { titulo: "b" }]);
  });
});
