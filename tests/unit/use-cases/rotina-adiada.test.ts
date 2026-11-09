import { describe, expect, it } from "vitest";
import { tipoParaCota } from "../../../src/domain/cota-da-ia.ts";
import { ADIADAS_PARA_AVISAR, dispararRotina, execucaoVenceu, textoAvisoAdiada } from "../../../src/use-cases/disparar-rotina.ts";
import { executarRotinaAgora } from "../../../src/use-cases/executar-rotina-agora.ts";
import { listarRotinas } from "../../../src/use-cases/listar-rotinas.ts";
import { pausarRotina, textoPausada } from "../../../src/use-cases/pausar-rotina.ts";
import { depsMemoria } from "../../helpers/deps-l7.ts";

/** NOD-243 (janela adiada, execução vencida, frente parada), NOD-271 (janela já usada reagenda) e NOD-272 (pausar corta a fila, "Testar agora" pergunta). */
const TZ = "America/Sao_Paulo";
const JANELA = Date.parse("2026-09-17T08:00:00-03:00"); // quinta
const SEXTA = Date.parse("2026-09-18T08:00:00-03:00");
const SEGUNDA = Date.parse("2026-09-21T08:00:00-03:00");
const TERCA = Date.parse("2026-09-22T08:00:00-03:00");
const QUARTA = Date.parse("2026-09-23T08:00:00-03:00");
const H = 3_600_000;

function relogio(inicio: number) {
  let t = inicio;
  return { agora: () => t, ir: (n: number) => { t = n; } };
}

async function rotinaAtiva(d: ReturnType<typeof depsMemoria>, cron = "0 8 * * 1-5") {
  const agente = await d.deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
  const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const rotina = await d.deps.repos.rotinas.criar({ agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", cron, fusoIana: TZ, instrucao: "poste o resumo", fonte: "PRs abertos", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "diga que não houve", proximaExecucao: JANELA });
  if (!rotina) throw new Error("rotina não criada");
  return rotina;
}

const disparo = (d: ReturnType<typeof depsMemoria>, rotina: Awaited<ReturnType<typeof rotinaAtiva>>, instanteAgendado: number) =>
  dispararRotina(d.deps, { rotina, instanteAgendado, machineId: "m1", executor: "catcher" });

describe("execucaoVenceu (NOD-243)", () => {
  const rotina = { cron: "0 8 * * 1-5", fusoIana: TZ };
  const aberto = { turnoId: "t", instanteAgendado: JANELA, estado: "pendente", attempted: false, acordarEm: null, criadoEm: JANELA, trabalhoId: null };
  it("pendente, nunca pego, sem volta: vence depois de um período do cron (mín. 30 min)", () => {
    expect(execucaoVenceu(aberto, rotina, SEXTA - 1)).toBe(false);
    expect(execucaoVenceu(aberto, rotina, SEXTA)).toBe(true);
    // cron de minuto: o piso de 30 min vale.
    expect(execucaoVenceu(aberto, { cron: "* * * * *", fusoIana: TZ }, JANELA + 29 * 60_000)).toBe(false);
    expect(execucaoVenceu(aberto, { cron: "* * * * *", fusoIana: TZ }, JANELA + 30 * 60_000)).toBe(true);
  });
  it("o que já começou, voltou à fila ou marcou volta nunca vence", () => {
    expect(execucaoVenceu({ ...aberto, estado: "despachando" }, rotina, SEXTA + H)).toBe(false);
    expect(execucaoVenceu({ ...aberto, attempted: true }, rotina, SEXTA + H)).toBe(false);
    expect(execucaoVenceu({ ...aberto, acordarEm: SEXTA }, rotina, SEXTA + H)).toBe(false);
  });
});

describe("rotina adiada (NOD-243)", () => {
  // revisto em 2026-10-20 (NOD-309, PR 4): o pendente que a máquina não puxou não fecha calado como 'interrompida ·
  // vencida' — a janela fica 'nao_rodou · maquina_sem_contato', com UMA linha "Não rodou · …" na conversa da rotina.
  it("CA: a execução que venceu na fila (a máquina não puxou) fica 'não rodou · máquina sem contato' e a janela nova roda", async () => {
    const r = relogio(JANELA + 30_000);
    const d = depsMemoria({ agora: r.agora });
    const rotina = await rotinaAtiva(d);
    const primeira = await disparo(d, rotina, JANELA);
    if (!("turno" in primeira.data)) throw new Error("deveria ter disparado");
    const t1 = primeira.data.turno;
    r.ir(SEXTA + 30_000);
    const segunda = await disparo(d, rotina, SEXTA);
    expect("turno" in segunda.data).toBe(true);
    expect(d.banco.turnos.find((t) => t.id === t1.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "vencido" });
    const execs = await d.deps.repos.rotinaExecucoes.listar(rotina.id);
    expect(execs.find((e) => e.turnoId === t1.id)).toMatchObject({ desfecho: "nao_rodou", motivo: "maquina_sem_contato", voltaEm: null });
    expect((segunda.events ?? []).map((e) => e.kind)).toContain("turno_interrompido");
    const linhas = d.banco.mensagens.filter((m) => m.conversaId === rotina.conversaId && m.texto.startsWith("Não rodou · "));
    expect(linhas.map((m) => m.texto)).toEqual([expect.stringContaining("Não rodou · o computador do bot ficou sem contato, volta na próxima execução da agenda.")]);
  });

  it("CA: a frente da rotina sem nada vivo há mais de 24 h é parada e deixa de segurar", async () => {
    const r = relogio(JANELA + 30_000);
    const d = depsMemoria({ agora: r.agora });
    const rotina = await rotinaAtiva(d);
    const primeira = await disparo(d, rotina, JANELA);
    if (!("turno" in primeira.data)) throw new Error("deveria ter disparado");
    const t1 = primeira.data.turno;
    const frente = await d.deps.repos.trabalhos.criar({ agenteId: rotina.agenteId, conversaId: rotina.conversaId, titulo: "Responder o chamado 42", origem: "rotina", rotinaId: rotina.id, forma: "frente" });
    await d.deps.repos.turnos.assentar(t1.id, { estado: "concluido" });
    const linha = d.banco.trabalhos.find((t) => t.id === frente!.id)!;
    // Ainda dentro de 24 h: segura.
    linha.criadoEm = SEXTA - 2 * H;
    r.ir(SEXTA + 30_000);
    expect((await disparo(d, rotina, SEXTA)).data).toMatchObject({ adiada: "frente_aberta", trabalhoAbertoId: frente!.id });
    // Mais de 24 h sem nada vivo: parada, e a janela roda.
    linha.criadoEm = SEGUNDA - 25 * H;
    r.ir(SEGUNDA + 30_000);
    expect("turno" in (await disparo(d, rotina, SEGUNDA)).data).toBe(true);
    expect(d.banco.trabalhos.find((t) => t.id === frente!.id)?.estado).toBe("parado");
  });

  it(`CA: na ${ADIADAS_PARA_AVISAR}ª adiada seguida, UM aviso na conversa; a 4ª não repete`, async () => {
    const r0 = relogio(JANELA + 30_000);
    const d = depsMemoria({ agora: r0.agora });
    const rotina = await rotinaAtiva(d);
    expect("turno" in (await disparo(d, rotina, JANELA)).data).toBe(true);
    const avisos = () => d.banco.mensagens.filter((m) => m.kind === "sistema" && m.texto.includes("não rodou nas últimas"));
    for (const [i, instante] of [SEXTA, SEGUNDA, TERCA, QUARTA].entries()) {
      r0.ir(JANELA + 30_000 + (i + 1) * 1_000); // o registro anda (a ordem do histórico é por `em`), sem vencer a primeira
      const r = await disparo(d, rotina, instante);
      expect(r.data).toMatchObject({ adiada: "execucao_anterior_aberta" });
      expect(avisos()).toHaveLength(i + 1 >= ADIADAS_PARA_AVISAR ? 1 : 0);
    }
    expect(avisos()[0]?.texto).toBe(textoAvisoAdiada({ motivo: "execucao_anterior_aberta" }));
    // A lista diz por que está esperando.
    const dto = (await listarRotinas(d.deps, {})).data.rotinas.find((x) => x.rotina.id === rotina.id);
    expect(dto?.espera).toEqual({ motivo: "execucao_anterior_aberta", seguidas: 4, desde: SEXTA, frente: null });
  });

  it("CA: o \"Testar agora\" nunca é adiado (a pessoa está esperando) e o turno vai como conversa para a cota", async () => {
    const r = relogio(JANELA + 30_000);
    const d = depsMemoria({ agora: r.agora });
    const rotina = await rotinaAtiva(d);
    await disparo(d, rotina, JANELA);
    r.ir(JANELA + 5 * 60_000);
    const agoraMesmo = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA + 5 * 60_000, machineId: "m1", executor: "catcher", preservarAgenda: true });
    if (!("turno" in agoraMesmo.data)) throw new Error("deveria ter disparado");
    expect(agoraMesmo.data.turno.pessoaEsperando).toBe(true);
    expect(tipoParaCota(agoraMesmo.data.turno, null)).toBe("conversa");
    expect(tipoParaCota({ origem: "rotina" }, null)).toBe("fundo_novo");
  });
});

describe("aviso da adiada (revisão do Gil no #335, A2)", () => {
  it("diz por que, com \"terminar\" como a lista", () => {
    expect(textoAvisoAdiada({ motivo: "execucao_anterior_aberta" })).toBe(`Esta rotina não rodou nas últimas ${ADIADAS_PARA_AVISAR} janelas porque a execução anterior ainda não terminou. Ela volta a rodar sozinha quando essa execução terminar.`);
    expect(textoAvisoAdiada({ motivo: "frente_aberta", titulo: "Revisar PRs" })).toBe(`Esta rotina não rodou nas últimas ${ADIADAS_PARA_AVISAR} janelas porque a frente “Revisar PRs” ainda não terminou. Ela volta a rodar sozinha quando a frente terminar.`);
    expect(textoAvisoAdiada({ motivo: "frente_aberta" })).toContain("porque uma frente desta rotina ainda não terminou.");
  });
});

describe("janela já usada (NOD-271)", () => {
  it("a agenda parada no passado anda — a rotina não fica vencida para sempre", async () => {
    const d = depsMemoria({ agora: () => JANELA + 30_000 });
    const rotina = await rotinaAtiva(d);
    expect("turno" in (await disparo(d, rotina, JANELA)).data).toBe(true);
    await d.deps.repos.rotinas.reagendar(rotina.id, JANELA); // como se o reagendar tivesse se perdido
    const r = await disparo(d, rotina, JANELA);
    expect(r.data).toEqual({ janelaDeOutro: true, proximaExecucao: SEXTA });
    expect((await d.deps.repos.rotinas.buscar(rotina.id))?.proximaExecucao).toBe(SEXTA);
    // Agenda já no futuro: não mexe.
    expect((await disparo(d, { ...rotina, proximaExecucao: SEXTA }, JANELA)).data).toEqual({ janelaDeOutro: true });
  });
});

describe("pausar e Testar agora (NOD-272)", () => {
  it("CA: pausar cancela a execução que está na fila e diz isso na conversa", async () => {
    const d = depsMemoria({ agora: () => JANELA + 30_000 });
    const rotina = await rotinaAtiva(d);
    const primeira = await disparo(d, rotina, JANELA);
    if (!("turno" in primeira.data)) throw new Error("deveria ter disparado");
    const t1 = primeira.data.turno;
    const r = await pausarRotina(d.deps, { rotinaId: rotina.id, estado: "pausada" });
    expect(d.banco.turnos.find((t) => t.id === t1.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
    expect((await d.deps.repos.rotinaExecucoes.listar(rotina.id))[0]).toMatchObject({ turnoId: t1.id, desfecho: "interrompida", motivo: "rotina_pausada" });
    expect((r.events ?? []).map((e) => e.kind)).toContain("turno_interrompido");
    expect(d.banco.mensagens.at(-1)?.texto).toBe("Rotina pausada: nada será disparado até você reativar. A execução que estava na fila foi cancelada.");
  });

  it("pausar com a execução já rodando não a corta: ela termina", async () => {
    const d = depsMemoria({ agora: () => JANELA + 30_000 });
    const rotina = await rotinaAtiva(d);
    const primeira = await disparo(d, rotina, JANELA);
    if (!("turno" in primeira.data)) throw new Error("deveria ter disparado");
    const t1 = primeira.data.turno;
    await d.deps.repos.turnos.reivindicar({ machineId: "m1", agora: JANELA + 30_000 });
    await pausarRotina(d.deps, { rotinaId: rotina.id, estado: "pausada" });
    expect(d.banco.turnos.find((t) => t.id === t1.id)?.estado).toBe("despachando");
    expect(d.banco.mensagens.at(-1)?.texto).toBe("Rotina pausada: nada será disparado até você reativar. A execução em andamento termina normalmente.");
  });

  it("pausar com a retomada da execução que roda: diz só que ela termina, sem contá-la como cancelada (revisão do Gil no #335, A7)", async () => {
    const d = depsMemoria({ agora: () => JANELA + 30_000 });
    const rotina = await rotinaAtiva(d);
    const primeira = await disparo(d, rotina, JANELA);
    if (!("turno" in primeira.data)) throw new Error("deveria ter disparado");
    const t1 = primeira.data.turno;
    await d.deps.repos.turnos.reivindicar({ machineId: "m1", agora: JANELA + 30_000 });
    const despachando = d.banco.turnos.find((t) => t.id === t1.id)!;
    d.banco.turnos.push({ ...despachando, id: "retomada-1", origem: "retomada", estado: "pendente", retomaTurnoId: t1.id, machineId: null, leaseAte: null });
    await pausarRotina(d.deps, { rotinaId: rotina.id, estado: "pausada" });
    expect(d.banco.turnos.find((t) => t.id === "retomada-1")?.estado).toBe("interrompido");
    expect(d.banco.mensagens.at(-1)?.texto).toBe("Rotina pausada: nada será disparado até você reativar. A execução em andamento termina normalmente.");
  });

  it("pausar pelo agente: o texto dele vem primeiro e o que foi cancelado não some (revisão do Gil no #335, A7)", async () => {
    const d = depsMemoria({ agora: () => JANELA + 30_000 });
    const rotina = await rotinaAtiva(d);
    await disparo(d, rotina, JANELA);
    await pausarRotina(d.deps, { rotinaId: rotina.id, estado: "pausada", texto: "Pausei a rotina a pedido do Mateus." });
    expect(d.banco.mensagens.at(-1)?.texto).toBe("Pausei a rotina a pedido do Mateus. A execução que estava na fila foi cancelada.");
  });

  it("textoPausada", () => {
    expect(textoPausada({ cortados: 0, rodando: false })).toBe("Rotina pausada: nada será disparado até você reativar.");
    expect(textoPausada({ cortados: 2, rodando: false })).toContain("As 2 execuções que estavam na fila foram canceladas.");
  });

  it("CA: Testar agora com execução na fila não cria nada e devolve jaNaFila; confirmado, roda mais uma", async () => {
    const r = relogio(JANELA + 30_000);
    const d = depsMemoria({ agora: r.agora });
    const rotina = await rotinaAtiva(d);
    const primeira = await disparo(d, rotina, JANELA);
    if (!("turno" in primeira.data)) throw new Error("deveria ter disparado");
    const t1 = primeira.data.turno;
    r.ir(JANELA + 5 * 60_000);
    const sem = await executarRotinaAgora(d.deps, { rotinaId: rotina.id, executor: "local" });
    expect(sem.data).toMatchObject({ turnoId: null, jaNaFila: { turnoId: t1.id, instanteAgendado: JANELA, fusoIana: TZ } });
    expect(d.banco.turnos).toHaveLength(1);
    const com = await executarRotinaAgora(d.deps, { rotinaId: rotina.id, executor: "local", confirmar: true });
    expect(com.data.turnoId).toBeTruthy();
    expect(com.data.jaNaFila).toBeUndefined();
    expect(d.banco.turnos).toHaveLength(2);
  });
});
