import type { Readable, Writable } from "node:stream";
import { ehPontoDeEntrada } from "../../../shared/entrada.ts";
import { CAPACIDADES_GITHUB } from "../../../contracts/github.ts";
import { ArgumentoGithubInvalido, ehCapacidadeGithub, validarArgsGithub } from "../../../domain/github.ts";
import { PROTOCOLO_MCP } from "../../mcp-proxy/cliente-mcp.ts";
import { cortar } from "../../mcp-proxy/corte.ts";
import { CODIGO, erro, interpretar, resposta } from "../../mcp-proxy/jsonrpc.ts";
import { criarLineSplitter } from "../../mcp-proxy/line-splitter.ts";
import { criarBackendComposio } from "./backend-composio.ts";
import { criarBackendRest } from "./backend-rest.ts";
import type { BackendGithub } from "./capacidades.ts";
import { ErroGithub, mensagemErroGithub } from "./erros.ts";

/**
 * Servidor MCP stdio do conector nativo `github` (ADR-048). JSON-RPC 2.0 puro, sem SDK, no mesmo
 * estilo do proxy: uma linha por mensagem, respostas em ordem. O servidor do nod o spawna como
 * qualquer conector stdio (cliente-mcp.ts), então a sonda, a concessão, a aprovação e a moldura de
 * não confiável continuam no caminho de sempre — este processo só sabe falar com o GitHub.
 *
 * O jeito de conectar chega pelo ambiente (NOD_GITHUB_JEITO), escolhido pelo servidor do nod
 * (domain/github.ts): o modelo nunca escolhe nem vê qual é. Sem jeito, tools/list volta vazio e a
 * sonda registra conector_indisponivel. NUNCA escreve fora do JSON-RPC no stdout: é o canal.
 */
export type ServidorGithub = { tratarLinha(linha: string): Promise<string | null>; ligar(entrada: Readable, saida: Writable): Promise<void> };

/**
 * definido em 2026-09-28: sem corte por padrão. O processo é compartilhado entre turnos e não conhece o
 * orçamento do plano; cortar aqui fazia o proxy recortar o que já estava cortado e perder a marca. O proxy
 * é o único ponto de corte (ADR-013), com o resto guardado para `ler_mais`.
 */
export function criarServidorGithub(backend: BackendGithub | null, orcamentoChars = Number.POSITIVE_INFINITY): ServidorGithub {
  let fila: Promise<unknown> = Promise.resolve();
  const disponiveis = new Set(backend?.disponiveis ?? []);

  async function chamar(params: unknown): Promise<unknown> {
    const p = (typeof params === "object" && params !== null ? params : {}) as { name?: unknown; arguments?: unknown };
    const nome = typeof p.name === "string" ? p.name : "";
    const bruto = (typeof p.arguments === "object" && p.arguments !== null && !Array.isArray(p.arguments) ? p.arguments : {}) as Record<string, unknown>;
    const falha = (texto: string) => ({ content: [{ type: "text", text: texto }], isError: true });
    if (!backend || !ehCapacidadeGithub(nome) || !disponiveis.has(nome)) return falha(`capacidade indisponível neste jeito de conectar: ${nome || "(sem nome)"}`);
    try {
      const args = validarArgsGithub(nome, bruto);
      const texto = await backend.executar(args);
      return { content: [{ type: "text", text: cortar(texto, orcamentoChars).texto }] };
    } catch (e) {
      if (e instanceof ArgumentoGithubInvalido) return falha(`${e.message}. Use repositorio no formato dono/nome e numero inteiro.`);
      if (e instanceof ErroGithub) return falha(mensagemErroGithub(e));
      return falha(mensagemErroGithub(new ErroGithub("falha", "gh")));
    }
  }

  async function tratarDentro(linha: string): Promise<string | null> {
    const m = interpretar(linha);
    if (m.tipo === "invalida") return m.motivo === "json_invalido" ? erro(null, CODIGO.parseError, "JSON inválido") : erro(m.id, CODIGO.invalidRequest, "requisição inválida");
    if (m.tipo !== "requisicao") return null;
    switch (m.metodo) {
      case "initialize": {
        const pv = typeof m.params === "object" && m.params !== null ? (m.params as { protocolVersion?: unknown }).protocolVersion : undefined;
        return resposta(m.id, { protocolVersion: typeof pv === "string" ? pv : PROTOCOLO_MCP, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "nod-github", version: "1" } });
      }
      case "ping":
        return resposta(m.id, {});
      case "tools/list":
        return resposta(m.id, {
          tools: CAPACIDADES_GITHUB.filter((c) => disponiveis.has(c.nome)).map((c) => ({ name: c.nome, description: c.descricao, inputSchema: c.schema, annotations: { readOnlyHint: c.readOnlyHint } })),
        });
      case "tools/call":
        return resposta(m.id, await chamar(m.params));
      default:
        return erro(m.id, CODIGO.methodNotFound, `método não suportado: ${m.metodo}`);
    }
  }

  function tratarLinha(linha: string): Promise<string | null> {
    const r = fila.then(() => tratarDentro(linha));
    fila = r.catch(() => undefined);
    return r;
  }

  return {
    tratarLinha,
    ligar(entrada, saida) {
      const splitter = criarLineSplitter();
      const escrever = (l: string | null) => {
        if (l !== null) saida.write(`${l}\n`);
      };
      const tratar = (l: string) => tratarLinha(l).then(escrever, () => escrever(erro(null, CODIGO.internalError, "falha interna")));
      return new Promise<void>((resolve) => {
        entrada.on("data", (chunk: Buffer | string) => {
          for (const l of splitter.alimentar(chunk)) void tratar(l);
        });
        entrada.on("end", () => {
          for (const l of splitter.encerrar()) void tratar(l);
          void fila.then(() => resolve());
        });
      });
    },
  };
}

/**
 * O backend a partir do ambiente que o servidor do nod montou (nativo.ts). Só os jeitos DO SERVIDOR
 * (token, App, Composio): o gh roda na máquina do turno (maquina.ts), nunca neste processo.
 */
export function backendDoAmbiente(env: Readonly<Record<string, string | undefined>>): BackendGithub | null {
  const jeito = env.NOD_GITHUB_JEITO;
  if ((jeito === "token" || jeito === "app") && env.NOD_GITHUB_TOKEN) return criarBackendRest({ jeito, token: env.NOD_GITHUB_TOKEN, base: env.NOD_GITHUB_API });
  if (jeito === "composio" && env.NOD_COMPOSIO_URL && env.NOD_COMPOSIO_CHAVE) return criarBackendComposio({ url: env.NOD_COMPOSIO_URL, chave: env.NOD_COMPOSIO_CHAVE });
  return null;
}

export async function main(env: Readonly<Record<string, string | undefined>> = process.env): Promise<void> {
  await criarServidorGithub(backendDoAmbiente(env)).ligar(process.stdin, process.stdout);
}

if (ehPontoDeEntrada(import.meta.url)) {
  void main().then(() => process.exit(0));
}
