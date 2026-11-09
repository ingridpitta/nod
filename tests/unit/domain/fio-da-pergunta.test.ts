import { describe, expect, it } from "vitest";
import type { Decisao } from "../../../src/contracts/decisao.ts";
import type { Mensagem, PayloadMensagem } from "../../../src/contracts/mensagem.ts";
import { agruparFios, chaveDoFio, estadoDoFio, HISTORICO_CARACTERES, HISTORICO_DO_FIO_MAX, historicoDoFio, mensagensDoFio, rodadaNoFio } from "../../../src/domain/fio-da-pergunta.ts";

/**
 * Fio da pergunta (emenda da ADR-045, definido em 2026-09-24): a pergunta é um fio que fica aberto
 * enquanto o agente ainda precisa da pessoa e fecha sozinho quando ele segue. O estado é derivado da
 * última rodada e do turno que a resposta criou — sem coluna nova.
 */
const EM = Date.parse("2026-09-24T12:00:00Z");

function decisao(id: string, p: Partial<Decisao> = {}): Decisao {
  return {
    tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: "a", conversaId: "c", turnoId: `turno-${id}`, tipo: "pergunta", estado: "pendente",
    prazoDecisaoEm: new Date(EM + 86_400_000).toISOString(), prazoExecucaoEm: null, frase: "parei para perguntar", desfecho: null, vistaEm: null,
    criadoEm: new Date(EM).toISOString(), fioId: null, ...p,
  };
}

const autoria = { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 } as const;

function mensagem(id: string, turnoId: string | null, texto: string, payload: PayloadMensagem | null = null, pessoa = false): Mensagem {
  return { tenantId: "t", id, conversaId: "c", turnoId, autoria: pessoa ? { ...autoria, autor_tipo: "pessoa", autor_id: "p", decidido_por: "pessoa" } : autoria, kind: "texto", texto, payload, confianca: "confiavel", parcial: false, criadoEm: EM };
}

const respondida = { estado: "decidida", desfecho: { tipo: "decidida", por: "p", em: new Date(EM).toISOString() } } as const;

describe("estado do fio: derivado da última rodada e da retomada que a resposta criou", () => {
  it("esperando você · lendo sua mensagem · resolvida · deixada pra lá · vencida", () => {
    expect(estadoDoFio(decisao("d"), null)).toBe("esperando_voce");
    expect(estadoDoFio(decisao("d", { estado: "reaberta" }), null)).toBe("esperando_voce");
    expect(estadoDoFio(decisao("d", { estado: "vencida", desfecho: { tipo: "expirou_sem_ninguem_ver", em: "x" } }), null)).toBe("vencida");
    expect(estadoDoFio(decisao("d", { estado: "decidida", desfecho: { tipo: "dispensada", por: "p", em: "x", antes: "pendente" } }), null)).toBe("deixada_pra_la");
    // Respondida: a pergunta continua aberta enquanto o agente lê (a retomada na fila ou rodando)…
    expect(estadoDoFio(decisao("d", respondida), "pendente")).toBe("lendo_sua_mensagem");
    expect(estadoDoFio(decisao("d", respondida), "despachando")).toBe("lendo_sua_mensagem");
    // …e fecha sozinha quando ele segue sem perguntar de novo.
    expect(estadoDoFio(decisao("d", respondida), "concluido")).toBe("resolvida");
    expect(estadoDoFio(decisao("d", respondida), "interrompido")).toBe("resolvida");
    // Resposta anterior ao fio (sem turnoRetomadaId) ou sem turno: nada a esperar.
    expect(estadoDoFio(decisao("d", respondida), null)).toBe("resolvida");
  });

  it("três rodadas são UM fio: a chave é a primeira decisão e a terceira é a 3ª rodada", () => {
    const d1 = decisao("d1", { ...respondida });
    const d2 = decisao("d2", { ...respondida, fioId: "d1", criadoEm: new Date(EM + 1000).toISOString() });
    const d3 = decisao("d3", { fioId: "d1", criadoEm: new Date(EM + 2000).toISOString() });
    const outra = decisao("x", { criadoEm: new Date(EM + 500).toISOString() });
    const fios = agruparFios([d3, outra, d1, d2]);
    expect([...fios.keys()].sort()).toEqual(["d1", "x"]);
    expect(fios.get("d1")?.map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
    expect([d1, d2, d3].map(chaveDoFio)).toEqual(["d1", "d1", "d1"]);
    expect(rodadaNoFio(fios.get("d1") ?? [], "d3")).toBe(3);
    expect(rodadaNoFio(fios.get("d1") ?? [], "d1")).toBe(1);
    expect(estadoDoFio(fios.get("d1")?.at(-1) ?? d1, null)).toBe("esperando_voce");
  });
});

describe("mensagens do fio", () => {
  it("as perguntas, as respostas e as explicações das retomadas que perguntaram de novo — nem o trabalho de antes, nem o de depois, nem 'Outro assunto'", () => {
    const d1 = decisao("d1", { turnoId: "T0" });
    const d2 = decisao("d2", { turnoId: "R1", fioId: "d1" });
    const mensagens = [
      mensagem("antes", "T0", "Li os PRs abertos."),
      mensagem("p1", "T0", "Posso arquivar o PR 7?", { kind: "pedido_a_pessoa", decisaoId: "d1" }),
      mensagem("outro", null, "E o deploy de ontem?", null, true),
      mensagem("r1", "T0", "O que é arquivar?", { kind: "resposta_a_pedido", decisaoId: "d1", agenteId: "a", perguntaEm: EM, retomada: true, turnoRetomadaId: "R1" }, true),
      mensagem("e1", "R1", "Arquivar fecha o PR sem juntar o código."),
      mensagem("p2", "R1", "Então: posso arquivar o PR 7?", { kind: "pedido_a_pessoa", decisaoId: "d2" }),
      mensagem("r2", "R1", "Pode.", { kind: "resposta_a_pedido", decisaoId: "d2", agenteId: "a", perguntaEm: EM, retomada: true, turnoRetomadaId: "R2" }, true),
      mensagem("depois", "R2", "Arquivei o PR 7."),
    ];
    expect(mensagensDoFio([d1, d2], mensagens).map((m) => m.id)).toEqual(["p1", "r1", "e1", "p2", "r2"]);
    expect(mensagensDoFio([d1], mensagens).map((m) => m.id)).toEqual(["p1", "r1"]);
  });

  it("NOD-353 (revisão 2 do #523): a explicação da retomada que usou ferramentas (fala com resumo das ações) continua no fio e no histórico", () => {
    const d1 = decisao("d1", { turnoId: "T0" });
    const d2 = decisao("d2", { turnoId: "R1", fioId: "d1" });
    const mensagens = [
      mensagem("p1", "T0", "Posso arquivar o PR 7?", { kind: "pedido_a_pessoa", decisaoId: "d1" }),
      mensagem("r1", "T0", "Ele passou na CI?", { kind: "resposta_a_pedido", decisaoId: "d1", agenteId: "a", perguntaEm: EM, retomada: true, turnoRetomadaId: "R1" }, true),
      mensagem("e1", "R1", "Olhei: a CI está vermelha.", { kind: "acoes_do_turno", acoes: [{ rotulo: "Rodou um comando" }] }),
      mensagem("p2", "R1", "Arquivo mesmo assim?", { kind: "pedido_a_pessoa", decisaoId: "d2" }),
    ];
    expect(mensagensDoFio([d1, d2], mensagens).map((m) => m.id)).toEqual(["p1", "r1", "e1", "p2"]);
    expect(historicoDoFio(mensagensDoFio([d1, d2], mensagens), () => "Marlon").join("\n")).toContain("a CI está vermelha");
  });

  it("o histórico da retomada leva só as últimas 10 mensagens, cada uma aparada, com quem falou", () => {
    const mensagens = Array.from({ length: 14 }, (_, i) =>
      i % 2 === 0 ? mensagem(`p${i}`, "T", `pergunta ${i}`, { kind: "pedido_a_pessoa", decisaoId: `d${i}` }) : mensagem(`r${i}`, "T", `resposta ${i} ${"x".repeat(HISTORICO_CARACTERES * 2)}`, { kind: "resposta_a_pedido", decisaoId: `d${i - 1}`, agenteId: "a", perguntaEm: EM, retomada: true }, true),
    );
    const linhas = historicoDoFio(mensagens, () => "Marlon");
    expect(linhas).toHaveLength(HISTORICO_DO_FIO_MAX);
    expect(linhas[0]).toBe("- Você perguntou: pergunta 4");
    expect(linhas.join("\n")).not.toContain("pergunta 2");
    const longa = linhas.find((l) => l.startsWith("- Marlon respondeu: resposta 13")) ?? "";
    expect([...longa.replace("- Marlon respondeu: ", "")]).toHaveLength(HISTORICO_CARACTERES);
    expect(longa.endsWith("…")).toBe(true);
    expect(historicoDoFio([mensagem("e", "R1", "  Arquivar\n  fecha o PR. ")], () => "Marlon")).toEqual(["- Você explicou: Arquivar fecha o PR."]);
  });
});
