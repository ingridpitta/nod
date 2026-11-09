import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Inventario } from "../../src/contracts/inventario.ts";
import { LINHA_CALIBRACAO, LINHA_WHATSAPP } from "../../src/domain/prompt-sistema.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { gravarPreferencias } from "../../src/use-cases/raio-x.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-112 (0089) no Postgres: a chave "Modo WhatsApp" da pessoa muda sozinha, chega ao plano do turno seguinte (a linha
 * "Tom:" no lugar da "Formatação:") e o Raio-X grava o que valeu. Desligada, o plano sai como antes.
 */
const escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto: Inventario = { estado: "pronto", versao: "teste", em: Date.now() };

describeIntegracao("Modo WhatsApp (ADR-112)", () => {
  async function montar(trx: Parameters<Parameters<typeof withRollback>[1]>[0]) {
    const base = await agenteComConversa(trx, escopo);
    const agora = () => Date.now();
    const deps = depsSobre(base.repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
    const plano = async () => {
      const turno = (await base.repos.turnos.enfileirar({ executor: "local", agenteId: base.agenteId, conversaId: base.conversaId, origem: "conversa", prazoEm: agora() + 60_000, profundidade: 0, entradaTexto: "e aí?", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" }))!;
      const p = (await emitirPlanoTurno(deps, { turnoId: turno.id, machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto } })).data;
      return { p, experimentos: (await base.repos.raioX.doTurno(turno.id))?.composicao?.experimentos };
    };
    return { ...base, deps, plano };
  }

  it("a preferência: nasce desligada, muda sozinha sem mexer nas outras chaves e recusa o que não é booleano", async () => {
    await withRollback(escopo, async (trx) => {
      const m = await montar(trx);
      expect((await m.repos.preferencias.buscar()).experimentos).toEqual({ calibracao: false, memoriaLonga: false, whatsapp: false, quadro: false });
      await gravarPreferencias(m.deps, { experimentos: { calibracao: true } });
      const ligada = (await gravarPreferencias(m.deps, { experimentos: { whatsapp: true } })).data;
      expect(ligada.experimentos).toEqual({ calibracao: true, memoriaLonga: false, whatsapp: true, quadro: false });
      expect(ligada.modoDev).toBe(false);
      expect((await gravarPreferencias(m.deps, { experimentos: { calibracao: false } })).data.experimentos).toEqual({ calibracao: false, memoriaLonga: false, whatsapp: true, quadro: false });
      for (const ruim of [{ whatsapp: "sim" }, { whatsapp: 1 }, { whatsApp: true }]) {
        await expect(gravarPreferencias(m.deps, { experimentos: ruim })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      }
    });
  });

  it("desligada: a Formatação de sempre e o Raio-X grava whatsapp desligado; ligada no meio, vale no turno seguinte", async () => {
    await withRollback(escopo, async (trx) => {
      const m = await montar(trx);
      const antes = await m.plano();
      expect(antes.p.promptSistema).toContain("Formatação:");
      expect(antes.p.promptSistema).not.toContain(LINHA_WHATSAPP);
      expect(antes.experimentos).toEqual({ calibracao: false, memoriaLonga: false, whatsapp: false, anexosAnteriores: 0 });

      await gravarPreferencias(m.deps, { experimentos: { whatsapp: true } });
      const depois = await m.plano();
      expect(depois.p.promptSistema).toContain(LINHA_WHATSAPP);
      expect(depois.p.promptSistema).not.toContain("Formatação:");
      expect(depois.p.promptSistemaPartes?.estavel).toContain(LINHA_WHATSAPP);
      expect(depois.experimentos).toEqual({ calibracao: false, memoriaLonga: false, whatsapp: true, anexosAnteriores: 0 });
    });
  });

  it("com a Calibração: as duas linhas entram, a da Calibração logo depois do Tom", async () => {
    await withRollback(escopo, async (trx) => {
      const m = await montar(trx);
      await m.repos.preferencias.gravar({ experimentos: { calibracao: true, whatsapp: true } });
      const { p, experimentos } = await m.plano();
      expect(p.promptSistema).toContain(`${LINHA_WHATSAPP}\n${LINHA_CALIBRACAO}`);
      expect(experimentos).toMatchObject({ calibracao: true, whatsapp: true });
    });
  });
});
