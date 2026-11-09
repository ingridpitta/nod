import { ErroDeDominio } from "../../domain/erro.ts";
import { log } from "../../obs/log.ts";
import type { ProvedorVoz } from "./catalogo-vozes.ts";
import { criarTranscritorGoogle } from "./google-transcricao.ts";
import { criarTranscritorDeArquivoGoogle } from "./google-transcricao-arquivo.ts";
import { criarTransporteHttp2 } from "./google-voz-streaming.ts";
import { criarSintetizadorGoogle } from "./google-voz.ts";
import { criarLimitadorTts, criarSintetizadorLimitado, TETO_TTS_PADRAO_MIN } from "./limitador-tts.ts";
import { criarSintetizadorSay } from "./local-say.ts";
import { criarTranscritorWhisperLocal } from "./local-whisper.ts";
import type { ProvedoresVoz, Sintetizador, Transcritor, TranscritorDeArquivo } from "./spi.ts";
import { criarFonteDeToken, type FonteTokenGoogle } from "./token-google.ts";
import { criarSintetizadorFalso, criarTranscritorDeArquivoFalso, criarTranscritorFalso } from "./voz-falsa.ts";

/**
 * Escolhe os provedores de voz pelo ambiente (definido em 2026-10-04, ADR-071): `NOD_VOZ_STT` e `NOD_VOZ_TTS` aceitam
 * "google" | "local" | "falso". Sem eles: produção → google; fora de produção no macOS → local (grátis); senão → falso.
 */
export type { ProvedorVoz };

const PROVEDORES: readonly ProvedorVoz[] = ["google", "local", "falso"];

export function provedorPadrao(env: Record<string, string | undefined>, plataforma: string = process.platform): ProvedorVoz {
  if (env.NODE_ENV === "production") return "google";
  return plataforma === "darwin" ? "local" : "falso";
}

function lerProvedor(valor: string | undefined, padrao: ProvedorVoz, nome: string): ProvedorVoz {
  const v = valor?.trim();
  if (!v) return padrao;
  const achado = PROVEDORES.find((p) => p === v);
  if (!achado) {
    log("erro", "voz_provedor_invalido", { variavel: nome, valor: v });
    throw new ErroDeDominio("entrada_invalida");
  }
  return achado;
}

/**
 * `NOD_VOZ_TTS_TETO_MIN` (definido em 2026-10-05, NOD-166): pedidos ao TTS do Google por minuto, por processo. Padrão
 * 180 (a cota do Chirp 3 HD é 200); `0` desliga o limitador.
 */
export function lerTetoTts(valor: string | undefined): number {
  const v = valor?.trim();
  if (!v) return TETO_TTS_PADRAO_MIN;
  if (!/^\d+$/.test(v)) {
    log("erro", "voz_tts_teto_invalido", { variavel: "NOD_VOZ_TTS_TETO_MIN", valor: v, mensagem: "NOD_VOZ_TTS_TETO_MIN precisa ser um número inteiro de pedidos por minuto (0 desliga o limitador)" });
    throw new ErroDeDominio("entrada_invalida");
  }
  return Number(v);
}

/**
 * STT de arquivo (definido em 2026-10-22, NOD-329): `NOD_VOZ_STT_ARQUIVO` = "google" | "falso" | "desligado". Padrão:
 * google em produção, falso fora dela. Não há `local`: o whisper local não dá tempo por palavra.
 */
export type ProvedorSttArquivo = "google" | "falso" | "desligado";
const PROVEDORES_STT_ARQUIVO: readonly ProvedorSttArquivo[] = ["google", "falso", "desligado"];

export function lerProvedorSttArquivo(env: Record<string, string | undefined>): ProvedorSttArquivo {
  const v = env.NOD_VOZ_STT_ARQUIVO?.trim();
  if (!v) return env.NODE_ENV === "production" ? "google" : "falso";
  const achado = PROVEDORES_STT_ARQUIVO.find((p) => p === v);
  if (!achado) {
    log("erro", "voz_provedor_invalido", { variavel: "NOD_VOZ_STT_ARQUIVO", valor: v });
    throw new ErroDeDominio("entrada_invalida");
  }
  return achado;
}

export function criarProvedoresVoz(env: Record<string, string | undefined>, plataforma: string = process.platform): ProvedoresVoz {
  const padrao = provedorPadrao(env, plataforma);
  const qualStt = lerProvedor(env.NOD_VOZ_STT, padrao, "NOD_VOZ_STT");
  const qualTts = lerProvedor(env.NOD_VOZ_TTS, padrao, "NOD_VOZ_TTS");
  if (qualTts === "local" && plataforma !== "darwin") {
    log("erro", "voz_tts_local_fora_do_mac", { plataforma });
    throw new ErroDeDominio("integracao_nao_configurada");
  }

  const qualArquivo = lerProvedorSttArquivo(env);
  const tetoTts = lerTetoTts(env.NOD_VOZ_TTS_TETO_MIN);

  let fonte: FonteTokenGoogle | null = null;
  const token = () => (fonte ??= criarFonteDeToken({ env }));
  const encerrar: Array<() => Promise<void>> = [];

  let stt: Transcritor;
  if (qualStt === "google") {
    const f = token();
    stt = criarTranscritorGoogle({ token: () => f.token(), projeto: f.projeto, regiao: env.NOD_VOZ_REGIAO, modelo: env.NOD_VOZ_STT_MODELO });
  } else if (qualStt === "local") {
    const local = criarTranscritorWhisperLocal({ env });
    encerrar.push(local.encerrar);
    stt = local;
  } else {
    // NOD_VOZ_FALSO_ROTEIRO: as falas que o STT falso devolve, na ordem, separadas por "|" (e2e e dev sem microfone).
    stt = criarTranscritorFalso(env.NOD_VOZ_FALSO_ROTEIRO ? env.NOD_VOZ_FALSO_ROTEIRO.split("|").map((s) => s.trim()) : undefined);
  }

  let tts: Sintetizador;
  if (qualTts === "google") {
    const f = token();
    // A cota é do projeto no Google: só o TTS google passa pelo limitador (definido em 2026-10-05, NOD-166).
    const limitador = tetoTts > 0 ? criarLimitadorTts({ tetoPorMinuto: tetoTts }) : null;
    const base = { token: () => f.token(), projeto: f.projeto, vagaExtra: limitador?.vaga };
    // definido em 2026-10-04: a voz do Google sai em streaming (o REST fica de rede de segurança); NOD_VOZ_TTS_STREAMING=0
    // volta ao REST puro.
    if (env.NOD_VOZ_TTS_STREAMING === "0") tts = criarSintetizadorGoogle(base);
    else {
      const transporte = criarTransporteHttp2();
      encerrar.push(async () => transporte.fechar());
      tts = criarSintetizadorGoogle({ ...base, streaming: { transporte } });
    }
    if (limitador) tts = criarSintetizadorLimitado(tts, limitador);
  } else if (qualTts === "local") {
    tts = criarSintetizadorSay();
  } else {
    tts = criarSintetizadorFalso();
  }

  let arquivo: TranscritorDeArquivo | null = null;
  if (qualArquivo === "google") {
    const f = token();
    arquivo = criarTranscritorDeArquivoGoogle({ token: () => f.token(), projeto: f.projeto, regiao: env.NOD_VOZ_STT_ARQUIVO_REGIAO, modelo: env.NOD_VOZ_STT_ARQUIVO_MODELO });
  } else if (qualArquivo === "falso") {
    arquivo = criarTranscritorDeArquivoFalso(env.NOD_VOZ_FALSO_ROTEIRO_ARQUIVO ?? "");
  }

  log("info", "voz_provedores", { stt: qualStt, stt_arquivo: qualArquivo, tts: qualTts, tts_streaming: tts.capacidades.streaming, tts_teto_min: qualTts === "google" ? tetoTts : null });
  return {
    stt,
    tts,
    arquivo,
    async encerrar() {
      await Promise.allSettled(encerrar.map((f) => f()));
    },
  };
}
