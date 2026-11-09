import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { createConnection } from "node:net";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createZstdDecompress } from "node:zlib";

/**
 * definido em 2026-10-22 (NOD-93, PR 2, ADR-123; canal trocado pela ADR-127 em 2026-10-24): a VM local do Mac. O app
 * leva o Lima (só o `limactl` e o guest agent) em Contents/Resources/vm-local e liga uma VM vz com o disco do release
 * (infra/vm-local/), que já traz o supervisor do computador da ADR-122. Tudo mora em `<userData>/vm` (no Mac,
 * ~/Library/Application Support/nod/vm):
 *
 *   vm/lima          LIMA_HOME próprio (nunca ~/.lima): a instância `nod` e o disco `nod-dados` (_disks/)
 *   vm/ctl.sock      o único canal com a VM: o /run/nod-computador/ctl.sock do supervisor, encaminhado pelo Lima
 *   vm/cache         o disco baixado (desktop/vm-local/download.ts, PR 3) e, só durante o `create`, o raw dele
 *
 * Atrás de NOD_VM_LOCAL=1 até o aceite nos dois Macs. Este módulo é o spike: monta o ambiente, gera o lima.yaml e
 * conduz o ciclo do `limactl`; quem decide quando ligar e dormir é o preparo (src/domain/preparo-vm-local.ts, PR 3).
 * O processo é injetado (`executar`): os testes rodam no Linux com um limactl falso.
 */

export const INSTANCIA = "nod";
export const DISCO_DADOS = "nod-dados";
/** definido em 2026-10-22: o disco de dados nasce com 64 GiB (raw esparso: ocupa só o que o supervisor grava). */
export const DADOS_GIB = 64;
/** definido em 2026-10-22: a raiz do convidado; o disco base é de 8 GiB (infra/vm-local/base.env) e cresce no boot. */
export const DISCO_GIB = 12;
/** O Virtualization.framework do Lima (vz) pede macOS 13; no 12 o app segue, sem computador local (`macos_antigo`). */
export const MACOS_MINIMO = 13;
/** O sun_path do macOS tem 104 bytes; o Lima põe sockets dentro da pasta da instância. */
export const SOCKET_MAX_BYTES = 104;

export type ArchMac = "arm64" | "x64";

export function vmLocalLigada(env: Record<string, string | undefined>): boolean {
  return env.NOD_VM_LOCAL === "1";
}

export type CaminhosVmLocal = { raiz: string; limaHome: string; socket: string; cache: string; yaml: string; registro: string; instancia: string; discoDados: string };

export function caminhosVmLocal(dadosApp: string): CaminhosVmLocal {
  const raiz = join(dadosApp, "vm");
  const limaHome = join(raiz, "lima");
  return {
    raiz,
    limaHome,
    socket: join(raiz, "ctl.sock"),
    cache: join(raiz, "cache"),
    yaml: join(raiz, `${INSTANCIA}.yaml`),
    registro: join(raiz, "instancia.json"),
    instancia: join(limaHome, INSTANCIA),
    discoDados: join(limaHome, "_disks", DISCO_DADOS),
  };
}

export type BinariosVmLocal = { limactl: string; modelo: string };

/** O layout que scripts/desktop/vm-local-binarios.ts monta e o electron-builder copia para Resources/vm-local. */
export function binariosVmLocal(recursos: string): BinariosVmLocal {
  const base = join(recursos, "vm-local");
  return { limactl: join(base, "lima", "bin", "limactl"), modelo: join(base, "lima.yaml") };
}

/**
 * Os sockets que o Lima cria (ssh.sock, ha.sock) ficam em <limaHome>/nod; o do supervisor, em vm/. Num nome de usuário
 * comprido o caminho passa do limite e o Lima recusa: melhor saber antes de baixar 1 GB.
 */
export function socketsCabem(c: CaminhosVmLocal): boolean {
  const maior = [join(c.instancia, "ssh.sock"), join(c.instancia, "ha.sock"), c.socket];
  return maior.every((s) => Buffer.byteLength(s) < SOCKET_MAX_BYTES);
}

/** Só o que o processo precisa; nada de LIMA_INSTANCE, http_proxy ou PATH da pessoa. */
const HERDADAS = ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG"] as const;
const PATH_DO_SISTEMA = "/usr/bin:/bin:/usr/sbin:/sbin";

function herdar(base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = { PATH: PATH_DO_SISTEMA };
  for (const k of HERDADAS) {
    const v = base[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}

export function ambienteLima(c: CaminhosVmLocal, base: Record<string, string | undefined>): Record<string, string> {
  return { ...herdar(base), LIMA_HOME: c.limaHome };
}

/** `versao` é o process.getSystemVersion() do Electron ("13.6.1"). Ilegível conta como não suportado. */
export function macosSuportado(versao: string): boolean {
  const m = /^(\d+)(?:\.|$)/.exec(versao.trim());
  return m !== null && Number(m[1]) >= MACOS_MINIMO;
}

export function archDoLima(arch: ArchMac): "aarch64" | "x86_64" {
  return arch === "arm64" ? "aarch64" : "x86_64";
}

export type CamposYaml = { imagem: string; arch: ArchMac; memoriaGiB: number; cpus: number; socket: string; discoGiB?: number };

/**
 * Caminho que entra entre aspas no yaml: absoluto e sem aspas, barra invertida, chave (o Lima trata hostSocket e
 * location como template Go: um `{{` viraria expressão) nem caractere de controle ou separador de linha (quebra de
 * linha, tab, NUL, U+0085, U+2028/2029: o yaml recusa ou dobra).
 */
function caminhoSeguro(nome: string, valor: string): string {
  if (!valor.startsWith("/") || /["\\{}\p{Cc}\u2028\u2029]/u.test(valor)) throw new Error(`${nome} inválido para o lima.yaml: ${valor}`);
  return valor;
}

function inteiroPositivo(nome: string, valor: number): number {
  if (!Number.isInteger(valor) || valor < 1) throw new Error(`${nome} inválido para o lima.yaml: ${valor}`);
  return valor;
}

/** Troca os @@CAMPOS@@ do desktop/vm-local/lima.yaml. Sobrou campo ou valor estranho: erro, nunca um yaml torto. */
export function gerarLimaYaml(modelo: string, campos: CamposYaml): string {
  const valores: Record<string, string> = {
    ARCH: archDoLima(campos.arch),
    IMAGEM: caminhoSeguro("imagem", campos.imagem),
    CPUS: String(inteiroPositivo("cpus", campos.cpus)),
    MEMORIA: `${inteiroPositivo("memória", campos.memoriaGiB)}GiB`,
    DISCO: `${inteiroPositivo("disco", campos.discoGiB ?? DISCO_GIB)}GiB`,
    SOCKET: caminhoSeguro("socket", campos.socket),
  };
  const saida = modelo.replace(/@@([A-Z]+)@@/g, (todo, nome: string) => {
    const v = valores[nome];
    if (v === undefined) throw new Error(`campo desconhecido no lima.yaml: ${todo}`);
    return v;
  });
  return saida;
}

export type StatusInstancia = "ausente" | "parada" | "ligada" | "quebrada";

/** `limactl list --format json`: um objeto por linha. Só a instância do nod interessa. */
export function lerStatus(saida: string): StatusInstancia {
  for (const linha of saida.split("\n")) {
    if (!linha.trim()) continue;
    let item: unknown;
    try { item = JSON.parse(linha); } catch { continue; }
    if (typeof item !== "object" || item === null) continue;
    const { name, status } = item as { name?: unknown; status?: unknown };
    if (name !== INSTANCIA) continue;
    if (status === "Running") return "ligada";
    if (status === "Stopped") return "parada";
    return "quebrada";
  }
  return "ausente";
}

/** O que foi usado para criar a instância: mudou a versão ou a arquitetura, recria (o disco de dados fica). */
export type RegistroInstancia = { versao: string; arch: ArchMac; memoriaGiB: number; cpus: number };

export type Resultado = { codigo: number; saida: string; erro: string };
export type Executar = (bin: string, args: readonly string[], env: Record<string, string>) => Promise<Resultado>;

/** Pergunta ao socket e fecha: true se o supervisor devolveu uma linha dentro do prazo. */
export type Conectar = (socket: string, prazoMs: number) => Promise<boolean>;

/** definido em 2026-10-24 (ADR-127 §2): 2 s para o supervisor responder no socket encaminhado. */
export const PRAZO_SUPERVISOR_MS = 2_000;

/**
 * QA da NOD-93: aceitar o connect não prova nada. O encaminhamento do Lima (ssh) e o .socket do systemd aceitam com o
 * supervisor morto ou congelado. Por isso a sonda manda uma linha que não é JSON; o supervisor responde com um
 * `resultado` falhou, sem log e sem efeito (servirControle), e só essa resposta conta.
 */
export const conectarSocket: Conectar = (socket, prazoMs) =>
  new Promise((resolve) => {
    const s = createConnection(socket);
    const fim = (ok: boolean) => { clearTimeout(t); s.destroy(); resolve(ok); };
    const t = setTimeout(() => fim(false), prazoMs);
    s.once("connect", () => s.write("sonda\n"));
    s.once("data", () => fim(true));
    s.once("error", () => fim(false));
    s.once("close", () => fim(false));
  });

export const executarProcesso: Executar = (bin, args, env) =>
  new Promise((resolve) => {
    execFile(bin, [...args], { env, maxBuffer: 8 * 1024 * 1024, timeout: 15 * 60_000 }, (erro, saida, err) => {
      const codigo = erro ? (typeof erro.code === "number" ? erro.code : 1) : 0;
      resolve({ codigo, saida: String(saida), erro: String(err || (erro && !saida && !err ? erro.message : "")) });
    });
  });

export type DepsRuntime = {
  dadosApp: string;
  recursos: string;
  /** process.env: só HOME, USER, LOGNAME, TMPDIR e LANG passam adiante. */
  ambiente: Record<string, string | undefined>;
  executar?: Executar;
  conectar?: Conectar;
  /** Troca o `.img.zst` do cache pelo raw que o Lima recebe; injetado nos testes. */
  descompactar?: (zst: string) => Promise<string>;
};

/** Pedaço em que o raw é conferido: só zeros vira buraco no arquivo em vez de bloco gravado. */
const BLOCO_ESPARSO = 64 * 1024;
const ZEROS = Buffer.alloc(BLOCO_ESPARSO);

/**
 * definido em 2026-10-29 (NOD-93, 1º ensaio no Mac): o Lima só descompacta `.zst` chamando o `zstd` do PATH, que o
 * macOS não traz (e o PATH do limactl é só o do sistema): o `create` morria com `decompressor "zstd" not found`. O app
 * descompacta antes, com o zstd do próprio Node, para `<disco>.img` ao lado do `.zst`, esparso (o disco base é quase
 * todo zero: 8 GiB de raw, ~2 GiB de dados). Grava em `.parcial` e só renomeia no fim; um `.img` que já existe é de
 * uma descompactação completa e é reaproveitado. O `.zst` fica: é ele que o sha256 do app confere.
 */
export async function descompactarDisco(zst: string): Promise<string> {
  if (!zst.endsWith(".zst")) return zst;
  const raw = zst.slice(0, -".zst".length);
  if (await existe(raw)) return raw;
  const parcial = `${raw}.parcial`;
  const arquivo = await open(parcial, "w");
  let posicao = 0;
  try {
    for await (const pedaco of createReadStream(zst).pipe(createZstdDecompress()) as AsyncIterable<Buffer>) {
      for (let i = 0; i < pedaco.length; i += BLOCO_ESPARSO) {
        const bloco = pedaco.subarray(i, i + BLOCO_ESPARSO);
        if (!bloco.equals(ZEROS.subarray(0, bloco.length))) await arquivo.write(bloco, 0, bloco.length, posicao);
        posicao += bloco.length;
      }
    }
    await arquivo.truncate(posicao);
  } catch (e) {
    await arquivo.close();
    await rm(parcial, { force: true });
    throw new FalhaVmLocal("descompactar o disco", e instanceof Error ? e.message : String(e));
  }
  await arquivo.close();
  await rename(parcial, raw);
  return raw;
}

export type PedidoLigar = { imagem: string; versao: string; arch: ArchMac; memoriaGiB: number; cpus: number };

export class FalhaVmLocal extends Error {
  readonly etapa: string;
  readonly detalhe: string;
  constructor(etapa: string, detalhe: string) {
    super(`vm local: ${etapa} falhou${detalhe ? `: ${detalhe}` : ""}`);
    this.etapa = etapa;
    this.detalhe = detalhe;
  }
}

async function existe(caminho: string): Promise<boolean> {
  try { await stat(caminho); return true; } catch { return false; }
}

async function lerRegistro(caminho: string): Promise<RegistroInstancia | null> {
  try { return JSON.parse(await readFile(caminho, "utf8")) as RegistroInstancia; } catch { return null; }
}

export function criarRuntimeVmLocal(deps: DepsRuntime) {
  const c = caminhosVmLocal(deps.dadosApp);
  const b = binariosVmLocal(deps.recursos);
  const executar = deps.executar ?? executarProcesso;
  const descompactar = deps.descompactar ?? descompactarDisco;
  const envLima = ambienteLima(c, deps.ambiente);

  async function limactl(etapa: string, ...args: string[]): Promise<Resultado> {
    const r = await executar(b.limactl, args, envLima);
    if (r.codigo !== 0) throw new FalhaVmLocal(etapa, r.erro.trim().split("\n").slice(-3).join(" | "));
    return r;
  }

  async function status(): Promise<StatusInstancia> {
    if (!(await existe(c.instancia))) return "ausente";
    return lerStatus((await limactl("listar", "list", "--format", "json")).saida);
  }

  return {
    caminhos: c,
    binarios: b,
    status,

    /** Cria (ou recria, se a versão mudou) e liga. Idempotente: com a VM ligada e na versão, não faz nada. */
    async ligar(p: PedidoLigar): Promise<void> {
      if (!socketsCabem(c)) throw new FalhaVmLocal("caminho", `a pasta ${c.limaHome} é longa demais para os sockets do Lima`);
      await mkdir(c.limaHome, { recursive: true });
      let atual = await status();
      const registro = await lerRegistro(c.registro);
      if (atual !== "ausente" && (registro?.versao !== p.versao || registro.arch !== p.arch || atual === "quebrada")) {
        // Disco base novo: a instância é refeita; o nod-dados (perfis, cookies, chaves) só é desanexado.
        if (atual === "ligada") await limactl("parar", "stop", INSTANCIA);
        await limactl("apagar", "delete", "--force", INSTANCIA);
        atual = "ausente";
      }
      if (!(await existe(c.discoDados))) await limactl("criar o disco de dados", "disk", "create", DISCO_DADOS, "--size", `${DADOS_GIB}GiB`, "--format", "raw");
      if (atual === "ausente") {
        const modelo = await readFile(b.modelo, "utf8");
        const imagem = await descompactar(p.imagem);
        await writeFile(c.yaml, gerarLimaYaml(modelo, { imagem, arch: p.arch, memoriaGiB: p.memoriaGiB, cpus: p.cpus, socket: c.socket }));
        await limactl("criar", "create", `--name=${INSTANCIA}`, "--tty=false", c.yaml);
        // O Lima copiou o disco para a instância (basedisk): o raw do cache sai; recriar descompacta de novo.
        if (imagem !== p.imagem) await rm(imagem, { force: true });
        atual = "parada";
      } else if (registro && (registro.memoriaGiB !== p.memoriaGiB || registro.cpus !== p.cpus)) {
        if (atual === "ligada") await limactl("parar", "stop", INSTANCIA);
        await limactl("ajustar", "edit", "--tty=false", `--memory=${p.memoriaGiB}`, `--cpus=${p.cpus}`, INSTANCIA);
        atual = "parada";
      }
      await writeFile(c.registro, JSON.stringify({ versao: p.versao, arch: p.arch, memoriaGiB: p.memoriaGiB, cpus: p.cpus } satisfies RegistroInstancia));
      if (atual !== "ligada") await limactl("ligar", "start", "--tty=false", INSTANCIA);
    },

    /** Dormir: desliga a VM; disco base e de dados ficam. */
    async parar(): Promise<void> {
      if ((await status()) === "ligada") await limactl("parar", "stop", INSTANCIA);
    },

    /** O supervisor do convidado aceita conexão no socket encaminhado (vm/ctl.sock) em até 2 s? */
    async supervisorResponde(): Promise<boolean> {
      return (deps.conectar ?? conectarSocket)(c.socket, PRAZO_SUPERVISOR_MS);
    },
  };
}

export type RuntimeVmLocal = ReturnType<typeof criarRuntimeVmLocal>;
