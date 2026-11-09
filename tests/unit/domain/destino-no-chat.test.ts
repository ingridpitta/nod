import { describe, expect, it } from "vitest";
import { ASSUNTOS, type Assunto } from "../../../src/contracts/destino-no-chat.ts";
import type { Autoria } from "../../../src/contracts/evento.ts";
import type { KindMensagem, PayloadMensagem } from "../../../src/contracts/mensagem.ts";
import { ASSUNTOS_DA_ATIVIDADE, assuntoDe, assuntoNoBastidor, DESTINO, destinoDe } from "../../../src/domain/destino-no-chat.ts";
import { assuntoDaNova } from "../../../src/repositories/mensagens.repo.ts";

const pessoa: Pick<Autoria, "decidido_por"> = { decidido_por: "pessoa" };
const regra: Pick<Autoria, "decidido_por"> = { decidido_por: "regra:aprovacao_automatica" };

/** Um payload de cada forma, com o kind de mensagem que o grava e o assunto esperado. */
const CASOS: readonly { nome: string; kind: KindMensagem; payload: PayloadMensagem; autoria?: Pick<Autoria, "decidido_por">; assunto: Assunto | null }[] = [
  { nome: "boas-vindas", kind: "texto", payload: { kind: "boas_vindas" }, assunto: null },
  { nome: "pergunta", kind: "texto", payload: { kind: "pedido_a_pessoa", decisaoId: "d" }, assunto: null },
  { nome: "resposta", kind: "texto", payload: { kind: "resposta_a_pedido", decisaoId: "d", agenteId: "a", perguntaEm: 1, retomada: false }, assunto: null },
  { nome: "handoff", kind: "handoff", payload: { kind: "handoff", de: "a", para: "b", motivo: "m" }, assunto: "colega.handoff" },
  { nome: "peer_pedido", kind: "texto", payload: { kind: "peer_pedido", conversaOrigemId: "c", turnoOrigemId: "t" }, assunto: "colega.pedido" },
  { nome: "peer_ask", kind: "peer_ask", payload: { kind: "peer_ask", agenteId: "a", nome: "Ada", naoSupervisionado: true, tarefaId: "t" }, assunto: "colega.resposta" },
  { nome: "passe", kind: "passe", payload: { kind: "passe", motivo: "passei_sem_nada_a_dizer" }, assunto: "passe" },
  { nome: "parada", kind: "parada", payload: { kind: "parada", interrompidas: 1, nadaRodando: false }, assunto: "parada" },
  { nome: "consentimento manual", kind: "consentimento", payload: { kind: "consentimento", conectorId: "c", slug: "gmail", capacidades: ["ler"], naoInclui: [] }, autoria: pessoa, assunto: "acesso.concedido" },
  { nome: "consentimento automático", kind: "consentimento", payload: { kind: "consentimento", conectorId: "c", slug: "gmail", capacidades: ["ler"], naoInclui: [] }, autoria: regra, assunto: "acesso.automatico" },
  { nome: "pasta aberta", kind: "sistema", payload: { kind: "pasta_aberta", propostaId: "p", agenteId: "a", pasta: "/x", nome: "x" }, assunto: "acesso.pasta" },
  { nome: "rotina executou", kind: "rotina_execucao", payload: { kind: "rotina_execucao", rotinaId: "r", instanteAgendado: 1, desfecho: "executou" }, assunto: "rotina.execucao" },
  { nome: "rotina em branco", kind: "rotina_execucao", payload: { kind: "rotina_execucao", rotinaId: "r", instanteAgendado: 1, desfecho: "passou_em_branco" }, assunto: "rotina.execucao" },
  { nome: "rotina falhou", kind: "rotina_execucao", payload: { kind: "rotina_execucao", rotinaId: "r", instanteAgendado: 1, desfecho: "falhou" }, assunto: "rotina.falhou" },
  { nome: "rotina bloqueada", kind: "rotina_execucao", payload: { kind: "rotina_execucao", rotinaId: "r", instanteAgendado: 1, desfecho: "bloqueada" }, assunto: "rotina.falhou" },
  { nome: "rotina parada (interrompida)", kind: "rotina_execucao", payload: { kind: "rotina_execucao", rotinaId: "r", instanteAgendado: 1, desfecho: "interrompida" }, assunto: "rotina.falhou" },
  { nome: "rotina criada", kind: "sistema", payload: { kind: "rotina_evento", rotinaId: "r", acao: "criada", resumo: "todo dia às 9h" }, assunto: "rotina.evento" },
  { nome: "recibo manual", kind: "resultado_aprovacao", payload: { kind: "resultado_aprovacao", decisaoId: "d", itens: [] }, assunto: "aprovacao.recibo" },
  { nome: "negação não terminal", kind: "negacao", payload: { kind: "negacao", classe: "ferramenta_negada", nome: "Bash", motivo: "alcance_insuficiente", terminal: false }, assunto: "negacao.ferramenta" },
  { nome: "negação terminal", kind: "negacao", payload: { kind: "negacao", classe: "ferramenta_negada", nome: "Bash", motivo: "capacidade_desligada", terminal: true }, assunto: "negacao.terminal" },
  { nome: "plano ausente", kind: "negacao", payload: { kind: "negacao", classe: "plano_ausente", nome: "claude-cli", motivo: "plano_ausente", terminal: true }, assunto: "negacao.plano_ausente" },
  { nome: "conector indisponível", kind: "negacao", payload: { kind: "negacao", classe: "conector_indisponivel", nome: "gmail", motivo: "conector_indisponivel", terminal: false }, assunto: "negacao.conector" },
  { nome: "ia trocada", kind: "sistema", payload: { kind: "ia_trocada", de: "claude-cli", para: "codex-cli", causa: "limite" }, assunto: "ia.trocada" },
  { nome: "limite do plano", kind: "sistema", payload: { kind: "limite_do_plano", harness: "claude-cli", voltaEm: null }, assunto: "ia.limite_do_plano" },
  { nome: "conta trocada", kind: "sistema", payload: { kind: "conta_trocada", harness: "claude-cli", de: 1, para: 2, voltaEm: null, foraDaTroca: [] }, assunto: "conta.trocada" },
  { nome: "conta seguiu", kind: "sistema", payload: { kind: "conta_seguiu", de: { id: "a", apelido: "A", ia: "claude-cli" }, para: { id: "b", apelido: "B", ia: "claude-cli" }, voltaEm: null }, assunto: "conta.seguiu" },
  { nome: "conta escolhida", kind: "sistema", payload: { kind: "conta_escolhida", contaId: "c", apelido: "C", ia: "claude-cli" }, assunto: "conta.escolhida" },
  { nome: "pedido na fila da cota", kind: "sistema", payload: { kind: "pedido_na_fila_da_cota", turnoId: "t", agenteId: "a", ia: "claude-cli", voltaEm: null }, assunto: "cota.pedido_na_fila" },
  { nome: "computador fora", kind: "sistema", payload: { kind: "computador_fora_do_ar", agenteId: "a", desde: 1, motivo: "sem_resposta" }, assunto: "computador.fora_do_ar" },
  { nome: "tela fechada", kind: "sistema", payload: { kind: "computador_tela_fechada", agenteId: "a" }, assunto: "computador.tela_fechada" },
  { nome: "artefato", kind: "artefato", payload: { kind: "artefato", artefatoId: "x", versao: 1, titulo: "t" }, assunto: "artefato" },
  { nome: "ligação", kind: "sistema", payload: { kind: "ligacao", ligacaoId: "l", duracaoMs: null, estado: "encerrada" }, assunto: "ligacao" },
  { nome: "trabalho aberto", kind: "sistema", payload: { kind: "trabalho_aberto", trabalhoId: "t", titulo: "x", origem: "pessoa" }, assunto: "trabalho.aberto" },
  { nome: "frentes abertas", kind: "sistema", payload: { kind: "frentes_abertas", loteId: "l", origem: "pessoa", frentes: [] }, assunto: "frentes.abertas" },
  { nome: "recado", kind: "sistema", payload: { kind: "recado_a_frente", trabalhoId: "t", titulo: "x" }, assunto: "frentes.recado" },
  { nome: "frentes terminadas", kind: "sistema", payload: { kind: "frentes_terminadas", loteId: "l", frentes: [] }, assunto: "frentes.terminadas" },
  { nome: "pedido respondido", kind: "sistema", payload: { kind: "pedido_respondido", loteId: "l", agenteId: "a", nome: "Ada" }, assunto: "pedido.respondido" },
  // Chat limpo, PR 4: os recibos com a âncora do cartão encolhido.
  { nome: "consentimento do pedido", kind: "consentimento", payload: { kind: "consentimento", conectorId: "c", slug: "gmail", capacidades: ["ler"], naoInclui: [], decisaoId: "d", turnoId: "t", frase: "f" }, autoria: pessoa, assunto: "acesso.concedido" },
  { nome: "regra permanente", kind: "consentimento", payload: { kind: "regra_permanente", decisaoId: "d", turnoId: "t", acoes: ["gmail.ler"] }, assunto: "acesso.concedido" },
  { nome: "proposta decidida", kind: "sistema", payload: { kind: "proposta_decidida", propostaId: "p", tipo: "rotina", titulo: "Rotina · 9h", estado: "confirmada", turnoId: null }, assunto: "proposta.resultado" },
];

describe("destino no chat: a tabela", () => {
  it("é total sobre os assuntos (nada fica sem destino)", () => {
    expect(Object.keys(DESTINO).sort()).toEqual([...ASSUNTOS].sort());
  });

  it("cada forma de payload tem o seu assunto", () => {
    for (const c of CASOS) expect(assuntoDe(c.kind, c.payload, c.autoria ?? pessoa), c.nome).toBe(c.assunto);
  });

  it("o consentimento da aprovação automática tem o mesmo payload do manual e se distingue pela autoria", () => {
    const p: PayloadMensagem = { kind: "consentimento", conectorId: "c", slug: "gmail", capacidades: ["ler"], naoInclui: [] };
    expect(destinoDe(assuntoDe("consentimento", p, pessoa))).toBe("chat");
    expect(destinoDe(assuntoDe("consentimento", p, regra))).toBe("atividade");
    // "permitiu para sempre" (permitir-sempre.ts) é consentimento sem payload da pessoa: recibo, fica.
    expect(destinoDe(assuntoDe("consentimento", null, pessoa))).toBe("chat");
  });

  it("fala é null e fica no chat; assunto desconhecido (código mais novo) também fica", () => {
    expect(assuntoDe("texto", null, pessoa)).toBeNull();
    expect(destinoDe(null)).toBe("chat");
    expect(destinoDe("assunto.que.nao.existe")).toBe("chat");
  });

  it("o que não pode ir para a Atividade fica no chat (decisões 10 e a regra das cinco coisas)", () => {
    const ficam: Assunto[] = [
      "agente.criado", "turno.orfao", "turno.falhou", "lote.retorno_caiu", "aprovacao.automatica_falhou", "aprovacao.recibo",
      "rotina.evento", "rotina.falhou", "negacao.terminal", "negacao.plano_ausente", "ia.limite_do_plano", "ia.troca",
      "computador.fora_do_ar", "colega.handoff", "colega.pedido", "colega.resposta", "acesso.concedido", "acesso.pasta",
      "artefato", "ligacao", "ia.fala_espera", "conta.recusada", "proposta.obsoleta", "proposta.resultado",
    ];
    for (const a of ficam) expect(destinoDe(a), a).toBe("chat");
  });

  // Decidido pelo orquestrador em 18/10, no lugar do Marlon (QA do PR 1): o que pede ação da pessoa fica no chat.
  it("a queda da máquina (card Retomar) e a pergunta vencida (você pode reabrir) ficam no chat e fora da Atividade", () => {
    for (const a of ["turno.queda_da_maquina", "decisao.vencida"] as const) {
      expect(DESTINO[a], a).toEqual({ destino: "chat", categoria: null });
      expect(ASSUNTOS_DA_ATIVIDADE, a).not.toContain(a);
    }
  });

  it("o que sai do chat vai para a Atividade, com a categoria do filtro", () => {
    expect(DESTINO["negacao.ferramenta"]).toEqual({ destino: "atividade", categoria: "bloqueios" });
    expect(DESTINO["ia.trocada"]).toEqual({ destino: "atividade", categoria: "maquina_ia" });
    expect(DESTINO["turno.interrompido"].destino).toBe("atividade");
    expect(DESTINO["memoria.anotada"]).toEqual({ destino: "atividade", categoria: null });
    expect(DESTINO["sistema.generico"].destino).toBe("atividade");
  });

  it("anexo: frentes, tasks, o pedido respondido e a linha da execução da rotina vêm na janela sem virar linha", () => {
    const anexos = ASSUNTOS.filter((a) => DESTINO[a].destino === "anexo").sort();
    expect(anexos).toEqual(["frentes.abertas", "frentes.recado", "frentes.terminadas", "pedido.respondido", "rotina.execucao", "trabalho.aberto"]);
  });

  it("a Atividade lista o que sai e os quatro de destino temporal, e nada do resto do chat", () => {
    const temporais = ASSUNTOS.filter((a) => DESTINO[a].temporal).sort();
    expect(temporais).toEqual(["computador.fora_do_ar", "ia.limite_do_plano", "ia.troca", "negacao.plano_ausente"]);
    for (const t of temporais) expect(ASSUNTOS_DA_ATIVIDADE).toContain(t);
    // QA do PR 2: na Atividade eles entram no filtro "Máquina e IA" (com null, só em "Tudo").
    for (const t of temporais) expect(DESTINO[t].categoria, t).toBe("maquina_ia");
    expect(ASSUNTOS_DA_ATIVIDADE).toContain("trabalho.aberto");
    expect(ASSUNTOS_DA_ATIVIDADE).not.toContain("agente.criado");
    expect(ASSUNTOS_DA_ATIVIDADE).not.toContain("rotina.evento");
  });
});

describe("assuntoDaNova (o que o repositório grava)", () => {
  it("com payload, o do payload ganha do escolhido", () => {
    const payload: PayloadMensagem = { kind: "limite_do_plano", harness: "claude-cli", voltaEm: null };
    expect(assuntoDaNova({ kind: "sistema", payload, autoria: { decidido_por: "pessoa" }, assunto: "turno.falhou" })).toBe("ia.limite_do_plano");
  });

  it("sem payload, vale o escolhido; fala sem escolha é null", () => {
    expect(assuntoDaNova({ kind: "sistema", payload: null, autoria: { decidido_por: "pessoa" }, assunto: "turno.orfao" })).toBe("turno.orfao");
    expect(assuntoDaNova({ kind: "resultado_aprovacao", autoria: { decidido_por: "pessoa" }, assunto: "aprovacao.automatica_falhou" })).toBe("aprovacao.automatica_falhou");
    expect(assuntoDaNova({ kind: "texto", payload: null, autoria: { decidido_por: "pessoa" } })).toBeNull();
  });
});

describe("ADA-28 (ADR-159): o turno de bastidor e a linha da tarefa", () => {
  it("o aviso de falha de um turno de bastidor vai para a Atividade; o mesmo aviso de um turno da conversa fica no chat", () => {
    for (const a of ["turno.falhou", "turno.orfao", "lote.retorno_caiu", "negacao.terminal"] as const) {
      expect(destinoDe(a), a).toBe("chat");
      const v = assuntoNoBastidor(a);
      expect(v, a).not.toBe(a);
      expect(destinoDe(v), a).toBe("atividade");
      expect(DESTINO[v!].categoria, a).toBe("bloqueios");
    }
    expect(DESTINO[assuntoNoBastidor("aprovacao.recibo")!]).toEqual({ destino: "atividade", categoria: "sem_aprovacao" });
  });

  it("o que não tem variante (a fala, a resposta da pessoa) fica igual no bastidor", () => {
    expect(assuntoNoBastidor(null)).toBeNull();
    expect(assuntoNoBastidor("pedido.respondido")).toBe("pedido.respondido");
    expect(assuntoNoBastidor("ia.troca")).toBe("ia.troca");
  });

  it("a variante nunca tem variante (a troca é de um passo só)", () => {
    for (const a of ASSUNTOS) {
      const v = DESTINO[a].seBastidor;
      if (v) expect(DESTINO[v].seBastidor, v).toBeUndefined();
    }
  });

  it("a linha da tarefa fica no chat: 'precisa de você' e 'terminou'", () => {
    const base = { kind: "tarefa_linha" as const, tarefaId: "tq", quadroId: "q", codigo: "ADA-28", agenteId: "ada" };
    expect(assuntoDe("sistema", { ...base, motivo: "precisa" }, pessoa)).toBe("tarefa.precisa");
    expect(assuntoDe("sistema", { ...base, motivo: "resultado" }, pessoa)).toBe("tarefa.resultado");
    expect(destinoDe("tarefa.precisa")).toBe("chat");
    expect(destinoDe("tarefa.resultado")).toBe("chat");
  });
});
