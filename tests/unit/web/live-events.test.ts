import { describe, expect, it } from "vitest";
import type { FrameSse } from "../../../src/contracts/frame.ts";
import { calcularBackoffMs, criarLiveEvents, interpretarFrame, PRAZO_SILENCIO_MS, urlComSince, type EventoLive, type FonteSse } from "../../../web/lib/live-events.ts";

type Ouvinte = (ev: { data?: unknown; lastEventId?: string }) => void;

/** EventSource falso: o teste dispara open/error/frames à mão. */
class FonteFalsa implements FonteSse {
  ouvintes = new Map<string, Ouvinte[]>();
  fechada = false;
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(tipo: string, fn: Ouvinte): void {
    this.ouvintes.set(tipo, [...(this.ouvintes.get(tipo) ?? []), fn]);
  }
  close(): void {
    this.fechada = true;
  }
  disparar(tipo: string, ev: { data?: unknown; lastEventId?: string } = {}): void {
    for (const fn of this.ouvintes.get(tipo) ?? []) fn(ev);
  }
  frame(f: FrameSse): void {
    this.disparar(f.tipo, { data: JSON.stringify(f), lastEventId: `${f.streamId}:${f.seq}` });
  }
}

function montar(aleatorio = () => 0.5) {
  const fontes: FonteFalsa[] = [];
  const timers: { fn: () => void; ms: number; cancelado: boolean }[] = [];
  const eventos: EventoLive[] = [];
  let reidratacoes = 0;
  // Relógio do vigia (NOD-254), separado dos timers do backoff: `avancar` anda o tempo e dispara o que venceu.
  let agora = 1_000_000;
  const vigias: { fn: () => void; vence: number; cancelado: boolean }[] = [];
  const avancar = (ms: number): void => {
    const alvo = agora + ms;
    for (;;) {
      const prox = vigias.filter((v) => !v.cancelado && v.vence <= alvo).sort((a, b) => a.vence - b.vence)[0];
      if (!prox) break;
      agora = Math.max(agora, prox.vence);
      prox.cancelado = true;
      prox.fn();
    }
    agora = alvo;
  };
  const live = criarLiveEvents("/api/t/t1/eventos", {
    aoReidratar: () => {
      reidratacoes += 1;
    },
    criarFonte: (url) => {
      const f = new FonteFalsa(url);
      fontes.push(f);
      return f;
    },
    agendar: (fn, ms) => {
      const t = { fn, ms, cancelado: false };
      timers.push(t);
      return t;
    },
    cancelar: (id) => {
      (id as { cancelado: boolean }).cancelado = true;
    },
    aleatorio,
    relogio: {
      agora: () => agora,
      agendar: (fn, ms) => {
        const v = { fn, vence: agora + ms, cancelado: false };
        vigias.push(v);
        return v;
      },
      cancelar: (id) => {
        (id as { cancelado: boolean }).cancelado = true;
      },
    },
  });
  live.subscribe((ev) => eventos.push(ev));
  return {
    live,
    fontes,
    timers,
    eventos,
    vigias,
    avancar,
    /** Muda o relógio sem disparar nada (NTP, Mac que dormiu). */
    pularRelogio: (ms: number) => {
      agora += ms;
    },
    reidratacoes: () => reidratacoes,
  };
}

const frame = (seq: number, tipo: FrameSse["tipo"] = "mensagem.nova", streamId = "s1"): FrameSse => ({ streamId, seq, pessoaId: "p", tipo, dados: { seq } });

describe("live-events: interface de 4 campos sobre EventSource (ADR-016)", () => {
  it("connect abre a fonte; resumed:false dispara reidratação; frames chegam na ordem e duplicata é descartada", () => {
    const m = montar();
    m.live.connect();
    expect(m.fontes).toHaveLength(1);
    expect(m.fontes[0]?.url).toBe("/api/t/t1/eventos");
    m.fontes[0]?.disparar("open");
    m.fontes[0]?.frame({ streamId: "s1", seq: 0, pessoaId: "p", tipo: "resumed", dados: { resumed: false } });
    expect(m.reidratacoes()).toBe(1);
    m.fontes[0]?.frame(frame(1));
    m.fontes[0]?.frame(frame(2, "turno.delta"));
    m.fontes[0]?.frame(frame(2, "turno.delta"));
    m.fontes[0]?.frame(frame(1));
    const frames = m.eventos.filter((e): e is Extract<EventoLive, { tipo: "frame" }> => e.tipo === "frame");
    expect(frames.map((e) => e.frame.seq)).toEqual([1, 2]);
    expect(m.eventos.filter((e) => e.tipo === "conexao").map((e) => (e.tipo === "conexao" ? e.estado : ""))).toEqual(["conectando", "aberto"]);
  });

  it("erro fecha a fonte, agenda reconexão com backoff+jitter e reconecta com ?since=<último id>", () => {
    const m = montar(() => 0.5);
    m.live.connect();
    m.fontes[0]?.disparar("open");
    m.fontes[0]?.frame(frame(1));
    m.fontes[0]?.frame(frame(2));
    m.fontes[0]?.disparar("error");
    expect(m.fontes[0]?.fechada).toBe(true);
    expect(m.timers).toHaveLength(1);
    expect(m.timers[0]?.ms).toBe(1000);
    const reconectando = m.eventos.find((e) => e.tipo === "conexao" && e.estado === "reconectando");
    expect(reconectando).toMatchObject({ tentativa: 1, proximaEmMs: 1000 });
    m.timers[0]?.fn();
    expect(m.fontes).toHaveLength(2);
    expect(m.fontes[1]?.url).toBe("/api/t/t1/eventos?since=s1%3A2");
    // Replay completo 3 e depois resumed:true: sem reidratar.
    m.fontes[1]?.disparar("open");
    m.fontes[1]?.frame(frame(3));
    m.fontes[1]?.frame({ streamId: "s1", seq: 3, pessoaId: "p", tipo: "resumed", dados: { resumed: true } });
    expect(m.reidratacoes()).toBe(0);
    expect(m.eventos.filter((e) => e.tipo === "frame")).toHaveLength(3);
    // Segundo erro dobra a espera; após 'open' a tentativa volta a zero.
    m.fontes[1]?.disparar("error");
    expect(m.timers[1]?.ms).toBe(1000);
    m.timers[1]?.fn();
    m.fontes[2]?.disparar("error");
    expect(m.timers[2]?.ms).toBe(2000);
  });

  it("resumed:false depois de buffer podado reidrata e passa a seguir o stream novo", () => {
    const m = montar();
    m.live.connect();
    m.fontes[0]?.frame(frame(5));
    m.fontes[0]?.disparar("error");
    m.timers[0]?.fn();
    m.fontes[1]?.frame({ streamId: "s2", seq: 0, pessoaId: "p", tipo: "resumed", dados: { resumed: false } });
    expect(m.reidratacoes()).toBe(1);
    m.fontes[1]?.frame(frame(1, "mensagem.nova", "s2"));
    expect(m.eventos.filter((e) => e.tipo === "frame").map((e) => (e.tipo === "frame" ? `${e.frame.streamId}:${e.frame.seq}` : ""))).toEqual(["s1:5", "s2:1"]);
    m.fontes[1]?.disparar("error");
    m.timers[1]?.fn();
    expect(m.fontes[2]?.url).toBe("/api/t/t1/eventos?since=s2%3A1");
  });

  it("disconnect fecha, cancela o timer pendente e ignora eventos tardios; connect de novo reabre", () => {
    const m = montar();
    m.live.connect();
    m.fontes[0]?.disparar("error");
    m.live.disconnect();
    expect(m.timers[0]?.cancelado).toBe(true);
    m.fontes[0]?.frame(frame(9));
    expect(m.eventos.filter((e) => e.tipo === "frame")).toHaveLength(0);
    expect(m.eventos.at(-1)).toMatchObject({ tipo: "conexao", estado: "parado" });
    m.live.connect();
    expect(m.fontes).toHaveLength(2);
    expect(() => m.live.send({})).toThrow(/REST/);
  });

  it("retomar (ADR-094): com a conexão aberta e viva não faz nada; caída, reabre na hora sem esperar o backoff", () => {
    const m = montar();
    m.live.connect();
    m.fontes[0]?.disparar("open");
    m.fontes[0]?.frame(frame(4));
    // Trocar de aba / voltar ao app com o stream vivo (ping recente): nenhuma fonte nova, nenhum timer, nenhuma reidratação.
    m.avancar(40_000);
    m.fontes[0]?.disparar("ping", { data: "{}" });
    m.avancar(40_000);
    m.live.retomar();
    m.live.retomar();
    expect(m.fontes).toHaveLength(1);
    expect(m.fontes[0]?.fechada).toBe(false);
    expect(m.timers).toHaveLength(0);
    // Abrindo (antes do open) também não: o navegador avisa com error se não conseguir.
    m.fontes[0]?.disparar("error");
    for (let i = 0; i < 5; i++) {
      m.timers.at(-1)?.fn();
      m.fontes.at(-1)?.disparar("error");
    }
    const esperando = m.timers.at(-1);
    expect(esperando?.ms).toBe(30000);
    const antes = m.fontes.length;
    m.live.retomar();
    expect(esperando?.cancelado).toBe(true);
    expect(m.fontes).toHaveLength(antes + 1);
    expect(m.fontes.at(-1)?.url).toBe("/api/t/t1/eventos?since=s1%3A4");
    m.live.retomar();
    expect(m.fontes).toHaveLength(antes + 1);
    // Desligado (sem sessão), retomar não reabre.
    m.live.disconnect();
    m.live.retomar();
    expect(m.fontes).toHaveLength(antes + 1);
  });

  const estados = (m: ReturnType<typeof montar>) => m.eventos.filter((e) => e.tipo === "conexao").map((e) => (e.tipo === "conexao" ? e.estado : ""));

  describe("vigia de silêncio (NOD-254)", () => {
    it("prazo é 45 s (3 × o ping de 15 s do servidor)", () => {
      expect(PRAZO_SILENCIO_MS).toBe(45_000);
    });

    it("sem nenhum sinal além do prazo: fecha a fonte, emite reconectando e reabre com ?since=<último id>", () => {
      const m = montar();
      m.live.connect();
      m.fontes[0]?.disparar("open");
      m.fontes[0]?.frame(frame(4));
      m.avancar(44_999);
      expect(m.fontes[0]?.fechada).toBe(false);
      m.avancar(1);
      expect(m.fontes[0]?.fechada).toBe(true);
      expect(estados(m)).toEqual(["conectando", "aberto", "reconectando"]);
      expect(m.eventos.at(-1)).toMatchObject({ tipo: "conexao", estado: "reconectando", tentativa: 1, proximaEmMs: 1000 });
      expect(m.timers).toHaveLength(1);
      m.timers[0]?.fn();
      expect(m.fontes).toHaveLength(2);
      expect(m.fontes[1]?.url).toBe("/api/t/t1/eventos?since=s1%3A4");
      // Frame tardio da fonte derrubada não conta nem como frame nem como sinal.
      m.fontes[0]?.frame(frame(9));
      expect(m.eventos.filter((e) => e.tipo === "frame")).toHaveLength(1);
    });

    it("2026-11-10: ultimoDado anda com frame e ping, não com o open (o proxy que abre e segura o stream)", () => {
      const m = montar();
      m.live.connect();
      expect(m.live.ultimoDado()).toBe(0);
      m.fontes[0]?.disparar("open");
      expect(m.live.ultimoDado()).toBe(0);
      m.avancar(10_000);
      m.fontes[0]?.frame(frame(4));
      const depoisDoFrame = m.live.ultimoDado();
      expect(depoisDoFrame).toBeGreaterThan(0);
      m.avancar(5_000);
      m.fontes[0]?.disparar("ping", { data: "{}" });
      expect(m.live.ultimoDado()).toBe(depoisDoFrame + 5_000);
    });

    it("um ping antes do prazo não reabre; 45 s de silêncio depois do último ping reabre", () => {
      const m = montar();
      m.live.connect();
      m.fontes[0]?.disparar("open");
      m.fontes[0]?.frame(frame(4));
      m.avancar(30_000);
      m.fontes[0]?.disparar("ping", { data: "{}" });
      m.avancar(15_000); // 45 s desde o open: o vigia dispara, vê 15 s de silêncio e rearma
      expect(m.fontes).toHaveLength(1);
      expect(m.fontes[0]?.fechada).toBe(false);
      expect(estados(m)).toEqual(["conectando", "aberto"]);
      m.avancar(29_999);
      expect(m.fontes[0]?.fechada).toBe(false);
      m.avancar(1); // 75 s: 45 s depois do ping
      expect(m.fontes[0]?.fechada).toBe(true);
      expect(estados(m).at(-1)).toBe("reconectando");
    });

    it("frame (mesmo duplicado) também conta como sinal; o vigia não reagenda a cada frame", () => {
      const m = montar();
      m.live.connect();
      m.fontes[0]?.disparar("open");
      for (let i = 1; i <= 40; i += 1) {
        m.avancar(1_000);
        m.fontes[0]?.frame(frame(1, "turno.delta"));
      }
      // 40 frames, um só timer de vigia vivo (o primeiro, ainda não vencido).
      expect(m.vigias.filter((v) => !v.cancelado)).toHaveLength(1);
      m.avancar(44_000);
      expect(m.fontes[0]?.fechada).toBe(false);
      m.avancar(1_000);
      expect(m.fontes[0]?.fechada).toBe(true);
    });

    it("conexão que nunca abre (nem open nem error) é derrubada depois do prazo", () => {
      const m = montar();
      m.live.connect();
      m.avancar(45_000);
      expect(m.fontes[0]?.fechada).toBe(true);
      expect(estados(m)).toEqual(["conectando", "reconectando"]);
      m.timers[0]?.fn();
      expect(m.fontes).toHaveLength(2);
    });

    it("error e vigia na mesma fonte não agendam dois backoffs", () => {
      const m = montar();
      m.live.connect();
      m.fontes[0]?.disparar("open");
      expect(m.vigias.filter((v) => !v.cancelado)).toHaveLength(1);
      m.fontes[0]?.disparar("error");
      expect(m.vigias.filter((v) => !v.cancelado)).toHaveLength(0); // cair cancela o vigia da fonte derrubada
      m.avancar(60_000);
      expect(m.timers).toHaveLength(1);
      expect(estados(m)).toEqual(["conectando", "aberto", "reconectando"]);
    });

    it("retomar() com fonte aberta e silenciosa além do prazo reabre na hora com since, emitindo reconectando", () => {
      const m = montar();
      m.live.connect();
      m.fontes[0]?.disparar("open");
      m.fontes[0]?.frame(frame(4));
      // Mac dormiu: o relógio pulou 2 min sem o timer do vigia rodar (timers atrasados).
      m.pularRelogio(120_000);
      m.live.retomar();
      expect(m.fontes[0]?.fechada).toBe(true);
      expect(m.fontes).toHaveLength(2);
      expect(m.fontes[1]?.url).toBe("/api/t/t1/eventos?since=s1%3A4");
      expect(m.timers).toHaveLength(0); // na hora, sem backoff
      expect(estados(m)).toEqual(["conectando", "aberto", "reconectando"]);
      // retomar repetido logo depois, com a fonte nova recém-criada: não reabre de novo.
      m.live.retomar();
      expect(m.fontes).toHaveLength(2);
      // Ao abrir, volta a "aberto" (o main.ts relê por invalidacoesAoReconectar).
      m.fontes[1]?.disparar("open");
      expect(estados(m).at(-1)).toBe("aberto");
      // O vigia da fonte velha não derruba a nova.
      m.avancar(44_000);
      expect(m.fontes[1]?.fechada).toBe(false);
    });

    it("disconnect() cancela o vigia: nenhuma fonte nova depois", () => {
      const m = montar();
      m.live.connect();
      m.fontes[0]?.disparar("open");
      expect(m.vigias.filter((v) => !v.cancelado)).toHaveLength(1); // armado na abertura
      m.live.disconnect();
      expect(m.vigias.every((v) => v.cancelado)).toBe(true);
      // Mesmo rodando à força o timer do vigia, nada reabre.
      for (const v of m.vigias) v.fn();
      m.avancar(300_000);
      expect(m.fontes).toHaveLength(1);
      expect(m.timers).toHaveLength(0);
      expect(m.eventos.at(-1)).toMatchObject({ tipo: "conexao", estado: "parado" });
    });

    it("relógio que volta (NTP) não reabre nem agenda timer gigante", () => {
      const m = montar();
      m.live.connect();
      m.fontes[0]?.disparar("open");
      m.pularRelogio(-3_600_000);
      m.avancar(45_000 + 3_600_000 - 1);
      expect(m.fontes).toHaveLength(1);
      expect(m.fontes[0]?.fechada).toBe(false);
      const vivo = m.vigias.filter((v) => !v.cancelado);
      expect(vivo).toHaveLength(1);
      m.live.retomar();
      expect(m.fontes).toHaveLength(1);
    });
  });

  it("backoff: 1s → 30s com jitter ±30%", () => {
    expect(calcularBackoffMs(1, () => 0.5)).toBe(1000);
    expect(calcularBackoffMs(2, () => 0.5)).toBe(2000);
    expect(calcularBackoffMs(6, () => 0.5)).toBe(30000);
    expect(calcularBackoffMs(20, () => 0.5)).toBe(30000);
    expect(calcularBackoffMs(1, () => 0)).toBe(700);
    expect(calcularBackoffMs(1, () => 0.999)).toBeGreaterThanOrEqual(1299);
    expect(calcularBackoffMs(1, () => 0.999)).toBeLessThanOrEqual(1300);
  });

  it("interpretarFrame recusa lixo; urlComSince respeita query existente", () => {
    expect(interpretarFrame("não json")).toBeNull();
    expect(interpretarFrame(JSON.stringify({ streamId: "s", seq: 1, pessoaId: "p", tipo: "inventado" }))).toBeNull();
    expect(interpretarFrame(JSON.stringify({ streamId: "s", seq: 1, pessoaId: "p", tipo: "negacao" }))).toEqual({ streamId: "s", seq: 1, pessoaId: "p", tipo: "negacao", dados: {} });
    expect(interpretarFrame(42)).toBeNull();
    expect(urlComSince("/e", null)).toBe("/e");
    expect(urlComSince("/e?x=1", "s:1")).toBe("/e?x=1&since=s%3A1");
  });
});
