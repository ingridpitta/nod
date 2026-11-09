import { describe, expect, it } from "vitest";
import { comandoDoHook, montarArgs, settingsDoTerminal, TETO_HOOK_S } from "../../../src/adapters/executor/drivers/claude-cli.ts";
import { AINDA_ESPERANDO, confirmarNoServidor, decidirHook, ESPERAS_RECONEXAO_MS, PAUSA_MINIMA_ENTRE_CONSULTAS_MS, SERVIDOR_REINICIANDO, type Confirmar } from "../../../src/adapters/executor/hook-nativas.ts";
import { NATIVAS_DO_TERMINAL } from "../../../src/domain/nativas.ts";
import { ESPERA_APROVACAO_NO_TURNO_MS } from "../../../src/shared/constantes.ts";
import { planoDeTeste } from "../../helpers/l5.ts";

const evento = (tool_name: string, tool_input: Record<string, unknown>) => ({ tool_name, tool_input, cwd: "/Users/m/nod/Ada" });

describe("hook do nod (ADR-052, revisto pela ADR-055)", () => {
  const pedidos: Parameters<Confirmar>[0][] = [];
  const confirmar: Confirmar = async (p) => {
    pedidos.push(p);
    return { permitir: true };
  };

  it("arquivo em qualquer lugar do Mac passa e é confirmado no servidor", async () => {
    const r = await decidirHook(evento("Write", { file_path: "/Users/m/Inhouse/acme/src/x.ts" }), confirmar);
    expect(r.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(pedidos.at(-1)).toEqual({ ferramenta: "Write", contamina: false });
  });

  it("Bash leva o comando ao servidor, e a negação dele volta ao modelo com o motivo", async () => {
    await decidirHook(evento("Bash", { command: "git push" }), confirmar);
    expect(pedidos.at(-1)).toEqual({ ferramenta: "Bash", contamina: false, comando: "git push" });
    const r = await decidirHook(evento("Bash", { command: "git push" }), async () => ({ permitir: false, motivo: "a pessoa não aprovou este comando" }));
    expect(r.hookSpecificOutput).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "nod: a pessoa não aprovou este comando" });
  });

  it("web é confirmada como contaminante; ferramenta MCP passa sem ir ao servidor; evento malformado nega", async () => {
    await decidirHook(evento("WebFetch", { url: "https://example.com" }), confirmar);
    expect(pedidos.at(-1)).toEqual({ ferramenta: "WebFetch", contamina: true });
    const antes = pedidos.length;
    expect((await decidirHook(evento("mcp__nod__publicar_artefato", { titulo: "x" }), confirmar)).hookSpecificOutput.permissionDecision).toBe("allow");
    expect(pedidos).toHaveLength(antes);
    expect((await decidirHook(null, confirmar)).hookSpecificOutput.permissionDecision).toBe("deny");
  });
});

describe("NOD-54: o hook guarda o original da gravação fora da pasta (ADR-134)", () => {
  const pastas = { pastaDoBot: "/Users/m/nod/Ada", home: "/Users/m" };
  const ok: Confirmar = async () => ({ permitir: true });
  const guardados: string[][] = [];
  const guardar = async (c: string[]) => { guardados.push(c); };

  it("Write/Edit fora da pasta, liberado: guarda o caminho antes; dentro da pasta, Read ou negado: não guarda", async () => {
    guardados.length = 0;
    await decidirHook(evento("Write", { file_path: "/Users/m/Documents/x.md" }), ok, pastas, undefined, guardar);
    await decidirHook(evento("Edit", { file_path: "notas.md" }), ok, pastas, undefined, guardar);
    await decidirHook(evento("Read", { file_path: "/Users/m/Documents/x.md" }), ok, pastas, undefined, guardar);
    const negado = await decidirHook(evento("Write", { file_path: "/Users/m/Documents/y.md" }), async () => ({ permitir: false, motivo: "não" }), pastas, undefined, guardar);
    expect(negado.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(guardados).toEqual([["/Users/m/Documents/x.md"]]);
  });

  it("turno da raiz do bot: gravar dentro de uma pasta de frente guarda (a foto da raiz pula as frentes; revisão 5, M1)", async () => {
    guardados.length = 0;
    await decidirHook(evento("Write", { file_path: "/Users/m/nod/Ada/task-abc123/a.ts" }), ok, pastas, undefined, guardar);
    await decidirHook(evento("Write", { file_path: "/Users/m/nod/Ada/task-abc123/b.ts" }), ok, { pastaDoBot: "/Users/m/nod/Ada/task-abc123", home: "/Users/m" }, undefined, guardar);
    expect(guardados).toEqual([["/Users/m/nod/Ada/task-abc123/a.ts"]]);
  });

  it("frente com maiúsculas trocadas (o disco do macOS não distingue): a raiz ainda guarda (revisão 7, M2)", async () => {
    guardados.length = 0;
    await decidirHook(evento("Write", { file_path: "/Users/m/nod/ADA/task-abc123/a.ts" }), ok, pastas, undefined, guardar);
    expect(guardados).toEqual([["/Users/m/nod/ADA/task-abc123/a.ts"]]);
  });

  it("apply_patch: guarda todos os arquivos do patch que estão fora; guardar que lança não nega", async () => {
    guardados.length = 0;
    const command = "*** Begin Patch\n*** Update File: /Users/m/a.md\n*** Add File: notas.md\n*** Add File: /Users/m/b.md\n*** End Patch";
    await decidirHook(evento("apply_patch", { command }), ok, pastas, undefined, guardar);
    expect(guardados).toEqual([["/Users/m/a.md", "/Users/m/b.md"]]);
    const r = await decidirHook(evento("Write", { file_path: "/Users/m/c.md" }), ok, pastas, undefined, async () => { throw new Error("disco"); });
    expect(r.hookSpecificOutput.permissionDecision).toBe("allow");
  });
});

/** Servidor falso: responde às rotas que o hook chama, em ordem, e guarda o que foi pedido. */
function servidor(respostas: Record<string, (unknown | ((corpo: unknown) => unknown))[]>) {
  const chamadas: { rota: string; corpo: unknown }[] = [];
  const chaves: string[] = [];
  const f: typeof fetch = async (url, init) => {
    const rota = String(url).replace("http://nod", "");
    const corpo = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
    chamadas.push({ rota, corpo });
    const chave = (init?.headers as Record<string, string> | undefined)?.["x-nod-idempotency-key"];
    if (chave !== undefined) chaves.push(chave);
    const fila = respostas[rota] ?? [];
    const proxima = fila.length > 1 ? fila.shift() : fila[0];
    const valor = typeof proxima === "function" ? (proxima as (c: unknown) => unknown)(corpo) : proxima;
    const status = typeof valor === "object" && valor !== null && "status" in valor ? Number((valor as { status: number }).status) : 200;
    return new Response(JSON.stringify(valor), { status });
  };
  return { f, chamadas, chaves };
}

describe("a espera pela aprovação no próprio turno (ADR-055)", () => {
  const cfg = { url: "http://nod/", token: "tok" };
  const AGUARDAR = "/api/interno/decisoes/d1/aguardar";

  it("leitura: uma chamada, liberada", async () => {
    const s = servidor({ "/api/interno/nativas": [{ ok: true }] });
    expect(await confirmarNoServidor(cfg, { fetch: s.f })({ ferramenta: "Bash", contamina: false, comando: "git status" })).toEqual({ permitir: true });
    expect(s.chamadas).toEqual([{ rota: "/api/interno/nativas", corpo: { ferramenta: "Bash", contamina: false, comando: "git status" } }]);
  });

  it("card aprovado: espera em fatias, confirma de novo e libera", async () => {
    const s = servidor({ "/api/interno/nativas": [{ aguardar: "d1" }, { ok: true }], [AGUARDAR]: [{ estado: "pendente" }, { estado: "decidida", itens: [{ desfecho: "executado" }] }] });
    expect(await confirmarNoServidor(cfg, { fetch: s.f, dormir: async () => undefined })({ ferramenta: "Bash", contamina: false, comando: "git push" })).toEqual({ permitir: true });
    expect(s.chamadas.map((c) => c.rota)).toEqual(["/api/interno/nativas", AGUARDAR, AGUARDAR, "/api/interno/nativas"]);
    // NOD-293 E7: a confirmação depois da aprovação é outra tentativa lógica — com a mesma chave o servidor devolveria
    // o `aguardar` guardado da primeira.
    expect(s.chaves).toHaveLength(2);
    expect(s.chaves[0]).not.toBe(s.chaves[1]);
  });

  it("card recusado: nega com o motivo", async () => {
    const s = servidor({ "/api/interno/nativas": [{ aguardar: "d1" }], [AGUARDAR]: [{ estado: "decidida", itens: [{ desfecho: "retirado_pela_pessoa" }] }] });
    expect(await confirmarNoServidor(cfg, { fetch: s.f })({ ferramenta: "Bash", contamina: false, comando: "rm -rf x" })).toEqual({ permitir: false, motivo: "a pessoa não aprovou este comando" });
  });

  it("a espera acaba sem resposta: nega dizendo que o pedido continua na conversa", async () => {
    let agora = 0;
    const s = servidor({ "/api/interno/nativas": [{ aguardar: "d1" }], [AGUARDAR]: [() => { agora += 60_000; return { estado: "pendente" }; }] });
    expect(await confirmarNoServidor(cfg, { fetch: s.f, agora: () => agora })({ ferramenta: "Bash", contamina: false, comando: "npm install" })).toEqual({ permitir: false, motivo: AINDA_ESPERANDO });
    expect(s.chamadas.filter((c) => c.rota === AGUARDAR).length).toBe(Math.ceil(ESPERA_APROVACAO_NO_TURNO_MS / 60_000));
  });

  it("ADR-089: `soltar: true` encerra a espera NA HORA com AINDA_ESPERANDO, sem consultar de novo", async () => {
    const s = servidor({ "/api/interno/nativas": [{ aguardar: "d1" }], [AGUARDAR]: [{ estado: "pendente", soltar: true }] });
    const pausas: number[] = [];
    const r = await confirmarNoServidor(cfg, { fetch: s.f, dormir: async (ms) => { pausas.push(ms); } })({ ferramenta: "Bash", contamina: false, comando: "npm install" });
    expect(r).toEqual({ permitir: false, motivo: AINDA_ESPERANDO });
    expect(s.chamadas.filter((c) => c.rota === AGUARDAR).length).toBe(1);
    expect(pausas).toEqual([]);
  });

  it("ADR-089: a rota que responde na hora não vira laço apertado — ao menos 1 s entre duas consultas", async () => {
    let agora = 0;
    const pausas: number[] = [];
    const s = servidor({ "/api/interno/nativas": [{ aguardar: "d1" }, { ok: true }], [AGUARDAR]: [() => { agora += 200; return { estado: "pendente" }; }, () => { agora += 200; return { estado: "pendente" }; }, { estado: "decidida", itens: [{ desfecho: "executado" }] }] });
    const r = await confirmarNoServidor(cfg, { fetch: s.f, agora: () => agora, dormir: async (ms) => { pausas.push(ms); agora += ms; } })({ ferramenta: "Bash", contamina: false, comando: "git push" });
    expect(r).toEqual({ permitir: true });
    expect(pausas).toEqual([PAUSA_MINIMA_ENTRE_CONSULTAS_MS - 200, PAUSA_MINIMA_ENTRE_CONSULTAS_MS - 200]);
  });

  it("o servidor recusa: a mensagem dele vai ao modelo", async () => {
    const s = servidor({ "/api/interno/nativas": [{ status: 403, codigo: "nao_permitido", mensagem: "ferramenta nativa fora do plano deste turno" }] });
    expect(await confirmarNoServidor(cfg, { fetch: s.f })({ ferramenta: "Bash", contamina: false, comando: "ls" })).toEqual({ permitir: false, motivo: "ferramenta nativa fora do plano deste turno" });
  });
});

/** O erro que o fetch do Node (undici) lança quando o servidor não aceita a conexão: `TypeError` com o código no `cause`. */
const erroDeRede = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${code}`), { code }) });

describe("NOD-293 E7: o servidor reiniciando no meio do turno", () => {
  const cfg = { url: "http://nod/", token: "tok" };
  /** fetch que falha com `falhas` (em ordem) e depois responde `{ ok: true }`; o relógio anda só no `dormir`. */
  function cenario(falhas: (Error | "ok")[], extra: { prazoMs?: number } = {}) {
    let agora = 0;
    const pausas: number[] = [];
    const chaves: string[] = [];
    let chamadas = 0;
    const f: typeof fetch = async (_url, init) => {
      chaves.push(String((init?.headers as Record<string, string> | undefined)?.["x-nod-idempotency-key"] ?? ""));
      const proxima = falhas[Math.min(chamadas, falhas.length - 1)];
      chamadas += 1;
      if (proxima instanceof Error) throw proxima;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const confirmar = confirmarNoServidor({ ...cfg, ...extra }, { fetch: f, agora: () => agora, dormir: async (ms) => { pausas.push(ms); agora += ms; } });
    return { confirmar, pausas, chaves, chamadas: () => chamadas };
  }

  it("recusa, recusa e depois responde: permitido, depois de esperar 1 s e 3 s", async () => {
    const c = cenario([erroDeRede("ECONNREFUSED"), erroDeRede("ECONNRESET"), "ok"]);
    expect(await c.confirmar({ ferramenta: "Bash", contamina: false, comando: "git status" })).toEqual({ permitir: true });
    expect(c.pausas).toEqual([1_000, 3_000]);
    expect(c.chamadas()).toBe(3);
    expect(new Set(c.chaves).size).toBe(1);
    expect(c.chaves[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("QA: o socket destruído no meio da resposta (UND_ERR_SOCKET do undici) também repete, com a mesma chave", async () => {
    const c = cenario([erroDeRede("UND_ERR_SOCKET"), "ok"]);
    expect(await c.confirmar({ ferramenta: "Bash", contamina: false, comando: "git status" })).toEqual({ permitir: true });
    expect(c.pausas).toEqual([1_000]);
    expect(new Set(c.chaves).size).toBe(1);
  });

  it("recusa contínua: tenta depois de 1, 3 e 5 s e nega dizendo que o servidor está reiniciando", async () => {
    const c = cenario([erroDeRede("ECONNREFUSED")]);
    expect(await c.confirmar({ ferramenta: "Bash", contamina: false, comando: "git status" })).toEqual({ permitir: false, motivo: SERVIDOR_REINICIANDO });
    expect(c.pausas).toEqual([...ESPERAS_RECONEXAO_MS]);
    expect(c.chamadas()).toBe(ESPERAS_RECONEXAO_MS.length + 1);
  });

  it("prazo curto: a espera que passaria do `prazoMs` não acontece, e a negação sai antes", async () => {
    const c = cenario([erroDeRede("ECONNREFUSED")], { prazoMs: 3_500 });
    expect(await c.confirmar({ ferramenta: "Bash", contamina: false, comando: "git status" })).toEqual({ permitir: false, motivo: SERVIDOR_REINICIANDO });
    expect(c.pausas).toEqual([1_000]);
    expect(c.chamadas()).toBe(2);
  });

  it("outro erro de rede não é repetido: segue a negação de antes (a falha sobe e o hook nega)", async () => {
    const c = cenario([erroDeRede("ENOTFOUND"), "ok"]);
    await expect(c.confirmar({ ferramenta: "Bash", contamina: false, comando: "git status" })).rejects.toThrow("fetch failed");
    expect(c.pausas).toEqual([]);
    expect(c.chamadas()).toBe(1);
  });
});

describe("args do turno com o kit do terminal (ADR-052, revisto pela ADR-055)", () => {
  const settings = settingsDoTerminal({ comandoHook: comandoDoHook({ nodePath: "/usr/bin/node", hookPath: "/app/Application Support/hook.mjs", config: "/tmp/t/hook.json" }) });
  const { args } = montarArgs({ plano: { ...planoDeTeste(), nativas: NATIVAS_DO_TERMINAL, pastaDoBot: "Ada" }, mcpJson: "/tmp/mcp.json", terminal: { settings, dirsExtras: ["/Users/m", "/Users/m/code/nod"] } });

  it("sem --restricted (ele tira Bash e WebFetch); --tools com a lista exata; o Mac da pessoa em --add-dir", () => {
    expect(args).not.toContain("--restricted");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("project");
    expect(args[args.indexOf("--tools") + 1]!.split(",")).toEqual([...NATIVAS_DO_TERMINAL, "ToolSearch"]);
    expect(args[args.indexOf("--allowedTools") + 1]!.split(",")).toEqual(expect.arrayContaining(["Bash", "WebFetch", "Write"]));
    expect(args.filter((a, i) => args[i - 1] === "--add-dir")).toEqual(["/Users/m", "/Users/m/code/nod"]);
  });

  it("--settings leva o hook do nod para cada nativa, SEM sandbox, com tempo para esperar a aprovação", () => {
    const s = JSON.parse(args[args.indexOf("--settings") + 1]!) as { hooks: { PreToolUse: { matcher: string; hooks: { command: string; timeout: number }[] }[] }; sandbox?: unknown };
    // Só as nativas: MCP passa pelo proxy (com "*", o hook negava publicar_artefato — medido ao vivo).
    expect(s.hooks.PreToolUse[0]?.matcher).toBe("Read|Edit|Write|Glob|Grep|NotebookEdit|Bash|Monitor|TaskStop|WebFetch|WebSearch|Skill|Agent|TaskCreate|TaskGet|TaskList|TaskUpdate");
    expect(s.hooks.PreToolUse[0]?.hooks[0]?.command).toBe("'/usr/bin/node' '/app/Application Support/hook.mjs' '/tmp/t/hook.json'");
    expect(s.sandbox).toBeUndefined();
    expect(s.hooks.PreToolUse[0]?.hooks[0]?.timeout).toBe(TETO_HOOK_S);
    expect(TETO_HOOK_S * 1000).toBeGreaterThan(ESPERA_APROVACAO_NO_TURNO_MS);
  });

  it("aspas simples no caminho não quebram o comando do hook", () => {
    expect(comandoDoHook({ nodePath: "/n", hookPath: "/a/it's/h.mjs", config: "/c", electronComoNode: true })).toBe("ELECTRON_RUN_AS_NODE=1 '/n' '/a/it'\\''s/h.mjs' '/c'");
  });

  it("ADA-11 (ADR-147): no Windows as nativas do terminal saem de --allowedTools (só o allow do hook libera) e seguem em --tools", () => {
    const win = montarArgs({ plano: { ...planoDeTeste(), nativas: NATIVAS_DO_TERMINAL, pastaDoBot: "Ada" }, mcpJson: "/tmp/mcp.json", terminal: { settings, dirsExtras: [] }, windows: true }).args;
    const aprovadas = win[win.indexOf("--allowedTools") + 1]!.split(",");
    for (const n of NATIVAS_DO_TERMINAL) expect(aprovadas).not.toContain(n);
    expect(aprovadas).toContain("ToolSearch");
    expect(win[win.indexOf("--tools") + 1]!.split(",")).toEqual([...NATIVAS_DO_TERMINAL, "ToolSearch"]);
    expect(win).toContain("--settings");
    // Sem o kit do terminal (nativas de arquivo com --restricted), o Windows não muda nada.
    const semKit = montarArgs({ plano: { ...planoDeTeste(), nativas: ["Read"], workspacePastas: { ativa: "C:\\w", aprovadas: ["C:\\w"] } }, mcpJson: "m", windows: true }).args;
    expect(semKit[semKit.indexOf("--allowedTools") + 1]!.split(",")).toContain("Read");
  });

  it("ADA-11 (ADR-147): no Windows o comando do hook vai com `/` para o Git Bash", () => {
    expect(comandoDoHook({ nodePath: "C:\\Program Files\\nodejs\\node.exe", hookPath: "C:\\U\\Bia's\\hook.mjs", config: "C:\\U\\AppData\\Local\\t\\hook.json", windows: true }))
      .toBe("'C:/Program Files/nodejs/node.exe' 'C:/U/Bia'\\''s/hook.mjs' 'C:/U/AppData/Local/t/hook.json'");
  });
});

/**
 * PR 6 dos modos de aprovação: o hook não nega mais sozinho o arquivo de credencial — manda ao servidor, que decide pelo
 * modo. E só deixa passar com a confirmação EXPLÍCITA (`credencial: "permitida"`): um servidor antigo responde `{ ok: true }`
 * ao Read (ignora o campo), e a credencial seria lida até no manual (revisão de engenharia do plano, item 12).
 */
describe("a credencial no hook novo × servidor novo e antigo (PR 6)", () => {
  const cfg = { url: "http://nod/", token: "tok" };
  const NATIVAS = "/api/interno/nativas";
  const AGUARDAR = "/api/interno/decisoes/d1/aguardar";
  const LER = evento("Read", { file_path: "/Users/m/.aws/config" });
  const decidir = (ev: unknown, s: ReturnType<typeof servidor>) => decidirHook(ev, confirmarNoServidor(cfg, { fetch: s.f, dormir: async () => undefined }));

  it("novo × novo, total: manda `credencial` (sem `arquivo`) e libera com a confirmação explícita", async () => {
    const s = servidor({ [NATIVAS]: [{ ok: true, credencial: "permitida" }] });
    const r = await decidir(LER, s);
    expect(r.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(s.chamadas).toEqual([{ rota: NATIVAS, corpo: { ferramenta: "Read", contamina: false, credencial: "/Users/m/.aws/config" } }]);
  });

  it("novo × novo, automático: espera o cartão (`aguardar`), e a segunda consulta confirma explicitamente", async () => {
    const s = servidor({ [NATIVAS]: [{ aguardar: "d1" }, { ok: true, credencial: "permitida" }], [AGUARDAR]: [{ estado: "pendente" }, { estado: "decidida", itens: [{ desfecho: "executado" }] }] });
    const r = await decidir(evento("Write", { file_path: "/Users/m/.ssh/config" }), s);
    expect(r.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(s.chamadas.map((c) => c.rota)).toEqual([NATIVAS, AGUARDAR, AGUARDAR, NATIVAS]);
    expect(s.chamadas[0]?.corpo).toEqual({ ferramenta: "Write", contamina: false, credencial: "/Users/m/.ssh/config" });
  });

  it("novo × novo, automático recusado: nega com o motivo do servidor", async () => {
    const s = servidor({ [NATIVAS]: [{ aguardar: "d1" }], [AGUARDAR]: [{ estado: "decidida", itens: [{ desfecho: "retirado_pela_pessoa" }] }] });
    expect((await decidir(LER, s)).hookSpecificOutput).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "nod: a pessoa não aprovou este comando" });
  });

  it("novo × novo, manual: o servidor nega (403) com a frase de sempre, e ela chega ao modelo", async () => {
    const frase = "arquivo de credencial (chaves, tokens, Keychain): o nod não abre; se a tarefa precisar, peça à pessoa";
    const s = servidor({ [NATIVAS]: [{ status: 403, codigo: "nao_permitido", mensagem: frase }] });
    expect((await decidir(LER, s)).hookSpecificOutput).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: `nod: ${frase}` });
  });

  it("novo × ANTIGO: o `{ ok: true }` cru do servidor revertido NÃO libera — nega com a frase de sempre, em toda nativa", async () => {
    for (const ev of [LER, evento("Write", { file_path: "/Users/m/.ssh/authorized_keys" }), evento("Glob", { pattern: "**/*.pem" }), evento("Grep", { pattern: "x", path: "/Users/m/.config/gh" })]) {
      const s = servidor({ [NATIVAS]: [{ ok: true }] });
      expect((await decidir(ev, s)).hookSpecificOutput, JSON.stringify(ev)).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "nod: arquivo de credencial (chaves, tokens, Keychain): o nod não abre; se a tarefa precisar, peça à pessoa" });
    }
    // Nem depois de um cartão aprovado: a segunda consulta também tem de vir explícita.
    const s = servidor({ [NATIVAS]: [{ aguardar: "d1" }, { ok: true }], [AGUARDAR]: [{ estado: "decidida", itens: [{ desfecho: "executado" }] }] });
    expect((await decidir(LER, s)).hookSpecificOutput.permissionDecision).toBe("deny");
    // Valor diferente de "permitida" também não serve.
    const t = servidor({ [NATIVAS]: [{ ok: true, credencial: true }] });
    expect((await decidir(LER, t)).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("o MCP da pessoa (Codex) que cita uma credencial vai com o pedido e a credencial; servidor antigo nega com a frase do MCP", async () => {
    const ev = evento("mcp__fs__read", { path: "~/.ssh/id_ed25519" });
    const novo = servidor({ [NATIVAS]: [{ ok: true, credencial: "permitida" }] });
    expect((await decidirHook(ev, confirmarNoServidor(cfg, { fetch: novo.f }), { mcpDaPessoa: true })).hookSpecificOutput.permissionDecision).toBe("allow");
    const corpo = novo.chamadas[0]?.corpo as { ferramenta: string; mcp: string; credencial: string };
    expect(corpo.ferramenta).toBe("mcp_da_pessoa");
    expect(corpo.credencial).toBe(corpo.mcp);
    const antigo = servidor({ [NATIVAS]: [{ ok: true }] });
    expect((await decidirHook(ev, confirmarNoServidor(cfg, { fetch: antigo.f }), { mcpDaPessoa: true })).hookSpecificOutput).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "nod: o pedido toca uma credencial (chaves, tokens, Keychain): o nod não manda; se a tarefa precisar, peça à pessoa" });
  });

  it("o arquivo comum não exige a confirmação da credencial (um `{ ok: true }` cru libera, como sempre)", async () => {
    const s = servidor({ [NATIVAS]: [{ ok: true }] });
    expect((await decidir(evento("Read", { file_path: "/Users/m/code/app/README.md" }), s)).hookSpecificOutput.permissionDecision).toBe("allow");
    expect(s.chamadas[0]?.corpo).toEqual({ ferramenta: "Read", contamina: false });
  });

  it("as cercas fixas continuam no hook, antes do servidor, em qualquer modo: git fora da pasta e ferramenta fora do kit", async () => {
    const s = servidor({ [NATIVAS]: [{ ok: true, credencial: "permitida" }] });
    const pastas = { pastaDoBot: "/Users/m/nod/Ada", home: "/Users/m" };
    const git = await decidirHook({ tool_name: "Bash", tool_input: { command: "git -C /Users/m/code/app checkout -b x" }, cwd: "/Users/m/nod/Ada" }, confirmarNoServidor(cfg, { fetch: s.f }), pastas);
    expect(git.hookSpecificOutput.permissionDecision).toBe("deny");
    expect((await decidir(evento("Task", {}), s)).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(s.chamadas).toEqual([]);
  });
});
