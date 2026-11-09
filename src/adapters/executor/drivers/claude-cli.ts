import { MODELO_SONDA_PADRAO } from "../../../contracts/modelos.ts";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Inventario } from "../../../contracts/inventario.ts";
import { motivoSondaLenta } from "../../../domain/sonda-lenta.ts";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno, SinaisTurno } from "../../../contracts/turno.ts";
import { comContaSemAcesso } from "../../../domain/conta-da-ia.ts";
import { ehErroDeDominio, ErroDeDominio } from "../../../domain/erro.ts";
import { montarExecucao } from "../../../domain/raio-x.ts";
import { ultimoUsoDoPlano } from "../../../domain/uso-do-plano.ts";
import type { CatalogoDeComandos } from "../../../contracts/comandos.ts";
import { lerCatalogoDoMac } from "../catalogo-comandos.ts";
import { log } from "../../../obs/log.ts";
import { pastaValidaNoWindows } from "../../../domain/caminhos.ts";
import { baixarAnexos, mensagemClaude } from "../anexos-turno.ts";
import { rodarLigacaoClaude } from "./claude-ligacao.ts";
import { classificarSessao, fimDoStderr, eventosDaLinhaStreamJson, reduzirSinais, SINAIS_ZERADOS, textoDaRodada } from "../../../domain/stream-json.ts";
import { capacidadesDe, versaoMinimaDoModelo } from "../../../domain/harness.ts";
import { criarFalaDoMeio } from "../../../domain/mensagem-no-meio.ts";
import { caminhoAumentado, resolverBinario } from "../caminho.ts";
import { compararVersoes, conferirFloors, conferirPisoCli, FLAG_FLOORS, inventarioAbaixoDoPiso, type FlagComPiso } from "../flag-floors.ts";
import { escreverMcpConfig } from "../mcp-config.ts";
import { iniciarProcesso, executarColetando, type Processo } from "../processo.ts";
import { lerFlagsDoHelp, lerVersao, PRAZO_SONDA_PADRAO_MS, sondarDetalhado } from "../sonda.ts";
import { motivoSemNode } from "../../../domain/saida-do-cli.ts";
import type { Adapter, ConfigDriver, Driver, Instance, SinksTurno } from "../spi.ts";
import { MARCADOR_PARTE_DINAMICA } from "../../../domain/marcador-prompt.ts";
import { ehPastaDeTask, NATIVAS_DE_ARQUIVO, NATIVAS_DO_TERMINAL } from "../../../domain/nativas.ts";
import { ESPERA_APROVACAO_NO_TURNO_MS, MAX_MCP_OUTPUT_TOKENS_FILHO } from "../../../shared/constantes.ts";

/**
 * Driver claude-cli (ADR-012: implementação ÚNICA e real; ADR-014 invertido: o CLI é o da pessoa).
 * Contrato empírico de 2026-09-16 (mapa-cli): -p + stream-json + --verbose obrigatório, --tools ""
 * + --strict-mcp-config + --allowedTools exato = menor privilégio verificado (s3/s4b), --session-id
 * só no PRIMEIRO turno e --resume nos seguintes (s2c), config (mcp.json, hook) num mkdtemp por turno (EMENDA 11;
 * --resume funciona de qualquer cwd, s2d) e, sem pasta, cwd estável por bot (NOD-188), SIGTERM → exit 143 sem `result` (s6).
 */
export type LigacaoClaudeCli = {
  /** URL do servidor nod para o proxy (vai no mcp.json, nunca no env do CLI). */
  urlNod: string;
  /** Caminho absoluto do proxy MCP (L5). */
  proxyPath: string;
  /**
   * ADR-052: caminho do hook PreToolUse do nod (hook-nativas.ts). Sem ele, o kit do terminal não liga — o turno
   * fica só com as nativas de arquivo das pastas autorizadas, como antes (fail-closed).
   */
  hookPath?: string;
  nodePath?: string;
  /** ADA-11 (ADR-147): a plataforma do motor; default `process.platform`. No win32 o hook é obrigatório (falha fechada). */
  plataforma?: NodeJS.Platform;
  /**
   * ADA-11 (ADR-147): o kit do terminal do Codex no Windows só liga com esta flag (NOD_CODEX_TERMINAL_WINDOWS=1), depois
   * que uma sonda numa máquina Windows provar que o Codex roda o PreToolUse lá. Sem ela o Codex roda isolado no win32.
   */
  codexTerminalNoWindows?: boolean;
  electronComoNode?: boolean;
  /** definido em 2026-09-16: a sonda usa o modelo mais barato (EMENDA 35). */
  modeloSonda?: string;
  sondaSemTurno?: boolean;
  /**
   * Prazo de `--version`/`--help`/`auth status`/`login status` (NOD-178); default PRAZO_SONDA_PADRAO_MS (10 s).
   * Vem de NOD_PRAZO_SONDA_MS pelo boot: o `cfg.env` do driver já passou pela denylist, que apaga NOD_*.
   */
  prazoSondaMs?: number;
  /**
   * ADR-097 (fase 1b): a fila do forno — o hook põe o comando pesado do bot na fila da máquina. Ligada por padrão;
   * `false` (NOD_FILA_DO_FORNO=0 no boot) desliga, e o comando roda direto como antes.
   */
  filaDoForno?: boolean;
  /**
   * Espera entre SIGTERM e SIGKILL na interrupção; default SIGTERM_PARA_SIGKILL_MS (5 s).
   * definido em 2026-09-16: existe para o teste que CRONOMETRA `interromper()` poder afirmar
   * contra um limite que ele controla, em vez de correr contra o mesmo relógio do código.
   * Produção não passa nada.
   */
  sigtermParaSigkillMs?: number;
  /**
   * NOD-9 (definido em 2026-10-23): o portão da atualização. O turno espera aqui antes de ler a versão enquanto o app
   * atualiza o Claude Code (ou segura os pedidos novos); resolve `true` só quando o portão segurou e uma atualização
   * terminou (a versão é relida); com o portão livre ou o prazo vencido, `false`. Quem implementa põe o prazo (180 s):
   * depois dele o turno segue com o que houver.
   */
  aguardarAtualizacao?(): Promise<boolean>;
  /**
   * NOD-9: o modelo do turno pede uma versão acima da instalada. O app atualiza agora (o próprio turno não conta como
   * ocupado) e resolve quando acaba: `true` = uma atualização terminou (a versão é relida), `false` = nada rodou.
   */
  aoPrecisarDeVersao?(minima: string): Promise<boolean>;
};

export { MODELO_SONDA_PADRAO } from "../../../contracts/modelos.ts";

/**
 * Janela do `--autocompact`. definido em 2026-09-18 como 200_000 fixo (valor do openmausbot); trocado em 2026-11-09
 * para "auto": com o Opus de 1M (contextWindow 1_000_000 no result), o teto de 200k fazia o CLI compactar cedo demais
 * e, com o system prompt e as ferramentas do nod ocupando boa parte da janela, o contexto voltava ao teto em até 3
 * turnos e o CLI parava com "Autocompact is thrashing" (pico de 132k numa janela de 1 mi). "auto" usa a janela real
 * do modelo do turno: 200k num modelo de 200k (igual ao de antes), 1M no de 1M.
 */
export const JANELA_AUTOCOMPACT = "auto";

/**
 * As flags que montarArgs usa SEMPRE — é a lista conferida contra os floors, e reprovar aqui
 * recusa o turno. --restricted e --add-dir ficam de fora de propósito: são condicionais a existir
 * projeto autorizado, e exigi-las aqui derrubaria todo turno num CLI mais antigo, inclusive os que
 * não tocam em pasta nenhuma. O gate delas é o help, conferido no próprio turno (fail-closed:
 * sem --restricted no help, o cwd continua no diretório temporário e as nativas ficam desligadas).
 * --autocompact é condicional pelo mesmo motivo, e o gate também é o help.
 *
 * definido em 2026-09-18: SEM `--max-turns`. O teto de 12 passos foi dimensionado em 2026-09-16
 * para "lembrar → pedir_aprovacao → resposta" e cortava tarefa de código no meio (ler quatro
 * arquivos já gastava metade). `sonda.ts` continua usando `--max-turns 1`, onde o teto é o desejado,
 * então a flag segue em FLAG_FLOORS — só não é mais exigida no turno.
 *
 * revisto em 2026-10-01 (ADR-067, sessão viva): nada limita o turno por relógio. A entrada vai em stream-json e
 * fica aberta enquanto há comando em segundo plano ou mensagem nova; o turno acaba quando o bot termina, no Parar
 * ou com o lease vencido.
 */
export const FLAGS_DO_TURNO: readonly FlagComPiso[] = [
  "--output-format",
  "--verbose",
  "--include-partial-messages",
  "--model",
  "--setting-sources",
  "--strict-mcp-config",
  "--mcp-config",
  "--tools",
  "--allowedTools",
  "--permission-mode",
  "--append-system-prompt",
  "--session-id",
  "--resume",
];


/** O que o modelo lê quando o plano pediu o kit do terminal e esta máquina não o tem (app sem o hook). */
export const AVISO_SEM_TERMINAL = "Nesta máquina o kit do terminal não está disponível neste turno: não há Bash, WebFetch nem WebSearch, e as nativas de arquivo só valem nas pastas de projeto autorizadas.";

/** O plano com o AVISO_SEM_TERMINAL no fim do prompt inteiro e, quando há partes, no fim da volátil (depois do marcador). */
export function comAvisoSemTerminal(plano: PlanoTurno): Pick<PlanoTurno, "promptSistema" | "promptSistemaPartes"> {
  const promptSistema = `${plano.promptSistema}\n${AVISO_SEM_TERMINAL}`;
  const p = plano.promptSistemaPartes;
  if (!p) return { promptSistema };
  return { promptSistema, promptSistemaPartes: { estavel: p.estavel, volatil: p.volatil === "" ? AVISO_SEM_TERMINAL : `${p.volatil}\n${AVISO_SEM_TERMINAL}` } };
}

/**
 * definido em 2026-10-06 (NOD-183, ADR-080): o par de args do prompt de sistema. Medido no CLI 2.1.290
 * (scripts/sonda-system-prompt-texto.ts): o `--append-system-prompt` ignora o marcador e o cache do 2º turno ficava em
 * 16%; o `--system-prompt` com a parte estável, o marcador e a volátil subiu para 75%, e os quatro comportamentos
 * (ToolSearch, Edit/Read, Bash sob o hook, só texto) seguiram iguais sem o prompt padrão do Claude Code. Sem a flag,
 * sem as partes ou com o marcador dentro de uma delas (ele partiria o prompt no lugar errado), volta ao append de antes.
 */
export function argsDoPromptSistema(plano: PlanoTurno, systemPrompt: boolean): string[] {
  if (!promptEmDuasPartes(plano, systemPrompt)) return ["--append-system-prompt", plano.promptSistema];
  const p = plano.promptSistemaPartes!;
  // NOD-188: só a estável e o marcador; a volátil vai na mensagem do turno (volatilNaMensagem). Quando a mensagem
  // começa com "/", ela não pode ir antes do texto, e fica depois do marcador, como na NOD-183.
  return ["--system-prompt", [p.estavel, MARCADOR_PARTE_DINAMICA, comecaComBarra(plano.entrada.texto) ? p.volatil : ""].join("\n")];
}

/**
 * Comando da barra (/cost, /compact, uma skill como "/review 420") só é reconhecido pelo CLI no começo da mensagem.
 * Um caminho ("/Users/ana/x.txt, o que tem aqui?") também começa com "/": vale a mesma regra, porque o CLI decide.
 */
const comecaComBarra = (texto: string): boolean => texto.trimStart().startsWith("/");

/** A forma do ADR-080 vale: o gate deixou, há as duas partes e nenhuma traz o marcador (ele partiria o prompt no lugar errado). */
function promptEmDuasPartes(plano: PlanoTurno, systemPrompt: boolean): boolean {
  const p = plano.promptSistemaPartes;
  return systemPrompt && p !== undefined && !p.estavel.includes(MARCADOR_PARTE_DINAMICA) && !p.volatil.includes(MARCADOR_PARTE_DINAMICA);
}

/** O bloco que abre a mensagem do turno com a parte volátil (NOD-188). */
export const ABRE_CONTEXTO_DO_TURNO = "[Contexto deste turno]";
export const FECHA_CONTEXTO_DO_TURNO = "[Fim do contexto deste turno]";
/**
 * Um delimitador do bloco dentro da volátil (memória, conversa recente de outros) ou da mensagem vira texto, com
 * parênteses. revisto em 2026-10-07 (QA da NOD-188): o modelo lê "[Fim  do contexto deste turno ]", com quebra de
 * linha, NBSP, espaço de largura zero ou colchete largo como o mesmo delimitador, então a busca aceita essas variações.
 */
const SEPARADOR = "[\\s\\u200B-\\u200D\\u2060\\uFEFF]";
const DELIMITADOR_FORJADO = new RegExp(`[\\[\\uFF3B]${SEPARADOR}*((?:fim${SEPARADOR}+do${SEPARADOR}+)?contexto${SEPARADOR}+deste${SEPARADOR}+turno)${SEPARADOR}*[\\]\\uFF3D]`, "giu");
const neutralizarDelimitador = (t: string): string => t.replace(DELIMITADOR_FORJADO, (_m, dentro: string) => `(${dentro.replace(new RegExp(`${SEPARADOR}+`, "gu"), " ")})`);

/**
 * definido em 2026-10-07 (NOD-188, emenda da ADR-080): a parte volátil (remetente, memória, conversa recente) vai no
 * começo da mensagem do turno, não no prompt de sistema. Medido no CLI 2.1.292 (scripts/sonda-system-prompt-texto.ts,
 * fase snapshotHistorico, 1º turno de ~15 mil tokens): com a volátil no sistema e o snapshot `off`, o sistema muda a
 * cada turno e o histórico inteiro, que vem depois dele, é reescrito no cache (15% do 3º turno em diante); com ela na
 * mensagem, o sistema fica igual e o 3º turno lê 99% do cache, com a volátil nova chegando ("azul", "verde"). Vale no 1º
 * turno também (uma forma só). Sem a forma do ADR-080 (append, plano sem partes) ou com a volátil vazia, o texto vai
 * como veio. Mensagem que começa com "/" (comando da barra, skill, caminho) também: o CLI só reconhece o comando no
 * começo, e a volátil fica no --system-prompt desse turno (argsDoPromptSistema), em vez de sumir.
 * A volátil traz texto de fora (conversa recente, memória): um delimitador dentro dela fecharia o bloco antes da hora
 * e faria o resto parecer fala da pessoa; ele chega ao modelo com parênteses no lugar dos colchetes. Na mensagem também
 * (QA da NOD-188): o pedido de um colega ou a fala de outro na sala poderia abrir, logo depois do bloco real, um
 * "[Contexto deste turno]" falso com outro remetente.
 */
export function volatilNaMensagem(plano: PlanoTurno, systemPrompt: boolean, texto: string): string {
  const volatil = plano.promptSistemaPartes?.volatil ?? "";
  if (!promptEmDuasPartes(plano, systemPrompt) || volatil.trim() === "" || comecaComBarra(texto)) return texto;
  return `${ABRE_CONTEXTO_DO_TURNO}\n${neutralizarDelimitador(volatil)}\n${FECHA_CONTEXTO_DO_TURNO}\n\n${neutralizarDelimitador(texto)}`;
}

/**
 * ADR-080: o --system-prompt com o marcador só quando o help traz a flag E a versão é a sondada. Hoje o PISO_CLI
 * do claude-cli é o mesmo 2.1.290 e recusa o turno antes; o piso próprio segura o caso de o PISO_CLI baixar.
 */
export function usaSystemPrompt(flagsNoHelp: readonly string[] | null | undefined, versao: string): boolean {
  return (flagsNoHelp ?? []).includes("--system-prompt") && compararVersoes(versao, FLAG_FLOORS["--system-prompt"].piso) >= 0;
}

/** NOD-185: o mesmo gate para desligar o snapshot do prompt de sistema (o `--resume` passa a levar a parte volátil do turno). */
export function usaSnapshotOff(flagsNoHelp: readonly string[] | null | undefined, versao: string): boolean {
  return (flagsNoHelp ?? []).includes("--system-prompt-snapshot") && compararVersoes(versao, FLAG_FLOORS["--system-prompt-snapshot"].piso) >= 0;
}

/** ADR-052: o turno com o kit do terminal — `settings` (o hook do nod) e as pastas além do cwd (ADR-055: a pasta da pessoa). */
export type TurnoTerminal = { settings: string; dirsExtras: readonly string[] };

/** Aspas de shell para o comando do hook (o CLI o roda num shell): caminhos com espaço, como "Application Support". */
const aspas = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

/**
 * Teto do hook em segundos: a espera de uma aprovação no próprio turno (0032) mais folga para a confirmação final.
 * Abaixo dele o CLI mataria o hook no meio da espera e o comando aprovado não rodaria.
 */
export const TETO_HOOK_S = Math.ceil(ESPERA_APROVACAO_NO_TURNO_MS / 1000) + 30;

/**
 * ADR-052: o `--settings` do turno com o kit do terminal. O hook PreToolUse do nod decide CADA nativa (medido em
 * 2026-09-28: roda em -p via --settings, e o deny barra a chamada).
 * revisto em 2026-09-28 (ADR-055, "terminal de verdade, como o inhouse"): SEM sandbox. O Bash roda no Mac da
 * pessoa com rede, o gh e o git logados dela; quem segura é o hook, que manda cada comando ao servidor — o que só
 * lê roda, o resto espera a aprovação dela num card.
 */
export function settingsDoTerminal(p: { comandoHook: string }): string {
  return JSON.stringify({
    // Só as nativas, no formato da documentação ("Edit|Write"). As ferramentas MCP do nod passam pelo proxy; o hook
    // as deixa passar também quando o CLI o consulta para elas (medido ao vivo em 2026-09-28: com "*", o hook
    // negava mcp__nod__publicar_artefato como "fora do kit").
    hooks: { PreToolUse: [{ matcher: NATIVAS_DO_TERMINAL.join("|"), hooks: [{ type: "command", command: p.comandoHook, timeout: TETO_HOOK_S }] }] },
  });
}

/**
 * ADA-11 (ADR-147): no Windows o Claude Code roda o hook no Git Bash; o caminho vai com `/` (`C:/…`), que o bash e o
 * Node entendem sem ambiguidade, nas mesmas aspas POSIX.
 */
export const paraOGitBash = (caminho: string, windows: boolean): string => (windows ? caminho.replace(/\\/g, "/") : caminho);

/** O comando que o CLI roda para o hook: o mesmo Node do proxy, o script do hook e a config 0600 do turno. */
export function comandoDoHook(p: { nodePath: string; hookPath: string; config: string; electronComoNode?: boolean; windows?: boolean }): string {
  return `${invocarDoHook(p)} ${aspas(paraOGitBash(p.config, p.windows === true))}`;
}

/** O node e o script do hook, sem a config: é como o comando do bot chama o nod-vaga (ADR-097). */
export function invocarDoHook(p: { nodePath: string; hookPath: string; electronComoNode?: boolean; windows?: boolean }): string {
  const w = p.windows === true;
  return `${p.electronComoNode ? "ELECTRON_RUN_AS_NODE=1 " : ""}${aspas(paraOGitBash(p.nodePath, w))} ${aspas(paraOGitBash(p.hookPath, w))}`;
}

/** ADR-097: a pasta da fila do forno, uma por máquina: ao lado de `turnos`, em NOD_HOME. */
export function pastaDaFila(cwdBase: string): string {
  return join(dirname(cwdBase), "vaga");
}

/**
 * A busca de ferramentas do Claude Code (definido em 2026-09-28): com ela no `--tools`, as ferramentas de MCP entram
 * só pelo nome e a definição é carregada quando o modelo precisa. Sem ela, todas as definições vão em toda chamada.
 * Medido com scripts/sonda-busca-ferramentas.ts (CLI 2.1.284, sonnet, 60 ferramentas de ~900 caracteres): a
 * primeira chamada caiu de 24.189 para 4.561 tokens. Não é nativa do plano: não lê nem grava nada, só carrega
 * definições que o plano já liberou — o proxy continua decidindo cada chamada (ADR-013).
 */
export const FERRAMENTA_DE_BUSCA = "ToolSearch";

/**
 * Args do `claude -p` para um plano (função pura: é o que os testes de args conferem).
 *
 * `bifurcar` (definido em 2026-10-07, ADR-083, #193, rede de 2 min): com `plano.entrada.bifurcar` e uma sessão, o turno
 * continua NUMA CÓPIA dela (`--resume <sessão> --fork-session`), porque a original segue com o trabalho promovido. O CLI
 * escolhe o id novo, que volta no `init`/`result` (e daí no `sessaoCli` do resultado); por isso `sessaoCli` é null aqui.
 * Só com a flag no help (`bifurcar` = o driver conferiu): sem ela, quem chama recusa o turno antes, para nunca continuar
 * a mesma sessão em dois processos.
 */
export function montarArgs(entrada: { plano: PlanoTurno; mcpJson: string; sessaoNova?: () => string; compactar?: boolean; streamJson?: boolean; terminal?: TurnoTerminal; esforco?: boolean; systemPrompt?: boolean; snapshotOff?: boolean; bifurcar?: boolean; windows?: boolean }): { args: string[]; sessaoCli: string | null } {
  const { plano, terminal } = entrada;
  const pastas = terminal ? null : plano.workspacePastas ?? null;
  // Sem projeto autorizado nada muda: nativas desligadas e cwd no diretório temporário vazio. As nativas vêm
  // do plano (nativasDoTurno, 2026-09-28); plano de servidor antigo sem o campo cai na regra anterior.
  // ADR-052: no kit do terminal elas são exatamente as do plano, sob o hook do nod (ADR-055: sem sandbox).
  const nativas = terminal ? (plano.nativas ?? []) : pastas ? (plano.nativas ?? NATIVAS_DE_ARQUIVO).filter((n) => (NATIVAS_DE_ARQUIVO as readonly string[]).includes(n)) : [];
  // ADA-11 (ADR-147): no Windows o hook roda pelo Git Bash e, se ele não rodar, a nativa do terminal não pode passar
  // pela lista de aprovadas: só o `allow` do hook a libera (falha fechada; em -p o CLI nega o que ninguém aprovou).
  const aprovadas = terminal && entrada.windows === true ? nativas.filter((n) => !(NATIVAS_DO_TERMINAL as readonly string[]).includes(n)) : nativas;
  const permitidas = [...plano.catalogo.ferramentas.map((f) => f.nomeMcp), ...aprovadas, FERRAMENTA_DE_BUSCA].join(",");
  const bifurca = entrada.bifurcar === true && plano.entrada.bifurcar === true && plano.entrada.sessaoCli !== null;
  const sessaoCli = plano.entrada.sessaoCli ?? (entrada.sessaoNova ?? randomUUID)();
  // Todos os projetos aprovados entram: o bot transita entre eles sem reautorizar (decisão de 2026-09-18).
  const extras = terminal ? terminal.dirsExtras : (pastas?.aprovadas ?? []).filter((p) => p !== pastas?.ativa);
  const args = [
    "-p",
    // ADR-046: com anexo, a entrada é uma linha stream-json com blocos de imagem/PDF em vez de texto puro.
    ...(entrada.streamJson ? ["--input-format", "stream-json"] : []),
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model",
    plano.entrada.modelo,
    // Sem teto de passos, a tarefa longa precisa de janela: compactar em vez de bater no limite.
    ...(entrada.compactar ? ["--autocompact", JANELA_AUTOCOMPACT] : []),
    // definido em 2026-09-28 (0037): o esforço do bot, só quando o help da versão instalada traz a flag.
    ...(entrada.esforco && plano.entrada.esforco ? ["--effort", plano.entrada.esforco] : []),
    // --restricted substitui --setting-sources project: ignora CLAUDE.md, skills e hooks do repo
    // aberto, que o nod não escreveu, e confina as ferramentas de arquivo às pastas permitidas.
    // ADR-052: o kit do terminal NÃO usa --restricted (ele tira Bash e WebFetch, medido em 2026-09-28); o cwd é a
    // pasta do bot, que o nod controla, e quem decide cada chamada é o hook do nod (--settings; ADR-055: sem sandbox).
    ...(pastas ? ["--restricted"] : ["--setting-sources", "project"]),
    ...extras.flatMap((p) => ["--add-dir", p]),
    "--strict-mcp-config",
    "--mcp-config",
    entrada.mcpJson,
    // Só --tools restringe o que existe no turno (--allowedTools só aprova): no terminal, a lista exata.
    // definido em 2026-09-28 (modo dev): a ToolSearch vai sempre na lista — sem ela o CLI carrega TODAS as definições
    // de MCP em toda chamada (scripts/sonda-busca-ferramentas.ts: 24.189 → 4.561 tokens na primeira chamada).
    "--tools", [...nativas, FERRAMENTA_DE_BUSCA].join(","),
    ...(terminal ? ["--settings", terminal.settings] : []),
    "--allowedTools",
    permitidas,
    "--permission-mode",
    "default",
    ...argsDoPromptSistema(plano, entrada.systemPrompt === true),
    // NOD-185: sem o snapshot, o `--resume` leva o prompt de sistema deste turno, não o gravado no 1º. Vai em todo turno,
    // para o 1º também não gravar. revisto em 2026-10-07 (NOD-188): com a volátil na mensagem, o sistema é só a parte
    // estável, então o `off` não custa cache (99% do 3º turno com histórico longo) e mantém a estável atualizada quando
    // o bot muda de nome ou ganha conector no meio da conversa.
    ...(entrada.snapshotOff ? ["--system-prompt-snapshot", "off"] : []),
    ...(plano.entrada.sessaoCli ? ["--resume", plano.entrada.sessaoCli, ...(bifurca ? ["--fork-session"] : [])] : ["--session-id", sessaoCli]),
  ];
  return { args, sessaoCli: bifurca ? null : sessaoCli };
}

/**
 * definido em 2026-09-28: o CLAUDE.md das pastas além do cwd (a da pessoa e os projetos autorizados). Medido no CLI
 * 2.1.284 com /context: o CLAUDE.md de um repositório que é só --add-dir NÃO carrega; com esta variável, carrega. No
 * terminal a pessoa abre o Claude Code DENTRO do repositório e ele lê as regras do projeto; o bot trabalha da pasta
 * dele (~/nod/<bot>) e ficava sem elas. Só no kit do terminal: o --restricted do modo de pastas as ignora de propósito.
 */
export const CLAUDE_MD_DAS_PASTAS = "CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD";

/** definido em 2026-10-01 (ADR-067): o maior atraso que um setTimeout do Node aceita (~24,8 dias); acima disso ele dispara na hora. */
export const SEM_TETO_DE_COMANDO_MS = 2_147_483_647;

/** Env do filho: cfg.env (já sem a denylist) + PATH aumentado + HOME + teto do tools/call. */
export function montarEnvDoFilho(env: Record<string, string>, home: string, prazoMs: number, opcoes: { claudeMdDasPastas?: boolean } = {}): Record<string, string> {
  return {
    ...env,
    PATH: caminhoAumentado(env.PATH, home),
    HOME: env.HOME ?? home,
    // definido em 2026-09-16: uma ferramenta (aprovação em long-poll) pode esperar tanto quanto o turno, nunca menos de 60 s;
    // o teto real do CLI é o que scripts/sonda-mcp-timeout.ts mede.
    MCP_TOOL_TIMEOUT: String(Math.max(60_000, Math.floor(prazoMs))),
    // definido em 2026-10-01 (ADR-067): sem teto de comando. Medido no 2.1.286: sem isto o Bash vai para segundo plano
    // aos 120 s (e morria com o turno); com isto ele espera o comando acabar. Quem para é a pessoa, no Parar.
    BASH_DEFAULT_TIMEOUT_MS: String(SEM_TETO_DE_COMANDO_MS),
    BASH_MAX_TIMEOUT_MS: String(SEM_TETO_DE_COMANDO_MS),
    // definido em 2026-09-28: acima deste teto o CLI desviaria a resposta para um arquivo que o bot não lê.
    MAX_MCP_OUTPUT_TOKENS: String(MAX_MCP_OUTPUT_TOKENS_FILHO),
    ...(opcoes.claudeMdDasPastas ? { [CLAUDE_MD_DAS_PASTAS]: "1" } : {}),
  };
}

/** NOD-9: o retrato do CLI que um turno usa do começo ao fim. */
type LeituraDoCli = { binario: string; versao: string; flags: string[] };

const chavesSinais: readonly (keyof SinaisTurno)[] = ["attempted", "rejected", "promptSubmitted", "producedOutput"];

export function criarClaudeCliDriver(lig: LigacaoClaudeCli): Driver {
  const prazoSondaMs = lig.prazoSondaMs ?? PRAZO_SONDA_PADRAO_MS;
  const capacidadesDoDriver = capacidadesDe("claude-cli");
  return {
    meta: { id: "claude-cli", locality: "local", capacidades: capacidadesDoDriver },
    async create(cfgRecebida: ConfigDriver): Promise<Instance> {
      // definido em 2026-10-12 (ADR-101): o Claude também recebe as variáveis só dele — a conta em uso vai como
      // CLAUDE_CONFIG_DIR (desktop/contas-mac.ts). Sonda, turno e terminal usam o mesmo env, então a mesma conta.
      const cfg: ConfigDriver = { ...cfgRecebida, env: { ...cfgRecebida.env, ...(cfgRecebida.envPorDriver?.["claude-cli"] ?? {}) } };
      const home = cfg.env.HOME ?? homedir();
      const path = caminhoAumentado(cfg.env.PATH, home);
      const envBase = { ...cfg.env, PATH: path, HOME: home };
      let binario: string | null = null;
      let versao: string | null = null;
      // O "/" do chat (0038): o último catálogo entregue por este app; o próximo só vai se mudar.
      let catalogoEntregue: string | null = null;
      let flagsNoHelp: string[] | null = null;

      /** A releitura forçada em curso (NOD-9): dois turnos que saem do portão juntos leem o binário uma vez só. */
      let relendo: Promise<LeituraDoCli> | null = null;

      /**
       * `--version` + `--help` sem gastar turno; a sonda completa também preenche. Devolve um retrato (binário, versão e
       * flags juntos) que o turno usa do começo ao fim. `forcar` (NOD-9, depois de uma atualização): resolve o binário de
       * novo e lê tudo outra vez; o estado da instância só troca no fim, inteiro — um turno que já tinha o seu retrato não
       * vê um meio-termo, e quem chega durante a releitura espera a mesma.
       */
      async function garantirVersao(opcoes: { forcar?: boolean } = {}): Promise<LeituraDoCli> {
        if (opcoes.forcar) {
          relendo ??= lerDoZero().finally(() => { relendo = null; });
          return relendo;
        }
        if (relendo) return relendo;
        if (binario && versao) return { binario, versao, flags: flagsNoHelp ?? [] };
        const b = binario ?? await resolverBinario(cfg.bin, path, home);
        if (!b) throw new ErroDeDominio("executor_indisponivel", { cause: "motor_ausente" });
        const v = await lerVersao(b, envBase, prazoSondaMs);
        if ("erro" in v) throw new ErroDeDominio("executor_indisponivel", { cause: v.erro });
        // NOD-178: help lento não vira "sem flags" (que daria "Atualize"); a versão também não fica guardada, e a próxima chamada lê de novo.
        let flags = flagsNoHelp;
        if (flags === null) {
          const help = await lerFlagsDoHelp(b, envBase, prazoSondaMs);
          if ("erro" in help) throw new ErroDeDominio("executor_indisponivel", { cause: help.erro });
          flags = help.flags;
        }
        binario = b;
        versao = v.versao;
        flagsNoHelp = flags;
        return { binario: b, versao: v.versao, flags: flags ?? [] };
      }

      async function lerDoZero(): Promise<LeituraDoCli> {
        const b = await resolverBinario(cfg.bin, path, home);
        if (!b) throw new ErroDeDominio("executor_indisponivel", { cause: "motor_ausente" });
        const v = await lerVersao(b, envBase, prazoSondaMs);
        if ("erro" in v) throw new ErroDeDominio("executor_indisponivel", { cause: v.erro });
        const help = await lerFlagsDoHelp(b, envBase, prazoSondaMs);
        if ("erro" in help) throw new ErroDeDominio("executor_indisponivel", { cause: help.erro });
        binario = b;
        versao = v.versao;
        flagsNoHelp = help.flags;
        return { binario: b, versao: v.versao, flags: help.flags ?? [] };
      }

      return {
        async sondar(): Promise<Inventario> {
          if (lig.sondaSemTurno) {
            try {
              const v = await garantirVersao();
              const antigo = inventarioAbaixoDoPiso("claude-cli", v.versao, "Claude Code", Date.now());
              if (antigo) return antigo;
              const pisos = conferirFloors({ versao: v.versao, flags: FLAGS_DO_TURNO, flagsNoHelp: v.flags });
              if (!pisos.ok) return { estado: "ausente", motivo: "Atualize o Claude Code para continuar.", em: Date.now() };
              const r = await executarColetando({ bin: v.binario, args: ["auth", "status"], env: envBase, cwd: home, timeoutMs: prazoSondaMs });
              // NOD-178: o gate continua fechado, mas a pessoa lê que o Claude demorou, não que precisa entrar na conta.
              if (r.estourouTempo) return { estado: "nao_autenticado", motivo: motivoSondaLenta("Claude"), versao: v.versao, causa: "sonda_lenta", em: Date.now() };
              let autenticado = false;
              try { const status = JSON.parse(r.stdout) as { loggedIn?: boolean }; autenticado = status.loggedIn === true; } catch { /* Sem resposta estruturada, a sonda fecha o gate. */ }
              return r.exitCode === 0 && autenticado ? { estado: "pronto", versao: v.versao, em: Date.now() } : { estado: "nao_autenticado", motivo: "Abra o Claude Code e entre na sua conta.", versao: v.versao, em: Date.now() };
            } catch (erro) {
              if (ehErroDeDominio(erro) && erro.cause === "sonda_lenta") return { estado: "ausente", motivo: motivoSondaLenta("Claude"), causa: "sonda_lenta", em: Date.now() };
              if (ehErroDeDominio(erro) && erro.cause === "sem_node") return { estado: "ausente", motivo: motivoSemNode("Claude Code"), causa: "sem_node", em: Date.now() };
              return { estado: "ausente", motivo: "Instale ou atualize o Claude Code neste computador.", em: Date.now() };
            }
          }

          // medido em 2026-09-16 (e2e:haiku, primeira rodada): NOD_HOME/turnos ainda não existia na sonda do boot e o
          // mkdtemp falhava com ENOENT — o driver ia para a sombra com "create_falhou". O diretório nasce aqui também.
          await mkdir(cfg.cwdBase, { recursive: true });
          const s = await sondarDetalhado(cfg.bin, cfg.env, lig.modeloSonda ?? MODELO_SONDA_PADRAO, { home, cwdBase: cfg.cwdBase, timeoutVersaoMs: prazoSondaMs });
          binario = s.binario;
          flagsNoHelp = s.flagsNoHelp;
          if ("versao" in s.inventario && s.inventario.versao) versao = s.inventario.versao;
          // O turno de sonda custa (assinatura da pessoa): o custo sai no log para o roteiro de aceite somar (L9).
          log("info", "sonda_claude_cli", { estado: s.inventario.estado, motivo: "motivo" in s.inventario ? s.inventario.motivo : null, causa: "causa" in s.inventario ? (s.inventario.causa ?? null) : null, custo_usd: s.custoUsd });
          return s.inventario;
        },

        // definido em 2026-10-05 (emenda da ADR-019): o teste de verdade, mesmo quando `sondar()` só confere o login (o
        // app do Mac). Quem chama já viu o login passar, então a falha sai com a causa. Custa um turno da assinatura.
        async testar(pergunta: string) {
          await mkdir(cfg.cwdBase, { recursive: true });
          const s = await sondarDetalhado(cfg.bin, cfg.env, lig.modeloSonda ?? MODELO_SONDA_PADRAO, { home, cwdBase: cfg.cwdBase, pergunta, loginConferido: true, timeoutVersaoMs: prazoSondaMs });
          if (s.binario) binario = s.binario;
          if (s.flagsNoHelp) flagsNoHelp = s.flagsNoHelp;
          if ("versao" in s.inventario && s.inventario.versao) versao = s.inventario.versao;
          log("info", "teste_claude_cli", { estado: s.inventario.estado, causa: "causa" in s.inventario ? s.inventario.causa ?? null : null, custo_usd: s.custoUsd });
          return { inventario: s.inventario, resposta: s.resposta };
        },

        // X9 (definido em 2026-10-08, revisão do épico #188): o que o app anuncia é a promessa do driver com os pisos do
        // CLI instalado — sem `--fork-session` no help o turno de cópia é recusado (rodarTurno), e sem `--input-format` a
        // sessão não fica viva. Sem conseguir ler o help, fecha as duas (o servidor cai no caminho sem a capacidade).
        async capacidades() {
          const flags = await garantirVersao().then((l) => l.flags, () => [] as string[]);
          return {
            ...capacidadesDoDriver,
            bifurcaSessao: capacidadesDoDriver.bifurcaSessao && flags.includes("--fork-session"),
            mensagemNoMeio: capacidadesDoDriver.mensagemNoMeio && flags.includes("--input-format"),
          };
        },

        adapter(plano: PlanoTurno): Adapter {
          let processo: Processo | null = null;
          let interromperPedido = false;
          // ADR-067: a entrada da sessão viva fica aberta até o modelo responder sem nada em segundo plano e sem
          // mensagem nova; só então fecha e o processo sai. Fora da sessão viva ela fecha logo depois do prompt.
          let entradaAberta = false;
          // ADR-083 §6: a primeira fala depois de uma mensagem do meio sai na hora, de qualquer tamanho.
          const meio = criarFalaDoMeio();
          // X1 (revisto em 2026-10-08): o modelo está parado entre voltas (o último evento foi um `result`). Uma mensagem
          // escrita agora abre a próxima volta, sem narração de antes no caminho: a próxima fala já é a resposta.
          let entreVoltas = false;
          let sinksDoTurno: SinksTurno | null = null;

          return {
            aceitaMensagens: () => entradaAberta && processo !== null,
            receberMensagem(texto: string, id?: string): boolean {
              if (!entradaAberta || !processo) return false;
              processo.escrever(mensagemClaude(texto, []));
              // X1: no meio da volta, o CLI só lê a mensagem na fronteira seguinte (tool_result ou result).
              if (entreVoltas) meio.armar();
              else meio.absorveu();
              // X2: o stdin aceitou a escrita: a mensagem entrou na sessão.
              if (id !== undefined) sinksDoTurno?.mensagemEntrou?.(id);
              return true;
            },
            grupoDeProcessos: () => processo?.pid ?? null,

            async rodarTurno(sinks): Promise<ResultadoTurno> {
              sinksDoTurno = sinks;
              // `sinais` é marcado ANTES de cada sinal síncrono sair, para o `aoLinha` (que pode
              // receber o init enquanto um `await sinks.sinal` ainda está pendente) não o repetir.
              let sinais: SinaisTurno = { ...SINAIS_ZERADOS, attempted: true };
              await sinks.sinal("attempted");
              // NOD-9: o turno espera a atualização em curso; se uma terminou, lê o CLI de novo. O retrato (binário, versão e
              // flags) é deste turno: outro turno que relê depois não o troca no meio.
              let cli = (await lig.aguardarAtualizacao?.()) ? await garantirVersao({ forcar: true }) : await garantirVersao();
              // NOD-9: o modelo pede um Claude Code mais novo — o app atualiza já e o turno espera o fim antes de conferir.
              const minimaDoModelo = versaoMinimaDoModelo("claude-cli", plano.entrada.modelo);
              if (minimaDoModelo && compararVersoes(cli.versao, minimaDoModelo) < 0 && lig.aoPrecisarDeVersao) {
                if (await lig.aoPrecisarDeVersao(minimaDoModelo)) cli = await garantirVersao({ forcar: true });
                if (compararVersoes(cli.versao, minimaDoModelo) < 0) throw new ErroDeDominio("executor_indisponivel", { cause: "modelo_requer_cli" });
              }
              const { binario: bin, versao: v, flags: flagsDoTurno } = cli;
              if (!conferirPisoCli("claude-cli", v).ok) throw new ErroDeDominio("executor_indisponivel", { cause: "cli_antigo" });
              const floors = conferirFloors({ versao: v, flags: FLAGS_DO_TURNO, flagsNoHelp: flagsDoTurno });
              if (!floors.ok) throw new ErroDeDominio("executor_indisponivel", { cause: floors.motivo });
              // #193: a cópia da sessão exige a flag; sem ela o turno é recusado em vez de continuar a original.
              const bifurcar = plano.entrada.bifurcar === true && plano.entrada.sessaoCli !== null;
              if (bifurcar && !flagsDoTurno.includes("--fork-session")) throw new ErroDeDominio("executor_indisponivel", { cause: "cli_sem_fork_session" });

              // ADR-072: o turno-cérebro de uma ligação é um laço de voz, não um turno de chat.
              if (plano.modoTurno === "ligacao" && plano.ligacaoVoz) {
                if (!flagsDoTurno.includes("--input-format")) throw new ErroDeDominio("executor_indisponivel", { cause: "CLI sem --input-format: atualize o Claude Code para ligar" });
                return await rodarLigacaoClaude({
                  plano,
                  sinks,
                  bin,
                  flagsNoHelp: flagsDoTurno,
                  env: montarEnvDoFilho(cfg.env, home, plano.politicaExecucao.prazoMs),
                  cwdBase: cfg.cwdBase,
                  urlNod: lig.urlNod,
                  proxyPath: lig.proxyPath,
                  nodePath: lig.nodePath,
                  electronComoNode: lig.electronComoNode,
                  sigtermParaSigkillMs: lig.sigtermParaSigkillMs,
                  aoProcesso: (p) => {
                    processo = p;
                    if (p && interromperPedido) void p.interromper();
                  },
                });
              }

              // Fail-closed: sem --restricted comprovado no help, não se aponta o cwd para a pasta
              // da pessoa — antes o turno cai para o diretório temporário e as nativas desligadas.
              const confinavel = flagsDoTurno.includes("--restricted");
              const pastas = confinavel ? plano.workspacePastas ?? null : null;
              await mkdir(cfg.cwdBase, { recursive: true });
              const tmpdir = await mkdtemp(join(cfg.cwdBase, "turno-"));
              // QA da NOD-188: o try começa logo depois do mkdtemp. A config do hook e as pastas (inclusive a texto-<agenteId>)
              // são criadas aqui, e uma falha nelas deixava o tmpdir do turno para trás.
              try {
                // ADR-052: o kit do terminal só liga com o hook do nod e a pasta do bot; senão, as nativas de arquivo de antes.
                const pedeTerminal = (plano.nativas ?? []).some((n) => !(NATIVAS_DE_ARQUIVO as readonly string[]).includes(n));
                const windows = (lig.plataforma ?? process.platform) === "win32";
                // ADA-11 (ADR-147): no Windows, a pasta com nome que o NTFS não aceita deixa o turno sem o terminal.
                const pastaNoWindowsInvalida = windows && plano.pastaDoBot !== undefined && plano.pastaDoBot !== null && !pastaValidaNoWindows(plano.pastaDoBot);
                if (pastaNoWindowsInvalida && pedeTerminal) log("aviso", "pasta_invalida_no_windows", { turno_id: plano.turnoId });
                const pastaBot = pedeTerminal && lig.hookPath && confinavel && plano.pastaDoBot && !pastaNoWindowsInvalida ? join(home, "nod", plano.pastaDoBot) : null;
                let terminal: TurnoTerminal | undefined;
                if (pastaBot && lig.hookPath) {
                  await mkdir(pastaBot, { recursive: true });
                  const config = join(tmpdir, "hook-nativas.json");
                  // ADR-065: a pasta do bot e a home vão para a cerca do git fora da pasta (hook-nativas.ts). ADR-088: com
                  // task, o plano traz `<bot>/<slug>` (ehPastaDeTask) e a worktree nasce ali.
                  // ADR-097: a fila do forno da máquina, que todos os turnos daqui dividem.
                  const nodeDoHook = { nodePath: lig.nodePath ?? process.execPath, hookPath: lig.hookPath, electronComoNode: lig.electronComoNode, windows };
                  // ADA-11 (ADR-147): a fila do forno mede a árvore pelo `ps` e o `$$` do Git Bash não é o pid do Windows:
                  // na Fase 1 ela fica desligada no win32 e o comando roda direto.
                  const vaga = lig.filaDoForno === false || windows ? undefined : { dir: pastaDaFila(cfg.cwdBase), invocar: invocarDoHook(nodeDoHook) };
                  await writeFile(config, JSON.stringify({ url: lig.urlNod, token: plano.tokenDeTurno, pastaDoBot: pastaBot, home, daTask: ehPastaDeTask(plano.pastaDoBot!), ...(vaga ? { vaga } : {}), checkpoint: { turnoId: plano.turnoId, pastaDoBot: plano.pastaDoBot!, home: homedir() } }), { mode: 0o600 });
                  const comandoHook = comandoDoHook({ ...nodeDoHook, config });
                  // ADR-055: o Mac inteiro da pessoa, a começar pela pasta dela; os projetos autorizados continuam juntos.
                  const dirsExtras = [...new Set([home, ...(plano.workspacePastas?.aprovadas ?? [])])].filter((p) => p !== pastaBot);
                  terminal = { settings: settingsDoTerminal({ comandoHook }), dirsExtras };
                }
                // definido em 2026-10-07 (NOD-188, como a ligação na ADR-072): sem pasta, o cwd é estável por bot, não o
                // tmpdir do turno. O CLI põe o cwd no contexto de cada turno; mudando a cada um, o histórico inteiro era
                // reescrito no cache no --resume (medido no 2.1.292: 15% → 99% no 3º turno). O tmpdir segue com a config.
                const cwdEstavel = join(cfg.cwdBase, `texto-${plano.agenteId}`);
                if (!pastaBot && !pastas) await mkdir(cwdEstavel, { recursive: true });
                const diretorio = pastaBot ?? pastas?.ativa ?? cwdEstavel;
                const eventos: EventoStream[] = [];
                // Modo dev (0036): quando cada evento chegou, para o Raio-X pôr as chamadas e compactações no tempo.
                const inicio = Date.now();
                const momentos: number[] = [];
                const finalizar = async (r: ResultadoTurno): Promise<ResultadoTurno> => {
                  const execucao = montarExecucao(eventos, momentos, Date.now() - inicio);
                  const init = eventos.find((e): e is Extract<EventoStream, { tipo: "init" }> => e.tipo === "init");
                  let comandos: CatalogoDeComandos | undefined;
                  if (init && (init.skills?.length || init.comandos?.length)) {
                    const pastasDeProjeto = (terminal?.dirsExtras ?? pastas?.aprovadas ?? []).filter((p) => p !== home);
                    const catalogo = await lerCatalogoDoMac(init, { home, pastasDeProjeto }).catch(() => null);
                    const chave = catalogo ? JSON.stringify(catalogo) : null;
                    if (catalogo && chave !== catalogoEntregue) {
                      comandos = catalogo;
                      catalogoEntregue = chave;
                    }
                  }
                  // NOD-179: o último uso do plano que o CLI informou no turno, com o instante em que a linha chegou.
                  const usoDoPlano = ultimoUsoDoPlano(eventos, "claude-cli", (i) => inicio + (momentos[i] ?? 0));
                  // definido em 2026-10-05: a recusa da conta não vira fala do bot; vira falha com a causa em código.
                  // Chat limpo (PR 1): quantos blocos a fala colou acima da final vai junto, na execução do Raio-X.
                  return { ...comContaSemAcesso(r), ...(execucao ? { execucao: r.blocosColados !== undefined ? { ...execucao, blocosColados: r.blocosColados } : execucao } : {}), ...(comandos ? { comandos } : {}), ...(usoDoPlano ? { usoDoPlano } : {}) };
                };
                const mcpJson = await escreverMcpConfig(tmpdir, { url: lig.urlNod, tokenDeTurno: plano.tokenDeTurno, proxyPath: lig.proxyPath, nodePath: lig.nodePath, electronComoNode: lig.electronComoNode });
                // Fail-closed: sem --autocompact no help da versão instalada, o turno roda sem ela.
                const compactar = flagsDoTurno.includes("--autocompact");
                // Fail-closed como --autocompact: sem --input-format no help, o turno segue só com o texto e
                // uma linha por anexo dizendo que não foi lido — nunca some com o arquivo em silêncio.
                const anexos = plano.entrada.anexos?.length ? await baixarAnexos(plano, lig.urlNod) : [];
                // ADR-067: a sessão viva precisa da entrada em stream-json. O comando da conversa (/uso, /contexto,
                // /compactar) segue de uma vez só, pelo texto, como o CLI o reconhece desde a 0038.
                const comandoDaBarra = comecaComBarra(plano.entrada.texto);
                const temEntradaJson = flagsDoTurno.includes("--input-format");
                const viva = temEntradaJson && !comandoDaBarra;
                const streamJson = temEntradaJson && (viva || anexos.length > 0);
                // Sem o kit (sem hook nesta máquina), o prompt não pode prometer Bash e web: a linha que corrige vai junto.
                // NOD-183: a linha vai também no fim da parte volátil, depois do marcador, para não quebrar o cache.
                const semKit = pedeTerminal && !terminal ? comAvisoSemTerminal(plano) : {};
                const esforco = flagsDoTurno.includes("--effort");
                const systemPrompt = usaSystemPrompt(flagsDoTurno, v);
                const snapshotOff = usaSnapshotOff(flagsDoTurno, v);
                const planoDoTurno = { ...plano, ...semKit };
                // NOD-188: a parte volátil abre a mensagem do turno (o sistema leva só a estável).
                const texto = volatilNaMensagem(planoDoTurno, systemPrompt, plano.entrada.texto);
                const entradaStdin = streamJson
                  ? mensagemClaude(texto, anexos)
                  : [texto, ...anexos.map((a) => `[anexo "${a.meta.nome}" não pôde ser lido: esta versão do Claude Code não aceita arquivos. Diga isso à pessoa.]`)].join("\n\n");
                const { args } = montarArgs({ plano: { ...planoDoTurno, ...(pastas || terminal ? {} : { workspacePastas: null }) }, mcpJson, compactar, streamJson, terminal, esforco, systemPrompt, snapshotOff, bifurcar, windows });
                const env = montarEnvDoFilho(cfg.env, home, plano.politicaExecucao.prazoMs, { claudeMdDasPastas: Boolean(terminal) });

                const pendentes: Promise<void>[] = [];
                // ADR-067: o que segura a sessão viva aberta — comandos em segundo plano ainda rodando — e as voltas
                // do modelo já fechadas por um `result` (cada uma vira fala; a última vai na entrega).
                const emFundo = new Set<string>();
                const rodadas: EventoStream[][] = [];
                let inicioDaRodada = 0;
                let rodadasFaladas = 0;
                // Falas intermediárias saem da sessão viva; na sala, a fala passa pelos responders (postarNaSala) e
                // vai inteira na entrega.
                // NOD-402 (ADR-130): nem nos bastidores da conversa — a rotina não fala no meio; tudo vai na entrega,
                // que o `sem_novidade` cala.
                const falaNaHora = plano.modoTurno !== "sala" && !plano.bastidores && sinks.falaIntermediaria !== undefined;
                const falarRodadas = () => {
                  if (!falaNaHora) return;
                  for (; rodadasFaladas < rodadas.length; rodadasFaladas++) {
                    const texto = textoDaRodada(rodadas[rodadasFaladas]!, meio);
                    if (texto.trim() !== "") sinks.falaIntermediaria!(texto);
                  }
                };
                let decidindo: Promise<void> = Promise.resolve();
                const fechar = () => {
                  entradaAberta = false;
                  processo?.fecharStdin();
                };
                /** Depois de cada `result`: segue (algo em segundo plano, ou chegou mensagem) ou fecha a entrada. */
                const aposRodada = async (): Promise<void> => {
                  if (!entradaAberta) return;
                  if (emFundo.size > 0) return falarRodadas();
                  const chegou = sinks.ocioso ? await sinks.ocioso() : false;
                  if (!entradaAberta) return;
                  if (chegou || emFundo.size > 0) return falarRodadas();
                  fechar();
                };
                const proc = iniciarProcesso({
                  bin,
                  args,
                  env,
                  cwd: diretorio,
                  sigtermParaSigkillMs: lig.sigtermParaSigkillMs,
                  aoLinha(linha) {
                    for (const ev of eventosDaLinhaStreamJson(linha)) aoEvento(ev);
                  },
                });
                function aoEvento(ev: EventoStream): void {
                    if (ev.tipo === "ignorado") return;
                    eventos.push(ev);
                    momentos.push(Date.now() - inicio);
                    sinks.evento(ev);
                    if (ev.tipo === "delta") sinks.delta(ev.texto);
                    // ADR-083 §6: a resposta à mensagem do meio vira fala gravada agora, não passo do card.
                    const resposta = meio.avaliar(ev, falaNaHora);
                    if (resposta !== null && falaNaHora) sinks.falaIntermediaria!(resposta);
                    if (ev.tipo === "result") entreVoltas = true;
                    else if (ev.tipo === "delta" || ev.tipo === "texto_bloco" || ev.tipo === "tool_use" || ev.tipo === "init") entreVoltas = false;
                    if (ev.tipo === "tarefa_fundo") {
                      // NOD-350: o subagente em primeiro plano não segura a sessão viva (e fica fora da lista da task).
                      if (ev.estado === "terminada") emFundo.delete(ev.id);
                      else if (ev.emFundo !== false) emFundo.add(ev.id);
                    }
                    if (ev.tipo === "result") {
                      rodadas.push(eventos.slice(inicioDaRodada));
                      inicioDaRodada = eventos.length;
                      if (viva) decidindo = decidindo.then(aposRodada).catch(() => fechar());
                    }
                    const depois = reduzirSinais(sinais, ev);
                    for (const k of chavesSinais) {
                      if (depois[k] && !sinais[k]) pendentes.push(sinks.sinal(k));
                    }
                    sinais = depois;
                }
                processo = proc;
                if (interromperPedido) await proc.interromper();

                // ADR-009: promptSubmitted é gravado ANTES de o prompt sair para o CLI.
                sinais = { ...sinais, promptSubmitted: true };
                await sinks.sinal("promptSubmitted");
                proc.escrever(entradaStdin);
                if (viva) entradaAberta = true;
                else proc.fecharStdin();

                const fim = await proc.fim;
                entradaAberta = false;
                await decidindo;
                await Promise.all(pendentes);
                const exitCode = fim.erroSpawn ? null : fim.exitCode;
                const signal = fim.erroSpawn ? null : fim.signal;
                // ADA-242 (plano do #691, passo 5): o motivo do spawn que não aconteceu (ENOENT, EACCES) fica só no log da
                // máquina; a conversa recebe a frase de lancamento_falhou ("neste computador"), nunca o erro do sistema.
                if (fim.erroSpawn) log("aviso", "claude_cli_nao_abriu", { turno_id: plano.turnoId, codigo: (fim.erroSpawn as NodeJS.ErrnoException).code ?? null });
                const classificado = classificarSessao({ eventos, exitCode, signal, stderr: fim.stderr, sinais, interrompidoPeloDriver: proc.interrompido(), driver: "claude-cli", rodadasJaFaladas: rodadasFaladas, falaDoMeio: meio });
                // NOD-264 (C20): sem result, o log da máquina guarda a causa e o fim do stderr (redigido); a ponte só leva a causa.
                if (classificado.desfecho === "interrompido") log("aviso", "turno_sem_result", { turno_id: plano.turnoId, causa: classificado.causa ?? null, stderr: fimDoStderr(fim.stderr) });
                return finalizar(classificado);
              } finally {
                processo = null;
                entradaAberta = false;
                await rm(tmpdir, { recursive: true, force: true });
              }
            },

            async interromper(): Promise<void> {
              interromperPedido = true;
              if (processo) await processo.interromper();
            },
          };
        },

        async dispose(): Promise<void> {
          // cada turno limpa o próprio tmpdir; a pasta texto-<agenteId> (NOD-188) é reusada entre turnos, como a da ligação
        },
      };
    },
  };
}
