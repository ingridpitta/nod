import type { EventoStream } from "../../src/contracts/turno.ts";

/**
 * Roteiro do catcher (Práticas §11): marcadores no PROMPT viram a sequência de eventos que o driver
 * falso/catcher emite, sem CLI e sem custo. Módulo puro (sem vitest): o driver catcher da L4 pode
 * importar por caminho. Um marcador por linha, qualquer lugar do prompt:
 *
 *   [[delta: texto]]              → um evento 'delta' com o texto
 *   [[tool: nome {"a":1}]]        → tool_use 'nome' com input JSON (default {}), seguido do
 *                                    tool_result que o servidor devolver (o driver preenche)
 *   [[texto: resposta final]]     → o texto do result
 *   [[custo: 0.0207631]]          → custo do result (default 0)
 *   [[falha: erro_max_turns]]     → result com subtype ≠ success
 *   [[espera: 5000]]              → o roteiro pausa N ms ali (teto ESPERA_MAX_MS = 60 s): uma ferramenta longa, para
 *                                    a mensagem do meio chegar com o turno rodando (decisão S9, 2026-10-07)
 *   [[sessao: <uuid>]]            → o init e o result reportam este `sessaoCli` (sem ele, null: o catcher não
 *                                    fabrica sessão, 0005); uuid inválido é ignorado
 *   [[negada: Bash]]              → o result traz a ferramenta em `negacoesPermissao`, como o permission_denials do
 *                                    CLI (definido em 2026-10-18, chat limpo, PR 2: o e2e da negação que vai para a
 *                                    Atividade precisa de uma negação nativa NÃO terminal, que o proxy não produz)
 *
 * Marcador numa linha citada ("> …") não conta: é contexto devolvido ao turno, não roteiro.
 *
 * Sem marcador, `roteiroPadrao` responde "catcher: recebi N caracteres; ferramentas: […]".
 */
export type PassoRoteiro =
  | { tipo: "delta"; texto: string }
  | { tipo: "tool_use"; nome: string; input: Record<string, unknown> }
  | { tipo: "texto"; texto: string }
  | { tipo: "custo"; custoUsd: number }
  | { tipo: "falha"; subtype: string }
  | { tipo: "espera"; ms: number }
  | { tipo: "sessao"; id: string }
  | { tipo: "negada"; nome: string };

/** definido em 2026-10-07 (S9): teto da pausa de um `[[espera]]`; um roteiro nunca segura o turno mais que isso por marcador. */
export const ESPERA_MAX_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Roteiro = { passos: PassoRoteiro[] };

const ABERTURA = /^\[\[(delta|tool|texto|custo|falha|espera|sessao|negada):/;

/**
 * Marcadores com `[[`/`]]` BALANCEADOS (definido em 2026-09-16, L9): um marcador pode carregar outro
 * dentro do próprio JSON — `[[tool: encaminhar {"motivo":"… [[tool: passar {…}]] …"}]]` — para o texto
 * que vira o PROMPT do próximo turno (handoff, pergunta a outro bot) levar o roteiro daquele turno.
 * Sem isto o primeiro `]]` interno fechava o marcador externo e o JSON chegava truncado (args_invalidos).
 */
function* marcadores(prompt: string): Generator<{ tipo: string; corpo: string }> {
  let i = 0;
  while (i < prompt.length) {
    const inicio = prompt.indexOf("[[", i);
    if (inicio === -1) return;
    const m = ABERTURA.exec(prompt.slice(inicio));
    // Linha citada ("> …") é contexto que o turno recebe de volta (a descrição da tarefa no turno da resposta,
    // NOD-442), não roteiro: um modelo de verdade não refaz o que lê citado.
    const linha = prompt.lastIndexOf("\n", inicio - 1) + 1;
    if (m && prompt.startsWith("> ", linha)) {
      i = inicio + 2;
      continue;
    }
    if (!m) {
      i = inicio + 2;
      continue;
    }
    let profundidade = 1;
    let j = inicio + 2;
    while (j < prompt.length && profundidade > 0) {
      if (prompt.startsWith("[[", j)) {
        profundidade += 1;
        j += 2;
      } else if (prompt.startsWith("]]", j)) {
        profundidade -= 1;
        j += 2;
      } else j += 1;
    }
    if (profundidade !== 0) return;
    yield { tipo: m[1] ?? "", corpo: prompt.slice(inicio + m[0].length, j - 2) };
    i = j;
  }
}

export function interpretarRoteiro(prompt: string): Roteiro {
  const passos: PassoRoteiro[] = [];
  for (const m of marcadores(prompt)) {
    const tipo = m.tipo;
    const corpo = m.corpo.trim();
    if (tipo === "delta") passos.push({ tipo: "delta", texto: corpo });
    else if (tipo === "texto") passos.push({ tipo: "texto", texto: corpo });
    else if (tipo === "custo") passos.push({ tipo: "custo", custoUsd: Number(corpo) || 0 });
    else if (tipo === "falha") passos.push({ tipo: "falha", subtype: corpo || "error_during_execution" });
    else if (tipo === "espera") passos.push({ tipo: "espera", ms: Math.min(ESPERA_MAX_MS, Math.max(0, Math.floor(Number(corpo) || 0))) });
    else if (tipo === "negada") {
      if (corpo) passos.push({ tipo: "negada", nome: corpo });
    }
    else if (tipo === "sessao") {
      if (UUID.test(corpo)) passos.push({ tipo: "sessao", id: corpo });
    }
    else if (tipo === "tool") {
      const espaco = corpo.search(/\s/);
      const nome = espaco === -1 ? corpo : corpo.slice(0, espaco);
      let input: Record<string, unknown> = {};
      if (espaco !== -1) {
        try {
          const lido: unknown = JSON.parse(corpo.slice(espaco).trim());
          if (typeof lido === "object" && lido !== null && !Array.isArray(lido)) input = lido as Record<string, unknown>;
        } catch {
          input = {};
        }
      }
      passos.push({ tipo: "tool_use", nome, input });
    }
  }
  return { passos };
}

/** As ferramentas que o roteiro diz que o CLI negou (`[[negada: …]]`), na ordem. */
export function negadasDoRoteiro(roteiro: Roteiro): string[] {
  return roteiro.passos.flatMap((p) => (p.tipo === "negada" ? [p.nome] : []));
}

/** O `[[sessao: …]]` do roteiro (o último vale), ou null. */
export function sessaoDoRoteiro(roteiro: Roteiro): string | null {
  let id: string | null = null;
  for (const p of roteiro.passos) if (p.tipo === "sessao") id = p.id;
  return id;
}

/** Roteiro default do catcher: um delta descritivo + result custo 0 (definido em 2026-09-16). */
export function roteiroPadrao(entrada: { prompt: string; ferramentas: readonly string[] }): Roteiro {
  const lidos = interpretarRoteiro(entrada.prompt);
  if (lidos.passos.length > 0) return lidos;
  const texto = `catcher: recebi ${entrada.prompt.length} caracteres; ferramentas: [${[...entrada.ferramentas].sort().join(", ")}]`;
  return { passos: [{ tipo: "delta", texto }, { tipo: "texto", texto }] };
}

/**
 * Converte o roteiro na sequência de EventoStream que um `claude -p` real emitiria (init → deltas/
 * tool_use → result), para o driver falso alimentar `sinks.evento` e `classificarResultado`.
 * O tool_result de cada tool_use vem de `responder` (o servidor de verdade ou um stub do teste).
 */
export function eventosDoRoteiro(
  roteiro: Roteiro,
  ctx: { sessaoCli: string; ferramentas: readonly string[]; modelo: string; responder?: (nome: string, input: Record<string, unknown>) => string },
): EventoStream[] {
  const sessaoCli = sessaoDoRoteiro(roteiro) ?? ctx.sessaoCli;
  const eventos: EventoStream[] = [
    { tipo: "init", sessaoCli, ferramentas: [...ctx.ferramentas], modelo: ctx.modelo, versaoCli: "catcher", apiKeySource: "none" },
  ];
  let texto = "";
  let custoUsd = 0;
  let falha: string | null = null;
  let numTurnos = 1;
  for (const p of roteiro.passos) {
    if (p.tipo === "delta") eventos.push({ tipo: "delta", texto: p.texto });
    else if (p.tipo === "texto") texto = p.texto;
    else if (p.tipo === "custo") custoUsd = p.custoUsd;
    else if (p.tipo === "falha") falha = p.subtype;
    else if (p.tipo === "tool_use") {
      const id = `toolu_catcher_${eventos.length}`;
      eventos.push({ tipo: "tool_use", id, nome: p.nome, input: p.input });
      const resposta = ctx.responder ? ctx.responder(p.nome, p.input) : `catcher: ${p.nome} não executada`;
      eventos.push({ tipo: "tool_result", toolUseId: id, isError: false, texto: resposta });
      numTurnos += 1;
    }
  }
  eventos.push({
    tipo: "result",
    sucesso: falha === null,
    subtype: falha ?? "success",
    sessaoCli,
    texto,
    custoUsd,
    tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 },
    numTurnos,
    negacoesPermissao: negadasDoRoteiro(roteiro), erroCru: null,
  });
  return eventos;
}
