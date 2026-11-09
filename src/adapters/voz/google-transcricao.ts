import { TAXA_MICROFONE_HZ } from "../../contracts/voz.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { log } from "../../obs/log.ts";
import { pcmParaBytes } from "./audio.ts";
import type { OpcoesSessaoStt, SessaoStt, Transcritor } from "./spi.ts";

/**
 * STT `google` pela Live API do Vertex AI (Transcribe Live), por WebSocket (definido em 2026-10-04, ADR-071).
 *
 * Como funciona: uma conexão por ligação; o VAD é o do nod (`automaticActivityDetection.disabled`), então cada trecho
 * vai entre `activityStart` e `activityEnd`. As parciais vêm de `serverContent.interimInputTranscription`, cada uma com o
 * texto do trecho até ali (conferido ao vivo em 2026-10-04: uma a cada ~0,5 s); o texto final vem de
 * `serverContent.inputTranscription` (pedaços somados; sem ele, vale a última parcial). O final sai quando o servidor fecha a transcrição (`finished`, `turnComplete` ou `generationComplete`) ou, se nada disso
 * chegar, 2 s depois do `activityEnd` com o que houver. Áudio que chega enquanto um final está pendente fica guardado e
 * vai como o trecho seguinte, depois do final (a ordem dos finais nunca se inverte). Cada trecho guardado continua
 * sendo um trecho: se ele acaba (`fimDeFala`) antes de o final anterior chegar, fecha assim que for reenviado
 * (definido em 2026-10-04: antes o `fimDeFala` era ignorado nesse estado, o trecho ficava aberto para sempre e a vez
 * da pessoa nunca era decidida).
 *
 * Rotação: a Live API do Vertex fecha a sessão aos 10 min. Aos 9 min (ou num `goAway`), abre a conexão nova, espera o
 * `setupComplete` e só troca numa fronteira de trecho; a antiga só fecha depois da troca. Nenhum quadro se perde: até a
 * troca, o áudio vai para a antiga.
 *
 * Autenticação: header `Authorization: Bearer` (+ `x-goog-user-project`). Conferido em 2026-10-04 contra um servidor
 * node:http local: o `WebSocket` global do Node 24.19 (undici) manda os headers de `new WebSocket(url, { headers })`,
 * então o token não precisa ir na query (`access_token`), onde vazaria em log de proxy.
 *
 * Modelo e região conferidos ao vivo em 2026-10-04 (listagem `publishers/google/models` do Vertex + setup pela Live
 * API): o id é "gemini-3.5-transcribe-live-preview" (`NOD_VOZ_STT_MODELO`) e só existe em `global` (`NOD_VOZ_REGIAO`);
 * em us-central1 o setup fecha com 1008 "Publisher model … was not found".
 *
 * A CONFIRMAR (NOD-166, com o ADC de produção; cada item tem a medição pronta, e o resultado vai para
 * docs/uat-modo-ligacao.md e para cá):
 * - se o modelo de transcrição pede `responseModalities` (mandamos ["TEXT"]) e se responde algo além da transcrição
 *   (o que vier em `modelTurn` é ignorado): `node scripts/voz/sonda-google.ts` conta as mensagens com `modelTurn`;
 * - se o vocabulário influencia a transcrição pela `systemInstruction` (é o único lugar que a Live API oferece):
 *   `scripts/teste-cego-voz.ts stt --so google` com e sem `--sem-vocabulario`, comparando a taxa de nomes de bots;
 * - se `inputTranscription` vem em pedaços (somamos) ou acumulado, e qual sinal fecha o trecho (`finished`?): a sonda
 *   classifica a forma e conta os `finished`;
 * - o limite real da sessão só de áudio no Vertex (10 min, pela documentação) e o formato do `goAway`:
 *   `sonda-google.ts --duracao 11m --sem-rotacao` grava o `goAway` e o código e a idade de cada fechamento; a rotação
 *   aos 9 min é provada por `--duracao 12m` (um `voz_stt_rotacao`, nenhum `voz_stt_rotacao_falhou`, nenhum final
 *   perdido).
 */

export const MODELO_STT_GOOGLE_PADRAO = "gemini-3.5-transcribe-live-preview";
export const REGIAO_GOOGLE_PADRAO = "global";
/** definido em 2026-10-04: troca de sessão aos 9 min (o Vertex fecha aos 10; sobra 1 min para o trecho em curso acabar). */
export const ROTACAO_MS = 9 * 60_000;
/** definido em 2026-10-04: sem sinal de fim de transcrição 2 s depois do `activityEnd`, fecha o final com o que houver. */
export const FINAL_SEM_SINAL_MS = 2_000;
const SETUP_TIMEOUT_MS = 15_000;
const VERIFICAR_ROTACAO_MS = 15_000;
/** definido em 2026-10-04: até 10 s de áudio guardado, somando os trechos, enquanto um final está pendente (o resto é descartado). */
const PENDENTE_MAX_AMOSTRAS = 10 * TAXA_MICROFONE_HZ;
const MIME_AUDIO = `audio/pcm;rate=${TAXA_MICROFONE_HZ}`;

/** Transporte mínimo: o WebSocket global em produção, um falso nos testes (o projeto não tem servidor WS). */
export type EventosConexaoWs = {
  aoAbrir(): void;
  aoMensagem(texto: string): void;
  aoFechar(codigo: number): void;
  aoErro(e: Error): void;
};
export type ConexaoWs = { enviar(texto: string): void; fechar(): void };
export type AbrirConexaoWs = (url: string, headers: Record<string, string>, eventos: EventosConexaoWs) => ConexaoWs;

export const abrirWebSocketGlobal: AbrirConexaoWs = (url, headers, ev) => {
  const ws = new WebSocket(url, { headers });
  ws.binaryType = "arraybuffer";
  const decodificador = new TextDecoder();
  ws.onopen = () => ev.aoAbrir();
  ws.onmessage = (m: MessageEvent) => {
    const d: unknown = m.data;
    if (typeof d === "string") ev.aoMensagem(d);
    else if (d instanceof ArrayBuffer) ev.aoMensagem(decodificador.decode(d));
  };
  ws.onclose = (c: CloseEvent) => ev.aoFechar(c.code);
  ws.onerror = () => ev.aoErro(new Error("websocket"));
  return {
    enviar(t) {
      if (ws.readyState === WebSocket.OPEN) ws.send(t);
    },
    fechar() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000);
    },
  };
};

export function urlLiveVertex(regiao: string): string {
  const host = regiao === "global" ? "aiplatform.googleapis.com" : `${regiao}-aiplatform.googleapis.com`;
  return `wss://${host}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;
}

/** O que importa de uma mensagem do servidor, já validado. */
export type MsgLive = { setupComplete: boolean; transcricao: string | null; parcial: string | null; transcricaoFechada: boolean; turnoCompleto: boolean; goAway: boolean };

function obj(x: unknown): Record<string, unknown> | null {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

export function lerMsgLive(texto: string): MsgLive | null {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return null;
  }
  const m = obj(bruto);
  if (!m) return null;
  const sc = obj(m.serverContent);
  const it = obj(sc?.inputTranscription);
  const interina = obj(sc?.interimInputTranscription);
  return {
    setupComplete: m.setupComplete !== undefined,
    transcricao: typeof it?.text === "string" ? it.text : null,
    parcial: typeof interina?.text === "string" ? interina.text : null,
    transcricaoFechada: it?.finished === true,
    turnoCompleto: sc?.turnComplete === true || sc?.generationComplete === true,
    goAway: m.goAway !== undefined,
  };
}

export function montarSetup(p: { projeto: string; regiao: string; modelo: string; vocabulario?: readonly string[] }): object {
  const termos = (p.vocabulario ?? []).map((t) => t.trim()).filter(Boolean);
  const instrucao = ["Transcreva fielmente a fala em português do Brasil. Não responda nem comente.", termos.length ? `Termos que podem aparecer: ${termos.join(", ")}.` : ""].filter(Boolean).join(" ");
  return {
    setup: {
      model: `projects/${p.projeto}/locations/${p.regiao}/publishers/google/models/${p.modelo}`,
      generationConfig: { responseModalities: ["TEXT"] },
      systemInstruction: { parts: [{ text: instrucao }] },
      inputAudioTranscription: {},
      realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
    },
  };
}

export type OpcoesTranscricaoGoogle = {
  token: () => Promise<string>;
  projeto: string | null;
  regiao?: string;
  modelo?: string;
  abrirConexao?: AbrirConexaoWs;
  rotacaoMs?: number;
  agora?: () => number;
};

type Ligacao = {
  conn: ConexaoWs;
  abertaEm: number;
  fechadaPorNos: boolean;
  aoMsg: (m: MsgLive) => void;
  aoFim: (codigo: number) => void;
};

export function criarTranscritorGoogle(o: OpcoesTranscricaoGoogle): Transcritor {
  const regiao = o.regiao || REGIAO_GOOGLE_PADRAO;
  const modelo = o.modelo || MODELO_STT_GOOGLE_PADRAO;
  const abrirConexao = o.abrirConexao ?? abrirWebSocketGlobal;
  const rotacaoMs = o.rotacaoMs ?? ROTACAO_MS;
  const agora = o.agora ?? Date.now;
  const url = urlLiveVertex(regiao);

  async function conectar(setup: object): Promise<Ligacao> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await o.token()}` };
    if (o.projeto) headers["x-goog-user-project"] = o.projeto;
    return new Promise<Ligacao>((resolver, rejeitar) => {
      let pronta = false;
      let abriuAntes = false;
      let lig: Ligacao | null = null;
      const falhar = (e: ErroDeDominio) => {
        if (pronta) return;
        pronta = true;
        clearTimeout(timer);
        rejeitar(e);
      };
      const timer = setTimeout(() => {
        if (lig) lig.fechadaPorNos = true;
        conn.fechar();
        falhar(new ErroDeDominio("conector_indisponivel", { cause: new Error("setup sem resposta") }));
      }, SETUP_TIMEOUT_MS);
      timer.unref?.();
      const conn = abrirConexao(url, headers, {
        aoAbrir() {
          if (lig) lig.conn.enviar(JSON.stringify(setup));
          else abriuAntes = true;
        },
        aoMensagem(texto) {
          const m = lerMsgLive(texto);
          if (!m || !lig) return;
          if (!pronta) {
            if (m.setupComplete) {
              pronta = true;
              clearTimeout(timer);
              resolver(lig);
            }
            return;
          }
          lig.aoMsg(m);
        },
        aoFechar(codigo) {
          if (!pronta) {
            const auth = codigo === 1008 || codigo === 4401 || codigo === 4403;
            falhar(new ErroDeDominio(auth ? "integracao_autenticacao" : "conector_indisponivel", { cause: new Error(`ws ${codigo}`) }));
          } else lig?.aoFim(codigo);
        },
        aoErro() {
          // o fechamento vem logo depois e decide
        },
      });
      lig = { conn, abertaEm: agora(), fechadaPorNos: false, aoMsg: () => {}, aoFim: () => {} };
      if (abriuAntes) conn.enviar(JSON.stringify(setup));
    });
  }

  return {
    id: "google",
    capacidades: { parciais: true, vocabulario: true, fimDeFalaManual: true },
    async abrir(opcoes: OpcoesSessaoStt): Promise<SessaoStt> {
      if (!o.projeto) {
        log("aviso", "voz_stt_sem_projeto", { provedor: "google", dica: "defina NOD_VOZ_PROJETO" });
        throw new ErroDeDominio("integracao_nao_configurada");
      }
      const setup = montarSetup({ projeto: o.projeto, regiao, modelo, vocabulario: opcoes.vocabulario });
      let atual = await conectar(setup);
      let proxima: Ligacao | null = null;
      let rotacionando = false;
      let fechada = false;
      let estado: "livre" | "falando" | "fechando" = "livre";
      let emitirFinal = true;
      let texto = "";
      let ultimaParcial = "";
      // Trechos que começaram enquanto um final estava pendente, na ordem; `fechado` = a fala deles já acabou.
      const guardados: { quadros: Int16Array[]; amostras: number; fechado: boolean }[] = [];
      let amostrasGuardadas = 0;
      let timerFinal: ReturnType<typeof setTimeout> | null = null;

      const enviarJson = (l: Ligacao, m: object) => l.conn.enviar(JSON.stringify(m));
      const enviarAudio = (pcm: Int16Array) => enviarJson(atual, { realtimeInput: { audio: { data: pcmParaBytes(pcm).toString("base64"), mimeType: MIME_AUDIO } } });
      const resultado = (t: string, final: boolean) => {
        if (!fechada) opcoes.aoResultado({ texto: t, final, confianca: null });
      };

      function falhar(e: ErroDeDominio) {
        if (fechada) return;
        void encerrar();
        opcoes.aoErro(e);
      }

      function trocar() {
        if (!proxima) return;
        const velha = atual;
        atual = proxima;
        proxima = null;
        velha.fechadaPorNos = true;
        velha.conn.fechar();
        log("info", "voz_stt_rotacao", { provedor: "google", idade_ms: agora() - velha.abertaEm });
      }

      function concluir() {
        if (estado !== "fechando") return;
        if (timerFinal) clearTimeout(timerFinal);
        timerFinal = null;
        if (emitirFinal) resultado(texto.trim() || ultimaParcial.trim(), true);
        estado = "livre";
        texto = "";
        ultimaParcial = "";
        emitirFinal = true;
        trocar(); // fronteira de trecho: se a nova sessão já está pronta, é aqui que ela assume
        const proximo = guardados.shift();
        if (proximo) {
          amostrasGuardadas -= proximo.amostras;
          enviarJson(atual, { realtimeInput: { activityStart: {} } });
          estado = "falando";
          for (const p of proximo.quadros) enviarAudio(p);
          // A fala dele já tinha acabado: fecha na hora; os que vieram depois esperam o final deste.
          if (proximo.fechado) fecharTrecho(true);
        }
      }

      function fecharTrecho(final: boolean) {
        enviarJson(atual, { realtimeInput: { activityEnd: {} } });
        estado = "fechando";
        emitirFinal = final;
        timerFinal = setTimeout(concluir, FINAL_SEM_SINAL_MS);
        timerFinal.unref?.();
      }

      function ligar(l: Ligacao) {
        l.aoMsg = (m) => {
          if (l !== atual) return; // a nova só fala depois da troca; a velha, depois da troca, não fala mais
          if (m.goAway) void rotacionar();
          if (m.transcricao !== null && estado !== "livre") {
            texto += m.transcricao;
            if (emitirFinal && texto.trim()) resultado(texto.trim(), false);
          }
          if (m.parcial !== null && estado !== "livre" && texto === "") {
            ultimaParcial = m.parcial;
            if (emitirFinal && ultimaParcial.trim()) resultado(ultimaParcial.trim(), false);
          }
          if (estado === "fechando" && (m.transcricaoFechada || m.turnoCompleto)) concluir();
        };
        l.aoFim = (codigo) => {
          if (l.fechadaPorNos || fechada) return;
          if (l === atual && proxima) {
            log("aviso", "voz_stt_caiu_com_reserva", { provedor: "google", codigo });
            const perdido = estado !== "livre";
            trocar();
            if (perdido) {
              // o trecho em curso morreu com a conexão: fecha vazio (o orquestrador pede para repetir)
              estado = "fechando";
              emitirFinal = true;
              texto = "";
              concluir();
            }
            return;
          }
          if (l === atual) {
            log("aviso", "voz_stt_caiu", { provedor: "google", codigo });
            falhar(new ErroDeDominio("conector_indisponivel", { cause: new Error(`ws ${codigo}`) }));
          } else if (l === proxima) {
            proxima = null;
          }
        };
      }
      ligar(atual);

      async function rotacionar() {
        if (rotacionando || proxima || fechada) return;
        rotacionando = true;
        try {
          const nova = await conectar(setup);
          if (fechada) {
            nova.fechadaPorNos = true;
            nova.conn.fechar();
            return;
          }
          ligar(nova);
          proxima = nova;
          if (estado === "livre") trocar();
        } catch (e) {
          log("aviso", "voz_stt_rotacao_falhou", { provedor: "google", codigo: e instanceof ErroDeDominio ? e.codigo : "desconhecido" });
        } finally {
          rotacionando = false;
        }
      }

      const vigia = setInterval(() => {
        if (agora() - atual.abertaEm >= rotacaoMs) void rotacionar();
      }, Math.min(VERIFICAR_ROTACAO_MS, Math.max(10, Math.floor(rotacaoMs / 4))));
      vigia.unref?.();

      async function encerrar() {
        if (fechada) return;
        fechada = true;
        clearInterval(vigia);
        if (timerFinal) clearTimeout(timerFinal);
        for (const l of [atual, proxima]) {
          if (!l) continue;
          l.fechadaPorNos = true;
          l.conn.fechar();
        }
        proxima = null;
      }

      return {
        enviar(pcm16: Int16Array) {
          if (fechada || pcm16.length === 0) return;
          if (estado === "fechando") {
            // O trecho ganha a entrada dele mesmo sem caber áudio: o `fimDeFala` dele tem de achar o que fechar, e o
            // final (vazio) dele mantém a conta de quem espera um final por trecho.
            let emCurso = guardados.at(-1);
            if (!emCurso || emCurso.fechado) {
              emCurso = { quadros: [], amostras: 0, fechado: false };
              guardados.push(emCurso);
            }
            if (amostrasGuardadas + pcm16.length > PENDENTE_MAX_AMOSTRAS) return;
            emCurso.quadros.push(pcm16.slice());
            emCurso.amostras += pcm16.length;
            amostrasGuardadas += pcm16.length;
            return;
          }
          if (estado === "livre") {
            enviarJson(atual, { realtimeInput: { activityStart: {} } });
            estado = "falando";
            texto = "";
            ultimaParcial = "";
          }
          enviarAudio(pcm16);
        },
        fimDeFala() {
          if (fechada) return;
          if (estado === "fechando") {
            const emCurso = guardados.at(-1);
            if (emCurso && !emCurso.fechado) emCurso.fechado = true;
            return;
          }
          if (estado !== "falando") return;
          fecharTrecho(true);
        },
        descartar() {
          if (fechada) return;
          const emCurso = guardados.at(-1);
          if (emCurso && !emCurso.fechado) {
            // O trecho em curso ainda está guardado: some sem ir ao provedor; os anteriores seguem.
            guardados.pop();
            amostrasGuardadas -= emCurso.amostras;
          } else if (guardados.length > 0) {
            // Nada em curso (o último guardado já fechou): não há o que descartar.
          } else if (estado === "falando") fecharTrecho(false);
          else if (estado === "fechando") emitirFinal = false;
        },
        guardando: () => estado === "fechando",
        fechar: encerrar,
      };
    },
  };
}
