import type { FormaTrabalho } from "../contracts/frente.ts";
import type { EstadoTrabalho, NivelPressao } from "../contracts/trabalho.ts";
import type { PastaParaLimpar } from "../contracts/ponte.ts";
import { RETOMAR_ATE_MS } from "./pedido-parado.ts";
import { pastaRelativa } from "./trabalho.ts";

/**
 * A limpeza das pastas de task (definido em 2026-10-09, ADR-088, issue #216). Medido no Mac do Marlon em 09/10: `~/nod`
 * com 254 GB (109 GB em 06/10), 261 worktrees, nenhuma removida pelo nod. Aqui só a regra de QUEM pode ser limpo; quem
 * lê o banco é o caso de uso (src/use-cases/limpeza-das-tasks.ts) e quem apaga é o Mac
 * (src/adapters/executor/limpeza-das-tasks.ts), sempre com `git worktree remove` sem --force.
 */

/** definido em 2026-10-09 (proposta da #216): a task encerrada há mais disto tem as worktrees limpas removidas. */
export const LIMPAR_APOS_MS = 3 * 24 * 3_600_000;

/**
 * definido em 2026-10-09: antes disto a task encerrada ainda pode voltar sozinha (a retomada automática do pedido a
 * colega, ADR-084, só vale para quedas das últimas 2 h). Nem a worktree de PR mergeado sai nesse intervalo.
 */
export const RETOMADA_POSSIVEL_MS = RETOMAR_ATE_MS;

/**
 * definido em 2026-10-09: o servidor só oferece as tasks encerradas nos últimos 30 dias. O Mac confere cada pasta
 * (um `lstat`); sem a janela, a lista cresceria para sempre com pastas já limpas. O que sobrar de mais antigo é órfão
 * (aparece na contagem `orfas` quando fica na raiz do bot) e espera a tela de Este Mac. revisto em 2026-10-15 (ADR-106):
 * a janela sozinha não bastou — com 1.151 tasks encerradas em 30 dias, o teto de 500 da consulta (as mais antigas
 * primeiro) só alcançava pastas já limpas. Agora a máquina manda as pastas que tem, e o servidor só olha essas — e aí
 * sem janela nem o teto de 500: a lista da máquina já limita, e a pasta presa há mais de 30 dias volta a ser vista.
 */
export const JANELA_DA_LIMPEZA_MS = 30 * 24 * 3_600_000;

/** definido em 2026-10-09: worktree órfã sem mexer há isto conta como "parada" no relato (o número da #216). */
export const ORFA_PARADA_MS = 2 * 24 * 3_600_000;

/** O que o banco diz de uma task encerrada candidata (trabalhosRepo.candidatosALimpeza). */
export type FatosLimpeza = {
  estado: EstadoTrabalho;
  terminadoEm: number | null;
  pasta: string | null;
  /** Turnos pendentes (inclusive a volta marcada, `acordar_em`) ou rodando. */
  turnosVivos: number;
  decisaoPendente: boolean;
  /**
   * Outra task que não acabou usa a mesma pasta (pasta decidida por quem chamou, fora do slug com id). ADR-106 (revisão
   * do #320): ou outra task da pasta encerrou depois desta — só a mais recente decide.
   */
  pastaDividida: boolean;
  /** ADR-099 (0071): ausente = `task`. */
  forma?: FormaTrabalho;
};

/**
 * `<bot>/<slug>` validado, ou null: exatamente dois nomes, nenhum vazio, `.`/`..`, escondido ou com barra invertida.
 * A raiz do bot (`~/nod/<bot>`) nunca é pasta de task: lá moram as worktrees antigas de dono desconhecido.
 */
export function pastaDeTask(pasta: string | null): string | null {
  if (pasta === null) return null;
  const rel = pastaRelativa(pasta);
  if (rel === null) return null;
  const partes = rel.split("/");
  if (partes.length !== 2) return null;
  if (partes.some((p) => p.trim() === "" || p.startsWith(".") || p.includes("\\") || p.includes("\0"))) return null;
  return rel;
}

/**
 * ADR-106 (definido em 2026-10-15): quantas pastas a máquina manda no pedido da limpeza. A VM dos bots tinha ~300 em
 * 15/10 e o Mac do Marlon 261 worktrees em 09/10; o teto só segura um corpo absurdo. Com 64 caracteres por código,
 * 5.000 dão ~335 KB, abaixo do corpo máximo de 1 MiB (`CORPO_MAX`). Passou disso, vão as primeiras e o relato conta as
 * cortadas.
 */
export const PASTAS_DA_MAQUINA_MAX = 5_000;

/**
 * ADR-106: as pastas que a máquina diz ter no disco chegam como CÓDIGO — o sha256 em hexadecimal de `<bot>/<slug>` em
 * NFC (`codigoDaPasta`, no executor) —, nunca como nome: em `~/nod/<bot>/` moram também clones, órfãs e pastas criadas à
 * mão, com nome que pode citar cliente ou jovem, e no modo local as de outra pessoa. O servidor só reconhece o código de
 * uma pasta que ele mesmo já guarda em `trabalhos.pasta`. Validados: 64 dígitos hexadecimais minúsculos, sem repetir,
 * até `PASTAS_DA_MAQUINA_MAX`. Não é lista (máquina antiga, que não manda) = null; lista sem nada válido = vazia.
 */
export function codigosDaMaquina(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const vistos = new Set<string>();
  for (const x of v) {
    if (vistos.size >= PASTAS_DA_MAQUINA_MAX) break;
    if (typeof x === "string" && /^[0-9a-f]{64}$/.test(x)) vistos.add(x);
  }
  return [...vistos];
}

/**
 * Quando a pasta da task pode ser limpa (ADR-088):
 * - nunca a task aberta, `parado` (a pessoa parou e pode querer continuar), com turno vivo ou volta marcada, ou com
 *   decisão pendente (o "Retomar" é uma decisão);
 * - nunca nas primeiras 2 h depois de encerrar (a retomada automática da ADR-084);
 * - `encerrada`: terminada ou falha há mais de 3 dias;
 * - `so_com_pr_mergeado`: encerrada há menos; o Mac só remove a worktree cujo PR já foi mergeado.
 *
 * ADR-096 (2026-10-11): com o disco da máquina `apertado` (amarelo ou vermelho), a task encerrada há mais de 2 h já vale
 * como `encerrada`. A worktree limpa sai e a branch fica no clone: se o bot voltar à task, ele a recria. Esperar 3 dias
 * com o disco no fim parava os bots (VM dos bots a 99% em 11/10).
 *
 * ADR-099 item 9 (definido em 2026-10-12, I5): a frente `terminado` vale `sem_trabalho` desde o fim, até virar `encerrada`
 * (3 dias, ou 2 h com o disco apertado): o Mac só apaga com prova de que não há trabalho. `falhou` segue a regra de
 * sempre — o varredor da ADR-084 pode retomá-la nas primeiras 2 h.
 */
export function quandoLimpar(f: FatosLimpeza, agora: number, o: { apertado?: boolean } = {}): PastaParaLimpar["quando"] | null {
  if (f.estado !== "terminado" && f.estado !== "falhou") return null;
  if (f.terminadoEm === null || f.turnosVivos > 0 || f.decisaoPendente || f.pastaDividida) return null;
  if (pastaDeTask(f.pasta) === null) return null;
  const ha = agora - f.terminadoEm;
  if (ha >= LIMPAR_APOS_MS) return "encerrada";
  if (ha >= RETOMADA_POSSIVEL_MS && o.apertado === true) return "encerrada";
  if (f.forma === "frente" && f.estado === "terminado") return "sem_trabalho";
  if (ha >= RETOMADA_POSSIVEL_MS) return "so_com_pr_mergeado";
  return null;
}

/**
 * Normaliza um caminho absoluto para comparar (sem `.`, `..` e barras repetidas); o relativo volta null. revisto em
 * 2026-10-09 (revisão do #225): NFC e sem caixa — o APFS do Mac não diferencia maiúsculas e guarda nomes em NFD, e a
 * origem que o Docker relata pode vir com outra caixa ou outra forma do mesmo acento. Comparar texto puro deixava a
 * montagem passar despercebida. Quem chama resolve os links (realpath) dos dois lados antes.
 */
function normalizar(caminho: string): string | null {
  caminho = caminho.normalize("NFC").toLowerCase();
  if (!caminho.startsWith("/")) return null;
  const partes: string[] = [];
  for (const s of caminho.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") partes.pop();
    else partes.push(s);
  }
  return `/${partes.join("/")}`;
}

/**
 * definido em 2026-10-09 (#216): `~/nod/Eng 1/nod-169/infra/postgres/init` é bind mount do `nod-postgres` do diário. O
 * caminho é protegido quando alguma montagem de container (rodando ou parado) está DENTRO dele ou é ele: apagar a
 * worktree apagaria a origem da montagem. Montagem que contém o caminho (um container que monta `~/nod` inteiro) não
 * protege: ela não depende desta pasta.
 */
export function protegidoPorMontagem(caminho: string, montagens: readonly string[]): boolean {
  const alvo = normalizar(caminho);
  if (alvo === null) return true;
  return montagens.some((m) => {
    const fonte = normalizar(m);
    return fonte !== null && (fonte === alvo || fonte.startsWith(`${alvo}/`));
  });
}

/**
 * definido em 2026-10-09 (revisão do #225): o que o `git worktree remove` apagaria junto sem perguntar (arquivo IGNORADO)
 * e que se refaz sozinho — dependência, build, cache. Qualquer outro ignorado (`.env`, `backups/*.dump`, um banco
 * local) segura a worktree com o motivo `ignorado_valioso`: o git não protege o que está no .gitignore, e é melhor
 * recusar demais do que apagar algo que não volta. revisto na segunda revisão do #225: `build`, `out` e `output` saíram
 * (são nomes genéricos, e `output/relatorio.csv` é resultado de trabalho); a pasta só conta pelo PRIMEIRO nome do
 * caminho; `.env*` nunca é regenerável, em nível nenhum.
 */
const PASTAS_REGENERAVEIS = new Set(["node_modules", "dist", "coverage", ".vite", ".next", ".turbo", ".cache", ".parcel-cache", ".pnpm-store", "__pycache__", ".pytest_cache"]);

/**
 * ADR-096 (2026-10-11): o cache de UMA ferramenta conhecida, com nome que só ela usa, vale em qualquer nível. O monorepo
 * tem um por pacote (`packages/auth/.turbo/`, `apps/mobile/.expo/`), e só o primeiro nome segurava 4 das 41 worktrees
 * de task da VM dos bots em 11/10. `dist`, `coverage` e `.cache` continuam só no primeiro nível: são nomes genéricos.
 */
export const CACHES_DE_FERRAMENTA: ReadonlySet<string> = new Set([".turbo", ".expo", ".next", ".nuxt", ".svelte-kit", ".vite", ".parcel-cache", ".pnpm-store", "__pycache__", ".pytest_cache"]);

/**
 * O caminho ignorado (relativo à worktree, como o `git status --ignored=traditional` mostra: pasta inteira ignorada vem
 * com `/` no fim) se refaz sozinho?
 * - `valioso`: segura a worktree;
 * - `regeneravel`: sai junto;
 * - `conferir_env`: pasta regenerável inteira (`dist/`) — sai junto só se não houver `.env*` dentro (quem chama olha).
 *
 * Exceções ao "só o primeiro nome", todas de coisa que nunca é trabalho: a pasta `node_modules` em qualquer nível (o
 * monorepo pnpm do gamefik e do lumen tem uma por pacote, e sem isso nenhuma worktree deles sairia), e os arquivos
 * `.DS_Store` (o Finder) e `*.tsbuildinfo` (cache do tsc) em qualquer nível. `*.log` só na raiz.
 */
export function classificarIgnorado(caminho: string): "valioso" | "regeneravel" | "conferir_env" {
  const pasta = caminho.endsWith("/");
  const partes = caminho.split("/").filter((p) => p !== "");
  if (partes.length === 0) return "valioso";
  if (partes.some((p) => p.startsWith(".env"))) return "valioso";
  const ultimo = partes[partes.length - 1]!;
  if (pasta && ultimo === "node_modules") return "regeneravel";
  if (!pasta && (ultimo === ".DS_Store" || ultimo.endsWith(".tsbuildinfo"))) return "regeneravel";
  const cache = partes.findIndex((p) => CACHES_DE_FERRAMENTA.has(p));
  if (cache > 0) return cache < partes.length - 1 ? "regeneravel" : pasta ? "conferir_env" : "valioso";
  if (PASTAS_REGENERAVEIS.has(partes[0]!)) return pasta && partes.length === 1 ? "conferir_env" : partes.length > 1 ? "regeneravel" : "valioso";
  if (!pasta && partes.length === 1 && ultimo.endsWith(".log")) return "regeneravel";
  return "valioso";
}

/**
 * ADR-096 (definido em 2026-10-11): a limpeza não espera as 6 h quando o disco aperta. A cada 5 min a máquina lê o
 * próprio disco (`statfs`, sem processo novo); amarelo ou vermelho (`nivelDoDisco`, os limites da ADR-085) dispara uma
 * passada `apertada`, no máximo uma a cada 30 min, para uma passada que não liberou nada não virar um laço sobre o
 * disco. Em 11/10 a VM dos bots ficou a 99% por horas com a limpeza esperando a próxima janela.
 */
export const VIGIA_DO_DISCO_MS = 5 * 60_000;
export const ENTRE_PASSADAS_APERTADAS_MS = 30 * 60_000;
/**
 * ADR-096 §6 (definido em 2026-10-11): com o disco ainda verde, mas caindo no ritmo de acabar em 6 h (a tendência de
 * `acabaEmMs`, medida na própria máquina), a passada apertada já roda: a VM perdeu 2 GB numa hora em 11/10, e 10 GB de
 * folga duram pouco nesse ritmo.
 */
export const LIMPAR_ANTES_DE_ACABAR_MS = 6 * 3_600_000;

/**
 * O disco está apertado (amarelo ou vermelho) ou acaba em menos de 6 h, e a última passada apertada começou há 30 min
 * ou mais (ou nunca houve)?
 */
export function passadaPorAperto(nivel: NivelPressao | null, ultimaApertadaEm: number | null, agora: number, acabaEm: number | null = null): boolean {
  const aperto = nivel === "amarela" || nivel === "vermelha" || (acabaEm !== null && acabaEm <= LIMPAR_ANTES_DE_ACABAR_MS);
  if (!aperto) return false;
  return ultimaApertadaEm === null || agora - ultimaApertadaEm >= ENTRE_PASSADAS_APERTADAS_MS;
}

/** Por que o `git worktree remove` (sem --force) recusou, pela saída de erro dele. */
export function motivoDaRecusa(stderr: string): "suja" | "travada" | "erro" {
  if (/contains modified or untracked files|is dirty|has modified or untracked|use --force to delete it/i.test(stderr) && !/locked/i.test(stderr)) return "suja";
  if (/locked/i.test(stderr)) return "travada";
  return "erro";
}
