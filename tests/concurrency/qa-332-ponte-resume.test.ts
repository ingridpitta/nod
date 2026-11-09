import { afterAll, beforeAll, expect, it } from "vitest";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { Entrega } from "../../src/contracts/ponte.ts";
import { vincularEscopo } from "../../src/db/tx.ts";

const SESSAO = "5d0c6a52-3a5b-4c1e-9f0a-3320aa281332";

/**
 * QA do PR #332 (NOD-281, ADR-107 §3): no modo compartilhado o emitir volta a permitir resume (compor.ts). Pelo caminho
 * real (servidor + ponte HTTP), o segundo turno na mesma máquina recebe a sessão que o primeiro deixou.
 */
describeIntegracao("QA #332: ponte compartilhada retoma a sessão na mesma máquina", () => {
  let srv: ServidorCompleto;
  let chave = "", machineId = "", conversaId = "", agenteId = "";
  const sinais = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
  const pedir = (nome: string, body: unknown = {}) => fetch(`${srv.url}/api/maquina/${nome}`, {
    method: "POST", headers: { authorization: `Bearer ${chave}`, "content-type": "application/json", "x-nod-versao": "0.1.0" }, body: JSON.stringify(body),
  });
  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20" } });
    const a = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "Mac A" });
    chave = a.chave; machineId = a.dados.id;
    const bot = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Bot QA 332", descricao: "Ajuda o time" });
    agenteId = bot.agente.id; conversaId = bot.conversa.id;
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`; });
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [agenteId], conversas: [conversaId] });
    await srv.desligar();
  });

  it("dois turnos seguidos na mesma máquina: o segundo plano vem com a sessão do primeiro", async () => {
    expect((await pedir("conectar", { nome: "Mac", machineId: "ignorado", versaoContrato: 1, inventario: { estado: "pronto", versao: "fake-sem-custo", em: 0 } })).status).toBe(200);
    const turno = async (texto: string, sessaoDevolvida: string, seqLocal: number): Promise<PlanoTurno> => {
      await srv.json("POST", `conversas/${conversaId}/mensagens`, { texto });
      const { plano } = await (await pedir("puxar")).json() as { plano: PlanoTurno };
      const entrega: Entrega = { turnoId: plano.turnoId, machineId, seqLocal, fala: { tipo: "texto", texto: "ok" }, resultado: {
        desfecho: "sucesso", texto: "ok", sessaoCli: sessaoDevolvida, sinais, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
      } };
      expect((await pedir("entregar", entrega)).status).toBe(200);
      return plano;
    };
    const p1 = await turno("primeira", SESSAO, 1);
    expect(p1.entrada.sessaoCli).toBeNull();
    const p2 = await turno("segunda", SESSAO, 2);
    expect(p2.entrada.sessaoCli).toBe(SESSAO);
  });
});
