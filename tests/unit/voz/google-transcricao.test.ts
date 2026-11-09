import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bytesParaPcm } from "../../../src/adapters/voz/audio.ts";
import {
  criarTranscritorGoogle,
  FINAL_SEM_SINAL_MS,
  lerMsgLive,
  urlLiveVertex,
  type AbrirConexaoWs,
  type EventosConexaoWs,
} from "../../../src/adapters/voz/google-transcricao.ts";
import type { ResultadoStt } from "../../../src/adapters/voz/spi.ts";

type Enviado = Record<string, unknown>;
type ConexaoFalsa = { url: string; headers: Record<string, string>; enviados: Enviado[]; ev: EventosConexaoWs; fechada: boolean };

/** Transporte injetado no lugar do WebSocket: grava o que o cliente manda e deixa o teste falar como o servidor. */
function transporteFalso(o: { setupAutomatico?: boolean; fecharNoSetup?: number } = {}) {
  const conexoes: ConexaoFalsa[] = [];
  const abrir: AbrirConexaoWs = (url, headers, ev) => {
    const c: ConexaoFalsa = { url, headers, enviados: [], ev, fechada: false };
    conexoes.push(c);
    queueMicrotask(() => ev.aoAbrir());
    return {
      enviar(t) {
        const m = JSON.parse(t) as Enviado;
        c.enviados.push(m);
        if (m.setup !== undefined) {
          if (o.fecharNoSetup) queueMicrotask(() => ev.aoFechar(o.fecharNoSetup ?? 1000));
          else if (o.setupAutomatico !== false) queueMicrotask(() => ev.aoMensagem(JSON.stringify({ setupComplete: {} })));
        }
      },
      fechar() {
        c.fechada = true;
      },
    };
  };
  const servidor = (c: ConexaoFalsa | undefined, msg: object) => c?.ev.aoMensagem(JSON.stringify(msg));
  return { conexoes, abrir, servidor };
}

const transcricao = (text: string, finished?: boolean) => ({ serverContent: { inputTranscription: finished === undefined ? { text } : { text, finished } } });
const tipos = (c: ConexaoFalsa | undefined) =>
  (c?.enviados ?? []).map((m) => {
    const ri = m.realtimeInput as Record<string, unknown> | undefined;
    if (m.setup) return "setup";
    if (ri?.activityStart) return "inicio";
    if (ri?.activityEnd) return "fim";
    if (ri?.audio) return "audio";
    return "?";
  });
const audiosDe = (c: ConexaoFalsa | undefined) =>
  (c?.enviados ?? []).flatMap((m) => {
    const audio = (m.realtimeInput as { audio?: { data: string; mimeType: string } } | undefined)?.audio;
    return audio ? [audio] : [];
  });

async function abrirSessao(t: ReturnType<typeof transporteFalso>, extra: { rotacaoMs?: number; agora?: () => number; vocabulario?: string[] } = {}) {
  const resultados: ResultadoStt[] = [];
  const erros: Error[] = [];
  const stt = criarTranscritorGoogle({ token: async () => "tok-123", projeto: "proj-1", abrirConexao: t.abrir, rotacaoMs: extra.rotacaoMs, agora: extra.agora });
  const s = await stt.abrir({ idioma: "pt-BR", vocabulario: extra.vocabulario, aoResultado: (r) => resultados.push(r), aoErro: (e) => erros.push(e) });
  return { stt, s, resultados, erros };
}

const quadro = (v: number) => new Int16Array(320).fill(v);
const tique = () => new Promise((r) => setTimeout(r, 0));

describe("voz: STT Live API (transporte falso)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("abre no endpoint do Vertex com token no header e manda o setup com VAD manual e transcrição de entrada", async () => {
    const t = transporteFalso();
    const { stt, s } = await abrirSessao(t, { vocabulario: ["Tuca", "Nod"] });
    expect(stt.capacidades).toEqual({ parciais: true, vocabulario: true, fimDeFalaManual: true });
    const c = t.conexoes[0];
    expect(c?.url).toBe("wss://aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent");
    expect(c?.headers).toEqual({ Authorization: "Bearer tok-123", "x-goog-user-project": "proj-1" });
    const setup = c?.enviados[0]?.setup as Record<string, unknown>;
    expect(setup.model).toBe("projects/proj-1/locations/global/publishers/google/models/gemini-3.5-transcribe-live-preview");
    expect(setup.inputAudioTranscription).toEqual({});
    expect(setup.realtimeInputConfig).toEqual({ automaticActivityDetection: { disabled: true } });
    expect(JSON.stringify(setup.systemInstruction)).toContain("Tuca, Nod");
    expect(urlLiveVertex("global")).toBe("wss://aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent");
    await s.fechar();
    expect(c?.fechada).toBe(true);
  });

  it("um trecho: activityStart, áudio base64 16 kHz, parciais somadas, activityEnd e o final no `finished`", async () => {
    const t = transporteFalso();
    const { s, resultados } = await abrirSessao(t);
    const c = t.conexoes[0];
    s.enviar(quadro(7));
    s.enviar(quadro(-3));
    t.servidor(c, transcricao("Cria uma"));
    t.servidor(c, transcricao(" rotina"));
    s.fimDeFala();
    t.servidor(c, transcricao(" pro Tuca.", true));
    expect(tipos(c)).toEqual(["setup", "inicio", "audio", "audio", "fim"]);
    const audios = audiosDe(c);
    expect(audios[0]?.mimeType).toBe("audio/pcm;rate=16000");
    expect(bytesParaPcm(Buffer.from(audios[1]?.data ?? "", "base64"))).toEqual(quadro(-3));
    expect(resultados).toEqual([
      { texto: "Cria uma", final: false, confianca: null },
      { texto: "Cria uma rotina", final: false, confianca: null },
      { texto: "Cria uma rotina pro Tuca.", final: false, confianca: null },
      { texto: "Cria uma rotina pro Tuca.", final: true, confianca: null },
    ]);
    // o próximo trecho começa limpo
    s.enviar(quadro(1));
    t.servidor(c, transcricao("Oi"));
    s.fimDeFala();
    t.servidor(c, { serverContent: { turnComplete: true } });
    expect(resultados.at(-1)).toEqual({ texto: "Oi", final: true, confianca: null });
  });

  it("parciais do Transcribe Live (`interimInputTranscription`, texto acumulado) e o final do `inputTranscription`, como ao vivo em 2026-10-04", async () => {
    const t = transporteFalso();
    const { s, resultados } = await abrirSessao(t);
    const c = t.conexoes[0];
    const interina = (text: string) => ({ serverContent: { interimInputTranscription: { text } } });
    s.enviar(quadro(5));
    t.servidor(c, interina("Hoy"));
    t.servidor(c, interina("Oi, aqui é a Nina."));
    t.servidor(c, interina("Oi, aqui é a Nina. Me conta,"));
    s.fimDeFala();
    t.servidor(c, transcricao("Oi, aqui é a Nina. Me conta, qual é a tarefa?"));
    t.servidor(c, { serverContent: { generationComplete: true } });
    expect(resultados.map((r) => [r.texto, r.final])).toEqual([
      ["Hoy", false],
      ["Oi, aqui é a Nina.", false],
      ["Oi, aqui é a Nina. Me conta,", false],
      ["Oi, aqui é a Nina. Me conta, qual é a tarefa?", false],
      ["Oi, aqui é a Nina. Me conta, qual é a tarefa?", true],
    ]);
    // Sem `inputTranscription`, o final é a última parcial.
    s.enviar(quadro(5));
    t.servidor(c, interina("Pode criar"));
    s.fimDeFala();
    t.servidor(c, { serverContent: { turnComplete: true } });
    expect(resultados.at(-1)).toEqual({ texto: "Pode criar", final: true, confianca: null });
  });

  it("sem sinal de fim, fecha o final 2 s depois do activityEnd com o que houver", async () => {
    vi.useFakeTimers();
    const t = transporteFalso();
    const { s, resultados } = await abrirSessao(t);
    s.enviar(quadro(5));
    t.servidor(t.conexoes[0], transcricao("tá bom"));
    s.fimDeFala();
    await vi.advanceTimersByTimeAsync(FINAL_SEM_SINAL_MS - 1);
    expect(resultados.filter((r) => r.final)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(resultados.filter((r) => r.final)).toEqual([{ texto: "tá bom", final: true, confianca: null }]);
  });

  it("áudio que chega com o final pendente vai como o trecho seguinte, depois do final, sem perder quadro", async () => {
    const t = transporteFalso();
    const { s, resultados } = await abrirSessao(t);
    const c = t.conexoes[0];
    s.enviar(quadro(1));
    s.fimDeFala();
    s.enviar(quadro(2));
    s.enviar(quadro(3));
    expect(tipos(c)).toEqual(["setup", "inicio", "audio", "fim"]);
    t.servidor(c, transcricao("primeiro", true));
    expect(tipos(c)).toEqual(["setup", "inicio", "audio", "fim", "inicio", "audio", "audio"]);
    expect(audiosDe(c).map((a) => bytesParaPcm(Buffer.from(a.data, "base64"))[0])).toEqual([1, 2, 3]);
    t.servidor(c, transcricao("segundo"));
    s.fimDeFala();
    t.servidor(c, transcricao("", true));
    expect(resultados.filter((r) => r.final).map((r) => r.texto)).toEqual(["primeiro", "segundo"]);
  });

  it("trecho que começa e acaba com o final anterior pendente fecha assim que é reenviado (antes ficava aberto para sempre)", async () => {
    const t = transporteFalso();
    const { s, resultados } = await abrirSessao(t);
    const c = t.conexoes[0];
    s.enviar(quadro(1));
    s.fimDeFala();
    // O trecho B inteiro acontece antes de o final de A chegar.
    s.enviar(quadro(2));
    s.enviar(quadro(3));
    s.fimDeFala();
    // E o C começa, ainda com o final de A pendente.
    s.enviar(quadro(4));
    expect(tipos(c)).toEqual(["setup", "inicio", "audio", "fim"]);
    t.servidor(c, transcricao("primeira parte", true));
    // B foi reenviado e fechado na hora; C espera o final de B.
    expect(tipos(c)).toEqual(["setup", "inicio", "audio", "fim", "inicio", "audio", "audio", "fim"]);
    t.servidor(c, transcricao("segunda parte", true));
    expect(tipos(c)).toEqual(["setup", "inicio", "audio", "fim", "inicio", "audio", "audio", "fim", "inicio", "audio"]);
    s.fimDeFala();
    t.servidor(c, transcricao("terceira parte", true));
    expect(resultados.filter((r) => r.final).map((r) => r.texto)).toEqual(["primeira parte", "segunda parte", "terceira parte"]);
    expect(audiosDe(c).map((a) => bytesParaPcm(Buffer.from(a.data, "base64"))[0])).toEqual([1, 2, 3, 4]);
  });

  it("descartar com o final anterior pendente tira só o trecho em curso: o final anterior e os trechos já fechados seguem", async () => {
    const t = transporteFalso();
    const { s, resultados } = await abrirSessao(t);
    const c = t.conexoes[0];
    s.enviar(quadro(1));
    s.fimDeFala();
    s.enviar(quadro(2));
    s.fimDeFala();
    // Uma batida curta (ruído) depois: o orquestrador descarta.
    s.enviar(quadro(9));
    s.descartar();
    // Descartar de novo, sem nada em curso, não engole o que já fechou.
    s.descartar();
    t.servidor(c, transcricao("primeira parte", true));
    t.servidor(c, transcricao("segunda parte", true));
    expect(resultados.filter((r) => r.final).map((r) => r.texto)).toEqual(["primeira parte", "segunda parte"]);
    expect(audiosDe(c).map((a) => bytesParaPcm(Buffer.from(a.data, "base64"))[0])).toEqual([1, 2]);
    expect(tipos(c).at(-1)).toBe("fim");
  });

  it("guardando() diz quando o trecho em curso ainda não foi ao provedor; o trecho que não coube nos 10 s ainda ganha o final dele", async () => {
    const t = transporteFalso();
    const { s, resultados } = await abrirSessao(t);
    const c = t.conexoes[0];
    expect(s.guardando?.()).toBe(false);
    s.enviar(quadro(1));
    expect(s.guardando?.()).toBe(false);
    s.fimDeFala();
    expect(s.guardando?.()).toBe(true);
    // B enche os 10 s guardados (500 quadros de 20 ms); C não cabe, mas a fala dele também acaba.
    for (let i = 0; i < 500; i++) s.enviar(quadro(2));
    s.fimDeFala();
    s.enviar(quadro(3));
    s.fimDeFala();
    t.servidor(c, transcricao("primeira", true));
    t.servidor(c, transcricao("segunda", true));
    // C foi aberto e fechado sem áudio: o final dele (vazio) mantém um final por trecho.
    expect(tipos(c).slice(-2)).toEqual(["inicio", "fim"]);
    t.servidor(c, { serverContent: { turnComplete: true } });
    expect(resultados.filter((r) => r.final).map((r) => r.texto)).toEqual(["primeira", "segunda", ""]);
    expect(s.guardando?.()).toBe(false);
  });

  it("descartar fecha a atividade no servidor e engole o final daquele trecho", async () => {
    const t = transporteFalso();
    const { s, resultados } = await abrirSessao(t);
    const c = t.conexoes[0];
    s.enviar(quadro(1));
    s.descartar();
    t.servidor(c, transcricao("eco do bot", true));
    expect(tipos(c)).toEqual(["setup", "inicio", "audio", "fim"]);
    expect(resultados).toEqual([]);
    s.enviar(quadro(1));
    s.fimDeFala();
    t.servidor(c, transcricao("valeu", true));
    expect(resultados.filter((r) => r.final).map((r) => r.texto)).toEqual(["valeu"]);
  });

  it("rotação: aos N min abre a nova, espera o setupComplete e só troca na fronteira do trecho", async () => {
    vi.useFakeTimers();
    let agora = 0;
    const t = transporteFalso();
    const { s, resultados } = await abrirSessao(t, { rotacaoMs: 1_000, agora: () => agora });
    const velha = t.conexoes[0];
    s.enviar(quadro(1)); // trecho em curso na velha
    agora = 1_000;
    await vi.advanceTimersByTimeAsync(250);
    const nova = t.conexoes[1];
    expect(nova?.enviados[0]?.setup).toBeDefined();
    expect(velha?.fechada).toBe(false);
    s.enviar(quadro(2)); // ainda na velha: o trecho não acabou
    s.fimDeFala();
    expect(tipos(nova)).toEqual(["setup"]);
    t.servidor(velha, transcricao("antes da troca", true));
    expect(velha?.fechada).toBe(true);
    s.enviar(quadro(3));
    s.fimDeFala();
    t.servidor(nova, transcricao("depois da troca", true));
    expect(tipos(velha)).toEqual(["setup", "inicio", "audio", "audio", "fim"]);
    expect(tipos(nova)).toEqual(["setup", "inicio", "audio", "fim"]);
    expect(resultados.filter((r) => r.final).map((r) => r.texto)).toEqual(["antes da troca", "depois da troca"]);
    await s.fechar();
    expect(nova?.fechada).toBe(true);
  });

  it("goAway com a sessão livre troca assim que a nova fica pronta; mensagens da velha depois disso são ignoradas", async () => {
    const t = transporteFalso();
    const { s, resultados } = await abrirSessao(t);
    const velha = t.conexoes[0];
    t.servidor(velha, { goAway: { timeLeft: "50s" } });
    await tique();
    expect(t.conexoes).toHaveLength(2);
    expect(velha?.fechada).toBe(true);
    t.servidor(velha, transcricao("fantasma", true));
    s.enviar(quadro(1));
    s.fimDeFala();
    t.servidor(t.conexoes[1], transcricao("nova", true));
    expect(resultados.map((r) => r.texto)).toEqual(["nova", "nova"]);
  });

  it("queda inesperada vira aoErro conector_indisponivel; nossa própria troca não", async () => {
    const t = transporteFalso();
    const { erros } = await abrirSessao(t);
    t.conexoes[0]?.ev.aoFechar(1011);
    expect(erros.map((e) => e.message)).toEqual(["conector_indisponivel"]);
    expect(t.conexoes[0]?.fechada).toBe(true);
  });

  it("recusa no setup (1008) é autenticação; sem projeto é configuração", async () => {
    await expect(abrirSessao(transporteFalso({ fecharNoSetup: 1008 }))).rejects.toThrow("integracao_autenticacao");
    await expect(abrirSessao(transporteFalso({ fecharNoSetup: 1011 }))).rejects.toThrow("conector_indisponivel");
    const stt = criarTranscritorGoogle({ token: async () => "t", projeto: null, abrirConexao: transporteFalso().abrir });
    await expect(stt.abrir({ idioma: "pt-BR", aoResultado: () => {}, aoErro: () => {} })).rejects.toThrow("integracao_nao_configurada");
  });

  it("lerMsgLive ignora lixo e lê só o que importa", () => {
    expect(lerMsgLive("não é json")).toBeNull();
    expect(lerMsgLive("[1,2]")).toBeNull();
    expect(lerMsgLive('{"setupComplete":{}}')).toMatchObject({ setupComplete: true, transcricao: null });
    expect(lerMsgLive('{"serverContent":{"inputTranscription":{"text":42}}}')).toMatchObject({ transcricao: null });
    expect(lerMsgLive('{"serverContent":{"generationComplete":true}}')).toMatchObject({ turnoCompleto: true });
  });
});
