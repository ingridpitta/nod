import { afterEach, describe, expect, it } from "vitest";
import { criarServicoDitado } from "../../../src/adapters/voz/ditado.ts";
import type { SessaoStt, Transcritor } from "../../../src/adapters/voz/spi.ts";
import { criarTranscritorFalso } from "../../../src/adapters/voz/voz-falsa.ts";
import type { CanalVoz } from "../../../src/adapters/voz/ws.ts";
import { FECHAMENTOS_VOZ } from "../../../src/contracts/voz.ts";
import { definirDestinoDoLog } from "../../../src/obs/log.ts";

/**
 * O ditado no servidor (definido em 2026-10-11, ADR-095) com canal e transcritor falsos: sem socket, sem banco, sem
 * áudio de verdade. O VAD é o da ligação; os quadros com "voz" são uma senoide, os de silêncio, zeros.
 */
type CanalFalso = CanalVoz & { json: Record<string, unknown>[]; fechadoCom: number | null; receber(m: object | Uint8Array): void; cair(): void };

function canalFalso(): CanalFalso {
  let aoMsg: ((m: { texto: string } | { binario: Uint8Array }) => void) | null = null;
  let aoFim: ((c: number) => void) | null = null;
  const c: CanalFalso = {
    json: [],
    fechadoCom: null,
    enviarJson(m) { c.json.push(m as Record<string, unknown>); },
    enviarBinario() {},
    fechar(codigo) {
      if (c.fechadoCom !== null) return;
      c.fechadoCom = codigo;
      aoFim?.(codigo);
    },
    aoMensagem(fn) { aoMsg = fn; },
    aoFechar(fn) { aoFim = fn; },
    pendente: () => 0,
    receber(m) { aoMsg?.(m instanceof Uint8Array ? { binario: m } : { texto: JSON.stringify(m) }); },
    cair() { aoFim?.(1006); },
  };
  return c;
}

let seq = 0;
function quadro(voz: boolean): Uint8Array {
  const b = new Uint8Array(5 + 640);
  const v = new DataView(b.buffer);
  v.setUint8(0, 1);
  v.setUint32(1, seq, true);
  for (let i = 0; i < 320; i++) v.setInt16(5 + i * 2, voz ? Math.round(Math.sin((i + seq * 320) / 6) * 9000) : 0, true);
  seq++;
  return b;
}
/** `n` quadros de 20 ms: fala (senoide) ou silêncio. */
function mandar(c: CanalFalso, voz: boolean, n: number): void {
  for (let i = 0; i < n; i++) c.receber(quadro(voz));
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ate<T>(f: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const fim = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > fim) throw new Error("tempo esgotado");
    await dormir(5);
  }
}
const doTipo = (c: CanalFalso, t: string) => c.json.find((m) => m.t === t);

const logs: string[] = [];
afterEach(() => {
  definirDestinoDoLog(null);
  logs.length = 0;
});

async function abrir(o: { roteiro?: string[]; transcritor?: Transcritor; maxMs?: number; prazoFinaisMs?: number } = {}) {
  definirDestinoDoLog((l) => logs.push(l));
  const transcritor = o.transcritor ?? criarTranscritorFalso(o.roteiro ?? []);
  // Relógio parado: a conta do abuso (áudio acima do tempo real) só deixa passar a folga de 4 s.
  const servico = criarServicoDitado({ transcritor, relogio: () => 0, maxMs: o.maxMs, prazoFinaisMs: o.prazoFinaisMs });
  const canal = canalFalso();
  await servico.abrir({ pessoaId: "p1", canal, vocabulario: ["Vera"] });
  return { servico, canal };
}

describe("ditado no servidor (ADR-095)", () => {
  it("abre o STT, diz pronto, corta nas pausas e devolve os trechos juntos no concluir", async () => {
    const { canal } = await abrir({ roteiro: ["Oi, tudo bem?", "Manda o resumo de ontem."] });
    expect(doTipo(canal, "pronto")).toEqual({ t: "pronto", maxS: 300 });
    mandar(canal, true, 30);
    mandar(canal, false, 60); // 1,2 s de pausa fecha o primeiro trecho
    mandar(canal, true, 30);
    canal.receber({ t: "concluir", destino: "enviar" }); // o segundo trecho fecha no clique
    const texto = await ate(() => doTipo(canal, "texto"));
    expect(texto).toEqual({ t: "texto", texto: "Oi, tudo bem? Manda o resumo de ontem." });
    expect(canal.fechadoCom).toBe(1000);
  });

  it("uma pausa curta (como entre palavras) não corta o trecho", async () => {
    const { canal } = await abrir({ roteiro: ["uma frase só", "não devia chegar aqui"] });
    mandar(canal, true, 25);
    mandar(canal, false, 30); // 600 ms: fecharia a vez na ligação, não no ditado
    mandar(canal, true, 25);
    canal.receber({ t: "concluir", destino: "campo" });
    expect(await ate(() => doTipo(canal, "texto"))).toEqual({ t: "texto", texto: "uma frase só" });
  });

  it("só silêncio devolve texto vazio (a tela diz que não ouviu)", async () => {
    const { canal } = await abrir({ roteiro: ["não devia aparecer"] });
    mandar(canal, false, 80);
    canal.receber({ t: "concluir", destino: "campo" });
    expect(await ate(() => doTipo(canal, "texto"))).toEqual({ t: "texto", texto: "" });
  });

  it("uma tosse (voz curta demais) é descartada e não consome o STT", async () => {
    const transcritor = criarTranscritorFalso(["texto da fala de verdade"]);
    const { canal } = await abrir({ transcritor });
    mandar(canal, true, 5); // 100 ms < VOZ_MINIMA_MS
    mandar(canal, false, 60);
    canal.receber({ t: "concluir", destino: "campo" });
    expect(await ate(() => doTipo(canal, "texto"))).toEqual({ t: "texto", texto: "" });
    expect(transcritor.restantes).toBe(1);
  });

  it("descartar fecha sem texto", async () => {
    const { canal, servico } = await abrir({ roteiro: ["segredo"] });
    mandar(canal, true, 30);
    canal.receber({ t: "descartar" });
    await dormir(20);
    expect(doTipo(canal, "texto")).toBeUndefined();
    expect(canal.fechadoCom).toBe(1000);
    expect(servico.vivos()).toBe(0);
  });

  it("o canal que cai no meio encerra o ditado sem texto", async () => {
    const { canal, servico } = await abrir({ roteiro: ["perdido"] });
    mandar(canal, true, 30);
    canal.cair();
    await dormir(20);
    expect(doTipo(canal, "texto")).toBeUndefined();
    expect(servico.vivos()).toBe(0);
    expect(logs.some((l) => l.includes("voz_ditado_encerrado") && l.includes('"desfecho":"caiu"'))).toBe(true);
  });

  it("no teto, conclui sozinho e marca `teto` (a tela põe no campo, nunca envia)", async () => {
    const { canal } = await abrir({ roteiro: ["fala comprida"], maxMs: 400 });
    mandar(canal, true, 25);
    const texto = await ate(() => doTipo(canal, "texto"));
    expect(texto).toEqual({ t: "texto", texto: "fala comprida", teto: true });
  });

  it("STT que não abre vira erro voz_fora", async () => {
    const quebrado: Transcritor = {
      id: "quebrado",
      capacidades: { parciais: false, vocabulario: false, fimDeFalaManual: true },
      abrir: () => Promise.reject(new Error("sem rede")),
    };
    const { canal } = await abrir({ transcritor: quebrado });
    expect(doTipo(canal, "erro")).toEqual({ t: "erro", codigo: "voz_fora" });
    expect(doTipo(canal, "pronto")).toBeUndefined();
    expect(canal.fechadoCom).toBe(1000);
  });

  it("STT que cai no meio vira erro voz_fora", async () => {
    const quem: { aoErro: ((e: Error) => void) | null } = { aoErro: null };
    const sessao: SessaoStt = { enviar() {}, fimDeFala() {}, descartar() {}, fechar: async () => {} };
    const caindo: Transcritor = {
      id: "caindo",
      capacidades: { parciais: false, vocabulario: false, fimDeFalaManual: true },
      async abrir(o) {
        quem.aoErro = o.aoErro;
        return sessao;
      },
    };
    const { canal } = await abrir({ transcritor: caindo });
    mandar(canal, true, 10);
    quem.aoErro?.(new Error("ws 1011"));
    expect(doTipo(canal, "erro")).toEqual({ t: "erro", codigo: "voz_fora" });
  });

  it("o final que não chega no prazo não segura a pessoa: devolve o que tem", async () => {
    const mudo: Transcritor = {
      id: "mudo",
      capacidades: { parciais: false, vocabulario: false, fimDeFalaManual: true },
      abrir: async () => ({ enviar() {}, fimDeFala() {}, descartar() {}, fechar: async () => {} }),
    };
    const { canal } = await abrir({ transcritor: mudo, prazoFinaisMs: 30 });
    mandar(canal, true, 30);
    canal.receber({ t: "concluir", destino: "campo" });
    expect(await ate(() => doTipo(canal, "texto"))).toEqual({ t: "texto", texto: "" });
    expect(logs.some((l) => l.includes("voz_ditado_final_atrasado"))).toBe(true);
  });

  it("áudio muito acima do tempo real fecha como abuso", async () => {
    const { canal } = await abrir({ roteiro: [] });
    mandar(canal, false, 260); // 5,2 s de áudio com o relógio parado: passa da folga de 4 s
    expect(canal.fechadoCom).toBe(FECHAMENTOS_VOZ.abuso);
    expect(logs.some((l) => l.includes("voz_ditado_encerrado") && l.includes('"desfecho":"erro"'))).toBe(true);
  });

  it("um ditado novo da mesma pessoa descarta o anterior (outra aba, recarga)", async () => {
    const transcritor = criarTranscritorFalso(["primeiro", "segundo"]);
    const servico = criarServicoDitado({ transcritor, relogio: () => 0 });
    const a = canalFalso();
    const b = canalFalso();
    await servico.abrir({ pessoaId: "p1", canal: a, vocabulario: [] });
    await servico.abrir({ pessoaId: "p1", canal: b, vocabulario: [] });
    expect(a.fechadoCom).toBe(1000);
    expect(servico.vivos()).toBe(1);
  });

  it("o log diz contagens e tempos, nunca o texto falado", async () => {
    const { canal } = await abrir({ roteiro: ["minha senha é abacaxi"] });
    mandar(canal, true, 30);
    canal.receber({ t: "concluir", destino: "enviar" });
    await ate(() => doTipo(canal, "texto"));
    const fim = logs.find((l) => l.includes("voz_ditado_encerrado"));
    expect(fim).toBeDefined();
    expect(fim).toContain('"desfecho":"concluido"');
    expect(fim).toContain('"destino":"enviar"');
    expect(fim).toContain('"trechos":1');
    expect(logs.join("\n")).not.toContain("abacaxi");
  });

  it("recusar manda o código e fecha", () => {
    const servico = criarServicoDitado({ transcritor: criarTranscritorFalso([]) });
    const c = canalFalso();
    servico.recusar(c, "sem_consentimento");
    expect(c.json).toEqual([{ t: "erro", codigo: "sem_consentimento" }]);
    expect(c.fechadoCom).toBe(1000);
  });
});
