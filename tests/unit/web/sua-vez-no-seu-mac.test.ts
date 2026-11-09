import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { renderSuaVez } from "../../../web/telas/sua-vez.ts";

/**
 * ADA-243 (revisão do PR #692): o motivo do "Sempre permitir" desligado no comando do terminal virou `noSeuMac()`, mas
 * dentro de aspas duplas: a tela mostrava o literal "${noSeuMac()}" no title do botão.
 */
type Item = SuaVezDto["itens"][number];
type ItemAprov = Item["itensAprovacao"][number];

const item = (): Item => ({
  decisao: { tenantId: "t", id: "d1", ownerId: "p", decisorId: "p", agenteId: "ze", conversaId: "c", turnoId: null, tipo: "aprovacao", estado: "pendente", prazoDecisaoEm: "2026-10-19T00:00:00Z", prazoExecucaoEm: null, frase: "Ze quer rodar um comando", desfecho: null, vistaEm: null, criadoEm: "2026-10-18T00:00:00Z", fioId: null },
  estadoColuna: "pendente", agenteNome: "Ze", aguardandoHaMs: 60_000, recusaAutomaticaEmMs: 60_000, gemeas: [], proposta: null, fio: null, rotinaParada: null,
  itensAprovacao: [{ tenantId: "t", id: "i1", decisaoId: "d1", idx: 0, textoOriginal: "ls", textoFinal: "ls", destino: { conector: "terminal", ferramenta: "bash", argumentos: { comando: "ls" } }, selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null } as unknown as ItemAprov],
} as unknown as Item);

describe("Sua vez: o comando do terminal no 'Sempre permitir' desligado", () => {
  it("diz onde o comando roda, sem o literal ${noSeuMac()}", () => {
    const e: Estado = { ...estadoInicial, sessao: { pessoaId: "p", tenantId: "t" } as never, frota: { agentes: [{ id: "ze", nome: "Ze", conversaId: "c", ownerId: "p" }] } as never, suaVez: { itens: [item()], incidentes: [], foraDoAr: [], vazio: false, ultimaDecisaoEm: null } };
    const html = renderSuaVez(e);
    expect(html).toContain("decidir-aprovacao-sempre");
    expect(html).not.toContain("${");
    expect(html).toContain("Comando no seu Mac é aprovado um a um");
  });
});
