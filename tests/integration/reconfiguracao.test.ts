import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IdHarness } from "../../src/contracts/harness.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { atualizarPerfil } from "../../src/use-cases/atualizar-perfil.ts";
import { autoriaAgente } from "../../src/use-cases/autoria-evento.ts";
import { confirmarProposta } from "../../src/use-cases/confirmar-proposta.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import { recusarProposta } from "../../src/use-cases/recusar-proposta.ts";
import { JANELA_RECONFIGURACAO_MS } from "../../src/domain/reconfiguracao.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-23 (/configurar): a mensagem /configurar na conversa própria de um bot confirmado liga a reconfiguração por 2 h na
 * mesma transação do turno; o plano desse turno (e dos seguintes, na janela) soma atualizar_perfil e a linha da
 * entrevista. Confirmar ou recusar o cartão de perfil fecha. O Nod, o bot não confirmado e o de outra pessoa não entram.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const PRONTO = { estado: "pronto" as const, versao: "t", em: 0 };
const harnesses: Partial<Record<IdHarness, typeof PRONTO>> = { "claude-cli": PRONTO };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function montar(trx: Trx, opcoes: { confirmado?: boolean } = {}) {
  let agora = Date.parse("2026-10-28T15:00:00Z");
  const relogio = () => agora;
  const base = await agenteComConversa(trx, MARLON, { nome: "Vera" });
  if (opcoes.confirmado !== false) await base.repos.agentes.atualizarPerfil(base.agenteId, { titulo: "Revisora", descricao: "Revisa PRs", confirmado: true });
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora: relogio, tokens: criarTokenTurno({ agora: relogio }) }), agora: relogio, trx });
  const enviar = async (texto: string) => (await enviarMensagem(deps, { conversaId: base.conversaId, texto, inventario: PRONTO })).data.turno;
  const plano = async (turnoId: string, recompor = false) => (await emitirPlanoTurno(deps, {
    turnoId, machineId: randomUUID(), executor: "local", harnesses,
    ...(recompor ? { recompor: { tokenDeTurno: deps.services.tokenTurno.cunhar(turnoId, { ...MARLON, agenteId: base.agenteId }), harness: "claude-cli" as const } } : {}),
  })).data;
  const nomes = (p: Awaited<ReturnType<typeof plano>>) => ("catalogo" in p ? p.catalogo.ferramentas.map((f) => f.nome) : []);
  const desde = async () => (await base.repos.agentes.buscar(base.agenteId))?.configurandoDesde ?? null;
  const avancar = (ms: number) => { agora += ms; };
  return { ...base, deps, enviar, plano, nomes, desde, avancar, agora: () => agora };
}

describeIntegracao("NOD-23: /configurar liga a reconfiguração", () => {
  it("/configurar no bot próprio confirmado liga o modo; o plano soma atualizar_perfil, a entrevista e nada muda no perfil", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await montar(trx);
      const turno = await c.enviar("/configurar");
      expect(await c.desde()).toBe(c.agora());
      const p = await c.plano(turno.id);
      expect(c.nomes(p)).toContain("atualizar_perfil");
      if (!("promptSistema" in p)) throw new Error("plano");
      expect(p.promptSistema).toContain("Modo de reconfiguração");
      expect(p.entrada.texto).toContain("Comece a entrevista");
      // A resposta seguinte da entrevista, ainda na janela, continua no modo.
      c.avancar(60_000);
      const resposta = await c.enviar("quero que você seja mais direto");
      const p2 = await c.plano(resposta.id);
      expect(c.nomes(p2)).toContain("atualizar_perfil");
      // Nada muda no perfil antes de confirmar.
      expect(await c.repos.agentes.buscar(c.agenteId)).toMatchObject({ nome: "Vera", titulo: "Revisora", descricao: "Revisa PRs" });
    });
  });

  it("passadas 2 h sem cartão, a conversa volta a ser comum sem atualizar_perfil", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await montar(trx);
      await c.enviar("/setup muda o tom");
      c.avancar(JANELA_RECONFIGURACAO_MS);
      const depois = await c.enviar("oi");
      const p = await c.plano(depois.id);
      expect(c.nomes(p)).not.toContain("atualizar_perfil");
      if (!("promptSistema" in p)) throw new Error("plano");
      expect(p.promptSistema).not.toContain("Modo de reconfiguração");
    });
  });

  it("o bot ainda não confirmado, o Nod e uma fala comum não ligam o modo", async () => {
    await withRollback(MARLON, async (trx) => {
      const novo = await montar(trx, { confirmado: false });
      await novo.enviar("/configurar");
      expect(await novo.desde()).toBeNull();

      const c = await montar(trx);
      await c.enviar("me ajuda a configurar o CI");
      expect(await c.desde()).toBeNull();
      // O Nod de verdade (garantirNod devolve o já gravado, sem bater no índice de um Nod por pessoa).
      const { nod } = (await garantirNod(c.deps, {})).data;
      const t = (await enviarMensagem(c.deps, { conversaId: nod.conversaId, texto: "/configurar", inventario: PRONTO })).data.turno;
      expect((await c.repos.agentes.buscar(nod.id))?.configurandoDesde ?? null).toBeNull();
      const p = await c.plano(t.id);
      expect(c.nomes(p)).not.toContain("atualizar_perfil");
    });
  });

  it("o /configurar que sai da fila depois de 2 h ainda entrevista e religa a janela a partir da emissão", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await montar(trx);
      const turno = await c.enviar("/configurar");
      c.avancar(3 * 60 * 60 * 1000);
      const p = await c.plano(turno.id);
      expect(c.nomes(p)).toContain("atualizar_perfil");
      expect(p.entrada.texto).toContain("Comece a entrevista");
      expect(await c.desde()).toBe(c.agora());
    });
  });

  it("o /configurar que responde a uma fala continua sendo comando, apesar do prefixo da citação", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await montar(trx);
      const citada = await c.repos.mensagens.criar({ conversaId: c.conversaId, autoria: autoriaAgente({ agenteId: c.agenteId, contaDeExecucao: MARLON.pessoaId, executor: "local", localityReason: "tudo_local_nesta_rodada" }), kind: "texto", texto: "Quer revisar seu perfil?", confianca: "confiavel" });
      if (!citada) throw new Error("fala citada");
      const turno = (await enviarMensagem(c.deps, { conversaId: c.conversaId, texto: "/configurar", respondeA: citada.id, inventario: PRONTO })).data.turno;
      const p = await c.plano(turno.id);
      expect(c.nomes(p)).toContain("atualizar_perfil");
      expect(p.entrada.texto).toContain("Comece a entrevista");
      expect(p.entrada.texto).not.toContain("respondendo a:");
    });
  });

  it("o repositório repete a regra: não liga bot não confirmado, excluído nem o Nod", async () => {
    await withRollback(MARLON, async (trx) => {
      const novo = await montar(trx, { confirmado: false });
      expect(await novo.repos.agentes.iniciarConfiguracao(novo.agenteId, novo.agora(), randomUUID(), novo.agora() - JANELA_RECONFIGURACAO_MS)).toBe(false);
      const excluido = await montar(trx);
      await trx`update agentes set excluido_em = now() where id = ${excluido.agenteId}`;
      expect(await excluido.repos.agentes.iniciarConfiguracao(excluido.agenteId, excluido.agora(), randomUUID(), excluido.agora() - JANELA_RECONFIGURACAO_MS)).toBe(false);
      const { nod } = (await garantirNod(novo.deps, {})).data;
      expect(await novo.repos.agentes.iniciarConfiguracao(nod.id, novo.agora(), randomUUID(), novo.agora() - JANELA_RECONFIGURACAO_MS)).toBe(false);
      const ok = await montar(trx);
      expect(await ok.repos.agentes.iniciarConfiguracao(ok.agenteId, ok.agora(), randomUUID(), ok.agora() - JANELA_RECONFIGURACAO_MS)).toBe(true);
    });
  });

  it("o repositório não liga o modo do bot de outra pessoa (RLS + WHERE da dona)", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await montar(trx);
      const deAna = criarRepos(trx, ANA);
      expect(await deAna.agentes.iniciarConfiguracao(c.agenteId, c.agora(), randomUUID(), c.agora() - JANELA_RECONFIGURACAO_MS)).toBe(false);
      expect(await c.desde()).toBeNull();
    });
  });
});

describeIntegracao("NOD-23: o cartão de perfil fecha a reconfiguração", () => {
  async function comCartao(trx: Trx, modo: "manual" | "automatico" = "manual") {
    const c = await montar(trx);
    if (modo !== "manual") await c.repos.agentes.definirModoAprovacao(c.agenteId, modo);
    const inicio = await c.enviar("/configurar");
    await c.repos.mensagens.criar({ conversaId: c.conversaId, turnoId: inicio.id, autoria: autoriaAgente({ agenteId: c.agenteId, contaDeExecucao: MARLON.pessoaId, executor: "local", localityReason: "tudo_local_nesta_rodada" }), kind: "texto", texto: "Resumo: vou ser direto ao revisar PRs. Certo?", confianca: "confiavel" });
    const turno = await c.enviar("sim, pode propor");
    const { data } = await atualizarPerfil(c.deps, { agenteId: c.agenteId, conversaId: c.conversaId, turnoId: turno.id, descricao: "Revisa PRs, direto ao ponto" });
    if ("erro" in data) throw new Error(data.erro);
    return { ...c, turnoId: turno.id, propostaId: data.proposta_id };
  }

  it("confirmar aplica a descrição e zera o modo", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await comCartao(trx);
      expect(await c.desde()).not.toBeNull();
      await confirmarProposta(c.deps, { propostaId: c.propostaId });
      expect(await c.repos.agentes.buscar(c.agenteId)).toMatchObject({ descricao: "Revisa PRs, direto ao ponto", nome: "Vera" });
      expect(await c.desde()).toBeNull();
      // Recriar o plano do turno antigo não pode reabrir uma entrevista cujo cartão já foi decidido.
      const recomposto = await c.plano(c.turnoId, true);
      expect(c.nomes(recomposto)).not.toContain("atualizar_perfil");
      expect(await c.desde()).toBeNull();
    });
  });

  it("recusar não muda o perfil e zera o modo", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await comCartao(trx);
      await recusarProposta(c.deps, { propostaId: c.propostaId });
      expect(await c.repos.agentes.buscar(c.agenteId)).toMatchObject({ descricao: "Revisa PRs" });
      expect(await c.desde()).toBeNull();
    });
  });

  it("uma proposta antiga não fecha a reconfiguração aberta depois dela", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await comCartao(trx);
      const novo = await c.enviar("/configurar de novo");
      await recusarProposta(c.deps, { propostaId: c.propostaId });
      expect(await c.desde()).toBeNull();
      const plano = await c.plano(novo.id);
      expect(c.nomes(plano)).toContain("atualizar_perfil");
      expect(await c.desde()).not.toBeNull();
    });
  });

  it("no modo automático, o perfil continua pendente no cartão", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await comCartao(trx, "automatico");
      expect((await c.repos.agentes.buscar(c.agenteId))?.modoAprovacao).toBe("automatico");
      expect(await c.repos.propostas.buscar(c.propostaId)).toMatchObject({ estado: "pendente", payload: { kind: "perfil" } });
    });
  });

  it("o cartão obsoleto (perfil editado pela tela) também fecha", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await comCartao(trx);
      await editarPerfil(c.deps, { agenteId: c.agenteId, titulo: "Tech Lead" });
      const r = await confirmarProposta(c.deps, { propostaId: c.propostaId });
      expect(r.data).toMatchObject({ obsoleta: true });
      expect(await c.desde()).toBeNull();
    });
  });
});
