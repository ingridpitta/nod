import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { DriverComputador } from "../../src/contracts/computador.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-200 (QA): a chave NOD_CAPTURA_NO_TRANSCRIPT chega do ambiente ao `compor` e liga o guardador e o serviço
 * juntos. Os testes da captura (tests/integration/captura-turno.test.ts) injetam a chave direto no helper; este
 * sobe o servidor completo e prova a costura: ligada, a tela que o bot observou pela ferramenta HTTP fica
 * legível em `services.capturas` até a ponte esquecer; ausente ou "0", nada fica.
 */
const PNG = Buffer.from("\x89PNG tela do bot").toString("base64");
const driver = (): DriverComputador => {
  const ativos = new Set<string>();
  return {
    ambiente: async () => ({ disponivel: true, motivo: null }),
    estado: async (id) => ({ disponivel: true, ativo: ativos.has(id), motivo: null }),
    iniciar: async (id) => { ativos.add(id); },
    parar: async (id) => { ativos.delete(id); },
    ligados: async () => new Set(ativos),
    executar: async () => ({ tela: { quadro: randomUUID(), imagem: PNG, largura: 1280, altura: 800, titulo: "Teste", url: "https://example.com", texto: "Tela", abas: [] } }),
  };
};

for (const [rotulo, valor, ligada] of [["ligada (1)", "1", true], ["ausente", undefined, false], ["em 0", "0", false]] as const) {
  describeIntegracao(`NOD-200 pelo servidor completo: chave ${rotulo}`, () => {
    let srv: ServidorCompleto;
    let bot: { agente: Agente; conversa: Conversa };
    beforeAll(async () => {
      srv = await servidorCompleto({ computador: driver(), env: { NOD_MODO: "compartilhado", NOD_CAPTURA_NO_TRANSCRIPT: valor }, intervalos: { orquestradorMs: 3_600_000, schedulerMs: 3_600_000, expiracaoMs: 3_600_000 } });
      bot = await srv.json("POST", "agentes", { dono: "pessoa", interativo: true });
    }, 30_000);
    afterAll(async () => {
      if (!srv) return;
      await srv.fechar();
      await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [bot.agente.id], conversas: [bot.conversa.id] });
      await srv.desligar();
    }, 30_000);

    it(ligada ? "a tela observada pelo bot fica em capturas até esquecer" : "nada fica em capturas", async () => {
      const plano: PlanoTurno = await srv.app.dentro(srv.pessoa, async (d) => {
        await d.tx(async (trx) => { await trx`update agentes set confirmado = true where id = ${bot.agente.id}`; });
        const t = await d.repos.turnos.enfileirar({ executor: "catcher", agenteId: bot.agente.id, conversaId: bot.conversa.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "Use seu computador", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" });
        return (await emitirPlanoTurno(d, { turnoId: t!.id, machineId: randomUUID(), executor: "catcher" })).data;
      });
      const r = await fetch(`${srv.url}/api/interno/ferramentas/computador_observar`, { method: "POST", headers: { authorization: `Bearer ${plano.tokenDeTurno}`, "content-type": "application/json" }, body: JSON.stringify({ argumentos: {} }) });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ ok: true, imagem: { mimeType: "image/png" } });
      const ler = () => srv.app.dentro(srv.pessoa, async (d) => {
        const bytes = d.services.capturas?.ler(plano.turnoId) ?? null;
        return bytes ? Buffer.from(bytes).toString("base64") : null;
      });
      if (!ligada) {
        expect(await ler()).toBeNull();
        return;
      }
      expect(await ler()).toBe(PNG);
      // Ler não esquece (o assentar repetido por impasse acha a mesma); quem esquece é a ponte.
      expect(await ler()).toBe(PNG);
      await srv.app.dentro(srv.pessoa, async (d) => { d.services.capturas?.esquecer(plano.turnoId); });
      expect(await ler()).toBeNull();
    }, 30_000);
  });
}
