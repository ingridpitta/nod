import { describe, expect, it } from "vitest";
import { alvoDoAtalho, alvoVizinho, atalhoDoNovoBot, atalhoDoTeclado, campoTemTexto, indiceDoBot, linhasAVista, linhasDaFolha, lugarDoTeclado, SELETOR_CAMPO, setaDaPilula, SELETOR_MODAL, type ContextoTecla, type ElementoDeCampo, type LugarTeclado, type Tecla } from "../../../web/lib/atalhos.ts";

const tecla = (code: string, key: string, mods: Partial<Tecla> = {}): Tecla => ({ code, key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
const ctx = (lugar: LugarTeclado, extra: Partial<ContextoTecla> = {}): ContextoTecla => ({ lugar, emCampo: false, dialogo: false, celular: false, ...extra });
const MOD: Record<LugarTeclado, Partial<Tecla>> = { "app-mac": { metaKey: true }, "navegador-mac": { ctrlKey: true }, outro: { altKey: true } };
const LUGARES: LugarTeclado[] = ["app-mac", "navegador-mac", "outro"];

describe("NOD-117: lugar do teclado", () => {
  it("app do Mac, navegador no Mac e o resto", () => {
    expect(lugarDoTeclado({ desktop: true, plataforma: "MacIntel" })).toBe("app-mac");
    expect(lugarDoTeclado({ desktop: false, plataforma: "MacIntel" })).toBe("navegador-mac");
    expect(lugarDoTeclado({ desktop: false, plataforma: "Win32" })).toBe("outro");
    expect(lugarDoTeclado({ desktop: false, plataforma: "Linux x86_64" })).toBe("outro");
    expect(lugarDoTeclado({ desktop: true, plataforma: "Win32" })).toBe("outro");
  });
});

describe("NOD-117: atalhoDoTeclado", () => {
  it("Novo bot: ⌘N no app, ⌃N no navegador do Mac, Alt+N no Windows", () => {
    expect(atalhoDoTeclado(tecla("KeyN", "n", { metaKey: true }), ctx("app-mac"))).toEqual({ tipo: "novo-bot" });
    expect(atalhoDoTeclado(tecla("KeyN", "n", { ctrlKey: true }), ctx("navegador-mac"))).toEqual({ tipo: "novo-bot" });
    expect(atalhoDoTeclado(tecla("KeyN", "ñ", { altKey: true }), ctx("outro"))).toEqual({ tipo: "novo-bot" });
  });

  it("o modificador de outro lugar não age (⌘N no navegador é do navegador)", () => {
    expect(atalhoDoTeclado(tecla("KeyN", "n", { metaKey: true }), ctx("navegador-mac"))).toBeNull();
    expect(atalhoDoTeclado(tecla("KeyN", "n", { ctrlKey: true }), ctx("app-mac"))).toBeNull();
    expect(atalhoDoTeclado(tecla("KeyN", "n", { ctrlKey: true }), ctx("outro"))).toBeNull();
    expect(atalhoDoTeclado(tecla("KeyN", "n"), ctx("app-mac"))).toBeNull();
  });

  it("AltGr (Ctrl+Alt) no Windows não é Alt", () => {
    expect(atalhoDoTeclado(tecla("Digit2", "@", { altKey: true, ctrlKey: true }), ctx("outro"))).toBeNull();
  });

  it.each(LUGARES)("ir ao bot 1–9 pelo código físico (%s)", (lugar) => {
    for (let n = 1; n <= 9; n++) expect(atalhoDoTeclado(tecla(`Digit${n}`, String(n), MOD[lugar]), ctx(lugar))).toEqual({ tipo: "ir-ao-bot", n });
    expect(atalhoDoTeclado(tecla("Digit0", "0", MOD[lugar]), ctx(lugar))).toBeNull();
    expect(atalhoDoTeclado(tecla("Digit2", "@", { ...MOD[lugar], shiftKey: true }), ctx(lugar))).toBeNull();
  });

  it.each(LUGARES)("anterior e próximo com Shift e colchete (%s)", (lugar) => {
    const m = { ...MOD[lugar], shiftKey: true };
    expect(atalhoDoTeclado(tecla("BracketLeft", "{", m), ctx(lugar))).toEqual({ tipo: "vizinho", passo: -1 });
    expect(atalhoDoTeclado(tecla("BracketRight", "}", m), ctx(lugar))).toEqual({ tipo: "vizinho", passo: 1 });
  });

  it.each(LUGARES)("sem Shift, ⌘[ é voltar do navegador/app: não é nosso sem páginas na pílula (%s)", (lugar) => {
    // Experimento desligado, outra tela ou o bot só com a Conversa: o navegador (ou o app) fica com a tecla.
    expect(atalhoDoTeclado(tecla("BracketLeft", "[", MOD[lugar]), ctx(lugar))).toBeNull();
    expect(atalhoDoTeclado(tecla("BracketRight", "]", MOD[lugar]), ctx(lugar, { paginas: 0 }))).toBeNull();
    expect(atalhoDoTeclado(tecla("BracketLeft", "[", MOD[lugar]), ctx(lugar, { paginas: 1 }))).toBeNull();
  });

  it.each(LUGARES)("NOD-445: sem Shift, com mais de uma página, o colchete anda pelas páginas da pílula (%s)", (lugar) => {
    const c = ctx(lugar, { paginas: 3 });
    expect(atalhoDoTeclado(tecla("BracketLeft", "[", MOD[lugar]), c)).toEqual({ tipo: "pagina", passo: -1 });
    expect(atalhoDoTeclado(tecla("BracketRight", "]", MOD[lugar]), c)).toEqual({ tipo: "pagina", passo: 1 });
    // No ABNT2 o "[" fica na BracketRight: vale o caractere.
    expect(atalhoDoTeclado(tecla("BracketRight", "[", MOD[lugar]), c)).toEqual({ tipo: "pagina", passo: -1 });
    // Ditando ou num diálogo, não.
    expect(atalhoDoTeclado(tecla("BracketLeft", "[", MOD[lugar]), { ...c, ditando: true })).toBeNull();
    // Com Shift continua sendo o bot vizinho, com ou sem páginas.
    expect(atalhoDoTeclado(tecla("BracketLeft", "{", { ...MOD[lugar], shiftKey: true }), c)).toEqual({ tipo: "vizinho", passo: -1 });
  });

  it("colchete no ABNT2: vale o caractere, não a posição", () => {
    // No ABNT2 a tecla do "[" é BracketRight e a do "´" é BracketLeft.
    expect(atalhoDoTeclado(tecla("BracketRight", "{", { metaKey: true, shiftKey: true }), ctx("app-mac"))).toEqual({ tipo: "vizinho", passo: -1 });
    expect(atalhoDoTeclado(tecla("Backslash", "}", { metaKey: true, shiftKey: true }), ctx("app-mac"))).toEqual({ tipo: "vizinho", passo: 1 });
    // Com Alt (Windows/Linux, layout alemão…) o caractere pode vir outro; aí vale a posição.
    expect(atalhoDoTeclado(tecla("BracketLeft", "”", { altKey: true, shiftKey: true }), ctx("outro"))).toEqual({ tipo: "vizinho", passo: -1 });
  });

  it("? fora de campo abre a folha; no campo escreve", () => {
    const q = tecla("Slash", "?", { shiftKey: true });
    for (const lugar of LUGARES) {
      expect(atalhoDoTeclado(q, ctx(lugar))).toEqual({ tipo: "folha" });
      expect(atalhoDoTeclado(q, ctx(lugar, { emCampo: true }))).toBeNull();
    }
  });

  it("⌘/ (⌃/ no navegador do Mac, Ctrl+/ fora) abre a folha mesmo no campo", () => {
    expect(atalhoDoTeclado(tecla("Slash", "/", { metaKey: true }), ctx("app-mac", { emCampo: true }))).toEqual({ tipo: "folha" });
    expect(atalhoDoTeclado(tecla("Slash", "/", { ctrlKey: true }), ctx("navegador-mac", { emCampo: true }))).toEqual({ tipo: "folha" });
    expect(atalhoDoTeclado(tecla("Slash", "/", { ctrlKey: true }), ctx("outro", { emCampo: true }))).toEqual({ tipo: "folha" });
    expect(atalhoDoTeclado(tecla("Slash", "/", { altKey: true }), ctx("outro"))).toBeNull();
    // ABNT2: a barra sai de outra tecla.
    expect(atalhoDoTeclado(tecla("IntlRo", "/", { metaKey: true }), ctx("app-mac"))).toEqual({ tipo: "folha" });
  });

  it("na posição Slash de outro layout (DE: \"-\", ABNT2: \";\") não é a folha: Ctrl+- segue sendo o zoom", () => {
    expect(atalhoDoTeclado(tecla("Slash", "-", { ctrlKey: true }), ctx("outro"))).toBeNull();
    expect(atalhoDoTeclado(tecla("Slash", "-", { metaKey: true }), ctx("app-mac"))).toBeNull();
    expect(atalhoDoTeclado(tecla("Slash", ";", { ctrlKey: true }), ctx("navegador-mac"))).toBeNull();
    // Sem caractere (tecla morta), vale a posição.
    expect(atalhoDoTeclado(tecla("Slash", "Dead", { ctrlKey: true }), ctx("outro"))).toEqual({ tipo: "folha" });
  });

  it("com Seu espaço aberto, só a folha e fora de campo; ditando, nada (nem a folha)", () => {
    for (const extra of [{ espaco: true }, { ditando: true }]) {
      expect(atalhoDoTeclado(tecla("KeyN", "n", { metaKey: true }), ctx("app-mac", extra))).toBeNull();
      expect(atalhoDoTeclado(tecla("Digit2", "2", { metaKey: true }), ctx("app-mac", extra))).toBeNull();
      expect(atalhoDoTeclado(tecla("BracketRight", "}", { metaKey: true, shiftKey: true }), ctx("app-mac", extra))).toBeNull();
    }
    expect(atalhoDoTeclado(tecla("Slash", "/", { metaKey: true }), ctx("app-mac", { espaco: true }))).toEqual({ tipo: "folha" });
    expect(atalhoDoTeclado(tecla("Slash", "/", { metaKey: true }), ctx("app-mac", { espaco: true, emCampo: true }))).toBeNull();
    expect(atalhoDoTeclado(tecla("Slash", "/", { metaKey: true }), ctx("app-mac", { ditando: true }))).toBeNull();
    expect(atalhoDoTeclado(tecla("Slash", "?", { shiftKey: true }), ctx("app-mac", { ditando: true }))).toBeNull();
  });

  it("editando na gaveta, só a folha age", () => {
    expect(atalhoDoTeclado(tecla("Digit1", "1", { metaKey: true }), ctx("app-mac", { emCampo: true, editando: true }))).toBeNull();
    expect(atalhoDoTeclado(tecla("KeyN", "n", { metaKey: true }), ctx("app-mac", { emCampo: true, editando: true }))).toBeNull();
    expect(atalhoDoTeclado(tecla("Slash", "/", { metaKey: true }), ctx("app-mac", { emCampo: true, editando: true }))).toEqual({ tipo: "folha" });
    // No composer (campo, mas não edição da gaveta) ⌘1 vai ao bot.
    expect(atalhoDoTeclado(tecla("Digit1", "1", { metaKey: true }), ctx("app-mac", { emCampo: true }))).toEqual({ tipo: "ir-ao-bot", n: 1 });
  });

  it("keydown sem key (autofill do Chrome) não quebra", () => {
    const semKey: Tecla = { ...tecla("", ""), key: undefined };
    expect(atalhoDoTeclado(semKey, ctx("app-mac"))).toBeNull();
    expect(atalhoDoTeclado({ ...semKey, ctrlKey: true }, ctx("outro"))).toBeNull();
  });

  it("nada age com diálogo aberto, compondo (IME), repetindo ou no celular", () => {
    const n = tecla("KeyN", "n", { metaKey: true });
    const q = tecla("Slash", "?", { shiftKey: true });
    for (const t of [n, q, tecla("Slash", "/", { metaKey: true }), tecla("Digit1", "1", { metaKey: true })]) {
      expect(atalhoDoTeclado(t, ctx("app-mac", { dialogo: true }))).toBeNull();
      expect(atalhoDoTeclado(t, ctx("app-mac", { celular: true }))).toBeNull();
      expect(atalhoDoTeclado({ ...t, isComposing: true }, ctx("app-mac"))).toBeNull();
      expect(atalhoDoTeclado({ ...t, keyCode: 229 }, ctx("app-mac"))).toBeNull();
      expect(atalhoDoTeclado({ ...t, repeat: true }, ctx("app-mac"))).toBeNull();
    }
  });

  it("⌘K e ⌘⇧D não são pegos aqui (seguem no handler de antes)", () => {
    for (const lugar of LUGARES) {
      for (const mods of [{ metaKey: true }, { ctrlKey: true }]) {
        expect(atalhoDoTeclado(tecla("KeyK", "k", mods), ctx(lugar))).toBeNull();
        expect(atalhoDoTeclado(tecla("KeyD", "D", { ...mods, shiftKey: true }), ctx(lugar))).toBeNull();
      }
    }
  });
});

describe("NOD-117: bots que contam na barra", () => {
  const l = (id: string, o: Partial<{ escondida: boolean; oculta: boolean }> = {}) => ({ id, escondida: false, oculta: false, ...o });

  it("o bot que a seção recolhida esconde não recebe número; o que ela deixa à vista recebe", () => {
    const linhas = [l("fixado"), l("meu"), l("recolhido", { escondida: true }), l("recolhido-aberto"), l("equipe")];
    expect(linhasAVista(linhas, false).map((x) => x.id)).toEqual(["fixado", "meu", "recolhido-aberto", "equipe"]);
  });

  it("buscando, conta o que a busca mostra (inclusive o escondido pela seção recolhida), não o que ela esconde", () => {
    const linhas = [l("a", { oculta: true }), l("b", { escondida: true }), l("c"), l("d", { escondida: true, oculta: true })];
    expect(linhasAVista(linhas, true).map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("o seletor de campo deixa caixa de marcar e rádio de fora; o de diálogo pega popovers e deixa o Raio-X", () => {
    expect(SELETOR_CAMPO).toMatch(/input:not\([^)]*\[type='checkbox'\][^)]*\[type='radio'\]/);
    expect(SELETOR_CAMPO).toContain("textarea");
    expect(SELETOR_CAMPO).toContain("[contenteditable]:not([contenteditable='false'])");
    expect(SELETOR_MODAL.split(", ")).toEqual(["dialog[open]:not(.raio-x)", '[role="dialog"]:not(.cfg-espaco)']);
  });
});

describe("NOD-117: alvoDoAtalho (a barra inteira)", () => {
  type L = { escondida: boolean; oculta: boolean; atual: boolean };
  const l = (o: Partial<L> = {}): L => ({ escondida: false, oculta: false, atual: false, ...o });

  it("⌘2 pula o escondido pela seção recolhida e o que a busca tirou, e devolve o índice na barra inteira", () => {
    const barra = [l(), l({ escondida: true }), l({ oculta: true }), l(), l()];
    expect(alvoDoAtalho(barra, { tipo: "ir-ao-bot", n: 2 }, false)).toBe(3);
    expect(alvoDoAtalho(barra, { tipo: "ir-ao-bot", n: 3 }, false)).toBe(4);
    expect(alvoDoAtalho(barra, { tipo: "ir-ao-bot", n: 4 }, false)).toBeNull();
    // Buscando, o escondido que casa conta.
    expect(alvoDoAtalho(barra, { tipo: "ir-ao-bot", n: 2 }, true)).toBe(1);
  });

  it("vizinho a partir do atual (aria-current), dando a volta e pulando o que não conta", () => {
    const barra = [l(), l({ escondida: true }), l(), l({ atual: true })];
    expect(alvoDoAtalho(barra, { tipo: "vizinho", passo: 1 }, false)).toBe(0);
    expect(alvoDoAtalho(barra, { tipo: "vizinho", passo: -1 }, false)).toBe(2);
    const primeiro = [l({ atual: true }), l({ escondida: true }), l()];
    expect(alvoDoAtalho(primeiro, { tipo: "vizinho", passo: -1 }, false)).toBe(2);
  });

  it("atual na seção recolhida (à vista por ser a conversa aberta) conta como os outros", () => {
    const barra = [l(), l({ escondida: true }), l({ atual: true }), l()];
    expect(alvoDoAtalho(barra, { tipo: "vizinho", passo: 1 }, false)).toBe(3);
    expect(alvoDoAtalho(barra, { tipo: "vizinho", passo: -1 }, false)).toBe(0);
    expect(alvoDoAtalho(barra, { tipo: "ir-ao-bot", n: 2 }, false)).toBe(2);
  });

  it("barra vazia: sem alvo", () => {
    expect(alvoDoAtalho([], { tipo: "vizinho", passo: 1 }, false)).toBeNull();
    expect(alvoDoAtalho([l({ oculta: true })], { tipo: "ir-ao-bot", n: 1 }, true)).toBeNull();
  });
});

describe("NOD-117: índice e vizinho", () => {
  it("⌘2 é o 2º; com 3 bots, ⌘5 não tem alvo", () => {
    expect(indiceDoBot(2, 3)).toBe(1);
    expect(indiceDoBot(3, 3)).toBe(2);
    expect(indiceDoBot(5, 3)).toBeNull();
    expect(indiceDoBot(1, 0)).toBeNull();
  });

  it("próximo no último vai ao primeiro; anterior no primeiro vai ao último", () => {
    expect(alvoVizinho(3, 2, 1)).toBe(0);
    expect(alvoVizinho(3, 0, -1)).toBe(2);
    expect(alvoVizinho(3, 1, 1)).toBe(2);
    expect(alvoVizinho(3, 1, -1)).toBe(0);
    expect(alvoVizinho(1, 0, 1)).toBe(0);
  });

  it("sem atual na lista: próximo é o 1º, anterior é o último; lista vazia, nada", () => {
    expect(alvoVizinho(4, -1, 1)).toBe(0);
    expect(alvoVizinho(4, -1, -1)).toBe(3);
    expect(alvoVizinho(0, -1, 1)).toBeNull();
  });
});

describe("NOD-117: folha e rótulo do +", () => {
  it("9 linhas, com as teclas do lugar (NOD-461: ⌥← → na de página e a linha de mover)", () => {
    const app = linhasDaFolha("app-mac");
    expect(app.map((l) => l.titulo)).toEqual(["Nova conversa (novo bot)", "Ir ao bot 1 a 9 da barra", "Bot anterior e próximo", "Página anterior e próxima do bot", "Mover a página atual na pílula", "Folha de atalhos", "Buscar agentes", "Modo dev", "Fechar e voltar"]);
    expect(app[0]!.combinacoes).toEqual([["⌘", "N"]]);
    expect(app[3]!.combinacoes).toEqual([["⌘", "["], ["⌘", "]"], ["⌥", "←"], ["⌥", "→"]]);
    expect(app[4]!.combinacoes).toEqual([["⌥", "⇧", "←"], ["⌥", "⇧", "→"]]);
    expect(app[4]!.falado).toBe("Option Shift seta para os lados");
    expect(app[5]!.combinacoes).toEqual([["?"], ["⌘", "/"]]);
    expect(app[7]!.combinacoes).toEqual([["⌘", "⇧", "D"]]);
    const nav = linhasDaFolha("navegador-mac");
    expect(nav[0]!.combinacoes).toEqual([["⌃", "N"]]);
    expect(nav[4]!.combinacoes).toEqual([["⌥", "⇧", "←"], ["⌥", "⇧", "→"]]);
    expect(nav[5]!.combinacoes).toEqual([["?"], ["⌃", "/"]]);
    expect(nav[6]!.combinacoes).toEqual([["⌘", "K"]]);
    const win = linhasDaFolha("outro");
    expect(win[0]!.combinacoes).toEqual([["Alt", "N"]]);
    expect(win[2]!.combinacoes).toEqual([["Alt", "Shift", "["], ["Alt", "Shift", "]"]]);
    expect(win[3]!.combinacoes).toEqual([["Alt", "["], ["Alt", "]"], ["Alt", "←"], ["Alt", "→"]]);
    expect(win[3]!.falado).toBe("Alt colchete esquerdo e Alt colchete direito, ou Alt seta para os lados");
    expect(win[4]!.combinacoes).toEqual([["Alt", "Shift", "←"], ["Alt", "Shift", "→"]]);
    expect(win[5]!.combinacoes).toEqual([["?"], ["Ctrl", "/"]]);
    expect(win[6]!.combinacoes).toEqual([["Ctrl", "K"]]);
    expect(win[7]!.combinacoes).toEqual([["Ctrl", "Shift", "D"]]);
    for (const l of [...app, ...nav, ...win]) expect(l.falado.length).toBeGreaterThan(0);
    expect(nav[0]!.falado).toBe("Control N");
  });

  it("rótulo do + por lugar", () => {
    expect(atalhoDoNovoBot("app-mac")).toEqual({ texto: "⌘N", aria: "Meta+N" });
    expect(atalhoDoNovoBot("navegador-mac")).toEqual({ texto: "⌃N", aria: "Control+N" });
    expect(atalhoDoNovoBot("outro")).toEqual({ texto: "Alt+N", aria: "Alt+N" });
  });
});

describe("NOD-461: ⌥← → troca e ⌥⇧← → move a página, de qualquer lugar da conversa", () => {
  const seta = (key: string, mods: Partial<Tecla> = {}) => tecla("", key, { altKey: true, ...mods });

  it("setaDaPilula: só Alt puro; Shift move; ⌘/Ctrl (⌘⌥← → do Chrome, AltGr do Windows) ficam de fora", () => {
    expect(setaDaPilula(seta("ArrowLeft"))).toEqual({ tipo: "pagina", passo: -1, seta: true });
    expect(setaDaPilula(seta("ArrowRight"))).toEqual({ tipo: "pagina", passo: 1, seta: true });
    expect(setaDaPilula(seta("ArrowLeft", { shiftKey: true }))).toEqual({ tipo: "mover-pagina", passo: -1 });
    expect(setaDaPilula(seta("ArrowRight", { shiftKey: true }))).toEqual({ tipo: "mover-pagina", passo: 1 });
    expect(setaDaPilula(tecla("", "ArrowRight"))).toBeNull();
    expect(setaDaPilula(tecla("", "ArrowRight", { shiftKey: true }))).toBeNull();
    expect(setaDaPilula(seta("ArrowRight", { metaKey: true }))).toBeNull();
    expect(setaDaPilula(seta("ArrowRight", { ctrlKey: true }))).toBeNull(); // AltGr no Windows = Ctrl+Alt
    expect(setaDaPilula(seta("ArrowLeft", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(setaDaPilula(seta("ArrowUp"))).toBeNull(); // Alt+↑↓ é dos times da barra
    expect(setaDaPilula(seta("Home"))).toBeNull();
  });

  it("vale igual no app do Mac, no navegador do Mac e fora dele, com mais de uma página", () => {
    for (const lugar of LUGARES) {
      expect(atalhoDoTeclado(seta("ArrowRight"), ctx(lugar, { paginas: 3 })), lugar).toEqual({ tipo: "pagina", passo: 1, seta: true });
      expect(atalhoDoTeclado(seta("ArrowLeft", { shiftKey: true }), ctx(lugar, { paginas: 3 })), lugar).toEqual({ tipo: "mover-pagina", passo: -1 });
    }
  });

  it("uma página só: engolida (andar não acha vizinho), para não virar o voltar do navegador; sem pílula, não é nossa", () => {
    expect(atalhoDoTeclado(seta("ArrowLeft"), ctx("outro", { paginas: 1 }))).toEqual({ tipo: "pagina", passo: -1, seta: true });
    expect(atalhoDoTeclado(seta("ArrowLeft"), ctx("outro"))).toBeNull();
    expect(atalhoDoTeclado(seta("ArrowLeft", { shiftKey: true }), ctx("app-mac", { paginas: 0 }))).toBeNull();
  });

  it("num campo com texto a tecla fica com o campo; campo vazio (composer recém-aberto) é da pílula", () => {
    expect(atalhoDoTeclado(seta("ArrowLeft"), ctx("app-mac", { paginas: 3, emCampo: true, campoComTexto: true }))).toBeNull();
    expect(atalhoDoTeclado(seta("ArrowLeft", { shiftKey: true }), ctx("app-mac", { paginas: 3, emCampo: true, campoComTexto: true }))).toBeNull();
    expect(atalhoDoTeclado(seta("ArrowLeft"), ctx("app-mac", { paginas: 3, emCampo: true, campoComTexto: false }))).toEqual({ tipo: "pagina", passo: -1, seta: true });
  });

  it("fora do Mac, campo com texto: engole sem trocar (o texto do quadro se perderia) e sem virar o voltar do navegador", () => {
    expect(atalhoDoTeclado(seta("ArrowLeft"), ctx("outro", { paginas: 3, emCampo: true, campoComTexto: true }))).toEqual({ tipo: "engolir" });
    expect(atalhoDoTeclado(seta("ArrowLeft", { shiftKey: true }), ctx("outro", { paginas: 3, emCampo: true, campoComTexto: true }))).toEqual({ tipo: "engolir" });
    expect(atalhoDoTeclado(seta("ArrowLeft"), ctx("navegador-mac", { paginas: 3, emCampo: true, campoComTexto: true }))).toBeNull();
  });

  it("com um menu aberto a página não troca por baixo dele", () => {
    expect(atalhoDoTeclado(seta("ArrowRight"), ctx("app-mac", { paginas: 3, menuAberto: true }))).toBeNull();
    expect(atalhoDoTeclado(seta("ArrowRight", { shiftKey: true }), ctx("outro", { paginas: 3, menuAberto: true }))).toBeNull();
  });

  it("campoTemTexto: input e textarea de digitar com valor, contenteditable com texto; vazio, botão e checkbox não", () => {
    const campo = (tag: string, props: Record<string, unknown>, casa = true) => ({ tagName: tag, matches: () => casa, textContent: "", ...props }) as ElementoDeCampo;
    expect(campoTemTexto(campo("TEXTAREA", { value: "oi" }))).toBe(true);
    expect(campoTemTexto(campo("TEXTAREA", { value: "" }))).toBe(false);
    expect(campoTemTexto(campo("INPUT", { value: "x" }, false))).toBe(false);
    expect(campoTemTexto(campo("DIV", { isContentEditable: true, textContent: "texto" }))).toBe(true);
    expect(campoTemTexto(campo("DIV", { isContentEditable: true, textContent: "" }))).toBe(false);
    expect(campoTemTexto(campo("BUTTON", { textContent: "Enviar" }))).toBe(false);
    expect(campoTemTexto(null)).toBe(false);
  });

  it("o cabeçalho de coluna (Alt+← → move a coluna) ganha da pílula", () => {
    expect(atalhoDoTeclado(seta("ArrowRight"), ctx("outro", { paginas: 3, teclaDoAlvo: true }))).toBeNull();
    expect(atalhoDoTeclado(seta("ArrowRight", { shiftKey: true }), ctx("outro", { paginas: 3, teclaDoAlvo: true }))).toBeNull();
  });

  it("diálogo, Seu espaço, ditado, edição na gaveta, IME, repetição e celular travam como os outros atalhos", () => {
    const t = seta("ArrowRight");
    expect(atalhoDoTeclado(t, ctx("app-mac", { paginas: 3, dialogo: true }))).toBeNull();
    expect(atalhoDoTeclado(t, ctx("app-mac", { paginas: 3, espaco: true }))).toBeNull();
    expect(atalhoDoTeclado(t, ctx("app-mac", { paginas: 3, ditando: true }))).toBeNull();
    expect(atalhoDoTeclado(t, ctx("app-mac", { paginas: 3, editando: true }))).toBeNull();
    expect(atalhoDoTeclado(t, ctx("app-mac", { paginas: 3, celular: true }))).toBeNull();
    expect(atalhoDoTeclado({ ...t, isComposing: true }, ctx("app-mac", { paginas: 3 }))).toBeNull();
    expect(atalhoDoTeclado({ ...t, repeat: true }, ctx("app-mac", { paginas: 3 }))).toBeNull();
  });

  it("o colchete segue sem `seta` (⌘[ ⌘] não abrem a doca)", () => {
    expect(atalhoDoTeclado(tecla("BracketRight", "]", { metaKey: true }), ctx("app-mac", { paginas: 3 }))).toEqual({ tipo: "pagina", passo: 1 });
  });
});
