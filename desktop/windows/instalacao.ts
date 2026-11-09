import type { ChildProcess } from "node:child_process";

/**
 * ADA-229 (ADR-152, item 4): o app instala o motor rodando o script `/windows` da ADR-151 num PowerShell oculto. A
 * conexão já está em `%APPDATA%\nod-motor\conexao.json` (pareou antes), então o script instala Git, Node, IAs e motor,
 * cria a tarefa e só sobe o motor, sem parear. O resultado sai pela variável `NOD_INSTALACAO_RESULTADO` (`ok`/`falhou`),
 * que o comando imprime numa linha marcada no fim. Sem Electron: o spawn é injetado (tests/unit/desktop/windows).
 */

/** O mesmo prefixo da tarefa do script (`TAREFA_DO_MOTOR_WINDOWS`); o teste confere que não divergiu. */
export const TAREFA_DO_MOTOR = "nod-motor";
export const MARCA_RESULTADO = "NOD_INSTALACAO_RESULTADO=";

/** Só https://host (ou http em loopback, na CI): o endereço entra entre aspas simples no PowerShell. */
export function servidorValido(servidor: string): boolean {
  return /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/.test(servidor) || /^http:\/\/(127\.0\.0\.1|localhost)(:[0-9]{1,5})?$/.test(servidor);
}

export type Comando = { arquivo: string; args: string[] };

/** O powershell.exe oculto que roda `irm <servidor>/windows | iex` e imprime o resultado. */
export function comandoDeInstalacao(servidor: string, systemRoot = "C:\\Windows"): Comando {
  if (!servidorValido(servidor)) throw new Error("servidor_invalido");
  const script = [
    "$ProgressPreference = 'SilentlyContinue'",
    "try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { $null = $_ }",
    `irm '${servidor}/windows' | iex`,
    `Write-Output ('${MARCA_RESULTADO}' + $env:NOD_INSTALACAO_RESULTADO)`,
  ].join("; ");
  return {
    arquivo: `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", script],
  };
}

export type LinhaDeInstalacao =
  | { tipo: "passo" | "aviso" | "erro" | "info"; texto: string }
  | { tipo: "resultado"; ok: boolean };

/** Uma linha da saída do script, como a janela mostra (✓ passo, ! aviso, ✗ erro). Vazia = null. */
export function lerLinhaDeInstalacao(bruta: string): LinhaDeInstalacao | null {
  const linha = bruta.replace(/\r$/, "").trim();
  if (!linha) return null;
  if (linha.startsWith(MARCA_RESULTADO)) return { tipo: "resultado", ok: linha.slice(MARCA_RESULTADO.length) === "ok" };
  if (linha.startsWith("\u2713 ")) return { tipo: "passo", texto: linha.slice(2) };
  if (linha.startsWith("\u2717 ")) return { tipo: "erro", texto: linha.slice(2) };
  if (linha.startsWith("! ")) return { tipo: "aviso", texto: linha.slice(2) };
  return { tipo: "info", texto: linha.slice(0, 500) };
}

export type ResultadoDaInstalacao = { ok: boolean; erro: string | null };

type Gerar = (arquivo: string, args: string[], opcoes: { windowsHide: boolean; stdio: ["ignore", "pipe", "pipe"]; env: NodeJS.ProcessEnv }) => Pick<ChildProcess, "stdout" | "stderr" | "on">;

/**
 * Roda a instalação e entrega cada linha. `ok` só com a linha marcada `ok`: sair com 0 sem ela (script cortado no meio,
 * servidor devolveu outra coisa) é falha. O erro é a última linha ✗, ou a última do stderr.
 */
export function rodarInstalacao(o: { servidor: string; gerar: Gerar; env: NodeJS.ProcessEnv; aoLinha(l: LinhaDeInstalacao): void }): Promise<ResultadoDaInstalacao> {
  const { arquivo, args } = comandoDeInstalacao(o.servidor, o.env.SystemRoot ?? o.env.SYSTEMROOT ?? "C:\\Windows");
  return new Promise((resolver) => {
    let ok = false;
    let erro: string | null = null;
    let ultimaDoStderr: string | null = null;
    let terminou = false;
    const fim = (r: ResultadoDaInstalacao) => { if (!terminou) { terminou = true; resolver(r); } };
    const filho = o.gerar(arquivo, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: o.env });
    let resto = "";
    filho.stdout?.setEncoding("utf8");
    filho.stdout?.on("data", (pedaco: string) => {
      resto += pedaco;
      const linhas = resto.split("\n");
      resto = linhas.pop() ?? "";
      for (const bruta of linhas) {
        const l = lerLinhaDeInstalacao(bruta);
        if (!l) continue;
        if (l.tipo === "resultado") ok = l.ok;
        else { if (l.tipo === "erro") erro = l.texto; o.aoLinha(l); }
      }
    });
    filho.stderr?.setEncoding("utf8");
    filho.stderr?.on("data", (pedaco: string) => {
      const ultima = pedaco.split("\n").map((s) => s.trim()).filter(Boolean).pop();
      if (ultima) ultimaDoStderr = ultima.slice(0, 500);
    });
    filho.on("error", (e: Error) => fim({ ok: false, erro: `Não deu para abrir o PowerShell: ${e.message}` }));
    filho.on("close", () => {
      const l = lerLinhaDeInstalacao(resto);
      if (l?.tipo === "resultado") ok = l.ok;
      else if (l) { if (l.tipo === "erro") erro = l.texto; o.aoLinha(l); }
      fim(ok ? { ok, erro: null } : { ok, erro: erro ?? ultimaDoStderr ?? "A instalação parou sem dizer o motivo." });
    });
  });
}
