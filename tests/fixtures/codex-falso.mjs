import { spawn } from "node:child_process";
import { setInterval, setTimeout } from "node:timers"; // usos comentados: `esperar` (20 s), `dormirMs` e o app-server calado
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
const emit = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
if (args.includes("app-server")) await appServer();
// definido em 2026-10-09: TESTE_NOD_SEM_NODE imita o `#!/usr/bin/env node` do npm num PATH sem node (medido no macOS).
else if (args.includes("--version") && process.env.TESTE_NOD_SEM_NODE) { process.stderr.write("env: node: No such file or directory\n"); process.exit(127); }
// NOD-171: TESTE_NOD_VERSAO simula uma versão (acima ou abaixo do piso); sem ela, uma saída sem x.y.z.
else if (args.includes("--version")) process.stdout.write(process.env.TESTE_NOD_VERSAO ? `codex-cli ${process.env.TESTE_NOD_VERSAO}\n` : "codex-cli teste\n");
else if (args.includes("--help")) process.stdout.write("--json --ephemeral --ignore-user-config --ignore-rules --strict-config --sandbox --skip-git-repo-check\n");
// definido em 2026-10-09: TESTE_NOD_CONFIG_QUEBRADA imita o config.toml quebrado (medido com o Codex 0.147.0).
else if (args[0] === "login" && process.env.TESTE_NOD_CONFIG_QUEBRADA) { process.stderr.write("Error loading configuration: /casa/.codex/config.toml:1:9: string values must be quoted, expected literal string\n"); process.exit(1); }
else if (args[0] === "login") process.exitCode = process.env.TESTE_NOD_SEM_LOGIN ? 1 : 0;
else {
  // Como o Codex real (medido em 2026-10-05 com o 0.147.0): a config é validada ANTES de o prompt ser lido. Uma chave
  // desconhecida para em "unknown configuration field" (uma por vez), e o stdin vazio para em "No prompt provided".
  // TESTE_NOD_CHAVES_DESCONHECIDAS lista as chaves que "esta versão" não conhece; TESTE_NOD_NEGOCIACOES conta as rodadas.
  const config = args.filter((a, i) => args[i - 1] === "-c");
  const desconhecida = (process.env.TESTE_NOD_CHAVES_DESCONHECIDAS ?? "").split(",").filter(Boolean).find((chave) => {
    const campoMcp = /^mcp_servers\.nod\.(.+)$/.exec(chave)?.[1];
    return campoMcp ? config.some((c) => c.startsWith("mcp_servers=") && c.includes(` ${campoMcp} = `)) : config.some((c) => c.startsWith(`${chave}=`));
  });
  if (desconhecida) {
    process.stderr.write(`Error loading config.toml: unknown configuration field \`${desconhecida}\` in -c/--config override\n`);
    process.exit(1);
  }
  let prompt = "";
  for await (const p of process.stdin) prompt += p;
  if (prompt === "") {
    if (process.env.TESTE_NOD_NEGOCIACOES) appendFileSync(process.env.TESTE_NOD_NEGOCIACOES, "x");
    process.stderr.write("No prompt provided via stdin.\n");
    process.exit(1);
  }
  // O teste da conta (definido em 2026-10-05): `mcp_servers={}`, sem proxy. Responde a frase pedida, ou falha como uma
  // conta logada que não responde (TESTE_NOD_TESTE_FALHA).
  if (config.includes("mcp_servers={}")) {
    if (process.env.TESTE_NOD_REGISTRO) writeFileSync(process.env.TESTE_NOD_REGISTRO, JSON.stringify({ args, env: process.env, cwd: process.cwd(), arquivos: readdirSync(process.cwd()), prompt }));
    emit({ type: "thread.started", thread_id: "sessao-teste" });
    if (process.env.TESTE_NOD_TESTE_FALHA) emit({ type: "turn.failed", error: { message: "conta sem uso disponível" } });
    else {
      emit({ type: "item.completed", item: { type: "agent_message", text: "“Oi, Marcelo. Tudo pronto.”" } });
      emit({ type: "turn.completed", usage: { input_tokens: 3, output_tokens: 3 } });
    }
    process.exit(0);
  }
  const arquivo = join(process.cwd(), "proxy.mjs");
  const child = spawn(process.execPath, [arquivo], { stdio: ["pipe", "pipe", "inherit"] });
  let resposta = "";
  await new Promise((resolve, reject) => {
    // NOD-198: falha por EVENTO (o proxy saiu e fechou o stdout sem responder), não por relógio: o antigo prazo de 3 s estourava sob carga
    // só pelo spawn do node. Proxy que trava sem sair cai no prazo do próprio teste.
    child.on("close", () => { if (!resposta.includes("\n")) reject(new Error("proxy_sem_resposta")); }); // `close`: depois de drenar o stdout
    child.stdout.on("data", (v) => { resposta += v; if (resposta.includes("\n")) { child.stdin.end(); resolve(); } });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "teste", version: "1" } } }) + "\n");
  });
  if (!JSON.parse(resposta).result?.serverInfo) throw new Error("proxy_invalido");
  const registro = { args, env: process.env, cwd: process.cwd(), arquivos: readdirSync(process.cwd()), proxy: readFileSync(arquivo, "utf8"), modo: statSync(arquivo).mode & 0o777 };
  if (process.env.TESTE_NOD_REGISTRO) writeFileSync(process.env.TESTE_NOD_REGISTRO, JSON.stringify(registro));
  emit({ type: "thread.started", thread_id: "sessao-codex" });
  // "esperar" imita um turno que não acaba sozinho: o teste sempre o encerra por interromper()/SIGTERM. Os 20 s só
  // garantem que o processo não fica órfão se o teste morrer antes; nenhuma asserção depende deles.
  if (prompt === "esperar") await new Promise((r) => setTimeout(r, 20_000));
  else if (prompt === "falhar") emit({ type: "turn.failed", error: { message: "segredo que não deve escapar" } });
  else if (prompt === "aviso-e-ferramenta-cancelada") {
    // O que o 0.147.0 emitia com a config antiga do nod: um item `error` de aviso e a chamada MCP falhando.
    emit({ type: "item.completed", item: { id: "e1", type: "error", message: "Code Mode is unavailable because code-mode host is disabled." } });
    emit({ type: "item.started", item: { id: "t1", type: "mcp_tool_call", server: "nod", tool: "pedir_acesso", arguments: { app: "gmail" } } });
    emit({ type: "item.completed", item: { id: "t1", type: "mcp_tool_call", status: "failed", error: { message: "user cancelled MCP tool call" } } });
    emit({ type: "item.completed", item: { type: "agent_message", text: "A ferramenta está indisponível." } });
    emit({ type: "turn.completed", usage: { input_tokens: 5, output_tokens: 5 } });
  } else if (prompt === "morrer-sem-evento") {
    process.stderr.write("2026-10-05T14:46:55.670225Z ERROR codex_core: algo quebrou antes do primeiro evento\n");
    process.exit(1);
  }
  else if (prompt === "relatorio") {
    // Relatório longo, depois lembrar, depois "Anotado." — o turn.completed do Codex não traz texto.
    emit({ type: "item.completed", item: { type: "agent_message", text: "Vou consultar as tasks." } });
    emit({ type: "item.started", item: { id: "t1", type: "mcp_tool_call", server: "nod", tool: "consultar", arguments: {} } });
    emit({ type: "item.completed", item: { id: "t1", type: "mcp_tool_call", status: "completed" } });
    emit({ type: "item.completed", item: { type: "agent_message", text: `Relatório das tasks: ${"NOD-101 aberto há 3 dias, sem revisão; ".repeat(10)}fim.` } });
    emit({ type: "item.started", item: { id: "t2", type: "mcp_tool_call", server: "nod", tool: "lembrar", arguments: {} } });
    emit({ type: "item.completed", item: { id: "t2", type: "mcp_tool_call", status: "completed" } });
    emit({ type: "item.completed", item: { type: "agent_message", text: "Anotado." } });
    emit({ type: "turn.completed", usage: { input_tokens: 30, output_tokens: 120, cached_input_tokens: 4 } });
  } else {
    emit({ type: "item.started", item: { id: "t1", type: "mcp_tool_call", server: "nod", tool: "lembrar", arguments: {} } });
    emit({ type: "item.completed", item: { id: "t1", type: "mcp_tool_call", status: "completed" } });
    emit({ type: "item.completed", item: { type: "agent_message", text: "Resposta de teste." } });
    emit({ type: "turn.completed", usage: { input_tokens: 14, output_tokens: 6, cached_input_tokens: 4 } });
  }
}

/**
 * App-server falso (ADR-076): JSON-RPC por linha no stdio, no formato do protocolo v2 que o laço de voz espera.
 * - initialize / thread/start respondem; thread/start guarda os parâmetros no registro.
 * - turn/start responde {turn:{id}} e fala "Entendi: <texto>." em três deltas; no primeiro turno, antes de falar, pede
 *   uma aprovação de comando (item/commandExecution/requestApproval) e só segue com a resposta (que vai ao registro).
 * - "[[ferramenta]]" no texto: um item mcpToolCall do servidor nod antes da fala.
 * - "demorar": fala "Pensando" e espera turn/steer (responde a fala nova e conclui) ou turn/interrupt (conclui interrompido).
 * - O pedido de resumo do fim responde "Resumo da ligação: N turno(s)." (N = turnos antes do resumo).
 * - "[[mudo]]" no texto (NOD-167): abre o turno e não fala nada até o turn/interrupt (conclui interrompido).
 * - "[[lento]]" no texto (NOD-167): a resposta do turn/start só sai quando o teste abre o portão (o turno fica
 *   "iniciando" no laço até lá).
 * - "[[conclui-antes]]" no texto (revisão NOD-167): quando o teste abre o portão, o turno conclui sem fala e só então
 *   chega a resposta do turn/start (a ordem que o app-server real pode entregar num turno curto).
 * - Portão (NOD-198): o arquivo em TESTE_NOD_PORTAO. O fake espera ele EXISTIR (fs.watch na pasta, olhando antes),
 *   sem relógio: antes eram 300 ms contra os 50 ms do teste, e sob carga o interromper chegava depois da resposta.
 * - model/list (NOD-167) devolve o Luna e um modelo de chat, com os esforços aceitos; uma notificação que o laço não
 *   conhece (`account/rateLimits/updated`) sai no primeiro turno.
 * - "[[chat-steer]]" no texto (chat do Codex, ADR-083 §6): fala "Começando.", chama `consultar`, que só termina com um
 *   turn/steer (ou turn/interrupt); com o steer, fala "Recebi: <texto do steer>", chama `lembrar` e fecha com "Terminei.".
 * - TESTE_NOD_RECUSAR_TURNO=N (X2, revisão do épico #188): o N-ésimo turn/start responde erro (o turno não abre);
 *   TESTE_NOD_RECUSA_MENSAGEM (NOD-293, B7) troca o texto do erro ("turno recusado" sem ela).
 * - stdin fechado: grava o registro (TESTE_NOD_REGISTRO) e sai 0.
 */
async function appServer() {
  // NOD-167: um Codex antigo, sem o subcomando (o clap recusa com 2, como qualquer subcomando desconhecido).
  if (process.env.TESTE_NOD_SEM_APP_SERVER) {
    process.stderr.write("error: unrecognized subcommand 'app-server'\n");
    process.exit(2);
  }
  if (args.includes("--help")) {
    process.stdout.write("[experimental] Run the app server or related tooling.\n  --listen <URL>\n  --ignore-user-config\n");
    return;
  }
  if (process.env.TESTE_NOD_PID) writeFileSync(process.env.TESTE_NOD_PID, String(process.pid)); // NOD-209: ver account/read
  const registro = { args, env: process.env, cwd: process.cwd(), thread: null, turnos: [], steers: [], interrupcoes: 0, aprovacao: null };
  const gravar = () => { if (process.env.TESTE_NOD_REGISTRO) writeFileSync(process.env.TESTE_NOD_REGISTRO, JSON.stringify(registro)); };
  // ADR-103: com os MCPs da pessoa, o nod entra como `mcp_servers.nod={…}` (junto dos dela) em vez de trocar a tabela.
  const indiceMcp = args.findIndex((a) => a.startsWith("mcp_servers=") || a.startsWith("mcp_servers.nod="));
  const launcher = indiceMcp >= 0 ? /args = \["([^"]+)"\]/.exec(args[indiceMcp])?.[1] ?? null : null;
  // ADR-103: o hook PreToolUse de `-c hooks=…`, como o 0.147.0 (medido em 2026-10-14): só roda CONFIADO (config/batchWrite
  // grava o hash); permitir = stdout vazio; negar = JSON deny ou exit 2; falhou ou estourou = o comando roda (falha aberto).
  // TESTE_NOD_HOOK_NAO_CONFIA: a gravação responde ok e o hook continua não confiado.
  const argHooks = args.find((a) => a.startsWith("hooks="));
  const hook = argHooks ? { comando: JSON.parse(`"${/command="((?:[^"\\]|\\.)*)"/.exec(argHooks)?.[1] ?? ""}"`), timeoutS: Number(/timeout=(\d+)/.exec(argHooks)?.[1] ?? 600) } : null;
  const CHAVE_HOOK = "/<session-flags>/config.toml:pre_tool_use:0:0";
  let hookConfiado = false;
  registro.configEscritas = [];
  registro.comandos = [];
  /** Divide o comando como o Codex: aspas simples, sem shell. */
  const partesDoComando = (c) => [...c.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1].replace(/'\\''/g, "'") : m[2]));
  /** Roda o hook para uma ferramenta; true = o Codex roda a ferramenta. */
  const rodarHook = (threadId, turnId, tool_name, tool_input) => new Promise((resolve) => {
    if (!hook || !hookConfiado) return resolve(true);
    const [bin, ...resto] = partesDoComando(hook.comando);
    const child = spawn(bin, resto, { cwd: process.cwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let saida = "";
    let erro = "";
    child.stdout.on("data", (v) => { saida += v; });
    child.stderr.on("data", (v) => { erro += v; });
    child.on("close", (codigo) => {
      let status = "completed";
      let motivo = null;
      if (codigo === 2) { status = "blocked"; motivo = erro.trim(); }
      else if (codigo !== 0) status = "failed";
      else if (saida.trim() !== "") {
        try {
          const s = JSON.parse(saida).hookSpecificOutput ?? {};
          if (s.permissionDecision === "deny") { status = "blocked"; motivo = s.permissionDecisionReason ?? ""; }
          else if (s.updatedInput === undefined) status = "failed"; // o allow puro conta como falha, e a ferramenta segue
        } catch { status = "failed"; }
      }
      notificar("hook/completed", { threadId, turnId, run: { id: `pre-tool-use:0:${CHAVE_HOOK}:${tool_name}`, eventName: "preToolUse", status, entries: motivo ? [{ kind: "feedback", text: motivo }] : [] } });
      resolve(status !== "blocked");
    });
    child.stdin.end(JSON.stringify({ session_id: threadId, turn_id: turnId, cwd: process.cwd(), hook_event_name: "PreToolUse", model: "falso", permission_mode: "bypassPermissions", tool_name, tool_input, tool_use_id: `exec-${tool_name}` }));
  });
  // O launcher do proxy precisa existir, ser 0600 e responder ao initialize do MCP.
  const validacao = (async () => {
    if (!launcher) return { ok: false };
    const child = spawn(process.execPath, [launcher], { stdio: ["pipe", "pipe", "inherit"] });
    let resposta = "";
    await new Promise((resolve, reject) => {
      // NOD-198: como no `exec` acima, falha quando o proxy sai sem responder, sem o antigo prazo de 5 s.
      child.on("close", () => { if (!resposta.includes("\n")) reject(new Error("proxy_sem_resposta")); }); // `close`: depois de drenar o stdout
      child.stdout.on("data", (v) => { resposta += v; if (resposta.includes("\n")) { child.stdin.end(); resolve(); } });
      child.on("error", reject);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "teste", version: "1" } } }) + "\n");
    });
    return { ok: Boolean(JSON.parse(resposta).result?.serverInfo), modo: statSync(launcher).mode & 0o777, conteudo: readFileSync(launcher, "utf8") };
  })().catch(() => ({ ok: false }));

  let proximoTurno = 1;
  let ativo = null; // { id, aoSteer(texto), aoInterromper() }
  let turnosAntesDoResumo = 0;
  let pediuAprovacao = false;
  let aoAprovacao = null;
  // Os `dormirMs(5)` abaixo só ESPAÇAM as notificações (deltas e item/started → item/completed), como o app-server real,
  // que não as manda no mesmo pacote. Nenhum teste depende deles para ordem: o que o teste manda no meio de uma fala ou
  // ferramenta é esperado por evento (demorar, [[mudo]], o `consultar` do [[chat-steer]], portão), não pelo relógio.
  const dormirMs = (ms) => new Promise((r) => setTimeout(r, ms));
  const portao = process.env.TESTE_NOD_PORTAO;
  /** Resolve quando o arquivo do portão existe. Olha antes de vigiar e de novo depois (o teste pode abrir no meio). */
  const portaoAberto = () => new Promise((r, falhar) => {
    if (!portao) return falhar(new Error("TESTE_NOD_PORTAO ausente: [[lento]]/[[conclui-antes]] precisam do portão"));
    if (existsSync(portao)) return r();
    const vigia = watch(dirname(portao), () => {
      if (!existsSync(portao)) return;
      vigia.close();
      r();
    });
    if (existsSync(portao)) {
      vigia.close();
      r();
    }
  });
  const responder = (id, result) => emit({ jsonrpc: "2.0", id, result });
  const notificar = (method, params) => emit({ jsonrpc: "2.0", method, params });
  let mensagensFaladas = 0;
  const falar = async (threadId, turnId, partes) => {
    const itemId = `msg_${turnId}_${++mensagensFaladas}`;
    notificar("item/started", { threadId, turnId, item: { type: "agentMessage", id: itemId, text: "" } });
    for (const delta of partes) { notificar("item/agentMessage/delta", { threadId, turnId, itemId, delta }); await dormirMs(5); } // só espaça os deltas (ver acima)
    notificar("item/completed", { threadId, turnId, item: { type: "agentMessage", id: itemId, text: partes.join("") } });
  };
  /** `terminaCom`: o evento que fecha a ferramenta "em curso"; sem ele, só espaça started → completed (ver acima). */
  const ferramenta = async (threadId, turnId, tool, terminaCom = null) => {
    const id = `mcp_${turnId}_${tool}`;
    notificar("item/started", { threadId, turnId, item: { type: "mcpToolCall", id, server: "nod", tool, status: "inProgress", arguments: {} } });
    await (terminaCom ?? dormirMs(5)); // o relógio só espaça; quem decide ordem passa `terminaCom`
    notificar("item/completed", { threadId, turnId, item: { type: "mcpToolCall", id, server: "nod", tool, status: "completed", arguments: {} } });
  };
  const concluir = (threadId, turnId, status) => {
    notificar("thread/tokenUsage/updated", { threadId, turnId, tokenUsage: { total: { inputTokens: 100 * proximoTurno, cachedInputTokens: 80, outputTokens: 10 * proximoTurno, totalTokens: 0 } } });
    notificar("turn/completed", { threadId, turn: { id: turnId, status, items: [] } });
    if (ativo?.id === turnId) ativo = null;
  };

  async function rodarTurno(threadId, turnId, texto) {
    notificar("turn/started", { threadId, turn: { id: turnId, status: "inProgress", items: [] } });
    if (texto.startsWith("[nod] A ligação terminou")) {
      await falar(threadId, turnId, ["Resumo da ligação: ", `${turnosAntesDoResumo} turno(s).`]);
      return concluir(threadId, turnId, "completed");
    }
    turnosAntesDoResumo++;
    if (turnosAntesDoResumo === 1) notificar("account/rateLimits/updated", { rateLimits: { primary: { usedPercent: 12, conteudo: "não logar" } } });
    if (texto.includes("[[mudo]]")) {
      // O interrupt pode ter chegado antes deste ponto (ativo ainda sem gancho): vale como já interrompido.
      const jaInterrompido = ativo?.id === turnId && ativo.interrompido === true;
      await new Promise((r) => { if (jaInterrompido) r(); else ativo = { id: turnId, aoSteer: null, aoInterromper: () => r() }; });
      return concluir(threadId, turnId, "interrupted");
    }
    if (!pediuAprovacao) {
      pediuAprovacao = true;
      const resposta = new Promise((r) => { aoAprovacao = r; });
      emit({ jsonrpc: "2.0", id: "srv_aprovar_1", method: "item/commandExecution/requestApproval", params: { threadId, turnId, itemId: "cmd_1", command: "rm -rf /" } });
      registro.aprovacao = await resposta;
      gravar();
    }
    if (texto.includes("[[ferramenta]]")) {
      notificar("item/started", { threadId, turnId, item: { type: "mcpToolCall", id: `mcp_${turnId}`, server: "nod", tool: "lembrar", status: "inProgress", arguments: {} } });
      await dormirMs(5); // só espaça started → completed; nenhum teste manda nada no meio (ver acima)
      notificar("item/completed", { threadId, turnId, item: { type: "mcpToolCall", id: `mcp_${turnId}`, server: "nod", tool: "lembrar", status: "completed", arguments: {} } });
    }
    if (texto.includes("[[chat-steer]]")) {
      const esperando = new Promise((r) => { ativo = { id: turnId, aoSteer: (t) => r({ steer: t }), aoInterromper: () => r({ interrompido: true }) }; });
      await falar(threadId, turnId, ["Começando."]);
      // Revisão NOD-198: o `consultar` em curso só termina com o steer (ou o interrupt), por EVENTO. Antes ele fechava
      // depois de `dormirMs(5)` e o fake só então esperava o steer: sob carga a resposta do turn/steer chegava depois do
      // fim do `consultar`, a fronteira seguinte era o próprio "Recebi:" e "Terminei." virava a resposta (X1 vermelho
      // no CI do PR #214, run 37895620607, tentativa 1). Assim o steer é sempre aceito com o `consultar` aberto.
      await ferramenta(threadId, turnId, "consultar", esperando);
      const desfecho = await esperando;
      if (desfecho.interrompido) return concluir(threadId, turnId, "interrupted");
      await falar(threadId, turnId, ["Recebi: ", desfecho.steer]);
      await ferramenta(threadId, turnId, "lembrar");
      await falar(threadId, turnId, ["Terminei."]);
      return concluir(threadId, turnId, "completed");
    }
    if (texto.includes("demorar")) {
      // Os ganchos entram ANTES da fala: o steer/interrupt pode chegar logo depois do primeiro delta.
      const esperando = new Promise((r) => { ativo = { id: turnId, aoSteer: (t) => r({ steer: t }), aoInterromper: () => r({ interrompido: true }) }; });
      await falar(threadId, turnId, ["Pensando"]);
      const desfecho = await esperando;
      if (desfecho.interrompido) return concluir(threadId, turnId, "interrupted");
      await falar(threadId, turnId, ["Entendi: ", desfecho.steer.replace(/^\[nod\][^\n]*\n/, ""), "."]);
      return concluir(threadId, turnId, "completed");
    }
    // ADR-103: "[[comando:X]]" e "[[patch:caminho]]" passam pelo hook antes de rodar (sem item quando ele barra, como o
    // 0.147.0); "[[web]]" é a busca hospedada, que o hook não vê.
    for (const [, command] of texto.matchAll(/\[\[comando:([^\]]+)\]\]/g)) {
      const roda = await rodarHook(threadId, turnId, "Bash", { command });
      registro.comandos.push({ command, roda }); gravar();
      if (!roda) continue;
      const id = `cmd_${turnId}_${registro.comandos.length}`;
      notificar("item/started", { threadId, turnId, item: { type: "commandExecution", id, command, status: "inProgress" } });
      notificar("item/completed", { threadId, turnId, item: { type: "commandExecution", id, command, status: "completed", exitCode: 0, aggregatedOutput: "ok\n" } });
    }
    for (const [, caminho] of texto.matchAll(/\[\[patch:([^\]]+)\]\]/g)) {
      const roda = await rodarHook(threadId, turnId, "apply_patch", { command: `*** Begin Patch\n*** Add File: ${caminho}\n+oi\n*** End Patch` });
      registro.comandos.push({ patch: caminho, roda }); gravar();
      if (!roda) continue;
      const id = `patch_${turnId}_${registro.comandos.length}`;
      notificar("item/started", { threadId, turnId, item: { type: "fileChange", id, changes: [{ path: caminho, kind: "add" }], status: "inProgress" } });
      notificar("item/completed", { threadId, turnId, item: { type: "fileChange", id, changes: [{ path: caminho, kind: "add" }], status: "completed" } });
    }
    if (texto.includes("[[web]]")) {
      notificar("item/started", { threadId, turnId, item: { type: "webSearch", id: `web_${turnId}`, query: "preço" } });
      notificar("item/completed", { threadId, turnId, item: { type: "webSearch", id: `web_${turnId}`, query: "preço" } });
    }
    const limpo = texto.replace(/^\[nod\][^\n]*\n/, "").replace("[[ferramenta]]", "").replace(/\[\[(comando|patch):[^\]]+\]\]/g, "").replace("[[web]]", "").trim();
    await falar(threadId, turnId, ["Entendi: ", limpo, "."]);
    concluir(threadId, turnId, "completed");
  }

  let resto = "";
  let fila = Promise.resolve();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (pedaco) => {
    resto += pedaco;
    let i;
    while ((i = resto.indexOf("\n")) >= 0) {
      const linha = resto.slice(0, i);
      resto = resto.slice(i + 1);
      if (linha.trim() === "") continue;
      const m = JSON.parse(linha);
      if (m.method === undefined && m.id === "srv_aprovar_1") { aoAprovacao?.(m.result ?? { erro: m.error }); continue; }
      switch (m.method) {
        case "initialize": responder(m.id, { userAgent: "codex-falso/0" }); break;
        case "initialized": break;
        case "thread/start":
          registro.thread = m.params; gravar();
          // NOD-198: a thread só abre depois da validação do launcher, como o app-server real, que sobe os servidores
          // MCP antes. Antes o resultado só era gravado no fim do stdin, e sob carga o driver encerrava o processo
          // antes do proxy responder: o teste lia `registro.launcher` vazio. Agora a ordem é por evento.
          void validacao.then((v) => {
            registro.launcher = v; gravar();
            responder(m.id, { thread: { id: "thr_falso" }, model: m.params.model });
          });
          break;
        // ADR-103: a continuação da thread (resume pelo id; "thr_inexistente" não existe nesta conta) e a cópia (fork).
        case "thread/resume":
        case "thread/fork":
          registro.thread = { ...m.params, metodo: m.method }; gravar();
          if (m.params.threadId === "thr_inexistente") { emit({ jsonrpc: "2.0", id: m.id, error: { code: -32600, message: "no rollout found" } }); break; }
          void validacao.then((v) => {
            registro.launcher = v; gravar();
            responder(m.id, { thread: { id: m.method === "thread/fork" ? "thr_copia" : m.params.threadId }, model: m.params.model });
          });
          break;
        // ADR-103: os hooks de `-c`, a gravação da confiança (e a limpeza de `[projects]`) e a leitura da config.
        case "hooks/list":
          responder(m.id, { data: [{ cwd: m.params.cwds?.[0] ?? "", hooks: hook ? [{ key: CHAVE_HOOK, eventName: "preToolUse", handlerType: "command", command: hook.comando, timeoutSec: hook.timeoutS, source: "sessionFlags", enabled: true, isManaged: false, currentHash: "sha256:falso", trustStatus: hookConfiado ? "trusted" : "untrusted" }] : [], warnings: [], errors: [] }] });
          break;
        case "config/batchWrite":
          registro.configEscritas.push(...(m.params.edits ?? [])); gravar();
          if (!process.env.TESTE_NOD_HOOK_NAO_CONFIA && (m.params.edits ?? []).some((e) => e.keyPath === `hooks.state.${JSON.stringify(CHAVE_HOOK)}.trusted_hash` && e.value === "sha256:falso")) hookConfiado = true;
          responder(m.id, { status: "ok", version: "sha256:v", filePath: "/casa/.codex/config.toml" });
          break;
        case "config/read":
          responder(m.id, { config: { projects: {} }, origins: {}, layers: null });
          break;
        case "model/list":
          registro.modelList = (registro.modelList ?? 0) + 1;
          responder(m.id, { data: [
            { id: "gpt-5.6-sol", model: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }, { reasoningEffort: "high" }], defaultReasoningEffort: "medium" },
            { id: "gpt-5.6-luna", model: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", isDefault: false, supportedReasoningEfforts: [{ reasoningEffort: "minimal" }, { reasoningEffort: "low" }, { reasoningEffort: "medium" }], defaultReasoningEffort: "low" },
          ], nextCursor: null });
          break;
        case "turn/start": {
          const texto = m.params.input?.[0]?.text ?? "";
          const imagens = (m.params.input ?? []).filter((i) => i.type === "localImage").map((i) => i.path);
          registro.turnos.push({ texto, effort: m.params.effort, ...(imagens.length ? { imagens } : {}) }); gravar();
          if (Number(process.env.TESTE_NOD_RECUSAR_TURNO) === registro.turnos.length) {
            emit({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: process.env.TESTE_NOD_RECUSA_MENSAGEM ?? "turno recusado" } });
            break;
          }
          const turnId = `turn_${proximoTurno++}`;
          const abrir = () => {
            responder(m.id, { turn: { id: turnId, status: "inProgress", items: [] } });
            ativo = { id: turnId, aoSteer: null, aoInterromper: null };
            fila = fila.then(() => rodarTurno(m.params.threadId, turnId, texto));
          };
          if (texto.includes("[[conclui-antes]]")) {
            void portaoAberto().then(() => {
              notificar("turn/completed", { threadId: m.params.threadId, turn: { id: turnId, status: "completed", items: [] } });
              responder(m.id, { turn: { id: turnId, status: "inProgress", items: [] } });
            });
            break;
          }
          if (texto.includes("[[lento]]")) void portaoAberto().then(abrir);
          else abrir();
          break;
        }
        case "turn/steer":
          if (!ativo || ativo.id !== m.params.expectedTurnId || !ativo.aoSteer) { emit({ jsonrpc: "2.0", id: m.id, error: { code: -32600, message: "sem turno ativo" } }); break; }
          registro.steers.push(m.params.input?.[0]?.text ?? ""); gravar();
          responder(m.id, { turnId: ativo.id });
          ativo.aoSteer(m.params.input?.[0]?.text ?? "");
          break;
        // NOD-209 (revisão do PR #266): a conta, como o Codex 0.162.1 responde. TESTE_NOD_CONTA_CODEX: um e-mail (a conta
        // ChatGPT), "chave" (login por chave de API, sem e-mail), "calado" (não responde nem sai) ou "erro" (responde erro).
        // TESTE_NOD_PID grava o pid, para o teste conferir que o processo morreu.
        case "account/read": {
          const conta = process.env.TESTE_NOD_CONTA_CODEX ?? "pessoa@exemplo.com";
          // Calado: nem o stdin fechado o tira do ar (um app-server travado); só o sinal de quem chamou.
          if (conta === "calado") { setInterval(() => undefined, 60_000); break; }
          if (conta === "erro") { emit({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "falhou" } }); break; }
          responder(m.id, { account: conta === "chave" ? { type: "apiKey" } : { type: "chatgpt", email: conta, planType: "pro" }, requiresOpenaiAuth: true });
          break;
        }
        // NOD-12: o uso do plano no fim da sessão, no formato medido no Codex 0.162.0 (sem os ids da conta).
        // TESTE_NOD_USO_CODEX: ausente = 42% da janela de 5 h e 18% da semana; "calado" = nunca responde (o driver segue
        // depois do prazo); "erro" = responde erro.
        case "account/rateLimits/read": {
          registro.usoLido = (registro.usoLido ?? 0) + 1; gravar();
          const modo = process.env.TESTE_NOD_USO_CODEX;
          if (modo === "calado") break;
          if (modo === "erro") { emit({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "falhou" } }); break; }
          const agoraS = Math.floor(Date.now() / 1000);
          const janela = (usedPercent, windowDurationMins, emS) => ({ usedPercent, windowDurationMins, resetsAt: agoraS + emS });
          const rateLimits = { limitId: "codex", limitName: null, primary: janela(42, 300, 3 * 3600), secondary: janela(18, 10080, 4 * 86400), credits: { hasCredits: false, unlimited: false, balance: "0" }, planType: "plus", rateLimitReachedType: null };
          responder(m.id, { ordinaryUsageAllowed: true, rateLimits, rateLimitsByLimitId: { codex: rateLimits } });
          break;
        }
        case "turn/interrupt":
          registro.interrupcoes++; gravar();
          responder(m.id, {});
          if (ativo?.id === m.params.turnId) {
            if (ativo.aoInterromper) ativo.aoInterromper();
            else ativo.interrompido = true;
          }
          break;
        default:
          if (m.id !== undefined) emit({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "método desconhecido" } });
      }
    }
  });
  await new Promise((r) => process.stdin.on("end", r));
  await fila;
  registro.launcher = await validacao;
  gravar();
}
