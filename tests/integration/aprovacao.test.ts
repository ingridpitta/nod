import { expect, it } from "vitest";
import { decidir } from "../../src/use-cases/decidir.ts";
import { assentarLoteAutomatico, pedirAprovacao } from "../../src/use-cases/pedir-aprovacao.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste, type ChamadaConector } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const destino = (texto: string) => ({ conector: "email", ferramenta: "enviar", argumentos: { texto } });

/**
 * E4.1/E4.2/E4.5 sobre Postgres real: itens como linhas próprias (CHECK item_sensivel_marcado_exige_pessoa
 * vivo), decidir 2 de 4 executa EXATAMENTE 2 no conector falso, desfechos por item, mensagem
 * 'resultado_aprovacao' permanente e turno de RETOMADA com retoma_turno_id (ADR-009: nunca requeue).
 */
describeIntegracao("aprovação em lista tipada: pedir → decidir → executar → retomar", () => {
  it("4 itens (2 sensíveis desmarcados com justificativa) → decidir 2 → 2 chamadas, desfechos certos, mensagem e retomada", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const email = await repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      await repos.conectores.registrarSonda(email?.id ?? "", { ok: true, catalogo: [{ nome: "enviar", descricao: "envia", schema: { type: "object" }, readOnlyHint: false }], agora: Date.now() });
      const consentimento = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "consentimento", texto: "ok", confianca: "confiavel" });
      await repos.concessoes.conceder({ agenteId, conectorId: email?.id ?? "", capacidade: "enviar", mensagemId: consentimento?.id ?? "" });
      await repos.conectores.criar({ nome: "CRM", slug: "crm", transporte: "stdio", comando: "node", declaracao: "toca" });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      const chamadas: ChamadaConector[] = [];
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ chamadas }), trx });

      const pedido = await pedirAprovacao(deps, {
        turnoId: turno?.id ?? "",
        agenteId,
        conversaId,
        resumo: "enviar 4 e-mails",
        itens: [
          { texto: "ana", destino: destino("ana") },
          { texto: "bia (do CRM)", destino: destino("bia"), origem_conector: "crm" },
          { texto: "caio", destino: destino("caio") },
          { texto: "dani (do CRM)", destino: destino("dani"), origem_conector: "crm" },
        ],
      });
      if (pedido.data.estado !== "pendente") throw new Error("esperava pendente");
      await repos.events.gravarComOutbox(pedido.events ?? []);
      const decisaoId = pedido.data.decisao_id;
      // A classificação por origem está DESLIGADA (ADR-002, refinamento 2026-09-21): nenhum item
      // nasce sensível. O mecanismo continua no banco, e este cenário o exercita marcando dois itens
      // como sensíveis pela DONA — é assim que a trava e o desfecho próprio seguem provados.
      const criados = await repos.itensAprovacao.listar(decisaoId);
      expect(criados.every((i) => !i.origemSensivel && i.selecionado)).toBe(true);
      for (const idx of [1, 3]) {
        await trx`update itens_aprovacao set origem_sensivel = true, selecionado = false, justificativa = 'do CRM' where id = ${criados[idx]?.id ?? ""}`;
      }
      const itens = await repos.itensAprovacao.listar(decisaoId);
      expect(itens.map((i) => [i.idx, i.selecionado, i.origemSensivel, i.justificativa !== null])).toEqual([
        [0, true, false, false],
        [1, false, true, true],
        [2, true, false, false],
        [3, false, true, true],
      ]);
      // A trava do banco (E4.2 (3)): sensível marcado sem pessoa é recusado pelo CHECK, não por convenção.
      await expectRejected(trx, () => trx`update itens_aprovacao set selecionado = true where id = ${itens[1]?.id ?? ""}`, "23514");

      const [ana, bia, caio, dani] = itens;
      const r = await decidir(deps, { decisaoId, itens: [{ id: bia?.id ?? "", selecionado: true }, { id: caio?.id ?? "", selecionado: false }] });
      await repos.events.gravarComOutbox(r.events ?? []);
      expect(chamadas.map((c) => c.args.texto)).toEqual(["ana", "bia"]);
      expect(chamadas.every((c) => c.conectorId === email?.id && c.tool === "enviar")).toBe(true);

      const finais = await repos.itensAprovacao.listar(decisaoId);
      const desfechoDe = (id: string | undefined) => finais.find((i) => i.id === id)?.desfecho;
      expect(desfechoDe(ana?.id)).toBe("executado");
      expect(desfechoDe(bia?.id)).toBe("executado");
      expect(desfechoDe(caio?.id)).toBe("retirado_pela_pessoa");
      expect(desfechoDe(dani?.id)).toBe("sensivel_nao_aprovado");
      expect(finais.find((i) => i.id === bia?.id)).toMatchObject({ marcadoPor: PESSOA_MARLON, selecionado: true });
      expect((await repos.decisoes.buscar(decisaoId))?.estado).toBe("decidida");

      const mensagens = await repos.mensagens.listarDaConversa(conversaId);
      const resultado = mensagens.find((m) => m.kind === "resultado_aprovacao");
      expect(resultado?.texto).toMatch(/aprovou 2 de 4; não enviado: caio \(retirado pela pessoa\); dani \(do CRM\) \(sensível, não aprovado\)\.$/);
      expect(resultado?.payload).toMatchObject({ kind: "resultado_aprovacao", decisaoId });
      expect(resultado?.turnoId).toBe(turno?.id);

      const retomada = await repos.turnos.buscar(r.data.turnoRetomadaId ?? "");
      expect(retomada).toMatchObject({ origem: "retomada", estado: "pendente", retomaTurnoId: turno?.id, conversaId, agenteId });
      expect(retomada?.entradaTexto).toContain("item 4 (email.enviar): sensivel_nao_aprovado");

      await expect(decidir(deps, { decisaoId })).rejects.toMatchObject({ codigo: "estado_invalido" });
      expect(chamadas).toHaveLength(2);

      // NOD-70: o cartão deixou 4 linhas `cartao`; o clique, 2 permitidas e 2 negadas com o desfecho — todas com o app.
      const trilha = await repos.trilha.doTurno(turno?.id ?? "");
      expect(trilha.every((l) => l.ferramenta === "email__enviar" && l.conectorId === email?.id)).toBe(true);
      expect(trilha.filter((l) => l.kind === "cartao").map((l) => l.regra)).toEqual(Array(4).fill("regra:cartao"));
      expect(trilha.filter((l) => l.kind !== "cartao").map((l) => [l.kind, l.motivo, l.regra]).sort()).toEqual([
        ["negacao", "retirado_pela_pessoa", "regra:clique"],
        ["negacao", "sensivel_nao_aprovado", "regra:clique"],
        ["tool_call", "item_de_aprovacao", "regra:clique"],
        ["tool_call", "item_de_aprovacao", "regra:clique"],
      ]);
    });
  });

  it("NOD-70: o lote que rodou sem cartão deixa uma linha `tool_call` por item que rodou, com a regra do item (ou a do lote); reassentar não repete", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const email = await repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
      const decisao = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, turnoId: turno?.id ?? null, prazoDecisaoEm: Date.now() + 600_000, frase: "enviar 3" });
      const itens = await repos.itensAprovacao.criarLote(decisao?.id ?? "", ["ana", "bia", "caio"].map((t, idx) => ({ idx, texto: t, destino: destino(t), origemSensivel: false })));
      const [ana, bia, caio] = itens;
      if (!ana || !bia || !caio || !decisao || !turno) throw new Error("cenário");
      const lote = {
        decisaoId: decisao.id, conversaId, turnoId: turno.id, agenteId, regra: "regra:modo_automatico" as const, regraVersao: 3,
        aExecutar: [{ item: ana, conectorId: email?.id ?? "" }, { item: bia, conectorId: email?.id ?? "", regra: "regra:aprovacao_permanente", regraVersao: 2 }, { item: caio, conectorId: email?.id ?? "" }],
      };
      const desfechos = [{ itemId: ana.id, desfecho: "executado" as const }, { itemId: bia.id, desfecho: "falhou_na_execucao" as const }, { itemId: caio.id, desfecho: "ja_executado" as const }];
      await assentarLoteAutomatico(deps, { lote, desfechos });
      await assentarLoteAutomatico(deps, { lote, desfechos });
      const trilha = await repos.trilha.doTurno(turno.id);
      expect(trilha.map((l) => [l.ferramenta, l.kind, l.regra, l.regraVersao, l.conectorId]).sort()).toEqual([
        ["email__enviar", "tool_call", "regra:aprovacao_permanente", 2, email?.id],
        ["email__enviar", "tool_call", "regra:modo_automatico", 3, email?.id],
      ]);
    });
  });
});

describeIntegracao("NOD-282 (G6): a ação que já saiu numa decisão posterior da mesma faixa não roda de novo", () => {
  it("o card antigo aprovado depois não chama o conector; com argumentos diferentes, chama; no card de 2, roda só o que falta", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const email = await repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      await repos.conectores.registrarSonda(email?.id ?? "", { ok: true, catalogo: [{ nome: "enviar", descricao: "envia", schema: { type: "object" }, readOnlyHint: false }], agora: Date.now() });
      const consentimento = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "consentimento", texto: "ok", confianca: "confiavel" });
      await repos.concessoes.conceder({ agenteId, conectorId: email?.id ?? "", capacidade: "enviar", mensagemId: consentimento?.id ?? "" });
      const chamadas: ChamadaConector[] = [];
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ chamadas }), trx });
      let minuto = 0;
      const pedir = async (textos: string[]) => {
        const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
        await repos.turnos.assentar(turno!.id, { estado: "concluido" });
        const r = await pedirAprovacao(deps, { turnoId: turno!.id, agenteId, conversaId, resumo: `enviar ${textos.join(", ")}`, itens: textos.map((t) => ({ texto: t, destino: destino(t) })) });
        if (r.data.estado !== "pendente") throw new Error("esperava pendente");
        // Tudo roda numa transação (o now() é o mesmo): a ordem de criação vem do relógio do teste.
        await trx`update decisoes set criado_em = now() + make_interval(mins => ${minuto++}) where id = ${r.data.decisao_id}`;
        return r.data.decisao_id;
      };
      const antiga = await pedir(["ana"]);
      const dupla = await pedir(["ana", "zeca"]);
      const outra = await pedir(["bia"]);
      const nova = await pedir(["ana"]);
      await decidir(deps, { decisaoId: nova });
      expect(chamadas.map((c) => c.args.texto)).toEqual(["ana"]);

      const r = await decidir(deps, { decisaoId: antiga });
      expect(chamadas).toHaveLength(1);
      expect((await repos.itensAprovacao.listar(antiga)).map((i) => i.desfecho)).toEqual(["ja_executado"]);
      expect(r.data.turnoRetomadaId).toBeNull();
      const recibo = (await repos.mensagens.listarDaConversa(conversaId, 500)).find((m) => m.kind === "resultado_aprovacao" && m.payload?.kind === "resultado_aprovacao" && m.payload.decisaoId === antiga);
      expect(recibo?.texto).toBe("Essa ação já foi feita.");

      await decidir(deps, { decisaoId: outra });
      expect(chamadas.map((c) => c.args.texto)).toEqual(["ana", "bia"]);
      const d = await decidir(deps, { decisaoId: dupla });
      expect(chamadas.map((c) => c.args.texto)).toEqual(["ana", "bia", "zeca"]);
      expect((await repos.itensAprovacao.listar(dupla)).map((i) => i.desfecho)).toEqual(["ja_executado", "executado"]);
      expect(d.data.turnoRetomadaId).not.toBeNull();

      // A decisão anterior não conta: a "nova" não vira já executada pela "antiga".
      expect((await repos.itensAprovacao.listar(nova)).map((i) => i.desfecho)).toEqual(["executado"]);
    });
  });

  it("executado em outra faixa (uma task) não conta", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const email = await repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      await repos.conectores.registrarSonda(email?.id ?? "", { ok: true, catalogo: [{ nome: "enviar", descricao: "envia", schema: { type: "object" }, readOnlyHint: false }], agora: Date.now() });
      const consentimento = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "consentimento", texto: "ok", confianca: "confiavel" });
      await repos.concessoes.conceder({ agenteId, conectorId: email?.id ?? "", capacidade: "enviar", mensagemId: consentimento?.id ?? "" });
      const chamadas: ChamadaConector[] = [];
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ chamadas }), trx });
      const pedir = async (minuto: number, trabalhoId?: string) => {
        const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
        if (trabalhoId) await trx`update turnos set trabalho_id = ${trabalhoId} where id = ${turno!.id}`;
        await repos.turnos.assentar(turno!.id, { estado: "concluido" });
        const r = await pedirAprovacao(deps, { turnoId: turno!.id, agenteId, conversaId, resumo: "enviar ana", itens: [{ texto: "ana", destino: destino("ana") }] });
        if (r.data.estado !== "pendente") throw new Error("esperava pendente");
        await trx`update decisoes set criado_em = now() + make_interval(mins => ${minuto}) where id = ${r.data.decisao_id}`;
        return r.data.decisao_id;
      };
      const [task] = await trx<{ id: string }[]>`insert into trabalhos (tenant_id, owner_id, agente_id, conversa_id, titulo, origem, estado) values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${agenteId}, ${conversaId}, 'T', 'pessoa', 'rodando') returning id`;
      const daConversa = await pedir(0);
      const daTask = await pedir(1, task!.id);
      await decidir(deps, { decisaoId: daTask });
      await decidir(deps, { decisaoId: daConversa });
      expect(chamadas).toHaveLength(2);
      expect((await repos.itensAprovacao.listar(daConversa)).map((i) => i.desfecho)).toEqual(["executado"]);
    });
  });
});
