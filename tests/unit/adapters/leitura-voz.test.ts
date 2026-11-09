import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { criarLeitorDeVoz, type LeitorDeVoz } from "../../../src/adapters/http/leitura-voz.ts";
import { criarProvedoresFalsos } from "../../../src/adapters/voz/voz-falsa.ts";
import type { Sintetizador } from "../../../src/adapters/voz/spi.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import type { LeituraPreparada } from "../../../src/use-cases/ouvir-mensagem.ts";

/**
 * Leitor de respostas (NOD-180), sem servidor: a resposta HTTP é um EventEmitter com o que o leitor usa. O caso que o
 * servidor completo não pega fácil é a pessoa fechar enquanto a rota ainda lê o banco: o `close` já passou quando o
 * leitor começa, `write` devolve false e o `drain` nunca vem.
 */
const escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
const leitura: LeituraPreparada = { agenteId: "a", trechos: ["Primeira frase.", "Segunda frase."], voz: "v", velocidade: 1, caracteres: 29 };

function respostaJaFechada(): ServerResponse & { escritas: number } {
  const r = Object.assign(new EventEmitter(), {
    escritas: 0,
    destroyed: true,
    writableEnded: false,
    headersSent: false,
    writeHead() {
      r.headersSent = true;
      return r;
    },
    write() {
      r.escritas++;
      return false;
    },
    end() {
      r.writableEnded = true;
    },
    destroy() {},
  });
  return r as unknown as ServerResponse & { escritas: number };
}

function ttsContado(): Sintetizador & { pedidos: number } {
  const base = criarProvedoresFalsos().tts;
  const t = { ...base, pedidos: 0, sintetizar: (p: Parameters<Sintetizador["sintetizar"]>[0]) => (t.pedidos++, base.sintetizar(p)) };
  return t;
}

it("a pessoa fechou antes de o áudio começar: não chama o TTS, não trava e devolve o teto", async () => {
  const tts = ttsContado();
  const leitor = criarLeitorDeVoz({ tts, caracteresPorDia: 29, adianteMs: 1_000 });
  const res = respostaJaFechada();
  const fim = leitor.ler({ escopo, mensagemId: "m", leitura, res });
  const venceu = await Promise.race([fim.then(() => "terminou"), new Promise((ok) => setTimeout(() => ok("travou"), 2_000))]);
  expect(venceu).toBe("terminou");
  expect(tts.pedidos).toBe(0);
  expect(res.escritas).toBe(0);
  expect(leitor.vivas()).toBe(0);
  // O teto inteiro voltou: a mesma leitura cabe de novo.
  await leitor.ler({ escopo, mensagemId: "m", leitura, res: respostaJaFechada() });
  leitor.fechar();
});

it("o socket cai no meio (write false, sem drain nem close novos): a espera não trava", async () => {
  const tts = ttsContado();
  const leitor = criarLeitorDeVoz({ tts, caracteresPorDia: 0, adianteMs: 60_000 });
  const res = respostaJaFechada();
  res.destroyed = false;
  res.write = () => {
    res.escritas++;
    res.destroyed = true;
    return false;
  };
  const fim = leitor.ler({ escopo, mensagemId: "m", leitura, res });
  const venceu = await Promise.race([fim.then(() => "terminou"), new Promise((ok) => setTimeout(() => ok("travou"), 2_000))]);
  expect(venceu).toBe("terminou");
  expect(res.escritas).toBe(1);
  expect(tts.pedidos).toBe(1);
  leitor.fechar();
});

/**
 * Teto diário (NOD-181): voz falsa com trechos controlados. Cada trecho sai num pedaço só; um trecho "travado" sai,
 * avisa e espera ser liberado (ou abortado), e um trecho "quebrado" lança. Assim se sabe exatamente quanto cada
 * leitura já mandou ao TTS quando a outra chega.
 */
describe("teto diário (NOD-181)", () => {
  const AGORA = Date.UTC(2026, 9, 6, 15);
  const L = (trechos: string[]): LeituraPreparada => ({ agenteId: "a", trechos, voz: "v", velocidade: 1, caracteres: trechos.join("").length });

  function respostaAberta(): ServerResponse & { status: number | null; terminou: boolean; destruida: boolean } {
    const r = Object.assign(new EventEmitter(), {
      status: null as number | null,
      terminou: false,
      destruida: false,
      destroyed: false,
      writableEnded: false,
      headersSent: false,
      writeHead(s: number) {
        r.status = s;
        r.headersSent = true;
        return r;
      },
      write() {
        return true;
      },
      end() {
        r.writableEnded = true;
        r.terminou = true;
      },
      destroy() {
        r.destroyed = true;
        r.destruida = true;
      },
    });
    return r as unknown as ServerResponse & { status: number | null; terminou: boolean; destruida: boolean };
  }

  function vozControlada() {
    const travados = new Map<string, { comecou: Promise<void>; avisar: () => void; liberar: () => void; liberado: Promise<void> }>();
    const quebrados = new Map<string, "antes" | "depois">();
    const travar = (texto: string) => {
      let avisar = () => {};
      let liberar = () => {};
      const comecou = new Promise<void>((ok) => (avisar = ok));
      const liberado = new Promise<void>((ok) => (liberar = ok));
      const t = { comecou, avisar, liberar, liberado };
      travados.set(texto, t);
      return t;
    };
    const tts: Sintetizador = {
      id: "falso",
      capacidades: { streaming: false, velocidade: true },
      async *sintetizar(p) {
        const quebra = quebrados.get(p.texto);
        if (quebra === "antes") throw new Error("tts caiu");
        yield new Int16Array(240);
        if (quebra === "depois") throw new Error("tts caiu");
        const trava = travados.get(p.texto);
        if (trava) {
          trava.avisar();
          await Promise.race([trava.liberado, new Promise<void>((ok) => p.sinal?.addEventListener("abort", () => ok(), { once: true }))]);
        }
      },
    };
    return { tts, travar, quebrados };
  }

  const novoLeitor = (tts: Sintetizador) => criarLeitorDeVoz({ tts, caracteresPorDia: 1_000, adianteMs: 1e9, agora: () => AGORA });

  /** Prova o usado do dia: cabem exatamente `livre` caracteres (lê `livre` e depois 1 dá 429). */
  async function confirmarLivre(leitor: LeitorDeVoz, livre: number) {
    if (livre > 0) await leitor.ler({ escopo, mensagemId: "sonda", leitura: L(["s".repeat(livre)]), res: respostaAberta() });
    await expect(leitor.ler({ escopo, mensagemId: "sonda", leitura: L(["s"]), res: respostaAberta() })).rejects.toMatchObject({ codigo: "limite_atingido" });
  }

  it("8. substituir perto do teto: o não falado da anterior volta antes de reservar, sem devolução em dobro", async () => {
    const voz = vozControlada();
    const leitor = novoLeitor(voz.tts);
    const a1 = "a".repeat(100);
    const trava = voz.travar(a1);
    const resA = respostaAberta();
    const fimA = leitor.ler({ escopo, mensagemId: "A", leitura: L([a1, "b".repeat(700)]), res: resA });
    await trava.comecou; // A mandou 100 ao TTS; 700 ainda não.
    const resB = respostaAberta();
    // Sem a devolução, 800 + 600 > 1.000 daria 429.
    await leitor.ler({ escopo, mensagemId: "B", leitura: L(["c".repeat(600)]), res: resB });
    await fimA;
    expect(resB.status).toBe(200);
    expect(resB.terminou).toBe(true);
    expect(resA.destruida).toBe(true);
    expect(leitor.vivas()).toBe(0);
    // Usado = 100 (A) + 600 (B) = 700. Com devolução em dobro, sobrariam 1.000.
    await confirmarLivre(leitor, 300);
    leitor.fechar();
  });

  it("extra: a 2ª leitura não cabe nem com a devolução → 429, e a anterior segue tocando até o fim", async () => {
    const voz = vozControlada();
    const leitor = novoLeitor(voz.tts);
    const a1 = "a".repeat(100);
    const trava = voz.travar(a1);
    const resA = respostaAberta();
    const fimA = leitor.ler({ escopo, mensagemId: "A", leitura: L([a1, "b".repeat(700)]), res: resA });
    await trava.comecou;
    // 800 − 700 + 1.000 > 1.000.
    await expect(leitor.ler({ escopo, mensagemId: "B", leitura: L(["c".repeat(1_000)]), res: respostaAberta() })).rejects.toMatchObject({
      codigo: "limite_atingido",
    });
    expect(leitor.vivas()).toBe(1);
    trava.liberar();
    await fimA;
    expect(resA.terminou).toBe(true);
    expect(resA.destruida).toBe(false);
    await confirmarLivre(leitor, 200);
    leitor.fechar();
  });

  it("9. regressão: sem substituição, a 2ª leitura que não cabe segue dando 429", async () => {
    const leitor = novoLeitor(vozControlada().tts);
    await leitor.ler({ escopo, mensagemId: "A", leitura: L(["a".repeat(800)]), res: respostaAberta() });
    await expect(leitor.ler({ escopo, mensagemId: "B", leitura: L(["b".repeat(300)]), res: respostaAberta() })).rejects.toMatchObject({
      codigo: "limite_atingido",
    });
    await confirmarLivre(leitor, 200);
    leitor.fechar();
  });

  it("10. TTS falha antes do 1º byte → 502 e a reserva volta inteira", async () => {
    const voz = vozControlada();
    const leitor = novoLeitor(voz.tts);
    const a1 = "a".repeat(400);
    voz.quebrados.set(a1, "antes");
    const res = respostaAberta();
    const erro = await leitor.ler({ escopo, mensagemId: "A", leitura: L([a1, "b".repeat(600)]), res }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeDominio);
    expect((erro as ErroDeDominio).codigo).toBe("conector_indisponivel");
    expect(res.headersSent).toBe(false);
    // Nada foi ouvido: dá para ler de novo o mesmo total.
    await confirmarLivre(leitor, 1_000);
    leitor.fechar();
  });

  it("11. regressão: TTS falha depois do 1º byte → o áudio corta e volta só o que não chegou ao TTS", async () => {
    const voz = vozControlada();
    const leitor = novoLeitor(voz.tts);
    const a1 = "a".repeat(400);
    voz.quebrados.set(a1, "depois");
    const res = respostaAberta();
    await leitor.ler({ escopo, mensagemId: "A", leitura: L([a1, "b".repeat(600)]), res });
    expect(res.status).toBe(200);
    expect(res.destruida).toBe(true);
    expect(res.terminou).toBe(false);
    // Os 400 do 1º trecho chegaram ao TTS e contam; os 600 do 2º voltam.
    await confirmarLivre(leitor, 600);
    leitor.fechar();
  });
});
