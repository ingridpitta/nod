import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ERROS_DO_SCRIPT, ETAPAS_DO_SCRIPT, papelDoScript, scriptDeInstalacao, servidorParaScript } from "../../../src/adapters/http/motor-instalacao.ts";
import { PISO_CLI } from "../../../src/adapters/executor/flag-floors.ts";
import { aposentarChaveAntiga, arquivoDaConexao, carregarConexao, comandoDeEntrar, guardarConexao, lerComando, lerConexao, pastaDoMotor } from "../../../motor/conexao.ts";

describe("motor sem janela (ADR-090)", () => {
  it("lê os comandos do nod-motor", () => {
    expect(lerComando([])).toEqual({ tipo: "ajuda", erro: null });
    expect(lerComando(["rodar"])).toEqual({ tipo: "rodar" });
    expect(lerComando(["parear", "https://nod.exemplo.com", "--nome", "vm-sp"])).toEqual({ tipo: "parear", servidor: "https://nod.exemplo.com", nome: "vm-sp", convite: null, abrir: false });
    expect(lerComando(["parear", "--nome", "vm-sp", "https://nod.exemplo.com"])).toEqual({ tipo: "parear", servidor: "https://nod.exemplo.com", nome: "vm-sp", convite: null, abrir: false });
    // ADR-102: o convite do comando de instalação; um valor fora do formato é ignorado (vale o código de sempre).
    const convite = "A".repeat(32);
    expect(lerComando(["parear", "https://nod.exemplo.com", "--convite", convite])).toEqual({ tipo: "parear", servidor: "https://nod.exemplo.com", nome: null, convite, abrir: false });
    expect(lerComando(["parear", "--convite", "x; rm -rf /", "https://nod.exemplo.com"])).toMatchObject({ servidor: "https://nod.exemplo.com", convite: null });
    // ADA-32 (ADR-151): `--abrir` (o instalador do Windows) não é confundido com o servidor.
    expect(lerComando(["parear", "--abrir", "https://nod.exemplo.com", "--convite", convite])).toEqual({ tipo: "parear", servidor: "https://nod.exemplo.com", nome: null, convite, abrir: true });
    expect(lerComando(["parear"]).tipo).toBe("ajuda");
    expect(lerComando(["entrar", "claude"])).toEqual({ tipo: "entrar", ia: "claude" });
    expect(lerComando(["entrar", "gemini"]).tipo).toBe("ajuda");
    expect(lerComando(["--help"])).toEqual({ tipo: "ajuda", erro: null });
    expect(lerComando(["xyz"])).toMatchObject({ tipo: "ajuda", erro: expect.stringContaining("xyz") });
    // ADA-245 (jornada D): a remoção deste computador.
    expect(lerComando(["desinstalar"])).toEqual({ tipo: "desinstalar", manterConexao: false, manterIas: false, json: false });
    expect(lerComando(["desinstalar", "--manter-ias", "--json", "--manter-conexao"])).toEqual({ tipo: "desinstalar", manterConexao: true, manterIas: true, json: true });
    expect(lerComando(["desinstalar", "--tudo"])).toMatchObject({ tipo: "ajuda", erro: expect.stringContaining("--tudo") });
  });

  it("o login headless de cada IA (o Codex e o gh pelo fluxo de dispositivo)", () => {
    expect(comandoDeEntrar("claude")).toEqual({ nome: "claude", args: ["auth", "login"] });
    expect(comandoDeEntrar("codex").args).toContain("--device-auth");
    expect(comandoDeEntrar("github").nome).toBe("gh");
  });

  it("a conexão fica num arquivo 0600 e volta igual", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-motor-"));
    expect(pastaDoMotor({ NOD_MOTOR_HOME: pasta })).toBe(pasta);
    expect(pastaDoMotor({ HOME: "/home/nod" })).toBe("/home/nod/.config/nod-motor");
    expect(await carregarConexao(pasta)).toBeNull();
    await guardarConexao(pasta, { url: "https://nod.exemplo.com", chave: "abc.def" });
    expect(await carregarConexao(pasta)).toEqual({ url: "https://nod.exemplo.com", chave: "abc.def" });
    expect((await stat(arquivoDaConexao(pasta))).mode & 0o777).toBe(0o600);
    expect(lerConexao(await readFile(arquivoDaConexao(pasta), "utf8"))).not.toBeNull();
    expect(lerConexao("{}")).toBeNull();
    expect(lerConexao("não é json")).toBeNull();
  });

  it("NOD-344: aposentarChaveAntiga manda a chave ANTIGA no Bearer, só no mesmo servidor e se a chave mudou; erro não derruba", async () => {
    const chamadas: { url: string; auth: string | null }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      chamadas.push({ url, auth: new Headers(init.headers).get("authorization") });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const nova = { url: "https://nod.exemplo.com", chave: "nova.k" };
    expect(await aposentarChaveAntiga({ url: "https://nod.exemplo.com", chave: "velha.k" }, nova, "1.0.0", f)).toBe(true);
    expect(chamadas).toEqual([{ url: "https://nod.exemplo.com/api/maquina/aposentar", auth: "Bearer velha.k" }]);
    expect(await aposentarChaveAntiga(null, nova, "1.0.0", f)).toBe(false);
    expect(await aposentarChaveAntiga({ url: "https://outro.exemplo.com", chave: "velha.k" }, nova, "1.0.0", f)).toBe(false);
    expect(await aposentarChaveAntiga(nova, nova, "1.0.0", f)).toBe(false);
    expect(chamadas).toHaveLength(1);
    const falha = (async () => { throw new Error("rede fora"); }) as unknown as typeof fetch;
    expect(await aposentarChaveAntiga({ url: nova.url, chave: "velha.k" }, nova, "1.0.0", falha)).toBe(false);
    const recusa = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    expect(await aposentarChaveAntiga({ url: nova.url, chave: "velha.k" }, nova, "1.0.0", recusa)).toBe(false);
  });

  it("o script de instalação só sai com HTTPS (ou http em loopback) e um host sem nada que o shell interprete", () => {
    expect(servidorParaScript("https", "nod.exemplo.com")).toBe("https://nod.exemplo.com");
    expect(servidorParaScript("https,http", "nod.exemplo.com")).toBe("https://nod.exemplo.com");
    expect(servidorParaScript("http", "127.0.0.1:8888")).toBe("http://127.0.0.1:8888");
    expect(servidorParaScript("http", "nod.exemplo.com")).toBeNull();
    expect(servidorParaScript("https", "nod.exemplo.com;rm -rf /")).toBeNull();
    expect(servidorParaScript("https", "$(whoami).exemplo.com")).toBeNull();
    expect(() => scriptDeInstalacao({ servidor: "https://x\"; rm", versao: "1" })).toThrow();
  });

  it("o script de instalação é shell válido e leva o servidor e a versão", () => {
    const script = scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.4.0-rc.6" });
    expect(script).toContain('NOD_SERVIDOR="https://nod.exemplo.com"');
    expect(script).toContain('NOD_VERSAO="0.4.0-rc.6"');
    expect(script).toContain("User=nod");
    expect(script).not.toContain("${o.");
    execFileSync("sh", ["-n"], { input: script });
  });

  it("ADR-102: o convite vai no script e no pareamento; o Codex vem sempre (NOD_SEM_CODEX=1 desliga)", () => {
    const convite = "Ab_-".repeat(8);
    const comConvite = scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.4.0", convite });
    expect(comConvite).toContain(`NOD_CONVITE="${convite}"`);
    expect(comConvite).toContain(`parear "$NOD_SERVIDOR" --convite "$NOD_CONVITE"`);
    expect(comConvite).toContain('if [ "${NOD_SEM_CODEX:-0}" != "1" ]; then');
    expect(comConvite).not.toContain("NOD_COM_CODEX:-0");
    // Convite fora do formato nunca entra no shell.
    expect(scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.4.0", convite: '"; rm -rf / #' })).toContain('NOD_CONVITE=""');
    expect(execFileSync("sh", ["-n"], { input: comConvite }).toString()).toBe("");
  });

  it("NOD-8: o script instala os dois CLIs a partir do piso (>=PISO_CLI), como o instalador do Mac", () => {
    const script = scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.4.0" });
    expect(script).toContain(`@anthropic-ai/claude-code@">=${PISO_CLI["claude-cli"]}"`);
    expect(script).toContain(`@openai/codex@">=${PISO_CLI["codex-cli"]}"`);
    // Sem o piso não sobra nenhum pedido solto (o npm instalaria o que o registry entregar).
    expect(script).not.toMatch(/@anthropic-ai\/claude-code\s/);
    expect(script).not.toMatch(/@openai\/codex\s/);
    execFileSync("sh", ["-n"], { input: script });
  });

  it("NOD-94: o script só-computador pula gh e as IAs, anuncia as etapas em ordem e diz o motivo de cada falha conhecida", () => {
    const convite = "Ab_-".repeat(8);
    const sempre = scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.4.0", convite });
    // Sem papel (ou papel desconhecido) o script é o de sempre, byte a byte: o caminho do motor não muda.
    expect(scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.4.0", convite, papel: null })).toBe(sempre);
    expect(sempre).not.toContain("NOD-ETAPA");
    expect(sempre).not.toContain("NOD-ERRO");
    expect(papelDoScript("computador")).toBe("computador");
    for (const v of ["motor", "Computador", "", null, undefined]) expect(papelDoScript(v)).toBeNull();

    const comp = scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.4.0", convite, papel: "computador" });
    execFileSync("sh", ["-n"], { input: comp });
    for (const fora of ["cli.github.com", "@anthropic-ai/claude-code", "@openai/codex", "install -y -qq gh"]) expect(comp).not.toContain(fora);
    for (const fica of ["OOMPolicy=continue", "RestartPreventExitStatus=2", "nod-motor-atualizar.path", `parear "$NOD_SERVIDOR" --convite "$NOD_CONVITE"`]) expect(comp).toContain(fica);
    const etapas = [...comp.matchAll(/^etapa (\w+)$/gm)].map((m) => m[1]);
    // "pronta" sai duas vezes: no caminho da máquina que já estava conectada e no fim do pareamento.
    expect(etapas).toEqual(["conferencia", "pacotes", "node", "usuario", "motor", "servico", "pronta", "pareamento", "pronta"]);
    for (const e of etapas) expect(ETAPAS_DO_SCRIPT).toContain(e);
    const motivos = [...comp.matchAll(/falhar "[^"]*" (\w+)/g)].map((m) => m[1]);
    expect(new Set(motivos)).toEqual(new Set(["so_nao_suportado", "sem_sudo", "nao_pareou"]));
    for (const m of motivos) expect(ERROS_DO_SCRIPT).toContain(m);
  });

  it("NOD-94: falhar() escreve NOD-ERRO com o motivo; o comando que quebra no meio (set -e) sai com instalacao_falhou", () => {
    const comp = scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.4.0", papel: "computador" });
    // O cabeçalho (até antes de principal) define falhar, etapa e o trap do EXIT; roda-se só ele, com o fim trocado.
    const cabecalho = comp.slice(0, comp.indexOf("principal() {"));
    const rodar = (fim: string) => spawnSync("sh", ["-c", `${cabecalho}\n${fim}`], { encoding: "utf8" });
    const semSudo = rodar(`etapa conferencia\nfalhar "Rode como root ou instale o sudo." sem_sudo`);
    expect(semSudo.status).toBe(1);
    expect(semSudo.stdout).toBe("NOD-ETAPA:conferencia\nNOD-ERRO:sem_sudo\n");
    expect(semSudo.stderr).toContain("Rode como root");
    const quebrou = rodar("etapa pacotes\nfalse");
    expect(quebrou.status).toBe(1);
    expect(quebrou.stdout).toBe("NOD-ETAPA:pacotes\nNOD-ERRO:instalacao_falhou\n");
    const ok = rodar("etapa pronta\nexit 0");
    expect(ok.stdout).toBe("NOD-ETAPA:pronta\n");
  });

  it("NOD-94 (QA): reinstalar a só-computador com convite pareia de novo mesmo com conexao.json antigo; sem convite, só reinicia", async () => {
    const convite = "Ab_-".repeat(8);
    const casa = await mkdtemp(join(tmpdir(), "nod-casa-"));
    await mkdir(join(casa, ".config/nod-motor"), { recursive: true });
    await writeFile(join(casa, ".config/nod-motor/conexao.json"), "{}");
    // Roda só o fim de principal() (da conferência da conexão em diante), com systemctl e o nod-motor falsos.
    const fimDe = (script: string) => {
      const cabecalho = script.slice(0, script.indexOf("principal() {"));
      const resto = script.slice(script.indexOf("# A pasta da conexão"), script.lastIndexOf("}\n\nprincipal"));
      const falsos = `SUDO=""\nCASA="${casa}"\nsystemctl() { echo "systemctl $*"; }\nnod_motor_falso() { echo "PAREOU $*"; }\n`;
      return spawnSync("sh", ["-c", `${cabecalho}\n${falsos}${resto.replaceAll("/usr/local/bin/nod-motor", "nod_motor_falso")}`], { encoding: "utf8" });
    };
    try {
      const comConvite = fimDe(scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.4.0", convite, papel: "computador" }));
      expect(comConvite.status).toBe(0);
      expect(comConvite.stdout).toContain(`PAREOU parear https://nod.exemplo.com --convite ${convite}`);
      expect(comConvite.stdout).toContain("NOD-ETAPA:pareamento");
      const semConvite = fimDe(scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.4.0", papel: "computador" }));
      expect(semConvite.stdout).toContain("systemctl restart nod-motor");
      expect(semConvite.stdout).not.toContain("PAREOU");
    } finally {
      await rm(casa, { recursive: true, force: true });
    }
  });

  it("ADR-097 (fase 0b): um OOM mata o processo, não o serviço; e a máquina sem swap ganha zram (ou arquivo de swap)", () => {
    const script = scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.4.0-rc.6" });
    expect(script).toContain("OOMPolicy=continue");
    // ADR-097 (fase 2): o motor cria um grupo de controle por turno.
    expect(script).toContain("Delegate=yes");
    // Só liga swap quando não há nenhum, e nunca para a instalação por isso.
    expect(script).toContain('if [ -z "$(swapon --noheadings 2>/dev/null)" ]; then');
    expect(script).toContain("ligar_swap || true");
    expect(script).toContain("zram-tools");
    expect(script).toContain("printf 'ALGO=zstd\\nSIZE=%s\\nPRIORITY=100\\n'");
    expect(script).toContain("/swapfile-nod none swap sw 0 0");
  });

  it("QA NOD-199: o motor reanuncia pela rota só de inventário, como o app do Mac — nunca pelo conectar direto", async () => {
    // O `conectar` com turno rodando volta 409 (o aoFalhar do motor reanuncia de novo) e, depois de 90 s, limpa os planos.
    // Quem decide entre `inventario` e `conectar` é o cliente (`anunciarInventario`, coberto em ponte-http-inventario).
    for (const arquivo of ["motor/main.ts", "desktop/main.ts"]) {
      const fonte = await readFile(join(process.cwd(), arquivo), "utf8");
      expect(fonte, arquivo).toMatch(/anunciar: async[^\n]*\n?[^]*?ponte\.anunciarInventario\(/);
      expect(fonte, arquivo).not.toMatch(/ponteHttp\.ponte\.conectar\(/);
    }
  });

  // Regression: inverter o manterConexao do desconectar(remover) do motor/main.ts passava em todos os testes, e o
  // "Continuar ligado" pedido pelo chat ou por outra tela apagaria a conexão.json (critério 2 da jornada D).
  // Found by /qa on 2026-11-08 (PR #694)
  it("QA ADA-245: o motor removido pela puxada só apaga a conexão sem 'Continuar ligado', e a limpeza leva as opções", async () => {
    const fonte = await readFile(join(process.cwd(), "motor/main.ts"), "utf8");
    const i = fonte.indexOf("desconectar: async (remover?: OpcoesRemover) => {");
    expect(i).toBeGreaterThan(0);
    const corpo = fonte.slice(i, fonte.indexOf("aoSairDaConta:", i));
    const apagam = corpo.match(/^.*rm\(arquivoDaConexao\(pasta\).*$/gm) ?? [];
    expect(apagam.map((l) => l.trim())).toEqual([
      "await rm(arquivoDaConexao(pasta), { force: true });",
      "if (!remover.manterConexao) await rm(arquivoDaConexao(pasta), { force: true }).catch(() => undefined);",
    ]);
    // O primeiro é o desconectar sem remoção (sai da conta de todo jeito).
    expect(corpo.indexOf("if (!remover) {")).toBeLessThan(corpo.indexOf(apagam[0]!.trim()));
    expect(corpo).toContain("await desinstalar(remover, depsDeVerdade({ modo: \"servico\", pastaDaConexao: pasta }))");
  });
});
