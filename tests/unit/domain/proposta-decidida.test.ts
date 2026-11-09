import { describe, expect, it } from "vitest";
import type { PayloadProposta } from "../../../src/contracts/conversa.ts";
import { tituloDaProposta } from "../../../src/domain/proposta-decidida.ts";

/** Chat limpo, PR 4: o título do cartão encolhido da proposta, gravado no payload `proposta_decidida`. */
describe("tituloDaProposta", () => {
  const t = (payload: PayloadProposta) => tituloDaProposta({ payload });
  const rotina = { cron: "0 9 * * *", fusoIana: "America/Sao_Paulo", instrucao: "x", fonte: "x", entregavel: "x", limitesAprovacao: "x", politicaSemDado: "x", proximaExecucao: 1 };

  it("o nome do cartão aberto com o que identifica o pedido", () => {
    expect(t({ kind: "rotina", ...rotina, resumo: "todo dia às 09:00" })).toBe("Rotina · todo dia às 09:00");
    expect(t({ kind: "rotina_atualizacao", rotinaId: "r", proximaExecucao: 1, resumo: "às 10:00", antes: { resumo: "às 09:00", instrucao: "x" } })).toBe("Mudança de rotina · às 10:00");
    expect(t({ kind: "rotina_exclusao", rotinaId: "r", resumo: "às 09:00", instrucao: "x" })).toBe("Excluir rotina · às 09:00");
    expect(t({ kind: "perfil", nome: "Clarice" })).toBe("Perfil · Clarice");
    expect(t({ kind: "bot", nome: "Eng 2", descricao: "x", forma: "shape-circle", cor: "c-red", voz: null } as never)).toBe("Novo bot · Eng 2");
    expect(t({ kind: "acesso", conector: "gmail", capacidades: [], nivel: "leitura", naoPedido: [] })).toBe("Acesso a conector · gmail");
    expect(t({ kind: "pasta", candidatas: [{ caminho: "/x/acme", nome: "acme", git: true }], motivo: "m", buscaTermo: "acme-site" })).toBe("Abrir o projeto acme");
    expect(t({ kind: "lote_bots", resumo: "criar 2 bots", acoes: [] })).toBe("Mudanças nos bots · criar 2 bots");
    expect(t({ kind: "quadro_exclusao", quadroId: "q", anfitriaoId: "a", anfitriaoNome: "Ana", quadroNome: "Site", tarefas: 0, colunas: 5, temMeta: false, revisao: "{}" })).toBe('Excluir o quadro "Site" do Ana');
    expect(t({ kind: "quadro_exclusao", quadroId: "q", anfitriaoId: "a", anfitriaoNome: "Ana", tarefas: 0, colunas: 5, temMeta: false, revisao: "{}" })).toBe("Excluir o quadro do Ana");
  });

  it("sem o detalhe (perfil só com título, pasta sem candidata), o nome sozinho ou o termo da busca", () => {
    expect(t({ kind: "perfil", titulo: "Revisora" })).toBe("Perfil");
    expect(t({ kind: "pasta", candidatas: [], motivo: "m", buscaTermo: "acme" })).toBe("Abrir o projeto acme");
  });
});
