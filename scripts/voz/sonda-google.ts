/**
 * Sonda paga da voz do Google (definido em 2026-10-04): sintetiza uma frase com o Chirp 3 HD pelo adaptador do nod,
 * mede a latência, salva o WAV e devolve o mesmo áudio (24 kHz → 16 kHz) ao transcritor ao vivo em tempo real.
 * Uso: NOD_VOZ_PROJETO=nod-exemplos NOD_VOZ_GCLOUD_BIN=$(which gcloud) node scripts/voz/sonda-google.ts [voz] ["frase"]
 *
 * Modos da homologação (definido em 2026-10-05, NOD-166). Todos gravam as mensagens cruas da Live API num JSON, que
 * responde os itens "A CONFIRMAR" de src/adapters/voz/google-transcricao.ts:
 *
 * --duracao 12m: áudio contínuo por 12 min numa sessão só (as falas do corpus NOD_CORPUS_VOZ em loop ou, sem corpus,
 *   a frase sintetizada), atravessando a rotação dos 9 min. Passa se houver `voz_stt_rotacao`, nenhum
 *   `voz_stt_rotacao_falhou` e um final com texto para cada trecho enviado.
 * --sem-rotacao: o mesmo, com a rotação desligada, para medir quando o Vertex fecha a sessão e como vem o `goAway`
 *   (use com --duracao 11m).
 * --cota N: N fluxos de TTS em streaming no mesmo minuto, sem o limitador e sem o REST de reserva, para ver se o
 *   fluxo conta na cota de 200/min (algum `RESOURCE_EXHAUSTED`, grpc 8 ou http 429, acima de 200). Fora do horário de
 *   uso: gasta a cota do projeto de produção.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TAXA_MICROFONE_HZ } from "../../src/contracts/voz.ts";
import { concatenar, lerWav, misturarParaMono, montarWav, reamostrar, silencio } from "../../src/adapters/voz/audio.ts";
import { vozDoProvedor } from "../../src/adapters/voz/catalogo-vozes.ts";
import { abrirWebSocketGlobal, criarTranscritorGoogle, ROTACAO_MS, type AbrirConexaoWs } from "../../src/adapters/voz/google-transcricao.ts";
import { criarTransporteHttp2, FalhaAntesDoAudio, sintetizarEmStreaming } from "../../src/adapters/voz/google-voz-streaming.ts";
import { criarSintetizadorGoogle } from "../../src/adapters/voz/google-voz.ts";
import { criarFonteDeToken } from "../../src/adapters/voz/token-google.ts";
import { redigirECortar } from "../../src/domain/segredos.ts";
import { duracaoEmMs, encerrarComFalha, inteiroPositivo } from "./falha-de-script.ts";

const dizer = (t: string) => process.stdout.write(`${t}\n`);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const COM_VALOR = new Set(["--duracao", "--cota"]);
const posicionais = process.argv.slice(2).filter((a, i, todos) => !a.startsWith("--") && !COM_VALOR.has(todos[i - 1] ?? ""));
const voz = posicionais[0] ?? "clara";
const frase = posicionais[1] ?? "Oi! Aqui é Nina. Me conta: qual é a tarefa que mais toma o seu tempo no trabalho hoje?";
const fonte = criarFonteDeToken({ env: process.env });
const token = () => fonte.token();
const tmp = process.env.TMPDIR ?? "/tmp";

/** As linhas de log do nod (JSON no console.log) que a sonda confere. */
const eventos: Record<string, unknown>[] = [];
// eslint-disable-next-line no-console -- a sonda escuta a saída do log do nod (src/obs/log.ts) para conferir a rotação
const logOriginal = console.log.bind(console);
// eslint-disable-next-line no-console -- idem
console.log = (linha: unknown) => {
  try {
    eventos.push(JSON.parse(String(linha)) as Record<string, unknown>);
  } catch {
    // não é linha do log do nod
  }
  logOriginal(linha);
};

/** Diagnóstico da Live API: o que chegou em cada conexão, sem o áudio. */
type Conexao = { aberta: number; fechada: number | null; codigo: number | null; mensagens: number; modelTurn: number; finished: number; goAway: unknown[]; transcricoes: string[] };
const conexoes: Conexao[] = [];
const abrirComDiagnostico: AbrirConexaoWs = (url, headers, ev) => {
  const c: Conexao = { aberta: Date.now(), fechada: null, codigo: null, mensagens: 0, modelTurn: 0, finished: 0, goAway: [], transcricoes: [] };
  conexoes.push(c);
  return abrirWebSocketGlobal(url, headers, {
    ...ev,
    aoMensagem(t) {
      c.mensagens++;
      try {
        const m = JSON.parse(t) as { goAway?: unknown; serverContent?: { modelTurn?: unknown; inputTranscription?: { text?: string; finished?: boolean } } };
        if (m.goAway !== undefined) c.goAway.push({ idade_ms: Date.now() - c.aberta, ...(m.goAway as object) });
        if (m.serverContent?.modelTurn !== undefined) c.modelTurn++;
        if (m.serverContent?.inputTranscription?.finished === true) c.finished++;
        if (typeof m.serverContent?.inputTranscription?.text === "string") c.transcricoes.push(m.serverContent.inputTranscription.text);
      } catch {
        // mensagem que não é JSON: o adaptador também ignora
      }
      ev.aoMensagem(t);
    },
    aoFechar(codigo) {
      c.fechada = Date.now();
      c.codigo = codigo;
      ev.aoFechar(codigo);
    },
  });
};

/** Pedaços de `inputTranscription` de um mesmo trecho: se cada um começa com o anterior, vêm acumulados. */
function formaDaTranscricao(): "acumulada" | "em pedaços" | "um pedaço por trecho" {
  const pares = conexoes.flatMap((c) => c.transcricoes.slice(1).map((t, i) => [c.transcricoes[i] ?? "", t] as const));
  if (pares.length === 0) return "um pedaço por trecho";
  return pares.filter(([a, b]) => b.startsWith(a)).length > pares.length / 2 ? "acumulada" : "em pedaços";
}

async function sintetizarFrase(): Promise<Int16Array> {
  const t0 = performance.now();
  let primeiro = 0;
  const pedacos: Int16Array[] = [];
  for await (const p of criarSintetizadorGoogle({ token, projeto: fonte.projeto }).sintetizar({ texto: frase, voz, velocidade: 1 })) {
    if (!primeiro) primeiro = performance.now() - t0;
    pedacos.push(p);
  }
  const total = pedacos.reduce((n, p) => n + p.length, 0);
  const pcm24 = new Int16Array(total);
  let o = 0;
  for (const p of pedacos) {
    pcm24.set(p, o);
    o += p.length;
  }
  const arquivo = `${tmp}/sonda-google-${voz}.wav`;
  writeFileSync(arquivo, montarWav(pcm24, 24_000));
  dizer(`TTS ${voz}: primeiro áudio ${primeiro.toFixed(0)} ms, ${(total / 24_000).toFixed(1)} s de fala → ${arquivo}`);
  return reamostrar(pcm24, 24_000, TAXA_MICROFONE_HZ);
}

/** Uma fala sintetizada, ida e volta: o modo de sempre. */
async function modoFrase(): Promise<void> {
  const audio = concatenar([await sintetizarFrase(), silencio(1000, TAXA_MICROFONE_HZ)]);
  const n16 = audio.length - TAXA_MICROFONE_HZ;
  const stt = criarTranscritorGoogle({ token, projeto: fonte.projeto, regiao: process.env.NOD_VOZ_REGIAO, modelo: process.env.NOD_VOZ_STT_MODELO, abrirConexao: abrirComDiagnostico });
  const t1 = performance.now();
  let fimFala = 0;
  const fim = new Promise<void>((resolve, reject) => {
    void stt
      .abrir({
        idioma: "pt-BR",
        vocabulario: ["nod", "Nina", "bot"],
        aoResultado(r) {
          dizer(`${(performance.now() - t1).toFixed(0).padStart(6)} ms ${r.final ? "FINAL  " : "parcial"} ${r.texto}${r.final ? `  (fim da fala +${(performance.now() - fimFala).toFixed(0)} ms)` : ""}`);
          if (r.final) resolve();
        },
        aoErro(e) {
          reject(e);
        },
      })
      .then(async (s) => {
        dizer(`STT aberto em ${(performance.now() - t1).toFixed(0)} ms`);
        for (let i = 0; i < audio.length; i += 320) {
          s.enviar(audio.subarray(i, i + 320));
          if (i === n16 - (n16 % 320)) fimFala = performance.now();
          await dormir(20);
        }
        s.fimDeFala();
        await fim.catch(() => {});
        await s.fechar();
      }, reject);
  });
  await Promise.race([fim, new Promise((_, rej) => setTimeout(() => rej(new Error("sem final em 30 s")), 30_000))]);
}

function falasDoCorpus(): Int16Array[] {
  const dir = process.env.NOD_CORPUS_VOZ;
  if (!dir) return [];
  return readdirSync(dir)
    .filter((a) => a.endsWith(".wav"))
    .sort()
    .map((a) => {
      const wav = lerWav(readFileSync(join(dir, a)));
      const mono = misturarParaMono(wav.pcm, wav.canais);
      return wav.taxa === TAXA_MICROFONE_HZ ? mono : reamostrar(mono, wav.taxa, TAXA_MICROFONE_HZ);
    });
}

/** Áudio contínuo numa sessão só, trecho atrás de trecho, como uma conversa longa. */
async function modoDuracao(duracaoMs: number, semRotacao: boolean): Promise<boolean> {
  let falas = falasDoCorpus();
  if (falas.length === 0) falas = [await sintetizarFrase()];
  const stt = criarTranscritorGoogle({
    token,
    projeto: fonte.projeto,
    regiao: process.env.NOD_VOZ_REGIAO,
    modelo: process.env.NOD_VOZ_STT_MODELO,
    abrirConexao: abrirComDiagnostico,
    rotacaoMs: semRotacao ? 60 * 60_000 : ROTACAO_MS,
  });
  let finais = 0;
  let finaisVazios = 0;
  let erro: Error | null = null;
  const s = await stt.abrir({
    idioma: "pt-BR",
    vocabulario: ["nod", "Nina", "bot"],
    aoResultado(r) {
      if (!r.final) return;
      if (r.texto.trim() === "") finaisVazios++;
      else finais++;
    },
    aoErro(e) {
      erro = e;
    },
  });
  const inicio = Date.now();
  let trechos = 0;
  while (Date.now() - inicio < duracaoMs && !erro) {
    const fala = falas[trechos % falas.length]!;
    for (let i = 0; i < fala.length; i += 320) {
      s.enviar(fala.subarray(i, i + 320));
      await dormir(20);
    }
    s.fimDeFala();
    trechos++;
    // pausa entre falas, mandando silêncio como um microfone aberto
    for (let i = 0; i < 50; i++) {
      s.enviar(new Int16Array(320));
      await dormir(20);
    }
    if (trechos % 10 === 0) dizer(`${((Date.now() - inicio) / 60_000).toFixed(1)} min: ${trechos} trechos, ${finais} finais com texto, ${conexoes.length} conexões`);
  }
  await dormir(5_000);
  await s.fechar();
  const rotacoes = eventos.filter((e) => e.evento === "voz_stt_rotacao").length;
  const falhas = eventos.filter((e) => e.evento === "voz_stt_rotacao_falhou").length;
  const passou = !erro && (semRotacao || (rotacoes >= 1 && falhas === 0)) && finais === trechos;
  dizer(`\n${trechos} trechos enviados, ${finais} finais com texto, ${finaisVazios} vazios; voz_stt_rotacao ${rotacoes}, voz_stt_rotacao_falhou ${falhas}${erro ? `, erro: ${redigirECortar((erro as Error).message, 500)}` : ""}`);
  return passou;
}

/** N fluxos de streaming no mesmo minuto, sem limitador nem REST de reserva: o fluxo conta na cota? */
async function modoCota(n: number): Promise<void> {
  const transporte = criarTransporteHttp2();
  const motivos = new Map<string, number>();
  const inicio = Date.now();
  const intervalo = 55_000 / n;
  const pedidos: Promise<void>[] = [];
  for (let i = 0; i < n; i++) {
    pedidos.push(
      (async () => {
        try {
          for await (const _ of sintetizarEmStreaming(transporte, { texto: `Teste ${i + 1}.`, voz: vozDoProvedor("google", voz), velocidade: 1, token: await token(), projeto: fonte.projeto, prazoPrimeiroAudioMs: 10_000, folgaInicialMs: 0, amostrasPorPedaco: 2400 })) {
            // só importa se o fluxo foi aceito
          }
          motivos.set("ok", (motivos.get("ok") ?? 0) + 1);
        } catch (e) {
          const m = e instanceof FalhaAntesDoAudio ? e.motivo : e instanceof Error ? e.name : "desconhecido";
          motivos.set(m, (motivos.get(m) ?? 0) + 1);
        }
      })(),
    );
    await dormir(intervalo);
  }
  await Promise.all(pedidos);
  transporte.fechar();
  dizer(`${n} fluxos em ${((Date.now() - inicio) / 1000).toFixed(0)} s: ${[...motivos].map(([m, q]) => `${m} ${q}`).join(", ")}`);
  dizer("Algum grpc_8 ou http_429: o fluxo conta na cota (o limitador já conta assim). Todos ok acima de 200: não conta, e o teto pode subir.");
}

let codigoSaida = 0;
const comCota = process.argv.includes("--cota");
try {
  // NaN ou 0 não mandava nada e a sonda "passava"; --cota sem número caía no modo frase, que é pago
  if (comCota) await modoCota(inteiroPositivo("cota", arg("cota")));
  else if (process.argv.includes("--duracao")) {
    if (!(await modoDuracao(duracaoEmMs(arg("duracao")), process.argv.includes("--sem-rotacao")))) codigoSaida = 1;
  } else await modoFrase();
} catch (e) {
  encerrarComFalha(e);
}

if (!comCota) {
  const diag = {
    conexoes: conexoes.map((c) => ({ duracao_ms: (c.fechada ?? Date.now()) - c.aberta, codigo_fechamento: c.codigo, mensagens: c.mensagens, model_turn: c.modelTurn, finished: c.finished, go_away: c.goAway })),
    transcricao: formaDaTranscricao(),
    amostra_input_transcription: conexoes[0]?.transcricoes.slice(0, 10) ?? [],
  };
  const arquivo = `${tmp}/sonda-google-diagnostico.json`;
  // O diagnóstico guarda texto cru do Vertex (goAway, transcrições): passa pelo redator antes de ir ao disco (NOD-158).
  writeFileSync(arquivo, redigirECortar(JSON.stringify(diag, null, 2), 200_000) ?? "{}");
  dizer(`\nA CONFIRMAR (google-transcricao.ts):`);
  dizer(`- modelTurn além da transcrição: ${conexoes.reduce((n, c) => n + c.modelTurn, 0)} mensagens`);
  dizer(`- inputTranscription: ${diag.transcricao}; finished=true em ${conexoes.reduce((n, c) => n + c.finished, 0)} mensagens`);
  dizer(`- goAway: ${redigirECortar(JSON.stringify(conexoes.flatMap((c) => c.goAway)), 2_000)}; fechamentos: ${conexoes.map((c) => `${c.codigo ?? "aberta"} aos ${(((c.fechada ?? Date.now()) - c.aberta) / 60_000).toFixed(1)} min`).join(", ")}`);
  dizer(`- vocabulário: compare scripts/teste-cego-voz.ts stt com e sem --sem-vocabulario`);
  dizer(`Diagnóstico: ${arquivo}`);
}
process.exit(codigoSaida);
