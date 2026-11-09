import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { tickPessoa } from "../../src/adapters/fundo/scheduler-rotina.ts";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-expiracao.ts";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import type { Transacao, Tx } from "../../src/shared/types.ts";
import { decidirAcesso } from "../../src/use-cases/decidir-acesso.ts";
import { listarRotinas } from "../../src/use-cases/listar-rotinas.ts";
import { listarSuaVez } from "../../src/use-cases/listar-sua-vez.ts";
import { pausarRotina } from "../../src/use-cases/pausar-rotina.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Emenda da ADR-044, "rotina se trava sozinha" — o caso da Nina, ponta a ponta no Postgres: a rotina de
 * Gmail rodava 3x/dia sem a concessão, e cada execução gastava um turno (~US$ 0,09), falhava e abria um
 * card. Agora a janela para ANTES do turno, com UM card; permitir roda na hora; ninguém liberar em 24 h
 * pausa a rotina com uma linha que diz por quê.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const TZ = "America/Sao_Paulo";
const H = 3_600_000;
const JANELA = Date.parse("2026-09-24T08:00:00-03:00");
const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const GMAIL = [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_LIST_LABELS", true), cap("GMAIL_SEND_EMAIL", false)];

async function cenario(trx: Tx, relogio: () => number) {
  const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Nina" });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: relogio });
  await repos.agentes.atualizarPerfil(agenteId, { confirmado: true, descricao: "Cuida dos e-mails" });
  const criado = await repos.conectores.criar({ nome: "Gmail (Composio)", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!criado) throw new Error("conector");
  await repos.conectores.registrarSonda(criado.id, { ok: true, catalogo: GMAIL, agora: JANELA });
  const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8,13,18 * * *", fusoIana: TZ, instrucao: "E-mails às 8h, 13h e 18h", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: JANELA });
  if (!rotina) throw new Error("rotina");
  const tx: Transacao = (fn) => fn(trx);
  const tick = () => tickPessoa(MARLON, tx, { machineId: randomUUID(), executor: "catcher", services: deps.services, useCases: deps.useCases, agora: relogio });
  const varrer = () => varrerPessoa(MARLON, tx, { services: deps.services, useCases: deps.useCases, agora: relogio });
  return { agenteId, conversaId, deps, repos, rotina, tick, varrer, conectorId: criado.id };
}

const cardsDeAcesso = async (repos: Repos, conversaId: string) => (await repos.propostas.pendentesDaConversa(conversaId)).filter((p) => p.kind === "acesso");
const kinds = async (trx: Tx, conversaId: string) => (await trx<{ kind: string }[]>`select kind from events where conversa_id = ${conversaId} order by created_at, id`).map((e) => e.kind);

describeIntegracao("rotina se trava sozinha (emenda da ADR-044): o caso da Nina", () => {
  it("sem a concessão: 8h, 13h e 18h param sem turno e sem mensagem, com UM card; a tela diz desde quando; permitir roda na hora", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = JANELA + 30_000;
      const c = await cenario(trx, () => agora);
      const mensagensAntes = (await c.repos.mensagens.listarDaConversa(c.conversaId, 200)).length;

      for (const [i, hora] of [8, 13, 18].entries()) {
        agora = JANELA + (hora - 8) * H + 30_000;
        const r = await c.tick();
        expect(r).toMatchObject({ disparadas: [], bloqueadas: [c.rotina.id], falhas: [] });
        expect(await cardsDeAcesso(c.repos, c.conversaId)).toHaveLength(1);
        expect(await c.repos.rotinaExecucoes.listar(c.rotina.id)).toHaveLength(i + 1);
      }
      expect(await c.repos.turnos.listarDaConversa(c.conversaId, 50)).toHaveLength(0);
      const execucoes = await c.repos.rotinaExecucoes.listar(c.rotina.id);
      expect(execucoes.map((e) => [e.instanteAgendado, e.desfecho, e.motivo, e.turnoId])).toEqual([
        [JANELA + 10 * H, "bloqueada", "sem_acesso", null],
        [JANELA + 5 * H, "bloqueada", "sem_acesso", null],
        [JANELA, "bloqueada", "sem_acesso", null],
      ]);
      // Nenhuma linha no chat por janela: o card é o aviso.
      expect(await c.repos.mensagens.listarDaConversa(c.conversaId, 200)).toHaveLength(mensagensAntes);
      const [card] = await cardsDeAcesso(c.repos, c.conversaId);
      if (!card) throw new Error("card");
      expect(card.payload).toMatchObject({ kind: "acesso", conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], nivel: "leitura", rotinaId: c.rotina.id, geracao: expect.any(Number) });
      expect(await c.repos.decisoes.buscar(card.id)).toMatchObject({ tipo: "acesso", estado: "pendente", turnoId: null, frase: "Nina precisa ler seu Gmail para a rotina “E-mails às 8h, 13h e 18h”. Não inclui: enviar, apagar, arquivar." });
      expect((await kinds(trx, c.conversaId)).sort()).toEqual(["decisao_criada", "proposta_criada", "rotina_bloqueada", "rotina_bloqueada", "rotina_bloqueada"]);
      // A agenda andou como num dia normal: a próxima é amanhã às 8h.
      expect((await c.repos.rotinas.buscar(c.rotina.id))?.proximaExecucao).toBe(JANELA + 24 * H);

      // A lista de rotinas e "Sua vez" dizem que está parada, desde quando e o que não rodou.
      const { data: lista } = await listarRotinas(c.deps, {});
      expect(lista.rotinas.find((r) => r.rotina.id === c.rotina.id)?.bloqueio).toEqual({ motivo: "sem_acesso", app: "Gmail", slug: "gmail", decisaoId: card.id, rodaNaHora: true, desde: JANELA, naoRodaram: [JANELA + 10 * H, JANELA + 5 * H, JANELA], fusoIana: TZ });
      const { data: fila } = await listarSuaVez(c.deps, { marcarVista: false });
      expect(fila.itens.find((i) => i.decisao.id === card.id)?.rotinaParada).toEqual({ desde: JANELA, naoRodaram: [JANELA + 10 * H, JANELA + 5 * H, JANELA], fusoIana: TZ });

      // "Permitir e rodar agora": concede a leitura e dispara a rotina na hora, sem passar pelo pré-voo.
      agora = JANELA + 10 * H + 5 * 60_000 + 417;
      const permitido = await decidirAcesso(c.deps, { decisaoId: card.id, recusar: false, executor: "catcher" });
      expect(permitido.data).toMatchObject({ concessoes: 2, rotinaId: c.rotina.id, turnoId: expect.any(String) });
      expect(await c.repos.turnos.buscar(permitido.data.turnoId ?? "")).toMatchObject({ origem: "rotina", retomaTurnoId: null });
      expect((await c.repos.propostas.buscar(card.id))?.estado).toBe("confirmada");
      expect((await listarRotinas(c.deps, {})).data.rotinas.find((r) => r.rotina.id === c.rotina.id)?.bloqueio).toBeNull();

      // A janela de amanhã roda normal.
      await c.repos.turnos.assentar(permitido.data.turnoId ?? "", { estado: "concluido" });
      agora = JANELA + 24 * H + 30_000;
      expect(await c.tick()).toMatchObject({ disparadas: [c.rotina.id], bloqueadas: [] });
      expect(await cardsDeAcesso(c.repos, c.conversaId)).toHaveLength(0);
    });
  });

  it("ninguém libera em 24 h: o card vence, a proposta sai recusada e a rotina pausa com a linha; reativar abre card novo; 'Reabrir' no vencido ainda permite", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = JANELA + 30_000;
      const c = await cenario(trx, () => agora);
      await c.tick();
      const [card] = await cardsDeAcesso(c.repos, c.conversaId);
      if (!card) throw new Error("card");

      agora = JANELA + 25 * H;
      const varrida = await c.varrer();
      expect(varrida.vencidas).toContain(card.id);
      expect(varrida.pausadas).toEqual([c.rotina.id]);
      expect((await c.repos.propostas.buscar(card.id))?.estado).toBe("recusada");
      expect((await c.repos.rotinas.buscar(c.rotina.id))?.estado).toBe("pausada");
      const textos = (await c.repos.mensagens.listarDaConversa(c.conversaId, 200)).map((m) => m.texto);
      expect(textos).toContain("Rotina pausada: ninguém liberou o acesso ao Gmail em 24h. Reative quando quiser.");
      // A linha da pausa SUBSTITUI a de vencimento: uma mensagem, não duas.
      expect(textos.filter((t) => t.startsWith("Este pedido venceu"))).toHaveLength(0);
      expect(await kinds(trx, c.conversaId)).toEqual(expect.arrayContaining(["decisao_vencida", "rotina_atualizada"]));
      // Varrer de novo não pausa nem escreve outra vez.
      expect(await c.varrer()).toEqual({ vencidas: [], mensagens: 0, passaramEmBranco: [], pausadas: [] });
      expect((await listarRotinas(c.deps, {})).data.rotinas.find((r) => r.rotina.id === c.rotina.id)?.bloqueio).toBeNull();

      // Reativar recalcula a agenda; a próxima janela para de novo e abre um card NOVO.
      await pausarRotina(c.deps, { rotinaId: c.rotina.id, estado: "ativa" });
      const reativada = await c.repos.rotinas.buscar(c.rotina.id);
      agora = (reativada?.proximaExecucao ?? 0) + 30_000;
      expect(await c.tick()).toMatchObject({ bloqueadas: [c.rotina.id] });
      const [novo] = await cardsDeAcesso(c.repos, c.conversaId);
      expect(novo?.id).toBeDefined();
      expect(novo?.id).not.toBe(card.id);

      // "Reabrir" no card vencido e permitir: a proposta recusada não impede; o card novo, igual, fecha junto.
      agora += 60_000;
      expect(await c.repos.decisoes.reabrir(card.id, agora + 24 * H)).not.toBeNull();
      const permitido = await decidirAcesso(c.deps, { decisaoId: card.id, recusar: false, executor: "catcher" });
      expect(permitido.data).toMatchObject({ concessoes: 2, rotinaId: c.rotina.id, turnoId: expect.any(String) });
      expect(await cardsDeAcesso(c.repos, c.conversaId)).toHaveLength(0);
      expect(await c.repos.propostas.pendentesDeAcessoDaRotina(c.rotina.id)).toEqual([]);
    });
  });

  it("card do pré-voo (sem turno) e agente excluído e restaurado (ADR-034): permitir o card reaberto concede, mas não reativa nem dispara a rotina da geração antiga", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = JANELA + 30_000;
      const c = await cenario(trx, () => agora);
      await c.tick();
      const [card] = await cardsDeAcesso(c.repos, c.conversaId);
      if (!card) throw new Error("card");
      expect(await c.repos.decisoes.buscar(card.id)).toMatchObject({ turnoId: null });
      await c.repos.agentes.excluir(c.agenteId, agora);
      await c.repos.agentes.restaurar(c.agenteId);
      expect((await c.repos.decisoes.buscar(card.id))?.estado).toBe("vencida");
      agora += 60_000;
      expect(await c.repos.decisoes.reabrir(card.id, agora + 24 * H)).not.toBeNull();
      const r = await decidirAcesso(c.deps, { decisaoId: card.id, recusar: false, executor: "catcher" });
      expect(r.data).toMatchObject({ concessoes: 2, rotinaId: c.rotina.id, turnoId: null });
      expect((await c.repos.rotinas.buscar(c.rotina.id))?.estado).toBe("pausada");
      expect(await c.repos.turnos.listarDaConversa(c.conversaId, 50)).toHaveLength(0);
    });
  });

  it("duas rotinas da Nina que leem o Gmail: UM card para as duas; 'Sem conexão' vira o card de um clique quando o app liga", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = JANELA + 30_000;
      const c = await cenario(trx, () => agora);
      await c.repos.conectores.habilitar(c.conectorId, false);
      const outra = await c.repos.rotinas.criar({ agenteId: c.agenteId, conversaId: c.conversaId, cron: "0 8 * * *", fusoIana: TZ, instrucao: "Etiquetar newsletters", fonte: "gmail (composio)", entregavel: "lista", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: JANELA });
      expect((await c.tick()).bloqueadas.sort()).toEqual([c.rotina.id, outra?.id].sort());
      const cards = await cardsDeAcesso(c.repos, c.conversaId);
      expect(cards).toHaveLength(1);
      expect(cards[0]?.payload).toMatchObject({ conectar: true, capacidades: [] });
      expect(await c.repos.decisoes.buscar(cards[0]?.id ?? "")).toBeNull();
      expect((await c.repos.rotinaExecucoes.listar(outra?.id ?? "")).map((e) => e.motivo)).toEqual(["sem_conexao"]);

      // A pessoa conecta o app: a próxima janela troca o card de conexão pelo de um clique — ainda um só.
      await c.repos.conectores.habilitar(c.conectorId, true);
      const deps13 = depsSobre(trx, MARLON, { agora: () => JANELA + 5 * H + 30_000 });
      const r13 = await tickPessoa(MARLON, (fn) => fn(trx), { machineId: randomUUID(), executor: "catcher", services: deps13.deps.services, useCases: deps13.deps.useCases, agora: () => JANELA + 5 * H + 30_000 });
      expect(r13.bloqueadas).toEqual([c.rotina.id]);
      const depois = await cardsDeAcesso(c.repos, c.conversaId);
      expect(depois).toHaveLength(1);
      expect(depois[0]?.payload).toMatchObject({ capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"] });
      expect((await c.repos.propostas.buscar(cards[0]?.id ?? ""))?.estado).toBe("confirmada");
      expect(await c.repos.decisoes.buscar(depois[0]?.id ?? "")).toMatchObject({ tipo: "acesso", estado: "pendente" });
      // As duas rotinas mostram o mesmo card; só a DONA dele roda na hora ao permitir.
      const bloqueios = (await listarRotinas(deps13.deps, {})).data.rotinas.map((r) => r.bloqueio);
      expect(bloqueios.map((b) => b?.decisaoId)).toEqual([depois[0]?.id, depois[0]?.id]);
      expect(bloqueios.filter((b) => b?.rodaNaHora)).toHaveLength(1);
    });
  });
});
