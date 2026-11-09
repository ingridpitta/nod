import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { entrega as validarEntrega } from "../../../src/adapters/http/rotas/ponte-validacao.ts";
import type { EventoStream, ResultadoTurno } from "../../../src/contracts/turno.ts";
import { resumoSemChamada, TEXTO_PERGUNTA_VENCIDA } from "../../../src/domain/frente.ts";
import { motivoDaFrente, respostaAoColega } from "../../../src/domain/retorno-do-lote.ts";
import { causaDaEntrega, causaDoCodexChat, classificarResultado, classificarSessao, fimDoStderr, LINHAS_DO_STDERR } from "../../../src/domain/stream-json.ts";
import { estadoDoTrabalho, MOTIVO_PERGUNTA_VENCIDA, type FatosTrabalho } from "../../../src/domain/trabalho.ts";

/** NOD-264 (C20 e C21): a causa do `trabalho_incompleto` e a pergunta que venceu sem resposta. */

describe("C20: a causa do turno que acabou sem result", () => {
  it("o driver interrompeu, o sinal ou o exit viram a causa", () => {
    expect(classificarResultado({ eventos: [], exitCode: 143, signal: null, stderr: "", interrompidoPeloDriver: true }).causa).toBe("interrompido_pelo_driver");
    const sigterm = classificarResultado({ eventos: [], exitCode: null, signal: "SIGTERM", stderr: "boom" });
    expect(sigterm).toMatchObject({ desfecho: "interrompido", causa: "sinal:SIGTERM" });
    expect(classificarResultado({ eventos: [], exitCode: 137, signal: null, stderr: "" }).causa).toBe("exit:137");
  });

  // NOD-293 (C20): o exit 0 sem result era o buraco que sobrava (turno_interrompido sem causa em produção).
  const init: EventoStream = { tipo: "init", sessaoCli: "s", ferramentas: [], modelo: "m", versaoCli: "v", apiKeySource: "none" };
  const delta: EventoStream = { tipo: "delta", texto: "Vou conferir" };
  const result = (sucesso: boolean, subtype: string): EventoStream => ({ tipo: "result", sucesso, subtype, sessaoCli: "s", texto: "", custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, numTurnos: 1, negacoesPermissao: [], erroCru: sucesso ? null : "x" });

  it("exit 0 sem result: a causa é sem_result:<driver> (sem driver, :desconhecido)", () => {
    expect(classificarResultado({ eventos: [init, delta], exitCode: 0, signal: null, stderr: "", driver: "claude-cli" })).toMatchObject({ desfecho: "interrompido", causa: "sem_result:claude-cli" });
    expect(classificarResultado({ eventos: [], exitCode: 0, signal: null, stderr: "", driver: "codex-chat" }).causa).toBe("sem_result:codex-chat");
    expect(classificarResultado({ eventos: [init, delta], exitCode: 0, signal: null, stderr: "" }).causa).toBe("sem_result:desconhecido");
    // O exit diferente de 0 e o sinal continuam dizendo o que foram.
    expect(classificarResultado({ eventos: [init, delta], exitCode: 1, signal: null, stderr: "", driver: "claude-cli" }).causa).toBe("exit:1");
    expect(causaDaEntrega("sem_result:claude-cli")).toBe("sem_result:claude-cli");
    expect(causaDaEntrega("sem_result:codex-chat")).toBe("sem_result:codex-chat");
  });

  it("o result com erro leva a causa falha:<subtype>; o sucesso não leva causa", () => {
    expect(classificarResultado({ eventos: [init, delta, result(false, "error_during_execution")], exitCode: 0, signal: null, stderr: "" })).toMatchObject({ desfecho: "falha", causa: "falha:error_during_execution" });
    expect(classificarResultado({ eventos: [init, delta, result(false, "success")], exitCode: 1, signal: null, stderr: "" }).causa).toBe("falha:success");
    expect(classificarResultado({ eventos: [init, delta, result(true, "success")], exitCode: 0, signal: null, stderr: "" }).causa).toBeUndefined();
    // Subtype fora da forma de código não vira causa crua.
    expect(classificarResultado({ eventos: [init, result(false, "Erro: algo deu errado")], exitCode: 0, signal: null, stderr: "" }).causa).toBe("falha:desconhecido");
    expect(causaDaEntrega("falha:error_during_execution")).toBe("falha:error_during_execution");
  });

  it("Codex app-server: turno_recusado, exit:N e sinal:X no fechamento; sucesso sem causa", () => {
    const recusado = classificarSessao({ eventos: [init, result(false, "error_during_execution")], exitCode: 0, signal: null, stderr: "", driver: "codex-chat" });
    expect(causaDoCodexChat(recusado, { turnoRecusado: true, exitCode: 0, signal: null })).toBe("turno_recusado");
    const caiu = classificarSessao({ eventos: [init, delta], exitCode: 1, signal: null, stderr: "", driver: "codex-chat" });
    expect(causaDoCodexChat(caiu, { turnoRecusado: false, exitCode: 1, signal: null })).toBe("exit:1");
    const morto = classificarSessao({ eventos: [init, delta], exitCode: null, signal: "SIGKILL", stderr: "", driver: "codex-chat" });
    expect(causaDoCodexChat(morto, { turnoRecusado: false, exitCode: null, signal: "SIGKILL" })).toBe("sinal:SIGKILL");
    // A volta que falhou e o processo saiu com erro: o exit diz mais que o subtype genérico.
    const falhouESaiu = classificarSessao({ eventos: [init, delta, result(false, "error_during_execution")], exitCode: 2, signal: null, stderr: "", driver: "codex-chat" });
    expect(causaDoCodexChat(falhouESaiu, { turnoRecusado: false, exitCode: 2, signal: null })).toBe("exit:2");
    // O Parar continua sendo do driver (o laço ainda pode trocar pela causa dele).
    const parado = classificarSessao({ eventos: [init, delta], exitCode: 143, signal: null, stderr: "", interrompidoPeloDriver: true, driver: "codex-chat" });
    expect(causaDoCodexChat(parado, { turnoRecusado: false, exitCode: 143, signal: null })).toBe("interrompido_pelo_driver");
    const semResult = classificarSessao({ eventos: [init, delta], exitCode: 0, signal: null, stderr: "", driver: "codex-chat" });
    expect(causaDoCodexChat(semResult, { turnoRecusado: false, exitCode: 0, signal: null })).toBe("sem_result:codex-chat");
    const ok = classificarSessao({ eventos: [init, delta, result(true, "success")], exitCode: 0, signal: null, stderr: "", driver: "codex-chat" });
    expect(causaDoCodexChat(ok, { turnoRecusado: false, exitCode: 0, signal: null })).toBeUndefined();
    for (const c of ["turno_recusado", "exit:1", "sinal:SIGKILL"]) expect(causaDaEntrega(c)).toBe(c);
  });

  it("a rota da máquina deixa a causa passar também no turno falho (antes só no interrompido)", () => {
    const resultado: ResultadoTurno = {
      desfecho: "falha", motivoFalha: "erro_execucao", erroCru: "x", texto: "", sessaoCli: null, custoUsd: null, causa: "turno_recusado",
      sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true },
      tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
    };
    const e = { turnoId: randomUUID(), seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado };
    expect(validarEntrega(JSON.parse(JSON.stringify(e)), "m1").resultado.causa).toBe("turno_recusado");
    expect(validarEntrega(JSON.parse(JSON.stringify({ ...e, resultado: { ...resultado, desfecho: "sucesso", motivoFalha: undefined } })), "m1").resultado.causa).toBeUndefined();
  });

  it("a entrega só aceita a causa com forma de código, curta", () => {
    expect(causaDaEntrega("renovacao_negada:sem_plano")).toBe("renovacao_negada:sem_plano");
    expect(causaDaEntrega("sinal:SIGTERM")).toBe("sinal:SIGTERM");
    expect(causaDaEntrega("reinicio_do_motor")).toBe("reinicio_do_motor");
    expect(causaDaEntrega("exit:-1")).toBe("exit:-1");
    expect(causaDaEntrega("Erro: token sk-abc vazou")).toBeNull();
    expect(causaDaEntrega("a:b:c")).toBeNull();
    expect(causaDaEntrega(`x:${"a".repeat(40)}`)).toBeNull();
    expect(causaDaEntrega(42)).toBeNull();
    expect(causaDaEntrega(undefined)).toBeNull();
  });

  it("o fim do stderr: as últimas 20 linhas não vazias, com os segredos redigidos antes do corte", () => {
    const linhas = Array.from({ length: 30 }, (_, i) => `linha ${i}`);
    const fim = fimDoStderr([...linhas, "", "Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"].join("\n"));
    expect(fim).not.toBeNull();
    const saida = fim!.split("\n");
    expect(saida).toHaveLength(LINHAS_DO_STDERR);
    expect(saida[0]).toBe("linha 11");
    expect(fim).not.toContain("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789");
    expect(fimDoStderr("")).toBeNull();
    expect(fimDoStderr("\n  \n")).toBeNull();
  });
});

describe("C21: a pergunta à pessoa que venceu sem resposta", () => {
  const base: FatosTrabalho = { estadoAtual: "rodando", iniciado: true, parando: 0, despachando: 0, pendentes: 0, esperandoOutro: false, decisaoPendente: false, aguardandoColega: false, ultimo: { estado: "concluido", motivo: null } };

  it("o trabalho fica `falhou` (antes ficava `terminado` e o resumo era a pergunta)", () => {
    expect(estadoDoTrabalho({ ...base, perguntaVencida: true })).toBe("falhou");
    expect(estadoDoTrabalho({ ...base, perguntaVencida: true, aguardandoColega: true })).toBe("falhou");
    expect(estadoDoTrabalho(base)).toBe("terminado");
    // Uma pergunta nova aberta vence a vencida; o Parar vence as duas.
    expect(estadoDoTrabalho({ ...base, perguntaVencida: true, decisaoPendente: true })).toBe("precisa_de_voce");
    expect(estadoDoTrabalho({ ...base, estadoAtual: "parado", perguntaVencida: true })).toBe("parado");
    // Um turno novo rodando também vence.
    expect(estadoDoTrabalho({ ...base, perguntaVencida: true, despachando: 1 })).toBe("rodando");
  });

  it("o resumo e o retorno do lote levam o motivo, nunca a pergunta", () => {
    const pergunta = "Posso apagar a tabela de clientes?";
    const r = resumoSemChamada({ estado: "falhou", ultimaFala: pergunta, perguntaVencida: true });
    expect(r.feito).toContain(TEXTO_PERGUNTA_VENCIDA);
    expect(JSON.stringify(r)).not.toContain(pergunta);
    expect(resumoSemChamada({ estado: "falhou", ultimaFala: pergunta }).feito).toContain(pergunta);
    const frente = { id: "a", titulo: "Frente a", estado: "falhou" as const, motivoInterrupcao: MOTIVO_PERGUNTA_VENCIDA, quedas: 0, resumo: null };
    expect(motivoDaFrente(frente)).toBe(TEXTO_PERGUNTA_VENCIDA);
    expect(TEXTO_PERGUNTA_VENCIDA).toBe("a pergunta à pessoa venceu sem resposta");
    expect(respostaAoColega([frente as never])).toContain(TEXTO_PERGUNTA_VENCIDA);
  });
});
