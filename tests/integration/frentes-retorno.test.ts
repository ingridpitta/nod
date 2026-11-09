import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Turno } from "../../src/contracts/turno.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { FALA_DEPOIS_DO_FIM } from "../../src/domain/fala-na-frente.ts";
import { REDE_MS } from "../../src/domain/trabalho.ts";
import { enfileirarNoTrabalho, mensagemParaTrabalho, promoverNaRede } from "../../src/use-cases/coordenar-trabalhos.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { INSTRUCAO_DO_RETORNO, PERGUNTA_DA_RECONEXAO } from "../../src/domain/retorno-do-lote.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { fecharLoteSePronto } from "../../src/use-cases/fechar-lote.ts";
import { abrirFrentes, devolverResumo } from "../../src/use-cases/frentes.ts";
import { parar } from "../../src/use-cases/parar.ts";
import { reabrirDecisao } from "../../src/use-cases/reabrir-decisao.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { criarTrabalho, pararTrabalho, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre as depsL5, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const TRES = [
  { titulo: "Login no Safari", pedido: "Conserte o login no Safari." },
  { titulo: "CI vermelha", pedido: "Descubra por que a CI quebrou." },
  { titulo: "Notas da versão", pedido: "Escreva as notas da versão." },
];

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const turnoDaConversa = async (p: { agenteId?: string; conversaId?: string; texto?: string } = {}) =>
    (await repos.turnos.enfileirar({ executor: "catcher", conversaId: p.conversaId ?? ada.conversaId, agenteId: p.agenteId ?? ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: p.texto ?? "conserte o login, a CI e as notas", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
  const abrir = async (dono: Turno, frentes = TRES, avisar = false) => {
    const r = await abrirFrentes(deps, { ...contexto(dono.agenteId, dono.conversaId, dono.id), frentes, avisar_a_cada_uma: avisar });
    if (!r.data.ok) throw new Error(`deveria abrir: ${r.data.instrucao}`);
    return { loteId: r.data.lote_id, ids: r.data.frentes.map((f) => f.trabalho_id) };
  };
  const turnoDa = async (trabalhoId: string) => (await repos.turnos.doTrabalho(trabalhoId))[0]!;
  /** A frente termina: o turno dela assenta e o trabalho relê os fatos (o caminho do assentamento de verdade). */
  const terminar = async (trabalhoId: string, feito?: string) => {
    const t = await turnoDa(trabalhoId);
    if (feito) await devolverResumo(deps, { ...contexto(t.agenteId, t.conversaId, t.id), feito });
    await repos.turnos.assentar(t.id, { estado: "concluido" });
    return sincronizarTrabalho(deps, trabalhoId);
  };
  const retomadasDe = async (dono: Turno) => (await repos.turnos.listarDaConversa(dono.conversaId, 500)).filter((t) => t.origem === "retomada" && t.retomaTurnoId === dono.id);
  const linhas = async (conversaId: string, kind: string) => (await repos.mensagens.listarDaConversa(conversaId, 500)).filter((m) => m.payload?.kind === kind);
  return { ada, deps, repos, turnoDaConversa, abrir, turnoDa, terminar, retomadasDe, linhas };
}

describeIntegracao("frentes: o lote volta ao dono numa mensagem só (ADR-099, I3)", () => {
  it("3 frentes → exatamente 1 retomada do dono, com os resumos, a marca de fora e a linha; o turno seguinte da pessoa nasce limpo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { loteId, ids } = await m.abrir(dono);
      // A CI leu uma página de fora: o retorno nasce marcado.
      await m.repos.turnos.contaminar((await m.turnoDa(ids[1]!)).id, Date.now());
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });

      await m.terminar(ids[0]!, "Corrigi o login no Safari");
      await m.terminar(ids[1]!);
      expect(await m.retomadasDe(dono)).toHaveLength(0);
      expect((await m.repos.frentes.buscarLote(loteId))?.devolvidoEm).toBeNull();

      const events = await m.terminar(ids[2]!, "Notas escritas");
      const [retorno, ...mais] = await m.retomadasDe(dono);
      expect(mais).toHaveLength(0);
      expect(retorno).toMatchObject({ estado: "pendente", trabalhoId: null, agenteId: m.ada.agenteId, entradaConfianca: "confiavel" });
      expect(retorno!.entradaTexto).toContain("As 3 frentes que você abriu para este pedido terminaram.");
      expect(retorno!.entradaTexto).toContain(INSTRUCAO_DO_RETORNO);
      const json = JSON.parse(retorno!.entradaTexto.split("\n")[1]!) as Record<string, unknown>[];
      expect(json.map((f) => [f.titulo, f.estado, f.feito])).toEqual([
        ["Login no Safari", "terminado", "Corrigi o login no Safari"],
        ["CI vermelha", "terminado", "A frente terminou sem dizer o que fez."],
        ["Notas da versão", "terminado", "Notas escritas"],
      ]);
      expect(json.map((f) => f.cuidado ?? false)).toEqual([false, true, false]);
      expect(await m.repos.turnos.contaminado(retorno!.id)).toBe(true);
      expect(await m.repos.frentes.buscarLote(loteId)).toMatchObject({ retornoTurnoId: retorno!.id, devolvidoEm: expect.any(Number) });

      const [linha, ...outras] = await m.linhas(m.ada.conversaId, "frentes_terminadas");
      expect(outras).toHaveLength(0);
      expect(linha).toMatchObject({ kind: "sistema", turnoId: retorno!.id, texto: "3 frentes terminaram", confianca: "confiavel", payload: { loteId, frentes: ids.map((id) => ({ trabalhoId: id, estado: "terminado" })) } });
      expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["trabalho_mudou", "turno_criado", "mensagem_criada"]));

      // Idempotente: um fecho a mais (o mesmo trabalho, de novo) não cria outro retorno nem outra linha.
      expect(await fecharLoteSePronto(m.deps, (await m.repos.trabalhos.buscar(ids[2]!))!)).toEqual([]);
      expect(await m.retomadasDe(dono)).toHaveLength(1);
      // O turno seguinte da pessoa nasce limpo (a marca é por turno).
      expect(await m.repos.turnos.contaminado((await m.turnoDaConversa({ texto: "e agora?" })).id)).toBe(false);
    });
  });

  it("NOD-376: a pessoa conversa numa frente que já voltou (avisar_a_cada_uma): o fim da conversa não acorda o dono de novo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { loteId, ids } = await m.abrir(dono, TRES.slice(0, 2), true);
      await m.terminar(ids[0]!, "Login corrigido");
      expect(await m.retomadasDe(dono)).toHaveLength(1);

      const fala = await mensagemParaTrabalho(m.deps, { trabalhoId: ids[0]!, texto: "Que commit foi?" });
      expect((await m.repos.trabalhos.buscar(ids[0]!))?.estado).not.toBe("terminado");
      await m.repos.turnos.assentar(fala.data.mensagemTurnoId, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, ids[0]!);
      expect((await m.repos.trabalhos.buscar(ids[0]!))?.estado).toBe("terminado");
      expect(await m.retomadasDe(dono)).toHaveLength(1);
      expect((await m.repos.frentes.buscarLote(loteId))?.devolvidoEm).toBeNull();

      // A outra frente termina: o retorno dela, o último, fecha o lote (a conversa não entrou em nenhum retorno).
      await m.terminar(ids[1]!, "CI verde");
      const retornos = await m.retomadasDe(dono);
      expect(retornos).toHaveLength(2);
      expect(retornos[1]!.entradaTexto).toContain("CI vermelha");
      expect(retornos[1]!.entradaTexto).not.toContain("Login no Safari");
      expect((await m.repos.frentes.buscarLote(loteId))?.devolvidoEm).toEqual(expect.any(Number));
    });
  });

  it("NOD-376 (revisão 8): a conversa numa frente terminada não segura o lote — a outra termina e todas voltam; o fim da conversa não volta de novo", async () => {
    for (const avisar of [false, true]) {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const dono = await m.turnoDaConversa();
        const { loteId, ids } = await m.abrir(dono, TRES.slice(0, 2), avisar);
        await m.terminar(ids[0]!, "Login corrigido");
        const antes = (await m.retomadasDe(dono)).length;
        const fala = await mensagemParaTrabalho(m.deps, { trabalhoId: ids[0]!, texto: "Que commit foi?" });
        expect(["na_fila", "rodando"]).toContain((await m.repos.trabalhos.buscar(ids[0]!))?.estado);
        await m.terminar(ids[1]!, "CI verde");
        const depoisDaOutra = await m.retomadasDe(dono);
        expect((await m.repos.frentes.buscarLote(loteId))?.devolvidoEm).toEqual(expect.any(Number));

        await m.repos.turnos.assentar(fala.data.mensagemTurnoId, { estado: "concluido" });
        await sincronizarTrabalho(m.deps, ids[0]!);
        const retornos = await m.retomadasDe(dono);
        if (avisar) {
          // Cada uma voltou na hora; o fim da conversa não manda outra.
          expect([antes, depoisDaOutra.length, retornos.length]).toEqual([1, 2, 2]);
        } else {
          // Um retorno só, com as duas (a que conversa, como terminou), assim que a outra termina.
          expect([antes, depoisDaOutra.length, retornos.length]).toEqual([0, 1, 1]);
          const json = JSON.parse(depoisDaOutra[0]!.entradaTexto.split("\n")[1]!) as Record<string, unknown>[];
          expect(json.map((f) => [f.titulo, f.estado, f.feito])).toEqual([
            ["Login no Safari", "terminado", "Login corrigido"],
            ["CI vermelha", "terminado", "CI verde"],
          ]);
        }
      });
    }
  });

  it("NOD-376 (revisão 6): parar a conversa numa frente acabada não a faz voltar ao dono como parada", async () => {
    for (const ultima of [false, true]) {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const dono = await m.turnoDaConversa();
        const { ids } = await m.abrir(dono, TRES.slice(0, 2));
        await m.terminar(ids[0]!, "Login corrigido");
        if (ultima) await m.terminar(ids[1]!, "CI verde");
        await mensagemParaTrabalho(m.deps, { trabalhoId: ids[0]!, texto: "Que commit foi?" });
        await pararTrabalho(m.deps, { trabalhoId: ids[0]! });
        if (!ultima) await m.terminar(ids[1]!, "CI verde");
        const [retorno, ...mais] = await m.retomadasDe(dono);
        expect(mais).toHaveLength(0);
        const json = JSON.parse(retorno!.entradaTexto.split("\n")[1]!) as Record<string, unknown>[];
        expect(json.map((f) => [f.titulo, f.estado, f.feito])).toEqual([
          ["Login no Safari", "terminado", "Login corrigido"],
          ["CI vermelha", "terminado", "CI verde"],
        ]);
      });
    }
  });

  it("NOD-376 (revisão 3): duas falas seguidas numa frente acabada — as duas marcadas, nenhuma manda continuar, o dono não acorda de novo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { ids } = await m.abrir(dono, TRES.slice(0, 2), true);
      await m.terminar(ids[0]!, "Login corrigido");
      const f1 = await mensagemParaTrabalho(m.deps, { trabalhoId: ids[0]!, texto: "Que commit foi?" });
      expect((await m.repos.trabalhos.buscar(ids[0]!))?.estado).not.toBe("terminado");
      const f2 = await mensagemParaTrabalho(m.deps, { trabalhoId: ids[0]!, texto: "E o PR?" });
      for (const id of [f1.data.mensagemTurnoId, f2.data.mensagemTurnoId]) {
        const t = (await m.repos.turnos.buscar(id))!;
        expect(t.decididoPor).toBe(FALA_DEPOIS_DO_FIM);
        expect(t.entradaTexto).toContain("já tinha acabado");
        expect(t.entradaTexto).not.toContain("continue o trabalho");
        await m.repos.turnos.assentar(id, { estado: "concluido" });
      }
      await sincronizarTrabalho(m.deps, ids[0]!);
      expect(await m.retomadasDe(dono)).toHaveLength(1);
      await m.terminar(ids[1]!, "CI verde");
      const retornos = await m.retomadasDe(dono);
      expect(retornos).toHaveLength(2);
      expect(retornos[1]!.entradaTexto).not.toContain("Login no Safari");
    });
  });

  it("NOD-376 (revisão 3): lote de colega com avisar_a_cada_uma — a conversa numa frente acabada não apaga a resposta nem troca o resumo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await agenteComConversa(trx, MARLON, { nome: "Bia" });
      const daAda = await m.turnoDaConversa({ texto: "peça à Bia" });
      await m.repos.turnos.assentar(daAda.id, { estado: "concluido" });
      const pedido = await pedirABot(m.deps, { ...contexto(m.ada.agenteId, m.ada.conversaId, daAda.id), agente: "Bia", pedido: "Revise o login e a CI" });
      if (!pedido.data.ok) throw new Error(pedido.data.instrucao);
      const triagem = (await m.repos.turnos.buscar(pedido.data.tarefa_id))!;
      const { loteId, ids } = await m.abrir(triagem, TRES.slice(0, 2), true);
      await m.repos.turnos.assentar(triagem.id, { estado: "concluido" });

      await m.terminar(ids[0]!, "Login revisado: ok");
      const fala = await mensagemParaTrabalho(m.deps, { trabalhoId: ids[0]!, texto: "Que commit foi?" });
      const t = (await m.repos.turnos.buscar(fala.data.mensagemTurnoId))!;
      // O bot tenta devolver outro resumo na conversa: o de antes fica.
      const r = await devolverResumo(m.deps, { ...contexto(t.agenteId, t.conversaId, t.id), feito: "Respondi à pessoa: o commit foi abc123" });
      expect(r.data).toMatchObject({ ok: true });
      expect((await m.repos.trabalhos.buscar(ids[0]!))?.resumo).toEqual({ feito: "Login revisado: ok" });
      // Revisão 8: a conversa não segura a resposta — ela sai quando a outra termina, e o fim da conversa não manda outra.
      await m.terminar(ids[1]!, "CI: um teste instável");
      expect(await m.linhas(m.ada.conversaId, "peer_ask")).toHaveLength(1);

      await m.repos.turnos.assentar(t.id, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, ids[0]!);
      const [resposta, ...mais] = await m.linhas(m.ada.conversaId, "peer_ask");
      expect(mais).toHaveLength(0);
      expect(resposta!.texto).toBe("- Login no Safari: Login revisado: ok\n- CI vermelha: CI: um teste instável");
      expect(await m.repos.frentes.buscarLote(loteId)).toMatchObject({ devolvidoEm: expect.any(Number) });
    });
  });

  it("NOD-376 (revisão 4): lote já devolvido — a conversa que só conversa não volta; a que vira trabalho devolve o complementar", async () => {
    for (const viraTrabalho of [false, true]) {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const dono = await m.turnoDaConversa();
        const { loteId, ids } = await m.abrir(dono, TRES.slice(0, 1));
        await m.terminar(ids[0]!, "Login corrigido");
        expect((await m.repos.frentes.buscarLote(loteId))?.devolvidoEm).toEqual(expect.any(Number));
        expect(await m.retomadasDe(dono)).toHaveLength(1);

        const fala = await mensagemParaTrabalho(m.deps, { trabalhoId: ids[0]!, texto: "Que commit foi?" });
        expect((await m.repos.trabalhos.buscar(ids[0]!))?.resumo).toEqual({ feito: "Login corrigido" });
        const turnos = [fala.data.mensagemTurnoId];
        if (viraTrabalho) {
          // O dono manda um recado à frente no meio da conversa: trabalho de verdade, o resumo novo volta a ele.
          const recado = await enfileirarNoTrabalho(m.deps, (await m.repos.trabalhos.buscar(ids[0]!))!, { texto: "Corrija também no Firefox", entrada: "Corrija também no Firefox", deQuem: { agenteId: dono.agenteId, turno: dono } });
          const r = await devolverResumo(m.deps, { ...contexto(recado.turno.agenteId, recado.turno.conversaId, recado.turno.id), feito: "Login corrigido no Safari e no Firefox" });
          expect(r.data).toMatchObject({ ok: true });
          turnos.push(recado.turno.id);
        }
        for (const id of turnos) await m.repos.turnos.assentar(id, { estado: "concluido" });
        await sincronizarTrabalho(m.deps, ids[0]!);
        const retornos = await m.retomadasDe(dono);
        expect(retornos).toHaveLength(viraTrabalho ? 2 : 1);
        if (viraTrabalho) expect(retornos[1]!.entradaTexto).toContain("Firefox");
        else expect((await m.repos.trabalhos.buscar(ids[0]!))?.resumo).toEqual({ feito: "Login corrigido" });
      });
    }
  });

  it("NOD-376 (revisão 5): a task que não é frente (rotina) segue com a fala crua, sem moldura nem marca", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { trabalho } = await criarTrabalho(m.deps, { agenteId: m.ada.agenteId, conversaId: m.ada.conversaId, titulo: "Relatório diário", origem: "rotina", forma: "task" });
      await m.repos.trabalhos.mudarEstado(trabalho.id, "terminado", Date.now());
      const fala = await mensagemParaTrabalho(m.deps, { trabalhoId: trabalho.id, texto: "Mande de novo?" });
      const t = (await m.repos.turnos.buscar(fala.data.mensagemTurnoId))!;
      expect(t.entradaTexto).toBe("Mande de novo?");
      expect(t.decididoPor).not.toBe(FALA_DEPOIS_DO_FIM);
    });
  });

  it("avisar_a_cada_uma: um retorno por frente, e só o último fecha o lote", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { loteId, ids } = await m.abrir(dono, TRES.slice(0, 2), true);
      await m.terminar(ids[0]!, "Login corrigido");
      const [primeiro] = await m.retomadasDe(dono);
      expect(primeiro!.entradaTexto).toContain('A frente "Login no Safari" deste pedido terminou; falta 1.');
      expect((await m.repos.frentes.buscarLote(loteId))?.devolvidoEm).toBeNull();
      await m.terminar(ids[1]!, "CI verde");
      const retornos = await m.retomadasDe(dono);
      expect(retornos).toHaveLength(2);
      expect(retornos[1]!.entradaTexto).toContain("era a última");
      expect((await m.repos.frentes.buscarLote(loteId))?.retornoTurnoId).toBe(retornos[1]!.id);
      expect((await m.linhas(m.ada.conversaId, "frentes_terminadas")).map((l) => l.texto)).toEqual(["A frente Login no Safari terminou", "A frente CI vermelha terminou"]);
    });
  });

  it("frente parada pela pessoa conta como encerrada: o lote fecha com o que tiver", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { ids } = await m.abrir(dono, TRES.slice(0, 2));
      await m.terminar(ids[0]!, "Login corrigido");
      await pararTrabalho(m.deps, { trabalhoId: ids[1]! });
      const [retorno, ...mais] = await m.retomadasDe(dono);
      expect(mais).toHaveLength(0);
      const json = JSON.parse(retorno!.entradaTexto.split("\n")[1]!) as Record<string, unknown>[];
      expect(json[1]).toMatchObject({ titulo: "CI vermelha", estado: "parado", motivo: "parada pela pessoa" });
    });
  });

  // revisto em 2026-10-22 (NOD-311): o Parar do chat não para as frentes — quando elas terminam, o lote volta ao dono.
  it("o Parar do chat não para as frentes: quando elas terminam, o lote acorda o dono com o resultado (NOD-311)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { loteId, ids } = await m.abrir(dono);
      await parar(m.deps, { conversaId: m.ada.conversaId });
      for (const id of ids) expect((await m.repos.trabalhos.buscar(id))?.estado).not.toBe("parado");
      expect(await m.repos.frentes.buscarLote(loteId)).toMatchObject({ devolvidoEm: null });
      for (const id of ids) await m.terminar(id, "feito");
      expect(await m.retomadasDe(dono)).toHaveLength(1);
    });
  });

  it("o Parar global para o dono: o lote fecha com uma linha só, sem acordar o dono", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { loteId } = await m.abrir(dono);
      await parar(m.deps, { conversaId: null });
      expect(await m.retomadasDe(dono)).toHaveLength(0);
      expect(await m.repos.frentes.buscarLote(loteId)).toMatchObject({ retornoTurnoId: null, devolvidoEm: expect.any(Number) });
      expect((await m.linhas(m.ada.conversaId, "frentes_terminadas")).map((l) => l.texto)).toEqual(["3 frentes terminaram"]);
    });
  });

  it("um pedido nunca espera frentes de outro: dois lotes do mesmo bot voltam cada um no seu tempo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const primeiro = await m.turnoDaConversa();
      const a = await m.abrir(primeiro, TRES.slice(0, 1));
      const segundo = await m.turnoDaConversa({ texto: "e escreva as notas" });
      const b = await m.abrir(segundo, TRES.slice(2));
      await m.terminar(b.ids[0]!, "Notas escritas");
      expect(await m.retomadasDe(segundo)).toHaveLength(1);
      expect(await m.retomadasDe(primeiro)).toHaveLength(0);
      await m.terminar(a.ids[0]!, "Login corrigido");
      expect(await m.retomadasDe(primeiro)).toHaveLength(1);
      expect(await m.retomadasDe(segundo)).toHaveLength(1);
    });
  });

  it("lote de colega: a resposta vai direto a quem pediu, sem turno no dono, e o dono só ganha a linha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const bia = await agenteComConversa(trx, MARLON, { nome: "Bia" });
      const daAda = await m.turnoDaConversa({ texto: "peça à Bia" });
      await m.repos.turnos.assentar(daAda.id, { estado: "concluido" });
      const pedido = await pedirABot(m.deps, { ...contexto(m.ada.agenteId, m.ada.conversaId, daAda.id), agente: "Bia", pedido: "Revise o login e a CI" });
      if (!pedido.data.ok) throw new Error(pedido.data.instrucao);
      // O turno curto da triagem roda na conversa da Bia, fora de task (com a triagem, o pedido já nasce assim).
      expect((await m.repos.turnos.buscar(pedido.data.tarefa_id))?.trabalhoId ?? null).toBeNull();
      const triagem = (await m.repos.turnos.buscar(pedido.data.tarefa_id))!;
      const { loteId, ids } = await m.abrir(triagem, TRES.slice(0, 2));
      await m.repos.turnos.assentar(triagem.id, { estado: "concluido" });
      // O "comecei 2 frentes" da triagem não é o resultado: a entrega espera o lote.
      expect((await entregarRespostaPeer(m.deps, { tarefaId: triagem.id, texto: "Comecei duas frentes." })).data).toEqual({ ignorado: "aguardando_frentes" });

      await m.terminar(ids[0]!, "Login revisado: ok");
      expect((await m.linhas(m.ada.conversaId, "peer_ask"))).toHaveLength(0);
      await m.terminar(ids[1]!, "CI: um teste instável");

      // Nenhum turno novo na Bia além das frentes e da triagem.
      expect(await m.retomadasDe(triagem)).toHaveLength(0);
      const [resposta, ...mais] = await m.linhas(m.ada.conversaId, "peer_ask");
      expect(mais).toHaveLength(0);
      expect(resposta!.texto).toBe("- Login no Safari: Login revisado: ok\n- CI vermelha: CI: um teste instável");
      const continuacao = (await m.repos.turnos.buscar(resposta!.turnoId!))!;
      expect(continuacao).toMatchObject({ origem: "retomada", retomaTurnoId: daAda.id, agenteId: m.ada.agenteId, estado: "pendente" });

      const [linha, ...outras] = await m.linhas(bia.conversaId, "pedido_respondido");
      expect(outras).toHaveLength(0);
      // Chat limpo (PR 3): a linha leva o texto entregue e o turno do pedido (a raiz da troca agrupada), com a confiança da
      // fala entregue — a frente de um pedido de colega conta como de fora (frentesDoLote, `origem = 'colega'`).
      expect(linha).toMatchObject({ kind: "sistema", texto: "Respondi ao pedido de Ada", confianca: "nao_confiavel", payload: { loteId, agenteId: m.ada.agenteId, nome: "Ada", resposta: resposta!.texto, turnoRaizId: triagem.id } });
      expect(await m.linhas(bia.conversaId, "frentes_terminadas")).toHaveLength(0);
      expect(await m.repos.frentes.buscarLote(loteId)).toMatchObject({ retornoTurnoId: null, devolvidoEm: expect.any(Number) });
    });
  });
  it("lote aberto pela rede (I8): o turno promovido virou da frente, e o retorno nasce na conversa do dono, com a sessão dela", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      for (const trabalhoDoLote of ["nulo", "a frente"] as const) {
        // O formato da I8: o turno da conversa é promovido, abre o lote e passa a pertencer à frente.
        const promovido = await m.turnoDaConversa({ texto: "migre os relatórios" });
        const lote = (await m.repos.frentes.criarLote({ agenteId: m.ada.agenteId, abertoPorTurnoId: promovido.id }))!;
        const { trabalho: frente } = await criarTrabalho(m.deps, { agenteId: m.ada.agenteId, conversaId: m.ada.conversaId, titulo: "Migrar relatórios", origem: "rede", forma: "frente", loteId: lote.id });
        await trx`update turnos set trabalho_id = ${frente.id} where id = ${promovido.id}`;
        if (trabalhoDoLote === "a frente") await trx`update lotes_de_frentes set trabalho_id = ${frente.id} where id = ${lote.id}`;
        await trx`update trabalhos set sessao_cli = 'sessao-da-frente', sessao_executor = 'local', sessao_harness = 'claude-cli' where id = ${frente.id}`;
        await trx`update conversas set sessao_cli = 'sessao-da-conversa', sessao_executor = 'local', sessao_harness = 'claude-cli' where id = ${m.ada.conversaId}`;
        await m.repos.turnos.assentar(promovido.id, { estado: "concluido" });
        await sincronizarTrabalho(m.deps, frente.id);

        const [retorno, ...mais] = await m.retomadasDe((await m.repos.turnos.buscar(promovido.id))!);
        expect(mais, trabalhoDoLote).toHaveLength(0);
        expect(retorno, trabalhoDoLote).toMatchObject({ conversaId: m.ada.conversaId, trabalhoId: null, origem: "retomada" });
        const agora = () => Date.now();
        const l5 = depsL5(m.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
        const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
        const plano = (await emitirPlanoTurno(l5, { turnoId: retorno!.id, machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto } })).data;
        expect(plano.entrada.sessaoCli, trabalhoDoLote).toBe("sessao-da-conversa");
        await m.repos.turnos.assentar(retorno!.id, { estado: "concluido" });
      }
    });
  });
});

/**
 * NOD-293 (G10 e N9, definido em 2026-10-20): o retorno do lote é a volta das frentes ao dono, não um pedido novo. Passou
 * de 2 min trabalhando, a rede de 2 min não o promove a frente (antes promovia: o lote voltava como outra frente, que
 * abria outro lote). O N9 ("a rede promove frentes que acabam em segundos") é o mesmo furo visto pelo outro lado: a frente
 * termina em segundos, o retorno nasce na hora e é ele que a rede pegava.
 */
describeIntegracao("a rede de 2 min não promove o retorno do lote (NOD-293, G10/N9)", () => {
  const promover = (deps: Parameters<typeof promoverNaRede>[0], turnoId: string, despachadoEm: number) =>
    promoverNaRede(deps, { turnoId, despachadoEm, fezFerramenta: true, harness: "codex-cli", sessaoCli: null, sessaoExecutor: "local", maquinaBifurca: false, modo: "conversa" });

  it("G10: o lote fecha, o retorno fica 2 min trabalhando e a rede não promove nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { loteId, ids } = await m.abrir(dono, TRES.slice(0, 2));
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      for (const id of ids) await m.terminar(id, "feito");
      const [retorno] = await m.retomadasDe(dono);
      expect((await m.repos.frentes.buscarLote(loteId))?.retornoTurnoId).toBe(retorno!.id);
      expect(await m.repos.frentes.ehRetornoDeLote(retorno!.id)).toBe(true);
      expect(await m.repos.frentes.ehRetornoDeLote(dono.id)).toBe(false);

      expect((await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }))?.id).toBe(retorno!.id);
      const r = await promover(m.deps, retorno!.id, Date.now() - REDE_MS);
      expect(r.data.trabalho).toBeNull();
      expect(r.events ?? []).toHaveLength(0);
      expect((await m.repos.turnos.buscar(retorno!.id))?.trabalhoId ?? null).toBeNull();
      expect((await m.repos.trabalhos.abertosDoAgente(m.ada.agenteId)).filter((t) => t.origem === "rede")).toHaveLength(0);
    });
  });

  it("G10 com avisar_a_cada_uma: o primeiro retorno intermediário (fora de retorno_turno_id) também não é promovido", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { loteId, ids } = await m.abrir(dono, TRES.slice(0, 2), true);
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      await m.terminar(ids[0]!, "Login corrigido");
      const [primeiro, ...mais] = await m.retomadasDe(dono);
      expect(mais).toHaveLength(0);
      // O lote segue aberto: o intermediário não é o retorno gravado no lote.
      expect((await m.repos.frentes.buscarLote(loteId))?.retornoTurnoId ?? null).toBeNull();
      expect(await m.repos.frentes.ehRetornoDeLote(primeiro!.id)).toBe(false);

      // A segunda frente ainda está na fila: a máquina a pega antes e, depois, o retorno intermediário.
      const maquina = randomUUID();
      expect((await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() }))?.id).toBe((await m.turnoDa(ids[1]!)).id);
      expect((await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() }))?.id).toBe(primeiro!.id);
      const r = await promover(m.deps, primeiro!.id, Date.now() - REDE_MS);
      expect(r.data.trabalho).toBeNull();
      expect(r.events ?? []).toHaveLength(0);
      expect((await m.repos.turnos.buscar(primeiro!.id))?.trabalhoId ?? null).toBeNull();
      expect((await m.repos.trabalhos.abertosDoAgente(m.ada.agenteId)).filter((t) => t.origem === "rede")).toHaveLength(0);
    });
  });

  it("N9: a frente que termina em menos de 5 s não é promovida, nem o retorno que ela acorda", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { ids } = await m.abrir(dono, TRES.slice(0, 1));
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      const maquina = randomUUID();
      const daFrente = await m.turnoDa(ids[0]!);
      expect((await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() }))?.id).toBe(daFrente.id);
      // A frente já é trabalho: nem com a marca do despacho velha (2 min) a rede a promove.
      expect((await promover(m.deps, daFrente.id, Date.now() - REDE_MS)).data.trabalho).toBeNull();
      // Termina 3 s depois de despachada; o retorno nasce na hora e passa de 2 min trabalhando.
      await m.terminar(ids[0]!, "feito em 3 s");
      const [retorno] = await m.retomadasDe(dono);
      expect((await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() }))?.id).toBe(retorno!.id);
      expect((await promover(m.deps, retorno!.id, Date.now() - REDE_MS)).data.trabalho).toBeNull();
      expect((await m.repos.trabalhos.abertosDoAgente(m.ada.agenteId)).filter((t) => t.origem === "rede")).toHaveLength(0);
    });
  });
});

describeIntegracao("frentes: NOD-282 (G4/G5) — a recusa e a aprovação vencida chegam certas ao dono", () => {
  const recusar = async (m: Awaited<ReturnType<typeof montar>>, id: string, motivoFalha: "nao_autenticado" | "limite_do_plano") => {
    const t = await m.turnoDa(id);
    await m.repos.turnos.assentar(t.id, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha });
    return sincronizarTrabalho(m.deps, id);
  };

  it("sem login na máquina: a frente volta ao dono na hora, com a pergunta de reconexão e o motivo certo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { loteId, ids } = await m.abrir(dono, TRES.slice(0, 2));
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      await recusar(m, ids[0]!, "nao_autenticado");
      const [retorno, ...mais] = await m.retomadasDe(dono);
      expect(mais).toHaveLength(0);
      expect(retorno!.entradaTexto).toContain(PERGUNTA_DA_RECONEXAO);
      const json = JSON.parse(retorno!.entradaTexto.split("\n")[1]!) as Record<string, unknown>[];
      expect(json).toHaveLength(1);
      expect(json[0]).toMatchObject({ titulo: "Login no Safari", estado: "falhou" });
      expect(json[0]!.motivo).not.toBe("a frente falhou");
      expect((await m.repos.frentes.buscarLote(loteId))?.devolvidoEm).toBeNull();
    });
  });

  it("sem cota (recusa de espera): nada volta antes das outras", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { ids } = await m.abrir(dono, TRES.slice(0, 2));
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      await recusar(m, ids[0]!, "limite_do_plano");
      expect(await m.retomadasDe(dono)).toHaveLength(0);
    });
  });

  it("aprovação vencida: a frente fecha falhou com o texto da aprovação, não o da pergunta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { ids } = await m.abrir(dono, TRES.slice(0, 1));
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      const t = await m.turnoDa(ids[0]!);
      const d = (await m.repos.decisoes.criar({ tipo: "aprovacao", agenteId: t.agenteId, conversaId: t.conversaId, turnoId: t.id, prazoDecisaoEm: Date.now() - 1_000, frase: "Posso publicar?" }))!;
      await m.repos.turnos.assentar(t.id, { estado: "concluido" });
      await trx`update decisoes set estado = 'vencida' where id = ${d.id}`;
      await sincronizarTrabalho(m.deps, ids[0]!);
      expect((await m.repos.trabalhos.buscar(ids[0]!))?.estado).toBe("falhou");
      const [retorno] = await m.retomadasDe(dono);
      const json = JSON.parse(retorno!.entradaTexto.split("\n")[1]!) as Record<string, unknown>[];
      expect(json[0]).toMatchObject({ estado: "falhou", motivo: "o pedido de aprovação venceu sem resposta" });
      expect(JSON.stringify(json[0])).not.toContain("pergunta");
    });
  });
});

describeIntegracao("frentes: NOD-282 (G7) — a frente reaberta depois do lote devolvido volta uma vez, só com ela", () => {
  /** A frente única do lote falha pela aprovação vencida (o lote volta ao dono) e a pessoa reabre a aprovação. */
  const vencerEReabrir = async (m: Awaited<ReturnType<typeof montar>>, dono: Turno) => {
    const { loteId, ids } = await m.abrir(dono, TRES.slice(0, 1));
    const id = ids[0]!;
    await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
    const t = await m.turnoDa(id);
    const d = (await m.repos.decisoes.criar({ tipo: "aprovacao", agenteId: t.agenteId, conversaId: t.conversaId, turnoId: t.id, prazoDecisaoEm: Date.now() - 1_000, frase: "Posso publicar?" }))!;
    await m.repos.turnos.assentar(t.id, { estado: "concluido" });
    await m.repos.decisoes.vencerPendentes(Date.now());
    await sincronizarTrabalho(m.deps, id);
    expect((await m.repos.frentes.buscarLote(loteId))?.devolvidoEm).toEqual(expect.any(Number));
    await reabrirDecisao(m.deps, { decisaoId: d.id });
    expect((await m.repos.trabalhos.buscar(id))?.estado).toBe("precisa_de_voce");
    return { loteId, id, decisaoId: d.id };
  };

  it("reaberta e decidida: o dono recebe UM complemento, só com ela; repetir o fecho ou o sync não duplica", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { id, decisaoId } = await vencerEReabrir(m, dono);
      expect(await m.retomadasDe(dono)).toHaveLength(1);

      await m.repos.frentes.gravarResumo(id, { feito: "Publiquei a página" });
      await trx`update decisoes set estado = 'decidida' where id = ${decisaoId}`;
      await sincronizarTrabalho(m.deps, id);
      expect((await m.repos.trabalhos.buscar(id))?.estado).toBe("terminado");
      const [, complemento, ...mais] = await m.retomadasDe(dono);
      expect(mais).toHaveLength(0);
      expect(complemento!.entradaTexto).toContain('A frente "Login no Safari", que tinha ficado pendente, terminou agora.');
      const json = JSON.parse(complemento!.entradaTexto.split("\n")[1]!) as Record<string, unknown>[];
      expect(json).toEqual([expect.objectContaining({ titulo: "Login no Safari", estado: "terminado", feito: "Publiquei a página" })]);
      expect((await m.linhas(m.ada.conversaId, "frentes_terminadas")).map((l) => l.texto)).toEqual(["A frente Login no Safari falhou", "A frente Login no Safari terminou"]);

      expect(await fecharLoteSePronto(m.deps, (await m.repos.trabalhos.buscar(id))!)).toEqual([]);
      await sincronizarTrabalho(m.deps, id);
      expect(await m.retomadasDe(dono)).toHaveLength(2);
    });
  });

  it("reaberta e vencida de novo, com o mesmo resumo: nada volta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { id } = await vencerEReabrir(m, dono);
      await trx`update decisoes set estado = 'vencida' where id in (select id from decisoes where turno_id in (select id from turnos where trabalho_id = ${id}))`;
      await sincronizarTrabalho(m.deps, id);
      expect((await m.repos.trabalhos.buscar(id))?.estado).toBe("falhou");
      expect(await m.retomadasDe(dono)).toHaveLength(1);
    });
  });

  it("lote de colega: o complemento vai a quem pediu, com a linha marcada complementar, sem turno no dono", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const bia = await agenteComConversa(trx, MARLON, { nome: "Bia" });
      const daAda = await m.turnoDaConversa({ texto: "peça à Bia" });
      await m.repos.turnos.assentar(daAda.id, { estado: "concluido" });
      const pedido = await pedirABot(m.deps, { ...contexto(m.ada.agenteId, m.ada.conversaId, daAda.id), agente: "Bia", pedido: "Publique a página" });
      if (!pedido.data.ok) throw new Error(pedido.data.instrucao);
      const triagem = (await m.repos.turnos.buscar(pedido.data.tarefa_id))!;
      const { id, decisaoId } = await vencerEReabrir(m, triagem);
      expect(await m.linhas(m.ada.conversaId, "peer_ask")).toHaveLength(1);

      await m.repos.frentes.gravarResumo(id, { feito: "Publiquei a página" });
      await trx`update decisoes set estado = 'decidida' where id = ${decisaoId}`;
      await sincronizarTrabalho(m.deps, id);
      const respostas = await m.linhas(m.ada.conversaId, "peer_ask");
      expect(respostas).toHaveLength(2);
      expect(respostas[1]!.texto).toContain('Complemento: a frente "Login no Safari", que tinha ficado pendente, terminou agora.');
      expect(respostas[1]!.texto).toContain("Publiquei a página");
      expect(await m.retomadasDe(triagem)).toHaveLength(0);
      const linhas = await m.linhas(bia.conversaId, "pedido_respondido");
      expect(linhas.map((l) => (l.payload as { complementar?: true } | null)?.complementar ?? false)).toEqual([false, true]);
      await sincronizarTrabalho(m.deps, id);
      expect(await m.linhas(m.ada.conversaId, "peer_ask")).toHaveLength(2);
    });
  });
});
