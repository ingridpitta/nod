import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { ESPERA_SEM_CONTATO_MS, ESPERA_SEM_INICIO_MS } from "../../src/domain/espera-comando.ts";
import { NATIVAS_DO_TERMINAL } from "../../src/domain/nativas.ts";
import type { Tx } from "../../src/shared/types.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { esperarComando, relatarEspera, varrerEsperasSemNoticia } from "../../src/use-cases/esperar-comando.ts";
import { meChameAs } from "../../src/use-cases/me-chame-as.ts";
import { mudarModoAprovacao } from "../../src/use-cases/mudar-modo-aprovacao.ts";
import { parar } from "../../src/use-cases/parar.ts";
import { criarTrabalho, listarTrabalhos, pararTrabalho } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-099 item 4 (parte 2, definido em 2026-10-12): `esperar_comando`. O bot pede, o pedido é gravado e o turno encerra;
 * a máquina do turno puxa a espera, roda o comando e relata o fim; o fim acorda o turno de origem uma vez, pelo caminho da
 * volta marcada (ADR-086). Enquanto o comando roda, a task fica `rodando` sem processo. Parar cancela; máquina sumida ou
 * relançada 3 vezes derruba a espera e acorda o dono com o motivo.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const SUCESSO = { desfecho: "sucesso" as const, texto: "vou esperar a CI", sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
const CI = "gh pr checks 845 --watch -R gamefik/app";

function planoDe(p: { turnoId: string; agenteId: string; conversaId: string }, extra: Partial<PlanoTurno> = {}): PlanoTurno {
  return {
    tenantId: TENANT_PADRAO, ...p, localidade: "local", machineId: "m", executor: "local", superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas", autoria: autoriaPessoa(PESSOA_MARLON), confiancaEntrada: "confiavel", profundidade: 0,
    catalogo: { ferramentas: [], servidores: [] }, promptSistema: "", entrada: { texto: "", sessaoCli: null, modelo: "m" },
    politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 8000 }, semprePermitir: [], tokenDeTurno: "tok",
    expiraEm: Date.now() + 60_000, nativas: [...NATIVAS_DO_TERMINAL], pastaDoBot: "Ada/acompanhar-ci", ...extra,
  };
}

async function montar(trx: Tx, o: { semTrabalho?: boolean } = {}) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const trabalho = o.semTrabalho ? null : (await criarTrabalho(deps, { agenteId: base.agenteId, conversaId: base.conversaId, titulo: "Acompanhar a CI do PR", origem: "pessoa" })).trabalho;
  const enfileirado = await repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: trabalho?.id ?? null });
  if (!enfileirado) throw new Error("turno");
  const machineId = randomUUID();
  const turno = await repos.turnos.reivindicar({ machineId, agora: Date.now() });
  if (turno?.id !== enfileirado.id) throw new Error("reivindicar");
  const plano = planoDe({ turnoId: turno.id, agenteId: base.agenteId, conversaId: base.conversaId });
  const ctx = { turnoId: turno.id, agenteId: base.agenteId, conversaId: base.conversaId, plano };
  const assentar = () => assentarTurno(deps, { turnoId: turno.id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "vou esperar a CI" }, resultado: SUCESSO, executor: "catcher" });
  const voltas = async () => (await repos.turnos.listarDaConversa(base.conversaId, 50)).filter((t) => t.origem === "retomada");
  const pedir = async (comando = CI, motivo = "a CI do PR #845") => {
    const r = await esperarComando(deps, { ...ctx, comando, motivo });
    if (!r.data.ok) throw new Error(`recusou: ${r.data.erro}`);
    return r.data.espera_id;
  };
  const relatar = (relato: Parameters<typeof relatarEspera>[1]["relato"], maquinaId = machineId) => relatarEspera(deps, { maquinaId, relato });
  return { ...base, deps, repos, trabalho, turno, machineId, plano, ctx, assentar, voltas, pedir, relatar };
}

describeIntegracao("esperar_comando (ADR-099, parte 2)", () => {
  it("grava e manda encerrar; a task fica rodando sem processo; o fim acorda uma vez, na mesma task, com código e últimas linhas", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await esperarComando(m.deps, { ...m.ctx, comando: CI, motivo: "a CI do PR #845" });
      if (!r.data.ok) throw new Error("recusou");
      expect(r.data.instrucao).toContain("encerre o turno");
      const espera = await m.repos.esperas.buscar(r.data.espera_id);
      expect(espera).toMatchObject({ estado: "rodando", maquinaId: m.machineId, pasta: "Ada/acompanhar-ci", comando: CI, motivo: "a CI do PR #845", trabalhoId: m.trabalho!.id, turnoId: m.turno.id });

      await m.assentar();
      expect(await m.voltas()).toEqual([]);
      expect((await m.repos.trabalhos.buscar(m.trabalho!.id))?.estado).toBe("rodando");
      const dto = (await listarTrabalhos(m.deps, {})).data.trabalhos.find((t) => t.id === m.trabalho!.id);
      expect(dto).toMatchObject({ estado: "rodando", turnoVivoId: null, esperandoComando: { motivo: "a CI do PR #845" } });

      // Só a máquina do turno recebe a espera; ler é a notícia dela.
      expect(await m.repos.esperas.paraAMaquina(randomUUID(), Date.now())).toEqual([]);
      expect(await m.repos.esperas.paraAMaquina(m.machineId, Date.now())).toEqual([{ id: espera!.id, comando: CI, pasta: "Ada/acompanhar-ci", iniciada: false }]);
      expect((await m.relatar({ id: espera!.id, tipo: "iniciou" })).data).toEqual({ seguir: true });
      // Outra máquina não relata por esta.
      expect((await m.relatar({ id: espera!.id, tipo: "terminou", codigo: 0, saida: "x" }, randomUUID())).data).toEqual({ seguir: false });
      expect((await m.repos.esperas.buscar(espera!.id))?.estado).toBe("rodando");

      const saida = `${"linha velha\n".repeat(800)}build  pass  4m\nAll checks were successful\n`;
      const fim = await m.relatar({ id: espera!.id, tipo: "terminou", codigo: 0, saida });
      expect(fim.data).toEqual({ seguir: false });
      const terminada = await m.repos.esperas.buscar(espera!.id);
      expect(terminada).toMatchObject({ estado: "terminou", codigoSaida: 0 });
      expect(terminada!.saida!.length).toBeLessThanOrEqual(4096);
      expect(terminada!.saida).toContain("All checks were successful");
      expect(terminada!.acordouEm).not.toBeNull();

      const [volta] = await m.voltas();
      expect(volta).toMatchObject({ retomaTurnoId: m.turno.id, trabalhoId: m.trabalho!.id, estado: "pendente", modelo: "sonnet", harness: "claude-cli" });
      expect(volta!.acordarEm).not.toBeNull();
      expect(volta!.entradaTexto).toContain("terminou (código 0): a CI do PR #845");
      expect(volta!.entradaTexto).toContain("All checks were successful");
      expect(fim.events.some((e) => e.kind === "turno_criado")).toBe(true);
      expect((await m.repos.turnos.reivindicar({ machineId: m.machineId, agora: Date.now() + 1 }))?.id).toBe(volta!.id);

      // O relato repetido (a resposta se perdeu) não acorda de novo.
      await m.relatar({ id: espera!.id, tipo: "terminou", codigo: 0, saida });
      expect(await m.voltas()).toHaveLength(1);
    });
  });

  it("o comando acaba antes de o turno terminar: a volta nasce no assentamento", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, { semTrabalho: true });
      const id = await m.pedir("gh run watch 123 -R gamefik/app", "o deploy de produção");
      await m.relatar({ id, tipo: "iniciou" });
      await m.relatar({ id, tipo: "terminou", codigo: 1, saida: "X deploy failed" });
      expect(await m.voltas()).toEqual([]);
      expect((await m.repos.esperas.buscar(id))?.acordouEm).toBeNull();
      await m.assentar();
      const [volta] = await m.voltas();
      expect(volta?.entradaTexto).toContain("(código 1): o deploy de produção");
      expect(volta?.entradaTexto).toContain("X deploy failed");
    });
  });

  it("recusas: laço com sleep, script, sem terminal, um por turno, me_chame_as no mesmo turno e comando que pediria aprovação", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const pedir = (comando: string, extra: Partial<PlanoTurno> = {}) => esperarComando(m.deps, { ...m.ctx, plano: { ...m.plano, ...extra }, comando, motivo: "a CI" });
      expect((await pedir("while true; do gh pr checks 845; sleep 30; done")).data).toMatchObject({ ok: false, erro: "comando_invalido" });
      expect((await pedir("gh pr checks 845\ngh pr view 845")).data).toMatchObject({ ok: false, erro: "comando_invalido" });
      expect((await pedir(CI, { nativas: [] })).data).toMatchObject({ ok: false, erro: "sem_terminal" });
      // O manual pede card para o que muda algo; o esperar não abre card.
      expect((await pedir("git push origin main")).data).toMatchObject({ ok: false, erro: "precisa_aprovacao" });
      expect(await m.repos.decisoes.doTurno(m.turno.id)).toEqual([]);
      expect((await pedir(CI)).data).toMatchObject({ ok: true });
      expect((await pedir("gh run watch 9 -R gamefik/app")).data).toMatchObject({ ok: false, erro: "ja_esperando" });
      expect((await meChameAs(m.deps, { ...m.ctx, em_minutos: 10, motivo: "ver a CI" })).data).toMatchObject({ ok: false, erro: "ja_esperando" });
    });
  });

  it("no automático, o comando comum passa; me_chame_as antes no mesmo turno recusa a espera", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await meChameAs(m.deps, { ...m.ctx, em_minutos: 10, motivo: "ver a CI" });
      expect((await esperarComando(m.deps, { ...m.ctx, comando: CI, motivo: "a CI" })).data).toMatchObject({ ok: false, erro: "ja_esperando" });

      const n = await montar(trx);
      await mudarModoAprovacao(n.deps, { agenteId: n.agenteId, modo: "automatico" });
      expect((await esperarComando(n.deps, { ...n.ctx, comando: "kubectl rollout status deploy/app", motivo: "o rollout" })).data).toMatchObject({ ok: true });
    });
  });

  it("revisão do PR 6: no total, a espera vai para a Atividade só quando é criada — a segunda do turno (ja_esperando) não deixa linha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await mudarModoAprovacao(m.deps, { agenteId: m.agenteId, modo: "total", confirmado: true });
      expect((await esperarComando(m.deps, { ...m.ctx, comando: "kubectl rollout status deploy/app", motivo: "o rollout" })).data).toMatchObject({ ok: true });
      expect((await esperarComando(m.deps, { ...m.ctx, comando: "kubectl rollout status deploy/api", motivo: "o outro" })).data).toMatchObject({ ok: false, erro: "ja_esperando" });
      expect((await m.repos.acoesPeloModo.doTurno(m.turno.id)).map((a) => a.resumo)).toEqual(["kubectl rollout status deploy/app"]);
    });
  });

  it("Parar a task cancela a espera: a máquina não a recebe mais, e o fim tardio não acorda", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const id = await m.pedir();
      await m.assentar();
      await pararTrabalho(m.deps, { trabalhoId: m.trabalho!.id });
      expect(await m.repos.esperas.buscar(id)).toMatchObject({ estado: "cancelada", motivoFim: "parada pela pessoa" });
      expect(await m.repos.esperas.paraAMaquina(m.machineId, Date.now())).toEqual([]);
      expect((await m.relatar({ id, tipo: "terminou", codigo: 0, saida: "ok" })).data).toEqual({ seguir: false });
      expect(await m.voltas()).toEqual([]);
      expect((await m.repos.trabalhos.buscar(m.trabalho!.id))?.estado).toBe("parado");
    });
  });

  it("Parar a conversa cancela as esperas do bot dela", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, { semTrabalho: true });
      const id = await m.pedir();
      await m.assentar();
      await parar(m.deps, { conversaId: m.conversaId });
      expect((await m.repos.esperas.buscar(id))?.estado).toBe("cancelada");
    });
  });

  it("o turno que pediu foi parado no meio: a espera é cancelada no assentamento", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const id = await m.pedir();
      await m.repos.turnos.pedirInterrupcao([m.turno.id], Date.now());
      await m.assentar();
      expect((await m.repos.esperas.buscar(id))?.estado).toBe("cancelada");
      expect(await m.voltas()).toEqual([]);
    });
  });

  it("a máquina some: sem começar em 3 min, ou sem notícia por 30 min, a espera cai e acorda o dono com o motivo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const id = await m.pedir();
      await m.assentar();
      expect((await varrerEsperasSemNoticia(m.deps)).caidas).toEqual([]);
      const depois = { ...m.deps, agora: () => Date.now() + ESPERA_SEM_INICIO_MS + 1_000 };
      expect((await varrerEsperasSemNoticia(depois)).caidas).toEqual([id]);
      expect(await m.repos.esperas.buscar(id)).toMatchObject({ estado: "caiu" });
      const [volta] = await m.voltas();
      expect(volta?.entradaTexto).toContain("A espera caiu: a máquina deste trabalho não começou o comando");

      const n = await montar(trx, { semTrabalho: true });
      const outra = await n.pedir();
      await n.assentar();
      await n.repos.esperas.paraAMaquina(n.machineId, Date.now());
      expect((await varrerEsperasSemNoticia(depois)).caidas).toEqual([]);
      expect((await varrerEsperasSemNoticia({ ...n.deps, agora: () => Date.now() + ESPERA_SEM_CONTATO_MS + 1_000 })).caidas).toEqual([outra]);
      expect((await n.voltas())[0]?.entradaTexto).toContain("mais de 30 min sem dar notícia");
    });
  });

  it("a máquina relança o comando (reiniciou): cada relançamento é uma queda; na 3ª a espera cai e o bot é acordado para perguntar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const id = await m.pedir();
      await m.assentar();
      expect((await m.relatar({ id, tipo: "iniciou" })).data).toEqual({ seguir: true });
      expect((await m.repos.esperas.paraAMaquina(m.machineId, Date.now()))[0]?.iniciada).toBe(true);
      expect((await m.relatar({ id, tipo: "iniciou" })).data).toEqual({ seguir: true });
      expect((await m.relatar({ id, tipo: "iniciou" })).data).toEqual({ seguir: true });
      expect((await m.repos.esperas.buscar(id))?.quedas).toBe(2);
      expect((await m.relatar({ id, tipo: "iniciou" })).data).toEqual({ seguir: false });
      expect(await m.repos.esperas.buscar(id)).toMatchObject({ estado: "caiu", quedas: 3 });
      const [volta] = await m.voltas();
      expect(volta?.entradaTexto).toContain("A espera caiu 3 vezes");
      expect(volta?.entradaTexto).toContain("pergunte como seguir");
    });
  });

  it("ADR-099 §5 (parte 1): três voltas de espera seguidas que só esperam de novo — a quarta vira pergunta à pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      let turnoId = m.turno.id;
      const ciclo = async () => {
        const plano = { ...m.plano, turnoId };
        const r = await esperarComando(m.deps, { ...m.ctx, turnoId, plano, comando: CI, motivo: "a CI do PR #845" });
        if (!r.data.ok) throw new Error(`recusou: ${r.data.erro}`);
        await assentarTurno(m.deps, { turnoId, machineId: m.machineId, seqLocal: 1, fala: { tipo: "texto", texto: "a CI ainda roda" }, resultado: SUCESSO, executor: "catcher" });
        await m.relatar({ id: r.data.espera_id, tipo: "iniciou" });
        return m.relatar({ id: r.data.espera_id, tipo: "terminou", codigo: 8, saida: "checks pending" });
      };
      for (let i = 0; i < 3; i++) {
        await ciclo();
        const volta = await m.repos.turnos.reivindicar({ machineId: m.machineId, agora: Date.now() + 1 });
        expect(volta?.retomaTurnoId, `volta ${i + 1}`).toBe(m.turno.id);
        turnoId = volta!.id;
      }
      const quarta = await ciclo();
      expect(quarta.events.some((e) => e.kind === "decisao_criada")).toBe(true);
      expect((await m.voltas()).filter((t) => t.estado === "pendente")).toEqual([]);
      const [pergunta] = await m.repos.decisoes.doTurno(turnoId);
      expect(pergunta).toMatchObject({ tipo: "pergunta", frase: "Voltei 3 vezes para conferir e nada mudou: a CI do PR #845. Sigo esperando ou paro por aqui?" });
    });
  });

  it("a pasta do turno não existe na máquina: a espera cai na hora e acorda", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const id = await m.pedir();
      await m.assentar();
      expect((await m.relatar({ id, tipo: "caiu", motivo: "pasta_ausente" })).data).toEqual({ seguir: false });
      expect((await m.voltas())[0]?.entradaTexto).toContain("a pasta deste trabalho não existe mais");
    });
  });
});
