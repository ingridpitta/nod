import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarBackendRest } from "../../../src/adapters/conectores-locais/github/backend-rest.ts";
import { configGithubNativo } from "../../../src/adapters/conectores-locais/github/nativo.ts";
import { criarServidorGithub } from "../../../src/adapters/conectores-locais/github/servidor.ts";
import { criarClienteMcp } from "../../../src/adapters/mcp-proxy/cliente-mcp.ts";

/**
 * O backend REST (token pessoal e token de instalação do App) contra um GitHub FALSO em porta 0:
 * cabeçalhos, corpo do POST, e cada status virando a frase do que fazer.
 */
type Pedido = { metodo: string; url: string; auth: string | undefined; accept: string | undefined; corpo: string };
const pedidos: Pedido[] = [];
let modo: "ok" | "401" | "403" | "cota" | "404" | "301" = "ok";
let srv: Server;
let base: string;

function ler(req: IncomingMessage): Promise<string> {
  return new Promise((r) => {
    let s = "";
    req.on("data", (c: Buffer) => (s += c.toString("utf8")));
    req.on("end", () => r(s));
  });
}

beforeAll(async () => {
  srv = createServer(async (req, res) => {
    pedidos.push({ metodo: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, accept: req.headers.accept, corpo: await ler(req) });
    if (modo === "401") { res.writeHead(401).end("{}"); return; }
    if (modo === "403") { res.writeHead(403).end("{}"); return; }
    if (modo === "cota") { res.writeHead(403, { "x-ratelimit-remaining": "0" }).end("{}"); return; }
    if (modo === "404") { res.writeHead(404).end("{}"); return; }
    if (modo === "301") { res.writeHead(301, { location: "https://api.github.com/repositories/1/pulls/7" }).end(); return; }
    const u = req.url ?? "";
    if (u === "/repos/acme/nod/pulls/7" && req.headers.accept === "application/vnd.github.diff") { res.end("diff --git a/x b/x\n+oi\n"); return; }
    if (u === "/repos/acme/nod/pulls/7") { res.end(JSON.stringify({ number: 7, title: "PR", state: "open", user: { login: "bruno" }, head: { ref: "f", sha: "abcdef1" }, base: { ref: "main" } })); return; }
    if (u === "/repos/acme/nod/commits/abcdef1/check-runs?per_page=100") { res.end(JSON.stringify({ check_runs: [{ name: "ci", status: "completed", conclusion: "success", html_url: "h" }] })); return; }
    if (u === "/repos/acme/nod/pulls/7/reviews" && req.method === "POST") { res.end(JSON.stringify({ state: "APPROVED", user: { login: "marlon" }, html_url: "r" })); return; }
    if (u.startsWith("/repos/acme/nod/contents/src/a%20b.ts?ref=feat%2Fx")) { res.end("conteúdo"); return; }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => srv.close(() => r())));

async function chamar(nome: string, args: Record<string, unknown>, jeito: "token" | "app" = "token"): Promise<{ texto: string; isError: boolean }> {
  const s = criarServidorGithub(criarBackendRest({ jeito, token: "ghp_segredo", base }));
  const linha = await s.tratarLinha(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: nome, arguments: args } }));
  const r = (JSON.parse(linha ?? "{}") as { result: { content: { text: string }[]; isError?: boolean } }).result;
  return { texto: r.content[0]?.text ?? "", isError: r.isError === true };
}

/**
 * medido em 2026-09-24: sob a suíte inteira com outra suíte rodando na mesma máquina, spawnar o
 * servidor stdio + o gh falso passou dos 5 s padrão do projeto unit (4 de 779 testes, uma rodada em
 * três). O teto por teste sobe só aqui, onde há processo de verdade.
 */
const PROCESSO = { timeout: 20_000 };

describe("backend REST do conector github (ADR-048)", PROCESSO, () => {
  it("token no cabeçalho, nunca na URL; checks seguem o head do PR; revisão manda o evento em maiúsculas", async () => {
    modo = "ok";
    pedidos.length = 0;
    expect(JSON.parse((await chamar("pr_checks", { repositorio: "acme/nod", numero: 7 })).texto)).toEqual({ head_sha: "abcdef1", checks: [{ nome: "ci", estado: "completed", conclusao: "success", url: "h" }] });
    expect(pedidos.map((p) => p.url)).toEqual(["/repos/acme/nod/pulls/7", "/repos/acme/nod/commits/abcdef1/check-runs?per_page=100"]);
    expect(pedidos.every((p) => p.auth === "Bearer ghp_segredo" && !p.url.includes("ghp_"))).toBe(true);
    expect(JSON.parse((await chamar("pr_revisar", { repositorio: "acme/nod", numero: 7, evento: "approve" })).texto)).toEqual({ ok: true, estado: "APPROVED", autor: "marlon", url: "r" });
    expect(JSON.parse(pedidos.at(-1)?.corpo ?? "")).toEqual({ event: "APPROVE" });
    expect((await chamar("pr_diff", { repositorio: "acme/nod", numero: 7 })).texto).toContain("+oi");
    expect((await chamar("arquivo_ler", { repositorio: "acme/nod", caminho: "src/a b.ts", ref: "feat/x" })).texto).toBe("conteúdo");
  });

  it("cada status vira a frase do que fazer, e a do token é diferente da do App", async () => {
    modo = "401";
    expect(await chamar("pr_ver", { repositorio: "acme/nod", numero: 7 })).toEqual({ isError: true, texto: expect.stringContaining("recusou o token pessoal") });
    expect(await chamar("pr_ver", { repositorio: "acme/nod", numero: 7 }, "app")).toEqual({ isError: true, texto: expect.stringContaining("GitHub App da organização") });
    modo = "403";
    expect((await chamar("pr_ver", { repositorio: "acme/nod", numero: 7 })).texto).toContain("Sem permissão neste repositório");
    modo = "cota";
    expect((await chamar("pr_ver", { repositorio: "acme/nod", numero: 7 })).texto).toContain("rate limit");
    modo = "404";
    expect((await chamar("issue_ver", { repositorio: "acme/nod", numero: 9 })).texto).toContain("não encontrado");
    // Repositório renomeado: não segue o redirect (o token não vai a outra URL) e diz o que houve.
    modo = "301";
    pedidos.length = 0;
    expect((await chamar("pr_ver", { repositorio: "acme/nod", numero: 7 })).texto).toContain("renomeado ou transferido");
    expect(pedidos).toHaveLength(1);
  });

  it("o processo de verdade, montado pela composição com o token do env cifrado, fala com a mesma API", async () => {
    modo = "ok";
    const r = configGithubNativo({ envConector: { GITHUB_TOKEN: "ghp_segredo" }, app: null, rotina: false, ambiente: { PATH: "/usr/bin:/bin", HOME: "/tmp" }, apiBase: base });
    if (!r.ok) throw new Error("jeito");
    expect(r.cfg.jeito).toBe("token");
    const cliente = criarClienteMcp({ nome: "github", transporte: "stdio", comando: r.cfg.comando, args: r.cfg.args, env: r.cfg.env, timeoutMs: 10_000 });
    try {
      const pr = await cliente.chamar("pr_ver", { repositorio: "acme/nod", numero: 7 });
      expect(JSON.parse(pr.conteudo)).toMatchObject({ numero: 7, autor: "bruno", head_sha: "abcdef1" });
    } finally {
      await cliente.fechar();
    }
  });
});
