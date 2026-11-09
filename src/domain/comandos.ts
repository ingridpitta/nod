import {
  TETO_COMANDOS,
  TETO_DESCRICAO_COMANDO,
  TETO_SO_DO_TERMINAL,
  type CatalogoDeComandos,
  type ComandoDaConversa,
  type ComandoDoMac,
} from "../contracts/comandos.ts";
import { HARNESS_LEGADO, type IdHarness } from "../contracts/harness.ts";
import { semCitacao } from "./citacao.ts";
import { capacidadesDe } from "./harness.ts";

/**
 * Os comandos da conversa (definido em 2026-09-28, canvas "Comandos /"). Nomes em português, e o nome do terminal como
 * apelido: quem vem do Claude Code digita /context e acha o mesmo. Medido no CLI 2.1.284 em `-p`: /context e /cost
 * respondem sem chamar o modelo (US$ 0); /compact funciona numa sessão retomada. O /clear NÃO serve: numa sessão
 * retomada ele emite `conversation_reset` com um id novo, e a sessão original continua lembrando de tudo (retomada,
 * respondeu a palavra guardada antes) — a nova sessão é do nod (nova-sessao.ts), nunca do CLI.
 */
export const COMANDOS_DA_CONVERSA: readonly ComandoDaConversa[] = [
  { nome: "contexto", apelidos: ["context"], descricao: "Quanto da janela o bot já está usando", acao: "turno", cli: "/context", gratis: true },
  { nome: "uso", apelidos: ["cost", "usage"], descricao: "Quanto da sua assinatura já foi nesta sessão e na semana", acao: "turno", cli: "/cost", gratis: true },
  { nome: "compactar", apelidos: ["compact"], descricao: "Resume o histórico e libera a janela; o bot continua daqui", acao: "turno", cli: "/compact" },
  { nome: "nova-sessao", apelidos: ["clear", "nova-sessão"], descricao: "O bot começa do zero; a conversa continua aqui para você", acao: "nod" },
  { nome: "modelo", apelidos: ["model", "effort", "esforco", "esforço"], descricao: "Troca o modelo e o esforço do bot", acao: "tela" },
  // NOD-23 (definido em 2026-10-28): o bot entrevista a pessoa e propõe o perfil de novo (src/domain/reconfiguracao.ts).
  // Sem `cli`: o nod troca a entrada pelo pedido da entrevista (montarPlano). `config` sai de "só do terminal".
  { nome: "configurar", apelidos: ["setup", "config"], descricao: "O bot te entrevista e propõe um perfil novo", acao: "turno", soBotProprio: true },
];

/** "/Nome args" → o comando da conversa pelo nome ou apelido, sem diferença de caixa. */
export function comandoDaConversa(texto: string): { comando: ComandoDaConversa; resto: string } | null {
  const m = /^\/(\S+)([\s\S]*)$/.exec(texto.trimStart());
  if (!m) return null;
  const nome = m[1]!.toLowerCase();
  const comando = COMANDOS_DA_CONVERSA.find((c) => c.nome === nome || c.apelidos.includes(nome));
  return comando ? { comando, resto: m[2]!.trim() } : null;
}

/**
 * NOD-23 (2026-10-28): a fala é um comando da conversa com turno próprio (/configurar, /contexto, /uso, /compactar), com
 * ou sem a citação na frente. Ela não entra na fila lida junta nem no turno vivo: sem o plano dela, ia crua ao CLI.
 */
export function ehComandoDeTurno(texto: string): boolean {
  return comandoDaConversa(semCitacao(texto))?.comando.acao === "turno";
}

/**
 * definido em 2026-10-06 (NOD-179): o /cost é do Claude Code. Num bot de outra IA (Codex) ele ia como prompt, e o
 * modelo inventava uma resposta; o uso do plano fica no nod, gravado a cada turno do Claude Code. revisto em 2026-10-22
 * (NOD-12): o uso mora na linha de cada conta em Provedores de IA (a tela "Conexão" mudou de nome).
 */
export const USO_FORA_DO_CLAUDE = "O uso do plano está em Seu espaço › Provedores de IA.";

/**
 * O comando da conversa só vira o do CLI quando o harness do turno tem `comandosDoCli` (ADR-083); sem harness (catcher,
 * legado), vale o do legado (HARNESS_LEGADO).
 */
function ehClaudeCode(harness: IdHarness | null | undefined): boolean {
  return capacidadesDe(harness ?? HARNESS_LEGADO).comandosDoCli;
}

/**
 * A entrada do turno com o comando do CLI no lugar do nome da conversa: "/contexto" → "/context", "/compactar foca
 * no PR" → "/compact foca no PR". Qualquer outro texto passa igual — "/review 420" já é o que o CLI entende.
 * Fora do Claude Code, /uso não vira /cost: pede só a frase fixa (a resposta é trocada por ela no assentar).
 */
export function traduzirParaOCli(texto: string, harness?: IdHarness | null): string {
  const c = comandoDaConversa(texto);
  if (!c || c.comando.acao !== "turno" || !c.comando.cli) return texto;
  if (c.comando.nome === "uso" && !ehClaudeCode(harness)) return `Responda só esta frase, sem usar ferramentas: "${USO_FORA_DO_CLAUDE}"`;
  return c.resto ? `${c.comando.cli} ${c.resto}` : c.comando.cli;
}

export type Frontmatter = { name?: string; description?: string; argumentHint?: string; userInvocable?: boolean };

/**
 * Comando sem frontmatter (os `hm-*` da pessoa começam por "# /hm-deploy — Validacao de Deploy (v2)"): a descrição sai
 * do primeiro título ou linha, sem os # e sem o "/nome —" do começo.
 */
function tituloComoDescricao(texto: string): { description?: string } {
  const linha = texto.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "" && l !== "---");
  if (!linha) return {};
  const limpa = linha.replace(/^#+\s*/, "").replace(/^\/[\w.:-]+\s*[—–-]\s*/, "").trim();
  return limpa ? { description: limpa } : {};
}

function semAspas(v: string): string {
  const t = v.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t;
}

/**
 * O cabeçalho YAML de um SKILL.md ou comando, só as chaves que o "/" usa. Subconjunto de YAML de propósito: chave: valor
 * numa linha, com ou sem aspas, e o bloco dobrado (`>-`, `|`) das descrições longas. O resto é ignorado.
 */
export function lerFrontmatter(md: string): Frontmatter {
  // Sem o fechamento: o cabeçalho passou do trecho lido (skills do plugin vercel têm metadados longos) — vale o que veio.
  const m = /^---\r?\n([\s\S]*?)(?:\r?\n---|$)/.exec(md);
  if (!m) return tituloComoDescricao(md);
  const linhas = m[1]!.split(/\r?\n/);
  const valores: Record<string, string> = {};
  for (let i = 0; i < linhas.length; i++) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(linhas[i]!);
    if (!kv) continue;
    let valor = kv[2]!;
    if (/^[>|][-+]?$/.test(valor.trim())) {
      const bloco: string[] = [];
      while (i + 1 < linhas.length && /^\s+\S/.test(linhas[i + 1]!)) bloco.push(linhas[++i]!.trim());
      valor = bloco.join(" ");
    }
    valores[kv[1]!] = semAspas(valor);
  }
  const booleano = (v: string | undefined) => (v === undefined ? undefined : v.trim().toLowerCase() !== "false");
  if (!valores.description) Object.assign(valores, tituloComoDescricao(md.slice(m[0].length)));
  return {
    ...(valores.name ? { name: valores.name } : {}),
    ...(valores.description ? { description: valores.description } : {}),
    ...(valores["argument-hint"] ? { argumentHint: valores["argument-hint"] } : {}),
    ...(valores["user-invocable"] !== undefined ? { userInvocable: booleano(valores["user-invocable"]) } : {}),
  };
}

/** Skills embutidas do Claude Code que não entram no "/": concorrem com o nod (rotinas, configuração) ou são do terminal. */
const EMBUTIDAS_FORA_DO_CHAT = new Set(["loop", "schedule", "update-config", "fewer-permission-prompts", "doctor", "run-skill-generator", "workflow-authoring", "design-sync"]);
/** Comandos embutidos (sem arquivo, fora da lista de skills) que fazem sentido no chat e rodam em `-p`. */
const COMANDOS_EMBUTIDOS_NO_CHAT: Record<string, string> = {
  "security-review": "Revisão de segurança das mudanças do branch",
};
/** Descrições das embutidas mais usadas; as outras aparecem sem descrição (o CLI não a expõe no `init`). */
const DESCRICAO_EMBUTIDA: Record<string, string> = {
  "code-review": "Revisa um pull request ou as mudanças do branch",
};
/** Só do terminal: o `terminal_slash_commands` do init mais os de configuração e de tela que não têm sentido no chat. */
const SO_DO_TERMINAL_CONHECIDOS = ["config", "theme", "vim", "login", "logout", "doctor", "color", "reload-plugins", "reload-skills", "heapdump", "ide", "terminal-setup", "statusline", "permissions", "hooks", "mcp", "agents", "plugin", "resume", "rewind", "export", "exit", "help", "output-style", "fast", "focus", "autocompact"];

export type ArquivoDeComando = { origem: string; frontmatter: Frontmatter };

/**
 * O catálogo do "/", puro. `skills` e `comandos` são os do `init`; `arquivos` traz, por nome, o frontmatter achado no
 * Mac e a origem (o plugin, a pasta do projeto ou "suas"). Sem arquivo: embutida do Claude Code, ou só do terminal.
 * Descrição que termina em "(gstack)" vira a origem — é assim que o gstack se identifica nas descrições.
 */
export function montarCatalogo(e: { skills: readonly string[]; comandos: readonly string[]; soDoTerminal: readonly string[]; arquivos: Readonly<Record<string, ArquivoDeComando>>; versaoCli: string | null }): CatalogoDeComandos {
  const daConversa = new Set(COMANDOS_DA_CONVERSA.flatMap((c) => [c.nome, ...c.apelidos]));
  const terminal = new Set([...e.soDoTerminal, ...SO_DO_TERMINAL_CONHECIDOS]);
  const skills = new Set(e.skills);
  const comandos: ComandoDoMac[] = [];
  const vistos = new Set<string>();
  for (const nome of [...e.skills, ...e.comandos]) {
    // "_gstack-command": nome com _ na frente é peça interna de um pacote de skills, não comando para a pessoa.
    if (vistos.has(nome) || nome.startsWith("_") || comandos.length >= TETO_COMANDOS) continue;
    vistos.add(nome);
    const arquivo = e.arquivos[nome];
    if (arquivo) {
      // NOD-23 (2026-10-28): o nome da conversa ganha do arquivo do Mac (/setup, /config): o servidor sempre o trata como
      // o comando da conversa, então listar a skill de mesmo nome mostraria um comando que nunca roda.
      if (arquivo.frontmatter.userInvocable === false || daConversa.has(nome)) continue;
      const inteira = (arquivo.frontmatter.description ?? "").trim();
      const sufixo = /\s*\(([A-Za-z][\w.-]{2,29})\)\s*$/.exec(inteira);
      const origem = arquivo.origem === "suas" && sufixo ? sufixo[1]! : arquivo.origem;
      const semSufixo = sufixo ? inteira.slice(0, sufixo.index) : inteira;
      const descricao = (semSufixo.split(/(?<=[.!?])\s|\n/)[0] ?? "").trim().slice(0, TETO_DESCRICAO_COMANDO);
      comandos.push({ nome, descricao, origem, ...(arquivo.frontmatter.argumentHint ? { argumento: arquivo.frontmatter.argumentHint.slice(0, 120) } : {}) });
    } else if (daConversa.has(nome) || terminal.has(nome)) {
      continue;
    } else if (skills.has(nome)) {
      if (!EMBUTIDAS_FORA_DO_CHAT.has(nome)) comandos.push({ nome, descricao: DESCRICAO_EMBUTIDA[nome] ?? "", origem: nome.includes(":") ? nome.split(":")[0]! : "Claude Code" });
    } else if (COMANDOS_EMBUTIDOS_NO_CHAT[nome]) {
      comandos.push({ nome, descricao: COMANDOS_EMBUTIDOS_NO_CHAT[nome]!, origem: "Claude Code" });
    }
  }
  // NOD-23: um nome que é da conversa (/config = /configurar) nunca é "só do terminal", mesmo que o CLI o diga.
  const soDoTerminal = [...new Set([...e.soDoTerminal, ...[...e.comandos].filter((c) => terminal.has(c))])].filter((c) => !daConversa.has(c)).slice(0, TETO_SO_DO_TERMINAL);
  return { comandos, soDoTerminal, versaoCli: e.versaoCli };
}

const MESES: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

/** "Sep 28 at 11:20pm (America/Sao_Paulo)" → "28/09 às 23:20"; o que não casar fica como veio. */
function quando(t: string): string {
  const m = /^(\w{3}) (\d{1,2}) at (\d{1,2})(?::(\d{2}))?(am|pm)/.exec(t.trim());
  if (!m || !MESES[m[1]!]) return t.trim();
  let hora = Number(m[3]) % 12;
  if (m[5] === "pm") hora += 12;
  return `${m[2]!.padStart(2, "0")}/${MESES[m[1]!]} às ${String(hora).padStart(2, "0")}:${m[4] ?? "00"}`;
}

/** Linhas conhecidas da saída do /cost em 2.1.284 (medida em 28/09); linha desconhecida passa como veio. */
const LINHAS_DO_USO: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^You are currently using your subscription.*$/, () => "**Você está usando a sua assinatura do Claude.**"],
  [/^Current session: (\d+)% used · resets (.+)$/, (m) => `- Sessão atual: **${m[1]}%** · renova ${quando(m[2]!)}`],
  [/^Current week \(all models\): (\d+)% used · resets (.+)$/, (m) => `- Semana, todos os modelos: **${m[1]}%** · renova ${quando(m[2]!)}`],
  [/^Current week \((.+)\): (\d+)% used · resets (.+)$/, (m) => `- Semana, ${m[1]}: **${m[2]}%** · renova ${quando(m[3]!)}`],
  [/^What's contributing to your limits usage\?$/, () => "**O que mais pesa no seu limite**"],
  [/^Approximate, based on local sessions.*$/, () => "Estimativa pelas sessões deste Mac, sem outros aparelhos nem o claude.ai. Cada item é independente, não uma divisão do total."],
  [/^Last 24h · (\d+) requests · (\d+) sessions$/, (m) => `**Últimas 24 h** · ${m[1]} pedidos · ${m[2]} sessões`],
  [/^Last 7d · (\d+) requests · (\d+) sessions$/, (m) => `**Últimos 7 dias** · ${m[1]} pedidos · ${m[2]} sessões`],
  [/^(\d+)% of your usage came from subagent-heavy sessions$/, (m) => `- ${m[1]}% do uso veio de sessões com muitos subagentes`],
  [/^(\d+)% of your usage came from sessions active for (\d+)\+ hours$/, (m) => `- ${m[1]}% do uso veio de sessões abertas por mais de ${m[2]} horas`],
  [/^(\d+)% of your usage was at >(\d+)k context$/, (m) => `- ${m[1]}% do uso foi com mais de ${m[2]} mil de contexto`],
  [/^(\d+)% of your usage was while (\d+)\+ sessions ran in parallel$/, (m) => `- ${m[1]}% do uso foi com ${m[2]} ou mais sessões em paralelo`],
  [/^Top skills: (.+)$/, (m) => `- Skills que mais pesaram: ${m[1]}`],
  [/^Top subagents: (.+)$/, (m) => `- Subagentes que mais pesaram: ${m[1]}`],
  [/^Top MCP servers: (.+)$/, (m) => `- Servidores MCP que mais pesaram: ${m[1]}`],
];

/** Trocas da saída do /context (markdown com tabela, que o chat já desenha como tabela). */
const TROCAS_DO_CONTEXTO: [RegExp, string][] = [
  [/^## Context Usage$/m, "## Contexto do bot"],
  [/\*\*Model:\*\*/g, "**Modelo:**"],
  [/^### Estimated usage by category$/m, "### Uso estimado por parte"],
  [/\| Category \| Tokens \| Percentage \|/g, "| Parte | Tokens | % |"],
  [/^### Memory Files$/m, "### Arquivos de memória"],
  [/\| Type \| Path \| Tokens \|/g, "| Tipo | Caminho | Tokens |"],
  [/\| System prompt \|/g, "| Prompt do sistema |"],
  [/\| System tools \|/g, "| Ferramentas do sistema |"],
  [/\| MCP tools \|/g, "| Ferramentas MCP |"],
  [/\| MCP tools \(deferred\) \|/g, "| Ferramentas MCP (sob demanda) |"],
  [/\| System tools \(deferred\) \|/g, "| Ferramentas do sistema (sob demanda) |"],
  [/^### MCP Tools$/m, "### Ferramentas MCP"],
  [/\| Tool \| Server \| Tokens \|/g, "| Ferramenta | Servidor | Tokens |"],
  [/\| Custom agents \|/g, "| Agentes |"],
  [/\| Memory files \|/g, "| Memória (CLAUDE.md) |"],
  [/\| Messages \|/g, "| Conversa |"],
  [/\| Free space \|/g, "| Livre |"],
  [/\| Autocompact buffer \|/g, "| Reserva da compactação |"],
  [/\| Project \|/g, "| Projeto |"],
  [/\| User \|/g, "| Pessoal |"],
];

/**
 * A resposta de um comando da conversa, em português (definido em 2026-09-28). /uso e /contexto voltam do Claude Code
 * em inglês e sem chamar o modelo; o nod troca as linhas que conhece. Qualquer outro turno passa intacto.
 * Fora do Claude Code, /uso responde sempre a frase fixa, diga o modelo o que disser (NOD-179).
 */
export function traduzirSaidaDoComando(entrada: string, saida: string, harness?: IdHarness | null): string {
  const c = comandoDaConversa(entrada)?.comando.nome;
  if (c === "uso" && !ehClaudeCode(harness)) return USO_FORA_DO_CLAUDE;
  if (c === "uso") {
    return saida.split("\n").map((linha) => {
      const limpa = linha.trim();
      for (const [re, troca] of LINHAS_DO_USO) {
        const m = re.exec(limpa);
        if (m) return troca(m);
      }
      return linha;
    }).join("\n");
  }
  // O chat não desenha título de markdown (visto na tela em 28/09: "## Contexto do bot" aparecia cru): vira negrito.
  if (c === "contexto") return TROCAS_DO_CONTEXTO.reduce((t, [re, troca]) => t.replace(re, troca), saida).replace(/^#{1,6}\s+(.+)$/gm, "**$1**");
  return saida;
}

/** A linha da conversa depois de /compactar: quanto o histórico ocupava e quanto sobrou (tokens, quando vierem). */
export function textoDaCompactacao(nome: string, antes: number | null, depois: number | null): string {
  const mil = (n: number) => (n >= 1000 ? `${(Math.round(n / 100) / 10).toLocaleString("pt-BR")} mil` : String(n));
  const numeros = antes !== null && depois !== null ? ` · ${mil(antes)} → ${mil(depois)} tokens` : antes !== null ? ` · eram ${mil(antes)} tokens` : "";
  return `Conversa compactada${numeros}. ${nome} continua daqui, com o resumo.`;
}
