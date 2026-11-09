import { expect, it } from "vitest";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { dispararRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { pedirAPessoa } from "../../../src/use-cases/pedir-a-pessoa.ts";
import { depsEmMemoria } from "../../helpers/deps-l6.ts";

/**
 * ADR-044: a rotina que dispara às 8h, 13h e 18h e esbarra no mesmo buraco deixava UM card de
 * pergunta por execução (a Nina, sem acesso ao Gmail, pedia em texto a cada disparo). Num turno de
 * rotina, a decisão pendente do mesmo agente e tipo, ligada à MESMA rotina, já é a pergunta.
 */
async function cenario() {
  const { deps, banco } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", nome: "Nina" });
  const agora = deps.agora();
  const criarRotina = async (instrucao: string) => {
    const r = await deps.repos.rotinas.criar({ agenteId: bot.agente.id, conversaId: bot.conversa.id, cron: "0 8,13,18 * * *", fusoIana: "America/Sao_Paulo", instrucao, fonte: "planilha", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: agora });
    if (!r) throw new Error("rotina");
    return r;
  };
  const rotina = await criarRotina("Resumo das vendas");
  let passo = 0;
  // Cada disparo é o de uma janela nova: o turno da anterior já terminou (a guarda "uma execução aberta
  // por rotina", ADR-045, pularia a janela com ele ainda pendente). É o "executar agora" (preservarAgenda):
  // desde a emenda da ADR-044 o AGENDADOR não dispara a rotina com a pergunta dela pendente (a janela fica
  // 'bloqueada' / aguardando_resposta) — quem roda de novo, com a pergunta aberta, é a pessoa.
  const disparo = async (r = rotina) => {
    for (const t of banco.turnos) if (t.origem === "rotina" && t.estado === "pendente") await deps.repos.turnos.assentar(t.id, { estado: "concluido" });
    passo += 1;
    const d = await dispararRotina(deps, { rotina: r, instanteAgendado: agora - passo * 3_600_000, machineId: "m", executor: "catcher", preservarAgenda: true });
    if (!("turno" in d.data)) throw new Error("sem turno");
    return d.data.turno.id;
  };
  const perguntar = (turnoId: string, tipo: "falta_de_dado" | "pergunta" = "falta_de_dado") =>
    pedirAPessoa(deps, { turnoId, conversaId: bot.conversa.id, agenteId: bot.agente.id, tipo, texto: "não achei a planilha de vendas", dado: "planilha de vendas" });
  return { deps, banco, bot, rotina, disparo, perguntar, criarRotina };
}

it("o disparo seguinte da mesma rotina reaproveita a pergunta pendente: nenhuma decisão, mensagem ou evento novos", async () => {
  const c = await cenario();
  const primeiro = await c.perguntar(await c.disparo());
  const mensagens = c.banco.mensagens.length;
  const segundo = await c.perguntar(await c.disparo());
  expect(segundo.data).toEqual({ estado: "pendente", decisao_id: primeiro.data.decisao_id, instrucao: "encerre o turno; a resposta retoma depois" });
  expect(segundo.events ?? []).toEqual([]);
  expect(c.banco.decisoes).toHaveLength(1);
  expect(c.banco.mensagens).toHaveLength(mensagens);
});

it("a retomada de um disparo (cadeia de retomaTurnoId) conta como a mesma rotina", async () => {
  const c = await cenario();
  const t = await c.disparo();
  const primeiro = await c.perguntar(t);
  const retomada = await c.deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.bot.conversa.id, agenteId: c.bot.agente.id, origem: "retomada", retomaTurnoId: t, prazoEm: c.deps.agora() + 60_000, profundidade: 0, entradaTexto: "continue", entradaConfianca: "confiavel", modelo: "sonnet" });
  expect((await c.perguntar(retomada?.id ?? "")).data.decisao_id).toBe(primeiro.data.decisao_id);
});

it("outro tipo, outra rotina, pergunta já respondida ou turno de conversa abrem pergunta nova", async () => {
  const c = await cenario();
  const primeiro = await c.perguntar(await c.disparo());
  expect((await c.perguntar(await c.disparo(), "pergunta")).data.decisao_id).not.toBe(primeiro.data.decisao_id);
  const outraRotina = await c.criarRotina("Resumo do estoque");
  expect((await c.perguntar(await c.disparo(outraRotina))).data.decisao_id).not.toBe(primeiro.data.decisao_id);
  const conversa = await c.deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.bot.conversa.id, agenteId: c.bot.agente.id, origem: "conversa", prazoEm: c.deps.agora() + 60_000, profundidade: 0, entradaTexto: "cadê a planilha?", entradaConfianca: "confiavel", modelo: "sonnet" });
  expect((await c.perguntar(conversa?.id ?? "")).data.decisao_id).not.toBe(primeiro.data.decisao_id);
  await c.deps.repos.decisoes.decidir(primeiro.data.decisao_id, { por: c.deps.escopo.pessoaId, agora: c.deps.agora() });
  expect((await c.perguntar(await c.disparo())).data.decisao_id).not.toBe(primeiro.data.decisao_id);
});
