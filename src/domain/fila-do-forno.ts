import { tokenizar } from "./comando.ts";

/**
 * A fila do forno (definido em 2026-10-11, ADR-097, fase 1b): o comando pesado de um bot espera a vez quando a memória
 * da máquina não cabe, e os outros bots seguem. Puro: quem lê a memória, guarda o histórico e espera é o adapter
 * (src/adapters/executor/vaga.ts), e quem reescreve o comando é o hook do nod (hook-nativas.ts).
 *
 * Medido na nod-motor-teste em 11/10: cada agente gastava ~300 MB e 3% a 6% de um núcleo; o peso vinha dos comandos que
 * eles rodavam (vitest, tsc, um Postgres embutido por arquivo de teste). Às 14:35 UTC a memória acabou com ~17 Postgres
 * e 29 node juntos, e a VM travou. A fila deixa os agentes entrarem e põe os comandos pesados em ordem.
 *
 * O nod não adivinha o que é pesado pelo nome: mede. Cada comando tem os picos de memória das últimas execuções (dele e
 * de tudo o que ele abriu), e a reserva da próxima vez é o maior deles mais 15%, a regra do VPA do Kubernetes. Comando
 * que morreu por falta de memória reserva mais na vez seguinte. Nada espera para sempre: sem nenhum comando pesado
 * rodando, o próximo roda mesmo que a estimativa passe da memória livre.
 */

/** Os picos guardados por comando (os mais recentes). */
export const PICOS_GUARDADOS = 5;
/** A margem sobre o maior pico. */
export const MARGEM_DO_PICO = 1.15;
/** Depois de faltar memória, a reserva cresce mais que a margem, até o comando passar sem faltar. */
export const MARGEM_DEPOIS_DE_FALTAR = 1.5;
/**
 * Abaixo disto o comando é leve e não entra na fila: git, ls, um script curto. O agente sozinho gasta ~300 MB; um
 * comando que nunca passou de 256 MB não é o que enche a máquina.
 */
export const LEVE_MB = 256;
/** A reserva de um comando nunca medido: roda se houver esta folga e passa a ser medido. */
export const DESCONHECIDO_MB = 512;
/**
 * A memória que a fila deixa livre para os agentes e o sistema. Na VM a máquina é só dos bots; no Mac a pessoa usa
 * outros apps ao mesmo tempo, e o nod não limita a memória de cada task: a fila deixa mais folga.
 */
export const RESERVA_LINUX_MB = 1024;
export const RESERVA_MAC_MB = 2048;
/** Quantos comandos o histórico guarda; os mais antigos saem. */
export const COMANDOS_GUARDADOS = 500;

/** Os picos de um comando (MB, o mais recente por último) e se a última execução morreu por falta de memória. */
export type HistoricoDoComando = { picos: number[]; faltou?: boolean; em: number };
export type Historico = Record<string, HistoricoDoComando>;

/**
 * A chave de um comando: o repositório em que ele roda e o texto, com os espaços juntados. `npm test` no gamefik e no
 * nod são comandos diferentes. revisto em 2026-10-12: era o nome da pasta, e na VM as chaves saíram com o nome da pasta
 * da task ("revise-o-seu-proprio-pr-…-c35427"), que muda a cada task: o pico medido numa task não valia na seguinte.
 * Fora de um repositório (a pasta da task, antes do `cd` para o clone), a chave é só o texto.
 */
export function chaveDoComando(comando: string, repositorio: string | null): string {
  return `${repositorio ?? ""}\n${comando.trim().replace(/\s+/g, " ").slice(0, 300)}`;
}

/**
 * O repositório pelo `remote.origin.url` do git: "dono/nome", igual para todas as worktrees e clones do mesmo projeto.
 * `git@github.com:gamefik/nod.git`, `https://github.com/gamefik/nod(.git)`, `ssh://git@host/dono/nome`. Outro formato,
 * ou vazio, é null.
 */
export function repositorioDaOrigem(url: string | null | undefined): string | null {
  const m = /[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec((url ?? "").trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** A reserva do comando em MB, ou null se ele nunca foi medido. */
export function estimativaMb(h: HistoricoDoComando | undefined): number | null {
  if (!h || h.picos.length === 0) return null;
  return Math.ceil(Math.max(...h.picos) * (h.faltou ? MARGEM_DEPOIS_DE_FALTAR : MARGEM_DO_PICO));
}

/** Medido e sempre abaixo de LEVE_MB, sem ter faltado memória. */
export function ehLeve(h: HistoricoDoComando | undefined): boolean {
  return h !== undefined && h.picos.length > 0 && h.faltou !== true && Math.max(...h.picos) < LEVE_MB;
}

/**
 * Programas que não pesam na memória: mexem em arquivo, texto ou git, ou esperam. Eles rodam direto sem nem ser medidos
 * (a medida custa um node a mais). Não é a classificação de aprovação (comando.ts): para ela os testes, o lint e os
 * tipos "só leem", e são justamente os comandos pesados.
 */
const SEM_PESO = new Set([
  "ls", "pwd", "cat", "head", "tail", "wc", "grep", "egrep", "fgrep", "rg", "tree", "echo", "printf", "which", "whoami", "date",
  "uname", "file", "stat", "sort", "uniq", "cut", "tr", "jq", "diff", "cmp", "basename", "dirname", "realpath", "readlink", "test",
  "[", "true", "false", "cd", "nl", "column", "hostname", "id", "sed", "awk", "mkdir", "touch", "cp", "mv", "rm", "ln", "chmod",
  "git", "gh", "curl", "sleep", "export", "kill", "ps", "pgrep", "lsof", "free", "df", "du", "find", "tee", "sha256sum",
  "shasum", "md5", "md5sum", "base64", "printenv", "type", "set", "unset", "exit",
]);
/** O git que roda os hooks do repositório (lint-staged, testes no pre-push): pode pesar. */
const GIT_COM_HOOK = new Set(["commit", "push", "merge", "rebase", "am", "cherry-pick", "pull"]);

/** Todo programa do comando está em SEM_PESO? Substituição de comando (`$(…)`) não dá para saber: pesa. */
export function semPeso(comando: string): boolean {
  const tokens = tokenizar(comando);
  if (!tokens) return false;
  let inicio = true;
  let depoisDoGit = false;
  for (const t of tokens) {
    if (t.operador) {
      if (t.texto === "&&" || t.texto === "||" || t.texto === ";" || t.texto === "|" || t.texto === "&") inicio = true;
      depoisDoGit = false;
      continue;
    }
    // No segmento do git, qualquer palavra que seja um subcomando com hook pesa (`git -C x push` também).
    if (depoisDoGit && GIT_COM_HOOK.has(t.texto)) return false;
    if (!inicio) continue;
    // `FOO=bar cmd`: a variável não é o programa.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t.texto)) continue;
    if (!SEM_PESO.has(t.texto)) return false;
    depoisDoGit = t.texto === "git";
    inicio = false;
  }
  return true;
}

/**
 * O comando passa pela fila? O que não pesa (SEM_PESO) e o que já se mostrou leve rodam direto, sem custo nenhum. O
 * resto pede a vez: o pesado espera se não cabe, o novo é medido.
 */
export function precisaDaVez(p: { comando: string; historico: HistoricoDoComando | undefined }): boolean {
  return !semPeso(p.comando) && !ehLeve(p.historico);
}

/** Um comando com a vez agora: a reserva dele e o que ele já usa. */
export type ComandoComAVez = { estimativaMb: number | null; usadoMb: number };

/**
 * Cabe mais este comando? A memória livre agora, menos a reserva dos agentes e do sistema, menos o que os comandos que
 * já têm a vez ainda devem usar (a reserva deles menos o que já usam), tem de comportar a reserva dele. Sem ninguém
 * com a vez, cabe sempre: nada espera para sempre.
 */
export function cabe(p: { estimativaMb: number | null; livreMb: number; reservaMb: number; comAVez: readonly ComandoComAVez[] }): boolean {
  if (p.comAVez.length === 0) return true;
  const aindaVaoUsar = p.comAVez.reduce((s, c) => s + Math.max(0, (c.estimativaMb ?? DESCONHECIDO_MB) - c.usadoMb), 0);
  return p.livreMb - p.reservaMb - aindaVaoUsar >= (p.estimativaMb ?? DESCONHECIDO_MB);
}

/**
 * O histórico depois de uma execução. Morreu por falta de memória (SIGKILL do OOM, saída 137): o pico medido fica, e a
 * próxima reserva usa MARGEM_DEPOIS_DE_FALTAR. Um pico zero (o comando acabou antes da primeira amostra) não apaga o
 * que já se sabia.
 */
export function comPico(h: HistoricoDoComando | undefined, picoMb: number, faltou: boolean, em: number): HistoricoDoComando {
  const picos = [...(h?.picos ?? []), Math.max(0, Math.round(picoMb))].slice(-PICOS_GUARDADOS);
  return { picos, ...(faltou ? { faltou: true } : {}), em };
}

/** O histórico com no máximo `maximo` comandos, os usados mais recentemente. */
export function podarHistorico(h: Historico, maximo = COMANDOS_GUARDADOS): Historico {
  const chaves = Object.keys(h);
  if (chaves.length <= maximo) return h;
  return Object.fromEntries(Object.entries(h).sort(([, a], [, b]) => b.em - a.em).slice(0, maximo));
}

/** A saída 137 é o SIGKILL, que é como o OOM killer do Linux encerra um processo. */
export function faltouMemoria(status: number | null): boolean {
  return status === 137;
}

/** Aspas de shell (o caminho da pasta pode ter espaço, como "Application Support"). */
export function aspasDeShell(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** O começo de um comando que já passou pela fila: o hook não o envolve de novo. */
export const MARCA_DA_FILA = "__nod_vaga=";

/**
 * O comando com a vez em volta, no MESMO shell em que o Claude Code o roda: o `cd` e as variáveis que ele define
 * continuam valendo no comando seguinte, e o status de saída é o do comando. `invocar` monta a chamada ao nod-vaga
 * (o node e o script do hook, já com aspas) e `dir` é a pasta da fila, também com aspas. O `$$` é o shell do comando: quem o vigia mede ele e o que ele abriu, e
 * solta a vez sozinho se o shell sumir sem passar pelo `soltar`. A quebra de linha antes do `}` deixa o comando terminar
 * num comentário ou num heredoc.
 */
export function comandoNaFila(comando: string, p: { invocar: string; chave64: string; dir: string }): string {
  return `${MARCA_DA_FILA}$(${p.invocar} vaga pegar ${p.chave64} $$ ${p.dir}); { ${comando}\n}; __nod_s=$?; ${p.invocar} vaga soltar "$__nod_vaga" "$__nod_s" ${p.dir}; (exit $__nod_s)`;
}

/** A memória livre do Linux, pelo `/proc/meminfo` (MemAvailable), em MB; null sem o campo. */
export function livreDoMeminfo(meminfo: string): number | null {
  const kib = Number(/^MemAvailable:\s+(\d+)/m.exec(meminfo)?.[1]);
  return Number.isFinite(kib) ? Math.floor(kib / 1024) : null;
}

/**
 * A memória livre do Mac pelo `vm_stat`, em MB: as páginas livres, as inativas e as especulativas, que o macOS
 * devolve sem tirar nada de quem está rodando. Sem o tamanho da página ou sem as linhas, null.
 */
export function livreDoVmStat(vmStat: string): number | null {
  const pagina = Number(/page size of (\d+) bytes/.exec(vmStat)?.[1]);
  const paginas = (nome: string) => Number(new RegExp(`^Pages ${nome}:\\s+(\\d+)`, "m").exec(vmStat)?.[1]);
  const livres = paginas("free");
  if (!Number.isFinite(pagina) || !Number.isFinite(livres)) return null;
  const soma = livres + (paginas("inactive") || 0) + (paginas("speculative") || 0);
  return Math.floor((soma * pagina) / 1048576);
}

/** Uma linha de `ps -A -o pid=,ppid=,rss=` (rss em KiB). */
export type ProcessoDaArvore = { pid: number; ppid: number; rssKib: number };

export function lerArvoreDoPs(saida: string): ProcessoDaArvore[] {
  const lista: ProcessoDaArvore[] = [];
  for (const linha of saida.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(linha);
    if (m) lista.push({ pid: Number(m[1]), ppid: Number(m[2]), rssKib: Number(m[3]) });
  }
  return lista;
}

/** A memória (MB) dos descendentes de `raiz`, sem ela (o shell do Claude Code) e sem `fora` (o próprio nod-vaga). */
export function memoriaDaArvoreMb(processos: readonly ProcessoDaArvore[], raiz: number, fora: ReadonlySet<number> = new Set()): number {
  const filhos = new Map<number, ProcessoDaArvore[]>();
  for (const p of processos) filhos.set(p.ppid, [...(filhos.get(p.ppid) ?? []), p]);
  let kib = 0;
  const pilha = [...(filhos.get(raiz) ?? [])];
  const vistos = new Set<number>();
  while (pilha.length) {
    const p = pilha.pop()!;
    if (vistos.has(p.pid)) continue;
    vistos.add(p.pid);
    if (!fora.has(p.pid)) kib += p.rssKib;
    pilha.push(...(filhos.get(p.pid) ?? []));
  }
  return Math.round(kib / 1024);
}

/** "1,2 GB", "800 MB": a memória como o bot lê na espera. */
export function memoriaLegivel(mb: number): string {
  return mb < 1024 ? `${Math.max(0, Math.round(mb))} MB` : `${(mb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
}

/** O que o bot lê no terminal quando o comando começa a esperar. */
export function avisoDeEspera(p: { comAVez: number; livreMb: number; estimativaMb: number | null; naFrente: number }): string {
  const precisa = p.estimativaMb !== null ? ` Ele costuma usar ${memoriaLegivel(p.estimativaMb)}.` : "";
  const frente = p.naFrente > 0 ? ` ${p.naFrente === 1 ? "Há 1 comando" : `Há ${p.naFrente} comandos`} na frente.` : "";
  return `nod: este comando espera a vez de rodar: ${p.comAVez === 1 ? "1 comando pesado roda" : `${p.comAVez} comandos pesados rodam`} nesta máquina e há ${memoriaLegivel(p.livreMb)} livres.${precisa}${frente} Ele começa sozinho quando couber; não precisa repetir.`;
}
