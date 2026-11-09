import { expect, it } from "vitest";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { dispararRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { pedirAcesso } from "../../../src/use-cases/pedir-acesso.ts";
import { depsEmMemoria } from "../../helpers/deps-l6.ts";

/**
 * Medido em 2026-09-21: a Cecília chamou pedir_acesso três vezes em 3 s no mesmo turno e cada proposta
 * virou uma decisão de acesso própria com a MESMA frase (mesmo id da proposta, confirmar-proposta.ts).
 * Depois de aprovar uma, as gêmeas ficaram impossíveis de resolver — `conceder` recusava capacidade já
 * concedida e o card pendente nunca saía da tela. O pedido idêntico agora reaproveita o que está lá.
 */
async function cenario() {
  const { deps, banco } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", interativo: true });
  const conector = await deps.repos.conectores.criar({ nome: "Gmail", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!conector) throw new Error("conector");
  conector.habilitado = true;
  conector.catalogo = [
    { nome: "GMAIL_FETCH_EMAILS", descricao: "Lê e-mails", schema: { type: "object" }, readOnlyHint: true },
    { nome: "GMAIL_FETCH_MESSAGE_BY_THREAD_ID", descricao: "Lê thread", schema: { type: "object" }, readOnlyHint: true },
  ];
  const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: deps.agora() + 10_000, profundidade: 0, entradaTexto: "veja meus e-mails", entradaConfianca: "confiavel", harness: "claude-cli", modelo: "sonnet" });
  if (!turno) throw new Error("turno");
  const pedir = (capacidades: string[], turnoId = turno.id) =>
    pedirAcesso(deps, { turnoId, conversaId: bot.conversa.id, agenteId: bot.agente.id, conector: "gmail", capacidades, nivel: "leitura", nao_pedido: [] });
  return { deps, banco, bot, turno, pedir };
}

it("pedido de acesso idêntico no mesmo turno não abre proposta nova: devolve a pendente, sem evento novo", async () => {
  const c = await cenario();
  const caps = ["GMAIL_FETCH_EMAILS", "GMAIL_FETCH_MESSAGE_BY_THREAD_ID"];

  const primeiro = await c.pedir(caps);
  const segundo = await c.pedir(caps);
  // Ordem diferente é o MESMO pedido: a comparação é por conjunto, não por lista.
  const terceiro = await c.pedir([...caps].reverse());

  expect(segundo.data.proposta_id).toBe(primeiro.data.proposta_id);
  expect(terceiro.data.proposta_id).toBe(primeiro.data.proposta_id);
  expect(segundo.events ?? []).toEqual([]);
  expect(c.banco.propostas.filter((p) => p.payload.kind === "acesso")).toHaveLength(1);
  // ADR-044: o pedido nasce com a decisão de MESMO id — uma só, também sem gêmea.
  expect(c.banco.decisoes.filter((d) => d.tipo === "acesso").map((d) => d.id)).toEqual([primeiro.data.proposta_id]);
  expect(primeiro.events?.map((e) => e.kind)).toEqual(["proposta_criada", "decisao_criada"]);
});

it("pedido com capacidades diferentes ainda abre proposta própria (pedir escopo a mais não é duplicata)", async () => {
  const c = await cenario();
  const primeiro = await c.pedir(["GMAIL_FETCH_EMAILS"]);
  const outro = await c.pedir(["GMAIL_FETCH_EMAILS", "GMAIL_FETCH_MESSAGE_BY_THREAD_ID"]);

  expect(outro.data.proposta_id).not.toBe(primeiro.data.proposta_id);
  expect(c.banco.propostas.filter((p) => p.payload.kind === "acesso")).toHaveLength(2);
});

it("proposta já resolvida não bloqueia pedir de novo: a guarda olha só o que está PENDENTE", async () => {
  const c = await cenario();
  const primeiro = await c.pedir(["GMAIL_FETCH_EMAILS"]);
  await c.deps.repos.propostas.decidir(primeiro.data.proposta_id, "recusada");

  const depois = await c.pedir(["GMAIL_FETCH_EMAILS"]);
  expect(depois.data.proposta_id).not.toBe(primeiro.data.proposta_id);
});

/**
 * ADR-044: a rotina das 8h, 13h e 18h pede de novo a cada disparo — outro turno, e o modelo pode
 * mandar [] numa execução e a lista exata na outra. Na rotina a chave é (agente, conector) desde a
 * emenda de 2026-09-24 (índice único da 0026). A fonte não cita o app, senão o pré-voo pararia as janelas.
 */
it("rotina: o pedido pendente vale para os disparos seguintes, ignorando turno e capacidades", async () => {
  const c = await cenario();
  const agora = c.deps.agora();
  const rotina = await c.deps.repos.rotinas.criar({ agenteId: c.bot.agente.id, conversaId: c.bot.conversa.id, cron: "0 8,13,18 * * *", fusoIana: "America/Sao_Paulo", instrucao: "E-mails às 8h, 13h e 18h", fonte: "a caixa de entrada", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: agora });
  if (!rotina) throw new Error("rotina");
  const disparo = async (instante: number) => {
    const r = await dispararRotina(c.deps, { rotina, instanteAgendado: instante, machineId: "m", executor: "catcher" });
    if (!("turno" in r.data)) throw new Error("sem turno");
    return r.data.turno.id;
  };
  const oito = await disparo(agora - 5 * 3_600_000);
  // O disparo das 8h terminou antes do das 13h (ADR-045: uma execução aberta por rotina).
  await c.deps.repos.turnos.assentar(oito, { estado: "concluido" });
  const treze = await disparo(agora);

  const primeiro = await c.pedir([], oito);
  const segundo = await c.pedir(["GMAIL_FETCH_EMAILS"], treze);
  expect(segundo.data.proposta_id).toBe(primeiro.data.proposta_id);
  expect(segundo.events ?? []).toEqual([]);
  expect(c.banco.propostas.filter((p) => p.payload.kind === "acesso")).toHaveLength(1);
  expect(c.banco.decisoes.filter((d) => d.tipo === "acesso")).toHaveLength(1);
  // A conversa não herda a chave da rotina: pedido do turno de conversa abre o seu.
  expect((await c.pedir(["GMAIL_FETCH_EMAILS"])).data.proposta_id).not.toBe(primeiro.data.proposta_id);
});
