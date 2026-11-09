import { afterAll, beforeAll, expect, it } from "vitest";
import type { RespostaMutacao } from "../../src/contracts/api.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
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
 * NOD-268 (a conversa inundada de 15/10): o servidor de verdade, duas máquinas falsas — A com o Claude e o Codex, B só
 * com o Claude — e o bot no Automático preso a B (ADR-090). O Claude bate no limite em B. Antes, o turno ia para o Codex
 * em `auto`, A o pegava, rodava, voltava ao limite noutra volta… dezenas de reenvios. Agora: no máximo 1 reenvio (aqui,
 * nenhum — o Codex não está em B), o turno fica com `acordar_em` na hora do limite e a conversa ganha UMA linha.
 * Custo zero: nenhum CLI roda.
 */
describeIntegracao("NOD-268: IA no limite com o bot preso a uma máquina só com o Claude", () => {
  let srv: ServidorCompleto;
  let chaveA = "", chaveB = "", maquinaB = "", conversaId = "", agenteId = "";
  let seq = 0;
  const pronto = { estado: "pronto", versao: "fake-sem-custo", em: 0 };
  const pedir = (nome: string, body: unknown, token: string) => fetch(`${srv.url}/api/maquina/${nome}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-nod-versao": "0.1.0" }, body: JSON.stringify(body),
  });
  const puxar = async (token: string) => ((await (await pedir("puxar", {}, token)).json()) as { plano: PlanoTurno | null }).plano;
  const renovaEm = Math.floor(Date.now() / 1000) + 3 * 3600;
  const noLimite = (): ResultadoTurno => classificarSessao({
    eventos: [
      '{"type":"system","subtype":"init","session_id":"0d3c9a54-4c1e-4f5e-9d8a-2b7f0e6a1c11","tools":[],"model":"opus","claude_code_version":"2.1.296"}',
      `{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":${renovaEm},"rateLimitType":"five_hour","unifiedWindows":{"five_hour":{"utilization":1,"resetsAt":${renovaEm}}}}}`,
      '{"type":"result","subtype":"success","is_error":true,"result":"Claude AI usage limit reached","num_turns":1,"usage":{}}',
    ].map(interpretarLinhaStreamJson),
    exitCode: 0, signal: null, stderr: "",
  });
  const entregar = (plano: PlanoTurno, resultado: ResultadoTurno, token: string) => {
    const e: Entrega = { turnoId: plano.turnoId, machineId: plano.machineId, seqLocal: ++seq, fala: { tipo: "texto", texto: resultado.texto }, resultado };
    return pedir("entregar", e, token);
  };
  const turnosDaConversa = () => srv.db.begin(async (tx) => {
    await vincularEscopo(tx, srv.pessoa);
    return tx<{ id: string; estado: string; harness: string; reenvios: number; acordar_em: Date | null; mensagem_origem_id: string | null }[]>`
      select id, estado, harness, reenvios, acordar_em, mensagem_origem_id from turnos where conversa_id = ${conversaId} order by criado_em`;
  });

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20" } });
    const a = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "Mac com as duas" });
    const b = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "Mac só com o Claude" });
    chaveA = a.chave; chaveB = b.chave; maquinaB = b.dados.id;
    const bot = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Bot preso ao B", descricao: "Ajuda o time" });
    agenteId = bot.agente.id; conversaId = bot.conversa.id;
    expect((await srv.chamar("PUT", `agentes/${agenteId}/maquina`, { maquinaId: maquinaB })).status).toBe(200);
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

  it("Claude no limite em B, Codex pronto só em A: no máximo 1 reenvio, o turno espera com acordar_em e há UMA linha", async () => {
    expect((await pedir("conectar", { nome: "Mac com as duas", versaoContrato: 1, inventario: pronto, harnesses: { "claude-cli": pronto, "codex-cli": pronto } }, chaveA)).status).toBe(200);
    expect((await pedir("conectar", { nome: "Mac só com o Claude", versaoContrato: 1, inventario: pronto, harnesses: { "claude-cli": pronto } }, chaveB)).status).toBe(200);
    const enviada = await srv.json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto: "Resuma a semana" });
    // O bot é do B: A não pega.
    expect(await puxar(chaveA)).toBeNull();
    const primeiro = await puxar(chaveB);
    expect(primeiro).toMatchObject({ turnoId: enviada.ids.turno, harness: "claude-cli" });
    expect((await entregar(primeiro!, noLimite(), chaveB)).status).toBe(200);

    // Nenhuma das duas pega de novo: a fala espera a hora do limite (antes, o Codex em `auto` girava entre as máquinas).
    for (let i = 0; i < 3; i++) {
      expect(await puxar(chaveA)).toBeNull();
      expect(await puxar(chaveB)).toBeNull();
    }

    const turnos = await turnosDaConversa();
    expect(turnos.filter((t) => t.reenvios > 0).length).toBeLessThanOrEqual(1);
    const espera = turnos.filter((t) => t.estado === "pendente");
    expect(espera).toHaveLength(1);
    expect(espera[0]!.acordar_em?.getTime()).toBe(renovaEm * 1000);
    expect(espera[0]!.harness).toBe("auto");

    const conversa = await srv.json<{ mensagens: Mensagem[] }>("GET", `conversas/${conversaId}/mensagens`);
    const depois = conversa.mensagens.filter((m) => m.autoria.autor_tipo !== "pessoa");
    expect(depois.map((m) => m.texto)).toHaveLength(1);
    expect(depois[0]?.texto).toMatch(/^O Claude Code está no limite da assinatura\. O Codex está pronto noutra máquina, mas este bot roda em Mac só com o Claude\. Sua mensagem volta sozinha (às|em \d\d\/\d\d às) \d\d:\d\d\.$/);
  });
});
