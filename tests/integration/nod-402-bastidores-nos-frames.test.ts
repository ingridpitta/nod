import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { despacharPessoa } from "../../src/adapters/fundo/despachar-outbox.ts";
import type { FrameSse } from "../../src/contracts/frame.ts";
import type { OrigemTurno } from "../../src/contracts/turno.ts";
import { criarMetricas } from "../../src/obs/metricas.ts";
import { criarBarramento } from "../../src/services/barramento.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { CAPACIDADES_HARNESS } from "../../src/contracts/harness.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { listarSuaVez } from "../../src/use-cases/listar-sua-vez.ts";
import { pedirAPessoa } from "../../src/use-cases/pedir-a-pessoa.ts";
import { enviarMensagem, lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa, autoriaAgente } from "../helpers/fabricas.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
type Deps = ReturnType<typeof depsSobreTrx>;

async function fundo(deps: Deps, criado: { conversa: { id: string }; agente: { id: string; modelo: string } }, origem: OrigemTurno, extra: { retomaTurnoId?: string; acordarEm?: number } = {}) {
  const t = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: criado.conversa.id, agenteId: criado.agente.id, origem, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: `[nod] ${origem}`, entradaConfianca: "confiavel", modelo: criado.agente.modelo, ...extra });
  if (!t) throw new Error("turno não criado");
  return t;
}

/**
 * NOD-402 (ADR-130): o turno dos bastidores (a rotina, o colega, a retomada deles) roda em segundo plano. Cada frame dele
 * diz `bastidores: true` — o `turno.iniciado` (dos dois kinds), os frames diretos do plano — e o GET da conversa também,
 * para a web deixá-lo fora do chat. O turno da pessoa nunca leva a marca.
 */
describeIntegracao("NOD-402: a marca dos bastidores nos frames e no GET da conversa", () => {
  it("turno_criado da rotina e da retomada dela sai com bastidores; o da fala da pessoa, sem", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const rotina = await fundo(deps, criado, "rotina");
      const retomada = await fundo(deps, criado, "retomada", { retomaTurnoId: rotina.id });
      // A frente que a rotina abre (um trabalho) mantém o ao vivo na tela da task: o turno_criado dela sai sem a marca.
      const frente = await fundo(deps, criado, "rotina");
      const { trabalho } = await criarTrabalho(deps, { agenteId: criado.agente.id, conversaId: criado.conversa.id, titulo: "frente", origem: "rotina", pessoaEsperando: false });
      await trx`update turnos set trabalho_id = ${trabalho.id}, bastidores = true where id = ${frente.id}`;
      const fala = (await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO })).data;
      const autoria = autoriaAgente(criado.agente.id, MARLON.pessoaId);
      await deps.repos.events.gravarComOutbox([rotina, retomada, frente].map((t) => ({ kind: "turno_criado" as const, autoria, pessoaDestinoId: MARLON.pessoaId, conversaId: criado.conversa.id, turnoId: t.id, dados: { turnoId: t.id, origem: t.origem } })));

      const barramento = criarBarramento();
      const frames: FrameSse[] = [];
      barramento.inscrever(MARLON.pessoaId, (f) => frames.push(f));
      await despacharPessoa(trx, MARLON, barramento, { metricas: criarMetricas(), agora: () => Date.now() });
      const criados = new Map(frames.filter((f) => f.dados.kind === "turno_criado").map((f) => [f.dados.turnoId, f.dados.bastidores]));
      expect(criados.get(rotina.id)).toBe(true);
      expect(criados.get(retomada.id)).toBe(true);
      expect(criados.has(frente.id)).toBe(true);
      expect(criados.get(frente.id)).toBeUndefined();
      // A fala da pessoa (o enviarMensagem grava o próprio turno_criado) segue sem a marca.
      expect(criados.has(fala.turno.id)).toBe(true);
      expect(criados.get(fala.turno.id)).toBeUndefined();
      // Revisão 9 do #591: todo turno_criado leva a hora em que o turno nasceu (relógio do banco), de onde a web trava a ordem.
      const nasceu = new Map(frames.filter((f) => f.dados.kind === "turno_criado").map((f) => [f.dados.turnoId, f.dados.criadoEm]));
      for (const t of [rotina, retomada, fala.turno]) expect(nasceu.get(t.id)).toBe((await deps.repos.turnos.buscar(t.id))?.criadoEm);
    });
  });

  it("o plano e o turno_despachado da rotina levam bastidores; o GET da conversa também", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const rotina = await fundo(deps, criado, "rotina");
      const plano = (await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO })).data.plano;
      expect(plano?.turnoId).toBe(rotina.id);
      expect(plano?.bastidores).toBe(true);

      const fala = (await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO })).data;
      const emCurso = (await lerConversa(deps, { conversaId: criado.conversa.id })).data.turnosEmCurso;
      expect(emCurso.find((t) => t.id === rotina.id)?.bastidores).toBe(true);
      expect(emCurso.find((t) => t.id === fala.turno.id)?.bastidores).toBeUndefined();
      // A mensagem gravada pelo turno dos bastidores chega marcada no GET; a da pessoa, sem.
      const autoria = autoriaAgente(criado.agente.id, MARLON.pessoaId);
      const daRotina = await deps.repos.mensagens.criar({ conversaId: criado.conversa.id, turnoId: rotina.id, autoria, kind: "texto", texto: "Achei 2 e-mails.", payload: null, confianca: "confiavel" });
      const lidas = (await lerConversa(deps, { conversaId: criado.conversa.id })).data.mensagens;
      expect(lidas.find((m) => m.id === daRotina?.id)?.bastidores).toBe(true);
      expect(lidas.filter((m) => m.id !== daRotina?.id).every((m) => m.bastidores === undefined)).toBe(true);
      // A hora em que o turno nasceu (relógio do banco, o mesmo do `criadoEm` das mensagens) vai junto: a web sabe se um
      // turno da conversa já existia quando a mensagem dos bastidores foi gravada (emOrdemDoChat), mesmo ainda na fila.
      const criadoEm = (await deps.repos.turnos.buscar(rotina.id))?.criadoEm;
      expect(criadoEm).toEqual(expect.any(Number));
      expect(lidas.find((m) => m.id === daRotina?.id)?.turnoDesde).toBe(criadoEm);
      // A volta marcada conta da hora em que acorda (revisão 11): a mensagem que outro turno gravou antes disso não é "durante" ela.
      const volta = await fundo(deps, criado, "conversa", { acordarEm: Date.now() + 3_600_000 });
      const daVolta = await deps.repos.mensagens.criar({ conversaId: criado.conversa.id, turnoId: volta.id, autoria, kind: "texto", texto: "Voltei.", payload: null, confianca: "confiavel" });
      const vb = await deps.repos.turnos.buscar(volta.id);
      expect(vb!.acordarEm!).toBeGreaterThan(vb!.criadoEm);
      const lidaVolta = (await lerConversa(deps, { conversaId: criado.conversa.id })).data;
      expect(lidaVolta.mensagens.find((m) => m.id === daVolta?.id)?.turnoDesde).toBe(vb!.acordarEm);
      // Revisão 14: o turno que ficou mais de 5 min na fila (máquina fora) segura só do despacho; o que esperou pouco, da criação.
      await trx`update turnos set despachado_em = criado_em + interval '10 minutes' where id = ${rotina.id}`;
      const parado = (await lerConversa(deps, { conversaId: criado.conversa.id })).data.mensagens.find((m) => m.id === daRotina?.id);
      expect(parado?.turnoDesde).toBe(criadoEm! + 10 * 60_000);
      await trx`update turnos set despachado_em = criado_em + interval '1 minute' where id = ${rotina.id}`;
      expect((await lerConversa(deps, { conversaId: criado.conversa.id })).data.mensagens.find((m) => m.id === daRotina?.id)?.turnoDesde).toBe(criadoEm);
      await trx`update turnos set despachado_em = null where id = ${rotina.id}`;
      const daFala = (await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO })).data.plano;
      expect(daFala?.turnoId).toBe(fala.turno.id);
      expect(daFala?.bastidores).toBeUndefined();
    });
  });

  it("emitirPlanoTurno: o turno_despachado (o turno.iniciado 'rodando') da rotina leva bastidores; o da conversa, não", async () => {
    await withRollback(MARLON, async (trx) => {
      const base = await agenteComConversa(trx, MARLON, { nome: "Gil" });
      await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
      const agora = () => Date.now();
      const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
      const pronto: Inventario = { estado: "pronto", versao: "teste", em: Date.now() };
      const despachado = async (origem: OrigemTurno) => {
        const t = await base.repos.turnos.enfileirar({ executor: "local", conversaId: base.conversaId, agenteId: base.agenteId, origem, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "olha a caixa", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" });
        const maquina = randomUUID();
        expect((await base.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() }))?.id).toBe(t?.id);
        const r = await emitirPlanoTurno(deps, { turnoId: t!.id, machineId: maquina, executor: "local", harnesses: { "claude-cli": pronto }, capacidadesDaMaquina: CAPACIDADES_HARNESS });
        return { plano: r.data, dados: (r.events ?? []).find((e) => e.kind === "turno_despachado")?.dados };
      };
      const daRotina = await despachado("rotina");
      expect(daRotina.plano.bastidores).toBe(true);
      expect(daRotina.dados?.bastidores).toBe(true);
      const daConversa = await despachado("conversa");
      expect(daConversa.plano.bastidores).toBeUndefined();
      expect(daConversa.dados).toBeDefined();
      expect(daConversa.dados?.bastidores).toBeUndefined();
      expect(typeof daConversa.dados?.criadoEm).toBe("number");
    });
  });

  it("Sua vez: o pedido aberto da rotina leva bastidores; o do turno da pessoa, não (revisão 6 do #591)", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const rotina = await fundo(deps, criado, "rotina");
      const fala = (await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO })).data;
      const base = { conversaId: criado.conversa.id, agenteId: criado.agente.id, tipo: "falta_de_dado" as const, dado: "planilha" };
      await pedirAPessoa(deps, { ...base, turnoId: rotina.id, texto: "falta a planilha (rotina)" });
      await pedirAPessoa(deps, { ...base, turnoId: fala.turno.id, texto: "falta a planilha (pessoa)" });
      const { data } = await listarSuaVez(deps, { marcarVista: false });
      const marca = new Map(data.itens.map((i) => [i.decisao.turnoId, i.bastidores]));
      expect(marca.get(rotina.id)).toBe(true);
      expect(marca.has(fala.turno.id)).toBe(true);
      expect(marca.get(fala.turno.id)).toBeUndefined();
    });
  });
});
