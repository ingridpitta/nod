import { describe, expect, it } from "vitest";
import { FalhaPareamentoWindows, lerPedidoDispositivo, linkDePareamento, parearPorDispositivo } from "../../../../desktop/windows/pareamento.ts";

const pedido = { codigoDispositivo: "dev-123", codigoPessoa: "ABCD-EFGH", intervaloS: 5, prazoS: 60 };
const resp = (status: number, corpo?: unknown) => new Response(corpo === undefined ? null : JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

/** Um servidor falso: o primeiro POST devolve o pedido; as trocas seguem `trocas`, uma por consulta. */
function montar(trocas: (Response | Error)[], o: { primeiro?: Response | Error } = {}) {
  const chamadas: { url: string; corpo: unknown }[] = [];
  const abertos: string[] = [];
  const codigos: string[] = [];
  let agora = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    chamadas.push({ url, corpo: init?.body ? JSON.parse(String(init.body)) : null });
    const r = url.endsWith("/dispositivo") ? (o.primeiro ?? resp(201, pedido)) : (trocas.shift() ?? resp(429));
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  const deps = { servidor: "https://nod.exemplo", nome: "PC-DA-ANA", fetchImpl, abrir: async (u: string) => { abertos.push(u); }, mostrarCodigo: (c: string) => codigos.push(c), esperar: async (ms: number) => { agora += ms; }, agora: () => agora };
  return { deps, chamadas, abertos, codigos };
}

describe("ADA-229: pareamento do app do Windows", () => {
  it("pede com plataforma win32, mostra o código, abre o navegador e devolve a chave no 201", async () => {
    const t = montar([resp(428), resp(201, { chave: "chave-nova" })]);
    await expect(parearPorDispositivo(t.deps)).resolves.toBe("chave-nova");
    expect(t.chamadas[0]).toEqual({ url: "https://nod.exemplo/api/pareamento/dispositivo", corpo: { nome: "PC-DA-ANA", plataforma: "win32" } });
    expect(t.chamadas[1]).toEqual({ url: "https://nod.exemplo/api/pareamento/dispositivo/trocar", corpo: { codigoDispositivo: "dev-123" } });
    expect(t.codigos).toEqual(["ABCD-EFGH"]);
    expect(t.abertos).toEqual(["https://nod.exemplo/?parear-maquina=ABCD-EFGH"]);
  });
  it("5xx, 429 e rede caída seguem tentando; só o 400 encerra como vencido", async () => {
    const t = montar([resp(503), new Error("rede"), resp(429), resp(400)]);
    await expect(parearPorDispositivo(t.deps)).rejects.toMatchObject({ codigo: "vencido" });
    expect(t.chamadas.length).toBe(5);
  });
  it("o prazo vence sem resposta: vencido", async () => {
    const t = montar([]);
    await expect(parearPorDispositivo(t.deps)).rejects.toBeInstanceOf(FalhaPareamentoWindows);
    expect(t.chamadas.length).toBe(1 + 60 / 5);
  });
  it("servidor fora no pedido, recusa e corpo torto", async () => {
    await expect(parearPorDispositivo(montar([], { primeiro: new Error("x") }).deps)).rejects.toMatchObject({ codigo: "servidor_fora" });
    await expect(parearPorDispositivo(montar([], { primeiro: resp(403) }).deps)).rejects.toMatchObject({ codigo: "recusado" });
    await expect(parearPorDispositivo(montar([], { primeiro: resp(201, { codigoPessoa: "x" }) }).deps)).rejects.toMatchObject({ codigo: "servidor_fora" });
    await expect(parearPorDispositivo(montar([resp(201, { chave: "" })]).deps)).rejects.toMatchObject({ codigo: "servidor_fora" });
  });
  it("não abrir o navegador não para o pareamento", async () => {
    const t = montar([resp(201, { chave: "k" })]);
    await expect(parearPorDispositivo({ ...t.deps, abrir: async () => { throw new Error("sem navegador"); } })).resolves.toBe("k");
  });
  it("cancelado para o laço", async () => {
    const t = montar([]);
    await expect(parearPorDispositivo({ ...t.deps, cancelado: () => true })).rejects.toMatchObject({ codigo: "vencido" });
    expect(t.chamadas.length).toBe(1);
  });
  it("lê o pedido com o intervalo entre 1 e 30 s e codifica o link", () => {
    expect(lerPedidoDispositivo({ ...pedido, intervaloS: 600 })?.intervaloS).toBe(30);
    expect(lerPedidoDispositivo({ ...pedido, intervaloS: 0 })).toBeNull();
    expect(linkDePareamento("https://n.x", "A B&C")).toBe("https://n.x/?parear-maquina=A%20B%26C");
  });
});
