// Teste de carga da TELA (definido em 2026-09-30): vários bots escrevendo ao mesmo tempo e um turno pesado na
// conversa aberta, medidos num Chrome headless de verdade, sem gastar assinatura (catcher com atraso entre eventos).
// Nasceu da investigação de "a tela trava com vários bots rodando": com o código de antes, 8 bots escrevendo
// travaram a página por 118 s. Use-o para ver se uma mudança na web ou no SSE piorou a tela.
//
//   npm run db:efemero:up -- carga-tela 5441        # uma vez: banco efêmero (NUNCA o diário, 5434)
//   node scripts/carga-tela/rodar.ts preparar       # 12 bots "Carga NN", conversa de 300 mensagens, modelo nod_base
//   node scripts/carga-tela/rodar.ts medir depois   # build da web + os 4 cenários → $CARGA_SAIDA/depois-*.json
//   CARGA_REPO=/tmp/nod-main node scripts/carga-tela/rodar.ts medir antes   # outra cópia do código (git archive)
//   node scripts/carga-tela/rodar.ts comparar antes depois
//
// Cada `medir` volta o banco ao modelo antes de começar, então as variantes veem os mesmos dados. Portas e nomes
// em scripts/carga-tela/comum.ts (CARGA_*). Rode com a máquina quieta: outros testes pesados distorcem os números.
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { api, botsDeCarga, CONFIG, container, entrar, escrever, respostaRica, urlWeb } from "./comum.ts";
import { CENARIOS, medir, type Cenario } from "./medir.ts";

const AQUI = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(process.env.CARGA_REPO ?? join(AQUI, "../.."));
const BOTS = 12;
const TROCAS = Number(process.env.CARGA_TROCAS ?? 150);

function docker(...args: string[]): void {
  execFileSync("docker", ["exec", container(), ...args], { stdio: "inherit" });
}

async function subirApi(webDir?: string): Promise<ChildProcess> {
  const api = spawn(process.execPath, [join(AQUI, "servidor.ts")], {
    cwd: repo,
    env: { ...process.env, CARGA_REPO: repo, ...(webDir ? { CARGA_WEB_DIR: webDir } : {}) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      if ((await fetch(`${urlWeb()}/api/sessao/modo`)).ok) return api;
    } catch {
      // subindo
    }
  }
  api.kill("SIGTERM");
  throw new Error(`a API não subiu em ${urlWeb()}`);
}

async function derrubar(api: ChildProcess): Promise<void> {
  api.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
}

async function preparar(): Promise<void> {
  const processo = await subirApi();
  try {
    const s = await entrar();
    const existentes = new Set((await botsDeCarga(s)).map((b) => b.nome));
    for (let i = 1; i <= BOTS; i++) {
      const nome = `Carga ${String(i).padStart(2, "0")}`;
      if (!existentes.has(nome)) await api(s, "POST", "agentes", { dono: "pessoa", nome });
    }
    const pesada = (await botsDeCarga(s))[0];
    if (!pesada) throw new Error("os bots de carga não foram criados");
    const ocioso = async (): Promise<void> => {
      for (;;) {
        const c = await api<{ turnosEmCurso?: unknown[] }>(s, "GET", `conversas/${pesada.conversaId}/mensagens`);
        if ((c.turnosEmCurso?.length ?? 0) === 0) return;
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    // Uma troca por vez: a conversa pesada tem pergunta da pessoa e resposta rica do bot, como no uso real.
    for (let i = 0; i < TROCAS; i++) {
      await api(s, "POST", `conversas/${pesada.conversaId}/mensagens`, { texto: `Rodada ${i}: me dá o panorama dos PRs e do deploy. [[delta: Olhando… ]] [[texto: ${respostaRica(i)}]]` });
      await ocioso();
      if ((i + 1) % 25 === 0) escrever(`preparar: ${i + 1}/${TROCAS} trocas na conversa de ${pesada.nome}`);
    }
  } finally {
    await derrubar(processo);
  }
  // O modelo: cada `medir` recria `nod` a partir dele (createdb -T exige o banco sem conexões).
  docker("dropdb", "-U", "postgres", "--if-exists", "--force", "nod_base");
  docker("createdb", "-U", "postgres", "-T", "nod", "-O", "nod_dono", "nod_base");
  escrever("preparar: pronto; o modelo nod_base guarda este estado");
}

async function medirVariante(rotulo: string, cenarios: readonly Cenario[]): Promise<void> {
  const webDir = join(CONFIG.saida, `web-${rotulo}`);
  const build = spawnSync("npx", ["vite", "build", "--outDir", webDir, "--emptyOutDir"], { cwd: repo, stdio: ["ignore", "ignore", "inherit"] });
  if (build.status !== 0) throw new Error(`o build da web de ${repo} falhou`);
  docker("dropdb", "-U", "postgres", "--if-exists", "--force", "nod");
  docker("createdb", "-U", "postgres", "-T", "nod_base", "-O", "nod_dono", "nod");
  // O modelo tem as migrações de quando foi preparado; a variante aplica as dela (a de antes não tem nada novo).
  execFileSync(process.execPath, [join(repo, "scripts/migrate.ts")], { cwd: repo, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, DATABASE_URL_DONO: `postgres://nod_dono:nod@127.0.0.1:${CONFIG.bancoPorta}/nod` } });
  const processo = await subirApi(webDir);
  try {
    await medir(rotulo, cenarios);
  } finally {
    await derrubar(processo);
  }
}

function comparar(rotulos: string[]): void {
  escrever("cenário | variante | turnos (s) | tela livre (s) | frames | maior tarefa (ms) | TBT (ms) | fps | quadros >100 ms | tecla p50/p95/max (ms) | script (s)");
  for (const c of CENARIOS) {
    for (const r of rotulos) {
      const arq = join(CONFIG.saida, `${r}-${c}.json`);
      if (!existsSync(arq)) continue;
      const x = JSON.parse(readFileSync(arq, "utf8")) as { duracaoS: number; telaLivreS: number | null; congeladaAlemDeS?: number; frames?: number; tarefasLongas?: { maxMs: number; tbtMs: number }; quadros?: { fps: number; acima100: number }; digitacao: { p50: number; p95?: number; max: number }; chrome?: { scriptS: number } };
      if (x.telaLivreS === null) {
        escrever([c, r, x.duracaoS, `congelada > ${x.congeladaAlemDeS}`, "-", "-", "-", "-", "-", `tecla presa (max ${x.digitacao.max} antes)`, "-"].join(" | "));
        continue;
      }
      escrever([c, r, x.duracaoS, x.telaLivreS, x.frames, x.tarefasLongas?.maxMs, x.tarefasLongas?.tbtMs, x.quadros?.fps, x.quadros?.acima100, `${x.digitacao.p50}/${x.digitacao.p95}/${x.digitacao.max}`, x.chrome?.scriptS].join(" | "));
    }
  }
}

const [comando, ...resto] = process.argv.slice(2);
if (comando === "preparar") await preparar();
else if (comando === "medir") {
  const [rotulo = "depois", lista] = resto;
  const cenarios = lista ? (lista.split(",") as Cenario[]) : CENARIOS;
  await medirVariante(rotulo, cenarios);
} else if (comando === "comparar") comparar(resto.length ? resto : ["antes", "depois"]);
else {
  escrever("uso: node scripts/carga-tela/rodar.ts preparar | medir <rotulo> [cenario,...] | comparar <rotulo>...");
  process.exit(2);
}
