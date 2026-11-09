import { fileURLToPath } from "node:url";
import { paraCadaPessoa } from "../src/adapters/fundo/escopos-de-fundo.ts";
import { criarDb } from "../src/db/client.ts";
import { log } from "../src/obs/log.ts";
import type { Escopo, Tx } from "../src/shared/types.ts";

/**
 * definido em 2026-10-18 (plano dos modos de aprovação, PR 1: medir antes): a linha de base das metas da fase — esperas
 * por aprovação (cartões de aprovação e comandos no Mac) nos bots em Automático e em Ignorar todas caem 80% duas semanas
 * depois do PR 7. Só leitura (transação read-only) e só contagens: nenhum texto de mensagem nem de item sai do banco.
 *
 *   node scripts/medir-modos.ts              # últimos 35 dias (cinco semanas inteiras)
 *   node scripts/medir-modos.ts --dias=14
 *
 * Por semana (segunda-feira, horário de Brasília) e por bot: os cartões de aprovação por `motivo_manual` e quantos foram
 * negados; os comandos no Mac (comando, gravar arquivo, MCP da pessoa) por motivo; as esperas de rotina e as horas
 * paradas; os bots por modo. O PR 4 acrescenta o revisor (veredito, cartões negados, liberadas contestadas). O que o revisor do Automático novo faria
 * NÃO vem daqui: vem dos logs `revisor_seria_chamado` e `cartao_seria_aberto` (src/use-cases/medir-revisao.ts).
 *
 * Como conta:
 *  - espera = cartão de aprovação que alguém teve de olhar. O lote que a regra aprovou sozinha (fechado em menos de 5 s)
 *    não é espera; aparece só em "sem espera".
 *  - o motivo do cartão é o do primeiro item que tem motivo; negado = decidido sem nenhum item marcado.
 *  - "em Automático/Ignorar" usa o modo ATUAL do bot (o modo na hora do cartão não fica gravado; o motivo diz parte).
 *  - rotina = a primeira volta da cadeia de retomadas do turno do cartão é de rotina.
 *  - horas paradas = do cartão até a decisão, o vencimento ou agora (aberto).
 *  - a credencial que o hook do Mac nega (arquivo de credencial, MCP que cita uma) não vira cartão: entra à parte, pela
 *    negação anotada na conversa (`causaNativa = credencial`, somando `vezes`). É o que o PR 1 subconta de credencial.
 */

export type LinhaAprovacao = {
  id: string;
  agente_id: string;
  semana: string;
  criado: number;
  fim: number | null;
  estado: string;
  desfecho: string | null;
  rotina: boolean;
  motivo: string | null;
  conector: string | null;
  eh_arquivo: boolean;
  frase_app: boolean;
  algum_marcado: boolean;
};
export type LinhaBot = { id: string; nome: string; modo: string; nod: boolean };
export type LinhaCredencial = { semana: string; agente_id: string; n: number };

export type TipoPedido = "comando" | "arquivo" | "mcp" | "app" | "computador";
export type Desfecho = "aprovada" | "negada" | "venceu" | "dispensada" | "regra_depois" | "aberta";
export type Espera = { agenteId: string; semana: string; tipo: TipoPedido; motivo: string; desfecho: Desfecho; ms: number; rotina: boolean };

/** Fechado por regra em menos disso = o modo ou a regra aprovou na hora: não foi espera. */
const NA_HORA_MS = 5_000;
const NO_MAC: ReadonlySet<TipoPedido> = new Set(["comando", "arquivo", "mcp"]);

export function tipoDoPedido(l: Pick<LinhaAprovacao, "conector" | "eh_arquivo" | "frase_app">): TipoPedido {
  if (l.conector === "computador") return "computador";
  if (l.conector !== "terminal") return "app";
  return l.eh_arquivo ? "arquivo" : l.frase_app ? "mcp" : "comando";
}

/** A espera do cartão, ou null quando a regra o fechou na hora. */
export function classificar(l: LinhaAprovacao, agora: number): Espera | null {
  const porRegra = l.desfecho === "decidida_por_regra";
  if (porRegra && l.fim !== null && l.fim - l.criado < NA_HORA_MS) return null;
  const desfecho: Desfecho =
    l.desfecho === "decidida" ? (l.algum_marcado ? "aprovada" : "negada")
    : l.desfecho === "dispensada" ? "dispensada"
    : l.estado === "vencida" || (l.desfecho ?? "").startsWith("expirou") ? "venceu"
    : porRegra ? "regra_depois"
    : "aberta";
  const fim = desfecho === "aberta" ? agora : (l.fim ?? agora);
  return { agenteId: l.agente_id, semana: l.semana, tipo: tipoDoPedido(l), motivo: l.motivo ?? "-", desfecho, ms: Math.max(0, fim - l.criado), rotina: l.rotina };
}

type Conta = { cartoes: number; negados: number; ms: number; rotina: number; msRotina: number };
const zero = (): Conta => ({ cartoes: 0, negados: 0, ms: 0, rotina: 0, msRotina: 0 });
function somar(c: Conta, e: Espera): void {
  c.cartoes += 1;
  if (e.desfecho === "negada") c.negados += 1;
  c.ms += e.ms;
  if (e.rotina) {
    c.rotina += 1;
    c.msRotina += e.ms;
  }
}

/** A conta da chave no mapa, criada na primeira vez. */
function da<C>(m: Map<string, C>, chave: string, nova: () => C): C {
  const c = m.get(chave) ?? nova();
  m.set(chave, c);
  return c;
}

export type Resumo = {
  porModo: Map<string, number>;
  porSemana: Map<string, Conta & { emAutoOuTotal: number; semEspera: number; credencialNegada: number }>;
  porMotivo: Map<string, Conta>;
  noMac: Map<string, Conta>;
  porBot: Map<string, Conta & { noMac: number; credencialNegada: number }>;
};

export function resumir(linhas: readonly LinhaAprovacao[], bots: readonly LinhaBot[], credenciais: readonly LinhaCredencial[], agora: number): Resumo {
  const modoDe = new Map(bots.map((b) => [b.id, b.modo]));
  const porModo = new Map<string, number>();
  for (const b of bots) {
    const chave = b.nod ? `${b.modo} (Nod)` : b.modo;
    porModo.set(chave, (porModo.get(chave) ?? 0) + 1);
  }
  const r: Resumo = { porModo, porSemana: new Map(), porMotivo: new Map(), noMac: new Map(), porBot: new Map() };
  const semana = (s: string) => da(r.porSemana, s, () => ({ ...zero(), emAutoOuTotal: 0, semEspera: 0, credencialNegada: 0 }));
  const bot = (s: string, agenteId: string) => da(r.porBot, `${s}|${agenteId}`, () => ({ ...zero(), noMac: 0, credencialNegada: 0 }));
  for (const l of linhas) {
    const e = classificar(l, agora);
    const s = semana(l.semana);
    if (!e) {
      s.semEspera += 1;
      continue;
    }
    somar(s, e);
    const modo = modoDe.get(e.agenteId);
    if (modo === "automatico" || modo === "total") s.emAutoOuTotal += 1;
    somar(da(r.porMotivo, `${e.semana}|${e.motivo}`, zero), e);
    if (NO_MAC.has(e.tipo)) somar(da(r.noMac, `${e.semana}|${e.tipo}|${e.motivo}`, zero), e);
    const b = bot(e.semana, e.agenteId);
    somar(b, e);
    if (NO_MAC.has(e.tipo)) b.noMac += 1;
  }
  for (const c of credenciais) {
    semana(c.semana).credencialNegada += c.n;
    bot(c.semana, c.agente_id).credencialNegada += c.n;
  }
  return r;
}

/**
 * Junta a linha de uma pessoa às das outras (a mesma decisão aparece para a dona e para quem decide). Revisão do PR
 * #402: quem decide sem ser dona vê a decisão mas não os turnos da dona, e a `rotina` dela sai falsa; a última pessoa
 * lida não pode apagar a rotina que a dona viu.
 */
export function juntarLinha(linhas: Map<string, LinhaAprovacao>, l: LinhaAprovacao): void {
  const antes = linhas.get(l.id);
  linhas.set(l.id, antes ? { ...l, rotina: antes.rotina || l.rotina } : l);
}

const SEMANA = (coluna: string) => `to_char(date_trunc('week', ${coluna} at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD')`;

/** As linhas que a pessoa do escopo enxerga (dona ou decisora), nos últimos `dias`. Quem chama junta por id. */
export async function lerDaPessoa(trx: Tx, escopo: Escopo, dias: number): Promise<{ linhas: LinhaAprovacao[]; bots: LinhaBot[]; credenciais: LinhaCredencial[] }> {
  const linhas = await trx<LinhaAprovacao[]>`
    with recursive cadeia as (
      select t.id inicio, t.id, t.retoma_turno_id, t.origem, 0 n from turnos t
      where t.tenant_id = ${escopo.tenantId} and exists (select 1 from decisoes d where d.tenant_id = t.tenant_id and d.turno_id = t.id
        and d.tipo = 'aprovacao' and d.criado_em >= now() - make_interval(days => ${dias}))
      union all
      select c.inicio, p.id, p.retoma_turno_id, p.origem, c.n + 1 from cadeia c
      join turnos p on p.tenant_id = ${escopo.tenantId} and p.id = c.retoma_turno_id where c.n < 40
    ), raiz as (select distinct on (inicio) inicio, origem from cadeia order by inicio, n desc)
    select d.id::text, d.agente_id::text, ${trx.unsafe(SEMANA("d.criado_em"))} as semana,
      (extract(epoch from d.criado_em) * 1000)::float8 as criado,
      (extract(epoch from coalesce(d.decidida_em, (d.desfecho->>'em')::timestamptz, case when d.estado = 'vencida' then d.prazo_decisao_em end)) * 1000)::float8 as fim,
      d.estado::text, d.desfecho->>'tipo' as desfecho, coalesce(r.origem::text = 'rotina', false) as rotina,
      i.motivo, i.conector, coalesce(i.eh_arquivo, false) as eh_arquivo, coalesce(i.algum_marcado, false) as algum_marcado,
      (i.conector = 'terminal' and d.frase like '% quer usar um app seu') as frase_app
    from decisoes d
    left join raiz r on r.inicio = d.turno_id
    left join lateral (
      select (array_agg(x.motivo_manual::text order by x.idx) filter (where x.motivo_manual is not null))[1] as motivo,
        (array_agg(x.destino->>'conector' order by x.idx))[1] as conector, bool_or(x.destino->'argumentos' ? 'arquivo') as eh_arquivo,
        bool_or(x.selecionado) as algum_marcado
      from itens_aprovacao x where x.tenant_id = d.tenant_id and x.decisao_id = d.id
    ) i on true
    where d.tenant_id = ${escopo.tenantId} and d.tipo = 'aprovacao' and d.criado_em >= now() - make_interval(days => ${dias})`;
  const bots = await trx<LinhaBot[]>`
    select id::text, nome, modo_aprovacao::text as modo, papel is not distinct from 'nod' as nod from agentes
    where tenant_id = ${escopo.tenantId} and excluido_em is null`;
  const credenciais = await trx<LinhaCredencial[]>`
    select ${trx.unsafe(SEMANA("m.criado_em"))} as semana, t.agente_id::text, sum(coalesce((m.payload->>'vezes')::int, 1))::int as n
    from mensagens m join turnos t on t.tenant_id = m.tenant_id and t.id = m.turno_id
    where m.tenant_id = ${escopo.tenantId} and m.owner_id = ${escopo.pessoaId} and m.kind = 'negacao'
      and m.payload->>'causaNativa' = 'credencial' and m.criado_em >= now() - make_interval(days => ${dias})
    group by 1, 2`;
  return { linhas, bots, credenciais };
}

/**
 * O revisor do Automático (definido em 2026-10-26, plano dos modos de aprovação, PR 4; as metas do "Pronto quando"): por
 * semana, as revisões e o veredito, dos cartões que ele deixou quantos a pessoa negou, e das liberadas quantas ela
 * contestou ("Devia ter perguntado"). Só contagens de `acoes_pelo_modo` (0093): nem o comando nem o motivo saem do banco.
 */
export type LinhaRevisor = { semana: string; veredito: string | null; desfecho_pessoa: string | null; contestada: boolean; n: number };
export type ResumoRevisor = { revisoes: number; libera: number; pede: number; falhou: number; naoRevisado: number; cartoes: number; negados: number; contestadas: number };

export function resumirRevisor(linhas: readonly LinhaRevisor[]): Map<string, ResumoRevisor> {
  const porSemana = new Map<string, ResumoRevisor>();
  for (const l of linhas) {
    const r = porSemana.get(l.semana) ?? { revisoes: 0, libera: 0, pede: 0, falhou: 0, naoRevisado: 0, cartoes: 0, negados: 0, contestadas: 0 };
    r.revisoes += l.n;
    if (l.veredito === "libera") r.libera += l.n;
    else if (l.veredito === "pede") r.pede += l.n;
    else if (l.veredito === "falhou") r.falhou += l.n;
    else if (l.veredito === "nao_revisado") r.naoRevisado += l.n;
    if (l.veredito !== null && l.veredito !== "libera") r.cartoes += l.n;
    if (l.desfecho_pessoa === "negou") r.negados += l.n;
    if (l.contestada) r.contestadas += l.n;
    porSemana.set(l.semana, r);
  }
  return porSemana;
}

export async function lerRevisorDaPessoa(trx: Tx, escopo: Escopo, dias: number): Promise<LinhaRevisor[]> {
  return trx<LinhaRevisor[]>`
    select ${trx.unsafe(SEMANA("criado_em"))} as semana, veredito, desfecho_pessoa, contestada_em is not null as contestada, count(*)::int as n
    from acoes_pelo_modo
    where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and modo = 'automatico' and criado_em >= now() - make_interval(days => ${dias})
    group by 1, 2, 3, 4`;
}

export function imprimirRevisor(r: ReadonlyMap<string, ResumoRevisor>, escrever: (s: string) => void): void {
  const pct = (a: number, b: number) => (b === 0 ? "-" : `${Math.round((100 * a) / b)}%`);
  const larg = [12, 9, 8, 7, 7, 8, 8, 8, 11];
  const col = (vs: readonly (string | number)[]) => vs.map((v, i) => (i === 0 ? String(v).padEnd(larg[i]!) : String(v).padStart(larg[i]!))).join(" ");
  escrever("Revisor do Automático (cartões = pede + falhou + não revisado; negados = a pessoa negou o cartão)");
  escrever(col(["semana", "revisões", "libera", "pede", "falhou", "não rev.", "cartões", "negados", "contestadas"]));
  for (const [s, c] of [...r].sort()) escrever(col([s, c.revisoes, `${c.libera} ${pct(c.libera, c.revisoes)}`, c.pede, c.falhou, c.naoRevisado, c.cartoes, `${c.negados} ${pct(c.negados, c.cartoes)}`, `${c.contestadas} ${pct(c.contestadas, c.libera)}`]));
}

export function imprimir(r: Resumo, bots: readonly LinhaBot[], escrever: (s: string) => void): void {
  const h = (ms: number) => (ms / 3_600_000).toFixed(1);
  // As `texto` primeiras colunas são texto (alinhadas à esquerda); as outras, números.
  const col = (vs: readonly (string | number)[], larguras: readonly number[], texto = 1) => vs.map((v, i) => (i < texto ? String(v).padEnd(larguras[i]!) : String(v).padStart(larguras[i]!))).join(" ");
  // Só o começo do id: o nome do bot é escolhido pela pessoa e não sai do banco (revisão do PR #402, "só contagens").
  const nome = new Map(bots.map((b) => [b.id, b.id.slice(0, 8)]));
  const modo = new Map(bots.map((b) => [b.id, b.modo]));
  escrever("Bots ativos por modo");
  for (const [m, n] of [...r.porModo].sort()) escrever(`  ${m.padEnd(20)} ${String(n).padStart(5)}`);
  escrever("");
  const lS = [12, 8, 12, 8, 9, 8, 9, 10, 11];
  escrever(col(["semana", "esperas", "auto/total", "negadas", "horas", "rotina", "h rotina", "sem espera", "cred. hook"], lS));
  for (const [s, c] of [...r.porSemana].sort()) escrever(col([s, c.cartoes, c.emAutoOuTotal, c.negados, h(c.ms), c.rotina, h(c.msRotina), c.semEspera, c.credencialNegada], lS));
  escrever("");
  escrever("Cartões de aprovação por motivo");
  const lM = [12, 40, 8, 8, 9];
  escrever(col(["semana", "motivo", "cartões", "negados", "horas"], lM, 2));
  for (const [k, c] of [...r.porMotivo].sort()) escrever(col([...k.split("|"), c.cartoes, c.negados, h(c.ms)], lM, 2));
  escrever("");
  escrever("Comandos no Mac por motivo");
  const lC = [12, 9, 22, 8, 8];
  escrever(col(["semana", "tipo", "motivo", "cartões", "negados"], lC, 3));
  for (const [k, c] of [...r.noMac].sort()) escrever(col([...k.split("|"), c.cartoes, c.negados], lC, 3));
  escrever("");
  escrever("Por semana e por bot");
  const lB = [12, 10, 11, 8, 8, 7, 7, 9, 11];
  escrever(col(["semana", "bot", "modo hoje", "esperas", "negadas", "no Mac", "rotina", "horas", "cred. hook"], lB, 3));
  for (const [k, c] of [...r.porBot].sort()) {
    const [s = "", id = ""] = k.split("|");
    escrever(col([s, nome.get(id) ?? `(${id.slice(0, 8)})`, modo.get(id) ?? "?", c.cartoes, c.negados, c.noMac, c.rotina, h(c.ms), c.credencialNegada], lB, 3));
  }
}

async function principal(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // sem .env: variáveis vêm do ambiente
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    log("erro", "medir_modos_sem_url", { variavel: "DATABASE_URL" });
    process.exit(1);
  }
  const dias = Number(process.argv.find((a) => a.startsWith("--dias="))?.slice("--dias=".length) ?? "35");
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
    log("erro", "medir_modos_dias_invalido", {});
    process.exit(1);
  }
  const db = criarDb(url, { max: 1 });
  const linhas = new Map<string, LinhaAprovacao>();
  const bots = new Map<string, LinhaBot>();
  const credenciais = new Map<string, LinhaCredencial>();
  const doRevisor: LinhaRevisor[] = [];
  let pessoas = 0;
  try {
    await paraCadaPessoa(
      db,
      (escopo, tx) => tx(async (trx) => {
        await trx`set local transaction_read_only = on`;
        const lido = await lerDaPessoa(trx, escopo, dias);
        pessoas += 1;
        for (const l of lido.linhas) juntarLinha(linhas, l);
        for (const b of lido.bots) bots.set(b.id, b);
        // acoes_pelo_modo é privada da dona (owner_id): cada pessoa lê só as suas, sem repetir entre escopos.
        doRevisor.push(...(await lerRevisorDaPessoa(trx, escopo, dias)));
        // A negação mora na conversa da dona: cada pessoa lê só as suas (owner_id), então não repete entre escopos.
        for (const c of lido.credenciais) {
          const chave = `${c.semana}|${c.agente_id}`;
          credenciais.set(chave, { ...c, n: (credenciais.get(chave)?.n ?? 0) + c.n });
        }
      }),
      { aoFalhar: (_escopo, erro) => { throw erro; }, sortearInicio: () => 0 },
    );
  } finally {
    await db.end({ timeout: 2 });
  }
  // Revisão do PR #402: o banco ocupado na listagem faz o paraCadaPessoa voltar sem ninguém, e as tabelas zeradas
  // pareceriam a linha de base.
  if (pessoas === 0) {
    log("erro", "medir_modos_sem_pessoas", {});
    process.exit(1);
  }
  const escrever = (s: string) => process.stdout.write(`${s}\n`);
  const banco = new URL(url);
  escrever(`Banco: ${banco.host}${banco.pathname} · últimos ${dias} dias · só leitura, só contagens`);
  escrever("\"auto/total\" usa o modo ATUAL do bot; \"cred. hook\" = credencial negada pelo hook do Mac, sem cartão.");
  escrever("");
  const r = resumir([...linhas.values()], [...bots.values()], [...credenciais.values()], Date.now());
  imprimir(r, [...bots.values()], escrever);
  escrever("");
  imprimirRevisor(resumirRevisor(doRevisor), escrever);
  log("info", "medir_modos", { dias, cartoes: linhas.size, bots: bots.size });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await principal();
