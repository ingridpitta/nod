import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { NovaMensagem } from "../../src/repositories/mensagens.repo.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import type { Tx } from "../../src/shared/types.ts";
import { contarAtividade, lerAtividade } from "../../src/use-cases/atividade.ts";
import { criarSala } from "../../src/use-cases/criar-sala.ts";
import { lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { registrarRelato } from "../../src/use-cases/registrar-relato.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa, autoriaAgente, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * A janela da conversa própria conta só o chat (chat limpo, PR 2; ADR-114, emenda do PR 2): as 200 mais recentes que o
 * chat mostra, os `anexo` desde o corte, nada do que mora na Atividade. E a linha sem assunto (antes do backfill) conta
 * como chat no SQL e ganha o destino na leitura pelo texto.
 */

const T0 = Date.UTC(2026, 9, 18, 9, 0);

/** Grava a mensagem e põe o relógio dela (o do banco é clock_timestamp). */
async function gravar(trx: Tx, repos: Repos, m: NovaMensagem, quando: number): Promise<string> {
  const criada = await repos.mensagens.criar(m);
  if (!criada) throw new Error("mensagem não criada");
  await trx`update mensagens set criado_em = ${new Date(quando)} where id = ${criada.id}`;
  return criada.id;
}

/**
 * `n` cópias da mensagem `modelo`, uma por milissegundo a partir de `desde` (num insert só: 1.000 avisos pelo repositório
 * levariam o teste para longe do prazo). `assunto` e `texto` da cópia vêm de fora; o resto é o do modelo.
 */
async function copias(trx: Tx, modelo: string, n: number, desde: number, opcoes: { texto: string; assunto: string | null; turnoId?: string | null }): Promise<void> {
  await trx`
    insert into mensagens (tenant_id, id, owner_id, conversa_id, turno_id, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao,
      executor, locality, locality_reason, machine_id, decidido_por, regra_versao, kind, texto, payload, confianca, parcial, assunto, criado_em)
    select tenant_id, gen_random_uuid(), owner_id, conversa_id, ${opcoes.turnoId === undefined ? trx`turno_id` : opcoes.turnoId}, autor_tipo, autor_id, sob_procuracao_de,
      conta_de_execucao, executor, locality, locality_reason, machine_id, decidido_por, regra_versao, kind, ${opcoes.texto} || ' ' || g, payload, confianca,
      parcial, ${opcoes.assunto}, ${new Date(desde)}::timestamptz + g * interval '1 millisecond'
    from mensagens, generate_series(1, ${n}) g where id = ${modelo}`;
}

describeIntegracao("janela da conversa própria (chat limpo, PR 2)", () => {
  it("1.000 avisos seguidos depois das falas: a janela ainda traz as 200 últimas falas e nenhum aviso", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const fala = await gravar(trx, repos, { conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "fala 0", confianca: "confiavel" }, T0);
      await copias(trx, fala, 249, T0, { texto: "fala", assunto: null });
      const aviso = await gravar(trx, repos, { conversaId, autoria: autoriaAgente(agenteId, PESSOA_MARLON), kind: "sistema", assunto: "memoria.anotada", texto: "Anotei", confianca: "confiavel" }, T0 + 10_000);
      await copias(trx, aviso, 999, T0 + 10_000, { texto: "Anotei", assunto: "memoria.anotada" });

      const deps = depsSobreTrx(trx, MARLON);
      const { mensagens } = (await executar(deps, lerConversa, { conversaId })).data;
      expect(mensagens).toHaveLength(200);
      expect(mensagens.every((m) => m.kind === "texto" && m.destino === "chat")).toBe(true);
      expect(mensagens.at(-1)?.texto).toBe("fala 249");
      expect(mensagens[0]?.texto).toBe("fala 50");
    });
  });

  it("o anexo vem desde o corte, nunca de antes; a conversa com menos de 200 itens de chat traz tudo menos a Atividade", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const bot = autoriaAgente(agenteId, PESSOA_MARLON);
      const trabalhoId = randomUUID();
      const abertura = (titulo: string): NovaMensagem => ({ conversaId, autoria: bot, kind: "sistema", texto: `Abriu a task ${titulo}`, payload: { kind: "trabalho_aberto", trabalhoId, titulo, origem: "pessoa" }, confianca: "confiavel" });
      const fala = await gravar(trx, repos, { conversaId, autoria: bot, kind: "texto", texto: "fala 0", confianca: "confiavel" }, T0);
      await copias(trx, fala, 299, T0, { texto: "fala", assunto: null });
      const antes = await gravar(trx, repos, abertura("antiga"), T0 + 50);
      const depois = await gravar(trx, repos, abertura("nova"), T0 + 250);
      const aviso = await gravar(trx, repos, { conversaId, autoria: bot, kind: "sistema", assunto: "compactacao", texto: "Conversa compactada", confianca: "confiavel" }, T0 + 260);

      const deps = depsSobreTrx(trx, MARLON);
      const cheia = (await executar(deps, lerConversa, { conversaId })).data.mensagens;
      const ids = new Set(cheia.map((m) => m.id));
      expect(cheia.filter((m) => m.kind === "texto")).toHaveLength(200);
      expect(ids.has(depois)).toBe(true);
      expect(cheia.find((m) => m.id === depois)?.destino).toBe("anexo");
      expect(ids.has(antes)).toBe(false);
      expect(ids.has(aviso)).toBe(false);

      // Menos de 200 itens de chat: nenhum corte; o anexo antigo volta, a Atividade continua de fora.
      const curta = await agenteComConversa(trx, MARLON);
      const botCurta = autoriaAgente(curta.agenteId, PESSOA_MARLON);
      const a = await gravar(trx, curta.repos, { conversaId: curta.conversaId, autoria: botCurta, kind: "sistema", texto: "Abriu a task X", payload: { kind: "trabalho_aberto", trabalhoId, titulo: "X", origem: "pessoa" }, confianca: "confiavel" }, T0);
      const f = await gravar(trx, curta.repos, { conversaId: curta.conversaId, autoria: botCurta, kind: "texto", texto: "oi", confianca: "confiavel" }, T0 + 1);
      const n = await gravar(trx, curta.repos, { conversaId: curta.conversaId, autoria: botCurta, kind: "negacao", texto: "Bash negada", payload: { kind: "negacao", classe: "ferramenta_negada", nome: "Bash", motivo: "fora_do_catalogo", terminal: false }, confianca: "confiavel" }, T0 + 2);
      const r = await gravar(trx, curta.repos, { conversaId: curta.conversaId, autoria: botCurta, kind: "sistema", texto: "Rotina pausada: todo dia", payload: { kind: "rotina_evento", rotinaId: randomUUID(), acao: "pausada", resumo: "todo dia" }, confianca: "confiavel" }, T0 + 3);
      const lidas = (await executar(deps, lerConversa, { conversaId: curta.conversaId })).data.mensagens;
      expect(lidas.map((m) => [m.id, m.destino])).toEqual([[a, "anexo"], [f, "chat"], [r, "chat"]]);
      expect(lidas.some((m) => m.id === n)).toBe(false);
    });
  });

  it("a fala do meio de uma task conta como anexo: um dia de frentes não empurra as falas da conversa para fora", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const bot = autoriaAgente(agenteId, PESSOA_MARLON);
      const trabalho = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Hero", origem: "pessoa", forma: "frente" });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: T0 + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m", trabalhoId: trabalho!.id });
      const fala = await gravar(trx, repos, { conversaId, autoria: bot, kind: "texto", texto: "conversa 0", confianca: "confiavel" }, T0);
      await copias(trx, fala, 199, T0, { texto: "conversa", assunto: null, turnoId: null });
      const daTask = await gravar(trx, repos, { conversaId, turnoId: turno!.id, autoria: bot, kind: "texto", texto: "task 0", confianca: "confiavel" }, T0 + 1_000);
      await copias(trx, daTask, 150, T0 + 1_000, { texto: "task", assunto: null });

      const deps = depsSobreTrx(trx, MARLON);
      const lidas = (await executar(deps, lerConversa, { conversaId })).data.mensagens;
      expect(lidas.filter((m) => m.texto.startsWith("conversa"))).toHaveLength(200);
      expect(lidas.filter((m) => m.texto.startsWith("task"))).toHaveLength(151);
      expect(lidas.find((m) => m.texto === "conversa 0")).toBeDefined();
    });
  });

  it("a linha 'Rotina executou' vem como anexo: a web sabe que a execução teve resultado e não o recolhe em 'nada para você'", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      await trx`update agentes set criado_em = ${new Date(T0 - 86_400_000)} where id = ${agenteId}`;
      const bot = autoriaAgente(agenteId, PESSOA_MARLON);
      const fala = await gravar(trx, repos, { conversaId, autoria: bot, kind: "texto", texto: "conversa 0", confianca: "confiavel" }, T0);
      await copias(trx, fala, 199, T0, { texto: "conversa", assunto: null });
      const executou = await gravar(trx, repos, { conversaId, autoria: bot, kind: "rotina_execucao", texto: "Rotina executou em 18/10 09:00", payload: { kind: "rotina_execucao", rotinaId: randomUUID(), instanteAgendado: T0, desfecho: "executou" }, confianca: "confiavel" }, T0 + 1_000);
      const resultado = await gravar(trx, repos, { conversaId, autoria: bot, kind: "texto", texto: "A Gabriela marcou você", confianca: "confiavel" }, T0 + 1_001);

      const deps = depsSobreTrx(trx, MARLON);
      const lidas = (await executar(deps, lerConversa, { conversaId })).data.mensagens;
      expect(lidas.find((m) => m.id === executou)?.destino).toBe("anexo");
      expect(lidas.find((m) => m.id === resultado)?.destino).toBe("chat");
      // Não conta como item de chat: as 200 falas cabem junto com o resultado (201 de chat pedidas, 200 trazidas).
      expect(lidas.filter((m) => m.destino === "chat")).toHaveLength(200);
      // E continua na Atividade do dia.
      const { data } = await executar(deps, lerAtividade, { agenteId, dia: "2026-10-18", fuso: "UTC" });
      expect(data.itens.some((i) => i.id === executou)).toBe(true);
    });
  });

  it("anexos acima do teto: a janela encurta, sem buraco — nada de fala da pessoa sem o resultado da task (revisão do PR 2)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const bot = autoriaAgente(agenteId, PESSOA_MARLON);
      const trabalho = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Hero", origem: "pessoa", forma: "frente" });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: T0 + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m", trabalhoId: trabalho!.id });
      // 250 falas da pessoa, uma por segundo (o corte cai na 50ª, em T0 + 50 s); 400 falas de task entre T0 + 100 s e
      // T0 + 140 s — só as 300 mais recentes cabem, desde T0 + 110 s.
      const fala = await gravar(trx, repos, { conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "pedido 0", confianca: "confiavel" }, T0);
      await copias(trx, fala, 249, T0 - 1_000, { texto: "pedido", assunto: null });
      await trx`update mensagens set criado_em = ${new Date(T0)}::timestamptz + (split_part(texto, ' ', 2)::int) * interval '1 second' where conversa_id = ${conversaId}`;
      const daTask = await gravar(trx, repos, { conversaId, turnoId: turno!.id, autoria: bot, kind: "texto", texto: "task 0", confianca: "confiavel" }, T0 + 100_000);
      await copias(trx, daTask, 399, T0 + 100_000, { texto: "task", assunto: null });
      await trx`update mensagens set criado_em = ${new Date(T0 + 100_000)}::timestamptz + (split_part(texto, ' ', 2)::int) * interval '100 milliseconds' where conversa_id = ${conversaId} and texto like 'task %'`;

      const deps = depsSobreTrx(trx, MARLON);
      const lidas = (await executar(deps, lerConversa, { conversaId })).data.mensagens;
      const pedidos = lidas.filter((m) => m.texto.startsWith("pedido"));
      const tasks = lidas.filter((m) => m.texto.startsWith("task"));
      expect(tasks).toHaveLength(300);
      const piso = Math.min(...tasks.map((m) => m.criadoEm));
      expect(piso).toBe(T0 + 110_000);
      // Nenhum item de chat de antes do piso: os pedidos de T0 + 50 s a T0 + 109 s saem junto com as falas de task cortadas.
      expect(pedidos.every((m) => m.criadoEm >= piso)).toBe(true);
      expect(pedidos).toHaveLength(140);
    });
  });

  it("a sala fica como hoje: as 200 mais recentes, sem destino, com os avisos", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const deps = depsSobreTrx(trx, MARLON);
      const sala = (await executar(deps, criarSala, { nome: "revisão", agenteIds: [vera.agenteId, tuca.agenteId] })).data.conversa;
      const aviso = await gravar(trx, vera.repos, { conversaId: sala.id, autoria: autoriaAgente(vera.agenteId, PESSOA_MARLON), kind: "sistema", assunto: "memoria.anotada", texto: "Anotei", confianca: "confiavel" }, T0);
      await copias(trx, aviso, 220, T0, { texto: "Anotei", assunto: "memoria.anotada" });
      const lidas = (await executar(deps, lerConversa, { conversaId: sala.id })).data.mensagens;
      expect(lidas).toHaveLength(200);
      expect(lidas.every((m) => m.destino === undefined)).toBe(true);
    });
  });

  it("sem backfill: a linha sem assunto conta como chat no SQL (a janela é a de antes) e ganha o destino pelo texto", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const bot = autoriaAgente(agenteId, PESSOA_MARLON);
      const base = { conversaId, autoria: bot, confianca: "confiavel" as const };
      // A primeira linha é a criação do bot, com uma frase que nenhum molde conhece: fica no chat pela regra da primeira.
      const nasceu = await gravar(trx, repos, { ...base, kind: "sistema", assunto: "agente.criado", texto: "Uma frase antiga de nascimento." }, T0);
      const anotei = await gravar(trx, repos, { ...base, kind: "sistema", assunto: "memoria.anotada", texto: "Anotei uma preferência: em reais" }, T0 + 1);
      const pausa = await gravar(trx, repos, { ...base, kind: "sistema", assunto: "rotina.evento", texto: "Rotina pausada: todo dia às 9h" }, T0 + 2);
      const negada = await gravar(trx, repos, { ...base, kind: "negacao", texto: "Bash negada", payload: { kind: "negacao", classe: "ferramenta_negada", nome: "Bash", motivo: "fora_do_catalogo", terminal: false } }, T0 + 3);
      const respondi = await gravar(trx, repos, { ...base, kind: "sistema", texto: "Respondi ao pedido de Ada", payload: { kind: "pedido_respondido", loteId: randomUUID(), agenteId: randomUUID(), nome: "Ada" } }, T0 + 4);
      const fala = await gravar(trx, repos, { ...base, kind: "texto", texto: "Pronto." }, T0 + 5);
      // Como a linha gravada antes da 0091: sem assunto.
      await trx`update mensagens set assunto = null where conversa_id = ${conversaId}`;

      const deps = depsSobreTrx(trx, MARLON);
      const lidas = (await executar(deps, lerConversa, { conversaId })).data.mensagens;
      expect(new Map(lidas.map((m) => [m.id, m.destino]))).toEqual(new Map([[nasceu, "chat"], [anotei, "atividade"], [pausa, "chat"], [negada, "atividade"], [respondi, "anexo"], [fala, "chat"]]));

      // Nada some por causa da janela: com 250 avisos sem assunto, a janela é a das 200 mais recentes, como antes do PR 2.
      await copias(trx, anotei, 250, T0 + 10_000, { texto: "Anotei uma preferência: em reais", assunto: null });
      const cheia = (await executar(deps, lerConversa, { conversaId })).data.mensagens;
      const crua = await repos.mensagens.listarDaConversa(conversaId, 200);
      expect(cheia.map((m) => m.id)).toEqual(crua.map((m) => m.id));
      expect(cheia.every((m) => m.destino === "atividade")).toBe(true);
    });
  });

  it("sem backfill, a Atividade do dia lista o aviso antigo pelo texto e não lista o que fica no chat; a contagem bate", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      await trx`update agentes set criado_em = ${new Date(T0 - 86_400_000)} where id = ${agenteId}`;
      const bot = autoriaAgente(agenteId, PESSOA_MARLON);
      const base = { conversaId, autoria: bot, confianca: "confiavel" as const };
      await gravar(trx, repos, { ...base, kind: "sistema", assunto: "agente.criado", texto: "Uma frase antiga de nascimento." }, T0);
      const anotei = await gravar(trx, repos, { ...base, kind: "sistema", assunto: "memoria.anotada", texto: "Anotei uma preferência: em reais" }, T0 + 60_000);
      await gravar(trx, repos, { ...base, kind: "sistema", assunto: "rotina.evento", texto: "Rotina pausada: todo dia às 9h" }, T0 + 120_000);
      const negada = await gravar(trx, repos, { ...base, kind: "negacao", texto: "Bash negada", payload: { kind: "negacao", classe: "ferramenta_negada", nome: "Bash", motivo: "fora_do_catalogo", terminal: false } }, T0 + 180_000);
      await gravar(trx, repos, { ...base, kind: "texto", texto: "Pronto." }, T0 + 240_000);
      await trx`update mensagens set assunto = null where conversa_id = ${conversaId}`;

      const deps = depsSobreTrx(trx, MARLON);
      const { data } = await executar(deps, lerAtividade, { agenteId, dia: "2026-10-18", fuso: "UTC" });
      expect(data.itens.map((i) => i.id)).toEqual([negada, anotei]);
      expect(data.itens[1]).toMatchObject({ titulo: "Anotou na memória", categoria: null });
      expect(data.total).toBe(2);
      expect((await executar(deps, contarAtividade, { agenteId, dia: "2026-10-18", fuso: "UTC" })).data.total).toBe(2);
    });
  });

  it("o relato conta 100 itens de chat e leva o que estava na Atividade nos mesmos 15 min, marcado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const bot = autoriaAgente(agenteId, PESSOA_MARLON);
      const agora = Date.now();
      const fala = await gravar(trx, repos, { conversaId, autoria: bot, kind: "texto", texto: "fala 0", confianca: "confiavel" }, agora - 300_000);
      await copias(trx, fala, 119, agora - 300_000, { texto: "fala", assunto: null });
      const aviso = await gravar(trx, repos, { conversaId, autoria: bot, kind: "sistema", assunto: "memoria.anotada", texto: "Anotei", confianca: "confiavel" }, agora - 299_950);
      await copias(trx, aviso, 400, agora - 299_950, { texto: "Anotei", assunto: "memoria.anotada" });
      const ancora = await gravar(trx, repos, { conversaId, autoria: bot, kind: "texto", texto: "a resposta errada", confianca: "confiavel" }, agora - 1_000);

      const janela = await repos.mensagens.janelaAte(conversaId, ancora, agora - 900_000, 100, { comDestino: true });
      expect(janela.filter((m) => m.destino === "chat")).toHaveLength(100);
      expect(janela.at(-1)?.id).toBe(ancora);
      const fora = janela.filter((m) => m.destino === "atividade");
      expect(fora.length).toBeGreaterThan(0);
      // O que estava na Atividade vem só desde o corte (o 100º item de chat), nunca de antes dele.
      const corte = Math.min(...janela.filter((m) => m.destino === "chat").map((m) => m.criadoEm));
      expect(fora.every((m) => m.criadoEm >= corte)).toBe(true);
      // Sem `comDestino` (a sala), as 100 cruas de antes.
      expect(await repos.mensagens.janelaAte(conversaId, ancora, agora - 900_000, 100)).toHaveLength(100);

      const deps = depsSobreTrx(trx, MARLON);
      const { relato } = (await executar(deps, registrarRelato, { mensagemId: ancora, categoria: "outro", alcance: "janela" })).data;
      const prosa = await repos.relatos.prosaDe(relato.id);
      const trecho = prosa?.trecho?.mensagens ?? [];
      expect(trecho.filter((m) => m.naAtividade !== true)).toHaveLength(100);
      expect(trecho.filter((m) => m.naAtividade === true).length).toBe(fora.length);
    });
  });

  it("NOD-325 (ADR-099 item 2): a fala da frente de lote volta anexo; a pergunta, a fala da pessoa, a frente sem lote e a task, chat", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const bot = autoriaAgente(agenteId, PESSOA_MARLON);
      const turno = (trabalhoId: string | null, mensagemOrigemId?: string) =>
        repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: T0 + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m", trabalhoId, ...(mensagemOrigemId ? { mensagemOrigemId } : {}) });
      const pedido = await gravar(trx, repos, { conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "arruma o runner", confianca: "confiavel" }, T0);
      const doDono = await turno(null, pedido);
      const lote = await repos.frentes.criarLote({ agenteId, abertoPorTurnoId: doDono!.id });
      const frente = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Runner", origem: "pessoa", forma: "frente", loteId: lote!.id });
      const semLote = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Antiga", origem: "pessoa", forma: "frente" });
      const task = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Task", origem: "pessoa" });
      const tf = await turno(frente!.id);
      const recado = await gravar(trx, repos, { conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "e o runner 3?", confianca: "confiavel" }, T0 + 500);
      await turno(frente!.id, recado);
      const ts = await turno(semLote!.id);
      const tt = await turno(task!.id);
      const daFrente = await gravar(trx, repos, { conversaId, turnoId: tf!.id, autoria: bot, kind: "texto", texto: "O runner 2 está no ar", confianca: "confiavel" }, T0 + 1_000);
      const pergunta = await gravar(trx, repos, { conversaId, turnoId: tf!.id, autoria: bot, kind: "texto", texto: "Reinicio o runner 3?", payload: { kind: "pedido_a_pessoa", decisaoId: randomUUID(), opcoes: ["Sim", "Não"] }, confianca: "confiavel" }, T0 + 1_100);
      const daSemLote = await gravar(trx, repos, { conversaId, turnoId: ts!.id, autoria: bot, kind: "texto", texto: "feito na antiga", confianca: "confiavel" }, T0 + 1_200);
      const daTask = await gravar(trx, repos, { conversaId, turnoId: tt!.id, autoria: bot, kind: "texto", texto: "feito na task", confianca: "confiavel" }, T0 + 1_300);
      const resposta = await gravar(trx, repos, { conversaId, turnoId: doDono!.id, autoria: bot, kind: "texto", texto: "Pronto: o runner 2 está no ar", confianca: "confiavel" }, T0 + 2_000);

      const deps = depsSobreTrx(trx, MARLON);
      const lidas = (await executar(deps, lerConversa, { conversaId })).data.mensagens;
      const destino = (id: string) => lidas.find((m) => m.id === id)?.destino;
      expect(destino(daFrente)).toBe("anexo");
      expect(destino(pergunta)).toBe("chat");
      expect(destino(pedido)).toBe("chat");
      expect(destino(recado)).toBe("chat");
      expect(destino(daSemLote)).toBe("chat");
      expect(destino(daTask)).toBe("chat");
      expect(destino(resposta)).toBe("chat");
      // A tela da frente continua com a fala (doTrabalho não tem destino).
      expect((await repos.mensagens.doTrabalho(frente!.id)).some((m) => m.id === daFrente)).toBe(true);

      // O relato registra o que a pessoa viu: a fala da frente de lote estava fora do chat.
      const janela = await repos.mensagens.janelaAte(conversaId, resposta, T0 - 1, 100, { comDestino: true });
      expect(janela.find((m) => m.id === daFrente)?.destino).toBe("anexo");
      expect(janela.find((m) => m.id === daSemLote)?.destino).toBe("chat");
      const { relato } = (await executar(deps, registrarRelato, { mensagemId: resposta, categoria: "outro", alcance: "janela" })).data;
      const trecho = (await repos.relatos.prosaDe(relato.id))?.trecho?.mensagens ?? [];
      expect(trecho.find((m) => m.id === daFrente)?.naAtividade).toBe(true);
      expect(trecho.find((m) => m.id === pergunta)?.naAtividade).toBeUndefined();
    });
  });
});
