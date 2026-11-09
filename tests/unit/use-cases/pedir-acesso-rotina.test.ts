import { describe, expect, it } from "vitest";
import type { ModoAprovacao } from "../../../src/contracts/agente.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { dispararRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { pedirAcesso } from "../../../src/use-cases/pedir-acesso.ts";
import { depsEmMemoria } from "../../helpers/deps-l6.ts";
import { planoDeTeste } from "../../helpers/l5.ts";

/**
 * ADR-044, visto com a Nina: a rotina que lê o Gmail não tinha acesso, pedir_acesso não estava no
 * catálogo da rotina e o prompt mandava "informar o bloqueio" — ela abria um card de texto por
 * execução. Agora o turno de rotina pede por pedir_acesso, [] = as ferramentas do nível, e o pedido
 * carrega a rotina para "Permitir e rodar agora".
 * revisto em 2026-10-01 (ADR-066, "o bot tem o que você deu; o modo decide"): a rotina pede leitura ou
 * escrita como qualquer turno, e o modo do bot concede (no automático, o "Apagar e desfazer" para no card).
 */
const INSTRUCAO = "E-mails às 8h, 13h e 18h";

async function cenario(opcoes: { gmailConectado?: boolean; modo?: ModoAprovacao } = {}) {
  const { deps, banco } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", nome: "Nina" });
  if (opcoes.gmailConectado ?? true) {
    const conector = await deps.repos.conectores.criar({ nome: "Gmail (Composio)", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
    if (!conector) throw new Error("conector");
    await deps.repos.conectores.registrarSonda(conector.id, {
      ok: true,
      agora: deps.agora(),
      catalogo: [
        { nome: "GMAIL_FETCH_EMAILS", descricao: "Lê e-mails", schema: { type: "object" }, readOnlyHint: true },
        { nome: "GMAIL_LIST_LABELS", descricao: "Lista rótulos", schema: { type: "object" }, readOnlyHint: true },
        { nome: "GMAIL_SEND_EMAIL", descricao: "Envia e-mail", schema: { type: "object" }, readOnlyHint: false },
        { nome: "GMAIL_DELETE_MESSAGE", descricao: "Apaga e-mail", schema: { type: "object" }, readOnlyHint: false },
      ],
    });
    await deps.repos.conectores.habilitar(conector.id, true);
  }
  // A fonte NÃO cita o app: com "Gmail" na fonte o pré-voo (emenda da ADR-044) pararia a janela antes do
  // turno. Aqui o turno roda e descobre no meio que precisa do Gmail — o caminho do pedir_acesso.
  const rotina = await deps.repos.rotinas.criar({ agenteId: bot.agente.id, conversaId: bot.conversa.id, cron: "0 8,13,18 * * *", fusoIana: "America/Sao_Paulo", instrucao: INSTRUCAO, fonte: "a caixa de entrada", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: deps.agora() });
  if (!rotina) throw new Error("rotina");
  const r = await dispararRotina(deps, { rotina, instanteAgendado: deps.agora(), machineId: "m", executor: "catcher" });
  if (!("turno" in r.data)) throw new Error("sem turno");
  const turno = r.data.turno;
  if (opcoes.modo) await deps.repos.agentes.definirModoAprovacao(bot.agente.id, opcoes.modo);
  const ctx = { turnoId: turno.id, conversaId: bot.conversa.id, agenteId: bot.agente.id };
  // O plano do turno de rotina: é com ele que o modo do bot decide (sem plano, nunca concede).
  const comPlano = { ...ctx, plano: planoDeTeste({ turnoId: turno.id, agenteId: bot.agente.id, conversaId: bot.conversa.id, modoTurno: "rotina" }) };
  return { deps, banco, bot, rotina, turno, ctx, comPlano };
}

describe("pedir_acesso num turno de rotina (ADR-044)", () => {
  it("[] com o app conectado vira as ferramentas de LEITURA; proposta e decisão de mesmo id, com a frase da rotina", async () => {
    const c = await cenario();
    const r = await pedirAcesso(c.deps, { ...c.ctx, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    expect(r.data).toEqual({ proposta_id: expect.any(String), estado: "aguardando_pessoa", instrucao: "o acesso ainda NÃO foi concedido: diga que pediu e encerre o turno" });
    const proposta = c.banco.propostas.find((p) => p.id === r.data.proposta_id);
    expect(proposta?.payload).toEqual({ kind: "acesso", turnoId: c.turno.id, conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], nivel: "leitura", naoPedido: [], rotinaId: c.rotina.id });
    const decisao = c.banco.decisoes.find((d) => d.id === r.data.proposta_id);
    expect(decisao).toMatchObject({ tipo: "acesso", estado: "pendente", turnoId: c.turno.id, agenteId: c.bot.agente.id });
    expect(decisao?.frase).toBe(`Nina precisa ler seu Gmail para a rotina “${INSTRUCAO}”. Não inclui: enviar, apagar, arquivar.`);
    expect(r.events?.map((e) => e.kind)).toEqual(["proposta_criada", "decisao_criada"]);
    expect(c.banco.concessoes).toHaveLength(0);
  });

  it("ADR-066: a rotina pede escrita como qualquer turno — pelo nível ([] = ler e alterar, sem apagar) ou pelo nome —; sem modo que conceda, vira o card da rotina e nada é concedido", async () => {
    const c = await cenario();
    const peloNivel = await pedirAcesso(c.deps, { ...c.ctx, conector: "gmail", capacidades: [], nivel: "escrita", nao_pedido: [] });
    expect(peloNivel.data.estado).toBe("aguardando_pessoa");
    expect(c.banco.propostas.find((p) => p.id === peloNivel.data.proposta_id)?.payload).toEqual({ kind: "acesso", turnoId: c.turno.id, conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS", "GMAIL_SEND_EMAIL"], nivel: "escrita", naoPedido: [], rotinaId: c.rotina.id });
    expect(c.banco.decisoes.find((d) => d.id === peloNivel.data.proposta_id)).toMatchObject({ tipo: "acesso", estado: "pendente" });

    // Pelo nome, mesmo declarando "leitura": o nível vem do catálogo (enviar é escrita), e a rotina não precisou declarar.
    const n = await cenario();
    const peloNome = await pedirAcesso(n.deps, { ...n.ctx, conector: "gmail", capacidades: ["GMAIL_SEND_EMAIL"], nivel: "leitura", nao_pedido: [] });
    expect(n.banco.propostas.find((p) => p.id === peloNome.data.proposta_id)?.payload).toMatchObject({ capacidades: ["GMAIL_SEND_EMAIL"], nivel: "escrita", rotinaId: n.rotina.id });
    expect([...c.banco.concessoes, ...n.banco.concessoes]).toHaveLength(0);
  });

  it("app ainda não conectado: só o card de conexão, com a rotina junto; sem decisão", async () => {
    const c = await cenario({ gmailConectado: false });
    const r = await pedirAcesso(c.deps, { ...c.ctx, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    expect(r.data.estado).toBe("aguardando_pessoa");
    expect(c.banco.propostas.find((p) => p.id === r.data.proposta_id)?.payload).toMatchObject({ conectar: true, capacidades: [], rotinaId: c.rotina.id });
    expect(c.banco.decisoes).toHaveLength(0);
    expect(r.events?.map((e) => e.kind)).toEqual(["proposta_criada"]);
  });

  it("a retomada de um turno de rotina continua sendo da rotina: o pedido dela é o mesmo pedido", async () => {
    const c = await cenario();
    const primeiro = await pedirAcesso(c.deps, { ...c.ctx, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    const retomada = await c.deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.bot.conversa.id, agenteId: c.bot.agente.id, origem: "retomada", retomaTurnoId: c.turno.id, prazoEm: c.deps.agora() + 60_000, profundidade: 0, entradaTexto: "continue", entradaConfianca: "confiavel", modelo: "sonnet" });
    const deNovo = await c.deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.bot.conversa.id, agenteId: c.bot.agente.id, origem: "retomada", retomaTurnoId: retomada?.id ?? "", prazoEm: c.deps.agora() + 60_000, profundidade: 0, entradaTexto: "continue", entradaConfianca: "confiavel", modelo: "sonnet" });
    const segundo = await pedirAcesso(c.deps, { ...c.ctx, turnoId: deNovo?.id ?? "", conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    expect(segundo.data.proposta_id).toBe(primeiro.data.proposta_id);
    // ADR-066: na cadeia a escrita também pode ser pedida, e cai no MESMO card aberto da rotina (UM por app).
    const escrita = await pedirAcesso(c.deps, { ...c.ctx, turnoId: deNovo?.id ?? "", conector: "gmail", capacidades: [], nivel: "escrita", nao_pedido: [] });
    expect(escrita.data).toMatchObject({ proposta_id: primeiro.data.proposta_id, estado: "aguardando_pessoa" });
    expect(c.banco.propostas).toHaveLength(1);
  });

  it("pedido cuja decisão venceu não conta: o disparo seguinte abre um card novo em vez de apontar para um que saiu da tela", async () => {
    const c = await cenario();
    const primeiro = await pedirAcesso(c.deps, { ...c.ctx, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    await c.deps.repos.decisoes.vencerPendentes(c.deps.agora() + 2 * 86_400_000);
    const depois = await pedirAcesso(c.deps, { ...c.ctx, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    expect(depois.data.proposta_id).not.toBe(primeiro.data.proposta_id);
    expect(c.banco.decisoes.find((d) => d.id === depois.data.proposta_id)?.estado).toBe("pendente");
  });
});

/**
 * ADR-066: o pedido da rotina passa pelo modo do bot, como o da conversa e o do pedido de colega. Antes era o
 * único lugar em que o total ainda esperava um clique, e cada janela seguinte saía bloqueada até ele.
 */
describe("pedir_acesso num turno de rotina pelo modo do bot (ADR-066)", () => {
  it("automático: a escrita é concedida na hora, a decisão fecha pela regra e a rotina roda de novo, já com a ferramenta", async () => {
    const c = await cenario({ modo: "automatico" });
    const r = await pedirAcesso(c.deps, { ...c.comPlano, conector: "gmail", capacidades: ["GMAIL_SEND_EMAIL"], nivel: "escrita", nao_pedido: [] });
    expect(r.data).toMatchObject({ proposta_id: expect.any(String), estado: "concedido" });
    expect(c.banco.concessoes.map((x) => x.capacidade)).toEqual(["GMAIL_SEND_EMAIL"]);
    expect(c.banco.decisoes.find((d) => d.id === r.data.proposta_id)).toMatchObject({ tipo: "acesso", estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: "regra:modo_automatico", regraVersao: 2 } });
    expect(c.banco.propostas.find((p) => p.id === r.data.proposta_id)?.payload).toMatchObject({ rotinaId: c.rotina.id });
    // A concessão do pedido de rotina roda a rotina de novo (decidir-acesso.ts), em vez de retomar o turno.
    expect(c.banco.turnos.filter((t) => t.origem === "rotina")).toHaveLength(2);
    expect(c.banco.turnos.some((t) => t.origem === "retomada")).toBe(false);
    expect(r.events?.map((e) => e.kind)).not.toContain("decisao_criada");
  });

  it("automático: apagar é arriscado fora da conversa com a pessoa — para no card, nada concedido; o total concede", async () => {
    const apagar = { conector: "gmail", capacidades: ["GMAIL_DELETE_MESSAGE"], nivel: "escrita" as const, nao_pedido: [] };
    const a = await cenario({ modo: "automatico" });
    const r = await pedirAcesso(a.deps, { ...a.comPlano, ...apagar });
    expect(r.data.estado).toBe("aguardando_pessoa");
    expect(a.banco.decisoes.find((d) => d.id === r.data.proposta_id)?.estado).toBe("pendente");
    expect(a.banco.concessoes).toHaveLength(0);

    const t = await cenario({ modo: "total" });
    expect((await pedirAcesso(t.deps, { ...t.comPlano, ...apagar })).data.estado).toBe("concedido");
    expect(t.banco.concessoes.map((x) => x.capacidade)).toEqual(["GMAIL_DELETE_MESSAGE"]);
    expect(t.banco.decisoes[0]?.desfecho).toMatchObject({ tipo: "decidida_por_regra", regra: "regra:modo_total" });
  });

  it("manual (com plano): o card de sempre, nada concedido e a rotina não roda de novo", async () => {
    const c = await cenario({ modo: "manual" });
    const r = await pedirAcesso(c.deps, { ...c.comPlano, conector: "gmail", capacidades: ["GMAIL_SEND_EMAIL"], nivel: "escrita", nao_pedido: [] });
    expect(r.data.estado).toBe("aguardando_pessoa");
    expect(c.banco.concessoes).toHaveLength(0);
    expect(c.banco.turnos).toHaveLength(1);
  });

  it("app ainda não conectado: conectar (login) continua sendo da pessoa, até no total", async () => {
    const c = await cenario({ gmailConectado: false, modo: "total" });
    const r = await pedirAcesso(c.deps, { ...c.comPlano, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    expect(r.data.estado).toBe("aguardando_pessoa");
    expect(c.banco.propostas.find((p) => p.id === r.data.proposta_id)?.payload).toMatchObject({ conectar: true, rotinaId: c.rotina.id });
    expect(c.banco.decisoes).toHaveLength(0);
    expect(c.banco.concessoes).toHaveLength(0);
  });
});
