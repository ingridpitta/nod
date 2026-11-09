import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Escopo } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { criarSala } from "../../src/use-cases/criar-sala.ts";
import { fixarAgente, ocultarAgente } from "../../src/use-cases/fixar-ocultar-agente.ts";
import { gerirAgente } from "../../src/use-cases/gerir-agente.ts";
import { listarFrota } from "../../src/use-cases/listar-frota.ts";
import { desfazerLeitura, listarNaoLidos, marcarConversaLida, marcarConversaNaoLida, marcarTudoLido } from "../../src/use-cases/nao-lidos.ts";
import { autoriaPessoa as autoriaDaRegra } from "../../src/use-cases/apoio-l7.ts";
import { autoriaPessoa } from "../../src/use-cases/autoria-evento.ts";
import { autoriaDoAgente } from "../../src/use-cases/registrar-negacao.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { ANA, MARLON, depsSobreTrx, esperarErro } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** Fala do bot na conversa (texto), como o assentar do turno grava. */
async function falaDoBot(d: Deps, escopo: Escopo, conversaId: string, agenteId: string, texto: string) {
  const m = await d.repos.mensagens.criar({ conversaId, autoria: autoriaDoAgente(escopo, agenteId), kind: "texto", texto, confianca: "confiavel" });
  if (!m) throw new Error("mensagem não criada");
  return m;
}

/** definido em 2026-09-29 (0039): "não lido" é o "lido até" por pessoa e conversa. */
describeIntegracao("não lidos: o que chegou depois do lido até", () => {
  it("conta a fala do bot, não a da pessoa nem o aviso do sistema; ler zera e a próxima fala volta a contar", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Leitor" });
      const c = b.conversa.id;
      await d.repos.mensagens.criar({ conversaId: c, autoria: autoriaPessoa(MARLON), kind: "texto", texto: "revisa o PR", confianca: "confiavel" });
      await d.repos.mensagens.criar({ conversaId: c, autoria: autoriaDoAgente(MARLON, b.agente.id), kind: "sistema", assunto: "memoria.anotada", texto: "Lembrei disso.", confianca: "confiavel" });
      const primeira = await falaDoBot(d, MARLON, c, b.agente.id, "Começando.");
      const segunda = await falaDoBot(d, MARLON, c, b.agente.id, "Pronto: o PR pode entrar.");

      const antes = (await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === c);
      expect(antes).toMatchObject({ tipo: "propria", agenteId: b.agente.id, total: 2, primeiraId: primeira.id, daRotina: false });
      expect(antes?.mensagens.map((m) => m.id)).toEqual([primeira.id, segunda.id]);
      expect((await listarFrota(d, {})).data.agentes.find((a) => a.id === b.agente.id)?.naoLido).toBe(true);

      await marcarConversaLida(d, { conversaId: c });
      // O lido_ate sai do banco com os microssegundos: a última fala não fica contando como nova.
      expect((await listarNaoLidos(d, {})).data.conversas.some((x) => x.conversaId === c)).toBe(false);
      expect((await listarFrota(d, {})).data.agentes.find((a) => a.id === b.agente.id)?.naoLido).toBe(false);

      const terceira = await falaDoBot(d, MARLON, c, b.agente.id, "Mais uma coisa.");
      expect((await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === c)).toMatchObject({ total: 1, primeiraId: terceira.id });
    });
  });

  it("NOD-114: conta a rotina que não rodou e leva a origem, a task e o fim do turno de cada mensagem; o aviso não é o fim", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Rotineiro" });
      const c = b.conversa.id;
      const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: c, agenteId: b.agente.id, origem: "rotina", prazoEm: d.agora() + 600_000, profundidade: 0, entradaTexto: "veja o Linear", entradaConfianca: "confiavel", modelo: "m" });
      const autoria = autoriaDoAgente(MARLON, b.agente.id);
      const meio = await d.repos.mensagens.criar({ conversaId: c, turnoId: turno!.id, autoria, kind: "texto", texto: "Olhando.", confianca: "confiavel" });
      const fim = await d.repos.mensagens.criar({ conversaId: c, turnoId: turno!.id, autoria, kind: "texto", texto: "Feito.", confianca: "confiavel" });
      // O aviso do bot vem depois da fala final e mesmo assim não é o fim do turno.
      const aviso = await d.repos.mensagens.criar({ conversaId: c, turnoId: turno!.id, autoria, kind: "texto", payload: { kind: "aviso_pessoa" }, texto: "A NOD-12 travou.", confianca: "confiavel" });
      // Como disparar-rotina.ts grava: autoria da pessoa pela regra que decidiu. Falhou conta; o Parar dela (interrompida) não.
      const linhaDaRotina = (desfecho: "falhou" | "interrompida") => d.repos.mensagens.criar({ conversaId: c, autoria: autoriaDaRegra(MARLON.pessoaId, "regra:varredor-expiracao"), kind: "rotina_execucao", texto: `A rotina ${desfecho}.`, payload: { kind: "rotina_execucao", rotinaId: c, instanteAgendado: 0, desfecho }, confianca: "confiavel" });
      const parada = await linhaDaRotina("interrompida");
      expect(parada).not.toBeNull();
      const falhou = await linhaDaRotina("falhou");
      const outroAviso = await d.repos.mensagens.criar({ conversaId: c, autoria, kind: "sistema", assunto: "memoria.anotada", texto: "Lembrei.", confianca: "confiavel" });
      expect(outroAviso).not.toBeNull();

      const vivo = (await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === c);
      expect(vivo?.total).toBe(4);
      // O turno ainda roda: nada é fim.
      expect(vivo?.mensagens.some((m) => m.fimDoTurno)).toBe(false);

      await tx`update turnos set estado = 'concluido' where id = ${turno!.id}`;
      const n = (await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === c);
      expect(n).toMatchObject({ total: 4, primeiraId: meio!.id, daRotina: true });
      const porId = new Map((n?.mensagens ?? []).map((m) => [m.id, m]));
      expect([...porId.keys()]).toEqual([fim!.id, aviso!.id, falhou!.id]);
      expect(porId.get(fim!.id)).toMatchObject({ origemTurno: "rotina", trabalhoId: null, fimDoTurno: true });
      expect(porId.get(aviso!.id)).toMatchObject({ origemTurno: "rotina", fimDoTurno: false, payload: { kind: "aviso_pessoa" } });
      expect(porId.get(falhou!.id)).toMatchObject({ origemTurno: null, fimDoTurno: false });
    });
  });

  it("NOD-114 (revisão): a fala da retomada leva a raiz da cadeia — a conversa que a pessoa aprovou e deixou rodando", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Retomador" });
      const c = b.conversa.id;
      const base = { executor: "catcher", conversaId: c, agenteId: b.agente.id, prazoEm: d.agora() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" } as const;
      const raiz = await d.repos.turnos.enfileirar({ ...base, origem: "conversa" });
      const ret = await d.repos.turnos.enfileirar({ ...base, origem: "retomada", retomaTurnoId: raiz!.id });
      const fala = await d.repos.mensagens.criar({ conversaId: c, turnoId: ret!.id, autoria: autoriaDoAgente(MARLON, b.agente.id), kind: "texto", texto: "Enviado.", confianca: "confiavel" });
      await tx`update turnos set estado = 'concluido' where id = ${ret!.id}`;
      const m = (await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === c)?.mensagens.find((x) => x.id === fala!.id);
      expect(m).toMatchObject({ origemTurno: "retomada", fimDoTurno: true, raiz: { turnoId: raiz!.id, origem: "conversa" } });
    });
  });

  it("NOD-114 (revisão 2): o aviso que ficou antes das três últimas vem em avisos — a fala comum, não", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Avisador" });
      const c = b.conversa.id;
      const autoria = autoriaDoAgente(MARLON, b.agente.id);
      await falaDoBot(d, MARLON, c, b.agente.id, "zero");
      const aviso = await d.repos.mensagens.criar({ conversaId: c, autoria, kind: "texto", payload: { kind: "aviso_pessoa" }, texto: "A NOD-12 travou.", confianca: "confiavel" });
      const falhou = await d.repos.mensagens.criar({ conversaId: c, autoria: autoriaDaRegra(MARLON.pessoaId, "regra:varredor-expiracao"), kind: "rotina_execucao", texto: "A rotina falhou.", payload: { kind: "rotina_execucao", rotinaId: c, instanteAgendado: 0, desfecho: "falhou" }, confianca: "confiavel" });
      await falaDoBot(d, MARLON, c, b.agente.id, "meio");
      for (const t of ["um", "dois", "três"]) await falaDoBot(d, MARLON, c, b.agente.id, t);
      const n = (await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === c);
      expect(n?.total).toBe(7);
      expect(n?.mensagens.map((m) => m.texto)).toEqual(["um", "dois", "três"]);
      expect(n?.avisos?.map((m) => m.id)).toEqual([aviso!.id, falhou!.id]);
    });
  });

  it("mostra a primeira não lida e só as três últimas; o total conta todas", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Falante" });
      const falas = [];
      for (const t of ["um", "dois", "três", "quatro", "cinco"]) falas.push(await falaDoBot(d, MARLON, b.conversa.id, b.agente.id, t));
      const n = (await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === b.conversa.id);
      expect(n?.total).toBe(5);
      expect(n?.primeiraId).toBe(falas[0]!.id);
      expect(n?.mensagens.map((m) => m.texto)).toEqual(["três", "quatro", "cinco"]);
    });
  });

  it("marcar como não lido devolve a última fala do bot; sem fala não há o que marcar; o menu do bot usa o mesmo lido até", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Quieto" });
      expect((await marcarConversaNaoLida(d, { conversaId: b.conversa.id })).data.marcada).toBe(false);

      await falaDoBot(d, MARLON, b.conversa.id, b.agente.id, "antiga");
      const ultima = await falaDoBot(d, MARLON, b.conversa.id, b.agente.id, "última");
      await marcarConversaLida(d, { conversaId: b.conversa.id });
      expect((await marcarConversaNaoLida(d, { conversaId: b.conversa.id })).data.marcada).toBe(true);
      expect((await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === b.conversa.id)).toMatchObject({ total: 1, primeiraId: ultima.id });

      await gerirAgente(d, { agenteId: b.agente.id, acao: "organizar", naoLido: false });
      expect((await listarNaoLidos(d, {})).data.conversas.some((x) => x.conversaId === b.conversa.id)).toBe(false);
      await gerirAgente(d, { agenteId: b.agente.id, acao: "organizar", naoLido: true });
      expect((await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === b.conversa.id)?.primeiraId).toBe(ultima.id);
    });
  });

  it("bot oculto sai da lista (não está na barra), mas a frota de gestão ainda diz que ele tem novidade", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Escondido" });
      await falaDoBot(d, MARLON, b.conversa.id, b.agente.id, "oi");
      await fixarAgente(d, { agenteId: b.agente.id, fixado: false });
      await ocultarAgente(d, { agenteId: b.agente.id, oculto: true });
      expect((await listarNaoLidos(d, {})).data.conversas.some((x) => x.conversaId === b.conversa.id)).toBe(false);
      expect((await listarFrota(d, { gerenciar: true })).data.agentes.find((a) => a.id === b.agente.id)?.naoLido).toBe(true);
    });
  });

  it("a sala entra com a fala de qualquer bot dela; marcar tudo lê bots e salas de uma vez", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: x } = await criarAgente(d, { dono: "pessoa", nome: "Bot X" });
      const { data: y } = await criarAgente(d, { dono: "pessoa", nome: "Bot Y" });
      const { data: s } = await criarSala(d, { nome: "revisão", agenteIds: [x.agente.id, y.agente.id] });
      await marcarConversaLida(d, { conversaId: s.conversa.id });
      await falaDoBot(d, MARLON, s.conversa.id, y.agente.id, "Subi a revisão.");
      await falaDoBot(d, MARLON, x.conversa.id, x.agente.id, "Terminei.");

      const lista = (await listarNaoLidos(d, {})).data.conversas;
      expect(lista.find((c) => c.conversaId === s.conversa.id)).toMatchObject({ tipo: "sala", salaId: s.sala.id, total: 1 });
      // A mais recente em cima.
      expect(lista.findIndex((c) => c.conversaId === x.conversa.id)).toBeLessThan(lista.findIndex((c) => c.conversaId === s.conversa.id));

      await marcarTudoLido(d, {});
      expect((await listarNaoLidos(d, {})).data.conversas.filter((c) => [s.conversa.id, x.conversa.id].includes(c.conversaId))).toEqual([]);
    });
  });

  it("o lido é de cada pessoa: a Ana não vê as conversas do Marlon nem marca por ele", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Privado" });
      await falaDoBot(d, MARLON, b.conversa.id, b.agente.id, "só para o Marlon");

      await vincularEscopo(tx, ANA);
      const a = depsSobreTrx(tx, ANA);
      expect((await listarNaoLidos(a, {})).data.conversas.some((x) => x.conversaId === b.conversa.id)).toBe(false);
      await esperarErro(() => marcarConversaLida(a, { conversaId: b.conversa.id }), "nao_encontrado");

      await vincularEscopo(tx, MARLON);
      expect((await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === b.conversa.id)?.total).toBe(1);
    });
  });

  it("NOD-449: fala entre bots não entra (pedido de colega e o turno dele); a tarefa do quadro e o aviso à pessoa entram; frota igual", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Recebedor" });
      const c = b.conversa.id;
      const autoria = autoriaDoAgente(MARLON, b.agente.id);
      const turnoDe = async (origem: "peer" | "delegacao" | "conversa") => {
        const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: c, agenteId: b.agente.id, origem, prazoEm: d.agora() + 600_000, profundidade: origem === "conversa" ? 0 : 1, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m", ...(origem === "delegacao" ? { sobProcuracaoDe: MARLON.pessoaId } : {}) });
        if (!t) throw new Error("turno");
        return t.id;
      };
      await marcarConversaLida(d, { conversaId: c });
      // O pedir_a_bot: o turno de triagem (delegação) e, nele, o peer_pedido; o que o bot responde nesse turno é entre bots.
      const triagem = await turnoDe("delegacao");
      await d.repos.mensagens.criar({ conversaId: c, turnoId: triagem, autoria, kind: "texto", texto: "revisa o PR 1", payload: { kind: "peer_pedido", conversaOrigemId: c, turnoOrigemId: await turnoDe("conversa"), nome: "Taga" }, confianca: "confiavel" });
      await d.repos.mensagens.criar({ conversaId: c, turnoId: triagem, autoria, kind: "texto", texto: "Revisei, Taga.", confianca: "confiavel" });
      await d.repos.mensagens.criar({ conversaId: c, turnoId: await turnoDe("peer"), autoria, kind: "texto", texto: "Combinado.", confianca: "confiavel" });
      expect((await listarNaoLidos(d, {})).data.conversas.some((x) => x.conversaId === c)).toBe(false);
      expect((await listarFrota(d, {})).data.agentes.find((a) => a.id === b.agente.id)?.naoLido).toBe(false);

      // O aviso dirigido à pessoa, mesmo num turno de colega, conta.
      const aviso = await d.repos.mensagens.criar({ conversaId: c, turnoId: await turnoDe("peer"), autoria, kind: "texto", texto: "Marlon, a NOD-1 travou.", payload: { kind: "aviso_pessoa" }, confianca: "confiavel" });
      expect((await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === c)).toMatchObject({ total: 1, primeiraId: aviso!.id });
      expect((await listarFrota(d, {})).data.agentes.find((a) => a.id === b.agente.id)?.naoLido).toBe(true);

      // A tarefa que a pessoa moveu no quadro (delegação sob a procuração dela, sem pedido de colega) é trabalho dela: conta.
      await marcarConversaLida(d, { conversaId: c });
      const doQuadro = await d.repos.mensagens.criar({ conversaId: c, turnoId: await turnoDe("delegacao"), autoria, kind: "texto", texto: "Terminei a T1.", confianca: "confiavel" });
      expect((await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === c)).toMatchObject({ total: 1, primeiraId: doQuadro!.id });

      // Revisão 2: a retomada da triagem (cartão, reenvio) e a frente aberta para o trabalho de um colega, e a retomada
      // dela, são entre bots; a retomada da tarefa do quadro continua contando.
      await marcarConversaLida(d, { conversaId: c });
      const retomar = async (de: string) => (await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: c, agenteId: b.agente.id, origem: "retomada", retomaTurnoId: de, prazoEm: d.agora() + 600_000, profundidade: 1, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" }))!.id;
      const retomadaDaTriagem = await retomar(await retomar(triagem));
      await d.repos.mensagens.criar({ conversaId: c, turnoId: retomadaDaTriagem, autoria, kind: "texto", texto: "Aprovado, sigo, Taga.", confianca: "confiavel" });
      const frente = (await d.repos.trabalhos.criar({ agenteId: b.agente.id, conversaId: c, titulo: "PR do Taga", origem: "colega", pedidoPorAgenteId: b.agente.id }))!;
      const turnoDaFrente = (await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: c, agenteId: b.agente.id, origem: "delegacao", trabalhoId: frente.id, prazoEm: d.agora() + 600_000, profundidade: 1, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" }))!.id;
      await d.repos.mensagens.criar({ conversaId: c, turnoId: turnoDaFrente, autoria, kind: "texto", texto: "Frente: abri o PR.", confianca: "confiavel" });
      await d.repos.mensagens.criar({ conversaId: c, turnoId: await retomar(turnoDaFrente), autoria, kind: "texto", texto: "Frente: CI verde.", confianca: "confiavel" });
      expect((await listarNaoLidos(d, {})).data.conversas.some((x) => x.conversaId === c)).toBe(false);
      expect((await listarFrota(d, {})).data.agentes.find((a) => a.id === b.agente.id)?.naoLido).toBe(false);
      const turnoDoQuadro = (await d.repos.mensagens.buscar(doQuadro!.id))!.turnoId!;
      const retomadaDoQuadro = await d.repos.mensagens.criar({ conversaId: c, turnoId: await retomar(turnoDoQuadro), autoria, kind: "texto", texto: "T1 aprovada, terminei.", confianca: "confiavel" });
      expect((await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === c)).toMatchObject({ total: 1, primeiraId: retomadaDoQuadro!.id });
    });
  });

  it("NOD-449: Desfazer volta a contar; leitura posterior não reabre; repetir não muda; a Ana não desfaz pelo Marlon", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Desfazível" });
      const c = b.conversa.id;
      await falaDoBot(d, MARLON, c, b.agente.id, "Uma.");
      const { data: r1 } = await marcarConversaLida(d, { conversaId: c });
      expect(r1.leituras).toHaveLength(1);
      expect(r1.leituras[0]).toMatchObject({ conversaId: c, antes: null });
      expect((await listarNaoLidos(d, {})).data.conversas.some((x) => x.conversaId === c)).toBe(false);

      // A Ana não desfaz pelo Marlon.
      await vincularEscopo(tx, ANA);
      await esperarErro(() => desfazerLeitura(depsSobreTrx(tx, ANA), { leituras: r1.leituras }), "nao_encontrado");
      // Nem pelo repo direto: a leitura é do Marlon (owner_id), não da Ana. QA do PR #616 (M12).
      expect(await depsSobreTrx(tx, ANA).repos.leituras.restaurarLeituras(r1.leituras)).toBe(0);
      await vincularEscopo(tx, MARLON);

      expect((await desfazerLeitura(d, { leituras: r1.leituras })).data.restauradas).toBe(1);
      expect((await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === c)?.total).toBe(1);
      expect((await desfazerLeitura(d, { leituras: r1.leituras })).data.restauradas).toBe(0);

      // Marcou de novo e depois leu mais: o Desfazer da primeira marcação não reabre.
      const { data: r2 } = await marcarConversaLida(d, { conversaId: c });
      await falaDoBot(d, MARLON, c, b.agente.id, "Outra.");
      await marcarConversaLida(d, { conversaId: c });
      expect((await desfazerLeitura(d, { leituras: r2.leituras })).data.restauradas).toBe(0);
      expect((await listarNaoLidos(d, {})).data.conversas.some((x) => x.conversaId === c)).toBe(false);

      // Com leitura anterior (antes não nulo): volta exatamente a ela, e só a fala nova conta.
      const nova = await falaDoBot(d, MARLON, c, b.agente.id, "Terceira.");
      const { data: r3 } = await marcarConversaLida(d, { conversaId: c });
      expect(r3.leituras[0]?.antes).not.toBeNull();
      expect((await desfazerLeitura(d, { leituras: r3.leituras })).data.restauradas).toBe(1);
      expect((await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === c)).toMatchObject({ total: 1, primeiraId: nova.id });

      // O lote cheio da mesma conversa (o que o fuzz manda): uma busca, um UPDATE, vale a primeira leitura.
      const { data: r4 } = await marcarConversaLida(d, { conversaId: c });
      const t0 = Date.now();
      expect((await desfazerLeitura(d, { leituras: Array.from({ length: 5000 }, () => r4.leituras[0]) })).data.restauradas).toBe(1);
      expect(Date.now() - t0).toBeLessThan(2000);

      await esperarErro(() => desfazerLeitura(d, { leituras: "x" }), "entrada_invalida");
    });
  });
});
