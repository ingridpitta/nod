import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ENTRADA_DA_VOLTA_DA_COTA } from "../../src/domain/cota-da-ia.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { definirInteligenciaDoBot, lerIasDaPessoa } from "../../src/use-cases/inteligencia.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * 0068 (emenda da ADR-036, 2026-10-10) no Postgres: o modo, a ordem e as escolhas por IA do bot gravados com os campos
 * derivados (harness/modelo/esforco, que o turno copia); a ordem e os limites da pessoa em `preferencias`; e a
 * tradução dos bots de antes (sonnet → Automático; modelo escolhido à mão → Uma IA só).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function bot(trx: Trx, legado: { harness?: "auto" | "claude-cli" | "codex-cli"; modelo?: string } = {}) {
  const repos = criarRepos(trx, MARLON);
  const a = await repos.agentes.criar({ id: randomUUID(), nome: `Bot ${randomUUID().slice(0, 6)}`, dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: legado.modelo ?? "auto", harness: legado.harness ?? "auto" });
  if (!a) throw new Error("agente");
  const conversaId = randomUUID();
  await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId: a.id });
  return { repos, agente: a, conversaId, deps: depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx }) };
}

const colunas = async (trx: Trx, id: string) =>
  (await trx<{ harness: string; modelo: string; esforco: string | null; inteligencia_modo: string; ordem_ias: unknown; escolhas_ia: unknown }[]>`
    select harness, modelo, esforco, inteligencia_modo, ordem_ias, escolhas_ia from agentes where id = ${id}`)[0];

describeIntegracao("inteligência do bot (0068)", () => {
  it("o bot novo nasce no Automático, sem ordem própria e sem escolhas", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agente } = await bot(trx);
      expect(agente.inteligencia).toEqual({ modo: "auto", fixa: null, ordem: null, escolhas: {} });
      expect(await colunas(trx, agente.id)).toEqual({ harness: "auto", modelo: "auto", esforco: null, inteligencia_modo: "auto", ordem_ias: null, escolhas_ia: {} });
    });
  });

  it("PUT inteligencia grava o modo, a ordem e as escolhas com os derivados; o PATCH antigo continua valendo", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agente, deps } = await bot(trx);
      const r = await definirInteligenciaDoBot(deps, { agenteId: agente.id, pedido: { modo: "fixa", fixa: "codex-cli", ordem: ["codex-cli", "claude-cli"], escolhas: { "codex-cli": { modelo: "gpt-5.6-luna", raciocinio: "high" }, "claude-cli": { raciocinio: "low" } } } });
      expect(r.data.agente).toMatchObject({ harness: "codex-cli", modelo: "gpt-5.6-luna", esforco: "low", inteligencia: { modo: "fixa", fixa: "codex-cli", ordem: ["codex-cli", "claude-cli"] } });
      expect(await colunas(trx, agente.id)).toEqual({ harness: "codex-cli", modelo: "gpt-5.6-luna", esforco: "low", inteligencia_modo: "fixa", ordem_ias: ["codex-cli", "claude-cli"], escolhas_ia: { "codex-cli": { modelo: "gpt-5.6-luna", raciocinio: "high" }, "claude-cli": { raciocinio: "low" } } });
      expect(r.events?.map((e) => e.dados)).toEqual([expect.objectContaining({ acao: "inteligencia", modo: "fixa", fixa: "codex-cli" })]);

      // A tela de Inteligência de antes manda {harness, modelo}: vira Automático, a ordem e as escolhas ficam.
      await editarPerfil(deps, { agenteId: agente.id, harness: "auto", modelo: "auto" });
      expect(await colunas(trx, agente.id)).toMatchObject({ harness: "auto", modelo: "auto", inteligencia_modo: "auto", ordem_ias: ["codex-cli", "claude-cli"] });
      await editarPerfil(deps, { agenteId: agente.id, esforco: "max" });
      expect(await colunas(trx, agente.id)).toMatchObject({ esforco: "max", escolhas_ia: { "claude-cli": { raciocinio: "max" } } });

      await expect(definirInteligenciaDoBot(deps, { agenteId: agente.id, pedido: { escolhas: { "claude-cli": { modelo: "haiku", raciocinio: "max" } } } })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    });
  });

  it("só a dona muda a inteligência do bot", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agente } = await bot(trx);
      await trx`update agentes set visibility = 'equipe' where id = ${agente.id}`;
      const deAna = depsSobre(criarRepos(trx, ANA), ANA, { services: servicosDeTeste({}), trx });
      await expect(definirInteligenciaDoBot(deAna, { agenteId: agente.id, pedido: { modo: "fixa" } })).rejects.toMatchObject({ codigo: "nao_permitido" });
    });
  });

  it("a ordem da pessoa e os limites moram em preferencias; GET /ias mostra o limite em vigor", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      expect(await repos.preferencias.buscar()).toMatchObject({ ordemIas: null, iasNoLimite: {} });
      await repos.preferencias.gravar({ ordemIas: ["codex-cli", "claude-cli"] });
      await repos.preferencias.gravar({ modoDev: true });
      expect((await repos.preferencias.buscar()).ordemIas).toEqual(["codex-cli", "claude-cli"]);
      const agora = Date.now();
      await repos.preferencias.registrarLimite("claude-cli", { renovaEm: agora + 60_000, desde: agora });
      await repos.preferencias.registrarLimite("codex-cli", { renovaEm: agora - 1, desde: agora - 3_600_000 });
      expect((await repos.preferencias.buscar()).iasNoLimite).toEqual({ "claude-cli": { renovaEm: agora + 60_000, desde: agora }, "codex-cli": { renovaEm: agora - 1, desde: agora - 3_600_000 } });

      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
      const pronto = { estado: "pronto" as const, versao: "1", em: agora };
      const ias = (await lerIasDaPessoa(deps, { inventarios: { "claude-cli": pronto, "codex-cli": pronto } })).data;
      expect(ias.ordem).toEqual(["codex-cli", "claude-cli"]);
      expect(ias.ias.find((i) => i.id === "claude-cli")).toMatchObject({ limite: { renovaEm: agora + 60_000 }, inventario: { estado: "nao_autenticado", causa: "limite" } });
      expect(ias.ias.find((i) => i.id === "codex-cli")).toMatchObject({ limite: null, inventario: pronto });

      expect(await repos.preferencias.limparLimite("claude-cli")).toBe(true);
      expect(await repos.preferencias.limparLimite("claude-cli")).toBe(false);
      expect(Object.keys((await repos.preferencias.buscar()).iasNoLimite ?? {})).toEqual(["codex-cli"]);
      await repos.preferencias.gravar({ ordemIas: null });
      expect((await repos.preferencias.buscar()).ordemIas).toBeNull();
      await expect(trx`update preferencias set ordem_ias = '{"a":1}'::jsonb where owner_id = ${PESSOA_MARLON}`).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("a migração dos bots de antes: sonnet vai para o Automático; o modelo escolhido à mão fica em Uma IA só, e o esforço vira raciocínio", async () => {
    // Os comandos de dados da 0068, rodados sobre uma cópia temporária (sem RLS e sem travar a tabela de verdade).
    const sql = readFileSync(new URL("../../src/db/migrations/0068_inteligencia_do_bot.sql", import.meta.url), "utf8");
    const dados = sql.slice(sql.indexOf("-- Os bots de antes"), sql.indexOf("ALTER TABLE agentes FORCE ROW LEVEL SECURITY")).replaceAll("UPDATE agentes ", "UPDATE pg_temp.agentes_0068 ");
    await withRollback(MARLON, async (trx) => {
      await trx`create temp table agentes_0068 (nome text, harness text, modelo text, esforco text, inteligencia_modo text not null default 'auto', escolhas_ia jsonb not null default '{}') on commit drop`;
      const linhas: [string, string, string, string | null][] = [
        ["auto/auto", "auto", "auto", null],
        ["auto/sonnet", "auto", "sonnet", "high"],
        ["claude/sonnet", "claude-cli", "sonnet", null],
        ["auto/opus", "auto", "opus", null],
        ["claude/haiku", "claude-cli", "haiku", "low"],
        ["claude/auto", "claude-cli", "auto", null],
        ["codex/auto", "codex-cli", "auto", null],
        ["codex/luna", "codex-cli", "gpt-5.6-luna", "max"],
      ];
      for (const [nome, harness, modelo, esforco] of linhas) await trx`insert into agentes_0068 (nome, harness, modelo, esforco) values (${nome}, ${harness}, ${modelo}, ${esforco})`;
      await trx.unsafe(dados);
      const r = Object.fromEntries((await trx<{ nome: string; harness: string; modelo: string; inteligencia_modo: string; escolhas_ia: unknown }[]>`select nome, harness, modelo, inteligencia_modo, escolhas_ia from agentes_0068`).map((l) => [l.nome, { h: l.harness, m: l.modelo, modo: l.inteligencia_modo, e: l.escolhas_ia }]));
      expect(r).toEqual({
        "auto/auto": { h: "auto", m: "auto", modo: "auto", e: {} },
        "auto/sonnet": { h: "auto", m: "auto", modo: "auto", e: { "claude-cli": { raciocinio: "high" } } },
        "claude/sonnet": { h: "auto", m: "auto", modo: "auto", e: {} },
        "auto/opus": { h: "claude-cli", m: "opus", modo: "fixa", e: { "claude-cli": { modelo: "opus" } } },
        "claude/haiku": { h: "claude-cli", m: "haiku", modo: "fixa", e: { "claude-cli": { modelo: "haiku", raciocinio: "low" } } },
        "claude/auto": { h: "claude-cli", m: "auto", modo: "fixa", e: {} },
        "codex/auto": { h: "codex-cli", m: "auto", modo: "fixa", e: {} },
        "codex/luna": { h: "codex-cli", m: "gpt-5.6-luna", modo: "fixa", e: { "claude-cli": { raciocinio: "max" }, "codex-cli": { modelo: "gpt-5.6-luna", raciocinio: "max" } } },
      });
    });
  });
  describe("NOD-277: a troca de IA reescreve o fundo que está na fila", () => {
    type Origem = "conversa" | "rotina" | "delegacao" | "peer" | "retomada" | "sala" | "ligacao";
    const turno = async (b: Awaited<ReturnType<typeof bot>>, o: { origem: Origem; retomaTurnoId?: string; acordarEm?: number; entrada?: string }) => {
      const t = await b.repos.turnos.enfileirar({ executor: "catcher", conversaId: b.conversaId, agenteId: b.agente.id, origem: o.origem, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: o.entrada ?? "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", retomaTurnoId: o.retomaTurnoId ?? null, ...(o.acordarEm ? { acordarEm: o.acordarEm } : {}) });
      if (!t) throw new Error("turno");
      return t;
    };
    const ia = async (trx: Trx, id: string) => (await trx<{ harness: string; modelo: string; acordar_em: Date | null; estado: string }[]>`select harness, modelo, acordar_em, estado from turnos where id = ${id}`)[0];
    const paraCodex = { modo: "fixa", fixa: "codex-cli", escolhas: { "codex-cli": { modelo: "gpt-5.6-luna" } } };

    it("rotina, pedido de colega e a retomada deles vão para a IA nova; a conversa e a retomada dela ficam", async () => {
      await withRollback(MARLON, async (trx) => {
        const b = await bot(trx, { harness: "claude-cli", modelo: "sonnet" });
        const rotina = await turno(b, { origem: "rotina" });
        const colega = await turno(b, { origem: "delegacao" });
        const retomadaDaRotina = await turno(b, { origem: "retomada", retomaTurnoId: rotina.id });
        const conversa = await turno(b, { origem: "conversa" });
        const retomadaDaConversa = await turno(b, { origem: "retomada", retomaTurnoId: conversa.id });

        await definirInteligenciaDoBot(b.deps, { agenteId: b.agente.id, pedido: paraCodex });
        for (const t of [rotina, colega, retomadaDaRotina]) expect(await ia(trx, t.id)).toMatchObject({ harness: "codex-cli", modelo: "gpt-5.6-luna", estado: "pendente" });
        for (const t of [conversa, retomadaDaConversa]) expect(await ia(trx, t.id)).toMatchObject({ harness: "claude-cli", modelo: "sonnet" });
      });
    });

    it("o turno já despachando não muda; só o raciocínio mudou, a fila fica como está", async () => {
      await withRollback(MARLON, async (trx) => {
        const b = await bot(trx, { harness: "claude-cli", modelo: "sonnet" });
        await definirInteligenciaDoBot(b.deps, { agenteId: b.agente.id, pedido: { modo: "fixa", fixa: "claude-cli", escolhas: { "claude-cli": { modelo: "sonnet" } } } });
        const rodando = await turno(b, { origem: "rotina" });
        await trx`update turnos set estado = 'despachando' where id = ${rodando.id}`;
        const pendente = await turno(b, { origem: "rotina" });
        await definirInteligenciaDoBot(b.deps, { agenteId: b.agente.id, pedido: { escolhas: { "claude-cli": { modelo: "sonnet", raciocinio: "low" } } } });
        expect(await ia(trx, pendente.id)).toMatchObject({ harness: "claude-cli", modelo: "sonnet" });
        await definirInteligenciaDoBot(b.deps, { agenteId: b.agente.id, pedido: paraCodex });
        expect(await ia(trx, rodando.id)).toMatchObject({ harness: "claude-cli", modelo: "sonnet", estado: "despachando" });
        expect(await ia(trx, pendente.id)).toMatchObject({ harness: "codex-cli" });
      });
    });

    it("a espera da cota do fundo acorda na troca; a volta marcada pelo bot segue esperando", async () => {
      await withRollback(MARLON, async (trx) => {
        const b = await bot(trx, { harness: "claude-cli", modelo: "sonnet" });
        await definirInteligenciaDoBot(b.deps, { agenteId: b.agente.id, pedido: { modo: "fixa", fixa: "claude-cli" } });
        const rotina = await turno(b, { origem: "rotina" });
        const daCota = await turno(b, { origem: "retomada", retomaTurnoId: rotina.id, acordarEm: Date.now() + 3 * 86_400_000, entrada: `${ENTRADA_DA_VOLTA_DA_COTA}Claude Code chegou ao limite.` });
        const marcada = await turno(b, { origem: "retomada", retomaTurnoId: rotina.id, acordarEm: Date.now() + 3_600_000, entrada: "volte às 15h" });
        await definirInteligenciaDoBot(b.deps, { agenteId: b.agente.id, pedido: { modo: "auto" } });
        expect(await ia(trx, daCota.id)).toMatchObject({ harness: "auto", modelo: "auto", acordar_em: null });
        expect((await ia(trx, marcada.id))?.acordar_em).not.toBeNull();
      });
    });
  });
});
