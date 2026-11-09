import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ContaAnunciada } from "../../src/contracts/contas-ia.ts";
import { CAPACIDADES_HARNESS, type IdHarness } from "../../src/contracts/harness.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { dispararRotina, registrarDesfechoRotina, repetidoSemResume } from "../../src/use-cases/disparar-rotina.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-281 (ADR-107): a sessão do CLI mora no disco da máquina, na pasta da conta e no CLI que a criou. O turno só a
 * retoma se cair na mesma máquina (no modo da ponte), com a mesma IA e a mesma conta; senão vai o histórico. A sessão
 * recusada pelo CLI repete a fala UMA vez, sem resume, em vez de virar "falhou".
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.now();
const pronto: Inventario = { estado: "pronto", versao: "teste", em: AGORA };
const MODELO: Record<"claude-cli" | "codex-cli", string> = { "claude-cli": "sonnet", "codex-cli": "gpt-6-astra" };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const TOKENS = { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 };
const sucesso = (sessaoCli: string): ResultadoTurno => ({ desfecho: "sucesso", texto: "feito", sessaoCli, sinais: SINAIS, custoUsd: 0.1, tokens: TOKENS, ferramentasChamadas: [], negacoesPermissao: [] });
const rejeitada: ResultadoTurno = {
  desfecho: "interrompido", motivoInterrupcao: "sessao_rejeitada", texto: "", sessaoCli: null, sinais: { ...SINAIS, rejected: true, promptSubmitted: false, producedOutput: false },
  custoUsd: null, tokens: TOKENS, ferramentasChamadas: [], negacoesPermissao: [],
};
const imp = (n: number) => n.toString(16).padStart(64, "0");
const anuncio = (n: number, ia: ContaAnunciada["ia"], apelido: string): ContaAnunciada => ({ impressao: imp(n), ia, estado: "pronta", plano: "Plus", corporativa: false, logadaEm: AGORA - 60_000, apelidoSugerido: apelido });

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Eng 1" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const agora = () => Date.now();
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const enfileirar = (harness: "claude-cli" | "codex-cli", extra: Record<string, unknown> = {}) =>
    base.repos.turnos.enfileirar({ executor: "local", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "roda os testes", entradaConfianca: "confiavel", modelo: MODELO[harness], harness, ...extra });
  const plano = async (turnoId: string, p: { machineId: string; ias: readonly IdHarness[]; ponte?: boolean; capacidades?: Parameters<typeof emitirPlanoTurno>[1]["capacidadesDaMaquina"] }) =>
    (await emitirPlanoTurno(deps, {
      turnoId, machineId: p.machineId, executor: "local", harnesses: Object.fromEntries(p.ias.map((ia) => [ia, pronto])),
      ...(p.ponte ? { sessaoPorMaquina: true } : {}), ...(p.capacidades ? { capacidadesDaMaquina: p.capacidades } : {}),
    })).data;
  return { ...base, deps, enfileirar, plano };
}

describeIntegracao("NOD-281: a sessão do CLI é da máquina, da IA e da conta (ADR-107)", () => {
  it("na ponte, o resume só vale na máquina onde a sessão nasceu; em outra (ou sessão sem máquina) vai o histórico", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const [a, b] = [randomUUID(), randomUUID()];
      const t1 = (await m.enfileirar("claude-cli"))!;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(t1.id);
      expect((await m.plano(t1.id, { machineId: a, ias: ["claude-cli"], ponte: true })).entrada.sessaoCli).toBeNull();
      await assentarTurno(m.deps, { turnoId: t1.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso("sessao-da-a"), executor: "local", harness: "claude-cli" });
      expect(await m.repos.conversas.buscar(m.conversaId)).toMatchObject({ sessaoCli: "sessao-da-a", sessaoHarness: "claude-cli" });
      expect(await m.repos.conversas.maquinaDaSessao(m.conversaId)).toBe(a);

      // Dois turnos seguidos na mesma máquina: o segundo retoma.
      const t2 = (await m.enfileirar("claude-cli"))!;
      expect((await m.plano(t2.id, { machineId: a, ias: ["claude-cli"], ponte: true })).entrada.sessaoCli).toBe("sessao-da-a");
      // Em outra máquina, a sessão não existe: sem resume, com o histórico.
      const naB = await m.plano(t2.id, { machineId: b, ias: ["claude-cli"], ponte: true });
      expect(naB.entrada.sessaoCli).toBeNull();
      expect(naB.promptSistema).toContain('"historico"');

      // Sessão de antes da 0079 (sem máquina): na ponte não retoma; no Mac do modo local, como antes.
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, "sessao-velha", "local", "claude-cli");
      expect(await m.repos.conversas.maquinaDaSessao(m.conversaId)).toBeNull();
      expect((await m.plano(t2.id, { machineId: a, ias: ["claude-cli"], ponte: true })).entrada.sessaoCli).toBeNull();
      expect((await m.plano(t2.id, { machineId: a, ias: ["claude-cli"] })).entrada.sessaoCli).toBe("sessao-velha");

      // /nova-sessao leva a máquina junto.
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, "sessao-nova", "local", "claude-cli", a);
      await m.repos.conversas.recomecar(m.conversaId);
      expect(await m.repos.conversas.maquinaDaSessao(m.conversaId)).toBeNull();
    });
  });

  it("o Codex só retoma na máquina que anuncia retomaSessao (o app-server); sem o anúncio dele, vai o histórico", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, "thread-do-codex", "local", "codex-cli", a);
      const t = (await m.enfileirar("codex-cli"))!;
      const codex = CAPACIDADES_HARNESS["codex-cli"];
      const com = (retomaSessao: boolean) => ({ "codex-cli": { ...codex, retomaSessao } });
      expect((await m.plano(t.id, { machineId: a, ias: ["codex-cli"], ponte: true, capacidades: com(true) })).entrada.sessaoCli).toBe("thread-do-codex");
      expect((await m.plano(t.id, { machineId: a, ias: ["codex-cli"], ponte: true, capacidades: com(false) })).entrada.sessaoCli).toBeNull();
      expect((await m.plano(t.id, { machineId: a, ias: ["codex-cli"], ponte: true, capacidades: {} })).entrada.sessaoCli).toBeNull();
    });
  });

  it("a cadeia: a sessão do Codex não vira --resume do Claude; com outra conta também não; na mesma IA e conta, retoma", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const chave = await m.repos.maquinaTokens.criar({ nome: "vm-bots", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) });
      const vm = chave!.id;
      const delegacao = (harness: "claude-cli" | "codex-cli", extra: Record<string, unknown> = {}) => m.enfileirar(harness, { origem: "delegacao", sobProcuracaoDe: PESSOA_MARLON, profundidade: 1, ...extra });

      // O pedido rodou no Codex (sem conta da lista): a IA efetiva fica no turno.
      const pedido = (await delegacao("codex-cli"))!;
      expect((await m.plano(pedido.id, { machineId: vm, ias: ["codex-cli"] })).harness).toBe("codex-cli");
      await m.repos.turnos.assentar(pedido.id, { estado: "concluido", sessaoCli: "thread-do-pedido" });
      expect(await m.repos.turnos.sessaoDoTurno(pedido.id)).toMatchObject({ sessaoCli: "thread-do-pedido", harness: "codex-cli", contaId: null });

      // A retomada caiu no Claude: a thread do Codex não existe lá.
      const noClaude = (await delegacao("claude-cli", { origem: "retomada", retomaTurnoId: pedido.id }))!;
      expect((await m.plano(noClaude.id, { machineId: vm, ias: ["claude-cli"] })).entrada.sessaoCli).toBeNull();
      // No Codex, mesma conta (nenhuma): retoma.
      const noCodex = (await delegacao("codex-cli", { origem: "retomada", retomaTurnoId: pedido.id }))!;
      expect((await m.plano(noCodex.id, { machineId: vm, ias: ["codex-cli"] })).entrada.sessaoCli).toBe("thread-do-pedido");

      // A máquina passa a ter uma conta do ChatGPT: a retomada iria na pasta dessa conta, onde a thread não existe.
      await m.repos.contasIa.doAnuncio(vm, [anuncio(7, "codex-cli", "Pessoal")], AGORA);
      const outraConta = (await delegacao("codex-cli", { origem: "retomada", retomaTurnoId: pedido.id }))!;
      const p = await m.plano(outraConta.id, { machineId: vm, ias: ["codex-cli"] });
      expect(p.conta?.apelido).toBe("Pessoal");
      expect(p.entrada.sessaoCli).toBeNull();

      // O pedido que rodou nessa conta deixa a sessão nela: a retomada na mesma conta continua.
      const pedido2 = (await delegacao("codex-cli"))!;
      expect((await m.plano(pedido2.id, { machineId: vm, ias: ["codex-cli"] })).conta?.apelido).toBe("Pessoal");
      await m.repos.turnos.assentar(pedido2.id, { estado: "concluido", sessaoCli: "thread-da-conta" });
      const mesmaConta = (await delegacao("codex-cli", { origem: "retomada", retomaTurnoId: pedido2.id }))!;
      expect((await m.plano(mesmaConta.id, { machineId: vm, ias: ["codex-cli"] })).entrada.sessaoCli).toBe("thread-da-conta");
    });
  });

  it("sessão recusada pelo CLI: a fala é repetida uma vez sem resume, sem aviso de falha; na segunda, o aviso de sempre", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, "sessao-que-sumiu", "local", "claude-cli", a);
      const t1 = (await m.enfileirar("claude-cli"))!;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(t1.id);
      expect((await m.plano(t1.id, { machineId: a, ias: ["claude-cli"], ponte: true })).entrada.sessaoCli).toBe("sessao-que-sumiu");
      await assentarTurno(m.deps, { turnoId: t1.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: rejeitada, executor: "local", harness: "claude-cli" });

      expect((await m.repos.conversas.buscar(m.conversaId))?.sessaoCli).toBeNull();
      const sistema = async () => (await m.repos.mensagens.listarDaConversa(m.conversaId)).filter((x) => x.kind === "sistema");
      expect(await sistema()).toHaveLength(0);
      const turnos = await trx<{ id: string; reenvios: number; estado: string; entrada_texto: string }[]>`
        select id, reenvios, estado, entrada_texto from turnos where conversa_id = ${m.conversaId} order by criado_em, id`;
      const repetido = turnos.find((x) => x.id !== t1.id);
      expect(repetido).toMatchObject({ reenvios: 1, estado: "pendente", entrada_texto: "roda os testes" });

      // O turno repetido vai sem resume, com o histórico.
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(repetido!.id);
      const p2 = await m.plano(repetido!.id, { machineId: a, ias: ["claude-cli"], ponte: true });
      expect(p2.entrada.sessaoCli).toBeNull();

      // Recusado de novo: não há sessão para largar nem segunda repetição — vale o aviso de sempre.
      await assentarTurno(m.deps, { turnoId: repetido!.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: rejeitada, executor: "local", harness: "claude-cli" });
      expect(await sistema()).toHaveLength(1);
      const depois = await trx<{ n: number }[]>`select count(*)::int as n from turnos where conversa_id = ${m.conversaId}`;
      expect(depois[0]!.n).toBe(2);
    });
  });

  it("retomada de rotina recusada pelo CLI: larga a sessão da cadeia, repete uma vez sem resume e a janela fecha pela repetição", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      const rotina = (await m.repos.rotinas.criar({ agenteId: m.agenteId, conversaId: m.conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resumo", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() }))!;
      const disparo = await dispararRotina(m.deps, { rotina, instanteAgendado: Date.now(), machineId: a, executor: "local" });
      if (!("turno" in disparo.data)) throw new Error("sem turno");
      const tr = disparo.data.turno;
      await trx`update turnos set harness = 'claude-cli' where id = ${tr.id}`;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(tr.id);
      await m.plano(tr.id, { machineId: a, ias: ["claude-cli"], ponte: true });
      await assentarTurno(m.deps, { turnoId: tr.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: sucesso("sessao-da-rotina"), executor: "local", harness: "claude-cli" });

      const ret = (await m.repos.turnos.enfileirar({ executor: "local", conversaId: m.conversaId, agenteId: m.agenteId, origem: "retomada", retomaTurnoId: tr.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "continue", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(ret.id);
      expect((await m.plano(ret.id, { machineId: a, ias: ["claude-cli"], ponte: true })).entrada.sessaoCli).toBe("sessao-da-rotina");
      const s1 = (await assentarTurno(m.deps, { turnoId: ret.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: rejeitada, executor: "local", harness: "claude-cli" })).data.turno!;

      // A sessão sai do turno da cadeia; a repetição continua o turno recusado, com a mesma entrada e reenvios 1.
      expect(await m.repos.turnos.sessaoDoTurno(tr.id)).toBeNull();
      const repeticao = (await m.repos.turnos.retomadaNaFila(ret.id))!;
      expect(repeticao).toMatchObject({ origem: "retomada", retomaTurnoId: ret.id, reenvios: 1, entradaTexto: "continue" });
      expect(await repetidoSemResume(m.deps, ret.id)).toBe(true);
      expect((await registrarDesfechoRotina(m.deps, { turnoId: s1.id, desfecho: "falhou", motivo: s1.motivoFalha ?? null })).data).toEqual({ ignorado: "repetido_sem_resume" });
      expect((await m.repos.mensagens.listarDaConversa(m.conversaId)).filter((x) => x.kind === "sistema")).toHaveLength(0);

      // A repetição vai sem resume e, concluída, é ela quem registra a execução.
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(repeticao.id);
      expect((await m.plano(repeticao.id, { machineId: a, ias: ["claude-cli"], ponte: true })).entrada.sessaoCli).toBeNull();
      const s2 = (await assentarTurno(m.deps, { turnoId: repeticao.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso("sessao-nova"), executor: "local", harness: "claude-cli" })).data.turno!;
      expect(s2.estado).toBe("concluido");
      await registrarDesfechoRotina(m.deps, { turnoId: s2.id, desfecho: "executou" });
      const execs = await trx<{ desfecho: string }[]>`select desfecho from rotina_execucoes where rotina_id = ${rotina.id}`;
      expect(execs.map((x) => x.desfecho)).toEqual(["executou"]);
    });
  });

  it("retomada de rotina recusada duas vezes: a segunda não repete e a rotina registra 'falhou' (sem laço)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      const rotina = (await m.repos.rotinas.criar({ agenteId: m.agenteId, conversaId: m.conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resumo", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() }))!;
      const disparo = await dispararRotina(m.deps, { rotina, instanteAgendado: Date.now(), machineId: a, executor: "local" });
      if (!("turno" in disparo.data)) throw new Error("sem turno");
      const tr = disparo.data.turno;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(tr.id);
      await m.plano(tr.id, { machineId: a, ias: ["claude-cli"], ponte: true });
      await assentarTurno(m.deps, { turnoId: tr.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: sucesso("sessao-da-rotina"), executor: "local", harness: "claude-cli" });
      // A repetição já é o reenvio (reenvios 1): recusada de novo, vale o aviso de sempre.
      const ret = (await m.repos.turnos.enfileirar({ executor: "local", conversaId: m.conversaId, agenteId: m.agenteId, origem: "retomada", retomaTurnoId: tr.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "continue", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", reenvios: 1 }))!;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(ret.id);
      await m.plano(ret.id, { machineId: a, ias: ["claude-cli"], ponte: true });
      const s = (await assentarTurno(m.deps, { turnoId: ret.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: rejeitada, executor: "local", harness: "claude-cli" })).data.turno!;
      expect(await m.repos.turnos.retomadaNaFila(ret.id)).toBeNull();
      expect(await repetidoSemResume(m.deps, ret.id)).toBe(false);
      await registrarDesfechoRotina(m.deps, { turnoId: s.id, desfecho: "falhou", motivo: s.motivoFalha ?? null });
      const execs = await trx<{ desfecho: string }[]>`select desfecho from rotina_execucoes where rotina_id = ${rotina.id}`;
      expect(execs.map((x) => x.desfecho)).toEqual(["falhou"]);
    });
  });
});
