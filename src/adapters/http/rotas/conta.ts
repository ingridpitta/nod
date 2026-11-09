import type { IncomingMessage } from "node:http";
import type { CaixaLocal } from "../../email/enviador.ts";
import { rotuloDoAparelho } from "../../../domain/conta.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import type { Escopo } from "../../../shared/types.ts";
import type { Quem, ServicoConta, SessaoNova } from "../../../use-cases/conta.ts";
import type { ServicoMinhaConta } from "../../../use-cases/minha-conta.ts";
import { TABELA_ERROS } from "../erros.ts";
import type { CtxPublico, Metodo, Rota } from "../roteador.ts";
import { assinar, cabecalhoCookieSessao, COOKIE_SESSAO, lerAssinado, lerSessaoDoCookie, PERMANENCIA_SESSAO_S } from "../sessao-cookie.ts";
import { paginaIndoPara } from "../sessao-google.ts";
import type { GuardaSessao } from "../sessao-revogavel.ts";
import { lerCookies } from "../util.ts";

/**
 * Rotas de conta (NOD-345, ADR-124). Só existem com NOD_CONTAS ligada (compor.ts). Todas em `/api/conta/*`, públicas no
 * roteador (a sessão é lida aqui, com o sid), e:
 *  - POST com `Origin` de outro host → 403 (a página de outro site não fala com estas rotas; o app, sem Origin, fala);
 *  - nenhuma resposta leva senha, código ou token de outra pessoa; o código de verificação só vai no e-mail.
 */
export type DepsRotasConta = {
  servico: ServicoConta;
  guarda: GuardaSessao;
  segredo: string;
  seguro: boolean;
  /** NOD_BOOTSTRAP: o espaço provisório por instalação (`/conta/provisorio`). */
  bootstrap: boolean;
  /** Só no stub (loopback): a caixa de e-mail local, lida em `GET /api/dev/caixa`. */
  caixa?: CaixaLocal | null;
  /** Google para conta ligado (NOD_LOGIN=google com client externo). */
  google: boolean;
  agora(): number;
  /**
   * NOD_ONBOARDING_TEXTO=1 (ADA-242, ADR-157): conta sem senha (`POST /conta/codigo`) e Google dentro do app (bilhete
   * `conta-app` + `POST /conta/google/trocar`). Desligada, as rotas novas respondem 404 e o resto fica como antes.
   */
  onboardingTexto?: boolean;
  /** NOD_MINHA_CONTA=1 (NOD-346): as rotas `/conta/eu/*`. Ausente, elas não existem. */
  minhaConta?: ServicoMinhaConta | null;
};

/**
 * NOD-346: os motivos que a tela da Minha conta precisa distinguir (abrir a janela de confirmar, dizer que o e-mail é de
 * outra conta…). Só estes saem no corpo, como `motivo`; qualquer outra causa continua só no log.
 */
const MOTIVOS_MINHA_CONTA = new Set(["reautenticar", "ultima_forma_de_entrada", "email_em_uso", "email_igual", "conta_de_equipe", "exclusao_programada", "sem conta", "email", "nome:nome_vazio", "nome:nome_longo", "nome:tipo", "sobreMim:sobre_mim_longo", "sobreMim:tipo", "foto:formato", "foto:tamanho", "foto:tipo"]);

/** definido em 2026-10-23: o bilhete do Google vale o mesmo que o state (10 min). */
const BILHETE_MS = 600_000;

/** IP de quem pede: atrás do Caddy (o servidor escuta em loopback), o primeiro do X-Forwarded-For; senão, o socket. */
/**
 * O IP de quem pede, para os limites. Em produção o Caddy é outro container (infra/gcp/vm/compose.yml) e o app só é
 * alcançável pela rede do compose: o socket vem de rede privada. O Caddy, sem `trusted_proxies`, ignora o
 * X-Forwarded-For de fora e põe o IP real como ÚLTIMO salto — por isso vale o último, nunca o primeiro (forjável).
 * IPv6 vira o /64: um cliente troca de endereço dentro do bloco à vontade.
 */
export function ipDe(req: IncomingMessage): string {
  const socket = semMapeado(req.socket?.remoteAddress ?? "");
  const xff = req.headers["x-forwarded-for"];
  const ultimo = semMapeado((Array.isArray(xff) ? xff.join(",") : xff ?? "").split(",").map((p) => p.trim()).filter(Boolean).at(-1) ?? "");
  return agrupar(proxyConfiavel(socket) && ultimo ? ultimo : socket).slice(0, 64) || "desconhecido";
}

const semMapeado = (ip: string): string => (ip.toLowerCase().startsWith("::ffff:") && ip.includes(".") ? ip.slice(7) : ip);

function proxyConfiavel(ip: string): boolean {
  if (ip === "::1" || /^fe80:/i.test(ip) || /^f[cd][0-9a-f]{2}:/i.test(ip)) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function agrupar(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [cabeca = "", cauda = ""] = ip.split("::");
  const partes = cabeca ? cabeca.split(":") : [];
  const fim = cauda ? cauda.split(":") : [];
  const cheio = ip.includes("::") ? [...partes, ...Array(Math.max(0, 8 - partes.length - fim.length)).fill("0"), ...fim] : partes;
  return `${cheio.slice(0, 4).map((h) => (h || "0").replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

function origemAceita(req: IncomingMessage): boolean {
  const origem = req.headers.origin;
  if (origem === undefined) return true;
  try {
    return new URL(origem).host === req.headers.host;
  } catch {
    return false;
  }
}

export function rotasConta(d: DepsRotasConta): Rota[] {
  const cookie = (s: SessaoNova) => cabecalhoCookieSessao(s.escopo, d.segredo, d.seguro, PERMANENCIA_SESSAO_S, s.sid);
  /**
   * Quem pede. O cookie de antes da 0109 (sem sid) que o servidor ainda aceita vira uma sessão registrada aqui, no
   * primeiro pedido à conta: sem isso, quem já estava logado ao ligar NOD_CONTAS não veria a conta nem o "sair".
   */
  const quem = async (ctx: CtxPublico): Promise<Quem> => {
    const req = ctx.req;
    const aparelho = rotuloDoAparelho(req.headers["user-agent"]);
    const h = req.headers["x-nod-app-desafio"];
    const desafioApp = typeof h === "string" && /^[A-Za-z0-9_-]{43}$/.test(h) ? h : null;
    const lido = lerSessaoDoCookie(lerCookies(req)[COOKIE_SESSAO], d.segredo);
    if (lido && !lido.sid && (await d.guarda.conferir(lido.escopo, null))) {
      const sid = await d.guarda.criar(lido.escopo, "web", aparelho);
      ctx.res.setHeader("set-cookie", cookie({ escopo: lido.escopo, sid }));
      return { escopo: lido.escopo, sid, ip: ipDe(req), aparelho, desafioApp };
    }
    const viva = lido && lido.sid && (await d.guarda.conferir(lido.escopo, lido.sid)) ? lido : null;
    // A sessão que acabou de ser trocada (importar) ainda se identifica: só o retry da importação a usa.
    const revogada = !viva && lido?.sid ? { escopo: lido.escopo, sid: lido.sid } : null;
    return { escopo: viva?.escopo ?? null, sid: viva?.sid ?? null, ip: ipDe(req), aparelho, desafioApp, revogada };
  };

  const rota = (metodo: Metodo, caminho: string, fn: (ctx: CtxPublico, q: Quem, corpo: Record<string, unknown>) => Promise<void>): Rota => ({
    metodo,
    padrao: new RegExp(`^/conta${caminho}$`),
    publica: true,
    async handler(ctx) {
      if (metodo !== "GET" && !origemAceita(ctx.req)) throw new ErroDeDominio("nao_permitido", { cause: "Origin de outro host" });
      ctx.res.setHeader("cache-control", "no-store");
      const corpo = metodo === "GET" ? {} : await ctx.corpo();
      await fn(ctx, await quem(ctx), typeof corpo === "object" && corpo !== null && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : {});
    },
  });
  /** Resposta que troca a sessão deste aparelho (entrou, importou, redefiniu, pareou). */
  const comSessao = (ctx: CtxPublico, r: { sessao: SessaoNova; trocaApp: string | null }, extra: Record<string, unknown>) => {
    ctx.res.setHeader("set-cookie", cookie(r.sessao));
    ctx.json(200, { ...extra, trocaApp: r.trocaApp });
  };

  const rotas: Rota[] = [
    rota("GET", "", async (ctx, q) => ctx.json(200, await d.servico.estado(q))),
    rota("POST", "/cadastro", async (ctx, q, b) => ctx.json(200, await d.servico.cadastrar(q, { email: b.email, senha: b.senha }))),
    rota("POST", "/codigo", async (ctx, q, b) => {
      if (!d.onboardingTexto) throw new ErroDeDominio("nao_encontrado", { cause: "NOD_ONBOARDING_TEXTO desligada" });
      ctx.json(200, await d.servico.pedirCodigo(q, { email: b.email }));
    }),
    rota("POST", "/reenviar", async (ctx, q) => ctx.json(200, await d.servico.reenviar(q))),
    rota("POST", "/verificar", async (ctx, q, b) => ctx.json(200, await d.servico.verificar(q, { codigo: b.codigo }))),
    rota("POST", "/entrar", async (ctx, q, b) => {
      const r = await d.servico.entrar(q, { email: b.email, senha: b.senha });
      if (r.resultado === "entrou") return comSessao(ctx, r, { resultado: "entrou" });
      ctx.json(200, r);
    }),
    rota("POST", "/importar", async (ctx, q) => {
      const r = await d.servico.importar(q);
      if (r.resultado === "importado") return comSessao(ctx, r, { resultado: "importado", contagem: r.contagem });
      ctx.json(200, r);
    }),
    rota("POST", "/outra", async (ctx, q) => ctx.json(200, await d.servico.fecharEscolha(q, "outra"))),
    rota("POST", "/cancelar", async (ctx, q) => ctx.json(200, await d.servico.fecharEscolha(q, "cancelada"))),
    rota("POST", "/recuperar", async (ctx, q, b) => ctx.json(200, await d.servico.recuperar(q, { email: b.email }))),
    rota("POST", "/redefinir", async (ctx, q, b) => {
      const r = await d.servico.redefinir(q, { token: b.token, senha: b.senha });
      if (r.resultado === "trocada") return comSessao(ctx, r, { resultado: "trocada" });
      ctx.json(200, r);
    }),
    rota("POST", "/senha", async (ctx, q, b) => ctx.json(200, await d.servico.trocarSenha(q, { atual: b.atual, nova: b.nova }))),
    rota("GET", "/sessoes", async (ctx, q) => ctx.json(200, await d.servico.sessoes(q))),
    rota("POST", "/sair-das-outras", async (ctx, q) => {
      if (!q.escopo || !q.sid) throw new ErroDeDominio("nao_permitido", { cause: "sem sessão" });
      ctx.json(200, { encerradas: await d.guarda.revogarOutras(q.escopo, q.sid) });
    }),
    rota("POST", "/parear", async (ctx, q) => ctx.json(200, await d.servico.gerarPareamento(q))),
    rota("GET", "/parear", async (ctx, q) => ctx.json(200, { pareamento: await d.servico.pareamentoAberto(q) })),
    rota("POST", "/parear/decidir", async (ctx, q, b) => ctx.json(200, await d.servico.decidirPareamento(q, { confirmar: b.confirmar }))),
    rota("POST", "/parear/pedir", async (ctx, q, b) => ctx.json(200, await d.servico.pedirPareamento(q, { codigo: b.codigo }))),
    rota("GET", "/parear/pedido", async (ctx, q) => {
      const r = await d.servico.esperarPareamento(q);
      if (r.estado === "entrou") return comSessao(ctx, r, { estado: "entrou" });
      ctx.json(200, r);
    }),
    // ADA-242: o app troca o código do loopback do Google com a prova. Só o processo principal (sem Origin).
    rota("POST", "/google/trocar", async (ctx, q, b) => {
      if (!d.onboardingTexto) throw new ErroDeDominio("nao_encontrado", { cause: "NOD_ONBOARDING_TEXTO desligada" });
      if (ctx.req.headers.origin !== undefined) throw new ErroDeDominio("nao_permitido", { cause: "troca do Google vinda de página" });
      const r = await d.servico.trocarGoogleApp(q, { codigo: b.codigo, prova: b.prova });
      if (!r) throw new ErroDeDominio("nao_permitido", { cause: "código do Google do app inválido" });
      ctx.json(200, r);
    }),
    // O app troca o código de uso único pela chave de máquina da pessoa nova. Só o app (sem Origin).
    rota("POST", "/troca-app", async (ctx, q, b) => {
      if (ctx.req.headers.origin !== undefined) throw new ErroDeDominio("nao_permitido", { cause: "troca do app vinda de página" });
      const r = await d.servico.trocarApp(q, { codigo: b.codigo, prova: b.prova });
      if (!r) throw new ErroDeDominio("nao_permitido", { cause: "código de troca inválido" });
      ctx.json(200, r);
    }),
    // O cartão pede o endereço do Google para conta: um bilhete assinado com a sessão de agora, que vai no state. O
    // bilhete só vale no navegador que tem ESTA sessão no cookie (ver contaNoGoogle.bilheteDoNavegador): um link com o
    // bilhete de outra pessoa não liga o Google de quem clica ao espaço dela. No app, o Google abre no navegador do
    // sistema, sem o cookie do app: por isso o Google para conta ainda não vale no app (só e-mail e senha).
    // ADA-242 (ADR-157 §3): com NOD_ONBOARDING_TEXTO, o app também usa o Google. O bilhete `conta-app` leva a porta e o
    // estado do loopback do processo principal e o desafio do segredo dele; a volta não liga nada até a troca com a prova.
    rota("POST", "/google", async (ctx, q, b) => {
      if (!d.google) throw new ErroDeDominio("estado_invalido", { cause: "Google para conta desligado" });
      if (b.app === true && !d.onboardingTexto) throw new ErroDeDominio("estado_invalido", { cause: "Google para conta ainda não vale no app" });
      if (!q.escopo || !q.sid) throw new ErroDeDominio("nao_permitido", { cause: "sem sessão" });
      if (b.app === true) {
        const porta = b.porta;
        const estado = b.estado;
        if (!q.desafioApp) throw new ErroDeDominio("nao_permitido", { cause: "Google do app sem desafio" });
        if (typeof porta !== "number" || !Number.isInteger(porta) || porta < 1024 || porta > 65535) throw new ErroDeDominio("entrada_invalida", { cause: "porta" });
        if (typeof estado !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(estado)) throw new ErroDeDominio("entrada_invalida", { cause: "estado" });
        const bilhete = cunharBilheteApp(d.segredo, { escopo: q.escopo, sid: q.sid, t: d.agora(), porta, estado, desafio: q.desafioApp });
        ctx.json(200, { url: `/api/sessao/google?conta-app=${encodeURIComponent(bilhete)}` });
        return;
      }
      const bilhete = cunharBilhete(d.segredo, { escopo: q.escopo, sid: q.sid, t: d.agora() });
      ctx.json(200, { url: `/api/sessao/google?conta=${encodeURIComponent(bilhete)}` });
    }),
  ];

  if (d.minhaConta) rotas.push(...rotasMinhaConta(d.minhaConta, rota));

  if (d.bootstrap) {
    rotas.push(
      rota("POST", "/provisorio", async (ctx, q, b) => {
        const forma = b.forma === "web" ? "web" : "app";
        // A web só ganha espaço provisório quando ainda não tem sessão (não troca a de alguém sem querer).
        if (forma === "web" && q.escopo) { ctx.json(200, { escopo: q.escopo, novo: false }); return; }
        if (forma === "app" && ctx.req.headers.origin !== undefined) throw new ErroDeDominio("nao_permitido", { cause: "chave de máquina pedida por página" });
        let r;
        try {
          r = await d.servico.provisorio(q, { verificador: b.verificador, nome: b.nome, forma, desafio: b.desafio, resposta: b.resposta });
        } catch (erro) {
          if (erro instanceof ErroDeDominio && erro.codigo === "limite_atingido" && erro.cause === "desafio_provisorio") {
            const desafio = d.servico.emitirDesafioProvisorio(q.ip);
            ctx.json(429, { codigo: "limite_atingido", mensagem: TABELA_ERROS.limite_atingido.mensagem, ...desafio });
            return;
          }
          throw erro;
        }
        if (r.sessao) ctx.res.setHeader("set-cookie", cookie(r.sessao));
        ctx.json(200, { escopo: r.escopo, novo: r.novo, ...(r.chave ? { chave: r.chave } : {}) });
      }),
    );
  }
  return rotas;
}

type FazRota = (metodo: Metodo, caminho: string, fn: (ctx: CtxPublico, q: Quem, corpo: Record<string, unknown>) => Promise<void>) => Rota;

/** NOD-346 (ADR-126): Minha conta. Mesmo Origin, no-store e leitura de sessão das rotas de conta. */
function rotasMinhaConta(s: ServicoMinhaConta, rota: FazRota): Rota[] {
  /** O erro de domínio com um motivo conhecido sai com `motivo`; o resto segue para o tratador geral. */
  const comMotivo = (fn: (ctx: CtxPublico, q: Quem, b: Record<string, unknown>) => Promise<void>) => async (ctx: CtxPublico, q: Quem, b: Record<string, unknown>) => {
    try {
      await fn(ctx, q, b);
    } catch (erro) {
      const causa = erro instanceof ErroDeDominio && typeof erro.cause === "string" ? erro.cause : null;
      if (!(erro instanceof ErroDeDominio) || !causa || !MOTIVOS_MINHA_CONTA.has(causa)) throw erro;
      const { status, mensagem } = TABELA_ERROS[erro.codigo];
      ctx.json(status, { codigo: erro.codigo, mensagem, motivo: causa === "sem conta" ? "sem_conta" : causa });
    }
  };
  const r = (metodo: Metodo, caminho: string, fn: (ctx: CtxPublico, q: Quem, b: Record<string, unknown>) => Promise<void>) => rota(metodo, `/eu${caminho}`, comMotivo(fn));
  return [
    r("GET", "", async (ctx, q) => ctx.json(200, await s.estado(q))),
    r("POST", "/perfil", async (ctx, q, b) => ctx.json(200, await s.salvarPerfil(q, { nome: b.nome, sobreMim: b.sobreMim }))),
    r("GET", "/foto", async (ctx, q) => {
      const f = await s.foto(q);
      if (!f) throw new ErroDeDominio("nao_encontrado", { cause: "sem foto" });
      ctx.res.writeHead(200, { "content-type": f.tipo, "content-length": String(f.bytes.byteLength), "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" });
      ctx.res.end(Buffer.from(f.bytes));
    }),
    r("POST", "/foto", async (ctx, q, b) => ctx.json(200, await s.definirFoto(q, { base64: b.base64 === undefined ? undefined : b.base64 }))),
    r("POST", "/reautenticar", async (ctx, q, b) => ctx.json(200, b.codigo !== undefined ? await s.reautenticarComCodigo(q, { codigo: b.codigo }) : await s.reautenticarComSenha(q, { senha: b.senha }))),
    r("POST", "/reautenticar/codigo", async (ctx, q) => ctx.json(200, await s.enviarCodigo(q))),
    r("POST", "/google/remover", async (ctx, q) => ctx.json(200, await s.removerGoogle(q))),
    r("POST", "/email", async (ctx, q, b) => ctx.json(200, await s.pedirTrocaEmail(q, { email: b.email }))),
    r("POST", "/email/cancelar", async (ctx, q) => ctx.json(200, await s.cancelarTrocaEmail(q))),
    r("POST", "/email/confirmar", async (ctx, q, b) => ctx.json(200, await s.confirmarTrocaEmail(q, { token: b.token }))),
    r("POST", "/exportacao", async (ctx, q) => ctx.json(200, await s.pedirExportacao(q))),
    r("GET", "/exportacao/([0-9a-fA-F-]{36})", async (ctx, q) => {
      const id = /\/exportacao\/([0-9a-fA-F-]{36})$/.exec((ctx.req.url ?? "").split("?")[0] ?? "")?.[1];
      const zip = await s.baixarExportacao(q, id);
      ctx.res.writeHead(200, { "content-type": "application/zip", "content-length": String(zip.byteLength), "content-disposition": 'attachment; filename="meus-dados-nod.zip"', "x-content-type-options": "nosniff" });
      ctx.res.end(Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength));
    }),
    r("POST", "/excluir", async (ctx, q) => ctx.json(200, await s.excluir(q))),
    r("POST", "/excluir/desfazer", async (ctx, q) => ctx.json(200, await s.desfazerExclusao(q))),
  ];
}

/** A caixa de e-mail do stub (só loopback): para testar o cadastro e a recuperação sem provedor. */
export function rotaCaixaDev(caixa: CaixaLocal): Rota {
  return {
    metodo: "GET",
    padrao: /^\/dev\/caixa$/,
    publica: true,
    async handler(ctx) {
      const s = ctx.req.socket?.remoteAddress ?? "";
      if (!(s === "127.0.0.1" || s === "::1" || s === "::ffff:127.0.0.1") || ctx.req.headers["x-forwarded-for"] !== undefined) throw new ErroDeDominio("nao_encontrado", { cause: "caixa só em loopback" });
      ctx.res.setHeader("cache-control", "no-store");
      ctx.json(200, { mensagens: [...caixa.mensagens].reverse().map((m) => ({ para: m.para, assunto: m.assunto, texto: m.texto, em: m.em })) });
    },
  };
}

// ------------------------------------------------------------------------------------------- bilhete do Google

type Bilhete = { escopo: Escopo; sid: string; t: number };

export function cunharBilhete(segredo: string, b: Bilhete): string {
  const payload = Buffer.from(JSON.stringify({ k: "conta", tn: b.escopo.tenantId, p: b.escopo.pessoaId, s: b.sid, t: b.t }), "utf8").toString("base64url");
  return `${payload}.${assinar(payload, segredo)}`;
}

export function lerBilhete(segredo: string, valor: string, agora: number): Bilhete | null {
  const payload = lerAssinado(valor, segredo);
  if (!payload) return null;
  try {
    const o = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (o.k !== "conta" || typeof o.tn !== "string" || typeof o.p !== "string" || typeof o.s !== "string" || typeof o.t !== "number") return null;
    if (agora - o.t < 0 || agora - o.t > BILHETE_MS) return null;
    return { escopo: { tenantId: o.tn, pessoaId: o.p }, sid: o.s, t: o.t };
  } catch {
    return null;
  }
}

/** ADA-242: o bilhete do Google pedido pelo app. Outro `k`: um não passa pelo outro. */
type BilheteApp = Bilhete & { porta: number; estado: string; desafio: string };

export function cunharBilheteApp(segredo: string, b: BilheteApp): string {
  const payload = Buffer.from(JSON.stringify({ k: "conta-app", tn: b.escopo.tenantId, p: b.escopo.pessoaId, s: b.sid, t: b.t, po: b.porta, e: b.estado, d: b.desafio }), "utf8").toString("base64url");
  return `${payload}.${assinar(payload, segredo)}`;
}

export function lerBilheteApp(segredo: string, valor: string, agora: number): BilheteApp | null {
  const payload = lerAssinado(valor, segredo);
  if (!payload) return null;
  try {
    const o = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (o.k !== "conta-app" || typeof o.tn !== "string" || typeof o.p !== "string" || typeof o.s !== "string" || typeof o.t !== "number") return null;
    if (typeof o.po !== "number" || !Number.isInteger(o.po) || o.po < 1024 || o.po > 65535) return null;
    if (typeof o.e !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(o.e) || typeof o.d !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(o.d)) return null;
    if (agora - o.t < 0 || agora - o.t > BILHETE_MS) return null;
    return { escopo: { tenantId: o.tn, pessoaId: o.p }, sid: o.s, t: o.t, porta: o.po, estado: o.e, desafio: o.d };
  } catch {
    return null;
  }
}

/** O lado de sessao-google.ts da conta: confere o bilhete, chama o serviço e diz para onde a página vai. */
export function contaNoGoogle(d: Pick<DepsRotasConta, "servico" | "guarda" | "segredo" | "seguro" | "agora" | "onboardingTexto">) {
  const cookieDe = (s: SessaoNova) => cabecalhoCookieSessao(s.escopo, d.segredo, d.seguro, PERMANENCIA_SESSAO_S, s.sid);
  return {
    /**
     * O bilhete vale só no navegador cuja sessão (cookie, SameSite=Strict) é a do bilhete. Na ida (navegação a partir da
     * própria página do nod) o cookie vai; num link vindo de fora, não. O state amarra a volta a este navegador.
     */
    bilheteDoNavegador: (bilhete: string, req: IncomingMessage): boolean => {
      const b = lerBilhete(d.segredo, bilhete, d.agora());
      const lido = lerSessaoDoCookie(lerCookies(req)[COOKIE_SESSAO], d.segredo);
      return !!b && !!lido && lido.sid === b.sid && lido.escopo.tenantId === b.escopo.tenantId && lido.escopo.pessoaId === b.escopo.pessoaId;
    },
    async aoVoltar(bilhete: string, g: { iss: string; sub: string; email: string; autoridade: boolean }, req: IncomingMessage): Promise<{ setCookie: string | null; pagina: string }> {
      const b = lerBilhete(d.segredo, bilhete, d.agora());
      const viva = b && (await d.guarda.conferir(b.escopo, b.sid)) ? b : null;
      const q: Quem = { escopo: viva?.escopo ?? null, sid: viva?.sid ?? null, ip: ipDe(req), aparelho: rotuloDoAparelho(req.headers["user-agent"]) };
      const r = await d.servico.voltaGoogle(q, g);
      if (r.resultado === "entrou") return { setCookie: cookieDe(r.sessao), pagina: paginaIndoPara("/?conta=entrou") };
      return { setCookie: null, pagina: paginaIndoPara(`/?conta=${r.resultado}`) };
    },
    bilheteApp: (bilhete: string): boolean => d.onboardingTexto === true && lerBilheteApp(d.segredo, bilhete, d.agora()) !== null,
    /**
     * A volta do bilhete do app: a sessão ainda vive? Guarda a identidade num código de uso único e manda o navegador ao
     * loopback do app (127.0.0.1, a porta e o estado do bilhete). Sessão morta: o loopback recebe `erro=sessao`.
     */
    async aoVoltarApp(bilhete: string, g: { iss: string; sub: string; email: string; autoridade: boolean }): Promise<string | null> {
      const b = d.onboardingTexto ? lerBilheteApp(d.segredo, bilhete, d.agora()) : null;
      if (!b) return null;
      const destino = new URL(`http://127.0.0.1:${b.porta}/retorno`);
      destino.searchParams.set("estado", b.estado);
      if (!(await d.guarda.conferir(b.escopo, b.sid))) destino.searchParams.set("erro", "sessao");
      else destino.searchParams.set("codigo", await d.servico.guardarGoogleApp({ escopo: b.escopo, sid: b.sid, desafio: b.desafio }, g));
      return destino.toString();
    },
    /** Sem bilhete: entra só se este Google já está ligado a uma conta; null = segue o login de antes. */
    async entrarSemBilhete(g: { iss: string; sub: string }, req: IncomingMessage): Promise<{ setCookie: string; pagina: string } | null> {
      const r = await d.servico.entrarPorGoogle({ escopo: null, sid: null, ip: ipDe(req), aparelho: rotuloDoAparelho(req.headers["user-agent"]) }, g);
      return r ? { setCookie: cookieDe(r.sessao), pagina: paginaIndoPara("/?conta=entrou") } : null;
    },
  };
}
