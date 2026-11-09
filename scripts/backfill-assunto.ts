import { fileURLToPath } from "node:url";
import { paraCadaPessoa } from "../src/adapters/fundo/escopos-de-fundo.ts";
import type { Assunto } from "../src/contracts/destino-no-chat.ts";
import type { Autoria } from "../src/contracts/evento.ts";
import type { KindMensagem, PayloadMensagem } from "../src/contracts/mensagem.ts";
import { criarDb } from "../src/db/client.ts";
import { assuntoDaLinhaAntiga } from "../src/domain/assunto-do-texto.ts";
import { destinoDe } from "../src/domain/destino-no-chat.ts";
import { log } from "../src/obs/log.ts";
import type { Escopo, Tx } from "../src/shared/types.ts";

/**
 * definido em 2026-10-18 (plano do chat limpo, PR 1; ADR-114): grava `mensagens.assunto` (0091) nas linhas de antes da
 * migração. Roda DEPOIS do deploy do PR 1 e ANTES do PR 2 (que tira os avisos da janela pelo assunto).
 *
 *   node scripts/backfill-assunto.ts --seco        # só conta, por assunto e destino, e quantas ficaram sem casamento
 *   node scripts/backfill-assunto.ts               # grava (as linhas com assunto nulo que ganham um assunto)
 *   node scripts/backfill-assunto.ts --refazer     # recalcula também as linhas sem payload já classificadas (molde errado)
 *
 * `--refazer` nunca tira uma linha do chat (revisão pré-merge de 2026-10-18): depois do deploy, cada linha nova sem payload
 * tem o assunto ESCOLHIDO pelo produtor, que sabe o que a linha é; o texto só adivinha. Recalcular pelo texto uma linha
 * que está no chat e mandá-la para a Atividade esconderia, por exemplo, um "turno interrompido" cuja frase mudou sem o
 * molde mudar junto. Então, no `--refazer`, a linha cujo assunto atual fica no chat só muda para outro assunto que também
 * fica no chat; as outras mudanças valem (Atividade → chat, que é o lado seguro, e Atividade → Atividade, que só troca o
 * filtro). As preservadas saem na contagem. Uma linha antiga que o backfill pôs no chat por engano continua lá: errar para
 * o chat polui, errar para a Atividade esconde.
 *
 * Regras do banco de produção: imprime só CONTAGENS, nunca texto de mensagem; `--seco` abre a transação só de leitura.
 * Idempotente: sem `--refazer`, só olha `assunto is null`, e a fala (assunto nulo de verdade) não é tocada. Pessoa por
 * pessoa (paraCadaPessoa, nod_app com RLS), uma transação escopada por lote de 5.000 linhas, como os laços de fundo; o
 * lote anda pelo id (chave primária), então a fala que continua nula não volta no lote seguinte.
 *
 * Como reconhece (src/domain/assunto-do-texto.ts, assuntoDaLinhaAntiga): com payload, pelo payload e pela autoria; sem
 * payload, `sistema` e o recibo automático pelo texto inteiro contra os moldes do catálogo de redacao.ts e dos textos
 * fixos; a primeira linha da conversa própria é a criação do bot. Sem casamento: `sistema.generico` (Atividade), a sala
 * `sala.evento`, o recibo `aprovacao.recibo` (chat) — e a contagem "sem casamento" diz quantas foram.
 */

export const LOTE_BACKFILL = 5000;

/** `conversaId`: só uma conversa (`--conversa=<uuid>`, para diagnóstico; os testes também, para não ler o resto do banco). */
export type OpcoesBackfill = { refazer: boolean; seco: boolean; limite?: number; conversaId?: string };
/** `preservadas`: linhas no chat que o `--refazer` mandaria para fora dele e não mandou (ver o cabeçalho). */
export type Contagem = { lidas: number; gravadas: number; semCasamento: number; preservadas: number; porAssunto: Map<string, number> };

type LinhaLida = { id: string; kind: KindMensagem; payload: PayloadMensagem | null; texto: string; decidido_por: Autoria["decidido_por"]; tipo: "propria" | "sala"; primeira: boolean; assunto: string | null };

export function contagemVazia(): Contagem {
  return { lidas: 0, gravadas: 0, semCasamento: 0, preservadas: 0, porAssunto: new Map() };
}

/**
 * Um lote da pessoa do escopo da transação, a partir do id `depoisDe`. Devolve o último id lido (null = acabou). Só a dona
 * grava a própria linha (owner_id): a perna de leitura da sala não entra no lote.
 */
export async function processarLote(trx: Tx, escopo: Escopo, opcoes: OpcoesBackfill, depoisDe: string | null, total: Contagem): Promise<string | null> {
  const limite = opcoes.limite ?? LOTE_BACKFILL;
  const quais = opcoes.refazer
    ? trx`(m.assunto is null or (m.payload is null and m.kind in ('sistema', 'resultado_aprovacao')))`
    : trx`m.assunto is null`;
  const linhas = await trx<LinhaLida[]>`
    select m.id, m.kind, m.payload, m.texto, m.decidido_por, c.tipo, m.assunto,
      (m.kind = 'sistema' and m.payload is null and not exists (
        select 1 from mensagens o where o.tenant_id = m.tenant_id and o.conversa_id = m.conversa_id
          and (o.criado_em < m.criado_em or (o.criado_em = m.criado_em and o.id < m.id)))) as primeira
    from mensagens m join conversas c on c.tenant_id = m.tenant_id and c.id = m.conversa_id
    where m.tenant_id = ${escopo.tenantId} and m.owner_id = ${escopo.pessoaId} and ${quais}
      ${depoisDe ? trx`and m.id > ${depoisDe}` : trx``}
      ${opcoes.conversaId ? trx`and m.conversa_id = ${opcoes.conversaId}` : trx``}
    order by m.id limit ${limite}`;
  const mudar: { id: string; assunto: Assunto }[] = [];
  for (const l of linhas) {
    const r = assuntoDaLinhaAntiga({ kind: l.kind, payload: l.payload, texto: l.texto, decididoPor: l.decidido_por, tipoConversa: l.tipo, primeiraDaConversa: l.primeira });
    total.lidas += 1;
    if (r.assunto === null) continue;
    if (l.assunto !== null && r.assunto !== l.assunto && destinoDe(l.assunto) === "chat" && destinoDe(r.assunto) !== "chat") {
      // --refazer: a linha está no chat (pelo produtor ou por um backfill anterior) e o texto a mandaria para fora; fica.
      total.preservadas += 1;
      total.porAssunto.set(l.assunto, (total.porAssunto.get(l.assunto) ?? 0) + 1);
      continue;
    }
    total.porAssunto.set(r.assunto, (total.porAssunto.get(r.assunto) ?? 0) + 1);
    if (r.semCasamento) total.semCasamento += 1;
    if (r.assunto !== l.assunto) mudar.push({ id: l.id, assunto: r.assunto });
  }
  if (!opcoes.seco && mudar.length > 0) {
    const r = await trx`
      update mensagens m set assunto = v.assunto
      from unnest(${mudar.map((x) => x.id)}::uuid[], ${mudar.map((x) => x.assunto)}::text[]) as v(id, assunto)
      where m.tenant_id = ${escopo.tenantId} and m.owner_id = ${escopo.pessoaId} and m.id = v.id`;
    total.gravadas += r.count;
  } else if (opcoes.seco) {
    total.gravadas += mudar.length;
  }
  return linhas.length < limite ? null : (linhas.at(-1)?.id ?? null);
}

function somar(a: Contagem, b: Contagem): void {
  a.lidas += b.lidas;
  a.gravadas += b.gravadas;
  a.semCasamento += b.semCasamento;
  a.preservadas += b.preservadas;
  for (const [k, v] of b.porAssunto) a.porAssunto.set(k, (a.porAssunto.get(k) ?? 0) + v);
}

async function principal(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // sem .env: variáveis vêm do ambiente
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    log("erro", "backfill_assunto_sem_url", { variavel: "DATABASE_URL" });
    process.exit(1);
  }
  const conversaId = process.argv.find((a) => a.startsWith("--conversa="))?.slice("--conversa=".length);
  if (conversaId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversaId)) {
    log("erro", "backfill_assunto_conversa_invalida", {});
    process.exit(1);
  }
  const opcoes: OpcoesBackfill = { seco: process.argv.includes("--seco"), refazer: process.argv.includes("--refazer"), ...(conversaId ? { conversaId } : {}) };
  const escrever = (s: string) => process.stdout.write(`${s}\n`);
  const db = criarDb(url, { max: 1 });
  const total = contagemVazia();
  let pessoas = 0;
  try {
    await paraCadaPessoa(
      db,
      async (escopo, tx) => {
        pessoas += 1;
        let depoisDe: string | null = null;
        do {
          const lote = contagemVazia();
          const de: string | null = depoisDe;
          depoisDe = await tx(async (trx) => {
            if (opcoes.seco) await trx`set local transaction_read_only = on`;
            return processarLote(trx, escopo, opcoes, de, lote);
          });
          somar(total, lote);
        } while (depoisDe !== null);
      },
      { aoFalhar: (_escopo, erro) => { throw erro; }, sortearInicio: () => 0 },
    );
  } finally {
    await db.end({ timeout: 2 });
  }
  const banco = new URL(url);
  escrever(`Banco: ${banco.host}${banco.pathname} · ${opcoes.seco ? "SECO (nada gravado)" : "GRAVANDO"}${opcoes.refazer ? " · refazer" : ""} · ${pessoas} pessoas`);
  escrever(`Linhas lidas: ${total.lidas} · com assunto: ${[...total.porAssunto.values()].reduce((a, b) => a + b, 0)} · ${opcoes.seco ? "a gravar" : "gravadas"}: ${total.gravadas}`);
  escrever(`Sem casamento (sistema.generico, sala.evento ou aprovacao.recibo de reserva): ${total.semCasamento}`);
  if (opcoes.refazer) escrever(`Preservadas no chat (o texto as mandaria para fora; o assunto do produtor vale): ${total.preservadas}`);
  escrever("");
  escrever(`${"assunto".padEnd(30)} ${"destino".padEnd(10)} ${"linhas".padStart(8)}`);
  for (const [assunto, n] of [...total.porAssunto].sort((a, b) => b[1] - a[1])) escrever(`${assunto.padEnd(30)} ${destinoDe(assunto).padEnd(10)} ${String(n).padStart(8)}`);
  log("info", "backfill_assunto", { seco: opcoes.seco, refazer: opcoes.refazer, lidas: total.lidas, gravadas: total.gravadas, sem_casamento: total.semCasamento, preservadas: total.preservadas });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await principal();
