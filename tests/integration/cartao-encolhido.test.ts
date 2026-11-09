import { expect, it, vi } from "vitest";
import type { Rotina } from "../../src/contracts/rotina.ts";
import type { Tx } from "../../src/shared/types.ts";
import type { Repos } from "../../src/repositories/index.ts";
import { atualizarPerfil } from "../../src/use-cases/atualizar-perfil.ts";
import { confirmarProposta } from "../../src/use-cases/confirmar-proposta.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { decidir } from "../../src/use-cases/decidir.ts";
import { decidirAcesso } from "../../src/use-cases/decidir-acesso.ts";
import { pedirAcesso } from "../../src/use-cases/pedir-acesso.ts";
import { pedirAprovacao } from "../../src/use-cases/pedir-aprovacao.ts";
import { permitirSempre } from "../../src/use-cases/permitir-sempre.ts";
import { recusarProposta } from "../../src/use-cases/recusar-proposta.ts";
import { retomarAposPasta } from "../../src/use-cases/retomar-apos-pasta.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { depsSobre as depsL7 } from "../helpers/deps-l7.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre as depsL5, servicosDeTeste } from "../helpers/l5.ts";
import { idDaProposta } from "../helpers/perfil.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Chat limpo, PR 4 (plano, Parte 3 · 3A): o recibo de cada decisão grava a âncora do pedido, para o cartão encolher no
 * lugar dele. `resultado_aprovacao` já estava no turno da decisão; o consentimento do pedido ganha decisão, turno e frase;
 * "permitiu para sempre" ganha o payload `regra_permanente`; a pasta, o turno; a proposta, `proposta_decidida`.
 */

async function turnoDe(repos: Repos, conversaId: string, agenteId: string): Promise<string> {
  const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
  if (!t) throw new Error("turno");
  return t.id;
}

async function assuntoDe(trx: Tx, id: string): Promise<string | null> {
  const [l] = await trx<{ assunto: string | null }[]>`select assunto from mensagens where id = ${id}`;
  return l?.assunto ?? null;
}

describeIntegracao("o recibo grava a âncora do cartão encolhido (chat limpo, PR 4)", () => {
  it("aprovação: o resultado no turno da decisão, com a decisão e a frase; 'Sempre permitir' vira regra_permanente com o turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Clarice" });
      const email = await repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      await repos.conectores.registrarSonda(email?.id ?? "", { ok: true, catalogo: [{ nome: "enviar", descricao: "envia", schema: { type: "object" }, readOnlyHint: false }], agora: Date.now() });
      const consentimento = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(MARLON.pessoaId), kind: "consentimento", texto: "ok", confianca: "confiavel" });
      await repos.concessoes.conceder({ agenteId, conectorId: email?.id ?? "", capacidade: "enviar", mensagemId: consentimento?.id ?? "" });
      const turnoId = await turnoDe(repos, conversaId, agenteId);
      const deps = depsL5(repos, MARLON, { services: servicosDeTeste({ chamadas: [] }), trx });
      const pedido = await pedirAprovacao(deps, { turnoId, agenteId, conversaId, resumo: "Enviar e-mail para Helena Souza", itens: [{ texto: "e-mail para Helena", destino: { conector: "email", ferramenta: "enviar", argumentos: { texto: "topamos" } } }] });
      if (pedido.data.estado !== "pendente") throw new Error("esperava pendente");
      const decisaoId = pedido.data.decisao_id;
      const [item] = await repos.itensAprovacao.listar(decisaoId);

      const r = await decidir(deps, { decisaoId, itens: [] });
      const resultado = (await repos.mensagens.listarDaConversa(conversaId, 50)).find((m) => m.id === r.data.mensagemId);
      expect(resultado).toMatchObject({ kind: "resultado_aprovacao", turnoId, payload: { kind: "resultado_aprovacao", decisaoId, frase: expect.any(String) } });
      expect(await assuntoDe(trx, resultado?.id ?? "")).toBe("aprovacao.recibo");

      // O pedido de teste nasce sem plano (motivo `sem_plano`, que regra nenhuma pula): o card real tem o motivo da regra.
      await trx`update itens_aprovacao set motivo_manual = null where id = ${item?.id ?? ""}`;
      const regra = await permitirSempre(deps, { decisaoId, itemIds: [item?.id ?? ""] });
      const m = (await repos.mensagens.listarDaConversa(conversaId, 50)).find((x) => x.id === regra.data.mensagemId);
      expect(m).toMatchObject({ kind: "consentimento", turnoId: null, payload: { kind: "regra_permanente", decisaoId, turnoId, acoes: ["email.enviar"] } });
      expect(m?.texto).toContain("permitiu para sempre: email.enviar");
      expect(await assuntoDe(trx, m?.id ?? "")).toBe("acesso.concedido");
    });
  });

  it("acesso pelo pedido: o consentimento leva a decisão, o turno que pediu e a frase do pedido", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Milton" });
      const { deps, repos } = depsL7(trx, MARLON);
      const conector = await repos.conectores.criar({ nome: "ClickUp", slug: "clickup", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
      await repos.conectores.registrarSonda(conector?.id ?? "", { ok: true, catalogo: [{ nome: "CLICKUP_GET_TASKS", descricao: "lê", schema: { type: "object" }, readOnlyHint: true }], agora: Date.now() });
      await repos.conectores.habilitar(conector?.id ?? "", true);
      const turnoId = await turnoDe(repos, conversaId, agenteId);
      const pedido = await pedirAcesso(deps, { agenteId, conversaId, turnoId, conector: "clickup", capacidades: ["CLICKUP_GET_TASKS"], nivel: "leitura", nao_pedido: [] });
      const decisao = await repos.decisoes.buscar(pedido.data.proposta_id);
      expect(decisao).toMatchObject({ tipo: "acesso", turnoId });

      const r = await decidirAcesso(deps, { decisaoId: decisao?.id ?? "", recusar: false, executor: "catcher" });
      const m = (await repos.mensagens.listarDaConversa(conversaId, 50)).find((x) => x.id === r.data.consentimentoId);
      expect(m?.payload).toMatchObject({ kind: "consentimento", slug: "clickup", capacidades: ["CLICKUP_GET_TASKS"], decisaoId: decisao?.id, turnoId, frase: decisao?.frase });
      expect(await assuntoDe(trx, m?.id ?? "")).toBe("acesso.concedido");
    });
  });

  it("acesso com grupos desmarcados: sem a frase do pedido, que diria mais do que foi concedido (ADR-044)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Milton" });
      const { deps, repos } = depsL7(trx, MARLON);
      const conector = await repos.conectores.criar({ nome: "ClickUp", slug: "clickup", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
      await repos.conectores.registrarSonda(conector?.id ?? "", { ok: true, catalogo: [{ nome: "CLICKUP_GET_TASKS", descricao: "lê", schema: { type: "object" }, readOnlyHint: true }, { nome: "CLICKUP_CREATE_TASK", descricao: "cria", schema: { type: "object" }, readOnlyHint: false }], agora: Date.now() });
      await repos.conectores.habilitar(conector?.id ?? "", true);
      const turnoId = await turnoDe(repos, conversaId, agenteId);
      const pedido = await pedirAcesso(deps, { agenteId, conversaId, turnoId, conector: "clickup", capacidades: ["CLICKUP_GET_TASKS", "CLICKUP_CREATE_TASK"], nivel: "escrita", nao_pedido: [] });
      const decisao = await repos.decisoes.buscar(pedido.data.proposta_id);

      const r = await decidirAcesso(deps, { decisaoId: decisao?.id ?? "", recusar: false, executor: "catcher", capacidades: ["CLICKUP_GET_TASKS"] });
      const m = (await repos.mensagens.listarDaConversa(conversaId, 50)).find((x) => x.id === r.data.consentimentoId);
      expect(m?.payload).toMatchObject({ kind: "consentimento", capacidades: ["CLICKUP_GET_TASKS"], decisaoId: decisao?.id, turnoId });
      expect(m?.payload).not.toHaveProperty("frase");
    });
  });

  it("proposta: confirmada e recusada viram proposta_decidida (assunto do chat) com o turno — o da proposta ou o da decisão de mesmo id", async () => {
    const ativar = vi.fn(async (_trx: unknown, propostaId: string): Promise<Rotina> => ({
      tenantId: MARLON.tenantId, id: propostaId, agenteId: "a", conversaId: "c", ownerId: MARLON.pessoaId, cron: "0 8 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "x", fonte: "y", entregavel: "z", limitesAprovacao: "w", politicaSemDado: "v", exigeAprovacao: true, estado: "ativa", proximaExecucao: 1, criadoEm: 0, excluidoEm: null, acessos: null, gatilho: "horario", provedor: null, eventos: null,
    }));
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON, { ativarRotina: ativar });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Vera" });
      const conversaId = criado.conversa.id;
      const agenteId = criado.agente.id;
      const turnoId = await turnoDe(deps.repos, conversaId, agenteId);
      const ultima = async () => {
        const m = await deps.repos.mensagens.ultimaDaConversa(conversaId);
        return { m, assunto: await assuntoDe(trx, m?.id ?? "") };
      };

      // Perfil recusado: o turno vem do payload da proposta.
      const perfil = (await executar(deps, atualizarPerfil, { turnoId, agenteId, conversaId, nome: "Outro" })).data;
      await executar(deps, recusarProposta, { propostaId: idDaProposta(perfil) });
      expect(await ultima()).toMatchObject({ m: { texto: "Deixei isso de lado. Nada foi agendado nem concedido.", payload: { kind: "proposta_decidida", propostaId: idDaProposta(perfil), tipo: "perfil", titulo: "Perfil · Outro", estado: "recusada", turnoId } }, assunto: "proposta.resultado" });

      // Rotina confirmada: a proposta não tem turno; a decisão de mesmo id tem.
      const rotina = await deps.repos.propostas.criar({ conversaId, agenteId, payload: { kind: "rotina", cron: "0 8 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "x", fonte: "y", entregavel: "z", limitesAprovacao: "w", politicaSemDado: "v", proximaExecucao: 1, resumo: "dias úteis às 08:00" } });
      await deps.repos.decisoes.criar({ id: rotina?.id ?? "", tipo: "rotina", turnoId, agenteId, conversaId, prazoDecisaoEm: Date.now() + 60_000, frase: "Criar a rotina" });
      await executar(deps, confirmarProposta, { propostaId: rotina?.id ?? "" });
      expect(await ultima()).toMatchObject({ m: { payload: { kind: "proposta_decidida", propostaId: rotina?.id, tipo: "rotina", titulo: "Rotina · dias úteis às 08:00", estado: "confirmada", turnoId } }, assunto: "proposta.resultado" });

      // Sem turno em lugar nenhum: null (o cartão encolhe onde o recibo está).
      const solta = await deps.repos.propostas.criar({ conversaId, agenteId, payload: { kind: "rotina", cron: "0 9 * * *", fusoIana: "America/Sao_Paulo", instrucao: "x", fonte: "y", entregavel: "z", limitesAprovacao: "w", politicaSemDado: "v", proximaExecucao: 1, resumo: "todo dia às 09:00" } });
      await executar(deps, recusarProposta, { propostaId: solta?.id ?? "" });
      expect((await ultima()).m?.payload).toMatchObject({ kind: "proposta_decidida", estado: "recusada", turnoId: null });

      // Confirmar um pedido de acesso só abre a decisão: "Pedido aberto" continua sem payload, na Atividade.
      const acesso = await deps.repos.propostas.criar({ conversaId, agenteId, payload: { kind: "acesso", conector: "exemplo", capacidades: ["listar_contatos"], nivel: "leitura", naoPedido: [] } });
      await executar(deps, confirmarProposta, { propostaId: acesso?.id ?? "" });
      expect(await ultima()).toMatchObject({ m: { texto: "Pedido aberto; nada foi concedido ainda.", payload: null }, assunto: "proposta.decidida" });
    });
  });

  it("pasta: o registro da pasta aberta leva o turno que pediu", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Dev 1" });
      const { deps, repos } = depsL7(trx, MARLON);
      const turnoId = await turnoDe(repos, conversaId, agenteId);
      const proposta = await repos.propostas.criar({ conversaId, agenteId, payload: { kind: "pasta", turnoId, candidatas: [{ caminho: "/Users/m/code/acme", nome: "acme", git: true, onde: "code" }], motivo: "o projeto", buscaTermo: "acme" } });
      if (!proposta) throw new Error("proposta");
      await retomarAposPasta(deps, { proposta, pasta: "/Users/m/code/acme" });
      const m = (await repos.mensagens.listarDaConversa(conversaId, 50)).find((x) => x.payload?.kind === "pasta_aberta");
      expect(m?.payload).toMatchObject({ kind: "pasta_aberta", propostaId: proposta.id, nome: "acme", turnoId });
      expect(await assuntoDe(trx, m?.id ?? "")).toBe("acesso.pasta");
    });
  });
});
