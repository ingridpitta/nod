/**
 * Sonda do Codex com ferramentas (definido em 2026-10-05): o driver de verdade (`criarCodexCliDriver`: sonda,
 * negociação de config, argumentos, launcher) contra o Codex instalado, com um servidor MCP de prova no lugar do proxy.
 * PAGA: usa a assinatura do Codex (dois turnos curtos, centavos). Não sobe servidor nem toca em banco.
 *
 * Responde a duas perguntas que a suíte não tem como responder sem o CLI real:
 *  1. a chamada de uma ferramenta do nod CHEGA ao servidor (`tools/call`) e o resultado volta ao modelo?
 *  2. o que o modelo diz ter à mão além das ferramentas do nod? (o isolamento, visto de dentro)
 *
 * Origem: em 2026-10-05, em produção, nove turnos de um bot no Codex terminaram com zero chamadas de ferramenta. Com o
 * 0.147.0 a causa foi reproduzida (ver codex-comum.ts). Rode esta sonda quando o Codex mudar de versão.
 *
 * Este mesmo arquivo é o "proxy": o launcher do driver o importa e chama `main()`.
 * Uso: node scripts/sonda-codex-ferramentas.ts [--modelo gpt-5.6-sol] [--codex /caminho/do/codex]
 * (`--codex` quando o binário mora fora do PATH deste shell, por exemplo numa versão do nvm)
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { criarCodexCliDriver } from "../src/adapters/executor/drivers/codex-cli.ts";
import type { PlanoTurno } from "../src/contracts/plano-turno.ts";
import type { EventoStream } from "../src/contracts/turno.ts";

const AQUI = fileURLToPath(import.meta.url);
const FERRAMENTAS = [
  { name: "pedir_acesso", description: "Pede à pessoa acesso a um app. Abre um cartão de autorização na conversa.", inputSchema: { type: "object", properties: { app: { type: "string" } }, required: ["app"] } },
  { name: "listar_apps", description: "Lista os apps conectados.", inputSchema: { type: "object", properties: {} } },
];

/**
 * O servidor MCP de prova. O Codex o sobe com o ambiente filtrado, então o registro vai para um arquivo ao lado da
 * pasta do turno (o launcher mora em `<base>/codex-XXXX/proxy.mjs`), nunca por variável de ambiente.
 */
export async function main(): Promise<void> {
  const registro = join(dirname(dirname(process.argv[1] ?? AQUI)), "recebido.log");
  const responder = (id: unknown, result: unknown) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  for await (const linha of createInterface({ input: process.stdin })) {
    let m: { id?: unknown; method?: string; params?: { protocolVersion?: string; name?: string; arguments?: unknown } };
    try { m = JSON.parse(linha) as typeof m; } catch { continue; }
    appendFileSync(registro, `${JSON.stringify({ metodo: m.method, ferramenta: m.params?.name ?? null, argumentos: m.params?.arguments ?? null })}\n`);
    if (m.id === undefined) continue;
    if (m.method === "initialize") responder(m.id, { protocolVersion: m.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "nod", version: "sonda" } });
    else if (m.method === "ping") responder(m.id, {});
    else if (m.method === "tools/list") responder(m.id, { tools: FERRAMENTAS });
    else if (m.method === "tools/call") responder(m.id, { content: [{ type: "text", text: "cartao-aberto-7391" }] });
    else process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "método não suportado" } })}\n`);
  }
}

async function sondar(): Promise<void> {
  const opcao = (nome: string) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] ?? null : null; };
  const modelo = opcao("--modelo") ?? "gpt-5.6-sol";
  const codex = opcao("--codex");
  const base = mkdtempSync(join(tmpdir(), "nod-sonda-codex-"));
  const registro = join(base, "recebido.log");
  // Só o ambiente de que o Codex precisa para achar a si mesmo e a conta; o driver ainda filtra as chaves da OpenAI.
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string" && ["PATH", "HOME", "USER", "LANG", "TMPDIR", "CODEX_HOME"].includes(e[0])));
  // O `codex` do npm é um script de Node: a pasta dele entra no PATH para o `env node` achar um.
  if (codex) env.PATH = `${dirname(codex)}:${env.PATH ?? ""}`;
  const instancia = await criarCodexCliDriver({ urlNod: "http://127.0.0.1:9", proxyPath: AQUI }).create({ env, cwdBase: base, bins: codex ? { "codex-cli": codex } : undefined });

  const inventario = await instancia.sondar();
  process.stdout.write(`codex: ${JSON.stringify(inventario)}\n`);
  if (inventario.estado !== "pronto") {
    process.stdout.write("O Codex não está pronto nesta máquina: nada foi medido.\n");
    process.exitCode = 2;
    return;
  }

  const plano = (texto: string) =>
    ({
      workspacePastas: null,
      modoTurno: "conversa",
      tokenDeTurno: "sonda",
      promptSistema: "Você é um assistente de teste do nod. Responda curto, em português.",
      entrada: { modelo, texto },
      catalogo: { ferramentas: FERRAMENTAS.map((f) => ({ nome: f.name })) },
      politicaExecucao: { prazoMs: 120_000 },
    }) as unknown as PlanoTurno;

  async function turno(rotulo: string, texto: string): Promise<{ eventos: EventoStream[]; texto: string; desfecho: string; erroCru: string | null }> {
    const eventos: EventoStream[] = [];
    const r = await instancia.adapter(plano(texto)).rodarTurno({ sinal: async () => {}, evento: (e) => { eventos.push(e); }, delta: () => {} });
    process.stdout.write(`\n== ${rotulo}\ndesfecho: ${r.desfecho}${r.motivoFalha ? ` (${r.motivoFalha})` : ""}${r.motivoInterrupcao ? ` (${r.motivoInterrupcao})` : ""}\n`);
    for (const e of eventos) {
      if (e.tipo === "tool_use") process.stdout.write(`  chamou ${e.nome} ${JSON.stringify(e.input)}\n`);
      if (e.tipo === "tool_result") process.stdout.write(`  resultado: ${e.isError ? `ERRO ${e.texto}` : "ok"}\n`);
    }
    process.stdout.write(`fala: ${r.texto.replace(/\s+/g, " ").slice(0, 600)}\n`);
    if (r.erroCru) process.stdout.write(`erro cru: ${r.erroCru}\n`);
    return { eventos, texto: r.texto, desfecho: r.desfecho, erroCru: r.erroCru ?? null };
  }

  const chamada = await turno("1. a ferramenta do nod chega ao servidor?", "Chame a ferramenta pedir_acesso do servidor nod com app igual a gmail e diga, em uma frase, exatamente o que ela devolveu.");
  const recebido = existsSync(registro) ? readFileSync(registro, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { metodo: string; ferramenta: string | null }) : [];
  const chegou = recebido.some((l) => l.metodo === "tools/call" && l.ferramenta === "pedir_acesso");
  const voltou = chamada.texto.includes("cartao-aberto-7391");
  process.stdout.write(`servidor recebeu: ${recebido.map((l) => (l.ferramenta ? `${l.metodo}(${l.ferramenta})` : l.metodo)).join(", ") || "nada"}\n`);

  await turno("2. o que o modelo diz ter à mão?", "Sem chamar nenhuma ferramenta, liste o nome de TODAS as ferramentas e capacidades que você tem disponíveis agora (terminal, arquivos, web, navegador, código, MCP), uma por linha. Se não tiver uma categoria, escreva 'não tenho'.");

  process.stdout.write(`\nRESULTADO: tools/call chegou ao servidor = ${chegou}; o resultado voltou ao modelo = ${voltou}\n`);
  await instancia.dispose();
  if (!chegou || !voltou) process.exitCode = 1;
}

// Só quando é o script chamado: o launcher do driver importa este arquivo e chama `main()`.
if (process.argv[1] === AQUI) await sondar();
