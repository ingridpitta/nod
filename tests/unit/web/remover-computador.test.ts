import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import { JARGAO_PROIBIDO_REMOVER, type PreviaRemoverDto, type ResultadoRemoverDto } from "../../../src/contracts/remover-computador.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { nomeDaSecao, SECOES_ESPACO } from "../../../web/telas/espaco.ts";
import { iaConectadaEmTexto, renderMaquinas } from "../../../web/telas/maquinas.ts";
import { appEncerraNoFim, dialogoRemover, ITEM_PONTE_FALHOU, itensDaPonte, itensDoServidor, telaFimRemover, textoDeRemover, UI_REMOVER_INICIAL, type UiRemover } from "../../../web/telas/remover-computador.ts";

// Regression: nada pegava a tela deixando de mandar `daqui` (a chave não cairia na hora e a puxada limparia de novo).
// Found by /qa on 2026-11-08 (PR #694)
describe("QA do PR #694: a limpeza daqui vem antes do POST, e o POST vai com daqui:true", () => {
  it("api.removerComputador manda daqui:true só quando o app já se limpou", async () => {
    const { criarApi } = await vi.importActual<{ criarApi: (e: { tenantId: string; pessoaId: string }) => { removerComputador(id: string, o: { manterIas: boolean; manterConexao: boolean }, daqui?: boolean): Promise<unknown> } }>("../../../web/lib/api.ts");
    const corpos: unknown[] = [];
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/t/t1/maquinas/m1/remover");
      corpos.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      const api = criarApi({ tenantId: "t1", pessoaId: "p1" });
      await api.removerComputador("m1", { manterIas: false, manterConexao: true }, true);
      await api.removerComputador("m1", { manterIas: true, manterConexao: false });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(corpos).toEqual([{ manterIas: false, manterConexao: true, daqui: true }, { manterIas: true, manterConexao: false }]);
  });

  it("o rm-confirmar do web/main.ts chama a ponte antes do POST e passa daqui quando ela respondeu", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const i = main.indexOf('"rm-confirmar":');
    const corpo = main.slice(i, main.indexOf('"rm-fim-fechar":', i));
    const ponte = corpo.indexOf("await ponte.removerDaqui(opcoes)");
    const post = corpo.indexOf("await api.removerComputador(d.previa.id, opcoes, daPonte !== null)");
    expect(ponte).toBeGreaterThan(0);
    expect(post).toBeGreaterThan(ponte);
  });
});

describe("revisão do PR #694: o Fechar do Fim nunca fica preso", () => {
  it("só fica na tela quando a ponte confirma que o app encerra; senão a tela volta a Computadores", async () => {
    expect(await appEncerraNoFim(true, { fecharAposRemover: async () => true })).toBe(true);
    // A ponte recusou a limpeza (ocupado) e não encerra: antes o Fechar não fazia nada.
    expect(await appEncerraNoFim(true, { fecharAposRemover: async () => false })).toBe(false);
    expect(await appEncerraNoFim(true, { fecharAposRemover: async () => { throw new Error("origem_invalida"); } })).toBe(false);
    expect(await appEncerraNoFim(true, { fecharAposRemover: async () => undefined as never })).toBe(false);
    expect(await appEncerraNoFim(true, {})).toBe(false);
    expect(await appEncerraNoFim(true, undefined)).toBe(false);
    let chamou = false;
    expect(await appEncerraNoFim(false, { fecharAposRemover: async () => { chamou = true; return true; } })).toBe(false);
    expect(chamou).toBe(false);
  });

  it("o rm-fim-fechar do web/main.ts usa a regra e cai na volta a Computadores", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const i = main.indexOf('"rm-fim-fechar":');
    const corpo = main.slice(i, main.indexOf("}),", i));
    expect(corpo).toContain("if (await appEncerraNoFim(f?.aqui === true, window.nodDesktop)) return;");
    expect(corpo).toContain('dispatch({ tipo: "remover-ui", mudanca: { fim: null } });');
  });
});

/** ADA-245 (docs/specs/onboarding-jornada-d.md): Computadores (D1), o diálogo de remover (D2) e o Fim (D3). */
const maquina = (id: string, nome: string, o: Partial<MaquinaDto> = {}): MaquinaDto => ({ id, nome, prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: null, conectada: true, plataforma: "win32", ias: { "claude-cli": "pronto" }, gh: false, ...o });
const bot = (id: string, nome: string, maquinaId: string | null = null) => ({ id, nome, titulo: "Dev", ownerId: "p", cor: "c-red", forma: "shape-square", conversaId: `c-${id}`, maquinaId, excluidoEm: null });
const previa = (o: Partial<PreviaRemoverDto> = {}): PreviaRemoverDto => ({ id: "pc", nome: "PC da Ana", plataforma: "win32", online: true, ehPadrao: false, bots: [], assume: null, ...o });
const MAC = { id: "mac", nome: "MacBook de Ana" };

const PC = maquina("pc", "PC da Ana", { ultimoUsoEm: Date.UTC(2026, 10, 6, 22, 34) });
const MACBOOK = maquina("mac", "MacBook de Ana", { plataforma: "darwin", conectada: false, ultimoUsoEm: Date.UTC(2026, 10, 6, 22, 34) });

function com(ob: boolean, o: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial,
    onboardingTexto: ob,
    sessao: { tenantId: "t", pessoaId: "p" },
    maquinas: { maquinas: [PC, MACBOOK], padraoId: "pc" },
    chaves: [{ id: "pc", nome: "PC da Ana", prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: null, revogadaEm: null }],
    frota: { agentes: [bot("a", "Ze"), bot("b", "Clarice", "mac")] } as never,
    ...o,
  } as Estado;
}
const comMenu = (e: Estado, id: string): Estado => ({ ...e, contasUi: { ...e.contasUi, maquinaMenu: id } });
/** O texto que a pessoa lê (sem as tags e os atributos, que carregam data-maquina etc.). */
const texto = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("ADA-245 D2: textoDeRemover por estado (critério 4)", () => {
  it("sem bots, neste computador", () => {
    expect(textoDeRemover(previa(), { aqui: true })).toEqual({
      titulo: "Remover o nod deste computador?",
      texto: "O nod para de rodar aqui e tira o que instalou. Nenhum bot trabalha aqui. Seus bots e conversas continuam na sua conta.",
    });
  });

  it("N bots com quem assume nomeado (a frase da spec)", () => {
    expect(textoDeRemover(previa({ bots: ["Ze", "Clarice"], assume: MAC }), { aqui: true }).texto)
      .toContain("Os 2 bots daqui passam para o MacBook de Ana; se ele estiver desligado, esperam até um computador com IA conectar.");
  });

  it("1 bot com quem assume: singular e com o nome do bot", () => {
    expect(textoDeRemover(previa({ bots: ["Ze"], assume: MAC }), { aqui: true }).texto)
      .toContain("O bot daqui, Ze, passa para o MacBook de Ana; se ele estiver desligado, espera até um computador com IA conectar.");
  });

  it("é o padrão e não há outro computador: os bots esperam um computador", () => {
    const t = textoDeRemover(previa({ ehPadrao: true, bots: ["Ze", "Clarice", "Tuca"], assume: null }), { aqui: true }).texto;
    expect(t).toContain("Os 3 bots daqui esperam um computador");
    expect(t).not.toContain("passam para");
  });

  it("1 bot sem ninguém para assumir", () => {
    expect(textoDeRemover(previa({ bots: ["Ze"], assume: null }), { aqui: true }).texto).toContain("O bot daqui, Ze, espera um computador: volta a trabalhar");
  });

  it("outro computador, online: fala dele pelo nome e de \"lá\"", () => {
    const t = textoDeRemover(previa({ online: true, bots: ["Ze", "Clarice"], assume: { id: "pc2", nome: "Notebook" } }), { aqui: false }).texto;
    expect(t).toMatch(/^O nod para de rodar no PC da Ana e tira o que instalou lá\./);
    expect(t).toContain("Os 2 bots de lá passam para o Notebook");
  });

  it("outro computador, offline, \"Continuar ligado\": a limpeza acontece quando ele ligar", () => {
    const t = textoDeRemover(previa({ online: false }), { aqui: false, manterConexao: true }).texto;
    expect(t).toMatch(/^O PC da Ana está desligado agora: o nod tira o que instalou lá quando ele ligar de novo\./);
    expect(t).toContain("Nenhum bot trabalha lá.");
  });

  it("revisão: outro computador, offline, saindo da conta: não promete limpeza (o servidor revoga na hora e ele não puxa mais)", () => {
    const t = textoDeRemover(previa({ online: false }), { aqui: false, manterConexao: false }).texto;
    expect(t).toMatch(/^O PC da Ana está desligado agora: ele sai da sua conta já, e o que o nod instalou fica lá até você remover por ele\./);
    expect(t).not.toContain("quando ele ligar");
  });

  it("revisão: a caixa \"Continuar ligado\" reescreve o parágrafo do diálogo aberto (web/main.ts)", () => {
    const html = (manterConexao: boolean) => dialogoRemover({ dialogo: { previa: previa({ online: false }), aqui: false, manterIas: false, manterConexao, enviando: false, erro: null }, fim: null });
    expect(html(true)).toContain("quando ele ligar de novo");
    expect(html(false)).toContain("ele sai da sua conta já");
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const i = main.indexOf('if (cb.matches("[data-rm-caixa]"))');
    expect(main.slice(i, main.indexOf("return;", i))).toContain("textoDeRemover(");
  });
});

describe("ADA-245 D3: os itens do Fim a partir do servidor", () => {
  const r = (o: Partial<ResultadoRemoverDto> = {}): ResultadoRemoverDto => ({ ok: true, nome: "PC da Ana", bots: ["Ze", "Clarice"], assume: MAC, saiuDaConta: true, aguardandoComputador: false, ...o });
  const opcoes = { manterIas: false, manterConexao: false };

  it("computador desligado que vai se limpar (\"Continuar ligado\"): espera, \"vai se limpar quando ligar\"", () => {
    const itens = itensDoServidor(r({ aguardandoComputador: true, saiuDaConta: false }), { online: false, opcoes: { manterIas: false, manterConexao: true } });
    expect(itens[0]).toMatchObject({ estado: "espera", texto: "O PC da Ana vai se limpar quando ligar" });
    expect(itens.map((i) => i.texto)).toContain("2 bots passaram para o MacBook de Ana");
    expect(itens.at(-1)).toMatchObject({ estado: "mantido", texto: "O PC da Ana continua ligado à sua conta" });
  });

  it("\"Continuar ligado\": o computador continua na conta (mantido)", () => {
    const itens = itensDoServidor(r({ saiuDaConta: false, aguardandoComputador: true, bots: [] }), { online: true, opcoes: { manterIas: true, manterConexao: true } });
    expect(itens).toHaveLength(2);
    expect(itens[0]!.texto).toBe("O PC da Ana vai tirar o nod em instantes");
    expect(itens[1]).toMatchObject({ estado: "mantido", texto: "O PC da Ana continua ligado à sua conta" });
  });

  it("sem ninguém para assumir e sem limpeza possível", () => {
    const itens = itensDoServidor(r({ assume: null, bots: ["Ze"] }), { online: false, opcoes });
    expect(itens[0]!.estado).toBe("mantido");
    expect(itens[1]!.texto).toBe("1 bot espera um computador");
  });

  it("os itens da ponte do app vêm como estão", () => {
    expect(itensDaPonte([{ id: "parou", texto: "O nod parou de rodar aqui e foi removido", estado: "feito" }, { id: "ias", texto: "IAs mantidas", estado: "mantido" }]))
      .toEqual([{ estado: "feito", texto: "O nod parou de rodar aqui e foi removido" }, { estado: "mantido", texto: "IAs mantidas" }]);
  });
});

describe("ADA-245 D1: Computadores com a flag; sem ela, igual a antes", () => {
  it("com a flag: os títulos renomeados, as linhas com plataforma, bots, IA e status", () => {
    const html = renderMaquinas(com(true));
    for (const s of ["<h2>Computadores</h2>", "Computador padrão", "Seus computadores", "Conectar outro computador", "Qualquer um<", "Conectado", "Offline desde"]) expect(html).toContain(s);
    expect(texto(html)).toContain("Windows · 1 bot aqui, 1 pelo padrão · Claude conectado");
    expect(html).not.toContain("Máquinas");
  });

  it("com a flag: o e-mail da conta pronta no computador entra na linha", () => {
    const e = com(true, { contasIa: { disponivel: true, modo: "perguntar", contas: [{ id: "c1", ia: "claude-cli", email: "ana@padaria.com.br", maquinas: [{ maquinaId: "pc", nome: "PC da Ana", estado: "pronta" }] }] } as never });
    expect(iaConectadaEmTexto(e, PC)).toBe("Claude conectado como ana@padaria.com.br");
    expect(iaConectadaEmTexto(e, maquina("x", "x", { ias: {} }))).toBe("nenhuma IA conectada");
  });

  it("com a flag: o \"…\" sem a chave e com \"Remover o nod deste computador\"; \"Revogar chave\" fica nos Detalhes", () => {
    const menu = renderMaquinas(comMenu(com(true), "pc"));
    expect(menu).toContain('data-act="rm-abrir" data-maquina="pc"');
    expect(menu).toContain("Remover o nod deste computador");
    expect(menu).not.toContain("Detalhes da chave");
    expect(menu).not.toContain('data-act="revogar-chave"');
    expect(menu).not.toContain("Desconectar máquina");
    const detalhes = renderMaquinas({ ...com(true), configUi: { ...estadoInicial.configUi, abertos: ["chave-pc"] } });
    expect(detalhes).toContain('data-act="revogar-chave" data-id="pc"');
  });

  it("sem a flag: os textos de antes, sem nada da jornada D", () => {
    const html = renderMaquinas(comMenu(com(false), "pc"));
    for (const s of ["<h2>Máquinas</h2>", "Máquina padrão", "Suas máquinas", "Conectar outra máquina", "Qualquer uma<", "Detalhes da chave", "Desconectar máquina", 'data-act="revogar-chave"', "Gerar uma chave à mão"]) expect(html).toContain(s);
    for (const s of ["Computadores", "Seus computadores", "rm-abrir", "Remover o nod", "rm-dialogo", "Tornar padrão"]) expect(html).not.toContain(s);
    // O estado de remover sobrando (de uma sessão com a flag) não aparece sem ela.
    const sobrando = renderMaquinas({ ...com(false), removerUi: { dialogo: { previa: previa(), aqui: true, manterIas: false, manterConexao: false, enviando: false, erro: null }, fim: { maquinaId: "pc", nome: "PC", aqui: true, itens: [] } } });
    expect(sobrando).toContain("<h2>Máquinas</h2>");
    expect(sobrando).not.toContain("rm-");
  });

  it("o nome da seção nas Configurações segue a flag", () => {
    const s = SECOES_ESPACO.find((x) => x.id === "maquinas")!;
    expect(nomeDaSecao(s, { onboardingTexto: true })).toBe("Computadores");
    expect(nomeDaSecao(s, { onboardingTexto: false })).toBe("Máquinas");
  });

  it("o reducer liga a flag e guarda o estado do diálogo", () => {
    const e = reduzir(reduzir(estadoInicial, { tipo: "onboarding-texto", ligado: true }), { tipo: "remover-ui", mudanca: { fim: { maquinaId: "pc", nome: "PC", aqui: false, itens: [] } } });
    expect(e.onboardingTexto).toBe(true);
    expect(e.removerUi.fim?.nome).toBe("PC");
    expect(estadoInicial.onboardingTexto).toBe(false);
  });
});

describe("ADA-245 D2/D3: o diálogo e o Fim", () => {
  const ui = (o: Partial<NonNullable<UiRemover["dialogo"]>> = {}): UiRemover => ({ ...UI_REMOVER_INICIAL, dialogo: { previa: previa({ bots: ["Ze", "Clarice"], assume: MAC }), aqui: true, manterIas: false, manterConexao: false, enviando: false, erro: null, ...o } });

  it("aria-modal, foco no título ao abrir, as duas caixas (IAs ligada, conta desligada) e o botão vermelho", () => {
    const html = dialogoRemover(ui());
    expect(html).toContain('role="dialog" aria-modal="true" aria-labelledby="rm-titulo"');
    expect(html).toMatch(/<h3 id="rm-titulo" tabindex="-1" data-cl-autofoco>Remover o nod deste computador\?<\/h3>/);
    expect(html).toMatch(/data-rm-caixa="ias" checked/);
    expect(html).toMatch(/data-rm-caixa="conexao">/);
    expect(html).toContain("Seus logins neles são seus e ficam.");
    expect(html).toContain('class="bt perigo" data-act="rm-confirmar">Remover</button>');
    expect(html).toContain('data-act="rm-fechar"');
  });

  it("enviando: os botões ficam desligados; erro aparece no diálogo", () => {
    expect(dialogoRemover(ui({ enviando: true }))).toContain("Removendo…");
    expect(dialogoRemover(ui({ erro: "Não deu" }))).toContain('role="alert">Não deu</p>');
  });

  it("o Fim lista o que aconteceu, tem \"Fechar\" e não tem nada que feche sozinho", () => {
    const html = telaFimRemover({ dialogo: null, fim: { maquinaId: "pc", nome: "PC", aqui: true, itens: [{ estado: "feito", texto: "O nod parou de rodar aqui e foi removido" }, ITEM_PONTE_FALHOU] } });
    expect(html).toContain("O nod saiu, mas nem tudo deu certo.");
    expect(html).toContain('data-act="rm-fim-fechar">Fechar</button>');
    expect(html).toContain('class="rm-item rm-falhou"');
    expect(html).not.toMatch(/setTimeout|data-fecha-em/);
    // Com a flag, o Fim fica no lugar da seção.
    expect(renderMaquinas({ ...com(true), removerUi: { dialogo: null, fim: { maquinaId: "pc", nome: "PC", aqui: true, itens: [] } } })).toContain('class="espaco-secao cfg-secao rm-fim"');
  });
});

describe("ADA-245 critério 7: nenhum jargão nas três telas", () => {
  const casos: PreviaRemoverDto[] = [
    previa(),
    previa({ bots: ["Ze"], assume: MAC }),
    previa({ bots: ["Ze", "Clarice"], assume: MAC, ehPadrao: true }),
    previa({ bots: ["Ze", "Clarice"], assume: null, ehPadrao: true, online: false }),
  ];
  const resultados: ResultadoRemoverDto[] = [
    { ok: true, nome: "PC da Ana", bots: ["Ze"], assume: MAC, saiuDaConta: true, aguardandoComputador: true },
    { ok: true, nome: "PC da Ana", bots: [], assume: null, saiuDaConta: false, aguardandoComputador: false },
  ];

  it("D1 (lista e \"…\" aberto de cada computador), D2 (cada estado) e D3 (cada resultado)", () => {
    const telas: string[] = [];
    for (const id of ["pc", "mac"]) telas.push(renderMaquinas(comMenu(com(true), id)));
    for (const p of casos) for (const aqui of [true, false]) {
      telas.push(dialogoRemover({ dialogo: { previa: p, aqui, manterIas: false, manterConexao: false, enviando: false, erro: null }, fim: null }));
      telas.push(renderMaquinas({ ...com(true), removerUi: { dialogo: { previa: p, aqui, manterIas: true, manterConexao: true, enviando: false, erro: null }, fim: null } }));
    }
    for (const r of resultados) for (const online of [true, false]) for (const manterIas of [true, false]) {
      const itens = itensDoServidor(r, { online, opcoes: { manterIas, manterConexao: !r.saiuDaConta } });
      for (const aqui of [true, false]) telas.push(telaFimRemover({ dialogo: null, fim: { maquinaId: "pc", nome: r.nome, aqui, itens: [...itens, ITEM_PONTE_FALHOU] } }));
    }
    for (const html of telas) {
      const t = texto(html);
      expect(t, t.match(JARGAO_PROIBIDO_REMOVER)?.[0]).not.toMatch(JARGAO_PROIBIDO_REMOVER);
    }
  });
});
