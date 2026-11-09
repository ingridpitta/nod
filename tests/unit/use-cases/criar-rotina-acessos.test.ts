import { describe, expect, it } from "vitest";
import type { ArgsPedirAcesso } from "../../../src/contracts/ferramentas-nod.ts";
import { aplicarAtualizacaoRotina } from "../../../src/use-cases/aplicar-proposta-rotina.ts";
import { ativarRotina } from "../../../src/use-cases/ativar-rotina.ts";
import { criarRotina } from "../../../src/use-cases/criar-rotina.ts";
import { decidirAcesso } from "../../../src/use-cases/decidir-acesso.ts";
import { dispararRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { pedirAcesso } from "../../../src/use-cases/pedir-acesso.ts";
import { atualizarRotinaPeloAgente } from "../../../src/use-cases/rotinas-do-agente.ts";
import { contexto, depsMemoria, rotinaValida } from "../../helpers/deps-l7.ts";

/**
 * Emenda da ADR-044, "rotina nasce com o acesso" (2026-09-24): a rotina de Gmail da Nina nasceu em 18/09
 * com fonte "Gmail do Marlon" e nada pediu o acesso — falhou desde a primeira execução. Agora criar_rotina
 * declara `acessos`, validados pelo domínio e guardados na proposta; confirmar concede.
 */
const AGORA = Date.parse("2026-09-24T12:00:00-03:00");
const LEITURA = ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"];
const acesso = (conector: string, nivel: "leitura" | "escrita" = "leitura", capacidades: string[] = []): ArgsPedirAcesso => ({ conector, capacidades, nivel, nao_pedido: [] });

async function cenario() {
  const d = depsMemoria({ agora: () => AGORA });
  const agente = await d.deps.repos.agentes.criar({ nome: "Nina", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const gmail = await d.deps.repos.conectores.criar({ nome: "Gmail (Composio)", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!agente || !conversa || !gmail) throw new Error("cenário");
  await d.deps.repos.conectores.registrarSonda(gmail.id, {
    ok: true,
    agora: AGORA,
    catalogo: [
      { nome: "GMAIL_FETCH_EMAILS", descricao: "Lê e-mails", schema: { type: "object" }, readOnlyHint: true },
      { nome: "GMAIL_LIST_LABELS", descricao: "Lista rótulos", schema: { type: "object" }, readOnlyHint: true },
      { nome: "GMAIL_SEND_EMAIL", descricao: "Envia e-mail", schema: { type: "object" }, readOnlyHint: false },
      { nome: "GMAIL_DELETE_MESSAGE", descricao: "Apaga e-mail", schema: { type: "object" }, readOnlyHint: false },
    ],
  });
  await d.deps.repos.conectores.habilitar(gmail.id, true);
  return { ...d, agenteId: agente.id, conversaId: conversa.id, gmailId: gmail.id, ctx: contexto(agente.id, conversa.id) };
}

describe("criar_rotina com acessos (rotina nasce com o acesso)", () => {
  it("leitura [] no Gmail conectado sai com as ferramentas de LEITURA guardadas na proposta; o app do marketplace por conectar fica como conexão", async () => {
    const c = await cenario();
    const r = (await criarRotina(c.deps, { ...c.ctx, ...rotinaValida({ fonte: "Gmail do Marlon" }), acessos: [acesso("notion"), acesso("gmail")] })).data;
    if ("erro" in r) throw new Error(r.erro);
    const proposta = c.banco.propostas.find((p) => p.id === r.proposta_id);
    expect(proposta?.payload).toMatchObject({
      kind: "rotina",
      acessos: [
        { conector: "gmail", capacidades: LEITURA, nivel: "leitura", naoPedido: [] },
        { conector: "notion", capacidades: [], nivel: "leitura", naoPedido: [], conectar: true },
      ],
    });
    // Nada concedido antes de a pessoa confirmar.
    expect(c.banco.concessoes).toHaveLength(0);
  });

  it("recusa com o erro TIPADO da ferramenta e nada nasce: escrita sem nomes, app inventado, capacidade fora do catálogo", async () => {
    const c = await cenario();
    for (const acessos of [[acesso("gmail", "escrita")], [acesso("inventado")], [acesso("gmail", "leitura", ["GMAIL_NAO_EXISTE"])]]) {
      expect((await criarRotina(c.deps, { ...c.ctx, ...rotinaValida(), acessos })).data).toEqual({ erro: "entrada_invalida" });
    }
    expect(c.banco.propostas).toHaveLength(0);
    expect(c.banco.decisoes).toHaveLength(0);
  });

  it("sem acessos a proposta segue sem o campo (a rotina não declarou: o pré-voo lê a fonte)", async () => {
    const c = await cenario();
    const r = await criarRotina(c.deps, { ...c.ctx, ...rotinaValida() });
    if ("erro" in r.data) throw new Error(r.data.erro);
    expect(c.banco.propostas[0]?.payload).not.toHaveProperty("acessos");
    const a = await ativarRotina(c.deps, { propostaId: r.data.proposta_id });
    expect(a.data.rotina.acessos).toBeNull();
  });

  it("confirmar concede o Gmail com UMA mensagem de consentimento e pula o app por conectar; a segunda ativação não concede de novo", async () => {
    const c = await cenario();
    const r = await criarRotina(c.deps, { ...c.ctx, ...rotinaValida(), acessos: [acesso("gmail"), acesso("notion")] });
    if ("erro" in r.data) throw new Error(r.data.erro);
    const a = await ativarRotina(c.deps, { propostaId: r.data.proposta_id });
    expect(a.data.rotina.acessos?.map((x) => x.conector)).toEqual(["gmail", "notion"]);
    expect(c.banco.concessoes.map((x) => [x.agenteId, x.conectorId, x.capacidade])).toEqual(LEITURA.map((cap) => [c.agenteId, c.gmailId, cap]));
    const consentimentos = c.banco.mensagens.filter((m) => m.kind === "consentimento");
    expect(consentimentos).toHaveLength(1);
    expect(new Set(c.banco.concessoes.map((x) => x.mensagemId))).toEqual(new Set([consentimentos[0]?.id]));
    expect(a.events?.map((e) => e.kind)).toEqual(["rotina_criada", "concessao_criada", "concessao_criada", "decisao_decidida"]);
    await ativarRotina(c.deps, { propostaId: r.data.proposta_id });
    expect(c.banco.concessoes).toHaveLength(2);
    expect(c.banco.mensagens.filter((m) => m.kind === "consentimento")).toHaveLength(1);
  });
});

describe("atualizar_rotina com acessos", () => {
  it("só declarar acessos já é mudança; a frase diz o que ela passa a precisar; a mesma declaração de novo não vira proposta", async () => {
    const c = await cenario();
    const r = await criarRotina(c.deps, { ...c.ctx, ...rotinaValida() });
    if ("erro" in r.data) throw new Error(r.data.erro);
    const { rotina } = (await ativarRotina(c.deps, { propostaId: r.data.proposta_id })).data;
    const mudanca = (await atualizarRotinaPeloAgente(c.deps, { ...c.ctx, rotina_id: rotina.id, acessos: [acesso("gmail")] })).data;
    if ("erro" in mudanca) throw new Error(mudanca.erro);
    const proposta = c.banco.propostas.find((p) => p.id === mudanca.proposta_id);
    expect(proposta?.payload).toMatchObject({ kind: "rotina_atualizacao", acessos: [{ conector: "gmail", capacidades: LEITURA, nivel: "leitura" }] });
    expect(c.banco.decisoes.find((d) => d.id === mudanca.proposta_id)?.frase).toContain("· precisa de Gmail (leitura)");
    // Mudar a instrução sem mexer nos acessos não carrega a lista.
    const soTexto = (await atualizarRotinaPeloAgente(c.deps, { ...c.ctx, rotina_id: rotina.id, instrucao: "outra coisa" })).data;
    if ("erro" in soTexto) throw new Error(soTexto.erro);
    expect(c.banco.propostas.find((p) => p.id === soTexto.proposta_id)?.payload).not.toHaveProperty("acessos");
    expect((await atualizarRotinaPeloAgente(c.deps, { ...c.ctx, rotina_id: rotina.id, acessos: [acesso("gmail", "escrita")] })).data).toEqual({ erro: "entrada_invalida" });
    // Aplicada, a mesma declaração de novo não muda nada: não vira proposta.
    await aplicarAtualizacaoRotina(c.deps, { propostaId: mudanca.proposta_id });
    expect((await atualizarRotinaPeloAgente(c.deps, { ...c.ctx, rotina_id: rotina.id, acessos: [acesso("gmail")] })).data).toEqual({ erro: "entrada_invalida" });
  });
});

describe("pedir_acesso num turno de rotina que DECLAROU escrita", () => {
  // revisto em 2026-10-01 (ADR-066): a declaração diz o que a rotina precisa ao nascer; não limita mais o turno.
  it("ADR-066: a escrita declarada pode ser pedida pelo nome, e a NÃO declarada também — cai no card aberto da rotina (UM por app) e, depois dele, vira o seu", async () => {
    const c = await cenario();
    const rotina = await c.deps.repos.rotinas.criar({
      agenteId: c.agenteId,
      conversaId: c.conversaId,
      cron: "0 8 * * *",
      fusoIana: "America/Sao_Paulo",
      instrucao: "Responder e-mails de suporte",
      fonte: "a caixa de entrada",
      entregavel: "respostas",
      limitesAprovacao: "nada sai sem aprovação",
      politicaSemDado: "silêncio",
      proximaExecucao: AGORA,
      acessos: [{ conector: "gmail", capacidades: [...LEITURA, "GMAIL_SEND_EMAIL"], nivel: "escrita", naoPedido: [] }],
    });
    if (!rotina) throw new Error("rotina");
    // aposConceder: o disparo não passa pelo pré-voo — o turno roda e pede no meio.
    const disparo = await dispararRotina(c.deps, { rotina, instanteAgendado: AGORA, machineId: "m", executor: "catcher", aposConceder: true });
    if (!("turno" in disparo.data)) throw new Error("sem turno");
    const ctx = contexto(c.agenteId, c.conversaId, disparo.data.turno.id);
    const ok = await pedirAcesso(c.deps, { ...ctx, conector: "gmail", capacidades: ["GMAIL_SEND_EMAIL"], nivel: "escrita", nao_pedido: [] });
    expect(c.banco.propostas.find((p) => p.id === ok.data.proposta_id)?.payload).toMatchObject({ kind: "acesso", capacidades: ["GMAIL_SEND_EMAIL"], nivel: "escrita", rotinaId: rotina.id });
    // Antes: nao_permitido. Agora o pedido entra; com o card do Gmail aberto, é ele que responde.
    const naoDeclarada = await pedirAcesso(c.deps, { ...ctx, conector: "gmail", capacidades: ["GMAIL_DELETE_MESSAGE"], nivel: "escrita", nao_pedido: [] });
    expect(naoDeclarada.data).toMatchObject({ proposta_id: ok.data.proposta_id, estado: "aguardando_pessoa" });
    // A pessoa permite o primeiro (a rotina roda de novo); o pedido de apagar vira o card dele, com a rotina junto.
    await decidirAcesso(c.deps, { decisaoId: ok.data.proposta_id, recusar: false, executor: "catcher" });
    expect(c.banco.concessoes.map((x) => x.capacidade)).toEqual(["GMAIL_SEND_EMAIL"]);
    const apagar = await pedirAcesso(c.deps, { ...ctx, conector: "gmail", capacidades: ["GMAIL_DELETE_MESSAGE"], nivel: "escrita", nao_pedido: [] });
    expect(apagar.data.proposta_id).not.toBe(ok.data.proposta_id);
    expect(c.banco.propostas.find((p) => p.id === apagar.data.proposta_id)?.payload).toMatchObject({ kind: "acesso", capacidades: ["GMAIL_DELETE_MESSAGE"], nivel: "escrita", rotinaId: rotina.id });
    expect(c.banco.decisoes.find((d) => d.id === apagar.data.proposta_id)?.estado).toBe("pendente");
  });
});
