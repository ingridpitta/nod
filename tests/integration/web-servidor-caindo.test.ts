import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { estadoInicial, reduzir, type Estado } from "../../web/estado/reducer.ts";
import { erroDe } from "../../web/lib/erro-da-tela.ts";
import { ESPERAS_MS, TETO_ESPERA_MS } from "../../web/lib/tentar-de-novo.ts";

/** api.ts usa XMLHttpRequest (DOM, fora do tsconfig.server.json que checa tests/): entra por `vi.importActual`. */
type ApiDeTeste = {
  criarApi: (escopo: { tenantId: string; pessoaId: string }) => { frota(): Promise<unknown> };
  observarRede: (o: { falhou(e: unknown): void; voltou(): void } | null) => void;
};
const { criarApi, observarRede } = await vi.importActual<ApiDeTeste>("../../web/lib/api.ts");

/**
 * NOD-215, critério de aceite: com o servidor reiniciando (~5 s fora, como num deploy), um GET em voo não gera banner
 * vermelho — o estado da tela passa por "Reconectando…" (erro de rede) e a chamada conclui sozinha quando o servidor
 * volta, com o aviso sumindo. Servidor HTTP de verdade, `fetch` de verdade e o backoff de verdade (sem relógio falso).
 */
const FORA_MS = 5_000;

function subir(porta = 0): Promise<Server> {
  const s = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ agentes: [], rota: req.url }));
  });
  return new Promise((ok) => s.listen(porta, "127.0.0.1", () => ok(s)));
}

function derrubar(s: Server): Promise<void> {
  s.closeAllConnections();
  return new Promise((ok) => s.close(() => ok()));
}

let servidor: Server | null = null;

afterEach(async () => {
  observarRede(null);
  vi.unstubAllGlobals();
  if (servidor?.listening) await derrubar(servidor);
  servidor = null;
});

describe("web atravessa o servidor caindo e voltando (NOD-215)", () => {
  it("GET em voo conclui sozinho, sem banner vermelho, e o Reconectando… some", async () => {
    // O servidor fora tem de caber no backoff, senão o teste não prova nada.
    expect(FORA_MS).toBeLessThan(ESPERAS_MS.reduce((a, b) => a + b, 0));
    servidor = await subir();
    const porta = (servidor.address() as AddressInfo).port;
    const fetchReal = globalThis.fetch;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => fetchReal(`http://127.0.0.1:${porta}${url}`, init));

    let estado: Estado = { ...estadoInicial, ocupado: true };
    const vistos: (string | null)[] = [];
    observarRede({
      falhou: (e) => {
        const erro = erroDe(e, () => undefined);
        if (erro) estado = reduzir(estado, { tipo: "rede-caiu", erro });
        vistos.push(estado.erro?.codigo ?? null);
      },
      voltou: () => {
        estado = reduzir(estado, { tipo: "rede-voltou" });
        vistos.push(estado.erro?.codigo ?? null);
      },
    });

    const api = criarApi({ tenantId: "t1", pessoaId: "p1" });
    expect(await api.frota()).toMatchObject({ agentes: [] });

    await derrubar(servidor);
    const inicio = Date.now();
    const emVoo = api.frota();
    await new Promise((r) => setTimeout(r, FORA_MS));
    servidor = await subir(porta);

    await expect(emVoo).resolves.toMatchObject({ agentes: [], rota: "/api/t/t1/frota" });
    expect(Date.now() - inicio).toBeLessThan(TETO_ESPERA_MS + 2_000);
    // Passou por "Reconectando…" (só erro de rede, nunca outro código) e terminou limpo.
    expect(vistos).toContain("servidor_indisponivel");
    expect(vistos.every((c) => c === null || c === "servidor_indisponivel")).toBe(true);
    expect(estado.erro).toBeNull();
    expect(estado.ocupado).toBe(true);
  });

  it("servidor fora o tempo todo: desiste dentro do teto com a frase de servidor, não 'confira a conexão'", async () => {
    servidor = await subir();
    const porta = (servidor.address() as AddressInfo).port;
    await derrubar(servidor);
    const fetchReal = globalThis.fetch;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => fetchReal(`http://127.0.0.1:${porta}${url}`, init));
    const inicio = Date.now();
    const erro = await criarApi({ tenantId: "t1", pessoaId: "p1" }).frota().then(() => null, (e: unknown) => e);
    expect(Date.now() - inicio).toBeLessThan(TETO_ESPERA_MS + 2_000);
    expect(erro).toMatchObject({ codigo: "servidor_indisponivel", message: "O servidor está reiniciando. Tentamos de novo sozinhos.", rota: "GET /frota" });
  });
});
