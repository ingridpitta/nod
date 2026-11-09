import { semPadraoDeBusca, tocaCredencial } from "./comando.ts";
import { arquivoForaDaPastaDoBot, gitForaDaPastaDoBot, type ContextoDaPasta } from "./git-na-pasta-do-bot.ts";
import { FERRAMENTAS_DE_TAREFA } from "./tarefas-do-bot.ts";
import type { Confianca } from "../contracts/mensagem.ts";
import type { IdHarness } from "../contracts/harness.ts";
import type { ModoTurno } from "../contracts/plano-turno.ts";

/**
 * Ferramentas nativas de arquivo do Claude Code liberadas quando há projeto autorizado (ADR-039). Bash fica
 * fora: --restricted remove as ferramentas que rodam comando, e comando continua indo ao container do nod.
 * Medido em 2026-09-18: com --restricted, ler fora das pastas permitidas é NEGADO pelo CLI (aparece em
 * permission_denials), por caminho relativo e absoluto, e o CLAUDE.md do projeto é ignorado.
 */
export const NATIVAS_DE_ARQUIVO = ["Read", "Edit", "Write", "Glob", "Grep", "NotebookEdit"] as const;

/**
 * definido em 2026-09-28 (emenda da ADR-055, "as skills do terminal"): as skills da pessoa e os subagentes. Sem a
 * ferramenta Skill, o Dev 1 respondeu "não tenho ferramenta de skills" a um pedido de /review — as 305 skills dela
 * e os plugins já vinham carregados pelo --add-dir da pasta dela, e nenhuma podia ser chamada. Medido no CLI
 * 2.1.284: o hook do nod recebe a Skill e o Agent, e DEPOIS cada ferramenta que a skill ou o subagente usa (o Bash
 * do subagente chega com o agent_id dele) — a decisão do servidor continua em toda chamada. O `init` lista o
 * subagente como "Task"; o --tools aceita e o hook recebe "Agent".
 */
export const NATIVAS_DE_SKILL = ["Skill", "Agent"] as const;

/**
 * definido em 2026-09-28 (ADR-052): o kit do terminal — o que a pessoa faz no Claude Code, o bot faz no nod.
 * Cada chamada passa pelo hook PreToolUse do nod (trilha no servidor). Só no harness Claude Code, com o hook.
 * revisto em 2026-09-28 (ADR-055): sem sandbox — arquivos em qualquer lugar do Mac, Bash com rede e as
 * credenciais da pessoa, e cada comando decidido pelo servidor (leitura roda, o resto pede aprovação).
 * revisto em 2026-10-01 (ADR-067): `Monitor` (acompanha um comando e acorda o bot a cada linha) e `TaskStop` (para um
 * comando que o próprio bot pôs em segundo plano) — o que deixa o trabalho seguir por horas, como no Claude Code.
 */
export const NATIVAS_DE_SEGUNDO_PLANO = ["Monitor", "TaskStop"] as const;
export const NATIVAS_DO_TERMINAL = [...NATIVAS_DE_ARQUIVO, "Bash", ...NATIVAS_DE_SEGUNDO_PLANO, "WebFetch", "WebSearch", ...NATIVAS_DE_SKILL, ...FERRAMENTAS_DE_TAREFA] as const;

/**
 * definido em 2026-10-14 (ADR-103, paridade do Codex): o kit do terminal no Codex, pelo nome que o PreToolUse do Codex
 * informa ao hook (medido no 0.147.0 com um turno real: "Bash" para o shell e o `exec_command`, "apply_patch" para criar
 * e editar arquivo, com o patch inteiro em `tool_input.command`). `spawn_agent` é o subagente (o `Agent` do Claude) e
 * `view_image` lê uma imagem do disco. `web_search` é ferramenta hospedada: o hook nunca a vê (documentação de hooks do
 * Codex, "Tool coverage"); quem avisa o servidor é o driver, pelo item `webSearch` do stream, e a chamada contamina o
 * turno como a busca do Claude. Skills do Codex não são ferramenta: entram como instrução.
 */
export const NATIVAS_DO_TERMINAL_CODEX = ["Bash", "apply_patch", "view_image", "spawn_agent", "web_search"] as const;

/**
 * definido em 2026-10-14 (ADR-103): uma ferramenta de um servidor MCP DA PESSOA (o config.toml dela), nunca o do nod.
 * Não passa pelo proxy: o hook a manda ao servidor como esta nativa, que decide pelo modo como um comando que muda algo.
 */
export const NATIVA_MCP_DA_PESSOA = "mcp_da_pessoa";

/**
 * Os modos em que o turno é da dona do bot (ADR-103): ela abriu a conversa, criou o bot ou marcou a rotina. Num pedido
 * de colega, numa sala ou numa ligação, um MCP dela usaria as credenciais dela a pedido de outra pessoa.
 */
const MODOS_DA_DONA: readonly ModoTurno[] = ["conversa", "criacao", "rotina"];

/** As nativas que trazem conteúdo de FORA para o turno: a chamada marca o turno como contaminado (0033). */
export const NATIVAS_QUE_CONTAMINAM: readonly string[] = ["WebFetch", "WebSearch", "web_search", NATIVA_MCP_DA_PESSOA];

/**
 * Quais nativas o turno recebe. definido em 2026-09-28: só turno de CONVERSA e CONFIÁVEL. Até aqui qualquer
 * turno de uma conversa com pasta autorizada ganhava Write/Edit nativos — inclusive a continuação com a
 * resposta de um colega (não confiável) e a retomada de rotina com gate. As nativas não passam pelo proxy:
 * não há moldura nem catálogo reduzido que as segure (ADR-026), então o único gate possível é não ligá-las.
 * revisto em 2026-09-28 (ADR-050, "bot novo é bot completo"): a criação também — é a mesma conversa própria,
 * aberta pela pessoa; antes ela nem tinha pasta, e bot novo com workspace_* sem Write/Edit ficaria pela metade.
 * revisto em 2026-09-28 (ADR-052): com o harness Claude Code (`terminal`), o turno de conversa confiável tem o
 * kit do terminal mesmo sem pasta de projeto — a pasta do bot (~/nod/<bot>) é sempre dele.
 * revisto em 2026-10-01 (ADR-066, "o bot tem o que você deu; o modo decide"): com o hook, o kit vale em TODO modo —
 * rotina, pedido de colega, sala — e com qualquer confiança da entrada. O motivo de desligar ("as nativas não passam
 * pelo proxy, o único gate é não ligá-las") caiu com a ADR-052: o hook leva cada chamada ao servidor, o Bash é
 * decidido pelo modo e, desde esta ADR, o Edit/Write fora da pasta do bot também. Em 30/09 os Devs não
 * implementaram nenhum dos 6 pedidos do Chico porque o pedido de colega não tinha terminal. Só o peer legado fica
 * sem. Sem o hook (driver antigo, só --restricted), ninguém decide as nativas: elas ficam na conversa confiável.
 */
/**
 * revisto em 2026-10-14 (ADR-103): com `harness` = Codex e o terminal, o kit dele (NATIVAS_DO_TERMINAL_CODEX), mais o
 * MCP da pessoa nos modos da dona. A regra de QUANDO há terminal é a mesma dos dois harnesses.
 */
export function nativasDoTurno(t: { modo: ModoTurno; confianca: Confianca; pastasAutorizadas: boolean; terminal?: boolean; harness?: IdHarness | null }): readonly string[] {
  if (t.modo === "peer") return [];
  if (t.terminal && t.harness === "codex-cli") return MODOS_DA_DONA.includes(t.modo) ? [...NATIVAS_DO_TERMINAL_CODEX, NATIVA_MCP_DA_PESSOA] : NATIVAS_DO_TERMINAL_CODEX;
  if (t.terminal) return NATIVAS_DO_TERMINAL;
  return t.pastasAutorizadas && (t.modo === "conversa" || t.modo === "criacao") && t.confianca === "confiavel" ? NATIVAS_DE_ARQUIVO : [];
}

/** Por que um turno de harness com terminal ficou sem ele: o modo, ou a entrada que veio de fora. */
export type MotivoSemTerminal = "pedido_de_colega" | "rotina" | "sala" | "conteudo_de_fora" | "resposta_a_colega" | "pedido_de_outra_pessoa";

/**
 * definido em 2026-10-01 (ADR-065): o motivo vai ao prompt, porque sem ele o bot não sabe por que tem terminal num
 * turno e não no outro. Em 30/09 os Devs responderam "neste turno não tenho terminal" a 6 de 6 pedidos de implementar
 * do Chico, a Clarice gravou na memória que os Devs "não têm terminal" e o Marlon perguntou cinco vezes como
 * desbloqueá-los. Sai da MESMA regra de `nativasDoTurno`: se ela mudar, o motivo acompanha. null = o turno tem o
 * terminal, ou o harness nunca o teria (Codex, máquina sem o hook) — aí não há o que explicar.
 */
export function motivoSemTerminal(t: { modo: ModoTurno; confianca: Confianca; terminal?: boolean; deOutraPessoa?: boolean }): MotivoSemTerminal | null {
  if (!t.terminal) return null;
  // NOD-443 (ADR-143, revisão 3 do PR #628): o turno a pedido de outra pessoa não tem o terminal (montarPlano o tira).
  if (t.deOutraPessoa) return "pedido_de_outra_pessoa";
  if (nativasDoTurno({ modo: t.modo, confianca: t.confianca, pastasAutorizadas: false, terminal: true }).includes("Bash")) return null;
  // Confiável, o mesmo modo teria o terminal: o que tirou foi a entrada.
  if (nativasDoTurno({ modo: t.modo, confianca: "confiavel", pastasAutorizadas: false, terminal: true }).includes("Bash")) return "conteudo_de_fora";
  if (t.modo === "delegacao") return "pedido_de_colega";
  if (t.modo === "rotina") return "rotina";
  if (t.modo === "sala") return "sala";
  return "resposta_a_colega";
}

/** Nome da pasta do bot no Mac da pessoa (~/nod/<nome>): o nome dele, sem o que o sistema de arquivos não aceita. */
export function pastaDoBot(nome: string): string {
  const limpo = nome.normalize("NFC").replace(/[/\\:\0]/g, "-").replace(/^\.+/, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return limpo === "" ? "bot" : limpo;
}

/**
 * A pasta do turno (relativa a `~/nod`) é a de uma task? definido em 2026-10-09 (ADR-088): a do bot nunca tem barra
 * (`pastaDoBot` troca a barra por hífen) e a da task é `<bot>/<slug>` (`pastaRelativa` de `trabalhos.pasta`).
 */
export function ehPastaDeTask(pastaRelativaANod: string): boolean {
  return pastaRelativaANod.includes("/");
}

/**
 * `comando` = o Bash: quem decide é o SERVIDOR (autorizar-comando.ts), com o comando na mão — só lê roda direto,
 * o resto vira card. O hook nunca decide um comando sozinho.
 */
/**
 * `arquivo` (definido em 2026-10-01, ADR-066): Write/Edit/NotebookEdit fora de ~/nod/<bot> — o servidor decide pelo
 * modo, como o comando. Só com o contexto da pasta (config do hook novo); sem ele, a gravação passa como antes.
 */
/**
 * `credencial` (definido em 2026-10-19, plano dos modos de aprovação, PR 6): o arquivo de credencial (ou, no MCP da pessoa,
 * o pedido que cita uma) que o hook manda ao SERVIDOR, que decide pelo modo atual: manual nega com a frase de sempre,
 * automático vira cartão, total roda e registra. Antes o hook negava aqui mesmo, sem saber o modo. O hook só deixa a
 * chamada passar com a confirmação EXPLÍCITA do servidor (`credencial: "permitida"`): um servidor antigo ignora o campo e
 * responde `{ ok: true }` ao Read, e a credencial seria lida até no manual (revisão de engenharia do plano, item 12).
 */
export type DecisaoNativa = { permitir: boolean; motivo: string; contamina: boolean; comando?: string; arquivo?: string; mcp?: string; credencial?: string };

/** A frase de sempre quando a credencial não passa (manual, servidor antigo, resposta sem a confirmação explícita). */
export const FRASE_ARQUIVO_DE_CREDENCIAL = "arquivo de credencial (chaves, tokens, Keychain): o nod não abre; se a tarefa precisar, peça à pessoa";
export const FRASE_MCP_COM_CREDENCIAL = "o pedido toca uma credencial (chaves, tokens, Keychain): o nod não manda; se a tarefa precisar, peça à pessoa";
const FRASE_CREDENCIAL_NO_WINDOWS = "o comando toca um arquivo de credencial do Windows (chaves, tokens, o cofre): o nod não roda; se a tarefa precisar, peça à pessoa";
const MOTIVO_CREDENCIAL = "credencial do Mac: o servidor do nod decide pelo modo de aprovação";

/**
 * TODOS os caminhos da chamada que tocam credencial, separados por espaço (revisão do PR 6): o servidor confere neles a
 * chave do próprio nod, que nem o total libera. Mandar só o primeiro deixava um patch com `~/.ssh/config` e
 * `~/.config/nod-motor/conexao.json` (ou um Grep com `path` em `~/.ssh` e `pattern` na chave do nod) passar no total
 * como se fosse só a chave SSH. O cartão do Automático também mostra todos.
 */
function credencialDosCaminhos(caminhos: readonly string[], windows = false): string | undefined {
  const tocam = caminhos.filter((c) => tocaCredencial(c, { windows }));
  return tocam.length > 0 ? tocam.join(" ") : undefined;
}

/**
 * definido em 2026-10-14 (ADR-103): os arquivos que um `apply_patch` do Codex cria, muda, apaga ou para onde move.
 * Formato medido no 0.147.0 (`*** Begin Patch` / `*** Add File: <caminho>` / `*** End Patch`); os outros cabeçalhos
 * são os da gramática do apply_patch (`Update File`, `Delete File`, `Move to`).
 */
export function caminhosDoPatch(patch: string): string[] {
  const caminhos: string[] = [];
  for (const linha of patch.split("\n")) {
    const m = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(linha.trimEnd());
    if (m) caminhos.push(m[1]!.trim());
  }
  return caminhos;
}

/** O pedido de um MCP da pessoa como o card o mostra: servidor, ferramenta e argumentos, com teto. */
const TETO_ARGUMENTOS_MCP = 2_000;
function textoDoMcp(ferramenta: string, entrada: Record<string, unknown>): string {
  const [, servidor = "", ...resto] = ferramenta.split("__");
  const argumentos = JSON.stringify(entrada);
  return `${servidor}: ${resto.join("__")} ${argumentos.length > TETO_ARGUMENTOS_MCP ? `${argumentos.slice(0, TETO_ARGUMENTOS_MCP)}…` : argumentos}`;
}

/**
 * A decisão do hook do nod para UMA chamada nativa, pura. revisto em 2026-09-28 (ADR-055, "terminal de verdade,
 * como o inhouse"): a pessoa escolheu que o bot lê e grava em QUALQUER lugar do Mac, como ela no Claude Code —
 * as nativas de arquivo não são mais confinadas à pasta do bot (ADR-052). O Bash roda fora de sandbox, com rede e
 * as credenciais dela, e por isso cada comando passa pelo servidor. Fail-closed: ferramenta desconhecida e Bash
 * sem comando → nega.
 */
/**
 * `mcpDaPessoa` (definido em 2026-10-14, ADR-103): o turno do Codex carregou os MCPs da pessoa, e uma ferramenta MCP que
 * não é do nod vai ao servidor. Sem a marca (o Claude, ou um modo que não é da dona), MCP segue com o proxy, como antes.
 */
export function decidirNativa(p: { ferramenta: string; entrada: Record<string, unknown>; pasta?: ContextoDaPasta; mcpDaPessoa?: boolean }): DecisaoNativa {
  // Ferramenta MCP do nod não é nativa: quem decide é o proxy (ADR-013), que também grava a trilha. Medido ao
  // vivo em 2026-09-28: com o matcher "*", o CLI consultava o hook para MCP e ele negava publicar_artefato.
  if (p.ferramenta.startsWith("mcp__nod__") || (p.ferramenta.startsWith("mcp__") && !p.mcpDaPessoa)) return { permitir: true, motivo: "ferramenta do nod: quem decide é o proxy", contamina: false };
  // ADR-103: no Codex, os MCPs da pessoa carregam junto com o do nod; cada chamada vai ao servidor, que decide pelo modo.
  if (p.ferramenta.startsWith("mcp__")) {
    const texto = textoDoMcp(p.ferramenta, p.entrada);
    if (tocaCredencial(texto, { windows: p.pasta?.windows === true })) return { permitir: true, motivo: MOTIVO_CREDENCIAL, contamina: true, mcp: texto, credencial: texto };
    return { permitir: true, motivo: "app da pessoa: o servidor do nod decide", contamina: true, mcp: texto };
  }
  switch (p.ferramenta) {
    // ADR-103: o apply_patch do Codex grava (cria, muda, apaga, move) os arquivos do patch — a mesma regra do Write.
    case "apply_patch": {
      const patch = typeof p.entrada.command === "string" ? p.entrada.command : "";
      const caminhos = caminhosDoPatch(patch);
      if (caminhos.length === 0) return { permitir: false, motivo: "patch sem arquivo reconhecível", contamina: false };
      const credencialNoPatch = credencialDosCaminhos(caminhos, p.pasta?.windows === true);
      if (credencialNoPatch !== undefined) return { permitir: true, motivo: MOTIVO_CREDENCIAL, contamina: false, credencial: credencialNoPatch };
      const fora = p.pasta ? caminhos.map((c) => arquivoForaDaPastaDoBot(c, p.pasta!)).find((f) => f !== null) ?? null : null;
      return { permitir: true, motivo: "arquivos do Mac da pessoa", contamina: false, ...(fora ? { arquivo: fora } : {}) };
    }
    case "view_image": {
      const caminho = typeof p.entrada.path === "string" ? p.entrada.path : "";
      if (tocaCredencial(caminho, { windows: p.pasta?.windows === true })) return { permitir: true, motivo: MOTIVO_CREDENCIAL, contamina: false, credencial: caminho };
      return { permitir: true, motivo: "arquivos do Mac da pessoa", contamina: false };
    }
    case "spawn_agent":
      return { permitir: true, motivo: "subagente: cada ferramenta dele passa pelo nod", contamina: false };
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
    case "Glob":
    case "Grep": {
      // ADR-055: o Mac inteiro; onde moram as credenciais, o servidor decide pelo modo (PR 6 dos modos de aprovação) —
      // lê-las é o primeiro passo para vazá-las, e só o "Ignorar todas as aprovações" lê sem a pessoa.
      const caminhos = ["file_path", "notebook_path", "path", "pattern", "glob"].map((k) => p.entrada[k]).filter((v): v is string => typeof v === "string");
      const credencial = credencialDosCaminhos(caminhos, p.pasta?.windows === true);
      if (credencial !== undefined) return { permitir: true, motivo: MOTIVO_CREDENCIAL, contamina: false, credencial };
      // ADR-066: gravar fora da pasta do bot segue o modo de aprovação (o servidor decide); ler continua livre.
      const grava = p.ferramenta === "Write" || p.ferramenta === "Edit" || p.ferramenta === "NotebookEdit";
      const alvo = typeof p.entrada.file_path === "string" ? p.entrada.file_path : typeof p.entrada.notebook_path === "string" ? p.entrada.notebook_path : null;
      const arquivo = grava && p.pasta && alvo !== null ? arquivoForaDaPastaDoBot(alvo, p.pasta) : null;
      return { permitir: true, motivo: "arquivos do Mac da pessoa", contamina: false, ...(arquivo ? { arquivo } : {}) };
    }
    // ADR-067: o Monitor roda um comando como o Bash (cada linha da saída acorda o bot) — mesma cerca e mesma decisão.
    case "Bash":
    case "Monitor": {
      const comando = typeof p.entrada.command === "string" ? p.entrada.command : "";
      if (comando.trim() === "") return { permitir: false, motivo: "comando vazio", contamina: false };
      // ADR-065: git que mexe na pasta de trabalho só na pasta do bot — cerca local, antes do servidor, em qualquer modo.
      const fora = p.pasta ? gitForaDaPastaDoBot(comando, p.pasta) : null;
      // Revisão 10 do PR #642 (médio 1): o servidor não sabe a plataforma e confere o comando só pelo texto. O que só a
      // regra do Windows pega (`cat ~/.AWS/credentials` no Git Bash, `~/.aws./credentials`) o hook do win32 nega aqui.
      if (!fora && p.pasta?.windows === true && tocaCredencial(semPadraoDeBusca(comando), { windows: true }) && !tocaCredencial(comando)) return { permitir: false, motivo: FRASE_CREDENCIAL_NO_WINDOWS, contamina: false };
      return fora ? { permitir: false, motivo: fora, contamina: false } : { permitir: true, motivo: "o servidor do nod decide o comando", contamina: false, comando };
    }
    case "WebFetch":
    case "WebSearch":
      return { permitir: true, motivo: "conteúdo da web: o turno passa a tratar escrita externa como não confiável", contamina: true };
    // Emenda da ADR-055: a skill é instrução dos arquivos da própria pessoa, e o subagente é o mesmo modelo com as
    // mesmas ferramentas; o que cada um USA passa por aqui de novo, chamada por chamada.
    case "Skill":
      return { permitir: true, motivo: "skill da pessoa: cada ferramenta que ela usar passa pelo nod", contamina: false };
    case "Agent":
      return { permitir: true, motivo: "subagente: cada ferramenta dele passa pelo nod", contamina: false };
    // A lista de tarefas do bot só organiza o trabalho dentro da sessão: não lê nem muda nada fora dela.
    case "TaskCreate":
    case "TaskGet":
    case "TaskList":
    case "TaskUpdate":
      return { permitir: true, motivo: "lista de tarefas do bot", contamina: false };
    // ADR-067: parar um comando que o próprio bot pôs em segundo plano não toca nada fora da sessão.
    case "TaskStop":
      return { permitir: true, motivo: "para um comando que o bot pôs em segundo plano", contamina: false };
    default:
      return { permitir: false, motivo: `ferramenta fora do kit do nod: ${p.ferramenta}`, contamina: false };
  }
}
