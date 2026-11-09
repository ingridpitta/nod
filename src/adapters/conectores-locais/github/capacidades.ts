import type { NomeCapacidadeGithub } from "../../../contracts/github.ts";
import type { AlvoGithub, ArgsGithub } from "../../../domain/github.ts";

/**
 * Uma requisição à API REST do GitHub. `caminho` sempre começa por `repos/` e é montado AQUI, com
 * cada pedaço já validado pelo domínio e ainda codificado — no `gh api` ele é um argumento posicional
 * que não começa por `-`, logo nunca vira opção.
 */
export type RequisicaoGithub = {
  metodo: "GET" | "POST";
  caminho: string;
  corpo?: Record<string, unknown>;
  /** definido em 2026-09-24: `diff` e `raw` pedem o texto cru; o resto é JSON. */
  aceitar?: "json" | "diff" | "raw";
};

/** `timeoutMs` = o que sobra do prazo da CAPACIDADE, não um teto por requisição. */
export type PedirGithub = (r: RequisicaoGithub, timeoutMs: number) => Promise<string>;

/**
 * definido em 2026-09-24: 12 s para a capacidade INTEIRA, abaixo dos 15 s de CHAMADA_CONECTOR_MS do
 * servidor. pr_checks faz duas requisições em sequência (o SHA do head, depois os checks) e divide
 * este prazo; pr_comentarios faz as duas em paralelo. Antes cada requisição tinha 12 s próprios e as
 * duas somavam 24 s — o servidor desistia antes e o modelo lia "conector indisponível".
 */
export const PRAZO_CAPACIDADE_GITHUB_MS = 12_000;

/** Backend = um jeito de conectar atrás da mesma interface (ADR-048). */
export interface BackendGithub {
  /** As capacidades que este jeito sabe cumprir; as outras aparecem como indisponíveis. */
  readonly disponiveis: readonly NomeCapacidadeGithub[];
  executar(args: ArgsGithub): Promise<string>;
}

export const MIDIA: Record<NonNullable<RequisicaoGithub["aceitar"]>, string> = {
  json: "application/vnd.github+json",
  diff: "application/vnd.github.diff",
  raw: "application/vnd.github.raw+json",
};

export const TODAS: readonly NomeCapacidadeGithub[] = ["pr_ver", "pr_diff", "pr_arquivos", "pr_comentarios", "pr_checks", "arquivo_ler", "issue_ver", "pr_comentar", "pr_revisar"];

const repo = (a: AlvoGithub) => `repos/${encodeURIComponent(a.dono)}/${encodeURIComponent(a.repo)}`;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const login = (v: unknown): string | null => (typeof obj(v).login === "string" ? (obj(v).login as string) : null);

function json(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/**
 * definido em 2026-09-24: o JSON do GitHub de um PR tem ~20 KB, quase tudo URL. O modelo recebe só
 * os campos que servem para revisar; o resto gastaria o orçamento do turno (8.000 caracteres).
 */
function resumoPr(p: Obj): Obj {
  return {
    numero: p.number, titulo: p.title, estado: p.state, rascunho: p.draft, mesclado: p.merged, autor: login(p.user),
    base: obj(p.base).ref, head: obj(p.head).ref, head_sha: obj(p.head).sha,
    adicoes: p.additions, remocoes: p.deletions, arquivos: p.changed_files,
    rotulos: lista(p.labels).map((l) => l.name), revisores_pedidos: lista(p.requested_reviewers).map(login),
    url: p.html_url, criado_em: p.created_at, atualizado_em: p.updated_at, descricao: p.body ?? "",
  };
}

/** Executa uma capacidade sobre `pedir` (gh api ou fetch): mesma rota REST, mesmo resultado. */
export async function executarPorRest(args: ArgsGithub, pedirComPrazo: PedirGithub, prazoMs = PRAZO_CAPACIDADE_GITHUB_MS, agora: () => number = Date.now): Promise<string> {
  const base = repo(args.alvo);
  const fim = agora() + prazoMs;
  const pedir = (r: RequisicaoGithub) => pedirComPrazo(r, Math.max(1, fim - agora()));
  switch (args.capacidade) {
    case "pr_ver":
      return JSON.stringify(resumoPr(obj(json(await pedir({ metodo: "GET", caminho: `${base}/pulls/${args.numero}` })))));
    case "pr_diff":
      return pedir({ metodo: "GET", caminho: `${base}/pulls/${args.numero}`, aceitar: "diff" });
    case "pr_arquivos": {
      const arquivos = lista(json(await pedir({ metodo: "GET", caminho: `${base}/pulls/${args.numero}/files?per_page=100` })));
      return JSON.stringify(arquivos.map((f) => ({ arquivo: f.filename, estado: f.status, adicoes: f.additions, remocoes: f.deletions })));
    }
    case "pr_comentarios": {
      const [daConversa, dasLinhas] = await Promise.all([
        pedir({ metodo: "GET", caminho: `${base}/issues/${args.numero}/comments?per_page=100` }),
        pedir({ metodo: "GET", caminho: `${base}/pulls/${args.numero}/comments?per_page=100` }),
      ]);
      const conversa = lista(json(daConversa));
      const linhas = lista(json(dasLinhas));
      return JSON.stringify({
        conversa: conversa.map((c) => ({ autor: login(c.user), em: c.created_at, texto: c.body })),
        linhas: linhas.map((c) => ({ autor: login(c.user), arquivo: c.path, linha: c.line ?? c.original_line, em: c.created_at, texto: c.body })),
      });
    }
    case "pr_checks": {
      const pr = obj(json(await pedir({ metodo: "GET", caminho: `${base}/pulls/${args.numero}` })));
      const sha = obj(pr.head).sha;
      if (typeof sha !== "string" || !/^[0-9a-f]{7,64}$/.test(sha)) return JSON.stringify({ head_sha: null, checks: [] });
      const r = obj(json(await pedir({ metodo: "GET", caminho: `${base}/commits/${sha}/check-runs?per_page=100` })));
      return JSON.stringify({ head_sha: sha, checks: lista(r.check_runs).map((c) => ({ nome: c.name, estado: c.status, conclusao: c.conclusion, url: c.html_url })) });
    }
    case "arquivo_ler": {
      const caminho = args.caminho.split("/").map(encodeURIComponent).join("/");
      return pedir({ metodo: "GET", caminho: `${base}/contents/${caminho}${args.ref ? `?ref=${encodeURIComponent(args.ref)}` : ""}`, aceitar: "raw" });
    }
    case "issue_ver": {
      const i = obj(json(await pedir({ metodo: "GET", caminho: `${base}/issues/${args.numero}` })));
      return JSON.stringify({ numero: i.number, titulo: i.title, estado: i.state, autor: login(i.user), rotulos: lista(i.labels).map((l) => l.name), comentarios: i.comments, eh_pr: "pull_request" in i, url: i.html_url, descricao: i.body ?? "" });
    }
    case "pr_comentar": {
      const c = obj(json(await pedir({ metodo: "POST", caminho: `${base}/issues/${args.numero}/comments`, corpo: { body: args.texto } })));
      return JSON.stringify({ ok: true, autor: login(c.user), url: c.html_url });
    }
    case "pr_revisar": {
      const evento = args.evento === "approve" ? "APPROVE" : args.evento === "request_changes" ? "REQUEST_CHANGES" : "COMMENT";
      const r = obj(json(await pedir({ metodo: "POST", caminho: `${base}/pulls/${args.numero}/reviews`, corpo: { event: evento, ...(args.texto ? { body: args.texto } : {}) } })));
      return JSON.stringify({ ok: true, estado: r.state, autor: login(r.user), url: r.html_url });
    }
  }
}
