import { describe, expect, it } from "vitest";
import type { Decisao } from "../../../src/contracts/decisao.ts";
import { HISTORICO_DO_FIO_MAX } from "../../../src/domain/fio-da-pergunta.ts";
import { autoriaAgente } from "../../../src/use-cases/apoio-l7.ts";
import { dispararRotina, registrarDesfechoRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { dispensarDecisao } from "../../../src/use-cases/dispensar-decisao.ts";
import { lerConversa } from "../../../src/use-cases/enviar-mensagem.ts";
import { listarSuaVez } from "../../../src/use-cases/listar-sua-vez.ts";
import { PRAZO_DECISAO_MS, pedirAPessoa } from "../../../src/use-cases/pedir-a-pessoa.ts";
import { fecharComResposta, retomarComResposta } from "../../../src/use-cases/responder-decisao.ts";
import { depsMemoria } from "../../helpers/deps-l7.ts";
import { PESSOA_MARLON } from "../../helpers/ids.ts";

/**
 * Fio da pergunta (emenda da ADR-045, definido em 2026-09-24): a pessoa pede explicação em vez de
 * responder, o agente explica e pergunta de novo — e a pergunta nova é a rodada seguinte do MESMO fio,
 * não um pedido do zero. Quem distingue é o agente (perguntando de novo ou seguindo), não a tela.
 */
const JANELA = Date.parse("2026-09-24T08:00:00-03:00");

async function cenario() {
  let relogio = JANELA + 60_000;
  const d = depsMemoria({ agora: () => relogio });
  d.banco.pessoas.push({ tenantId: d.deps.escopo.tenantId, id: PESSOA_MARLON, nome: "Marlon", iniciais: "M", email: null });
  const agente = await d.deps.repos.agentes.criar({ nome: "Nina", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
  const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  if (!agente || !conversa) throw new Error("agente");
  const alvo = { agenteId: agente.id, conversaId: conversa.id };
  const passar = (ms: number) => {
    relogio += ms;
  };
  const turno = async (origem: "conversa" | "retomada" = "conversa", retomaTurnoId: string | null = null) => {
    const t = await d.deps.repos.turnos.enfileirar({ executor: "catcher", ...alvo, origem, retomaTurnoId, prazoEm: relogio + 60_000, profundidade: 0, entradaTexto: "arquive os PRs parados", entradaConfianca: "confiavel", modelo: "sonnet" });
    if (!t) throw new Error("turno");
    return t.id;
  };
  const perguntar = async (turnoId: string, texto: string, opcoes?: string[]) => {
    const r = await pedirAPessoa(d.deps, { turnoId, ...alvo, tipo: "pergunta", texto, ...(opcoes ? { opcoes } : {}) });
    const decisao = d.banco.decisoes.find((x) => x.id === r.data.decisao_id);
    if (!decisao) throw new Error("decisão");
    return decisao as Decisao;
  };
  /** O que a rota `responder` faz: fase 1 fecha, fase 2 grava a resposta e cria a retomada. */
  const responder = async (decisaoId: string, texto: string) => {
    const { data } = await fecharComResposta(d.deps, { decisaoId, texto });
    const r = await retomarComResposta(d.deps, { decisao: data.decisao, texto, respondidaPor: { id: PESSOA_MARLON, nome: "Marlon" } });
    if (!r.data.turno) throw new Error("sem retomada");
    return r.data.turno;
  };
  const explicar = (turnoId: string, texto: string) => d.deps.repos.mensagens.criar({ ...alvo, turnoId, autoria: autoriaAgente(alvo.agenteId, PESSOA_MARLON), kind: "texto", texto, confianca: "confiavel" });
  return { ...d, alvo, passar, turno, perguntar, responder, explicar, agora: () => relogio };
}

describe("pedirAPessoa: a pergunta da retomada de uma pergunta respondida é a rodada seguinte do fio", () => {
  it("três rodadas, um fio: fio_id aponta a primeira; cada rodada com o próprio prazo e as próprias opções", async () => {
    const c = await cenario();
    const d1 = await c.perguntar(await c.turno(), "Posso arquivar o PR 7?", ["Sim", "Não"]);
    expect(d1.fioId).toBeNull();
    c.passar(3_600_000);
    const r1 = await c.responder(d1.id, "O que é arquivar?");
    const d2 = await c.perguntar(r1.id, "Arquivar fecha o PR sem juntar o código. Posso?", ["Pode", "Espere"]);
    expect(d2.fioId).toBe(d1.id);
    expect(Date.parse(d2.prazoDecisaoEm)).toBe(c.agora() + PRAZO_DECISAO_MS);
    expect(c.banco.mensagens.find((m) => m.payload?.kind === "pedido_a_pessoa" && m.payload.decisaoId === d2.id)?.payload).toMatchObject({ opcoes: ["Pode", "Espere"] });
    const r2 = await c.responder(d2.id, "E se eu precisar dele depois?");
    const d3 = await c.perguntar(r2.id, "Dá para reabrir depois. Arquivo?");
    expect(d3.fioId).toBe(d1.id);
    // "Sua vez" leva o fio e a rodada: a faixa diz "3ª rodada" e os contadores contam um fio.
    const sv = await listarSuaVez(c.deps);
    expect(sv.data.itens.map((i) => [i.decisao.id, i.fio])).toEqual([[d3.id, { id: d1.id, rodada: 3 }]]);
  });

  it("não é rodada: turno de conversa, retomada de pergunta deixada pra lá, retomada de turno sem pergunta", async () => {
    const c = await cenario();
    expect((await c.perguntar(await c.turno(), "Qual planilha?")).fioId).toBeNull();
    const t = await c.turno();
    const deixada = await c.perguntar(t, "Posso apagar o rascunho?");
    await dispensarDecisao(c.deps, { decisaoId: deixada.id });
    expect((await c.perguntar(await c.turno("retomada", t), "E o outro rascunho?")).fioId).toBeNull();
    const semPergunta = await c.turno();
    await c.deps.repos.turnos.interromper(semPergunta, "maquina_sem_contato");
    expect((await c.perguntar(await c.turno("retomada", semPergunta), "Continuo de onde?")).fioId).toBeNull();
  });

  it("a retomada que caiu no meio (queda do Mac) e foi retomada continua o mesmo fio", async () => {
    const c = await cenario();
    const d1 = await c.perguntar(await c.turno(), "Posso arquivar o PR 7?");
    const r1 = await c.responder(d1.id, "Explique melhor");
    await c.deps.repos.turnos.interromper(r1.id, "maquina_sem_contato");
    const retomar = await c.turno("retomada", r1.id);
    expect((await c.perguntar(retomar, "Arquivar fecha o PR. Posso?")).fioId).toBe(d1.id);
  });

  it("a rodada seguinte não reaproveita a pergunta pendente de OUTRA janela da mesma rotina (a regra da rotina segue valendo fora do fio)", async () => {
    const c = await cenario();
    const rotina = await c.deps.repos.rotinas.criar({ ...c.alvo, cron: "0 8,13 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resuma os PRs", fonte: "GitHub", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "diga que não houve", proximaExecucao: JANELA });
    if (!rotina) throw new Error("rotina");
    // "Executar agora" (preservarAgenda): o agendador não dispara com a pergunta da rotina pendente desde a
    // emenda da ADR-044 (janela 'bloqueada' / aguardando_resposta); a pessoa, sim.
    const disparar = async (instante: number) => {
      const r = await dispararRotina(c.deps, { rotina, instanteAgendado: instante, machineId: "m", executor: "catcher", preservarAgenda: true });
      if (!("turno" in r.data)) throw new Error("sem turno");
      return r.data.turno.id;
    };
    const t8 = await disparar(JANELA);
    const q8 = await c.perguntar(t8, "Qual repositório?");
    await c.deps.repos.turnos.assentar(t8, { estado: "concluido" });
    const t13 = await disparar(JANELA + 5 * 3_600_000);
    const q13 = await c.perguntar(t13, "Qual repositório?");
    expect(q13.id).toBe(q8.id);
    await c.deps.repos.turnos.assentar(t13, { estado: "concluido" });
    const r8 = await c.responder(q8.id, "Qual a diferença?");
    // A janela do dia seguinte pergunta de novo (a de ontem já foi respondida): pergunta pendente da MESMA rotina.
    const outra = await c.perguntar(await disparar(JANELA + 24 * 3_600_000), "Qual repositório?");
    expect(outra.id).not.toBe(q8.id);
    const rodada2 = await c.perguntar(r8.id, "O nod ou o site?");
    expect(rodada2.id).not.toBe(outra.id);
    expect(rodada2.fioId).toBe(q8.id);
  });
});

describe("retomarComResposta: da 2ª rodada em diante, a retomada leva o histórico do fio", () => {
  it("as últimas 10 mensagens do fio (perguntas, respostas e explicações), com a rodada; a 1ª rodada não muda", async () => {
    const c = await cenario();
    let pergunta = await c.perguntar(await c.turno(), "Pergunta 1: posso arquivar o PR 7?");
    const r1 = await c.responder(pergunta.id, "O que é arquivar?");
    expect(r1.entradaTexto).not.toContain("rodada do mesmo fio");
    expect(r1.entradaTexto.split("\n").slice(0, 2)).toEqual([`Resposta de Marlon ao seu pedido (pergunta: "${pergunta.frase}"): O que é arquivar?`, "Continue a partir daqui; nada foi reenviado."]);
    let retomada = r1;
    for (let rodada = 2; rodada <= 6; rodada++) {
      await c.explicar(retomada.id, `Explicação ${rodada - 1}`);
      pergunta = await c.perguntar(retomada.id, `Pergunta ${rodada}: e agora?`);
      if (rodada < 6) retomada = await c.responder(pergunta.id, `Resposta ${rodada}: ainda não entendi`);
    }
    const final = await c.responder(pergunta.id, "Pode arquivar.");
    const linhas = final.entradaTexto.split("\n");
    expect(linhas[0]).toContain("Pode arquivar.");
    expect(linhas).toContain("Esta pergunta é a 6ª rodada do mesmo fio. O que já foi dito nele (as 10 últimas mensagens, da mais antiga para a mais nova):");
    const historico = linhas.filter((l) => l.startsWith("- "));
    expect(historico).toHaveLength(HISTORICO_DO_FIO_MAX);
    expect(historico.at(-1)).toBe("- Você perguntou: Pergunta 6: e agora?");
    expect(historico).toContain("- Marlon respondeu: Resposta 5: ainda não entendi");
    expect(historico).toContain("- Você explicou: Explicação 5");
    expect(final.entradaTexto).not.toContain("Pergunta 1:");
  });
});

describe("o estado do fio na conversa", () => {
  it("esperando você → lendo sua mensagem → (pergunta de novo) esperando, 2ª rodada → resolvida quando a retomada segue", async () => {
    const c = await cenario();
    const estado = async () => (await lerConversa(c.deps, { conversaId: c.alvo.conversaId })).data.fios.map((f) => [f.estado, f.rodada, f.mensagens.length]);
    const d1 = await c.perguntar(await c.turno(), "Posso arquivar o PR 7?");
    expect(await estado()).toEqual([["esperando_voce", 1, 1]]);
    const r1 = await c.responder(d1.id, "O que é arquivar?");
    expect(await estado()).toEqual([["lendo_sua_mensagem", 1, 2]]);
    await c.explicar(r1.id, "Arquivar fecha o PR sem juntar o código.");
    const d2 = await c.perguntar(r1.id, "Posso?");
    await c.deps.repos.turnos.assentar(r1.id, { estado: "concluido" });
    expect(await estado()).toEqual([["esperando_voce", 2, 4]]);
    const r2 = await c.responder(d2.id, "Pode.");
    expect(await estado()).toEqual([["lendo_sua_mensagem", 2, 5]]);
    await c.explicar(r2.id, "Arquivei o PR 7.");
    await c.deps.repos.turnos.assentar(r2.id, { estado: "concluido" });
    // A fala da retomada que seguiu é o resultado, não o fio: ele continua com 5 mensagens.
    expect(await estado()).toEqual([["resolvida", 2, 5]]);
    expect((await listarSuaVez(c.deps)).data.itens).toEqual([]);
  });
});

describe("rotina: todas as rodadas são da mesma janela, e o desfecho é do fio inteiro", () => {
  async function rotinaComFio() {
    const c = await cenario();
    const rotina = await c.deps.repos.rotinas.criar({ ...c.alvo, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resuma os PRs", fonte: "GitHub", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "diga que não houve", proximaExecucao: JANELA });
    if (!rotina) throw new Error("rotina");
    const r = await dispararRotina(c.deps, { rotina, instanteAgendado: JANELA, machineId: "m", executor: "catcher" });
    if (!("turno" in r.data)) throw new Error("sem turno");
    const t0 = r.data.turno.id;
    const d1 = await c.perguntar(t0, "Qual repositório?");
    await c.deps.repos.turnos.assentar(t0, { estado: "concluido" });
    expect((await registrarDesfechoRotina(c.deps, { turnoId: t0, desfecho: "executou" })).data).toEqual({ ignorado: "aguardando_gate" });
    const r1 = await c.responder(d1.id, "Como assim?");
    expect(r1.entradaTexto).toContain("Entrada original da rotina:");
    const d2 = await c.perguntar(r1.id, "O nod ou o site?");
    await c.deps.repos.turnos.assentar(r1.id, { estado: "concluido" });
    expect((await registrarDesfechoRotina(c.deps, { turnoId: r1.id, desfecho: "executou" })).data).toEqual({ ignorado: "aguardando_gate" });
    return { c, rotina, d2 };
  }

  it("resolvida → UMA linha 'executou' e UM marcador na conversa, registrados pela retomada que seguiu", async () => {
    const { c, rotina, d2 } = await rotinaComFio();
    const r2 = await c.responder(d2.id, "O nod.");
    expect(r2.entradaTexto).toContain("2ª rodada do mesmo fio");
    expect(r2.entradaTexto).toContain("Entrada original da rotina:");
    await c.deps.repos.turnos.assentar(r2.id, { estado: "concluido" });
    const r = await registrarDesfechoRotina(c.deps, { turnoId: r2.id, desfecho: "executou" });
    expect("execucao" in r.data && r.data.rotina.id).toBe(rotina.id);
    expect(c.banco.execucoes.map((e) => [e.instanteAgendado, e.desfecho])).toEqual([[JANELA, "executou"]]);
    expect(c.banco.mensagens.filter((m) => m.kind === "rotina_execucao")).toHaveLength(1);
  });

  it("deixada pra lá na 2ª rodada → UMA linha 'passou_em_branco' (pedido_dispensado)", async () => {
    const { c, d2 } = await rotinaComFio();
    await dispensarDecisao(c.deps, { decisaoId: d2.id });
    expect(c.banco.execucoes.map((e) => [e.instanteAgendado, e.desfecho, e.motivo])).toEqual([[JANELA, "passou_em_branco", "pedido_dispensado"]]);
  });
});
