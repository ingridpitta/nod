import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TAXA_VOZ_HZ } from "../../contracts/voz.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { log } from "../../obs/log.ts";
import { fatiar, lerWav, misturarParaMono, reamostrar } from "./audio.ts";
import { vozDoProvedor } from "./catalogo-vozes.ts";
import type { PedidoTts, Sintetizador } from "./spi.ts";

/**
 * TTS `local` para dev (definido em 2026-10-04, ADR-071): o `say` do macOS, grátis e sem internet. Robótico, mas dá para
 * entender. Gera a frase inteira num WAV temporário (apagado na hora, junto com o arquivo do texto) e devolve em pedaços.
 * O texto vai por arquivo (`-f`), nunca por argumento nem por shell: um texto que começa com "-" não vira opção.
 *
 * medido em 2026-10-04 (M1, macOS 26.0, 3 rodadas por frase, script com este adaptador): 0,74–0,84 s até o primeiro
 * pedaço com Luciana e 0,63–0,69 s com Eddy, quase igual para 8 e para 50 caracteres — é o custo de subir o `say`, não
 * o tamanho da frase. Por isso as falas de espera vêm do cache, nunca do `say` ao vivo.
 */

/** definido em 2026-10-04: palavras por minuto do `say` para 1x/1,25x/1,5x (185/230/275), linear entre os pontos. */
export function palavrasPorMinuto(velocidade: number): number {
  const v = Number.isFinite(velocidade) && velocidade > 0 ? velocidade : 1;
  return Math.round(185 + (v - 1) * 180);
}

const AMOSTRAS_POR_PEDACO = (100 * TAXA_VOZ_HZ) / 1000;
/** definido em 2026-10-04: teto de uma frase no `say` (uma frase de ~25 palavras leva ~1 s; 30 s é processo travado). */
const TIMEOUT_SAY_MS = 30_000;

export type OpcoesSay = {
  /** Onde nasce o diretório temporário de cada frase (testes isolam o seu); padrão: o tmpdir do sistema. */
  dirBase?: string; bin?: string };

function rodarSay(bin: string, args: string[], sinal: AbortSignal | undefined): Promise<"ok" | "abortado"> {
  return new Promise((resolver, rejeitar) => {
    const sinais = [AbortSignal.timeout(TIMEOUT_SAY_MS)];
    if (sinal) sinais.push(sinal);
    const filho = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"], signal: AbortSignal.any(sinais), shell: false });
    let stderr = "";
    filho.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < 2000) stderr += d.toString("utf8");
    });
    filho.on("error", (e) => {
      if (sinal?.aborted) resolver("abortado");
      else rejeitar(e);
    });
    filho.on("close", (codigo) => {
      if (sinal?.aborted) resolver("abortado");
      else if (codigo === 0) resolver("ok");
      else rejeitar(new Error(`say saiu com ${codigo}: ${stderr.slice(0, 200)}`));
    });
  });
}

export function criarSintetizadorSay(o: OpcoesSay = {}): Sintetizador {
  const bin = o.bin ?? "say";
  return {
    id: "local",
    capacidades: { streaming: false, velocidade: true },
    async *sintetizar(p: PedidoTts) {
      if (p.sinal?.aborted) return;
      const dir = await mkdtemp(join(o.dirBase ?? tmpdir(), "nod-say-"));
      let pcm: Int16Array;
      try {
        const entrada = join(dir, "texto.txt");
        const saida = join(dir, "fala.wav");
        await writeFile(entrada, p.texto, { encoding: "utf8", mode: 0o600 });
        const args = ["-v", vozDoProvedor("local", p.voz), "-r", String(palavrasPorMinuto(p.velocidade)), "--file-format=WAVE", `--data-format=LEI16@${TAXA_VOZ_HZ}`, "-o", saida, "-f", entrada];
        let r: "ok" | "abortado";
        try {
          r = await rodarSay(bin, args, p.sinal);
        } catch (e) {
          const semBinario = typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT";
          log("aviso", "voz_tts_falhou", { provedor: "local", sem_binario: semBinario });
          throw new ErroDeDominio(semBinario ? "integracao_nao_configurada" : "conector_indisponivel", { cause: e });
        }
        if (r === "abortado") return;
        const wav = lerWav(await readFile(saida));
        const mono = misturarParaMono(wav.pcm, wav.canais);
        pcm = wav.taxa === TAXA_VOZ_HZ ? mono : reamostrar(mono, wav.taxa, TAXA_VOZ_HZ);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      for (const pedaco of fatiar(pcm, AMOSTRAS_POR_PEDACO)) {
        if (p.sinal?.aborted) return;
        yield pedaco;
      }
    },
  };
}
