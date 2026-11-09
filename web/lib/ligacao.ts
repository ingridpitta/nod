import type { MsgMidiaCliente, MsgMidiaServidor, RotaSaida } from "../../src/contracts/voz.ts";
import { decidirPorVoz, type DecisaoPorVoz } from "./api.ts";
import type { EstadoLocalLigacao } from "./ligacao-protocolo.ts";
import { FECHAMENTOS, fechamentoDefinitivo, lerMsgServidor, lerQuadroVoz, mensagemCliente, quadroMicrofone, rotaPeloNome, VERSAO_PROTOCOLO } from "./ligacao-protocolo.ts";
// Os worklets entram como bundle próprio (definido em 2026-10-04): `new URL("./x.worklet.ts", import.meta.url)` faz o
// Vite copiar o .ts CRU para o build (asset), e o AudioWorklet não entende TypeScript; `?worker&url` compila o arquivo
// com os imports dele e devolve a URL do .js gerado (conferido em `npm run build`: dist/web/assets/*.worklet-*.js).
import urlCaptura from "./ligacao-captura.worklet.ts?worker&url";
import urlToque from "./ligacao-toque.worklet.ts?worker&url";

/**
 * Motor da ligação no renderer (definido em 2026-10-04, ADR-071; plano "Peças" e "Protocolo nod-voz/1"): microfone com
 * o AEC do Chromium, os dois worklets, o canal de mídia e as reconexões. A tela (web/telas/ligacao.ts) só recebe os
 * eventos e chama a API daqui; o motor não desenha nada.
 *
 * - A voz do bot toca no MESMO AudioContext do microfone: é a referência do cancelamento de eco. Nunca pelo processo
 *   principal do Electron.
 * - O canal é a mesma origem da página (`/api/t/:tenant/voz/v1/midia`); o cookie da sessão vai sozinho.
 * - `ola` logo ao abrir, `ping` a cada 15 s; caiu, tenta de novo por até 10 s com `ola{retomar:true}`.
 */
export type { EstadoLocalLigacao };
export type EventoMotor =
  | MsgMidiaServidor
  | { t: "local"; estado: EstadoLocalLigacao }
  /** Quem está com a voz agora, visto daqui: o bot (o toque saindo no alto-falante) ou a pessoa (energia no microfone). */
  | { t: "voz-local"; quem: "bot" | "pessoa"; ativo: boolean };

export type MotorLigacao = {
  mudo(ativo: boolean): void;
  /** O composer durante a ligação: vira uma vez da pessoa sem passar pelo STT. false = o canal não está aberto. */
  enviarTexto(texto: string): boolean;
  /** Com o aviso "a IA caiu" na tela, a pessoa abriu o login ou a instalação de uma IA: a espera da escolha recomeça. */
  resolvendo(): void;
  /** Manda `tchau` e fecha. O POST de encerrar é da tela (o motor não conhece a rota da ligação). */
  desligar(): void;
  /** Fecha tudo sem `tchau` (a ligação acabou do outro lado, ou a página está saindo). */
  fechar(): void;
  /** O navegador segurou o áudio sem um clique (autoplay): chamar dentro do clique da pessoa. */
  retomarAudio(): Promise<void>;
};

export type OpcoesMotor = {
  tenantId: string;
  ligacaoId: string;
  /** A página foi recarregada no meio da ligação: o primeiro `ola` já pede para retomar. */
  retomar?: boolean;
  aoEvento: (ev: EventoMotor) => void;
  /** Para teste; o padrão é a rota de decisão com o cookie da página. */
  decidir?: (decisaoId: string, corpo: DecisaoPorVoz) => Promise<unknown>;
};

/** definido em 2026-10-04 (plano, "Regras"): reconexão da mídia em até 10 s; ping a cada 15 s. */
const RECONEXAO_MAX_MS = 10_000;
const PING_MS = 15_000;
/** Com mais que isto parado no socket (rede lenta), o quadro do microfone é descartado em vez de acumular atraso. */
const ATRASO_MAX_BYTES = 32 * 1024;
const TEXTO_MAX = 2_000;
/** Voz que chega antes de o worklet de toque existir: guarda poucos quadros (uns 2 s), o resto se perde. */
const PENDENTES_MAX = 100;

const RESTRICOES_AUDIO = { noiseSuppression: true, autoGainControl: true, channelCount: 1 } as const;

async function abrirMicrofone(): Promise<MediaStream> {
  // revisto em 2026-10-04 (teste do Marlon no Chrome do Mac): com echoCancellation "all" o microfone chegava ao servidor
  // só com zeros (35 s de áudio, energia 0). Volta ao AEC padrão do Chromium, que já usa a voz tocada nesta página como
  // referência.
  return navigator.mediaDevices.getUserMedia({ audio: { ...RESTRICOES_AUDIO, echoCancellation: true } });
}

export function iniciarMotorLigacao(o: OpcoesMotor): MotorLigacao {
  const decidir = o.decidir ?? ((decisaoId: string, corpo: DecisaoPorVoz) => decidirPorVoz(o.tenantId, decisaoId, corpo));
  let fechado = false;
  let encerrada = false;
  let mudo = false;
  let ws: WebSocket | null = null;
  let seq = 0;
  let jaAbriu = false;
  let ping: number | null = null;
  let reconexao: { desde: number; tentativa: number; timer: number | null } | null = null;
  let ctx: AudioContext | null = null;
  let toque: AudioWorkletNode | null = null;
  let captura: AudioWorkletNode | null = null;
  let fonte: MediaStreamAudioSourceNode | null = null;
  let microfone: MediaStream | null = null;
  let trocaDeAparelho: number | null = null;
  let rota: RotaSaida = "desconhecida";
  const vozPendente: { utt: number; pcm: Int16Array }[] = [];

  const emitir = (ev: EventoMotor): void => {
    if (!fechado) o.aoEvento(ev);
  };
  const enviar = (m: MsgMidiaCliente): boolean => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(mensagemCliente(m));
    return true;
  };

  // ---- canal de mídia ----------------------------------------------------------------------------------------------
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/t/${encodeURIComponent(o.tenantId)}/voz/v1/midia`;

  function conectar(): void {
    if (fechado || encerrada) return;
    const s = new WebSocket(url);
    s.binaryType = "arraybuffer";
    ws = s;
    s.onopen = () => {
      if (ws !== s) return;
      const retomar = jaAbriu || o.retomar === true;
      jaAbriu = true;
      enviar({ t: "ola", v: VERSAO_PROTOCOLO, ligacaoId: o.ligacaoId, entrada: "pcm16", saida: "pcm16", ...(retomar ? { retomar: true } : {}) });
      if (mudo) enviar({ t: "mudo", ativo: true });
      if (rota !== "desconhecida") enviar({ t: "saida", rota });
      if (reconexao) {
        if (reconexao.timer !== null) window.clearTimeout(reconexao.timer);
        reconexao = null;
        emitir({ t: "local", estado: "conectado" });
      }
      if (ping !== null) window.clearInterval(ping);
      ping = window.setInterval(() => enviar({ t: "ping" }), PING_MS);
    };
    s.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
      if (ws !== s) return;
      if (typeof e.data === "string") receberControle(e.data);
      else receberVoz(e.data);
    };
    s.onclose = (e) => {
      if (ws !== s) return;
      ws = null;
      if (ping !== null) window.clearInterval(ping);
      ping = null;
      if (fechado || encerrada) return;
      if (fechamentoDefinitivo(e.code)) {
        encerrada = true;
        emitir({ t: "local", estado: e.code === FECHAMENTOS.encerrada ? "encerrada-pelo-servidor" : e.code === FECHAMENTOS.vozFora ? "voz-fora" : e.code === FECHAMENTOS.jaEmLigacao ? "ja-em-ligacao" : e.code === FECHAMENTOS.sessao ? "sessao-expirada" : "caiu" });
        return;
      }
      reconectar();
    };
  }

  function reconectar(): void {
    const agora = Date.now();
    if (!reconexao) {
      reconexao = { desde: agora, tentativa: 0, timer: null };
      emitir({ t: "local", estado: "reconectando" });
    }
    if (agora - reconexao.desde >= RECONEXAO_MAX_MS) {
      reconexao = null;
      encerrada = true;
      emitir({ t: "local", estado: "caiu" });
      return;
    }
    const espera = Math.min(250 * 2 ** reconexao.tentativa, 2_000, Math.max(0, RECONEXAO_MAX_MS - (agora - reconexao.desde)));
    reconexao.tentativa += 1;
    reconexao.timer = window.setTimeout(() => {
      if (reconexao) reconexao.timer = null;
      conectar();
    }, espera);
  }

  function receberControle(texto: string): void {
    const m = lerMsgServidor(texto);
    if (!m) return;
    if (m.t === "interromper") toque?.port.postMessage({ tipo: "interromper", utt: m.utt });
    else if (m.t === "subir") toque?.port.postMessage({ tipo: "subir" });
    else if (m.t === "comando") {
      void decidir(m.decisaoId, { canal: "voz", ligacaoId: o.ligacaoId, comandoId: m.comandoId, acao: m.acao }).catch(() => emitir({ t: "local", estado: "comando-falhou" }));
    } else if (m.t === "fim") encerrada = true;
    if (m.t !== "pong") emitir(m);
  }

  function receberVoz(buf: ArrayBuffer): void {
    const q = lerQuadroVoz(buf);
    if (!q) return;
    if (!toque) {
      if (vozPendente.length < PENDENTES_MAX) vozPendente.push({ utt: q.utt, pcm: q.pcm });
      return;
    }
    toque.port.postMessage({ tipo: "voz", utt: q.utt, pcm: q.pcm }, [q.pcm.buffer]);
  }

  // Diagnóstico (definido em 2026-10-04): 4 s de quadros só com zeros = microfone que abriu mas não manda som.
  let quadrosZerados = 0;
  let avisouMudo = false;
  function conferirSilencioAbsoluto(pcm: Int16Array): void {
    if (avisouMudo || mudo) return;
    let zero = true;
    for (let i = 0; i < pcm.length; i++) if (pcm[i] !== 0) { zero = false; break; }
    quadrosZerados = zero ? quadrosZerados + 1 : 0;
    if (quadrosZerados >= 200) {
      avisouMudo = true;
      emitir({ t: "local", estado: "microfone-mudo" });
    }
  }

  function enviarQuadro(pcm: Int16Array): void {
    conferirSilencioAbsoluto(pcm);
    if (mudo || !ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > ATRASO_MAX_BYTES) return;
    ws.send(quadroMicrofone(seq, pcm));
    seq = (seq + 1) >>> 0;
  }

  // ---- áudio ---------------------------------------------------------------------------------------------------------
  async function prepararAudio(): Promise<void> {
    const c = new AudioContext({ latencyHint: "interactive" });
    ctx = c;
    await Promise.all([c.audioWorklet.addModule(urlToque), c.audioWorklet.addModule(urlCaptura)]);
    if (fechado) return;
    const t = new AudioWorkletNode(c, "nod-ligacao-toque", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    t.connect(c.destination);
    t.port.onmessage = (e: MessageEvent<{ tipo: string; utt?: number; ms?: number; ativo?: boolean }>) => {
      const m = e.data;
      if (m.tipo === "tocado" && typeof m.utt === "number" && typeof m.ms === "number") enviar({ t: "tocado", utt: m.utt, ms: m.ms });
      else if (m.tipo === "tocou-fim" && typeof m.utt === "number") enviar({ t: "tocou-fim", utt: m.utt });
      else if (m.tipo === "interrompido" && typeof m.utt === "number" && typeof m.ms === "number") enviar({ t: "interrompido", utt: m.utt, ms: m.ms });
      else if (m.tipo === "falando") emitir({ t: "voz-local", quem: "bot", ativo: m.ativo === true });
    };
    toque = t;
    for (const v of vozPendente.splice(0)) t.port.postMessage({ tipo: "voz", utt: v.utt, pcm: v.pcm }, [v.pcm.buffer]);
    if (c.state === "suspended") await c.resume().catch(() => undefined);
    if (c.state === "suspended") emitir({ t: "local", estado: "audio-suspenso" });

    // O macOS pergunta antes do Chromium (no app): negado lá, getUserMedia nem chega a pedir.
    const acesso = await window.nodDesktop?.microfone?.().catch(() => undefined);
    if (acesso === "negado" || acesso === "restrito") {
      emitir({ t: "local", estado: acesso === "negado" ? "microfone-negado" : "microfone-restrito" });
      return;
    }
    await ligarMicrofone(c, t);
  }

  async function ligarMicrofone(c: AudioContext, t: AudioWorkletNode): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await abrirMicrofone();
    } catch (e) {
      const nome = e instanceof DOMException ? e.name : "";
      emitir({ t: "local", estado: nome === "NotAllowedError" || nome === "SecurityError" ? "microfone-negado" : "microfone-indisponivel" });
      return;
    }
    if (fechado) {
      for (const tr of stream.getTracks()) tr.stop();
      return;
    }
    microfone = stream;
    void detectarRota();
    for (const tr of stream.getAudioTracks()) tr.enabled = !mudo;
    fonte = c.createMediaStreamSource(stream);
    if (!captura) {
      const cap = new AudioWorkletNode(c, "nod-ligacao-captura", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      // A captura não toca nada: a saída vai para um ganho zero só para o nó continuar sendo puxado pelo grafo.
      const mudoNoGrafo = c.createGain();
      mudoNoGrafo.gain.value = 0;
      cap.connect(mudoNoGrafo).connect(c.destination);
      cap.port.onmessage = (e: MessageEvent<{ tipo: string; pcm?: Int16Array; ativo?: boolean }>) => {
        if (e.data.tipo === "quadro" && e.data.pcm) enviarQuadro(e.data.pcm);
        else if (e.data.tipo === "fala") emitir({ t: "voz-local", quem: "pessoa", ativo: e.data.ativo === true });
      };
      // As duas pontas se falam direto, sem o thread principal no meio: o "abaixar" chega ao toque em um bloco de áudio.
      const canal = new MessageChannel();
      t.port.postMessage({ tipo: "porta", porta: canal.port1 }, [canal.port1]);
      cap.port.postMessage({ tipo: "porta", porta: canal.port2 }, [canal.port2]);
      if (mudo) cap.port.postMessage({ tipo: "mudo", ativo: true });
      captura = cap;
    }
    fonte.connect(captura);
  }

  /** Fone ou alto-falante pelo nome da saída padrão (os nomes só aparecem depois da permissão do microfone). */
  async function detectarRota(): Promise<void> {
    try {
      const saidas = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
      const padrao = saidas.find((d) => d.deviceId === "default") ?? saidas[0];
      const nova = rotaPeloNome(padrao?.label ?? "");
      if (nova === rota) return;
      rota = nova;
      enviar({ t: "saida", rota });
    } catch {
      // sem a lista de aparelhos, o servidor segue conservador ("desconhecida")
    }
  }

  /** AirPods e fones Bluetooth trocam o aparelho no meio da ligação: a captura reabre no aparelho novo. */
  function aoTrocarAparelho(): void {
    if (trocaDeAparelho !== null) window.clearTimeout(trocaDeAparelho);
    trocaDeAparelho = window.setTimeout(() => {
      trocaDeAparelho = null;
      if (fechado || !ctx || !toque || !microfone) return;
      fonte?.disconnect();
      for (const tr of microfone.getTracks()) tr.stop();
      microfone = null;
      void ligarMicrofone(ctx, toque);
    }, 500);
  }

  navigator.mediaDevices?.addEventListener?.("devicechange", aoTrocarAparelho);
  void window.nodDesktop?.emLigacao?.(true).catch(() => undefined);
  conectar();
  void prepararAudio().catch(() => emitir({ t: "local", estado: "microfone-indisponivel" }));

  function fechar(): void {
    if (fechado) return;
    fechado = true;
    if (ping !== null) window.clearInterval(ping);
    if (reconexao?.timer) window.clearTimeout(reconexao.timer);
    if (trocaDeAparelho !== null) window.clearTimeout(trocaDeAparelho);
    navigator.mediaDevices?.removeEventListener?.("devicechange", aoTrocarAparelho);
    const s = ws;
    ws = null;
    s?.close(1000);
    for (const tr of microfone?.getTracks() ?? []) tr.stop();
    void ctx?.close().catch(() => undefined);
    void window.nodDesktop?.emLigacao?.(false).catch(() => undefined);
  }

  return {
    mudo(ativo) {
      mudo = ativo;
      for (const tr of microfone?.getAudioTracks() ?? []) tr.enabled = !ativo;
      captura?.port.postMessage({ tipo: "mudo", ativo });
      enviar({ t: "mudo", ativo });
    },
    enviarTexto(texto) {
      // Por code point (NOD-398): o corte não deixa meio emoji (surrogate solto) no texto que vai à fala.
      const conteudo = [...texto.trim()].slice(0, TEXTO_MAX).join("");
      return conteudo !== "" && enviar({ t: "texto", conteudo });
    },
    resolvendo() {
      enviar({ t: "resolvendo" });
    },
    desligar() {
      enviar({ t: "tchau" });
      fechar();
    },
    fechar,
    async retomarAudio() {
      await ctx?.resume().catch(() => undefined);
    },
  };
}
