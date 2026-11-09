import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DisponibilidadeDitado } from "../../../src/contracts/ditado.ts";
import type { EventoDitado } from "../../../web/lib/ditado-protocolo.ts";
import { textoDaFalha } from "../../../web/telas/ditado.ts";

/**
 * NOD-324: o controle do ditado com a disponibilidade velha. O motor (worklet `?worker&url`) e o diálogo são trocados
 * por dublês; o `document` é o mínimo que o controle toca (o 🎤 e nada mais).
 */

type Gravacao = { tenantId: string; aoEvento: (ev: EventoDitado) => void; antesDeConectar?: Promise<unknown>; descartar: ReturnType<typeof vi.fn> };
type Pedido = { aoConcordar?: () => void; responder(sim: boolean): void };

const gravacoes: Gravacao[] = [];
const pedidos: Pedido[] = [];

vi.mock("../../../web/lib/ditado.ts", () => ({
  iniciarDitado: (o: { tenantId: string; aoEvento: (ev: EventoDitado) => void; antesDeConectar?: Promise<unknown> }) => {
    const g: Gravacao = { ...o, descartar: vi.fn() };
    gravacoes.push(g);
    return { concluir: vi.fn(), descartar: g.descartar };
  },
}));

vi.mock("../../../web/telas/consentimento-voz.ts", () => ({
  pedirConsentimentoVoz: (p: { aoConcordar?: () => void }) =>
    new Promise<boolean>((resolver) => {
      pedidos.push({
        aoConcordar: p.aoConcordar,
        responder(sim) {
          if (sim) p.aoConcordar?.();
          resolver(sim);
        },
      });
    }),
}));

// Como em gaveta-render.test.ts: o controle tem DOM e é carregado em execução; seu tipo é conferido pelo tsconfig.web,
// enquanto estes testes também passam pelo tsconfig.server, sem a biblioteca DOM.
type Controle = { atualizar(): void; comecar(): void; descartar(): void; reler(): Promise<boolean>; reiniciar(): void; ativo(): boolean };
type Deps = {
  tenantId(): string | null;
  disponibilidade(): Promise<DisponibilidadeDitado | null>;
  consentir(versao: number): Promise<unknown>;
  aoTexto(texto: string, destino: "campo" | "enviar", ta: unknown): void;
  avisar(texto: string): void;
  noApp(): boolean;
};
const { criarControleDitado }: { criarControleDitado: (d: Deps) => Controle } = await import(new URL("../../../web/telas/ditado-controle.ts", import.meta.url).href);

type Adiado<T> = { promessa: Promise<T>; resolver(v: T): void; rejeitar(e: unknown): void };
function adiado<T>(): Adiado<T> {
  let resolver!: (v: T) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<T>((s, f) => { resolver = s; rejeitar = f; });
  return { promessa, resolver, rejeitar };
}
const esvaziar = () => new Promise<void>((r) => setTimeout(r, 0));

const JA_CONSENTIU: DisponibilidadeDitado = { disponivel: true, consentimentoNecessario: false, versaoConsentimento: 3 };
const PEDE_V3: DisponibilidadeDitado = { disponivel: true, consentimentoNecessario: true, versaoConsentimento: 3 };
const PEDE_V4: DisponibilidadeDitado = { disponivel: true, consentimentoNecessario: true, versaoConsentimento: 4 };

let mic: { hidden: boolean };

function montar(primeira: DisponibilidadeDitado) {
  const leituras: Adiado<DisponibilidadeDitado | null>[] = [];
  const deps = {
    tenantId: () => "t1",
    disponibilidade: vi.fn(() => {
      const a = adiado<DisponibilidadeDitado | null>();
      leituras.push(a);
      return a.promessa;
    }),
    consentir: vi.fn((_v: number) => Promise.resolve()),
    aoTexto: vi.fn(),
    avisar: vi.fn(),
    noApp: () => true,
  };
  const c = criarControleDitado(deps);
  return {
    c,
    deps,
    leituras,
    /** Primeira leitura (o render do campo) com a disponibilidade dada. */
    async iniciar() {
      c.atualizar();
      leituras.at(-1)?.resolver(primeira);
      await esvaziar();
    },
    /** O canal recusa a gravação de índice `i` por falta do aviso. */
    recusar(i: number) {
      gravacoes[i]?.aoEvento({ t: "erro", codigo: "sem_consentimento" });
    },
  };
}

beforeEach(() => {
  gravacoes.length = 0;
  pedidos.length = 0;
  mic = { hidden: true };
  vi.stubGlobal("document", {
    querySelector: (sel: string) => (sel.includes('data-act="ditar"') ? mic : null),
    getElementById: () => null,
    // ADA-5: o 🎤 do chat e o da pílula do Quadro (um seletor só).
    querySelectorAll: (sel: string) => (sel.includes('data-act="ditar"') ? [mic] : []),
  });
  vi.stubGlobal("window", { setInterval: () => 1, clearInterval: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("controle do ditado com a disponibilidade velha (NOD-324)", () => {
  it("sem consentimento já sabido, o toque abre o diálogo antes do microfone", async () => {
    const t = montar(PEDE_V3);
    await t.iniciar();
    expect(mic.hidden).toBe(false);
    t.c.comecar();
    expect(pedidos).toHaveLength(1);
    expect(gravacoes).toHaveLength(0);
  });

  it("disp velho + sem_consentimento: relê e abre o diálogo, sem banner", async () => {
    const t = montar(JA_CONSENTIU);
    await t.iniciar();
    t.c.comecar();
    expect(gravacoes).toHaveLength(1);
    t.recusar(0);
    expect(t.deps.disponibilidade).toHaveBeenCalledTimes(2);
    t.leituras[1]?.resolver(PEDE_V3);
    await esvaziar();
    expect(pedidos).toHaveLength(1);
    expect(t.deps.avisar).not.toHaveBeenCalled();
  });

  it("recusar o diálogo não grava nada", async () => {
    const t = montar(JA_CONSENTIU);
    await t.iniciar();
    t.c.comecar();
    t.recusar(0);
    t.leituras[1]?.resolver(PEDE_V3);
    await esvaziar();
    pedidos[0]?.responder(false);
    await esvaziar();
    expect(t.deps.consentir).not.toHaveBeenCalled();
    expect(gravacoes).toHaveLength(1);
    expect(t.deps.avisar).not.toHaveBeenCalled();
  });

  it("aceitar consente com a versão da página e grava esperando o aceite", async () => {
    const t = montar(JA_CONSENTIU);
    await t.iniciar();
    t.c.comecar();
    t.recusar(0);
    t.leituras[1]?.resolver(PEDE_V3);
    await esvaziar();
    pedidos[0]?.responder(true);
    expect(t.deps.consentir).toHaveBeenCalledWith(3);
    expect(gravacoes).toHaveLength(2);
    expect(gravacoes[1]?.antesDeConectar).toBeInstanceOf(Promise);
    await esvaziar();
    // O pedido acabou: o próximo toque grava direto.
    gravacoes[1]?.aoEvento({ t: "texto", texto: "oi", teto: false });
    t.c.comecar();
    expect(gravacoes).toHaveLength(3);
    expect(pedidos).toHaveLength(1);
  });

  it("servidor com versão diferente da página: pede para atualizar, sem diálogo nem aceite", async () => {
    const t = montar(JA_CONSENTIU);
    await t.iniciar();
    t.c.comecar();
    t.recusar(0);
    t.leituras[1]?.resolver(PEDE_V4);
    await esvaziar();
    expect(pedidos).toHaveLength(0);
    expect(t.deps.consentir).not.toHaveBeenCalled();
    expect(t.deps.avisar).toHaveBeenCalledWith(textoDaFalha("aviso-mudou", true));
    // E o próximo toque, já sabendo, também.
    t.c.comecar();
    expect(gravacoes).toHaveLength(1);
    expect(t.deps.avisar).toHaveBeenCalledTimes(2);
  });

  it("sem_consentimento depois do diálogo vira \"falhou\", sem segundo diálogo", async () => {
    const t = montar(PEDE_V3);
    await t.iniciar();
    t.c.comecar();
    pedidos[0]?.responder(true);
    await esvaziar();
    t.recusar(0);
    await esvaziar();
    expect(pedidos).toHaveLength(1);
    expect(t.deps.avisar).toHaveBeenCalledWith(textoDaFalha("falhou", true));
    expect(t.deps.avisar).not.toHaveBeenCalledWith(textoDaFalha("sem_consentimento", true));
  });

  it("toque duplo durante a releitura abre um diálogo só", async () => {
    const t = montar(JA_CONSENTIU);
    await t.iniciar();
    t.c.comecar();
    t.recusar(0);
    t.c.comecar();
    t.c.comecar();
    t.leituras.at(-1)?.resolver(PEDE_V3);
    await esvaziar();
    t.c.comecar();
    expect(pedidos).toHaveLength(1);
    expect(gravacoes).toHaveLength(1);
  });

  for (const qual of ["descartar", "reiniciar"] as const) {
    it(`${qual}() no meio da releitura: nada abre nem grava`, async () => {
      const t = montar(JA_CONSENTIU);
      await t.iniciar();
      t.c.comecar();
      t.recusar(0);
      t.c[qual]();
      t.leituras[1]?.resolver(PEDE_V3);
      await esvaziar();
      expect(pedidos).toHaveLength(0);
      expect(t.deps.avisar).not.toHaveBeenCalled();
    });

    it(`${qual}() com o diálogo aberto: o "Concordo" não grava`, async () => {
      const t = montar(PEDE_V3);
      await t.iniciar();
      t.c.comecar();
      t.c[qual]();
      pedidos[0]?.responder(true);
      await esvaziar();
      expect(t.deps.consentir).not.toHaveBeenCalled();
      expect(gravacoes).toHaveLength(0);
    });
  }

  it("a leitura da sessão antiga que chega depois da troca é ignorada", async () => {
    const t = montar(JA_CONSENTIU);
    t.c.atualizar();
    const antiga = t.leituras[0];
    t.c.reiniciar();
    t.c.atualizar();
    t.leituras[1]?.resolver(PEDE_V3);
    await esvaziar();
    antiga?.resolver(JA_CONSENTIU);
    await esvaziar();
    t.c.comecar();
    expect(pedidos).toHaveLength(1);
    expect(gravacoes).toHaveLength(0);
  });

  it("trocar de sessão esquece a disponibilidade e descarta a gravação", async () => {
    const t = montar(JA_CONSENTIU);
    await t.iniciar();
    t.c.comecar();
    t.c.reiniciar();
    expect(gravacoes[0]?.descartar).toHaveBeenCalled();
    expect(t.c.ativo()).toBe(false);
    t.c.comecar();
    expect(gravacoes).toHaveLength(1);
    t.c.atualizar();
    expect(t.deps.disponibilidade).toHaveBeenCalledTimes(2);
  });

  it("releitura ultrapassada pela da reconexão, que chega antes, usa a leitura nova e abre o diálogo", async () => {
    const t = montar(JA_CONSENTIU);
    await t.iniciar();
    t.c.comecar();
    t.recusar(0);
    // aoReidratar no meio da releitura do sem_consentimento.
    void t.c.reler();
    t.leituras[2]?.resolver(PEDE_V3);
    await esvaziar();
    t.leituras[1]?.resolver(JA_CONSENTIU);
    await esvaziar();
    expect(pedidos).toHaveLength(1);
    expect(t.deps.avisar).not.toHaveBeenCalled();
  });

  it("reler() que falha mantém o 🎤", async () => {
    const t = montar(JA_CONSENTIU);
    await t.iniciar();
    const r = t.c.reler();
    t.leituras[1]?.rejeitar(new Error("rede"));
    expect(await r).toBe(false);
    expect(mic.hidden).toBe(false);
    t.c.comecar();
    expect(gravacoes).toHaveLength(1);
  });

  it("releitura que falha depois do sem_consentimento vira \"falhou\"", async () => {
    const t = montar(JA_CONSENTIU);
    await t.iniciar();
    t.c.comecar();
    t.recusar(0);
    t.leituras[1]?.rejeitar(new Error("rede"));
    await esvaziar();
    expect(pedidos).toHaveLength(0);
    expect(t.deps.avisar).toHaveBeenCalledWith(textoDaFalha("falhou", true));
    expect(mic.hidden).toBe(false);
  });

  it("ditado desligado na releitura esconde o 🎤 sem aviso", async () => {
    const t = montar(JA_CONSENTIU);
    await t.iniciar();
    t.c.comecar();
    t.recusar(0);
    t.leituras[1]?.resolver({ disponivel: false, motivo: "desligado" });
    await esvaziar();
    expect(mic.hidden).toBe(true);
    expect(t.deps.avisar).not.toHaveBeenCalled();
  });

  it("aceite recusado pelo servidor relê a disponibilidade", async () => {
    const t = montar(PEDE_V3);
    await t.iniciar();
    t.deps.consentir.mockImplementationOnce(() => Promise.reject(new Error("entrada_invalida")));
    t.c.comecar();
    pedidos[0]?.responder(true);
    await expect(gravacoes[0]?.antesDeConectar).rejects.toThrow("entrada_invalida");
    await esvaziar();
    expect(t.deps.disponibilidade).toHaveBeenCalledTimes(2);
    t.leituras[1]?.resolver(PEDE_V4);
    await esvaziar();
    gravacoes[0]?.aoEvento({ t: "erro", codigo: "falhou" });
    t.c.comecar();
    expect(t.deps.avisar).toHaveBeenLastCalledWith(textoDaFalha("aviso-mudou", true));
  });

  it("QA: o aceite da sessão anterior que chega depois da troca não libera o 🎤 da nova", async () => {
    const t = montar(PEDE_V3);
    await t.iniciar();
    const aceite = adiado<void>();
    t.deps.consentir.mockImplementationOnce(() => aceite.promessa);
    t.c.comecar();
    pedidos[0]?.responder(true);
    // Outra sessão, que também pede o aviso, enquanto o aceite da anterior ainda corre.
    t.c.reiniciar();
    t.c.atualizar();
    t.leituras.at(-1)?.resolver(PEDE_V3);
    await esvaziar();
    aceite.resolver();
    await esvaziar();
    t.c.comecar();
    expect(pedidos).toHaveLength(2);
    expect(gravacoes).toHaveLength(1);
  });

  it("QA: a leitura da sessão antiga que termina não solta a leitura da nova em curso (sem pedido duplicado)", async () => {
    const t = montar(JA_CONSENTIU);
    t.c.atualizar();
    t.c.reiniciar();
    t.c.atualizar();
    expect(t.deps.disponibilidade).toHaveBeenCalledTimes(2);
    t.leituras[0]?.resolver(JA_CONSENTIU);
    await esvaziar();
    // O render seguinte, com a leitura da sessão nova ainda correndo, não pede outra.
    t.c.atualizar();
    expect(t.deps.disponibilidade).toHaveBeenCalledTimes(2);
  });

  it("QA: a reconexão durante o aceite não desfaz o aceite da mesma sessão", async () => {
    const t = montar(PEDE_V3);
    await t.iniciar();
    const aceite = adiado<void>();
    t.deps.consentir.mockImplementationOnce(() => aceite.promessa);
    t.c.comecar();
    pedidos[0]?.responder(true);
    void t.c.reler();
    aceite.resolver();
    await esvaziar();
    gravacoes[0]?.aoEvento({ t: "texto", texto: "oi", teto: false });
    t.c.comecar();
    expect(pedidos).toHaveLength(1);
    expect(gravacoes).toHaveLength(2);
  });
});

describe("fiação do ditado em main.ts (NOD-324)", () => {
  const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
  const sessao = main.slice(main.indexOf("async function iniciarSessao("), main.indexOf("live.subscribe(", main.indexOf("async function iniciarSessao(")));

  it("iniciarSessao reinicia o ditado depois de trocar a api", () => {
    expect(sessao).toMatch(/api = criarApi\(escopo\);[\s\S]{0,200}ditado\.reiniciar\(\);/);
  });

  it("a reconexão (aoReidratar) relê a disponibilidade do ditado", () => {
    expect(sessao).toMatch(/aoReidratar: \(\) => \{[\s\S]{0,300}ditado\.reler\(\);[\s\S]{0,20}\}/);
  });
});
