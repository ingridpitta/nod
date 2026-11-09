import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../../src/use-cases/despachar-turno.ts";
import { enviarMensagem, lerConversa, mensagemExecutorIndisponivel } from "../../../src/use-cases/enviar-mensagem.ts";
import { depsEmMemoria, esperarErro, executar } from "../../helpers/deps-l6.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

describe("enviarMensagem: mensagem + turno + outbox na mesma tx (ADR-010), localidade honesta (ADR-022)", () => {
  it("grava a mensagem da pessoa, o turno pendente com prazo e os eventos no outbox", async () => {
    const relogio = () => 1_000_000;
    const { deps, banco } = depsEmMemoria(undefined, { relogio });
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    banco.outbox.length = 0;
    const { data, events } = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: " oi ", prazoMs: 5_000, inventario: PRONTO });
    expect(data.mensagem).toMatchObject({ kind: "texto", texto: "oi", confianca: "confiavel", autoria: { autor_tipo: "pessoa" } });
    expect(data.turno).toMatchObject({ estado: "pendente", origem: "conversa", entradaTexto: "oi", prazoEm: 1_005_000, profundidade: 0, modelo: criado.agente.modelo });
    expect(data.negacao).toBeNull();
    expect(events.map((e) => e.kind)).toEqual(["mensagem_criada", "turno_criado"]);
    expect(banco.outbox.map((o) => o.tipo)).toEqual(["mensagem_criada", "turno_criado"]);
  });

  it("texto vazio → texto_vazio; conversa inexistente → nao_encontrado", async () => {
    const { deps } = depsEmMemoria();
    const { data } = await executar(deps, criarAgente, { dono: "pessoa" });
    await esperarErro(() => enviarMensagem(deps, { conversaId: data.conversa.id, texto: "   " }), "texto_vazio");
    await esperarErro(() => enviarMensagem(deps, { conversaId: randomUUID(), texto: "oi" }), "nao_encontrado");
  });

  it("sem inventário 'pronto' o turno NASCE interrompido executor_indisponivel com negação renderizável (E9.3, ADR-029)", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const { data, events } = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi" });
    expect(data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "executor_indisponivel" });
    expect(data.negacao).toMatchObject({ kind: "negacao", payload: { kind: "negacao", classe: "plano_ausente", terminal: true } });
    expect(data.negacao?.texto).toContain("executor indisponível");
    expect(events.map((e) => e.kind)).toEqual(["mensagem_criada", "turno_interrompido", "mensagem_criada"]);
    expect(await deps.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() })).toBeNull();
  });

  it("2ª mensagem não é reivindicada até a 1ª assentar; enquanto isso é renderizável como 'na fila' (EMENDA 13)", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const m1 = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "primeira", inventario: PRONTO });
    const maquina = randomUUID();
    // A 2ª chega com a 1ª já rodando (duas pendentes juntas seriam lidas num turno só: fila-lida-junta).
    const d1 = await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO });
    const m2 = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "segunda", inventario: PRONTO });
    expect(d1.data.plano?.turnoId).toBe(m1.data.turno.id);
    expect(d1.data.plano?.entrada.texto).toBe("primeira");
    const d2 = await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO });
    expect(d2.data).toMatchObject({ plano: null, motivo: "fila_vazia" });
    const lida = (await lerConversa(deps, { conversaId: criado.conversa.id })).data;
    expect(lida.turnosPendentes).toEqual([{ id: m2.data.turno.id, motivo: "agente_ocupado_em", conversaId: criado.conversa.id }]);
    // O turno rodando também vem, para a web recriar o "trabalhando" depois de recarregar a página.
    expect(lida.turnosEmCurso.map((t) => [t.id, t.estado])).toEqual([[m1.data.turno.id, "despachando"], [m2.data.turno.id, "pendente"]]);
    expect(lida.mensagens.map((m) => m.texto)).toEqual([expect.stringContaining("identidade"), "primeira", "segunda"]);

    await executar(deps, assentarTurno, {
      turnoId: m1.data.turno.id,
      machineId: maquina,
      seqLocal: 1,
      fala: { tipo: "texto", texto: "resposta" },
      resultado: { desfecho: "sucesso", texto: "resposta", sessaoCli: "s1", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, custoUsd: 0.01, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] },
    });
    const d3 = await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO });
    expect(d3.data.plano?.turnoId).toBe(m2.data.turno.id);
    // a 2ª leva --resume: a sessão do CLI ficou na conversa ao assentar a 1ª
    expect(d3.data.plano?.entrada.sessaoCli).toBe("s1");
  });

  it("falar de novo encerra a parada aberta da conversa (E5.4/E8.1)", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    await deps.repos.paradas.ativar({ conversaId: criado.conversa.id, agora: Date.now() });
    expect(await deps.repos.paradas.ativa(deps.escopo.pessoaId, criado.conversa.id)).toBe(true);
    await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "voltei", inventario: PRONTO });
    expect(await deps.repos.paradas.ativa(deps.escopo.pessoaId, criado.conversa.id)).toBe(false);
  });
});

/**
 * NOD-220: a negação de executor indisponível grava a IA que negou (`ia`). Sem ela, a web via o bot no Automático com o
 * turno recusado pelo Codex e decidia "já voltou" pela sonda do Claude (motor em uso), pronto.
 */
describe("NOD-220: a negação grava a IA que negou", () => {
  const AUSENTE = { estado: "ausente" as const, motivo: "sem sonda", em: 0 };

  it("harness recusado (Codex): ia = codex-cli, mesmo com o executor local (motor claude-cli)", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const { data } = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
    const m = await mensagemExecutorIndisponivel(deps, { conversaId: criado.conversa.id, turnoId: data.turno.id, agenteId: criado.agente.id, executor: "local", inventario: PRONTO, agora: 1, harness: "codex-cli" });
    expect(m?.payload).toMatchObject({ kind: "negacao", classe: "plano_ausente", nome: "codex-cli", ia: "codex-cli" });
    expect(m?.texto).toContain("Codex indisponível");
  });

  // Revisão do #303: o motor local fora não é a IA "claude-cli" recusando. Antes gravava ia = claude-cli e a web, num bot
  // fixado no Codex, esperava o Claude Code voltar para sempre.
  it("o executor fora (sem harness): nem o motor local nem o catcher gravam `ia`", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const local = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", executor: "local", inventario: AUSENTE });
    expect(local.data.negacao?.payload).toMatchObject({ kind: "negacao", nome: "claude-cli" });
    expect(local.data.negacao?.payload).not.toHaveProperty("ia");
    const catcher = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "de novo", inventario: AUSENTE });
    expect(catcher.data.negacao?.payload).toMatchObject({ kind: "negacao", nome: "catcher" });
    expect(catcher.data.negacao?.payload).not.toHaveProperty("ia");
  });

  // #313: no envio, o bot fixado nomeia a IA DELE (com o estado que as máquinas anunciam) e o Automático não chama o motor
  // de "Claude Code" — quem só tinha o ChatGPT lia "Claude Code sem conta conectada" com o bot fixado no Codex.
  it("#313: bot fixado no Codex sem Codex pronto: a negação nomeia o Codex e grava `ia`", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa", harness: "codex-cli", modelo: "gpt-5.6-sol" });
    const semLogin = { estado: "nao_autenticado" as const, motivo: "entre no codex", em: 0 };
    const { data } = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", executor: "local", inventario: AUSENTE, harnessesDaPessoa: { "claude-cli": PRONTO, "codex-cli": semLogin } });
    expect(data.negacao?.payload).toMatchObject({ kind: "negacao", nome: "codex-cli", ia: "codex-cli" });
    expect(data.negacao?.texto).toContain("Codex sem conta conectada: entre no codex");
    expect(data.negacao?.texto).not.toContain("Claude Code");
    // Sem máquina viva nenhuma: não afirma "não instalado", diz que nenhum computador conectado o tem pronto.
    const semMaquina = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "de novo", executor: "local", inventario: AUSENTE, harnessesDaPessoa: {} });
    expect(semMaquina.data.negacao?.texto).toContain("Codex não está pronto em nenhum computador conectado");
  });

  it("#313: bot no Automático sem IA pronta: 'nenhuma IA pronta nas suas máquinas', sem nomear IA nem gravar `ia`", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const { data } = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", executor: "local", inventario: { estado: "nao_autenticado", motivo: "Entre na conta do harness neste computador", em: 0 }, harnessesDaPessoa: {} });
    expect(data.negacao?.texto).toContain("nenhuma IA pronta nas suas máquinas");
    expect(data.negacao?.texto).not.toContain("Claude Code");
    expect(data.negacao?.payload).not.toHaveProperty("ia");
  });

  it("harness Claude recusado: ia = claude-cli; harness fora do catálogo não grava `ia`", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const { data } = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
    const base = { conversaId: criado.conversa.id, turnoId: data.turno.id, agenteId: criado.agente.id, executor: "catcher" as const, inventario: AUSENTE, agora: 1 };
    expect((await mensagemExecutorIndisponivel(deps, { ...base, harness: "claude-cli" }))?.payload).toMatchObject({ nome: "claude-cli", ia: "claude-cli" });
    expect((await mensagemExecutorIndisponivel(deps, { ...base, harness: "gemini-x" }))?.payload).not.toHaveProperty("ia");
  });
});
