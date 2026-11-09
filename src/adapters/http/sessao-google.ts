import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { log } from "../../obs/log.ts";
import type { Escopo } from "../../shared/types.ts";
import type { Rota } from "./roteador.ts";
import { assinar, cabecalhoCookieSessao, iguaisEmTempoConstante, lerAssinado, PERMANENCIA_SESSAO_S } from "./sessao-cookie.ts";
import { lerCookies } from "./util.ts";

/**
 * Login Google (ADR-021, ADR-030): OAuth 2.0 Authorization Code, SEM biblioteca (o nod tem
 * uma dependência de produção e trata a lista como superfície controlada).
 *
 *   GET /api/sessao/google
 *     └─ 302 accounts.google.com ?state=<nonce.hmac>   + Set-Cookie nod_oauth=<o mesmo state> (Lax, 600 s)
 *   GET /api/sessao/google/callback?code&state
 *     ├─ state com HMAC válido, idade ≤ 600 s e IGUAL ao cookie?      não → recusa
 *     ├─ POST oauth2.googleapis.com/token (fetch injetável, 5 s)      falhou → recusa
 *     ├─ claims do id_token: iss, aud, exp                           ruim → recusa
 *     ├─ email_verified = true                                       não → recusa
 *     ├─ Google responde pelo e-mail (ver googleEhAutoridade); com    não → recusa
 *     │  NOD_GOOGLE_DOMINIO, hd e e-mail precisam ser desse domínio
 *     ├─ e-mail casa uma pessoa (cfg.pessoaPorEmail; o boot liga em   não → tenta admitir
 *     │  buscarPorEmail, SEM escopo)
 *     ├─ sem pessoa: conta Workspace (`hd` = domínio do e-mail) de um    não → recusa
 *     │  domínio admitido vira pessoa (cfg.admitirPorDominio, emenda de
 *     │  2026-10-05 da ADR-030; quem decide o domínio é o banco)
 *     └─ 200 página que segue para / (PAGINA_ENTROU) + Set-Cookie nod_sessao (Strict; Max-Age de 30 dias, ADR-094;
 *        Secure se o redirect for https)
 *
 * TODA recusa é a MESMA resposta, byte a byte: 302 para /?entrar=recusado. Dizer "domínio errado"
 * num caso e "não cadastrado" no outro contaria a quem está de fora quem tem acesso ao nod. O motivo
 * real vai só para o log (`login_recusado`), sem o e-mail.
 *
 * A ALLOWLIST (e-mail em `pessoas`) é a fronteira de segurança; o domínio, quando configurado, é
 * defesa em profundidade. Não "simplificar" confiando no `hd` e tirando a busca da pessoa.
 *
 * Por que NÃO verificamos a assinatura RS256 do id_token: ele chega DIRETO do endpoint de token do
 * Google, numa chamada que o nosso servidor faz sobre TLS autenticada com o nosso client_secret — o
 * caso em que a documentação do Google dispensa a verificação. O perigo real é o inverso (aceitar um
 * id_token vindo do navegador), e este fluxo não tem esse caminho. Nunca leia id_token de query/corpo.
 */
export type ConfigGoogle = {
  clientId: string;
  clientSecret: string;
  /** URL pública do callback, exatamente como cadastrada no Google Cloud Console. */
  redirectUri: string;
  /** Domínio Workspace exigido na claim `hd` (NOD_GOOGLE_DOMINIO). Ausente = qualquer conta da allowlist. */
  dominio?: string;
  /** E-mail → pessoa do cadastro, sem escopo (buscarPorEmail). null = recusa. */
  pessoaPorEmail(email: string): Promise<Escopo | null>;
  /**
   * Primeira entrada de uma conta Workspace sem pessoa (NOD_ADMISSAO_DOMINIOS). Devolve a pessoa criada, ou
   * null quando o domínio não é admitido. Ausente = só entra quem já está no cadastro.
   */
  admitirPorDominio?(email: string): Promise<(Escopo & { criada: boolean }) | null>;
  /** NOD-345: com NOD_CONTAS, o cookie leva o id de uma sessão revogável criada aqui. Ausente = cookie de antes. */
  cookiePara?(escopo: Escopo, req: IncomingMessage, maxAgeS?: number): Promise<string>;
  /**
   * NOD-345 (ADR-124 §2): a volta do Google com intenção de CONTA. `bilhete` é o que `GET /sessao/google?conta=…`
   * recebeu (assinado por quem chamou); a função confere, decide e devolve o cookie (se entrou) e a página de destino.
   * Ausente = o `?conta=` é ignorado e o login segue o de antes (allowlist).
   */
  conta?: {
    bilheteDoNavegador(bilhete: string, req: IncomingMessage): boolean;
    aoVoltar(bilhete: string, g: { iss: string; sub: string; email: string; autoridade: boolean }, req: IncomingMessage): Promise<{ setCookie: string | null; pagina: string }>;
    /** Sem bilhete: a conta cujo Google (iss+sub) é este entra; null = segue o login de antes (allowlist). */
    entrarSemBilhete(g: { iss: string; sub: string }, req: IncomingMessage): Promise<{ setCookie: string; pagina: string } | null>;
    /**
     * ADA-242 (ADR-157 §3): o bilhete do Google pedido pelo APP (`?conta-app=`). Vale sem o cookie (o navegador do
     * sistema não tem a sessão do app): quem amarra é o desafio do processo principal, conferido na troca.
     */
    bilheteApp?(bilhete: string): boolean;
    /** A volta de um bilhete do app: guarda a identidade e devolve o endereço do loopback; null = não é bilhete do app. */
    aoVoltarApp?(bilhete: string, g: { iss: string; sub: string; email: string; autoridade: boolean }): Promise<string | null>;
  };
  /** Injetáveis para o teste nunca falar com o Google. */
  fetchImpl?: typeof fetch;
  agora?: () => number;
  urlAutorizacao?: string;
  urlToken?: string;
};

export const COOKIE_STATE = "nod_oauth";
/** definido em 2026-09-16: 10 min para escolher a conta no Google; depois disso o login recomeça. */
export const STATE_VALIDADE_MS = 600_000;
/** definido em 2026-09-16: mesmo teto de 5 s do cliente HTTP do nod (cliente-nod.ts). */
const TIMEOUT_TOKEN_MS = 5_000;
const EMISSORES = new Set(["accounts.google.com", "https://accounts.google.com"]);
export const DESTINO_RECUSA = "/?entrar=recusado";

/**
 * A volta do login bem-sucedido (definido em 2026-10-10, ADR-094): uma página da própria origem que segue para "/", no
 * lugar do 302 direto. A volta do Google é navegação que começou em outro site, e o nod_sessao é SameSite=Strict: com o
 * 302, a página do app nascia de uma navegação entre sites, e o Safari (iPhone e app instalado) pode segurar o cookie
 * Strict até a próxima navegação — a pessoa voltaria à tela de entrada. Saindo daqui, a ida a "/" é do próprio site.
 */
const PAGINA_MODELO = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="0;url=__DESTINO__"><title>nod</title></head><body><p><a href="__DESTINO__">Entrando no Nod…</a></p><script>location.replace("__DESTINO__")</script></body></html>';

/** A página da própria origem que segue para `destino` (caminho local, sempre começando com "/"). */
export function paginaIndoPara(destino: string): string {
  const d = destino.startsWith("/") && !destino.startsWith("//") ? destino.replace(/[^A-Za-z0-9/?=&_-]/g, "") : "/";
  return PAGINA_MODELO.replaceAll("__DESTINO__", d);
}
export const PAGINA_ENTROU = paginaIndoPara("/");

export type MotivoRecusa = "cancelado" | "state" | "sem_code" | "troca" | "id_token" | "emissor" | "audiencia" | "expirado" | "dominio" | "email_nao_verificado" | "sem_pessoa";

// ---------------------------------------------------------------------------------------------
// state anti-CSRF sem tabela: nonce + instante assinados; a MESMA string vai na URL e no cookie.

export function cunharState(segredo: string, agora: number, nonce = randomBytes(16).toString("base64url"), bilhete?: string): string {
  const payload = Buffer.from(JSON.stringify(bilhete ? { n: nonce, t: agora, c: bilhete } : { n: nonce, t: agora }), "utf8").toString("base64url");
  return `${payload}.${assinar(payload, segredo)}`;
}

/** true só com: assinatura válida, idade dentro da validade, e o state da URL igual ao do cookie. */
/** O bilhete de conta que foi junto no state (já validado por `stateValido`). */
export function bilheteDoState(state: string, segredo: string): string | null {
  const payload = lerAssinado(state, segredo);
  if (!payload) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { c?: unknown };
    return typeof obj.c === "string" ? obj.c : null;
  } catch {
    return null;
  }
}

/**
 * NOD-345: as claims para CONTA. Qualquer Google com e-mail verificado (Gmail e Workspace, ADR-124 §2); a identidade é
 * iss+sub. `autoridade` diz se o Google responde pelo e-mail (Gmail ou o próprio domínio Workspace): só assim o e-mail
 * pode achar uma conta que já existe.
 */
export function validarClaimsConta(claims: Record<string, unknown>, p: { clientId: string; agora: number }): { ok: true; iss: string; sub: string; email: string; autoridade: boolean } | { ok: false; motivo: MotivoRecusa } {
  if (typeof claims.iss !== "string" || !EMISSORES.has(claims.iss)) return { ok: false, motivo: "emissor" };
  const aud = claims.aud;
  if (!(aud === p.clientId || (Array.isArray(aud) && aud.includes(p.clientId)))) return { ok: false, motivo: "audiencia" };
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= p.agora) return { ok: false, motivo: "expirado" };
  if (claims.email_verified !== true) return { ok: false, motivo: "email_nao_verificado" };
  if (typeof claims.email !== "string" || typeof claims.sub !== "string" || claims.sub === "" || claims.sub.length > 255) return { ok: false, motivo: "id_token" };
  const email = claims.email.toLowerCase();
  return { ok: true, iss: "https://accounts.google.com", sub: claims.sub, email, autoridade: googleEhAutoridade(email, claims.hd) };
}

export function stateValido(daUrl: string | undefined, doCookie: string | undefined, segredo: string, agora: number): boolean {
  if (!daUrl || !doCookie || !iguaisEmTempoConstante(daUrl, doCookie)) return false;
  const payload = lerAssinado(daUrl, segredo);
  if (!payload) return false;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { n?: unknown; t?: unknown };
    if (typeof obj.n !== "string" || typeof obj.t !== "number") return false;
    return agora - obj.t >= 0 && agora - obj.t <= STATE_VALIDADE_MS;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// id_token

/** Só o payload (segmento do meio). Ver no cabeçalho do arquivo por que a assinatura não é checada. */
export function claimsDoIdToken(idToken: unknown): Record<string, unknown> | null {
  if (typeof idToken !== "string") return null;
  const partes = idToken.split(".");
  if (partes.length !== 3 || !partes[1]) return null;
  try {
    const obj: unknown = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
    return typeof obj === "object" && obj !== null && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * O Google só responde pela posse do e-mail quando ele é Gmail ou do próprio domínio Workspace (`hd`).
 * Conta Google criada com e-mail de outro provedor pode ter `email_verified` verdadeiro e mesmo assim
 * o endereço ter mudado de dono depois — essa conta não entra pela allowlist de e-mail.
 */
export function googleEhAutoridade(email: string, hd: unknown): boolean {
  if (email.endsWith("@gmail.com")) return true;
  return contaDoWorkspace(email, hd);
}

/** Conta de um Google Workspace: a claim `hd` existe e é o domínio do próprio e-mail. Gmail não tem `hd`. */
export function contaDoWorkspace(email: string, hd: unknown): hd is string {
  return typeof hd === "string" && hd !== "" && email.endsWith(`@${hd.toLowerCase()}`);
}

export function validarClaims(claims: Record<string, unknown>, p: { clientId: string; dominio?: string; agora: number }): { ok: true; email: string } | { ok: false; motivo: MotivoRecusa } {
  if (typeof claims.iss !== "string" || !EMISSORES.has(claims.iss)) return { ok: false, motivo: "emissor" };
  const aud = claims.aud;
  if (!(aud === p.clientId || (Array.isArray(aud) && aud.includes(p.clientId)))) return { ok: false, motivo: "audiencia" };
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= p.agora) return { ok: false, motivo: "expirado" };
  if (p.dominio) {
    // `hd` AUSENTE é conta pessoal (Gmail): recusa igual a domínio errado.
    if (typeof claims.hd !== "string" || claims.hd.toLowerCase() !== p.dominio) return { ok: false, motivo: "dominio" };
  }
  if (claims.email_verified !== true) return { ok: false, motivo: "email_nao_verificado" };
  if (typeof claims.email !== "string") return { ok: false, motivo: "dominio" };
  const email = claims.email.toLowerCase();
  if (p.dominio ? !email.endsWith(`@${p.dominio}`) : !googleEhAutoridade(email, claims.hd)) return { ok: false, motivo: "dominio" };
  return { ok: true, email };
}

// ---------------------------------------------------------------------------------------------

export function rotasGoogle(segredo: string, cfg: ConfigGoogle): Rota[] {
  const agora = cfg.agora ?? (() => Date.now());
  const dominio = cfg.dominio?.toLowerCase() || undefined;
  const seguro = cfg.redirectUri.startsWith("https://");
  const atributosState = `HttpOnly; SameSite=Lax; Path=/api/sessao/google${seguro ? "; Secure" : ""}`;
  // SameSite=Lax (e NÃO Strict) de propósito: a volta do Google é navegação top-level vinda de outro
  // site, e com Strict o navegador não manda o cookie — o login nunca fecha e o sintoma ("state
  // inválido") não aponta a causa. O nod_sessao continua Strict: é cunhado aqui, não lido aqui.
  const apagarState = `${COOKIE_STATE}=; Max-Age=0; ${atributosState}`;

  return [
    {
      metodo: "GET",
      padrao: /^\/sessao\/google$/,
      publica: true,
      async handler(ctx) {
        const params = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams;
        const doApp = params.get("conta-app");
        const pedido = doApp ?? params.get("conta");
        const bilhete = !cfg.conta || !pedido ? undefined
          : doApp !== null ? (doApp.length <= 1000 && cfg.conta.bilheteApp?.(doApp) ? doApp : undefined)
          : pedido.length <= 600 && cfg.conta.bilheteDoNavegador(pedido, ctx.req) ? pedido : undefined;
        // Bilhete de outro navegador (um link recebido) ou vencido: não vira login de antes por engano.
        if (pedido !== null && !bilhete) {
          ctx.res.writeHead(302, { location: "/?conta=recusado", "cache-control": "no-store" });
          ctx.res.end();
          return;
        }
        const state = cunharState(segredo, agora(), undefined, bilhete);
        const url = new URL(cfg.urlAutorizacao ?? "https://accounts.google.com/o/oauth2/v2/auth");
        url.searchParams.set("client_id", cfg.clientId);
        url.searchParams.set("redirect_uri", cfg.redirectUri);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", "openid email");
        // `hd` na URL só pré-filtra a tela do Google; a validação de verdade é a claim, no callback. Conta: qualquer Google.
        // Com contas, a tela de entrada também serve quem entra com Gmail: sem `hd`.
        if (dominio && !bilhete && !cfg.conta) url.searchParams.set("hd", dominio);
        url.searchParams.set("prompt", "select_account");
        url.searchParams.set("state", state);
        ctx.res.writeHead(302, {
          location: url.toString(),
          "set-cookie": `${COOKIE_STATE}=${state}; Max-Age=${STATE_VALIDADE_MS / 1000}; ${atributosState}`,
          "cache-control": "no-store",
        });
        ctx.res.end();
      },
    },
    {
      metodo: "GET",
      padrao: /^\/sessao\/google\/callback$/,
      publica: true,
      async handler(ctx) {
        const recusar = (motivo: MotivoRecusa) => {
          log("aviso", "login_recusado", { motivo });
          ctx.res.writeHead(302, { location: DESTINO_RECUSA, "set-cookie": apagarState, "cache-control": "no-store" });
          ctx.res.end();
        };

        const q = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams;
        if (q.has("error")) return recusar("cancelado");
        if (!stateValido(q.get("state") ?? undefined, lerCookies(ctx.req)[COOKIE_STATE], segredo, agora())) return recusar("state");
        const code = q.get("code");
        if (!code) return recusar("sem_code");

        let idToken: unknown;
        try {
          const f = cfg.fetchImpl ?? fetch;
          const r = await f(cfg.urlToken ?? "https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: "authorization_code" }).toString(),
            signal: AbortSignal.timeout(TIMEOUT_TOKEN_MS),
          });
          // Nada do corpo de erro do Google chega à pessoa nem ao log.
          if (!r.ok) return recusar("troca");
          idToken = ((await r.json()) as { id_token?: unknown }).id_token;
        } catch {
          return recusar("troca");
        }

        const claims = claimsDoIdToken(idToken);
        if (!claims) return recusar("id_token");
        const bilhete = cfg.conta ? bilheteDoState(q.get("state") ?? "", segredo) : null;
        if (bilhete && cfg.conta) {
          const g = validarClaimsConta(claims, { clientId: cfg.clientId, agora: agora() });
          if (!g.ok) return recusar(g.motivo);
          const loopback = cfg.conta.aoVoltarApp ? await cfg.conta.aoVoltarApp(bilhete, g) : null;
          if (loopback) {
            ctx.res.writeHead(302, { location: loopback, "set-cookie": apagarState, "cache-control": "no-store" });
            ctx.res.end();
            return;
          }
          const r = await cfg.conta.aoVoltar(bilhete, g, ctx.req);
          ctx.res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": r.setCookie ? [r.setCookie, apagarState] : [apagarState], "cache-control": "no-store" });
          ctx.res.end(r.pagina);
          return;
        }
        if (cfg.conta) {
          const g = validarClaimsConta(claims, { clientId: cfg.clientId, agora: agora() });
          const r = g.ok ? await cfg.conta.entrarSemBilhete(g, ctx.req) : null;
          if (r) {
            ctx.res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": [r.setCookie, apagarState], "cache-control": "no-store" });
            ctx.res.end(r.pagina);
            return;
          }
        }
        const v = validarClaims(claims, { clientId: cfg.clientId, dominio, agora: agora() });
        if (!v.ok) return recusar(v.motivo);

        let escopo = await cfg.pessoaPorEmail(v.email);
        const hd = claims.hd;
        if (!escopo && cfg.admitirPorDominio && contaDoWorkspace(v.email, hd)) {
          // Só conta Workspace: no Gmail o "domínio" é de todo mundo, e a claim `hd` é o que diz que o
          // Google responde por aquele domínio. A lista de domínios admitidos mora no banco (0052).
          const admitida = await cfg.admitirPorDominio(v.email);
          if (admitida) {
            if (admitida.criada) log("info", "pessoa_admitida", { tenant_id: admitida.tenantId, pessoa_id: admitida.pessoaId, dominio: hd.toLowerCase() });
            escopo = { tenantId: admitida.tenantId, pessoaId: admitida.pessoaId };
          }
        }
        if (!escopo) return recusar("sem_pessoa");

        log("info", "login_google", { tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId });
        const cookie = cfg.cookiePara ? await cfg.cookiePara(escopo, ctx.req, PERMANENCIA_SESSAO_S) : cabecalhoCookieSessao(escopo, segredo, seguro, PERMANENCIA_SESSAO_S);
        ctx.res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": [cookie, apagarState], "cache-control": "no-store" });
        ctx.res.end(PAGINA_ENTROU);
      },
    },
  ];
}
