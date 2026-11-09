/**
 * Sonda paga do STT de arquivo (definido em 2026-10-22, NOD-329): manda cada arquivo ao Speech-to-Text v2 `recognize`
 * (chirp_2, us-central1, tempo por palavra) e imprime o que importa para o memo de voz: duração lida do cabeçalho,
 * quantas palavras voltaram, o tempo da primeira e da última, a duração cobrada e a latência. NUNCA imprime o texto.
 * Serve para confirmar quais formatos o chirp_2 decodifica (wav, mp3, m4a, ogg opus, ogg vorbis) antes do PR 3 e,
 * em produção, que a conta da VM tem `roles/speech.client`. Custa centavos do GCP.
 *
 * Uso: NOD_VOZ_PROJETO=nod-exemplos NOD_VOZ_GCLOUD_BIN=$(which gcloud) node scripts/voz/sonda-stt-arquivo.ts a.wav b.m4a c.ogg
 * Na VM (conta de serviço pelo metadata): NODE_ENV=production NOD_VOZ_PROJETO=… node scripts/voz/sonda-stt-arquivo.ts a.wav
 * Opcionais: NOD_VOZ_STT_ARQUIVO_MODELO, NOD_VOZ_STT_ARQUIVO_REGIAO.
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { criarTranscritorDeArquivoGoogle } from "../../src/adapters/voz/google-transcricao-arquivo.ts";
import { RecusaDoArquivo } from "../../src/adapters/voz/spi.ts";
import { criarFonteDeToken } from "../../src/adapters/voz/token-google.ts";
import { duracaoMs } from "../../src/domain/duracao-audio.ts";
import { encerrarComFalha, mensagemDeFalha, UsoInvalido } from "./falha-de-script.ts";

const MIMES: Record<string, string> = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".aac": "audio/mp4", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg" };
const dizer = (t: string) => process.stdout.write(`${t}\n`);
const seg = (ms: number | null) => (ms === null ? "?" : `${(ms / 1000).toFixed(2)} s`);

try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: as variáveis vêm do ambiente
}

try {
  const arquivos = process.argv.slice(2);
  if (arquivos.length === 0) throw new UsoInvalido("passe um ou mais arquivos de áudio (wav, mp3, m4a, ogg)");
  const fonte = criarFonteDeToken({ env: process.env });
  const stt = criarTranscritorDeArquivoGoogle({ token: () => fonte.token(), projeto: fonte.projeto, modelo: process.env.NOD_VOZ_STT_ARQUIVO_MODELO, regiao: process.env.NOD_VOZ_STT_ARQUIVO_REGIAO });
  dizer(`modelo ${stt.modelo} · projeto ${fonte.projeto ?? "(não configurado)"} · token por ${fonte.origem}`);
  for (const caminho of arquivos) {
    const mime = MIMES[extname(caminho).toLowerCase()];
    if (!mime) throw new UsoInvalido(`extensão não reconhecida: ${caminho} (use ${Object.keys(MIMES).join(", ")})`);
    const bytes = new Uint8Array(readFileSync(caminho));
    const cabecalho = duracaoMs(bytes, mime);
    const t0 = performance.now();
    let linha: string;
    try {
      const r = await stt.transcrever({ bytes, mime, idioma: "pt-BR" });
      const primeira = r.palavras[0];
      const ultima = r.palavras.at(-1);
      linha = r.palavras.length === 0 ? "sem_fala (0 palavras)" : `pronta · ${r.palavras.length} palavras · 1ª em ${seg(primeira?.inicioMs ?? null)} · última termina em ${seg(ultima?.fimMs ?? null)} · cobrado ${seg(r.cobradoMs)}`;
    } catch (e) {
      linha = e instanceof RecusaDoArquivo ? `recusado: ${e.motivo}` : `falhou: ${mensagemDeFalha(e).split("\n")[0]}`;
    }
    dizer(`${caminho} (${mime}, ${(bytes.length / 1024).toFixed(0)} KB, cabeçalho ${seg(cabecalho)}): ${linha} · ${Math.round(performance.now() - t0)} ms`);
  }
} catch (e) {
  encerrarComFalha(e);
}
