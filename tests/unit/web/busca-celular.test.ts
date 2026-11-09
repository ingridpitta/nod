import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MensagemAchada } from "../../../src/contracts/busca.ts";
import { semAcento as semAcentoServidor } from "../../../src/domain/busca-mensagens.ts";
import {
  alvoDepoisDeFalar,
  appInerte,
  buscaMensagens,
  apagarTodosOsRecentes,
  buscarSemOcupado,
  ESPERA_OCUPADO_MS,
  TENTATIVAS_OCUPADO,
  chaveDosRecentes,
  comRecente,
  criarMotorDaBusca,
  dataCurta,
  falaDoStatus,
  filtrar,
  gravarRecentes,
  lerRecentes,
  semAcento,
  semRecente,
  trechoComNegrito,
  type EstadoMensagens,
} from "../../../web/lib/busca-celular.ts";
import { htmlDaBusca, type BotDaBusca, type ModeloDaBusca, type SalaDaBusca } from "../../../web/telas/busca-celular.ts";
import { CONSULTA_CELULAR } from "../../../web/lib/celular.ts";

const msg = (id: string, trecho = "o girassol"): MensagemAchada => ({ id, conversaId: "c1", conversaTipo: "propria", agenteId: "a1", salaId: null, autor: { tipo: "pessoa", id: "p1" }, em: "2026-10-28T10:00:00.000000Z", trecho });
const bot = (nome: string, titulo = ""): BotDaBusca => ({ agenteId: `a-${nome}`, conversaId: `c-${nome}`, nome, titulo, sub: titulo, mascote: (t) => `<i class="icon ${t}"></i>` });
const sala = (nome: string): SalaDaBusca => ({ salaId: `s-${nome}`, conversaId: `cs-${nome}`, nome, sub: "Vera, Tuca", membros: "2 bots" });
const modelo = (o: Partial<ModeloDaBusca> = {}): ModeloDaBusca => ({ termo: "", recentes: [], bots: [], salas: [], mensagens: { tipo: "inativo" }, rosto: () => ({ titulo: "Você", sufixo: "com Vera", avatar: "<i></i>" }), data: () => "10:00", ...o });

describe("busca do celular (NOD-380): regras puras", () => {
  it("semAcento da web é o mesmo do servidor", () => {
    for (const t of ["Reunião ÀS três", "ÍRIS", "ação", "Çedilha", "naïve café", "日本", "🙂 ok"]) expect(semAcento(t)).toBe(semAcentoServidor(t));
  });

  it("filtra bots e salas ignorando acento e caixa, na ordem de entrada; mensagens só com 2+ letras", () => {
    const bots = [bot("Íris", "design"), bot("Chico", "Tech Lead"), bot("Ada", "PM")];
    expect(filtrar(bots, "iris", (b) => [b.nome, b.titulo]).map((b) => b.nome)).toEqual(["Íris"]);
    expect(filtrar(bots, "TECH", (b) => [b.nome, b.titulo]).map((b) => b.nome)).toEqual(["Chico"]);
    expect(filtrar(bots, "a", (b) => [b.nome, b.titulo]).map((b) => b.nome)).toEqual(["Chico", "Ada"]);
    expect(buscaMensagens("a")).toBe(false);
    expect(buscaMensagens(" a  ")).toBe(false);
    expect(buscaMensagens("ab")).toBe(true);
    expect(buscaMensagens("🙂🙂")).toBe(true);
  });

  it("negrito no termo sem acento e caixa, com o resto escapado e sem marca-texto", () => {
    expect(trechoComNegrito("A reunião da Reuniao", "reuniao")).toBe("A <b>reunião</b> da <b>Reuniao</b>");
    expect(trechoComNegrito("<script>girassol</script>", "girassol")).toBe("&lt;script&gt;<b>girassol</b>&lt;/script&gt;");
    expect(trechoComNegrito("nada aqui", "zz")).toBe("nada aqui");
    expect(trechoComNegrito("x & y", "")).toBe("x &amp; y");
  });

  it("recentes: o novo no topo, sem repetir (acento/caixa), até 5; apagar um; ler tolera lixo", () => {
    let r: string[] = [];
    for (const t of ["um", "dois", "três", "quatro", "cinco", "seis"]) r = comRecente(r, t);
    expect(r).toEqual(["seis", "cinco", "quatro", "três", "dois"]);
    expect(comRecente(r, "TRES")).toEqual(["TRES", "seis", "cinco", "quatro", "dois"]);
    expect(comRecente(r, "a")).toEqual(r);
    expect(semRecente(r, "cinco")).toEqual(["seis", "quatro", "três", "dois"]);
    const mapa = new Map<string, string>();
    const guarda = { getItem: (k: string) => mapa.get(k) ?? null, setItem: (k: string, v: string) => void mapa.set(k, v), removeItem: (k: string) => void mapa.delete(k), get length() { return mapa.size; }, key: (i: number) => [...mapa.keys()][i] ?? null };
    const ana = chaveDosRecentes("t1", "ana");
    const bia = chaveDosRecentes("t1", "bia");
    expect(ana).toBe("nod.buscaRecentes:t1:ana");
    expect(chaveDosRecentes("t2", "ana")).not.toBe(ana);
    gravarRecentes(guarda, ana, ["a1", "b2"]);
    expect(lerRecentes(guarda, ana)).toEqual(["a1", "b2"]);
    // Outra pessoa no mesmo navegador não vê os recentes da Ana; sem sessão, nada se lê nem grava.
    expect(lerRecentes(guarda, bia)).toEqual([]);
    expect(lerRecentes(guarda, null)).toEqual([]);
    gravarRecentes(guarda, null, ["x9"]);
    expect([...mapa.keys()]).toEqual([ana]);
    gravarRecentes(guarda, ana, []);
    expect(mapa.has(ana)).toBe(false);
    mapa.set(ana, "{lixo");
    expect(lerRecentes(guarda, ana)).toEqual([]);
    mapa.set(ana, JSON.stringify(["ok", 3, "", null, "x", "y", "z", "w", "v"]));
    expect(lerRecentes(guarda, ana)).toEqual(["ok", "x", "y", "z", "w"]);
    expect(lerRecentes(null, ana)).toEqual([]);
    // Sair da conta apaga os recentes de todas as contas (e a chave antiga, sem escopo), sem tocar no resto.
    mapa.set(bia, JSON.stringify(["b"]));
    mapa.set("nod.buscaRecentes", JSON.stringify(["velho"]));
    mapa.set("nod.outra", "fica");
    apagarTodosOsRecentes(guarda);
    expect([...mapa.keys()]).toEqual(["nod.outra"]);
  });

  it("status do leitor de tela: só o resumo", () => {
    expect(falaDoStatus({ tipo: "inativo" })).toBe("");
    expect(falaDoStatus({ tipo: "carregando", termo: "gi" })).toBe("Buscando nas mensagens…");
    expect(falaDoStatus({ tipo: "erro", termo: "gi" })).toBe("Não deu para buscar nas mensagens.");
    expect(falaDoStatus({ tipo: "pronto", termo: "gi", itens: [msg("1")], proximo: null, maisCarregando: false, erroNoMais: false })).toBe("1 mensagem encontrada.");
    expect(falaDoStatus({ tipo: "pronto", termo: "gi", itens: [msg("1"), msg("2")], proximo: "c", maisCarregando: false, erroNoMais: false })).toBe("2+ mensagens encontradas.");
    expect(falaDoStatus({ tipo: "pronto", termo: "gi", itens: [], proximo: null, maisCarregando: false, erroNoMais: false })).toBe("Nenhuma mensagem encontrada.");
  });

  it("data curta: hoje a hora, este ano dia e mês, antes a data inteira", () => {
    const fmt = { hora: () => "H", diaMes: () => "DM", completa: () => "C" };
    const agora = new Date(2026, 9, 28, 12).getTime();
    expect(dataCurta(new Date(2026, 9, 28, 8).toISOString(), agora, fmt)).toBe("H");
    expect(dataCurta(new Date(2026, 1, 3).toISOString(), agora, fmt)).toBe("DM");
    expect(dataCurta(new Date(2025, 1, 3).toISOString(), agora, fmt)).toBe("C");
    expect(dataCurta("lixo", agora, fmt)).toBe("");
  });
});

describe("busca do celular (NOD-380): 429 da busca em voo", () => {
  const ocupado = Object.assign(new Error("ocupado"), { codigo: "limite_atingido" });
  it("repete o 429 depois de esperar, até dar certo; outro erro não repete", async () => {
    const esperas: number[] = [];
    let n = 0;
    const r = await buscarSemOcupado(async () => { if (++n < 3) throw ocupado; return "ok"; }, new AbortController().signal, async (ms) => { esperas.push(ms); });
    expect(r).toBe("ok");
    expect(esperas).toEqual([ESPERA_OCUPADO_MS, ESPERA_OCUPADO_MS]);
    let m = 0;
    await expect(buscarSemOcupado(async () => { m++; throw new Error("rede"); }, new AbortController().signal, async () => {})).rejects.toThrow("rede");
    expect(m).toBe(1);
  });

  it("desiste depois das tentativas e não repete o pedido que deixou de valer", async () => {
    let n = 0;
    await expect(buscarSemOcupado(async () => { n++; throw ocupado; }, new AbortController().signal, async () => {})).rejects.toBe(ocupado);
    expect(n).toBe(TENTATIVAS_OCUPADO + 1);
    const ctl = new AbortController();
    let k = 0;
    await expect(buscarSemOcupado(async () => { k++; throw ocupado; }, ctl.signal, async () => { ctl.abort(); })).rejects.toBe(ocupado);
    expect(k).toBe(1);
  });
});

describe("busca do celular (NOD-380): motor das mensagens", () => {
  function montar() {
    const timers: { fn: () => void; ms: number; id: number }[] = [];
    let id = 0;
    const pedidos: { termo: string; cursor: string | null; signal: AbortSignal; ok: (p: { itens: MensagemAchada[]; proximo: string | null }) => void; falha: (e: unknown) => void }[] = [];
    const estados: EstadoMensagens<MensagemAchada>[] = [];
    const motor = criarMotorDaBusca<MensagemAchada>({
      buscar: (termo, cursor, signal) => new Promise((ok, falha) => pedidos.push({ termo, cursor, signal, ok, falha })),
      agendar: (fn, ms) => { timers.push({ fn, ms, id: ++id }); return id; },
      cancelar: (k) => { const i = timers.findIndex((t) => t.id === k); if (i >= 0) timers.splice(i, 1); },
      aoMudar: (e) => estados.push(e),
    });
    const correr = () => { for (const t of timers.splice(0)) t.fn(); };
    return { motor, timers, pedidos, estados, correr };
  }
  const tique = () => new Promise((r) => setTimeout(r, 0));

  it("espera 250 ms parado, com 2+ letras; cada letra reinicia a espera; 1 letra não busca", async () => {
    const m = montar();
    m.motor.digitar("g");
    expect(m.timers).toHaveLength(0);
    expect(m.motor.estado().tipo).toBe("inativo");
    m.motor.digitar("gi");
    m.motor.digitar("gir");
    expect(m.timers).toHaveLength(1);
    expect(m.timers[0]!.ms).toBe(250);
    expect(m.motor.estado()).toEqual({ tipo: "carregando", termo: "gir" });
    m.correr();
    expect(m.pedidos.map((p) => p.termo)).toEqual(["gir"]);
    m.pedidos[0]!.ok({ itens: [msg("1")], proximo: "c2" });
    await tique();
    expect(m.motor.estado()).toMatchObject({ tipo: "pronto", termo: "gir", proximo: "c2" });
  });

  it("o pedido que deixa de valer é abortado: outra letra, apagar o termo ou fechar", () => {
    const m = montar();
    m.motor.digitar("gir");
    m.correr();
    m.motor.digitar("gira");
    expect(m.pedidos[0]!.signal.aborted).toBe(true);
    m.correr();
    expect(m.pedidos[1]!.signal.aborted).toBe(false);
    m.motor.digitar("g");
    expect(m.pedidos[1]!.signal.aborted).toBe(true);
    m.motor.digitar("gir");
    m.correr();
    m.motor.parar();
    expect(m.pedidos[2]!.signal.aborted).toBe(true);
  });

  it("resposta velha não apaga a nova (fora de ordem)", async () => {
    const m = montar();
    m.motor.digitar("gir");
    m.correr();
    m.motor.digitar("girassol");
    m.correr();
    m.pedidos[1]!.ok({ itens: [msg("novo")], proximo: null });
    await tique();
    m.pedidos[0]!.ok({ itens: [msg("velho")], proximo: null });
    await tique();
    const e = m.motor.estado();
    expect(e.tipo === "pronto" && e.itens.map((i) => i.id)).toEqual(["novo"]);
    // Apagar para menos de 2 letras descarta o que ainda vinha.
    m.motor.digitar("girafa");
    m.correr();
    m.motor.digitar("g");
    m.pedidos[2]!.ok({ itens: [msg("tarde")], proximo: null });
    await tique();
    expect(m.motor.estado().tipo).toBe("inativo");
  });

  it("ver mais junta a página seguinte sem repetir; erro no mais mantém o que veio e tenta de novo", async () => {
    const m = montar();
    m.motor.digitar("gir");
    m.correr();
    m.pedidos[0]!.ok({ itens: [msg("1"), msg("2")], proximo: "c2" });
    await tique();
    m.motor.verMais();
    m.motor.verMais(); // segundo toque com o primeiro em voo: não pede de novo
    expect(m.pedidos).toHaveLength(2);
    expect(m.pedidos[1]).toMatchObject({ termo: "gir", cursor: "c2" });
    m.pedidos[1]!.falha(new Error("rede"));
    await tique();
    expect(m.motor.estado()).toMatchObject({ tipo: "pronto", erroNoMais: true, maisCarregando: false });
    m.motor.tentarDeNovo();
    m.pedidos[2]!.ok({ itens: [msg("2"), msg("3")], proximo: null });
    await tique();
    const e = m.motor.estado();
    expect(e.tipo === "pronto" && e.itens.map((i) => i.id)).toEqual(["1", "2", "3"]);
    expect(e.tipo === "pronto" && e.proximo).toBeNull();
  });

  it("um espaço no fim não cancela a espera; parar e reabrir com o mesmo termo busca de novo (revisão: carregando eterno)", async () => {
    const m = montar();
    m.motor.digitar("gir");
    m.motor.digitar("gir ");
    expect(m.timers).toHaveLength(1);
    m.correr();
    expect(m.pedidos.map((p) => p.termo)).toEqual(["gir"]);
    // Fecha com o pedido em voo e reabre pelo mesmo recente.
    m.motor.parar();
    expect(m.motor.estado().tipo).toBe("inativo");
    m.motor.digitar("gir");
    m.correr();
    expect(m.pedidos).toHaveLength(2);
    m.pedidos[0]!.ok({ itens: [msg("velho")], proximo: null });
    m.pedidos[1]!.ok({ itens: [msg("novo")], proximo: null });
    await tique();
    const e = m.motor.estado();
    expect(e.tipo === "pronto" && e.itens.map((i) => i.id)).toEqual(["novo"]);
  });

  it("erro na 1ª página vira estado de erro; tentar de novo repete o mesmo termo", async () => {
    const m = montar();
    m.motor.digitar("gir");
    m.correr();
    m.pedidos[0]!.falha(new Error("500"));
    await tique();
    expect(m.motor.estado()).toEqual({ tipo: "erro", termo: "gir" });
    m.motor.tentarDeNovo();
    expect(m.pedidos[1]).toMatchObject({ termo: "gir", cursor: null });
  });
});

describe("busca do celular (NOD-380): o que a tela mostra", () => {
  const bots = [bot("Íris", "design"), bot("Chico", "Tech Lead")];
  const salas = [sala("Revisão")];

  it("sem texto: Recentes (com Limpar e ✕ por linha) e a fila de até 8 bots", () => {
    const muitos = Array.from({ length: 10 }, (_, i) => bot(`B${i}`));
    const h = htmlDaBusca(modelo({ recentes: ["girassol", "<x>"], bots: muitos }));
    expect(h).toContain(">Recentes<");
    expect(h).toContain('data-bc="limpar-recentes"');
    expect(h.match(/data-bc="tirar-recente"/g)).toHaveLength(2);
    expect(h).toContain("&lt;x&gt;");
    expect(h).not.toContain("<x>");
    expect(h.match(/class="bc-bot"/g)).toHaveLength(8);
    expect(htmlDaBusca(modelo({ bots: muitos }))).not.toContain("Recentes");
  });

  it("com texto: Bots, Salas e Mensagens; grupo vazio some; acento e caixa ignorados", () => {
    const h = htmlDaBusca(modelo({ termo: "IRIS", bots, salas, mensagens: { tipo: "pronto", termo: "IRIS", itens: [msg("1", "falei com a Íris")], proximo: null, maisCarregando: false, erroNoMais: false } }));
    expect(h).toContain(">Bots<");
    expect(h).toContain("<b><b>Íris</b></b>");
    expect(h).not.toContain(">Salas<");
    expect(h).toContain(">Mensagens<");
    expect(h).toContain("falei com a <b>Íris</b>");
    expect(h).not.toContain("Ver mais");
    const soSala = htmlDaBusca(modelo({ termo: "revisao", bots, salas, mensagens: { tipo: "pronto", termo: "revisao", itens: [], proximo: null, maisCarregando: false, erroNoMais: false } }));
    expect(soSala).toContain(">Salas<");
    expect(soSala).not.toContain(">Bots<");
    expect(soSala).not.toContain(">Mensagens<");
  });

  it("carregando = 3 esqueletos só em Mensagens, sem spinner; nada encontrado = uma frase", () => {
    const h = htmlDaBusca(modelo({ termo: "chico", bots, mensagens: { tipo: "carregando", termo: "chico" } }));
    expect(h.match(/bc-esqueleto/g)).toHaveLength(3);
    expect(h).toContain(">Bots<");
    expect(h).not.toMatch(/spinner|girando/u);
    const nada = htmlDaBusca(modelo({ termo: "zzz", bots, salas, mensagens: { tipo: "pronto", termo: "zzz", itens: [], proximo: null, maisCarregando: false, erroNoMais: false } }));
    expect(nada).toBe('<p class="bc-nada">Nada encontrado para “zzz”.</p>');
    // 1 letra: só os grupos locais; sem nada local, a frase.
    expect(htmlDaBusca(modelo({ termo: "z", bots }))).toContain("Nada encontrado");
  });

  it("erro nas mensagens mantém Bots e Salas e mostra a linha neutra com Tentar de novo", () => {
    const h = htmlDaBusca(modelo({ termo: "i", bots, salas: [sala("Iris time")], mensagens: { tipo: "erro", termo: "i" } }));
    expect(h).toContain(">Bots<");
    expect(h).toContain(">Salas<");
    expect(h).toContain("Não deu para buscar nas mensagens");
    expect(h).toContain('data-bc="tentar"');
    const noMais = htmlDaBusca(modelo({ termo: "gir", mensagens: { tipo: "pronto", termo: "gir", itens: [msg("1")], proximo: "c", maisCarregando: false, erroNoMais: true } }));
    expect(noMais).toContain("o <b>gir</b>assol");
    expect(noMais).toContain('data-bc="tentar"');
    expect(noMais).not.toContain('data-bc="mais"');
  });

  it("ver mais aparece com cursor e fica ocupado enquanto carrega", () => {
    const pronto = (mais: boolean): EstadoMensagens<MensagemAchada> => ({ tipo: "pronto", termo: "gir", itens: [msg("1")], proximo: "c", maisCarregando: mais, erroNoMais: false });
    expect(htmlDaBusca(modelo({ termo: "gir", mensagens: pronto(false) }))).toContain(">Ver mais mensagens<");
    expect(htmlDaBusca(modelo({ termo: "gir", mensagens: pronto(true) }))).toMatch(/data-bc="mais" aria-disabled="true" aria-busy="true">Carregando…/u);
  });

  it("CSS: alvos de 44, reduced motion sem animação, a regra de celular na consulta canônica, balão da pessoa na cor do bot", () => {
    const css = readFileSync(new URL("../../../web/busca-celular.css", import.meta.url), "utf8");
    for (const sel of [".bc-limpar", ".bc-tirar"]) expect(css).toMatch(new RegExp(`\\${sel} \\{[^}]*width: 44px; height: 44px`, "u"));
    for (const sel of [".bc-cancelar", ".bc-texto", ".bc-recente-termo"]) expect(css).toMatch(new RegExp(`\\${sel} \\{[^}]*min-height: 44px`, "u"));
    expect(css).toMatch(/\.bc-campo \{[^}]*height: 44px; border-radius: 22px/u);
    expect(css).toMatch(/\.bc-input \{[^}]*font-size: 16px/u);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.busca-celular, \.busca-celular\.saindo \{ animation: none; \}/u);
    expect(css).toContain(`@media ${CONSULTA_CELULAR} {`);
    for (const m of css.matchAll(/@media ([^{]+)\{/g)) expect([CONSULTA_CELULAR, "(prefers-reduced-motion: reduce)", "(forced-colors: active)"]).toContain(m[1]!.trim());
    // O balão é casca do celular: mora no mobile.css (ADR-094), dentro da consulta canônica.
    expect(css).not.toContain(".message.you");
    const mobile = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
    // NOD-431 desfez o balão cinza da NOD-380: no celular o balão da pessoa também veste a cor do bot (interface.css).
    expect(mobile).not.toMatch(/\.message\.you \.bubble \{ background: var\(--surface-raised\)/u);
    // --signal só no cursor.
    expect(css.match(/var\(--signal\)/g)).toHaveLength(1);
    expect(css).toContain("caret-color: var(--signal)");
    const html = readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8");
    expect(html.indexOf("/busca-celular.css")).toBeGreaterThan(html.indexOf("/configuracoes.css"));
    expect(html.indexOf("/busca-celular.css")).toBeLessThan(html.indexOf("/mobile.css"));
  });
});

describe("busca do celular (NOD-380): revisão 4 (inert e alvo depois de falar)", () => {
  it("a .app fica inerte com a busca aberta ou outra camada por cima; só solta sem nenhuma", () => {
    expect(appInerte({ outraCamada: false, buscaAberta: true })).toBe(true);
    expect(appInerte({ outraCamada: true, buscaAberta: false })).toBe(true);
    expect(appInerte({ outraCamada: false, buscaAberta: false })).toBe(false);
  });

  it("o render conta a busca aberta no inert, e fechar a busca respeita a outra camada", () => {
    const main = readFileSync("web/main.ts", "utf8");
    const tela = readFileSync("web/telas/busca-celular.ts", "utf8");
    const linhaDoRender = main.split("\n").find((l) => l.includes('document.querySelector(".app")?.toggleAttribute("inert"'));
    expect(linhaDoRender).toContain("buscaAberta: !!document.querySelector(\".busca-celular:not(.saindo)\")");
    expect(tela).toContain("app.inert = appInerte({ outraCamada: d.appInerte(), buscaAberta: false })");
    expect(tela).not.toMatch(/app\.inert = false/);
  });

  it("falar na conversa do alvo esquece o alvo; em outra conversa, o alvo fica", () => {
    const alvo = { conversaId: "c1", mensagemId: "m1" };
    expect(alvoDepoisDeFalar(alvo, "c1")).toBeNull();
    expect(alvoDepoisDeFalar(alvo, "c2")).toBe(alvo);
    expect(alvoDepoisDeFalar(null, "c1")).toBeNull();
  });

  it("o envio pelo campo e o Tentar de novo esquecem o alvo depois de enviar", () => {
    const main = readFileSync("web/main.ts", "utf8");
    const corpo = (nome: string) => main.slice(main.indexOf(`async function ${nome}(`), main.indexOf("\n}\n", main.indexOf(`async function ${nome}(`)));
    expect(corpo("enviarComposer")).toMatch(/enviou = true;[\s\S]*alvoDaBusca = alvoDepoisDeFalar\(alvoDaBusca, alvo\.conversaId\)/);
    expect(main.match(/alvoDaBusca = alvoDepoisDeFalar\(/g)).toHaveLength(2);
  });
});

describe("NOD-380 revisão 7: a fala achada que a timeline recolhe", () => {
  it("leva à primeira desenhada depois dela; sem nenhuma depois, à última antes; nenhuma desenhada, null", async () => {
    const { vizinhaDesenhada } = await import("../../../web/lib/busca-celular.ts");
    const ids = ["a", "b", "c", "d", "e"];
    expect(vizinhaDesenhada(ids, "b", (x) => x === "a" || x === "d")).toBe("d");
    expect(vizinhaDesenhada(ids, "e", (x) => x === "a" || x === "c")).toBe("c");
    expect(vizinhaDesenhada(ids, "c", () => false)).toBeNull();
    expect(vizinhaDesenhada(ids, "z", () => true)).toBeNull();
  });

  it("passoDoAlvo (NOD-363): desenhada leva; não veio é antiga; veio e não desenhada vai à vizinha só depois da espera; prazo vencido desiste", async () => {
    const { passoDoAlvo, ESPERA_DESENHO_MS } = await import("../../../web/lib/busca-celular.ts");
    const base = { desenhada: false, veio: undefined, veioEm: undefined, agora: 1000, desiste: 5000 } as const;
    expect(passoDoAlvo({ ...base, desenhada: true, veio: false })).toBe("levar");
    expect(passoDoAlvo({ ...base, veio: false })).toBe("antiga");
    expect(passoDoAlvo({ ...base, veio: false, agora: 9000 })).toBe("antiga");
    expect(passoDoAlvo(base)).toBe("esperar");
    expect(passoDoAlvo({ ...base, veio: true, veioEm: 1000 - ESPERA_DESENHO_MS + 1 })).toBe("esperar");
    expect(passoDoAlvo({ ...base, veio: true, veioEm: 1000 - ESPERA_DESENHO_MS })).toBe("vizinha");
    expect(passoDoAlvo({ ...base, veio: true, veioEm: undefined })).toBe("esperar");
    expect(passoDoAlvo({ ...base, agora: 5000 })).toBe("desistiu");
    expect(passoDoAlvo({ ...base, agora: 4999 })).toBe("esperar");
  });

  it("main.ts: a busca e a Biblioteca usam o mesmo levarAFalaComAte (web/lib/ir-para-a-fala.ts); a falha da busca avisa", async () => {
    const { readFileSync } = await import("node:fs");
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toContain("levarAFalaComAte(mundoDaFala, m.conversaId, m.id, {");
    const busca = main.slice(main.indexOf("function abrirMensagemAchada("), main.indexOf("const mundoDaFala"));
    expect(busca.indexOf("soltarAlvoNaoDesenhado(mundoDaFala, m.conversaId, m.id)")).toBeLessThan(busca.indexOf('codigo: "busca_alvo_fora"'));
    expect(busca.indexOf("soltarAlvoNaoDesenhado")).toBeGreaterThan(-1);
    expect(main).toContain("const mundoDaFala = criarMundoDaFala<HTMLElement>({");
    expect(main).toContain("notarVeio(alvoDaBusca, conversaId, ate,");
    // Revisão 3 (B1): a leitura da conversa (na tela e a dos vivos) sai com o `ate` do alvo — sem isso a janela não cresce.
    for (const p of ["9", "6"]) {
      expect(main).toContain(`const ate = ateDaBusca(q.slice(${p}));`);
      expect(main).toContain(`notarAlvoDaBusca(q.slice(${p}), ate, await api.conversa(q.slice(${p}), ate))`);
    }
    expect(main).toContain("const ateDaBusca = (conversaId: string): string | undefined => (alvoDaBusca?.conversaId === conversaId ? alvoDaBusca.mensagemId : undefined);");
  });
});

describe("NOD-380 revisão 8: o ?ate= sai quando a pessoa volta ao fim", () => {
  it("só depois do desenho e só no fim da conversa", async () => {
    const { alvoNoFimDaConversa } = await import("../../../web/lib/busca-celular.ts");
    const fim = { topo: 900, altura: 1500, janela: 600 };
    const meio = { topo: 300, altura: 1500, janela: 600 };
    expect(alvoNoFimDaConversa({ desenhado: false }, fim)).toEqual({ desenhado: false });
    expect(alvoNoFimDaConversa({ desenhado: true }, meio)).toEqual({ desenhado: true });
    expect(alvoNoFimDaConversa({ desenhado: true }, fim)).toBeNull();
    expect(alvoNoFimDaConversa(null, fim)).toBeNull();
  });
});
