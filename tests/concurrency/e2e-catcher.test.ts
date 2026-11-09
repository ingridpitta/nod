import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import type { AtividadeDto } from "../../src/contracts/atividade.ts";
import type { ConversaDto, FrotaDto, RespostaMutacao, SuaVezDto } from "../../src/contracts/api.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { FrameSse } from "../../src/contracts/frame.ts";
import type { Memoria } from "../../src/contracts/memoria.ts";
import type { ExecucaoRotina, Rotina } from "../../src/contracts/rotina.ts";
import type { FaixaParada, Turno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Tx } from "../../src/shared/types.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

const MCP_EXEMPLO = fileURLToPath(new URL("../../scripts/mcp-exemplo.mjs", import.meta.url));
const UUID_NULO = "00000000-0000-4000-8000-000000000000";
/** Nome ÚNICO por execução: `pedir_a_pessoa` resolve a decisora por nome entre as pessoas do tenant (EMENDA 16). */
const NOME_PESSOA = `E2E ${randomUUID().slice(0, 8)}`;

/**
 * E2E de fumaça (EMENDA 30, Práticas §6): UM `it` por jornada — "a lista é o ls" — sobre o servidor
 * COMPLETO (compor.ts + boot.ts) com NOD_EXECUTOR=catcher: zero custo, roda no CI. As respostas do
 * "modelo" são o roteiro do catcher (tests/helpers/catcher-roteiro.ts: marcadores [[tool: …]] /
 * [[texto: …]] no prompt), e cada ferramenta chamada passa pela MESMA rota interna que o CLI real
 * usaria (cliente-nod → /api/interno/ferramentas/:nome → chamar-ferramenta). Nada vem do seed: a
 * pessoa é própria deste arquivo e tudo é apagado por id ao fim (tests/concurrency/limpeza-e2e.ts).
 *
 * desvio registrado (definido em 2026-09-16): o plano nomeia tests/integration/e2e-catcher.test.ts; o
 * arquivo mora em tests/concurrency porque COMMITA (laços reais, cookie de sessão, SSE) e limpa por id —
 * a definição do terceiro modo (ADR-011 refinado) e a única pasta onde DELETE em teste é permitido.
 */
type Sessao = { cookie: string; tenantId: string; pessoaId: string };
/** definido em 2026-09-16: 60 s por jornada — cada uma encadeia vários turnos do catcher (20 ms/evento) e espera laços de fundo a 200 ms. */
const JORNADA_MS = 60_000;

describeIntegracao("e2e com catcher: as doze jornadas do fluxo de aceite, sem CLI e sem custo", () => {
  let srv: ServidorCompleto;
  let dirTmp: string;
  let arquivoEmails: string;
  const frames: FrameSse[] = [];
  let sse: AbortController;
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  let vera: { agenteId: string; conversaId: string };
  let tuca: { agenteId: string; conversaId: string };
  let conectorId = "";
  let salaId = "";

  const chamar = (metodo: string, caminho: string, corpo?: unknown, sessao?: Sessao) => srv.chamar(metodo, caminho, corpo, sessao);
  const json = <T>(metodo: string, caminho: string, corpo?: unknown, sessao?: Sessao) => srv.json<T>(metodo, caminho, corpo, sessao);
  const conversa = (id: string) => json<ConversaDto>("GET", `conversas/${id}/mensagens`);
  /** A Atividade do bot hoje (ADR-114), no fuso UTC: o dia do relógio do Postgres e do Node coincidem. */
  const atividadeDeHoje = (agenteId: string) => json<AtividadeDto>("GET", `agentes/${agenteId}/atividade?dia=${new Date().toISOString().slice(0, 10)}&fuso=UTC`);
  const turno = (id: string) => json<{ turno: Turno }>("GET", `turnos/${id}`).then((r) => r.turno);
  const esperarTurno = (id: string, estados: Turno["estado"][] = ["concluido"]) =>
    srv.esperar(async () => {
      const t = await turno(id);
      return estados.includes(t.estado) ? t : null;
    }, { nome: `turno ${id} em ${estados.join("|")}`, timeoutMs: 15_000 });
  const esperarFrame = (tipo: FrameSse["tipo"], desde = 0, pred: (f: FrameSse) => boolean = () => true) =>
    srv.esperar(async () => frames.slice(desde).find((f) => f.tipo === tipo && pred(f)) ?? null, { nome: `frame ${tipo}` });
  const enviar = async (conversaId: string, texto: string): Promise<{ turnoId: string; mensagemId: string }> => {
    const r = await json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto });
    return { turnoId: r.ids.turno ?? "", mensagemId: r.ids.mensagem ?? "" };
  };
  const rodar = async (conversaId: string, texto: string): Promise<Turno> => {
    const { turnoId } = await enviar(conversaId, texto);
    return esperarTurno(turnoId);
  };
  /** Diagnóstico de uma espera que estourou: mensagens da conversa e passos do catcher (nunca passa em silêncio). */
  const diagnostico = async (conversaId: string): Promise<string> => {
    const dto = await conversa(conversaId);
    const dev = await json<{ registros: { turnoId: string; tipo: string; dados: Record<string, unknown> }[] }>("GET", "dev/catcher");
    return JSON.stringify({ mensagens: dto.mensagens.map((m) => [m.kind, m.autoria.autor_tipo, m.texto.slice(0, 80)]), turnosPendentes: dto.turnosPendentes, registros: dev.registros.slice(0, 12).map((r) => [r.turnoId.slice(0, 8), r.tipo, r.dados]) }, null, 1);
  };
  const esperarOu = async <T>(conversaId: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      throw new Error(`${e instanceof Error ? e.message : String(e)}\n${await diagnostico(conversaId)}`);
    }
  };
  const criarBot = async (nome?: string) => {
    const r = await json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", nome ? { dono: "pessoa", nome } : { dono: "pessoa" });
    criados.agentes.push(r.agente.id);
    criados.conversas.push(r.conversa.id);
    // NOD-316: o bot nasce em Automático; este cenário parte do Manual, explícito.
    await json("POST", `agentes/${r.agente.id}/modo-aprovacao`, { modo: "manual" });
    return r;
  };
  /** Escrita direta como a pessoa (o fluxo de aceite usa psql): só onde o produto não tem rota (relógio). */
  const comoPessoa = async <T>(fn: (trx: Tx) => Promise<T>): Promise<T> => {
    const caixa: { valor?: T } = {};
    await srv.db.begin(async (trx) => {
      await vincularEscopo(trx, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId });
      caixa.valor = await fn(trx);
    });
    return caixa.valor as T;
  };

  beforeAll(async () => {
    dirTmp = await mkdtemp(join(tmpdir(), "nod-e2e-"));
    arquivoEmails = join(dirTmp, "emails.jsonl");
    srv = await servidorCompleto({
      nomePessoa: NOME_PESSOA,
      env: { NOD_LONGPOLL_MS: "300", NOD_PRAZO_DECISAO_MS: "86400000" },
      // definido em 2026-09-16: 20 ms entre eventos do catcher — dá tempo de Parar no meio do streaming (jornada 8) sem arrastar as outras.
      drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: 20 })],
    });
    sse = new AbortController();
    const res = await fetch(`${srv.url}/api/t/${srv.pessoa.tenantId}/eventos`, { headers: { cookie: srv.pessoa.cookie }, signal: sse.signal });
    expect(res.status).toBe(200);
    void (async () => {
      const reader = res.body?.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      if (!reader) return;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
          const blocos = buffer.split("\n\n");
          buffer = blocos.pop() ?? "";
          for (const bloco of blocos) {
            const linhas = bloco.split("\n");
            // `event: ping` (NOD-254) é sinal de vida, não frame.
            if (linhas.includes("event: ping")) continue;
            const linha = linhas.find((l) => l.startsWith("data: "));
            if (linha) frames.push(JSON.parse(linha.slice(6)) as FrameSse);
          }
        }
      } catch {
        // abort no afterAll
      }
    })();
  }, 30_000);

  afterAll(async () => {
    sse?.abort();
    if (srv) {
      await srv.fechar();
      await limparPessoaE2E(srv.db, srv.dbDono, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, criados);
      await srv.desligar();
    }
    if (dirTmp) await rm(dirTmp, { recursive: true, force: true });
  }, 30_000);

  it("criar bot: nasce 'Novo agente' sem acessos, conversa própria, inventário pronto; o modelo propõe o perfil e nada vale antes de confirmar; 2º turno usa --resume", { timeout: JORNADA_MS }, async () => {
    expect(await json("GET", "inventario")).toMatchObject({ estado: "pronto", versao: "catcher" });
    const vazio = await json<SuaVezDto>("GET", "sua-vez");
    expect(vazio).toMatchObject({ vazio: true, itens: [], ultimaDecisaoEm: null });

    const criado = await criarBot();
    vera = { agenteId: criado.agente.id, conversaId: criado.conversa.id };
    expect(criado.agente).toMatchObject({ nome: "Novo agente", confirmado: false, fixado: false, oculto: false });
    const frota = await json<FrotaDto>("GET", "frota");
    expect(frota.agentes.find((a) => a.id === vera.agenteId)).toMatchObject({ conversaId: vera.conversaId, descricaoEstado: "sem acessos · nunca executou" });
    expect(frota.inventario.estado).toBe("pronto");
    await esperarFrame("agente.mudou");
    const inicial = await conversa(vera.conversaId);
    expect(inicial.mensagens.map((m) => m.kind)).toEqual(["sistema"]);
    expect(inicial.mensagens[0]?.texto).toContain("identidade de execução vazia");

    const desde = frames.length;
    const t1 = await rodar(vera.conversaId, 'Te chamo de Vera. Você revisa PRs do time nod e responde curto. [[delta: pensando…]] [[tool: atualizar_perfil {"nome":"Vera","titulo":"Revisora de PRs","descricao":"Revisa PRs do time nod e responde curto."}]] [[texto: Proposta de perfil enviada; confirme para eu virar Vera.]] [[custo: 0.02]]');
    expect(t1).toMatchObject({ estado: "concluido", custoUsd: 0.02, origem: "conversa" });
    expect(t1.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: true, producedOutput: true });
    await esperarFrame("turno.encerrado", desde, (f) => f.dados.turnoId === t1.id || f.dados.turno_id === t1.id || true);
    const doTurno = frames.slice(desde).map((f) => f.tipo);
    for (const tipo of ["turno.iniciado", "turno.delta", "proposta.nova", "mensagem.nova", "turno.encerrado"]) expect(doTurno, `frame ${tipo}`).toContain(tipo);
    expect(frames.slice(desde).find((f) => f.tipo === "turno.delta")?.dados).toMatchObject({ texto: "pensando…", executor: "catcher" });

    // Nada aplicado antes da confirmação (E1.1): ainda 'Novo agente'; a proposta está pendente na conversa.
    const antes = await conversa(vera.conversaId);
    expect(antes.propostas.map((p) => p.kind)).toEqual(["perfil"]);
    expect((await json<FrotaDto>("GET", "frota")).agentes.find((a) => a.id === vera.agenteId)?.nome).toBe("Novo agente");
    const confirmada = await json<RespostaMutacao>("POST", `propostas/${antes.propostas[0]?.id}/confirmar`);
    expect(confirmada.ids.agente).toBe(vera.agenteId);
    expect((await json<FrotaDto>("GET", "frota")).agentes.find((a) => a.id === vera.agenteId)).toMatchObject({ nome: "Vera", confirmado: true });
    expect((await conversa(vera.conversaId)).propostas).toEqual([]);

    // 2º turno: o catcher NÃO cria sessão do CLI (0005). Antes ele inventava um uuid e a conversa
    // guardava; ao trocar para claude-cli o plano montava --resume de uma sessão que o Claude nunca
    // viu (medido 2026-09-16 na conversa "Teste 1" do Marlon). O --resume real é provado em
    // sessao-por-executor.test.ts; aqui o que vale é: sessão fica NULA e o executor é o catcher.
    expect((await conversa(vera.conversaId)).conversa.sessaoCli).toBeNull();
    const t2 = await rodar(vera.conversaId, "[[texto: segunda resposta]]");
    expect(t2.estado).toBe("concluido");
    expect((await conversa(vera.conversaId)).conversa.sessaoCli).toBeNull();
    const registros = await json<{ executor: string; registros: { turnoId: string; tipo: string; dados: Record<string, unknown> }[] }>("GET", "dev/catcher");
    expect(registros.executor).toBe("catcher");
    expect(registros.registros.find((r) => r.turnoId === t2.id && r.tipo === "plano_recebido")?.dados).toMatchObject({ sessaoCli: null, executor: "catcher" });
  });

  it("memória: lembrar (origem agente) aparece em GET memoria com a mensagem 'anotei'; a pessoa edita, acrescenta e apaga; Pin/Hide/Duplicate (cópia com memória, sem histórico)", { timeout: JORNADA_MS }, async () => {
    const t = await rodar(vera.conversaId, 'Lembre que prefiro resumos em tópicos. [[tool: lembrar {"tipo":"preferencia","texto":"prefere resumos em tópicos"}]] [[texto: Anotado.]]');
    expect(t.estado).toBe("concluido");
    const lista = await json<{ memorias: Memoria[] }>("GET", `agentes/${vera.agenteId}/memoria`);
    expect(lista.memorias.map((m) => [m.tipo, m.origem, m.texto])).toEqual([["preferencia", "agente", "prefere resumos em tópicos"]]);
    // Chat limpo (ADR-114, PR 2): o "Anotei" sai do chat e mora na Atividade do bot.
    expect((await conversa(vera.conversaId)).mensagens.some((m) => m.texto.startsWith("Anotei uma preferência"))).toBe(false);
    expect((await atividadeDeHoje(vera.agenteId)).itens.some((i) => i.titulo === "Anotou na memória" && i.detalhe?.startsWith("Anotei uma preferência"))).toBe(true);
    const m = lista.memorias[0]?.id ?? "";
    expect((await json<{ memoria: Memoria }>("PATCH", `agentes/${vera.agenteId}/memoria/${m}`, { texto: "prefere tópicos curtos" })).memoria.texto).toBe("prefere tópicos curtos");
    const nova = await json<{ memoria: Memoria }>("POST", `agentes/${vera.agenteId}/memoria`, { tipo: "fato", texto: "o time revisa PRs às terças" });
    expect(nova.memoria.origem).toBe("pessoa");
    expect((await chamar("DELETE", `agentes/${vera.agenteId}/memoria/${nova.memoria.id}`)).status).toBe(200);
    expect((await json<{ memorias: Memoria[] }>("GET", `agentes/${vera.agenteId}/memoria`)).memorias).toHaveLength(1);

    expect((await json<{ agente: Agente }>("POST", `agentes/${vera.agenteId}/fixar`)).agente.fixado).toBe(true);
    expect((await json<{ agente: Agente }>("POST", `agentes/${vera.agenteId}/ocultar`, { oculto: true })).agente.oculto).toBe(true);
    expect((await json<FrotaDto>("GET", "frota")).agentes.some((a) => a.id === vera.agenteId)).toBe(false);
    expect((await json<{ agente: Agente }>("POST", `agentes/${vera.agenteId}/ocultar`, { oculto: false })).agente.oculto).toBe(false);
    const copia = await json<{ agente: Agente; conversa: Conversa }>("POST", `agentes/${vera.agenteId}/duplicar`);
    criados.agentes.push(copia.agente.id);
    criados.conversas.push(copia.conversa.id);
    expect(copia.agente).toMatchObject({ nome: "Vera (cópia)", duplicadoDe: vera.agenteId });
    // Emenda de 2026-09-28 da ADR-034: a dona leva a memória; o histórico nunca vem (só consentimentos e avisos de sistema da própria cópia).
    expect((await json<{ memorias: Memoria[] }>("GET", `agentes/${copia.agente.id}/memoria`)).memorias.map((x) => [x.tipo, x.origem, x.texto])).toEqual([["preferencia", "agente", "prefere tópicos curtos"]]);
    const daCopia = (await conversa(copia.conversa.id)).mensagens;
    expect(daCopia.filter((x) => x.kind !== "consentimento" && x.kind !== "sistema")).toEqual([]);
    expect(daCopia.some((x) => x.texto.includes("prefiro resumos em tópicos"))).toBe(false);
  });

  it("rotina por texto: criar_rotina vira proposta + decisão 'rotina' (zero rotinas); decidir ativa com fuso nomeado; o scheduler dispara e a execução é registrada; fuso offset → 400; pausar", { timeout: JORNADA_MS }, async () => {
    const t = await rodar(vera.conversaId, 'Todo dia útil às 8:00 de São Paulo poste um resumo. [[tool: criar_rotina {"cron":"0 8 * * 1-5","fuso_iana":"America/Sao_Paulo","instrucao":"poste aqui um resumo dos PRs abertos","fonte":"PRs abertos do time nod","entregavel":"resumo em tópicos","limites_aprovacao":"nada sai sem aprovação","politica_sem_dado":"diga que não houve"}]] [[texto: Proposta de rotina enviada.]]');
    expect(t.estado).toBe("concluido");
    expect((await json<{ rotinas: unknown[] }>("GET", "rotinas")).rotinas).toEqual([]);
    const fila = await json<SuaVezDto>("GET", "sua-vez");
    const decisaoRotina = fila.itens.find((i) => i.decisao.tipo === "rotina");
    expect(decisaoRotina?.decisao.frase).toContain("dias úteis às 08:00");
    const decidida = await json<RespostaMutacao>("POST", `decisoes/${decisaoRotina?.decisao.id}/decidir`, {});
    expect(decidida.ids.rotina).toBe(decisaoRotina?.decisao.id);
    const rotinas = await json<{ rotinas: { rotina: Rotina; proximaExecucao: number }[] }>("GET", "rotinas");
    expect(rotinas.rotinas.map((r) => [r.rotina.estado, r.rotina.exigeAprovacao, r.rotina.fusoIana])).toEqual([["ativa", true, "America/Sao_Paulo"]]);
    expect((await conversa(vera.conversaId)).mensagens.some((m) => m.kind === "sistema" && m.texto.includes("(America/Sao_Paulo)"))).toBe(true);
    await esperarFrame("rotina.criada");
    const rotinaId = rotinas.rotinas[0]?.rotina.id ?? "";

    // Disparo sem ferramenta extra: a pessoa adianta a próxima execução (o fluxo de aceite faz o mesmo por psql).
    // definido em 2026-09-16: o domínio exige minuto e hora FIXOS no cron (Regra 9) — '* * * * *' do plano é
    // entrada_invalida; adiantar `proxima_execucao` basta, o cron segue '0 8 * * 1-5' e é reagendado depois.
    const desde = frames.length;
    await comoPessoa((trx) => trx`update rotinas set proxima_execucao = now() where id = ${rotinaId}`);
    const execucoes = await srv.esperar(async () => {
      const r = await json<{ execucoes: ExecucaoRotina[] }>("GET", `rotinas/${rotinaId}/execucoes`);
      return r.execucoes.length > 0 ? r.execucoes : null;
    }, { nome: "execução da rotina", timeoutMs: 15_000 });
    expect(execucoes[0]).toMatchObject({ rotinaId, desfecho: "executou" });
    await esperarFrame("rotina.executou", desde);
    // Chat limpo (ADR-114, PR 2): a linha "Rotina executou" vem na janela como `anexo` (não vira linha; é ela que diz à web
    // que a execução teve resultado para a pessoa) e aparece na Atividade.
    expect((await conversa(vera.conversaId)).mensagens.find((m) => m.kind === "rotina_execucao")?.destino).toBe("anexo");
    expect((await atividadeDeHoje(vera.agenteId)).itens.some((i) => i.titulo === "A rotina rodou")).toBe(true);
    const turnoRotina = await turno(execucoes[0]?.turnoId ?? "");
    expect(turnoRotina).toMatchObject({ origem: "rotina", estado: "concluido" });
    expect((await json<RespostaMutacao>("POST", `rotinas/${rotinaId}/pausar`)).ids.rotinaId).toBe(rotinaId);
    expect((await json<{ rotinas: { rotina: Rotina }[] }>("GET", "rotinas")).rotinas[0]?.rotina.estado).toBe("pausada");

    const fuso = await chamar("POST", "rotinas", { agenteId: vera.agenteId, cron: "0 8 * * *", fusoIana: "+03:00" });
    expect(fuso.status).toBe(400);
    expect(((await fuso.json()) as { codigo: string }).codigo).toBe("fuso_invalido");

    // ADR-041: o agente mexe na rotina que já existe. Reativa pela ferramenta (aplica direto),
    // depois propõe mudança e exclusão — que NÃO aplicam nada até a pessoa decidir.
    await rodar(vera.conversaId, `Volta a rotina. [[tool: reativar_rotina {"rotina_id":"${rotinaId}"}]] [[texto: Rotina reativada.]]`);
    expect((await json<{ rotinas: { rotina: Rotina }[] }>("GET", "rotinas")).rotinas[0]?.rotina.estado).toBe("ativa");

    await rodar(vera.conversaId, `Passa para as 9h. [[tool: atualizar_rotina {"rotina_id":"${rotinaId}","cron":"0 9 * * 1-5"}]] [[texto: Mudança proposta.]]`);
    expect((await json<{ rotinas: { rotina: Rotina }[] }>("GET", "rotinas")).rotinas[0]?.rotina.cron).toBe("0 8 * * 1-5");
    const dAtu = (await json<SuaVezDto>("GET", "sua-vez")).itens.find((i) => i.decisao.tipo === "rotina_atualizacao");
    expect((await json<RespostaMutacao>("POST", `decisoes/${dAtu?.decisao.id}/decidir`, {})).ids.rotina).toBe(rotinaId);
    expect((await json<{ rotinas: { rotina: Rotina }[] }>("GET", "rotinas")).rotinas[0]?.rotina.cron).toBe("0 9 * * 1-5");

    await rodar(vera.conversaId, `Pode apagar. [[tool: excluir_rotina {"rotina_id":"${rotinaId}"}]] [[texto: Exclusão proposta.]]`);
    expect((await json<{ rotinas: unknown[] }>("GET", "rotinas")).rotinas).toHaveLength(1);
    const dExc = (await json<SuaVezDto>("GET", "sua-vez")).itens.find((i) => i.decisao.tipo === "rotina_exclusao");
    await json<RespostaMutacao>("POST", `decisoes/${dExc?.decisao.id}/decidir`, {});
    // Some da listagem, mas a linha continua no banco (exclusão recuperável, ADR-034).
    expect((await json<{ rotinas: unknown[] }>("GET", "rotinas")).rotinas).toEqual([]);
    const [linha] = await comoPessoa((trx) => trx<{ excluido_em: Date | null }[]>`select excluido_em from rotinas where id = ${rotinaId}`);
    expect(linha?.excluido_em).not.toBeNull();
  });

  it("conector + concessão: registra desabilitado, sondar habilita com readOnlyHint, concessões viram mensagens de consentimento; env placeholder → 400; http+toca → 400; comando inválido → ultimaFalha na frota", { timeout: JORNADA_MS }, async () => {
    const criado = await json<{ ids: { conector: string }; conector: { habilitado: boolean; env: Record<string, unknown> } }>("POST", "conectores", {
      nome: "Exemplo",
      slug: "exemplo",
      transporte: "stdio",
      comando: process.execPath,
      args: [MCP_EXEMPLO],
      env: { NOD_MCP_EXEMPLO_ARQUIVO: arquivoEmails },
      declaracao: "nao-toca",
    });
    conectorId = criado.ids.conector;
    expect(criado.conector).toMatchObject({ habilitado: false, env: { NOD_MCP_EXEMPLO_ARQUIVO: true } });
    const sonda = await json<{ ok: boolean; conector: { habilitado: boolean; catalogo: { nome: string; readOnlyHint: boolean }[] } }>("POST", `conectores/${conectorId}/sondar`);
    expect(sonda.ok).toBe(true);
    expect(sonda.conector.habilitado).toBe(true);
    expect(sonda.conector.catalogo.map((c) => [c.nome, c.readOnlyHint])).toEqual([
      ["listar_contatos", true],
      ["enviar_email", false],
    ]);
    for (const capacidade of ["listar_contatos", "enviar_email"]) {
      const c = await json<{ ids: { concessao: string; mensagem: string } }>("POST", `agentes/${vera.agenteId}/concessoes`, { conectorId, capacidade });
      expect(c.ids.concessao).toBeTruthy();
    }
    const consentimentos = (await conversa(vera.conversaId)).mensagens.filter((m) => m.kind === "consentimento");
    // ADR-044: o consentimento carrega o LOTE (`capacidades`); aqui foram dois pedidos de uma capacidade cada.
    expect(consentimentos.map((m) => m.payload?.kind === "consentimento" && "capacidades" in m.payload && m.payload.capacidades)).toEqual([["listar_contatos"], ["enviar_email"]]);
    expect(consentimentos[0]?.texto).toMatch(new RegExp(`^Concedido por ${NOME_PESSOA} em .* UTC: exemplo\\.listar_contatos; não inclui: enviar_email`));
    expect((await json<FrotaDto>("GET", "frota")).agentes.find((a) => a.id === vera.agenteId)?.descricaoEstado).toMatch(/^2 acessos · executou \d+ vezes$/);

    expect((await chamar("POST", "conectores", { nome: "X", slug: "x", transporte: "stdio", comando: "node", env: { TOKEN: true } })).status).toBe(400);
    expect((await chamar("POST", "conectores", { nome: "Y", slug: "y", transporte: "http", url: "http://127.0.0.1:1/mcp", declaracao: "toca" })).status).toBe(400);
    const quebrado = await json<{ ids: { conector: string } }>("POST", "conectores", { nome: "Quebrado", slug: "quebrado", transporte: "stdio", comando: "/nao/existe/mcp", declaracao: "nao-toca" });
    const falha = await json<{ ok: boolean; conector: { ultimaFalha: { motivo: string } | null } }>("POST", `conectores/${quebrado.ids.conector}/sondar`);
    expect(falha.ok).toBe(false);
    expect(falha.conector.ultimaFalha?.motivo).toBe("conector_indisponivel");
    expect((await json<FrotaDto>("GET", "frota")).negacoes).toEqual([expect.objectContaining({ classe: "conector_indisponivel", nome: "quebrado" })]);
  });

  it("aprovação em lista: listar_contatos → pedir_aprovacao (3 itens) encerra o turno; decidir 2 de 3 executa exatamente 2 no conector, escreve o resultado (o cartão encolhido, ancorado no turno) e retoma com --resume; ferramenta não concedida → negação terminal na trilha", { timeout: JORNADA_MS }, async () => {
    const desde = frames.length;
    const itens = ["ana@exemplo.test", "bia@exemplo.test", "caio@exemplo.test"].map((para) => ({
      texto: `e-mail de boas-vindas para ${para}`,
      destino: { conector: "exemplo", ferramenta: "enviar_email", argumentos: { para, assunto: "Bem-vinda(o)", texto: `e-mail de boas-vindas para ${para}` } },
      origem_conector: "exemplo",
    }));
    const t = await rodar(vera.conversaId, `Envie um e-mail curto de boas-vindas para ana, bia e caio pelo conector Exemplo. [[tool: exemplo__listar_contatos {}]] [[tool: pedir_aprovacao ${JSON.stringify({ resumo: "3 e-mails de boas-vindas", itens })}]] [[texto: aguardando sua aprovação]]`);
    expect(t).toMatchObject({ estado: "concluido" });
    await esperarFrame("decisao.nova", desde);
    const registrosDoTurno = (await json<{ registros: { turnoId: string; tipo: string; dados: Record<string, unknown> }[] }>("GET", "dev/catcher")).registros.filter((r) => r.turnoId === t.id);
    expect(registrosDoTurno.filter((r) => r.tipo === "tool_result").map((r) => r.dados.isError)).toEqual([false, false]);
    expect((await conversa(vera.conversaId)).mensagens.at(-1)).toMatchObject({ kind: "texto", texto: "aguardando sua aprovação" });

    const fila = await json<SuaVezDto>("GET", "sua-vez");
    const item = fila.itens.find((i) => i.decisao.tipo === "aprovacao" && i.decisao.turnoId === t.id);
    expect(item?.itensAprovacao).toHaveLength(3);
    expect(item?.itensAprovacao.map((i) => [i.idx, i.selecionado, i.origemSensivel])).toEqual([
      [0, true, false],
      [1, true, false],
      [2, true, false],
    ]);
    const [i0, i1, i2] = item?.itensAprovacao ?? [];
    const decidida = await json<RespostaMutacao>("POST", `decisoes/${item?.decisao.id}/decidir`, {
      itens: [
        { id: i0?.id, selecionado: true },
        { id: i1?.id, selecionado: false },
        { id: i2?.id, selecionado: true, textoFinal: "editado" },
      ],
    });
    expect(decidida.ids.turnoRetomada).toBeTruthy();
    const enviados = (await readFile(arquivoEmails, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { para: string; texto: string });
    expect(enviados.map((e) => e.para)).toEqual(["ana@exemplo.test", "caio@exemplo.test"]);
    expect(enviados[1]?.texto).toBe("editado");
    const lida = (await conversa(vera.conversaId)).mensagens;
    const resultado = lida.find((m) => m.kind === "resultado_aprovacao");
    expect(resultado?.texto).toContain(`${NOME_PESSOA} aprovou 2 de 3; não enviado: e-mail de boas-vindas para bia@exemplo.test (retirado pela pessoa)`);
    // Chat limpo, PR 4: o recibo é o cartão encolhido no chat, ancorado no turno que pediu — a fala desse turno vem antes
    // dele na janela, e a web põe o cartão logo depois dela (web/telas/conversa.ts, comEncolhidosNaAncora).
    expect(resultado).toMatchObject({ turnoId: t.id, destino: "chat", payload: { kind: "resultado_aprovacao", decisaoId: item?.decisao.id, frase: item?.decisao.frase } });
    const ancora = lida.slice(0, lida.indexOf(resultado ?? lida[0]!)).filter((m) => m.turnoId === t.id).at(-1);
    expect(ancora).toMatchObject({ kind: "texto", texto: "aguardando sua aprovação" });
    const retomada = await esperarTurno(decidida.ids.turnoRetomada ?? "");
    expect(retomada).toMatchObject({ origem: "retomada", retomaTurnoId: t.id, estado: "concluido" });
    await esperarFrame("decisao.decidida", desde);

    const trilha = await json<{ linhas: { kind: string; ferramenta: string; motivo: string | null }[] }>("GET", `trilha?agente=${vera.agenteId}&conector=${conectorId}`);
    expect(trilha.linhas.map((l) => [l.kind, l.ferramenta])).toContainEqual(["tool_call", "exemplo__listar_contatos"]);

    // Ferramenta fora do plano (não concedida): negação LOCAL do catcher/proxy, terminal, registrada na trilha e como frame.
    const desde2 = frames.length;
    const negado = await rodar(vera.conversaId, "[[tool: exemplo__apagar_tudo {}]] [[texto: tentei]]");
    expect(negado.estado).toBe("concluido");
    const frameNegacao = await esperarFrame("negacao", desde2);
    expect(frameNegacao.dados).toMatchObject({ classe: "ferramenta_negada", motivo: "fora_do_catalogo", terminal: true });
    const trilhaNegada = await json<{ linhas: { kind: string; ferramenta: string; motivo: string | null }[] }>("GET", `trilha?agente=${vera.agenteId}`);
    expect(trilhaNegada.linhas.some((l) => l.kind === "negacao" && l.ferramenta === "exemplo__apagar_tudo" && l.motivo === "fora_do_catalogo")).toBe(true);
  });

  it("negação vai para a Atividade (ADR-114, PR 2): a ferramenta negada pelo CLI, não terminal, sai da janela e aparece em GET atividade", { timeout: JORNADA_MS }, async () => {
    const desde = frames.length;
    const t = await rodar(vera.conversaId, "[[negada: Bash]] [[texto: tentei pelo terminal]]");
    expect(t.estado).toBe("concluido");
    const frame = await esperarFrame("negacao", desde, (f) => f.dados.nome === "Bash");
    expect(frame.dados).toMatchObject({ classe: "ferramenta_negada", terminal: false });
    const janela = (await conversa(vera.conversaId)).mensagens;
    expect(janela.some((m) => m.kind === "negacao" && m.turnoId === t.id)).toBe(false);
    // A fala do mesmo turno fica no chat.
    expect(janela.find((m) => m.turnoId === t.id && m.kind === "texto")?.destino).toBe("chat");
    const atividade = await atividadeDeHoje(vera.agenteId);
    const negada = atividade.itens.find((i) => i.titulo === "Bash negada");
    expect(negada).toMatchObject({ categoria: "bloqueios" });
    expect(negada?.alvo).toEqual({ mensagemId: negada?.id });
    const contagem = await json<{ total: number }>("GET", `agentes/${vera.agenteId}/atividade?dia=${atividade.dia}&fuso=UTC&contagem=1`);
    expect(contagem.total).toBe(atividade.total);
  });

  it("sala: 2 bots com grant; @menção dirige o turno; sem menção o lead responde e encaminha (handoff visível); o destinatário passa e a rodada assenta; 1 bot → 400 sala_tamanho; outra pessoa → 404 no agente", { timeout: JORNADA_MS }, async () => {
    const criado = await criarBot("Tuca");
    tuca = { agenteId: criado.agente.id, conversaId: criado.conversa.id };
    await json("PATCH", `agentes/${tuca.agenteId}`, { descricao: "Tria pedidos." });
    const sala = await json<RespostaMutacao>("POST", "salas", { nome: "revisão", agenteIds: [vera.agenteId, tuca.agenteId] });
    salaId = sala.ids.salaId ?? "";
    const conversaSala = sala.ids.conversaId ?? "";
    criados.conversas.push(conversaSala);

    const mencao = await json<RespostaMutacao>("POST", `salas/${salaId}/mensagens`, { texto: "@Tuca o que acha do PR 42? [[texto: Acho que o PR 42 está bom.]]" });
    expect(Object.keys(mencao.ids).filter((k) => k.startsWith("turnoId"))).toEqual(["turnoId0"]);
    const turnoTuca = await esperarTurno(mencao.ids.turnoId0 ?? "");
    expect(turnoTuca).toMatchObject({ agenteId: tuca.agenteId, origem: "sala" });
    expect((await conversa(conversaSala)).mensagens.filter((m) => m.autoria.autor_id === tuca.agenteId).map((m) => m.texto)).toEqual(["Acho que o PR 42 está bom."]);

    const desde = frames.length;
    const semMencao = await json<RespostaMutacao>("POST", `salas/${salaId}/mensagens`, {
      texto: 'Alguém revisa o PR 43? [[tool: encaminhar {"para_agente":"Tuca","motivo":"triagem [[tool: passar {\\"motivo\\":\\"passei_sem_nada_a_dizer\\"}]] [[texto: passo]]"}]] [[texto: Passei para a Tuca.]]',
    });
    const turnoVera = await esperarTurno(semMencao.ids.turnoId0 ?? "");
    expect(turnoVera.agenteId).toBe(vera.agenteId);
    await esperarOu(conversaSala, () => esperarFrame("sala.handoff", desde));
    const turnos = await srv.esperar(async () => {
      const dto = await conversa(conversaSala);
      return dto.mensagens.some((m) => m.kind === "passe") ? dto : null;
    }, { nome: "passe da Tuca", timeoutMs: 15_000 });
    const kinds = turnos.mensagens.filter((m) => m.turnoId !== null && m.turnoId !== turnoTuca.id && m.turnoId !== mencao.ids.turnoId0).map((m) => m.kind);
    expect(kinds).toContain("handoff");
    expect(kinds).toContain("passe");
    expect(turnos.mensagens.find((m) => m.kind === "handoff")?.texto).toBe("Vera passou para Tuca: triagem [[tool: passar {\"motivo\":\"passei_sem_nada_a_dizer\"}]] [[texto: passo]].");
    expect(turnos.mensagens.find((m) => m.kind === "passe")?.payload).toEqual({ kind: "passe", motivo: "passei_sem_nada_a_dizer" });

    const pequena = await chamar("POST", "salas", { nome: "só um", agenteIds: [vera.agenteId] });
    expect(pequena.status).toBe(400);
    expect(((await pequena.json()) as { codigo: string }).codigo).toBe("sala_tamanho");
    const outra = srv.sessaoDe({ tenantId: srv.pessoa.tenantId, pessoaId: randomUUID() });
    expect((await chamar("GET", `agentes/${vera.agenteId}/memoria`, undefined, outra)).status).toBe(404);
    expect((await chamar("GET", `conversas/${conversaSala}/mensagens`, undefined, outra)).status).toBe(404);
    expect((await chamar("POST", `salas/${salaId}/parar`)).status).toBe(200);
  });

  it("bot-a-bot (ADR-058/062): pedir_a_bot abre no alvo um turno 'delegacao' confiável; a resposta volta como peer_ask e o remetente continua no modo dele, ainda com o salto abaixo do limite", { timeout: JORNADA_MS }, async () => {
    const desde = frames.length;
    const t = await rodar(vera.conversaId, 'Pergunte ao Tuca o status do PR 42. [[tool: pedir_a_bot {"agente":"Tuca","pedido":"qual o status do PR 42? [[texto: PR 42 aprovado ontem]]"}]] [[texto: Perguntei ao Tuca.]]');
    expect(t.estado).toBe("concluido");
    const resposta = await esperarOu(tuca.conversaId, () =>
      srv.esperar(async () => {
        const dto = await conversa(vera.conversaId);
        return dto.mensagens.find((m) => m.kind === "peer_ask") ?? null;
      }, { nome: "peer_ask", timeoutMs: 15_000 }),
    );
    expect(resposta).toMatchObject({ texto: "PR 42 aprovado ontem" });
    expect(resposta.payload).toMatchObject({ kind: "peer_ask", agenteId: tuca.agenteId, nome: "Tuca", delegada: true });
    const tarefa = await turno(resposta.payload?.kind === "peer_ask" ? resposta.payload.tarefaId : "");
    expect(tarefa).toMatchObject({ origem: "delegacao", profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: srv.pessoa.pessoaId, agenteId: tuca.agenteId, conversaId: tuca.conversaId, estado: "concluido" });
    // Chat limpo (PR 3): o nome vai gravado dos dois lados, e a conversa do Tuca diz quem pediu pelo turno do pedido.
    const doTuca = await conversa(tuca.conversaId);
    expect(doTuca.mensagens.find((m) => m.turnoId === tarefa.id && m.payload?.kind === "peer_pedido")?.payload).toMatchObject({ nome: "Vera" });
    expect(doTuca.pedidosDeColega?.[tarefa.id]).toEqual({ agenteId: vera.agenteId, nome: "Vera" });
    expect((await conversa(vera.conversaId)).mensagens.find((m) => m.payload?.kind === "handoff" && m.payload.tarefaId === tarefa.id)?.payload).toMatchObject({ nomePara: "Tuca" });
    const dev = await json<{ registros: { turnoId: string; tipo: string; dados: Record<string, unknown> }[] }>("GET", "dev/catcher");
    const doAlvo = dev.registros.find((r) => r.tipo === "plano_recebido" && r.turnoId === tarefa.id)?.dados.ferramentas as string[];
    expect(doAlvo).toContain("mcp__nod__pedir_acesso");
    // ADR-063: quem cumpre o pedido (profundidade 1) também pede a outro colega, até o limite da corrente.
    expect(doAlvo).toContain("mcp__nod__pedir_a_bot");
    const continuacao = await srv.esperar(async () => {
      const d = await json<{ registros: { turnoId: string; tipo: string; dados: Record<string, unknown> }[] }>("GET", "dev/catcher");
      return d.registros.find((r) => r.tipo === "plano_recebido" && r.turnoId === resposta.turnoId) ?? null;
    }, { nome: "plano da continuação", timeoutMs: 15_000 });
    const ferramentas = continuacao.dados.ferramentas as string[];
    // A continuação é a retomada do turno da Vera: o kit da conversa, com o salto (profundidade 1, abaixo do limite).
    expect(ferramentas).toEqual(expect.arrayContaining(["mcp__nod__lembrar", "mcp__nod__pedir_aprovacao", "mcp__nod__pedir_a_bot"]));
    expect(await turno(resposta.turnoId ?? "")).toMatchObject({ origem: "retomada", profundidade: 1 });
    expect(frames.slice(desde).filter((f) => f.tipo === "turno.iniciado").length).toBeGreaterThanOrEqual(2);
    await esperarTurno(resposta.turnoId ?? "");
  });

  it("pedido com a mensagem da pessoa (ADR-058): ela vai junto ao alvo, literal; o resultado volta; a falha no alvo avisa o remetente uma vez", { timeout: JORNADA_MS }, async () => {
    const criadoTaga = await json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Taga", descricao: "Coordena o time." });
    criados.agentes.push(criadoTaga.agente.id);
    criados.conversas.push(criadoTaga.conversa.id);
    // NOD-316: o bot nasce em Automático; este cenário parte do Manual, explícito.
    await json("POST", `agentes/${criadoTaga.agente.id}/modo-aprovacao`, { modo: "manual" });
    const taga = { agenteId: criadoTaga.agente.id, conversaId: criadoTaga.conversa.id };
    const pedido = 'Pede ao Tuca para revisar o PR 466. [[tool: pedir_a_bot {"agente":"Tuca","pedido":"revisar o PR 466 [[texto: PR 466 revisado: dois comentários]]","contexto":"https://github.com/acme/app/pull/466"}]] [[texto: Pedi ao Tuca.]]';
    const t = await rodar(taga.conversaId, pedido);
    expect(t.estado).toBe("concluido");
    const resultado = await esperarOu(tuca.conversaId, () =>
      srv.esperar(async () => {
        const dto = await conversa(taga.conversaId);
        return dto.mensagens.find((m) => m.kind === "peer_ask" && m.payload?.kind === "peer_ask" && m.payload.delegada === true) ?? null;
      }, { nome: "resultado do pedido", timeoutMs: 15_000 }),
    );
    expect(resultado).toMatchObject({ texto: "PR 466 revisado: dois comentários" });
    expect(resultado.autoria.sob_procuracao_de).toBe(srv.pessoa.pessoaId);
    const tarefa = await turno(resultado.payload?.kind === "peer_ask" ? resultado.payload.tarefaId : "");
    expect(tarefa).toMatchObject({ origem: "delegacao", profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: srv.pessoa.pessoaId, agenteId: tuca.agenteId, conversaId: tuca.conversaId, estado: "concluido" });
    expect(tarefa.entradaTexto).toContain(`<pedido_da_pessoa>\n${pedido}\n</pedido_da_pessoa>`);
    // Na conversa do Tuca, o pedido é a fala do Taga, assinada "Taga · por <pessoa>".
    const naConversaDoAlvo = (await conversa(tuca.conversaId)).mensagens.find((m) => m.turnoId === tarefa.id && m.payload?.kind === "peer_pedido");
    expect(naConversaDoAlvo?.autoria).toMatchObject({ autor_id: taga.agenteId, sob_procuracao_de: srv.pessoa.pessoaId });
    expect(naConversaDoAlvo?.payload).toMatchObject({ kind: "peer_pedido", nome: "Taga" });
    await esperarTurno(resultado.turnoId ?? "");

    // A tarefa que falha no alvo avisa o remetente uma vez, em vez de ele esperar calado.
    await rodar(taga.conversaId, 'Pede ao Tuca para revisar o PR 467. [[tool: pedir_a_bot {"agente":"Tuca","pedido":"revisar o PR 467 [[falha: error_during_execution]]"}]] [[texto: Pedi ao Tuca.]]');
    const aviso = await esperarOu(tuca.conversaId, () =>
      srv.esperar(async () => {
        const dto = await conversa(taga.conversaId);
        return dto.mensagens.find((m) => m.payload?.kind === "peer_ask" && m.payload.falhou === true) ?? null;
      }, { nome: "aviso de pedido não concluído", timeoutMs: 15_000 }),
    );
    expect(aviso.texto).toMatch(/^Tuca não concluiu: /);
    await esperarTurno(aviso.turnoId ?? "");
  });

  it("falha do fornecedor (NOD-174): o erro do CLI em inglês não vira fala; a conversa ganha o aviso em pt-BR e o erro cru fica só no diagnóstico do turno", { timeout: JORNADA_MS }, async () => {
    const bot = await criarBot("Fornecedor");
    const casos = [
      { erro: "Credit balance is too low", aviso: "Turno interrompido: a IA parou por um erro; tente de novo e, se repetir, relate o problema nesta mensagem." },
      { erro: "API Error: 529 overloaded", aviso: "Turno interrompido: o serviço da sua IA está instável ou fora do ar; tente de novo em alguns minutos." },
    ];
    for (const c of casos) {
      const { turnoId } = await enviar(bot.conversa.id, `veja a planilha [[delta: Vou olhar a planilha.]] [[falha: ${c.erro}]]`);
      const t = await esperarOu(bot.conversa.id, () => esperarTurno(turnoId, ["interrompido"]));
      expect(t.motivoFalha).toBe("erro_execucao");
      const doTurno = await esperarOu(bot.conversa.id, () =>
        srv.esperar(async () => {
          const ms = (await conversa(bot.conversa.id)).mensagens.filter((m) => m.turnoId === turnoId);
          return ms.some((m) => m.kind === "sistema") ? ms : null;
        }, { nome: `aviso do turno ${turnoId}` }),
      );
      expect(doTurno.map((m) => [m.kind, m.parcial])).toEqual([["texto", true], ["sistema", false]]);
      expect(doTurno[0]?.texto).toBe("Vou olhar a planilha.");
      expect(doTurno[1]?.texto).toContain(c.aviso);
      expect(JSON.stringify(doTurno)).not.toContain(c.erro);
      const [diag] = await comoPessoa((trx) => trx<{ erro_cru: string | null }[]>`select erro_cru from turno_diagnosticos where turno_id = ${turnoId}`);
      expect(diag?.erro_cru).toContain(c.erro);
    }
  });

  it("parar: durante o streaming, POST parar interrompe em < 2 s com faixa {interrompidas:1}, fala parcial e motivo parado_pela_pessoa; sem nada rodando → nadaRodando; máquina some (lease vencido) → 'maquina_sem_contato' + decisão retomar → turno novo", { timeout: JORNADA_MS }, async () => {
    const longo = Array.from({ length: 80 }, (_, i) => `[[delta: parágrafo ${i}]]`).join(" ");
    const { turnoId } = await enviar(vera.conversaId, `escreva um relatório bem longo sobre revisão de código ${longo} [[texto: relatório]]`);
    await esperarFrame("turno.delta", frames.length - 1, (f) => f.dados.turnoId === turnoId);
    const inicio = Date.now();
    const faixa = await json<FaixaParada>("POST", `conversas/${vera.conversaId}/parar`);
    expect(faixa).toMatchObject({ interrompidas: 1, naoInterrompidas: [], nadaRodando: false });
    const parado = await esperarTurno(turnoId, ["interrompido"]);
    expect(Date.now() - inicio).toBeLessThan(2_000);
    expect(parado.motivoInterrupcao).toBe("parado_pela_pessoa");
    await esperarFrame("parada.faixa");
    const dto = await srv.esperar(async () => {
      const c = await conversa(vera.conversaId);
      return c.mensagens.some((m) => m.turnoId === turnoId && m.autoria.autor_tipo === "agente" && m.parcial) ? c : null;
    }, { nome: "fala parcial" });
    // Chat limpo (ADR-114, PR 2; emenda da ADR-110): a linha "■ Parado por você" vai para a Atividade; a faixa do Parar fica.
    expect(dto.mensagens.some((m) => m.kind === "parada")).toBe(false);
    expect((await atividadeDeHoje(vera.agenteId)).itens.some((i) => i.titulo === "Parado por você · 1 turno interrompido" && i.categoria === "bloqueios")).toBe(true);
    const deNovo = await json<FaixaParada>("POST", `conversas/${vera.conversaId}/parar`);
    expect(deNovo.nadaRodando).toBe(true);

    // A máquina some no meio de um turno: o lease vence, o varredor encerra com 'maquina_sem_contato' e abre 'retomar?' em Sua vez.
    const outro = await enviar(vera.conversaId, `de novo ${longo} [[texto: outro relatório]]`);
    await esperarFrame("turno.delta", frames.length - 1, (f) => f.dados.turnoId === outro.turnoId);
    await comoPessoa((trx) => trx`update turnos set lease_ate = now() - interval '1 minute' where id = ${outro.turnoId}`);
    const sumido = await esperarTurno(outro.turnoId, ["interrompido"]);
    expect(sumido.motivoInterrupcao).toBe("maquina_sem_contato");
    const fila = await json<SuaVezDto>("GET", "sua-vez");
    const retomar = fila.itens.find((i) => i.decisao.tipo === "retomar_turno" && i.decisao.turnoId === outro.turnoId);
    expect(retomar).toBeDefined();
    const retomado = await json<RespostaMutacao>("POST", `decisoes/${retomar?.decisao.id}/retomar`, { texto: "continue [[texto: continuei]]" });
    expect(retomado.ids.retomaTurno).toBe(outro.turnoId);
    expect(await esperarTurno(retomado.ids.turno ?? "")).toMatchObject({ origem: "retomada", retomaTurnoId: outro.turnoId, estado: "concluido" });
  });

  it("sua vez e expiração: decisão vencida vira 'vencido' em cinza com carimbo (varrida UMA vez), reabrir volta ao topo com prazo novo; a pessoa que não é a decisora não vê", { timeout: JORNADA_MS }, async () => {
    const t = await rodar(vera.conversaId, 'Posso arquivar o PR 7? [[tool: pedir_a_pessoa {"tipo":"pergunta","texto":"posso arquivar o PR 7?"}]] [[texto: parei para perguntar]]');
    expect(t.estado).toBe("concluido");
    const fila = await json<SuaVezDto>("GET", "sua-vez");
    const pergunta = fila.itens.find((i) => i.decisao.tipo === "pergunta" && i.decisao.turnoId === t.id);
    expect(pergunta?.estadoColuna).toBe("pendente");
    const desde = frames.length;
    await comoPessoa((trx) => trx`update decisoes set prazo_decisao_em = now() - interval '1 minute' where id = ${pergunta?.decisao.id ?? UUID_NULO}`);
    await esperarFrame("decisao.vencida", desde, (f) => f.dados.decisaoId === pergunta?.decisao.id || f.dados.decisao_id === pergunta?.decisao.id);
    const vencida = (await json<SuaVezDto>("GET", "sua-vez")).itens.find((i) => i.decisao.id === pergunta?.decisao.id);
    expect(vencida?.estadoColuna).toBe("vencido");
    expect(vencida?.decisao.desfecho?.tipo).toBe("expirou_com_alguem_ciente");
    expect((await conversa(vera.conversaId)).mensagens.some((m) => m.kind === "sistema" && m.texto.includes("Este pedido venceu em"))).toBe(true);
    await new Promise((r) => setTimeout(r, 700)); // três voltas do varredor (200 ms): nada duplica
    const varridas = await comoPessoa((trx) => trx<{ n: number }[]>`select count(*)::int as n from decisao_eventos_varridos where decisao_id = ${pergunta?.decisao.id ?? UUID_NULO}`);
    expect(varridas[0]?.n).toBe(1);
    expect((await conversa(vera.conversaId)).mensagens.filter((m) => m.kind === "sistema" && m.texto.includes("Este pedido venceu em"))).toHaveLength(1);
    const reaberta = await json<RespostaMutacao>("POST", `decisoes/${pergunta?.decisao.id}/reabrir`);
    expect(reaberta.ids.decisaoId).toBe(pergunta?.decisao.id);
    const depois = await json<SuaVezDto>("GET", "sua-vez");
    expect(depois.itens[0]?.decisao.id).toBe(pergunta?.decisao.id);
    expect(depois.itens[0]?.estadoColuna).toBe("reaberto");
    const outra = srv.sessaoDe({ tenantId: srv.pessoa.tenantId, pessoaId: randomUUID() });
    expect((await json<SuaVezDto>("GET", "sua-vez", undefined, outra)).itens).toEqual([]);
  });

  it("pergunta ≠ permissão: falta_de_dado nomeia o dado e quem destrava; args malformados viram 'pergunta' (nunca permissão); decidir → 409; responder com texto retoma o turno com --resume", { timeout: JORNADA_MS }, async () => {
    const t = await rodar(vera.conversaId, `Preciso do orçamento. [[tool: pedir_a_pessoa {"tipo":"falta_de_dado","texto":"não achei o orçamento do Q4","dado":"orçamento do Q4","quem_destrava":"${NOME_PESSOA}"}]] [[texto: parei]]`);
    const dto = await conversa(vera.conversaId);
    const fila = await json<SuaVezDto>("GET", "sua-vez");
    const falta = fila.itens.find((i) => i.decisao.turnoId === t.id);
    expect(falta?.decisao.tipo, JSON.stringify({ t: t.id, fila: fila.itens.map((i) => [i.decisao.tipo, i.decisao.turnoId, i.estadoColuna]) })).toBe("falta_de_dado");
    // Emenda da ADR-045: a conversa recebe a FALA do agente ligada à decisão. Plano "pergunta com botões" (2026-10-18): a
    // frase da fila é a mesma fala, inteira — o molde "parei: falta X; quem destrava: Y; não vou tentar de novo" saiu.
    expect(dto.mensagens.find((m) => m.payload?.kind === "pedido_a_pessoa" && m.payload.decisaoId === falta?.decisao.id)?.texto).toBe("não achei o orçamento do Q4");
    expect(falta?.decisao.frase).toBe("não achei o orçamento do Q4");
    expect(dto.mensagens.some((m) => m.texto.startsWith("parei: falta"))).toBe(false);

    const mal = await rodar(vera.conversaId, '[[tool: pedir_a_pessoa {"texto":"posso?"}]] [[texto: parei]]');
    const malformada = (await json<SuaVezDto>("GET", "sua-vez")).itens.find((i) => i.decisao.turnoId === mal.id);
    expect(malformada?.decisao.tipo).toBe("pergunta");

    const decidir = await chamar("POST", `decisoes/${falta?.decisao.id}/decidir`, {});
    expect(decidir.status).toBe(409);
    const sessaoAntes = (await conversa(vera.conversaId)).conversa.sessaoCli;
    const resposta = await json<RespostaMutacao>("POST", `decisoes/${falta?.decisao.id}/responder`, { texto: "o orçamento do Q4 é R$ 120 mil [[texto: obrigado, continuo]]" });
    expect(resposta.ids.turnoRetomada).toBeTruthy();
    const retomado = await esperarTurno(resposta.ids.turnoRetomada ?? "");
    expect(retomado).toMatchObject({ origem: "retomada", retomaTurnoId: t.id, estado: "concluido" });
    expect(retomado.entradaTexto).toContain(`Resposta de ${NOME_PESSOA}`);
    // A resposta leva o vínculo com a pergunta: a web rotula "respondendo à pergunta das HH:MM".
    expect((await conversa(vera.conversaId)).mensagens.find((m) => m.id === resposta.ids.mensagem)?.payload).toMatchObject({ kind: "resposta_a_pedido", decisaoId: falta?.decisao.id, retomada: true });
    const dev = await json<{ registros: { turnoId: string; tipo: string; dados: Record<string, unknown> }[] }>("GET", "dev/catcher");
    // 0005: o catcher não tem sessão para retomar — o plano da retomada leva sessaoCli nulo (a
    // continuidade real por --resume é do claude-cli; ver sessao-por-executor.test.ts).
    expect(sessaoAntes).toBeNull();
    expect(dev.registros.find((r) => r.turnoId === retomado.id && r.tipo === "plano_recebido")?.dados.sessaoCli).toBeNull();
    expect((await json<SuaVezDto>("GET", "sua-vez")).itens.find((i) => i.decisao.id === falta?.decisao.id)).toBeUndefined();
    expect((await chamar("POST", `decisoes/${UUID_NULO}/responder`, { texto: "x" })).status).toBe(404);
  });

  it("pergunta com botões (plano #388): a recomendada vai para A no balão e em 'Sua vez'; o clique numa opção responde com o texto dela, grava via 'opcao' e retoma", { timeout: JORNADA_MS }, async () => {
    const t = await rodar(vera.conversaId, 'O #845 não fica verde. [[tool: pedir_a_pessoa {"tipo":"pergunta","texto":"O #845 não fica verde. Como sigo? Recomendo mergear: na VM o teste passou.","opcoes":["Tentar mais uma vez","Reapontar a pilha para a main","Mergear com o teste rodado na VM"],"recomendada":2}]] [[texto: parei]]');
    expect(t.estado).toBe("concluido");
    const balao = (await conversa(vera.conversaId)).mensagens.find((m) => m.turnoId === t.id && m.payload?.kind === "pedido_a_pessoa");
    const opcoes = ["Mergear com o teste rodado na VM", "Tentar mais uma vez", "Reapontar a pilha para a main"];
    expect(balao?.payload).toMatchObject({ kind: "pedido_a_pessoa", opcoes, recomendada: 0 });
    const item = (await json<SuaVezDto>("GET", "sua-vez")).itens.find((i) => i.decisao.turnoId === t.id);
    expect(item?.pedido).toMatchObject({ texto: "O #845 não fica verde. Como sigo? Recomendo mergear: na VM o teste passou.", opcoes, recomendada: 0 });
    expect(item?.decisao.frase).toBe("O #845 não fica verde. Como sigo? Recomendo mergear: na VM o teste passou.");
    // O clique manda o TEXTO da opção (EMENDA 16); um "via" no corpo é ignorado — quem calcula é o servidor.
    const resposta = await json<RespostaMutacao>("POST", `decisoes/${item?.decisao.id}/responder`, { texto: opcoes[0], via: "texto", opcao: 2 });
    const retomado = await esperarTurno(resposta.ids.turnoRetomada ?? "");
    expect(retomado).toMatchObject({ origem: "retomada", retomaTurnoId: t.id, estado: "concluido" });
    expect(retomado.entradaTexto).toContain("O #845 não fica verde. Como sigo?");
    expect((await conversa(vera.conversaId)).mensagens.find((m) => m.id === resposta.ids.mensagem)?.payload).toMatchObject({ kind: "resposta_a_pedido", decisaoId: item?.decisao.id, via: "opcao", opcao: 0 });
    // Outras palavras: via "texto", sem índice.
    const t2 = await rodar(vera.conversaId, '[[tool: pedir_a_pessoa {"tipo":"pergunta","texto":"Posso apagar a branch b14-rascunho?","opcoes":["Pode apagar","Deixa ela"]}]] [[texto: parei]]');
    const item2 = (await json<SuaVezDto>("GET", "sua-vez")).itens.find((i) => i.decisao.turnoId === t2.id);
    const livre = await json<RespostaMutacao>("POST", `decisoes/${item2?.decisao.id}/responder`, { texto: "pode, mas guarda o diff num gist antes" });
    await esperarTurno(livre.ids.turnoRetomada ?? "");
    const gravada = (await conversa(vera.conversaId)).mensagens.find((m) => m.id === livre.ids.mensagem)?.payload;
    expect(gravada).toMatchObject({ kind: "resposta_a_pedido", via: "texto" });
    expect(gravada && "opcao" in gravada).toBe(false);
  });
});
