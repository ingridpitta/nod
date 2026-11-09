import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  classificar400,
  criarTranscritorDeArquivoGoogle,
  duracaoParaMs,
  lerRespostaRecognize,
  urlRecognizeV2,
} from "../../../src/adapters/voz/google-transcricao-arquivo.ts";
import { RecusaDoArquivo } from "../../../src/adapters/voz/spi.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";

const SEGREDO = "palavrasecreta";
const respostaOk = () =>
  new Response(
    JSON.stringify({
      results: [
        {
          alternatives: [
            {
              transcript: `oi ${SEGREDO}`,
              words: [
                { word: "oi", endOffset: "0.400s" },
                { word: SEGREDO, startOffset: "0.400s", endOffset: "1.5s" },
              ],
            },
          ],
        },
        {
          alternatives: [
            {
              transcript: "tchau",
              words: [
                { word: "tchau", startOffset: "2s", endOffset: "2.250s" },
              ],
            },
          ],
        },
      ],
      metadata: { totalBilledDuration: "3s" },
    }),
  );
const erro = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { code: status, message } }), {
    status,
  });
const audio = Uint8Array.from([1, 2, 3, 250]);

describe("voz: STT de arquivo do Google (v2 recognize, chirp_2)", () => {
  let saidaLog: MockInstance;
  const linhasLog = () =>
    saidaLog.mock.calls.map((c) => String(c[0])).join("\n");
  beforeEach(() => {
    saidaLog = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("monta URL regional, corpo (autoDecoding, chirp_2, pt-BR, tempo por palavra, base64) e headers", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(respostaOk());
    const t = criarTranscritorDeArquivoGoogle({
      token: async () => "tok",
      projeto: "proj",
      fetchImpl: f,
    });
    expect([t.id, t.modelo]).toEqual(["google", "chirp_2"]);
    const r = await t.transcrever({
      bytes: audio,
      mime: "audio/wav",
      idioma: "pt-BR",
    });
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://us-central1-speech.googleapis.com/v2/projects/proj/locations/us-central1/recognizers/_:recognize",
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer tok",
      "x-goog-user-project": "proj",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      config: {
        autoDecodingConfig: {},
        model: "chirp_2",
        languageCodes: ["pt-BR"],
        features: {
          enableWordTimeOffsets: true,
          enableAutomaticPunctuation: true,
        },
      },
      content: Buffer.from(audio).toString("base64"),
    });
    expect(r).toEqual({
      palavras: [
        { texto: "oi", inicioMs: 0, fimMs: 400 },
        { texto: SEGREDO, inicioMs: 400, fimMs: 1500 },
        { texto: "tchau", inicioMs: 2000, fimMs: 2250 },
      ],
      cobradoMs: 3000,
    });
  });

  it("modelo e região configuráveis", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    const t = criarTranscritorDeArquivoGoogle({
      token: async () => "tok",
      projeto: "p",
      regiao: "europe-west4",
      modelo: "chirp_3",
      fetchImpl: f,
    });
    expect(
      await t.transcrever({
        bytes: audio,
        mime: "audio/mpeg",
        idioma: "pt-BR",
      }),
    ).toEqual({ palavras: [], cobradoMs: null });
    expect(f.mock.calls[0]?.[0]).toBe(urlRecognizeV2("p", "europe-west4"));
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body)).config.model).toBe(
      "chirp_3",
    );
  });

  it("Duration do protobuf vira ms; resposta sem results vira [] (sem fala); palavra inválida é pulada", () => {
    expect([
      duracaoParaMs("1.5s"),
      duracaoParaMs("1.500s"),
      duracaoParaMs("2s"),
      duracaoParaMs("0.000123456s"),
      duracaoParaMs(undefined),
    ]).toEqual([1500, 1500, 2000, 0, 0]);
    expect([
      duracaoParaMs("1,5s"),
      duracaoParaMs(1.5),
      duracaoParaMs("-1s"),
    ]).toEqual([null, null, null]);
    expect(lerRespostaRecognize({})).toEqual({ palavras: [], cobradoMs: null });
    expect(lerRespostaRecognize(null)).toEqual({
      palavras: [],
      cobradoMs: null,
    });
    expect(
      lerRespostaRecognize({
        results: [
          { alternatives: [] },
          {
            alternatives: [
              {
                words: [
                  { word: " " },
                  { word: "a", startOffset: "x" },
                  { word: "b", startOffset: "1s" },
                ],
              },
            ],
          },
        ],
      }).palavras,
    ).toEqual([{ texto: "b", inicioMs: 1000, fimMs: 1000 }]);
  });

  it("sem projeto: integracao_nao_configurada sem chamar a rede", async () => {
    const f = vi.fn<typeof fetch>();
    const t = criarTranscritorDeArquivoGoogle({
      token: async () => "tok",
      projeto: null,
      fetchImpl: f,
    });
    await expect(
      t.transcrever({ bytes: audio, mime: "audio/wav", idioma: "pt-BR" }),
    ).rejects.toThrow("integracao_nao_configurada");
    expect(f).not.toHaveBeenCalled();
  });

  it("mapa de erros: 400 de duração → longo, 400 de codificação → nao_suportado, outro 400, 401/403, 429, 5xx, rede e timeout", async () => {
    const casos: Array<[Response | Error, (e: unknown) => boolean]> = [
      [
        erro(400, "Audio can be of a maximum of 60 seconds."),
        (e) => e instanceof RecusaDoArquivo && e.motivo === "longo",
      ],
      [
        erro(400, "Audio data does not appear to be in a supported encoding."),
        (e) => e instanceof RecusaDoArquivo && e.motivo === "nao_suportado",
      ],
      [
        erro(400, "Invalid recognizer config"),
        (e) => e instanceof ErroDeDominio && e.codigo === "entrada_invalida",
      ],
      [
        erro(401, "x"),
        (e) =>
          e instanceof ErroDeDominio && e.codigo === "integracao_autenticacao",
      ],
      [
        erro(403, "Permission denied on speech"),
        (e) =>
          e instanceof ErroDeDominio && e.codigo === "integracao_autenticacao",
      ],
      [
        erro(429, "quota"),
        (e) =>
          e instanceof ErroDeDominio && e.codigo === "conector_indisponivel",
      ],
      [
        erro(503, "unavailable"),
        (e) =>
          e instanceof ErroDeDominio && e.codigo === "conector_indisponivel",
      ],
      [
        new TypeError("fetch failed"),
        (e) =>
          e instanceof ErroDeDominio && e.codigo === "conector_indisponivel",
      ],
      [
        new DOMException("timeout", "TimeoutError"),
        (e) =>
          e instanceof ErroDeDominio && e.codigo === "conector_indisponivel",
      ],
    ];
    for (const [resposta, confere] of casos) {
      const f = vi.fn<typeof fetch>();
      if (resposta instanceof Response) f.mockResolvedValue(resposta);
      else f.mockRejectedValue(resposta);
      const t = criarTranscritorDeArquivoGoogle({
        token: async () => "tok",
        projeto: "p",
        fetchImpl: f,
      });
      const e = await t
        .transcrever({ bytes: audio, mime: "audio/wav", idioma: "pt-BR" })
        .then(
          () => null,
          (x: unknown) => x,
        );
      expect(confere(e), String(e)).toBe(true);
    }
    expect(linhasLog()).toContain("voz_stt_arquivo_autenticacao");
  });

  it("timeout de 30 s: o pedido leva um sinal que aborta; abort de quem chama propaga sem virar erro do provedor", async () => {
    const f = vi.fn<typeof fetch>(
      (_u, init) =>
        new Promise((_r, rej) => {
          if (init?.signal?.aborted) rej(init.signal.reason);
          init?.signal?.addEventListener("abort", () =>
            rej(init.signal?.reason),
          );
        }),
    );
    const t = criarTranscritorDeArquivoGoogle({
      token: async () => "tok",
      projeto: "p",
      fetchImpl: f,
      timeoutMs: 20,
    });
    await expect(
      t.transcrever({ bytes: audio, mime: "audio/wav", idioma: "pt-BR" }),
    ).rejects.toThrow("conector_indisponivel");
    const ctl = new AbortController();
    const t2 = criarTranscritorDeArquivoGoogle({
      token: async () => "tok",
      projeto: "p",
      fetchImpl: f,
    });
    const p = t2.transcrever({
      bytes: audio,
      mime: "audio/wav",
      idioma: "pt-BR",
      sinal: ctl.signal,
    });
    ctl.abort();
    await expect(p).rejects.not.toBeInstanceOf(ErroDeDominio);
  });

  it("QA NOD-329: 200 com corpo que não é JSON é provedor fora (não vira sem fala); só a 1ª alternativa conta", async () => {
    const quebrado = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html>502</html>", { status: 200 }));
    const t = criarTranscritorDeArquivoGoogle({
      token: async () => "tok",
      projeto: "p",
      fetchImpl: quebrado,
    });
    await expect(
      t.transcrever({ bytes: audio, mime: "audio/wav", idioma: "pt-BR" }),
    ).rejects.toThrow("conector_indisponivel");
    expect(
      lerRespostaRecognize({
        results: [
          {
            alternatives: [
              { words: [{ word: "certa", startOffset: "0s", endOffset: "0.5s" }] },
              { words: [{ word: "errada", startOffset: "0s", endOffset: "0.5s" }] },
            ],
          },
        ],
      }).palavras.map((p) => p.texto),
    ).toEqual(["certa"]);
  });

  it("classificar400 reconhece as mensagens de duração e de formato", () => {
    expect(
      classificar400(
        "Sync input too long. For audio longer than 1 min use BatchRecognize",
      ),
    ).toBe("longo");
    expect(
      classificar400("Request payload size exceeds the limit: 10485760 bytes."),
    ).toBe("longo");
    expect(classificar400("Unable to decode audio")).toBe("nao_suportado");
    expect(classificar400("")).toBeNull();
  });

  it("log nunca leva token, texto nem a mensagem do Google", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respostaOk())
      .mockResolvedValueOnce(
        erro(400, `Audio can be of a maximum of 60 seconds ${SEGREDO}`),
      )
      .mockResolvedValueOnce(erro(500, SEGREDO))
      .mockResolvedValueOnce(erro(403, SEGREDO));
    const t = criarTranscritorDeArquivoGoogle({
      token: async () => "tok-super-secreto",
      projeto: "p",
      fetchImpl: f,
    });
    await t.transcrever({ bytes: audio, mime: "audio/wav", idioma: "pt-BR" });
    for (let i = 0; i < 3; i++)
      await t
        .transcrever({ bytes: audio, mime: "audio/wav", idioma: "pt-BR" })
        .catch(() => {});
    expect(linhasLog()).toContain("voz_stt_arquivo_falhou");
    // QA NOD-329: o caminho do 401/403 (log de erro próprio) também não leva o token
    expect(linhasLog()).toContain("voz_stt_arquivo_autenticacao");
    expect(linhasLog()).not.toContain(SEGREDO);
    expect(linhasLog()).not.toContain("tok-super-secreto");
    expect(linhasLog()).not.toContain("maximum");
  });
});
