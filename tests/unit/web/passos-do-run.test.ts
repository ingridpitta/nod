import { describe, expect, it } from "vitest";
import type { PassoDoRun } from "../../../src/contracts/quadro-comentarios.ts";
import { classeDaFerramenta, criarPassosDosRuns, passoDoFrame, vistaDosPassos } from "../../../web/lib/passos-do-run.ts";
import { agruparPassos, comRecados, listaDePassos, PASSOS_A_VISTA } from "../../../web/telas/passos-do-run.ts";

const passo = (seq: number, o: Partial<PassoDoRun> = {}): PassoDoRun => ({ seq, tipo: "ferramenta", classe: "comando", ferramenta: "Bash", rotulo: "Rodando um comando", resumo: null, acaoId: null, falhou: false, em: seq * 1000, ...o });

describe("passos do run (Passo 2: rota + frames por seq)", () => {
  it("a rota e os frames se mesclam por seq: o frame que chega antes da rota não duplica nem some", async () => {
    let mudou = 0;
    const api = { passosDoRun: async (_a: string, _t: string, _turno: string, depois?: number | null) => (depois ? { passos: [], fim: true } : { passos: [passo(1), passo(2, { resumo: "npm test" })], fim: true }) };
    const p = criarPassosDosRuns({ api: () => api, aoMudar: () => { mudou++; }, agora: () => 9_000 });
    p.ligar([{ turnoId: "raiz", turnoAtual: "retomada" }]);
    expect(p.aoFrame({ tipo: "turno.atividade", dados: { turnoId: "retomada", seq: 2, rotulo: "Rodando um comando", resumo: "npm test", id: "a2" } })).toBe("raiz");
    expect(p.aoFrame({ tipo: "turno.atividade", dados: { turnoId: "retomada", seq: 3, rotulo: "Lendo um arquivo", classe: "arquivo", resumo: "quadro.ts", id: "a3" } })).toBe("raiz");
    p.carregar("ag", "t", "raiz");
    await new Promise((r) => setTimeout(r, 0));
    const v = p.de("raiz")!;
    expect(v.lista.map((x) => x.seq)).toEqual([1, 2, 3]);
    expect(v.ultimo).toBe("Lendo um arquivo · quadro.ts");
    expect(v.carregado).toBe(true);
    expect(mudou).toBe(1);
    // O fim da ação marca a falha pelo id; o turno de outro run é ignorado.
    p.aoFrame({ tipo: "turno.acao_fim", dados: { turnoId: "retomada", id: "a3", falhou: true } });
    expect(p.de("raiz")!.lista.at(-1)!.falhou).toBe(true);
    expect(p.aoFrame({ tipo: "turno.atividade", dados: { turnoId: "outro", seq: 9, rotulo: "x" } })).toBeNull();
  });

  // Revisão do PR #16: o run termina enquanto a primeira leitura ainda está no ar. A leitura velha não pode marcar o cache
  // como carregado: a fala persistida do fim (que só a rota traz) tem de ser lida de novo.
  it("o fim do run no meio da leitura relê os passos (a leitura velha não fecha o cache)", async () => {
    let soltar: () => void = () => undefined;
    const chamadas: number[] = [];
    const api = {
      passosDoRun: async () => {
        chamadas.push(chamadas.length);
        if (chamadas.length === 1) { await new Promise<void>((r) => { soltar = r; }); return { passos: [passo(1)], fim: true }; }
        return { passos: [passo(1), passo(2, { tipo: "texto", classe: "texto", ferramenta: null, rotulo: "Feito: PR #3" })], fim: true };
      },
    };
    const p = criarPassosDosRuns({ api: () => api, aoMudar: () => undefined });
    p.ligar([{ turnoId: "raiz", turnoAtual: "raiz" }]);
    p.carregar("ag", "t", "raiz");
    p.aoFrame({ tipo: "turno.encerrado", dados: { turnoId: "raiz" } });
    p.carregar("ag", "t", "raiz", true);
    soltar();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(chamadas.length).toBe(2);
    expect(p.de("raiz")!.lista.map((x) => x.seq)).toEqual([1, 2]);
    expect(p.de("raiz")!.carregado).toBe(true);
  });

  it("o texto ao vivo vence como último passo até vir uma ferramenta; o n é o maior entre o servidor e o cache", () => {
    const v = vistaDosPassos({ passos: new Map([[1, passo(1)]]), texto: "pensando no plano", carregado: false }, 7);
    expect(v.ultimo).toBe("pensando no plano");
    expect(v.n).toBe(7);
  });

  it("o frame sem seq (servidor antigo) entra depois dos persistidos, com a classe pelo nome", () => {
    const p = passoDoFrame({ rotulo: "Usando Linear", ferramenta: "mcp__linear__x" }, 1e15, 1);
    expect(p.seq).toBe(1e15);
    expect(p.classe).toBe("app");
    expect(classeDaFerramenta("Grep")).toBe("busca");
    expect(classeDaFerramenta("Edit")).toBe("arquivo");
  });

  it("3 ou mais chamadas seguidas da mesma ferramenta viram um grupo ×N; 2 não", () => {
    const itens = agruparPassos([passo(1), passo(2), passo(3), passo(4, { ferramenta: "Read", classe: "arquivo" }), passo(5, { ferramenta: "Grep" }), passo(6, { ferramenta: "Grep" })]);
    expect(itens.map((i) => i.tipo)).toEqual(["grupo", "passo", "passo", "passo"]);
    expect(listaDePassos({ turno: "r", lista: [passo(1), passo(2), passo(3)], todos: false })).toContain('<span class="qd-n">×3</span>');
  });

  it("os 12 últimos à vista e 'mostrar N anteriores'; o recado lido entra no ponto em que foi lido", () => {
    const lista = Array.from({ length: 20 }, (_, i) => passo(i + 1, { ferramenta: `F${i}` }));
    const h = listaDePassos({ turno: "r", lista, todos: false });
    expect(h).toContain(`mostrar ${20 - PASSOS_A_VISTA} anteriores`);
    expect(h.match(/class="ta-passo"/g)?.length).toBe(PASSOS_A_VISTA);
    expect(listaDePassos({ turno: "r", lista, todos: true }).match(/class="ta-passo"/g)?.length).toBe(20);
    const com = comRecados(agruparPassos([passo(1, { ferramenta: "A" }), passo(3, { ferramenta: "B" })]), [{ em: 2000, texto: "use a branch nova" }]);
    expect(com.map((i) => i.tipo)).toEqual(["passo", "recado", "passo"]);
  });

  it("o resumo do passo sai escapado (é texto de fora)", () => {
    expect(listaDePassos({ turno: "r", lista: [passo(1, { resumo: "<img src=x onerror=1>" })], todos: true })).not.toContain("<img");
  });
});
