import { describe, expect, it } from "vitest";
import { lerCabecalhoMidia } from "../../../src/adapters/http/rotas/interno.ts";
import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import { criarFila, criarFilaDeLeitura, FATIA_MAX_BYTES, enviarVigiado, RESPOSTA_PARADA_MS, faixaPedida, tipoServido } from "../../../src/adapters/http/util.ts";

describe("Range de faixa única (NOD-323)", () => {
  it("a-b, a- e -n; fim além do arquivo é cortado", () => {
    expect(faixaPedida("bytes=0-99", 1000)).toEqual({ inicio: 0, fim: 99 });
    expect(faixaPedida("bytes=500-", 1000)).toEqual({ inicio: 500, fim: 999 });
    expect(faixaPedida("bytes=-100", 1000)).toEqual({ inicio: 900, fim: 999 });
    expect(faixaPedida("bytes=-5000", 1000)).toEqual({ inicio: 0, fim: 999 });
    expect(faixaPedida("bytes=10-5000", 1000)).toEqual({ inicio: 10, fim: 999 });
  });
  it("fora do arquivo é 416; várias faixas ou formato estranho é o arquivo inteiro", () => {
    expect(faixaPedida("bytes=1000-", 1000)).toBe("invalida");
    expect(faixaPedida("bytes=5-2", 1000)).toBe("invalida");
    expect(faixaPedida("bytes=-0", 1000)).toBe("invalida");
    expect(faixaPedida("bytes=0-1,5-9", 1000)).toBeNull();
    expect(faixaPedida("items=0-1", 1000)).toBeNull();
    expect(faixaPedida("bytes=-", 1000)).toBeNull();
    expect(faixaPedida(undefined, 1000)).toBeNull();
  });
});

describe("tipo servido", () => {
  it("só a lista explícita sai com o próprio tipo; svg e html viram texto", () => {
    for (const m of ["image/png", "video/mp4", "video/webm", "audio/mpeg", "audio/ogg", "application/zip", "application/pdf"]) expect(tipoServido(m)).toBe(m);
    for (const m of ["image/svg+xml", "text/html", "application/javascript", "text/markdown"]) expect(tipoServido(m)).toBe("text/plain; charset=utf-8");
  });
});

describe("cabeçalho x-nod-midia", () => {
  const ok = { nome: "capa.png", caminhoRelativo: "Chico/capa.png", sha256: "A".repeat(64), mime: "image/png", largura: 10 };
  it("lê o JSON url-encoded e normaliza o sha256", () => {
    expect(lerCabecalhoMidia(encodeURIComponent(JSON.stringify(ok)))).toEqual({ ...ok, sha256: "a".repeat(64) });
  });
  it("recusa o que não é do formato", () => {
    expect(lerCabecalhoMidia(undefined)).toBeNull();
    expect(lerCabecalhoMidia("%E0%A4%A")).toBeNull();
    expect(lerCabecalhoMidia(encodeURIComponent("[]"))).toBeNull();
    expect(lerCabecalhoMidia(encodeURIComponent(JSON.stringify({ ...ok, nome: "" })))).toBeNull();
    expect(lerCabecalhoMidia(encodeURIComponent(JSON.stringify({ ...ok, largura: 1.5 })))).toBeNull();
    expect(lerCabecalhoMidia(encodeURIComponent(JSON.stringify({ ...ok, sha256: 1 })))).toBeNull();
  });
});

// Revisão do #507 (A2): o `bytes=0-` do <video> num arquivo de 50 MiB não arrasta o arquivo inteiro.
describe("fatia limitada e fila de leituras (A2)", () => {
  const MB50 = 50 * 1024 * 1024;
  it("bytes=0- num vídeo grande devolve só a 1ª fatia", () => {
    expect(faixaPedida("bytes=0-", MB50)).toEqual({ inicio: 0, fim: FATIA_MAX_BYTES - 1 });
    expect(faixaPedida("bytes=0-52428799", MB50)).toEqual({ inicio: 0, fim: FATIA_MAX_BYTES - 1 });
    expect(faixaPedida(`bytes=-${MB50}`, MB50)).toEqual({ inicio: 0, fim: FATIA_MAX_BYTES - 1 });
    expect(faixaPedida("bytes=10-", 100)).toEqual({ inicio: 10, fim: 99 });
  });
  it("arquivo vazio: qualquer faixa é inválida", () => {
    expect(faixaPedida("bytes=-5", 0)).toBe("invalida");
  });
  it("a fila deixa no máximo N ao mesmo tempo e não perde nenhuma", async () => {
    const fila = criarFila(2);
    let agora = 0;
    let pico = 0;
    const tarefa = (i: number) => fila(async () => {
      agora++;
      pico = Math.max(pico, agora);
      await new Promise((r) => setTimeout(r, 5));
      agora--;
      if (i === 3) throw new Error("x");
      return i;
    });
    const r = await Promise.allSettled([0, 1, 2, 3, 4, 5].map(tarefa));
    expect(pico).toBe(2);
    expect(r.map((x) => x.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "rejected", "fulfilled", "fulfilled"]);
    expect(await fila(async () => "depois")).toBe("depois");
  });
});

describe("a fila das leituras inteiras (revisão 3 do #507, alto 1)", () => {
  it("um tenant não passa de 2 ao mesmo tempo e não toma as vagas dos outros; quem desistiu não lê", async () => {
    const fila = criarFilaDeLeitura({ max: 4, porChave: 2 });
    const emCurso = new Map<string, number>();
    let picoA = 0;
    let lidas = 0;
    const tarefa = (t: string, desistiu = false) => fila(t, () => desistiu, async () => {
      lidas++;
      emCurso.set(t, (emCurso.get(t) ?? 0) + 1);
      if (t === "a") picoA = Math.max(picoA, emCurso.get("a") ?? 0);
      await new Promise((r) => setTimeout(r, 10));
      emCurso.set(t, (emCurso.get(t) ?? 1) - 1);
      return t;
    });
    const r = await Promise.all([tarefa("a"), tarefa("a"), tarefa("a"), tarefa("a"), tarefa("b"), tarefa("a", true)]);
    expect(picoA).toBe(2);
    expect(r).toEqual(["a", "a", "a", "a", "b", undefined]);
    expect(lidas).toBe(5);
  });
  it("chaves de pessoas diferentes do mesmo tenant não se bloqueiam (revisão 5 do #507)", async () => {
    const fila = criarFilaDeLeitura({ max: 4, porChave: 1 });
    let soltar = () => {};
    const presa = fila("t:p1", () => false, () => new Promise<string>((ok) => { soltar = () => ok("p1"); }));
    expect(await fila("t:p2", () => false, async () => "p2")).toBe("p2");
    soltar();
    expect(await presa).toBe("p1");
  });
  it("a janela de produção cabe 1/3 do buffer de envio de 4 MiB a 25 KiB/s, com folga de 1,5x (revisão 8 do #507)", () => {
    // O drain só volta quando o kernel libera 1/3 do buffer de envio (até 4 MiB): a janela tem de caber isso no piso.
    const porJanela = (RESPOSTA_PARADA_MS / 1000) * 25 * 1024;
    expect(porJanela).toBeGreaterThanOrEqual(1.5 * ((4 * 1024 * 1024) / 3));
  });
  it("a resposta que para de andar é derrubada; a que anda devagar recebe tudo — socket real (revisões 4 a 6 do #507)", async () => {
    const fins: string[] = [];
    const srv = createServer((req, res) => {
      // O lento: 16 MiB (passa dos buffers do loopback), janela de 3 s, pedaço padrão (256 KiB). O parado: 24 MiB (passa do buffer do kernel), janela de 300 ms.
      const lento = req.url === "/lento";
      const conteudo = Buffer.alloc(lento ? 16 * 1024 * 1024 : 24 * 1024 * 1024, 7);
      res.writeHead(200, { "content-length": String(conteudo.byteLength) });
      void enviarVigiado(res, conteudo, lento ? { paradoMs: 3_000 } : { paradoMs: 300 }).then(() => fins.push(res.writableFinished ? "saiu" : "derrubada"));
    });
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
    const porta = (srv.address() as AddressInfo).port;
    try {
      // Lento mas andando, em ritmo CONSTANTE (~2 MiB/s, 16 MiB, ~8 s): com a janela de 3 s, o drain precisa vir antes de o buffer
      // do kernel esvaziar todo (revisão 7 do #507); recebe tudo.
      const inicio = Date.now();
      const recebidos = await new Promise<number>((ok, falha) => {
        get({ port: porta, host: "127.0.0.1", agent: false, path: "/lento" }, (res) => {
          let n = 0;
          res.on("data", (c: Buffer) => { n += c.byteLength; res.pause(); setTimeout(() => res.resume(), c.byteLength / 2048); });
          res.on("end", () => ok(n));
          res.on("error", falha);
        }).on("error", falha);
      });
      expect(recebidos).toBe(16 * 1024 * 1024);
      expect(Date.now() - inicio).toBeGreaterThan(3_000);
      // Parado: lê o cabeçalho e não lê mais; o servidor derruba (o cliente pausado só veria o fim ao ler o que tem).
      const parado = get({ port: porta, host: "127.0.0.1", agent: false }, (res) => res.pause());
      parado.on("error", () => {});
      const t0 = Date.now();
      while (fins.length < 2 && Date.now() - t0 < 5_000) await new Promise((r) => setTimeout(r, 20));
      parado.destroy();
      expect(fins).toEqual(["saiu", "derrubada"]);
    } finally {
      srv.closeAllConnections();
      await new Promise((ok) => srv.close(ok));
    }
  }, 30_000);
});
