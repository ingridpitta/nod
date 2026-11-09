import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ResultadoTurno, Turno } from "../../src/contracts/turno.ts";
import { cotaDasIas, ENTRADA_DA_VOLTA_DA_COTA, portaoDaCota, RETORNO_DO_LOTE } from "../../src/domain/cota-da-ia.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { refazerRetornoDoLote } from "../../src/use-cases/fechar-lote.ts";
import { repetirBarradosPorIa } from "../../src/use-cases/repetir-barrados-por-ia.ts";
import { abrirFrentes, devolverResumo } from "../../src/use-cases/frentes.ts";
import { sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre as depsL5, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * QA do PR #340 (NOD-258, com NOD-269 B5): o retorno do lote é fundo — no limite ele espera a cota numa volta que
 * continua sendo retorno do lote (portão, lote apontando para ela, os resumos na entrada); se cair, é refeito uma vez na
 * IA atual do bot, e na segunda queda uma linha diz onde ficaram os resumos.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const HORA = 3_600_000;
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false };
const limite = (voltaEm: number): ResultadoTurno => ({
  desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: voltaEm, erroCru: "Claude AI usage limit reached", texto: "", sessaoCli: null, custoUsd: 0, sinais: SINAIS,
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
});
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function montar(trx: Trx) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  await trx`update agentes set harness = 'claude-cli', modelo = 'sonnet' where id = ${ada.agenteId}`;
  const { deps, repos } = depsSobre(trx, MARLON);
  const l5 = depsL5(repos, MARLON, { services: servicosDeTeste({}), trx });
  const dono = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "conserte o login", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
  const r = await abrirFrentes(deps, { ...contexto(dono.agenteId, dono.conversaId, dono.id), frentes: [{ titulo: "Login no Safari", pedido: "Conserte o login no Safari." }], avisar_a_cada_uma: false });
  if (!r.data.ok) throw new Error(r.data.instrucao);
  const loteId = r.data.lote_id;
  const frenteId = r.data.frentes[0]!.trabalho_id;
  await repos.turnos.assentar(dono.id, { estado: "concluido" });
  const t = (await repos.turnos.doTrabalho(frenteId))[0]!;
  await devolverResumo(deps, { ...contexto(t.agenteId, t.conversaId, t.id), feito: "Corrigi o login no Safari" });
  await repos.turnos.assentar(t.id, { estado: "concluido" });
  await sincronizarTrabalho(deps, frenteId);
  const [retorno] = (await repos.turnos.listarDaConversa(ada.conversaId, 500)).filter((x) => x.origem === "retomada" && x.retomaTurnoId === dono.id);
  if (!retorno) throw new Error("sem retorno do lote");
  /** O turno roda nesta máquina e bate no limite do Claude (o caminho do assentamento de verdade). */
  const bater = async (turno: Turno, voltaEm: number) => {
    const machineId = randomUUID();
    const pego = await repos.turnos.reivindicar({ machineId, agora: Math.max(Date.now(), (turno.acordarEm ?? 0) + 1) });
    expect(pego?.id).toBe(turno.id);
    return assentarTurno(l5, { turnoId: turno.id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: limite(voltaEm), executor: "local", harness: "claude-cli", prontosDaPessoa: ["claude-cli"] });
  };
  const voltasDe = async (t: Turno) => (await repos.turnos.listarDaConversa(ada.conversaId, 500)).filter((x) => x.origem === "retomada" && x.criadoEm >= t.criadoEm && x.id !== t.id && x.acordarEm !== null);
  const sistema = async () => (await repos.mensagens.listarDaConversa(ada.conversaId, 500)).filter((m) => m.kind === "sistema" && /cota|limite|volta/i.test(m.texto ?? "") && m.payload?.kind !== "frentes_terminadas");
  return { ada, deps, repos, l5, dono, loteId, frenteId, retorno, bater, voltasDe, sistema, trx };
}

describeIntegracao("NOD-258: o retorno do lote espera a cota e não se perde (QA do PR #340)", () => {
  it("critérios 1, 3 e 6: o retorno no limite vira volta com acordar_em, os resumos e a marca; o lote aponta para ela; duas batidas → uma linha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect(m.retorno.decididoPor).toBe(RETORNO_DO_LOTE);
      const voltaEm = Date.now() + 2 * HORA;
      const r = await m.bater(m.retorno, voltaEm);
      expect(r.data.esperaDaCota).toBe("espera");
      expect((await m.repos.turnos.buscar(m.retorno.id))?.estado).toBe("interrompido");
      const [volta, ...mais] = (await m.repos.turnos.listarDaConversa(m.ada.conversaId, 500)).filter((x) => x.retomaTurnoId === m.dono.id && x.id !== m.retorno.id);
      expect(mais).toHaveLength(0);
      expect(volta).toMatchObject({ estado: "pendente", origem: "retomada", acordarEm: voltaEm, decididoPor: RETORNO_DO_LOTE, reenvios: 0, trabalhoId: null });
      // A frente acorda com o pedido: a volta leva os resumos do lote (sem sessão retomável).
      expect(volta!.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA)).toBe(true);
      expect(volta!.entradaTexto).toContain("Corrigi o login no Safari");
      expect((await m.repos.frentes.buscarLote(m.loteId))?.retornoTurnoId).toBe(volta!.id);
      expect(await m.sistema()).toHaveLength(1);

      // Segunda batida na volta: outra volta, o lote segue o último, os resumos seguem, e nenhuma linha nova.
      const voltaEm2 = Date.now() + 4 * HORA;
      const r2 = await m.bater(volta!, voltaEm2);
      expect(r2.data.esperaDaCota).toBe("espera");
      const segunda = (await m.repos.turnos.listarDaConversa(m.ada.conversaId, 500)).find((x) => x.retomaTurnoId === m.dono.id && x.acordarEm === voltaEm2);
      expect(segunda).toMatchObject({ decididoPor: RETORNO_DO_LOTE, estado: "pendente" });
      expect(segunda!.entradaTexto).toContain("Corrigi o login no Safari");
      expect((await m.repos.frentes.buscarLote(m.loteId))?.retornoTurnoId).toBe(segunda!.id);
      expect(await m.sistema()).toHaveLength(1);
    });
  });

  it("critério 2: com o Claude no limite, o portão segura o retorno do lote (e a volta dele), como fundo; a conversa passa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.preferencias.registrarLimite("claude-cli", { renovaEm: Date.now() + HORA, desde: Date.now() });
      const cota = cotaDasIas({ usos: await m.repos.usoDoPlano.listar(), limites: (await m.repos.preferencias.buscar()).iasNoLimite, agora: Date.now() });
      const portao = portaoDaCota(cota, ["claude-cli"]);
      expect(await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now(), cota: portao })).toBeNull();
      // Sem o limite, o mesmo retorno sai.
      expect((await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }))?.id).toBe(m.retorno.id);
    });
  });

  it("critérios 4 e 5: a volta que cai é refeita UMA vez na IA atual do bot; na segunda queda, a linha diz onde ficaram os resumos", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.bater(m.retorno, Date.now() + 2 * HORA);
      const volta = (await m.repos.frentes.buscarLote(m.loteId))!.retornoTurnoId!;
      // O bot trocou de IA enquanto esperava.
      await trx`update agentes set harness = 'codex-cli', modelo = 'gpt-5' where id = ${m.ada.agenteId}`;
      await m.repos.turnos.assentar(volta, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel" });
      await refazerRetornoDoLote(m.l5, (await m.repos.turnos.buscar(volta))!);
      const copiaId = (await m.repos.frentes.buscarLote(m.loteId))!.retornoTurnoId!;
      expect(copiaId).not.toBe(volta);
      const copia = (await m.repos.turnos.buscar(copiaId))!;
      expect(copia).toMatchObject({ estado: "pendente", decididoPor: RETORNO_DO_LOTE, reenvios: 1, harness: "codex-cli", modelo: "gpt-5" });
      expect(copia.entradaTexto).toContain("Corrigi o login no Safari");
      // Ajuste do QA: a cópia leva a entrada do retorno de verdade, não o aviso "[nod] A cota do ..." da volta que caiu.
      expect(copia.entradaTexto).toBe(m.retorno.entradaTexto);
      expect(copia.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA)).toBe(false);

      await m.repos.turnos.assentar(copiaId, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel" });
      const antes = (await m.repos.turnos.listarDaConversa(m.ada.conversaId, 500)).length;
      const ev = await refazerRetornoDoLote(m.l5, (await m.repos.turnos.buscar(copiaId))!);
      expect(ev.map((e) => e.kind)).toEqual(["mensagem_criada"]);
      expect((await m.repos.turnos.listarDaConversa(m.ada.conversaId, 500)).length).toBe(antes);
      const caiu = (await m.repos.mensagens.listarDaConversa(m.ada.conversaId, 500)).filter((x) => x.texto?.includes("caiu duas vezes"));
      expect(caiu).toHaveLength(1);
      expect(caiu[0]!.texto).toContain("Login no Safari");
    });
  });

  it("critério 4 (bordas, revisto em 2026-10-20 — NOD-309, PR 3): a queda da máquina e o reinício refazem o retorno; o Parar não; o concluído marca o lote entregue", async () => {
    for (const motivo of ["maquina_sem_contato", "reinicio_servidor"] as const) {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        await m.repos.turnos.assentar(m.retorno.id, { estado: "interrompido", motivoInterrupcao: motivo });
        const evs = await refazerRetornoDoLote(m.l5, (await m.repos.turnos.buscar(m.retorno.id))!);
        expect(evs.map((e) => e.kind)).toEqual(["turno_criado"]);
        const lote = await m.repos.frentes.buscarLote(m.loteId);
        expect(lote?.retornoTurnoId).not.toBe(m.retorno.id);
        expect((await m.repos.turnos.buscar(lote!.retornoTurnoId!))).toMatchObject({ estado: "pendente", origem: "retomada" });
      });
    }
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const total = async () => (await m.repos.turnos.listarDaConversa(m.ada.conversaId, 500)).length;
      const antes = await total();
      await m.repos.turnos.assentar(m.retorno.id, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel" });
      await trx`update turnos set parar_solicitado_em = now() where id = ${m.retorno.id}`;
      expect(await refazerRetornoDoLote(m.l5, (await m.repos.turnos.buscar(m.retorno.id))!)).toEqual([]);
      await trx`update turnos set estado = 'concluido', parar_solicitado_em = null where id = ${m.retorno.id}`;
      expect(await refazerRetornoDoLote(m.l5, (await m.repos.turnos.buscar(m.retorno.id))!)).toEqual([]);
      expect(await total()).toBe(antes);
      const lote = await m.repos.frentes.buscarLote(m.loteId);
      expect(lote?.retornoTurnoId).toBe(m.retorno.id);
      expect(lote?.retornoConcluidoEm).not.toBeNull();
      // Entregue, uma queda tardia do mesmo turno não refaz nada.
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'reinicio_servidor' where id = ${m.retorno.id}`;
      expect(await refazerRetornoDoLote(m.l5, (await m.repos.turnos.buscar(m.retorno.id))!)).toEqual([]);
    });
  });
});

describeIntegracao("NOD-269 B5: a repetição dos barrados por IA deixa de fora a recusa por conta e o limite (QA do PR #340)", () => {
  it("'sem_conta' e 'limite_do_plano' não voltam; a falta de IA sem motivo de conta volta", async () => {
    await withRollback(MARLON, async (trx) => {
      const base = await agenteComConversa(trx, MARLON, { nome: "Ze" });
      const outra = await agenteComConversa(trx, MARLON, { nome: "Zu" });
      const terceira = await agenteComConversa(trx, MARLON, { nome: "Zo" });
      const { repos } = depsSobre(trx, MARLON);
      const barrar = async (conversaId: string, agenteId: string, motivoFalha: "sem_conta" | "limite_do_plano" | null) => {
        const t = (await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
        await repos.turnos.assentar(t.id, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel", ...(motivoFalha ? { motivoFalha } : {}) });
        return t.id;
      };
      const semConta = await barrar(base.conversaId, base.agenteId, "sem_conta");
      const noLimite = await barrar(outra.conversaId, outra.agenteId, "limite_do_plano");
      const semIa = await barrar(terceira.conversaId, terceira.agenteId, null);
      // Critério 3 (QA do #385): a frente (conversa + trabalho_id) barrada só por falta de IA também fica de fora — ela
      // espera pelo caminho da task; repetida, viraria fala solta na conversa.
      const { frenteId } = await montar(trx);
      const quarta = await agenteComConversa(trx, MARLON, { nome: "Zi" });
      const frente = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: quarta.conversaId, agenteId: quarta.agenteId, origem: "conversa", trabalhoId: frenteId, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "Frente: revisar", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
      await repos.turnos.assentar(frente.id, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel" });
      const ids = (await repos.turnos.barradosPorFaltaDeIa(Date.now() - HORA)).map((t) => t.id);
      expect(ids).toContain(semIa);
      expect(ids).not.toContain(semConta);
      expect(ids).not.toContain(noLimite);
      expect(ids).not.toContain(frente.id);
    });
  });

  it("C4: reconectar duas vezes (a IA anunciada pronta) não cria turno nem nota para a recusa por conta e o limite; a falta de IA volta uma vez", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const l5 = depsL5(repos, MARLON, { services: servicosDeTeste({}), trx });
      const barrar = async (nome: string, motivoFalha: "sem_conta" | "limite_do_plano" | null) => {
        const a = await agenteComConversa(trx, MARLON, { nome });
        const t = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: a.conversaId, agenteId: a.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
        await repos.turnos.assentar(t.id, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel", ...(motivoFalha ? { motivoFalha } : {}) });
        return a.conversaId;
      };
      const conversas = { semConta: await barrar("Ze", "sem_conta"), noLimite: await barrar("Zu", "limite_do_plano"), semIa: await barrar("Zo", null) };
      const contar = async (conversaId: string) => ({
        turnos: (await repos.turnos.listarDaConversa(conversaId, 500)).length,
        notas: (await repos.mensagens.listarDaConversa(conversaId, 500)).length,
      });
      const antes = { semConta: await contar(conversas.semConta), noLimite: await contar(conversas.noLimite), semIa: await contar(conversas.semIa) };
      for (let i = 0; i < 2; i++) await repetirBarradosPorIa(l5, { executor: "local", prontos: ["claude-cli"] });
      expect(await contar(conversas.semConta)).toEqual(antes.semConta);
      expect(await contar(conversas.noLimite)).toEqual(antes.noLimite);
      // O controle: a fala barrada só por falta de IA é repetida — uma vez, nas duas conexões.
      expect((await contar(conversas.semIa)).turnos).toBe(antes.semIa.turnos + 1);
    });
  });
});
