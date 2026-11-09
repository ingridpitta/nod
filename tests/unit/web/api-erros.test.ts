import { afterEach, describe, expect, it, vi } from "vitest";
import { ErroApi, FRASE_SEM_INTERNET, FRASE_SERVIDOR_INDISPONIVEL, rotaDe } from "../../../web/lib/erro-api.ts";

/**
 * api.ts usa XMLHttpRequest (DOM) e o tsconfig.server.json, que checa tests/, não tem a lib DOM: o módulo entra por
 * `vi.importActual` (o tsc não segue), como em trabalhos.test.ts; o tipo é só o que estes testes chamam.
 */
type ApiDeTeste = {
  criarApi: (escopo: { tenantId: string; pessoaId: string }) => {
    frota(): Promise<unknown>;
    marcarLida(id: string): Promise<unknown>;
    enviar(id: string, texto: string, anexos?: readonly string[], idEnvio?: string): Promise<unknown>;
    organizarAgente(id: string, campos: { fixado?: boolean }): Promise<unknown>;
    excluirAgente(id: string): Promise<unknown>;
    gravarPreferencias(p: { modoDev?: boolean }): Promise<unknown>;
    telemetriaLinhas(eventos: readonly unknown[]): Promise<unknown>;
    subirAnexo(conversaId: string, arquivo: { name: string }, mime: string): Promise<unknown>;
  };
  observarRede: (o: { falhou(e: unknown): void; voltou(): void } | null) => void;
};
const { criarApi, observarRede } = await vi.importActual<ApiDeTeste>("../../../web/lib/api.ts");

/**
 * NOD-215: a falha de transporte diz a causa. O retry real dorme (0,5 s + 2 s + 6 s): aqui o relógio é falso e
 * avança sozinho até a promessa assentar.
 */
const escopo = { tenantId: "t1", pessoaId: "p1" };

async function assentar<T>(p: Promise<T>): Promise<{ ok: T } | { erro: unknown }> {
  const r = p.then((ok) => ({ ok }), (erro: unknown) => ({ erro }));
  await vi.runAllTimersAsync();
  return r;
}

function online(valor: boolean): void {
  vi.stubGlobal("navigator", { onLine: valor });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  observarRede(null);
});

describe("classificação da falha em pedir() (NOD-215)", () => {
  it("fetch rejeitado com onLine false → sem_internet; com onLine true → servidor_indisponivel", async () => {
    vi.useFakeTimers();
    for (const [linha, codigo, frase] of [[false, "sem_internet", FRASE_SEM_INTERNET], [true, "servidor_indisponivel", FRASE_SERVIDOR_INDISPONIVEL]] as const) {
      online(linha);
      vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch"); });
      const r = await assentar(criarApi(escopo).frota());
      expect("erro" in r).toBe(true);
      const e = (r as { erro: ErroApi }).erro;
      expect(e).toBeInstanceOf(ErroApi);
      expect(e).toMatchObject({ status: 0, codigo, message: frase, rota: "GET /frota" });
      expect(e.message).not.toMatch(/Failed to fetch|confira a conexão/i);
    }
  });

  it("502/503/504 sem corpo do nod viram servidor_indisponivel", async () => {
    vi.useFakeTimers();
    online(true);
    for (const status of [502, 503, 504]) {
      vi.stubGlobal("fetch", async () => new Response("<html>Bad Gateway</html>", { status }));
      const r = await assentar(criarApi(escopo).frota());
      expect((r as { erro: ErroApi }).erro).toMatchObject({ status, codigo: "servidor_indisponivel", message: FRASE_SERVIDOR_INDISPONIVEL });
    }
  });

  it("503 com corpo do nod mantém o código do servidor (e não repete)", async () => {
    online(true);
    let chamadas = 0;
    vi.stubGlobal("fetch", async () => { chamadas++; return new Response(JSON.stringify({ codigo: "manutencao", mensagem: "Em manutenção.", correlation_id: "cid-1" }), { status: 503 }); });
    await expect(criarApi(escopo).frota()).rejects.toMatchObject({ status: 503, codigo: "manutencao", message: "Em manutenção.", correlationId: "cid-1", rota: "GET /frota" });
    expect(chamadas).toBe(1);
  });

  it("ErroApi normal segue como veio", async () => {
    online(true);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ codigo: "nao_encontrado", mensagem: "Não achei.", correlation_id: "c2" }), { status: 404 }));
    await expect(criarApi(escopo).frota()).rejects.toMatchObject({ status: 404, codigo: "nao_encontrado", message: "Não achei.", correlationId: "c2" });
  });

  it("AbortError sobe como AbortError, sem virar falha de rede", async () => {
    online(true);
    const abort = new DOMException("cancelado", "AbortError");
    vi.stubGlobal("fetch", async () => { throw abort; });
    await expect(criarApi(escopo).frota()).rejects.toBe(abort);
  });

  it("a rota vai sem o tenant e sem query", () => {
    expect(rotaDe("get", "/api/t/abc-123/conversas/c9/mensagens?depois=5")).toBe("GET /conversas/c9/mensagens");
    expect(rotaDe("POST", "/api/sessao/entrar")).toBe("POST /api/sessao/entrar");
  });
});

describe("nova tentativa nas chamadas da api (NOD-215)", () => {
  it("GET atravessa o servidor caindo e conclui; o observador vê a falha e a volta", async () => {
    vi.useFakeTimers();
    online(true);
    const falhou = vi.fn();
    const voltou = vi.fn();
    observarRede({ falhou, voltou });
    let chamadas = 0;
    vi.stubGlobal("fetch", async () => {
      chamadas++;
      if (chamadas <= 2) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ agentes: [] }));
    });
    const r = await assentar(criarApi(escopo).frota());
    expect(r).toEqual({ ok: { agentes: [] } });
    expect(chamadas).toBe(3);
    expect(falhou).toHaveBeenCalledTimes(2);
    expect(voltou).toHaveBeenCalledTimes(1);
  });

  it("POST/PATCH/PUT/DELETE sem chave de idempotência fazem EXATAMENTE 1 fetch (rejeitado ou 502 de proxy)", async () => {
    vi.useFakeTimers();
    online(true);
    const api = criarApi(escopo);
    const chamadas: Array<[string, () => Promise<unknown>]> = [
      ["POST", () => api.marcarLida("c1")],
      ["POST", () => api.enviar("c1", "oi")],
      ["POST", () => api.enviar("c1", "oi", [], "")],
      ["PATCH", () => api.organizarAgente("a1", { fixado: true })],
      ["PUT", () => api.gravarPreferencias({ modoDev: true })],
      ["DELETE", () => api.excluirAgente("a1")],
    ];
    for (const falha of [() => Promise.reject(new TypeError("Failed to fetch")), () => Promise.resolve(new Response("<html>Bad Gateway</html>", { status: 502 }))]) {
      for (const [metodo, chamar] of chamadas) {
        const fetchs: string[] = [];
        vi.stubGlobal("fetch", (_url: string, init: RequestInit) => { fetchs.push(String(init.method)); return falha(); });
        const r = await assentar(chamar());
        expect((r as { erro: ErroApi }).erro).toMatchObject({ codigo: "servidor_indisponivel" });
        expect(fetchs).toEqual([metodo]);
      }
    }
  });

  it("enviar com idEnvio repete com a MESMA chave", async () => {
    vi.useFakeTimers();
    online(true);
    const corpos: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      corpos.push(JSON.parse(String(init.body)));
      if (corpos.length < 3) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ ok: true, ids: {} }));
    });
    const r = await assentar(criarApi(escopo).enviar("c1", "oi", [], "chave-1"));
    expect(r).toEqual({ ok: { ok: true, ids: {} } });
    expect(corpos).toEqual([{ texto: "oi", idEnvio: "chave-1" }, { texto: "oi", idEnvio: "chave-1" }, { texto: "oi", idEnvio: "chave-1" }]);
  });
});

describe("revisão NOD-215: o que não acende o aviso e o upload", () => {
  it("depois de a leitura desistir, a próxima chamada que dá certo avisa que a rede voltou", async () => {
    vi.useFakeTimers();
    online(true);
    const falhou = vi.fn();
    const voltou = vi.fn();
    observarRede({ falhou, voltou });
    vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch"); });
    const api = criarApi(escopo);
    expect("erro" in (await assentar(api.frota()))).toBe(true);
    expect(voltou).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ agentes: [] })));
    await assentar(api.frota());
    expect(voltou).toHaveBeenCalledTimes(1);
  });

  it("a telemetria (chamada de fundo) não acende o 'Reconectando…' nem repete", async () => {
    online(true);
    const falhou = vi.fn();
    const voltou = vi.fn();
    observarRede({ falhou, voltou });
    let chamadas = 0;
    vi.stubGlobal("fetch", async () => { chamadas++; throw new TypeError("Failed to fetch"); });
    await expect(criarApi(escopo).telemetriaLinhas([])).rejects.toMatchObject({ codigo: "servidor_indisponivel" });
    expect(chamadas).toBe(1);
    expect(falhou).not.toHaveBeenCalled();
  });

  it("upload: 2xx com corpo vazio resolve objeto (não null); onerror faz 1 envio só", async () => {
    online(true);
    const enviados: unknown[] = [];
    let modo: "vazio" | "rede" = "vazio";
    class XhrFalso {
      status = 0;
      responseText = "";
      upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open(): void {}
      setRequestHeader(): void {}
      send(corpo: unknown): void {
        enviados.push(corpo);
        if (modo === "vazio") { this.status = 201; this.responseText = ""; this.onload?.(); }
        else this.onerror?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", XhrFalso);
    const api = criarApi(escopo);
    await expect(api.subirAnexo("c1", { name: "a.txt" }, "text/plain")).resolves.toEqual({});
    modo = "rede";
    await expect(api.subirAnexo("c1", { name: "a.txt" }, "text/plain")).rejects.toMatchObject({ codigo: "servidor_indisponivel", rota: "POST /conversas/c1/anexos" });
    expect(enviados).toHaveLength(2);
  });
});
