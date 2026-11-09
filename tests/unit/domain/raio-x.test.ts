import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Conector } from "../../../src/contracts/conector.ts";
import type { FerramentaPlano } from "../../../src/contracts/plano-turno.ts";
import { SECOES_DO_PROMPT, TETO_CHAMADAS_RAIO_X, TETO_FERRAMENTAS_RAIO_X, type ExecucaoRaioX } from "../../../src/contracts/raio-x.ts";
import type { EventoStream } from "../../../src/contracts/turno.ts";
import { entrega, execucao } from "../../../src/adapters/http/rotas/ponte-validacao.ts";
import { montarPromptSistema, secaoDaLinha } from "../../../src/domain/prompt-sistema.ts";
import { composicaoDoPlano, montarExecucao, partesDoPrompt, resumoDoRaioX, TEXTO_RAIO_X_MAX_CHARS } from "../../../src/domain/raio-x.ts";
import { interpretarLinhaStreamJson } from "../../../src/domain/stream-json.ts";
import { planoDeTeste } from "../../helpers/l5.ts";

const FIXTURES = new URL("../../fixtures/stream-json/", import.meta.url);
const eventosDe = (nome: string): EventoStream[] =>
  readFileSync(new URL(nome, FIXTURES), "utf8").split("\n").map(interpretarLinhaStreamJson).filter((e) => e.tipo !== "ignorado");

const chamada = (contexto: number, extra: Partial<Extract<EventoStream, { tipo: "chamada" }>> = {}): EventoStream => ({
  tipo: "chamada", entrada: 0, cacheLido: contexto, cacheNovo: 0, saida: 10, pensamento: 0, subagente: false, ...extra,
});

describe("stream-json do modo dev: cada chamada, as compactações e a janela", () => {
  it("s3 real: dois message_delta viram duas chamadas com o usage de cada uma; o result traz a janela", () => {
    const evs = eventosDe("s3-mcp-ok.jsonl");
    expect(evs.filter((e) => e.tipo === "chamada")).toEqual([
      { tipo: "chamada", entrada: 10, cacheLido: 0, cacheNovo: 7341, saida: 319, pensamento: 241, subagente: false },
      { tipo: "chamada", entrada: 8, cacheLido: 7341, cacheNovo: 375, saida: 393, pensamento: 247, subagente: false },
    ]);
    expect(evs.find((e) => e.tipo === "result")).toMatchObject({ janela: 200000 });
  });

  it("compact_boundary em snake_case (stream) e camelCase (transcript) viram a mesma compactação", () => {
    expect(interpretarLinhaStreamJson('{"type":"system","subtype":"compact_boundary","compact_metadata":{"trigger":"auto","pre_tokens":179900}}'))
      .toEqual({ tipo: "compactacao", antes: 179900, depois: null, gatilho: "auto" });
    expect(interpretarLinhaStreamJson('{"type":"system","subtype":"compact_boundary","compactMetadata":{"trigger":"auto","preTokens":209137,"postTokens":4807}}'))
      .toEqual({ tipo: "compactacao", antes: 209137, depois: 4807, gatilho: "auto" });
  });

  it("chamada de subagente (parent_tool_use_id) é marcada; message_delta sem usage continua ignorado", () => {
    const sub = interpretarLinhaStreamJson('{"type":"stream_event","parent_tool_use_id":"toolu_1","event":{"type":"message_delta","usage":{"input_tokens":5,"output_tokens":7}}}');
    expect(sub).toMatchObject({ tipo: "chamada", entrada: 5, saida: 7, subagente: true });
    expect(interpretarLinhaStreamJson('{"type":"stream_event","event":{"type":"message_delta","delta":{}}}')).toMatchObject({ tipo: "ignorado" });
  });
});

describe("montarExecucao", () => {
  it("s3 real: a ferramenta vai na chamada que a pediu, com o tamanho do resultado; modelo, versão e custo da sessão", () => {
    const evs = eventosDe("s3-mcp-ok.jsonl");
    const x = montarExecucao(evs, evs.map((_, i) => i * 100), 8330);
    expect(x?.chamadas.map((c) => c.ferramentas)).toEqual([[{ nome: "mcp__nod__somar", resultadoChars: "RESULTADO_SOMA=42".length, erro: false }], []]);
    expect(x?.chamadas.map((c) => c.contexto)).toEqual([7351, 7724]);
    expect(x).toMatchObject({ janela: 200000, versaoCli: "2.1.272", custoSessaoUsd: 0.0207631, ferramentasNoInit: 1, buscaDeFerramentas: false, chamadasOmitidas: 0, duracaoMs: 8330 });
  });

  it("a busca de ferramentas no init aparece; compactação entra com o momento em que chegou", () => {
    const evs: EventoStream[] = [
      { tipo: "init", sessaoCli: "s", ferramentas: ["Read", "ToolSearch", "mcp__nod__lembrar"], modelo: "sonnet", versaoCli: "2.1.284", apiKeySource: "none" },
      chamada(160_500),
      { tipo: "compactacao", antes: 179_900, depois: 22_700, gatilho: "auto" },
      chamada(181_800),
    ];
    const x = montarExecucao(evs, [0, 1000, 29_000, 39_000], 40_000);
    expect(x).toMatchObject({ buscaDeFerramentas: true, ferramentasNoInit: 3, modelo: "sonnet", janela: null, custoSessaoUsd: null });
    expect(x?.compactacoes).toEqual([{ em: 29_000, antes: 179_900, depois: 22_700, gatilho: "auto" }]);
  });

  it("sem init, chamada nem result (o spawn falhou): nada a mostrar", () => {
    expect(montarExecucao([], [], 5)).toBeNull();
  });

  it("acima do teto ficam as primeiras 100 e as últimas chamadas, e o total de ferramentas também tem teto", () => {
    const n = TETO_CHAMADAS_RAIO_X + 50;
    const evs: EventoStream[] = [];
    for (let i = 0; i < n; i++) {
      evs.push({ tipo: "tool_use", id: `u${i}`, nome: "Read", input: {} }, { tipo: "tool_use", id: `v${i}`, nome: "Grep", input: {} }, chamada(i));
    }
    const x = montarExecucao(evs, evs.map(() => 0), 0);
    expect(x?.chamadas).toHaveLength(TETO_CHAMADAS_RAIO_X);
    expect(x?.chamadasOmitidas).toBe(50);
    expect(x?.chamadas[99]?.cacheLido).toBe(99);
    expect(x?.chamadas[100]?.cacheLido).toBe(150);
    expect(x?.chamadas.reduce((s, c) => s + c.ferramentas.length, 0)).toBe(TETO_FERRAMENTAS_RAIO_X);
  });
});

describe("partesDoPrompt: o prompt de sistema em seções", () => {
  const f = (nome: string, origem: FerramentaPlano["origem"] = "nod"): FerramentaPlano => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem, conectorId: origem === "conector" ? "c-gmail" : null, readOnlyHint: true, tocaDadoPessoal: false, schema: { type: "object" } });
  const gmail: Conector = {
    tenantId: "t", id: "c-gmail", ownerId: "p", visibility: "privado", nome: "Gmail", slug: "gmail", transporte: "http",
    comando: null, args: [], url: "https://x", env: {}, declaracao: "toca", habilitado: true, sondadoEm: 1, ultimaFalha: null, criadoEm: 1,
    catalogo: [{ nome: "GMAIL_FETCH_EMAILS", descricao: "busca", schema: { type: "object" }, readOnlyHint: true }],
  };
  const completo = (modo: "conversa" | "criacao" | "sala" | "rotina" | "peer" | "delegacao") => montarPromptSistema({
    agente: { nome: "Clarice", titulo: "assistente", descricao: "Cuida da agenda." },
    memorias: [{ tenantId: "t", id: "m1", agenteId: "a", tipo: "preferencia", texto: "prefere tópicos", origem: "pessoa", criadoEm: 1 }],
    ferramentas: [
      f("pedir_a_bot"), f("ver_colegas"), f("criar_rotina"), f("pausar_rotina"), f("pedir_acesso"), f("publicar_artefato"),
      f("computador_bash", "computador"), f("pasta_ler", "workspace"), f("gmail__GMAIL_FETCH_EMAILS", "conector"),
    ],
    nativas: modo === "conversa" || modo === "criacao" ? ["Read", "Bash", "Skill", "Agent"] : [],
    pastaDoBot: "Clarice",
    pessoaNome: "Marlon",
    modo,
    colegas: [{ id: "a2", nome: "Dev 1", titulo: "dev", descricao: "revisa PR" }],
    contextoConversa: JSON.stringify({ historico: [{ autor: "pessoa", texto: "oi" }] }),
    conectores: [gmail],
    rotinas: [{ id: "r1", resumo: "todo dia às 8h", instrucao: "checklist", estado: "ativa" }],
    computadorFora: null,
    delegacao: modo === "delegacao" ? { pessoaNome: "Marlon", remetenteNome: "Dev 1" } : null,
  });

  it("toda linha de um prompt completo tem seção (só o JSON do contexto herda a da linha anterior), em todos os modos", () => {
    for (const modo of ["conversa", "criacao", "sala", "rotina", "peer", "delegacao"] as const) {
      const sem = completo(modo).split("\n").filter((l) => secaoDaLinha(l) === null);
      expect(sem.every((l) => l.startsWith("{") || l.startsWith("[{")), `${modo}: ${sem.join(" | ").slice(0, 300)}`).toBe(true);
    }
    // NOD-317: o "A fazer" saiu — nem a regra nem a lista.
    expect(completo("conversa")).not.toMatch(/^(Pendências:|Suas pendências abertas)/mu);
  });

  it("as partes somam o prompt inteiro, na ordem das seções; sem modo dev, sem texto", () => {
    const prompt = completo("conversa");
    const partes = partesDoPrompt(prompt, false);
    expect(partes.reduce((s, p) => s + p.chars, 0)).toBe(prompt.length);
    expect(partes.map((p) => p.secao)).toEqual([...SECOES_DO_PROMPT]);
    expect(partes.some((p) => "texto" in p)).toBe(false);
    const comTexto = partesDoPrompt(prompt, true);
    expect(comTexto.find((p) => p.secao === "memoria")?.texto).toContain("prefere tópicos");
    expect(comTexto.find((p) => p.secao === "contexto")?.texto).toContain('{"historico"');
  });

  it("texto de uma parte acima do teto é cortado com o tamanho original", () => {
    const [parte] = partesDoPrompt(`Você é X.${"a".repeat(TEXTO_RAIO_X_MAX_CHARS + 10)}`, true);
    expect(parte?.texto?.endsWith(`[cortado: ${TEXTO_RAIO_X_MAX_CHARS + 19} caracteres]`)).toBe(true);
  });
});

describe("composicaoDoPlano", () => {
  it("agrupa as definições por app e por origem, maior primeiro; entrada e retomada; texto só com modo dev", () => {
    const plano = planoDeTeste({ nativas: ["Read", "Bash"], entrada: { texto: "resuma meus e-mails", sessaoCli: "s1", modelo: "sonnet", anexos: [] } });
    plano.catalogo.ferramentas.push({ ...plano.catalogo.ferramentas[1]!, nome: "exemplo__subtrair", nomeMcp: "mcp__nod__exemplo__subtrair" });
    const c = composicaoDoPlano(plano, { modo: "conversa", comTexto: false });
    expect(c.ferramentas.map((g) => [g.grupo, g.origem, g.quantidade]).sort()).toEqual([["exemplo", "conector", 2], ["nod", "nod", 1]]);
    expect(c.ferramentas.every((g) => g.chars > 0)).toBe(true);
    expect(c.ferramentas[0]!.chars).toBeGreaterThanOrEqual(c.ferramentas[1]!.chars);
    expect(c).toMatchObject({ modo: "conversa", modelo: "sonnet", sessaoRetomada: true, nativas: ["Read", "Bash"], entrada: { chars: 19, anexos: 0 }, comTexto: false, promptChars: plano.promptSistema.length });
    expect(c.entrada.texto).toBeUndefined();
    expect(composicaoDoPlano(plano, { modo: "conversa", comTexto: true }).entrada.texto).toBe("resuma meus e-mails");
    expect(JSON.stringify(c)).not.toContain(plano.tokenDeTurno);
  });
});

describe("resumoDoRaioX", () => {
  it("pico só da conversa principal, cache sobre o contexto de todas as chamadas", () => {
    const x = montarExecucao([chamada(100_000, { cacheNovo: 0 }), chamada(150_000, { subagente: true }), { tipo: "compactacao", antes: 1, depois: 1, gatilho: "auto" }], [0, 1, 2], 3);
    expect(resumoDoRaioX("t1", 0.5, x)).toEqual({ turnoId: "t1", custoUsd: 0.5, chamadas: 2, compactacoes: 1, picoContexto: 100_000, janela: null, cachePct: 100, modelo: null });
    expect(resumoDoRaioX("t2", 1, null)).toMatchObject({ chamadas: 0, picoContexto: null, cachePct: null });
  });
});

describe("ponte: execução na entrega", () => {
  const valida: ExecucaoRaioX = {
    chamadas: [{ em: 10, contexto: 7351, entrada: 10, cacheLido: 0, cacheNovo: 7341, saida: 319, pensamento: 241, subagente: false, ferramentas: [{ nome: "mcp__nod__somar", resultadoChars: 17, erro: false }] }],
    chamadasOmitidas: 0, compactacoes: [{ em: 20, antes: 100, depois: null, gatilho: "auto" }], janela: 200000, modelo: "sonnet", versaoCli: "2.1.284",
    custoSessaoUsd: 0.02, ferramentasNoInit: 3, buscaDeFerramentas: true, duracaoMs: 30,
  };

  it("passa inteira e reconstruída: campo fora do contrato não atravessa", () => {
    expect(execucao(valida)).toEqual(valida);
    expect(execucao({ ...valida, extra: "x", chamadas: [{ ...valida.chamadas[0], segredo: "y" }] })).toEqual(valida);
  });

  it("chat limpo (PR 1): blocosColados atravessa quando é inteiro; ausente (app antigo) continua valendo", () => {
    expect(execucao({ ...valida, blocosColados: 2 })).toEqual({ ...valida, blocosColados: 2 });
    expect(execucao(valida)).not.toHaveProperty("blocosColados");
    expect(execucao({ ...valida, blocosColados: -1 })).toBeUndefined();
    expect(execucao({ ...valida, blocosColados: "2" })).toBeUndefined();
  });

  it("2026-11-09: versaoApp é do servidor (x-nod-versao), nunca do corpo da entrega — o app não forja a versão do Raio-X", () => {
    expect(execucao({ ...valida, versaoApp: "9.9.9" })).toEqual(valida);
    expect(execucao({ ...valida, versaoApp: "9.9.9" })).not.toHaveProperty("versaoApp");
  });

  it("fora do formato vira undefined, e a entrega segue sem ela — o turno nunca cai pelo Raio-X", () => {
    expect(execucao({ ...valida, janela: -1 })).toBeUndefined();
    expect(execucao({ ...valida, chamadas: [{ ...valida.chamadas[0], ferramentas: [{ nome: "x".repeat(201), resultadoChars: 1, erro: false }] }] })).toBeUndefined();
    const corpo = {
      turnoId: "8ae907d2-2246-4ea2-ae60-d7b1d82b83f7", seqLocal: 1, fala: { tipo: "texto", texto: "ok" },
      resultado: { desfecho: "sucesso", texto: "ok", sessaoCli: null, custoUsd: 0.1, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
        sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, execucao: { ...valida, chamadas: "nada" } },
    };
    const e = entrega(corpo, "m1");
    expect(e.resultado.texto).toBe("ok");
    expect(e.resultado.execucao).toBeUndefined();
    expect(entrega({ ...corpo, resultado: { ...corpo.resultado, execucao: valida } }, "m1").resultado.execucao).toEqual(valida);
  });
});
