import { randomUUID } from "node:crypto";
import { vincularEscopo } from "../db/tx.ts";
import type { Escopo, Tx } from "../shared/types.ts";

/**
 * Levar o espaço provisório para uma conta que já existe (NOD-345, ADR-124 §3, estados #j3-1 a #j3-4).
 *
 * Uma transação só, na `trx` de quem chama: lê com o escopo da ORIGEM, grava com o do DESTINO (a RLS confere cada lado),
 * com ids novos. Se qualquer passo falha, a transação inteira volta e nada muda dos dois lados (#j3-4).
 *
 * Copia: bots (menos o Nod) com memórias; conversas próprias com mensagens; as mensagens do Nod de origem entram na
 * conversa do Nod de destino; rotinas (PAUSADAS e sem acessos: a pessoa religa no destino); artefatos com versões e o
 * estado de cada um; anexos das mensagens copiadas (com os bytes). Ids dentro de JSON (o `artefatoId` de uma mensagem,
 * os anexos do payload) também são trocados. Conversas de bot excluído ficam de fora, como o bot. Não copia: credenciais e acessos de apps, máquinas, computadores, turnos, salas, trilha. Nada do
 * destino é alterado nem apagado; o espaço provisório fica como está (só deixa de ter sessão), com as rotinas pausadas.
 *
 * Idempotente pela linha de `importacoes` (destino, origem): a segunda chamada devolve a contagem da primeira.
 */
/** NOD-323 (Codex no #507): o link `nod-anexo:<uuid>` no texto da fala aponta para o anexo — ganha o id novo junto. */
const LINK_ANEXO_NO_TEXTO = /nod-anexo:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export type ContagemImportacao = { bots: number; conversas: number; mensagens: number; rotinas: number; artefatos: number };

/** Colunas que apontam para o que NÃO vem junto: viram null na cópia. */
const SOLTAR: Record<string, readonly string[]> = {
  agentes: ["computador_id", "maquina_id", "duplicado_de", "excluido_em", "configurando_desde", "configurando_turno_id"],
  conversas: ["sala_id", "sessao_cli", "sessao_executor", "sessao_harness", "sessao_em", "sessao_conta_id", "sessao_maquina_id", "recomeco_em"],
  mensagens: ["turno_id", "machine_id", "id_envio"],
  // NOD-323: a mídia do bot aponta para o turno e a máquina da origem (que não vêm); o caminho só vale naquela máquina.
  anexos: ["turno_id", "machine_id", "caminho_relativo"],
  // NOD-412 (QA do PR #13): a cópia chega pausada SEM data — a pessoa religa no destino; com a data, voltava sozinha.
  rotinas: ["acessos", "excluido_em", "retomar_em"],
  artefato_versoes: [],
  artefato_estados: [],
  artefatos: [],
  agente_memorias: [],
};

type Linha = Record<string, unknown>;

async function colunas(trx: Tx, tabela: string): Promise<string[]> {
  const r = await trx<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${tabela} and is_generated = 'NEVER'
    order by ordinal_position`;
  return r.map((x) => x.column_name);
}

/** Insere linhas JSON numa tabela com as colunas não geradas (json_populate_record faz o tipo de cada coluna). */
async function inserir(trx: Tx, tabela: string, cols: string[], linhas: Linha[]): Promise<void> {
  if (linhas.length === 0) return;
  const lista = cols.map((c) => `"${c}"`).join(", ");
  // A tabela e as colunas vêm do catálogo (information_schema) e de constantes deste arquivo, nunca da entrada.
  await trx.unsafe(
    `insert into public.${tabela} (${lista}) select ${lista} from json_populate_recordset(null::public.${tabela}, ($1::text)::json)`,
    [JSON.stringify(linhas)],
  );
}

export async function importarEspaco(trx: Tx, origem: Escopo, destino: Escopo): Promise<ContagemImportacao> {
  await vincularEscopo(trx, destino);
  const feita = await trx<{ contagem: ContagemImportacao }[]>`
    select contagem from importacoes
    where tenant_id = ${destino.tenantId} and origem_tenant_id = ${origem.tenantId} and origem_pessoa_id = ${origem.pessoaId}`;
  if (feita[0]) return feita[0].contagem;

  // ---- leitura, com o escopo da origem
  await vincularEscopo(trx, origem);
  // Um bot ainda trabalhando escreveria na origem depois da cópia, e a resposta ficaria para trás. O turno vivo para
  // ANTES da leitura (a linha travada serializa com a máquina que o assenta), e a chave da máquina morre no fim: nada
  // mais escreve no espaço levado. Esperar não serve: sem o motor ligado, o pendente ficaria para sempre.
  await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa', lease_ate = null
    where tenant_id = ${origem.tenantId} and owner_id = ${origem.pessoaId} and estado in ('pendente', 'despachando')`;
  const ler = async (sql: string): Promise<Linha[]> => (await trx.unsafe(sql, [origem.tenantId, origem.pessoaId])) as unknown as Linha[];
  const agentes = await ler(`select row_to_json(a)::jsonb as j from agentes a where tenant_id = $1 and owner_id = $2 and excluido_em is null`);
  const conversas = await ler(`select row_to_json(c)::jsonb as j from conversas c where tenant_id = $1 and owner_id = $2 and sala_id is null and agente_id in (select id from agentes where tenant_id = $1 and owner_id = $2 and excluido_em is null)`);
  const mensagens = await ler(`select row_to_json(m)::jsonb as j from mensagens m where tenant_id = $1 and owner_id = $2 and conversa_id in (select id from conversas where tenant_id = $1 and owner_id = $2 and sala_id is null) order by criado_em, id`);
  // Sem os bytes: cada anexo (até 10 MB) é copiado depois, um por vez, sem passar por uma string JSON só.
  const anexos = await ler(`select to_jsonb(x) - 'conteudo' as j from anexos x where tenant_id = $1 and owner_id = $2 and mensagem_id is not null`);
  const memorias = await ler(`select row_to_json(x)::jsonb as j from agente_memorias x where tenant_id = $1 and owner_id = $2`);
  const rotinas = await ler(`select row_to_json(r)::jsonb as j from rotinas r where tenant_id = $1 and owner_id = $2 and excluido_em is null`);
  const artefatos = await ler(`select row_to_json(a)::jsonb as j from artefatos a where tenant_id = $1 and owner_id = $2`);
  const versoes = await ler(`select row_to_json(v)::jsonb as j from artefato_versoes v where tenant_id = $1 and owner_id = $2`);
  const estados = await ler(`select row_to_json(e)::jsonb as j from artefato_estados e where tenant_id = $1 and owner_id = $2`);
  const j = (ls: Linha[]) => ls.map((l) => l.j as Linha);

  // ---- destino
  await vincularEscopo(trx, destino);
  const nodDestino = (await trx<{ id: string }[]>`select id from agentes where tenant_id = ${destino.tenantId} and owner_id = ${destino.pessoaId} and papel = 'nod' and excluido_em is null limit 1`)[0]?.id ?? null;
  const conversaNodDestino = nodDestino
    ? ((await trx<{ id: string }[]>`select id from conversas where tenant_id = ${destino.tenantId} and owner_id = ${destino.pessoaId} and agente_id = ${nodDestino} and sala_id is null order by criado_em limit 1`)[0]?.id ?? null)
    : null;

  // Mapa de ids: tudo que é copiado ganha id novo; a pessoa vira a pessoa de destino; o Nod vira o Nod de destino.
  const mapa = new Map<string, string>([[origem.pessoaId, destino.pessoaId]]);
  const nodOrigem = j(agentes).find((a) => a.papel === "nod");
  const agentesACopiar = j(agentes).filter((a) => !(a.papel === "nod" && nodDestino));
  if (nodOrigem && nodDestino) mapa.set(String(nodOrigem.id), nodDestino);
  for (const a of agentesACopiar) mapa.set(String(a.id), randomUUID());
  const conversasACopiar: Linha[] = [];
  for (const c of j(conversas)) {
    if (nodOrigem && nodDestino && c.agente_id === nodOrigem.id && conversaNodDestino) mapa.set(String(c.id), conversaNodDestino);
    else { mapa.set(String(c.id), randomUUID()); conversasACopiar.push(c); }
  }
  const msgs = j(mensagens).filter((m) => mapa.has(String(m.conversa_id)));
  for (const m of msgs) mapa.set(String(m.id), randomUUID());
  const anxs = j(anexos).filter((a) => mapa.has(String(a.mensagem_id)));
  for (const a of anxs) mapa.set(String(a.id), randomUUID());
  const rots = j(rotinas).filter((r) => mapa.has(String(r.agente_id)) && mapa.has(String(r.conversa_id)));
  for (const r of rots) mapa.set(String(r.id), randomUUID());
  const arts = j(artefatos).filter((a) => mapa.has(String(a.agente_id)) && mapa.has(String(a.conversa_id)));
  for (const a of arts) mapa.set(String(a.id), randomUUID());
  // A versão publicada numa sala aponta para uma mensagem que não vem junto: o conteúdo fica, a referência solta.
  const vers = j(versoes).filter((v) => mapa.has(String(v.artefato_id))).map((v) => (v.mensagem_id && !mapa.has(String(v.mensagem_id)) ? { ...v, mensagem_id: null } : v));
  const ests = j(estados).filter((e) => mapa.has(String(e.artefato_id)));
  const mems = j(memorias).filter((m) => mapa.has(String(m.agente_id)));

  /** Troca os ids conhecidos em qualquer profundidade (colunas jsonb como `mensagens.payload`). */
  const remapear = (v: unknown): unknown => {
    if (typeof v === "string") return mapa.get(v) ?? v.replace(LINK_ANEXO_NO_TEXTO, (t, id: string) => { const novo = mapa.get(id.toLowerCase()); return novo ? `nod-anexo:${novo}` : t; });
    if (Array.isArray(v)) return v.map(remapear);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remapear(x)]));
    return v;
  };

  /** Copia a linha trocando os ids conhecidos e soltando o que não vem junto. Os ids novos de versões/memórias/estados nascem aqui. */
  const traduzir = (tabela: string, l: Linha, extra: Linha = {}): Linha => {
    const out: Linha = {};
    for (const [k, v] of Object.entries(l)) out[k] = remapear(v);
    for (const k of SOLTAR[tabela] ?? []) out[k] = null;
    if (!mapa.has(String(l.id))) out.id = randomUUID();
    out.tenant_id = destino.tenantId;
    out.owner_id = destino.pessoaId;
    // O destino pode ser uma pessoa de time: o que vem do espaço solo chega só dela, e quem abre para a equipe é ela.
    if ("visibility" in out) out.visibility = "privado";
    if (tabela === "agentes" && "dono" in out) out.dono = "pessoa";
    delete out.search_tsv;
    return { ...out, ...extra };
  };

  const ins = async (tabela: string, linhas: Linha[]) => inserir(trx, tabela, await colunas(trx, tabela), linhas);
  await ins("agentes", agentesACopiar.map((a) => traduzir("agentes", a, { fixado: false, posicao: null })));
  await ins("agente_memorias", mems.map((m) => traduzir("agente_memorias", m)));
  await ins("conversas", conversasACopiar.map((c) => traduzir("conversas", c)));
  await ins("mensagens", msgs.map((m) => traduzir("mensagens", m)));
  const colsAnexo = (await colunas(trx, "anexos")).filter((c) => c !== "conteudo");
  const listaAnexo = colsAnexo.map((c) => `"${c}"`).join(", ");
  for (const a of anxs) {
    await vincularEscopo(trx, origem);
    const [b] = await trx<{ conteudo: Buffer }[]>`select conteudo from anexos where tenant_id = ${origem.tenantId} and id = ${String(a.id)}`;
    await vincularEscopo(trx, destino);
    if (!b) continue;
    // As colunas vêm do catálogo; os valores, de parâmetros.
    await trx.unsafe(
      `insert into public.anexos (${listaAnexo}, "conteudo") select ${listaAnexo}, $2::bytea from json_populate_record(null::public.anexos, ($1::text)::json)`,
      [JSON.stringify(traduzir("anexos", a)), b.conteudo],
    );
  }
  await ins("rotinas", rots.map((r) => traduzir("rotinas", r, { estado: "pausada" })));
  await ins("artefatos", arts.map((a) => traduzir("artefatos", a)));
  await ins("artefato_versoes", vers.map((v) => traduzir("artefato_versoes", v)));
  await ins("artefato_estados", ests.map((e) => traduzir("artefato_estados", e)));

  const contagem: ContagemImportacao = {
    bots: agentesACopiar.filter((a) => a.papel !== "nod").length,
    conversas: conversasACopiar.length + (conversaNodDestino && nodOrigem ? 1 : 0),
    mensagens: msgs.length,
    rotinas: rots.length,
    artefatos: arts.length,
  };
  // As rotinas do espaço de origem param: ninguém mais o vê, e as cópias (pausadas) são as que a pessoa religa.
  await vincularEscopo(trx, origem);
  // NOD-412 (QA do PR #13): a pausa com data também perde a data, senão o agendador a religaria no espaço levado.
  await trx`update rotinas set estado = 'pausada', retomar_em = null where tenant_id = ${origem.tenantId} and owner_id = ${origem.pessoaId} and (estado = 'ativa' or retomar_em is not null)`;
  // ADR-124 §3: o espaço levado fica sem acesso. As chaves de máquina emitidas para ele (o app pede uma por abertura)
  // morrem aqui; as sessões, no chamador (contas.repo).
  await trx`update maquina_tokens set revogado_em = clock_timestamp() where tenant_id = ${origem.tenantId} and owner_id = ${origem.pessoaId} and revogado_em is null`;
  await vincularEscopo(trx, destino);
  await trx`insert into importacoes (tenant_id, owner_id, origem_tenant_id, origem_pessoa_id, contagem)
    values (${destino.tenantId}, ${destino.pessoaId}, ${origem.tenantId}, ${origem.pessoaId}, ${trx.json(contagem)})`;
  return contagem;
}

/** O que o cartão mostra antes de levar (#j3-1): quanto há no espaço provisório. Só leitura, com o escopo da origem. */
export async function contarEspaco(trx: Tx, origem: Escopo): Promise<ContagemImportacao> {
  await vincularEscopo(trx, origem);
  const [r] = await trx<{ bots: number; conversas: number; mensagens: number; rotinas: number; artefatos: number }[]>`
    select
      (select count(*)::int from agentes where tenant_id = ${origem.tenantId} and owner_id = ${origem.pessoaId} and excluido_em is null and papel is distinct from 'nod') as bots,
      (select count(*)::int from conversas c where c.tenant_id = ${origem.tenantId} and c.owner_id = ${origem.pessoaId} and c.sala_id is null
        and exists (select 1 from agentes a where a.tenant_id = c.tenant_id and a.id = c.agente_id and a.excluido_em is null)) as conversas,
      (select count(*)::int from mensagens m join conversas c on c.tenant_id = m.tenant_id and c.id = m.conversa_id
        where m.tenant_id = ${origem.tenantId} and m.owner_id = ${origem.pessoaId} and c.sala_id is null
        and exists (select 1 from agentes a where a.tenant_id = c.tenant_id and a.id = c.agente_id and a.excluido_em is null)) as mensagens,
      (select count(*)::int from rotinas where tenant_id = ${origem.tenantId} and owner_id = ${origem.pessoaId} and excluido_em is null) as rotinas,
      (select count(*)::int from artefatos where tenant_id = ${origem.tenantId} and owner_id = ${origem.pessoaId}) as artefatos`;
  return r ?? { bots: 0, conversas: 0, mensagens: 0, rotinas: 0, artefatos: 0 };
}
