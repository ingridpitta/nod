import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESPOSTA_TESTE_IA_MAX } from "../../contracts/desktop.ts";
import type { CausaSemIa, Inventario } from "../../contracts/inventario.ts";
import { motivoSondaLenta } from "../../domain/sonda-lenta.ts";
import { faltaNode, motivoSemNode } from "../../domain/saida-do-cli.ts";
import type { EventoStream } from "../../contracts/turno.ts";
import { montarAmbiente } from "../../domain/ambiente-executor.ts";
import { causaDaFalhaDeConta, respostaDoTeste } from "../../domain/conta-da-ia.ts";
import { interpretarLinhaStreamJson } from "../../domain/stream-json.ts";
import { caminhoAumentado, homeDaPessoa, resolverBinario } from "./caminho.ts";
import { extrairVersao, flagsListadasNoHelp, inventarioAbaixoDoPiso } from "./flag-floors.ts";
import { executarColetando } from "./processo.ts";

/**
 * Sonda de disponibilidade (ADR-019): pergunta ao CLI, nunca lê a credencial.
 *  (1) presença de variável de ambiente não prova nada — ANTHROPIC_API_KEY nem é lida;
 *  (2) a identidade que o CLI reporta é cosmética: o snapshot NÃO tem email;
 *  (3) três estados: ausente (binário) | nao_autenticado (turno mínimo falhou ou cobraria fora da
 *      assinatura) | pronto (versão lida e turno de uma palavra respondido com init.apiKeySource 'none').
 * O turno de sonda é stream-json (não json): ver lerTurnoDeSonda.
 * O turno de sonda custa (medido em 2026-09-16, mapa-cli: US$0,003–0,02 com haiku) — por isso o
 * cache de 5 min em src/services/inventario.ts e o modelo mais barato (EMENDA 35).
 */
/**
 * definido em 2026-09-16: 10 s para `--version`/`--help`/`auth status` (local, sem rede). revisto em 2026-10-05 (NOD-178):
 * configurável por NOD_PRAZO_SONDA_MS; com o Mac carregado (load 260–550 em 12 núcleos) o `--version` passou de 10 s.
 */
export const PRAZO_SONDA_PADRAO_MS = 10_000;

/** NOD_PRAZO_SONDA_MS do env do processo (antes da denylist), na convenção de NOD_PRAZO_DECISAO_MS. */
export function prazoSondaDoEnv(env: Readonly<Record<string, string | undefined>>): number | undefined {
  return Number(env.NOD_PRAZO_SONDA_MS) || undefined;
}

export type OpcoesSonda = {
  /** Prazo de `--version`/`--help`; default PRAZO_SONDA_PADRAO_MS. */
  timeoutVersaoMs?: number;
  /** definido em 2026-09-16: 90 s para o turno de uma palavra — a sonda s3 com MCP levou 8,3 s; folga de 10x. */
  timeoutTurnoMs?: number;
  /** Casa da pessoa para `~` e ~/.local/bin; default homeDaPessoa(env) (passwd, não $HOME — ver caminho.ts). */
  home?: string;
  /** Base do cwd descartável da sonda (nunca o repo — mapa-cli: o cwd decide qual CLAUDE.md o CLI lê). */
  cwdBase?: string;
  relogio?: () => number;
  /** definido em 2026-10-05: a frase do turno de teste (padrão "responda só OK"); o onboarding manda "Diga oi para…". */
  pergunta?: string;
  /**
   * definido em 2026-10-05: quem chama já conferiu que há login (o app do Mac, antes do teste). Então uma falha do turno
   * não é "falta entrar": o inventário sai com `causa` (`teste_falhou`, ou `conta_sem_acesso` quando o texto diz).
   */
  loginConferido?: boolean;
};

export type SondaDetalhada = {
  inventario: Inventario;
  /** Caminho absoluto resolvido; null quando ausente. */
  binario: string | null;
  /** Flags que o `--help` lista (para os floors); null quando o help não pôde ser lido. */
  flagsNoHelp: string[] | null;
  /** total_cost_usd do turno de sonda (null quando não houve turno ou result). */
  custoUsd: number | null;
  /** O que a IA respondeu ao teste, pronto para a tela; null quando ela não ficou pronta. */
  resposta: string | null;
};

type Env = Readonly<Record<string, string | undefined>>;

export function ambienteDaSonda(env: Env, home: string): Record<string, string> {
  const limpo = montarAmbiente("local", env);
  return { ...limpo, PATH: caminhoAumentado(env.PATH, home), HOME: limpo.HOME ?? home };
}

/**
 * Só `--version`: barato e sem rede. Para o driver conferir floors sem gastar turno.
 * NOD-178: estouro de prazo é `sonda_lenta` (o CLI existe e só demorou), nunca `version_exit_null`.
 */
export async function lerVersao(binario: string, env: Record<string, string>, timeoutMs = PRAZO_SONDA_PADRAO_MS): Promise<{ versao: string } | { erro: string }> {
  const r = await executarColetando({ bin: binario, args: ["--version"], env, cwd: tmpdir(), timeoutMs });
  if (r.erroSpawn) return { erro: "binario_nao_executa" };
  if (r.estourouTempo) return { erro: "sonda_lenta" };
  // definido em 2026-10-09: o Claude Code antigo do npm é `#!/usr/bin/env node`; sem node, a causa é dita, não "instale".
  if (r.exitCode !== 0 && faltaNode(r.stderr)) return { erro: "sem_node" };
  if (r.exitCode !== 0) return { erro: `version_exit_${r.exitCode ?? "null"}` };
  const versao = extrairVersao(r.stdout);
  return versao ? { versao } : { erro: "versao_ilegivel" };
}

/** Flags do `--help`; `flags: null` quando o help falhou. NOD-178: o estouro de prazo volta à parte, como `sonda_lenta`. */
export async function lerFlagsDoHelp(binario: string, env: Record<string, string>, timeoutMs = PRAZO_SONDA_PADRAO_MS): Promise<{ flags: string[] | null } | { erro: "sonda_lenta" }> {
  const r = await executarColetando({ bin: binario, args: ["--help"], env, cwd: tmpdir(), timeoutMs });
  if (r.estourouTempo) return { erro: "sonda_lenta" };
  if (r.erroSpawn || r.exitCode !== 0) return { flags: null };
  return { flags: flagsListadasNoHelp(r.stdout) };
}

/**
 * Lê o turno de sonda pelo MESMO parser do driver. medido em 2026-09-16 (um turno haiku real,
 * US$0,014): `--output-format json` NÃO traz `apiKeySource` (chaves: type, subtype, is_error,
 * result, session_id, total_cost_usd, usage, modelUsage, permission_denials…); só o `system/init`
 * do stream-json traz — por isso a sonda usa stream-json e lê o init. Sem init, ou com
 * apiKeySource ausente, é fail-closed (nao_autenticado), nunca "assume assinatura".
 */
export function lerTurnoDeSonda(stdout: string): { init: Extract<EventoStream, { tipo: "init" }> | null; result: Extract<EventoStream, { tipo: "result" }> | null; texto: string } {
  let init: Extract<EventoStream, { tipo: "init" }> | null = null;
  let result: Extract<EventoStream, { tipo: "result" }> | null = null;
  // definido em 2026-10-05: o texto do assistente também é lido — a recusa da conta chega como "resposta".
  const blocos: string[] = [];
  for (const linha of stdout.split("\n")) {
    const ev = interpretarLinhaStreamJson(linha);
    if (ev.tipo === "init") init = ev;
    else if (ev.tipo === "result") result = ev;
    else if (ev.tipo === "texto_bloco") blocos.push(ev.texto);
  }
  return { init, result, texto: blocos.join("\n") };
}

export async function sondarDetalhado(bin: string | undefined, env: Env, modelo: string, o: OpcoesSonda = {}): Promise<SondaDetalhada> {
  const home = o.home ?? homeDaPessoa(env);
  const agora = o.relogio ?? Date.now;
  const ambiente = ambienteDaSonda(env, home);
  const binario = await resolverBinario(bin, ambiente.PATH ?? "", home);
  if (!binario) return { inventario: { estado: "ausente", motivo: bin ? "binario_nao_encontrado" : "claude_fora_do_path", em: agora() }, binario: null, flagsNoHelp: null, custoUsd: null, resposta: null };

  // NOD-178: o CLI que só demorou continua 'ausente' (fail-closed), mas com a causa e a frase de lentidão, nunca "não instalado".
  const lenta = (): SondaDetalhada => ({ inventario: { estado: "ausente", motivo: motivoSondaLenta("Claude"), causa: "sonda_lenta", em: agora() }, binario, flagsNoHelp: null, custoUsd: null, resposta: null });
  const versao = await lerVersao(binario, ambiente, o.timeoutVersaoMs);
  if ("erro" in versao && versao.erro === "sem_node") return { inventario: { estado: "ausente", motivo: motivoSemNode("Claude Code"), causa: "sem_node", em: agora() }, binario, flagsNoHelp: null, custoUsd: null, resposta: null };
  if ("erro" in versao) return versao.erro === "sonda_lenta" ? lenta() : { inventario: { estado: "ausente", motivo: versao.erro, em: agora() }, binario, flagsNoHelp: null, custoUsd: null, resposta: null };
  // NOD-171: abaixo do piso testado não gasta turno; a pessoa lê "Atualize", com a versão que tem e a mínima.
  const antigo = inventarioAbaixoDoPiso("claude-cli", versao.versao, "Claude Code", agora());
  if (antigo) return { inventario: antigo, binario, flagsNoHelp: null, custoUsd: null, resposta: null };
  const help = await lerFlagsDoHelp(binario, ambiente, o.timeoutVersaoMs);
  if ("erro" in help) return lenta();
  const flagsNoHelp = help.flags;

  const dir = await mkdtemp(join(o.cwdBase ?? tmpdir(), "nod-sonda-"));
  try {
    const mcpVazio = join(dir, "mcp-vazio.json");
    await writeFile(mcpVazio, `${JSON.stringify({ mcpServers: {} })}\n`, { mode: 0o600 });
    const r = await executarColetando({
      bin: binario,
      args: ["-p", o.pergunta ?? "responda só OK", "--model", modelo, "--max-turns", "1", "--tools", "", "--strict-mcp-config", "--mcp-config", mcpVazio, "--output-format", "stream-json", "--verbose"],
      env: ambiente,
      cwd: dir,
      timeoutMs: o.timeoutTurnoMs ?? 90_000,
    });
    const { init, result, texto } = lerTurnoDeSonda(r.stdout);
    const custoUsd = result?.custoUsd ?? null;
    // A recusa da conta vale em qualquer desfecho do turno, inclusive num `result` "de sucesso" cuja resposta é a recusa.
    const semAcesso = causaDaFalhaDeConta(result?.erroCru) ?? causaDaFalhaDeConta(result?.texto) ?? causaDaFalhaDeConta(texto);
    const naoAutenticado = (motivo: string): SondaDetalhada => {
      const causa: CausaSemIa | undefined = semAcesso ?? (o.loginConferido ? "teste_falhou" : undefined);
      return { inventario: { estado: "nao_autenticado", motivo, versao: versao.versao, ...(causa ? { causa } : {}), em: agora() }, binario, flagsNoHelp, custoUsd, resposta: null };
    };
    if (semAcesso) return naoAutenticado("conta_sem_acesso");
    if (r.estourouTempo) return naoAutenticado("turno_de_sonda_sem_resposta");
    if (r.erroSpawn) return naoAutenticado("turno_de_sonda_nao_lancou");
    // ADR-009: o motivo é o código de saída, nunca o texto do stderr ("Not logged in" não é lido).
    if (r.exitCode !== 0) return naoAutenticado(`turno_de_sonda_exit_${r.exitCode ?? "null"}`);
    if (!init) return naoAutenticado("turno_de_sonda_sem_init");
    if (!result) return naoAutenticado("turno_de_sonda_sem_result");
    if (!result.sucesso) return naoAutenticado("turno_de_sonda_com_erro");
    // Cobrança fora da assinatura claude.ai (chave de API, helper) não é 'pronto': cairia na fatura errada (ADR-015).
    if (init.apiKeySource !== "none") return naoAutenticado(`api_key_source_${init.apiKeySource}`);
    return { inventario: { estado: "pronto", versao: versao.versao, em: agora() }, binario, flagsNoHelp, custoUsd, resposta: respostaDoTeste(result.texto || texto, RESPOSTA_TESTE_IA_MAX) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Forma do plano: `sondar(bin, env, modelo)` → Inventario. */
export async function sondar(bin: string | undefined, env: Env, modelo: string, o: OpcoesSonda = {}): Promise<Inventario> {
  return (await sondarDetalhado(bin, env, modelo, o)).inventario;
}
