import { spawn } from "node:child_process";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, win32 } from "node:path";
import type { ItemRemocao, OpcoesRemover, ResultadoRemoverDaqui } from "../src/contracts/remover-computador.ts";

/**
 * ADA-245 (jornada D): `nod-motor desinstalar [--manter-conexao] [--manter-ias] [--json]`, a limpeza deste computador.
 * Lógica pura: o disco, os comandos e a plataforma vêm de fora (tests/unit/motor/desinstalar.test.ts roda sem Windows).
 *
 * No Windows (a instalação da ADR-151), na ordem:
 *   parou    ── schtasks /End + /Delete da tarefa `nod-motor-<SID>` e o valor `nod-motor-<SID>` da chave Run
 *   programa ── `%LOCALAPPDATA%\nod` e `%LOCALAPPDATA%\nod-motor`, pelo PowerShell da limpeza (para a árvore de node.exe
 *               da pasta, tira as duas pastas do Path do usuário e apaga, com novas tentativas)
 *   ias      ── do `%APPDATA%\npm`, só o Claude/Codex que a marca `%APPDATA%\nod-motor\ias-do-nod.json` diz que o nod
 *               instalou (sem marca, ficam: instalação antiga, ou a IA já era da pessoa)
 *   conta    ── `conexao.json`, `contas-locais.json` e `maquina.json` de `%APPDATA%\nod-motor` (a pasta inteira
 *               quando nada dela precisa ficar), a não ser com manterConexao
 * Só caminhos fixos, derivados de `%LOCALAPPDATA%`/`%APPDATA%` (nunca de NOD_PASTA, NOD_MOTOR_HOME, servidor ou tela).
 *
 * O processo que roda de DENTRO de `%LOCALAPPDATA%\nod` (o `nod-motor desinstalar` no terminal e o próprio motor, pela
 * puxada) não consegue apagar a pasta do node.exe que o executa. Definido em 2026-11-07: nesses modos a limpeza da pasta
 * vai para um PowerShell oculto criado pelo WMI (`Win32_Process.Create`, fora do job da Tarefa Agendada, que mataria um
 * filho comum junto com o motor), que espera este processo sair e só então apaga. O app do Windows roda de outra pasta
 * (`%LOCALAPPDATA%\Programs\nod`): chama esta mesma função no modo "app", que espera a limpeza terminar e confere no
 * disco, então o item `programa` diz o que de fato aconteceu.
 *
 * Fora do Windows (o motor da VM, ADR-090): só a conexão sai (a não ser com manterConexao); o serviço systemd fica.
 */

export type Env = Readonly<Record<string, string | undefined>>;
export type RodarComando = (exe: string, args: readonly string[], o: { timeoutMs: number }) => Promise<{ codigo: number | null; saida: string }>;
export type DiscoDaRemocao = {
  existe(caminho: string): Promise<boolean>;
  ler(caminho: string): Promise<string | null>;
  gravar(caminho: string, texto: string): Promise<void>;
  /** Apaga arquivo ou pasta inteira; ausente não é erro (rm -rf). */
  apagar(caminho: string): Promise<void>;
};

/**
 * - "app": o app do Windows, fora da pasta do programa: espera a limpeza e confere;
 * - "terminal": `nod-motor desinstalar` rodando de dentro da pasta: a pasta sai depois que ele terminar;
 * - "servico": o motor da tarefa, pela puxada: sem /End (mataria este processo no meio da limpeza), e a pasta sai
 *   depois que ele sair.
 */
export type ModoDaRemocao = "app" | "terminal" | "servico";

export type DepsDesinstalar = {
  plataforma: NodeJS.Platform;
  env: Env;
  disco: DiscoDaRemocao;
  rodar: RodarComando;
  /** Este processo: quem a limpeza destacada espera sair. */
  pid: number;
  modo: ModoDaRemocao;
  /** Fora do Windows: a pasta da conexão do motor (pastaDoMotor). */
  pastaDaConexao?: string;
};

/** `programaDepois`: a pasta do programa sai quando este processo terminar (a limpeza destacada já foi disparada). */
export type ResultadoDesinstalar = ResultadoRemoverDaqui & { programaDepois: boolean };

export type IaDoNpm = "claude" | "codex";

/** O que o `npm install -g --prefix %APPDATA%\npm` grava por IA: os três shims e a pasta do pacote. */
export const IAS_DO_NPM: Record<IaDoNpm, { nome: string; shims: readonly string[]; pacote: readonly string[] }> = {
  claude: { nome: "Claude", shims: ["claude", "claude.cmd", "claude.ps1"], pacote: ["node_modules", "@anthropic-ai", "claude-code"] },
  codex: { nome: "ChatGPT", shims: ["codex", "codex.cmd", "codex.ps1"], pacote: ["node_modules", "@openai", "codex"] },
};

/** O prefixo da tarefa e do valor da chave Run (TAREFA_DO_MOTOR_WINDOWS do instalador; o teste confere). */
export const TAREFA_DO_MOTOR = "nod-motor";
const CHAVE_RUN = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

export type CaminhosDaRemocao = {
  programa: string;
  dados: string;
  config: string;
  npm: string;
  temp: string;
  conexao: string;
  contasLocais: string;
  maquina: string;
  marca: string;
  sistema: string;
};

/** C:\... absoluto, sem aspas, e não a raiz de um disco: o resto não serve de base para apagar nada. */
const BASE_SEGURA = /^[A-Za-z]:\\[^"\r\n]*[^\\"\r\n]$/;
const baseSegura = (v: string | undefined): string | null => {
  const t = v?.trim().replace(/\\+$/, "");
  return t && BASE_SEGURA.test(t) && !t.split("\\").includes("..") ? t : null;
};

/** Os únicos caminhos que a remoção no Windows toca. null = ambiente estranho (sem LOCALAPPDATA/APPDATA absolutos). */
export function caminhosNoWindows(env: Env): CaminhosDaRemocao | null {
  const local = baseSegura(env.LOCALAPPDATA);
  const roaming = baseSegura(env.APPDATA);
  if (!local || !roaming) return null;
  const temp = baseSegura(env.TEMP) ?? win32.join(local, "Temp");
  const sistema = baseSegura(env.SystemRoot ?? env.SYSTEMROOT) ?? "C:\\Windows";
  const config = win32.join(roaming, "nod-motor");
  return {
    programa: win32.join(local, "nod"),
    dados: win32.join(local, "nod-motor"),
    config,
    npm: win32.join(roaming, "npm"),
    temp,
    conexao: win32.join(config, "conexao.json"),
    contasLocais: win32.join(config, "contas-locais.json"),
    maquina: win32.join(config, "maquina.json"),
    marca: win32.join(config, "ias-do-nod.json"),
    sistema,
  };
}

/** A marca `{"claude":"2.1.3","codex":null}`: as IAs com versão foram instaladas pelo nod. Ilegível = nenhuma. */
export function lerMarcaDasIas(texto: string | null): IaDoNpm[] {
  if (!texto) return [];
  try {
    const v = JSON.parse(texto.replace(/^\uFEFF/, "")) as Record<string, unknown>;
    if (typeof v !== "object" || v === null) return [];
    return (Object.keys(IAS_DO_NPM) as IaDoNpm[]).filter((ia) => typeof v[ia] === "string" && v[ia] !== "");
  } catch {
    return [];
  }
}

/** O SID na saída de `whoami /user /fo csv /nh` (`"pc\ana","S-1-5-21-…"`). */
export function sidDaSaida(saida: string): string | null {
  return saida.match(/S-1-5-21(?:-\d+)+/)?.[0] ?? saida.match(/S-1-\d+(?:-\d+){2,}/)?.[0] ?? null;
}

const nomes = (ias: readonly IaDoNpm[]) => {
  const n = ias.map((ia) => IAS_DO_NPM[ia].nome);
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} e ${n[n.length - 1]}`;
};

/**
 * As pastas do programa como a tela de Fim as nomeia. Nunca o caminho de verdade: `%LOCALAPPDATA%\nod-motor` e o
 * perfil da pessoa podem trazer jargão (JARGAO_PROIBIDO_REMOVER; revisão do PR #694). O npm vai como `%APPDATA%\npm`.
 */
export type PastaDoPrograma = "programa" | "dados";
const NOME_DA_PASTA: Record<PastaDoPrograma, string> = { programa: "%LOCALAPPDATA%\\nod", dados: "a pasta de trabalho do nod (em %LOCALAPPDATA%)" };
const NPM_NA_TELA = "%APPDATA%\\npm";

/** Os textos da tela de Fim (sem motor, máquina, chave nem parear: JARGAO_PROIBIDO_REMOVER), também os de falha. */
export const TEXTOS_REMOCAO = {
  parou: "Parou de rodar neste computador",
  naoParou: "Não deu para parar o nod neste computador. Reinicie o computador e remova de novo",
  programa: "O programa do nod foi removido",
  programaDepois: "O programa do nod sai deste computador em alguns segundos",
  programaFicou: (pastas: readonly PastaDoPrograma[]) => `Não deu para apagar ${pastas.map((p) => NOME_DA_PASTA[p]).join(" e ")}. Reinicie o computador e apague à mão`,
  ias: (ias: readonly IaDoNpm[]) => `${nomes(ias)} ${ias.length > 1 ? "instalados pelo nod foram removidos" : "instalado pelo nod foi removido"}`,
  iasFicam: "O Claude e o ChatGPT ficam neste computador",
  iasDaPessoa: "As IAs deste computador ficam: não foi o nod que as instalou",
  semIas: "Não havia IAs instaladas pelo nod neste computador",
  iasFicaram: (ias: readonly IaDoNpm[], pasta: string) => `Não deu para remover ${nomes(ias)}. Apague à mão em ${pasta}`,
  saiu: "Este computador saiu da sua conta",
  continua: "Continua ligado à sua conta",
  naoSaiu: "Não deu para desligar este computador da sua conta. Abra o nod e remova de novo",
} as const;

const item = (id: ItemRemocao["id"], estado: ItemRemocao["estado"], texto: string): ItemRemocao => ({ id, estado, texto });

async function rodarComSeguranca(d: DepsDesinstalar, exe: string, args: readonly string[], timeoutMs = 30_000) {
  return d.rodar(exe, args, { timeoutMs }).catch(() => ({ codigo: null, saida: "" }));
}

async function apagarTodos(d: DepsDesinstalar, caminhos: readonly string[]): Promise<boolean> {
  let ok = true;
  for (const c of caminhos) await d.disco.apagar(c).catch(() => { ok = false; });
  return ok;
}

/** Aspas simples do PowerShell: o único escape é dobrar a aspa (um perfil `O'Brien`). */
const ps = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * O PowerShell da limpeza das duas pastas (ASCII: o Windows PowerShell 5.1 lê um .ps1 sem BOM como ANSI). Os caminhos
 * vão embutidos (o processo criado pelo WMI não herda o ambiente deste). Espera `-EsperarPid` sair, para a árvore de
 * node.exe da pasta do programa (dos filhos para o pai, como o desinstalar.ps1), tira `bin` e `node` do Path do usuário,
 * apaga com até 15 tentativas (antivírus, um arquivo ainda aberto) e se apaga no fim. Sai com 1 se alguma pasta ficou.
 */
export function scriptDaLimpeza(c: CaminhosDaRemocao): string {
  // Revisão do PR #694: o BOM do UTF-8 na frente. O Windows PowerShell 5.1 lê .ps1 sem BOM como ANSI, e um perfil com
  // acento (C:\Users\José) viraria um caminho que não existe: nada sairia.
  return "\uFEFF" + [
    "param([int]$EsperarPid = 0)",
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$programa = ${ps(c.programa)}`,
    `$pastas = @($programa, ${ps(c.dados)})`,
    "if ($EsperarPid -gt 0) { Wait-Process -Id $EsperarPid -Timeout 120 }",
    "$prefixo = $programa.TrimEnd('\\') + '\\'",
    "$todos = @(Get-CimInstance -ClassName Win32_Process)",
    "$fila = [System.Collections.Generic.Queue[int]]::new()",
    "foreach ($p in $todos) { if ($p.Name -eq 'node.exe' -and $p.ExecutablePath -and $p.ExecutablePath.StartsWith($prefixo, [StringComparison]::OrdinalIgnoreCase)) { $fila.Enqueue([int]$p.ProcessId) } }",
    "$arvore = [System.Collections.Generic.List[int]]::new()",
    "while ($fila.Count -gt 0) { $id = $fila.Dequeue(); if ($arvore.Contains($id)) { continue }; $arvore.Add($id); foreach ($f in $todos) { if ($f.ParentProcessId -eq $id -and $f.ProcessId -ne $id) { $fila.Enqueue([int]$f.ProcessId) } } }",
    "for ($i = $arvore.Count - 1; $i -ge 0; $i--) { Stop-Process -Id $arvore[$i] -Force }",
    "foreach ($id in $arvore) { Wait-Process -Id $id -Timeout 15 }",
    "$tirar = @((Join-Path $programa 'bin'), (Join-Path $programa 'node'))",
    "$chave = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)",
    "if ($null -ne $chave) { try { $atual = [string]$chave.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $itens = @($atual -split ';' | Where-Object { $_ -ne '' }); $ficam = @($itens | Where-Object { $item = [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\\'); -not ($tirar | Where-Object { $_ -ieq $item }) }); if ($ficam.Count -ne $itens.Count) { $chave.SetValue('Path', ($ficam -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString) } } finally { $chave.Close() } }",
    "[Environment]::SetEnvironmentVariable('NOD_INSTALADO_EM', $null, 'User')",
    "$ficou = 0",
    "foreach ($p in $pastas) { for ($i = 0; $i -lt 15 -and (Test-Path -LiteralPath $p); $i++) { Remove-Item -LiteralPath $p -Recurse -Force; if (Test-Path -LiteralPath $p) { Start-Sleep -Seconds 1 } }; if (Test-Path -LiteralPath $p) { $ficou++ } }",
    "Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force",
    "exit $ficou",
    "",
  ].join("\r\n");
}

const powershellDe = (c: CaminhosDaRemocao) => win32.join(c.sistema, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const ARGS_PS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden"] as const;

/** O lançador pelo WMI: o processo nasce do WmiPrvSE, fora do job da Tarefa Agendada e da árvore deste processo. */
export function lancadorDestacado(c: CaminhosDaRemocao, script: string, pid: number): string[] {
  const linha = `"${powershellDe(c)}" ${ARGS_PS.join(" ")} -File "${script}" -EsperarPid ${Math.trunc(pid)}`;
  const comando = `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${ps(linha)} }; exit [int]$r.ReturnValue`;
  return [...ARGS_PS, "-EncodedCommand", Buffer.from(comando, "utf16le").toString("base64")];
}

async function pararNoWindows(c: CaminhosDaRemocao, d: DepsDesinstalar): Promise<ItemRemocao> {
  const sys = (exe: string) => win32.join(c.sistema, "System32", exe);
  const sid = sidDaSaida((await rodarComSeguranca(d, sys("whoami.exe"), ["/user", "/fo", "csv", "/nh"])).saida);
  if (!sid) return item("parou", "falhou", TEXTOS_REMOCAO.naoParou);
  const nome = `${TAREFA_DO_MOTOR}-${sid}`;
  const tarefa = `\\${nome}`;
  let ok = true;
  if ((await rodarComSeguranca(d, sys("schtasks.exe"), ["/Query", "/TN", tarefa])).codigo === 0) {
    // /End falhar (a tarefa já parada) não importa: a limpeza para a árvore de node.exe; o que conta é a tarefa sumir.
    if (d.modo !== "servico") await rodarComSeguranca(d, sys("schtasks.exe"), ["/End", "/TN", tarefa]);
    ok = (await rodarComSeguranca(d, sys("schtasks.exe"), ["/Delete", "/TN", tarefa, "/F"])).codigo === 0;
  }
  if ((await rodarComSeguranca(d, sys("reg.exe"), ["query", CHAVE_RUN, "/v", nome])).codigo === 0) {
    ok = (await rodarComSeguranca(d, sys("reg.exe"), ["delete", CHAVE_RUN, "/v", nome, "/f"])).codigo === 0 && ok;
  }
  return item("parou", ok ? "feito" : "falhou", ok ? TEXTOS_REMOCAO.parou : TEXTOS_REMOCAO.naoParou);
}

async function programaNoWindows(c: CaminhosDaRemocao, d: DepsDesinstalar): Promise<{ item: ItemRemocao; depois: boolean }> {
  const script = win32.join(c.temp, `nod-remover-${Math.trunc(d.pid)}.ps1`);
  const falhou = (pastas: readonly PastaDoPrograma[]) => ({ item: item("programa", "falhou", TEXTOS_REMOCAO.programaFicou(pastas)), depois: false });
  try {
    await d.disco.gravar(script, scriptDaLimpeza(c));
  } catch {
    return falhou(["programa", "dados"]);
  }
  if (d.modo === "app") {
    await rodarComSeguranca(d, powershellDe(c), [...ARGS_PS, "-File", script], 180_000);
    const ficaram: PastaDoPrograma[] = [];
    for (const p of ["programa", "dados"] as const) if (await d.disco.existe(c[p])) ficaram.push(p);
    return ficaram.length ? falhou(ficaram) : { item: item("programa", "feito", TEXTOS_REMOCAO.programa), depois: false };
  }
  const r = await rodarComSeguranca(d, powershellDe(c), lancadorDestacado(c, script, d.pid));
  return r.codigo === 0 ? { item: item("programa", "feito", TEXTOS_REMOCAO.programaDepois), depois: true } : falhou(["programa", "dados"]);
}

async function iasNoWindows(c: CaminhosDaRemocao, o: OpcoesRemover, d: DepsDesinstalar): Promise<{ item: ItemRemocao; marcaFica: boolean }> {
  if (o.manterIas) return { item: item("ias", "mantido", TEXTOS_REMOCAO.iasFicam), marcaFica: true };
  const marca = await d.disco.ler(c.marca).catch(() => null);
  const ias = lerMarcaDasIas(marca);
  if (ias.length === 0) return { item: item("ias", marca === null ? "mantido" : "feito", marca === null ? TEXTOS_REMOCAO.iasDaPessoa : TEXTOS_REMOCAO.semIas), marcaFica: false };
  const ficaram: IaDoNpm[] = [];
  for (const ia of ias) {
    const { shims, pacote } = IAS_DO_NPM[ia];
    if (!(await apagarTodos(d, [...shims.map((s) => win32.join(c.npm, s)), win32.join(c.npm, ...pacote)]))) ficaram.push(ia);
  }
  if (ficaram.length) return { item: item("ias", "falhou", TEXTOS_REMOCAO.iasFicaram(ficaram, NPM_NA_TELA)), marcaFica: true };
  return { item: item("ias", "feito", TEXTOS_REMOCAO.ias(ias)), marcaFica: false };
}

async function contaNoWindows(c: CaminhosDaRemocao, o: OpcoesRemover, marcaFica: boolean, d: DepsDesinstalar): Promise<ItemRemocao> {
  if (o.manterConexao) {
    // A conexão fica; a marca sai quando as IAs que ela apontava saíram (senão uma remoção futura tiraria uma IA
    // que a pessoa reinstalou por conta própria).
    if (!marcaFica) await d.disco.apagar(c.marca).catch(() => undefined);
    return item("conta", "mantido", TEXTOS_REMOCAO.continua);
  }
  // Nada de %APPDATA%\nod-motor precisa ficar: a pasta inteira (vereditos, pedidos, a marca). Senão, só a conexão.
  const ok = await apagarTodos(d, marcaFica ? [c.conexao, c.contasLocais, c.maquina] : [c.config]);
  return ok ? item("conta", "feito", TEXTOS_REMOCAO.saiu) : item("conta", "falhou", TEXTOS_REMOCAO.naoSaiu);
}

export async function desinstalar(o: OpcoesRemover, d: DepsDesinstalar): Promise<ResultadoDesinstalar> {
  if (d.plataforma !== "win32") {
    if (o.manterConexao) return { itens: [item("conta", "mantido", TEXTOS_REMOCAO.continua)], programaDepois: false };
    const pasta = d.pastaDaConexao;
    const ok = pasta ? await apagarTodos(d, [join(pasta, "conexao.json"), join(pasta, "maquina.json")]) : false;
    return { itens: [ok ? item("conta", "feito", TEXTOS_REMOCAO.saiu) : item("conta", "falhou", TEXTOS_REMOCAO.naoSaiu)], programaDepois: false };
  }
  const c = caminhosNoWindows(d.env);
  if (!c) {
    // Sem as pastas do perfil não há o que apagar com segurança: nada é tocado, e a tela diz que falhou.
    const nada = "Não deu para achar as pastas do nod neste computador";
    return { itens: [item("parou", "falhou", nada), item("programa", "falhou", nada), item("ias", o.manterIas ? "mantido" : "falhou", o.manterIas ? TEXTOS_REMOCAO.iasFicam : nada), item("conta", o.manterConexao ? "mantido" : "falhou", o.manterConexao ? TEXTOS_REMOCAO.continua : nada)], programaDepois: false };
  }
  const parou = await pararNoWindows(c, d);
  if (d.modo === "app") {
    // O app espera a limpeza: os processos da pasta morrem antes de mexer nas IAs (um claude aberto prende o pacote).
    const programa = await programaNoWindows(c, d);
    const ias = await iasNoWindows(c, o, d);
    const conta = await contaNoWindows(c, o, ias.marcaFica, d);
    return { itens: [parou, programa.item, ias.item, conta], programaDepois: false };
  }
  const ias = await iasNoWindows(c, o, d);
  const conta = await contaNoWindows(c, o, ias.marcaFica, d);
  // Por último: o lançado espera este processo sair, e então apaga as duas pastas.
  const programa = await programaNoWindows(c, d);
  return { itens: [parou, programa.item, ias.item, conta], programaDepois: programa.depois };
}

/** O disco e os comandos de verdade (o motor e o app do Windows usam os mesmos). */
export function depsDeVerdade(o: Pick<DepsDesinstalar, "modo"> & Partial<Pick<DepsDesinstalar, "pastaDaConexao">>): DepsDesinstalar {
  return {
    plataforma: process.platform,
    env: process.env,
    pid: process.pid,
    modo: o.modo,
    ...(o.pastaDaConexao ? { pastaDaConexao: o.pastaDaConexao } : {}),
    disco: {
      existe: (c) => stat(c).then(() => true, () => false),
      ler: (c) => readFile(c, "utf8").catch(() => null),
      gravar: (c, t) => writeFile(c, t, "utf8"),
      apagar: (c) => rm(c, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }),
    },
    rodar: (exe, args, { timeoutMs }) => new Promise((resolver) => {
      let saida = "";
      const p = spawn(exe, [...args], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"], timeout: timeoutMs });
      p.stdout?.setEncoding("utf8");
      p.stdout?.on("data", (t: string) => { if (saida.length < 64_000) saida += t; });
      p.on("error", () => resolver({ codigo: null, saida }));
      p.on("close", (codigo) => resolver({ codigo, saida }));
    }),
  };
}
