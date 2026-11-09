import { expect, it } from "vitest";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { Tx } from "../../src/shared/types.ts";
import { atualizarPerfil } from "../../src/use-cases/atualizar-perfil.ts";
import { confirmarProposta } from "../../src/use-cases/confirmar-proposta.ts";
import { criarRotinaPelaPessoa } from "../../src/use-cases/criar-rotina.ts";
import { modoDoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { recusarProposta } from "../../src/use-cases/recusar-proposta.ts";
import { pausarRotinaPeloAgente } from "../../src/use-cases/rotinas-do-agente.ts";
import { verColegas } from "../../src/use-cases/ver-colegas.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
import { FERRAMENTAS_NOD_POR_MODO } from "../../src/domain/plano-turno.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-050, "bot novo é bot completo" (2026-09-28), no Postgres. O caso real: a Teodora, recém-criada,
 * ouviu "vire minha assistente e pegue o que a Taga, a Ada e a Nina fazem" e respondeu "não consigo"
 * cinco vezes. Aqui ela vê as colegas pelo nod, propõe o perfil com as rotinas num card só, e pausa as
 * rotinas delas quando a pessoa pede.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-09-28T10:48:00-03:00");
const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const RESUMO_DA_MANHA = { cron: "0 8 * * 1-5", fuso_iana: "America/Sao_Paulo", instrucao: "Resumo da manhã: e-mails novos e ToDos do dia", fonte: "Gmail e ClickUp do Marlon", entregavel: "mensagem nesta conversa", limites_aprovacao: "sem ações externas", politica_sem_dado: "dizer que não há novidade" };
const EMAILS_A_TARDE = { ...RESUMO_DA_MANHA, cron: "0 13,18 * * 1-5", instrucao: "E-mails novos desde o último resumo" };

function plano(confiancaEntrada: PlanoTurno["confiancaEntrada"]): PlanoTurno {
  return {
    tenantId: TENANT_PADRAO, turnoId: "t", conversaId: "c", agenteId: "a", localidade: "local", machineId: "m", executor: "catcher", superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas", autoria: autoriaPessoa(PESSOA_MARLON), confiancaEntrada, profundidade: 0, catalogo: { ferramentas: [], servidores: [] },
    promptSistema: "", entrada: { texto: "", sessaoCli: null, modelo: "m" }, politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 8000 }, semprePermitir: [], tokenDeTurno: "tok", expiraEm: AGORA + 60_000,
  };
}

async function colega(trx: Tx, nome: string, descricao: string, rotina: { cron: string; instrucao: string }) {
  const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  await repos.agentes.atualizarPerfil(agenteId, { confirmado: true, titulo: nome === "Nina" ? "Assistente de e-mail" : "Checklist de ToDos", descricao });
  const { data } = await criarRotinaPelaPessoa(deps, { agenteId, cron: rotina.cron, fusoIana: "America/Sao_Paulo", instrucao: rotina.instrucao, fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p" });
  return { agenteId, conversaId, rotinaId: data.rotina.id };
}

async function cenario(trx: Tx) {
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  const nina = await colega(trx, "Nina", "Verifica o Gmail três vezes ao dia", { cron: "0 8,13,18 * * 1-5", instrucao: "Resumir os e-mails novos" });
  const ada = await colega(trx, "Ada", "Monta o checklist de ToDos", { cron: "0 8 * * 1-5", instrucao: "Montar o checklist do dia" });
  // Gmail conectado, com leitura concedida à Nina: ver_colegas diz o app e o nível.
  const gmail = await repos.conectores.criar({ nome: "Gmail", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!gmail) throw new Error("conector");
  await repos.conectores.registrarSonda(gmail.id, { ok: true, catalogo: [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_SEND_EMAIL", false)], agora: AGORA });
  await repos.conectores.habilitar(gmail.id, true);
  const msg = await repos.mensagens.criar({ conversaId: nina.conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "sistema", assunto: "acesso.concedido", texto: "acesso", confianca: "confiavel" });
  await repos.concessoes.conceder({ agenteId: nina.agenteId, conectorId: gmail.id, capacidade: "GMAIL_FETCH_EMAILS", mensagemId: msg?.id ?? "" });
  // Um bot ainda sem perfil não é colega de ninguém.
  await agenteComConversa(trx, MARLON, { nome: "Rascunho" });
  const teodora = await agenteComConversa(trx, MARLON, { nome: "Teodora" });
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId: teodora.conversaId, agenteId: teodora.agenteId, origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "vire minha assistente pessoal e pegue o que a Ada e a Nina fazem", entradaConfianca: "confiavel", modelo: "m" });
  if (!turno) throw new Error("turno");
  await repos.turnos.assentar(turno.id, { estado: "concluido" });
  const ctx = { agenteId: teodora.agenteId, conversaId: teodora.conversaId, turnoId: turno.id };
  return { deps, repos, nina, ada, teodora, turno, ctx };
}

describeIntegracao("bot novo é bot completo (ADR-050)", () => {
  it("o bot sem perfil fica em criação, e a criação tem o kit da conversa: vê, pergunta e delega", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const teodora = await c.repos.agentes.buscar(c.teodora.agenteId);
      expect(teodora?.confirmado).toBe(false);
      expect(modoDoTurno(c.turno, { tipo: "propria" }, { confirmado: false })).toBe("criacao");
      for (const n of ["ver_colegas", "pedir_a_bot", "pausar_rotina", "atualizar_perfil"]) expect(FERRAMENTAS_NOD_POR_MODO.criacao).toContain(n);
    });
  });

  it("ver_colegas: colegas confirmados do mesmo dono, com rotinas e apps; nunca a si mesma nem bot sem perfil", async () => {
    process.env.TZ = "UTC";
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const { data } = await verColegas(c.deps, { ...c.ctx });
      if ("erro" in data) throw new Error(data.erro);
      expect(data.colegas.map((x) => x.nome).sort()).toEqual(["Ada", "Nina"]);
      const nina = data.colegas.find((x) => x.nome === "Nina");
      expect(nina).toMatchObject({ titulo: "Assistente de e-mail", descricao: "Verifica o Gmail três vezes ao dia", apps: [{ slug: "gmail", nome: "Gmail", nivel: "leitura" }] });
      expect(nina?.rotinas).toEqual([{ id: c.nina.rotinaId, quando: expect.stringContaining("08:00"), estado: "ativa", instrucao: "Resumir os e-mails novos" }]);

      const so = await verColegas(c.deps, { ...c.ctx, agente: "@ada" });
      expect("colegas" in so.data && so.data.colegas.map((x) => x.id)).toEqual([c.ada.agenteId]);
      // NOD-20 (revisão 3 M2): só com `agente` vêm as versões do perfil (número, origem, campos), para o restaurar_versao.
      expect("colegas" in so.data && so.data.colegas[0]?.versoes).toEqual([]);
      expect(data.colegas.every((x) => x.versoes === undefined)).toBe(true);
      await editarPerfil(c.deps, { agenteId: c.ada.agenteId, descricao: "Organiza o backlog." });
      const comVersoes = await verColegas(c.deps, { ...c.ctx, agente: "ada" });
      expect("colegas" in comVersoes.data && comVersoes.data.colegas[0]?.versoes).toEqual([
        { versao: 2, origem: "tela", autor: "pessoa", campos: ["descricao"], atual: true },
        { versao: 1, origem: "inicial", autor: "pessoa", campos: [], atual: false },
      ]);
      expect((await verColegas(c.deps, { ...c.ctx, agente: "Rascunho" })).data).toEqual({ erro: "nao_encontrado" });
      expect((await verColegas(c.deps, { ...c.ctx, agente: "Teodora" })).data).toEqual({ erro: "nao_encontrado" });
    });
  });

  it("perfil com rotinas: um card; confirmar cria as rotinas, confirma o bot, escreve UMA linha e retoma o turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const { data } = await atualizarPerfil(c.deps, { ...c.ctx, nome: "Teodora", titulo: "Assistente pessoal", descricao: "Cuida do seu dia", rotinas: [RESUMO_DA_MANHA, EMAILS_A_TARDE] });
      if ("erro" in data) throw new Error(data.erro);
      expect(data.rotinas).toHaveLength(2);
      const perfil = await c.repos.propostas.buscar(data.proposta_id);
      if (perfil?.payload.kind !== "perfil") throw new Error("perfil");
      expect(perfil.payload.turnoId).toBe(c.turno.id);
      const ids = perfil.payload.rotinas ?? [];
      expect(ids).toHaveLength(2);
      for (const id of ids) {
        expect((await c.repos.propostas.buscar(id))?.estado).toBe("pendente");
        // Sem decisão própria em "Sua vez": o card do perfil é o único lugar onde ela se confirma.
        expect(await c.repos.decisoes.buscar(id)).toBeNull();
      }
      const antes = (await c.repos.mensagens.listarDaConversa(c.teodora.conversaId, 50)).length;

      const confirmada = await confirmarProposta(c.deps, { propostaId: data.proposta_id });
      expect(confirmada.data.agente).toMatchObject({ nome: "Teodora", titulo: "Assistente pessoal", confirmado: true });
      for (const id of ids) expect(await c.repos.rotinas.buscar(id)).toMatchObject({ estado: "ativa", agenteId: c.teodora.agenteId });
      const novas = (await c.repos.mensagens.listarDaConversa(c.teodora.conversaId, 50)).slice(antes);
      expect(novas.map((m) => m.kind)).toEqual(["sistema"]);
      expect(novas[0]?.texto).toContain("2 rotinas, a próxima em");

      const eventos = (confirmada.events ?? []).filter((e) => e.kind === "turno_criado");
      expect(eventos).toHaveLength(1);
      const turnoId = eventos[0]?.turnoId ?? "";
      const nova = await c.repos.turnos.buscar(turnoId);
      expect(nova).toMatchObject({ origem: "retomada", retomaTurnoId: c.turno.id, entradaConfianca: "confiavel" });
      expect(nova?.entradaTexto).toContain("pedir_a_pessoa se deve pausar as rotinas deles");
      // Confirmada, a retomada já roda no modo conversa.
      expect(modoDoTurno(nova ?? c.turno, { tipo: "propria" }, { confirmado: true })).toBe("conversa");
    });
  });

  it("rotina recusada pelo domínio: erro tipado com o índice e nada nasce; recusar o perfil leva as rotinas junto", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const ruim = await atualizarPerfil(c.deps, { ...c.ctx, nome: "Teodora", rotinas: [RESUMO_DA_MANHA, { ...EMAILS_A_TARDE, fuso_iana: "-03:00" }] });
      expect(ruim.data).toEqual({ erro: "fuso_invalido", rotina: 1 });
      expect(await c.repos.propostas.pendentesDaConversa(c.teodora.conversaId)).toEqual([]);

      const { data } = await atualizarPerfil(c.deps, { ...c.ctx, nome: "Teodora", rotinas: [RESUMO_DA_MANHA] });
      if ("erro" in data) throw new Error(data.erro);
      await recusarProposta(c.deps, { propostaId: data.proposta_id });
      expect(await c.repos.propostas.pendentesDaConversa(c.teodora.conversaId)).toEqual([]);
    });
  });

  it("pausar a rotina de uma colega: vale com a pessoa no turno e fica dito na conversa dela; sem ela, não", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const semPessoa = await pausarRotinaPeloAgente(c.deps, { ...c.ctx, plano: plano("nao_confiavel"), rotina_id: c.nina.rotinaId });
      expect(semPessoa.data).toEqual({ erro: "nao_encontrado" });
      expect((await c.repos.rotinas.buscar(c.nina.rotinaId))?.estado).toBe("ativa");
      expect((await pausarRotinaPeloAgente(c.deps, { ...c.ctx, rotina_id: c.nina.rotinaId })).data).toEqual({ erro: "nao_encontrado" });

      const pausa = await pausarRotinaPeloAgente(c.deps, { ...c.ctx, plano: plano("confiavel"), rotina_id: c.nina.rotinaId });
      expect(pausa.data).toMatchObject({ rotina_id: c.nina.rotinaId, estado: "pausada", ja_estava: false });
      expect((await c.repos.mensagens.ultimaDaConversa(c.nina.conversaId))?.texto).toBe("Teodora pausou esta rotina a seu pedido: nada será disparado até você reativar.");
    });
  });
});
