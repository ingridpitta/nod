/**
 * Sonda paga do TTS em streaming (definido em 2026-10-04, emenda da ADR-071): sintetiza as mesmas frases pelo REST e
 * pelo streaming do Chirp 3 HD e compara o tempo até o primeiro áudio, o ritmo de entrega (a síntese anda mais rápido
 * que a fala?) e o maior intervalo entre pedaços. Depois mede só o streaming: em sequência (as duas faixas do endpoint
 * global), com pedidos simultâneos na mesma sessão, e nos endpoints `us-` e `eu-`. Salva o WAV do streaming para ouvir.
 * Custa centavos do GCP.
 * Uso: NOD_VOZ_PROJETO=nod-exemplos NOD_VOZ_GCLOUD_BIN=$(which gcloud) node scripts/voz/sonda-tts-streaming.ts [voz] [velocidade]
 */
import { writeFileSync } from "node:fs";
import { concatenar, montarWav } from "../../src/adapters/voz/audio.ts";
import { vozDoProvedor } from "../../src/adapters/voz/catalogo-vozes.ts";
import { criarTransporteHttp2, sintetizarEmStreaming } from "../../src/adapters/voz/google-voz-streaming.ts";
import { criarSintetizadorGoogle } from "../../src/adapters/voz/google-voz.ts";
import { criarFonteDeToken } from "../../src/adapters/voz/token-google.ts";

const dizer = (t: string) => process.stdout.write(`${t}\n`);
const voz = process.argv[2] ?? "clara";
const velocidade = Number(process.argv[3] ?? "1");
const frases = [
  "Prazer, Marlon!",
  "E como você conheceu o nod?",
  "Que legal, indicação de amigo é a melhor!",
  "Chegou por indicação de um amigo, quer responder clientes mais rápido e trabalha num time de cinco pessoas.",
];
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: as variáveis vêm do ambiente
}
const fonte = criarFonteDeToken({ env: process.env });
const token = await fonte.token();
const transporte = criarTransporteHttp2();
const rest = criarSintetizadorGoogle({ token: async () => token, projeto: fonte.projeto });

type Medida = { primeiroMs: number; totalMs: number; audioMs: number; maiorBuracoMs: number; pedacos: number };

async function medir(it: AsyncIterable<Int16Array>, guardar?: Int16Array[]): Promise<Medida> {
  const t0 = performance.now();
  let primeiroMs = 0;
  let anterior = 0;
  let maiorBuracoMs = 0;
  let amostras = 0;
  let pedacos = 0;
  for await (const p of it) {
    const agora = performance.now();
    if (pedacos === 0) primeiroMs = agora - t0;
    else maiorBuracoMs = Math.max(maiorBuracoMs, agora - anterior);
    anterior = agora;
    amostras += p.length;
    pedacos++;
    guardar?.push(p);
  }
  return { primeiroMs, totalMs: performance.now() - t0, audioMs: (amostras / 24_000) * 1000, maiorBuracoMs, pedacos };
}
const linha = (rotulo: string, m: Medida) =>
  `  ${rotulo.padEnd(10)} primeiro áudio ${m.primeiroMs.toFixed(0).padStart(5)} ms · tudo em ${m.totalMs.toFixed(0).padStart(5)} ms para ${(m.audioMs / 1000).toFixed(1)} s de fala · maior intervalo ${m.maiorBuracoMs.toFixed(0)} ms · ${m.pedacos} pedaços`;

dizer(`voz ${voz} (${vozDoProvedor("google", voz)}), velocidade ${velocidade}`);
const primeirosRest: number[] = [];
const primeirosStreaming: number[] = [];
const audio: Int16Array[] = [];
// Aquece as duas conexões (TLS) fora da medida.
await medir(rest.sintetizar({ texto: "Oi.", voz, velocidade }));
await medir(sintetizarEmStreaming(transporte, { texto: "Oi.", voz: vozDoProvedor("google", voz), velocidade, token, projeto: fonte.projeto, prazoPrimeiroAudioMs: 10_000, folgaInicialMs: 0, amostrasPorPedaco: 2400 }));
for (const frase of frases) {
  dizer(`\n"${frase}"`);
  for (let rodada = 0; rodada < 2; rodada++) {
    const r = await medir(rest.sintetizar({ texto: frase, voz, velocidade }));
    primeirosRest.push(r.primeiroMs);
    dizer(linha("REST", r));
    const s = await medir(
      sintetizarEmStreaming(transporte, { texto: frase, voz: vozDoProvedor("google", voz), velocidade, token, projeto: fonte.projeto, prazoPrimeiroAudioMs: 10_000, folgaInicialMs: 0, amostrasPorPedaco: 2400 }),
      rodada === 0 ? audio : undefined,
    );
    primeirosStreaming.push(s.primeiroMs);
    dizer(linha("streaming", s));
  }
}
const mediana = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
dizer(`\nmediana do primeiro áudio: REST ${mediana(primeirosRest).toFixed(0)} ms · streaming ${mediana(primeirosStreaming).toFixed(0)} ms`);
// Só o streaming: a distribuição do primeiro áudio. `origem` troca o endpoint (sessão própria).
async function primeiroAudio(t: ReturnType<typeof criarTransporteHttp2>, texto: string): Promise<number> {
  const t0 = performance.now();
  try {
    for await (const _ of sintetizarEmStreaming(t, { texto, voz: vozDoProvedor("google", voz), velocidade, token, projeto: fonte.projeto, prazoPrimeiroAudioMs: 8_000, folgaInicialMs: 0, amostrasPorPedaco: 2400 })) return performance.now() - t0;
  } catch {
    // falha conta como o pior caso
  }
  return 9999;
}
const resumo = (v: number[]) => `mediana ${mediana(v).toFixed(0)} ms · maior ${Math.max(...v).toFixed(0)} ms · abaixo de 700 ms: ${v.filter((x) => x < 700).length}/${v.length} · acima de 2 s: ${v.filter((x) => x > 2000).length}/${v.length}`;
const emSequencia: number[] = [];
for (let i = 0; i < 16; i++) emSequencia.push(await primeiroAudio(transporte, frases[i % frases.length]!));
dizer(`\nsó streaming, 16 em sequência: ${emSequencia.map((x) => x.toFixed(0)).join(", ")}`);
dizer(`  ${resumo(emSequencia)}`);
for (const n of [3, 6]) {
  const juntos: number[] = [];
  for (let r = 0; r < 4; r++) juntos.push(...(await Promise.all(Array.from({ length: n }, (_, i) => primeiroAudio(transporte, frases[(r + i) % frases.length]!)))));
  dizer(`${n} simultâneos na mesma sessão × 4: ${resumo(juntos)}`);
}
for (const regiao of ["us", "eu"]) {
  const t = criarTransporteHttp2(`https://${regiao}-texttospeech.googleapis.com`);
  await primeiroAudio(t, "Oi.");
  const v: number[] = [];
  for (let i = 0; i < 8; i++) v.push(await primeiroAudio(t, frases[i % frases.length]!));
  dizer(`endpoint ${regiao}-, 8 em sequência: ${resumo(v)}`);
  t.fechar();
}
const arquivo = `${process.env.TMPDIR ?? "/tmp"}/sonda-tts-streaming-${voz}.wav`;
writeFileSync(arquivo, montarWav(concatenar(audio), 24_000));
dizer(`áudio do streaming em ${arquivo}`);
transporte.fechar();
process.exit(0);
