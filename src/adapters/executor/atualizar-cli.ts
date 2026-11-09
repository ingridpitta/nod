import { tmpdir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import { chaveNegada } from "../../domain/ambiente-executor.ts";
import { falhaPorPermissao } from "../../domain/saida-do-cli.ts";
import { compararVersoes } from "./flag-floors.ts";
import { executarColetando } from "./processo.ts";

/**
 * Roda o atualizador de um CLI de IA (definido em 2026-10-23, NOD-9, plano do Arquiteto de 20/10, passo 5): hoje o
 * `claude update`. Quem escolhe o binário e os argumentos é o app (desktop/ia-mac.ts › comandoDeAtualizar); aqui só se
 * roda, com prazo, e se lê a versão antes e depois. Regras:
 *  - ambiente limpo: sem ANTHROPIC_*, CLAUDE_CODE_*, NOD_*, OPENAI_* (as do nod e as de conta não servem a um update) e
 *    sem DISABLE_AUTOUPDATER, que faria o CLI recusar o pedido;
 *  - o prazo (3 min) mata com SIGKILL (executarColetando) e vira `tempo_esgotado`;
 *  - uma por binário: dois pedidos ao mesmo binário esperam o mesmo processo;
 *  - o texto do CLI nunca sai daqui: só o código (`resultado`); o detalhe fica no log de quem chama.
 */
export const PRAZO_ATUALIZAR_CLI_MS = 180_000;
/** O fim da saída basta para classificar (o erro sai por último). */
const SAIDA_MAX = 65_536;

export type ResultadoAtualizar = "ok" | "falhou" | "tempo_esgotado" | "versao_ilegivel" | "nao_suportado" | "sem_permissao" | "sem_espaco" | "sem_internet";

export type FimDaAtualizacao = {
  resultado: ResultadoAtualizar;
  antes: string | null;
  depois: string | null;
  /** A versão depois de atualizar chegou ao alvo. `ok` sem `atende` = subiu pouco (a tela diz "insuficiente"). */
  atende: boolean;
};

export type PedidoAtualizarCli = {
  bin: string;
  /** null = o CLI não tem atualizador conhecido (o Codex, até a NOD-8). */
  args: readonly string[] | null;
  env: Readonly<Record<string, string | undefined>>;
  alvo: string;
  prazoMs?: number;
  lerVersao(bin: string): Promise<string | null>;
};

/** O jeito de rodar (executarColetando; os testes passam um falso). */
export type ExecutarAtualizador = (o: { bin: string; args: readonly string[]; env: Record<string, string>; cwd: string; timeoutMs: number }) => ReturnType<typeof executarColetando>;

const PREFIXOS_FORA = ["ANTHROPIC_", "CLAUDE_CODE_", "NOD_", "OPENAI_"] as const;

/** O ambiente do atualizador: o de quem chama, sem as variáveis do nod e das contas. */
export function ambienteDoAtualizador(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || chaveNegada(k) || PREFIXOS_FORA.some((p) => k.startsWith(p)) || k === "CODEX_API_KEY" || k === "DISABLE_AUTOUPDATER") continue;
    out[k] = v;
  }
  return out;
}

/** O código da falha pela saída do atualizador (npm ou nativo). */
export function classificarFalhaAtualizar(saida: string): Exclude<ResultadoAtualizar, "ok" | "tempo_esgotado" | "versao_ilegivel" | "nao_suportado"> {
  const t = stripVTControlCharacters(saida);
  if (falhaPorPermissao(t)) return "sem_permissao";
  if (/\bENOSPC\b|no space left/i.test(t)) return "sem_espaco";
  if (/\bENOTFOUND\b|\bEAI_AGAIN\b|\bENETUNREACH\b|\bECONNREFUSED\b|\bECONNRESET\b|\bETIMEDOUT\b|getaddrinfo|network (?:request|error)/i.test(t)) return "sem_internet";
  return "falhou";
}

export function criarAtualizadorDeCli(executar: ExecutarAtualizador = executarColetando): (p: PedidoAtualizarCli) => Promise<FimDaAtualizacao> {
  const emCurso = new Map<string, Promise<FimDaAtualizacao>>();
  async function rodar(p: PedidoAtualizarCli): Promise<FimDaAtualizacao> {
    const antes = await p.lerVersao(p.bin).catch(() => null);
    const chegou = (v: string | null) => v !== null && compararVersoes(v, p.alvo) >= 0;
    if (!p.args) return { resultado: "nao_suportado", antes, depois: antes, atende: chegou(antes) };
    const r = await executar({ bin: p.bin, args: p.args, env: ambienteDoAtualizador(p.env), cwd: tmpdir(), timeoutMs: p.prazoMs ?? PRAZO_ATUALIZAR_CLI_MS });
    const depois = await p.lerVersao(p.bin).catch(() => null);
    if (r.estourouTempo) return { resultado: "tempo_esgotado", antes, depois, atende: chegou(depois) };
    if (r.erroSpawn || r.exitCode !== 0) {
      const saida = `${r.stdout}\n${r.stderr}${r.erroSpawn ? `\n${r.erroSpawn.message}` : ""}`.slice(-SAIDA_MAX);
      return { resultado: classificarFalhaAtualizar(saida), antes, depois, atende: chegou(depois) };
    }
    if (depois === null) return { resultado: "versao_ilegivel", antes, depois, atende: false };
    return { resultado: "ok", antes, depois, atende: chegou(depois) };
  }
  return (p) => {
    const atual = emCurso.get(p.bin);
    if (atual) return atual;
    const nova = rodar(p).finally(() => emCurso.delete(p.bin));
    emCurso.set(p.bin, nova);
    return nova;
  };
}

/** O atualizador do processo (uma fila por binário para o app inteiro). */
export const atualizarCli = criarAtualizadorDeCli();
