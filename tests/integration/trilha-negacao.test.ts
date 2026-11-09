import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { FERRAMENTAS_NOD } from "../../src/contracts/ferramentas-nod.ts";
import type { FerramentaPlano } from "../../src/contracts/plano-turno.ts";
import { chamarFerramenta } from "../../src/use-cases/chamar-ferramenta.ts";
import { REGRA_PARADA_ALCADA } from "../../src/use-cases/registrar-negacao.ts";
import { agenteComConversa, autoriaAgente } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, planoDeTeste, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const hoje = () => new Date().toISOString().slice(0, 10);

/**
 * E8.4/ADR-004: toda negação do ponto de decisão vira linha na trilha com horário, ferramenta,
 * motivo e a regra — e passa nos CHECKs do banco (sem texto livre). O filtro dia/agente/conector
 * devolve exatamente o recorte.
 */
describeIntegracao("trilha de negações com filtro dia/agente/conector", () => {
  it("negações de dois agentes e um conector: filtrar por agente, por conector e por dia devolve o recorte exato", async () => {
    await withRollback(MARLON, async (trx) => {
      const a = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const b = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const repos = a.repos;
      const conector = await repos.conectores.criar({ nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      const conectorId = conector?.id ?? "";
      await repos.conectores.registrarSonda(conectorId, { ok: true, catalogo: [{ nome: "enviar", descricao: "", schema: { type: "object" }, readOnlyHint: false }], agora: Date.now() });
      const turnoA = await repos.turnos.enfileirar({ executor: "catcher", conversaId: a.conversaId, agenteId: a.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      const turnoB = await repos.turnos.enfileirar({ executor: "catcher", conversaId: b.conversaId, agenteId: b.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste(), trx });
      const enviar: FerramentaPlano = { nome: "exemplo__enviar", nomeMcp: "mcp__nod__exemplo__enviar", origem: "conector", conectorId, readOnlyHint: false, tocaDadoPessoal: false, schema: { type: "object" } };
      const lembrar: FerramentaPlano = { nome: "lembrar", nomeMcp: "mcp__nod__lembrar", origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD.lembrar };
      const maquina = randomUUID();
      const planoDe = (turnoId: string, agenteId: string, conversaId: string) =>
        planoDeTeste({
          turnoId,
          agenteId,
          conversaId,
          machineId: maquina,
          autoria: { ...autoriaAgente(agenteId, PESSOA_MARLON), machine_id: maquina },
          expiraEm: Date.now() + 60_000,
          catalogo: { ferramentas: [enviar, lembrar], servidores: [{ conectorId, nome: "exemplo", trust: "untrusted", transporte: "stdio" }] },
        });

      // Agente A: sem concessão → capacidade_desligada (terminal, conector); fora do catálogo (terminal, sem conector).
      const n1 = await chamarFerramenta(deps, { turnoId: turnoA?.id ?? "", agenteId: a.agenteId, nome: "exemplo__enviar", argumentos: {}, plano: planoDe(turnoA?.id ?? "", a.agenteId, a.conversaId) });
      expect(n1.data).toMatchObject({ ok: false, negacao: { motivo: "capacidade_desligada", terminal: true } });
      const n2 = await chamarFerramenta(deps, { turnoId: turnoA?.id ?? "", agenteId: a.agenteId, nome: "nao_existe", argumentos: {}, plano: planoDe(turnoA?.id ?? "", a.agenteId, a.conversaId) });
      expect(n2.data).toMatchObject({ ok: false, negacao: { motivo: "fora_do_catalogo" } });
      // Agente B: args inválidos em ferramenta nod (transitória, sem conector).
      const n3 = await chamarFerramenta(deps, { turnoId: turnoB?.id ?? "", agenteId: b.agenteId, nome: "lembrar", argumentos: { tipo: "x" }, plano: planoDe(turnoB?.id ?? "", b.agenteId, b.conversaId) });
      expect(n3.data).toMatchObject({ ok: false, negacao: { motivo: "args_invalidos", terminal: false } });
      for (const n of [n1, n2, n3]) await repos.events.gravarComOutbox(n.events ?? []);

      const tudo = await repos.trilha.filtrar({ dia: hoje() });
      const nossas = tudo.filter((l) => [a.agenteId, b.agenteId].includes(l.agenteId));
      expect(nossas.map((l) => [l.ferramenta, l.motivo, l.regra, l.regraVersao])).toEqual(
        expect.arrayContaining([
          ["exemplo__enviar", "capacidade_desligada", REGRA_PARADA_ALCADA, 1],
          ["nao_existe", "fora_do_catalogo", REGRA_PARADA_ALCADA, 1],
          ["lembrar", "args_invalidos", REGRA_PARADA_ALCADA, 1],
        ]),
      );
      expect(nossas.every((l) => l.kind === "negacao" && typeof l.em === "string")).toBe(true);

      expect((await repos.trilha.filtrar({ agenteId: b.agenteId })).map((l) => l.ferramenta)).toEqual(["lembrar"]);
      expect((await repos.trilha.filtrar({ agenteId: a.agenteId })).map((l) => l.ferramenta).sort()).toEqual(["exemplo__enviar", "nao_existe"]);
      expect((await repos.trilha.filtrar({ conectorId })).map((l) => [l.agenteId, l.ferramenta])).toEqual([[a.agenteId, "exemplo__enviar"]]);
      expect((await repos.trilha.filtrar({ dia: hoje(), agenteId: a.agenteId, conectorId })).map((l) => l.ferramenta)).toEqual(["exemplo__enviar"]);
      expect(await repos.trilha.filtrar({ dia: "2001-01-01", agenteId: a.agenteId })).toEqual([]);

      // A negação terminal pediu interrupção; a transitória não.
      expect((await repos.turnos.buscar(turnoA?.id ?? ""))?.pararSolicitadoEm).toBeNull(); // pendente: só 'despachando' recebe o pedido
      await repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
      const n4 = await chamarFerramenta(deps, { turnoId: turnoA?.id ?? "", agenteId: a.agenteId, nome: "exemplo__enviar", argumentos: {}, plano: planoDe(turnoA?.id ?? "", a.agenteId, a.conversaId) });
      expect(n4.data).toMatchObject({ ok: false });
      expect((await repos.turnos.buscar(turnoA?.id ?? ""))?.pararSolicitadoEm).not.toBeNull();
    });
  });
});
