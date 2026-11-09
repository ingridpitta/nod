import { describe, expect, it } from "vitest";
import { mediana, medirLinhas, medirMensagem, resumir } from "../../../scripts/medir-chat-limpo.ts";

const base = { payload: null, texto: "", decidido_por: "pessoa" as const, assunto: null, de_trabalho: false, primeira: false };

describe("medir-chat-limpo (a régua das metas)", () => {
  it("fala conta nas duas colunas; o aviso que sai do chat só hoje; o que fica, nas duas", () => {
    expect(medirMensagem({ ...base, kind: "texto", texto: "Oi" })).toEqual({ assunto: null, fala: true, hoje: true, tabela: true, troca: false });
    expect(medirMensagem({ ...base, kind: "sistema", assunto: "memoria.anotada" })).toMatchObject({ fala: false, hoje: true, tabela: false });
    expect(medirMensagem({ ...base, kind: "sistema", assunto: "turno.orfao" })).toMatchObject({ hoje: true, tabela: true });
    // Linha sem backfill: o assunto vem do texto, na hora.
    expect(medirMensagem({ ...base, kind: "sistema", texto: "Anotei um fato: o repo é o nod" })).toMatchObject({ assunto: "memoria.anotada", tabela: false });
  });

  it("fala de turno com trabalho e rotina silenciosa contam como escondidas nas duas", () => {
    expect(medirMensagem({ ...base, kind: "texto", texto: "Passo 3", de_trabalho: true })).toMatchObject({ hoje: false, tabela: false });
    expect(medirMensagem({ ...base, kind: "rotina_execucao", payload: { kind: "rotina_execucao", rotinaId: "r", instanteAgendado: 1, desfecho: "executou" } })).toMatchObject({ hoje: false, tabela: false });
  });

  it("só conversas com 20+ itens visíveis hoje entram; a mediana é da parcela de falas", () => {
    expect(mediana([])).toBeNull();
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
    const r = resumir([
      { itensHoje: 20, falasHoje: 10, itensTabela: 11, falasTabela: 10 },
      { itensHoje: 40, falasHoje: 30, itensTabela: 31, falasTabela: 30 },
      { itensHoje: 5, falasHoje: 0, itensTabela: 0, falasTabela: 0 },
    ]);
    expect(r.conversas).toBe(2);
    expect(r.falasHoje).toBeCloseTo((50 + 75) / 2);
    expect(r.falasTabela).toBeCloseTo((100 * 10 / 11 + 100 * 30 / 31) / 2);
  });

  it("PR 3: mensagens entre bots seguidas contam UM item na coluna da tabela (a troca); um item à vista ou 30 min de pausa separam", () => {
    const MIN = 60_000;
    const linha = (em: number, extra: Partial<Parameters<typeof medirMensagem>[0]> & { kind: Parameters<typeof medirMensagem>[0]["kind"] }) => ({ conversa_id: "c", ...base, em, ...extra });
    const pedido = (em: number) => linha(em, { kind: "texto", assunto: "colega.pedido", de_delegacao: true });
    const doTurno = (em: number) => linha(em, { kind: "texto", texto: "Revisado", de_delegacao: true });
    const respondido = (em: number) => linha(em, { kind: "sistema", assunto: "pedido.respondido" });
    expect(medirMensagem(doTurno(0))).toMatchObject({ fala: true, troca: true });
    const r = medirLinhas([
      pedido(0), doTurno(MIN), doTurno(2 * MIN), respondido(3 * MIN), pedido(4 * MIN), // uma troca (cinco mensagens)
      linha(5 * MIN, { kind: "texto", texto: "Oi" }), // uma fala separa
      pedido(6 * MIN), respondido(7 * MIN), // outra troca
      pedido(60 * MIN), // a pausa de 30 min separa
    ], new Map()).get("c")!;
    expect(r).toMatchObject({ itensTabela: 4, falasTabela: 1 });
    // A coluna "hoje" conta como antes: cada uma das nove mensagens é um item.
    expect(r.itensHoje).toBe(9);
  });
});
