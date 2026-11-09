import { describe, expect, it } from "vitest";
import type { ModoTurno } from "../../../src/contracts/plano-turno.ts";
import { caminhosDoPatch, decidirNativa, motivoSemTerminal, NATIVA_MCP_DA_PESSOA, NATIVAS_DO_TERMINAL, NATIVAS_DO_TERMINAL_CODEX, NATIVAS_QUE_CONTAMINAM, nativasDoTurno } from "../../../src/domain/nativas.ts";
import { tocaChaveDoNod } from "../../../src/domain/comando.ts";
import { montarPromptSistema, terminalNoCodex } from "../../../src/domain/prompt-sistema.ts";

const pasta = { cwd: "/Users/ana/nod/Dev", pastaDoBot: "/Users/ana/nod/Dev", home: "/Users/ana" };

describe("ADR-103: o kit do terminal no Codex", () => {
  it("com o terminal, o Codex recebe as nativas dele; o MCP da pessoa só nos modos da dona", () => {
    const codex = (modo: ModoTurno) => nativasDoTurno({ modo, confianca: "confiavel", pastasAutorizadas: false, terminal: true, harness: "codex-cli" });
    for (const modo of ["conversa", "criacao", "rotina"] as ModoTurno[]) expect(codex(modo), modo).toEqual([...NATIVAS_DO_TERMINAL_CODEX, NATIVA_MCP_DA_PESSOA]);
    for (const modo of ["delegacao", "sala"] as ModoTurno[]) expect(codex(modo), modo).toEqual(NATIVAS_DO_TERMINAL_CODEX);
    expect(codex("peer")).toEqual([]);
    // O Claude segue com o kit dele; sem o terminal, o Codex não ganha nada além do que já tinha.
    expect(nativasDoTurno({ modo: "conversa", confianca: "confiavel", pastasAutorizadas: false, terminal: true, harness: "claude-cli" })).toEqual(NATIVAS_DO_TERMINAL);
    expect(nativasDoTurno({ modo: "conversa", confianca: "confiavel", pastasAutorizadas: false, terminal: false, harness: "codex-cli" })).toEqual([]);
  });

  it("o motivo de estar sem terminal vale para o Codex com a mesma regra (o Bash está no kit dos dois)", () => {
    expect(NATIVAS_DO_TERMINAL_CODEX).toContain("Bash");
    expect(motivoSemTerminal({ modo: "conversa", confianca: "confiavel", terminal: true })).toBeNull();
  });

  it("a busca do Codex e o MCP da pessoa contaminam o turno, como a web do Claude", () => {
    expect(NATIVAS_QUE_CONTAMINAM).toEqual(expect.arrayContaining(["web_search", NATIVA_MCP_DA_PESSOA, "WebFetch", "WebSearch"]));
  });

  it("caminhosDoPatch lê os arquivos do formato medido no 0.147.0 e os outros cabeçalhos da gramática", () => {
    const patch = "*** Begin Patch\n*** Add File: /Users/ana/nod/Dev/nota.txt\n+oi\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** Move to: src/b.ts\n*** Delete File: velho.md\n*** End Patch";
    expect(caminhosDoPatch(patch)).toEqual(["/Users/ana/nod/Dev/nota.txt", "src/a.ts", "src/b.ts", "velho.md"]);
    expect(caminhosDoPatch("echo oi")).toEqual([]);
  });

  it("apply_patch: dentro da pasta passa; fora vai ao servidor com o arquivo; credencial vai ao servidor (PR 6); patch sem arquivo é negado", () => {
    const patch = (caminho: string) => ({ command: `*** Begin Patch\n*** Add File: ${caminho}\n+oi\n*** End Patch` });
    expect(decidirNativa({ ferramenta: "apply_patch", entrada: patch("/Users/ana/nod/Dev/a.txt"), pasta })).toEqual({ permitir: true, motivo: "arquivos do Mac da pessoa", contamina: false });
    expect(decidirNativa({ ferramenta: "apply_patch", entrada: patch("/Users/ana/code/nod/x.ts"), pasta })).toMatchObject({ permitir: true, arquivo: "/Users/ana/code/nod/x.ts" });
    // Relativo ao cwd do turno: dentro da pasta do bot.
    expect(decidirNativa({ ferramenta: "apply_patch", entrada: patch("repo/a.ts"), pasta }).arquivo).toBeUndefined();
    expect(decidirNativa({ ferramenta: "apply_patch", entrada: patch("/Users/ana/.ssh/config"), pasta })).toMatchObject({ permitir: true, credencial: "/Users/ana/.ssh/config" });
    expect(decidirNativa({ ferramenta: "apply_patch", entrada: patch("/Users/ana/.ssh/config"), pasta }).arquivo).toBeUndefined();
    expect(decidirNativa({ ferramenta: "apply_patch", entrada: { command: "nada" }, pasta }).permitir).toBe(false);
    // Revisão do PR 6: todos os caminhos de credencial vão ao servidor — a chave do nod no segundo arquivo não se esconde
    // atrás da chave SSH do primeiro (o servidor só libera no total o que não é a chave do nod).
    const dois = { command: "*** Begin Patch\n*** Update File: /Users/ana/.ssh/config\n@@\n-a\n+b\n*** Add File: /Users/ana/.config/nod-motor/conexao.json\n+{}\n*** Add File: /Users/ana/nod/Dev/a.txt\n+oi\n*** End Patch" };
    const d = decidirNativa({ ferramenta: "apply_patch", entrada: dois, pasta });
    expect(d).toMatchObject({ permitir: true, credencial: "/Users/ana/.ssh/config /Users/ana/.config/nod-motor/conexao.json" });
    expect(tocaChaveDoNod(d.credencial ?? "")).toBe(true);
  });

  it("view_image lê (credencial vai ao servidor, PR 6); spawn_agent passa (cada ferramenta dele volta ao hook)", () => {
    expect(decidirNativa({ ferramenta: "view_image", entrada: { path: "/tmp/print.png" } })).toEqual({ permitir: true, motivo: "arquivos do Mac da pessoa", contamina: false });
    expect(decidirNativa({ ferramenta: "view_image", entrada: { path: "/Users/ana/.aws/credentials" } })).toMatchObject({ permitir: true, credencial: "/Users/ana/.aws/credentials" });
    expect(decidirNativa({ ferramenta: "spawn_agent", entrada: {} }).permitir).toBe(true);
  });

  it("MCP: o do nod segue com o proxy; o da pessoa vai ao servidor com o pedido (e contamina) só com a marca", () => {
    expect(decidirNativa({ ferramenta: "mcp__nod__lembrar", entrada: {}, mcpDaPessoa: true })).toMatchObject({ permitir: true, contamina: false });
    expect(decidirNativa({ ferramenta: "mcp__nod__lembrar", entrada: {}, mcpDaPessoa: true }).mcp).toBeUndefined();
    const linear = decidirNativa({ ferramenta: "mcp__linear__create_issue", entrada: { title: "Bug" }, mcpDaPessoa: true });
    expect(linear).toMatchObject({ permitir: true, contamina: true, mcp: 'linear: create_issue {"title":"Bug"}' });
    // Sem a marca (Claude, ou modo que não é da dona) nada muda: o proxy decide.
    expect(decidirNativa({ ferramenta: "mcp__linear__create_issue", entrada: {} }).mcp).toBeUndefined();
    // PR 6: argumento que toca credencial vai ao servidor como `credencial` (além do pedido), que decide pelo modo.
    const cred = decidirNativa({ ferramenta: "mcp__fs__read", entrada: { path: "~/.ssh/id_ed25519" }, mcpDaPessoa: true });
    expect(cred).toMatchObject({ permitir: true, contamina: true });
    expect(cred.credencial).toBe(cred.mcp);
    expect(cred.mcp).toContain("~/.ssh/id_ed25519");
    // Argumentos grandes chegam ao card cortados.
    expect(decidirNativa({ ferramenta: "mcp__x__y", entrada: { t: "a".repeat(5_000) }, mcpDaPessoa: true }).mcp!.length).toBeLessThan(2_100);
  });
});

describe("ADR-103: o prompt do terminal no Codex", () => {
  const base = { agente: { nome: "Dev 1", titulo: "", descricao: "" }, memorias: [], ferramentas: [], pessoaNome: "Marlon", modo: "conversa" as const, pastaDoBot: "Dev 1" };

  it("fala do shell e do apply_patch, não das ferramentas do Claude, com as mesmas regras", () => {
    const p = montarPromptSistema({ ...base, nativas: NATIVAS_DO_TERMINAL_CODEX, harness: "codex-cli" });
    expect(p).toContain("Você tem o terminal e os arquivos do Codex");
    expect(p).toContain("apply_patch");
    expect(p).toContain("~/nod/Dev 1");
    expect(p).toContain("AGENTS.md");
    expect(p).not.toContain("run_in_background");
    expect(p).not.toContain("Monitor");
    expect(p).not.toContain("Os apps que Marlon configurou");
  });

  it("os apps da pessoa entram só quando o turno os tem", () => {
    const p = montarPromptSistema({ ...base, nativas: [...NATIVAS_DO_TERMINAL_CODEX, NATIVA_MCP_DA_PESSOA], harness: "codex-cli" });
    expect(p).toContain("Os apps que Marlon configurou no Codex dela");
  });

  it("numa máquina Linux nomeia a máquina e não promete o Mac nem o s3key", () => {
    const t = terminalNoCodex({ pastaDoBot: "Dev 1", pessoaNome: "Marlon", regraDoModo: "x.", worktree: "a partir do clone que ela já tem", maquina: "vm-1", mcpDaPessoa: false });
    expect(t).toContain("máquina vm-1");
    expect(t).not.toContain("Finder");
    expect(t).not.toContain("s3key");
  });

  it("o Claude segue com o texto de sempre", () => {
    const p = montarPromptSistema({ ...base, nativas: NATIVAS_DO_TERMINAL, harness: "claude-cli" });
    expect(p).toContain("como no Claude Code do terminal");
    expect(p).not.toContain("terminal e os arquivos do Codex");
  });
});
