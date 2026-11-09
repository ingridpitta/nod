import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { JANELA_MESCLA_INCIDENTE_MS } from "../../src/domain/incidente.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { dispensarIncidente } from "../../src/use-cases/dispensar-incidente.ts";
import { interromperPorMaquina } from "../../src/use-cases/interromper-por-maquina.ts";
import { listarSuaVez, type DepsSuaVez } from "../../src/use-cases/listar-sua-vez.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import type { Tx } from "../../src/shared/types.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const H = 3_600_000;
const T0 = Date.parse("2026-09-24T00:50:00-03:00");

/** Um turno de conversa rodando numa máquina, com o lease até `ate` (a queda é notada depois). */
async function turnoRodando(trx: Tx, agenteId: string, conversaId: string, maquina: string, desde: number): Promise<Turno> {
  const repos = criarRepos(trx, MARLON);
  const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: desde + 86_400_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
  const r = await repos.turnos.reivindicar({ machineId: maquina, agora: desde });
  if (!t || r?.id !== t.id) throw new Error("turno não reivindicado");
  return r;
}

describeIntegracao("incidentes (ADR-045): um aviso por queda do Mac, nunca um card por turno", () => {
  it("quedas de uma madrugada mesclam num aviso; mais de 3 h depois abre outro; fechado E dispensado não recebe queda nova", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Taga" });
      const maquina = randomUUID();
      const cair = async (desde: number, notadoEm: number) => {
        const t = await turnoRodando(trx, agenteId, conversaId, maquina, desde);
        return interromperPorMaquina({ repos, escopo: MARLON, agora: () => notadoEm }, { turnos: [t] });
      };

      const a = await cair(T0, T0 + 20 * 60_000);
      const b = await cair(T0 + 2 * H, T0 + 2 * H + 20 * 60_000); // dark wake seguinte, dentro de 3 h
      expect(b.data.incidenteId).toBe(a.data.incidenteId);
      const [mesclado] = await repos.incidentes.visiveis(0);
      expect(mesclado).toMatchObject({ comecouEm: T0, voltouEm: T0 + 2 * H + 20 * 60_000, conversas: 2 });

      const longe = T0 + 2 * H + 20 * 60_000 + JANELA_MESCLA_INCIDENTE_MS + 60_000;
      // A queda é notada depois do lease (como o varredor: só lê vencidos). NOD-241: o lease vivo não é interrompido.
      const c = await cair(longe, longe + LEASE_MS + 60_000);
      expect(c.data.incidenteId).not.toBe(a.data.incidenteId);
      expect((await repos.incidentes.visiveis(0)).map((i) => i.id)).toEqual([a.data.incidenteId, c.data.incidenteId]);

      // "Entendi" no aviso fechado: a queda seguinte, mesmo dentro de 3 h, abre aviso novo (visível).
      await dispensarIncidente({ repos, agora: () => longe + 3 * 60_000 }, { incidenteId: c.data.incidenteId ?? "" });
      const d = await cair(longe + 10 * 60_000, longe + 10 * 60_000 + LEASE_MS + 60_000);
      expect(d.data.incidenteId).not.toBe(c.data.incidenteId);
      expect((await repos.incidentes.visiveis(0)).map((i) => i.id)).toEqual([a.data.incidenteId, d.data.incidenteId]);
    });
  });

  it("um em curso por pessoa e tipo: o índice parcial recusa o segundo; aviso de outra pessoa não aparece (RLS)", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      await repos.incidentes.abrir({ tipo: "mac_sem_contato", machineId: null, comecouEm: T0, voltouEm: null, rotinas: 1, conversas: 0, agentes: [] });
      await expectRejected(trx, () => repos.incidentes.abrir({ tipo: "mac_sem_contato", machineId: null, comecouEm: T0 + 1, voltouEm: null, rotinas: 1, conversas: 0, agentes: [] }), "23505");
      // Fechado (voltou) não conta como em curso.
      await repos.incidentes.abrir({ tipo: "mac_sem_contato", machineId: null, comecouEm: T0, voltouEm: T0 + H, rotinas: 0, conversas: 1, agentes: [] });
      await expectRejected(trx, () => repos.incidentes.abrir({ tipo: "mac_sem_contato", machineId: null, comecouEm: T0 + H, voltouEm: T0, rotinas: 0, conversas: 1, agentes: [] }), "23514");

      await vincularEscopo(trx, ANA);
      expect(await criarRepos(trx, ANA).incidentes.visiveis(0)).toEqual([]);
      await vincularEscopo(trx, MARLON);
      expect(await repos.incidentes.visiveis(0)).toHaveLength(2);
    });
  });

  it("'Sua vez' leva o aviso com os nomes dos agentes; dispensar tira da tela; id desconhecido → nao_encontrado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Taga" });
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const maquina = randomUUID();
      const t1 = await turnoRodando(trx, agenteId, conversaId, maquina, T0);
      const t2 = await turnoRodando(trx, ada.agenteId, ada.conversaId, maquina, T0 + 60_000);
      const agora = T0 + 2 * H;
      const r = await interromperPorMaquina({ repos, escopo: MARLON, agora: () => agora }, { turnos: [t1, t2] });
      const deps: DepsSuaVez = { repos, escopo: MARLON, agora: () => agora, tx: (fn) => fn(trx) };
      const { data } = await listarSuaVez(deps, { marcarVista: false });
      expect(data.incidentes).toEqual([{ id: r.data.incidenteId, tipo: "mac_sem_contato", comecouEm: T0, voltouEm: agora, rotinas: 0, conversas: 2, agentes: ["Ada", "Taga"] }]);

      await dispensarIncidente({ repos, agora: () => agora + 1 }, { incidenteId: r.data.incidenteId ?? "" });
      expect((await listarSuaVez(deps, { marcarVista: false })).data.incidentes).toEqual([]);
      await expect(dispensarIncidente({ repos, agora: () => agora }, { incidenteId: randomUUID() })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  it("2026-10-09: a queda da VM (motor Linux, 0067) nomeia a máquina na conversa e no aviso; o Mac, a chave sem sistema e o Mac sem chave ficam com \"seu Mac\"", async () => {
    const chave = async (repos: ReturnType<typeof criarRepos>, nome: string, plataforma: "darwin" | "linux" | null) => {
      const c = await repos.maquinaTokens.criar({ nome, prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) });
      if (!c) throw new Error("chave");
      if (plataforma) await repos.maquinaTokens.registrarPlataforma(c.id, plataforma);
      return c.id;
    };
    const aviso = async (repos: ReturnType<typeof criarRepos>, conversaId: string) => (await repos.mensagens.listarDaConversa(conversaId, 50)).find((m) => m.kind === "sistema")?.texto;

    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ze 1" });
      const vm = await chave(repos, "nod-motor-teste", "linux");
      await repos.maquinaTokens.registrarPlataforma(vm, "linux");
      expect(await repos.maquinaTokens.identificar(vm)).toEqual({ nome: "nod-motor-teste", plataforma: "linux", papel: "motor", ultimoUsoEm: null });
      const agora = T0 + 2 * H;
      await interromperPorMaquina({ repos, escopo: MARLON, agora: () => agora }, { turnos: [await turnoRodando(trx, agenteId, conversaId, vm, T0)] });
      expect(await aviso(repos, conversaId)).toBe("Turno interrompido: a máquina nod-motor-teste parou de responder (desligada, sem rede ou motor parado). O que já saiu fica marcado como parcial; nada foi reenviado.");
      const { data } = await listarSuaVez({ repos, escopo: MARLON, agora: () => agora, tx: (fn) => fn(trx) }, { marcarVista: false });
      expect(data.incidentes).toMatchObject([{ maquina: "nod-motor-teste", conversas: 1, agentes: ["Ze 1"] }]);
    });

    for (const plataforma of ["darwin", null, "sem chave"] as const) {
      await withRollback(MARLON, async (trx) => {
        const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Taga" });
        const maquina = plataforma === "sem chave" ? randomUUID() : await chave(repos, "MacBook de Marlon", plataforma);
        const agora = T0 + 2 * H;
        await interromperPorMaquina({ repos, escopo: MARLON, agora: () => agora }, { turnos: [await turnoRodando(trx, agenteId, conversaId, maquina, T0)] });
        expect(await aviso(repos, conversaId), String(plataforma)).toContain("Turno interrompido: seu Mac parou de responder (repouso, sem rede ou nod fechado).");
        const { data } = await listarSuaVez({ repos, escopo: MARLON, agora: () => agora, tx: (fn) => fn(trx) }, { marcarVista: false });
        expect(data.incidentes[0], String(plataforma)).not.toHaveProperty("maquina");
      });
    }
  });

  it("0021: as retomar_turno ABERTAS de turnos de rotina (e das retomadas deles) fecham por regra:rotina_nao_retoma; a da conversa fica", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const novo = (origem: "rotina" | "conversa" | "retomada", retomaTurnoId?: string) => repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem, retomaTurnoId, prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      const rotina = await novo("rotina");
      const retomada = await novo("retomada", rotina?.id);
      const conversa = await novo("conversa");
      const retomar = async (turnoId: string) => (await repos.decisoes.criar({ tipo: "retomar_turno", agenteId, conversaId, turnoId, prazoDecisaoEm: T0 + 86_400_000, frase: "retomar?" }))?.id ?? "";
      const [dRotina, dRetomada, dConversa] = [await retomar(rotina?.id ?? ""), await retomar(retomada?.id ?? ""), await retomar(conversa?.id ?? "")];

      // A limpeza da migração, executada como está no arquivo (o nod_app da dona enxerga as próprias linhas).
      const sql = readFileSync(new URL("../../src/db/migrations/0021_incidentes.sql", import.meta.url), "utf8");
      const limpeza = sql.slice(sql.indexOf("WITH RECURSIVE subida"), sql.indexOf(";", sql.indexOf("WITH RECURSIVE subida")) + 1);
      expect(limpeza).toContain("regra:rotina_nao_retoma");
      await trx.unsafe(limpeza);

      for (const id of [dRotina, dRetomada]) {
        const d = await repos.decisoes.buscar(id);
        expect(d).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: "regra:rotina_nao_retoma", regraVersao: 1 } });
        expect(d?.desfecho?.tipo === "decidida_por_regra" && d.desfecho.em).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }
      expect(await repos.decisoes.buscar(dConversa)).toMatchObject({ estado: "pendente" });
    });
  });
});
