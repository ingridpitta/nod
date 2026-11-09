import { COMPOSIO_POR_CAPACIDADE_GITHUB } from "../../contracts/github.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import type { ArgsGithub } from "../../domain/github.ts";
import type { AppGerenciado } from "../../domain/catalogo-marketplace.ts";
import { classificarFalhaHttp, ehRedirecionamentoRecusado, esperaAntes, lerRetryAfterMs, podeRepetir, prazoDaTentativa, type FalhaHttp } from "../../domain/nova-tentativa.ts";
import { log } from "../../obs/log.ts";
import { CHAMADA_CONECTOR_MS, ORCAMENTO_CONECTOR_MS } from "../../shared/constantes.ts";

export type ChamadaComposio = { slug: string; argumentos: Record<string, unknown> };

/** A tabela capacidade → GITHUB_* mora em src/contracts/github.ts (a migração dos acessos antigos também a lê). */
export const GITHUB_PELO_COMPOSIO = COMPOSIO_POR_CAPACIDADE_GITHUB;

/** As chamadas ao Composio de uma capacidade já validada pelo domínio; null = indisponível neste jeito. */
export function chamadasComposioGithub(a: ArgsGithub): ChamadaComposio[] | null {
  const repo = { owner: a.alvo.dono, repo: a.alvo.repo };
  switch (a.capacidade) {
    case "pr_ver":
      return [{ slug: "GITHUB_GET_A_PULL_REQUEST", argumentos: { ...repo, pull_number: a.numero } }];
    case "pr_arquivos":
      return [{ slug: "GITHUB_LIST_PULL_REQUESTS_FILES", argumentos: { ...repo, pull_number: a.numero, per_page: 100 } }];
    case "pr_comentarios":
      return [
        { slug: "GITHUB_LIST_ISSUE_COMMENTS", argumentos: { ...repo, issue_number: a.numero, per_page: 100 } },
        { slug: "GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST", argumentos: { ...repo, pull_number: a.numero, per_page: 100 } },
      ];
    case "arquivo_ler":
      return [{ slug: "GITHUB_GET_REPOSITORY_CONTENT", argumentos: { ...repo, path: a.caminho, ...(a.ref ? { ref: a.ref } : {}) } }];
    case "issue_ver":
      return [{ slug: "GITHUB_GET_AN_ISSUE", argumentos: { ...repo, issue_number: a.numero } }];
    case "pr_comentar":
      return [{ slug: "GITHUB_CREATE_AN_ISSUE_COMMENT", argumentos: { ...repo, issue_number: a.numero, body: a.texto } }];
    case "pr_revisar":
      return [{ slug: "GITHUB_CREATE_A_REVIEW_FOR_A_PULL_REQUEST", argumentos: { ...repo, pull_number: a.numero, event: a.evento === "approve" ? "APPROVE" : a.evento === "request_changes" ? "REQUEST_CHANGES" : "COMMENT", ...(a.texto ? { body: a.texto } : {}) } }];
    case "pr_diff":
    case "pr_checks":
      return null;
  }
}

function urlDoProvedor(valor: string, hosts: string[]): URL {
  let url: URL;
  try { url = new URL(valor); } catch { throw new ErroDeDominio("conector_indisponivel"); }
  if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.username || url.password || url.port) throw new ErroDeDominio("conector_indisponivel");
  return url;
}

const BASE = "https://backend.composio.dev/api/v3.1";

const HOSTS_LOGO = ["logos.composio.dev", "assets.composio.dev", "cdn.composio.dev"];

/** O logo só passa com host da allowlist: o servidor é quem busca a imagem (ADR-041 §6). */
function logoDoProvedor(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  try { return urlDoProvedor(bruto, HOSTS_LOGO).href; } catch { return null; }
}

/**
 * definido em 2026-09-29 (ADR-057): o `GET /toolkits` devolve até 1000 por página, e o catálogo
 * público tinha 312 toolkits na documentação do provedor. Cinco páginas são folga, não expectativa: o
 * teto existe para um `next_cursor` que nunca acaba não virar laço.
 */
const PAGINAS_TOOLKITS = 5;

export type OpcoesClienteComposio = {
  /** Relógio, espera e aleatório da nova tentativa (NOD-157) entram injetados para os testes serem determinísticos. */
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  aleatorio?: () => number;
  /** NOD-208 (revisão do PR #264): instante (no relógio `agora`) em que toda requisição desiste; corta os 30 s. */
  prazoFinal?: number;
};

/** definido em 2026-09-17: URLs e erros do provedor nunca transportam a chave para a web ou para o modelo. */
export function criarClienteComposio(chave: string, f: typeof fetch = fetch, opcoes: OpcoesClienteComposio = {}) {
  const agora = opcoes.agora ?? Date.now;
  const dormir = opcoes.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const aleatorio = opcoes.aleatorio ?? Math.random;
  const prazoFinal = opcoes.prazoFinal ?? Number.POSITIVE_INFINITY;

  /**
   * NOD-157 (emenda à ADR-009): GET é leitura (repete em 429, 5xx e rede); POST e PATCH são escrita (só 429, a
   * recusa do limitador antes de executar). Timeout, 401/403 e 4xx nunca repetem. Devolve a última resposta
   * (que pode ser !ok: quem chama classifica); só erro de rede sem resposta lança. O prazo de cada tentativa é
   * cortado ao que sobra dos 30 s e cobre também a leitura do corpo (o timer não é limpo no retorno).
   */
  async function requisitar(metodo: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<Response> {
    const inicio = agora();
    const restante = () => Math.min(ORCAMENTO_CONECTOR_MS - (agora() - inicio), prazoFinal - agora());
    const rotulo = `${metodo} /${path.split("?")[0]?.split("/")[1] ?? ""}`;
    let anterior: { status: number | "rede"; espera: number } | null = null;
    for (let tentativa = 1; ; tentativa++) {
      const campos = (desfecho: string) => ({ conector: "composio", ferramenta: rotulo, status: anterior?.status, tentativa, espera_ms: anterior?.espera, desfecho });
      let resposta: Response | null = null;
      let falha: FalhaHttp;
      // setTimeout e não AbortSignal.timeout: o relógio falso dos testes controla este, e unref não segura o processo.
      const ctrl = new AbortController();
      const prazo = setTimeout(() => ctrl.abort(new DOMException("prazo", "TimeoutError")), prazoDaTentativa(CHAMADA_CONECTOR_MS, restante()));
      prazo.unref?.();
      try {
        resposta = await f(`${BASE}${path}`, { method: metodo, headers: { "x-api-key": chave, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: ctrl.signal, redirect: "error" });
        if (resposta.ok) {
          if (anterior) log("info", "conector_nova_tentativa", campos("recuperou"));
          return resposta;
        }
        falha = resposta.status;
      } catch (e) {
        if (ehRedirecionamentoRecusado(e)) {
          clearTimeout(prazo);
          throw new ErroDeDominio("conector_indisponivel");
        }
        falha = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "rede";
      }
      const retryAfterMs = resposta ? lerRetryAfterMs(resposta.headers.get("retry-after"), agora()) : undefined;
      const repetir = podeRepetir({
        classe: classificarFalhaHttp(falha),
        ...(typeof falha === "number" ? { status: falha } : {}),
        somenteLeitura: metodo === "GET",
        tentativa,
        restanteMs: restante(),
        prazoMs: CHAMADA_CONECTOR_MS,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      });
      if (anterior) log("aviso", "conector_nova_tentativa", campos(repetir ? "repetindo" : "esgotou"));
      if (!repetir || falha === "timeout") {
        if (resposta) return resposta;
        throw new ErroDeDominio("conector_indisponivel");
      }
      clearTimeout(prazo);
      await resposta?.body?.cancel().catch(() => undefined);
      const espera = esperaAntes(tentativa, aleatorio(), retryAfterMs);
      anterior = { status: falha, espera };
      await dormir(espera);
    }
  }

  /** O `error` do `successful: false` que diz recusa da conta (lido só para classificar; o texto não sai daqui). */
  const ERRO_DE_AUTENTICACAO = /\b(401|403)\b|unauthori[sz]ed|forbidden|authenticat|expired|revoked|disconnected|not active|inactive|invalid[_ ](grant|token|credentials?)|reauthori[sz]|reconnect/i;

  /** Só 401 e 403 são recusa da conta (integracao_autenticacao); o resto (400/404/410, 5xx, 408/429, rede) é indisponível. */
  async function pedir(path: string, body?: unknown): Promise<Record<string, unknown>> {
    try {
      const r = await requisitar(body ? "POST" : "GET", path, body);
      if (!r.ok) throw new ErroDeDominio(r.status === 401 || r.status === 403 ? "integracao_autenticacao" : "conector_indisponivel");
      const data: unknown = await r.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new ErroDeDominio("conector_indisponivel");
      return data as Record<string, unknown>;
    } catch (e) {
      if (e instanceof ErroDeDominio) throw e;
      throw new ErroDeDominio("conector_indisponivel");
    }
  }
  return {
    validar: () => pedir("/toolkits?limit=1"),
    /**
     * ADR-041: o catálogo exibido é o que a pessoa configurou no painel (auth configs), não o
     * catálogo público de toolkits. A forma do envelope e o nome do campo do logo não estão
     * fixados no contrato do provedor, então lemos as variações conhecidas e o que não casar cai
     * fora em silêncio — catálogo incompleto degrada para o piso curado, nunca derruba a tela.
     */
    async catalogo(): Promise<{ slug: string; nome: string; logo: string | null }[]> {
      const r = await pedir("/auth_configs");
      const itens = (r.items ?? r.data ?? r.auth_configs) as unknown;
      if (!Array.isArray(itens)) throw new ErroDeDominio("conector_indisponivel");
      const porSlug = new Map<string, { slug: string; nome: string; logo: string | null }>();
      for (const it of itens) {
        if (!it || typeof it !== "object") continue;
        const o = it as Record<string, unknown>;
        const tk = o.toolkit as Record<string, unknown> | string | undefined;
        const slug = (typeof tk === "string" ? tk : typeof tk?.slug === "string" ? tk.slug : null)?.toLowerCase();
        if (!slug || !/^[a-z0-9_-]{1,64}$/.test(slug)) continue;
        if (o.status === "DISABLED" || o.deleted === true) continue;
        const meta = (tk && typeof tk === "object" ? tk : {}) as Record<string, unknown>;
        const logo = logoDoProvedor(meta.logo ?? (meta.meta as Record<string, unknown> | undefined)?.logo ?? o.logo);
        const nome = typeof meta.name === "string" ? meta.name : slug;
        if (!porSlug.has(slug)) porSlug.set(slug, { slug, nome, logo });
        else if (logo && !porSlug.get(slug)!.logo) porSlug.get(slug)!.logo = logo;
      }
      return [...porSlug.values()];
    },
    /**
     * ADR-057: o catálogo público, só o que o Composio conecta sem auth config no painel — o toolkit
     * com login gerenciado por ele (`composio_managed_auth_schemes` não vazio). Ficam de fora o que
     * não tem login a fazer (`no_auth`: conectar aqui termina numa conta conectada, que ele não tem),
     * o toolkit local e o customizado do projeto (esse, com auth config, já vem do `catalogo()`).
     */
    async gerenciados(): Promise<AppGerenciado[]> {
      const porSlug = new Map<string, AppGerenciado>();
      let cursor: string | null = null;
      for (let pagina = 0; pagina < PAGINAS_TOOLKITS; pagina++) {
        const r = await pedir(`/toolkits?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        if (!Array.isArray(r.items)) throw new ErroDeDominio("conector_indisponivel");
        for (const it of r.items as unknown[]) {
          if (!it || typeof it !== "object") continue;
          const o = it as Record<string, unknown>;
          const slug = typeof o.slug === "string" ? o.slug.toLowerCase() : null;
          if (!slug || !/^[a-z0-9_-]{1,64}$/.test(slug) || porSlug.has(slug)) continue;
          const gerenciado = Array.isArray(o.composio_managed_auth_schemes) && o.composio_managed_auth_schemes.length > 0;
          if (!gerenciado || o.no_auth === true || o.is_local_toolkit === true || o.type === "custom") continue;
          const meta = (o.meta && typeof o.meta === "object" ? o.meta : {}) as Record<string, unknown>;
          const categorias = (Array.isArray(meta.categories) ? meta.categories as unknown[] : [])
            .map((c) => typeof c === "string" ? c : c && typeof c === "object" ? (c as Record<string, unknown>).name : null)
            .filter((c): c is string => typeof c === "string" && c.length > 0);
          porSlug.set(slug, {
            slug,
            nome: typeof o.name === "string" && o.name.trim() ? o.name.trim() : slug,
            logo: logoDoProvedor(meta.logo),
            descricao: typeof meta.description === "string" ? meta.description : "",
            categorias,
          });
        }
        cursor = typeof r.next_cursor === "string" && r.next_cursor ? r.next_cursor : null;
        if (!cursor) break;
      }
      return [...porSlug.values()];
    },
    async criarSessao(userId: string, toolkit: string) {
      const r = await pedir("/tool_router/session", {
        user_id: userId, toolkits: { enable: [toolkit] }, preload: { tools: "all" },
        manage_connections: { enable: false }, workbench: { enable: false, enable_proxy_execution: false },
        search: { enable: false }, execute: { enable_multi_execute: false },
      });
      const mcp = r.mcp as { url?: unknown } | undefined;
      if (typeof r.session_id !== "string" || !/^[A-Za-z0-9_-]+$/.test(r.session_id) || typeof mcp?.url !== "string") throw new ErroDeDominio("conector_indisponivel");
      const url = urlDoProvedor(mcp.url, ["app.composio.dev", "backend.composio.dev"]);
      return { id: r.session_id, url: url.href };
    },
    async autorizar(sessaoId: string, toolkit: string) {
      const r = await pedir(`/tool_router/session/${encodeURIComponent(sessaoId)}/link`, { toolkit });
      if (typeof r.redirect_url !== "string" || typeof r.connected_account_id !== "string") throw new ErroDeDominio("conector_indisponivel");
      const url = urlDoProvedor(r.redirect_url, ["app.composio.dev", "connect.composio.dev", "backend.composio.dev"]);
      return { url: url.href, contaId: r.connected_account_id };
    },
    /**
     * NOD-422: executa uma ferramenta do Composio com a conta da pessoa (o servidor busca o time do Linear). Devolve o
     * `data` da resposta, sem o texto do provedor. Revisão 7 do PR #630: só a recusa da conta (401/403 do Composio, ou
     * `successful: false` cujo erro fala de autenticação, conta desconectada ou expirada) vira integracao_autenticacao (o
     * caso de uso pede a reconexão). 400/404/410, erro do GraphQL e o `successful: false` sem esse sinal são
     * conector_indisponivel, como prazo, 5xx, 429 e rede: pedir reconexão por um pedido errado mandaria a pessoa refazer
     * uma conta que funciona.
     */
    async executar(ferramenta: string, p: { userId: string; contaId: string; argumentos: Record<string, unknown> }): Promise<Record<string, unknown>> {
      if (!/^[A-Z0-9_]{1,80}$/.test(ferramenta)) throw new ErroDeDominio("conector_indisponivel");
      const r = await pedir(`/tools/execute/${ferramenta}`, { user_id: p.userId, connected_account_id: p.contaId, arguments: p.argumentos });
      if (r.successful === false) throw new ErroDeDominio(typeof r.error === "string" && ERRO_DE_AUTENTICACAO.test(r.error) ? "integracao_autenticacao" : "conector_indisponivel");
      if (!r.data || typeof r.data !== "object" || Array.isArray(r.data)) throw new ErroDeDominio("conector_indisponivel");
      return r.data as Record<string, unknown>;
    },
    async conectado(contaId: string, userId: string, toolkit: string) {
      const r = await pedir(`/connected_accounts/${encodeURIComponent(contaId)}`);
      const t = r.toolkit as { slug?: unknown } | undefined;
      return r.status === "ACTIVE" && r.is_disabled !== true && r.user_id === userId && t?.slug === toolkit;
    },
    /**
     * NOD-212: a resposta do PATCH traz `tool_router_tools`, as ferramentas que a sessão expõe depois de fixar a conta.
     * `ferramentas` conta as concretas (sem COMPOSIO_*); null = o provedor não mandou a lista (resposta sem corpo ou
     * noutro formato) e ninguém conclui nada dela. `avisos` são só os códigos (ex.: PRELOAD_TOOLS_HIGH_CONTEXT_USAGE).
     */
    async fixarConta(sessaoId: string, toolkit: string, contaId: string): Promise<{ ferramentas: number | null; avisos: string[] }> {
      const r = await requisitar("PATCH", `/tool_router/session/${encodeURIComponent(sessaoId)}`, { connected_accounts: { [toolkit]: [contaId] } }).catch(() => null);
      if (!r?.ok) throw new ErroDeDominio("conector_indisponivel");
      const lido: unknown = await r.json().catch(() => null);
      const corpo = lido && typeof lido === "object" && !Array.isArray(lido) ? lido as Record<string, unknown> : null;
      const lista = corpo?.tool_router_tools;
      // Autorrevisão do PR #288: item que não é string = formato que não conhecemos; contar 0 culparia o Composio.
      const ferramentas = Array.isArray(lista) && lista.every((t): t is string => typeof t === "string")
        ? lista.filter((t) => !t.startsWith("COMPOSIO_")).length
        : null;
      const avisos = (Array.isArray(corpo?.warnings) ? corpo.warnings as unknown[] : [])
        .map((w) => (w && typeof w === "object" ? (w as Record<string, unknown>).code : null))
        .filter((c): c is string => typeof c === "string" && /^[A-Z0-9_]{1,64}$/.test(c));
      return { ferramentas, avisos };
    },
  };
}
