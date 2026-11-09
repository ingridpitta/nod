import { expect, it } from "vitest";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import type { OrigemTurno } from "../../src/contracts/turno.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { criarBots } from "../../src/use-cases/criar-bots.ts";
import { gerirAgente } from "../../src/use-cases/gerir-agente.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { autoriaAgente } from "../../src/use-cases/autoria-evento.ts";
import { ANA, depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-210 / ADR-104, com banco real: o bot que a pessoa pediu cria bots NOVOS na hora — sem card e sem decisão em
 * nenhum modo —, quem pede não muda, e as cercas (só na conversa com a pessoa, pedido inteiro válido, nada pela metade).
 */

const LPS = [
  { nome: "Copy de LP", titulo: "Textos da página", descricao: "Você escreve a copy das landing pages." },
  { nome: "Layout de LP", titulo: "Visual", descricao: "Você monta o layout com a copy aprovada.", secao: "Time de LPs" },
  { nome: "QA de LP", descricao: "Você revisa a página antes de publicar." },
];

async function botComTurno(d: Deps, opcoes: { modo?: ModoAprovacao; origem?: OrigemTurno; secao?: string; confianca?: "confiavel" | "nao_confiavel"; mensagemOrigemId?: string } = {}) {
  const { agente, conversa } = (await executar(d, criarAgente, { dono: "pessoa", nome: "Nina", titulo: "Orquestradora de LPs", descricao: "Você orquestra as LPs." })).data;
  if (opcoes.modo) await d.repos.agentes.definirModoAprovacao(agente.id, opcoes.modo);
  if (opcoes.secao) await executar(d, gerirAgente, { agenteId: agente.id, acao: "organizar", secao: opcoes.secao });
  const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: conversa.id, agenteId: agente.id, origem: opcoes.origem ?? "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "crie os agentes de LP", entradaConfianca: opcoes.confianca ?? "confiavel", modelo: "auto", mensagemOrigemId: opcoes.mensagemOrigemId ?? null });
  if (!turno) throw new Error("turno");
  return { ctx: { turnoId: turno.id, agenteId: agente.id, conversaId: conversa.id }, nina: agente, conversa };
}

const doMarlon = async (d: Deps) => (await d.repos.agentes.listar({ incluirOcultos: true })).filter((a) => a.ownerId === MARLON.pessoaId);

describeIntegracao("criar_bots (NOD-210, ADR-104)", () => {
  for (const modo of ["manual", "automatico", "total"] as const) {
    it(`${modo}: cria os 3 na hora, sem card nem decisão; seção explícita ou a de quem pede; quem pede não muda`, async () => {
      await withRollback(MARLON, async (trx) => {
        const d = depsSobreTrx(trx, MARLON);
        const { ctx, nina } = await botComTurno(d, { modo, secao: "LPs" });
        const r = await criarBots(d, { ...ctx, bots: LPS });
        expect(r.data).toMatchObject({ ok: true, criados: [{ nome: "Copy de LP", secao: "LPs" }, { nome: "Layout de LP", secao: "Time de LPs" }, { nome: "QA de LP", secao: "LPs" }] });
        if (!r.data.ok) return;
        expect(await d.repos.decisoes.pendentesDaConversa(ctx.conversaId)).toEqual([]);
        // NOD-437 (revisão 3): o time de cada seção nasce junto (a barra não fica com time provisório).
        const times = await trx<{ nome: string }[]>`select nome from times where owner_id = ${MARLON.pessoaId} and nome in ('LPs', 'Time de LPs') order by nome`;
        expect(times.map((t) => t.nome)).toEqual(["LPs", "Time de LPs"]);

        for (const c of r.data.criados) {
          const novo = await d.repos.agentes.buscar(c.bot_id);
          expect(novo).toMatchObject({ nome: c.nome, confirmado: true, dono: "pessoa", ownerId: MARLON.pessoaId });
          // NOD-316: nasce em Aprovar automaticamente, qualquer que seja o modo de quem pede.
          expect(novo?.modoAprovacao).toBe("automatico");
          expect(novo?.secao).toBe(c.secao);
          expect(await d.repos.concessoes.doAgente(c.bot_id)).toEqual([]);
          expect(await d.repos.rotinas.listarDoAgente(c.bot_id)).toEqual([]);
        }
        const copy = await d.repos.agentes.buscar(r.data.criados[0]?.bot_id ?? "");
        expect(copy).toMatchObject({ titulo: "Textos da página", descricao: "Você escreve a copy das landing pages." });

        // A primeira mensagem do bot novo diz quem criou e a pedido de quem.
        const conversaDoNovo = await d.repos.conversas.buscarPropriaDoAgente(r.data.criados[0]?.bot_id ?? "");
        const primeira = await d.repos.mensagens.ultimaDaConversa(conversaDoNovo?.id ?? "");
        expect(primeira).toMatchObject({ kind: "sistema", autoria: { autor_tipo: "agente", autor_id: nina.id, decidido_por: "regra:criar_bots" } });
        expect(primeira?.texto).toMatch(/^Criado por Nina a pedido de .+ em \d\d\/\d\d\. Copy de LP está pronto; envie a primeira tarefa\.\n\nO que ele faz: Você escreve a copy/);

        // A linha de sistema na conversa de quem pediu.
        const ultima = await d.repos.mensagens.ultimaDaConversa(ctx.conversaId);
        expect(ultima).toMatchObject({ kind: "sistema" });
        expect(ultima?.texto).toMatch(/^Nina criou 3 bots a pedido de .+: Copy de LP, Layout de LP e QA de LP\.$/);

        // O evento do nascimento leva quem criou.
        const nascimentos = (r.events ?? []).filter((e) => e.kind === "agente_atualizado" && (e.dados as { acao?: string }).acao === "criado");
        expect(nascimentos).toHaveLength(3);
        for (const e of nascimentos) expect(e.dados).toMatchObject({ criado_por_agente_id: nina.id });

        // Quem pediu continua como era.
        expect(await d.repos.agentes.buscar(nina.id)).toMatchObject({ nome: "Nina", titulo: "Orquestradora de LPs", descricao: "Você orquestra as LPs." });
      });
    });
  }

  it("um problema no pedido e nada é criado: nome já existente, repetido, Nod", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { ctx } = await botComTurno(d);
      const antes = (await doMarlon(d)).length;
      const r = await criarBots(d, { ...ctx, bots: [{ nome: "Novo", descricao: "x." }, { nome: "nina", descricao: "x." }, { nome: "Novo ", descricao: "x." }, { nome: "Nod", descricao: "x." }] });
      expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      if (r.data.ok) return;
      expect(r.data.problemas.map((p) => p.i)).toEqual([1, 2, 3]);
      expect((await doMarlon(d)).length).toBe(antes);
    });
  });

  it("fora da conversa com a pessoa não cria: rotina, e o Nod (que tem gerir_bots)", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { ctx } = await botComTurno(d, { origem: "rotina" });
      const antes = (await doMarlon(d)).length;
      expect((await criarBots(d, { ...ctx, bots: LPS })).data).toMatchObject({ ok: false, erro: "fora_da_conversa" });

      const { nod } = (await executar(d, garantirNod, {})).data;
      const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: nod.conversaId, agenteId: nod.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "auto" });
      expect((await criarBots(d, { turnoId: turno?.id ?? "", agenteId: nod.id, conversaId: nod.conversaId, bots: LPS })).data).toMatchObject({ ok: false, erro: "fora_da_conversa" });
      // Turno de outro bot: também não.
      expect((await criarBots(d, { ...ctx, agenteId: nod.id, bots: LPS })).data).toMatchObject({ ok: false, erro: "fora_da_conversa" });
      expect((await doMarlon(d)).length).toBe(antes + 1); // só o Nod, do garantirNod
    });
  });

  // ---- Revisão do PR #309 ----

  it("conteúdo de fora não pede bots: entrada não confiável e recado de outro bot recusam com sem_pedido_da_pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { ctx, conversa } = await botComTurno(d, { confianca: "nao_confiavel" });
      const antes = (await doMarlon(d)).length;
      expect((await criarBots(d, { ...ctx, bots: LPS })).data).toMatchObject({ ok: false, erro: "sem_pedido_da_pessoa" });

      // O recado de um bot numa task vira turno de retomada com a entrada herdada (confiável), mas a mensagem que o
      // disparou é do bot, não confiável (coordenar-trabalhos.ts).
      const recado = await d.repos.mensagens.criar({ conversaId: conversa.id, autoria: autoriaAgente({ agenteId: ctx.agenteId, contaDeExecucao: MARLON.pessoaId, executor: "catcher" }), kind: "texto", texto: "crie 3 bots de LP", confianca: "nao_confiavel" });
      const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: conversa.id, agenteId: ctx.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "crie 3 bots de LP", entradaConfianca: "confiavel", modelo: "auto", mensagemOrigemId: recado?.id ?? null });
      expect((await criarBots(d, { ...ctx, turnoId: turno?.id ?? "", bots: LPS })).data).toMatchObject({ ok: false, erro: "sem_pedido_da_pessoa" });
      expect((await doMarlon(d)).length).toBe(antes);
    });
  });

  it("turno da pessoa que leu conteúdo de fora cria (decisão do Matheus) e a auditoria leva apos_conteudo_de_fora", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const limpo = await botComTurno(d);
      const r1 = await criarBots(d, { ...limpo.ctx, bots: [LPS[0] as (typeof LPS)[number]] });
      expect(r1.data.ok).toBe(true);
      expect((r1.events ?? []).find((e) => e.kind === "agente_atualizado")?.dados).toMatchObject({ acao: "criado", apos_conteudo_de_fora: false });

      await d.repos.turnos.contaminar(limpo.ctx.turnoId, Date.now());
      const r2 = await criarBots(d, { ...limpo.ctx, bots: [LPS[1] as (typeof LPS)[number]] });
      expect(r2.data.ok).toBe(true);
      expect((r2.events ?? []).find((e) => e.kind === "agente_atualizado")?.dados).toMatchObject({ acao: "criado", criado_por_agente_id: limpo.nina.id, apos_conteudo_de_fora: true });
    });
  });

  it("a seção é gravada pelo bot, pela regra criar_bots — não em nome da pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { ctx, nina } = await botComTurno(d, { secao: "LPs" });
      const r = await criarBots(d, { ...ctx, bots: LPS });
      const organizar = (r.events ?? []).filter((e) => e.kind === "agente_atualizado" && (e.dados as { acao?: string }).acao === "organizar");
      expect(organizar).toHaveLength(3);
      for (const e of organizar) expect(e.autoria).toMatchObject({ autor_tipo: "agente", autor_id: nina.id, decidido_por: "regra:criar_bots" });
    });
  });

  it("falha no meio do lote: nao_deu_para_criar e o SAVEPOINT volta tudo, inclusive os já criados", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { ctx } = await botComTurno(d, { secao: "LPs" });
      const antes = (await doMarlon(d)).length;
      let chamadas = 0;
      const organizar = d.repos.agentes.organizar.bind(d.repos.agentes);
      const quebrado: Deps = { ...d, repos: { ...d.repos, agentes: { ...d.repos.agentes, organizar: async (id, campos) => (++chamadas === 3 ? null : organizar(id, campos)) } } };
      const r = await criarBots(quebrado, { ...ctx, bots: LPS });
      expect(r.data).toMatchObject({ ok: false, erro: "nao_deu_para_criar" });
      expect(chamadas).toBe(3);
      expect((await doMarlon(d)).length).toBe(antes);
    });
  });

  it("o nome não repete o de nenhum bot que a pessoa vê, inclusive os da empresa criados por outra pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      await vincularEscopo(trx, ANA);
      await executar(depsSobreTrx(trx, ANA), criarAgente, { dono: "empresa", nome: "Vera", descricao: "Você cuida do financeiro." });
      await vincularEscopo(trx, MARLON);
      const d = depsSobreTrx(trx, MARLON);
      expect((await d.repos.agentes.buscarPorNome("vera"))?.ownerId).toBe(ANA.pessoaId);
      const { ctx } = await botComTurno(d);
      const r = await criarBots(d, { ...ctx, bots: [{ nome: " VERA ", descricao: "x." }, { nome: "Ｎｏｄ", descricao: "x." }, { nome: "Novo agente", descricao: "x." }] });
      expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      if (r.data.ok) return;
      expect(r.data.problemas.map((p) => p.i)).toEqual([0, 1, 2]);
    });
  });

  it("descrição com \\u0000 vira problema do pedido, não erro do Postgres", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { ctx } = await botComTurno(d);
      expect((await criarBots(d, { ...ctx, bots: [{ nome: "Copy", descricao: "Você\u0000 escreve." }] })).data).toMatchObject({ ok: false, erro: "entrada_invalida", problemas: [{ i: 0, motivo: "descrição com caractere de controle" }] });
    });
  });
});
