import { describe, expect, it } from "vitest";
import { AINDA_ESPERANDO } from "../../../src/adapters/executor/hook-nativas.ts";
import { entrega } from "../../../src/adapters/http/rotas/ponte-validacao.ts";
import { CAUSAS_NATIVAS } from "../../../src/contracts/negacao.ts";
import type { EventoStream } from "../../../src/contracts/turno.ts";
import { motivoDaEsperaNegada } from "../../../src/domain/espera-em-laco.ts";
import { descreverNegacao } from "../../../src/domain/estado-degradacao.ts";
import { gitForaDaPastaDoBot } from "../../../src/domain/git-na-pasta-do-bot.ts";
import { CAUSA_NATIVA_HUMANA, causaDaNegacaoNativa, motivoDoHookDoNod, negacoesDoTurno } from "../../../src/domain/negacao-nativa.ts";
import { decidirNativa } from "../../../src/domain/nativas.ts";
import { classificarResultado, classificarSessao } from "../../../src/domain/stream-json.ts";

const TASK = "/home/nod/nod/Ze 1/jornada-08aff6";
const ctx = { cwd: TASK, pastaDoBot: TASK, home: "/home/nod", daTask: true };

describe("a pílula diz por que o nod barrou a nativa (definido em 2026-10-11)", () => {
  it("cada motivo que o próprio nod gera cai na sua causa", () => {
    const casos: [string, ReturnType<typeof causaDaNegacaoNativa>][] = [
      [gitForaDaPastaDoBot(`git worktree add "$X/r" -b x`, ctx)!, "git_fora_da_pasta"],
      [gitForaDaPastaDoBot(`git -C /home/nod/nod/x checkout main`, ctx)!, "git_fora_da_pasta"],
      [gitForaDaPastaDoBot(`git -C /home/nod/x worktree add /tmp/r -b x`, ctx)!, "git_fora_da_pasta"],
      [motivoDaEsperaNegada({ tipo: "laco_com_sleep", segundos: 20 }, true), "espera_com_sleep"],
      [motivoDaEsperaNegada({ tipo: "sleep_longo", segundos: 300 }, false), "espera_com_sleep"],
      [AINDA_ESPERANDO, "esperando_aprovacao"],
      ["a pessoa não aprovou este comando", "recusado_pela_pessoa"],
      [decidirNativa({ ferramenta: "Read", entrada: { file_path: "/home/nod/.ssh/id_ed25519" } }).motivo, "credencial"],
      ["ferramenta nativa fora do plano deste turno", "fora_do_plano"],
      ["não foi possível decidir esta chamada", "sem_conferencia"],
      ["token de turno ausente ou inválido", "sem_conferencia"],
      ["o servidor do nod não confirmou esta chamada", "sem_conferencia"],
      ["Algum dado do pedido não está certo. Confira e tente de novo.", "outra"],
    ];
    for (const [motivo, causa] of casos) expect(causaDaNegacaoNativa(motivo), motivo).toBe(causa);
  });

  it("o motivo sai do tool_result do Claude Code; recusa que não é do nod não conta", () => {
    expect(motivoDoHookDoNod("PreToolUse:Bash hook error: nod: a pessoa não aprovou este comando")).toBe("a pessoa não aprovou este comando");
    expect(motivoDoHookDoNod("Permission to use Bash has been denied.")).toBeNull();
  });

  it("uma pílula por ferramenta e causa, com as vezes; o nome negado fora do hook segue sem causa; motor anterior, como antes", () => {
    const sleep = motivoDaEsperaNegada({ tipo: "laco_com_sleep", segundos: 10 }, true);
    expect(negacoesDoTurno({
      negacoesPermissao: ["Bash", "WebFetch"],
      negacoesDoNod: [
        { nome: "Bash", motivo: gitForaDaPastaDoBot(`git worktree add "$X/r"`, ctx)! },
        { nome: "Bash", motivo: sleep },
        { nome: "Bash", motivo: gitForaDaPastaDoBot(`git worktree add "$Y/r"`, ctx)! },
        { nome: "", motivo: sleep },
      ],
    })).toEqual([
      { nome: "Bash", causa: "git_fora_da_pasta", vezes: 2 },
      { nome: "Bash", causa: "espera_com_sleep", vezes: 2 },
      { nome: "WebFetch", vezes: 1 },
    ]);
    expect(negacoesDoTurno({ negacoesPermissao: ["Bash"] })).toEqual([{ nome: "Bash", vezes: 1 }]);
  });

  it("a frase: a causa no lugar de 'peça aprovação', com as vezes; sem causa, a de antes", () => {
    const base = { classe: "ferramenta_negada", nome: "Bash", motivo: "alcance_insuficiente", desde: 0, terminal: false } as const;
    expect(descreverNegacao({ ...base, causa: "git_fora_da_pasta", vezes: 3 }, 0)).toBe("ferramenta Bash negada: git fora da pasta da task; o bot recebeu o caminho certo (3 vezes)");
    expect(descreverNegacao({ ...base, causa: "esperando_aprovacao" }, 0)).toBe("ferramenta Bash negada: esperando sua aprovação na conversa");
    expect(descreverNegacao(base, 0)).toBe("ferramenta Bash negada: alcance insuficiente — peça aprovação");
    for (const causa of CAUSAS_NATIVAS) expect(descreverNegacao({ ...base, causa }, 0)).toContain(CAUSA_NATIVA_HUMANA[causa]);
  });

  it("o motor junta os motivos do turno, pelo nome que o tool_use pediu, também na sessão viva", () => {
    const tokens = { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 };
    const result = (negadas: string[]): EventoStream => ({ tipo: "result", sucesso: true, subtype: "success", sessaoCli: "s", texto: "ok", custoUsd: 0, tokens, numTurnos: 1, negacoesPermissao: negadas, erroCru: null });
    const negada = (id: string, nome: string, motivo: string): EventoStream[] => [
      { tipo: "tool_use", id, nome, input: {} },
      { tipo: "tool_result", toolUseId: id, isError: true, texto: `PreToolUse:${nome} hook error: nod: ${motivo}` },
    ];
    const eventos: EventoStream[] = [
      ...negada("a", "Bash", "a pessoa não aprovou este comando"),
      { tipo: "tool_use", id: "b", nome: "Bash", input: {} },
      { tipo: "tool_result", toolUseId: "b", isError: true, texto: "Exit code 1" },
      result(["Bash"]),
      ...negada("c", "Monitor", AINDA_ESPERANDO),
      result(["Monitor"]),
    ];
    expect(classificarResultado({ eventos: eventos.slice(0, 5), exitCode: 0, signal: null, stderr: "" }).negacoesDoNod).toEqual([{ nome: "Bash", motivo: "a pessoa não aprovou este comando" }]);
    expect(classificarSessao({ eventos, exitCode: 0, signal: null, stderr: "" }).negacoesDoNod).toEqual([
      { nome: "Bash", motivo: "a pessoa não aprovou este comando" },
      { nome: "Monitor", motivo: AINDA_ESPERANDO },
    ]);
    expect("negacoesDoNod" in classificarResultado({ eventos: [result([])], exitCode: 0, signal: null, stderr: "" })).toBe(false);
  });

  it("a ponte deixa os motivos atravessarem; fora do formato, somem e a entrega é aceita", () => {
    const base = { turnoId: "11111111-1111-4111-8111-111111111111", seqLocal: 1, fala: { tipo: "texto", texto: "ok" } };
    const resultado = { desfecho: "sucesso", texto: "ok", sessaoCli: null, custoUsd: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: ["Bash"], negacoesPermissao: ["Bash"] };
    const doNod = [{ nome: "Bash", motivo: "a pessoa não aprovou este comando", extra: "some" }];
    expect(entrega({ ...base, resultado: { ...resultado, negacoesDoNod: doNod } }, "maq").resultado.negacoesDoNod).toEqual([{ nome: "Bash", motivo: "a pessoa não aprovou este comando" }]);
    for (const estranho of ["texto", [{ nome: 1, motivo: "x" }], [{ nome: "Bash", motivo: "x".repeat(1001) }]]) {
      expect("negacoesDoNod" in entrega({ ...base, resultado: { ...resultado, negacoesDoNod: estranho } }, "maq").resultado).toBe(false);
    }
  });
});
