import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { tickPessoa } from "../../src/adapters/fundo/scheduler-rotina.ts";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import type { ArgsPedirAcesso } from "../../src/contracts/ferramentas-nod.ts";
import { ROTINAS } from "../../src/db/schema/rotinas.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import type { Transacao, Tx } from "../../src/shared/types.ts";
import { aplicarAtualizacaoRotina } from "../../src/use-cases/aplicar-proposta-rotina.ts";
import { concederAcessosDaRotina } from "../../src/use-cases/conceder-acessos-da-rotina.ts";
import { confirmarProposta } from "../../src/use-cases/confirmar-proposta.ts";
import { criarRotina } from "../../src/use-cases/criar-rotina.ts";
import { atualizarRotinaPeloAgente } from "../../src/use-cases/rotinas-do-agente.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Emenda da ADR-044, "rotina nasce com o acesso" (2026-09-24), no Postgres: a rotina de Gmail da Nina
 * nasceu em 18/09 com fonte "Gmail do Marlon" e nada pediu o acesso — falhou desde a primeira execução.
 * Agora ela DECLARA o que lê, a pessoa vê no card e confirmar concede, na mesma transação da ativação.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-09-24T10:00:00-03:00");
const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const GMAIL = [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_LIST_LABELS", true), cap("GMAIL_SEND_EMAIL", false)];
const LEITURA = ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"];
const ler = (conector: string): ArgsPedirAcesso => ({ conector, capacidades: [], nivel: "leitura", nao_pedido: [] });
const ROTINA = { cron: "0 8,13,18 * * *", fuso_iana: "America/Sao_Paulo", instrucao: "E-mails às 8h, 13h e 18h", fonte: "Gmail do Marlon", entregavel: "resumo", limites_aprovacao: "nada sai sem aprovação", politica_sem_dado: "silêncio" };

async function cenario(trx: Tx, relogio: () => number) {
  const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Nina" });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: relogio });
  await repos.agentes.atualizarPerfil(agenteId, { confirmado: true, descricao: "Cuida dos e-mails" });
  const gmail = await repos.conectores.criar({ nome: "Gmail (Composio)", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!gmail) throw new Error("conector");
  await repos.conectores.registrarSonda(gmail.id, { ok: true, catalogo: GMAIL, agora: AGORA });
  await repos.conectores.habilitar(gmail.id, true);
  const tx: Transacao = (fn) => fn(trx);
  const tick = () => tickPessoa(MARLON, tx, { machineId: randomUUID(), executor: "catcher", services: deps.services, useCases: deps.useCases, agora: relogio });
  // Turno REAL (decisoes tem FK para turnos), já assentado: a fila do agente fica livre para a rotina.
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "cria a rotina dos e-mails", entradaConfianca: "confiavel", modelo: "m" });
  if (!turno) throw new Error("turno");
  await repos.turnos.assentar(turno.id, { estado: "concluido" });
  const ctx = { agenteId, conversaId, turnoId: turno.id };
  return { agenteId, conversaId, deps, repos, gmailId: gmail.id, tick, ctx };
}

const consentimentos = async (repos: Repos, conversaId: string) => (await repos.mensagens.listarDaConversa(conversaId, 200)).filter((m) => m.kind === "consentimento");
const concedidas = async (repos: Repos, agenteId: string) => (await repos.concessoes.doAgente(agenteId)).map((c) => c.capacidade).sort();

describeIntegracao("rotina nasce com o acesso (emenda da ADR-044)", () => {
  it("confirmar a rotina concede o que ela declarou, com UM consentimento, na MESMA transação; idempotente; a primeira janela roda sem card", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = AGORA;
      const c = await cenario(trx, () => agora);
      const proposta = await criarRotina(c.deps, { ...c.ctx, ...ROTINA, acessos: [ler("gmail")] });
      if ("erro" in proposta.data) throw new Error(proposta.data.erro);
      const propostaId = proposta.data.proposta_id;
      expect((await c.repos.propostas.buscar(propostaId))?.payload).toMatchObject({ kind: "rotina", acessos: [{ conector: "gmail", capacidades: LEITURA, nivel: "leitura" }] });

      // A concessão anda com a transação de quem confirma: desfeita a confirmação, não sobra concessão nem rotina.
      await expectRejected(trx, async () => {
        await confirmarProposta(c.deps, { propostaId });
        expect(await concedidas(c.repos, c.agenteId)).toEqual(LEITURA);
        throw new Error("desfaz a confirmação");
      }, /desfaz a confirmação/);
      expect(await c.repos.rotinas.buscar(propostaId)).toBeNull();
      expect(await concedidas(c.repos, c.agenteId)).toEqual([]);
      expect((await c.repos.propostas.buscar(propostaId))?.estado).toBe("pendente");

      const confirmada = await confirmarProposta(c.deps, { propostaId });
      expect(confirmada.data.rotina).toMatchObject({ id: propostaId, estado: "ativa", acessos: [{ conector: "gmail", capacidades: LEITURA, nivel: "leitura", naoPedido: [] }] });
      expect(await c.repos.rotinas.buscar(propostaId)).toMatchObject({ acessos: [{ conector: "gmail", capacidades: LEITURA }] });
      expect(await concedidas(c.repos, c.agenteId)).toEqual(LEITURA);
      const [consentimento, ...outros] = await consentimentos(c.repos, c.conversaId);
      expect(outros).toHaveLength(0);
      expect(consentimento?.payload).toMatchObject({ kind: "consentimento", slug: "gmail", capacidades: LEITURA });
      expect(new Set((await c.repos.concessoes.doAgente(c.agenteId)).map((x) => x.mensagemId))).toEqual(new Set([consentimento?.id]));

      // Idempotente: a decisão de "Sua vez" ativando de novo, ou conceder de novo, não escreve outro consentimento.
      await c.deps.tx((t) => c.deps.services.rotinas.ativar(t, propostaId));
      const deNovo = await concederAcessosDaRotina(c.deps, { agenteId: c.agenteId, acessos: confirmada.data.rotina?.acessos });
      expect(deNovo.data.concedidos).toEqual([{ slug: "gmail", capacidades: LEITURA, consentimentoId: null }]);
      expect(deNovo.events).toEqual([]);
      expect(await consentimentos(c.repos, c.conversaId)).toHaveLength(1);
      expect(await concedidas(c.repos, c.agenteId)).toEqual(LEITURA);

      // O pré-voo (emenda "rotina se trava sozinha") não para a primeira janela: o acesso nasceu com ela.
      agora = (confirmada.data.rotina?.proximaExecucao ?? 0) + 30_000;
      expect(await c.tick()).toMatchObject({ disparadas: [propostaId], bloqueadas: [], falhas: [] });
      expect((await c.repos.propostas.pendentesDaConversa(c.conversaId)).filter((p) => p.kind === "acesso")).toHaveLength(0);
    });
  });

  it("app declarado e ainda por conectar fica de fora da concessão; o pré-voo abre o card de conexão para ele", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = AGORA;
      const c = await cenario(trx, () => agora);
      const proposta = await criarRotina(c.deps, { ...c.ctx, ...ROTINA, acessos: [ler("gmail"), ler("notion")] });
      if ("erro" in proposta.data) throw new Error(proposta.data.erro);
      const { rotina } = (await confirmarProposta(c.deps, { propostaId: proposta.data.proposta_id })).data;
      expect(rotina?.acessos).toEqual([
        { conector: "gmail", capacidades: LEITURA, nivel: "leitura", naoPedido: [] },
        { conector: "notion", capacidades: [], nivel: "leitura", naoPedido: [], conectar: true },
      ]);
      expect(await concedidas(c.repos, c.agenteId)).toEqual(LEITURA);
      expect(await consentimentos(c.repos, c.conversaId)).toHaveLength(1);

      agora = (rotina?.proximaExecucao ?? 0) + 30_000;
      expect(await c.tick()).toMatchObject({ disparadas: [], bloqueadas: [rotina?.id] });
      const cards = (await c.repos.propostas.pendentesDaConversa(c.conversaId)).filter((p) => p.kind === "acesso");
      expect(cards.map((p) => p.payload)).toEqual([expect.objectContaining({ kind: "acesso", conector: "notion", conectar: true, rotinaId: rotina?.id })]);
    });
  });

  it("a mudança de rotina que declara acessos concede ao ser aplicada, uma vez só", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, () => AGORA);
      // Rotina anterior à emenda: sem declaração (null), o pré-voo lê a fonte.
      const legada = await c.repos.rotinas.criar({ agenteId: c.agenteId, conversaId: c.conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "E-mails", fonte: "a caixa de entrada", entregavel: "resumo", limitesAprovacao: "nada", politicaSemDado: "silêncio", proximaExecucao: AGORA + 60_000 });
      if (!legada) throw new Error("rotina");
      expect(legada.acessos).toBeNull();
      const mudanca = await atualizarRotinaPeloAgente(c.deps, { ...c.ctx, rotina_id: legada.id, acessos: [ler("gmail")] });
      if ("erro" in mudanca.data) throw new Error(mudanca.data.erro);
      expect(await concedidas(c.repos, c.agenteId)).toEqual([]);

      const aplicada = await aplicarAtualizacaoRotina(c.deps, { propostaId: mudanca.data.proposta_id });
      expect(aplicada.data.rotina.acessos).toEqual([{ conector: "gmail", capacidades: LEITURA, nivel: "leitura", naoPedido: [] }]);
      expect(await concedidas(c.repos, c.agenteId)).toEqual(LEITURA);
      expect(aplicada.events?.map((e) => e.kind)).toEqual(["rotina_atualizada", "concessao_criada", "concessao_criada", "decisao_decidida"]);
      expect((await aplicarAtualizacaoRotina(c.deps, { propostaId: mudanca.data.proposta_id })).data.jaAplicada).toBe(true);
      expect(await consentimentos(c.repos, c.conversaId)).toHaveLength(1);

      // Mudar só a instrução depois não mexe na declaração (o UPDATE mantém `acessos`).
      const outra = await atualizarRotinaPeloAgente(c.deps, { ...c.ctx, rotina_id: legada.id, instrucao: "E-mails e rótulos" });
      if ("erro" in outra.data) throw new Error(outra.data.erro);
      expect((await aplicarAtualizacaoRotina(c.deps, { propostaId: outra.data.proposta_id })).data.rotina.acessos).toEqual(aplicada.data.rotina.acessos);
    });
  });

  it("o CHECK da 0027 recusa `acessos` que não seja lista; null e [] passam", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, () => AGORA);
      const rotina = await c.repos.rotinas.criar({ agenteId: c.agenteId, conversaId: c.conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: AGORA, acessos: [] });
      expect(rotina?.acessos).toEqual([]);
      const erro = await expectRejected(trx, () => trx`update rotinas set acessos = ${trx.json({ conector: "gmail" })} where id = ${rotina?.id ?? ""}`, "23514");
      expect(erro.message).toContain(ROTINAS.acessos.check);
      await trx`update rotinas set acessos = null where id = ${rotina?.id ?? ""}`;
      expect((await c.repos.rotinas.buscar(rotina?.id ?? ""))?.acessos).toBeNull();
    });
  });
});
