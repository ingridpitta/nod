import { ErroDeDominio } from "./erro.ts";

/**
 * Gatilho por webhook (NOD-84, ADR-139). Puro: regras do que entra pela chamada, sem rede nem banco.
 *
 * A rotina webhook mora em `rotinas` como as de horário; `gatilho` decide. Ela guarda um cron sentinela e a próxima
 * execução em 9999-01-01 para os mais de 30 leitores de `rotina.cron` não precisarem tratar null, e o agendador, a agenda
 * e a nuvem filtram `gatilho = 'horario'`. Nenhum texto mostra o cron de uma rotina webhook: quem escreve o "quando"
 * pergunta `ehWebhook` antes (quandoDaRotina).
 */
export type GatilhoRotina = "horario" | "webhook";

export const CRON_SENTINELA_WEBHOOK = "0 0 31 2 *";
/** Por que 31/02: nunca vence. Se algo tentar agendar uma rotina webhook pelo cron, `proximaJanela` falha alto. */
/** 9999-01-01T00:00:00Z: nunca vence, e o índice de ativas continua valendo. */
export const PROXIMA_WEBHOOK = Date.UTC(9999, 0, 1);

/** definido em 2026-10-30 (spec da NOD-84): 3 pendentes, 50 chamadas no log, corpo até 256 KB. */
export const PENDENTES_MAX = 3;
export const CHAMADAS_NO_LOG = 50;
export const CORPO_MAX_WEBHOOK = 256 * 1024;
export const RETRY_AFTER_S = 60;
/** Teto por token na rota pública, em memória: 60 chamadas por minuto. */
export const CHAMADAS_POR_MINUTO = 60;

export const DESFECHOS_CHAMADA = ["rodou", "ignorada", "fila_cheia", "recusada", "pausada", "bloqueada", "teste"] as const;
export type DesfechoChamada = (typeof DESFECHOS_CHAMADA)[number];
export const MOTIVOS_RECUSA = ["endereco", "assinatura"] as const;
export type MotivoRecusa = (typeof MOTIVOS_RECUSA)[number];

export type GatilhoWebhook = { provedor: string; eventos: string[] };

const EVENTO = /^[a-z0-9_*:-]+(\.[a-z0-9_*:-]+)*$/;

/** Valida e normaliza o que o bot propôs: provedor de 1 a 40 caracteres, até 20 eventos em minúsculas, sem repetir. */
export function normalizarGatilhoWebhook(entrada: { provedor?: unknown; eventos?: unknown }): GatilhoWebhook {
  const provedor = typeof entrada.provedor === "string" ? entrada.provedor.trim().replace(/\s+/g, " ") : "";
  if (provedor.length < 1 || provedor.length > 40) throw new ErroDeDominio("entrada_invalida", { cause: "provedor do webhook" });
  const crus = entrada.eventos === undefined ? [] : entrada.eventos;
  if (!Array.isArray(crus) || crus.length > 20) throw new ErroDeDominio("entrada_invalida", { cause: "eventos do webhook" });
  const eventos: string[] = [];
  for (const e of crus) {
    const ev = typeof e === "string" ? e.trim().toLowerCase() : "";
    if (ev.length < 1 || ev.length > 120 || !EVENTO.test(ev)) throw new ErroDeDominio("entrada_invalida", { cause: "evento do webhook" });
    if (!eventos.includes(ev)) eventos.push(ev);
  }
  return { provedor, eventos };
}

type Cabecalhos = Record<string, string | string[] | undefined>;

function cabecalho(h: Cabecalhos, nome: string): string | null {
  const v = h[nome.toLowerCase()];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() !== "" ? s.trim() : null;
}

function campo(corpo: unknown, nome: string): string | null {
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return null;
  const v = (corpo as Record<string, unknown>)[nome];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * O evento da chamada, em minúsculas: GitHub (`X-GitHub-Event` + `.action` do corpo, "pull_request.opened"), Stripe
 * (`type` do corpo, "payment_intent.succeeded") ou genérico (`X-Nod-Evento`). Null = a chamada não diz.
 */
export function eventoDaChamada(h: Cabecalhos, corpo: unknown): string | null {
  const gh = cabecalho(h, "x-github-event");
  let ev: string | null = null;
  if (gh) {
    const acao = campo(corpo, "action");
    ev = acao ? `${gh}.${acao}` : gh;
  } else {
    ev = cabecalho(h, "x-nod-evento") ?? campo(corpo, "type") ?? campo(corpo, "event");
  }
  if (!ev) return null;
  const limpo = ev.toLowerCase().slice(0, 120);
  return EVENTO.test(limpo) ? limpo : null;
}

/**
 * Filtro por evento. Sem filtro, tudo passa. `pull_request` aceita `pull_request` e `pull_request.opened`; `*` no fim
 * de um segmento aceita qualquer coisa a partir dali. Chamada sem evento só passa quando não há filtro.
 */
export function eventoPassa(eventos: readonly string[] | null, evento: string | null): boolean {
  if (!eventos || eventos.length === 0) return true;
  return filtroQueCasou(eventos, evento) !== null;
}

/**
 * O filtro que a DONA confirmou e que casou com a chamada; null sem filtro ou sem casar. É o único texto sobre o evento
 * que entra na linha cinza (confiável) e no cabeçalho do turno: o nome que vem da chamada é de fora (revisão da NOD-84).
 */
export function filtroQueCasou(eventos: readonly string[] | null, evento: string | null): string | null {
  if (!eventos || !evento) return null;
  return eventos.find((f) => (f.endsWith("*") ? evento.startsWith(f.slice(0, -1)) : evento === f || evento.startsWith(`${f}.`))) ?? null;
}

/**
 * O GitHub sempre assina (o segredo vem no Copiar segredo): sem a assinatura, a chamada é recusada. O provedor é texto
 * livre que o bot escreveu ("GitHub", "GitHub Actions", "gh"): qualquer um que cite o GitHub exige — suposição da
 * revisão da NOD-84; errar para o lado de exigir só faz a dona colar o segredo, errar para o outro abre o endereço.
 */
export function exigeAssinatura(provedor: string | null | undefined): boolean {
  const p = (provedor ?? "").trim().toLowerCase();
  return p === "gh" || p.replace(/[^a-z]/g, "").includes("github");
}

/** O id de entrega para o dedupe: X-GitHub-Delivery, Idempotency-Key, ou o `id` evt_ do Stripe. Null = sem dedupe. */
export function entregaDaChamada(h: Cabecalhos, corpo: unknown): string | null {
  const id = cabecalho(h, "x-github-delivery") ?? cabecalho(h, "idempotency-key") ?? cabecalho(h, "x-nod-entrega");
  const stripe = campo(corpo, "id");
  const escolhido = id ?? (stripe && stripe.startsWith("evt_") ? stripe : null);
  return escolhido ? escolhido.slice(0, 200) : null;
}

/** O endereço como a tela e o bot o veem. O inteiro só sai pelo Copiar (GET /rotinas/:id/endereco, só a dona). */
export function enderecoMascarado(prefixo: string): string {
  return `…/w/gt_${prefixo}_••••`;
}

/** "a cada pagamento aprovado no Stripe, na hora" no card; com eventos, cita os eventos. */
export function quandoWebhook(g: GatilhoWebhook): string {
  const quais = g.eventos.length === 0 ? "chamada" : g.eventos.join(", ");
  return `a cada ${quais} no ${g.provedor}, na hora`;
}

/** O resumo da lista de Rotinas: "Quando o Stripe avisa". */
export function resumoWebhook(provedor: string): string {
  return `Quando o ${provedor} avisa`;
}

/**
 * Recusa pendente: a recusada mais nova é posterior à aceita mais nova (o "!" da lista some quando chega uma aceita do
 * provedor). O "Enviar teste" não conta como aceita: é a dona quem testa, e o provedor pode continuar errando.
 */
export function recusaPendente(chamadas: readonly { desfecho: DesfechoChamada; em: number }[]): boolean {
  let recusa = -Infinity;
  let aceita = -Infinity;
  for (const c of chamadas) {
    if (c.desfecho === "recusada") recusa = Math.max(recusa, c.em);
    else if (c.desfecho !== "teste") aceita = Math.max(aceita, c.em);
  }
  return recusa > aceita;
}
