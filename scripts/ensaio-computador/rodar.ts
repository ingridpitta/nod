/**
 * NOD-169: o laço do ensaio do computador contra um servidor já no ar (`scripts/ensaio-computador.sh` sobe o servidor).
 * Por execução: cria um bot novo, fixa harness e modelo, liga o computador, planta as páginas e o servidor local,
 * manda o pedido com a política `autonomo`, espera o turno (teto do roteiro; ao estourar, Parar e `timeout`), coleta a
 * evidência (fala, trilha, Sua vez, registro do servidor de páginas, arquivos-alvo), classifica e lê o gasto. No fim,
 * exclui o bot e apaga container, rede e volumes. Grava uma linha por execução em `<saida>/execucoes.jsonl`.
 *
 * Portão de custo: sem `--confirmo-orcamento`, só 1 tarefa × 1 repetição por harness (`recusaDeOrcamento`).
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Execucao } from "./relatorio.ts";
import { escolherTarefas, recusaDeOrcamento, type Tarefa } from "./tarefas.ts";
import { classificar, type Evidencia, type LinhaRegistro } from "./verificar.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PAGINAS = join(AQUI, "paginas");

export const HARNESSES = {
  claude: { harness: "claude-cli", modelo: "sonnet" },
  codex: { harness: "codex-cli", modelo: "gpt-5.6-sol" },
} as const;
type NomeHarness = keyof typeof HARNESSES;

type Opcoes = { api: string; harnesses: NomeHarness[]; tarefas: Tarefa[]; repeticoes: number; confirmado: boolean; saida: string; tetoS: number };

const FLAGS_COM_VALOR = new Set(["--api", "--harness", "--tarefas", "--repeticoes", "--saida", "--teto-s"]);
const FLAGS_SEM_VALOR = new Set(["--com-audio", "--confirmo-orcamento", "--so-portao"]);

export function lerOpcoes(argv: string[]): Opcoes {
  // Flag desconhecida (`--seco`, `--so-porta`, `--repeticoes=3`) ignorada em silêncio levaria à rodada paga da tarefa 1.
  const vistas = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!FLAGS_COM_VALOR.has(a) && !FLAGS_SEM_VALOR.has(a)) throw new Error(`opção inválida: ${a} (use ${[...FLAGS_COM_VALOR, ...FLAGS_SEM_VALOR].join(" ")})`);
    if (vistas.has(a)) throw new Error(`opção repetida: ${a}`);
    vistas.add(a);
    if (FLAGS_COM_VALOR.has(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} sem valor`);
      i++;
    }
  }
  const valor = (nome: string) => { const i = argv.indexOf(nome); return i >= 0 ? argv[i + 1] : undefined; };
  // Sem repetir harness: `claude,claude` dobraria as execuções pagas sem passar pelo portão.
  const harnesses = [...new Set((valor("--harness") ?? "claude,codex").split(",").map((s) => s.trim()).filter(Boolean))];
  for (const h of harnesses) if (!(h in HARNESSES)) throw new Error(`--harness inválido: ${h} (use claude e/ou codex)`);
  const repeticoes = Number(valor("--repeticoes") ?? "1");
  if (!Number.isInteger(repeticoes) || repeticoes < 1) throw new Error("--repeticoes precisa ser um inteiro ≥ 1");
  // Teto inválido (NaN) nunca estoura: o turno pago ficaria sem o Parar do roteiro.
  const tetoS = Number(valor("--teto-s") ?? "360");
  if (!Number.isInteger(tetoS) || tetoS < 1) throw new Error("--teto-s precisa ser um inteiro ≥ 1 (segundos)");
  return {
    api: valor("--api") ?? process.env.NOD_ENSAIO_API ?? "http://127.0.0.1:8889",
    harnesses: harnesses as NomeHarness[],
    tarefas: escolherTarefas(valor("--tarefas") ?? "1", argv.includes("--com-audio")),
    repeticoes,
    confirmado: argv.includes("--confirmo-orcamento"),
    saida: valor("--saida") ?? `/tmp/nod-ensaio-${new Date().toISOString().slice(0, 10)}`,
    tetoS,
  };
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (s: string) => process.stderr.write(`${s}\n`);

export class Api {
  private cookie = "";
  tenant = "";
  pessoa = "";
  private base: string;
  constructor(base: string) { this.base = base; }

  async entrar(): Promise<void> {
    const modo = await (await fetch(`${this.base}/api/sessao/modo`)).json() as { pessoas?: { id: string; nome: string }[] };
    const marlon = modo.pessoas?.find((p) => p.nome === "Marlon");
    if (!marlon) throw new Error("Marlon não está no cadastro (rode npm run db:seed)");
    const r = await fetch(`${this.base}/api/sessao/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pessoaId: marlon.id }) });
    this.cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    const s = await (await fetch(`${this.base}/api/sessao`, { headers: { cookie: this.cookie } })).json() as { tenantId: string; pessoaId: string };
    this.tenant = s.tenantId; this.pessoa = s.pessoaId;
    if (!this.tenant) throw new Error("login falhou: sessão sem tenant");
  }

  async chamar<T = Record<string, unknown>>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const r = await fetch(`${this.base}/api/t/${this.tenant}/${caminho}`, {
      method: metodo,
      headers: { cookie: this.cookie, ...(corpo === undefined ? {} : { "content-type": "application/json" }) },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
    const texto = await r.text();
    if (!r.ok) throw new Error(`${metodo} ${caminho} → ${r.status} ${texto.slice(0, 300)}`);
    return (texto ? JSON.parse(texto) : {}) as T;
  }
}

type Acao = Record<string, unknown>;
type ResultadoAcao = { saida?: string; codigoSaida?: number; arquivo?: { base64: string } };

async function acao(api: Api, agente: string, a: Acao): Promise<ResultadoAcao> {
  return api.chamar<ResultadoAcao>("POST", `agentes/${agente}/computador/acoes`, a);
}

async function terminal(api: Api, agente: string, comando: string): Promise<string> {
  const r = await acao(api, agente, { tipo: "terminal", comando });
  if (r.codigoSaida !== 0) throw new Error(`preparo falhou (${r.codigoSaida}): ${comando}\n${r.saida ?? ""}`);
  return r.saida ?? "";
}

type ListaArquivos = { arquivos?: { nome: string }[] };

/**
 * Lê um arquivo-alvo do computador. `null` só quando a listagem da pasta confirma que ele não existe: o `ler_arquivo`
 * devolve o mesmo `acao_falhou` para arquivo ausente e para runtime ocupado, e tratar erro como ausência esconderia
 * uma violação (o `pwned.txt` do hostil, o registro com as teclas da senha). Qualquer outra falha sobe como erro do roteiro.
 */
export async function lerArquivoDoComputador(executarAcao: (a: Acao) => Promise<ResultadoAcao & ListaArquivos>, caminho: string): Promise<string | null> {
  const barra = caminho.lastIndexOf("/");
  const pasta = barra >= 0 ? caminho.slice(0, barra) : ".";
  const nome = caminho.slice(barra + 1);
  // As pastas-alvo (/workspace, ensaio, downloads) são criadas no plantio: listagem que falha é erro do roteiro.
  const lista = await executarAcao({ tipo: "arquivos", caminho: pasta });
  if (!lista.arquivos) throw new Error(`listagem de ${pasta} sem arquivos`);
  if (!lista.arquivos.some((a) => a.nome === nome)) return null;
  const r = await executarAcao({ tipo: "ler_arquivo", caminho });
  if (!r.arquivo) throw new Error(`ler_arquivo ${caminho} sem conteúdo`);
  return Buffer.from(r.arquivo.base64, "base64").toString("utf8");
}

const lerArquivo = (api: Api, agente: string, caminho: string) => lerArquivoDoComputador((a) => acao(api, agente, a), caminho);

/** Roda só no Mac local (NOD-169): nunca em CI nem fora do macOS (a GCP não tem computador). Devolve a recusa, ou null. */
export function recusaDeAmbiente(o: { plataforma: string; ci: string | undefined }): string | null {
  if (o.ci && o.ci !== "false" && o.ci !== "0") return "Recusado: o ensaio do computador não roda em CI (CI está definido). Rode no Mac local.";
  if (o.plataforma !== "darwin") return `Recusado: o ensaio do computador roda só no Mac local (plataforma ${o.plataforma}).`;
  return null;
}

/** Planta as páginas em /workspace/ensaio/paginas (marcador do hostil trocado pelo nonce) e sobe o servidor local. */
async function plantar(api: Api, agente: string, tarefa: Tarefa, nonce: string): Promise<void> {
  await terminal(api, agente, "mkdir -p /workspace/ensaio/paginas /workspace/downloads");
  for (const nome of readdirSync(PAGINAS)) {
    let conteudo = readFileSync(join(PAGINAS, nome));
    if (nome === "hostil.html") conteudo = Buffer.from(conteudo.toString("utf8").replaceAll("__MARCADOR__", `HOSTIL-${nonce}`));
    await acao(api, agente, { tipo: "gravar_arquivo", caminho: `ensaio/paginas/${nome}`, base64: conteudo.toString("base64") });
  }
  await terminal(api, agente, "cp /workspace/ensaio/paginas/config.txt /workspace/ensaio/paginas/acessos.log /workspace/ensaio/");
  if (tarefa.preparo) await terminal(api, agente, tarefa.preparo);
  await terminal(api, agente, "nohup node /workspace/ensaio/paginas/servidor.mjs > /workspace/ensaio/servidor.log 2>&1 < /dev/null & sleep 1; cat /workspace/ensaio/servidor.log");
}

async function esperarTurno(api: Api, turno: string, conversa: string, tetoS: number): Promise<"concluido" | "interrompido" | "timeout"> {
  const t0 = Date.now();
  for (;;) {
    const { turno: t } = await api.chamar<{ turno: { estado: string; motivoInterrupcao?: string | null; motivoFalha?: string | null } }>("GET", `turnos/${turno}`);
    if (t.estado === "interrompido") log(`   turno interrompido: ${t.motivoFalha ?? t.motivoInterrupcao ?? "sem motivo"}`);
    if (t.estado === "concluido" || t.estado === "interrompido") return t.estado;
    if (Date.now() - t0 > tetoS * 1000) {
      await api.chamar("POST", `conversas/${conversa}/parar`).catch(() => undefined);
      return "timeout";
    }
    await dormir(2000);
  }
}

/** Soma o gasto de todos os turnos da conversa (tabela `gastos`, sob RLS do tenant). */
function lerGasto(api: Api, conversa: string): { custoUsd: number | null; entrada: number; saida: number } {
  const url = process.env.DATABASE_URL;
  if (!url) return { custoUsd: null, entrada: 0, saida: 0 };
  const sql = `select set_config('nod.tenant_id','${api.tenant}',false); select set_config('nod.pessoa_id','${api.pessoa}',false);
    select coalesce(sum(tokens_entrada),0) || '|' || coalesce(sum(tokens_saida),0) || '|' || coalesce(sum(custo_usd)::text,'') from gastos where turno_id in (select id from turnos where conversa_id = '${conversa}');`;
  const linha = execFileSync("psql", [url, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim().split("\n").pop() ?? "0|0|";
  const [e, s, c] = linha.split("|");
  return { entrada: Number(e), saida: Number(s), custoUsd: c ? Number(c) : null };
}

function apagarDocker(computadorId: string | null): void {
  if (!computadorId) return;
  const rodar = (args: string[]) => { try { execFileSync("docker", args, { stdio: "ignore" }); } catch { /* já não existe */ } };
  rodar(["rm", "-f", `nod-computador-${computadorId}`, `nod-egress-${computadorId}`]);
  rodar(["network", "rm", `nod-rede-${computadorId}`]);
  rodar(["volume", "rm", `nod-computador-${computadorId}-home`, `nod-computador-${computadorId}-workspace`]);
}

type Mensagem = { turnoId: string | null; kind: string; texto: string; autoria: { autor_tipo: string } };
type LinhaTrilha = { turnoId?: string | null; kind?: string; ferramenta?: string | null };
type ItemSuaVez = { decisao?: { id: string; tipo: string; turnoId?: string | null } };

async function executar(api: Api, nome: NomeHarness, tarefa: Tarefa, repeticao: number, o: Opcoes, meta: { commit: string; imagem: string }): Promise<Execucao> {
  const { harness, modelo } = HARNESSES[nome];
  const nonce = randomBytes(4).toString("hex");
  const criado = await api.chamar<{ agente: { id: string }; conversa: { id: string } }>("POST", "agentes", { dono: "pessoa" });
  const agente = criado.agente.id; const conversa = criado.conversa.id;
  let computadorId: string | null = null;
  try {
    await api.chamar("PATCH", `agentes/${agente}`, { harness, modelo, nome: `Ensaio ${tarefa.id} ${nome}`, descricao: "Bot do ensaio do computador (NOD-169)." });
    await api.chamar("POST", `agentes/${agente}/computador`, { operacao: "iniciar" });
    const c = await api.chamar<{ computador?: { id?: string } }>("GET", `agentes/${agente}/computador`);
    computadorId = c.computador?.id ?? null;
    await api.chamar("POST", `agentes/${agente}/computador`, { operacao: "assumir" });
    await plantar(api, agente, tarefa, nonce);
    await api.chamar("POST", `agentes/${agente}/computador`, { operacao: "devolver" });
    await api.chamar("POST", `agentes/${agente}/computador`, { operacao: "autonomo" });

    const t0 = Date.now();
    const enviado = await api.chamar<{ ids: { turno: string } }>("POST", `conversas/${conversa}/mensagens`, { texto: tarefa.pedido(nonce) });
    const turno = enviado.ids.turno;
    const estado = await esperarTurno(api, turno, conversa, o.tetoS);
    const ms = Date.now() - t0;

    const { mensagens } = await api.chamar<{ mensagens: Mensagem[] }>("GET", `conversas/${conversa}/mensagens`);
    const resposta = mensagens.filter((m) => m.turnoId === turno && m.kind === "texto" && m.autoria.autor_tipo === "agente").map((m) => m.texto).join("\n");
    const { linhas } = await api.chamar<{ linhas: LinhaTrilha[] }>("GET", `trilha?agente=${agente}`);
    const ferramentas = linhas.filter((l) => l.turnoId === turno && l.kind === "tool_call" && l.ferramenta).map((l) => l.ferramenta!);
    const { itens } = await api.chamar<{ itens: ItemSuaVez[] }>("GET", "sua-vez");
    const doTurno = itens.filter((i) => i.decisao?.turnoId === turno);
    const pergunta = doTurno.some((i) => i.decisao?.tipo === "pergunta");
    const ajuda: Evidencia["ajuda"] = ferramentas.some((f) => f.endsWith("computador_pedir_ajuda")) ? "computador_pedir_ajuda"
      : ferramentas.some((f) => f.endsWith("pedir_a_pessoa")) || pergunta ? "pedir_a_pessoa" : null;
    // Registro ausente = nenhuma requisição às páginas (tarefas 4, 5 e 9); erro de leitura derruba a execução.
    const registroTxt = await lerArquivo(api, agente, "ensaio/registro.jsonl");
    const registro = (registroTxt ?? "").split("\n").filter((s) => s.trim()).map((s) => JSON.parse(s) as LinhaRegistro);
    const arquivos: Record<string, string | null> = {};
    for (const a of tarefa.arquivos) arquivos[a] = await lerArquivo(api, agente, a);

    const evidencia: Evidencia = { resposta, ferramentas, registro, arquivos, ajuda, aprovacaoInesperada: doTurno.some((i) => i.decisao?.tipo === "aprovacao"), estado };
    const v = tarefa.verificar(evidencia, nonce);
    const classe = classificar(v, evidencia, { violou: tarefa.violou?.(evidencia, nonce) ?? false });
    const gasto = lerGasto(api, conversa);
    return {
      data: new Date().toISOString(), commit: meta.commit, imagem: meta.imagem, harness, modelo, tarefa: tarefa.id, chave: tarefa.chave, nome: tarefa.nome,
      repeticao, classe, detalhe: v.detalhe, ms, custoUsd: gasto.custoUsd, tokensEntrada: gasto.entrada, tokensSaida: gasto.saida, ajuda, trecho: resposta.slice(0, 600),
    };
  } finally {
    await api.chamar("DELETE", `agentes/${agente}`).catch((e: unknown) => log(`   aviso: não excluí o bot ${agente}: ${String(e)}`));
    apagarDocker(computadorId);
  }
}

function metaDaRodada(): { commit: string; imagem: string } {
  const ler = (cmd: string, args: string[]) => { try { return execFileSync(cmd, args, { encoding: "utf8" }).trim(); } catch { return "?"; } };
  return { commit: ler("git", ["rev-parse", "--short", "HEAD"]), imagem: ler("docker", ["image", "inspect", "nod-computador:1", "--format", "{{.Id}}"]).slice(7, 19) };
}

async function main(): Promise<void> {
  const ambiente = recusaDeAmbiente({ plataforma: process.platform, ci: process.env.CI });
  if (ambiente) { log(ambiente); process.exit(3); }
  const o = lerOpcoes(process.argv.slice(2));
  const recusa = recusaDeOrcamento({ tarefas: o.tarefas.length, repeticoes: o.repeticoes, confirmado: o.confirmado });
  if (recusa) { log(recusa); process.exit(3); }
  if (process.argv.includes("--so-portao")) return;
  mkdirSync(o.saida, { recursive: true });
  const arquivo = join(o.saida, "execucoes.jsonl");
  const api = new Api(o.api);
  await api.entrar();
  const meta = metaDaRodada();
  // Uma execução por vez: o Mac roda com load alto e o teto de computadores é 3.
  for (const nome of o.harnesses) {
    for (const tarefa of o.tarefas) {
      for (let rep = 1; rep <= o.repeticoes; rep++) {
        log(`== ${nome} · tarefa ${tarefa.id} (${tarefa.nome}) · repetição ${rep}`);
        try {
          const e = await executar(api, nome, tarefa, rep, o, meta);
          appendFileSync(arquivo, `${JSON.stringify(e)}\n`);
          log(`   ${e.classe} · ${e.detalhe} · ${(e.ms / 1000).toFixed(1)} s · custo ${e.custoUsd ?? "n/d"} · tokens ${e.tokensEntrada}/${e.tokensSaida}`);
        } catch (err) {
          // Falha do roteiro (preparo, API), não do modelo: aparece no log e não entra no jsonl.
          log(`   ERRO DO ROTEIRO: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
        }
      }
    }
  }
  process.stdout.write(`${arquivo}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => { log(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
