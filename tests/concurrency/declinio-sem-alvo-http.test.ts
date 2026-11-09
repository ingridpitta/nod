import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { RespostaMutacao } from "../../src/contracts/api.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Tx } from "../../src/shared/types.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-301 (emenda da ADR-102): o servidor de verdade no modo compartilhado e duas máquinas falsas da mesma pessoa — o Mac,
 * com a única conta do Claude dele no limite, e a VM, com outra conta do Claude livre. O bot não tem máquina (turno sem
 * alvo). Antes, o Mac pegava primeiro e a conversa ganhava a nota de limite; agora ele deixa passar e a VM pega. Custo
 * zero: nenhum CLI roda.
 */
describeIntegracao("NOD-301: turno sem alvo e a máquina sem conta livre", () => {
  let srv: ServidorCompleto;
  let chaveMac = "", chaveVm = "", vmId = "", conversaId = "", agenteId = "";
  const pronto = { estado: "pronto", versao: "fake-sem-custo", em: 0 };
  const IMP_MAC = `${"a".repeat(56)}00000001`;
  const IMP_VM = `${"b".repeat(56)}00000002`;
  const conta = (impressao: string) => ({ impressao, ia: "claude-cli", estado: "pronta", plano: "Max", corporativa: false, logadaEm: Date.now() - 60_000 });
  const pedir = (nome: string, body: unknown, token: string) => fetch(`${srv.url}/api/maquina/${nome}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-nod-versao": "0.1.0" }, body: JSON.stringify(body),
  });
  const puxar = async (token: string) => ((await (await pedir("puxar", {}, token)).json()) as { plano: PlanoTurno | null }).plano;
  const sql = async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
    const caixa: { valor?: T } = {};
    await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); caixa.valor = await fn(tx); });
    return caixa.valor as T;
  };

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20" } });
    const mac = await srv.json<{ chave: string }>("POST", "maquinas/chaves", { nome: "Mac" });
    const vm = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "VM" });
    chaveMac = mac.chave; chaveVm = vm.chave; vmId = vm.dados.id;
    const bot = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Bot sem máquina", descricao: "Ajuda o time" });
    agenteId = bot.agente.id; conversaId = bot.conversa.id;
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await sql(async (tx) => {
      await tx`delete from contas_ia where owner_id = ${srv.pessoa.pessoaId}`;
      await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`;
    });
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [agenteId], conversas: [conversaId] });
    await srv.desligar();
  });

  it("o Mac deixa passar a fala e a VM, com conta livre, pega — sem nota de limite", async () => {
    expect((await pedir("conectar", { nome: "Mac", versaoContrato: 1, inventario: pronto, harnesses: { "claude-cli": pronto }, contas: [conta(IMP_MAC)] }, chaveMac)).status).toBe(200);
    expect((await pedir("conectar", { nome: "VM", plataforma: "linux", versaoContrato: 1, inventario: pronto, harnesses: { "claude-cli": pronto }, contas: [conta(IMP_VM)] }, chaveVm)).status).toBe(200);
    // As duas contas na troca automática; a do Mac no limite pelas próximas 3 h.
    await sql(async (tx) => { await tx`update contas_ia set entra_na_troca_automatica = true,
      no_limite_ate = case when impressao = ${IMP_MAC} then now() + interval '3 hours' else null end where owner_id = ${srv.pessoa.pessoaId}`; });

    const enviada = await srv.json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto: "Resuma a semana" });
    expect(await puxar(chaveMac)).toBeNull();
    const plano = await puxar(chaveVm);
    expect(plano).toMatchObject({ turnoId: enviada.ids.turno, machineId: vmId, harness: "claude-cli" });
    expect(plano?.conta?.impressao).toBe(IMP_VM);

    const notas = await sql((tx) => tx<{ texto: string }[]>`select texto from mensagens where conversa_id = ${conversaId} and autor_tipo <> 'pessoa'`);
    expect(notas.map((m) => m.texto).join("\n")).not.toMatch(/limite/);
    await srv.json("POST", `conversas/${conversaId}/parar`, {});
  });
});
