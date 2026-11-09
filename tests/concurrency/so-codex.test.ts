import { afterAll, beforeAll, expect, it } from "vitest";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { RespostaMutacao } from "../../src/contracts/api.ts";
import { vincularEscopo } from "../../src/db/tx.ts";

/**
 * #313 (teste de um sócio, 14/10): a VM com SÓ o ChatGPT logado. O app/motor manda em `inventario` o estado do Claude (sem
 * login) e o do Codex em `harnesses`. Antes: as 17 mensagens viraram negação "Claude Code sem conta conectada" no envio e a
 * máquina nunca puxou nada. Agora: o envio passa, a máquina puxa, o plano sai pelo Codex e com o executor local.
 */
describeIntegracao("#313: máquina só com o ChatGPT (Codex) roda os bots", () => {
  let srv: ServidorCompleto;
  let chave = "", machineId = "", conversaId = "", agenteId = "";
  const semLogin = { estado: "nao_autenticado", motivo: "Entre na conta do harness neste computador", em: 0 };
  const codex = { estado: "pronto", versao: "0.162.0", em: 0 };
  const pedir = (nome: string, body: unknown = {}) => fetch(`${srv.url}/api/maquina/${nome}`, {
    method: "POST", headers: { authorization: `Bearer ${chave}`, "content-type": "application/json", "x-nod-versao": "0.1.0" }, body: JSON.stringify(body),
  });
  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20" } });
    const a = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "gamefik-codex-dev" });
    chave = a.chave; machineId = a.dados.id;
    const bot = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Chico", descricao: "Ajuda o time" });
    agenteId = bot.agente.id; conversaId = bot.conversa.id;
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`; });
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [agenteId], conversas: [conversaId] });
    await srv.desligar();
  });

  it("o envio não é negado, a máquina puxa o turno e o plano sai pelo Codex, com o executor local", async () => {
    const r = await pedir("conectar", { nome: "gamefik-codex-dev", plataforma: "linux", versaoContrato: 1, inventario: semLogin, harnesses: { "claude-cli": semLogin, "codex-cli": codex } });
    expect(r.status).toBe(200);
    const enviada = await srv.json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto: "oi" });
    expect(enviada.ids.negacao).toBeUndefined();
    const { plano } = await (await pedir("puxar")).json() as { plano: PlanoTurno };
    expect(plano).toMatchObject({ turnoId: enviada.ids.turno, machineId, harness: "codex-cli", executor: "local" });
    await srv.json("POST", `conversas/${conversaId}/parar`, {});
  });
});
