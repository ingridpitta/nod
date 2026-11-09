import { fileURLToPath } from "node:url";
import { paraCadaPessoa } from "../src/adapters/fundo/escopos-de-fundo.ts";
import type { Autoria } from "../src/contracts/evento.ts";
import type { KindMensagem, PayloadMensagem } from "../src/contracts/mensagem.ts";
import { criarDb } from "../src/db/client.ts";
import { assuntoDaLinhaAntiga } from "../src/domain/assunto-do-texto.ts";
import { destinoDe } from "../src/domain/destino-no-chat.ts";
import { log } from "../src/obs/log.ts";
import type { Escopo, Tx } from "../src/shared/types.ts";

/**
 * definido em 2026-10-18 (plano do chat limpo, "Como medir"; PR 1): a régua das metas da fase — falas ≥ 90% dos itens
 * visíveis numa conversa típica (mediana das conversas próprias com 20+ itens). Só leitura (transação read-only) e só
 * contagens: o texto de mensagem é lido para reconhecer o assunto das linhas sem backfill e nunca sai do processo.
 *
 *   node scripts/medir-chat-limpo.ts              # últimos 30 dias
 *   node scripts/medir-chat-limpo.ts --dias=7
 *
 * Duas colunas, sobre as mesmas mensagens: "hoje" (o que o chat mostra com as regras de agora) e "com a tabela" (o que
 * ele mostra com a tabela DESTINO do PR 2). Repetir depois de cada PR da fase.
 *
 * O que a medição NÃO reproduz do estado vivo da tela (vai no cabeçalho da saída):
 *  - fala de turno com trabalho (task ou frente) conta como escondida nas duas colunas (a web mostra só a última, com a
 *    etiqueta, e só enquanto conhece o trabalho);
 *  - execução de rotina sem nada para a pessoa (`rotina.execucao`) conta como escondida nas duas (já fica escondida hoje);
 *  - os quatro avisos de destino temporal (limite do plano, troca de IA, computador fora, IA ausente) contam como
 *    visíveis mesmo depois de deixarem de valer (a web os esconde pelo estado de agora);
 *  - agrupamentos da tela não entram: cada recibo conta um item, e o "N avisos do sistema · ver" não é desfeito. Desde
 *    o PR 4 o recibo é o cartão encolhido, no lugar do pedido e não no fim: continua um item (o cartão aberto, que ele
 *    substitui, não é mensagem e nunca contou). A proposta decidida com payload (`proposta.resultado`) passa a contar na
 *    coluna "com a tabela"; a de antes (`proposta.decidida`) continua na Atividade.
 *
 * revisto em 2026-10-18 (PR 3, a troca agrupada): na coluna "com a tabela", as mensagens entre bots seguidas (pedido,
 * resposta, `handoff`, `peer_ask`, "Respondi ao pedido" e as falas do turno de delegação), sem item à vista no meio e sem
 * pausa de 30 min, contam UM item, como a linha "Conversou com …" da tela. A coluna "hoje" conta como antes.
 */

type LinhaMedida = { conversa_id: string; kind: KindMensagem; payload: PayloadMensagem | null; texto: string; decidido_por: Autoria["decidido_por"]; assunto: string | null; de_trabalho: boolean; de_delegacao?: boolean; primeira: boolean; em?: number };

/** Os assuntos da conversa entre bots que a tela junta numa troca (PR 3). */
const ASSUNTOS_DA_TROCA = new Set(["colega.handoff", "colega.pedido", "colega.resposta", "pedido.respondido"]);
/** A pausa que separa duas trocas na tela (web/telas/divisores-de-data.ts, PAUSA_QUE_ABRE_BLOCO_MS, a mesma do divisor de data). */
const PAUSA_TROCA_MS = 30 * 60_000;

export type Medida = { itensHoje: number; falasHoje: number; itensTabela: number; falasTabela: number };

/** O que uma mensagem conta em cada coluna. */
export function medirMensagem(l: Pick<LinhaMedida, "kind" | "payload" | "texto" | "decidido_por" | "assunto" | "de_trabalho" | "primeira" | "de_delegacao">): { assunto: string | null; hoje: boolean; tabela: boolean; fala: boolean; troca: boolean } {
  const assunto = l.assunto ?? assuntoDaLinhaAntiga({ kind: l.kind, payload: l.payload, texto: l.texto, decididoPor: l.decidido_por, tipoConversa: "propria", primeiraDaConversa: l.primeira }).assunto;
  const fala = l.kind === "texto" && assunto === null;
  const escondidaHoje = (fala && l.de_trabalho) || assunto === "rotina.execucao";
  const troca = (assunto !== null && ASSUNTOS_DA_TROCA.has(assunto)) || (fala && l.de_delegacao === true && !l.de_trabalho);
  return { assunto, fala, hoje: !escondidaHoje, tabela: !escondidaHoje && destinoDe(assunto) === "chat", troca };
}

export function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[meio]! : (v[meio - 1]! + v[meio]!) / 2;
}

/** As conversas próprias da pessoa do escopo, nos últimos `dias`: a medida de cada uma e a contagem por assunto. */
export async function medirDaPessoa(trx: Tx, escopo: Escopo, dias: number, porAssunto: Map<string, number>): Promise<Map<string, Medida>> {
  const linhas = await trx<LinhaMedida[]>`
    select m.conversa_id, m.kind, m.payload, m.texto, m.decidido_por, m.assunto,
      coalesce(t.trabalho_id, o.trabalho_id) is not null as de_trabalho, coalesce(t.origem::text = 'delegacao', false) as de_delegacao,
      (extract(epoch from m.criado_em) * 1000)::float8 as em,
      (m.kind = 'sistema' and m.payload is null and not exists (
        select 1 from mensagens p where p.tenant_id = m.tenant_id and p.conversa_id = m.conversa_id
          and (p.criado_em < m.criado_em or (p.criado_em = m.criado_em and p.id < m.id)))) as primeira
    from mensagens m
    join conversas c on c.tenant_id = m.tenant_id and c.id = m.conversa_id and c.tipo = 'propria'
    left join turnos t on t.tenant_id = m.tenant_id and t.id = m.turno_id
    left join lateral (
      select x.trabalho_id from turnos x where x.tenant_id = m.tenant_id and x.mensagem_origem_id = m.id and m.turno_id is null
      order by x.criado_em limit 1
    ) o on true
    where m.tenant_id = ${escopo.tenantId} and m.owner_id = ${escopo.pessoaId} and m.criado_em >= now() - make_interval(days => ${dias})
    order by m.conversa_id, m.criado_em, m.id`;
  return medirLinhas(linhas, porAssunto);
}

/**
 * As medidas por conversa, sobre as linhas em ordem de tempo dentro de cada conversa. Na coluna "com a tabela", uma
 * sequência de mensagens entre bots conta um item (PR 3): a troca começa na primeira e acaba no próximo item à vista ou
 * numa pausa de 30 min.
 */
export function medirLinhas(linhas: readonly LinhaMedida[], porAssunto: Map<string, number>): Map<string, Medida> {
  const porConversa = new Map<string, Medida>();
  const ultimaDaTroca = new Map<string, number | null>();
  for (const l of linhas) {
    const r = medirMensagem(l);
    porAssunto.set(r.assunto ?? "(fala)", (porAssunto.get(r.assunto ?? "(fala)") ?? 0) + 1);
    const m = porConversa.get(l.conversa_id) ?? { itensHoje: 0, falasHoje: 0, itensTabela: 0, falasTabela: 0 };
    if (r.hoje) {
      m.itensHoje += 1;
      if (r.fala) m.falasHoje += 1;
    }
    const ultima = ultimaDaTroca.get(l.conversa_id) ?? null;
    if (r.troca) {
      if (ultima === null || (l.em ?? 0) - ultima >= PAUSA_TROCA_MS) m.itensTabela += 1;
      ultimaDaTroca.set(l.conversa_id, l.em ?? 0);
    } else if (r.tabela) {
      m.itensTabela += 1;
      if (r.fala) m.falasTabela += 1;
      ultimaDaTroca.set(l.conversa_id, null);
    }
    porConversa.set(l.conversa_id, m);
  }
  return porConversa;
}

/** A régua: conversas com 20+ itens visíveis hoje; a mediana da parcela de falas em cada coluna. */
export function resumir(medidas: readonly Medida[]): { conversas: number; falasHoje: number | null; falasTabela: number | null; itensHoje: number | null; itensTabela: number | null } {
  const tipicas = medidas.filter((m) => m.itensHoje >= 20);
  const pct = (falas: number, itens: number) => (itens === 0 ? 100 : (100 * falas) / itens);
  return {
    conversas: tipicas.length,
    falasHoje: mediana(tipicas.map((m) => pct(m.falasHoje, m.itensHoje))),
    falasTabela: mediana(tipicas.map((m) => pct(m.falasTabela, m.itensTabela))),
    itensHoje: mediana(tipicas.map((m) => m.itensHoje)),
    itensTabela: mediana(tipicas.map((m) => m.itensTabela)),
  };
}

async function principal(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // sem .env: variáveis vêm do ambiente
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    log("erro", "medir_chat_limpo_sem_url", { variavel: "DATABASE_URL" });
    process.exit(1);
  }
  const dias = Number(process.argv.find((a) => a.startsWith("--dias="))?.slice("--dias=".length) ?? "30");
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
    log("erro", "medir_chat_limpo_dias_invalido", {});
    process.exit(1);
  }
  const escrever = (s: string) => process.stdout.write(`${s}\n`);
  const db = criarDb(url, { max: 1 });
  const medidas: Medida[] = [];
  const porAssunto = new Map<string, number>();
  try {
    await paraCadaPessoa(
      db,
      (escopo, tx) => tx(async (trx) => {
        await trx`set local transaction_read_only = on`;
        medidas.push(...(await medirDaPessoa(trx, escopo, dias, porAssunto)).values());
      }),
      { aoFalhar: (_escopo, erro) => { throw erro; }, sortearInicio: () => 0 },
    );
  } finally {
    await db.end({ timeout: 2 });
  }
  const r = resumir(medidas);
  const fmt = (v: number | null) => (v === null ? "-" : v.toFixed(1));
  const banco = new URL(url);
  escrever(`Banco: ${banco.host}${banco.pathname} · últimos ${dias} dias · só leitura, só contagens`);
  escrever("Não reproduz: fala de task/frente e rotina silenciosa contam como escondidas; os 4 avisos temporais contam como visíveis;");
  escrever("               recibos contam um item cada (Parte 3); o recolhimento \"N avisos\" não é desfeito; \"com a tabela\" junta as trocas entre bots (PR 3).");
  escrever("");
  escrever(`Conversas próprias com 20+ itens visíveis hoje: ${r.conversas} (de ${medidas.length} com alguma mensagem no período)`);
  escrever(`${"".padEnd(28)} ${"hoje".padStart(8)} ${"com a tabela".padStart(14)}`);
  escrever(`${"falas (% dos itens, mediana)".padEnd(28)} ${fmt(r.falasHoje).padStart(8)} ${fmt(r.falasTabela).padStart(14)}`);
  escrever(`${"itens visíveis (mediana)".padEnd(28)} ${fmt(r.itensHoje).padStart(8)} ${fmt(r.itensTabela).padStart(14)}`);
  escrever("");
  escrever(`${"assunto".padEnd(30)} ${"destino".padEnd(10)} ${"mensagens".padStart(10)}`);
  for (const [assunto, n] of [...porAssunto].sort((a, b) => b[1] - a[1])) escrever(`${assunto.padEnd(30)} ${(assunto === "(fala)" ? "chat" : destinoDe(assunto)).padEnd(10)} ${String(n).padStart(10)}`);
  log("info", "medir_chat_limpo", { dias, conversas: r.conversas, falas_hoje: r.falasHoje, falas_tabela: r.falasTabela });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await principal();
