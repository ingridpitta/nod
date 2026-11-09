import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { vincularEscopo } from "../../src/db/tx.ts";
import { contadorDeEco } from "../../src/domain/ligacao-eco.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { encerrarComFalha, UsoInvalido } from "../voz/falha-de-script.ts";

/**
 * NOD-165: o relatório da UAT da ligação no Mac assinado. Lê o log do servidor (uma linha JSON por evento, src/obs/log.ts)
 * no intervalo da sessão e monta uma linha por ligação: interrupções, trocas, latência p50, ecos descartados, sugestões
 * de fone e rota de saída. Depois consulta o banco, só leitura, pelas decisões tomadas durante cada ligação.
 *
 * Nada de áudio nem de texto falado (ADR-071): o log já não traz `texto`, e do banco só saem id, tipo, estado e hora.
 *
 * Decisão por voz: o servidor não grava `canal: "voz"` na decisão (o marcador vive em memória, em compor.ts). Por isso o
 * relatório conta TODA decisão da conversa da ligação decidida entre `iniciada_em` e `encerrada_em`. Isso superestima
 * (uma decisão pela tela no meio da ligação também entra), o que é o lado seguro para o critério "zero decisões por eco".
 *
 * Banco: lê com `DATABASE_URL` (nod_app), uma pessoa por vez. `ligacoes` e `decisoes` têm FORCE ROW LEVEL SECURITY e as
 * policies valem só para nod_app; o nod_dono não enxerga linha nenhuma e devolveria sempre "0 ✅".
 *
 * Uso: node scripts/uat/relatorio-ligacao.ts --log /tmp/nod-servidor.log [--de 2026-10-06T13:00:00Z] [--ate …] [--sem-banco]
 */
export type LinhaLog = { ts: string; evento: string; ligacao_id?: string; [k: string]: unknown };

export type ResumoLigacao = {
  ligacaoId: string;
  inicio: string;
  fim: string | null;
  motivo: string | null;
  trocas: number | null;
  interrupcoes: number | null;
  latenciaP50Ms: number | null;
  /** Linhas `voz_eco_descartado` no intervalo. */
  ecos: number;
  /** Vezes em que o contador de eco (> 3 por minuto) passou a sugerir fone. */
  sugestoesDeFone: number;
  rotas: string[];
};

export type DecisaoNaLigacao = { ligacaoId: string; decisaoId: string; tipo: string; estado: string; decididaEm: string };

/** Linhas JSON do log; o resto (saída do dev.mjs, stack, prefixos) é ignorado. */
export function lerLinhas(conteudo: string): LinhaLog[] {
  const r: LinhaLog[] = [];
  for (const bruta of conteudo.split("\n")) {
    const i = bruta.indexOf("{");
    if (i < 0) continue;
    try {
      const l = JSON.parse(bruta.slice(i)) as Partial<LinhaLog>;
      if (typeof l.ts === "string" && typeof l.evento === "string") r.push(l as LinhaLog);
    } catch {
      // linha que não é JSON
    }
  }
  return r;
}

/** Quantas vezes o contador de eco virou de "não sugere" para "sugere fone", avaliado a cada eco. */
export function sugestoesDeFone(ecosEm: readonly number[]): number {
  const ordenados = [...ecosEm].sort((a, b) => a - b);
  let sugerindo = false;
  let n = 0;
  for (const em of ordenados) {
    const agora = contadorDeEco(ordenados, em).sugerirFone;
    if (agora && !sugerindo) n++;
    sugerindo = agora;
  }
  return n;
}

const numero = (v: unknown): number | null => (typeof v === "number" ? v : null);

export function resumirLigacoes(linhas: readonly LinhaLog[], intervalo: { de?: number; ate?: number } = {}): ResumoLigacao[] {
  const porLigacao = new Map<string, LinhaLog[]>();
  for (const l of linhas) {
    if (!l.evento.startsWith("voz_") || typeof l.ligacao_id !== "string") continue;
    const em = Date.parse(l.ts);
    if ((intervalo.de !== undefined && em < intervalo.de) || (intervalo.ate !== undefined && em > intervalo.ate)) continue;
    porLigacao.set(l.ligacao_id, [...(porLigacao.get(l.ligacao_id) ?? []), l]);
  }
  const r: ResumoLigacao[] = [];
  for (const [ligacaoId, ls] of porLigacao) {
    const fim = ls.find((l) => l.evento === "voz_ligacao_encerrada");
    const ecosEm = ls.filter((l) => l.evento === "voz_eco_descartado").map((l) => Date.parse(l.ts));
    r.push({
      ligacaoId,
      inicio: ls[0]!.ts,
      fim: fim?.ts ?? null,
      motivo: typeof fim?.motivo === "string" ? fim.motivo : null,
      trocas: numero(fim?.trocas),
      interrupcoes: numero(fim?.interrupcoes),
      latenciaP50Ms: numero(fim?.latencia_p50_ms),
      ecos: ecosEm.length,
      sugestoesDeFone: sugestoesDeFone(ecosEm),
      rotas: [...new Set(ls.filter((l) => l.evento === "voz_rota_saida" && typeof l.rota === "string").map((l) => l.rota as string))],
    });
  }
  return r.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

const celula = (v: number | string | null) => (v === null ? "—" : String(v));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `decisoes` null: o banco não foi consultado (`--sem-banco`). */
export function tabelaMarkdown(resumos: readonly ResumoLigacao[], decisoes: readonly DecisaoNaLigacao[] | null): string {
  const linhas = [
    "| Ligação | Início | Motivo | Trocas | Interrupções | Latência p50 (ms) | Ecos descartados | Sugestões de fone | Rota | Decididas na ligação |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of resumos) {
    // id que não é uuid fica fora da consulta: "0" diria que o banco foi olhado e não achou nada
    const minhas = decisoes === null || !UUID.test(r.ligacaoId) ? null : decisoes.filter((d) => d.ligacaoId === r.ligacaoId).length;
    linhas.push(`| ${r.ligacaoId.slice(0, 8)} | ${r.inicio} | ${celula(r.motivo)} | ${celula(r.trocas)} | ${celula(r.interrupcoes)} | ${celula(r.latenciaP50Ms)} | ${r.ecos} | ${r.sugestoesDeFone} | ${r.rotas.join(", ") || "—"} | ${celula(minhas)} |`);
  }
  const soma = (f: (r: ResumoLigacao) => number | null) => resumos.reduce((n, r) => n + (f(r) ?? 0), 0);
  linhas.push(
    "",
    `Ligações: ${resumos.length} · encerradas: ${resumos.filter((r) => r.fim).length} · interrupções: ${soma((r) => r.interrupcoes)} · ecos descartados: ${soma((r) => r.ecos)} · sugestões de fone: ${soma((r) => r.sugestoesDeFone)}`,
  );
  if (decisoes === null) linhas.push("Decisões: banco não consultado (--sem-banco).");
  else if (decisoes.length === 0) linhas.push("Decisões tomadas durante as ligações: 0 ✅");
  else {
    linhas.push(`Decisões tomadas durante as ligações: ${decisoes.length} ❌ nas leituras (passo 3); no passo 2.4 é esperada uma por ligação, a rotina aprovada de propósito`);
    for (const d of decisoes) linhas.push(`- ${d.ligacaoId.slice(0, 8)} · decisão ${d.decisaoId} · ${d.tipo} · ${d.estado} · ${d.decididaEm}`);
  }
  return linhas.join("\n");
}

/**
 * Decisões tomadas durante as ligações, vistas pelo escopo de cada pessoa (dona da ligação e da conversa). Sem
 * `escopos`, são todas as pessoas do banco: `pessoas` não tem RLS e o nod_app a lê sem escopo. O resto passa pelas
 * policies como no servidor.
 */
export async function decisoesNasLigacoes(trx: Tx, ligacaoIds: readonly string[], escopos?: readonly Escopo[]): Promise<DecisaoNaLigacao[]> {
  const pessoas = escopos ?? (await trx<{ tenant_id: string; id: string }[]>`select tenant_id, id from pessoas order by id`).map((p) => ({ tenantId: p.tenant_id, pessoaId: p.id }));
  const vistas = new Map<string, DecisaoNaLigacao>();
  for (const escopo of pessoas) {
    await vincularEscopo(trx, escopo);
    const rows = await trx<{ ligacao_id: string; decisao_id: string; tipo: string; estado: string; decidida_em: Date }[]>`
      select l.id as ligacao_id, d.id as decisao_id, d.tipo::text as tipo, d.estado::text as estado, d.decidida_em
      from ligacoes l
      join decisoes d on d.tenant_id = l.tenant_id and d.conversa_id = l.conversa_id
      where l.id = any(${ligacaoIds as string[]}::uuid[])
        and d.decidida_em between l.iniciada_em and coalesce(l.encerrada_em, now())`;
    for (const x of rows) vistas.set(x.decisao_id, { ligacaoId: x.ligacao_id, decisaoId: x.decisao_id, tipo: x.tipo, estado: x.estado, decididaEm: x.decidida_em.toISOString() });
  }
  return [...vistas.values()].sort((a, b) => a.decididaEm.localeCompare(b.decididaEm));
}

async function lerDecisoes(url: string, ligacaoIds: readonly string[]): Promise<DecisaoNaLigacao[]> {
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    return await sql.begin("read only", (trx) => decisoesNasLigacoes(trx as unknown as Tx, ligacaoIds));
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** `--de` sem valor (ou seguido de outra opção) desligaria o filtro em silêncio: é erro de uso, não "sem filtro". */
function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new UsoInvalido(`--${nome} precisa de um valor`);
  return v;
}

/** `--de`/`--ate` que não é data faria o filtro sumir em silêncio (NaN nunca compara). */
function instante(nome: string): number | undefined {
  const v = arg(nome);
  if (v === undefined) return undefined;
  const em = Date.parse(v);
  if (Number.isNaN(em)) throw new UsoInvalido(`--${nome} precisa ser uma data ISO, como 2026-10-06T13:00:00Z (veio "${v}")`);
  return em;
}

async function principal(): Promise<void> {
  const uso = "uso: node scripts/uat/relatorio-ligacao.ts --log <arquivo> [--de ISO] [--ate ISO] [--sem-banco]";
  if (!process.argv.includes("--log")) throw new UsoInvalido(uso);
  const arquivo = arg("log")!;
  const de = instante("de");
  const ate = instante("ate");
  if (de !== undefined && ate !== undefined && de > ate) throw new UsoInvalido("--de precisa vir antes de --ate");
  const resumos = resumirLigacoes(lerLinhas(readFileSync(arquivo, "utf8")), { de, ate });
  // Zero ligações é log ou intervalo errado (fuso, arquivo de outra sessão), nunca um relatório: sem isto a tabela vazia
  // passava por resultado.
  if (resumos.length === 0) throw new UsoInvalido(`nenhuma ligação em ${arquivo}${de !== undefined || ate !== undefined ? " no intervalo de --de/--ate (horário em UTC)" : ""}: confira o arquivo de log e o intervalo`);
  let decisoes: DecisaoNaLigacao[] | null = null;
  if (!process.argv.includes("--sem-banco")) {
    try {
      process.loadEnvFile(".env");
    } catch {
      // sem .env: variáveis vêm do ambiente
    }
    const url = process.env.DATABASE_URL;
    if (!url) throw new UsoInvalido("DATABASE_URL ausente (ou use --sem-banco)");
    // Um `ligacao_id` que não é uuid (log truncado ou editado) derrubaria o cast `::uuid[]` da consulta inteira.
    decisoes = await lerDecisoes(url, resumos.map((r) => r.ligacaoId).filter((id) => UUID.test(id)));
  }
  process.stdout.write(`${tabelaMarkdown(resumos, decisoes)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await principal().catch(encerrarComFalha);
}
