import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaginasDto } from "../../../src/contracts/apps.ts";
import { esquecerPaginas, guardarOrdem, paginasDtoDe, paginasDoAgente, aoGuardarOrdem, definirPaginas } from "../../../web/lib/ordem-das-paginas.ts";
import { criarPaginasDoServidor, type FonteDasPaginas } from "../../../web/lib/paginas-do-servidor.ts";
import { appDe, paginasDe } from "../../helpers/paginas-do-bot.ts";

/** Uma promessa que o teste resolve (ou rejeita) quando quiser: a resposta do servidor na ordem que o teste escolhe. */
function adiada<T>() {
  let ok!: (v: T) => void;
  let erro!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => ((ok = a), (erro = b)));
  return { p, ok, erro };
}
const tique = () => new Promise((r) => setTimeout(r, 0));

const A = appDe("A");
const B = appDe("B");
const base = paginasDe([A, B], { agenteId: "bot" });
const comOrdem = (ordem: string[]): PaginasDto => ({ ...base, ordem });

function fonte(o: Partial<FonteDasPaginas> = {}): FonteDasPaginas {
  return { ler: vi.fn(), ordenar: vi.fn(), aoLer: vi.fn(), aoGuardar: vi.fn(), aoFalharOrdem: vi.fn(), ...o } as FonteDasPaginas;
}

afterEach(() => esquecerPaginas());

describe("o PUT da ordem (revisão 1 do #626: respostas fora de ordem)", () => {
  it("duas mudanças seguidas: a resposta da primeira chega depois e não desfaz a segunda", async () => {
    definirPaginas(base);
    const puts: ReturnType<typeof adiada<{ paginas: PaginasDto }>>[] = [];
    const f = fonte({ ordenar: vi.fn(() => { const d = adiada<{ paginas: PaginasDto }>(); puts.push(d); return d.p; }) });
    const s = criarPaginasDoServidor(f);
    const primeira = ["tarefas", "conversa", "app:id-a", "app:id-b"];
    const segunda = ["app:id-b", "tarefas", "conversa", "app:id-a"];
    const g1 = s.guardar("bot", primeira);
    const g2 = s.guardar("bot", segunda);
    puts[1]!.ok({ paginas: comOrdem(segunda) });
    await g2;
    puts[0]!.ok({ paginas: comOrdem(primeira) });
    await g1;
    expect(paginasDtoDe("bot")?.ordem).toEqual(segunda);
    expect(f.aoGuardar).toHaveBeenCalledTimes(1);
  });

  it("a primeira falha depois que a segunda já ficou: sem erro na tela e sem reler a ordem antiga", async () => {
    definirPaginas(base);
    const puts: ReturnType<typeof adiada<{ paginas: PaginasDto }>>[] = [];
    const f = fonte({ ordenar: vi.fn(() => { const d = adiada<{ paginas: PaginasDto }>(); puts.push(d); return d.p; }) });
    const s = criarPaginasDoServidor(f);
    const segunda = ["conversa", "app:id-b", "tarefas", "app:id-a"];
    const g1 = s.guardar("bot", ["tarefas", "conversa", "app:id-a", "app:id-b"]);
    const g2 = s.guardar("bot", segunda);
    puts[1]!.ok({ paginas: comOrdem(segunda) });
    await g2;
    puts[0]!.erro(new Error("rede"));
    await g1;
    expect(f.aoFalharOrdem).not.toHaveBeenCalled();
    expect(f.ler).not.toHaveBeenCalled();
    expect(paginasDtoDe("bot")?.ordem).toEqual(segunda);
  });

  it("a última falha: mostra o erro e relê a ordem do servidor", async () => {
    definirPaginas(base);
    const f = fonte({ ordenar: vi.fn(() => Promise.reject(new Error("rede"))), ler: vi.fn(() => Promise.resolve({ paginas: base })) });
    await criarPaginasDoServidor(f).guardar("bot", ["tarefas", "conversa", "app:id-a", "app:id-b"]);
    await tique();
    expect(f.aoFalharOrdem).toHaveBeenCalledTimes(1);
    expect(f.ler).toHaveBeenCalledTimes(1);
  });

  it("um GET que saiu antes de mover e volta depois não traz a ordem velha de volta", async () => {
    definirPaginas(base);
    const get = adiada<{ paginas: PaginasDto }>();
    const put = adiada<{ paginas: PaginasDto }>();
    const f = fonte({ ler: vi.fn(() => get.p), ordenar: vi.fn(() => put.p) });
    const s = criarPaginasDoServidor(f);
    s.ler("bot", true);
    const nova = ["app:id-a", "conversa", "tarefas", "app:id-b"];
    aoGuardarOrdem((ag, ids) => void s.guardar(ag, ids));
    guardarOrdem("bot", paginasDoAgente("bot"), [2, 0, 1, 3]);
    const pedida = paginasDtoDe("bot")!.ordem;
    expect(pedida).toEqual(nova);
    get.ok({ paginas: base });
    await tique();
    expect(paginasDtoDe("bot")?.ordem).toEqual(pedida);
    put.ok({ paginas: comOrdem(nova) });
    await tique();
    expect(paginasDtoDe("bot")?.ordem).toEqual(nova);
  });
});

describe("a leitura que falha (revisão 1 do #626: sem laço de GET)", () => {
  it("falhou: o render seguinte não pede de novo; a nova tentativa vem com espera crescente e para no sucesso", async () => {
    vi.useFakeTimers();
    try {
      let falhas = 2;
      const ler = vi.fn(() => (falhas-- > 0 ? Promise.reject(new Error("rede")) : Promise.resolve({ paginas: base })));
      const f = fonte({ ler });
      const s = criarPaginasDoServidor(f);
      s.ler("bot");
      await vi.advanceTimersByTimeAsync(0);
      expect(ler).toHaveBeenCalledTimes(1);
      // Cada render da conversa chama ler(): durante a espera, nenhum GET.
      for (let i = 0; i < 50; i++) s.ler("bot");
      await vi.advanceTimersByTimeAsync(0);
      expect(ler).toHaveBeenCalledTimes(1);
      // A primeira espera (2 s) acaba: tenta de novo, sozinha; falha e dobra (4 s).
      await vi.advanceTimersByTimeAsync(2_000);
      expect(ler).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(ler).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(ler).toHaveBeenCalledTimes(3);
      expect(f.aoLer).toHaveBeenCalledTimes(1);
      expect(paginasDtoDe("bot")).toBeDefined();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(ler).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("o frame paginas.mudaram (forçar) tenta na hora mesmo durante a espera, e o bot que falhou conta como conhecido", async () => {
    vi.useFakeTimers();
    try {
      const ler = vi.fn(() => Promise.reject(new Error("rede")));
      const s = criarPaginasDoServidor(fonte({ ler }));
      expect(s.conhece("bot")).toBe(false);
      s.ler("bot");
      await vi.advanceTimersByTimeAsync(0);
      expect(s.conhece("bot")).toBe(true);
      s.ler("bot", true);
      await vi.advanceTimersByTimeAsync(0);
      expect(ler).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

it("revisão 4 do #626: lendo() diz se o GET do bot está no ar (o esqueleto do app vazio dura só isso), com ou sem falha", async () => {
  const gets: ReturnType<typeof adiada<{ paginas: PaginasDto }>>[] = [];
  const s = criarPaginasDoServidor(fonte({ ler: vi.fn(() => { const d = adiada<{ paginas: PaginasDto }>(); gets.push(d); return d.p; }) }));
  expect(s.lendo("bot")).toBe(false);
  s.ler("bot");
  expect(s.lendo("bot")).toBe(true);
  gets[0]!.ok({ paginas: base });
  await tique();
  expect(s.lendo("bot")).toBe(false);
  s.ler("bot", true);
  expect(s.lendo("bot")).toBe(true);
  gets[1]!.erro(new Error("rede"));
  await tique();
  expect(s.lendo("bot")).toBe(false);
});

it("o frame que chega com um GET no ar pede outro quando ele volta (um GET por vez)", async () => {
  const gets: ReturnType<typeof adiada<{ paginas: PaginasDto }>>[] = [];
  const ler = vi.fn(() => { const d = adiada<{ paginas: PaginasDto }>(); gets.push(d); return d.p; });
  const s = criarPaginasDoServidor(fonte({ ler }));
  s.ler("bot");
  s.ler("bot", true);
  s.ler("bot", true);
  expect(ler).toHaveBeenCalledTimes(1);
  gets[0]!.ok({ paginas: base });
  await tique();
  expect(ler).toHaveBeenCalledTimes(2);
  gets[1]!.ok({ paginas: comOrdem(["app:id-b", "conversa", "tarefas", "app:id-a"]) });
  await tique();
  expect(paginasDtoDe("bot")?.ordem[0]).toBe("app:id-b");
});
