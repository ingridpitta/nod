import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { avisarPessoa } from "../../src/use-cases/avisar-pessoa.ts";
import { chamarFerramenta } from "../../src/use-cases/chamar-ferramenta.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-114: o bot avisa a pessoa por conta própria. Uma rotina do Tuca vê algo novo e chama avisar_pessoa: a fala vira
 * `texto` com payload `aviso_pessoa` (assunto `aviso.pessoa`, chat) no turno da rotina. Um aviso por turno; turno que
 * nasceu de conteúdo de fora não avisa; o que leu um app no meio do turno avisa, marcado.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-10-28T15:00:00Z");

async function montar(trx: Tx, o: { origem?: "rotina" | "conversa" | "sala" | "peer" | "delegacao"; confianca?: "confiavel" | "nao_confiavel"; confirmado?: boolean } = {}) {
  const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  await repos.agentes.atualizarPerfil(tuca.agenteId, { confirmado: o.confirmado ?? true });
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId: tuca.conversaId, agenteId: tuca.agenteId, origem: o.origem ?? "rotina", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "veja o Linear", entradaConfianca: o.confianca ?? "confiavel", modelo: "m" });
  return { tuca, deps, repos, turno: turno! };
}

describeIntegracao("avisar_pessoa (NOD-114): o bot avisa a pessoa por conta própria", () => {
  it("grava uma fala texto com payload aviso_pessoa, assunto aviso.pessoa e o turno; a segunda chamada do turno é recusada sem gravar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await avisarPessoa(m.deps, { ...contexto(m.tuca.agenteId, m.tuca.conversaId, m.turno.id), texto: "  A NOD-12 foi aprovada; falta o deploy.  " });
      expect(r.data).toMatchObject({ ok: true });
      expect(r.events?.map((e) => e.kind)).toEqual(["mensagem_criada"]);
      const avisos = (await m.repos.mensagens.listarDaConversa(m.tuca.conversaId)).filter((x) => x.payload?.kind === "aviso_pessoa");
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({ kind: "texto", texto: "A NOD-12 foi aprovada; falta o deploy.", turnoId: m.turno.id, confianca: "confiavel", autoria: { autor_tipo: "agente", autor_id: m.tuca.agenteId } });
      const [linha] = await trx<{ assunto: string }[]>`select assunto from mensagens where id = ${avisos[0]!.id}`;
      expect(linha?.assunto).toBe("aviso.pessoa");
      expect(await trx`select 1 from events where kind = 'quadro_avisou'`).toEqual([]);

      const outra = await avisarPessoa(m.deps, { ...contexto(m.tuca.agenteId, m.tuca.conversaId, m.turno.id), texto: "de novo" });
      expect(outra.data).toMatchObject({ ok: false, erro: "ja_avisou_neste_turno" });
      expect((await m.repos.mensagens.listarDaConversa(m.tuca.conversaId)).filter((x) => x.payload?.kind === "aviso_pessoa")).toHaveLength(1);
    });
  });

  it("duas chamadas disparadas juntas no mesmo turno gravam um aviso só (na mesma conexão; entre transações quem segura é o índice único de id_envio)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const ctx = contexto(m.tuca.agenteId, m.tuca.conversaId, m.turno.id);
      const rs = await Promise.all([avisarPessoa(m.deps, { ...ctx, texto: "um" }), avisarPessoa(m.deps, { ...ctx, texto: "dois" })]);
      expect(rs.filter((r) => r.data.ok)).toHaveLength(1);
      expect((await m.repos.mensagens.listarDaConversa(m.tuca.conversaId)).filter((x) => x.payload?.kind === "aviso_pessoa")).toHaveLength(1);
    });
  });

  it("recusa sem gravar: entrada não confiável, texto em branco, turno de outro bot e turno de sala", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, { confianca: "nao_confiavel" });
      const ctx = contexto(m.tuca.agenteId, m.tuca.conversaId, m.turno.id);
      expect((await avisarPessoa(m.deps, { ...ctx, texto: "olha isso" })).data).toMatchObject({ ok: false, erro: "entrada_nao_confiavel" });

      const confiavel = await montar(trx);
      const ctx2 = contexto(confiavel.tuca.agenteId, confiavel.tuca.conversaId, confiavel.turno.id);
      expect((await avisarPessoa(confiavel.deps, { ...ctx2, texto: "   " })).data).toMatchObject({ ok: false, erro: "texto_vazio" });
      const outro = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      expect((await avisarPessoa(confiavel.deps, { ...contexto(outro.agenteId, outro.conversaId, confiavel.turno.id), texto: "x" })).data).toMatchObject({ ok: false, erro: "fora_do_turno" });
      expect((await avisarPessoa(confiavel.deps, { ...contexto(confiavel.tuca.agenteId, outro.conversaId, confiavel.turno.id), texto: "x" })).data).toMatchObject({ ok: false, erro: "fora_do_turno" });
      const peer = await montar(trx, { origem: "peer" });
      expect((await avisarPessoa(peer.deps, { ...contexto(peer.tuca.agenteId, peer.tuca.conversaId, peer.turno.id), texto: "x" })).data).toMatchObject({ ok: false, erro: "fora_do_turno" });

      const [conta] = await trx<{ n: number }[]>`select count(*)::int as n from mensagens where payload->>'kind' = 'aviso_pessoa'`;
      expect(conta?.n).toBe(0);
    });
  });

  it("ADR-026: o turno que leu um app no meio sai com o aviso marcado nao_confiavel", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.turnos.contaminar(m.turno.id, AGORA);
      expect((await avisarPessoa(m.deps, { ...contexto(m.tuca.agenteId, m.tuca.conversaId, m.turno.id), texto: "chegou e-mail do cliente" })).data).toMatchObject({ ok: true });
      const [aviso] = (await m.repos.mensagens.listarDaConversa(m.tuca.conversaId)).filter((x) => x.payload?.kind === "aviso_pessoa");
      expect(aviso?.confianca).toBe("nao_confiavel");
    });
  });

  it("revisão 2 (ADR-026/062): o pedido de colega que herdou a marca de quem pediu não avisa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, { origem: "delegacao" });
      await m.repos.turnos.contaminar(m.turno.id, AGORA);
      expect((await avisarPessoa(m.deps, { ...contexto(m.tuca.agenteId, m.tuca.conversaId, m.turno.id), texto: "clique em evil.example" })).data).toMatchObject({ ok: false, erro: "entrada_nao_confiavel" });
      expect((await m.repos.mensagens.listarDaConversa(m.tuca.conversaId)).filter((x) => x.payload?.kind === "aviso_pessoa")).toEqual([]);
    });
  });

  it("o plano da rotina traz avisar_pessoa e o despacho grava pelo caminho de sempre", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const plano = (await emitirPlanoTurno(m.deps, { turnoId: m.turno.id, machineId: randomUUID(), executor: "catcher" })).data;
      expect(plano.catalogo.ferramentas.map((f) => f.nome)).toContain("avisar_pessoa");
      const r = await chamarFerramenta({ ...m.deps, useCases: useCasesDeTeste() }, { turnoId: m.turno.id, agenteId: m.tuca.agenteId, nome: "avisar_pessoa", argumentos: { texto: "Saiu o relatório." }, plano });
      // O despacho embrulha a saída do caso de uso em `conteudo`: o ok de fora é só o da chamada.
      expect(JSON.parse((r.data as { conteudo: string }).conteudo)).toMatchObject({ ok: true });
    });
  });

  it("revisão: conversa, criação (bot ainda não confirmado) e pedido de colega também avisam pelo plano", async () => {
    await withRollback(MARLON, async (trx) => {
      for (const o of [{ origem: "conversa", modo: "conversa" }, { origem: "conversa", confirmado: false, modo: "criacao" }, { origem: "delegacao", modo: "delegacao" }] as const) {
        const m = await montar(trx, o);
        const plano = (await emitirPlanoTurno(m.deps, { turnoId: m.turno.id, machineId: randomUUID(), executor: "catcher" })).data;
        expect(plano.modoTurno).toBe(o.modo);
        expect(plano.catalogo.ferramentas.map((f) => f.nome)).toContain("avisar_pessoa");
        const r = await chamarFerramenta({ ...m.deps, useCases: useCasesDeTeste() }, { turnoId: m.turno.id, agenteId: m.tuca.agenteId, nome: "avisar_pessoa", argumentos: { texto: "Saiu." }, plano });
        expect(JSON.parse((r.data as { conteudo: string }).conteudo), o.modo).toMatchObject({ ok: true });
      }
    });
  });
});
