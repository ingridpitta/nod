import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { aplicarLoteQuadro, type PedidoLote } from "../../src/use-cases/quadro.ts";
import { MAX_COMECOS_POR_LOTE } from "../../src/domain/quadro.ts";
import { trabalhoDaTarefa } from "../../src/use-cases/quadro-execucoes.ts";
import { autoriaPessoa } from "../../src/use-cases/autoria-evento.ts";
import { registrarAvisoDoQuadro, registrarConsultaDoQuadro, registrarTrilhaQuadro } from "../../src/use-cases/trilha-quadro.ts";
import { autoriaAgente } from "../../src/use-cases/apoio-l7.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-422 (PR 2): o `scripts/dogfood-quadro.sql` roda escopado numa pessoa, como o app (FORCE RLS), e devolve linhas
 * com dados reais: as métricas que só existem nele (tempo em coluna, conversa aberta sem mensagem em 60 s) não podem
 * sair zeradas. Aqui as consultas rodam dentro da transação escopada do teste, com as variáveis do psql trocadas.
 */

const SCRIPT = readFileSync(new URL("../../scripts/dogfood-quadro.sql", import.meta.url), "utf8");

/** As consultas do script, na ordem, com o título do `\echo` anterior; sem meta-comandos, BEGIN/ROLLBACK e escopo. */
function consultas(vars: Record<string, string>): { titulo: string; sql: string }[] {
  const out: { titulo: string; sql: string }[] = [];
  let titulo = "";
  let atual: string[] = [];
  for (const linha of SCRIPT.split("\n")) {
    const l = linha.trim();
    if (l.startsWith("\\echo '== ")) { titulo = l.slice("\\echo '== ".length, -1); continue; }
    if (l.startsWith("\\") || l.startsWith("--") || l === "") continue;
    atual.push(linha);
    if (l.endsWith(";") || l.endsWith("\\gset")) {
      const sql = atual.join("\n").replace(/\\gset$/, "").replace(/:'(\w+)'/g, (_, k: string) => `'${vars[k] ?? ""}'`).replace(/:(\w+)\b/g, (m, k: string) => (vars[k] ?? m));
      atual = [];
      if (/^(BEGIN|ROLLBACK);$/.test(sql.trim()) || sql.includes("set_config(")) continue;
      out.push({ titulo, sql });
    }
  }
  return out;
}

async function rodar(trx: Tx, anfitriao: string, extra: Record<string, string> = {}) {
  const r = new Map<string, Record<string, unknown>[]>();
  for (const c of consultas({ anfitriao, dias: "7", parada_h: "24", tenant: MARLON.tenantId, pessoa: MARLON.pessoaId, ...extra })) {
    const linhas = (await trx.unsafe(c.sql)) as unknown as Record<string, unknown>[];
    if (/^\s*(select|with)\b/i.test(c.sql)) r.set(c.titulo, [...linhas]);
  }
  return r;
}

/** A linha 'linear' no mesmo lote da criação da tarefa (como a importação grava). `para` null = "fechada no Linear". */
async function linhaDoLinear(trx: Tx, quadroId: string, tarefaId: string, para: string | null, em: string, mesmoLote: boolean | string = true) {
  const [c] = await trx<{ lote_id: string | null }[]>`select lote_id from quadro_tarefa_historico where tarefa_id = ${tarefaId} and campo = 'criada'`;
  await trx.unsafe(`insert into quadro_tarefa_historico (tenant_id, owner_id, tarefa_id, quadro_id, campo, de, para, autor, lote_id, criado_em)
    values ($1, $2, $3, $4, 'linear', null, $5, 'regra', $6, ${em})`, [MARLON.tenantId, MARLON.pessoaId, tarefaId, quadroId, para, typeof mesmoLote === "string" ? mesmoLote : mesmoLote ? (c?.lote_id ?? null) : null]);
}

/** Uma cópia da conversa_aberta que acabou de ser gravada, 2 minutos atrás (a janela de 60 s dela já fechou). */
async function aberturaHa2Minutos(trx: Tx, conversaId: string, minutos = 2) {
  await trx`insert into events (tenant_id, owner_id, kind, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao, executor, locality, locality_reason,
              machine_id, decidido_por, regra_versao, pessoa_destino_id, conversa_id, turno_id, dados, created_at)
            select tenant_id, owner_id, kind, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao, executor, locality, locality_reason,
              machine_id, decidido_por, regra_versao, pessoa_destino_id, conversa_id, turno_id, dados, now() - make_interval(mins => ${minutos})
              from events where kind = 'conversa_aberta' and dados->>'conversa_id' = ${conversaId} order by created_at desc limit 1`;
}

describeIntegracao("as consultas do dogfood do quadro (NOD-422, PR 2)", () => {
  it("com uma linha de cada evento, nenhuma métrica sai zerada; a tarefa importada conta o tempo desde o Linear", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON, { services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON) });
      await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
      const sufixo = Math.random().toString(36).slice(2, 7);
      const host = await agenteComConversa(trx, MARLON, { nome: `Host ${sufixo}` });
      const lote = (ops: Parameters<typeof aplicarLoteQuadro>[1]["ops"]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: host.agenteId, executor: "catcher", ops });
      expect((await lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Importada", status: "backlog" }, { tipo: "criar_tarefa", titulo: "Andou", status: "backlog" }])).data).toMatchObject({ ok: true });
      expect((await lote([{ tipo: "mudar_tarefa", tarefa: "Andou", status: "feito" }])).data).toMatchObject({ ok: true });
      const [q] = await trx<{ id: string }[]>`select id from quadros where agente_id = ${host.agenteId}`;
      const [imp] = await trx<{ id: string }[]>`select id from quadro_tarefas where quadro_id = ${q!.id} and titulo = 'Importada'`;
      // A linha do Linear: "No Linear em Backlog desde" há 3 dias (a importação grava a data de lá, no lote que criou a tarefa).
      await linhaDoLinear(trx, q!.id, imp!.id, "Backlog", "now() - interval '3 days'");
      await executar(d, registrarTrilhaQuadro, { eventos: [
        { acao: "quadro_aberto", quadroId: q!.id, via: "tela" },
        { acao: "tarefa_aberta", quadroId: q!.id, tarefaId: imp!.id, via: "card" },
        { acao: "conversa_aberta", agenteId: host.agenteId, conversaId: host.conversaId },
      ] });
      await trx`update events set created_at = now() - interval '2 minutes' where kind = 'quadro_aberto' and dados->>'quadro_id' = ${q!.id}`;
      await registrarConsultaDoQuadro(d, q!.id, host.agenteId);
      await registrarAvisoDoQuadro(d, { quadroId: q!.id, tipo: "decisao", tarefas: 2, mensagemId: "44444444-4444-4444-8444-444444444444", autoria: autoriaAgente(host.agenteId, MARLON.pessoaId) });
      await aberturaHa2Minutos(trx, host.conversaId);

      const r = await rodar(trx, `Host ${sufixo}`);
      const t = (k: string) => { const v = [...r.entries()].find(([titulo]) => titulo.startsWith(k)); expect(v, k).toBeDefined(); return v![1]; };
      expect(t("O quadro")).toHaveLength(1);
      expect(t("Tarefas movidas por autor").map((l) => [l.autor, Number(l.movidas)])).toEqual([["pessoa", 1]]);
      expect(t("Fluxo entre colunas").map((l) => [l.de, l.para])).toEqual([["backlog", "feito"]]);
      expect(t("Tarefas abertas").map((l) => [l.via, Number(l.aberturas)])).toEqual([["card", 1]]);
      const achar = t("Tempo para achar trabalho")[0]!;
      expect(Number(achar.aberturas_com_trabalho)).toBe(1);
      expect(Number(achar.mediana_seg)).toBeGreaterThanOrEqual(119);
      expect(t("Consultas de estado").map((l) => [Number(l.pela_tela), Number(l.pelo_chat), Number(l.total)])).toEqual([[1, 1, 2]]);
      expect(t("Avisos do quadro").map((l) => [l.tipo, Number(l.avisos), Number(l.tarefas)])).toEqual([["decisao", 1, 2]]);
      const colunas = new Map(t("Tempo em coluna").map((l) => [String(l.coluna), l]));
      expect(Number(colunas.get("backlog")?.passagens)).toBe(2);
      expect(Number(colunas.get("backlog")?.max_h)).toBeGreaterThanOrEqual(71); // a importada: desde o Linear, não desde agora
      expect(Number(colunas.get("feito")?.abertas)).toBe(1);
      expect(t("Conversas de membros").map((l) => [l.bot, Number(l.aberturas), Number(l.sem_mensagem_60s)])).toEqual([[`Host ${sufixo}`, 1, 1]]);
      expect(Number(t("A semana em números")[0]?.criadas)).toBe(2);
    });
  });

  it("revisão do PR #630: a linha mais nova do Linear (fechada, outro estado) não apaga o tempo desde o Linear; a abertura de agora não conta antes de 60 s", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON, { services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON) });
      await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
      const sufixo = Math.random().toString(36).slice(2, 7);
      const host = await agenteComConversa(trx, MARLON, { nome: `Host ${sufixo}` });
      expect((await executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: host.agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Importada", status: "backlog" }] })).data).toMatchObject({ ok: true });
      const [q] = await trx<{ id: string }[]>`select id from quadros where agente_id = ${host.agenteId}`;
      const [imp] = await trx<{ id: string }[]>`select id from quadro_tarefas where quadro_id = ${q!.id} and titulo = 'Importada'`;
      await linhaDoLinear(trx, q!.id, imp!.id, "Backlog", "now() - interval '3 days'");
      // A reimportação depois: "fechada no Linear" (a hora da importação), num lote real que não é o da criação (revisão 2:
      // com lote_id nulo o próprio `lote_id IS NOT NULL` a descartava, e tirar o casamento por lote do JOIN passava).
      expect((await executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: host.agenteId, executor: "catcher", ops: [{ tipo: "criar_tarefa", titulo: "Reimportação", status: "backlog" }] })).data).toMatchObject({ ok: true });
      const [outro] = await trx<{ lote_id: string }[]>`select h.lote_id from quadro_tarefa_historico h join quadro_tarefas t on t.id = h.tarefa_id where t.quadro_id = ${q!.id} and t.titulo = 'Reimportação' and h.campo = 'criada'`;
      expect(outro?.lote_id).toBeTruthy();
      await linhaDoLinear(trx, q!.id, imp!.id, null, "now()", outro!.lote_id);
      await linhaDoLinear(trx, q!.id, imp!.id, "Todo", "now() - interval '1 hour'", outro!.lote_id);
      // Uma abertura agora (a janela de 60 s ainda aberta) e uma de 2 minutos atrás, sem mensagem.
      await executar(d, registrarTrilhaQuadro, { eventos: [{ acao: "conversa_aberta", agenteId: host.agenteId, conversaId: host.conversaId }] });
      await aberturaHa2Minutos(trx, host.conversaId);

      // QA 2 (mutantes A1 e A3): uma abertura de 10 min atrás com fala da pessoa 30 s depois (com mensagem) e uma de 5 min
      // atrás com fala só 2 min depois (fora dos 60 s: sem mensagem). Inverter o filtro da janela fechada ou alargar os 60 s falha.
      for (const [min, depoisS] of [[10, 30], [5, 120]] as const) {
        await aberturaHa2Minutos(trx, host.conversaId, min);
        const fala = await d.repos.mensagens.criar({ conversaId: host.conversaId, autoria: autoriaPessoa(MARLON), kind: "texto", texto: "oi", confianca: "confiavel" });
        await trx`update mensagens set criado_em = now() - make_interval(secs => ${min * 60 - depoisS}) where id = ${fala!.id}`;
      }

      const r = await rodar(trx, `Host ${sufixo}`);
      const t = (k: string) => [...r.entries()].find(([titulo]) => titulo.startsWith(k))?.[1] ?? [];
      const backlog = t("Tempo em coluna").find((l) => l.coluna === "backlog");
      expect(Number(backlog?.max_h)).toBeGreaterThanOrEqual(71);
      // Uma passagem por tarefa (a Importada e a Reimportação): a linha do Linear de outro lote não duplica a entrada.
      expect(Number(backlog?.passagens)).toBe(2);
      expect(t("Conversas de membros").map((l) => [l.bot, Number(l.aberturas), Number(l.sem_mensagem_60s)])).toEqual([[`Host ${sufixo}`, 3, 2]]);
    });
  });

  it("revisão 4 do PR #630: a tarefa excluída sai do tempo em coluna (não fica aberta na última coluna)", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON, { services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON) });
      await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
      const sufixo = Math.random().toString(36).slice(2, 7);
      const host = await agenteComConversa(trx, MARLON, { nome: `Host ${sufixo}` });
      const lote = (ops: Parameters<typeof aplicarLoteQuadro>[1]["ops"]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: host.agenteId, executor: "catcher", ops });
      expect((await lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Fica", status: "backlog" }, { tipo: "criar_tarefa", titulo: "Sai", status: "backlog" }])).data).toMatchObject({ ok: true });
      expect((await lote([{ tipo: "mudar_tarefa", tarefa: "Sai", status: "afazer" }])).data).toMatchObject({ ok: true });
      expect((await lote([{ tipo: "mudar_tarefa", tarefa: "Sai", excluir: true }])).data).toMatchObject({ ok: true });
      const [q] = await trx<{ id: string }[]>`select id from quadros where agente_id = ${host.agenteId}`;
      expect((await trx`select titulo from quadro_tarefas where quadro_id = ${q!.id}`).map((x) => x.titulo)).toEqual(["Fica"]);
      // O histórico da excluída continua lá (o Desfazer a restaura).
      expect((await trx`select 1 from quadro_tarefa_historico where quadro_id = ${q!.id} and campo = 'status'`).length).toBeGreaterThan(0);

      const r = await rodar(trx, `Host ${sufixo}`);
      const tempo = [...r.entries()].find(([titulo]) => titulo.startsWith("Tempo em coluna"))?.[1] ?? [];
      expect(tempo.map((l) => [l.coluna, Number(l.passagens), Number(l.abertas)])).toEqual([["backlog", 1, 1]]);
    });
  });

  it("NOD-343: tempo de ciclo, passagens que começaram sozinhas, intervenções, paradas, erros e freios e rotinas sem novidade", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON, { services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON) });
      await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
      const sufixo = Math.random().toString(36).slice(2, 7);
      const host = await agenteComConversa(trx, MARLON, { nome: `Host ${sufixo}` });
      const beto = await agenteComConversa(trx, MARLON, { nome: `Beto ${sufixo}` });
      const p: PedidoLote = { autor: { tipo: "pessoa" }, anfitriaoId: host.agenteId, executor: "catcher", ops: [] };
      const lote = async (ops: PedidoLote["ops"]) => { const r = await executar(d, aplicarLoteQuadro, { ...p, ops }); expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true }); };
      const titulos = ["Ciclo", "Cancelada", "Passa", "Parada", "Velha", "Antiga feita", "Entregue", "Veio"];
      await lote([{ tipo: "criar_quadro" }, ...titulos.map((titulo) => ({ tipo: "criar_tarefa" as const, titulo, status: "backlog" as const }))]);
      const [q] = await trx<{ id: string }[]>`select id from quadros where agente_id = ${host.agenteId}`;
      const ids = new Map((await trx<{ id: string; titulo: string }[]>`select id, titulo from quadro_tarefas where quadro_id = ${q!.id}`).map((x) => [x.titulo, x.id]));
      const id = (t: string) => ids.get(t)!;

      // 3 · Ciclo: criada há 10 h, terminou agora (10 h). A cancelada termina mas não entra no ciclo. A "Antiga feita" foi
      // feita há 10 dias (fora da janela) e voltou: o 1º Feito dela é o que vale, e está fora.
      await trx`update quadro_tarefa_historico set criado_em = now() - interval '10 hours' where tarefa_id = ${id("Ciclo")} and campo = 'criada'`;
      await lote([{ tipo: "mudar_tarefa", tarefa: "Ciclo", status: "feito" }, { tipo: "mudar_tarefa", tarefa: "Cancelada", status: "cancelado" }, { tipo: "mudar_tarefa", tarefa: "Antiga feita", status: "feito" }]);
      await trx`update quadro_tarefa_historico set criado_em = now() - interval '10 days' where tarefa_id = ${id("Antiga feita")} and campo in ('criada', 'status')`;
      await lote([{ tipo: "mudar_tarefa", tarefa: "Antiga feita", status: "backlog" }]);
      await lote([{ tipo: "mudar_tarefa", tarefa: "Antiga feita", status: "feito" }]);

      // 3 · Uma coluna da pessoa no grupo Feito (c-entregue): a Entregue, importada do Linear há 30 h (criada há 20 h), entra
      // nela agora. Ciclo de 30 h (desde o Linear): com a Ciclo, mediana 20, p90 28. Ela também não conta como parada (6).
      await trx`update quadro_tarefa_historico set criado_em = now() - interval '20 hours' where tarefa_id = ${id("Entregue")} and campo = 'criada'`;
      await linhaDoLinear(trx, q!.id, id("Entregue"), "Backlog", "now() - interval '30 hours'");
      await trx`insert into quadro_tarefa_historico (tenant_id, owner_id, tarefa_id, quadro_id, campo, de, para, autor, criado_em)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${id("Entregue")}, ${q!.id}, 'status', 'backlog', 'c-entregue', 'pessoa', now())`;
      // 3 · Revisão do PR #688: a Veio nasceu em OUTRO quadro há 20 h (a linha 'criada' fica com o quadro de origem) e
      // termina aqui agora. Entra no ciclo (antes sumia: o começo só era procurado neste quadro). Ciclos 10, 20 e 30 h.
      await trx`update quadro_tarefa_historico set quadro_id = gen_random_uuid(), criado_em = now() - interval '20 hours' where tarefa_id = ${id("Veio")} and campo = 'criada'`;
      await trx`insert into quadro_tarefa_historico (tenant_id, owner_id, tarefa_id, quadro_id, campo, de, para, autor, criado_em)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${id("Veio")}, ${q!.id}, 'status', 'backlog', 'feito', 'pessoa', now())`;

      // 4 · Passagem pela pessoa: Passa entra em Fazendo com o Beto e o trabalho começa sozinho.
      await lote([{ tipo: "mudar_tarefa", tarefa: "Passa", status: "fazendo", agente: `Beto ${sufixo}` }]);
      expect((await trx`select 1 from quadro_execucoes where tarefa_id = ${id("Passa")} and origem = 'inicio'`).length).toBe(1);
      // Movimentos à mão (autor null = a pessoa; o padrão é o anfitrião), `min` minutos atrás.
      const mov = (tarefa: string, tipo: string, de: string, para: string, o: { autor?: string | null; antes?: string | null; acionou?: boolean; min?: number } = {}) => {
        const autor = o.autor === undefined ? host.agenteId : o.autor;
        return trx`insert into quadro_movimentos
          (tenant_id, owner_id, quadro_id, tarefa_id, tipo, de, para, agente_antes, agente_depois, autor, autor_agente_id, acionou, criado_em)
          values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${q!.id}, ${id(tarefa)}, ${tipo}, ${de}, ${para}, ${o.antes ?? null}, ${beto.agenteId},
                  ${autor ? "agente" : "pessoa"}, ${autor}, ${o.acionou ?? false}, now() - make_interval(mins => ${o.min ?? 0}))`;
      };
      const trabalho = (tarefa: string, numero: number, origem: string, min: number) => trx`insert into quadro_execucoes (tenant_id, owner_id, tarefa_id, numero, origem, turno_id, criado_em)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${id(tarefa)}, ${numero}, ${origem}, gen_random_uuid(), now() - make_interval(mins => ${min}))`;
      // O anfitrião passa a Velha ao Beto há 60 min e ela não começou: o 'inicio' de 10 min antes e o de agora (60 min
      // depois) ficam fora da janela, e o 'comentario' 1 min depois não é começo.
      await mov("Velha", "mover", "backlog", "revisao", { acionou: true, min: 60 });
      await trabalho("Velha", 100, "inicio", 70);
      await trabalho("Velha", 101, "comentario", 59);
      await trabalho("Velha", 102, "inicio", 0);
      // A pessoa passa a Velha ao Beto numa coluna dela do grupo Iniciado (c-producao), há 30 min, e não começou.
      await mov("Velha", "mover", "afazer", "c-producao", { autor: null, min: 30 });
      // Não são passagens: ir para Bloqueado; a pessoa andar no andamento com o mesmo responsável (Fazendo → Em revisão não
      // aciona, deveComecar); o Beto se pôr na própria tarefa (o bot não se reinicia).
      await mov("Velha", "mover", "revisao", "bloqueado");
      await mov("Velha", "mover", "fazendo", "revisao", { autor: null, antes: beto.agenteId });
      await mov("Velha", "mover", "backlog", "fazendo", { autor: beto.agenteId });
      // Nem entrar em Em revisão vindo de fora com o mesmo responsável (lá só a troca de mão aciona).
      await mov("Velha", "mover", "backlog", "revisao", { autor: null, antes: beto.agenteId, min: 40 });
      // É passagem (revisão do PR #688): a pessoa põe em Fazendo, vindo do Backlog, a tarefa que já era do Beto (o mesmo
      // responsável, mas entrar no andamento aciona, deveComecar), há 20 min, e o trabalho começa.
      await mov("Velha", "mover", "backlog", "fazendo", { autor: null, antes: beto.agenteId, min: 20 });
      await trabalho("Velha", 104, "inicio", 20);

      // 5 · Intervenções: recado, cancelar e repetir no trabalho da Passa (a tela). Cancelar depois não desfaz o começo (4).
      const op = async (o: { tipo: "repetir_trabalho" } | { tipo: "cancelar_trabalho" } | { tipo: "recado"; texto: string }) => {
        const r = await trabalhoDaTarefa(d, p, { ...o, tarefa: "Passa" } as Parameters<typeof trabalhoDaTarefa>[2]);
        expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      };
      await op({ tipo: "recado", texto: "olha o teste" });
      await op({ tipo: "cancelar_trabalho" });
      await op({ tipo: "repetir_trabalho" });
      await trabalho("Passa", 103, "resposta", 0);

      // 6 · Paradas: Parada em A fazer há 30 h conta; Velha em Backlog há 48 h e a Ciclo em Feito há 48 h, não.
      await lote([{ tipo: "mudar_tarefa", tarefa: "Parada", status: "afazer" }]);
      await trx`update quadro_tarefas set na_coluna_desde = now() - interval '30 hours' where id = ${id("Parada")}`;
      await trx`update quadro_tarefas set status = 'c-entregue' where id = ${id("Entregue")}`;
      await trx`update quadro_tarefas set na_coluna_desde = now() - interval '48 hours' where id in (${id("Velha")}, ${id("Ciclo")}, ${id("Entregue")})`;

      // 7 · Erros e freios: um trabalho que falhou, uma nova tentativa automática, um laço, um freio e uma recusa.
      await trx`update quadro_execucoes set desfecho = 'falhou', tratada_em = now() where tarefa_id = ${id("Passa")} and numero = 1`;
      await trx`insert into quadro_execucoes (tenant_id, owner_id, tarefa_id, numero, origem, turno_id)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${id("Passa")}, 99, 'automatica', gen_random_uuid())`;
      await mov("Velha", "laco", "revisao", "bloqueado", { autor: beto.agenteId });
      await mov("Velha", "freio", "revisao", "bloqueado", { autor: beto.agenteId });
      await mov("Velha", "nao_e_comigo", "revisao", "revisao", { autor: beto.agenteId });

      // 10 · Rotinas do Beto: antes de assumir, 2 rodaram e 1 sem novidade; depois, 1 sem novidade (regravada de executou),
      // e uma que não rodou (fora da conta).
      const [rot] = await trx<{ id: string }[]>`insert into rotinas (tenant_id, owner_id, agente_id, conversa_id, cron, fuso_iana, instrucao, fonte, entregavel, limites_aprovacao, politica_sem_dado, proxima_execucao)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${beto.agenteId}, ${beto.conversaId}, '*/30 * * * *', 'UTC', 'x', 'f', 'e', 'l', 'p', now() + interval '1 hour') returning id`;
      await trx`update quadros set assumido_em = now() - interval '2 days' where id = ${q!.id}`;
      const rotina = (execucaoId: string, desfecho: string, horas: number) => trx`insert into events (tenant_id, owner_id, kind, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao, executor, locality, locality_reason,
              machine_id, decidido_por, regra_versao, pessoa_destino_id, conversa_id, turno_id, dados, created_at)
            select tenant_id, owner_id, 'rotina_executou', autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao, executor, locality, locality_reason,
              machine_id, decidido_por, regra_versao, pessoa_destino_id, ${beto.conversaId}, null,
              ${trx.json({ rotinaId: rot!.id, execucaoId, desfecho, motivo: null, instanteAgendado: 0 })}, now() - make_interval(hours => ${horas})
              from events where kind = 'tarefa_movida' and dados->>'quadro_id' = ${q!.id} limit 1`;
      await rotina("11111111-1111-4111-8111-111111111111", "executou", 72);
      await rotina("22222222-2222-4222-8222-222222222222", "sem_novidade", 71);
      await rotina("33333333-3333-4333-8333-333333333333", "executou", 10);
      await rotina("33333333-3333-4333-8333-333333333333", "sem_novidade", 9);
      await rotina("44444444-4444-4444-8444-444444444444", "nao_rodou", 8);

      // As colunas da pessoa (quadros.colunas): c-producao no grupo Iniciado e c-entregue no Feito.
      const colunas = [["backlog", "nao_iniciado"], ["afazer", "nao_iniciado"], ["fazendo", "iniciado"], ["c-producao", "iniciado"], ["revisao", "iniciado"],
        ["bloqueado", "iniciado"], ["voce", "iniciado"], ["feito", "feito"], ["c-entregue", "feito"], ["cancelado", "fechado"]].map(([cid, grupo]) => ({ id: cid, nome: cid, grupo }));
      await trx`update quadros set colunas = ${trx.json(colunas)} where id = ${q!.id}`;

      const r = await rodar(trx, `Host ${sufixo}`);
      const t = (k: string) => { const v = [...r.entries()].find(([titulo]) => titulo.startsWith(k)); expect(v, k).toBeDefined(); return v![1]; };

      const ciclo = t("Tempo de ciclo")[0]!;
      expect(Number(ciclo.terminadas)).toBe(3);
      for (const [k, v] of [["media_h", 20], ["mediana_h", 20], ["p90_h", 28]] as const) {
        expect(Number(ciclo[k]), k).toBeGreaterThanOrEqual(v - 0.1);
        expect(Number(ciclo[k]), k).toBeLessThan(v + 0.2);
      }

      expect(t("Passagens automáticas").map((l) => [l.autor, Number(l.passagens), Number(l.acionaram), Number(l.comecaram), Number(l.pct_comecaram)]))
        .toEqual([["agente", 1, 1, 0, 0], ["pessoa", 3, 1, 2, 66.7], ["total", 4, 2, 2, 50]]);

      const iv = t("Intervenções manuais")[0]!;
      // 7 movimentos dos lotes + os 4 à mão da pessoa; terminadas: Ciclo, Cancelada, Antiga feita, Entregue e Veio.
      expect([iv.movimentos_da_pessoa, iv.recados, iv.repeticoes, iv.respostas, iv.cancelamentos, iv.total, iv.terminadas, iv.por_terminada].map(Number))
        .toEqual([11, 1, 1, 1, 1, 15, 5, 3]);

      expect(t("Paradas").map((l) => [l.coluna, Number(l.paradas)])).toEqual([["afazer", 1]]);
      expect(Number(t("Paradas")[0]!.max_h)).toBeGreaterThanOrEqual(29.9);

      const er = t("Erros e freios")[0]!;
      expect([er.falharam, er.novas_tentativas, er.lacos, er.freios, er.recusas].map(Number)).toEqual([1, 1, 1, 1, 1]);

      expect(t("Rotinas sem novidade").map((l) => [l.bot, l.periodo, Number(l.rodaram), Number(l.sem_novidade), Number(l.pct_sem_novidade)]))
        .toEqual([[`Beto ${sufixo}`, "antes", 2, 1, 50], [`Beto ${sufixo}`, "depois", 1, 1, 100]]);
    });
  });

  // Regression: ISSUE-001 — a passagem segurada pelo teto do lote (volta para A fazer, sem começar) sumia das passagens
  // Found by /qa on 2026-11-05 (QA do PR #688). Também reforça as janelas e o nullif das rotinas (mutantes que passavam).
  it("QA do PR #688: a passagem segurada (a 9ª do lote volta para A fazer) conta como passagem que não começou; o que é de antes da janela fica de fora", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON, { services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON) });
      await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
      const sufixo = Math.random().toString(36).slice(2, 7);
      const host = await agenteComConversa(trx, MARLON, { nome: `Host ${sufixo}` });
      const beto = await agenteComConversa(trx, MARLON, { nome: `Beto ${sufixo}` });
      const caio = await agenteComConversa(trx, MARLON, { nome: `Caio ${sufixo}` });
      const p: PedidoLote = { autor: { tipo: "pessoa" }, anfitriaoId: host.agenteId, executor: "catcher", ops: [] };
      const lote = async (ops: PedidoLote["ops"]) => { const r = await executar(d, aplicarLoteQuadro, { ...p, ops }); expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true }); };
      const titulos = Array.from({ length: MAX_COMECOS_POR_LOTE + 1 }, (_, i) => `T${i}`);
      await lote([{ tipo: "criar_quadro" }, ...titulos.map((titulo) => ({ tipo: "criar_tarefa" as const, titulo, status: "backlog" as const }))]);
      // Todas para Fazendo com o Beto num lote só: 8 começam; a 9ª é segurada e fica em A fazer (o movimento grava "afazer").
      await lote(titulos.map((tarefa) => ({ tipo: "mudar_tarefa" as const, tarefa, status: "fazendo" as const, agente: `Beto ${sufixo}` })));
      const [q] = await trx<{ id: string }[]>`select id from quadros where agente_id = ${host.agenteId}`;
      const segurada = await trx<{ tarefa_id: string }[]>`select tarefa_id from quadro_movimentos where quadro_id = ${q!.id} and para = 'afazer' and not acionou`;
      expect(segurada).toHaveLength(1);
      const tid = segurada[0]!.tarefa_id;
      const mov = (tipo: string, para: string, autor: string | null, dias: number) => trx`insert into quadro_movimentos
          (tenant_id, owner_id, quadro_id, tarefa_id, tipo, de, para, agente_antes, agente_depois, autor, autor_agente_id, criado_em)
          values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${q!.id}, ${tid}, ${tipo}, 'backlog', ${para}, null, ${beto.agenteId},
                  ${autor ? "agente" : "pessoa"}, ${autor}, now() - make_interval(days => ${dias}))`;
      // Agora: um desfazer da pessoa, 2 laços e 1 freio. Há 8 dias (fora da janela de 7): uma passagem da pessoa, um laço,
      // um recado e um repetir.
      await mov("desfazer", "afazer", null, 0);
      await mov("laco", "bloqueado", beto.agenteId, 0);
      await mov("laco", "bloqueado", beto.agenteId, 0);
      await mov("freio", "bloqueado", beto.agenteId, 0);
      await mov("mover", "fazendo", null, 8);
      await mov("laco", "bloqueado", beto.agenteId, 8);
      await trx`insert into quadro_recados (tenant_id, owner_id, tarefa_id, texto, criado_em) values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${tid}, 'x', now() - interval '8 days')`;
      await trx`insert into quadro_execucoes (tenant_id, owner_id, tarefa_id, numero, origem, turno_id, criado_em)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${tid}, 50, 'repetir', gen_random_uuid(), now() - interval '8 days')`;
      // Rotinas do Caio: uma que rodou há 10 dias (fora da janela) e uma que não rodou agora (o % fica vazio, sem dividir por 0).
      const [rot] = await trx<{ id: string }[]>`insert into rotinas (tenant_id, owner_id, agente_id, conversa_id, cron, fuso_iana, instrucao, fonte, entregavel, limites_aprovacao, politica_sem_dado, proxima_execucao)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${caio.agenteId}, ${caio.conversaId}, '*/30 * * * *', 'UTC', 'x', 'f', 'e', 'l', 'p', now() + interval '1 hour') returning id`;
      for (const [execucaoId, desfecho, horas] of [["55555555-5555-4555-8555-555555555555", "executou", 240], ["66666666-6666-4666-8666-666666666666", "nao_rodou", 1]] as const) {
        await trx`insert into events (tenant_id, owner_id, kind, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao, executor, locality, locality_reason,
              machine_id, decidido_por, regra_versao, pessoa_destino_id, conversa_id, turno_id, dados, created_at)
            select tenant_id, owner_id, 'rotina_executou', autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao, executor, locality, locality_reason,
              machine_id, decidido_por, regra_versao, pessoa_destino_id, ${caio.conversaId}, null,
              ${trx.json({ rotinaId: rot!.id, execucaoId, desfecho, motivo: null, instanteAgendado: 0 })}, now() - make_interval(hours => ${horas})
              from events where kind = 'tarefa_movida' and dados->>'quadro_id' = ${q!.id} limit 1`;
      }

      const r = await rodar(trx, `Host ${sufixo}`);
      const t = (k: string) => { const v = [...r.entries()].find(([titulo]) => titulo.startsWith(k)); expect(v, k).toBeDefined(); return v![1]; };
      const n = MAX_COMECOS_POR_LOTE;
      const pct = Math.round((1000 * n) / (n + 1)) / 10;
      expect(t("Passagens automáticas").map((l) => [l.autor, Number(l.passagens), Number(l.acionaram), Number(l.comecaram), Number(l.pct_comecaram)]))
        .toEqual([["pessoa", n + 1, n, n, pct], ["total", n + 1, n, n, pct]]);
      const iv = t("Intervenções manuais")[0]!;
      expect([iv.movimentos_da_pessoa, iv.recados, iv.repeticoes, iv.respostas, iv.cancelamentos, iv.total, iv.terminadas].map(Number))
        .toEqual([n + 2, 0, 0, 0, 0, n + 2, 0]);
      expect(iv.por_terminada).toBeNull();
      const er = t("Erros e freios")[0]!;
      expect([er.falharam, er.novas_tentativas, er.lacos, er.freios, er.recusas].map(Number)).toEqual([0, 0, 2, 1, 0]);
      expect(t("Rotinas sem novidade").map((l) => [l.bot, l.periodo, Number(l.rodaram), Number(l.sem_novidade), l.pct_sem_novidade]))
        .toEqual([[`Caio ${sufixo}`, "sem assumir", 0, 0, null]]);
    });
  });
});
