import { afterAll, beforeAll, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import type { Driver } from "../../src/adapters/executor/spi.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { EstadoExecutor } from "../../src/contracts/executor.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { RespostaMutacao } from "../../src/contracts/api.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { driverFalso } from "../helpers/driver-falso.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

describeIntegracao("harnesses ponta a ponta sem fornecedores reais", () => {
  let srv: ServidorCompleto;
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  const planos: PlanoTurno[] = [];
  let bot: { agente: Agente; conversa: Conversa };
  beforeAll(async () => {
    const codex: Driver = { ...driverFalso({ aoReceberPlano: (p) => planos.push(p), inventario: { estado: "pronto", versao: "codex-falso", em: Date.now() } }), meta: { id: "codex-cli", locality: "local" } };
    srv = await servidorCompleto({ env: { NOD_EXECUTOR: "auto", NOD_MODELO: "auto" }, drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod }), codex] });
  }, 30000);
  afterAll(async () => { if (srv) { await srv.fechar(); await limparPessoaE2E(srv.db, srv.dbDono, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, criados); await srv.desligar(); } }, 30000);
  async function rodar() {
    const resposta = await srv.json<RespostaMutacao>("POST", `conversas/${bot.conversa.id}/mensagens`, { texto: "[[texto: olá pelo Codex]]" });
    await srv.esperar(async () => { const { turno } = await srv.json<{ turno: Turno }>("GET", `turnos/${resposta.ids.turno}`); return turno.estado === "concluido" ? turno : null; }, { timeoutMs: 15000 });
    return planos.find((p) => p.turnoId === resposta.ids.turno)!;
  }
  it("só Codex conectado: detecta automaticamente, cria agente sem configuração e responde pelo harness correto", async () => {
    const estado = await srv.json<EstadoExecutor>("GET", "executor");
    expect(estado.atual).toBe("codex-cli"); expect(estado.harnesses).toMatchObject({ padrao: "codex-cli", simulacao: false });
    bot = await srv.json("POST", "agentes", { dono: "pessoa", interativo: true });
    criados.agentes.push(bot.agente.id); criados.conversas.push(bot.conversa.id);
    expect(bot.agente).toMatchObject({ harness: "auto", modelo: "auto" });
    expect(await rodar()).toMatchObject({ harness: "codex-cli", executor: "local", entrada: { modelo: "gpt-5.6-sol", sessaoCli: null } });
  }, 30000);
  it("troca de modelo pela API vale para o próximo turno sem trocar o padrão dos demais agentes", async () => {
    await srv.json("PATCH", `agentes/${bot.agente.id}`, { harness: "codex-cli", modelo: "gpt-6-astra" });
    expect(await rodar()).toMatchObject({ harness: "codex-cli", entrada: { modelo: "gpt-6-astra", sessaoCli: null } });
    const invalido = await srv.chamar("PATCH", `agentes/${bot.agente.id}`, { harness: "claude-cli", modelo: "gpt-6-astra" });
    expect(invalido.status).toBe(400);
    await srv.json("PATCH", `agentes/${bot.agente.id}`, { harness: "auto", modelo: "auto" });
    expect(await rodar()).toMatchObject({ harness: "codex-cli", entrada: { modelo: "gpt-5.6-sol" } });
  }, 30000);
});
