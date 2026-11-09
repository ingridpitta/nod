import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compararVersoes } from "../src/adapters/executor/flag-floors.ts";
import { classificarFalhaAtualizar } from "../src/adapters/executor/atualizar-cli.ts";
import type { IaDesktop } from "../src/contracts/desktop.ts";
import type { FimDoPasso, PassoFeito } from "./atualizador-ias.ts";

/**
 * A janela de senha do macOS para atualizar um CLI instalado como root (definido em 2026-10-23, NOD-9 PR3, plano do
 * Arquiteto de 22/10). É o último passo, só num clique, depois de o oficial e a reserva falharem por permissão. Regras:
 *  - o script do osascript é FIXO (SCRIPT_ELEVAR); os argumentos vão por `argv` e cada um passa por `quoted form of`
 *    dentro do AppleScript. Nada vindo da pessoa ou do CLI é interpolado no texto do script;
 *  - um argumento com quebra de linha ou NUL é recusado antes de abrir a janela;
 *  - o comando é `/bin/sh -c <SCRIPT_ROOT fixo> nod-atualizar <PATH> <realpath do bin> update`. O HOME é criado PELO
 *    root (`mktemp -d` em /tmp, 0700 do root) e apagado por ele no fim, com ou sem prazo esgotado: nenhum processo da
 *    pessoa grava ali um `.npmrc` que o npm como root leria, e o cache do npm (`.npm/_cacache`, de root) não sobra. O
 *    resto do ambiente é `env -i`: nada da pessoa;
 *  - só eleva binário de root: o realpath do bin e todas as pastas acima são do uid 0 e não graváveis por grupo/outros;
 *    as pastas do PATH passam pela mesma checagem e entram pelo REALPATH (deduplicado): um symlink da pessoa
 *    (`~/.local/bin` → `/usr/local/bin`) passaria na checagem e poderia ser trocado durante a janela. Pasta da pessoa no
 *    caminho = não eleva;
 *  - limite conhecido: a checagem olha dono e bits de modo, não a ACL do macOS (`chmod +a`). Uma ACL que dê escrita à
 *    pessoa numa pasta de root passaria. As pastas de sistema não vêm com ACL de escrita; registrado como limite;
 *  - prazo de 5 min: vira `tempo_esgotado`, sem matar o processo de root (o app não tem como, nem deve). A janela conta
 *    como aberta até o osascript FECHAR, não até o prazo: um clique depois do prazo não abre uma 2ª;
 *  - `-128` (a pessoa cancelou) vira `recusou`;
 *  - o texto do osascript nunca vai à tela, só o código; depois de rodar, confere que ~/.claude e ~/.claude.json
 *    continuam da pessoa (log de aviso se o dono mudou ou se um deles, que não existia, nasceu de root).
 */
export const PRAZO_ELEVAR_MS = 5 * 60_000;

const NOME_DA_IA: Record<IaDesktop, string> = { "claude-cli": "Claude Code", "codex-cli": "Codex" };

/** O AppleScript fixo de cada IA (só o nome no aviso muda, e vem desta tabela). */
export function scriptElevar(ia: IaDesktop): string[] {
  return [
    "on run argv",
    'set c to ""',
    "repeat with a in argv",
    'set c to c & quoted form of (a as text) & " "',
    "end repeat",
    `do shell script c with administrator privileges with prompt "O nod precisa da sua senha para atualizar o ${NOME_DA_IA[ia]}."`,
    "end run",
  ];
}

/** As pastas de sistema que podem entrar no PATH do comando elevado (cada uma ainda passa pela checagem de dono). */
export const PASTAS_DO_PATH = ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] as const;

export type InfoDoArquivo = { uid: number; mode: number };

/**
 * O que o root roda (uma linha, sem interpolação: os valores chegam em $1, $2 e no resto de argv). `mktemp -d` cria a
 * pasta 0700 do root com nome imprevisível; o `rm` no fim também é de root.
 */
export const SCRIPT_ROOT = 'p="$1"; b="$2"; shift 2; h=$(/usr/bin/mktemp -d /tmp/nod-atualizar.XXXXXX) || exit 70; /usr/bin/env -i HOME="$h" PATH="$p" npm_config_cache="$h/.npm" "$b" "$@"; s=$?; /bin/rm -rf "$h"; exit $s';

/** O resultado do osascript; `fechou` resolve quando o processo termina de verdade (depois do prazo, inclusive). */
export type ResultadoOsascript = { codigo: number | null; stderr: string; estourou: boolean; fechou: Promise<void> };

export type DepsElevar = {
  /** Roda o osascript; `estourou` = passou do prazo (o processo NÃO é morto). */
  executar(bin: string, args: readonly string[], prazoMs: number): Promise<ResultadoOsascript>;
  info(caminho: string): Promise<InfoDoArquivo | null>;
  realpath(caminho: string): Promise<string>;
  lerVersao(bin: string): Promise<string | null>;
  /** A pasta da pessoa (a conferência de ~/.claude e ~/.claude.json). */
  home: string;
  registrar(evento: string, campos: Record<string, string | number | boolean | null>): void;
  prazoMs?: number;
};

/** O argumento que não pode entrar no osascript (quebra de linha ou NUL). */
export function argumentoHostil(a: string): boolean {
  return a.includes("\n") || a.includes("\r") || a.includes("\0");
}

/** O caminho e todas as pastas acima são de root e ninguém além dele escreve. */
export async function soDeRoot(caminho: string, info: DepsElevar["info"]): Promise<boolean> {
  let atual = caminho;
  for (;;) {
    const i = await info(atual);
    if (!i || i.uid !== 0 || (i.mode & 0o022) !== 0) return false;
    const acima = dirname(atual);
    if (acima === atual) return true;
    atual = acima;
  }
}

/** O passo de senha só cabe depois de o oficial dar sem_permissao e a reserva sem_permissao ou sem_npm. */
export function cabeAprovacao(anteriores: readonly PassoFeito[]): boolean {
  const oficial = anteriores.find((p) => p.tipo === "oficial");
  const reserva = anteriores.find((p) => p.tipo === "reserva");
  return oficial?.fim.resultado === "sem_permissao" && (reserva?.fim.resultado === "sem_permissao" || reserva?.fim.resultado === "sem_npm");
}

/** Os argumentos do osascript: o script fixo em linhas `-e` e o comando em argv. */
export function argsDoOsascript(ia: IaDesktop, comando: readonly string[]): string[] {
  return [...scriptElevar(ia).flatMap((l) => ["-e", l]), "--", ...comando];
}

export type Elevador = {
  /** Há uma janela de senha aberta agora (uma por vez). */
  aberta(): boolean;
  atualizar(o: { ia: IaDesktop; bin: string; args: readonly string[]; alvo: string }): Promise<FimDoPasso>;
};

export function criarElevador(d: DepsElevar): Elevador {
  let aberta = false;

  async function donos(): Promise<(number | null)[]> {
    return Promise.all([join(d.home, ".claude"), join(d.home, ".claude.json")].map(async (p) => (await d.info(p))?.uid ?? null));
  }

  async function atualizar(o: { ia: IaDesktop; bin: string; args: readonly string[]; alvo: string }): Promise<FimDoPasso> {
    const antes = await d.lerVersao(o.bin).catch(() => null);
    const chegou = (v: string | null) => v !== null && compararVersoes(v, o.alvo) >= 0;
    const nao = (motivo: string): FimDoPasso => {
      d.registrar("ia_atualizacao", { ia: o.ia, caminho: "aprovacao", elevou: false, motivo });
      return { resultado: "sem_permissao", antes, depois: antes, atende: false };
    };
    if (aberta) return nao("janela_aberta");
    const real = await d.realpath(o.bin).catch(() => null);
    if (!real) return nao("bin_sumiu");
    if (!(await soDeRoot(real, d.info))) return nao("bin_fora_de_root");
    // O PATH leva o realpath já checado (nunca o caminho com symlink), sem repetir.
    const pastas: string[] = [];
    for (const p of [dirname(o.bin), ...PASTAS_DO_PATH]) {
      const r = await d.realpath(p).catch(() => null);
      if (r && !pastas.includes(r) && (await soDeRoot(r, d.info))) pastas.push(r);
    }
    const comando = ["/bin/sh", "-c", SCRIPT_ROOT, "nod-atualizar", pastas.join(":"), real, ...o.args];
    if (comando.some(argumentoHostil)) return nao("argumento_hostil");
    const donosAntes = await donos();
    aberta = true;
    let r: ResultadoOsascript;
    try {
      r = await d.executar("/usr/bin/osascript", argsDoOsascript(o.ia, comando), d.prazoMs ?? PRAZO_ELEVAR_MS);
    } catch (err) {
      aberta = false;
      throw err;
    }
    // Só fecha quando o processo fecha: depois do prazo a janela da senha ainda pode estar na tela.
    void r.fechou.finally(() => { aberta = false; });
    const donosDepois = await donos();
    // Mudou de dono, ou nasceu de root (não existia antes): os dois são aviso.
    if (donosAntes.some((u, i) => (u !== null && u !== donosDepois[i]) || (u === null && donosDepois[i] === 0))) d.registrar("ia_atualizacao_dono_mudou", { ia: o.ia, caminho: "aprovacao" });
    const depois = await d.lerVersao(o.bin).catch(() => null);
    const fim = (resultado: FimDoPasso["resultado"]): FimDoPasso => {
      d.registrar("ia_atualizacao", { ia: o.ia, caminho: "aprovacao", elevou: true, resultado, codigo: r.codigo });
      return { resultado, antes, depois, atende: chegou(depois) };
    };
    if (r.estourou) return fim("tempo_esgotado");
    if (r.codigo !== 0 && /\(-128\)/.test(r.stderr)) return fim("recusou");
    if (r.codigo !== 0) return fim(classificarFalhaAtualizar(r.stderr));
    if (depois === null) return fim("versao_ilegivel");
    return fim("ok");
  }

  return { aberta: () => aberta, atualizar };
}

/**
 * O executar de verdade: o spawn com argv (sem shell) e um prazo que só para de esperar. `fechou` resolve no `close`
 * (ou no `error` do spawn), mesmo depois do prazo.
 */
export function executarOsascript(bin: string, args: readonly string[], prazoMs: number): Promise<ResultadoOsascript> {
  return new Promise((resolve) => {
    let fechar!: () => void;
    const fechou = new Promise<void>((r) => { fechar = r; });
    const filho = spawn(bin, [...args], { stdio: ["ignore", "ignore", "pipe"], shell: false });
    let stderr = "";
    let feito = false;
    const acabar = (v: Omit<ResultadoOsascript, "fechou">) => {
      if (feito) return;
      feito = true;
      clearTimeout(prazo);
      resolve({ ...v, fechou });
    };
    const prazo = setTimeout(() => acabar({ codigo: null, stderr, estourou: true }), prazoMs);
    filho.stderr?.on("data", (b: Buffer) => { stderr = `${stderr}${b.toString("utf8")}`.slice(-16_384); });
    filho.on("error", (err) => { acabar({ codigo: null, stderr: err.message, estourou: false }); fechar(); });
    filho.on("close", (codigo) => { acabar({ codigo, stderr, estourou: false }); fechar(); });
  });
}

/** As dependências reais (o fs do Node); quem chama dá a versão, o log e a pasta da pessoa. */
export function depsReaisDoElevador(o: Pick<DepsElevar, "lerVersao" | "registrar" | "home">): DepsElevar {
  return {
    ...o,
    executar: executarOsascript,
    info: async (p) => {
      const s = await stat(p).catch(() => null);
      return s ? { uid: s.uid, mode: s.mode } : null;
    },
    realpath: (p) => realpath(p),
  };
}
