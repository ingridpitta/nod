import { afterEach, describe, expect, it } from "vitest";
import { textoPedidoDeTela } from "../../../src/domain/computador.ts";
import { ErroApi } from "../../../web/lib/erro-api.ts";
import { aoFecharATela, criarCliqueQueAssume, esperaParaAssumir, falhaQuePassaAoAssumir, htmlCartaoTela, htmlDialogoComputador, htmlPilula, marcarTelaFechadaNaAjuda, motivoDoPedidoDeTela, rotuloDoFechar, teclaAssume, type OrigemDoAssumir } from "../../../web/lib/computador.ts";

/** O portão com um computador em Assistindo que vira "pessoa" quando o assumir conclui. */
function cenario() {
  let controle: "bot" | "pessoa" = "bot";
  const assumidos: OrigemDoAssumir[] = [];
  const portao = criarCliqueQueAssume({ assistindo: () => controle !== "pessoa", assumir: (o) => { assumidos.push(o); } });
  const concluir = () => { controle = "pessoa"; portao.concluiu(); };
  return { portao, assumidos, concluir };
}

describe("NOD-97: o primeiro clique na tela assume o controle", () => {
  it("o clique em Assistindo assume e é consumido (mousedown e o mouseup do mesmo gesto); o 2º clique vira ação", () => {
    const { portao, assumidos, concluir } = cenario();
    expect(portao.apertar()).toBe(true);
    expect(assumidos).toEqual(["clique"]);
    expect(portao.assumindo()).toBe(true);
    expect(portao.soltar()).toBe(true);
    concluir();
    // O 2º gesto chega ao site.
    expect(portao.apertar()).toBe(false);
    expect(portao.soltar()).toBe(false);
    expect(portao.tecla({ key: "a" })).toBe(false);
    expect(assumidos).toEqual(["clique"]);
  });

  it("o gesto que assumiu engole o mouseup mesmo se o assumir já concluiu antes de soltar", () => {
    const { portao, concluir } = cenario();
    expect(portao.apertar()).toBe(true);
    concluir();
    expect(portao.soltar()).toBe(true);
    expect(portao.apertar()).toBe(false);
    expect(portao.soltar()).toBe(false);
  });

  it("uma tecla em Assistindo assume e é consumida", () => {
    const { portao, assumidos } = cenario();
    expect(portao.tecla({ key: "Enter" })).toBe(true);
    expect(assumidos).toEqual(["clique"]);
  });

  it("Tab, Shift+Tab, Esc, modificadoras sozinhas e a roda do mouse não assumem", () => {
    const { portao, assumidos } = cenario();
    for (const key of ["Tab", "Escape", "Shift", "Control", "Alt", "Meta"]) {
      expect(teclaAssume({ key })).toBe(false);
      expect(portao.tecla({ key })).toBe(false);
    }
    expect(portao.rolar()).toBe(false);
    expect(assumidos).toEqual([]);
    expect(portao.assumindo()).toBe(false);
    expect(teclaAssume({ key: "a" })).toBe(true);
  });

  it("atalhos do navegador (Ctrl/Cmd+tecla, F1 a F12) não assumem", () => {
    const { portao, assumidos } = cenario();
    expect(portao.tecla({ key: "r", ctrlKey: true })).toBe(false);
    expect(portao.tecla({ key: "f", metaKey: true })).toBe(false);
    expect(portao.tecla({ key: "F5" })).toBe(false);
    expect(portao.tecla({ key: "F12" })).toBe(false);
    expect(assumidos).toEqual([]);
    expect(teclaAssume({ key: "F" })).toBe(true);
  });

  it("o gesto que assumiu soltou fora da imagem: o 1º clique no controle chega inteiro ao site", () => {
    const { portao, concluir } = cenario();
    expect(portao.apertar()).toBe(true);
    concluir(); // o mouseup foi fora da imagem e nunca chegou
    expect(portao.apertar()).toBe(false);
    expect(portao.soltar()).toBe(false);
  });

  it("durante o Assumindo… tudo é descartado e não assume de novo", () => {
    const { portao, assumidos } = cenario();
    portao.apertar(); portao.soltar();
    expect(portao.apertar()).toBe(true);
    expect(portao.soltar()).toBe(true);
    expect(portao.tecla({ key: "x" })).toBe(true);
    expect(portao.rolar()).toBe(true);
    expect(portao.botao()).toBe(false);
    expect(assumidos).toEqual(["clique"]);
  });

  it("a pílula assume sem gesto a engolir (origem botao)", () => {
    const { portao, assumidos, concluir } = cenario();
    expect(portao.botao()).toBe(true);
    expect(assumidos).toEqual(["botao"]);
    concluir();
    expect(portao.apertar()).toBe(false);
    expect(portao.soltar()).toBe(false);
  });

  it("desistiu (sem controle): o próximo clique tenta assumir de novo", () => {
    const { portao, assumidos } = cenario();
    portao.apertar(); portao.soltar();
    portao.concluiu();
    expect(portao.apertar()).toBe(true);
    expect(assumidos).toEqual(["clique", "clique"]);
  });

  it("erro que passa sozinho tenta de novo com espera de 0,5 s, 1 s, 2 s e daí 4 s; o resto não", () => {
    expect([0, 1, 2, 3, 4, 10].map(esperaParaAssumir)).toEqual([500, 1000, 2000, 4000, 4000, 4000]);
    expect(falhaQuePassaAoAssumir(new ErroApi(409, "estado_invalido", "ocupado"))).toBe(true);
    expect(falhaQuePassaAoAssumir(new ErroApi(0, "servidor_indisponivel", "rede"))).toBe(true);
    expect(falhaQuePassaAoAssumir(new ErroApi(0, "sem_internet", "rede"))).toBe(true);
    expect(falhaQuePassaAoAssumir(new ErroApi(500, "falha_interna", "x"))).toBe(true);
    expect(falhaQuePassaAoAssumir(new ErroApi(403, "proibido", "x"))).toBe(false);
    expect(falhaQuePassaAoAssumir(new ErroApi(404, "nao_encontrado", "x"))).toBe(false);
    expect(falhaQuePassaAoAssumir(new Error("x"))).toBe(false);
  });
});

describe("NOD-97: a pílula, o cartão e a frase do pedido", () => {
  afterEach(() => marcarTelaFechadaNaAjuda("a1", null));

  it("a pílula nos 3 estados; Parar devolve (não desliga)", () => {
    const assistindo = htmlPilula("Nina", "assistindo");
    expect(assistindo).toContain(">Assistindo<");
    expect(assistindo).toContain("Clique para assumir");
    expect(assistindo).toContain("Toque para assumir");
    expect(assistindo).toContain('data-c="assumir" aria-label="Assumir o controle"');
    expect(htmlPilula("Nina", "assumindo")).toContain(">Assumindo…<");
    expect(htmlPilula("Nina", "assumindo")).not.toContain("<button");
    const controle = htmlPilula("Nina", "controle");
    expect(controle).toContain(">Você está no controle<");
    expect(controle).toContain('data-c="devolver"');
    expect(controle).toContain(">Parar</button>");
    expect(htmlDialogoComputador("Nina")).toContain("Fechar devolve ao Nina");
  });

  it("a frase nova do pedido de tela não manda usar Assumir controle, e a antiga continua virando o cartão", () => {
    const frase = textoPedidoDeTela("entrar no banco");
    expect(frase).not.toContain("Assumir controle");
    expect(motivoDoPedidoDeTela(frase)).toBe("entrar no banco");
    expect(motivoDoPedidoDeTela("Abra meu computador para concluir este passo: entrar no banco. Use Assumir controle; depois, Devolver ao bot. Não envie senha ou código aqui.")).toBe("entrar no banco");
  });

  it("fechou a tela com a ajuda aberta: o cartão espera, com Abrir (já no controle) e Terminei", () => {
    expect(htmlCartaoTela("entrar no banco", "a1", true, "Nina", "d1")).not.toContain("Você fechou a tela");
    marcarTelaFechadaNaAjuda("a1", "d1");
    const html = htmlCartaoTela("entrar no banco", "a1", true, "Nina", "d1");
    expect(html).toContain("Você fechou a tela; Nina espera você terminar.");
    expect(html).toContain("aguardando você");
    expect(html).toMatch(/data-act="abrir-computador"[^>]*data-assumir="1"|data-assumir="1"[^>]*data-act="abrir-computador"/);
    expect(html).toContain(">Abrir<");
    expect(html).toContain('data-act="terminei-computador"');
    expect(html).toContain(">Terminei<");
    // Ajuda já resolvida: volta a "devolvida", sem botões.
    expect(htmlCartaoTela("entrar no banco", "a1", false, "Nina", "d1")).toContain("A tela voltou para o bot.");
  });

  it("a marca é do pedido: um pedido novo do mesmo bot nasce sem \"Você fechou a tela\"", () => {
    marcarTelaFechadaNaAjuda("a1", "d1");
    expect(htmlCartaoTela("entrar no banco", "a1", true, "Nina", "d2")).not.toContain("Você fechou a tela");
    marcarTelaFechadaNaAjuda("a1", null);
    expect(htmlCartaoTela("entrar no banco", "a1", true, "Nina", "d1")).not.toContain("Você fechou a tela");
  });
});

describe("NOD-97: fechar a tela no controle", () => {
  it("devolve sem pedido de ajuda; com o pedido aberto espera; sem controle não faz nada", () => {
    expect(aoFecharATela(true, null)).toBe("devolver");
    expect(aoFecharATela(true, "d1")).toBe("esperar");
    expect(aoFecharATela(false, null)).toBe("nada");
    expect(aoFecharATela(false, "d1")).toBe("nada");
  });

  it("o ✕ só promete devolver quando fechar devolve (protótipo v1.1)", () => {
    expect(rotuloDoFechar("Nina", true, null)).toEqual({ rotulo: "Fechar e devolver ao Nina (Esc)", dica: "Fechar devolve ao Nina" });
    expect(rotuloDoFechar("Nina", true, "d1")).toEqual({ rotulo: "Fechar (o pedido continua aberto)", dica: "Esc fecha; o pedido continua aberto" });
    expect(rotuloDoFechar("Nina", false, null)).toEqual({ rotulo: "Fechar computador", dica: null });
  });
});
