import { execFile } from "node:child_process";
import type { PrLido } from "../../contracts/quadro.ts";
import { avisoDaLeitura, lerPrDoGh, repoValido } from "../../domain/prs-da-tarefa.ts";
import { log } from "../../obs/log.ts";
import type { Db, Escopo } from "../../shared/types.ts";
import { codigoDoStatus, ErroGithub } from "../conectores-locais/github/erros.ts";
import { logarTickLento, paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/**
 * definido em 2026-11-02 (NOD-421): o PR na tarefa em até 1 min. Uma volta a cada 30 s lê os PRs de cada repo de
 * NOD_QUADRO_GITHUB_REPOS (uma chamada por repo por volta, os 60 atualizados mais recentes) e entrega a lista inteira a
 * cada pessoa; o caso de uso casa com as tarefas dela (sincronizarPrsDoQuadro). Poll em vez de webhook: o Nod ainda não
 * recebe evento do GitHub para o quadro (o webhook da NOD-84 é gatilho de rotina). Sem a env, o laço não sobe.
 */
export const INTERVALO_PRS_DO_QUADRO_MS = 30_000;
export const LIMITE_PRS_POR_REPO = 60;
/** definido em 2026-11-02: `gh pr list` com statusCheckRollup de 60 PRs leva ~2-4 s no gamefik/nod; 20 s é folga. */
export const PRAZO_GH_MS = 20_000;

/** A fonte dos PRs de um repo. Em produção o `gh`; no teste, uma falsa. Falha = ErroGithub (código, nunca a mensagem). */
export type FontePrs = { listar(repo: string): Promise<PrLido[]> };

const CAMPOS = "number,url,headRefName,state,mergeable,statusCheckRollup,isCrossRepository,updatedAt";

/** NOD_QUADRO_GITHUB_REPOS="dono/repo,dono/outro" → a lista válida, sem repetir (até 5; o resto vai para o log). */
export function reposDoAmbiente(v: string | undefined): string[] {
  const todos = [...new Set((v ?? "").split(/[\s,]+/).map((s) => s.trim()).filter((s) => s !== ""))];
  const validos = todos.filter(repoValido);
  if (validos.length !== todos.length || validos.length > 5) log("aviso", "prs_do_quadro_repos_ignorados", { recebidos: todos.length, usados: Math.min(validos.length, 5) });
  return validos.slice(0, 5);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * definido em 2026-11-02 (NOD-421, revisão do PR #621; 2ª revisão no mesmo dia, ADR-145): a trava entre tenants. O
 * token do servidor lê repos privados (gamefik/nod); sem trava, qualquer tenant com o quadro ligado e um `NOD-…` no
 * branch veria repo, número e estado desses PRs. NOD_QUADRO_GITHUB_TENANTS="id,id" lista quem pode sincronizar, em
 * QUALQUER jeito (token do servidor, `gh` com GH_TOKEN no ambiente ou `gh` logado na máquina): lista vazia = nenhum
 * tenant, e o laço nem sobe. A 1ª versão abria tudo no `gh` sem lista; a 2ª revisão fechou: o `gh` de um servidor
 * compartilhado (ou com GH_TOKEN) é credencial do servidor, e no desenvolvimento basta pôr o tenant na lista (o
 * TENANT_PADRAO do seed, no .env.example). Id que não é uuid cai (e vai para o log).
 */
export function tenantsQueSincronizam(env: Readonly<Record<string, string | undefined>>): ReadonlySet<string> {
  const todos = [...new Set((env.NOD_QUADRO_GITHUB_TENANTS ?? "").split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter((s) => s !== ""))];
  const validos = todos.filter((t) => UUID.test(t));
  if (validos.length !== todos.length) log("aviso", "prs_do_quadro_tenants_ignorados", { recebidos: todos.length, usados: validos.length });
  return new Set(validos);
}

/** `gh pr list --repo R --state all --json ...` por execFile (nunca shell); o repo já foi validado pelo domínio. */
export function fonteGh(o: { env: Record<string, string>; bin?: string; prazoMs?: number }): FontePrs {
  const bin = o.bin ?? "gh";
  return {
    listar(repo) {
      if (!repoValido(repo)) return Promise.reject(new ErroGithub("falha", "gh"));
      const argv = ["pr", "list", "--repo", repo, "--state", "all", "--limit", String(LIMITE_PRS_POR_REPO), "--json", CAMPOS];
      return new Promise((resolver, rejeitar) => {
        execFile(bin, argv, { env: o.env, timeout: o.prazoMs ?? PRAZO_GH_MS, maxBuffer: 8 * 1024 * 1024, shell: false, windowsHide: true, encoding: "utf8" }, (e, stdout, stderr) => {
          if (e) {
            const err = e as { code?: string | number | null; killed?: boolean };
            if (err.code === "ENOENT") return rejeitar(new ErroGithub("gh_ausente", "gh"));
            if (err.killed) return rejeitar(new ErroGithub("falha", "gh"));
            if (err.code === 4 || /gh auth login|not logged in|authentication required/i.test(stderr)) return rejeitar(new ErroGithub("sem_login", "gh"));
            if (/rate limit/i.test(stderr)) return rejeitar(new ErroGithub("limite", "gh"));
            if (/could not resolve to a repository/i.test(stderr)) return rejeitar(new ErroGithub("nao_encontrado", "gh"));
            const status = /\(HTTP (\d{3})\)/.exec(stderr)?.[1];
            return rejeitar(new ErroGithub(status ? codigoDoStatus(Number(status)) : "falha", "gh"));
          }
          let lista: unknown;
          try {
            lista = JSON.parse(stdout);
          } catch {
            return rejeitar(new ErroGithub("falha", "gh"));
          }
          if (!Array.isArray(lista)) return rejeitar(new ErroGithub("falha", "gh"));
          resolver(lista.map((v) => lerPrDoGh(repo, v)).filter((p): p is PrLido => p !== null));
        });
      });
    },
  };
}

const CONSULTA = `query($dono:String!,$nome:String!,$n:Int!){repository(owner:$dono,name:$nome){pullRequests(first:$n,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number url headRefName state mergeable isCrossRepository commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}}`;
/** definido em 2026-11-02: 60 PRs sem corpo nem título cabem com folga em 2 MiB; acima disso é falha, não corte. */
const TETO_RESPOSTA = 2 * 1024 * 1024;

/**
 * definido em 2026-11-02 (3ª revisão do PR #621): o 403 do GitHub também é limite (não "sem acesso") quando a cota
 * primária acabou (`x-ratelimit-remaining: 0`) ou quando é o secondary rate limit, que vem com `retry-after` e/ou a frase
 * "secondary rate limit" no corpo. O corpo só é testado pela regex (até 4 KiB), nunca vai a log nem a erro.
 */
async function limiteNo403(resp: Response): Promise<boolean> {
  if (resp.headers.get("x-ratelimit-remaining") === "0" || resp.headers.get("retry-after") !== null) return true;
  try {
    return /rate limit/i.test((await resp.text()).slice(0, 4096));
  } catch {
    return false;
  }
}

/** definido em 2026-11-02 (4ª revisão do PR #621): a pausa máxima por rate limit; um reset mais longe que isso é suspeito. */
export const PAUSA_MAXIMA_LIMITE_MS = 60 * 60_000;

/** O rate limit com a hora em que o GitHub volta a aceitar (ms): o laço não chama aquele repo antes dela. */
export class ErroLimiteGithub extends ErroGithub {
  readonly retomarEm: number;
  constructor(jeito: ErroGithub["jeito"], retomarEm: number) {
    super("limite", jeito);
    this.retomarEm = retomarEm;
  }
}

/**
 * A hora de volta do limite: `retry-after` (segundos, o secondary rate limit) ou `x-ratelimit-reset` (epoch em
 * segundos, a cota primária). Sem nenhum válido no futuro = null (tenta na próxima volta). No máximo 1 h.
 */
export function retomarDoLimite(h: Headers, agora: number): number | null {
  const depois = Number(h.get("retry-after") ?? "");
  const reset = Number(h.get("x-ratelimit-reset") ?? "");
  const em = h.get("retry-after") !== null && Number.isFinite(depois) && depois > 0 ? agora + depois * 1000 : Number.isFinite(reset) && reset * 1000 > agora ? reset * 1000 : null;
  return em === null ? null : Math.min(em, agora + PAUSA_MAXIMA_LIMITE_MS);
}

const erroDeLimite = (h: Headers, agora: number): ErroGithub => {
  const em = retomarDoLimite(h, agora);
  return em === null ? new ErroGithub("limite", "token") : new ErroLimiteGithub("token", em);
};

/**
 * definido em 2026-11-02 (NOD-421, revisão da Ada): a fonte de produção, sem binário. A imagem não tem o `gh` e o
 * servidor não roda o jeito gh (ADR-048); a mesma leitura do `gh pr list` sai numa chamada GraphQL por repo, por fetch,
 * com o token do servidor (NOD_QUADRO_GITHUB_TOKEN, só leitura de PR). O token nunca vai para a URL nem para o log;
 * redirect é recusado. Título e corpo do PR nem são pedidos (dado de fora).
 */
export function fonteApi(o: { token: string; base?: string; prazoMs?: number; fetchImpl?: typeof fetch; agora?: () => number }): FontePrs {
  const base = (o.base ?? "https://api.github.com").replace(/\/+$/, "");
  const f = o.fetchImpl ?? fetch;
  const agora = o.agora ?? Date.now;
  return {
    async listar(repo) {
      if (!repoValido(repo)) throw new ErroGithub("falha", "token");
      const [dono, nome] = repo.split("/") as [string, string];
      let resp: Response;
      try {
        resp = await f(`${base}/graphql`, {
          method: "POST",
          headers: { authorization: `Bearer ${o.token}`, "content-type": "application/json", "user-agent": "nod" },
          body: JSON.stringify({ query: CONSULTA, variables: { dono, nome, n: LIMITE_PRS_POR_REPO } }),
          redirect: "manual",
          signal: AbortSignal.timeout(o.prazoMs ?? PRAZO_GH_MS),
        });
      } catch {
        throw new ErroGithub("falha", "token");
      }
      if (resp.status >= 300 && resp.status < 400) throw new ErroGithub("movido", "token");
      if (!resp.ok) {
        const codigo = codigoDoStatus(resp.status, resp.status === 403 && (await limiteNo403(resp)));
        throw codigo === "limite" ? erroDeLimite(resp.headers, agora()) : new ErroGithub(codigo, "token");
      }
      const bytes = await resp.arrayBuffer();
      if (bytes.byteLength > TETO_RESPOSTA) throw new ErroGithub("falha", "token");
      let corpo: { data?: { repository?: { pullRequests?: { nodes?: unknown[] } } | null }; errors?: { type?: string }[] };
      try {
        corpo = JSON.parse(new TextDecoder("utf-8").decode(bytes));
      } catch {
        throw new ErroGithub("falha", "token");
      }
      if (corpo.errors?.length) {
        const tipo = corpo.errors[0]?.type;
        if (tipo === "RATE_LIMITED") throw erroDeLimite(resp.headers, agora());
        throw new ErroGithub(tipo === "NOT_FOUND" ? "nao_encontrado" : tipo === "RATE_LIMITED" ? "limite" : tipo === "FORBIDDEN" ? "sem_permissao" : "falha", "token");
      }
      const nos = corpo.data?.repository?.pullRequests?.nodes;
      if (!Array.isArray(nos)) throw new ErroGithub("nao_encontrado", "token");
      // O mesmo formato do `gh pr list --json`: o rollup do último commit vira uma checagem só ({state}).
      return nos
        .map((v) => {
          const o2 = (v ?? {}) as Record<string, unknown> & { commits?: { nodes?: { commit?: { statusCheckRollup?: { state?: unknown } | null } }[] } };
          const estado = o2.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
          return lerPrDoGh(repo, { ...o2, statusCheckRollup: typeof estado === "string" ? [{ state: estado }] : [] });
        })
        .filter((p): p is PrLido => p !== null);
    },
  };
}

export type JeitoPrs = "token" | "gh_token" | "gh" | "nenhum";

/**
 * definido em 2026-11-02 (3ª revisão do PR #621): o servidor compartilhado sem token não tem credencial para os PRs. A
 * fonte nem tenta o `gh` (a imagem não o tem, e um `gh` que aparecesse seria de quem opera a máquina): toda leitura falha
 * com `sem_login`, sempre o mesmo código, então o aviso "não conectado" é gravado uma vez e o log sai uma vez por repo,
 * sem alternar com gh_ausente/limite.
 */
const FONTE_SEM_CREDENCIAL: FontePrs = { listar: () => Promise.reject(new ErroGithub("sem_login", "token")) };

export const API_GITHUB_PADRAO = "https://api.github.com";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * definido em 2026-11-02 (4ª revisão do PR #621): a base da API do token do quadro. Variável própria,
 * NOD_QUADRO_GITHUB_API (padrão https://api.github.com): a NOD_GITHUB_API é do conector e apontá-la para outro lugar
 * não pode levar junto o token do servidor. Só https; http só nos testes (VITEST) e só para o loopback (a API falsa do
 * teste de boot). Recusada = null, com `prs_do_quadro_api_recusada` no log (sem a url, que pode trazer credencial).
 */
export function baseDaApi(env: Readonly<Record<string, string | undefined>>): string | null {
  const bruta = env.NOD_QUADRO_GITHUB_API?.trim() || API_GITHUB_PADRAO;
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    log("aviso", "prs_do_quadro_api_recusada", { motivo: "url_invalida" });
    return null;
  }
  const testeLocal = url.protocol === "http:" && Boolean(env.VITEST) && LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !testeLocal) {
    log("aviso", "prs_do_quadro_api_recusada", { motivo: "sem_https" });
    return null;
  }
  return bruta;
}

/**
 * Com NOD_QUADRO_GITHUB_TOKEN, a API (produção); sem, o `gh` desta máquina (desenvolvimento). `gh_token` = o `gh` com
 * GH_TOKEN no ambiente: é token do servidor como o outro (2ª revisão do PR #621) e obedece à mesma lista de tenants.
 * No modo compartilhado sem token, `nenhum` (FONTE_SEM_CREDENCIAL); com o token e a base recusada (baseDaApi), também.
 */
export function fonteDoAmbiente(env: Readonly<Record<string, string | undefined>>): { fonte: FontePrs; jeito: JeitoPrs } {
  const token = env.NOD_QUADRO_GITHUB_TOKEN?.trim();
  if (token) {
    const base = baseDaApi(env);
    if (base === null) return { fonte: FONTE_SEM_CREDENCIAL, jeito: "nenhum" };
    return { fonte: fonteApi({ token, base }), jeito: "token" };
  }
  if (env.NOD_MODO === "compartilhado") return { fonte: FONTE_SEM_CREDENCIAL, jeito: "nenhum" };
  const envGh = Object.fromEntries(["PATH", "HOME", "USER", "GH_TOKEN", "GH_HOST", "GH_CONFIG_DIR"].flatMap((k) => (env[k] ? [[k, env[k]!]] : [])));
  return { fonte: fonteGh({ env: envGh }), jeito: env.GH_TOKEN?.trim() ? "gh_token" : "gh" };
}

/** O laço que o boot sobe: os repos, a fonte e os tenants. */
export type PlanoPrsDoQuadro = { repos: string[]; fonte: FontePrs; jeito: JeitoPrs; tenants: ReadonlySet<string> };

/**
 * O que o boot faz com o ambiente (boot.ts): sem NOD_QUADRO_GITHUB_REPOS, nada (null, sem log); com os repos e sem
 * tenant na lista, nada também, com `prs_do_quadro_sem_tenants` no log (em qualquer jeito e modo); senão, o plano.
 */
export function planoPrsDoQuadro(env: Readonly<Record<string, string | undefined>>): PlanoPrsDoQuadro | null {
  const repos = reposDoAmbiente(env.NOD_QUADRO_GITHUB_REPOS);
  if (repos.length === 0) return null;
  const { fonte, jeito } = fonteDoAmbiente(env);
  const tenants = tenantsQueSincronizam(env);
  if (tenants.size === 0) {
    log("aviso", "prs_do_quadro_sem_tenants", { repos: repos.length, jeito });
    return null;
  }
  log("info", "prs_do_quadro_ligado", { repos: repos.length, jeito, tenants: tenants.size });
  return { repos, fonte, jeito, tenants };
}

/**
 * definido em 2026-11-02 (5ª revisão do PR #621): repo 404/sem permissão/movido e credencial ausente ou recusada não são
 * falha passageira: são configuração (NOD_QUADRO_GITHUB_REPOS, o token, o `gh auth login`). Não contam como falha seguida
 * (o erro do log é para rede/5xx) e o repo fica sem leitura por 10 min, com o aviso do topo mantido. Pausa longa em vez
 * de "até a configuração mudar": o token pode ganhar acesso ao repo e o `gh` pode logar sem reiniciar o processo (os
 * repos e a fonte só mudam no boot), então a leitura volta sozinha em até 10 min.
 */
export const PAUSA_SEM_ACESSO_MS = 10 * 60_000;
const DE_CONFIGURACAO = new Set(["gh_ausente", "sem_login", "sem_permissao", "nao_encontrado", "movido"]);

/** O que a volta entrega a cada pessoa: os PRs lidos e o aviso do quadro (null = tudo certo; undefined = não mexe). */
export type LeituraPrs = { prs: readonly PrLido[]; aviso: string | null | undefined };

/**
 * Uma volta: lê cada repo (um que falha não impede os outros; o código vai para o log uma vez por mudança) e, com algum
 * PR ou um aviso a dar/limpar, entrega a leitura a cada pessoa dos tenants permitidos (paraCadaPessoa: uma que falha não
 * impede as outras). Pessoa de tenant fora da trava não abre transação nem recebe nada.
 */
export async function voltaPrsDoQuadro(p: {
  db: Db;
  fonte: FontePrs;
  repos: readonly string[];
  processar: (escopo: Escopo, leitura: LeituraPrs) => Promise<void>;
  /** tenantsQueSincronizam: só eles recebem a leitura; vazio = ninguém (nem lê o GitHub). */
  tenants: ReadonlySet<string>;
  opcoes?: OpcoesLaco;
  ultimaFalha?: Map<string, string>;
  /** 4ª revisão do PR #621: as falhas seguidas de cada repo (a 3ª vai ao log como erro, uma vez por sequência). */
  seguidas?: Map<string, number>;
  /** 4ª revisão do PR #621: até quando cada repo fica sem leitura por rate limit (ErroLimiteGithub.retomarEm). */
  pausa?: Map<string, number>;
  agora?: () => number;
}): Promise<{ prs: number; falhas: number }> {
  const tenants = p.tenants;
  if (tenants.size === 0) return { prs: 0, falhas: 0 };
  const prs: PrLido[] = [];
  const resultados: { repo: string; codigo: string | null }[] = [];
  let falhas = 0;
  const agora = p.agora ?? Date.now;
  for (const repo of p.repos) {
    // Em pausa: nem chama o GitHub e não conta como falha. Pelo rate limit, conta como limite (não mexe no aviso do
    // topo); por configuração (5ª revisão), repete o último código, e o aviso "sem acesso"/"não conectado" segue igual.
    const ate = p.pausa?.get(repo);
    if (ate !== undefined && agora() < ate) {
      const ultimo = p.ultimaFalha?.get(repo);
      resultados.push({ repo, codigo: ultimo !== undefined && DE_CONFIGURACAO.has(ultimo) ? ultimo : "limite" });
      continue;
    }
    p.pausa?.delete(repo);
    try {
      prs.push(...(await p.fonte.listar(repo)));
      p.ultimaFalha?.delete(repo);
      p.seguidas?.delete(repo);
      resultados.push({ repo, codigo: null });
    } catch (e) {
      falhas++;
      const codigo = e instanceof ErroGithub ? e.codigo : "falha";
      // Sem repetir o mesmo aviso a cada 30 s: só quando o código muda.
      if (p.ultimaFalha?.get(repo) !== codigo) log("aviso", "prs_do_quadro_leitura_falhou", { repo, codigo });
      p.ultimaFalha?.set(repo, codigo);
      if (DE_CONFIGURACAO.has(codigo)) {
        // 5ª revisão do PR #621: configuração não é falha seguida; o repo descansa PAUSA_SEM_ACESSO_MS.
        p.seguidas?.delete(repo);
        p.pausa?.set(repo, agora() + PAUSA_SEM_ACESSO_MS);
      } else {
        const n = (p.seguidas?.get(repo) ?? 0) + 1;
        p.seguidas?.set(repo, n);
        if (n === 3) log("erro", "prs_do_quadro_falhas_seguidas", { repo, codigo, seguidas: n });
        if (e instanceof ErroLimiteGithub) p.pausa?.set(repo, e.retomarEm);
      }
      resultados.push({ repo, codigo });
    }
  }
  const aviso = avisoDaLeitura(resultados);
  if (prs.length > 0 || aviso !== undefined) {
    const leitura: LeituraPrs = { prs, aviso };
    await paraCadaPessoa(p.db, async (escopo) => { if (tenants.has(escopo.tenantId.toLowerCase())) await p.processar(escopo, leitura); }, p.opcoes);
  }
  return { prs: prs.length, falhas };
}

export function iniciarLacoPrsDoQuadro(p: {
  db: Db;
  fonte: FontePrs;
  repos: readonly string[];
  processar: (escopo: Escopo, leitura: LeituraPrs) => Promise<void>;
  tenants: ReadonlySet<string>;
  intervaloMs?: number;
  opcoes?: OpcoesLaco;
  aoBater?: () => void;
}): { parar(): Promise<void> } {
  const intervalo = p.intervaloMs ?? INTERVALO_PRS_DO_QUADRO_MS;
  const ultimaFalha = new Map<string, string>();
  const seguidas = new Map<string, number>();
  const pausa = new Map<string, number>();
  let rodando = false;
  let emVoo: Promise<unknown> | null = null;
  const tick = async () => {
    if (rodando) return;
    rodando = true;
    const inicio = Date.now();
    try {
      await voltaPrsDoQuadro({ ...p, ultimaFalha, seguidas, pausa });
    } catch (e) {
      log("erro", "laco_prs_do_quadro_falhou", { erro: e instanceof Error ? e.name : "desconhecido" });
    } finally {
      rodando = false;
      logarTickLento("prs_do_quadro", Date.now() - inicio, intervalo);
      p.aoBater?.();
    }
  };
  const timer = setInterval(() => {
    if (rodando) return;
    emVoo = tick().finally(() => {
      emVoo = null;
    });
  }, intervalo);
  return {
    async parar() {
      clearInterval(timer);
      if (emVoo) await emVoo;
    },
  };
}
