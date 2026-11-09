import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { CAPACIDADES_HARNESS, SEM_CAPACIDADES, type IdHarness } from "../../src/contracts/harness.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { interromperPorMaquina } from "../../src/use-cases/interromper-por-maquina.ts";
import { parar } from "../../src/use-cases/parar.ts";
import { criarTrabalho, pararTrabalho, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
const harnesses: Partial<Record<IdHarness, typeof pronto>> = { "claude-cli": pronto };
const CLAUDE_ORIGINAL = { ...CAPACIDADES_HARNESS["claude-cli"] };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const sucesso = (sessaoCli: string): ResultadoTurno => ({ desfecho: "sucesso", texto: "feito", sessaoCli, sinais: SINAIS, custoUsd: 0.4, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] });

afterEach(() => {
  Object.assign(CAPACIDADES_HARNESS["claude-cli"], CLAUDE_ORIGINAL);
});

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const agora = () => Date.now();
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const turno = (trabalhoId: string | null | undefined, origem: "conversa" | "retomada" = "conversa", retomaTurnoId?: string) =>
    base.repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId, ...(retomaTurnoId ? { retomaTurnoId } : {}) });
  const plano = async (turnoId: string) => (await emitirPlanoTurno(deps, { turnoId, machineId: randomUUID(), executor: "local", harnesses })).data;
  return { ...base, deps, turno, plano };
}

describeIntegracao("trabalhos: sessão, pasta, retomada e parada (#192, ADR-083)", () => {
  it("o turno do trabalho roda na sessão e na pasta DELE, nunca na da conversa; duas tasks nunca dividem sessão nem pasta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const daConversa = randomUUID();
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, daConversa, "local", "claude-cli");
      const a = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Login do app", origem: "pessoa" })).trabalho;
      const b = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Login do app", origem: "pessoa" })).trabalho;
      expect(a.pasta).toMatch(/^~\/nod\/Ada\/login-do-app-[a-z0-9]{6}$/);
      expect(a.pasta).not.toBe(b.pasta);

      const tA = await m.turno(a.id);
      const pA = await m.plano(tA!.id);
      expect(pA.entrada.sessaoCli).toBeNull();
      expect(pA.pastaDoBot).toBe(a.pasta?.slice("~/nod/".length));
      expect(pA.promptSistema).toContain(`~/nod/${a.pasta?.slice("~/nod/".length)}`);

      // Assentar grava a sessão no trabalho e soma o custo nele; a conversa continua com a dela.
      await m.repos.turnos.reivindicar({ machineId: pA.machineId, agora: Date.now() });
      await assentarTurno(m.deps, { turnoId: tA!.id, machineId: pA.machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso("sessao-a"), executor: "local", harness: "claude-cli" });
      expect(await m.repos.trabalhos.buscar(a.id)).toMatchObject({ sessaoCli: "sessao-a", sessaoHarness: "claude-cli", custoUsd: 0.4, estado: "terminado" });
      expect((await m.repos.conversas.buscar(m.conversaId))?.sessaoCli).toBe(daConversa);

      // A retomada herda o trabalho e volta na sessão dele; a outra task nunca a pega.
      const retomada = await m.turno(undefined, "retomada", tA!.id);
      expect(retomada?.trabalhoId).toBe(a.id);
      const pRetomada = await m.plano((await m.repos.turnos.buscar(retomada!.id))!.id);
      expect(pRetomada.entrada.sessaoCli).toBe("sessao-a");
      const pB = await m.plano((await m.turno(b.id))!.id);
      expect(pB.entrada.sessaoCli).toBeNull();
      expect(pB.pastaDoBot).not.toBe(pA.pastaDoBot);
      // E o turno da conversa segue na sessão da conversa.
      expect((await m.plano((await m.turno(null))!.id)).entrada.sessaoCli).toBe(daConversa);
    });
  });

  it("harness SEM capacidades (S3): nem a sessão do trabalho nem a da conversa são retomadas, e não há terminal nem pasta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      Object.assign(CAPACIDADES_HARNESS["claude-cli"], SEM_CAPACIDADES);
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, randomUUID(), "local", "claude-cli");
      const w = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Sem capacidade", origem: "pessoa" })).trabalho;
      await m.repos.trabalhos.atualizarSessao(w.id, "sessao-velha", "claude-cli");
      const doTrabalho = await m.plano((await m.turno(w.id))!.id);
      expect(doTrabalho.entrada.sessaoCli).toBeNull();
      expect(doTrabalho.nativas ?? []).not.toContain("Bash");
      expect(doTrabalho.pastaDoBot).toBeUndefined();
      // Sem retomar, o modelo recebe o histórico recente no prompt.
      expect(doTrabalho.promptSistema).toContain('"historico"');
      expect((await m.plano((await m.turno(null))!.id)).entrada.sessaoCli).toBeNull();
    });
  });

  it("a rede de 2 min: a próxima mensagem da conversa sai com bifurcar na sessão que ficou com o trabalho; sem bifurcaSessao, não", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const s = randomUUID();
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, s, "local", "claude-cli");
      expect((await m.plano((await m.turno(null))!.id)).entrada.bifurcar).toBeUndefined();
      await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Promovido", origem: "rede", estado: "rodando", sessaoCli: s, sessaoHarness: "claude-cli", pasta: null });
      const p = await m.plano((await m.turno(null))!.id);
      expect(p.entrada).toMatchObject({ sessaoCli: s, bifurcar: true });
      Object.assign(CAPACIDADES_HARNESS["claude-cli"], { ...CLAUDE_ORIGINAL, bifurcaSessao: false });
      expect((await m.plano((await m.turno(null))!.id)).entrada.bifurcar).toBeUndefined();
    });
  });

  it("estados: rodando no despacho, precisa_de_voce com decisão aberta, parado pelo Parar da task (sem parar a conversa)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const w = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Estados", origem: "pessoa" })).trabalho;
      const t = await m.turno(w.id);
      const daConversa = await m.turno(null);
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      const ev = await sincronizarTrabalho(m.deps, w.id);
      expect(ev.map((e) => [e.kind, e.dados.estado])).toEqual([["trabalho_mudou", "rodando"]]);
      expect(await sincronizarTrabalho(m.deps, w.id)).toEqual([]);
      await m.repos.decisoes.criar({ tipo: "pergunta", agenteId: m.agenteId, conversaId: m.conversaId, turnoId: t!.id, prazoDecisaoEm: Date.now() + 60_000, frase: "Qual repo?" });
      await sincronizarTrabalho(m.deps, w.id);
      expect((await m.repos.trabalhos.buscar(w.id))?.estado).toBe("precisa_de_voce");

      const r = await pararTrabalho(m.deps, { trabalhoId: w.id });
      expect(r.data.trabalho.estado).toBe("parado");
      expect((await m.repos.turnos.buscar(t!.id))?.pararSolicitadoEm).not.toBeNull();
      expect((await m.repos.turnos.buscar(daConversa!.id))?.pararSolicitadoEm).toBeNull();
      // Uma sincronização enquanto o processo acaba não ressuscita o trabalho.
      await sincronizarTrabalho(m.deps, w.id);
      expect((await m.repos.trabalhos.buscar(w.id))?.estado).toBe("parado");
    });
  });

  // revisto em 2026-10-22 (NOD-311): o Parar do chat não toca as tasks; só o Parar global as para e devolve a lista.
  it("o Parar do chat deixa as tasks do bot; o Parar global as para e devolve a lista para a tela", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Uma", origem: "pessoa" })).trabalho;
      const b = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Outra", origem: "rotina" })).trabalho;
      const pendente = await m.turno(a.id);
      const doChat = await parar(m.deps, { conversaId: m.conversaId });
      expect(doChat.data.trabalhosParados).toBeUndefined();
      expect((await m.repos.trabalhos.buscar(a.id))?.estado).not.toBe("parado");
      expect((await m.repos.turnos.buscar(pendente!.id))?.estado).toBe("pendente");
      const r = await parar(m.deps, { conversaId: null });
      expect(r.data.trabalhosParados).toEqual(expect.arrayContaining([{ id: a.id, titulo: "Uma" }, { id: b.id, titulo: "Outra" }]));
      expect((await m.repos.trabalhos.buscar(a.id))?.estado).toBe("parado");
      expect((await m.repos.turnos.buscar(pendente!.id))?.estado).toBe("interrompido");
      expect((r.events ?? []).filter((e) => e.kind === "trabalho_mudou")).toHaveLength(2);
    });
  });

  // revisto em 2026-10-20 (NOD-309, PR 3): a task é trabalho de fundo — a queda a devolve à fila sozinha, sem "Retomar";
  // a conversa segue com o dela, e a queda da task não o fecha.
  it("S6: a máquina que cai numa task não fecha o \"Retomar\" da conversa; a task volta à fila sozinha (NOD-309)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const w = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Caiu", origem: "pessoa" })).trabalho;
      const daConversa = await m.turno(null);
      const daTask = await m.turno(w.id);
      const maquina = randomUUID();
      const agora = Date.now();
      await m.repos.turnos.reivindicar({ machineId: maquina, agora: agora - 200_000 });
      await m.repos.turnos.reivindicar({ machineId: maquina, agora: agora - 200_000 });
      const vencidos = await m.repos.turnos.vencidos(agora);
      const conversa = vencidos.find((t) => t.id === daConversa!.id)!;
      await interromperPorMaquina(m.deps, { turnos: [conversa] });
      const task = vencidos.find((t) => t.id === daTask!.id)!;
      const r = await interromperPorMaquina(m.deps, { turnos: [task] });
      const pendentes = (await m.repos.decisoes.pendentesDaConversa(m.conversaId)).filter((d) => d.tipo === "retomar_turno").map((d) => d.turnoId);
      expect(pendentes).toEqual([daConversa!.id]);
      expect(r.events.some((e) => e.kind === "turno_criado")).toBe(true);
      const voltas = await trx<{ estado: string; trabalho_id: string }[]>`select estado, trabalho_id from turnos where retoma_turno_id = ${daTask!.id}`;
      expect(voltas).toEqual([{ estado: "pendente", trabalho_id: w.id }]);
      expect((await m.repos.trabalhos.buscar(w.id))?.estado).not.toBe("precisa_de_voce");
    });
  });
});
