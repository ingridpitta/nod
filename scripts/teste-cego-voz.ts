/**
 * Teste cego de voz em pt-BR (definido em 2026-10-05, NOD-166). Três modos:
 *
 * STT — o mesmo corpus pelo Google (Transcribe Live) e pelo whisper `base`, cada fala mandada em tempo real (quadros de
 * 20 ms, como o microfone) e fechada pelo `fimDeFala`, como o VAD do nod faz. Mede nomes de bots, comandos de aprovação
 * (pelo classificador do orquestrador) e recusa transcrita como aprovação. O corpus fica FORA do repositório (vozes com
 * consentimento): uma pasta com WAVs e um `esperado.json` (formato em scripts/voz/medidas-teste-cego.ts, ItemCorpus).
 *   NOD_VOZ_PROJETO=<projeto> NOD_VOZ_GCLOUD_BIN=$(which gcloud) node scripts/teste-cego-voz.ts stt --corpus ~/corpus-voz [--so google|whisper] [--saida DIR]
 * `--sem-vocabulario` manda as sessões sem a lista de nomes: rodado com e sem, diz se o vocabulário pela
 * `systemInstruction` muda a taxa de nomes do Google (item "A CONFIRMAR" de src/adapters/voz/google-transcricao.ts).
 *
 * TTS — as 25 frases × as 8 vozes do catálogo pelo Chirp 3 HD, em WAVs com nome embaralhado (A001…A200), mais o
 * gabarito (fica com quem aplica) e a planilha de notas (vai aos ouvintes, nota de 1 a 5). Passa pelo limitador da cota.
 *   NOD_VOZ_PROJETO=<projeto> NOD_VOZ_GCLOUD_BIN=$(which gcloud) node scripts/teste-cego-voz.ts tts --saida ~/teste-cego-tts [--semente 166]
 *
 * Apurar — junta as notas e o gabarito: MOS por voz e quais caem abaixo de 3,5.
 *   node scripts/teste-cego-voz.ts apurar --gabarito ~/teste-cego-tts/gabarito.json --notas notas-preenchidas.csv
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TAXA_MICROFONE_HZ, TAXA_VOZ_HZ } from "../src/contracts/voz.ts";
import { VOZES_NOD } from "../src/contracts/vozes.ts";
import { concatenar, lerWav, misturarParaMono, montarWav, reamostrar, silencio } from "../src/adapters/voz/audio.ts";
import { criarTranscritorGoogle } from "../src/adapters/voz/google-transcricao.ts";
import { criarSintetizadorGoogle } from "../src/adapters/voz/google-voz.ts";
import { criarLimitadorTts, criarSintetizadorLimitado, TETO_TTS_PADRAO_MIN } from "../src/adapters/voz/limitador-tts.ts";
import { criarTranscritorWhisperLocal, MODELO_WHISPER_PADRAO } from "../src/adapters/voz/local-whisper.ts";
import type { Transcritor } from "../src/adapters/voz/spi.ts";
import { criarFonteDeToken } from "../src/adapters/voz/token-google.ts";
import { redigirECortar } from "../src/domain/segredos.ts";
import { encerrarComFalha, UsoInvalido } from "./voz/falha-de-script.ts";
import {
  apurarMos,
  aprovado,
  avaliarStt,
  CORTE_MOS,
  embaralhar,
  FRASES_TESTE_TTS,
  lerCorpus,
  lerNotas,
  META_COMANDOS,
  META_NOMES,
  taxa,
  type EntradaGabarito,
  type ResultadoStt,
} from "./voz/medidas-teste-cego.ts";

const dizer = (t: string) => process.stdout.write(`${t}\n`);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
function arg(nome: string, padrao?: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : padrao;
}
const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
const QUADRO = (20 * TAXA_MICROFONE_HZ) / 1000;

/** Uma fala do corpus por uma sessão nova do transcritor; devolve o texto final (vazio se não veio em 20 s). */
async function transcrever(t: Transcritor, pcm: Int16Array, vocabulario: readonly string[]): Promise<string> {
  let final = "";
  let fechar: () => void = () => {};
  const veio = new Promise<void>((ok) => (fechar = ok));
  const s = await t.abrir({
    idioma: "pt-BR",
    vocabulario,
    aoResultado(r) {
      if (!r.final) return;
      final = r.texto;
      fechar();
    },
    aoErro(e) {
      dizer(`  erro do ${t.id}: ${redigirECortar(e.message, 500)}`);
      fechar();
    },
  });
  const audio = concatenar([pcm, silencio(300, TAXA_MICROFONE_HZ)]);
  for (let i = 0; i < audio.length; i += QUADRO) {
    s.enviar(audio.subarray(i, i + QUADRO));
    await dormir(20);
  }
  s.fimDeFala();
  await Promise.race([veio, dormir(20_000)]);
  await s.fechar();
  return final;
}

function lerFala(arquivo: string): Int16Array {
  const wav = lerWav(readFileSync(arquivo));
  const mono = misturarParaMono(wav.pcm, wav.canais);
  return wav.taxa === TAXA_MICROFONE_HZ ? mono : reamostrar(mono, wav.taxa, TAXA_MICROFONE_HZ);
}

function linhaStt(id: string, r: ResultadoStt): string {
  return `| ${id} | ${pct(taxa(r.nomes))} (${r.nomes.acertos}/${r.nomes.total}) | ${pct(taxa(r.comandos))} (${r.comandos.acertos}/${r.comandos.total}) | ${r.aprovacoesFalsas.length} | ${aprovado(r) ? "passa" : "reprova"} |`;
}

async function modoStt(): Promise<void> {
  const so = arg("so");
  // um --so com erro de digitação não rodava nenhum provedor e gravava um resultado vazio
  if (so !== undefined && so !== "google" && so !== "whisper") throw new UsoInvalido(`--so precisa ser google ou whisper (veio "${so}")`);
  const corpus = arg("corpus", process.env.NOD_CORPUS_VOZ);
  if (!corpus) throw new UsoInvalido("falta --corpus (ou NOD_CORPUS_VOZ): a pasta com os WAVs e o esperado.json, fora do repositório");
  const saida = arg("saida", join(tmpdir(), "teste-cego-stt"))!;
  mkdirSync(saida, { recursive: true });
  const itens = lerCorpus(JSON.parse(readFileSync(join(corpus, "esperado.json"), "utf8")));
  const semVocabulario = process.argv.includes("--sem-vocabulario");
  const vocabulario = semVocabulario ? [] : [...new Set(["nod", ...VOZES_NOD.map((v) => v.nome), ...itens.flatMap((i) => i.nomes ?? [])])];

  const provedores: { id: string; t: Transcritor; encerrar?: () => Promise<void> }[] = [];
  if (!so || so === "google") {
    const fonte = criarFonteDeToken({ env: process.env });
    provedores.push({ id: "google", t: criarTranscritorGoogle({ token: () => fonte.token(), projeto: fonte.projeto, regiao: process.env.NOD_VOZ_REGIAO, modelo: process.env.NOD_VOZ_STT_MODELO }) });
  }
  if (!so || so === "whisper") {
    // a linha de base é o whisper `base`, mesmo com o small baixado
    const w = criarTranscritorWhisperLocal({ env: { ...process.env, NOD_VOZ_WHISPER_MODELO: process.env.NOD_VOZ_WHISPER_MODELO ?? MODELO_WHISPER_PADRAO } });
    await w.preparar();
    provedores.push({ id: "whisper-base", t: w, encerrar: w.encerrar });
  }

  const linhas = ["| provedor | nomes de bots (meta ≥ 90%) | comandos (meta ≥ 95%) | recusa → aprovação (meta 0) | resultado |", "|---|---|---|---|---|"];
  const detalhes: Record<string, unknown> = {};
  for (const p of provedores) {
    const transcricoes = new Map<string, string>();
    for (const [i, item] of itens.entries()) {
      const texto = await transcrever(p.t, lerFala(join(corpus, item.arquivo)), vocabulario);
      transcricoes.set(item.arquivo, texto);
      dizer(`${p.id} ${i + 1}/${itens.length} ${item.arquivo}: ${texto}`);
    }
    const r = avaliarStt(itens, transcricoes);
    linhas.push(linhaStt(p.id, r));
    detalhes[p.id] = { ...r, transcricoes: Object.fromEntries(transcricoes) };
    await p.encerrar?.();
  }
  const resultado = join(saida, semVocabulario ? "resultado-stt-sem-vocabulario.json" : "resultado-stt.json");
  writeFileSync(resultado, JSON.stringify({ metas: { nomes: META_NOMES, comandos: META_COMANDOS }, itens: itens.length, vocabulario, detalhes }, null, 2));
  dizer(`\n${linhas.join("\n")}\n\n${semVocabulario ? "Sem vocabulário. " : ""}Transcrições e erros: ${resultado} (fica fora do repositório: tem a fala das pessoas)`);
}

async function modoTts(): Promise<void> {
  const saida = arg("saida", join(tmpdir(), "teste-cego-tts"))!;
  const semente = Number(arg("semente", "166"));
  mkdirSync(join(saida, "amostras"), { recursive: true });
  const fonte = criarFonteDeToken({ env: process.env });
  // REST (frase inteira): o teste é da voz, não da latência; o limitador segura os 200 pedidos abaixo da cota
  const limitador = criarLimitadorTts({ tetoPorMinuto: TETO_TTS_PADRAO_MIN });
  const tts = criarSintetizadorLimitado(criarSintetizadorGoogle({ token: () => fonte.token(), projeto: fonte.projeto, vagaExtra: limitador.vaga }), limitador);
  const pares = VOZES_NOD.flatMap((v) => FRASES_TESTE_TTS.map((_, frase) => ({ voz: v.id, frase })));
  const ordem = embaralhar(pares, semente);
  const gabarito: EntradaGabarito[] = [];
  for (const [i, par] of ordem.entries()) {
    const amostra = `A${String(i + 1).padStart(3, "0")}`;
    const pedacos: Int16Array[] = [];
    for await (const p of tts.sintetizar({ texto: FRASES_TESTE_TTS[par.frase]!, voz: par.voz, velocidade: 1 })) pedacos.push(p);
    writeFileSync(join(saida, "amostras", `${amostra}.wav`), montarWav(concatenar(pedacos), TAXA_VOZ_HZ));
    gabarito.push({ amostra, ...par });
    dizer(`${amostra} (${i + 1}/${ordem.length})`);
  }
  writeFileSync(join(saida, "gabarito.json"), JSON.stringify(gabarito, null, 2));
  writeFileSync(join(saida, "notas.csv"), ["amostra,ouvinte,nota", ...gabarito.map((g) => `${g.amostra},,`)].join("\n") + "\n");
  dizer(`\n${ordem.length} amostras em ${join(saida, "amostras")}. Mande a pasta amostras/ e o notas.csv a cada ouvinte (nota de 1 a 5, uma cópia por ouvinte, com o nome na coluna ouvinte); o gabarito.json fica com quem aplica.`);
}

function modoApurar(): void {
  const i = process.argv.indexOf("--notas");
  // sem --notas, o slice pegaria o próprio comando (node, o script, "apurar") como planilhas; as planilhas vão até a
  // próxima opção, senão o valor dela (o gabarito em `--notas a.csv --gabarito g.json`) virava planilha
  const depois = i < 0 ? [] : process.argv.slice(i + 1);
  const proxima = depois.findIndex((a) => a.startsWith("--"));
  const arquivos = proxima < 0 ? depois : depois.slice(0, proxima);
  if (arquivos.length === 0) throw new UsoInvalido("falta --notas: as planilhas preenchidas pelos ouvintes (amostra,ouvinte,nota)");
  const gabarito = JSON.parse(readFileSync(arg("gabarito") ?? "gabarito.json", "utf8")) as EntradaGabarito[];
  const notas = arquivos.flatMap((a) => lerNotas(readFileSync(a, "utf8")));
  const mos = apurarMos(gabarito, notas);
  dizer(`| voz | MOS | notas | ouvintes | Release 1 (corte ${CORTE_MOS}) |\n|---|---|---|---|---|`);
  for (const m of mos) dizer(`| ${m.voz} | ${m.mos?.toFixed(2) ?? "—"} | ${m.notas} | ${m.ouvintes} | ${m.mos === null ? "sem notas" : m.sai ? "sai do catálogo" : "fica"} |`);
  const ouvintes = new Set(notas.map((n) => n.ouvinte)).size;
  if (ouvintes < 5) dizer(`\nAtenção: ${ouvintes} ouvinte(s); o aceite pede pelo menos 5.`);
}

const modo = process.argv[2];
try {
  if (modo === "stt") await modoStt();
  else if (modo === "tts") await modoTts();
  else if (modo === "apurar") modoApurar();
  else throw new UsoInvalido("uso: node scripts/teste-cego-voz.ts stt|tts|apurar (detalhes no topo do arquivo)");
} catch (e) {
  encerrarComFalha(e);
}
process.exit(0);
