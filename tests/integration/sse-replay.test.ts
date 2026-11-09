import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarRotaEventos } from "../../src/adapters/http/rotas/eventos.ts";
import { criarMetricas } from "../../src/obs/metricas.ts";
import { criarBarramento } from "../../src/services/barramento.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

/**
 * Leitor mínimo de SSE sobre fetch: separa blocos por linha vazia e entrega {id, event, data}. O `event: ping`
 * (NOD-254) vai para a lista `pings`, como o `retry` vai para `retries`: não é frame e não sai em `proximo()`.
 */
type EventoSse = { id: string | null; event: string | null; data: string };

async function abrirSse(url: string, headers: Record<string, string>) {
  const ac = new AbortController();
  const res = await fetch(url, { headers, signal: ac.signal });
  const fila: EventoSse[] = [];
  const esperando: ((e: EventoSse) => void)[] = [];
  const retries: number[] = [];
  const pings: EventoSse[] = [];
  const entregar = (e: EventoSse): void => {
    const w = esperando.shift();
    if (w) w(e);
    else fila.push(e);
  };
  const interpretar = (bloco: string): void => {
    const ev: EventoSse = { id: null, event: null, data: "" };
    let temDados = false;
    for (const linha of bloco.split("\n")) {
      if (linha.startsWith(":")) continue;
      const i = linha.indexOf(":");
      const campo = i === -1 ? linha : linha.slice(0, i);
      const valor = i === -1 ? "" : linha.slice(i + 1).replace(/^ /, "");
      if (campo === "id") ev.id = valor;
      else if (campo === "event") ev.event = valor;
      else if (campo === "retry") retries.push(Number(valor));
      else if (campo === "data") {
        ev.data += (temDados ? "\n" : "") + valor;
        temDados = true;
      }
    }
    if (ev.event === "ping") pings.push(ev);
    else if (temDados) entregar(ev);
  };
  void (async () => {
    const reader = res.body?.getReader();
    if (!reader) return;
    const dec = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        let corte = buffer.indexOf("\n\n");
        while (corte !== -1) {
          interpretar(buffer.slice(0, corte));
          buffer = buffer.slice(corte + 2);
          corte = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // abortado pelo teste
    }
  })();
  return {
    res,
    retries,
    pings,
    proximo(timeoutMs = 2_000): Promise<EventoSse> {
      const pronto = fila.shift();
      if (pronto) return Promise.resolve(pronto);
      return new Promise((resolve, reject) => {
        const esperar = (e: EventoSse): void => {
          clearTimeout(t);
          resolve(e);
        };
        const t = setTimeout(() => {
          // Sai da fila de espera: um evento posterior não pode cair num waiter já rejeitado.
          const i = esperando.indexOf(esperar);
          if (i !== -1) esperando.splice(i, 1);
          reject(new Error(`nenhum evento em ${timeoutMs} ms`));
        }, timeoutMs);
        esperando.push(esperar);
      });
    },
    fechar(): void {
      ac.abort();
    },
  };
}

const dados = (e: EventoSse) => JSON.parse(e.data) as { streamId: string; seq: number; pessoaId: string; tipo: string; dados: Record<string, unknown> };

/**
 * ADR-016 revisado, ponta a ponta sobre o servidor real (porta 0): buffer por PESSOA, `id:` =
 * `${streamId}:${seq}`, replay completo desde since+1 ou `resumed:false` — nunca parcial. Sem
 * banco: o barramento é alimentado direto (o outbox → barramento é provado em outbox-despacho).
 * definido em 2026-09-16: buffer de 3 frames neste teste para forçar a poda sem publicar 500.
 */
describe("SSE: replay por pessoa e contrato de resume", () => {
  const barramento = criarBarramento({ bufferFrames: 3 });
  const metricas = criarMetricas();
  let srv: ServidorDeTeste;
  let marlon: { cookie: string; tenantId: string; pessoaId: string };
  let ana: { cookie: string; tenantId: string; pessoaId: string };
  const url = () => `${srv.url}/api/t/${marlon.tenantId}/eventos`;

  beforeAll(async () => {
    srv = await servidorDeTeste([criarRotaEventos(barramento, { metricas, pingMs: 50 })]);
    marlon = await srv.entrar("marlon");
    ana = await srv.entrar("ana");
  });
  afterAll(() => srv.close());

  it("sem sessão → 401; com sessão → text/event-stream, retry 3000 e primeiro frame resumed:false", async () => {
    expect((await fetch(url())).status).toBe(401);
    const s = await abrirSse(url(), { cookie: marlon.cookie });
    expect(s.res.status).toBe(200);
    expect(s.res.headers.get("content-type")).toContain("text/event-stream");
    expect(s.res.headers.get("x-accel-buffering")).toBe("no");
    const primeiro = await s.proximo();
    expect(primeiro.event).toBe("resumed");
    expect(dados(primeiro)).toMatchObject({ tipo: "resumed", pessoaId: marlon.pessoaId, dados: { resumed: false } });
    expect(s.retries).toEqual([3000]);
    expect(metricas.ler({ metrica: "polls_abertos", tenant_id: marlon.tenantId, pessoa_id: marlon.pessoaId })).toBe(1);
    s.fechar();
  });

  it("1..5 ao vivo; reconecta com since 3 → 4, 5 e resumed:true; buffer podado → resumed:false com streamId novo; pessoa B nunca recebe frame de A", async () => {
    const abertos: { fechar(): void }[] = [];
    const abrir = async (u: string, headers: Record<string, string>) => {
      const s = await abrirSse(u, headers);
      abertos.push(s);
      return s;
    };
    try {
      const deAna = await abrir(url(), { cookie: ana.cookie });
      expect(dados(await deAna.proximo()).pessoaId).toBe(ana.pessoaId);

      const vivo = await abrir(url(), { cookie: marlon.cookie });
      await vivo.proximo(); // resumed:false da primeira conexão
      for (let i = 1; i <= 5; i += 1) barramento.publicar(marlon.pessoaId, "mensagem.nova", { i, texto: "privado de marlon" });
      const { streamId } = barramento.posicao(marlon.pessoaId);
      const recebidos = [];
      for (let i = 1; i <= 5; i += 1) recebidos.push(await vivo.proximo());
      expect(recebidos.map((e) => e.id)).toEqual([1, 2, 3, 4, 5].map((n) => `${streamId}:${n}`));
      expect(recebidos.map((e) => e.event)).toEqual(Array(5).fill("mensagem.nova"));
      expect(recebidos.map((e) => dados(e).dados.i)).toEqual([1, 2, 3, 4, 5]);
      vivo.fechar();

      // Reconexão com Last-Event-ID (como o EventSource nativo faz): replay COMPLETO 4 e 5, depois resumed:true.
      const desde3 = await abrir(url(), { cookie: marlon.cookie, "last-event-id": `${streamId}:3` });
      expect(dados(await desde3.proximo())).toMatchObject({ seq: 4, tipo: "mensagem.nova" });
      expect(dados(await desde3.proximo())).toMatchObject({ seq: 5, tipo: "mensagem.nova" });
      const retomado = await desde3.proximo();
      expect(retomado.event).toBe("resumed");
      expect(retomado.id).toBe(`${streamId}:5`);
      expect(dados(retomado)).toMatchObject({ streamId, seq: 5, dados: { resumed: true } });
      desde3.fechar();

      // ?since= (reconexão manual do cliente do nod), na cabeça: só resumed:true, sem replay.
      const naCabeca = await abrir(`${url()}?since=${encodeURIComponent(`${streamId}:5`)}`, { cookie: marlon.cookie });
      expect(dados(await naCabeca.proximo())).toMatchObject({ seq: 5, dados: { resumed: true } });
      naCabeca.fechar();

      // Buffer de 3 guarda 3..5: since 1 exigiria o 2 → nada parcial: resumed:false e streamId NOVO.
      const podado = await abrir(url(), { cookie: marlon.cookie, "last-event-id": `${streamId}:1` });
      const falhou = await podado.proximo();
      expect(falhou.event).toBe("resumed");
      const corpo = dados(falhou);
      expect(corpo.dados).toEqual({ resumed: false });
      expect(corpo.streamId).not.toBe(streamId);
      expect(corpo.seq).toBe(0);
      expect(barramento.posicao(marlon.pessoaId)).toEqual({ streamId: corpo.streamId, seq: 0 });
      podado.fechar();

      // Ana ficou conectada o tempo todo e não viu NADA de marlon.
      await expect(deAna.proximo(300)).rejects.toThrow(/nenhum evento/);
      barramento.publicar(ana.pessoaId, "agente.mudou", { de: "ana" });
      expect(dados(await deAna.proximo())).toMatchObject({ pessoaId: ana.pessoaId, tipo: "agente.mudou" });
    } finally {
      for (const s of abertos) s.fechar();
    }
  });

  it("ping (NOD-254): a cada pingMs chega `event: ping` com `data: {}` e sem `id`, fora da sequência de frames", async () => {
    const s = await abrirSse(url(), { cookie: marlon.cookie });
    try {
      const primeiro = await s.proximo();
      expect(primeiro.event).toBe("resumed");
      for (let i = 0; i < 100 && s.pings.length < 2; i += 1) await new Promise((r) => setTimeout(r, 20));
      expect(s.pings.length).toBeGreaterThanOrEqual(2);
      for (const p of s.pings) expect(p).toEqual({ id: null, event: "ping", data: "{}" });
      // O ping não gasta seq: o próximo frame segue a cabeça do stream.
      const antes = barramento.posicao(marlon.pessoaId);
      barramento.publicar(marlon.pessoaId, "agente.mudou", { depoisDoPing: true });
      const depois = await s.proximo();
      expect(depois.id).toBe(`${antes.streamId}:${antes.seq + 1}`);
    } finally {
      s.fechar();
    }
  });

  it("fechar a conexão cancela a inscrição e zera polls_abertos da pessoa", async () => {
    const s = await abrirSse(url(), { cookie: marlon.cookie });
    await s.proximo();
    expect(barramento.inscritos(marlon.pessoaId)).toBe(1);
    s.fechar();
    for (let i = 0; i < 50 && barramento.inscritos(marlon.pessoaId) > 0; i += 1) await new Promise((r) => setTimeout(r, 20));
    expect(barramento.inscritos(marlon.pessoaId)).toBe(0);
    expect(metricas.ler({ metrica: "polls_abertos", tenant_id: marlon.tenantId, pessoa_id: marlon.pessoaId })).toBe(0);
  });
});
