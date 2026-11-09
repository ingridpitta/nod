import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { OrigemTurno, Profundidade } from "../../../src/contracts/turno.ts";
import { montarPlano } from "../../../src/domain/plano-turno.ts";
import { avisarFalhaDelegacao, entregarRespostaPeer } from "../../../src/use-cases/entregar-resposta-peer.ts";
import { pedirABot } from "../../../src/use-cases/pedir-a-bot.ts";
import { depsMemoria } from "../../helpers/deps-l7.ts";
import { PESSOA_ANA, TENANT_PADRAO } from "../../helpers/ids.ts";
import { tarefaDoPedido } from "../../helpers/pedido.ts";

/**
 * pedir_a_bot (definido em 2026-09-29, ADR-058): UM jeito de um bot pedir a outro — pergunta ou tarefa —, e
 * quem recebe usa os acessos dele, venha o pedido de conversa, sala ou rotina. Até três passes (ADR-063); a marca de
 * quem leu algo de fora passa adiante, no lugar da trava herdada (ADR-066); a resposta volta como retomada do turno
 * que pediu.
 */
const AGORA = 1_700_000_000_000;
type D = ReturnType<typeof depsMemoria>;

async function bot(d: D, nome: string, deps = d.deps) {
  const a = await deps.repos.agentes.criar({ nome, dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
  const c = await deps.repos.conversas.criar({ tipo: "propria", agenteId: a?.id ?? "" });
  return { id: a?.id ?? "", conversaId: c?.id ?? "", agente: a };
}

/** O turno de quem pede: é dele que o pedido parte (profundidade, confiança, rotina). */
async function turno(d: D, agenteId: string, conversaId: string, origem: OrigemTurno = "conversa", extra: { profundidade?: Profundidade; confianca?: "confiavel" | "nao_confiavel" } = {}) {
  const t = await d.deps.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem, prazoEm: AGORA + 60_000, profundidade: extra.profundidade ?? 0, entradaTexto: "trabalho", entradaConfianca: extra.confianca ?? "confiavel", modelo: "haiku" });
  if (!t) throw new Error("turno não criado");
  return t;
}

function pedir(d: D, de: { id: string; conversaId: string }, turnoId: string, agente: string, pedido: string, contexto?: string) {
  return pedirABot(d.deps, { turnoId, agenteId: de.id, conversaId: de.conversaId, agente, pedido, ...(contexto ? { contexto } : {}) });
}

describe("pedir_a_bot: quem recebe usa os acessos dele", () => {
  it("de uma conversa: o alvo ganha turno 'delegacao' confiável, em profundidade 1, sob procuração da pessoa; o pedido vai num bloco próprio", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    const tuca = await bot(d, "Tuca");
    const t = await turno(d, vera.id, vera.conversaId);
    const r = await pedir(d, vera, t.id, "Tuca", "Explique como a busca por nome funciona hoje.", "PR #415");
    const tarefa = d.banco.turnos.find((x) => x.id === tarefaDoPedido(r.data));
    expect(tarefa).toMatchObject({ agenteId: tuca.id, conversaId: tuca.conversaId, origem: "delegacao", profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: d.deps.escopo.pessoaId, estado: "pendente" });
    expect(tarefa?.entradaTexto).toContain("Pedido de Vera:\n<pedido_do_colega>\nPedido: Explique como a busca por nome funciona hoje.\nContexto: PR #415\n</pedido_do_colega>");
    const pedido = d.banco.mensagens.find((m) => m.conversaId === tuca.conversaId && m.payload?.kind === "peer_pedido");
    expect(pedido).toMatchObject({ turnoId: tarefaDoPedido(r.data), autoria: { autor_tipo: "agente", autor_id: vera.id, sob_procuracao_de: d.deps.escopo.pessoaId }, payload: { turnoOrigemId: t.id, conversaOrigemId: vera.conversaId } });
    expect(d.banco.mensagens.find((m) => m.kind === "handoff")).toMatchObject({ conversaId: vera.conversaId, texto: "Vera pediu a Tuca: Explique como a busca por nome funciona hoje.", payload: { tarefaId: tarefaDoPedido(r.data) } });
    // revisto em 2026-10-12 (ADR-099, I7 revista; era uma task `colega`, ADR-083 S7): o pedido entra como turno de triagem na
    // conversa do dono de quem recebe — nenhum trabalho, e o handoff aponta só para o turno.
    expect(r.events?.map((e) => e.kind)).toEqual(["mensagem_criada", "turno_criado"]);
    expect(tarefa?.trabalhoId ?? null).toBeNull();
    expect(d.banco.trabalhos).toHaveLength(0);
    expect(d.banco.mensagens.find((m) => m.kind === "handoff")?.payload).not.toHaveProperty("trabalhoId");
    expect(r.data).toMatchObject({ ok: true, instrucao: expect.stringContaining("Pedido entregue a Tuca: entrou na triagem dele"), livres: [] });
  });

  it("ADR-099 (I7 revista): a espera circular é recusada com instrução, sem turno nem handoff; o colega livre é sugerido", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    const tuca = await bot(d, "Tuca");
    const bia = await bot(d, "Bia");
    for (const b of [vera, tuca, bia]) await d.deps.repos.agentes.atualizarPerfil(b.id, { confirmado: true });
    const t = await turno(d, vera.id, vera.conversaId);
    const r = await pedir(d, vera, t.id, "Tuca", "Revise o PR 42.");
    expect(r.data).toMatchObject({ ok: true, livres: [{ id: bia.id, nome: "Bia" }], instrucao: expect.stringContaining("Livres agora: Bia") });
    const triagem = tarefaDoPedido(r.data);
    const turnos = d.banco.turnos.length;
    const volta = await pedir(d, tuca, triagem, "Vera", "Qual repositório?");
    expect(volta.data).toEqual({ ok: false, erro: "espera_circular", instrucao: expect.stringContaining("Espera circular: Vera pediu algo a você") });
    expect(d.banco.turnos).toHaveLength(turnos);
    expect(d.banco.mensagens.filter((m) => m.kind === "handoff")).toHaveLength(1);
  });

  it("de uma rotina também — o caso da Clarice e do Chico —, e sem o bloco da pessoa (ninguém escreveu)", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const clarice = await bot(d, "Clarice");
    await bot(d, "Chico");
    const t = await turno(d, clarice.id, clarice.conversaId, "rotina", { confianca: "nao_confiavel" });
    const r = await pedir(d, clarice, t.id, "Chico", "Como a busca por nome funciona no Backoffice?");
    const tarefa = d.banco.turnos.find((x) => x.id === tarefaDoPedido(r.data));
    expect(tarefa).toMatchObject({ origem: "delegacao", entradaConfianca: "confiavel" });
    expect(tarefa?.entradaTexto).not.toContain("pedido_da_pessoa");
    // ADR-085 (revisão do #209): ninguém está na conversa esperando — as frentes que o dono abrir para este pedido podem
    // ser seguradas pelo Mac apertado (pessoaEsperaOPedido; tests/unit/domain/triagem.test.ts).
    expect(tarefa?.trabalhoId ?? null).toBeNull();
  });

  it("até o limite da corrente (ADR-063): quem está em 1 ou 2 pede, e o alvo nasce um passe mais fundo; em 3 não pede", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    const tuca = await bot(d, "Tuca");
    for (const profundidade of [1, 2] as const) {
      const t = await turno(d, vera.id, vera.conversaId, "delegacao", { profundidade });
      const r = await pedir(d, vera, t.id, "Tuca", `e agora? (passe ${profundidade})`);
      expect(d.banco.turnos.find((x) => x.id === tarefaDoPedido(r.data))).toMatchObject({ agenteId: tuca.id, origem: "delegacao", profundidade: profundidade + 1 });
      expect(r.events?.find((e) => e.kind === "turno_criado")?.dados).toMatchObject({ profundidade: profundidade + 1 });
    }
    const noLimite = await turno(d, vera.id, vera.conversaId, "retomada", { profundidade: 3 });
    await expect(pedir(d, vera, noLimite.id, "Tuca", "e agora?")).rejects.toMatchObject({ codigo: "nao_permitido" });
    // Turno de outro bot também não serve de origem.
    const outro = await bot(d, "Zeca");
    const deOutro = await turno(d, outro.id, outro.conversaId);
    await expect(pedir(d, vera, deOutro.id, "Tuca", "oi")).rejects.toMatchObject({ codigo: "nao_permitido" });
    expect(d.banco.turnos.filter((x) => x.origem === "delegacao" && x.agenteId === tuca.id)).toHaveLength(2);
  });

  it("outro dono: sem procuração, nao_permitido; procuração antiga (perguntar_a_bot) ou nova (pedir_a_bot) vale", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    const comoAna = d.comEscopo({ tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA });
    const tuca = await bot(d, "Tuca", comoAna);
    const t = await turno(d, vera.id, vera.conversaId);
    await expect(pedir(d, vera, t.id, "Tuca", "oi")).rejects.toMatchObject({ codigo: "nao_permitido" });
    await comoAna.repos.procuracoes.criar({ agenteConcedenteId: tuca.id, agenteBeneficiarioId: vera.id, classesPermitidas: ["outra"], tetoDiario: 5 });
    await expect(pedir(d, vera, t.id, "Tuca", "oi")).rejects.toMatchObject({ codigo: "nao_permitido" });
    await comoAna.repos.procuracoes.criar({ agenteConcedenteId: tuca.id, agenteBeneficiarioId: vera.id, classesPermitidas: ["perguntar_a_bot"], tetoDiario: 5 });
    const r = await pedir(d, vera, t.id, "Tuca", "oi");
    expect(d.banco.turnos.find((x) => x.id === tarefaDoPedido(r.data))?.agenteId).toBe(tuca.id);
  });

  it("outro dono, só um salto (ADR-063, como a Jornada 02): o bot da Ana não repassa, e a continuação da Vera não volta a ele", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    const bia = await bot(d, "Bia");
    const comoAna = d.comEscopo({ tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA });
    const tuca = await bot(d, "Tuca", comoAna);
    await bot(d, "Zeca", comoAna);
    await comoAna.repos.procuracoes.criar({ agenteConcedenteId: tuca.id, agenteBeneficiarioId: vera.id, classesPermitidas: ["pedir_a_bot"], tetoDiario: 5 });
    const t = await turno(d, vera.id, vera.conversaId);
    const r = await pedir(d, vera, t.id, "Tuca", "levante os clientes do piloto");
    // O Tuca cumpre por procuração; o Zeca, também da Ana, nunca deu procuração a ninguém.
    await expect(pedir(d, tuca, tarefaDoPedido(r.data), "Zeca", "me ajuda?")).rejects.toMatchObject({ codigo: "nao_permitido" });
    const volta = await entregarRespostaPeer(d.deps, { tarefaId: tarefaDoPedido(r.data), texto: "12 clientes." });
    if (!("continuacao" in volta.data)) throw new Error("deveria entregar à Vera");
    await expect(pedir(d, vera, volta.data.continuacao.id, "Tuca", "e os e-mails deles?")).rejects.toMatchObject({ codigo: "nao_permitido" });
    const daVera = await pedir(d, vera, volta.data.continuacao.id, "Bia", "prepare o e-mail aos 12");
    expect(d.banco.turnos.find((x) => x.id === tarefaDoPedido(daVera.data))).toMatchObject({ agenteId: bia.id, profundidade: 2 });
  });

  it("bot desconhecido → nao_encontrado; a si mesmo → entrada_invalida; pedido vazio → texto_vazio", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    await bot(d, "Tuca");
    const t = await turno(d, vera.id, vera.conversaId);
    await expect(pedir(d, vera, t.id, "Zé", "oi")).rejects.toMatchObject({ codigo: "nao_encontrado" });
    await expect(pedir(d, vera, t.id, "Vera", "oi")).rejects.toMatchObject({ codigo: "entrada_invalida" });
    await expect(pedir(d, vera, t.id, "Tuca", " ")).rejects.toMatchObject({ codigo: "texto_vazio" });
  });
});

describe("a resposta volta como continuação de quem pediu", () => {
  it("peer_ask na conversa de quem pediu + retomada do turno dele, com a confiança dele, um passe mais funda", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    const tuca = await bot(d, "Tuca");
    const t = await turno(d, vera.id, vera.conversaId);
    const r = await pedir(d, vera, t.id, "Tuca", "status do PR 42?");
    const entrega = await entregarRespostaPeer(d.deps, { tarefaId: tarefaDoPedido(r.data), texto: "PR 42 aprovado, falta o merge." });
    if (!("mensagem" in entrega.data)) throw new Error("deveria entregar");
    expect(entrega.data.mensagem).toMatchObject({
      conversaId: vera.conversaId,
      kind: "peer_ask",
      texto: "PR 42 aprovado, falta o merge.",
      payload: { kind: "peer_ask", agenteId: tuca.id, nome: "Tuca", tarefaId: tarefaDoPedido(r.data), turnoOrigemId: t.id, delegada: true },
    });
    expect(entrega.data.continuacao).toMatchObject({ conversaId: vera.conversaId, agenteId: vera.id, origem: "retomada", retomaTurnoId: t.id, profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: null });
    expect(entrega.data.continuacao.entradaTexto).toContain("Resposta de Tuca ao seu pedido: PR 42 aprovado, falta o merge.");
    expect(entrega.data.continuacao.entradaTexto).not.toContain("NÃO confiável");
    // Fio de conversa sem pendência: nenhuma frase a mais — a tarefa original do contexto diz o que fazer.
    expect(entrega.data.continuacao.entradaTexto).not.toContain("Ainda faltam");
    expect(entrega.data.continuacao.entradaTexto).not.toContain("Todas as respostas");
    expect(entrega.events?.find((e) => e.kind === "turno_criado")?.dados).toMatchObject({ profundidade: 1 });

    // Em profundidade 1 o salto fica (ADR-063): a continuação ainda pede a outro colega. No limite, some.
    const continuacao = entrega.data.continuacao;
    const planoEm = (profundidade: 1 | 3) => montarPlano({
      turno: { ...continuacao, profundidade },
      agente: vera.agente!,
      memorias: [],
      concessoes: [],
      conectores: [],
      modo: "conversa",
      confianca: "confiavel",
      profundidade,
      inventario: { estado: "pronto", versao: "x", em: AGORA },
      executor: "catcher",
      sessaoCli: null,
      pessoaNome: "Marlon",
      agora: AGORA,
    }).catalogo.ferramentas.map((f) => f.nome);
    expect(planoEm(1)).toContain("pedir_a_bot");
    expect(planoEm(3)).not.toContain("pedir_a_bot");
    expect(planoEm(3)).not.toContain("encaminhar");
    expect(planoEm(3)).toEqual(expect.arrayContaining(["lembrar", "pedir_aprovacao", "pedir_acesso", "pedir_a_pessoa"]));

    // A continuação NÃO é uma tarefa: entregar sobre ela é ignorado.
    expect((await entregarRespostaPeer(d.deps, { tarefaId: entrega.data.continuacao.id, texto: "x" })).data).toEqual({ ignorado: "nao_e_tarefa_peer" });
  });

  it("pedido que partiu da rotina volta à rotina: a continuação herda a confiança dela (não confiável)", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const clarice = await bot(d, "Clarice");
    await bot(d, "Chico");
    const t = await turno(d, clarice.id, clarice.conversaId, "rotina", { confianca: "nao_confiavel" });
    const r = await pedir(d, clarice, t.id, "Chico", "como funciona a busca?");
    const entrega = await entregarRespostaPeer(d.deps, { tarefaId: tarefaDoPedido(r.data), texto: "Busca por tokens, sem acento." });
    if (!("continuacao" in entrega.data)) throw new Error("deveria entregar");
    expect(entrega.data.continuacao).toMatchObject({ origem: "retomada", retomaTurnoId: t.id, entradaConfianca: "nao_confiavel", profundidade: 1 });
  });

  it("pedido feito numa sala volta à mesma sala", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    await bot(d, "Tuca");
    const sala = await d.deps.repos.conversas.criar({ tipo: "sala", salaId: randomUUID() });
    const original = await turno(d, vera.id, sala!.id, "sala");
    const r = await pedirABot(d.deps, { turnoId: original.id, agenteId: vera.id, conversaId: sala!.id, agente: "Tuca", pedido: "Quais clientes avisar?" });
    expect(d.banco.mensagens.find((m) => m.kind === "handoff")).toMatchObject({ conversaId: sala!.id, payload: { tarefaId: tarefaDoPedido(r.data) } });
    const resposta = await entregarRespostaPeer(d.deps, { tarefaId: tarefaDoPedido(r.data), texto: "Clientes do piloto." });
    if (!("continuacao" in resposta.data)) throw new Error("resposta ausente");
    expect(resposta.data.continuacao).toMatchObject({ conversaId: sala!.id, origem: "retomada", retomaTurnoId: original.id });
    expect(resposta.data.mensagem.conversaId).toBe(sala!.id);
  });
});

describe("a corrente até três passes (ADR-063): Clarice → Chico → Dev", () => {
  /** Rotina com a janela ligada; `confianca` é a da fonte dela (ADR-062: só conteúdo de fora nasce não confiável). */
  async function turnoDaRotina(d: D, de: { id: string; conversaId: string }, exigeAprovacao: boolean, confianca: "confiavel" | "nao_confiavel" = "nao_confiavel") {
    const rotina = await d.deps.repos.rotinas.criar({ agenteId: de.id, conversaId: de.conversaId, cron: "*/10 * * * *", fusoIana: "UTC", instrucao: "Ler o Slack", fonte: "Slack", entregavel: "chat", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: AGORA, exigeAprovacao });
    const t = await turno(d, de.id, de.conversaId, "rotina", { confianca });
    await d.deps.repos.rotinaJanelas.reivindicar({ rotinaId: rotina!.id, instanteAgendado: AGORA, executor: "catcher", machineId: randomUUID() });
    await d.deps.repos.rotinaJanelas.vincularTurno({ rotinaId: rotina!.id, instanteAgendado: AGORA, turnoId: t.id });
    return t;
  }
  const tarefaDe = (d: D, id: string) => d.banco.turnos.find((x) => x.id === id)!;

  it("cada passe soma 1 — pedido e resposta —; a continuação de quem cumpria um pedido mantém a procuração; em 3 ninguém pede", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const clarice = await bot(d, "Clarice");
    const chico = await bot(d, "Chico");
    const dev = await bot(d, "Dev");
    const t0 = await turno(d, clarice.id, clarice.conversaId);
    const d1 = tarefaDe(d, tarefaDoPedido((await pedir(d, clarice, t0.id, "Chico", "acione o Dev para revisar o PR 481")).data));
    expect(d1).toMatchObject({ agenteId: chico.id, profundidade: 1 });
    // O Chico, cumprindo o pedido da Clarice, aciona o Dev — o que o "um salto" da ADR-058 impedia.
    const d2 = tarefaDe(d, tarefaDoPedido((await pedir(d, chico, d1.id, "Dev", "revise o PR 481")).data));
    expect(d2).toMatchObject({ agenteId: dev.id, origem: "delegacao", profundidade: 2, sobProcuracaoDe: d.deps.escopo.pessoaId });
    const volta = await entregarRespostaPeer(d.deps, { tarefaId: d2.id, texto: "Aprovar com ressalvas." });
    if (!("continuacao" in volta.data)) throw new Error("deveria entregar ao Chico");
    expect(volta.data.continuacao).toMatchObject({ agenteId: chico.id, conversaId: chico.conversaId, origem: "retomada", retomaTurnoId: d1.id, profundidade: 2, sobProcuracaoDe: d.deps.escopo.pessoaId });
    expect(volta.data.continuacao.entradaTexto).toContain("Todas as respostas que você pediu chegaram: consolide a resposta final para Clarice.");
    // A continuação (2) ainda pede; o pedido nasce no último passe (3), e dali ninguém repassa.
    const d3 = tarefaDe(d, tarefaDoPedido((await pedir(d, chico, volta.data.continuacao.id, "Dev", "e o CI?")).data));
    expect(d3).toMatchObject({ profundidade: 3 });
    await expect(pedir(d, dev, d3.id, "Chico", "me ajuda?")).rejects.toMatchObject({ codigo: "nao_permitido" });
    const ultima = await entregarRespostaPeer(d.deps, { tarefaId: d3.id, texto: "CI verde." });
    if (!("continuacao" in ultima.data)) throw new Error("deveria entregar ao Chico");
    expect(ultima.data.continuacao).toMatchObject({ profundidade: 3, retomaTurnoId: volta.data.continuacao.id });
    await expect(pedir(d, chico, ultima.data.continuacao.id, "Dev", "mais uma?")).rejects.toMatchObject({ codigo: "nao_permitido" });
  });

  it("ADR-066: a marca de quem leu algo de fora atravessa a cadeia — rotina de fora → Clarice → Chico → Dev, também pela continuação; exige_aprovacao não trava ninguém; de conversa ou rotina limpa, sem marca", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const clarice = await bot(d, "Clarice");
    const chico = await bot(d, "Chico");
    await bot(d, "Dev");
    // NOD-259: cada cadeia é um pedido diferente (o mesmo texto ainda aberto seria recusado como repetido).
    let n = 0;
    const cadeia = async (t0: { id: string }) => {
      n += 1;
      const d1 = tarefaDe(d, tarefaDoPedido((await pedir(d, clarice, t0.id, "Chico", `acione o Dev (${n})`)).data));
      const d2 = tarefaDe(d, tarefaDoPedido((await pedir(d, chico, d1.id, "Dev", `revise o PR ${n}`)).data));
      return { d1, d2 };
    };
    const marcado = (t: { id: string }) => d.deps.repos.turnos.contaminado(t.id);
    const deFora = await cadeia(await turnoDaRotina(d, clarice, true));
    expect(await marcado(deFora.d1)).toBe(true);
    expect(await marcado(deFora.d2)).toBe(true);
    const volta = await entregarRespostaPeer(d.deps, { tarefaId: deFora.d2.id, texto: "feito" });
    if (!("continuacao" in volta.data)) throw new Error("deveria entregar ao Chico");
    expect(await marcado(volta.data.continuacao)).toBe(true);
    const d3 = tarefaDe(d, tarefaDoPedido((await pedir(d, chico, volta.data.continuacao.id, "Dev", "e o CI?")).data));
    expect(await marcado(d3)).toBe(true);
    expect(await marcado((await cadeia(await turno(d, clarice.id, clarice.conversaId))).d2)).toBe(false);
    // ADR-062 em cada passe: rotina limpa (fonte da empresa) não marca ninguém na cadeia, nem com exige_aprovacao.
    const limpa = await cadeia(await turnoDaRotina(d, clarice, true, "confiavel"));
    expect(await marcado(limpa.d1)).toBe(false);
    expect(await marcado(limpa.d2)).toBe(false);
  });

  it("ADR-086 (revisão do #212): quem cumpre o pedido marcou uma volta — a frase 'vou esperar o CI' não é entregue; o resultado da volta, sim", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const clarice = await bot(d, "Clarice");
    await bot(d, "Chico");
    const t0 = await turno(d, clarice.id, clarice.conversaId);
    const d1 = tarefaDoPedido((await pedir(d, clarice, t0.id, "Chico", "veja se o CI do PR 212 passa")).data);
    const tarefa = d.banco.turnos.find((x) => x.id === d1)!;
    const volta = await d.deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: tarefa.conversaId, agenteId: tarefa.agenteId, origem: "retomada", retomaTurnoId: d1, prazoEm: AGORA + 600_000, profundidade: tarefa.profundidade, entradaTexto: "[nod] Você marcou para voltar", entradaConfianca: "confiavel", modelo: "haiku", acordarEm: AGORA + 600_000 });
    expect((await entregarRespostaPeer(d.deps, { tarefaId: d1, texto: "Vou esperar o CI." })).data).toEqual({ ignorado: "aguardando_volta" });
    await d.deps.repos.turnos.assentar(volta!.id, { estado: "concluido" });
    const r = await entregarRespostaPeer(d.deps, { tarefaId: volta!.id, texto: "CI verde: pode mergear." });
    expect("continuacao" in r.data).toBe(true);
    expect(d.banco.mensagens.filter((m) => m.conversaId === clarice.conversaId && m.payload?.kind === "peer_ask").map((m) => m.texto)).toEqual(["CI verde: pode mergear."]);
  });

  it("a entrega espera os subpedidos: a Clarice recebe UMA entrega, a final, e não o 'pedi aos Devs, aguardo'", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const clarice = await bot(d, "Clarice");
    const chico = await bot(d, "Chico");
    await bot(d, "Dev 2");
    await bot(d, "Dev 3");
    const t0 = await turno(d, clarice.id, clarice.conversaId);
    const d1 = tarefaDoPedido((await pedir(d, clarice, t0.id, "Chico", "distribua os PRs 475 e 963 aos Devs")).data);
    const paraDev2 = tarefaDoPedido((await pedir(d, chico, d1, "Dev 2", "revise o PR 475")).data);
    const paraDev3 = tarefaDoPedido((await pedir(d, chico, d1, "Dev 3", "revise o PR 963")).data);
    const naClarice = () => d.banco.mensagens.filter((m) => m.conversaId === clarice.conversaId && m.payload?.kind === "peer_ask");

    // O turno do Chico termina aguardando: nem o texto nem o aviso de falha vão à Clarice.
    expect((await entregarRespostaPeer(d.deps, { tarefaId: d1, texto: "Pedi aos Devs 2 e 3; aguardo." })).data).toEqual({ ignorado: "aguardando_colega" });
    expect((await avisarFalhaDelegacao(d.deps, { turnoId: d1, motivo: "terminou sem resposta" })).data).toEqual({ ignorado: "aguardando_colega" });
    expect(naClarice()).toHaveLength(0);

    // O Dev 2 responde: a continuação do Chico sabe que falta o Dev 3, e também espera.
    const r2 = await entregarRespostaPeer(d.deps, { tarefaId: paraDev2, texto: "PR 475: aprovar." });
    if (!("continuacao" in r2.data)) throw new Error("deveria entregar ao Chico");
    expect(r2.data.continuacao.entradaTexto).toContain("Ainda faltam as respostas de Dev 3; elas chegam em novos turnos. Siga com o que já tem e não repita esses pedidos.");
    expect((await entregarRespostaPeer(d.deps, { tarefaId: r2.data.continuacao.id, texto: "Dev 2 aprovou o 475; falta o Dev 3." })).data).toEqual({ ignorado: "aguardando_colega" });
    await d.deps.repos.turnos.assentar(r2.data.continuacao.id, { estado: "concluido" });
    expect(naClarice()).toHaveLength(0);

    // O Dev 3 responde: tudo voltou. A continuação consolida para a Clarice, e é ela que entrega — uma vez.
    const r3 = await entregarRespostaPeer(d.deps, { tarefaId: paraDev3, texto: "PR 963: aprovar com ressalvas." });
    if (!("continuacao" in r3.data)) throw new Error("deveria entregar ao Chico");
    expect(r3.data.continuacao.entradaTexto).toContain("Todas as respostas que você pediu chegaram: consolide a resposta final para Clarice.");
    const final = await entregarRespostaPeer(d.deps, { tarefaId: r3.data.continuacao.id, texto: "475 aprovado; 963 com ressalvas." });
    if (!("mensagem" in final.data)) throw new Error("deveria entregar à Clarice");
    expect(final.data.mensagem).toMatchObject({ conversaId: clarice.conversaId, kind: "peer_ask", texto: "475 aprovado; 963 com ressalvas.", payload: { tarefaId: d1, delegada: true } });
    expect(final.data.continuacao).toMatchObject({ agenteId: clarice.id, origem: "retomada", retomaTurnoId: t0.id, profundidade: 1, sobProcuracaoDe: null });
    expect(naClarice()).toHaveLength(1);
    expect((await entregarRespostaPeer(d.deps, { tarefaId: r3.data.continuacao.id, texto: "de novo" })).data).toEqual({ ignorado: "ja_entregue" });
  });

  it("NOD-239: as duas respostas chegam juntas — a continuação que assenta com a outra ainda viva não entrega; a última entrega uma vez, com as duas", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const clarice = await bot(d, "Clarice");
    const chico = await bot(d, "Chico");
    await bot(d, "Dev 2");
    await bot(d, "Dev 3");
    const t0 = await turno(d, clarice.id, clarice.conversaId);
    const d1 = tarefaDoPedido((await pedir(d, clarice, t0.id, "Chico", "distribua os PRs 475 e 963 aos Devs")).data);
    const paraDev2 = tarefaDoPedido((await pedir(d, chico, d1, "Dev 2", "revise o PR 475")).data);
    const paraDev3 = tarefaDoPedido((await pedir(d, chico, d1, "Dev 3", "revise o PR 963")).data);
    await d.deps.repos.turnos.assentar(d1, { estado: "concluido" });
    const naClarice = () => d.banco.mensagens.filter((m) => m.conversaId === clarice.conversaId && m.payload?.kind === "peer_ask");

    // O Dev 2 responde: C1 nasce e começa a rodar (despachando). Enquanto isso o Dev 3 responde: C2 nasce pendente.
    const r2 = await entregarRespostaPeer(d.deps, { tarefaId: paraDev2, texto: "PR 475: aprovar." });
    if (!("continuacao" in r2.data)) throw new Error("deveria entregar ao Chico");
    const c1 = d.banco.turnos.find((x) => x.id === (r2.data as { continuacao: { id: string } }).continuacao.id)!;
    c1.estado = "despachando";
    const r3 = await entregarRespostaPeer(d.deps, { tarefaId: paraDev3, texto: "PR 963: aprovar com ressalvas." });
    if (!("continuacao" in r3.data)) throw new Error("deveria entregar ao Chico");

    // C1 assenta: não há pedido em aberto (as duas peer_ask já existem), mas C2 ainda vai rodar — não entrega, nem avisa.
    await d.deps.repos.turnos.assentar(c1.id, { estado: "concluido" });
    expect((await entregarRespostaPeer(d.deps, { tarefaId: c1.id, texto: "Dev 2 aprovou o 475; falta o Dev 3." })).data).toEqual({ ignorado: "aguardando_volta" });
    expect((await avisarFalhaDelegacao(d.deps, { turnoId: c1.id, motivo: "terminou sem resposta" })).data).toEqual({ ignorado: "aguardando_volta" });
    expect(naClarice()).toHaveLength(0);

    // C2 assenta: é a última viva da cadeia, e entrega a resposta com as duas — uma vez.
    await d.deps.repos.turnos.assentar(r3.data.continuacao.id, { estado: "concluido" });
    const final = await entregarRespostaPeer(d.deps, { tarefaId: r3.data.continuacao.id, texto: "475 aprovado; 963 com ressalvas." });
    if (!("mensagem" in final.data)) throw new Error("deveria entregar à Clarice");
    expect(naClarice().map((m) => m.texto)).toEqual(["475 aprovado; 963 com ressalvas."]);
  });

  it("NOD-239: a continuação que ficaria por último é interrompida — o aviso sai uma vez, quando nenhuma outra continuação está viva", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const clarice = await bot(d, "Clarice");
    const chico = await bot(d, "Chico");
    await bot(d, "Dev 2");
    await bot(d, "Dev 3");
    const t0 = await turno(d, clarice.id, clarice.conversaId);
    const d1 = tarefaDoPedido((await pedir(d, clarice, t0.id, "Chico", "distribua os PRs")).data);
    const paraDev2 = tarefaDoPedido((await pedir(d, chico, d1, "Dev 2", "revise o PR 475")).data);
    const paraDev3 = tarefaDoPedido((await pedir(d, chico, d1, "Dev 3", "revise o PR 963")).data);
    await d.deps.repos.turnos.assentar(d1, { estado: "concluido" });
    const naClarice = () => d.banco.mensagens.filter((m) => m.conversaId === clarice.conversaId && m.payload?.kind === "peer_ask");
    const r2 = await entregarRespostaPeer(d.deps, { tarefaId: paraDev2, texto: "ok 475" });
    const r3 = await entregarRespostaPeer(d.deps, { tarefaId: paraDev3, texto: "ok 963" });
    if (!("continuacao" in r2.data) || !("continuacao" in r3.data)) throw new Error("deveria entregar ao Chico");
    await d.deps.repos.turnos.assentar(r2.data.continuacao.id, { estado: "concluido" });
    expect((await entregarRespostaPeer(d.deps, { tarefaId: r2.data.continuacao.id, texto: "parcial" })).data).toEqual({ ignorado: "aguardando_volta" });
    await d.deps.repos.turnos.interromper(r3.data.continuacao.id, "executor_indisponivel");
    expect((await avisarFalhaDelegacao(d.deps, { turnoId: r3.data.continuacao.id, motivo: "a máquina parou" })).data).toMatchObject({ mensagem: { texto: "Chico não concluiu: a máquina parou" } });
    expect((await avisarFalhaDelegacao(d.deps, { turnoId: r3.data.continuacao.id, motivo: "a máquina parou" })).data).toEqual({ ignorado: "ja_entregue" });
    expect(naClarice()).toHaveLength(1);
  });

  it("fio de conversa: a continuação diz quem ainda falta e pede para não repetir o pedido", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const chico = await bot(d, "Chico");
    await bot(d, "Dev 1");
    await bot(d, "Dev 2");
    const t0 = await turno(d, chico.id, chico.conversaId);
    const paraDev1 = tarefaDoPedido((await pedir(d, chico, t0.id, "Dev 1", "revise o PR 475")).data);
    await pedir(d, chico, t0.id, "Dev 2", "revise o PR 481");
    const r = await entregarRespostaPeer(d.deps, { tarefaId: paraDev1, texto: "475 ok" });
    if (!("continuacao" in r.data)) throw new Error("deveria entregar ao Chico");
    expect(r.data.continuacao.entradaTexto).toContain("Ainda faltam as respostas de Dev 2");
    expect(r.data.continuacao.entradaTexto).not.toContain("Todas as respostas");
  });
});

describe("NOD-259: o mesmo pedido repetido ao mesmo colega", () => {
  it("o mesmo texto ainda aberto é recusado (ja_pedido), sem turno nem handoff; outro texto passa com o aviso", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const leo = await bot(d, "Leonardo");
    await bot(d, "Ze 1");
    const t = await turno(d, leo.id, leo.conversaId, "rotina");
    const r1 = await pedir(d, leo, t.id, "Ze 1", "Qual o status da NOD-12?");
    expect(r1.data).toMatchObject({ ok: true });
    expect((r1.data as { instrucao: string }).instrucao).not.toContain("Você já tem");
    const turnos = d.banco.turnos.length;
    // Outra janela da rotina, outro fio: o mesmo pedido com caixa e espaços diferentes.
    const t2 = await turno(d, leo.id, leo.conversaId, "rotina");
    const repetido = await pedir(d, leo, t2.id, "Ze 1", "  qual o status da   NOD-12? ");
    expect(repetido.data).toEqual({ ok: false, erro: "ja_pedido", instrucao: expect.stringContaining("Você já pediu isso a Ze 1") });
    expect(repetido.data).toMatchObject({ instrucao: expect.stringContaining("Este pedido não foi enviado.") });
    expect(d.banco.turnos).toHaveLength(turnos + 1);
    expect(d.banco.mensagens.filter((m) => m.kind === "handoff")).toHaveLength(1);
    const outro = await pedir(d, leo, t2.id, "Ze 1", "Revise o PR 7.");
    expect(outro.data).toMatchObject({ ok: true, instrucao: expect.stringContaining("Você já tem 1 pedido aberto a Ze 1 desde") });
  });

  it("no teto de pedidos abertos ao mesmo colega, o próximo é recusado; a outro colega, não; respondido, libera", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const leo = await bot(d, "Leonardo");
    await bot(d, "Ze 1");
    await bot(d, "Ze 2");
    const t = await turno(d, leo.id, leo.conversaId);
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      const r = await pedir(d, leo, t.id, "Ze 1", `Pedido ${n}`);
      expect(r.data).toMatchObject({ ok: true });
      ids.push(tarefaDoPedido(r.data));
    }
    expect((await pedir(d, leo, t.id, "Ze 1", "Pedido 4")).data).toEqual({ ok: false, erro: "ja_pedido", instrucao: expect.stringContaining("Você já tem 3 pedidos abertos a Ze 1") });
    expect((await pedir(d, leo, t.id, "Ze 2", "Pedido 4")).data).toMatchObject({ ok: true });
    await entregarRespostaPeer(d.deps, { tarefaId: ids[0]!, texto: "feito" });
    expect((await pedir(d, leo, t.id, "Ze 1", "Pedido 4")).data).toMatchObject({ ok: true, instrucao: expect.stringContaining("Você já tem 2 pedidos abertos a Ze 1") });
  });

  it("a continuação lista os outros pedidos ainda sem resposta, fora o que acabou de chegar", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const leo = await bot(d, "Leonardo");
    await bot(d, "Ze 1");
    await bot(d, "Cartola");
    const t = await turno(d, leo.id, leo.conversaId);
    const r1 = await pedir(d, leo, t.id, "Ze 1", "Status da NOD-12?");
    await pedir(d, leo, t.id, "Cartola", "Revise a tela de login.");
    const entrega = await entregarRespostaPeer(d.deps, { tarefaId: tarefaDoPedido(r1.data), texto: "Em revisão." });
    if (!("continuacao" in entrega.data)) throw new Error("deveria entregar");
    const texto = entrega.data.continuacao.entradaTexto;
    expect(texto).toContain("Pedidos seus a colegas ainda sem resposta");
    expect(texto).toContain("- a Cartola, às ");
    expect(texto).toContain(": Revise a tela de login.");
    expect(texto).not.toContain("- a Ze 1");
  });
});

describe("NOD-302 (CA9 da NOD-253): a cota de quem recebe segura o pedido", () => {
  const uso = (d: D, utilizacao: number, renovaEm: number) =>
    d.deps.repos.usoDoPlano.gravar({ harness: "claude-cli", situacao: "normal", cincoHoras: { utilizacao, renovaEm }, semana: null, medidoEm: AGORA - 60_000 }, null);

  it("na reserva (99%): o pedido entra e a instrução diz a quem pediu a espera e a hora da volta", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    await bot(d, "Tuca");
    await uso(d, 0.995, AGORA + 2 * 3_600_000);
    const t = await turno(d, vera.id, vera.conversaId);
    const r = await pedir(d, vera, t.id, "Tuca", "Revise o PR 42.");
    expect(r.data).toMatchObject({ ok: true });
    const instrucao = r.data.ok ? r.data.instrucao : "";
    expect(instrucao).toMatch(/Ele ainda não começa: a cota do Claude Code está no fim; o pedido espera na fila até ela renovar, às \d{2}:\d{2}\. Diga isso a quem espera a resposta\./);
    expect(d.banco.turnos.find((x) => x.id === tarefaDoPedido(r.data))).toMatchObject({ estado: "pendente", origem: "delegacao" });
  });

  it("com a cota livre, a instrução de sempre (sem espera)", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    await bot(d, "Tuca");
    await uso(d, 0.5, AGORA + 2 * 3_600_000);
    const t = await turno(d, vera.id, vera.conversaId);
    const r = await pedir(d, vera, t.id, "Tuca", "Revise o PR 42.");
    expect(r.data.ok && r.data.instrucao).not.toMatch(/ainda não começa/);
  });
});
