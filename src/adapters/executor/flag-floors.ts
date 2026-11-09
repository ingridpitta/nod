import type { EpochMs } from "../../contracts/ids.ts";
import type { Inventario } from "../../contracts/inventario.ts";
import { motivoCliAntigo } from "../../domain/cli-antigo.ts";

/**
 * Flag floors (ADR-014 invertido): o CLI é o da pessoa, em 19 versões diferentes, e uma flag
 * desconhecida faz TODO turno falhar com erro de argumento. A tabela é conferida contra a versão
 * que a sonda leu (`claude --version`) ANTES de montar os args; abaixo do piso o driver recusa com
 * ErroDeDominio('executor_indisponivel', cause 'cli_antigo') em vez de gastar um turno.
 *
 * definido em 2026-09-16: o piso de TODAS as flags é 2.1.272 — a única versão sondada (mapa-cli).
 * Baixar um piso exige sondar a versão mais antiga; ninguém sondou. Como segunda prova, quando o
 * `--help` está disponível, uma flag listada nele passa mesmo abaixo do piso (o help é a própria
 * CLI dizendo o que aceita). `--max-turns` é a exceção: medido em 2026-09-16, não aparece no
 * `--help` de 2.1.272 e mesmo assim foi aceita (sonda s3) — só o piso a confere.
 */
export const FLAG_FLOORS = {
  "--strict-mcp-config": { piso: "2.1.272", ocultaNoHelp: false },
  "--setting-sources": { piso: "2.1.272", ocultaNoHelp: false },
  "--mcp-config": { piso: "2.1.272", ocultaNoHelp: false },
  "--tools": { piso: "2.1.272", ocultaNoHelp: false },
  "--allowedTools": { piso: "2.1.272", ocultaNoHelp: false },
  "--include-partial-messages": { piso: "2.1.272", ocultaNoHelp: false },
  "--session-id": { piso: "2.1.272", ocultaNoHelp: false },
  "--resume": { piso: "2.1.272", ocultaNoHelp: false },
  "--permission-mode": { piso: "2.1.272", ocultaNoHelp: false },
  "--append-system-prompt": { piso: "2.1.272", ocultaNoHelp: false },
  "--output-format": { piso: "2.1.272", ocultaNoHelp: false },
  "--verbose": { piso: "2.1.272", ocultaNoHelp: false },
  "--model": { piso: "2.1.272", ocultaNoHelp: false },
  // definido em 2026-09-18: continua na tabela mesmo tendo saído de FLAGS_DO_TURNO — sonda.ts ainda
  // usa --max-turns 1, onde o teto de passos é o desejado (turno de prova barato).
  "--max-turns": { piso: "2.1.272", ocultaNoHelp: true },
  // definido em 2026-09-18: sondadas na 2.1.276, onde o confinamento foi medido de fato — leitura
  // fora das pastas permitidas negada pelo CLI e CLAUDE.md do projeto ignorado. Piso na versão
  // sondada, não antes: o driver só aponta o cwd para a pasta da pessoa se o help trouxer a flag.
  "--restricted": { piso: "2.1.276", ocultaNoHelp: false },
  "--add-dir": { piso: "2.1.276", ocultaNoHelp: false },
  /**
   * definido em 2026-09-18: compacta o contexto em vez de deixar a tarefa longa bater no limite,
   * agora que o turno não é mais cortado por contagem de passos. Piso na versão sondada AQUI
   * (2.1.276, `--help` conferido); o openmausbot registra 2.1.122 como primeira aparição, mas essa
   * versão não foi sondada nesta máquina. Flag CONDICIONAL: fica fora de FLAGS_DO_TURNO e o gate
   * real é o `--help` lido no turno.
   */
  "--autocompact": { piso: "2.1.276", ocultaNoHelp: false },
  /** definido em 2026-09-28 (0037): o esforço do bot. Condicional como --autocompact; piso na versão sondada aqui. */
  "--effort": { piso: "2.1.284", ocultaNoHelp: false },
  /**
   * definido em 2026-10-06 (NOD-183, ADR-080): o prompt de texto em `--system-prompt` com o marcador de cache. Sondada
   * em 2026-10-06 na 2.1.290 (scripts/sonda-system-prompt-texto.ts): cache do 2º turno de 16% para 75% e os quatro
   * comportamentos iguais. Condicional: fica fora de FLAGS_DO_TURNO; sem ela no help ou abaixo do piso, o driver
   * segue no `--append-system-prompt`.
   */
  "--system-prompt": { piso: "2.1.290", ocultaNoHelp: false },
  /**
   * definido em 2026-10-06 (NOD-185, ADR-080): `off` faz o CLI renderizar o prompt de novo a cada request, em vez de
   * reenviar no `--resume` o gravado no 1º turno. Sondada na 2.1.290: com `off` o 2º e o 3º turno da sessão veem a parte
   * volátil nova e o cache fica em 71–72%. Condicional como `--system-prompt`: sem ela no help ou abaixo do piso, o
   * turno sai como antes.
   */
  "--system-prompt-snapshot": { piso: "2.1.290", ocultaNoHelp: false },
  /**
   * definido em 2026-10-07 (ADR-083, #193, rede de 2 min): a cópia da sessão. Listada no `claude --help` da versão do
   * piso (revisão de engenharia de 07/10); o turno que pede o fork confere a flag no help e recusa sem ela. O piso é o
   * PISO_CLI de hoje: abaixo dele nenhum turno roda.
   */
  "--fork-session": { piso: "2.1.290", ocultaNoHelp: false },
} as const satisfies Record<string, { piso: string; ocultaNoHelp: boolean }>;

export type FlagComPiso = keyof typeof FLAG_FLOORS;

export type ConferenciaFloors = { ok: true } | { ok: false; motivo: "cli_antigo"; abaixo: FlagComPiso[] };

/** "2.1.272 (Claude Code)" → "2.1.272"; "codex-cli 0.155.0-alpha.2.6" → "0.155.0-alpha.2.6" (NOD-171: o sufixo fica, senão o
 * alpha passaria no piso da final); null quando não há x.y.z. */
export function extrairVersao(saidaVersion: string): string | null {
  const m = /(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z][0-9A-Za-z.-]*)?/.exec(saidaVersion);
  return m ? `${m[1]}.${m[2]}.${m[3]}${m[4] ?? ""}` : null;
}

const comparar = (x: number, y: number): -1 | 0 | 1 => (x < y ? -1 : x > y ? 1 : 0);

/**
 * Compara x.y.z numericamente (não como string): "2.1.272" > "2.1.9". O pré-release segue o semver (NOD-171): vem antes
 * da final ("0.155.0-alpha.2.6" < "0.155.0"), e entre dois pré-releases cada parte numérica compara como número.
 */
export function compararVersoes(a: string, b: string): -1 | 0 | 1 {
  const [nucleoA = "", preA] = a.split(/-(.*)/s);
  const [nucleoB = "", preB] = b.split(/-(.*)/s);
  const pa = nucleoA.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = nucleoB.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const c = comparar(pa[i] ?? 0, pb[i] ?? 0);
    if (c !== 0) return c;
  }
  if (!preA || !preB) return preA ? -1 : preB ? 1 : 0;
  const qa = preA.split(".");
  const qb = preB.split(".");
  for (let i = 0; i < Math.max(qa.length, qb.length); i += 1) {
    const x = qa[i];
    const y = qb[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    const c = nx !== null && ny !== null ? comparar(nx, ny) : nx !== null ? -1 : ny !== null ? 1 : comparar(x < y ? 0 : x > y ? 2 : 1, 1);
    if (c !== 0) return c;
  }
  return 0;
}

/** Toda opção longa que o `--help` lista (`--allowedTools, --allowed-tools <tools...>` → as duas). */
export function flagsListadasNoHelp(help: string): string[] {
  const achadas = new Set<string>();
  for (const m of help.matchAll(/(?:^|[\s,])(--[a-zA-Z][a-zA-Z0-9-]*)/g)) {
    if (m[1]) achadas.add(m[1]);
  }
  return [...achadas];
}

export function conferirFloors(entrada: { versao: string; flags: readonly FlagComPiso[]; flagsNoHelp?: readonly string[] | null }): ConferenciaFloors {
  const abaixo: FlagComPiso[] = [];
  for (const flag of entrada.flags) {
    const regra = FLAG_FLOORS[flag];
    if (compararVersoes(entrada.versao, regra.piso) >= 0) continue;
    if (!regra.ocultaNoHelp && entrada.flagsNoHelp?.includes(flag)) continue;
    abaixo.push(flag);
  }
  return abaixo.length === 0 ? { ok: true } : { ok: false, motivo: "cli_antigo", abaixo };
}

/**
 * Versão mínima de cada CLI (NOD-171, emenda da ADR-014/019): a versão em que as rodadas A, B e C do UAT passaram
 * (docs/uat-harnesses-e-modelos.md). Sem teto. Abaixo dela o harness fica `ausente` com `causa: "cli_antigo"`, nunca
 * "não encontrado": uma release estável só promete o que foi testado. Muda com release, como FLAG_FLOORS.
 */
export const PISO_CLI = {
  "claude-cli": "2.1.290",
  "codex-cli": "0.159.0",
} as const satisfies Record<string, string>;

export type ConferenciaPisoCli = { ok: true } | { ok: false; versao: string; minima: string };

/**
 * O inventário de um CLI abaixo do piso (`ausente` + `cli_antigo`, com as duas versões), ou null quando ele passa.
 * `nome` é o que a pessoa lê ("Claude Code", "Codex").
 */
export function inventarioAbaixoDoPiso(cli: keyof typeof PISO_CLI, versao: string, nome: string, em: EpochMs): Inventario | null {
  const piso = conferirPisoCli(cli, versao);
  return piso.ok ? null : { estado: "ausente", motivo: motivoCliAntigo(nome, piso.versao, piso.minima), causa: "cli_antigo", versao: piso.versao, minima: piso.minima, em };
}

/** A versão lida (`extrairVersao`) contra o piso do CLI. Sem versão legível não recusa: o `--version` que falhou já é `ausente`. */
export function conferirPisoCli(cli: keyof typeof PISO_CLI, versao: string): ConferenciaPisoCli {
  const minima = PISO_CLI[cli];
  if (!versao || compararVersoes(versao, minima) >= 0) return { ok: true };
  return { ok: false, versao, minima };
}
