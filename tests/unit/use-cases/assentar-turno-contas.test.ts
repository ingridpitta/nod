import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { IdHarness } from "../../../src/contracts/harness.ts";
import type { ContaNoLimite, ResultadoTurno } from "../../../src/contracts/turno.ts";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { criarTrabalho } from "../../../src/use-cases/trabalhos.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { definirInteligenciaDoBot } from "../../../src/use-cases/inteligencia.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

const T0 = Date.now();
const DUAS_HORAS = 2 * 3_600_000;
const base = {
  texto: "", sessaoCli: null, custoUsd: 0, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false },
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
} satisfies Omit<ResultadoTurno, "desfecho">;
/** O que o driver do Claude entrega com `rate_limit_event` `rejected` e o `result` com erro (stream-json.ts). */
const limiteDoClaude = (voltaEm: number | null): ResultadoTurno => ({ ...base, desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: voltaEm, erroCru: "Claude AI usage limit reached" });

const comConta = (conta: ContaNoLimite): ResultadoTurno => ({ ...limiteDoClaude(T0 + DUAS_HORAS), contaNoLimite: conta });

/**
 * definido em 2026-10-12 (ADR-101, NOD-211): o Mac decide a conta no limite e diz só posições. Com outra conta livre a IA
 * NÃO entra no limite (os outros bots seguem nela); "trocou" repete o turno na mesma IA; "perguntar" deixa a pessoa
 * escolher; "todas_no_limite" é o limite de sempre.
 */
async function cenario(o: { pedido?: unknown; origem?: "conversa" | "rotina" | "retomada"; task?: boolean } = {}) {
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => T0 });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Assistente pessoal" });
  if (o.pedido) await executar(deps, definirInteligenciaDoBot, { agenteId: bot.agente.id, pedido: o.pedido });
  const agente = (await deps.repos.agentes.buscar(bot.agente.id))!;
  const origem = await deps.repos.mensagens.criar({ conversaId: bot.conversa.id, autoria: { autor_tipo: "pessoa", autor_id: MARLON.pessoaId, sob_procuracao_de: null, conta_de_execucao: MARLON.pessoaId, executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 }, kind: "texto", texto: "oi", confianca: "confiavel" });
  const trabalhoId = o.task ? (await criarTrabalho(deps, { agenteId: bot.agente.id, conversaId: bot.conversa.id, titulo: "Revisar os PRs", origem: "pessoa" })).trabalho.id : null;
  const t = await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: o.origem ?? "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "oi", mensagemOrigemId: origem!.id, entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local", trabalhoId });
  const maquina = randomUUID();
  await deps.repos.turnos.reivindicar({ machineId: maquina, agora: T0 });
  const antes = banco.mensagens.length;
  const entregar = (resultado: ResultadoTurno, harness: IdHarness, prontosDaPessoa: IdHarness[] = ["claude-cli", "codex-cli"]) =>
    executar(deps, assentarTurno, { turnoId: t!.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: resultado.texto }, resultado, executor: "local", harness, prontosDaPessoa });
  return { deps, banco, turnoId: t!.id, trabalhoId, antes, entregar, turno: () => banco.turnos.find((x) => x.id === t!.id)! };
}

describe("assentarTurno: a conta da IA chegou ao limite (várias contas)", () => {
  it("Trocar sozinho: repete na MESMA IA e modelo, linha conta_trocada só com posições, a IA não fica no limite", async () => {
    const c = await cenario({ pedido: { modo: "fixa", fixa: "claude-cli" } });
    const r = await c.entregar(comConta({ tipo: "trocou", de: 1, para: 3, voltaEm: T0 + DUAS_HORAS, foraDaTroca: [2] }), "claude-cli");
    expect((await c.deps.repos.preferencias.buscar()).iasNoLimite ?? {}).toEqual({});
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => m.payload)).toEqual([{ kind: "conta_trocada", harness: "claude-cli", de: 1, para: 3, voltaEm: T0 + DUAS_HORAS, foraDaTroca: [2] }]);
    expect(novas[0]?.texto).toMatch(/^Conta 1 do Claude Code no limite até (\d\d\/\d\d às )?\d\d:\d\d\. Seguindo com a conta 3 \(conta 2 fora da troca automática\)\.$/);
    const original = c.banco.turnos.find((t) => t.id === c.turnoId)!;
    const repetido = c.banco.turnos.filter((t) => t.id !== c.turnoId);
    expect(repetido).toMatchObject([{ estado: "pendente", origem: "conversa", entradaTexto: "oi", harness: original.harness, modelo: original.modelo, reenvios: 1 }]);
    expect(r.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["turno_interrompido", "mensagem_criada", "turno_criado"]));
  });

  it("Perguntar antes: aviso com a pergunta e o payload da conta; nada repetido; a IA não fica no limite", async () => {
    const c = await cenario();
    const conta: ContaNoLimite = { tipo: "perguntar", de: 1, livres: [2, 3], foraDaTroca: [], voltaEm: T0 + DUAS_HORAS };
    await c.entregar(comConta(conta), "claude-cli");
    expect((await c.deps.repos.preferencias.buscar()).iasNoLimite ?? {}).toEqual({});
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => m.payload)).toEqual([{ kind: "limite_do_plano", harness: "claude-cli", voltaEm: T0 + DUAS_HORAS, conta }]);
    expect(novas[0]?.texto).toMatch(/^Conta 1 do Claude Code no limite até (\d\d\/\d\d às )?\d\d:\d\d\. Seguir com a conta 2 ou 3\?$/);
    // Automático com o Codex pronto: com conta livre, o nod NÃO pula de IA por conta própria — quem escolhe é a pessoa.
    expect(c.banco.turnos).toHaveLength(1);
  });

  it("todas no limite: o limite de sempre (gravado para os outros bots), com a frase das contas", async () => {
    const c = await cenario({ pedido: { modo: "fixa", fixa: "claude-cli" } });
    await c.entregar(comConta({ tipo: "todas_no_limite", noLimite: [1, 2], voltaEm: T0 + DUAS_HORAS }), "claude-cli", ["claude-cli"]);
    expect((await c.deps.repos.preferencias.buscar()).iasNoLimite?.["claude-cli"]?.renovaEm).toBe(T0 + DUAS_HORAS);
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas[0]?.payload).toMatchObject({ kind: "limite_do_plano", conta: { tipo: "todas_no_limite" } });
    expect(novas[0]?.texto).toMatch(/^Todas as contas do Claude Code estão no limite\. A primeira volta (às|em \d\d\/\d\d às) \d\d:\d\d\.$/);
  });

  // NOD-274 (2026-10-15): a rotina é fundo — com a troca feita no Mac ela segue já na conta nova, como a task; antes a
  // janela morria ali ("só a conversa repete").
  it("rotina com troca feita no Mac: segue já na conta nova (NOD-274); fica o aviso com a frase", async () => {
    const c = await cenario({ origem: "rotina" });
    await c.entregar(comConta({ tipo: "trocou", de: 1, para: 2, voltaEm: null, foraDaTroca: [] }), "claude-cli");
    const volta = c.banco.turnos.filter((t) => t.id !== c.turnoId);
    expect(volta).toMatchObject([{ estado: "pendente", origem: "retomada", retomaTurnoId: c.turnoId, acordarEm: T0 }]);
    expect(volta[0]?.entradaTexto).toMatch(/seguiu com a conta 2\./);
    expect(c.banco.mensagens.slice(c.antes)[0]?.texto).toBe("Conta 1 do Claude Code no limite. Seguindo com a conta 2.");
  });

  // QA do NOD-211 (2026-10-12): a task (frente) caía no aviso de sempre e virava "falhou" quando a conta parava com outra
  // livre — o ramo da conta livre não registrava o limite e aposLimiteNoFundo nunca rodava (ADR-099 §7: nenhuma frente
  // falha por limite).
  it("task de fundo + Trocar sozinho: segue já, na mesma IA, com a entrada só com posições; a task não falha", async () => {
    const c = await cenario({ pedido: { modo: "fixa", fixa: "claude-cli" }, task: true, origem: "retomada" });
    await c.entregar(comConta({ tipo: "trocou", de: 1, para: 2, voltaEm: T0 + DUAS_HORAS, foraDaTroca: [] }), "claude-cli", ["claude-cli"]);
    expect((await c.deps.repos.trabalhos.buscar(c.trabalhoId!))?.estado).not.toBe("falhou");
    expect((await c.deps.repos.preferencias.buscar()).iasNoLimite ?? {}).toEqual({});
    const volta = c.banco.turnos.filter((t) => t.id !== c.turnoId);
    expect(volta).toMatchObject([{ estado: "pendente", origem: "retomada", trabalhoId: c.trabalhoId, harness: "claude-cli", acordarEm: T0 }]);
    expect(volta[0]?.entradaTexto).toMatch(/^\[nod\] A cota do Claude Code chegou ao limite na conta 1 .* seguiu com a conta 2\./);
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => m.payload)).toEqual([{ kind: "conta_trocada", harness: "claude-cli", de: 1, para: 2, voltaEm: T0 + DUAS_HORAS, foraDaTroca: [] }]);
  });

  for (const origem of ["retomada", "conversa"] as const) {
    it(`task (${origem}) + Perguntar antes: nada troca sozinho, a task espera a conta 1 voltar e não falha`, async () => {
      const c = await cenario({ pedido: { modo: "fixa", fixa: "claude-cli" }, task: true, origem });
      await c.entregar(comConta({ tipo: "perguntar", de: 1, livres: [2], foraDaTroca: [], voltaEm: T0 + DUAS_HORAS }), "claude-cli", ["claude-cli"]);
      expect((await c.deps.repos.trabalhos.buscar(c.trabalhoId!))?.estado).not.toBe("falhou");
      expect((await c.deps.repos.preferencias.buscar()).iasNoLimite ?? {}).toEqual({});
      const volta = c.banco.turnos.filter((t) => t.id !== c.turnoId);
      expect(volta).toMatchObject([{ estado: "pendente", origem: "retomada", trabalhoId: c.trabalhoId, acordarEm: T0 + DUAS_HORAS }]);
      const novas = c.banco.mensagens.slice(c.antes);
      expect(novas).toHaveLength(1);
      expect(novas[0]?.texto).toMatch(/^A conta 1 do Claude Code chegou ao limite\. Esta task espera e volta sozinha (às|em \d\d\/\d\d às) \d\d:\d\d, de onde parou\.$/);
    });
  }
});

describe("NOD-287: troca de conta leva a marca da web", () => {
  for (const suja of [true, false]) {
    it(`Trocar sozinho, origem ${suja ? "contaminada ⇒ repetida contaminada" : "limpa ⇒ repetida limpa"}`, async () => {
      const c = await cenario({ pedido: { modo: "fixa", fixa: "claude-cli" } });
      if (suja) await c.deps.repos.turnos.contaminar(c.turnoId, T0);
      await c.entregar(comConta({ tipo: "trocou", de: 1, para: 3, voltaEm: T0 + DUAS_HORAS, foraDaTroca: [2] }), "claude-cli");
      const [repetido] = c.banco.turnos.filter((t) => t.id !== c.turnoId);
      expect(repetido).toBeDefined();
      expect(await c.deps.repos.turnos.contaminado(repetido!.id)).toBe(suja);
    });
  }
});

describe("NOD-268: o teto de reenvios na troca de conta", () => {
  it("Trocar sozinho com a fala já reenviada uma vez: não repete — espera a conta voltar, com UMA linha", async () => {
    const c = await cenario({ pedido: { modo: "fixa", fixa: "claude-cli" } });
    c.turno().reenvios = 1;
    await c.entregar(comConta({ tipo: "trocou", de: 1, para: 3, voltaEm: T0 + DUAS_HORAS, foraDaTroca: [] }), "claude-cli");
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas).toHaveLength(1);
    expect(novas[0]?.texto).toMatch(/^O Claude Code está no limite da assinatura\. Sua mensagem espera e volta sozinha (às|em \d\d\/\d\d às) \d\d:\d\d\.$/);
    expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ estado: "pendente", reenvios: 2, acordarEm: T0 + DUAS_HORAS }]);
  });

  it("e a que já esperou a hora fica com o aviso de sempre (nada na fila)", async () => {
    const c = await cenario({ pedido: { modo: "fixa", fixa: "claude-cli" } });
    c.turno().reenvios = 2;
    c.turno().acordarEm = T0 - 1;
    await c.entregar(comConta({ tipo: "trocou", de: 1, para: 3, voltaEm: T0 + DUAS_HORAS, foraDaTroca: [] }), "claude-cli");
    expect(c.banco.turnos).toHaveLength(1);
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas).toHaveLength(1);
    // Revisão do PR #319: sem "Seguindo com a conta 3" — nada segue; o aviso do limite com a hora.
    expect(novas[0]?.texto).not.toContain("Seguindo");
    expect(novas[0]?.payload).toMatchObject({ kind: "limite_do_plano", harness: "claude-cli", voltaEm: T0 + DUAS_HORAS });
  });
});
