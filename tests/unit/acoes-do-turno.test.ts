import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { VERSAO_MINIMA_APP, type PonteInternaNod } from "../../src/adapters/fundo/ponte-interna.ts";
import { criarPonteHttpServidor } from "../../src/adapters/http/rotas/ponte.ts";
import { frameDaFerramenta, frameVivoDoEvento, repassarAcaoDoEvento } from "../../src/domain/rotulo-ferramenta.ts";
import { criarPonteHttp } from "../../src/adapters/executor/ponte-http.ts";
import type { EventoStream } from "../../src/contracts/turno.ts";
import { ACOES_DO_TURNO_MAX, acoesDoTurno, ROTULO_DA_ACAO_MAX } from "../../src/domain/acoes-do-turno.ts";
import { assuntoDe } from "../../src/domain/destino-no-chat.ts";
import { classificarResultado, classificarSessao, eventosDaLinhaStreamJson } from "../../src/domain/stream-json.ts";
import { entrega, ferramentasFalharam, trechos } from "../../src/adapters/http/rotas/ponte-validacao.ts";
import { LISTA_DA_ENTREGA_MAX } from "../../src/adapters/http/rotas/ponte-validacao.ts";

const init: EventoStream = { tipo: "init", sessaoCli: "s", ferramentas: [], modelo: "m", versaoCli: "v", apiKeySource: "none" };
const ok = (texto: string): EventoStream => ({ tipo: "result", sucesso: true, subtype: "success", sessaoCli: "s", texto, custoUsd: 0.01, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, numTurnos: 2, negacoesPermissao: [], erroCru: null });
const uso = (id: string, nome: string): EventoStream => ({ tipo: "tool_use", id, nome, input: {} });
const fim = (id: string, isError: boolean): EventoStream => ({ tipo: "tool_result", toolUseId: id, isError, texto: isError ? "erro" : "ok" });

describe("NOD-353: acoesDoTurno (o resumo que a fala final grava)", () => {
  it("rótulo no passado por chamada, Falhou pelo índice e a mesma ação seguida numa linha só", () => {
    expect(acoesDoTurno(["Read", "Read", "Write", "Bash", "WebFetch", "Read"], [4])).toEqual([
      { rotulo: "Leu um arquivo", vezes: 2 },
      { rotulo: "Escreveu um arquivo" },
      { rotulo: "Rodou um comando" },
      { rotulo: "Abriu uma página", falhou: true },
      { rotulo: "Leu um arquivo" },
    ]);
    // A mesma ação com outro desfecho não se junta: a que falhou continua à vista.
    expect(acoesDoTurno(["Bash", "Bash", "Bash"], [1])).toEqual([{ rotulo: "Rodou um comando" }, { rotulo: "Rodou um comando", falhou: true }, { rotulo: "Rodou um comando" }]);
    // Revisão 2 do #523: a contagem da linha juntada (5 leituras seguidas, uma que falhou duas vezes).
    expect(acoesDoTurno(["Read", "Read", "Read", "Read", "Read", "Bash", "Bash"], [5, 6])).toEqual([{ rotulo: "Leu um arquivo", vezes: 5 }, { rotulo: "Rodou um comando", falhou: true, vezes: 2 }]);
    expect(acoesDoTurno([])).toEqual([]);
  });

  it("teto de linhas: guarda as primeiras (a frase segue a ordem do primeiro uso)", () => {
    const nomes = Array.from({ length: ACOES_DO_TURNO_MAX * 2 }, (_, i) => (i % 2 === 0 ? "Read" : "Bash"));
    const acoes = acoesDoTurno(nomes);
    expect(acoes).toHaveLength(ACOES_DO_TURNO_MAX);
    expect(acoes[0]).toEqual({ rotulo: "Leu um arquivo" });
  });

  it("a fala com o resumo continua fala (assunto null)", () => {
    expect(assuntoDe("texto", { kind: "acoes_do_turno", acoes: [{ rotulo: "Leu um arquivo" }] }, null)).toBeNull();
  });
});

describe("NOD-353: ferramentasFalharam ← tool_result.isError", () => {
  it("índice em ferramentasChamadas da chamada cujo resultado voltou com erro; sem erro, o campo não vem", () => {
    const r = classificarResultado({ eventos: [init, uso("a", "Read"), fim("a", false), uso("b", "WebFetch"), uso("c", "Bash"), fim("c", true), fim("b", true), ok("pronto")], exitCode: 0, signal: null, stderr: "" });
    expect(r.ferramentasChamadas).toEqual(["Read", "WebFetch", "Bash"]);
    expect(r.ferramentasFalharam).toEqual([2, 1]);
    const limpo = classificarResultado({ eventos: [init, uso("a", "Read"), fim("a", false), ok("pronto")], exitCode: 0, signal: null, stderr: "" });
    expect("ferramentasFalharam" in limpo).toBe(false);
  });

  it("resultado de id desconhecido não marca nada; turno sem result também leva os índices", () => {
    const r = classificarResultado({ eventos: [init, uso("a", "Read"), fim("zz", true), uso("b", "Bash"), fim("b", true)], exitCode: null, signal: "SIGTERM", stderr: "" });
    expect(r.desfecho).toBe("interrompido");
    expect(r.ferramentasFalharam).toEqual([1]);
    // Revisão 2 do #523: id vazio (o Codex sem id) não casa com um tool_result de id vazio.
    expect(classificarResultado({ eventos: [init, uso("", "Read"), fim("", true), ok("ok")], exitCode: 0, signal: null, stderr: "" }).ferramentasFalharam).toBeUndefined();
  });

  it("sessão cortada depois de uma rodada: os índices são do turno inteiro, não da rodada aberta", () => {
    const eventos = [init, uso("a", "Read"), fim("a", false), ok("1"), uso("b", "Bash"), fim("b", true), { tipo: "delta", texto: "seguindo" } as EventoStream];
    const r = classificarSessao({ eventos, exitCode: null, signal: "SIGTERM", stderr: "", rodadasJaFaladas: 1 });
    expect(r.ferramentasChamadas).toEqual(["Read", "Bash"]);
    expect(r.ferramentasFalharam).toEqual([1]);
  });
});

describe("NOD-353 (revisão 2 do #523): vários tool_result numa linha user", () => {
  it("cada bloco vira um evento, com o isError de cada um; linha com um só e as outras linhas seguem com um evento", () => {
    const linha = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "a", is_error: true, content: "x" }, { type: "text", text: "?" }, { type: "tool_result", tool_use_id: "b", content: [{ type: "text", text: "ok" }] }] } });
    expect(eventosDaLinhaStreamJson(linha).map((e) => (e.tipo === "tool_result" ? [e.toolUseId, e.isError] : e.tipo))).toEqual([["a", true], ["b", false]]);
    const eventos = [init, uso("a", "Read"), uso("b", "Bash"), ...eventosDaLinhaStreamJson(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a" }, { type: "tool_result", tool_use_id: "b", is_error: true }] } })), ok("pronto")];
    expect(classificarResultado({ eventos, exitCode: 0, signal: null, stderr: "" }).ferramentasFalharam).toEqual([1]);
    expect(eventosDaLinhaStreamJson(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "z" }] } }))).toHaveLength(1);
    expect(eventosDaLinhaStreamJson("nada")).toEqual([{ tipo: "ignorado", razao: "json_invalido", tipoBruto: null }]);
  });
});

describe("NOD-353: a entrega valida os índices e os corta junto com a lista", () => {
  it("fora do formato some (a entrega segue); dentro, os índices andam com o corte das últimas chamadas", () => {
    expect(ferramentasFalharam([0, 2], 3)).toEqual([0, 2]);
    for (const ruim of [undefined, "1", [3], [-1], [1.5], [0, 0, 0, 0], { 0: 1 }]) expect(ferramentasFalharam(ruim, 3)).toEqual([]);
    const total = LISTA_DA_ENTREGA_MAX + 5;
    expect(ferramentasFalharam([0, 4, 5, total - 1], total)).toEqual([0, LISTA_DA_ENTREGA_MAX - 1]);
  });

  it("entrega leva ferramentasFalharam validado", () => {
    const base = { turnoId: "11111111-1111-4111-8111-111111111111", seqLocal: 1, fala: { tipo: "texto", texto: "ok" } };
    const resultado = { desfecho: "sucesso", texto: "ok", sessaoCli: null, custoUsd: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: ["Read", "Bash"], negacoesPermissao: [] };
    expect(entrega({ ...base, resultado: { ...resultado, ferramentasFalharam: [1] } }, "maq").resultado.ferramentasFalharam).toEqual([1]);
    expect("ferramentasFalharam" in entrega({ ...base, resultado: { ...resultado, ferramentasFalharam: [9] } }, "maq").resultado).toBe(false);
    expect("ferramentasFalharam" in entrega({ ...base, resultado }, "maq").resultado).toBe(false);
  });
});

describe("NOD-353: o fim de cada ação ao vivo (trechos da ponte)", () => {
  it("a ponte do executor manda o id da chamada e o fim dela, na ordem", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ativo: true, versaoMinimaApp: "0.1.0" })));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f });
    c.ferramenta("x", "WebFetch", "toolu_1"); c.ferramenta("x", "Bash"); c.fimDaFerramenta("x", "toolu_1", true);
    await c.ponte.renovar({ turnoId: "x", machineId: "y", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, eventos: [] });
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body)).trechos).toEqual([{ ferramenta: "WebFetch", id: "toolu_1" }, { ferramenta: "Bash" }, { fim: "toolu_1", falhou: true }]);
  });

  it("a rota aceita {ferramenta,id} e {fim,falhou}; fora do formato, o id cai (a ferramenta fica) e o fim some", () => {
    expect(trechos([{ ferramenta: "Bash", id: "toolu_01AbC-x" }, { fim: "toolu_01AbC-x", falhou: false }, { ferramenta: "Read" }])).toEqual([{ ferramenta: "Bash", id: "toolu_01AbC-x" }, { fim: "toolu_01AbC-x", falhou: false }, { ferramenta: "Read" }]);
    expect(trechos([{ ferramenta: "Bash", id: "a b" }, { ferramenta: "rm -rf /", id: "x" }, { fim: "x", falhou: "sim" }, { fim: "x".repeat(101), falhou: true }, { fim: "x", falhou: true, texto: "a" }, { ferramenta: "Bash", nome: "x" }])).toEqual([{ ferramenta: "Bash" }]);
  });
});

describe("NOD-353 (revisão 3 do #523): o Falhou ao vivo de ponta a ponta", () => {
  it("rota renovar: {ferramenta,id} e {fim,falhou} chegam ao servidor na ordem; app antigo só com a ferramenta", async () => {
    const plano = { turnoId: "00000000-0000-4000-8000-000000000003", agenteId: "00000000-0000-4000-8000-000000000004" } as PlanoTurno;
    const escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
    const ponte: PonteInternaNod = { conectar: async () => undefined, puxar: async () => plano, renovar: async () => ({ ativo: true, versaoMinimaApp: VERSAO_MINIMA_APP }), entregar: async () => undefined, desconectar: async () => undefined, maquinasConectadas: () => [], escopoDoTurno: () => null };
    const chegou: unknown[][] = [];
    const p = criarPonteHttpServidor({
      criar: () => ponte, persistir: async () => undefined, autorizar: async () => ({ ...escopo, chaveId: "m1" }),
      segredo: "s", seguro: false, agora: () => Date.now(), delta: () => undefined, tarefas: () => undefined, longpollMs: 2_000,
      ferramenta: (_p, nome, id) => { chegou.push(["ferramenta", nome, id]); },
      fimDaFerramenta: (_p, id, falhou) => { chegou.push(["fim", id, falhou]); },
    });
    const chamar = async (nome: string, corpo: unknown = {}) => {
      const rota = p.rotas.find((r) => r.padrao.test(`/${nome}`));
      let resposta: { status: number; body: unknown } | null = null;
      const req = new IncomingMessage(new Socket());
      req.headers = { authorization: "Bearer k", "x-nod-versao": VERSAO_MINIMA_APP };
      await rota!.handler({ req, res: new ServerResponse(req), escopo, params: { chaveId: "m1" }, corpo: async () => corpo, json: (status, body) => { resposta = { status, body }; } });
      return resposta!;
    };
    await chamar("conectar", { versaoContrato: 1, nome: "Mac", inventario: { estado: "pronto", versao: "fake", em: 0 } });
    await chamar("puxar");
    const sinais = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
    expect(await chamar("renovar", { turnoId: plano.turnoId, sinais, trechos: [{ ferramenta: "Bash", id: "t1" }, { fim: "t1", falhou: true }, { fim: "t2", falhou: false }] })).toMatchObject({ status: 200 });
    expect(await chamar("renovar", { turnoId: plano.turnoId, sinais, trechos: [{ ferramenta: "Read" }] })).toMatchObject({ status: 200 });
    expect(chegou).toEqual([["ferramenta", "Bash", "t1"], ["fim", "t1", true], ["fim", "t2", false], ["ferramenta", "Read", undefined]]);
  });

  it("desktop e motor: o repasse leva o id e o isError à ponte; o laço local publica o mesmo par de frames", () => {
    const alvo = { ferramenta: vi.fn(), fimDaFerramenta: vi.fn() };
    for (const ev of [uso("t1", "Bash"), fim("t1", true), fim("t2", false), ok("x")]) repassarAcaoDoEvento(alvo, "turno", ev);
    expect(alvo.ferramenta.mock.calls).toEqual([["turno", "Bash", "t1"]]);
    expect(alvo.fimDaFerramenta.mock.calls).toEqual([["turno", "t1", true], ["turno", "t2", false]]);
    expect(frameVivoDoEvento(fim("t1", true))).toEqual({ tipo: "turno.acao_fim", dados: { id: "t1", falhou: true } });
    expect(frameVivoDoEvento(uso("t1", "Bash"))).toMatchObject({ tipo: "turno.atividade", dados: { nome: "Bash", id: "t1" } });
    expect(frameVivoDoEvento(ok("x"))).toBeNull();
  });

  it("o rótulo ao vivo tem o mesmo teto do gravado (a troca da viva pela gravada não muda o texto)", () => {
    const longo = `mcp__${"s".repeat(150)}__${"f".repeat(150)}`;
    expect(frameDaFerramenta(longo).rotulo.length).toBeLessThanOrEqual(ROTULO_DA_ACAO_MAX);
    expect(acoesDoTurno([longo])[0]?.rotulo).toBe(frameDaFerramenta(longo).rotulo);
  });
});
