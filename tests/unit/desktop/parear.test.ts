import { afterEach, describe, expect, it, vi } from "vitest";
import { FalhaPareamento, parearPeloNavegador, urlDePareamento } from "../../../desktop/parear.ts";
import { desafioDe } from "../../../src/services/pareamento-maquina.ts";

/**
 * O "navegador" do teste: lê o pedido da URL que o app abriu e chama o retorno no 127.0.0.1. `retorno` é o status
 * HTTP que o app respondeu ao navegador.
 * NOD-198: antes era um `void fetch(...)` solto. Sob carga, no teste do estado errado o prazo de 300 ms do app vencia
 * antes de o fetch conectar: o teste passava sem exercitar o estado errado e a rejeição (ECONNRESET na porta já
 * fechada) virava "Unhandled Rejection" no `test:unit` inteiro (medido em 2026-10-08, 1 de 2 execuções paralelas).
 * Agora o fetch tem dono e o teste espera o evento (a resposta) em vez do relógio.
 */
function navegador(responder: (pedido: URL) => string | null) {
  let entregar!: (r: Promise<number>) => void;
  const retorno = new Promise<number>((r) => { entregar = r; });
  const abrir = async (url: string) => {
    const pedido = new URL(url);
    const codigo = responder(pedido);
    const porta = pedido.searchParams.get("porta");
    const estado = codigo === null ? "estado-errado-estado-errado" : pedido.searchParams.get("estado") ?? "";
    const r = fetch(`http://127.0.0.1:${porta}/retorno?estado=${encodeURIComponent(estado)}&codigo=${encodeURIComponent(codigo ?? "x")}`)
      .then(async (res) => { await res.arrayBuffer(); return res.status; });
    r.catch(() => {}); // quem confere é o teste, via `retorno`; o app só olha a rejeição de `abrir`, não esta
    entregar(r);
  };
  return { abrir, retorno };
}

afterEach(() => { vi.useRealTimers(); });

describe("pareamento pelo navegador, lado do app (ADR-069)", () => {
  it("a URL leva porta, estado, desafio e nome, e não leva verificador", () => {
    const u = new URL(urlDePareamento("https://nod.acme.com.br", { porta: 50000, estado: "e".repeat(32), desafio: "d".repeat(43), nome: "MacBook" }));
    expect(u.origin).toBe("https://nod.acme.com.br");
    expect(Object.fromEntries(u.searchParams)).toEqual({ "parear-mac": "1", porta: "50000", estado: "e".repeat(32), desafio: "d".repeat(43), nome: "MacBook" });
  });

  it("recebe o código no 127.0.0.1 e troca com o verificador cujo sha256 é o desafio da URL", async () => {
    let desafio = "";
    let enviado: { codigo: string; verificador: string } | null = null;
    const nav = navegador((p) => { desafio = p.searchParams.get("desafio") ?? ""; return "c".repeat(43); });
    const chave = await parearPeloNavegador({
      servidor: "https://nod.acme.com.br",
      nome: "MacBook",
      abrir: nav.abrir,
      fetchImpl: (async (url: URL, init: RequestInit) => {
        expect(String(url)).toBe("https://nod.acme.com.br/api/pareamento/trocar");
        enviado = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ chave: "a.b" }), { status: 201 });
      }) as typeof fetch,
    });
    expect(chave).toBe("a.b");
    expect(enviado!.codigo).toBe("c".repeat(43));
    expect(desafioDe(enviado!.verificador)).toBe(desafio);
    expect(await nav.retorno).toBe(200);
  });

  it("retorno com estado errado não conta: sem o certo, o prazo vence", async () => {
    // NOD-198: o prazo do app corre em relógio falso e só avança DEPOIS que o app respondeu 400 ao retorno errado,
    // então o teste prova que o retorno errado chegou e não contou, com qualquer carga na máquina.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const nav = navegador(() => null);
    const pareamento = parearPeloNavegador({ servidor: "https://nod.acme.com.br", nome: "MacBook", abrir: nav.abrir, prazoMs: 300 });
    pareamento.catch(() => {}); // conferido abaixo; evita a rejeição sem dono enquanto o retorno não chega
    expect(await nav.retorno).toBe(400);
    vi.advanceTimersByTime(300);
    await expect(pareamento).rejects.toEqual(new FalhaPareamento("sem_resposta"));
  });

  it("troca recusada pelo servidor vira 'recusado'", async () => {
    const nav = navegador(() => "c".repeat(43));
    await expect(parearPeloNavegador({
      servidor: "https://nod.acme.com.br",
      nome: "MacBook",
      abrir: nav.abrir,
      fetchImpl: (async () => new Response("{}", { status: 400 })) as typeof fetch,
    })).rejects.toEqual(new FalhaPareamento("recusado"));
    expect(await nav.retorno).toBe(200);
  });
});
