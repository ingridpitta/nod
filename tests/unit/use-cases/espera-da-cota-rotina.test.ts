import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";
import { ENTRADA_DA_VOLTA_DA_COTA } from "../../../src/domain/cota-da-ia.ts";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { dispararRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { definirInteligenciaDoBot } from "../../../src/use-cases/inteligencia.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

const T0 = Date.now();
const HORA = 3_600_000;
const base = {
  texto: "", sessaoCli: null, custoUsd: 0, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false },
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
} satisfies Omit<ResultadoTurno, "desfecho">;
const limiteDoClaude = (voltaEm: number): ResultadoTurno => ({ ...base, desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: voltaEm, erroCru: "Claude AI usage limit reached" });

/**
 * QA do PR #340 (NOD-274, critérios 1, 2 e 11): a rotina sem task que bate no limite espera a cota se ela volta antes da
 * próxima janela; se volta depois, a janela fica 'nao_rodou' com a hora, sem volta. Duas batidas na mesma cadeia: uma
 * linha só na conversa.
 */
async function cenario(proximaJanelaEm: number) {
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => T0 });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Rotineira" });
  await executar(deps, definirInteligenciaDoBot, { agenteId: bot.agente.id, pedido: { modo: "fixa", fixa: "claude-cli" } });
  const rotina = await deps.repos.rotinas.criar({ agenteId: bot.agente.id, conversaId: bot.conversa.id, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "Resumo do dia", fonte: "planilha", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: T0 });
  if (!rotina) throw new Error("rotina");
  const disparo = await dispararRotina(deps, { rotina, instanteAgendado: T0, machineId: "m", executor: "local" });
  if (!("turno" in disparo.data)) throw new Error("sem turno");
  const turnoId = disparo.data.turno.id;
  // A próxima janela do cron fica onde o teste quer (o disparo já a avançou).
  const r = banco.rotinas.find((x) => x.id === rotina.id);
  if (!r) throw new Error("rotina no banco");
  r.proximaExecucao = proximaJanelaEm;
  const antes = banco.mensagens.length;
  const rodar = async (id: string, resultado: ResultadoTurno) => {
    const machineId = randomUUID();
    const pego = await deps.repos.turnos.reivindicar({ machineId, agora: T0 + 10 * HORA * 10 });
    expect(pego?.id).toBe(id);
    return executar(deps, assentarTurno, { turnoId: id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado, executor: "local", harness: "claude-cli", prontosDaPessoa: ["claude-cli"] });
  };
  const sistema = () => banco.mensagens.slice(antes).filter((m) => m.kind === "sistema" && m.conversaId === bot.conversa.id);
  return { deps, banco, rotinaId: rotina.id, turnoId, rodar, sistema };
}

describe("NOD-274: a rotina sem task no limite (QA do PR #340)", () => {
  it("critério 1: a volta antes da próxima janela → retomada com acordar_em na mesma cadeia; nada de 'falhou'", async () => {
    const c = await cenario(T0 + 24 * HORA);
    const r = await c.rodar(c.turnoId, limiteDoClaude(T0 + 2 * HORA));
    expect(r.data.esperaDaCota).toBe("espera");
    const voltas = c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId);
    expect(voltas).toMatchObject([{ estado: "pendente", origem: "retomada", acordarEm: T0 + 2 * HORA }]);
    expect(voltas[0]?.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA)).toBe(true);
    expect((await c.deps.repos.rotinaExecucoes.listar(c.rotinaId)).map((e) => e.desfecho)).not.toContain("falhou");
    expect(c.sistema()).toHaveLength(1);
  });

  it("critério 2: a volta depois da próxima janela → nenhuma retomada; 'nao_rodou' com motivo e volta_em; rotina_executou", async () => {
    const c = await cenario(T0 + HORA);
    const r = await c.rodar(c.turnoId, limiteDoClaude(T0 + 3 * HORA));
    expect(r.data.esperaDaCota).toBe("nao_rodou");
    expect(c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId)).toHaveLength(0);
    expect(await c.deps.repos.rotinaExecucoes.listar(c.rotinaId)).toMatchObject([{ desfecho: "nao_rodou", motivo: "cota_da_ia", voltaEm: T0 + 3 * HORA }]);
    expect(r.events.map((e) => e.kind)).toContain("rotina_executou");
    // revisto em 2026-10-20 (NOD-309, PR 4): nenhum aviso de sistema, mas a janela não fica calada — UMA linha "Não
    // rodou · <motivo>, volta HH:MM" na conversa da rotina (kind rotina_execucao), além do histórico.
    expect(c.sistema()).toHaveLength(0);
    const linhas = c.banco.mensagens.filter((m) => m.kind === "rotina_execucao" && m.texto.startsWith("Não rodou · "));
    expect(linhas.map((m) => m.texto)).toEqual([expect.stringMatching(/^Não rodou · a cota da IA chegou ao limite, volta (às|em \d\d\/\d\d às) \d\d:\d\d\. A rotina segue a agenda\./)]);
  });

  it("critério 2 (borda): a volta exatamente na próxima janela conta como depois", async () => {
    const c = await cenario(T0 + 2 * HORA);
    const r = await c.rodar(c.turnoId, limiteDoClaude(T0 + 2 * HORA));
    expect(r.data.esperaDaCota).toBe("nao_rodou");
  });

  it("critério 11: duas batidas no limite na mesma cadeia → UMA linha de espera na conversa", async () => {
    const c = await cenario(T0 + 24 * HORA);
    await c.rodar(c.turnoId, limiteDoClaude(T0 + 2 * HORA));
    const [volta] = c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId);
    const r2 = await c.rodar(volta!.id, limiteDoClaude(T0 + 4 * HORA));
    expect(r2.data.esperaDaCota).toBe("espera");
    // A segunda volta nasce (a espera continua), na mesma cadeia, com a hora nova.
    expect(c.banco.turnos.filter((t) => t.retomaTurnoId === c.turnoId).map((t) => t.acordarEm)).toEqual([T0 + 2 * HORA, T0 + 4 * HORA]);
    expect(c.sistema()).toHaveLength(1);
  });
});
