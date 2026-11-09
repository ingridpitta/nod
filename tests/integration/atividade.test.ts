import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasAgentes } from "../../src/adapters/http/rotas/agentes.ts";
import { criarRotasAtividade } from "../../src/adapters/http/rotas/atividade.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { AtividadeDto, ContagemDaAtividade } from "../../src/contracts/atividade.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { NovaMensagem } from "../../src/repositories/mensagens.repo.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { contarAtividade, lerAtividade } from "../../src/use-cases/atividade.ts";
import { criarSala } from "../../src/use-cases/criar-sala.ts";
import { lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa, autoriaAgente, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const DIA = "2026-10-18";
const em = (hhmm: string, dia = DIA) => new Date(`${dia}T${hhmm}:00Z`);

/** O relógio das linhas é o do banco (clock_timestamp): o teste o põe no dia que quer medir. */
async function noInstante(trx: Tx, tabela: "mensagens" | "trabalhos", id: string, quando: Date, fim?: { em: Date; estado: "terminado" | "falhou" | "parado" }): Promise<void> {
  if (tabela === "mensagens") await trx`update mensagens set criado_em = ${quando} where id = ${id}`;
  else if (fim) await trx`update trabalhos set criado_em = ${quando}, terminado_em = ${fim.em}, estado = ${fim.estado} where id = ${id}`;
  else await trx`update trabalhos set criado_em = ${quando} where id = ${id}`;
}

async function nasceuEm(trx: Tx, agenteId: string, quando: Date): Promise<void> {
  await trx`update agentes set criado_em = ${quando} where id = ${agenteId}`;
}

async function mensagem(trx: Tx, repos: Repos, m: NovaMensagem, quando: Date): Promise<string> {
  const criada = await repos.mensagens.criar(m);
  if (!criada) throw new Error("mensagem não criada");
  await noInstante(trx, "mensagens", criada.id, quando);
  return criada.id;
}

async function assuntoGravado(trx: Tx, id: string): Promise<string | null> {
  const [l] = await trx<{ assunto: string | null }[]>`select assunto from mensagens where id = ${id}`;
  return l?.assunto ?? null;
}

describeIntegracao("Atividade do bot (chat limpo, PR 1)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx:
        (escopo: Escopo) =>
        async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: T } = {};
          await trx.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(sp);
          });
          return caixa.valor as T;
        },
      services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON),
      useCases: useCasesDeTeste(),
      prazoDecisaoMs: 60_000,
      executor: "catcher",
    };
    servidor = await servidorDeTeste([...criarRotasAgentes(deps), ...criarRotasAtividade(deps)]);
  });
  afterAll(() => servidor.close());

  it("as três fontes, sem repetir a task do dia, mais recentes primeiro; contagem=1 igual ao total", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      await nasceuEm(trx, agenteId, em("08:00", "2026-10-10"));
      const bot = autoriaAgente(agenteId, PESSOA_MARLON);
      const base = { conversaId, autoria: bot, confianca: "confiavel" as const };

      // Trabalhos: T1 começou e terminou hoje (dois itens), T2 começou ontem e terminou hoje (um), T3 é de ontem (nada).
      const t1 = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Hero w5", origem: "pessoa" });
      const t2 = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Roteiros", origem: "rotina", forma: "frente" });
      const t3 = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Antiga", origem: "pessoa" });
      await noInstante(trx, "trabalhos", t1!.id, em("09:00"), { em: em("11:00"), estado: "terminado" });
      await noInstante(trx, "trabalhos", t2!.id, em("15:00", "2026-10-17"), { em: em("13:00"), estado: "falhou" });
      await noInstante(trx, "trabalhos", t3!.id, em("10:00", "2026-10-17"));

      // Mensagens: entram as de Atividade, anexo e destino temporal; ficam de fora a fala, o que é do chat, a task que a
      // fonte 3 já conta e o que é de outro dia.
      const anotei = await mensagem(trx, repos, { ...base, kind: "sistema", assunto: "memoria.anotada", texto: "Anotei uma preferência: em reais" }, em("10:00"));
      const negada = await mensagem(trx, repos, { ...base, kind: "negacao", texto: "Bash negada: fora do catálogo", payload: { kind: "negacao", classe: "ferramenta_negada", nome: "Bash", motivo: "fora_do_catalogo", terminal: false, causaNativa: "esperando_aprovacao", vezes: 3 } }, em("10:05"));
      const limite = await mensagem(trx, repos, { ...base, kind: "sistema", texto: "Turno interrompido: limite", payload: { kind: "limite_do_plano", harness: "claude-cli", voltaEm: null } }, em("10:10"));
      const respondido = await mensagem(trx, repos, { ...base, kind: "sistema", texto: "Respondi ao pedido de Ada", payload: { kind: "pedido_respondido", loteId: randomUUID(), agenteId: randomUUID(), nome: "Ada" }, confianca: "nao_confiavel" }, em("10:15"));
      await mensagem(trx, repos, { ...base, kind: "texto", texto: "Pronto, mandei." }, em("10:20"));
      await mensagem(trx, repos, { ...base, kind: "negacao", texto: "Negado (terminal)", payload: { kind: "negacao", classe: "ferramenta_negada", nome: "Bash", motivo: "capacidade_desligada", terminal: true } }, em("10:25"));
      await mensagem(trx, repos, { ...base, kind: "sistema", texto: "Rotina ativa: …", payload: { kind: "rotina_evento", rotinaId: randomUUID(), acao: "criada", resumo: "todo dia" } }, em("10:30"));
      await mensagem(trx, repos, { ...base, kind: "sistema", texto: "Abriu a task Hero w5", payload: { kind: "trabalho_aberto", trabalhoId: t1!.id, titulo: "Hero w5", origem: "pessoa" } }, em("09:00"));
      await mensagem(trx, repos, { ...base, kind: "sistema", texto: "Começou a frente Roteiros", payload: { kind: "frentes_abertas", loteId: randomUUID(), origem: "rotina", frentes: [{ trabalhoId: t1!.id, titulo: "Hero w5" }] } }, em("09:01"));
      await mensagem(trx, repos, { ...base, kind: "sistema", assunto: "memoria.anotada", texto: "Anotei ontem" }, em("23:59", "2026-10-17"));

      // Trilha: conector indisponível ×3 e um tempo esgotado viram duas linhas; a negação de outra causa, a de ontem e a
      // de outro bot não entram.
      const outro = await agenteComConversa(trx, MARLON);
      for (const minuto of ["12:00", "12:01", "12:02"]) await repos.trilha.registrar({ agenteId, ferramenta: "gmail_buscar", kind: "negacao", motivo: "conector_indisponivel", regra: "regra:parada_alcada", regraVersao: 1, em: em(minuto).getTime() });
      await repos.trilha.registrar({ agenteId, ferramenta: "gmail_buscar", kind: "negacao", motivo: "timeout_transporte", regra: "regra:parada_alcada", regraVersao: 1, em: em("12:30").getTime() });
      await repos.trilha.registrar({ agenteId, ferramenta: "gmail_enviar", kind: "negacao", motivo: "alcance_insuficiente", regra: "regra:parada_alcada", regraVersao: 1, em: em("12:40").getTime() });
      await repos.trilha.registrar({ agenteId, ferramenta: "gmail_buscar", kind: "negacao", motivo: "conector_indisponivel", regra: "regra:parada_alcada", regraVersao: 1, em: em("12:00", "2026-10-17").getTime() });
      await repos.trilha.registrar({ agenteId: outro.agenteId, ferramenta: "gmail_buscar", kind: "negacao", motivo: "conector_indisponivel", regra: "regra:parada_alcada", regraVersao: 1, em: em("12:00").getTime() });

      const deps = depsSobreTrx(trx, MARLON);
      const { data } = await executar(deps, lerAtividade, { agenteId, dia: DIA, fuso: "UTC" });
      expect(data.itens.map((i) => i.id)).toEqual([
        `trabalho:${t2!.id}:terminou`,
        `trilha:gmail_buscar:timeout_transporte`,
        `trilha:gmail_buscar:conector_indisponivel`,
        `trabalho:${t1!.id}:terminou`,
        respondido,
        limite,
        negada,
        anotei,
        `trabalho:${t1!.id}:comecou`,
      ]);
      expect(data).toMatchObject({ dia: DIA, total: 9, truncados: 0, diaAnterior: "2026-10-17" });
      const porId = new Map(data.itens.map((i) => [i.id, i]));
      expect(porId.get("trilha:gmail_buscar:conector_indisponivel")).toMatchObject({ categoria: "bloqueios", titulo: "gmail_buscar indisponível", detalhe: "o app não respondeu", vezes: 3 });
      expect(porId.get("trilha:gmail_buscar:conector_indisponivel")?.alvo).toBeUndefined();
      expect(porId.get(negada)).toMatchObject({ categoria: "bloqueios", titulo: "Bash negada", vezes: 3, alvo: { mensagemId: negada } });
      expect(porId.get(anotei)).toMatchObject({ categoria: null, titulo: "Anotou na memória", detalhe: "Anotei uma preferência: em reais" });
      expect(porId.get(respondido)).toMatchObject({ titulo: "Respondeu ao pedido de Ada" });
      expect(porId.get(`trabalho:${t1!.id}:comecou`)).toMatchObject({ categoria: "frentes", titulo: "Abriu a task Hero w5", detalhe: "pedido seu", alvo: { trabalhoId: t1!.id } });
      expect(porId.get(`trabalho:${t1!.id}:terminou`)).toMatchObject({ titulo: "Terminou Hero w5", detalhe: "em 2 h 00" });
      expect(porId.get(`trabalho:${t2!.id}:terminou`)?.titulo).toBe("Roteiros falhou");

      const contagem = await executar(deps, contarAtividade, { agenteId, dia: DIA, fuso: "UTC" });
      expect(contagem.data).toEqual({ dia: DIA, total: 9 });
    });
  });

  it("NOD-374: a volta do app aparece depois do indisponível (uma linha por app, com as vezes); a de ontem e a de outro bot não entram", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON);
      await nasceuEm(trx, agenteId, em("08:00", "2026-10-10"));
      const outro = await agenteComConversa(trx, MARLON);
      const gmail = (await repos.conectores.criar({ nome: "Gmail", slug: "gmail", transporte: "stdio", comando: "node", declaracao: "nao-toca" }))!;
      const volta = (agente: string, quando: Date) => repos.trilha.registrar({ agenteId: agente, conectorId: gmail.id, ferramenta: "gmail", kind: "conector_recuperado", motivo: "conector_indisponivel", regra: "regra:disjuntor_conector", regraVersao: 1, em: quando.getTime() });
      await repos.trilha.registrar({ agenteId, conectorId: gmail.id, ferramenta: "gmail_buscar", kind: "negacao", motivo: "conector_indisponivel", regra: "regra:parada_alcada", regraVersao: 1, em: em("12:00").getTime() });
      await volta(agenteId, em("12:20"));
      await volta(agenteId, em("15:00"));
      await volta(agenteId, em("12:00", "2026-10-17"));
      await volta(outro.agenteId, em("12:20"));

      const deps = depsSobreTrx(trx, MARLON);
      const { data } = await executar(deps, lerAtividade, { agenteId, dia: DIA, fuso: "UTC" });
      expect(data.itens.map((i) => i.id)).toEqual([`trilha:${gmail.id}:recuperado`, `trilha:${gmail.id}:conector_indisponivel`]);
      expect(data.itens[0]).toMatchObject({ categoria: null, titulo: "Gmail voltou sozinho", detalhe: "o app respondeu de novo", vezes: 2, em: em("15:00").getTime() });
      expect(data.total).toBe(2);
      expect((await executar(deps, contarAtividade, { agenteId, dia: DIA, fuso: "UTC" })).data.total).toBe(2);
    });
  });

  it("fuso: a mesma linha cai no dia certo de cada lado da meia-noite; o nascimento do bot fecha o dia anterior", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      await nasceuEm(trx, agenteId, em("12:00", "2026-10-17"));
      const id = await mensagem(trx, repos, { conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "sistema", assunto: "aprovacao.modo", texto: "Marlon mudou as aprovações", confianca: "confiavel" }, em("02:30"));
      const deps = depsSobreTrx(trx, MARLON);
      const ler = async (dia: string, fuso: string) => (await executar(deps, lerAtividade, { agenteId, dia, fuso })).data;
      // 02:30Z de 18/10 é 23:30 de 17/10 em São Paulo (UTC−3).
      expect((await ler("2026-10-18", "UTC")).itens.map((i) => i.id)).toEqual([id]);
      expect((await ler("2026-10-18", "America/Sao_Paulo")).itens).toEqual([]);
      expect((await ler("2026-10-17", "America/Sao_Paulo")).itens.map((i) => i.id)).toEqual([id]);
      expect((await ler("2026-10-17", "UTC")).itens).toEqual([]);
      // O bot nasceu em 17/10: o dia dele não tem anterior; o seguinte tem. Dia vazio responde vazio.
      expect((await ler("2026-10-17", "UTC")).diaAnterior).toBeNull();
      expect((await ler("2026-10-18", "UTC")).diaAnterior).toBe("2026-10-17");
      expect(await ler("2026-10-20", "UTC")).toEqual({ dia: "2026-10-20", itens: [], total: 0, truncados: 0, diaAnterior: "2026-10-19" });
    });
  });

  it("até 500 itens, os mais recentes; truncados diz quantos ficaram de fora e a contagem conta todos", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      // 520 avisos num dia, um por segundo a partir das 10:00 (insert em lote: o teste mede a rota, não o produtor).
      await trx`
        insert into mensagens (tenant_id, owner_id, conversa_id, autor_tipo, autor_id, conta_de_execucao, executor, locality, locality_reason,
          decidido_por, regra_versao, kind, texto, confianca, assunto, criado_em)
        select ${MARLON.tenantId}, ${PESSOA_MARLON}, ${conversaId}, 'agente', ${agenteId}, ${PESSOA_MARLON}, 'catcher', 'local', 'tudo_local_nesta_rodada',
          'regra:localidade', 1, 'sistema', 'Anotei ' || g, 'confiavel', 'memoria.anotada', ${em("10:00")}::timestamptz + make_interval(secs => g)
        from generate_series(1, 520) g`;
      const deps = depsSobreTrx(trx, MARLON);
      const { data } = await executar(deps, lerAtividade, { agenteId, dia: DIA, fuso: "UTC" });
      expect(data.itens).toHaveLength(500);
      expect(data).toMatchObject({ total: 520, truncados: 20 });
      expect(data.itens[0]?.detalhe).toBe("Anotei 520");
      expect(data.itens.at(-1)?.detalhe).toBe("Anotei 21");
      expect((await executar(deps, contarAtividade, { agenteId, dia: DIA, fuso: "UTC" })).data.total).toBe(520);
    });
  });

  it("HTTP: dia inválido 400, fuso inválido 400, bot de outra pessoa 404 pela RLS, id que não é uuid 404, contagem=1", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const ana = await servidor.entrar("ana");
      const { agente } = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa" })).json()) as { agente: Agente; conversa: Conversa };
      const rota = (q: string) => `agentes/${agente.id}/atividade?${q}`;

      const ok = await servidor.chamar(marlon, "GET", rota(`dia=${DIA}&fuso=America/Sao_Paulo`));
      expect(ok.status).toBe(200);
      const pagina = (await ok.json()) as AtividadeDto;
      expect(pagina).toMatchObject({ dia: DIA, truncados: 0 });
      const contagem = (await (await servidor.chamar(marlon, "GET", rota(`dia=${DIA}&fuso=America/Sao_Paulo&contagem=1`))).json()) as ContagemDaAtividade;
      expect(contagem).toEqual({ dia: DIA, total: pagina.total });

      expect((await servidor.chamar(marlon, "GET", rota("dia=18-10-2026"))).status).toBe(400);
      expect((await servidor.chamar(marlon, "GET", rota("dia=2026-02-30"))).status).toBe(400);
      expect((await servidor.chamar(marlon, "GET", rota(""))).status).toBe(400);
      expect((await servidor.chamar(marlon, "GET", rota(`dia=${DIA}&fuso=-03:00`))).status).toBe(400);
      expect((await servidor.chamar(marlon, "GET", rota(`dia=${DIA}&fuso=Marte/Olimpo`))).status).toBe(400);
      expect((await servidor.chamar(ana, "GET", rota(`dia=${DIA}`))).status).toBe(404);
      expect((await servidor.chamar(ana, "GET", rota(`dia=${DIA}&contagem=1`))).status).toBe(404);
      expect((await servidor.chamar(marlon, "GET", `agentes/${randomUUID()}/atividade?dia=${DIA}`)).status).toBe(404);
      expect((await servidor.chamar(marlon, "GET", `agentes/nao-e-uuid/atividade?dia=${DIA}`)).status).toBe(404);
      // O Intl do Node aceita, o tzdata do Postgres não tem mais: 400, não 500 (fica por último porque o erro do Postgres
      // aborta a transação do teste).
      expect((await servidor.chamar(marlon, "GET", rota(`dia=${DIA}&fuso=US/Pacific-New`))).status).toBe(400);
      trxAtual = null;
    });
  });

  it("HTTP (PR 4 dos modos de aprovação): POST acoes-do-modo/:id/contestar — a dona marca a liberação do revisor; outra pessoa e id fora do formato, 404", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const ana = await servidor.entrar("ana");
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ze" });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      const acaoId = await repos.acoesPeloModo.registrar({ agenteId, conversaId, turnoId: turno!.id, decisaoId: null, modo: "automatico", tipo: "comando", resumo: "rm -rf dist", gatilho: "arriscado", risco: "apaga pastas inteiras", veredito: "libera", motivo: "você pediu" });
      expect((await servidor.chamar(ana, "POST", `acoes-do-modo/${acaoId}/contestar`)).status).toBe(404);
      const r = await servidor.chamar(marlon, "POST", `acoes-do-modo/${acaoId}/contestar`);
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ jaContestada: false, contestadaEm: expect.any(Number) });
      expect((await (await servidor.chamar(marlon, "POST", `acoes-do-modo/${acaoId}/contestar`)).json())).toMatchObject({ jaContestada: true });
      expect((await servidor.chamar(marlon, "POST", "acoes-do-modo/nao-e-uuid/contestar")).status).toBe(404);
      trxAtual = null;
    });
  });

  it("bot de empresa visível para a equipe: a Atividade continua só do dono", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const ana = await servidor.entrar("ana");
      const { agente } = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "empresa", nome: "Tuca" })).json()) as { agente: Agente };
      expect((await servidor.chamar(marlon, "GET", `agentes/${agente.id}/atividade?dia=${DIA}`)).status).toBe(200);
      expect((await servidor.chamar(ana, "GET", `agentes/${agente.id}/atividade?dia=${DIA}`)).status).toBe(404);
      trxAtual = null;
    });
  });

  it("o destino vai pronto no DTO só na conversa própria; a sala fica como hoje", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const bot = autoriaAgente(vera.agenteId, PESSOA_MARLON);
      await vera.repos.mensagens.criar({ conversaId: vera.conversaId, autoria: bot, kind: "texto", texto: "Oi", confianca: "confiavel" });
      await vera.repos.mensagens.criar({ conversaId: vera.conversaId, autoria: bot, kind: "sistema", assunto: "memoria.anotada", texto: "Anotei", confianca: "confiavel" });
      await vera.repos.mensagens.criar({ conversaId: vera.conversaId, autoria: bot, kind: "sistema", texto: "Abriu a task X", payload: { kind: "trabalho_aberto", trabalhoId: randomUUID(), titulo: "X", origem: "pessoa" }, confianca: "confiavel" });
      await vera.repos.mensagens.criar({ conversaId: vera.conversaId, autoria: bot, kind: "sistema", assunto: "turno.orfao", texto: "Tirei este pedido da fila", confianca: "confiavel" });
      const deps = depsSobreTrx(trx, MARLON);
      const propria = (await executar(deps, lerConversa, { conversaId: vera.conversaId })).data;
      // PR 2: a janela conta só o chat — o "Anotei" (Atividade) sai da resposta; o anexo vem, sem virar linha na web.
      expect(propria.mensagens.map((m) => [m.texto, m.destino])).toEqual([
        ["Oi", "chat"],
        ["Abriu a task X", "anexo"],
        ["Tirei este pedido da fila", "chat"],
      ]);

      const sala = await executar(deps, criarSala, { nome: "revisão", agenteIds: [vera.agenteId, tuca.agenteId] });
      const daSala = (await executar(deps, lerConversa, { conversaId: sala.data.conversa.id })).data;
      expect(daSala.mensagens.length).toBeGreaterThan(0);
      for (const m of daSala.mensagens) expect(m.destino).toBeUndefined();
      expect(await assuntoGravado(trx, daSala.mensagens[0]!.id)).toBe("sala.evento");
    });
  });
});
