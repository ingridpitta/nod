import { describe, expect, it, vi } from "vitest";
import { criarQuadroNaTela } from "../../../web/lib/quadro-na-tela.ts";

/**
 * NOD-430: o código da tarefa num chat abre a conversa do dono já na tarefa (quadroNaTela.abrirTarefaDe). Importa código de
 * DOM: quem checa os tipos é o tsconfig.web.json.
 */
const ENG = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";

describe("abrir a tarefa pelo código (quadroNaTela.abrirTarefaDe, NOD-430, revisão 1)", () => {
  // O unit não tem DOM: um documento vazio basta (sem #quadro, a troca de aba não anima). Quem prova que a tarefa abriu é a
  // leitura dos comentários dela (coms.abrir → comentariosDaTarefa).
  const montar = () => {
    const doc = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, activeElement: null } as unknown as Document;
    const comentariosDaTarefa = vi.fn(async () => ({ comentarios: [] }));
    const api = { comentariosDaTarefa } as never;
    const tela = criarQuadroNaTela(doc, { reduzido: () => true, dados: { api: () => api, agente: (() => null) as never, hora: () => "10:00" } });
    return { tela, comentariosDaTarefa };
  };
  it("o dono com quadro: a tarefa abre quando a conversa dele sincroniza", () => {
    const { tela, comentariosDaTarefa } = montar();
    tela.abrirTarefaDe(ENG, T);
    tela.sincronizar({ chave: "c-eng", nome: "EngApp", agenteId: ENG });
    expect(comentariosDaTarefa).toHaveBeenCalledWith(ENG, T);
  });
  it("o dono sem quadro: o pedido cai, e não abre a tarefa velha quando o quadro dele voltar", () => {
    const { tela, comentariosDaTarefa } = montar();
    tela.abrirTarefaDe(ENG, T);
    // A conversa do dono chegou à tela, mas ele não tem quadro (foi excluído).
    tela.sincronizar({ chave: null, nome: "", agenteId: ENG });
    // Depois ele ganha um quadro novo e a pessoa volta à conversa: nada de abrir a tarefa do pedido antigo.
    tela.sincronizar({ chave: "c-eng", nome: "EngApp", agenteId: ENG });
    expect(comentariosDaTarefa).not.toHaveBeenCalled();
  });
});
