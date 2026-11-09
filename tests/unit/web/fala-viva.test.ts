import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SELETORES_DA_FALA, TETO_DE_TURNOS, criarAnunciador, criarRelogioDaFala, escreverTempos, lerFalasNaTela, tempoDaFala } from "../../../web/lib/fala-viva.ts";

/** Uma agenda falsa: `passar(ms)` roda o que venceu, em ordem. */
function agendaFalsa() {
  let agora = 0;
  let fila: { em: number; fn: () => void; vivo: boolean }[] = [];
  const agendar = (fn: () => void, ms: number) => {
    const item = { em: agora + ms, fn, vivo: true };
    fila.push(item);
    return () => { item.vivo = false; };
  };
  const passar = (ms: number) => {
    const fim = agora + ms;
    for (;;) {
      const prox = fila.filter((i) => i.vivo && i.em <= fim).sort((a, b) => a.em - b.em)[0];
      if (!prox) break;
      agora = prox.em;
      prox.vivo = false;
      fila = fila.filter((i) => i !== prox);
      prox.fn();
    }
    agora = fim;
  };
  return { agendar, passar, pendentes: () => fila.filter((i) => i.vivo).length };
}

describe("tempoDaFala", () => {
  it.each([[0, "0 s"], [59_999, "59 s"], [60_000, "1 min 0 s"], [61_000, "1 min 1 s"], [72_000, "1 min 12 s"], [3_600_000, "1 h 0 min"], [-5_000, "0 s"]])("%i ms → %s", (ms, texto) => {
    expect(tempoDaFala(ms)).toBe(texto);
  });
});

describe("escreverTempos e o relógio", () => {
  const el = (desde: string) => ({ textContent: "" as string | null, escritas: 0, getAttribute: () => desde });
  it("escreve cada [data-desde] só quando muda e conta quantos há", () => {
    const a = el("1000");
    const escritas: string[] = [];
    const proxy = { get textContent() { return a.textContent; }, set textContent(v) { a.textContent = v; escritas.push(String(v)); }, getAttribute: a.getAttribute };
    const raiz = { querySelectorAll: () => [proxy] };
    expect(escreverTempos(raiz, 5_000)).toBe(1);
    expect(escreverTempos(raiz, 5_400)).toBe(1);
    expect(escritas).toEqual(["4 s"]);
    expect(escreverTempos(null, 1)).toBe(0);
    expect(escreverTempos({ querySelectorAll: () => [] }, 1)).toBe(0);
  });

  it("toca a cada 1 s enquanto há fala viva, para sem ela e não roda com a aba escondida", () => {
    const ag = agendaFalsa();
    let falas = 1;
    let escondida = false;
    let toques = 0;
    const relogio = criarRelogioDaFala(() => { toques++; return falas; }, ag.agendar, () => escondida);
    relogio.tocar();
    relogio.tocar();
    expect(ag.pendentes()).toBe(1);
    ag.passar(3_000);
    expect(toques).toBe(5);
    falas = 0;
    ag.passar(1_000);
    expect(ag.pendentes()).toBe(0);
    falas = 1;
    escondida = true;
    relogio.tocar();
    expect(ag.pendentes()).toBe(0);
  });
});

describe("anunciador do turno (leitor de tela)", () => {
  function montar() {
    const ag = agendaFalsa();
    const ditos: string[] = [];
    const a = criarAnunciador((t) => ditos.push(t), ag.agendar);
    return { ag, ditos, a };
  }

  it("diz o estado depois de 1 s estável, uma vez só, com o nome da ferramenta como é", () => {
    const { ag, ditos, a } = montar();
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Pensando" }]);
    ag.passar(999);
    expect(ditos).toEqual([]);
    ag.passar(1);
    expect(ditos).toEqual(["Ada está pensando"]);
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Pensando" }]);
    ag.passar(5_000);
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Usando Linear" }]);
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Usando Linear" }]);
    ag.passar(1_000);
    expect(ditos).toEqual(["Ada está pensando", "Ada está usando Linear"]);
  });

  it("a troca rápida não anuncia o que passou; volta ao estado já dito não repete", () => {
    const { ag, ditos, a } = montar();
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Pensando" }]);
    ag.passar(1_000);
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Usando Linear" }]);
    ag.passar(400);
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Usando Gmail" }]);
    ag.passar(400);
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Pensando" }]);
    ag.passar(2_000);
    expect(ditos).toEqual(["Ada está pensando"]);
  });

  it("QA 2 do #508: o 1 s que vence depois da troca não diz o estado velho, nem com a agenda que não cancela", () => {
    const ag = agendaFalsa();
    const semCancelar = (fn: () => void, ms: number) => { ag.agendar(fn, ms); return () => {}; };
    const ditos: string[] = [];
    const a = criarAnunciador((t) => ditos.push(t), semCancelar);
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Pensando" }]);
    ag.passar(400);
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Usando Linear" }]);
    ag.passar(2_000);
    expect(ditos).toEqual(["Ada está usando Linear"]);
  });

  it("'respondeu' uma vez no fim, só se o turno deixou fala; interrompido e turno sem fala ficam calados", () => {
    const { ag, ditos, a } = montar();
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Escrevendo" }, { turnoId: "t2", nome: "Gil", estado: "Pensando" }, { turnoId: "t3", nome: "Leo", estado: "Pensando" }]);
    ag.passar(1_000);
    ditos.length = 0;
    a.frame("turno.delta", { turnoId: "t1", texto: "Olá" });
    a.frame("turno.delta", { turnoId: "t2", texto: "   " });
    a.frame("turno.delta", { turnoId: "t3", texto: "Vou parar" });
    a.frame("turno.interrompido", { turnoId: "t3" });
    a.frame("turno.encerrado", { turnoId: "t1" });
    a.frame("turno.encerrado", { turnoId: "t1" });
    a.frame("turno.encerrado", { turnoId: "t2" });
    a.frame("turno.encerrado", { turnoId: "t3" });
    expect(ditos).toEqual(["Ada respondeu"]);
  });

  it("turno.fala (sessão viva) também conta como fala; o turno de outra conversa (nunca à vista) não anuncia", () => {
    const { ditos, a } = montar();
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Usando Linear" }]);
    a.frame("turno.fala", { turnoId: "t1" });
    a.frame("turno.fala", { turnoId: "fora" });
    a.frame("turno.encerrado", { turnoId: "fora" });
    a.frame("turno.encerrado", { turnoId: "t1" });
    expect(ditos).toEqual(["Ada respondeu"]);
  });

  it("na sala, cada turno anuncia o seu bot; o turno que sai da tela cancela o anúncio pendente", () => {
    const { ag, ditos, a } = montar();
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Pensando" }, { turnoId: "t2", nome: "Gil", estado: "Pensando" }]);
    ag.passar(500);
    a.observar([{ turnoId: "t2", nome: "Gil", estado: "Pensando" }]);
    ag.passar(500);
    expect(ditos).toEqual(["Gil está pensando"]);
  });

  it("revisão do #508: o turno que sai e volta à tela não é dito de novo; o que mudou fora é dito na volta", () => {
    const { ag, ditos, a } = montar();
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Pensando" }]);
    ag.passar(1_000);
    a.observar([]);
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Pensando" }]);
    ag.passar(2_000);
    expect(ditos).toEqual(["Ada está pensando"]);
    a.observar([]);
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Usando Linear" }]);
    ag.passar(1_000);
    expect(ditos).toEqual(["Ada está pensando", "Ada está usando Linear"]);
  });

  it("revisão 2 do #508: o turno que acaba fora da tela (a pessoa foi para outra conversa) não diz 'respondeu'", () => {
    const { ditos, a } = montar();
    a.observar([{ turnoId: "t1", nome: "Ada", estado: "Escrevendo" }]);
    a.frame("turno.delta", { turnoId: "t1", texto: "Olá" });
    a.observar([]);
    a.frame("turno.encerrado", { turnoId: "t1" });
    a.observar([{ turnoId: "t2", nome: "Gil", estado: "Escrevendo" }]);
    a.frame("turno.delta", { turnoId: "t2", texto: "Oi" });
    a.observar([]);
    a.observar([{ turnoId: "t2", nome: "Gil", estado: "Escrevendo" }]);
    a.frame("turno.encerrado", { turnoId: "t2" });
    expect(ditos.filter((d) => d.endsWith("respondeu"))).toEqual(["Gil respondeu"]);
  });

  it(`revisão do #508: guarda no máximo ${TETO_DE_TURNOS} turnos (os mais antigos saem) e o fim do mais novo ainda responde`, () => {
    const { ag, ditos, a } = montar();
    const muitos = Array.from({ length: TETO_DE_TURNOS + 10 }, (_, i) => ({ turnoId: `t${i}`, nome: "Ada", estado: "Pensando" }));
    for (const f of muitos) { a.observar([f]); a.frame("turno.fala", { turnoId: f.turnoId }); }
    ag.passar(1_000);
    ditos.length = 0;
    a.frame("turno.encerrado", { turnoId: "t0" });
    expect(ditos).toEqual([]);
    a.frame("turno.encerrado", { turnoId: `t${TETO_DE_TURNOS + 9}` });
    expect(ditos).toEqual(["Ada respondeu"]);
  });
});

describe("main.ts: o anunciador ligado no lugar certo (revisão do #508)", () => {
  const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
  it("o frame passa pelo anunciador antes do reducer (no fim, ele ainda sabe quem falava)", () => {
    const corpo = /function receberFrame\(frame: FrameSse\): void \{([\s\S]*?)\n\}/.exec(main)![1]!;
    const linhas = corpo.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
    expect(linhas[0]).toBe("anunciadorDoTurno.frame(frame.tipo, frame.dados);");
    expect(corpo.indexOf("anunciadorDoTurno.frame")).toBeLessThan(corpo.indexOf("reduzir("));
  });
  it("o anúncio novo cancela o que ainda não saiu (um texto por vez em #anuncio-turno)", () => {
    const falar = /const anunciadorDoTurno = criarAnunciador\(\(texto\) => \{([\s\S]*?)\n\}/.exec(main)![1]!;
    expect(falar).toMatch(/clearTimeout\(anuncioPendente\)[\s\S]*anuncioPendente = window\.setTimeout/);
  });
});

describe("lerFalasNaTela (QA do #508)", () => {
  it("lê turno, nome e estado pelos seletores e pula a fala que saiu", () => {
    const pedidos: string[] = [];
    const el = (turno: string | null, nome: string | null, estado: string | null) => ({
      getAttribute: (n: string) => (n === "data-turno" ? turno : null),
      querySelector: (sel: string) => {
        const t = sel === SELETORES_DA_FALA.nome ? nome : sel === SELETORES_DA_FALA.estado ? estado : null;
        return t === null ? null : { textContent: t };
      },
    });
    const raiz = { querySelectorAll: (sel: string) => { pedidos.push(sel); return [el("t1", "Ada", "Pensando"), el("t2", "Gil", null), el(null, "Leo", "Pensando")]; } };
    expect(lerFalasNaTela(raiz)).toEqual([{ turnoId: "t1", nome: "Ada", estado: "Pensando" }]);
    expect(pedidos).toEqual([SELETORES_DA_FALA.fala]);
    expect(SELETORES_DA_FALA.fala).toContain(":not(.saindo)");
    expect(lerFalasNaTela(null)).toEqual([]);
  });
});

describe("main.ts: relógio e anunciador depois de cada render (revisão 2 do #508)", () => {
  const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
  it("o render toca o relógio e entrega as falas da tela ao anunciador", () => {
    expect(main).toMatch(/relogioDaFala\.tocar\(\);\s*\n\s*anunciadorDoTurno\.observar\(falasNaTela\(\)\);/);
    expect(main).toMatch(/function falasNaTela\(\): FalaNaTela\[\] \{\s*return lerFalasNaTela\(document\.getElementById\("timeline-ao-vivo"\)\);/);
  });
});
