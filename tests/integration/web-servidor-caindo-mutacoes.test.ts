import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { estadoInicial, reduzir, type Estado } from "../../web/estado/reducer.ts";
import { acaoDoErro, detalhesDoErro, erroDaAcao, erroDe } from "../../web/lib/erro-da-tela.ts";

type ApiDeTeste = {
  criarApi: (escopo: { tenantId: string; pessoaId: string }) => {
    frota(): Promise<unknown>;
    enviar(c: string, t: string, a?: readonly string[], id?: string): Promise<unknown>;
    criarAgente(nome?: string): Promise<unknown>;
    telemetriaLinhas(ev: readonly unknown[]): Promise<unknown>;
  };
  observarRede: (o: { falhou(e: unknown): void; voltou(): void } | null) => void;
};
const { criarApi, observarRede } = await vi.importActual<ApiDeTeste>("../../web/lib/api.ts");

type Modo = "ok" | "proxy503";
let modo: Modo = "ok";
const recebidos: { metodo: string; url: string; corpo: string }[] = [];
const ler = (req: IncomingMessage) => new Promise<string>((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b)); });

function subir(porta = 0): Promise<Server> {
  const s = createServer(async (req, res) => {
    const corpo = await ler(req);
    recebidos.push({ metodo: req.method ?? "", url: req.url ?? "", corpo });
    if (modo === "proxy503") { res.statusCode = 503; res.setHeader("content-type", "text/html"); res.end("<html>503 Service Unavailable</html>"); return; }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, agentes: [] }));
  });
  return new Promise((ok) => s.listen(porta, "127.0.0.1", () => ok(s)));
}
function derrubar(s: Server): Promise<void> { s.closeAllConnections(); return new Promise((ok) => s.close(() => ok())); }

let servidor: Server | null = null;
afterEach(async () => { observarRede(null); vi.unstubAllGlobals(); modo = "ok"; recebidos.length = 0; if (servidor?.listening) await derrubar(servidor); servidor = null; });

async function preparar() {
  servidor = await subir();
  const porta = (servidor.address() as AddressInfo).port;
  const fetchReal = globalThis.fetch;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => fetchReal(`http://127.0.0.1:${porta}${url}`, init));
  return porta;
}

describe("QA NOD-215: queda de ~5 s", () => {
  it("enviar com idEnvio atravessa a queda e o servidor recebe a MESMA chave; POST sem chave cai com 1 tentativa e vira acao_nao_concluida", async () => {
    const porta = await preparar();
    const api = criarApi({ tenantId: "t1", pessoaId: "p1" });
    let estado: Estado = estadoInicial;
    observarRede({ falhou: (e) => { const er = erroDe(e, () => undefined); if (er) estado = reduzir(estado, { tipo: "rede-caiu", erro: er }); }, voltou: () => { estado = reduzir(estado, { tipo: "rede-voltou" }); } });
    await derrubar(servidor!);
    const semChave = await api.criarAgente("x").then(() => null, (e: unknown) => e);
    const er = erroDe(semChave, () => undefined)!;
    const acao = erroDaAcao(er);
    expect(acao.codigo).toBe("acao_nao_concluida");
    expect(acao.mensagem).not.toMatch(/conex/i);
    expect(detalhesDoErro(acao)).toBe("tipo: acao_nao_concluida · causa: servidor_indisponivel · rota: POST /agentes · status: sem resposta");
    estado = reduzir(estado, { tipo: "erro", erro: acao });
    const emVoo = api.enviar("c1", "oi", [], "chave-1");
    await new Promise((r) => setTimeout(r, 5_000));
    servidor = await subir(porta);
    await expect(emVoo).resolves.toMatchObject({ ok: true });
    const posts = recebidos.filter((r) => r.metodo === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]!.corpo)).toEqual({ texto: "oi", idEnvio: "chave-1" });
    // A ação perdida continua no banner: a volta do nod não a apaga.
    expect(estado.erro?.codigo).toBe("acao_nao_concluida");
    estado = reduzir(estado, { tipo: "conexao", estado: "aberto", tentativa: 0, proximaEmMs: null });
    expect(estado.erro?.codigo).toBe("acao_nao_concluida");
  });

  it("proxy respondendo 503 HTML por 5 s: GET repete e conclui; POST sem chave faz 1 requisição", async () => {
    await preparar();
    const api = criarApi({ tenantId: "t1", pessoaId: "p1" });
    const codigos: string[] = [];
    observarRede({ falhou: (e) => codigos.push((e as { codigo: string }).codigo), voltou: () => codigos.push("voltou") });
    modo = "proxy503";
    const emVoo = api.frota();
    const post = await api.criarAgente("y").then(() => null, (e: unknown) => e);
    expect(post).toMatchObject({ codigo: "servidor_indisponivel", status: 503 });
    setTimeout(() => { modo = "ok"; }, 5_000);
    await expect(emVoo).resolves.toMatchObject({ ok: true });
    expect(recebidos.filter((r) => r.metodo === "POST")).toHaveLength(1);
    expect(recebidos.filter((r) => r.metodo === "GET").length).toBeGreaterThanOrEqual(3);
    expect(codigos.at(-1)).toBe("voltou");
    expect(codigos.filter((c) => c !== "voltou").every((c) => c === "servidor_indisponivel")).toBe(true);
  });

  it("sem internet: frase de sem internet; telemetria caindo não acende aviso", async () => {
    await preparar();
    await derrubar(servidor!);
    vi.stubGlobal("navigator", { onLine: false });
    const api = criarApi({ tenantId: "t1", pessoaId: "p1" });
    let chamadas = 0;
    observarRede({ falhou: () => { chamadas++; }, voltou: () => { chamadas++; } });
    await api.telemetriaLinhas([]).catch(() => undefined);
    expect(chamadas).toBe(0);
    const e = await api.criarAgente().then(() => null, (x: unknown) => x);
    expect(e).toMatchObject({ codigo: "sem_internet", message: "Seu dispositivo está sem internet. Assim que voltar, tentamos de novo." });
    expect(acaoDoErro(erroDe(e, () => undefined)!).tipo).toBe("rede-caiu");
  });
});
