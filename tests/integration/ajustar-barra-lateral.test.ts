import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { ajustarBarraLateral, PERGUNTA_DO_PEDIDO } from "../../src/use-cases/ajustar-barra-lateral.ts";
import { chamarFerramenta } from "../../src/use-cases/chamar-ferramenta.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-119 (C1): a pessoa pede "deixa a barra compacta" e o bot chama ajustar_barra_lateral. A ferramenta só grava a linha
 * `sistema` com payload `ajuste_barra` (assunto `barra.ajuste`, chat); quem muda a barra é a web, no clique da pessoa.
 * Um card por turno; só na conversa com a pessoa (conversa e criação).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-10-29T20:00:00Z");

async function montar(trx: Tx, o: { origem?: "rotina" | "conversa" | "sala" | "peer" | "delegacao"; confianca?: "confiavel" | "nao_confiavel"; confirmado?: boolean; sobProcuracaoDe?: string } = {}) {
  const gil = await agenteComConversa(trx, MARLON, { nome: "Gil" });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  await repos.agentes.atualizarPerfil(gil.agenteId, { confirmado: o.confirmado ?? true });
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId: gil.conversaId, agenteId: gil.agenteId, origem: o.origem ?? "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "deixa a barra compacta", entradaConfianca: o.confianca ?? "confiavel", modelo: "m", ...(o.sobProcuracaoDe ? { sobProcuracaoDe: o.sobProcuracaoDe } : {}) });
  return { gil, deps, repos, turno: turno! };
}

const cards = async (m: Awaited<ReturnType<typeof montar>>) => (await m.repos.mensagens.listarDaConversa(m.gil.conversaId)).filter((x) => x.payload?.kind === "ajuste_barra");

describeIntegracao("ajustar_barra_lateral (NOD-119): o card que propõe mudar a barra", () => {
  it("grava a linha sistema com a pergunta, o payload, o assunto barra.ajuste e o turno; a segunda chamada do turno é recusada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const ctx = contexto(m.gil.agenteId, m.gil.conversaId, m.turno.id);
      const r = await ajustarBarraLateral(m.deps, { ...ctx, pedido: "compacta" });
      expect(r.data).toMatchObject({ ok: true });
      expect(r.events?.map((e) => e.kind)).toEqual(["mensagem_criada"]);
      const lista = await cards(m);
      expect(lista).toHaveLength(1);
      expect(lista[0]?.confianca).toBe("confiavel");
      expect(lista[0]).toMatchObject({ kind: "sistema", texto: PERGUNTA_DO_PEDIDO.compacta, payload: { kind: "ajuste_barra", pedido: "compacta" }, turnoId: m.turno.id, autoria: { autor_tipo: "agente", autor_id: m.gil.agenteId } });
      const [linha] = await trx<{ assunto: string }[]>`select assunto from mensagens where id = ${lista[0]!.id}`;
      expect(linha?.assunto).toBe("barra.ajuste");

      expect((await ajustarBarraLateral(m.deps, { ...ctx, pedido: "normal" })).data).toMatchObject({ ok: false, erro: "ja_mostrou_neste_turno" });
      expect(await cards(m)).toHaveLength(1);
    });
  });

  it("os três pedidos têm a sua pergunta", async () => {
    await withRollback(MARLON, async (trx) => {
      for (const pedido of ["compacta", "so_avatares", "normal"] as const) {
        const m = await montar(trx);
        await ajustarBarraLateral(m.deps, { ...contexto(m.gil.agenteId, m.gil.conversaId, m.turno.id), pedido });
        expect((await cards(m))[0]?.texto).toBe(PERGUNTA_DO_PEDIDO[pedido]);
      }
    });
  });

  it("recusa sem gravar: pedido inválido, turno de outro bot, outra conversa, rotina, pedido de colega e conteúdo de fora", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const ctx = contexto(m.gil.agenteId, m.gil.conversaId, m.turno.id);
      expect((await ajustarBarraLateral(m.deps, { ...ctx, pedido: "gigante" as never })).data).toMatchObject({ ok: false, erro: "pedido_invalido" });
      const outro = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      expect((await ajustarBarraLateral(m.deps, { ...contexto(outro.agenteId, outro.conversaId, m.turno.id), pedido: "compacta" })).data).toMatchObject({ ok: false, erro: "fora_do_turno" });
      expect((await ajustarBarraLateral(m.deps, { ...contexto(m.gil.agenteId, outro.conversaId, m.turno.id), pedido: "compacta" })).data).toMatchObject({ ok: false, erro: "fora_do_turno" });
      // Outro bot na mesma conversa e no mesmo turno: só o agenteId difere (QA, mutante 16).
      expect((await ajustarBarraLateral(m.deps, { ...contexto(outro.agenteId, m.gil.conversaId, m.turno.id), pedido: "compacta" })).data).toMatchObject({ ok: false, erro: "fora_do_turno" });
      // Turno confiável, mas o plano diz que a entrada é de fora (QA, mutante 19).
      expect((await ajustarBarraLateral(m.deps, { ...ctx, pedido: "compacta", plano: { modoTurno: "conversa", confiancaEntrada: "nao_confiavel" } as never })).data).toMatchObject({ ok: false, erro: "entrada_nao_confiavel" });
      for (const origem of ["rotina", "delegacao", "peer"] as const) {
        const r = await montar(trx, { origem });
        expect((await ajustarBarraLateral(r.deps, { ...contexto(r.gil.agenteId, r.gil.conversaId, r.turno.id), pedido: "compacta" })).data, origem).toMatchObject({ ok: false, erro: "fora_do_turno" });
      }
      // ADR-026: entrada de fora ou turno que leu conteúdo de fora não põem a proposta no chat.
      const fora = await montar(trx, { confianca: "nao_confiavel" });
      expect((await ajustarBarraLateral(fora.deps, { ...contexto(fora.gil.agenteId, fora.gil.conversaId, fora.turno.id), pedido: "compacta" })).data).toMatchObject({ ok: false, erro: "entrada_nao_confiavel" });
      const leu = await montar(trx);
      await leu.repos.turnos.contaminar(leu.turno.id, AGORA);
      expect((await ajustarBarraLateral(leu.deps, { ...contexto(leu.gil.agenteId, leu.gil.conversaId, leu.turno.id), pedido: "compacta" })).data).toMatchObject({ ok: false, erro: "entrada_nao_confiavel" });
      // Frente, retomada ou lote de um pedido de colega (sob procuração): não é a pessoa pedindo.
      const colega = await montar(trx, { sobProcuracaoDe: PESSOA_MARLON });
      expect((await ajustarBarraLateral(colega.deps, { ...contexto(colega.gil.agenteId, colega.gil.conversaId, colega.turno.id), pedido: "compacta" })).data).toMatchObject({ ok: false, erro: "entrada_nao_confiavel" });
      const [conta] = await trx<{ n: number }[]>`select count(*)::int as n from mensagens where payload->>'kind' = 'ajuste_barra'`;
      expect(conta?.n).toBe(0);
    });
  });

  it("o plano da conversa e o da criação trazem a ferramenta e o despacho grava; o da rotina não traz", async () => {
    await withRollback(MARLON, async (trx) => {
      for (const o of [{ origem: "conversa", modo: "conversa" }, { origem: "conversa", confirmado: false, modo: "criacao" }] as const) {
        const m = await montar(trx, o);
        const plano = (await emitirPlanoTurno(m.deps, { turnoId: m.turno.id, machineId: randomUUID(), executor: "catcher" })).data;
        expect(plano.modoTurno).toBe(o.modo);
        expect(plano.catalogo.ferramentas.map((f) => f.nome)).toContain("ajustar_barra_lateral");
        const r = await chamarFerramenta({ ...m.deps, useCases: useCasesDeTeste() }, { turnoId: m.turno.id, agenteId: m.gil.agenteId, nome: "ajustar_barra_lateral", argumentos: { pedido: "so_avatares" }, plano });
        expect(JSON.parse((r.data as { conteudo: string }).conteudo), o.modo).toMatchObject({ ok: true });
        expect(await cards(m)).toHaveLength(1);
      }
      const rotina = await montar(trx, { origem: "rotina" });
      const plano = (await emitirPlanoTurno(rotina.deps, { turnoId: rotina.turno.id, machineId: randomUUID(), executor: "catcher" })).data;
      expect(plano.catalogo.ferramentas.map((f) => f.nome)).not.toContain("ajustar_barra_lateral");
    });
  });
});
