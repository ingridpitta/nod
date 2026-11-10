import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { ResultadoTurno, Turno } from "../../src/contracts/turno.ts";
import { ENTRADA_DO_RECOMECO_POR_AUTOCOMPACTACAO } from "../../src/domain/cota-da-ia.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { abrirFrentes } from "../../src/use-cases/frentes.ts";
import { contexto, depsSobre as depsL7 } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-480 (emenda da ADR-040): o turno que parou com "o histórico enche de novo logo depois de resumido"
 * (`autocompact_thrashing`) recomeça sozinho UMA vez numa sessão nova, sem --resume, com o resumo do que já saiu; só na
 * segunda falha a pessoa lê o aviso. Nada do que já saiu é reenviado: as falas ficam (parciais) e vão no histórico.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const TOKENS = { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 };
const pronto: Inventario = { estado: "pronto", versao: "2.1.309", em: Date.now() };
const sucesso = (sessaoCli: string): ResultadoTurno => ({ desfecho: "sucesso", texto: "feito", sessaoCli, sinais: SINAIS, custoUsd: 0.1, tokens: TOKENS, ferramentasChamadas: [], negacoesPermissao: [] });
/** O `result` do 2.1.309 quando o disjuntor do autocompact dispara (repro do #718: haiku, `--autocompact 100000`). */
const thrashing = (sessaoCli: string | null): ResultadoTurno => ({
  desfecho: "falha", motivoFalha: "erro_execucao", erroCru: "error_during_execution | api_error: autocompact_thrashing", texto: "", sessaoCli, custoUsd: 0.2, sinais: SINAIS,
  tokens: TOKENS, ferramentasChamadas: [], negacoesPermissao: [],
});
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function montarConversa(trx: Trx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Atlas" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const agora = () => Date.now();
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const maquina = randomUUID();
  const rodar = async (turno: Turno, resultado: ResultadoTurno, texto = "") => {
    expect((await base.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() }))?.id).toBe(turno.id);
    const plano = await emitirPlanoTurno(deps, { turnoId: turno.id, machineId: maquina, executor: "local", harnesses: { "claude-cli": pronto } });
    const r = await assentarTurno(deps, { turnoId: turno.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto }, resultado, executor: "local", harness: "claude-cli" });
    return { plano: plano.data, eventos: r.events ?? [] };
  };
  const enfileirar = () => base.repos.turnos.enfileirar({ executor: "local", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "levante os PRs abertos", entradaConfianca: "confiavel", modelo: "haiku", harness: "claude-cli" });
  const repeticoes = async () => (await base.repos.turnos.listarDaConversa(base.conversaId, 50)).filter((t) => t.estado === "pendente");
  const avisos = async () => (await base.repos.mensagens.listarDaConversa(base.conversaId, 200)).filter((m) => m.kind === "sistema" && /Turno interrompido/.test(m.texto ?? ""));
  return { ...base, deps, rodar, enfileirar, repeticoes, avisos };
}

describeIntegracao("NOD-480: o turno em autocompactação recomeça sozinho numa sessão nova", () => {
  it("conversa: larga a sessão, repete uma vez sem --resume com o aviso e o resumo; sem aviso de interrupção no chat", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montarConversa(trx);
      await m.rodar((await m.enfileirar())!, sucesso("sessao-cheia"), "primeira resposta");
      const t2 = (await m.enfileirar())!;
      const r2 = await m.rodar(t2, thrashing("sessao-cheia"), "Achei 3 PRs, vou ler o maior…");
      expect(r2.plano.entrada.sessaoCli).toBe("sessao-cheia");
      expect(r2.eventos.find((e) => e.kind === "turno_interrompido")?.dados).toMatchObject({ recomeca_sem_sessao: "autocompactacao", repete_sem_resume: true });
      expect((await m.repos.conversas.buscar(m.conversaId))?.sessaoCli).toBeNull();
      expect(await m.avisos()).toHaveLength(0);
      // A fala que já saiu fica (parcial) e não é apagada nem reenviada.
      const falas = (await m.repos.mensagens.listarDaConversa(m.conversaId, 200)).filter((x) => x.turnoId === t2.id && x.kind === "texto");
      expect(falas.map((f) => f.texto)).toEqual(["Achei 3 PRs, vou ler o maior…"]);
      expect(falas[0]?.parcial).toBe(true);

      const [rep] = await m.repeticoes();
      expect(rep).toMatchObject({ reenvios: 1, entradaTexto: "levante os PRs abertos", motivoRecomeco: "autocompactacao" });
      expect((await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }))?.id).toBe(rep!.id);
    });
  });

  it("a repetição vai sem sessão, com o aviso de recomeço; se encher de novo, aí sim o aviso (sem /nova-sessao)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montarConversa(trx);
      await m.rodar((await m.enfileirar())!, sucesso("sessao-cheia"));
      await m.rodar((await m.enfileirar())!, thrashing("sessao-cheia"));
      const [rep] = await m.repeticoes();
      const r = await m.rodar(rep!, thrashing("sessao-nova"));
      expect(r.plano.entrada.sessaoCli).toBeNull();
      expect(r.plano.entrada.texto).toContain("o histórico enchia de novo logo depois de resumido e o nod recomeçou numa sessão nova");
      expect(r.plano.entrada.texto.startsWith("levante os PRs abertos")).toBe(true);
      // Segunda falha: nada mais na fila e o aviso com a frase nova.
      expect(await m.repeticoes()).toHaveLength(0);
      const [aviso] = await m.avisos();
      expect(aviso?.texto).toContain("mesmo numa sessão nova");
      expect(aviso?.texto).not.toContain("/nova-sessao");
    });
  });

  // QA do PR #721: a retomada de conversa (a resposta a uma aprovação continua a sessão da conversa) também recomeça.
  it("retomada de conversa: larga a sessão da conversa e a da cadeia, repete UMA vez como retomada sem --resume; a 2ª falha avisa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montarConversa(trx);
      const t1 = (await m.enfileirar())!;
      await m.rodar(t1, sucesso("sessao-cheia"), "primeira resposta");
      const ret = (await m.repos.turnos.enfileirar({ executor: "local", conversaId: m.conversaId, agenteId: m.agenteId, origem: "retomada", retomaTurnoId: t1.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "aprovado, siga", entradaConfianca: "confiavel", modelo: "haiku", harness: "claude-cli" }))!;
      const r = await m.rodar(ret, thrashing("sessao-cheia"), "Lendo o PR maior…");
      expect(r.plano.entrada.sessaoCli).toBe("sessao-cheia");
      expect(r.eventos.find((e) => e.kind === "turno_interrompido")?.dados).toMatchObject({ recomeca_sem_sessao: "autocompactacao", repete_sem_resume: true });
      expect((await m.repos.conversas.buscar(m.conversaId))?.sessaoCli).toBeNull();
      expect(await m.repos.turnos.sessaoDoTurno(t1.id)).toBeNull();
      expect(await m.avisos()).toHaveLength(0);
      const falas = (await m.repos.mensagens.listarDaConversa(m.conversaId, 200)).filter((x) => x.turnoId === ret.id && x.kind === "texto");
      expect(falas.map((f) => [f.texto, f.parcial])).toEqual([["Lendo o PR maior…", true]]);

      const [rep] = await m.repeticoes();
      expect(rep).toMatchObject({ origem: "retomada", retomaTurnoId: ret.id, reenvios: 1, entradaTexto: "aprovado, siga", motivoRecomeco: "autocompactacao" });
      const r2 = await m.rodar(rep!, thrashing("sessao-nova"));
      expect(r2.plano.entrada.sessaoCli).toBeNull();
      expect(r2.plano.entrada.texto).toContain("o histórico enchia de novo logo depois de resumido e o nod recomeçou numa sessão nova");
      expect(await m.repeticoes()).toHaveLength(0);
      const [aviso] = await m.avisos();
      expect(aviso?.texto).toContain("mesmo numa sessão nova");
      expect(aviso?.texto).not.toContain("/nova-sessao");
    });
  });

  // QA do PR #721: o trabalho de fundo (rotina e pedido de colega) volta UMA vez na hora, numa sessão nova, com o pedido.
  for (const tipo of ["rotina", "pedido"] as const) {
    it(`${tipo}: larga a sessão do turno, volta à fila na hora com o pedido e a marca, sem --resume; a volta que enche de novo não repete`, async () => {
      await withRollback(MARLON, async (trx) => {
        const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
        await trx`update agentes set harness = 'claude-cli', modelo = 'haiku' where id = ${ada.agenteId}`;
        const { deps, repos } = depsL7(trx, MARLON);
        const agora = () => Date.now();
        const l5 = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
        let alvo: Turno;
        let pedido: string;
        if (tipo === "rotina") {
          const rotina = await repos.rotinas.criar({ agenteId: ada.agenteId, conversaId: ada.conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "Resumo do dia dos PRs", fonte: "github", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: Date.now() });
          const disparo = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: Date.now(), machineId: randomUUID(), executor: "catcher" });
          if (!("turno" in disparo.data)) throw new Error("rotina não disparou");
          await trx`update rotinas set proxima_execucao = ${new Date(Date.now() + 24 * 3_600_000)} where id = ${rotina!.id}`;
          alvo = disparo.data.turno;
          pedido = "Resumo do dia dos PRs";
        } else {
          pedido = "Levante os PRs abertos do repo nod";
          alvo = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "peer", prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: pedido, entradaConfianca: "confiavel", modelo: "haiku", harness: "claude-cli" }))!;
        }
        const cair = async (turno: Turno, sessao: string, texto = "") => {
          const machineId = randomUUID();
          expect((await repos.turnos.reivindicar({ machineId, agora: Math.max(Date.now(), (turno.acordarEm ?? 0) + 1) }))?.id).toBe(turno.id);
          const plano = await emitirPlanoTurno(l5, { turnoId: turno.id, machineId, executor: "local", harnesses: { "claude-cli": pronto } });
          const r = await assentarTurno(l5, { turnoId: turno.id, machineId, seqLocal: 1, fala: { tipo: "texto", texto }, resultado: thrashing(sessao), executor: "local", harness: "claude-cli", prontosDaPessoa: ["claude-cli"] });
          return { plano: plano.data, eventos: r.events ?? [] };
        };
        const volta = async () => (await repos.turnos.listarDaConversa(ada.conversaId, 500)).find((t) => t.origem === "retomada" && t.estado === "pendente") ?? null;
        const avisos = async () => (await repos.mensagens.listarDaConversa(ada.conversaId, 500)).filter((x) => x.kind === "sistema" && /Turno interrompido/.test(x.texto ?? ""));

        const r1 = await cair(alvo, `sessao-da-${tipo}`, "Achei 3 PRs…");
        expect(r1.eventos.find((e) => e.kind === "turno_interrompido")?.dados).toMatchObject({ recomeca_sem_sessao: "autocompactacao" });
        expect(await repos.turnos.sessaoDoTurno(alvo.id)).toBeNull();
        expect(await avisos()).toHaveLength(0);
        const falas = (await repos.mensagens.listarDaConversa(ada.conversaId, 500)).filter((x) => x.turnoId === alvo.id && x.kind === "texto");
        expect(falas.map((f) => [f.texto, f.parcial])).toEqual([["Achei 3 PRs…", true]]);
        const v = await volta();
        expect(v).toMatchObject({ retomaTurnoId: alvo.id, motivoRecomeco: "autocompactacao" });
        expect(v!.entradaTexto.startsWith(ENTRADA_DO_RECOMECO_POR_AUTOCOMPACTACAO)).toBe(true);
        expect(v!.entradaTexto).toContain(pedido);
        expect(v!.acordarEm).not.toBeNull();

        const r2 = await cair(v!, "sessao-nova");
        expect(r2.plano.entrada.sessaoCli).toBeNull();
        expect(await volta()).toBeNull();
        const [aviso] = await avisos();
        expect(aviso?.texto).toContain("mesmo numa sessão nova");
        expect(aviso?.texto).not.toContain("/nova-sessao");
      });
    });
  }

  it("a pessoa pediu para parar: não repete", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montarConversa(trx);
      const t = (await m.enfileirar())!;
      const maquina = randomUUID();
      await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
      await trx`update turnos set parar_solicitado_em = now() where id = ${t.id}`;
      await assentarTurno(m.deps, { turnoId: t.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: thrashing("s"), executor: "local", harness: "claude-cli" });
      expect(await m.repeticoes()).toHaveLength(0);
    });
  });

  it("frente: larga a sessão da task e volta à fila na hora, com o pedido e a marca; a volta que enche de novo não repete", async () => {
    await withRollback(MARLON, async (trx) => {
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      await trx`update agentes set harness = 'claude-cli', modelo = 'haiku' where id = ${ada.agenteId}`;
      const { deps, repos } = depsL7(trx, MARLON);
      const l5 = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
      const dono = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "conserte o login", entradaConfianca: "confiavel", modelo: "haiku", harness: "claude-cli" }))!;
      const r = await abrirFrentes(deps, { ...contexto(dono.agenteId, dono.conversaId, dono.id), frentes: [{ titulo: "Login no Safari", pedido: "Conserte o login no Safari." }], avisar_a_cada_uma: false });
      if (!r.data.ok) throw new Error(r.data.instrucao);
      await repos.turnos.assentar(dono.id, { estado: "concluido" });
      const trabalhoId = r.data.frentes[0]!.trabalho_id;
      const frente = (await repos.turnos.doTrabalho(trabalhoId))[0]!;
      const cair = async (turno: Turno, sessao: string) => {
        const machineId = randomUUID();
        expect((await repos.turnos.reivindicar({ machineId, agora: Math.max(Date.now(), (turno.acordarEm ?? 0) + 1) }))?.id).toBe(turno.id);
        const plano = await emitirPlanoTurno(l5, { turnoId: turno.id, machineId, executor: "local", harnesses: { "claude-cli": pronto } });
        await assentarTurno(l5, { turnoId: turno.id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: thrashing(sessao), executor: "local", harness: "claude-cli", prontosDaPessoa: ["claude-cli"] });
        return plano.data;
      };
      const volta = async () => (await repos.turnos.doTrabalho(trabalhoId)).find((t) => t.estado === "pendente") ?? null;

      await cair(frente, "sessao-da-frente");
      expect((await repos.trabalhos.buscar(trabalhoId))?.sessaoCli).toBeNull();
      const v = await volta();
      expect(v).not.toBeNull();
      expect(v!.entradaTexto.startsWith(ENTRADA_DO_RECOMECO_POR_AUTOCOMPACTACAO)).toBe(true);
      expect(v!.entradaTexto).toContain("Conserte o login no Safari.");
      expect(v!.motivoRecomeco).toBe("autocompactacao");
      expect(v!.acordarEm).not.toBeNull();
      expect(await repos.turnos.sessaoDoTurno(v!.retomaTurnoId!)).toBeNull();

      // QA do PR #721: a volta sai sem --resume e com a passagem de bastão (a sessão da task foi largada).
      const planoDaVolta = await cair(v!, "sessao-nova");
      expect(planoDaVolta.entrada.sessaoCli).toBeNull();
      expect(planoDaVolta.entrada.passagem).toEqual({ git: true });
      expect(await volta()).toBeNull();
    });
  });
});
