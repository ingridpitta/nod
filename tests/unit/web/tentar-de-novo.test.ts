import { describe, expect, it, vi } from "vitest";
import { ErroApi } from "../../../web/lib/erro-api.ts";
import { ESPERAS_MS, TETO_ESPERA_MS, podeRepetir, tentarDeNovo } from "../../../web/lib/tentar-de-novo.ts";

const fora = () => new ErroApi(0, "servidor_indisponivel", "O servidor está reiniciando. Tentamos de novo sozinhos.");
const semRede = () => new ErroApi(0, "sem_internet", "Seu dispositivo está sem internet. Assim que voltar, tentamos de novo.");

describe("tentarDeNovo (NOD-215)", () => {
  it("o backoff soma até o teto de 10 s e cresce a cada tentativa", () => {
    expect(ESPERAS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(TETO_ESPERA_MS);
    for (let i = 1; i < ESPERAS_MS.length; i++) expect(ESPERAS_MS[i]!).toBeGreaterThan(ESPERAS_MS[i - 1]!);
  });

  it("repete a falha de rede com as esperas na ordem e conclui quando o servidor volta", async () => {
    const esperas: number[] = [];
    const aoFalhar = vi.fn();
    let chamadas = 0;
    const r = await tentarDeNovo(async () => {
      chamadas++;
      if (chamadas < 3) throw chamadas === 1 ? fora() : semRede();
      return "ok";
    }, { esperar: async (ms) => { esperas.push(ms); }, aoFalhar });
    expect(r).toBe("ok");
    expect(chamadas).toBe(3);
    expect(esperas).toEqual(ESPERAS_MS.slice(0, 2));
    expect(aoFalhar).toHaveBeenCalledTimes(2);
  });

  it("desiste depois das tentativas e sobe o erro de rede com a frase certa", async () => {
    let chamadas = 0;
    const p = tentarDeNovo(async () => { chamadas++; throw fora(); }, { esperar: async () => undefined });
    await expect(p).rejects.toMatchObject({ codigo: "servidor_indisponivel", message: "O servidor está reiniciando. Tentamos de novo sozinhos." });
    expect(chamadas).toBe(ESPERAS_MS.length + 1);
  });

  it("resposta do nod (4xx/5xx com código) e exceção comum não repetem", async () => {
    for (const erro of [new ErroApi(409, "conflito", "x"), new ErroApi(500, "falha_interna", "x"), new TypeError("boom")]) {
      let chamadas = 0;
      await expect(tentarDeNovo(async () => { chamadas++; throw erro; }, { esperar: async () => undefined })).rejects.toBe(erro);
      expect(chamadas).toBe(1);
    }
  });

  it("só GET ou mutação com chave de idempotência podem repetir", () => {
    expect(podeRepetir("GET")).toBe(true);
    expect(podeRepetir("get")).toBe(true);
    for (const m of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(podeRepetir(m)).toBe(false);
      expect(podeRepetir(m, "")).toBe(false);
      expect(podeRepetir(m, null)).toBe(false);
    }
    expect(podeRepetir("POST", "chave-1")).toBe(true);
  });

  it("teto de 10 s: cada espera ≤ 10 s, a soma ≤ 10 s (hoje 0,5 + 2 + 6 = 8,5 s)", () => {
    expect(TETO_ESPERA_MS).toBe(10_000);
    expect(ESPERAS_MS).toEqual([500, 2_000, 6_000]);
    for (const espera of ESPERAS_MS) expect(espera).toBeLessThanOrEqual(TETO_ESPERA_MS);
    expect(ESPERAS_MS.reduce((a, b) => a + b, 0)).toBe(8_500);
  });

  it("esperas configuradas além do teto são cortadas: a soma esperada nunca passa de 10 s", async () => {
    for (const [esperas, esperado] of [[[6_000, 6_000], [6_000]], [[11_000], []], [[4_000, 4_000, 4_000], [4_000, 4_000]]] as const) {
      const feitas: number[] = [];
      await expect(tentarDeNovo(async () => { throw fora(); }, { esperas, esperar: async (ms) => { feitas.push(ms); } })).rejects.toMatchObject({ codigo: "servidor_indisponivel" });
      expect(feitas).toEqual(esperado);
      expect(feitas.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(TETO_ESPERA_MS);
    }
  });

  it("o teto vale para o tempo de parede: tentativa que demora a falhar consome o teto", async () => {
    let relogio = 0;
    const feitas: number[] = [];
    let chamadas = 0;
    // Cada fetch leva 4 s para rejeitar: 4 s + 0,5 s → 8,5 s gastos; esperar mais 2 s passaria de 10 s.
    const p = tentarDeNovo(async () => { chamadas++; relogio += 4_000; throw fora(); }, { agora: () => relogio, esperar: async (ms) => { feitas.push(ms); relogio += ms; } });
    await expect(p).rejects.toMatchObject({ codigo: "servidor_indisponivel" });
    expect(feitas).toEqual([500]);
    expect(chamadas).toBe(2);
  });
});

