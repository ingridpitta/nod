import { afterAll, beforeAll, expect, it } from "vitest";
import type { RespostaMutacao } from "../../src/contracts/api.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { EstadoExecutor } from "../../src/contracts/executor.ts";
import type { IasDaPessoa } from "../../src/contracts/inteligencia.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { Entrega } from "../../src/contracts/ponte.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { classificarSessao, interpretarLinhaStreamJson } from "../../src/domain/stream-json.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Limite simulado (definido em 2026-10-10, plano das IAs, PR 2): o servidor compartilhado de verdade, um "Mac" falso que
 * anuncia Claude e Codex prontos e um "driver" falso que devolve ao Claude o que o CLI manda no teto da assinatura
 * (`rate_limit_event` `rejected` e o `result` com erro, classificados pelo MESMO stream-json.ts do driver). Prova a troca:
 * o turno do bot no Automático é repetido no Codex, a conversa ganha a linha `ia_trocada` com causa `limite`, `GET /ias`
 * mostra o Claude no limite até a hora do fornecedor, e uma máquina que só tem o Claude não pega turno do Automático
 * enquanto o Codex está pronto. Custo zero: nenhum CLI roda.
 */
describeIntegracao("limite da assinatura troca de IA (emenda da ADR-036)", () => {
  let srv: ServidorCompleto;
  let chaveA = "", chaveB = "", maquinaA = "", maquinaB = "", conversaId = "", agenteId = "";
  let seq = 0;
  const sinais = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false };
  const pronto = { estado: "pronto", versao: "fake-sem-custo", em: 0 };
  const pedir = (nome: string, body: unknown, token: string) => fetch(`${srv.url}/api/maquina/${nome}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-nod-versao": "0.1.0" }, body: JSON.stringify(body),
  });
  const puxar = async (token: string) => ((await (await pedir("puxar", {}, token)).json()) as { plano: PlanoTurno | null }).plano;
  /** O "driver" falso: o que o Claude Code imprime no teto da assinatura, classificado pelo parser do driver de verdade. */
  const renovaEm = Math.floor(Date.now() / 1000) + 3 * 3600;
  const noLimite = (): ResultadoTurno => classificarSessao({
    eventos: [
      '{"type":"system","subtype":"init","session_id":"ff68ffc2-f8ba-44ed-9f8a-483e3c4b3684","tools":[],"model":"opus","claude_code_version":"2.1.296"}',
      `{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":${renovaEm},"rateLimitType":"five_hour","unifiedWindows":{"five_hour":{"utilization":1,"resetsAt":${renovaEm}}}}}`,
      '{"type":"result","subtype":"success","is_error":true,"result":"Claude AI usage limit reached","num_turns":1,"usage":{}}',
    ].map(interpretarLinhaStreamJson),
    exitCode: 0, signal: null, stderr: "",
  });
  const respondeu = (texto: string): ResultadoTurno => ({ desfecho: "sucesso", texto, sessaoCli: null, sinais: { ...sinais, producedOutput: true }, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] });
  const entregar = (plano: PlanoTurno, resultado: ResultadoTurno, token: string) => {
    const e: Entrega = { turnoId: plano.turnoId, machineId: plano.machineId, seqLocal: ++seq, fala: { tipo: "texto", texto: resultado.texto }, resultado };
    return pedir("entregar", e, token);
  };

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20" } });
    const a = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "Mac com as duas" });
    const b = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "Mac só com o Claude" });
    chaveA = a.chave; maquinaA = a.dados.id; chaveB = b.chave; maquinaB = b.dados.id;
    const bot = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Bot do limite", descricao: "Ajuda o time" });
    agenteId = bot.agente.id; conversaId = bot.conversa.id;
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`;
      await tx`update preferencias set ias_no_limite = '{}', ordem_ias = null where owner_id = ${srv.pessoa.pessoaId}`;
    });
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [agenteId], conversas: [conversaId] });
    await srv.desligar();
  });

  it("o bot novo está no Automático; no servidor compartilhado não há interruptor de executor", async () => {
    const bot = await srv.json<{ inteligencia: unknown }>("GET", `agentes/${agenteId}/inteligencia`);
    expect(bot.inteligencia).toEqual({ modo: "auto", fixa: null, ordem: null, escolhas: {} });
    expect((await srv.json<EstadoExecutor>("GET", "executor")).trocavel).toBe(false);
    expect((await srv.chamar("POST", "executor", { id: "codex-cli" })).status).toBe(404);
  });

  it("Claude no limite: o turno é repetido no Codex, a conversa ganha a linha da troca e o Claude fica fora até a hora do fornecedor", async () => {
    const r = await pedir("conectar", { nome: "Mac com as duas", versaoContrato: 1, inventario: pronto, harnesses: { "claude-cli": pronto, "codex-cli": pronto } }, chaveA);
    expect(r.status).toBe(200);
    const enviada = await srv.json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto: "Resuma a semana" });
    const primeiro = await puxar(chaveA);
    // A ordem padrão (Claude primeiro) e o Recomendado: Opus, raciocínio médio.
    expect(primeiro).toMatchObject({ turnoId: enviada.ids.turno, harness: "claude-cli", entrada: { modelo: "opus", esforco: "medium" } });

    expect((await entregar(primeiro!, noLimite(), chaveA)).status).toBe(200);
    const segundo = await puxar(chaveA);
    expect(segundo).toMatchObject({ harness: "codex-cli", entrada: { modelo: "gpt-5.6-sol", esforco: "medium" } });
    expect(segundo!.turnoId).not.toBe(primeiro!.turnoId);
    expect(segundo!.entrada.texto).toContain("Resuma a semana");

    // Chat limpo (ADR-114, PR 2): a linha da troca é gravada, mas mora na Atividade do bot (Máquina e IA), fora da janela.
    const conversa = await srv.json<{ mensagens: Mensagem[] }>("GET", `conversas/${conversaId}/mensagens`);
    expect(conversa.mensagens.some((m) => m.payload?.kind === "ia_trocada")).toBe(false);
    expect(conversa.mensagens.some((m) => m.payload?.kind === "limite_do_plano")).toBe(false);
    const gravadas = await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      return tx<{ payload: Mensagem["payload"] }[]>`select payload from mensagens where conversa_id = ${conversaId} and payload->>'kind' in ('ia_trocada', 'limite_do_plano')`;
    });
    expect(gravadas.map((g) => g.payload)).toEqual([{ kind: "ia_trocada", de: "claude-cli", para: "codex-cli", causa: "limite", renovaEm: renovaEm * 1000 }]);
    const atividade = await srv.json<{ itens: { titulo: string; categoria: string | null }[] }>("GET", `agentes/${agenteId}/atividade?dia=${new Date().toISOString().slice(0, 10)}&fuso=UTC`);
    expect(atividade.itens).toContainEqual(expect.objectContaining({ titulo: "Trocou de IA", categoria: "maquina_ia" }));

    const ias = await srv.json<IasDaPessoa>("GET", "ias");
    expect(ias.ias.find((i) => i.id === "claude-cli")).toMatchObject({ limite: { renovaEm: renovaEm * 1000 }, inventario: { estado: "nao_autenticado", causa: "limite", renovaEm: renovaEm * 1000 } });
    expect(ias.ias.find((i) => i.id === "codex-cli")).toMatchObject({ limite: null, inventario: { estado: "pronto" } });

    expect((await entregar(segundo!, respondeu("Semana resumida."), chaveA)).status).toBe(200);
    expect((await srv.json<{ turno: { estado: string } }>("GET", `turnos/${segundo!.turnoId}`)).turno.estado).toBe("concluido");
  });

  it("com o Claude no limite, o Mac que só tem o Claude não pega turno do Automático; o que tem o Codex pega, já no Codex", async () => {
    expect((await pedir("conectar", { nome: "Mac só com o Claude", versaoContrato: 1, inventario: pronto, harnesses: { "claude-cli": pronto } }, chaveB)).status).toBe(200);
    const enviada = await srv.json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto: "E a próxima?" });
    expect(await puxar(chaveB)).toBeNull();
    const plano = await puxar(chaveA);
    expect(plano).toMatchObject({ turnoId: enviada.ids.turno, harness: "codex-cli", machineId: maquinaA });
    expect((await entregar(plano!, respondeu("Pronto."), chaveA)).status).toBe(200);
    expect(maquinaB).not.toBe(maquinaA);
  });

  it("a ordem própria do bot e a escolha de modelo e raciocínio valem no próximo turno; o Claude volta quando o limite sai", async () => {
    expect((await srv.chamar("PUT", `agentes/${agenteId}/inteligencia`, { ordem: ["codex-cli", "claude-cli"], escolhas: { "codex-cli": { modelo: "gpt-5.6-luna", raciocinio: "high" } } })).status).toBe(200);
    await srv.json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto: "Pelo Luna" });
    const plano = await puxar(chaveA);
    expect(plano).toMatchObject({ harness: "codex-cli", entrada: { modelo: "gpt-5.6-luna", esforco: "high" } });
    expect((await entregar(plano!, respondeu("Feito."), chaveA)).status).toBe(200);

    // A ordem da pessoa (Claude primeiro) com o bot voltando a segui-la; o limite sai (o fornecedor liberou antes).
    expect((await srv.chamar("PUT", "preferencias", { ordemIas: ["claude-cli", "codex-cli"] })).status).toBe(200);
    expect((await srv.chamar("PUT", `agentes/${agenteId}/inteligencia`, { ordem: null })).status).toBe(200);
    await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); await tx`update preferencias set ias_no_limite = jsonb_build_object('claude-cli', jsonb_build_object('renovaEm', 1, 'desde', 0)) where owner_id = ${srv.pessoa.pessoaId}`; });
    await srv.json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto: "De volta ao Claude" });
    // O puxar relê os limites a cada 30 s ou quando uma ponte grava um; aqui o prazo vencido já basta: a fila não segura
    // o Claude (o prazo é comparado com o relógio), e o plano o escolhe pela ordem.
    const deVolta = await puxar(chaveA);
    expect(deVolta).toMatchObject({ harness: "claude-cli", entrada: { modelo: "opus" } });
    expect((await entregar(deVolta!, respondeu("Oi de novo."), chaveA)).status).toBe(200);
    const ias = await srv.json<IasDaPessoa>("GET", "ias");
    expect(ias.ias.find((i) => i.id === "claude-cli")?.limite).toBeNull();
  });
});
