/**
 * Sonda do passo 0 da NOD-183 (gate, 2026-10-06). PAGA: usa a assinatura do Claude Code (dezenas de turnos curtos no
 * modelo padrão dos bots). Roda o `claude -p` com os argumentos REAIS do turno de texto (montarArgs) e um prompt de
 * delegação real (partesDoPromptSistema), trocando só como o prompt de sistema entra, e mede:
 *  1. cache: dois turnos seguidos do mesmo bot, em sessões novas, com a parte volátil diferente (outro remetente). Do
 *     2º turno sai cache lido / escrito / sem cache, no mesmo cálculo do cachePct do Raio-X;
 *  2. comportamento sem o prompt padrão do Claude Code, lado a lado: ToolSearch para achar uma ferramenta MCP, Edit/Read
 *     numa pasta autorizada, Bash sob o hook do terminal e resposta só em texto;
 *  3. o `--resume` com a forma do prompt diferente da do turno anterior (o app atualizado no meio da conversa) e se o
 *     prompt novo vale na sessão retomada.
 * Um MCP falso `nod` (sem rede) expõe o kit da delegação e um app `clima` com 20 ferramentas; o hook do terminal é um
 * script local que registra a chamada e deixa passar. Nada sai do Mac além das chamadas ao modelo.
 * NOD-185 (fases `snapshot`, `snapshotVolatil` e `snapshotHistorico`, fora do padrão): o `--system-prompt-snapshot
 * on × off` no `--resume` — se o 2º e o 3º turno da mesma sessão veem o prompt novo e quanto cacheiam; `on → off` é a
 * sessão gravada antes do app atualizado. A `snapshot` troca também o nome do bot (parte estável); a `snapshotVolatil`
 * muda só a volátil, como no uso real (é a dos números da ADR-080); a `snapshotHistorico` mede um 1º turno longo.
 * `--formas` filtra as fases `cache` e `comportamento` (esta, por padrão, roda append e system).
 * `--bot` é a pasta em ~/nod onde a fase `comportamento` cria a pasta do bot (padrão: Eng 1).
 * Uso: node scripts/sonda-system-prompt-texto.ts [--modelo sonnet] [--fases cache,comportamento,resume,snapshot,snapshotVolatil,snapshotHistorico] [--formas system,systemOff] [--variantes 1,3,5] [--bot "Eng 2"] [--bruto dir]
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { FerramentaPlano, PlanoTurno } from "../src/contracts/plano-turno.ts";
import { FERRAMENTAS_NOD } from "../src/contracts/ferramentas-nod.ts";
import { MODELO_AGENTE_PADRAO } from "../src/contracts/modelos.ts";
import { FERRAMENTAS_NOD_POR_MODO } from "../src/domain/plano-turno.ts";
import { partesDoPromptSistema, type EntradaPromptSistema } from "../src/domain/prompt-sistema.ts";
import { MARCADOR_PARTE_DINAMICA } from "../src/domain/marcador-prompt.ts";
import { NATIVAS_DE_ARQUIVO, NATIVAS_DO_TERMINAL } from "../src/domain/nativas.ts";
import { montarAmbiente } from "../src/domain/ambiente-executor.ts";
import { montarArgs, montarEnvDoFilho, settingsDoTerminal } from "../src/adapters/executor/drivers/claude-cli.ts";

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const modelo = arg("--modelo") ?? MODELO_AGENTE_PADRAO;
const fases = new Set((arg("--fases") ?? "cache,comportamento,resume").split(","));
const bruto = arg("--bruto");
if (bruto) mkdirSync(bruto, { recursive: true });
const escrever = (s: string) => process.stdout.write(`${s}\n`);
const home = homedir();
const env = montarEnvDoFilho(montarAmbiente("local", process.env), home, 600_000);
const dir = mkdtempSync(join(tmpdir(), "sonda-183-"));
const sal = randomUUID().slice(0, 8);

// --- MCP falso: o kit da delegação (schemas reais) e o app clima; só clima__PREVISAO_AMANHA responde algo útil.
const CODIGO_CLIMA = `CLIMA-${sal}`;
const ACOES = ["LISTAR", "BUSCAR", "VER", "CRIAR", "ATUALIZAR"];
const ferramentasClima = Array.from({ length: 20 }, (_, i) => (i === 7 ? "PREVISAO_AMANHA" : `${ACOES[i % ACOES.length]}_ESTACAO_${i}`)).map((acao) => ({
  name: `clima__${acao}`,
  description: acao === "PREVISAO_AMANHA" ? "Ferramenta do conector clima: previsão do tempo de amanhã para uma cidade. Devolve o resumo e um código de consulta." : `Ferramenta do conector clima: ${acao.toLowerCase().replace(/_/g, " ")}.`,
  inputSchema: { type: "object", properties: { cidade: { type: "string", description: "Nome da cidade." } }, additionalProperties: false },
}));
const kit = FERRAMENTAS_NOD_POR_MODO.delegacao;
const ferramentasMcp = [...kit.map((nome) => ({ name: nome, description: String(FERRAMENTAS_NOD[nome].description ?? nome), inputSchema: FERRAMENTAS_NOD[nome] })), ...ferramentasClima];
const mcpFalso = join(dir, "mcp-falso.mjs");
writeFileSync(mcpFalso, `import { createInterface } from "node:readline";
const tools = ${JSON.stringify(ferramentasMcp)};
const enviar = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
createInterface({ input: process.stdin }).on("line", (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === "initialize") enviar({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "nod", version: "0" } } });
  else if (m.method === "tools/list") enviar({ jsonrpc: "2.0", id: m.id, result: { tools } });
  else if (m.method === "tools/call") enviar({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: m.params?.name === "clima__PREVISAO_AMANHA" ? "Amanhã: sol entre nuvens, 29 °C. Código da consulta: ${CODIGO_CLIMA}" : "ok" }] } });
  else if (m.id !== undefined) enviar({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "sonda" } });
});
process.stdin.on("end", () => process.exit(0));
`);
const mcpJson = join(dir, "mcp.json");
writeFileSync(mcpJson, JSON.stringify({ mcpServers: { nod: { type: "stdio", command: process.execPath, args: [mcpFalso] } } }));

// --- Hook do terminal: registra cada nativa e deixa passar (o do nod pergunta ao servidor; aqui não há servidor).
const logHook = join(dir, "hook.log");
const hook = join(dir, "hook.mjs");
writeFileSync(hook, `import { appendFileSync } from "node:fs";
let s = ""; process.stdin.on("data", (b) => (s += b)); process.stdin.on("end", () => {
  let nome = "?"; try { nome = JSON.parse(s).tool_name; } catch {}
  appendFileSync(${JSON.stringify(logHook)}, nome + "\\n");
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "nod: sonda" } }));
});
`);
const settings = settingsDoTerminal({ comandoHook: `'${process.execPath}' '${hook}'` });

// --- O prompt: delegação real, com colegas, conectores, memória e o kit do turno.
const f = (nome: string, origem: FerramentaPlano["origem"] = "nod", conectorId: string | null = null): FerramentaPlano => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem, conectorId, readOnlyHint: false, tocaDadoPessoal: false, schema: {} });
const catalogo: FerramentaPlano[] = [...kit.map((n) => f(n)), ...ferramentasClima.map((t) => f(t.name, "conector", "con-clima"))];
const colegas = ["Ada", "Cecília", "Chico", "Gil", "Teodora", "Eng 2", "Eng 3"].map((nome, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, nome, titulo: "Colega do time", descricao: `Sou ${nome}, do time de engenharia do Marlon. Respondo em português do Brasil, de forma curta e direta.` }));
const conectores = [{ id: "con-clima", slug: "clima", nome: "Clima", habilitado: true, catalogo: ferramentasClima.map((t) => ({ nome: t.name.slice("clima__".length) })) }];
/** `volatilNaMensagem` (NOD-188): a volátil sai do prompt de sistema e vai no começo da mensagem do turno. */
type Forma = { nome: string; padraoMantido: boolean; args: (estavel: string, volatil: string) => string[]; volatilNaMensagem?: boolean };
const juntar = (...p: string[]) => p.join("\n");
const FORMAS: Record<string, Forma> = {
  append: { nome: "append sem marcador (hoje)", padraoMantido: true, args: (e, v) => ["--append-system-prompt", juntar(e, v)] },
  appendMarcador: { nome: "append com marcador", padraoMantido: true, args: (e, v) => ["--append-system-prompt", juntar(e, MARCADOR_PARTE_DINAMICA, v)] },
  system: { nome: "--system-prompt com marcador", padraoMantido: false, args: (e, v) => ["--system-prompt", juntar(e, MARCADOR_PARTE_DINAMICA, v)] },
  appendExcluir: { nome: "append + --exclude-dynamic-system-prompt-sections", padraoMantido: true, args: (e, v) => ["--append-system-prompt", juntar(e, v), "--exclude-dynamic-system-prompt-sections"] },
  appendMarcadorExcluir: { nome: "append com marcador + --exclude-dynamic…", padraoMantido: true, args: (e, v) => ["--append-system-prompt", juntar(e, MARCADOR_PARTE_DINAMICA, v), "--exclude-dynamic-system-prompt-sections"] },
  systemMaisAppend: { nome: "--system-prompt (estável) + --append-system-prompt (volátil)", padraoMantido: false, args: (e, v) => ["--system-prompt", e, "--append-system-prompt", v] },
  // NOD-185: o mesmo --system-prompt com marcador, sem o snapshot (o prompt é renderizado de novo a cada request).
  systemOff: { nome: "--system-prompt com marcador + snapshot off", padraoMantido: false, args: (e, v) => ["--system-prompt", juntar(e, MARCADOR_PARTE_DINAMICA, v), "--system-prompt-snapshot", "off"] },
  // NOD-188: o --system-prompt só com a estável; a volátil vai no começo da mensagem do turno (com e sem snapshot).
  systemMsg: { nome: "--system-prompt só estável + volátil na mensagem", padraoMantido: false, volatilNaMensagem: true, args: (e) => ["--system-prompt", e] },
  systemMsgOff: { nome: "--system-prompt só estável + volátil na mensagem + snapshot off", padraoMantido: false, volatilNaMensagem: true, args: (e) => ["--system-prompt", e, "--system-prompt-snapshot", "off"] },
  // Sem o marcador o CLI põe a parte dinâmica dele (cwd, que muda a cada turno) no prompt cacheável: o marcador fica.
  systemMarcadorMsg: { nome: "--system-prompt estável + marcador + volátil na mensagem", padraoMantido: false, volatilNaMensagem: true, args: (e) => ["--system-prompt", juntar(e, MARCADOR_PARTE_DINAMICA, "")] },
  systemMarcadorMsgOff: { nome: "--system-prompt estável + marcador + volátil na mensagem + snapshot off", padraoMantido: false, volatilNaMensagem: true, args: (e) => ["--system-prompt", juntar(e, MARCADOR_PARTE_DINAMICA, ""), "--system-prompt-snapshot", "off"] },
};
const volatilNoTurno = (volatil: string, texto: string) => `[Contexto deste turno]\n${volatil}\n[Fim do contexto deste turno]\n\n${texto}`;

type Caso = { nome?: string; remetente: string; nativas?: readonly string[]; pastaDoBot?: string; pastas?: { ativa: string; aprovadas: string[] }; terminal?: boolean; memoria?: string };
function prompt(c: Caso): { estavel: string; volatil: string } {
  const entrada: EntradaPromptSistema = {
    agente: { nome: c.nome ?? `Sonda ${sal}`, titulo: "Dev Sr", descricao: "Sou desenvolvedor sênior do time de engenharia do Marlon: implemento, reviso, testo e abro PRs.", modoAprovacao: "total" },
    memorias: c.memoria ? [{ id: "m1", agenteId: "a", texto: c.memoria, criadoEm: 1 } as never] : [],
    ferramentas: catalogo, nativas: c.nativas ?? [], ...(c.pastaDoBot ? { pastaDoBot: c.pastaDoBot } : {}),
    pessoaNome: "Marlon", modo: "delegacao", colegas, conectores: conectores as never,
    delegacao: { pessoaNome: "Marlon", remetenteNome: c.remetente },
    contextoConversa: `Contexto recente da conversa (JSON de dados): ${JSON.stringify({ historico: [{ autor: c.remetente, texto: `Pedido de ${c.remetente} para a sonda ${sal}.` }] })}`,
  };
  const p = partesDoPromptSistema(entrada);
  return { estavel: p.estavel.join("\n"), volatil: p.volatil.join("\n") };
}

type Saida = { ok: boolean; texto: string; ferramentas: string[]; lido: number; escrito: number; semCache: number; custo: number; ms: number; erro?: string };
async function turno(rotulo: string, forma: Forma, c: Caso, texto: string, opcoes: { sessao?: string; resume?: boolean; cwd?: string } = {}): Promise<Saida> {
  const p = prompt(c);
  const plano = {
    catalogo: { ferramentas: catalogo }, promptSistema: juntar(p.estavel, p.volatil), nativas: c.nativas ?? [], workspacePastas: c.pastas ?? null,
    entrada: { texto, modelo, sessaoCli: opcoes.resume ? opcoes.sessao : undefined },
  } as unknown as PlanoTurno;
  const terminal = c.terminal ? { settings, dirsExtras: [] } : undefined;
  const { args: base } = montarArgs({ plano, mcpJson, sessaoNova: () => opcoes.sessao ?? randomUUID(), terminal });
  const i = base.indexOf("--append-system-prompt");
  const args = [...base.slice(0, i), ...forma.args(p.estavel, p.volatil), ...base.slice(i + 2)];
  // Como o driver: a pasta do bot no terminal, a pasta ativa com projeto, senão um diretório temporário.
  const cwd = opcoes.cwd ?? (c.pastaDoBot ? join(home, "nod", c.pastaDoBot) : undefined) ?? c.pastas?.ativa ?? mkdtempSync(join(dir, "cwd-"));
  const t0 = Date.now();
  const proc = spawn("claude", args, { cwd, env: montarEnvDoFilho(env, home, 600_000, { claudeMdDasPastas: Boolean(terminal) }), stdio: ["pipe", "pipe", "pipe"] });
  proc.stdin.end(forma.volatilNaMensagem ? volatilNoTurno(p.volatil, texto) : texto);
  let out = "";
  let err = "";
  proc.stdout.on("data", (b: Buffer) => (out += b.toString("utf8")));
  proc.stderr.on("data", (b: Buffer) => (err += b.toString("utf8")));
  const codigo = await new Promise<number | null>((r) => proc.on("close", r));
  if (bruto) writeFileSync(join(bruto, `${rotulo}.jsonl`), out);
  type Bloco = { type?: string; name?: string };
  type Linha = { type?: string; subtype?: string; result?: string; total_cost_usd?: number; message?: { content?: Bloco[] }; usage?: Record<string, number> };
  const linhas = out.split("\n").flatMap((l) => { try { return [JSON.parse(l) as Linha]; } catch { return []; } });
  const ferramentas = linhas.filter((o) => o.type === "assistant").flatMap((o) => (o.message?.content ?? []).filter((b) => b.type === "tool_use").map((b) => String(b.name)));
  const r = linhas.find((o) => o.type === "result");
  const u = r?.usage ?? {};
  return { ok: codigo === 0 && r?.subtype === "success", texto: String(r?.result ?? ""), ferramentas, lido: u.cache_read_input_tokens ?? 0, escrito: u.cache_creation_input_tokens ?? 0, semCache: u.input_tokens ?? 0, custo: Number(r?.total_cost_usd ?? 0), ms: Date.now() - t0, ...(r ? {} : { erro: `exit ${codigo}: ${err.slice(0, 300)}` }) };
}
const pct = (s: Saida) => { const ctx = s.lido + s.escrito + s.semCache; return ctx > 0 ? Math.round((100 * s.lido) / ctx) : 0; };
const uso = (s: Saida) => `lido ${s.lido} · escrito ${s.escrito} · sem cache ${s.semCache} · cachePct ${pct(s)}% · US$ ${s.custo.toFixed(4)}${s.erro ? ` · ERRO ${s.erro}` : ""}`;
let custoTotal = 0;
const somar = (s: Saida) => ((custoTotal += s.custo), s);

escrever(`CLI: modelo ${modelo} · sal ${sal} · bruto ${bruto ?? "(não grava)"}`);

if (fases.has("cache")) {
  escrever("\n## 1. Cache do 2º turno (sessões novas; o volátil muda de remetente: Cecília → Chico)");
  escrever("| forma | prompt padrão | 1º turno | 2º turno |\n|---|---|---|---|");
  const formasCache = arg("--formas")?.split(",");
  for (const [chave, forma] of Object.entries(FORMAS).filter(([k]) => !formasCache || formasCache.includes(k))) {
    // O nome do bot leva a forma: o prefixo estável de uma forma não aquece o da seguinte.
    const nome = `Sonda ${sal} ${chave}`;
    const t1 = somar(await turno(`cache-${chave}-1`, forma, { nome, remetente: "Cecília" }, "Responda só: ok."));
    const t2 = somar(await turno(`cache-${chave}-2`, forma, { nome, remetente: "Chico" }, "Responda só: ok."));
    escrever(`| ${forma.nome} | ${forma.padraoMantido ? "mantido" : "substituído"} | ${uso(t1)} | ${uso(t2)} |`);
  }
}

if (fases.has("comportamento")) {
  escrever("\n## 2. Comportamento, lado a lado");
  const pastaBotRel = `${arg("--bot") ?? "Eng 1"}/.sonda-183-${sal}`;
  const pastaBot = join(home, "nod", pastaBotRel);
  for (const chave of arg("--formas")?.split(",") ?? ["append", "system"]) {
    const forma = FORMAS[chave]!;
    escrever(`\n### ${forma.nome}`);
    const a = somar(await turno(`comp-${chave}-toolsearch`, forma, { remetente: "Cecília" }, "Use a ferramenta do app clima para ver a previsão de amanhã em Recife e me diga o código da consulta que ela devolver."));
    escrever(`- ToolSearch: ${a.ferramentas.includes("ToolSearch") && a.ferramentas.includes("mcp__nod__clima__PREVISAO_AMANHA") && a.texto.includes(CODIGO_CLIMA) ? "OK" : "FALHOU"} · ferramentas ${a.ferramentas.join(" → ") || "(nenhuma)"} · ${uso(a)}\n  > ${a.texto.replace(/\n+/g, " ").slice(0, 300)}`);

    const proj = mkdtempSync(join(dir, "proj-"));
    writeFileSync(join(proj, "notas.txt"), "tarefa: sonda\nstatus: pendente\n");
    const b = somar(await turno(`comp-${chave}-edit`, forma, { remetente: "Cecília", nativas: NATIVAS_DE_ARQUIVO, pastas: { ativa: proj, aprovadas: [proj] } }, "No projeto autorizado, leia o arquivo notas.txt e troque o status pendente por concluido. Depois diga o que mudou."));
    const notas = readFileSync(join(proj, "notas.txt"), "utf8");
    escrever(`- Edit/Read: ${/status: conclu[ií]do/.test(notas) && b.ferramentas.some((n) => n === "Read") && b.ferramentas.some((n) => n === "Edit" || n === "Write") ? "OK" : "FALHOU"} · ferramentas ${b.ferramentas.join(" → ") || "(nenhuma)"} · arquivo: ${JSON.stringify(notas)} · ${uso(b)}`);

    rmSync(pastaBot, { recursive: true, force: true });
    mkdirSync(pastaBot, { recursive: true });
    writeFileSync(logHook, "");
    const c = somar(await turno(`comp-${chave}-bash`, forma, { remetente: "Cecília", nativas: NATIVAS_DO_TERMINAL, pastaDoBot: pastaBotRel, terminal: true }, "Rode no terminal, na sua pasta, o comando: echo sonda-$((6*7)) > saida.txt && git --version. Depois me diga o conteúdo de saida.txt e a versão do git."));
    const saida = existsSync(join(pastaBot, "saida.txt")) ? readFileSync(join(pastaBot, "saida.txt"), "utf8").trim() : "(não existe)";
    const chamadasHook = readFileSync(logHook, "utf8").trim().split("\n").filter(Boolean);
    escrever(`- Bash sob o hook: ${saida === "sonda-42" && chamadasHook.includes("Bash") && c.texto.includes("sonda-42") ? "OK" : "FALHOU"} · ferramentas ${c.ferramentas.join(" → ") || "(nenhuma)"} · hook viu ${chamadasHook.join(", ") || "nada"} · saida.txt=${saida} · ${uso(c)}\n  > ${c.texto.replace(/\n+/g, " ").slice(0, 300)}`);
    rmSync(pastaBot, { recursive: true, force: true });

    const d = somar(await turno(`comp-${chave}-texto`, forma, { remetente: "Cecília" }, "Em uma frase curta: o que é um pull request?"));
    escrever(`- Só texto: ${d.ferramentas.length === 0 && d.texto.length < 400 && !/^\s*(\d+\.|#)/m.test(d.texto) ? "OK" : "FALHOU"} · ferramentas ${d.ferramentas.join(", ") || "(nenhuma)"} · ${d.texto.length} caracteres · ${uso(d)}\n  > ${d.texto.replace(/\n+/g, " ")}`);
  }
}

if (fases.has("resume")) {
  escrever("\n## 3. --resume com a forma trocada (o nome do bot muda no 2º turno: qual prompt vale?)");
  for (const [de, para] of [["append", "system"], ["system", "append"], ["append", "append"], ["system", "system"]] as const) {
    const sessao = randomUUID();
    const t1 = somar(await turno(`resume-${de}-${para}-1`, FORMAS[de]!, { nome: "Ana", remetente: "Cecília", memoria: "A palavra do dia é laranja." }, "Responda só: ok.", { sessao }));
    const t2 = somar(await turno(`resume-${de}-${para}-2`, FORMAS[para]!, { nome: "Bia", remetente: "Chico", memoria: "A palavra do dia é azul." }, "Qual é o seu nome e qual é a palavra do dia, segundo as suas instruções de sistema? Responda só os dois, separados por vírgula.", { sessao, resume: true }));
    escrever(`- ${de} → ${para}: 1º ${t1.ok ? "ok" : `ERRO ${t1.erro}`} · 2º ${t2.ok ? "ok" : `ERRO ${t2.erro}`} · resposta "${t2.texto.trim()}" · 2º turno: ${uso(t2)}`);
  }
}

if (fases.has("snapshot")) {
  escrever("\n## 4. --system-prompt-snapshot no --resume (NOD-185): 1º turno Ana/laranja, 2º e 3º Bia/azul na mesma sessão");
  escrever("| 1º → seguintes | 2º turno: resposta | 2º turno: uso | 3º turno: resposta | 3º turno: uso |\n|---|---|---|---|---|");
  const pergunta = "Qual é o seu nome e qual é a palavra do dia, segundo as suas instruções de sistema? Responda só os dois, separados por vírgula.";
  for (const [de, para] of [["system", "system"], ["systemOff", "systemOff"], ["system", "systemOff"]] as const) {
    const sessao = randomUUID();
    const nome = (n: string) => `${n} ${sal}`;
    const t1 = somar(await turno(`snap-${de}-${para}-1`, FORMAS[de]!, { nome: nome("Ana"), remetente: "Cecília", memoria: "A palavra do dia é laranja." }, "Responda só: ok.", { sessao }));
    const t2 = somar(await turno(`snap-${de}-${para}-2`, FORMAS[para]!, { nome: nome("Bia"), remetente: "Chico", memoria: "A palavra do dia é azul." }, pergunta, { sessao, resume: true }));
    const t3 = somar(await turno(`snap-${de}-${para}-3`, FORMAS[para]!, { nome: nome("Bia"), remetente: "Gil", memoria: "A palavra do dia é azul." }, `De novo: ${pergunta}`, { sessao, resume: true }));
    escrever(`| ${de} → ${para}${t1.ok ? "" : ` (1º ERRO ${t1.erro})`} | "${t2.texto.trim()}" | ${uso(t2)} | "${t3.texto.trim()}" | ${uso(t3)} |`);
  }
}

if (fases.has("snapshotVolatil")) {
  // Como no uso real: o bot é o mesmo (parte estável idêntica) e só a volátil muda — memória e remetente. Cada linha tem
  // um bot próprio, para o prefixo de uma não aquecer o da seguinte.
  escrever("\n## 5. --system-prompt-snapshot no --resume, só a parte volátil mudando (memória laranja → azul → verde)");
  escrever("| 1º → seguintes | 2º turno: resposta | 2º turno: uso | 3º turno: resposta | 3º turno: uso |\n|---|---|---|---|---|");
  const pergunta = "Qual é a palavra do dia, segundo as suas instruções de sistema? Responda só a palavra.";
  for (const [de, para] of [["system", "system"], ["systemOff", "systemOff"], ["system", "systemOff"]] as const) {
    const sessao = randomUUID();
    const nome = `Vera ${sal} ${de}-${para}`;
    const t1 = somar(await turno(`snapv-${de}-${para}-1`, FORMAS[de]!, { nome, remetente: "Cecília", memoria: "A palavra do dia é laranja." }, "Responda só: ok.", { sessao }));
    const t2 = somar(await turno(`snapv-${de}-${para}-2`, FORMAS[para]!, { nome, remetente: "Chico", memoria: "A palavra do dia é azul." }, pergunta, { sessao, resume: true }));
    const t3 = somar(await turno(`snapv-${de}-${para}-3`, FORMAS[para]!, { nome, remetente: "Gil", memoria: "A palavra do dia é verde." }, `De novo: ${pergunta}`, { sessao, resume: true }));
    escrever(`| ${de} → ${para}${t1.ok ? "" : ` (1º ERRO ${t1.erro})`} | "${t2.texto.trim()}" | ${uso(t2)} | "${t3.texto.trim()}" | ${uso(t3)} |`);
  }
}

if (fases.has("snapshotHistorico")) {
  // O preço do `off`: o histórico da conversa vem DEPOIS do prompt de sistema; se a volátil muda, o cache dele cai junto.
  // O 1º turno leva um texto longo (~15 mil tokens) para pesar como uma conversa comprida.
  // NOD-188 (gate de diagnóstico): além do controle (volátil variando no sistema, on e off), a volátil FIXA nos três
  // turnos (on e off: se o 2º turno passa de 60%, a causa é a volátil antes do histórico) e a volátil na mensagem do
  // turno (a candidata a correção). Com --bruto, o cache_creation/cache_read de cada turno fica no JSON.
  escrever("\n## 6. Histórico longo no --resume (1º turno com ~15 mil tokens)");
  escrever("| variante | 2º turno: resposta | 2º turno: uso | 3º turno: resposta | 3º turno: uso |\n|---|---|---|---|---|");
  const longo = Array.from({ length: 600 }, (_, i) => `Linha ${i} do relatório ${sal}: a estação ${i % 37} registrou ${(i * 7) % 101} mm de chuva e vento de ${(i * 13) % 61} km/h.`).join("\n");
  const pergunta = "Qual é a palavra do dia, segundo as suas memórias? Responda só a palavra.";
  const variando = [{ remetente: "Cecília", memoria: "A palavra do dia é laranja." }, { remetente: "Chico", memoria: "A palavra do dia é azul." }, { remetente: "Gil", memoria: "A palavra do dia é verde." }];
  const fixa = [variando[0]!, variando[0]!, variando[0]!];
  const variantes: [string, string, typeof variando][] = [
    ["system", "controle on, volátil variando", variando],
    ["systemOff", "controle off, volátil variando", variando],
    ["system", "volátil fixa, on", fixa],
    ["systemOff", "volátil fixa, off", fixa],
    ["systemMsg", "volátil na mensagem, on", variando],
    ["systemMsgOff", "volátil na mensagem, off", variando],
    ["systemMarcadorMsg", "marcador + volátil na mensagem, on", variando],
    ["systemMarcadorMsgOff", "marcador + volátil na mensagem, off", variando],
    // O CLI grava o cwd do launch como anexo `environment` do turno; o driver usa um diretório temporário novo por
    // turno. As variantes com "cwd fixo" mantêm o mesmo cwd na sessão inteira.
    ["system", "controle on, volátil variando, cwd fixo", variando],
    ["systemOff", "controle off, volátil variando, cwd fixo", variando],
    ["systemMarcadorMsgOff", "marcador + volátil na mensagem, off, cwd fixo", variando],
  ];
  const cwdFixo = (rotulo: string) => rotulo.endsWith("cwd fixo");
  const filtro = arg("--variantes")?.split(",").map(Number);
  for (const [i, [chave, rotulo, vol]] of variantes.entries()) {
    if (filtro && !filtro.includes(i + 1)) continue;
    const sessao = randomUUID();
    // Um bot por variante: o prefixo estável de uma não aquece o da seguinte.
    const nome = `Vera ${sal} hist-${i + 1}`;
    const forma = FORMAS[chave]!;
    const cwd = cwdFixo(rotulo) ? mkdtempSync(join(dir, "cwd-fixo-")) : undefined;
    const t1 = somar(await turno(`snaph-${i + 1}-${chave}-1`, forma, { nome, ...vol[0]! }, `Guarde este relatório para depois e responda só: ok.\n\n${longo}`, { sessao, cwd }));
    const t2 = somar(await turno(`snaph-${i + 1}-${chave}-2`, forma, { nome, ...vol[1]! }, pergunta, { sessao, resume: true, cwd }));
    const t3 = somar(await turno(`snaph-${i + 1}-${chave}-3`, forma, { nome, ...vol[2]! }, `De novo: ${pergunta}`, { sessao, resume: true, cwd }));
    // O 1º turno com ferramenta (o modelo às vezes "guarda" o relatório com lembrar) muda o que fica no cache: sai na linha.
    escrever(`| ${i + 1}. ${rotulo} (${chave})${t1.ok ? "" : ` (1º ERRO ${t1.erro})`}${t1.ferramentas.length ? ` [1º turno usou ${t1.ferramentas.join(", ")}]` : ""} | "${t2.texto.trim()}" | ${uso(t2)} | "${t3.texto.trim()}" | ${uso(t3)} |`);
  }
}

escrever(`\ncusto total da sonda: US$ ${custoTotal.toFixed(4)}`);
rmSync(dir, { recursive: true, force: true });
