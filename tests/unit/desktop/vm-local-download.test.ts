import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { baixarDisco, caminhoDaParte, discoNoCache, lerContentRange, lerSha256, nomeDoDisco, pastaDoCache, type Progresso } from "../../../desktop/vm-local/download.ts";

/** NOD-93 (PR 3): o download do disco da VM local, com Range, fallback 200, retomada e sha256. Servidor falso. */
const tmp = mkdtempSync(join(tmpdir(), "vm-local-dl-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const DISCO = new Uint8Array(Array.from({ length: 10_000 }, (_, i) => (i * 7) % 251));
const SHA = createHash("sha256").update(DISCO).digest("hex");
let n = 0;
const destinoNovo = () => join(tmp, `c${n++}`, "nod-vm-1.0.0-arm64.img.zst");

/** Um corpo em pedaços de 1000 bytes; `cortaEm` faz a conexão cair depois desse tanto. */
function corpo(dados: Uint8Array, cortaEm?: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (cortaEm !== undefined && i >= cortaEm) { c.error(new Error("conexão caiu")); return; }
      if (i >= dados.length) { c.close(); return; }
      c.enqueue(dados.slice(i, i + 1000));
      i += 1000;
    },
  });
}

type Pedido = { range: string | null };
/** Servidor falso: `range` true responde 206 a pedidos com Range; false ignora o Range (200 inteiro). */
function servidor(o: { range: boolean; dados?: Uint8Array; cortaEm?: number; status?: number; contentRange?: string }) {
  const pedidos: Pedido[] = [];
  const buscar = (async (_url: string | URL | Request, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("range");
    pedidos.push({ range });
    const dados = o.dados ?? DISCO;
    if (o.status) return new Response(null, { status: o.status });
    const m = range ? /^bytes=(\d+)-$/.exec(range) : null;
    if (m && o.range) {
      const inicio = Number(m[1]);
      if (inicio >= dados.length) return new Response(null, { status: 416 });
      const cr = o.contentRange ?? `bytes ${inicio}-${dados.length - 1}/${dados.length}`;
      return new Response(corpo(dados.slice(inicio), o.cortaEm), { status: 206, headers: { "content-range": cr } });
    }
    return new Response(corpo(dados, o.cortaEm), { status: 200, headers: { "content-length": String(dados.length) } });
  }) as typeof fetch;
  return { buscar, pedidos };
}

describe("desktop/vm-local/download.ts (NOD-93)", () => {
  it("do zero: 200, grava, confere o sha256 e só então vira o arquivo final (a parte some)", async () => {
    const destino = destinoNovo();
    const { buscar, pedidos } = servidor({ range: true });
    const progresso: Progresso[] = [];
    const r = await baixarDisco({ url: "https://x/d", destino, sha256: SHA, fetch: buscar, aoProgresso: (p) => progresso.push(p) });
    expect(r).toEqual({ tipo: "baixou", bytes: 10_000, retomou: false });
    expect(pedidos).toEqual([{ range: null }]);
    expect(new Uint8Array(readFileSync(destino))).toEqual(DISCO);
    expect(existsSync(caminhoDaParte(destino))).toBe(false);
    expect(progresso.at(-1)).toEqual({ recebidos: 10_000, total: 10_000 });
    expect(await discoNoCache(destino, SHA)).toBe(true);
    expect(await discoNoCache(destino, "0".repeat(64))).toBe(false);
  });

  it("a rede cai no meio: sem_internet, e o que chegou fica na parte", async () => {
    const destino = destinoNovo();
    const r = await baixarDisco({ url: "u", destino, sha256: SHA, fetch: servidor({ range: true, cortaEm: 4000 }).buscar });
    expect(r).toMatchObject({ tipo: "sem_internet", motivo: "conexão caiu" });
    expect(readFileSync(caminhoDaParte(destino)).length).toBe(4000);
    expect(existsSync(destino)).toBe(false);
  });

  it("retomada com 206: pede Range a partir da parte, emenda e confere o sha256 do arquivo inteiro", async () => {
    const destino = destinoNovo();
    await baixarDisco({ url: "u", destino, sha256: SHA, fetch: servidor({ range: true, cortaEm: 4000 }).buscar });
    const { buscar, pedidos } = servidor({ range: true });
    const progresso: Progresso[] = [];
    const r = await baixarDisco({ url: "u", destino, sha256: SHA, fetch: buscar, aoProgresso: (p) => progresso.push(p) });
    expect(pedidos).toEqual([{ range: "bytes=4000-" }]);
    expect(r).toEqual({ tipo: "baixou", bytes: 10_000, retomou: true });
    expect(progresso[0]).toEqual({ recebidos: 5000, total: 10_000 });
    expect(new Uint8Array(readFileSync(destino))).toEqual(DISCO);
  });

  it("servidor sem Range (200 ao pedido com Range): recomeça do zero por cima da parte", async () => {
    const destino = destinoNovo();
    await baixarDisco({ url: "u", destino, sha256: SHA, fetch: servidor({ range: true, cortaEm: 3000 }).buscar });
    const { buscar, pedidos } = servidor({ range: false });
    const r = await baixarDisco({ url: "u", destino, sha256: SHA, fetch: buscar });
    expect(pedidos).toEqual([{ range: "bytes=3000-" }]);
    expect(r).toEqual({ tipo: "baixou", bytes: 10_000, retomou: false });
    expect(new Uint8Array(readFileSync(destino))).toEqual(DISCO);
  });

  it("parte já inteira (416): confere o sha256 e conclui sem baixar nada", async () => {
    const destino = destinoNovo();
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(caminhoDaParte(destino), DISCO);
    const r = await baixarDisco({ url: "u", destino, sha256: SHA, fetch: servidor({ range: true }).buscar });
    expect(r).toEqual({ tipo: "baixou", bytes: 10_000, retomou: true });
  });

  it("206 com faixa que não começa onde a parte parou: apaga a parte e volta como passageiro", async () => {
    const destino = destinoNovo();
    await baixarDisco({ url: "u", destino, sha256: SHA, fetch: servidor({ range: true, cortaEm: 2000 }).buscar });
    const r = await baixarDisco({ url: "u", destino, sha256: SHA, fetch: servidor({ range: true, contentRange: "bytes 0-9999/10000" }).buscar });
    expect(r.tipo).toBe("sem_internet");
    expect(existsSync(caminhoDaParte(destino))).toBe(false);
  });

  it("sha256 ruim: apaga a parte, não cria o final e devolve o hash que veio", async () => {
    const destino = destinoNovo();
    const errado = DISCO.map((b, i) => (i === 5000 ? b ^ 1 : b));
    const r = await baixarDisco({ url: "u", destino, sha256: SHA, fetch: servidor({ range: true, dados: errado }).buscar });
    expect(r).toEqual({ tipo: "sha_ruim", veio: createHash("sha256").update(errado).digest("hex") });
    expect(existsSync(caminhoDaParte(destino))).toBe(false);
    expect(existsSync(destino)).toBe(false);
  });

  it("fetch que lança e 5xx/429 são sem_internet; 404 é falha", async () => {
    const lanca = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    expect(await baixarDisco({ url: "u", destino: destinoNovo(), sha256: SHA, fetch: lanca })).toEqual({ tipo: "sem_internet", motivo: "fetch failed" });
    expect((await baixarDisco({ url: "u", destino: destinoNovo(), sha256: SHA, fetch: servidor({ range: true, status: 503 }).buscar })).tipo).toBe("sem_internet");
    expect((await baixarDisco({ url: "u", destino: destinoNovo(), sha256: SHA, fetch: servidor({ range: true, status: 429 }).buscar })).tipo).toBe("sem_internet");
    expect(await baixarDisco({ url: "u", destino: destinoNovo(), sha256: SHA, fetch: servidor({ range: true, status: 404 }).buscar })).toEqual({ tipo: "falhou", motivo: "o servidor respondeu 404 para u" });
  });

  it("não dá para pôr o disco no lugar (rename falha): devolve falhou, nunca exceção (QA)", async () => {
    const destino = destinoNovo();
    // O destino é uma pasta com conteúdo: o rename da parte por cima dela falha.
    mkdirSync(join(destino, "ocupado"), { recursive: true });
    const r = await baixarDisco({ url: "u", destino, sha256: SHA, fetch: servidor({ range: true }).buscar });
    expect(r.tipo).toBe("falhou");
    expect(r).toMatchObject({ motivo: expect.stringContaining(destino) });
  });

  it("corpo que termina antes do Content-Length, sem erro de rede: sem_internet, a parte fica (QA)", async () => {
    const destino = destinoNovo();
    const curto = (async () => new Response(corpo(DISCO.slice(0, 6000)), { status: 200, headers: { "content-length": "10000" } })) as typeof fetch;
    const r = await baixarDisco({ url: "u", destino, sha256: SHA, fetch: curto });
    expect(r).toEqual({ tipo: "sem_internet", motivo: "o corpo parou em 6000 de 10000 bytes" });
    expect(readFileSync(caminhoDaParte(destino)).length).toBe(6000);
  });

  it("416 com parte que passou do fim: sha ruim e a parte é apagada (QA)", async () => {
    const destino = destinoNovo();
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(caminhoDaParte(destino), new Uint8Array([...DISCO, 1, 2, 3]));
    const r = await baixarDisco({ url: "u", destino, sha256: SHA, fetch: servidor({ range: true }).buscar });
    expect(r.tipo).toBe("sha_ruim");
    expect(existsSync(caminhoDaParte(destino))).toBe(false);
    expect(existsSync(destino)).toBe(false);
  });

  it("retomada com 206 e sha ruim: o hash conta a parte antiga, e a parte some (QA)", async () => {
    const destino = destinoNovo();
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(caminhoDaParte(destino), DISCO.slice(0, 4000).map((b) => b ^ 1));
    const r = await baixarDisco({ url: "u", destino, sha256: SHA, fetch: servidor({ range: true }).buscar });
    expect(r.tipo).toBe("sha_ruim");
    expect(existsSync(caminhoDaParte(destino))).toBe(false);
  });

  it("nomes, .sha256 publicado e Content-Range", () => {
    expect(nomeDoDisco("1.0.0", "arm64")).toBe("nod-vm-1.0.0-arm64.img.zst");
    expect(pastaDoCache("/Users/p/Library/Application Support/nod")).toBe("/Users/p/Library/Application Support/nod/vm/cache");
    const nome = "nod-vm-1.0.0-arm64.img.zst";
    expect(lerSha256(`${SHA}  ${nome}\n`, nome)).toBe(SHA);
    expect(lerSha256(`${SHA} *${nome}`, nome)).toBe(SHA);
    expect(lerSha256(`${SHA}  outro.img.zst\n`, nome)).toBeNull();
    expect(lerContentRange("bytes 100-999/1000")).toEqual({ inicio: 100, total: 1000 });
    expect(lerContentRange("bytes 100-999/*")).toEqual({ inicio: 100, total: null });
    expect(lerContentRange(null)).toBeNull();
    // QA: só o cabeçalho inteiro vale; lixo antes ou depois não é faixa.
    expect(lerContentRange("x bytes 100-999/1000")).toBeNull();
    expect(lerContentRange("bytes 100-999/1000 extra")).toBeNull();
  });

  it("500 é passageiro; disco que não existe não está no cache (QA)", async () => {
    expect((await baixarDisco({ url: "u", destino: destinoNovo(), sha256: SHA, fetch: servidor({ range: true, status: 500 }).buscar })).tipo).toBe("sem_internet");
    expect(await discoNoCache(join(tmp, "nao-existe", "d.img.zst"), SHA)).toBe(false);
  });
});
