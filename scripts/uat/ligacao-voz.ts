/**
 * UAT da ligação por voz contra um servidor de pé (definido em 2026-10-04, plano do modo ligação, "Verificação"). Faz o
 * papel do app: entra (login stub), cria ou acha o bot, aceita o aviso de voz, liga, fala frases de verdade (geradas
 * com o `say` do macOS e mandadas em tempo real, 20 ms por quadro, como um microfone), ouve as respostas, mede as
 * latências e desliga. O áudio que o bot falou é salvo em WAV para ouvir depois.
 *
 * Uso: node scripts/uat/ligacao-voz.ts --url http://127.0.0.1:8890 --saida /tmp/uat-voz "Oi, tudo bem?" "Cria uma rotina"
 * Exige NOD_LOGIN=stub no servidor e macOS (para o `say`). Custo zero com NOD_EXECUTOR=catcher; com claude-cli, gasta a
 * assinatura (o modelo da ligação do servidor).
 *
 * --paralelas N (definido em 2026-10-05, NOD-166): N ligações ao mesmo tempo, cada uma com uma pessoa do login stub
 * (uma pessoa só tem uma ligação por vez), para ver o pico de pedidos de TTS por minuto contra a cota do Google: o
 * `tts_pico_min` de cada `voz_ligacao_encerrada` e os `voz_tts_limitado` no log do servidor.
 *
 * Eco (NOD-165), as 50 frases de comando de scripts/uat/frases-eco.ts:
 * - `--eco --listar` só imprime as 50 linhas `[[delta: …]]`, que o catcher lê ao pé da letra (servidor local em
 *   NOD_EXECUTOR=catcher, no navegador). `--eco --listar --ia` imprime as mesmas 50 como pedido de leitura para a IA de
 *   verdade: é o que se cola no app assinado, que só roda claude-cli/codex-cli (desktop/main.ts), nunca o catcher.
 * - `--eco [--quantas N]` é o pré-teste sem hardware: manda as mesmas linhas pela ligação e devolve o áudio do bot como
 *   microfone, em tempo real e sem cancelamento de eco (o pior caso). Conta as legendas finais (eco que vazou e virou
 *   fala da pessoa) e os `comando` (que precisam ser 0).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { encerrarComFalha, inteiroPositivo, UsoInvalido } from "../voz/falha-de-script.ts";
import { FRASES_DE_ECO, linhaDoCatcher, linhaParaIa, vereditoDoEco } from "./frases-eco.ts";

type Msg = { t: string; [k: string]: unknown };

function arg(nome: string, padrao: string): string {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1]! : padrao;
}
const url = arg("url", "http://127.0.0.1:8890");
const saida = arg("saida", join(tmpdir(), "uat-voz"));
const voz = arg("voz", "Luciana");
const nomeBot = arg("bot", "Nina");
// NaN ou 0 faria o slice das pessoas sair vazio e o script terminar sem ligar nada
const paralelas = (() => {
  try {
    return process.argv.includes("--paralelas") ? inteiroPositivo("paralelas", process.argv[process.argv.indexOf("--paralelas") + 1]) : 1;
  } catch (e) {
    return encerrarComFalha(e);
  }
})();
const eco = process.argv.includes("--eco");
const BOOLEANAS = new Set(["--eco", "--listar", "--ia"]);
const frases = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(all[i - 1]?.startsWith("--") && !BOOLEANAS.has(all[i - 1]!)));
if (frases.length === 0) frases.push("Oi, tudo bem?", "Me conta o que você sabe fazer.");
if (eco && process.argv.includes("--listar")) {
  const linha = process.argv.includes("--ia") ? linhaParaIa : linhaDoCatcher;
  FRASES_DE_ECO.forEach((f, i) => process.stdout.write(`${String(i + 1).padStart(2, "0")} [${f.perfil}: ${f.comando}] ${linha(f)}\n`));
  process.exit(0);
}
// `--quantas abc` daria slice(0, NaN) vazio: zero leituras e "comandos: 0 ✅" sem ter testado nada
const frasesDeEco = (() => {
  try {
    return process.argv.includes("--quantas") ? FRASES_DE_ECO.slice(0, inteiroPositivo("quantas", arg("quantas", ""))) : FRASES_DE_ECO;
  } catch (e) {
    return encerrarComFalha(e);
  }
})();
mkdirSync(saida, { recursive: true });

const escreverNoTerminal = (s: string) => process.stdout.write(`${s}\n`);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function wavDoSay(texto: string, saida: string): Int16Array {
  const arquivo = join(saida, `entrada-${Date.now()}.wav`);
  execFileSync("say", ["-v", voz, "--file-format=WAVE", "--data-format=LEI16@16000", "-o", arquivo, texto]);
  const b = readFileSync(arquivo);
  let i = 12;
  while (i < b.length - 8) {
    const id = b.toString("ascii", i, i + 4);
    const tam = b.readUInt32LE(i + 4);
    if (id === "data") return new Int16Array(b.buffer.slice(b.byteOffset + i + 8, b.byteOffset + i + 8 + tam));
    i += 8 + tam + (tam % 2);
  }
  throw new Error("WAV sem data");
}

function wav(pcm: Int16Array, taxa: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.byteLength, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(taxa, 24); h.writeUInt32LE(taxa * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([h, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]);
}

/**
 * O laço do eco: o que o bot fala volta como microfone, 24 kHz → 16 kHz, um quadro de 20 ms a cada 20 ms, como um
 * alto-falante ao lado do microfone sem cancelamento de eco. Sem fala do bot, manda silêncio (o microfone nunca para).
 * Relata `tocou-fim` de cada fala quando o último pedaço dela "tocou" e nada mais chegou em 300 ms.
 */
function criarLaco() {
  const fila: { utt: number; quadro: Int16Array }[] = [];
  let resto = new Int16Array(0);
  let restoUtt = -1;
  const ultimoPedacoEm = new Map<number, number>();
  const tocando = new Set<number>();
  let seq = 1_000_000;
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    tocar(utt: number, pcm24: Int16Array) {
      const n = Math.floor(pcm24.length / 1.5);
      const pcm16 = new Int16Array(n);
      for (let i = 0; i < n; i++) pcm16[i] = pcm24[Math.floor(i * 1.5)]!;
      const junto = restoUtt === utt ? new Int16Array([...resto, ...pcm16]) : pcm16;
      let o = 0;
      for (; o + 320 <= junto.length; o += 320) fila.push({ utt, quadro: junto.subarray(o, o + 320) });
      resto = junto.slice(o);
      restoUtt = utt;
      ultimoPedacoEm.set(utt, Date.now());
      tocando.add(utt);
    },
    ligar(ws: WebSocket) {
      timer = setInterval(() => {
        const q = fila.shift();
        const b = Buffer.alloc(5 + 640);
        b.writeUInt8(1, 0);
        b.writeUInt32LE(seq++, 1);
        if (q) Buffer.from(q.quadro.buffer, q.quadro.byteOffset, q.quadro.byteLength).copy(b, 5);
        ws.send(b);
        for (const utt of tocando) {
          const naFila = fila.some((x) => x.utt === utt);
          if (!naFila && Date.now() - (ultimoPedacoEm.get(utt) ?? 0) > 300) {
            tocando.delete(utt);
            ws.send(JSON.stringify({ t: "tocou-fim", utt }));
          }
        }
      }, 20);
    },
    quieto: () => fila.length === 0 && tocando.size === 0,
    desligar: () => clearInterval(timer),
  };
}
async function ligar(pessoaId: string, indice: number): Promise<void> {
  const escrever = (s: string) => escreverNoTerminal(paralelas > 1 ? s.replace(/^/gm, `[${indice + 1}] `) : s);
  const saidaDaLigacao = paralelas > 1 ? join(saida, String(indice + 1)) : saida;
  mkdirSync(saidaDaLigacao, { recursive: true });
  const entrar = await fetch(`${url}/api/sessao/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pessoaId }) });
  const cookie = (entrar.headers.get("set-cookie") ?? "").split(";")[0]!;
  const { tenantId } = (await entrar.json()) as { tenantId: string };
  const api = async <T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> => {
    const r = await fetch(`${url}/api/t/${tenantId}/${caminho}`, { method: metodo, headers: { cookie, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await r.text();
    if (!r.ok) throw new Error(`${metodo} ${caminho} → ${r.status} ${t}`);
    return JSON.parse(t) as T;
  };

  const frota = await api<{ agentes: { id: string; nome: string }[] }>("GET", "frota");
  let agenteId = frota.agentes.find((a) => a.nome === nomeBot)?.id;
  if (!agenteId) agenteId = (await api<{ agente: { id: string } }>("POST", "agentes", { dono: "pessoa", nome: nomeBot })).agente.id;
  const disp = await api<{ disponivel: boolean; consentimentoNecessario?: boolean; texto?: string }>("GET", `ligacoes/disponibilidade?agenteId=${agenteId}`);
  if (!disp.disponivel) throw new Error(`indisponível: ${disp.texto}`);
  if (disp.consentimentoNecessario) await api("POST", "voz/consentimento", { versao: 1 });
  const { ligacao } = await api<{ ligacao: { id: string } }>("POST", "ligacoes", { agenteId });
  escrever(`ligação ${ligacao.id} com ${nomeBot}`);

  const ws = new WebSocket(`${url.replace("http", "ws")}/api/t/${tenantId}/voz/v1/midia`, { headers: { cookie, origin: url } });
  const msgs: { em: number; m: Msg }[] = [];
  const audioPorUtt = new Map<number, Int16Array[]>();
  const todasAsVozes: Int16Array[] = [];
  let primeiroAudioEm = 0;
  // Quando chegou o primeiro áudio de cada fala do bot: o que a pessoa ouve, não só o texto.
  const audioEm = new Map<number, number>();
  // Um laço por ligação: com --paralelas, o áudio de uma não pode voltar como microfone de outra.
  const laco = criarLaco();
  ws.on("message", (dados, binario) => {
    const agora = Date.now();
    if (binario) {
      const b = dados as Buffer;
      const utt = b.readUInt16LE(5);
      const pcm = new Int16Array(b.buffer.slice(b.byteOffset + 7, b.byteOffset + b.byteLength));
      if (!audioPorUtt.has(utt)) {
        audioPorUtt.set(utt, []);
        audioEm.set(utt, agora);
        // O "alto-falante": relata o fim da fala depois da duração, como o app faria. No eco, quem relata é o laço.
        if (!eco) setTimeout(() => ws.send(JSON.stringify({ t: "tocou-fim", utt })), 400);
      }
      if (eco) laco.tocar(utt, pcm);
      audioPorUtt.get(utt)!.push(pcm);
      todasAsVozes.push(pcm);
      primeiroAudioEm ||= agora;
      return;
    }
    const m = JSON.parse(String(dados)) as Msg;
    msgs.push({ em: agora, m });
    if (m.t === "bot-fala") escrever(`  🤖 [${m.tipo}] ${m.texto}`);
    if (m.t === "legenda" && m.final) escrever(`  🎤 ${m.texto}`);
    if (m.t === "aviso") escrever(`  ⚠️  ${m.texto}`);
  });
  await new Promise<void>((r, j) => { ws.once("open", () => r()); ws.once("error", j); });
  ws.send(JSON.stringify({ t: "ola", v: 1, ligacaoId: ligacao.id, entrada: "pcm16", saida: "pcm16" }));
  const esperar = async (f: (m: Msg) => boolean, desde: number, ms: number): Promise<{ em: number; m: Msg } | null> => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      const achado = msgs.find((x) => x.em >= desde && f(x.m));
      if (achado) return achado;
      await dormir(50);
    }
    return null;
  };
  const inicio = Date.now();
  const online = await esperar((m) => m.t === "cerebro" && m.online === true, inicio, 40_000);
  escrever(online ? `cérebro online em ${Date.now() - inicio} ms` : "❌ o cérebro da ligação não ficou online em 40 s");
  await dormir(2500);

  if (eco) {
    laco.ligar(ws);
    const desde = Date.now();
    let lidas = 0;
    for (const [i, f] of frasesDeEco.entries()) {
      // Ligação encerrada pelo servidor (cerebro_caiu, por exemplo): nada mais será lido.
      if (!online || msgs.some((x) => x.m.t === "fim")) break;
      const antes = Date.now();
      ws.send(JSON.stringify({ t: "texto", conteudo: linhaDoCatcher(f) }));
      const leu = await esperar((m) => m.t === "bot-fala" && m.tipo === "conteudo", antes, 30_000);
      if (!leu) {
        escrever(`  ${String(i + 1).padStart(2, "0")}/${frasesDeEco.length} ❌ o bot não leu em 30 s: o pré-teste parou aqui`);
        break;
      }
      lidas++;
      await dormir(800);
      while (!laco.quieto()) await dormir(100);
      // Deixa o STT fechar o último trecho do eco antes da próxima leitura.
      await dormir(1500);
      escrever(`  ${String(i + 1).padStart(2, "0")}/${frasesDeEco.length} lida`);
    }
    laco.desligar();
    const vazou = msgs.filter((x) => x.em >= desde && x.m.t === "legenda" && x.m.final === true);
    const comandos = msgs.filter((x) => x.em >= desde && x.m.t === "comando");
    escrever(`\n— eco em laço: ${frasesDeEco.length} leituras —`);
    escrever(`legendas finais (eco que virou fala da pessoa): ${vazou.length}`);
    for (const v of vazou) escrever(`  🎤 ${String(v.m.texto)}`);
    const veredito = vereditoDoEco({ pedidas: frasesDeEco.length, lidas, comandos: comandos.length });
    for (const l of veredito.linhas) escrever(l);
    escrever(`ligação ${ligacao.id}: rode scripts/uat/relatorio-ligacao.ts no log do servidor para os ecos descartados`);
    ws.send(JSON.stringify({ t: "tchau" }));
    await esperar((m) => m.t === "fim", inicio, 10_000);
    ws.close();
    if (!veredito.passou) process.exitCode = 1;
    return;
  }

  let seq = 0;
  const relatorio: string[] = [];
  for (const frase of frases) {
    const pcm = wavDoSay(frase, saidaDaLigacao);
    const quadros = Math.ceil(pcm.length / 320);
    let fimDaFala = 0;
    for (let q = 0; q < quadros + 75; q++) {
      const pedaco = q < quadros ? pcm.subarray(q * 320, q * 320 + 320) : new Int16Array(320);
      const b = Buffer.alloc(5 + 640);
      b.writeUInt8(1, 0);
      b.writeUInt32LE(seq++, 1);
      Buffer.from(pedaco.buffer, pedaco.byteOffset, pedaco.byteLength).copy(b, 5);
      ws.send(b);
      if (q === quadros) fimDaFala = Date.now();
      await dormir(20);
    }
    const legenda = await esperar((m) => m.t === "legenda" && m.final === true, fimDaFala, 15_000);
    const resposta = await esperar((m) => m.t === "bot-fala" && m.tipo === "conteudo", fimDaFala, 30_000);
    const espera = await esperar((m) => m.t === "bot-fala" && m.tipo === "espera", fimDaFala, 1);
    await dormir(4000);
    // Buraco entre frases da mesma resposta: o áudio da seguinte chegou depois de a anterior acabar de tocar?
    const falas = msgs.filter((x) => x.em >= fimDaFala && x.m.t === "bot-fala" && x.m.tipo === "conteudo").map((x) => Number(x.m.utt));
    let buracoMax = 0;
    for (let i = 1; i < falas.length; i++) {
      const ant = falas[i - 1]!;
      const dur = ((audioPorUtt.get(ant) ?? []).reduce((n, p) => n + p.length, 0) / 24_000) * 1000;
      const fimAnt = (audioEm.get(ant) ?? 0) + dur;
      buracoMax = Math.max(buracoMax, (audioEm.get(falas[i]!) ?? fimAnt) - fimAnt);
    }
    const audio1 = resposta ? audioEm.get(Number(resposta.m.utt)) : undefined;
    relatorio.push(`"${frase}" → STT ${legenda ? legenda.em - fimDaFala : "—"} ms · 1º conteúdo ${resposta ? resposta.em - fimDaFala : "—"} ms · 1º áudio ${audio1 ? audio1 - fimDaFala : "—"} ms${espera ? ` · espera ${espera.em - fimDaFala} ms` : ""}${falas.length > 1 ? ` · maior buraco entre frases ${Math.round(buracoMax)} ms` : ""}`);
  }
  ws.send(JSON.stringify({ t: "tchau" }));
  await esperar((m) => m.t === "fim", inicio, 10_000);
  ws.close();
  const total = todasAsVozes.reduce((s, p) => s + p.length, 0);
  const tudo = new Int16Array(total);
  let o = 0;
  for (const p of todasAsVozes) { tudo.set(p, o); o += p.length; }
  writeFileSync(join(saidaDaLigacao, "voz-do-bot.wav"), wav(tudo, 24_000));
  const falas = await api<{ falas: { autor: string; texto: string }[] }>("GET", `ligacoes/${ligacao.id}/falas`);
  escrever("\n— latências (do fim da fala da pessoa) —");
  for (const l of relatorio) escrever(l);
  escrever(`\n— transcrição (${falas.falas.length} falas) —`);
  for (const f of falas.falas) escrever(`${f.autor === "pessoa" ? "🎤" : "🤖"} ${f.texto}`);
  escrever(`\náudio do bot: ${join(saidaDaLigacao, "voz-do-bot.wav")} (${(total / 24_000).toFixed(1)} s)`);
}

async function main(): Promise<void> {
  const modo = (await (await fetch(`${url}/api/sessao/modo`)).json()) as { pessoas?: { id: string }[] };
  const pessoas = modo.pessoas ?? [];
  if (pessoas.length === 0) throw new UsoInvalido("servidor sem login stub ou sem pessoas");
  if (pessoas.length < paralelas) throw new UsoInvalido(`--paralelas ${paralelas} pede ${paralelas} pessoas no login stub (uma ligação por pessoa); o servidor tem ${pessoas.length}`);
  // as ligações começam com 1 s de diferença, como pessoas ligando quase juntas
  await Promise.all(pessoas.slice(0, paralelas).map(async (p, i) => {
    await dormir(i * 1000);
    await ligar(p.id, i);
  }));
}

main().catch(encerrarComFalha);
