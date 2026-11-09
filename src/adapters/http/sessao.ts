import type { IncomingMessage } from "node:http";
import type { ModoSessaoDto } from "../../contracts/api.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import type { Escopo } from "../../shared/types.ts";
import type { Rota } from "./roteador.ts";
import { rotasGoogle, type ConfigGoogle } from "./sessao-google.ts";
import { cabecalhoApagarSessao, cabecalhoCookieSessao, COOKIE_SESSAO, lerSessaoDoCookie } from "./sessao-cookie.ts";
import type { GuardaSessao } from "./sessao-revogavel.ts";
import { rotuloDoAparelho } from "../../domain/conta.ts";
import { lerCookies } from "./util.ts";

/**
 * Sessão por cookie assinado (HMAC) `nod_sessao` = base64url(JSON{tenantId, pessoaId}) "." HMAC.
 * A sessão vem do SERVIDOR, nunca do CLI (ADR-019). Dois modos de entrar, escolhidos por NOD_LOGIN
 * (ADR-030) — nunca por omissão:
 *  - `google`: OAuth do Google, só para e-mails do cadastro e, com NOD_GOOGLE_DOMINIO, só desse
 *    domínio (sessao-google.ts). Pode escutar fora de 127.0.0.1, e exige segredo de sessão forte.
 *  - `stub`: login de DESENVOLVIMENTO, lista as pessoas do cadastro e entra como uma delas sem prova
 *    nenhuma. Por isso só existe em loopback: `exigirConfiguracaoSegura` recusa subir de outro jeito.
 * Os testes não usam nenhum dos dois: cunham o cookie direto com `cunharCookie`.
 */
export { assinar, cabecalhoCookieSessao, COOKIE_SESSAO, cunharCookie, iguaisEmTempoConstante, lerAssinado, lerCookieSessao, lerSessaoDoCookie } from "./sessao-cookie.ts";

export type ModoLogin = "stub" | "google";

/** Pessoa que o login de desenvolvimento oferece (vem do cadastro, nunca fixa no código). */
export type PessoaDoStub = { tenantId: string; id: string; nome: string };

export type OpcoesSessao = (
  | { modo: "stub"; pessoas?: () => Promise<PessoaDoStub[]> }
  | { modo: "google"; google: ConfigGoogle }
) & { /** ADA-245: liga as telas novas do onboarding; ausente = NOD_ONBOARDING_TEXTO. */ onboardingTexto?: boolean };

// ---------------------------------------------------------------------------------------------
// Configuração segura (E1.5/E1.6, ADR-030): o que o servidor RECUSA antes de escutar.

const HOSTS_LOOPBACK = new Set(["127.0.0.1", "localhost"]);

/**
 * Segredos conhecidos: o fallback histórico do código e o valor que o .env.example distribui.
 * Definido em 2026-09-16: com eles, qualquer pessoa forja o cookie de qualquer outra, sem log.
 */
const SEGREDOS_CONHECIDOS = new Set(["dev-sem-segredo", "troque-este-segredo-em-dev"]);
/** definido em 2026-09-16: 32 caracteres ≈ o mínimo de um segredo HMAC gerado (openssl rand -base64 24). */
export const SEGREDO_MINIMO = 32;

/**
 * Lança (erro de boot, nunca ErroDeDominio) quando a combinação modo × host × segredo abriria a porta:
 *  - stub fora de loopback: qualquer um que alcance o servidor entraria como qualquer pessoa;
 *  - google com segredo ausente, conhecido ou curto: o cookie seria forjável.
 */
export function exigirConfiguracaoSegura(p: { modo: ModoLogin; host: string; segredo: string | undefined }): void {
  if (p.modo === "stub" && !HOSTS_LOOPBACK.has(p.host)) {
    throw new Error(`NOD_HOST=${p.host} recusado: com NOD_LOGIN=stub (login de desenvolvimento) o servidor só escuta em 127.0.0.1`);
  }
  if (p.modo === "google") {
    const s = p.segredo ?? "";
    if (s.length < SEGREDO_MINIMO || SEGREDOS_CONHECIDOS.has(s)) {
      throw new Error(`NOD_SESSAO_SEGREDO recusado: com NOD_LOGIN=google ele precisa ter ao menos ${SEGREDO_MINIMO} caracteres e não pode ser o valor de exemplo`);
    }
  }
}

/** Segredo efetivo: no stub cai para um valor de desenvolvimento; no google nunca (exigirConfiguracaoSegura já recusou). */
export function segredoEfetivo(modo: ModoLogin, segredo: string | undefined): string {
  if (segredo) return segredo;
  if (modo === "stub") return "dev-sem-segredo";
  throw new Error("NOD_SESSAO_SEGREDO ausente com NOD_LOGIN=google");
}

/**
 * Lê NOD_LOGIN e NOD_GOOGLE_* do ambiente. Sem NOD_LOGIN o servidor NÃO sobe: escolher o login de
 * desenvolvimento por omissão é exatamente o acidente que o ADR-030 fecha (um deploy atrás de proxy
 * em 127.0.0.1 viraria "todo mundo é qualquer pessoa"). Google meio configurado também não sobe.
 */
export function opcoesSessaoDoEnv(
  env: Readonly<Record<string, string | undefined>>,
  fontes: { pessoaPorEmail: ConfigGoogle["pessoaPorEmail"]; admitirPorDominio?: ConfigGoogle["admitirPorDominio"]; pessoas: () => Promise<PessoaDoStub[]> },
): OpcoesSessao {
  const modo = env.NOD_LOGIN;
  if (modo === "stub") return { modo: "stub", pessoas: fontes.pessoas };
  if (modo === "google") {
    const clientId = env.NOD_GOOGLE_CLIENT_ID;
    const clientSecret = env.NOD_GOOGLE_CLIENT_SECRET;
    const redirectUri = env.NOD_GOOGLE_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("NOD_LOGIN=google exige NOD_GOOGLE_CLIENT_ID, NOD_GOOGLE_CLIENT_SECRET e NOD_GOOGLE_REDIRECT_URI");
    }
    return { modo: "google", google: { clientId, clientSecret, redirectUri, dominio: env.NOD_GOOGLE_DOMINIO || undefined, pessoaPorEmail: fontes.pessoaPorEmail, admitirPorDominio: fontes.admitirPorDominio } };
  }
  throw new Error(`NOD_LOGIN=${modo ?? "(ausente)"} recusado: use NOD_LOGIN=google (login real) ou NOD_LOGIN=stub (só desenvolvimento, só em 127.0.0.1)`);
}

// ---------------------------------------------------------------------------------------------

/**
 * NOD-345: com `contas` (NOD_CONTAS ligada) o cookie ganha sid e passa a ser conferido no banco (sessao-revogavel.ts), e
 * entra `POST /sessao/sair`. Sem `contas`, tudo como antes: nenhuma consulta e nenhuma rota nova.
 */
/** `minhaConta` (NOD-346): NOD_MINHA_CONTA ligada; a web só mostra a seção Minha conta com ela. */
export type ContasNaSessao = { guarda: GuardaSessao; google: boolean; bootstrap: boolean; minhaConta?: boolean; onboardingTexto?: boolean; rotas?: Rota[] };

export type SessaoMontada = {
  modo: ModoLogin;
  resolverEscopo(req: IncomingMessage): Escopo | null | Promise<Escopo | null>;
  rotas: Rota[];
};

export function criarSessao(segredo: string, opcoes: OpcoesSessao = { modo: "stub" }, contas?: ContasNaSessao): SessaoMontada {
  const comuns: Rota[] = [
    {
      metodo: "GET",
      padrao: /^\/sessao$/,
      publica: true,
      async handler(ctx) {
        if (!ctx.escopo) {
          ctx.json(401, { codigo: "nao_permitido", mensagem: "Sua sessão terminou. Entre de novo para continuar." });
          return;
        }
        ctx.json(200, { tenantId: ctx.escopo.tenantId, pessoaId: ctx.escopo.pessoaId });
      },
    },
  ];
  // ADA-245: NOD_ONBOARDING_TEXTO=1 liga as telas novas do onboarding (Computadores, Remover o nod deste computador).
  const extraModo = { ...(contas ? { contas: { google: contas.google, bootstrap: contas.bootstrap, ...(contas.minhaConta ? { minhaConta: true } : {}), ...(contas.onboardingTexto ? { onboardingTexto: true } : {}) } } : {}), ...(opcoes.onboardingTexto ?? process.env.NOD_ONBOARDING_TEXTO === "1" ? { onboardingTexto: true as const } : {}) };
  const seguro = opcoes.modo === "google" && opcoes.google.redirectUri.startsWith("https://");
  /** Cunha o cookie da pessoa: com contas, cria a sessão no banco e põe o sid. */
  const cookiePara = async (escopo: Escopo, req: IncomingMessage, maxAgeS?: number): Promise<string> => {
    const sid = contas ? await contas.guarda.criar(escopo, "web", rotuloDoAparelho(req.headers["user-agent"])) : null;
    return cabecalhoCookieSessao(escopo, segredo, seguro, maxAgeS, sid);
  };

  if (contas) {
    comuns.push({
      metodo: "POST",
      padrao: /^\/sessao\/sair$/,
      publica: true,
      async handler(ctx) {
        // Sair desta sessão: revoga o sid (se houver) e apaga o cookie. Sem sessão também responde 200 (idempotente).
        const lido = lerSessaoDoCookie(lerCookies(ctx.req)[COOKIE_SESSAO], segredo);
        if (lido?.sid) await contas.guarda.revogar(lido.escopo, lido.sid);
        ctx.res.setHeader("set-cookie", cabecalhoApagarSessao(seguro));
        ctx.json(200, { ok: true });
      },
    });
  }

  const rotas: Rota[] =
    opcoes.modo === "google"
      ? [...comuns, rotaModo({ modo: "google", ...extraModo }), ...rotasGoogle(segredo, { ...opcoes.google, cookiePara })]
      : [...comuns, ...rotasStub(cookiePara, opcoes.pessoas, extraModo)];

  return {
    modo: opcoes.modo,
    resolverEscopo(req) {
      const lido = lerSessaoDoCookie(lerCookies(req)[COOKIE_SESSAO], segredo);
      if (!lido) return null;
      if (!contas) return lido.escopo;
      return contas.guarda.conferir(lido.escopo, lido.sid).then((ok) => (ok ? lido.escopo : null));
    },
    rotas: [...rotas, ...(contas?.rotas ?? [])],
  };
}

function rotaModo(corpo: ModoSessaoDto | (() => Promise<ModoSessaoDto>)): Rota {
  return {
    metodo: "GET",
    padrao: /^\/sessao\/modo$/,
    publica: true,
    async handler(ctx) {
      ctx.json(200, typeof corpo === "function" ? await corpo() : corpo);
    },
  };
}

/** Login de desenvolvimento: só existe com NOD_LOGIN=stub, e o servidor só escuta em loopback nesse modo. */
function rotasStub(
  cookiePara: (escopo: Escopo, req: IncomingMessage) => Promise<string>,
  pessoas: (() => Promise<PessoaDoStub[]>) | undefined,
  extraModo: Partial<ModoSessaoDto>,
): Rota[] {
  const listar = pessoas ?? (async () => []);
  return [
    rotaModo(async () => ({ modo: "stub", pessoas: (await listar()).map((p) => ({ id: p.id, nome: p.nome })), ...extraModo })),
    {
      metodo: "POST",
      padrao: /^\/sessao\/entrar$/,
      publica: true,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { pessoaId?: unknown };
        const pessoa = typeof corpo.pessoaId === "string" ? (await listar()).find((p) => p.id === corpo.pessoaId) : undefined;
        if (!pessoa) throw new ErroDeDominio("entrada_invalida", { cause: "pessoa fora do cadastro" });
        const escopo: Escopo = { tenantId: pessoa.tenantId, pessoaId: pessoa.id };
        ctx.res.setHeader("set-cookie", await cookiePara(escopo, ctx.req));
        ctx.json(200, escopo);
      },
    },
  ];
}
