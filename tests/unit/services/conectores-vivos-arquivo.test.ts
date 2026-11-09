import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarSubidaComposio } from "../../../src/adapters/integracoes/arquivo-composio.ts";
import { criarConectoresVivos, type ConfigConectorVivo } from "../../../src/services/conectores-vivos.ts";

/**
 * ADR-068 de ponta a ponta no serviço: o bot cita o vídeo do Mac no `s3key`, o servidor pede o link ao Composio, sobe
 * os bytes, troca o caminho pela chave e chama o app pela sessão MCP. O Composio e a sessão MCP são falsos (fetch).
 */
const SESSAO = "https://backend.composio.dev/tool_router/sess_1/mcp";
const LINK = "https://s3.amazonaws.com/composio/upload/abc?assinatura=x";

type Pedido = { url: string; metodo: string; cabecalhos: Record<string, string>; corpo: unknown };

function composioFalso() {
  const pedidos: Pedido[] = [];
  const f: typeof fetch = async (entrada, init) => {
    const url = String(entrada);
    const cabecalhos = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const corpo = init?.body instanceof Uint8Array ? Buffer.from(init.body) : typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    pedidos.push({ url, metodo: init?.method ?? "GET", cabecalhos, corpo });
    if (url.endsWith("/files/upload/request")) return Response.json({ id: "f1", key: "47563/slack/SLACK_UPLOAD/request/abc", new_presigned_url: LINK, metadata: { storage_backend: "s3" } });
    if (url === LINK) return new Response(null, { status: 200 });
    const rpc = corpo as { id?: number; method: string; params?: { arguments?: unknown } };
    if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (rpc.method === "initialize") return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "composio" } } });
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: `enviado: ${JSON.stringify(rpc.params?.arguments)}` }] } });
  };
  return { f, pedidos };
}

describe("arquivo do Mac na chamada do app (ADR-068)", () => {
  let dir: string;
  let video: string;
  const BYTES = Buffer.from("webm-falso-de-qa");
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nod-arquivo-"));
    video = join(dir, "filtros-desktop.webm");
    await writeFile(video, BYTES);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const vivosCom = (c: ReturnType<typeof composioFalso>, extra: { subir?: boolean; transporte?: "http" | "stdio" } = {}) => criarConectoresVivos({
    agora: () => 0,
    fetchImpl: c.f,
    carregar: async (): Promise<ConfigConectorVivo> => extra.transporte === "stdio"
      ? { nome: "github", transporte: "stdio", comando: "node", args: [], url: null, env: {} }
      : { nome: "slack", transporte: "http", url: SESSAO, env: { "x-api-key": "ck_teste" } },
    ...(extra.subir === false ? {} : { subirArquivo: criarSubidaComposio({ fetchImpl: c.f, home: dir }) }),
  });

  it("sobe o vídeo (link do Composio + PUT dos bytes) e chama o app com a chave no lugar do caminho", async () => {
    const c = composioFalso();
    const vivos = vivosCom(c);
    const r = await vivos.chamar("k1", "SLACK_UPLOAD_OR_CREATE_A_FILE_IN_SLACK", { channels: "C1", initial_comment: "QA da 86akr9u9u", file: { name: "", mimetype: "", s3key: video } });
    expect(r.isError).toBe(false);
    const [pedido, envio] = c.pedidos;
    expect(pedido).toMatchObject({ url: "https://backend.composio.dev/api/v3.1/files/upload/request", metodo: "POST", cabecalhos: { "x-api-key": "ck_teste" } });
    expect(pedido!.corpo).toEqual({ toolkit_slug: "slack", tool_slug: "SLACK_UPLOAD_OR_CREATE_A_FILE_IN_SLACK", filename: "filtros-desktop.webm", mimetype: "video/webm", md5: createHash("md5").update(BYTES).digest("hex") });
    expect(envio).toMatchObject({ url: LINK, metodo: "PUT", cabecalhos: { "content-type": "video/webm" } });
    expect(Buffer.compare(envio!.corpo as Buffer, BYTES)).toBe(0);
    const chamada = c.pedidos.find((p) => (p.corpo as { method?: string })?.method === "tools/call");
    expect((chamada!.corpo as { params: { arguments: unknown } }).params.arguments).toEqual({ channels: "C1", initial_comment: "QA da 86akr9u9u", file: { name: "filtros-desktop.webm", mimetype: "video/webm", s3key: "47563/slack/SLACK_UPLOAD/request/abc" } });
    await vivos.fechar();
  });

  it("~/ é a home da pessoa; o mesmo arquivo citado duas vezes sobe uma vez", async () => {
    const c = composioFalso();
    const vivos = vivosCom(c);
    const r = await vivos.chamar("k1", "SLACK_UPLOAD_OR_CREATE_A_FILE_IN_SLACK", { file: [{ name: "a.webm", mimetype: "video/webm", s3key: "~/filtros-desktop.webm" }, { name: "b.webm", mimetype: "video/webm", s3key: "~/filtros-desktop.webm" }] });
    expect(r.isError).toBe(false);
    expect(c.pedidos.filter((p) => p.url.endsWith("/files/upload/request"))).toHaveLength(1);
    await vivos.fechar();
  });

  it("problema com o arquivo volta como erro legível ao modelo, sem chamar o app nem subir nada", async () => {
    for (const [args, trecho, extra] of [
      [{ file: { name: "x", mimetype: "video/webm", s3key: join(dir, "nao-existe.webm") } }, "não achei o arquivo", {}],
      [{ file: { name: "id", mimetype: "text/plain", s3key: "/Users/m/.ssh/id_ed25519" } }, "credencial", {}],
      [{ file: { name: "x", mimetype: "video/webm", s3key: video } }, "servidor que não alcança", { subir: false }],
      [{ file: { name: "x", mimetype: "video/webm", s3key: video } }, "não recebe arquivo do Mac", { transporte: "stdio" }],
    ] as const) {
      const c = composioFalso();
      const vivos = vivosCom(c, extra);
      const r = await vivos.chamar("k1", "SLACK_UPLOAD_OR_CREATE_A_FILE_IN_SLACK", args as Record<string, unknown>);
      expect(r.isError, trecho).toBe(true);
      expect(r.conteudo, trecho).toContain(trecho);
      expect(c.pedidos, trecho).toHaveLength(0);
      await vivos.fechar();
    }
  });

  it("chave do Composio (arquivo que veio de outro app) segue direto, sem subida", async () => {
    const c = composioFalso();
    const vivos = vivosCom(c);
    await vivos.chamar("k1", "SLACK_UPLOAD_OR_CREATE_A_FILE_IN_SLACK", { file: { name: "x.pdf", mimetype: "application/pdf", s3key: "47563/gmail/GET_ATTACHMENT/response/1" } });
    expect(c.pedidos.some((p) => p.url.endsWith("/files/upload/request"))).toBe(false);
    await vivos.fechar();
  });
});
