import { describe, expect, it } from "vitest";
import type { ComentarioDto } from "../../../src/contracts/quadro.ts";
import type { PayloadPropostaQuadroExclusao } from "../../../src/contracts/quadro-exclusao.ts";
import { textoFormatado } from "../../../web/lib/texto-formatado.ts";
import { renderCardQuadroExclusao } from "../../../web/telas/card-quadro-exclusao.ts";
import { linhaDoTempo } from "../../../web/telas/linha-do-tempo.ts";
import { renderSuaVez } from "../../../web/telas/sua-vez.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import type { SuaVezDto } from "../../../src/contracts/api.ts";

/** NOD-430: o link da tarefa na resposta, o card de excluir o quadro e a assinatura "Você, pela Ada". */
const ENG = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";

describe("o código da tarefa na resposta do bot (NOD-430)", () => {
  it("vira o botão que abre a tarefa no quadro do dono", () => {
    expect(textoFormatado(`Criei [NOD-12](nod-tarefa:${ENG}:${T}).`)).toBe(`Criei <button type="button" class="md-midia-link md-tarefa-link" data-act="abrir-tarefa-quadro" data-agente="${ENG}" data-tarefa="${T}" aria-label="Abrir tarefa NOD-12 no quadro">NOD-12</button>.`);
  });
  it("id que não é uuid fica como o bot escreveu", () => {
    expect(textoFormatado("[x](nod-tarefa:abc:def)")).not.toContain("data-act");
  });
});

const PAYLOAD: PayloadPropostaQuadroExclusao = { kind: "quadro_exclusao", quadroId: "q", anfitriaoId: ENG, anfitriaoNome: "EngApp", tarefas: 12, colunas: 5, temMeta: true, revisao: "{}" };

describe("card de excluir o quadro (NOD-430)", () => {
  it("aberto: o que sai, o que fica, sem Desfazer, Excluir e Agora não", () => {
    const h = renderCardQuadroExclusao({ id: "p1", estado: "pendente" }, PAYLOAD, true);
    expect(h).toContain("Excluir o quadro do EngApp");
    // ADA-14: com N quadros, o card diz qual (o sem nome segue "o quadro do EngApp").
    expect(renderCardQuadroExclusao({ id: "p1", estado: "pendente" }, { ...PAYLOAD, quadroNome: "Site" }, true)).toContain("Excluir o quadro &quot;Site&quot; do EngApp");
    expect(h).toContain("Sai: 12 tarefas, 5 colunas, a meta e o histórico");
    expect(h).toContain("Fica: a conversa e a memória do EngApp");
    expect(h).toContain("Não dá para desfazer.");
    expect(h).toMatch(/data-act="decidir-proposta"[^>]*>Excluir</);
    expect(h).toMatch(/data-act="recusar-decisao"[^>]*>Agora não</);
  });
  it("decidido: sem botões, com o desfecho", () => {
    const sim = renderCardQuadroExclusao({ id: "p1", estado: "confirmada" }, { ...PAYLOAD, tarefas: 1, colunas: 1, temMeta: false }, false);
    expect(sim).toContain("Sai: 1 tarefa, 1 coluna e o histórico");
    expect(sim).toContain("Quadro excluído. EngApp voltou a ser um agente comum.");
    expect(sim).not.toContain("data-act");
    expect(renderCardQuadroExclusao({ id: "p1", estado: "recusada" }, PAYLOAD, false)).toContain("Quadro mantido.");
  });
});

describe("o card de excluir o quadro na Sua vez (NOD-430, revisão 1)", () => {
  it("é sutil como o da conversa: Excluir neutro com o verbo em vermelho, sem botão cheio (pri)", () => {
    const item: SuaVezDto["itens"][number] = {
      decisao: { tenantId: "t", id: "p1", ownerId: "p", decisorId: "p", agenteId: "a", conversaId: "c", turnoId: null, tipo: "quadro_exclusao", estado: "pendente", prazoDecisaoEm: "2026-11-03T00:00:00Z", prazoExecucaoEm: null, frase: "Excluir o quadro do EngApp: 12 tarefas, 5 colunas e a meta", desfecho: null, vistaEm: null, criadoEm: "2026-11-02T00:00:00Z", fioId: null },
      estadoColuna: "pendente", agenteNome: "Ada", aguardandoHaMs: 0, recusaAutomaticaEmMs: 60_000, gemeas: [], itensAprovacao: [], fio: null, rotinaParada: null,
      proposta: { tenantId: "t", id: "p1", conversaId: "c", agenteId: "a", kind: "quadro_exclusao", estado: "pendente", criadoEm: 0, payload: PAYLOAD },
    };
    const estado: Estado = { ...estadoInicial, suaVez: { itens: [item], incidentes: [], foraDoAr: [], vazio: false, ultimaDecisaoEm: null } };
    const h = renderSuaVez(estado);
    const excluir = h.match(/<button[^>]*data-act="decidir-proposta"[^>]*>Excluir<\/button>/)?.[0];
    expect(excluir).toBeDefined();
    expect(excluir).not.toMatch(/class="[^"]*\bpri\b/);
    expect(excluir).toMatch(/class="[^"]*\bdanger\b/);
    expect(h).toMatch(/data-act="recusar-decisao"[^>]*>Agora não</);
  });
});

describe("assinatura na tarefa aberta (NOD-430)", () => {
  const agente = ((id: string) => (id === "ada" ? { avatar: "", nome: "Ada" } : null)) as never;
  const com = (o: Partial<ComentarioDto>): ComentarioDto => ({ id: "c1", quadroId: "q", tarefaId: T, autor: { tipo: "agente", agenteId: "ada" }, texto: "Olhei", deFora: false, criadoEm: 0, autorNome: "Ada", acionados: [], ...o });
  // 2026-11-10: a tarefa aberta desenha os comentários pela linha do tempo (o comentarios-tarefa.ts antigo saiu).
  const linha = (lista: ComentarioDto[], o: { criadaPor?: string | null; criadaEm?: number | null } = {}) => linhaDoTempo({
    t: { id: T, quadroId: "q", titulo: "T", descricao: "", status: "fazendo", agenteId: "ada", movimentos: [], linhas: [] } as never, colunas: [], comentarios: lista, runs: [], agente, agora: Date.UTC(2026, 10, 2, 14), nomes: ["Ada"],
    respondendo: null, editando: null, abertos: new Set(), passos: () => null, chips: () => "", pendente: null, criadaPor: o.criadaPor ?? null, criadaEm: o.criadaEm ?? null, carga: "ok",
  });
  it("comentário a pedido da pessoa assina Você, pela Ada; o do bot sozinho, Ada", () => {
    const h = linha([com({ pedidoPor: "pessoa" }), com({ id: "c2", texto: "Sozinha" })]);
    expect(h).toContain("Você, pela Ada");
    expect(h.split("Você, pela Ada").length - 1).toBe(1);
  });
  it("quem criou a tarefa vem antes dos comentários", () => {
    const h = linha([com({ criadoEm: 120_000 })], { criadaPor: "Você, pela Ada", criadaEm: 60_000 });
    expect(h).toContain("<b>Você, pela Ada</b> criou a tarefa");
    expect(h.indexOf("criou a tarefa")).toBeLessThan(h.indexOf("Olhei"));
  });
  it("revisão 1: a hora do comentário leva o datetime ISO no <time>", () => {
    const em = Date.UTC(2026, 10, 2, 13, 6);
    const h = linha([com({ criadoEm: em })]);
    expect(h).toContain('<time datetime="2026-11-02T13:06:00.000Z"');
    expect(h).not.toContain("<time>");
  });
});
