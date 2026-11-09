import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import type { FrameSse } from "../../../src/contracts/frame.ts";
import { frameDeRetomada, lerSince, serializarFrame } from "../../../src/adapters/http/sse.ts";
import { criarBarramento, interpretarSince } from "../../../src/services/barramento.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function barramentoFixo(bufferFrames?: number) {
  let n = 0;
  return criarBarramento({ bufferFrames, gerarStreamId: () => `s${(n += 1)}` });
}

describe("barramento por PESSOA: seq monotônico, buffer e contrato de resume (ADR-016)", () => {
  it("seq é monotônico por pessoa e o buffer guarda só os últimos BUFFER frames", () => {
    const b = barramentoFixo(3);
    for (let i = 1; i <= 5; i += 1) b.publicar(A, "turno.delta", { i });
    expect(b.posicao(A)).toEqual({ streamId: "s1", seq: 5 });
    // Retomar desde 2 exigiria o frame 3 no buffer; ele está (3,4,5) → replay completo 3..5.
    const r = b.retomar(A, { streamId: "s1", seq: 2 });
    expect(r.resumed).toBe(true);
    if (r.resumed) expect(r.frames.map((f) => f.seq)).toEqual([3, 4, 5]);
    // Desde 1 exigiria o frame 2, podado → resumed:false, NUNCA parcial, e streamId novo.
    const falha = b.retomar(A, { streamId: "s1", seq: 1 });
    expect(falha).toEqual({ resumed: false, streamId: "s2", seq: 0 });
    expect(b.posicao(A)).toEqual({ streamId: "s2", seq: 0 });
  });

  it("1..5, reconecta com since 3 → 4,5; since na cabeça → nada a repetir; since desconhecido → resumed:false", () => {
    const b = barramentoFixo();
    for (let i = 1; i <= 5; i += 1) b.publicar(A, "mensagem.nova", { i });
    const r = b.retomar(A, { streamId: "s1", seq: 3 });
    expect(r.resumed && r.frames.map((f) => f.seq)).toEqual([4, 5]);
    const cabeca = b.retomar(A, { streamId: "s1", seq: 5 });
    expect(cabeca).toEqual({ resumed: true, streamId: "s1", seq: 5, frames: [] });
    // streamId de outro processo (reinício do servidor) → não retoma, stream novo.
    expect(b.retomar(A, { streamId: "antigo", seq: 3 })).toEqual({ resumed: false, streamId: "s2", seq: 0 });
    // since à frente da cabeça (impossível num stream honesto) → também falha.
    b.publicar(A, "mensagem.nova", {});
    expect(b.retomar(A, { streamId: "s2", seq: 9 })).toEqual({ resumed: false, streamId: "s3", seq: 0 });
  });

  it("primeira conexão (sem since) devolve resumed:false sem girar o stream: o cliente hidrata por REST", () => {
    const b = barramentoFixo();
    b.publicar(A, "agente.mudou", {});
    expect(b.retomar(A, null)).toEqual({ resumed: false, streamId: "s1", seq: 1 });
    expect(b.posicao(A)).toEqual({ streamId: "s1", seq: 1 });
  });

  it("pessoa B nunca recebe frame de A: buffers, seqs e inscritos são por pessoa", () => {
    const b = barramentoFixo();
    const deA: FrameSse[] = [];
    const deB: FrameSse[] = [];
    const cancelarA = b.inscrever(A, (f) => deA.push(f));
    b.inscrever(B, (f) => deB.push(f));
    b.publicar(A, "turno.delta", { texto: "privado de A" });
    b.publicar(A, "turno.delta", { texto: "mais de A" });
    b.publicar(B, "mensagem.nova", {});
    expect(deA.map((f) => f.seq)).toEqual([1, 2]);
    expect(deB.map((f) => [f.pessoaId, f.seq])).toEqual([[B, 1]]);
    expect(b.retomar(B, { streamId: b.posicao(B).streamId, seq: 0 })).toMatchObject({ resumed: true, frames: [{ pessoaId: B, seq: 1 }] });
    expect(b.inscritos(A)).toBe(1);
    cancelarA();
    b.publicar(A, "turno.delta", {});
    expect(deA).toHaveLength(2);
    expect(b.inscritos(A)).toBe(0);
  });

  it("um inscrito que lança não derruba a publicação nem os outros", () => {
    const b = barramentoFixo();
    const ok: number[] = [];
    b.inscrever(A, () => {
      throw new Error("socket morto");
    });
    b.inscrever(A, (f) => ok.push(f.seq));
    expect(() => b.publicar(A, "negacao", {})).not.toThrow();
    expect(ok).toEqual([1]);
  });
});

describe("linha SSE: id `${streamId}:${seq}`, event = tipo, data = frame inteiro", () => {
  it("serializa e o since faz o caminho inverso", () => {
    const frame: FrameSse = { streamId: "s1", seq: 7, pessoaId: A, tipo: "decisao.nova", dados: { decisao_id: "d" } };
    const linha = serializarFrame(frame);
    expect(linha).toBe(`id: s1:7\nevent: decisao.nova\ndata: ${JSON.stringify(frame)}\n\n`);
    expect(interpretarSince("s1:7")).toEqual({ streamId: "s1", seq: 7 });
    expect(interpretarSince("uuid-com:dois-pontos:12")).toEqual({ streamId: "uuid-com:dois-pontos", seq: 12 });
    expect(interpretarSince("")).toBeNull();
    expect(interpretarSince("semseq")).toBeNull();
    expect(interpretarSince("s1:abc")).toBeNull();
    expect(interpretarSince("s1:-1")).toBeNull();
    expect(interpretarSince(":3")).toBeNull();
  });

  it("frame resumed tem forma de FrameSse com o id da cabeça, e o handler lê Last-Event-ID ou ?since=", () => {
    expect(frameDeRetomada(A, { resumed: false, streamId: "s9", seq: 0 })).toEqual({ streamId: "s9", seq: 0, pessoaId: A, tipo: "resumed", dados: { resumed: false } });
    const req = new IncomingMessage(new Socket());
    req.url = "/api/t/x/eventos";
    req.headers["last-event-id"] = "s1:3";
    expect(lerSince(req)).toEqual({ streamId: "s1", seq: 3 });
    const porQuery = new IncomingMessage(new Socket());
    porQuery.url = "/api/t/x/eventos?since=s2%3A4";
    expect(lerSince(porQuery)).toEqual({ streamId: "s2", seq: 4 });
    const nada = new IncomingMessage(new Socket());
    nada.url = "/api/t/x/eventos";
    expect(lerSince(nada)).toBeNull();
  });
});
