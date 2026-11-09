import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { CHAMADAS_POR_MINUTO, CORPO_MAX_WEBHOOK } from "../../../domain/rotina-webhook.ts";
import { redigirSegredos } from "../../../domain/segredos.ts";
import { log } from "../../../obs/log.ts";
import { hashDoToken, tokenAlegado } from "../../../services/token-gatilho.ts";
import { gerarEnderecoWebhook, testarWebhook, verEnderecoWebhook } from "../../../use-cases/endereco-webhook.ts";
import { receberWebhook } from "../../../use-cases/receber-webhook.ts";
import type { RespostaMutacao } from "../../../contracts/api.ts";
import { envolverNaoConfiavel } from "../../mcp-proxy/moldura.ts";
import type { CtxPublico, Rota } from "../roteador.ts";
import { lerBruto } from "../util.ts";
import { ipDe } from "./conta.ts";
import { executar, uuid, type DepsRotasL7 } from "./rotinas.ts";

/**
 * A rota pública do gatilho por webhook (NOD-84, ADR-139): `POST /api/w/<token>`, ou `POST /api/w` com
 * `Authorization: Bearer <token>`. Só no modo compartilhado (compor.ts). O token é o endereço secreto: nunca vai ao log
 * (erros.ts mascara `/w/<token>`), e o bot nunca o vê.
 *
 * O que não precisa do banco fica aqui, antes da transação: navegador (Origin) → 403; limites em memória → 429; token
 * malformado → 401; corpo acima de 256 KB → 413. O resto é do caso de uso, na transação do escopo que o token alega.
 */
export type DepsWebhook = DepsRotasL7 & { cifrar(texto: string): string; decifrar(cifrado: string): string };

/** O payload que entra no turno: os primeiros 16 KB, emoldurados como dado de fora. */
export const PAYLOAD_NO_TURNO = 16 * 1024;
/** A redação roda numa janela de 16 KB + 2 KB (revisão 5): um segredo que cruza o corte de 16 KB ainda inteiro na janela. */
const MARGEM_DA_REDACAO = 2 * 1024;
const MINUTO = 60_000;
/**
 * Os tetos por minuto, em memória, por processo (ADR-139 §4; revisões 3, 4 e 5 da NOD-84):
 * - por IP: o token malformado (lixo, varredura) tem o teto baixo; o bem formado, um alto, porque o GitHub e o Stripe
 *   saem de poucos IPs divididos entre todos os tenants;
 * - por token (pela parte secreta): alto, porque um webhook de organização do GitHub manda rajadas de eventos que a
 *   rotina ignora; o teto firme de cada rotina é o de 3 pendentes, no banco;
 * - por dona: só as chamadas CARAS provadas (rodou, bloqueada) — uma dona com muitas rotinas não esgota a válvula dos outros;
 * - global: a válvula do processo, bem acima do da dona, também só das caras provadas;
 * O teto por IP bem formado vale só para o token ainda não provado (pelo token inteiro, não só o segredo): duas rotinas
 *   movimentadas de um tenant pelo IP do GitHub não fecham esse IP para os outros tenants (revisão 6).
 * Sem freio de "forjados" (revisões 5 a 8): a dona que o token alega vem do próprio token, sem prova. O token
 * desconhecido custa um SELECT sem trava; o que segura muitos IPs forjando é o teto por IP.
 * RISCO ASSUMIDO (revisão 9): quem forja ~600/min pelo IP do provedor (criando webhooks próprios no GitHub) fecha esse
 * IP para todo token ainda NÃO provado neste processo — o endereço novo, o primeiro ping, todos logo depois de um deploy.
 * Sem o banco, token não provado e forjado são indistinguíveis; o gatilho de reversão (ADR-139) leva os limites para lá.
 */
export const POR_IP = CHAMADAS_POR_MINUTO * 2;
export const POR_IP_BEM_FORMADO = CHAMADAS_POR_MINUTO * 10;
export const POR_TOKEN = CHAMADAS_POR_MINUTO * 5;
export const POR_DONA = CHAMADAS_POR_MINUTO * 5;
export const GLOBAL = CHAMADAS_POR_MINUTO * 100;
/** Teto de chaves em memória (IPs + tokens + donas; e, à parte, tokens provados): passou, a mais velha sai. */
export const LIMITE_DE_CHAVES = 20_000;

type Janela = { inicio: number; n: number };

/**
 * Contagem por janela fixa de 1 minuto. Ordem: o IP primeiro (o estourado volta sem tocar no resto); o token; a dona e o
 * global só se CONSULTAM aqui — quem os conta é `provada`, depois que o banco provou o token, então forjar tokens de
 * quantos IPs for não os move. `recusada` tira o token dos provados (endereço revogado, assinatura errada).
 */
export function criarLimites(agora: () => number) {
  const porChave = new Map<string, Janela>();
  const provados = new Set<string>();
  let global: Janela = { inicio: 0, n: 0 };
  let virada = 0;
  const conta = (j: Janela | undefined, t: number): Janela => (j && t - j.inicio < MINUTO ? { inicio: j.inicio, n: j.n + 1 } : { inicio: t, n: 1 });
  const cheio = (j: Janela | undefined, t: number, teto: number): boolean => j !== undefined && t - j.inicio < MINUTO && j.n >= teto;
  /** Abre lugar para mais uma chave: no teto, a mais velha sai (IPs e tokens sem fim não fazem o processo crescer). */
  const abrirLugar = (m: Map<string, Janela> | Set<string>) => {
    if (m.size < LIMITE_DE_CHAVES) return;
    const velha = m.keys().next();
    if (!velha.done) m.delete(velha.value);
  };
  const contar = (chave: string, t: number): number => {
    const j = conta(porChave.get(chave), t);
    porChave.delete(chave);
    abrirLugar(porChave);
    porChave.set(chave, j);
    return j.n;
  };
  const chaveDoToken = (token: string) => `tk:${hashDoToken(token.slice(token.lastIndexOf(".") + 1)).toString("base64url").slice(0, 22)}`;
  /** O provado é o token INTEIRO (revisão 8): o mesmo segredo com outra dona alegada não herda o passe. */
  const chaveDoProvado = (token: string) => hashDoToken(token).toString("base64url").slice(0, 22);
  return {
    /** true = passou; false = estourou. `token` null = malformado (só conta no IP). `dona` = o escopo que o token alega. */
    passa(ip: string, token: string | null, dona = ""): boolean {
      const t = agora();
      if (t - virada >= MINUTO) {
        for (const [k, j] of porChave) if (t - j.inicio >= MINUTO) porChave.delete(k);
        virada = t;
      }
      if (token === null) return contar(`ip:${ip}`, t) <= POR_IP;
      const tk = chaveDoToken(token);
      if (!provados.has(chaveDoProvado(token)) && contar(`ipt:${ip}`, t) > POR_IP_BEM_FORMADO) return false;
      if (contar(tk, t) > POR_TOKEN) return false;
      return !cheio(porChave.get(`dn:${dona}`), t, POR_DONA) && !cheio(global, t, GLOBAL);
    },
    /** O banco provou o token: ele entra nos conhecidos; e, se a chamada foi cara (disparou ou bloqueou), conta na dona e no global. */
    provada(token: string, dona: string, cara: boolean): void {
      const pv = chaveDoProvado(token);
      provados.delete(pv);
      abrirLugar(provados);
      provados.add(pv);
      if (!cara) return;
      const t = agora();
      contar(`dn:${dona}`, t);
      global = conta(global, t);
    },
    /** O banco recusou (401: token desconhecido, revogado ou assinatura errada): o token perde o passe livre. */
    recusada(token: string): void {
      provados.delete(chaveDoProvado(token));
    },
    tamanho: (): number => porChave.size,
  };
}

function cabecalhoTexto(req: IncomingMessage, nome: string): string {
  const v = req.headers[nome];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** O corpo como o provedor mandou: JSON, ou o form `payload=<json>` que o GitHub usa quando o tipo é form. */
export function interpretarCorpo(contentType: string, cru: Buffer): { corpo: unknown; texto: string } {
  const texto = cru.toString("utf8");
  if (/application\/x-www-form-urlencoded/i.test(contentType)) {
    const payload = new URLSearchParams(texto).get("payload");
    if (payload !== null) {
      try {
        return { corpo: JSON.parse(payload) as unknown, texto: payload };
      } catch {
        return { corpo: null, texto: payload };
      }
    }
    return { corpo: null, texto };
  }
  try {
    return { corpo: texto.trim() === "" ? null : (JSON.parse(texto) as unknown), texto };
  } catch {
    return { corpo: null, texto };
  }
}

/**
 * O payload para o turno: redigido, cortado em 16 KB (sem partir um caractere) e emoldurado. A redação vem antes do
 * corte (contrato de segredos.ts) e pega o próprio endereço gt_ e o segredo ghs_ que um provedor ecoa (o evento `meta`
 * do GitHub traz `hook.config.url`): o bot nunca vê o endereço (ADR-139).
 */
export function entradaDoPayload(bruto: string, token?: string): string {
  // O segredo da própria chamada sai literalmente também: a regex não pega um eco que o provedor partiu ou codificou.
  const segredo = token ? token.slice(token.lastIndexOf(".") + 1) : "";
  // Só a janela que pode entrar no turno passa pela redação (revisão 5): 256 KB adversariais custavam ~250 ms de CPU.
  const grande = Buffer.byteLength(bruto, "utf8") > PAYLOAD_NO_TURNO + MARGEM_DA_REDACAO;
  const janela = grande ? Buffer.from(bruto, "utf8").subarray(0, PAYLOAD_NO_TURNO + MARGEM_DA_REDACAO).toString("utf8").replace(/\uFFFD$/, "") : bruto;
  const texto = redigirSegredos(segredo.length >= 16 ? janela.split(segredo).join("[segredo removido]") : janela);
  const cortado = grande || Buffer.byteLength(texto, "utf8") > PAYLOAD_NO_TURNO ? `${Buffer.from(texto, "utf8").subarray(0, PAYLOAD_NO_TURNO).toString("utf8").replace(/�$/, "")}\n[… payload cortado em 16 KB]` : texto;
  return envolverNaoConfiavel(cortado === "" ? "(corpo vazio)" : cortado, "webhook", true);
}

export function criarRotasWebhook(deps: DepsWebhook): Rota[] {
  const limites = criarLimites(deps.agora);
  const machineId = randomUUID();

  async function tratar(ctx: CtxPublico, token: string): Promise<void> {
    if (ctx.req.headers.origin !== undefined) return ctx.json(403, { codigo: "nao_permitido" });
    const alegado = tokenAlegado(token);
    const dona = alegado ? `${alegado.escopo.tenantId}:${alegado.escopo.pessoaId}` : "";
    if (!limites.passa(ipDe(ctx.req), alegado ? token : null, dona)) {
      ctx.res.setHeader("retry-after", "60");
      return ctx.json(429, { codigo: "limite" });
    }
    if (!alegado) return ctx.json(401, { codigo: "nao_permitido" });
    let cru: Buffer;
    try {
      cru = await lerBruto(ctx.req, CORPO_MAX_WEBHOOK);
    } catch (e) {
      if (e instanceof RangeError) return ctx.json(413, { codigo: "corpo_grande" });
      throw e;
    }
    const { corpo, texto } = interpretarCorpo(cabecalhoTexto(ctx.req, "content-type"), cru);
    const r = await executar(deps, alegado.escopo, receberWebhook, {
      rotinaId: alegado.rotinaId,
      hash: hashDoToken(token),
      cabecalhos: ctx.req.headers,
      corpoCru: cru,
      corpo,
      emoldurar: () => entradaDoPayload(texto, token),
      decifrar: deps.decifrar,
      executor: deps.executor?.() ?? "catcher",
      machineId,
    });
    if (r.status === 401) limites.recusada(token);
    else limites.provada(token, dona, r.codigo === "aceita" || r.codigo === "rotina_bloqueada");
    log("info", "webhook_recebido", { status: r.status, codigo: r.codigo });
    if (r.retryAfter) ctx.res.setHeader("retry-after", String(r.retryAfter));
    ctx.json(r.status, { codigo: r.codigo });
  }

  return [
    {
      // Só a dona: o endereço inteiro e o segredo do GitHub, para o Copiar. no-store: não fica em cache nenhum.
      metodo: "GET",
      padrao: /^\/rotinas\/(?<id>[^/]+)\/endereco$/,
      async handler(ctx) {
        const r = await executar(deps, ctx.escopo, verEnderecoWebhook, { rotinaId: uuid(ctx.params.id, "id"), decifrar: deps.decifrar });
        ctx.res.setHeader("cache-control", "no-store");
        ctx.json(200, r);
      },
    },
    {
      // "Gerar novo endereço": o anterior para de valer na hora. Devolve só o prefixo (a tela busca o inteiro no Copiar).
      metodo: "POST", acao: "rotinas.gerar_endereco",
      padrao: /^\/rotinas\/(?<id>[^/]+)\/endereco$/,
      async handler(ctx) {
        const r = await executar(deps, ctx.escopo, gerarEnderecoWebhook, { rotinaId: uuid(ctx.params.id, "id"), cifrar: deps.cifrar });
        const resposta: RespostaMutacao = { ok: true, ids: { rotinaId: ctx.params.id ?? "", prefixo: r.prefixo } };
        ctx.json(200, resposta);
      },
    },
    {
      metodo: "POST", acao: "rotinas.enviar_teste",
      padrao: /^\/rotinas\/(?<id>[^/]+)\/testar-webhook$/,
      async handler(ctx) {
        const r = await executar(deps, ctx.escopo, testarWebhook, { rotinaId: uuid(ctx.params.id, "id"), executor: deps.executor?.() ?? "catcher", machineId, emoldurar: entradaDoPayload });
        const resposta: RespostaMutacao = { ok: true, ids: { conversaId: r.conversaId, ...(r.turnoId ? { turnoId: r.turnoId } : {}), ...(r.bloqueada ? { bloqueada: "sim" } : {}) } };
        ctx.json(200, resposta);
      },
    },
    { metodo: "POST", padrao: /^\/w\/(?<token>[^/]+)$/, publica: true, handler: (ctx) => tratar(ctx, ctx.params.token ?? "") },
    {
      metodo: "POST",
      padrao: /^\/w$/,
      publica: true,
      handler: (ctx) => {
        const auth = cabecalhoTexto(ctx.req, "authorization");
        return tratar(ctx, auth.startsWith("Bearer ") ? auth.slice(7).trim() : "");
      },
    },
  ];
}
