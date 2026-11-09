import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IdHarness } from "../../src/contracts/harness.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { agenteComConversa, autoriaAgente, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
const MODELO: Record<"claude-cli" | "codex-cli", string> = { "claude-cli": "sonnet", "codex-cli": "gpt-6-astra" };

/**
 * Regressão medida em 2026-09-28 (0030): desde os harnesses (18/09), `!escolha` desligava o --resume de
 * todo turno real — cada mensagem abria uma sessão nova com 20 falas de 1.000 caracteres, e cada
 * retomada da Ada reescrevia o resumo. A sessão agora é do HARNESS que a criou.
 */
describeIntegracao("sessão do CLI pertence ao harness (0030)", () => {
  type Repos = Awaited<ReturnType<typeof agenteComConversa>>["repos"];
  async function plano(trx: Parameters<Parameters<typeof withRollback>[1]>[0], repos: Repos, agenteId: string, conversaId: string, harness: "claude-cli" | "codex-cli", extra: { mensagemOrigemId?: string } = {}) {
    const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "ola", entradaConfianca: "confiavel", modelo: MODELO[harness], harness, ...extra });
    const agora = () => Date.now();
    const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
    const harnesses: Partial<Record<IdHarness, typeof pronto>> = { "claude-cli": pronto, "codex-cli": pronto };
    return (await emitirPlanoTurno(deps, { turnoId: turno?.id ?? "", machineId: randomUUID(), executor: "local", harnesses })).data;
  }

  it("com harness escolhido, só a sessão gravada pelo mesmo harness vira --resume; sessão sem harness nunca", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true });

      expect((await plano(trx, repos, agenteId, conversaId, "claude-cli")).entrada.sessaoCli).toBeNull();

      // Sessão de antes da 0030 (sem harness): desconhecido é perigoso (ADR-009), abre sessão nova.
      await repos.conversas.atualizarSessaoCli(conversaId, randomUUID(), "local");
      expect((await plano(trx, repos, agenteId, conversaId, "claude-cli")).entrada.sessaoCli).toBeNull();

      const doClaude = randomUUID();
      await repos.conversas.atualizarSessaoCli(conversaId, doClaude, "local", "claude-cli");
      expect(await repos.conversas.buscar(conversaId)).toMatchObject({ sessaoHarness: "claude-cli", sessaoEm: expect.any(Number) });
      const retomado = await plano(trx, repos, agenteId, conversaId, "claude-cli");
      expect(retomado.entrada.sessaoCli).toBe(doClaude);
      // Retomando, o histórico não é repetido: a sessão já o tem.
      expect(retomado.promptSistema).not.toContain('"historico":[{');
      // O Codex nunca retoma a sessão do Claude (lição da 0005, agora por harness).
      expect((await plano(trx, repos, agenteId, conversaId, "codex-cli")).entrada.sessaoCli).toBeNull();

      await repos.conversas.atualizarSessaoCli(conversaId, null, "local", "claude-cli");
      expect(await repos.conversas.buscar(conversaId)).toMatchObject({ sessaoCli: null, sessaoHarness: null, sessaoEm: null });
    });
  });

  it("a sessão retomada recebe o que a conversa ganhou depois dela, sem a fala que disparou o turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true });
      const antes = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "Antes da sessão: monte meu checklist", confianca: "confiavel" });
      const sessao = randomUUID();
      await repos.conversas.atualizarSessaoCli(conversaId, sessao, "local", "claude-cli");

      // A rotina das 8h postou na conversa numa sessão própria (ADR-044): a sessão da conversa não viu.
      const rotina = await repos.mensagens.criar({ conversaId, autoria: autoriaAgente(agenteId, PESSOA_MARLON), kind: "texto", texto: "Checklist das 8h: [ ] RBAC [ ] Fechamento semanal", confianca: "confiavel" });
      // O plano compara `criadoEm > sessaoEm` e `criadoEm < turno.criadoEm` em milissegundos. Numa máquina rápida as
      // três gravações (fala de antes, sessão, rotina) e o turno cabem no mesmo ms e a rotina sumia do
      // "desdeSuaUltimaVez" (3 quedas na CI em 2026-11-04). O teste fixa os instantes em vez de contar com o relógio.
      const T = Date.now();
      await trx`update mensagens set criado_em = ${new Date(T - 2000)} where id = ${antes?.id ?? ""}`;
      await trx`update conversas set sessao_em = ${new Date(T - 1000)} where id = ${conversaId}`;
      await trx`update mensagens set criado_em = ${new Date(T - 500)} where id = ${rotina?.id ?? ""}`;
      const pedido = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "Marca o RBAC como feito", confianca: "confiavel" });

      const p = await plano(trx, repos, agenteId, conversaId, "claude-cli", { mensagemOrigemId: pedido?.id ?? "" });
      expect(p.entrada.sessaoCli).toBe(sessao);
      expect(p.promptSistema).toContain("desdeSuaUltimaVez");
      expect(p.promptSistema).toContain("Checklist das 8h");
      // O que a sessão já viu não se repete; a fala que disparou o turno vai só na entrada.
      expect(p.promptSistema).not.toContain("Antes da sessão");
      expect(p.promptSistema).not.toContain("Marca o RBAC como feito");
    });
  });

  // Regression: QA do PR #693 (jornada C) — o filtro da fala fixa sem IA no "desdeSuaUltimaVez" não tinha teste: sem ele,
  // a sessão retomada recebia "Recebi. Estou sem IA…" como novidade da conversa.
  // Found by /qa on 2026-11-08
  it("jornada C: a sessão retomada recebe a pergunta guardada sem IA, nunca a fala fixa do bot", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true });
      const sessao = randomUUID();
      await repos.conversas.atualizarSessaoCli(conversaId, sessao, "local", "claude-cli");
      const guardada = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "Pergunta guardada sem IA", confianca: "confiavel" });
      const fixa = await repos.mensagens.criar({ conversaId, autoria: autoriaAgente(agenteId, PESSOA_MARLON), kind: "negacao", texto: "Recebi. Estou sem IA neste computador, então ainda não consigo pensar nisso.", payload: { kind: "negacao", classe: "plano_ausente", nome: "claude-cli", motivo: "plano_ausente", terminal: false, aguardaIa: true }, confianca: "confiavel" });
      const T = Date.now();
      await trx`update conversas set sessao_em = ${new Date(T - 1000)} where id = ${conversaId}`;
      await trx`update mensagens set criado_em = ${new Date(T - 700)} where id = ${guardada?.id ?? ""}`;
      await trx`update mensagens set criado_em = ${new Date(T - 600)} where id = ${fixa?.id ?? ""}`;
      const pedido = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "E agora?", confianca: "confiavel" });

      const p = await plano(trx, repos, agenteId, conversaId, "claude-cli", { mensagemOrigemId: pedido?.id ?? "" });
      expect(p.entrada.sessaoCli).toBe(sessao);
      expect(p.promptSistema).toContain("Pergunta guardada sem IA");
      expect(p.promptSistema).not.toContain("Estou sem IA neste computador");
    });
  });
});
