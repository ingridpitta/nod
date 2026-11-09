import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ErroDeDominio } from "../../domain/erro.ts";
import { log } from "../../obs/log.ts";
import { bytesParaPcm, concatenar, pcmParaBytes } from "./audio.ts";
import type { Sintetizador } from "./spi.ts";

/**
 * Cache dos clipes das falas de espera (definido em 2026-10-04, ADR-071, plano "Falas de espera"). Chave por
 * (provedor, voz, velocidade, id, versão do texto): mudar o texto sem subir a `versao` reaproveita o clipe antigo.
 * Memória sempre; disco opcional (`diretorio`, ex.: /data/nod/vozes), com um `.pcm` cru (PCM16LE mono 24 kHz) por clipe,
 * que pode ser apagado a qualquer hora e é refeito sob demanda. Só guarda a voz do BOT (texto fixo), nunca a da pessoa.
 *
 * Nunca há TTS no caminho crítico: o orquestrador usa `obterPronto` (síncrono, só memória) e, se não houver clipe,
 * não toca nada. `aquecer` gera em segundo plano, um clipe por vez, e engole erro (fica no log, sem o texto).
 */
export type FalaDeEspera = { id: string; versao: number; texto: string };

export type CacheDeFalas = {
  /** Clipe da memória, do disco ou gerado agora. null se o TTS falhar (o erro vai para o log). */
  obter(fala: FalaDeEspera, voz: string, velocidade: number): Promise<Int16Array | null>;
  /** Só memória, na hora: null quando o clipe ainda não está pronto. */
  obterPronto(fala: FalaDeEspera, voz: string, velocidade: number): Int16Array | null;
  /** Gera em segundo plano o que faltar. Nunca rejeita; a promessa devolvida só serve para testes e para o boot esperar. */
  aquecer(falas: readonly FalaDeEspera[], voz: string, velocidade: number): Promise<void>;
  readonly tamanho: number;
};

export type OpcoesCacheDeFalas = { tts: Sintetizador; provedor: string; diretorio?: string };

/** Segmento seguro para nome de arquivo: o id e a voz vêm do catálogo, mas a chave nunca sai da pasta. */
function seg(s: string): string {
  const limpo = s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  if (!limpo) throw new ErroDeDominio("entrada_invalida");
  return limpo;
}

export function chaveDaFala(provedor: string, voz: string, velocidade: number, fala: Pick<FalaDeEspera, "id" | "versao">): string {
  const vel = String(Math.round(velocidade * 100));
  return `${seg(provedor)}/${seg(voz)}/${vel}/${seg(fala.id)}-v${Math.trunc(fala.versao)}`;
}

export function criarCacheDeFalas(p: OpcoesCacheDeFalas): CacheDeFalas {
  const memoria = new Map<string, Int16Array>();
  const emVoo = new Map<string, Promise<Int16Array | null>>();

  async function doDisco(chave: string): Promise<Int16Array | null> {
    if (!p.diretorio) return null;
    try {
      const pcm = bytesParaPcm(await readFile(join(p.diretorio, `${chave}.pcm`)));
      return pcm.length > 0 ? pcm : null;
    } catch {
      return null;
    }
  }

  async function paraDisco(chave: string, pcm: Int16Array): Promise<void> {
    if (!p.diretorio) return;
    const arquivo = join(p.diretorio, `${chave}.pcm`);
    const tmp = `${arquivo}.${process.pid}.tmp`;
    try {
      await mkdir(join(arquivo, ".."), { recursive: true });
      await writeFile(tmp, pcmParaBytes(pcm));
      await rename(tmp, arquivo); // quem lê nunca vê um clipe pela metade
    } catch (e) {
      log("aviso", "voz_espera_disco_falhou", { chave, erro: e instanceof Error ? e.name : "desconhecido" });
    }
  }

  async function gerar(chave: string, fala: FalaDeEspera, voz: string, velocidade: number): Promise<Int16Array | null> {
    const doArquivo = await doDisco(chave);
    if (doArquivo) return doArquivo;
    const pedacos: Int16Array[] = [];
    try {
      for await (const pedaco of p.tts.sintetizar({ texto: fala.texto, voz, velocidade, prioridade: "espera" })) pedacos.push(pedaco.slice());
    } catch (e) {
      log("aviso", "voz_espera_tts_falhou", { chave, codigo: e instanceof ErroDeDominio ? e.codigo : "desconhecido" });
      return null;
    }
    const pcm = concatenar(pedacos);
    if (pcm.length === 0) return null;
    await paraDisco(chave, pcm);
    return pcm;
  }

  async function obter(fala: FalaDeEspera, voz: string, velocidade: number): Promise<Int16Array | null> {
    const chave = chaveDaFala(p.provedor, voz, velocidade, fala);
    const pronto = memoria.get(chave);
    if (pronto) return pronto;
    let promessa = emVoo.get(chave);
    if (!promessa) {
      promessa = gerar(chave, fala, voz, velocidade).then((pcm) => {
        emVoo.delete(chave);
        if (pcm) memoria.set(chave, pcm);
        return pcm;
      });
      emVoo.set(chave, promessa);
    }
    return promessa;
  }

  return {
    obter,
    obterPronto(fala, voz, velocidade) {
      return memoria.get(chaveDaFala(p.provedor, voz, velocidade, fala)) ?? null;
    },
    async aquecer(falas, voz, velocidade) {
      // um por vez: não disputa a cota do TTS (200 pedidos/min no Chirp) com as falas de conteúdo
      for (const f of falas) {
        try {
          await obter(f, voz, velocidade);
        } catch (e) {
          log("aviso", "voz_espera_aquecer_falhou", { id: f.id, codigo: e instanceof ErroDeDominio ? e.codigo : "desconhecido" });
        }
      }
    },
    get tamanho() {
      return memoria.size;
    },
  };
}
