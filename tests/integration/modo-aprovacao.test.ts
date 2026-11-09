import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { trechoAplicavel } from "../../src/db/migrar.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { NATIVAS_DO_TERMINAL } from "../../src/domain/nativas.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { autorizarComando } from "../../src/use-cases/autorizar-comando.ts";
import { mudarModoAprovacao } from "../../src/use-cases/mudar-modo-aprovacao.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-059 no Postgres: o modo mora em agentes.modo_aprovacao (0040), só a dona o muda, e cada comando do terminal
 * é decidido com o modo ATUAL do agente — automático roda o que muda algo e para no arriscado e na credencial; total
 * só para na credencial. revisto em 2026-10-01 (ADR-066): depois da web, o automático e o total seguem; só o manual
 * volta a pedir, até a leitura.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

function planoDe(p: { turnoId: string; agenteId: string; conversaId: string }): PlanoTurno {
  return {
    tenantId: TENANT_PADRAO, ...p, localidade: "local", machineId: "m", executor: "local", superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas", autoria: autoriaPessoa(PESSOA_MARLON), confiancaEntrada: "confiavel", profundidade: 0,
    catalogo: { ferramentas: [], servidores: [] }, promptSistema: "", entrada: { texto: "", sessaoCli: null, modelo: "m" },
    politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 8000 }, semprePermitir: [], tokenDeTurno: "tok",
    expiraEm: Date.now() + 60_000, nativas: [...NATIVAS_DO_TERMINAL],
  };
}

async function cenario(trx: Trx, modo: ModoAprovacao) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Dev 1" });
  const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
  if (modo !== "manual") await mudarModoAprovacao(deps, { agenteId, modo, confirmado: true });
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "sobe e abre o PR", entradaConfianca: "confiavel", modelo: "m" });
  if (!turno) throw new Error("turno");
  const plano = planoDe({ turnoId: turno.id, agenteId, conversaId });
  const autorizar = (comando: string) => autorizarComando(deps, { plano, comando });
  const motivoDoCard = async (comando: string) => {
    const r = await autorizar(comando);
    if (!("aguardar" in r.data)) throw new Error(`esperava card para ${comando}`);
    return (await repos.itensAprovacao.listar(r.data.aguardar))[0];
  };
  return { repos, deps, turno, agenteId, conversaId, autorizar, motivoDoCard };
}

describeIntegracao("modo de aprovação do bot (ADR-059)", () => {
  it("a coluna aceita só os três modos e a troca vira linha na conversa do bot (a fábrica parte do 'manual')", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "manual");
      expect((await c.repos.agentes.buscar(c.agenteId))?.modoAprovacao).toBe("manual");
      await mudarModoAprovacao(c.deps, { agenteId: c.agenteId, modo: "automatico" });
      expect((await c.repos.agentes.buscar(c.agenteId))?.modoAprovacao).toBe("automatico");
      expect((await c.repos.mensagens.ultimaDaConversa(c.conversaId))?.texto).toContain("para Aprovar automaticamente");
      await expect(trx`update agentes set modo_aprovacao = 'auto' where id = ${c.agenteId}`).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("NOD-316 (0095): o DEFAULT da coluna é 'automatico' — o INSERT sem a coluna (o seed) nasce assim — e a migração não toca nas linhas", async () => {
    await withRollback(MARLON, async (trx) => {
      const id = randomUUID();
      await trx`insert into agentes (tenant_id, id, owner_id, visibility, nome, dono, forma, cor, modelo) values (${TENANT_PADRAO}, ${id}, ${PESSOA_MARLON}, 'privado', 'Cru', 'pessoa', 'shape-hex', 'c-purple', 'm')`;
      expect((await criarRepos(trx, MARLON).agentes.buscar(id))?.modoAprovacao).toBe("automatico");
      // Um bot que já estava em manual continua em manual: a 0095 só muda o catálogo, sem UPDATE.
      const { agenteId } = await agenteComConversa(trx, MARLON, { modo: "manual" });
      expect((await criarRepos(trx, MARLON).agentes.buscar(agenteId))?.modoAprovacao).toBe("manual");
      const sql = trechoAplicavel(readFileSync(new URL("../../src/db/migrations/0095_bot_nasce_automatico.sql", import.meta.url), "utf8"));
      expect(sql).toMatch(/ALTER TABLE agentes ALTER COLUMN modo_aprovacao SET DEFAULT 'automatico'/);
      expect(sql).not.toMatch(/\bUPDATE\b/i);
    });
  });

  it("só a dona muda: o update de outra pessoa não acha a linha", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "manual");
      await trx`update agentes set visibility = 'equipe' where id = ${c.agenteId}`;
      await vincularEscopo(trx, ANA);
      expect(await criarRepos(trx, ANA).agentes.definirModoAprovacao(c.agenteId, "total")).toBeNull();
      await vincularEscopo(trx, MARLON);
      expect((await c.repos.agentes.buscar(c.agenteId))?.modoAprovacao).toBe("manual");
    });
  });

  it("automático: o que muda algo roda sem card; o arriscado e a credencial viram card com o motivo", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "automatico");
      expect((await c.autorizar("git commit -am 'fix: acento'")).data).toEqual({ permitir: true, porque: "modo_automatico" });
      expect((await c.autorizar("gh pr create --fill")).data).toEqual({ permitir: true, porque: "modo_automatico" });
      expect((await c.autorizar("git status")).data).toEqual({ permitir: true, porque: "leitura" });
      expect(await c.motivoDoCard("git push --force origin fix/x")).toMatchObject({ motivoManual: "acao_arriscada", justificativa: "reescreve ou apaga no remoto" });
      expect(await c.motivoDoCard("cat ~/.aws/credentials")).toMatchObject({ motivoManual: "toca_credencial" });
    });
  });

  it("ADR-066: depois da web o automático segue (leitura e escrita pelo modo) e só para no arriscado e na credencial; o total segue, até na credencial (PR 6); o manual pede até a leitura", async () => {
    await withRollback(MARLON, async (trx) => {
      const auto = await cenario(trx, "automatico");
      await auto.repos.turnos.contaminar(auto.turno.id, Date.now());
      expect((await auto.autorizar("git commit -am x")).data).toEqual({ permitir: true, porque: "modo_automatico" });
      // Depois da web a leitura deixa de ser livre por si: passa pelo modo, que a aprova.
      expect((await auto.autorizar("git status")).data).toEqual({ permitir: true, porque: "modo_automatico" });
      expect(await auto.motivoDoCard("git push --force origin fix/x")).toMatchObject({ motivoManual: "acao_arriscada" });
      expect(await auto.motivoDoCard("cat ~/.aws/credentials")).toMatchObject({ motivoManual: "toca_credencial" });
      const total = await cenario(trx, "total");
      await total.repos.turnos.contaminar(total.turno.id, Date.now());
      expect((await total.autorizar("git push --force origin fix/x")).data).toEqual({ permitir: true, porque: "modo_total" });
      expect((await total.autorizar("git status")).data).toEqual({ permitir: true, porque: "modo_total" });
      // PR 6 dos modos de aprovação: no total a credencial do Mac roda (só a chave do nod ainda para).
      expect((await total.autorizar("gh auth token")).data).toEqual({ permitir: true, porque: "modo_total" });
      expect(await total.motivoDoCard("cat ~/.config/nod-motor/conexao.json")).toMatchObject({ motivoManual: "toca_credencial" });
      const manual = await cenario(trx, "manual");
      await manual.repos.turnos.contaminar(manual.turno.id, Date.now());
      expect(await manual.motivoDoCard("git status")).toMatchObject({ motivoManual: "destino_terminal" });
    });
  });

  it("manual continua como a ADR-055: o que muda algo é card com destino_terminal", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "manual");
      expect(await c.motivoDoCard("git commit -am x")).toMatchObject({ motivoManual: "destino_terminal" });
    });
  });

  it("voltar para o manual vale no comando seguinte do mesmo turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "total");
      expect((await c.autorizar("npm install")).data).toEqual({ permitir: true, porque: "modo_total" });
      await mudarModoAprovacao(c.deps, { agenteId: c.agenteId, modo: "manual" });
      expect("aguardar" in (await c.autorizar("npm install left-pad")).data).toBe(true);
    });
  });

  it("excluir o bot volta o modo para manual", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "total");
      await c.repos.agentes.excluir(c.agenteId, Date.now());
      await c.repos.agentes.restaurar(c.agenteId);
      expect((await c.repos.agentes.buscar(c.agenteId))?.modoAprovacao).toBe("manual");
    });
  });
});
