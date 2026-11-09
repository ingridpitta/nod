import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IdHarness } from "../../src/contracts/harness.ts";
import { ENTRADA_DA_VOLTA_DA_COTA, MARCA_DA_FALA_NA_FRENTE } from "../../src/domain/cota-da-ia.ts";
import { FALA_DEPOIS_DO_FIM } from "../../src/domain/fala-na-frente.ts";
import { molduraFalaNaFrente } from "../../src/domain/mensagem-no-meio.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { autoriaAgente } from "../../src/use-cases/autoria-evento.ts";
import { absorverNoTrabalho, mensagemParaTrabalho } from "../../src/use-cases/coordenar-trabalhos.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { abrirTask, mandarParaTask } from "../../src/use-cases/frentes.ts";
import { relatarEspera } from "../../src/use-cases/esperar-comando.ts";
import { aposQuedaDaMaquina } from "../../src/use-cases/interromper-por-maquina.ts";
import { detalharTrabalho, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-376: a pessoa escreve na tela de uma frente. A fala entra com a moldura "responda primeiro" — absorvida no turno
 * vivo ou reabrindo a frente parada/terminada —, o recado do bot (mandar_para_frente) entra cru, e o detalhe da task diz
 * onde a fala está ("na fila" → "entregue" → some quando o bot responde).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
const harnesses: Partial<Record<IdHarness, typeof pronto>> = { "claude-cli": pronto };

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const agora = () => Date.now();
  const base = await agenteComConversa(trx, MARLON, { nome: "Faustino" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const conversa = await base.repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "implemente a NOD-370", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: null });
  const ctx = { turnoId: conversa!.id, agenteId: base.agenteId, conversaId: base.conversaId };
  const aberta = await abrirTask(deps, { ...ctx, titulo: "Implementar NOD-370", pedido: "Implemente e lance a NOD-370." });
  if (!aberta.data.ok) throw new Error("abrir");
  const trabalhoId = aberta.data.trabalho_id;
  const [daFrente] = await base.repos.turnos.doTrabalho(trabalhoId);
  const detalhe = async () => (await detalharTrabalho(deps, { trabalhoId })).data;
  const plano = async (turnoId: string) => (await emitirPlanoTurno(deps, { turnoId, machineId: randomUUID(), executor: "local", harnesses })).data;
  const falaDoBot = (turnoId: string, texto: string) => base.repos.mensagens.criar({ conversaId: base.conversaId, turnoId, autoria: autoriaAgente({ agenteId: base.agenteId, contaDeExecucao: MARLON.pessoaId, executor: "catcher" }), kind: "texto", texto, confianca: "confiavel" });
  return { ...base, deps, ctx, conversaTurnoId: conversa!.id, trabalhoId, daFrente: daFrente!, detalhe, plano, falaDoBot };
}

describeIntegracao("NOD-376: conversar dentro de uma frente", () => {
  it("frente rodando: a fala da pessoa é absorvida com a moldura, o recado do bot sem; o chip vai de na_fila a entregue e some com a resposta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      expect((await m.repos.turnos.buscar(m.daFrente.id))?.estado).toBe("despachando");

      const fala = await mensagemParaTrabalho(m.deps, { trabalhoId: m.trabalhoId, texto: "Oi" });
      const turnoDaFala = await m.repos.turnos.buscar(fala.data.mensagemTurnoId);
      expect(turnoDaFala).toMatchObject({ estado: "pendente", trabalhoId: m.trabalhoId, entradaTexto: molduraFalaNaFrente("Oi") });
      const msgDaFala = turnoDaFala!.mensagemOrigemId!;
      // A mensagem que a tela mostra é a fala crua, e o chip diz que ela espera o próximo passo.
      const d1 = await m.detalhe();
      expect(d1.mensagens.find((x) => x.id === msgDaFala)?.texto).toBe("Oi");
      expect(d1.falasNaFila).toEqual([{ mensagemId: msgDaFala, situacao: "na_fila" }]);

      // O recado que o bot repassa da conversa entra cru (critério 8).
      expect((await mandarParaTask(m.deps, { ...m.ctx, trabalho_id: m.trabalhoId, texto: "Use o PR aberto" })).data).toMatchObject({ ok: true });

      const absorvido = await absorverNoTrabalho(m.deps, { turnoId: m.daFrente.id });
      expect(absorvido.data.textos).toEqual([molduraFalaNaFrente("Oi"), "[nod] Recado da conversa com a pessoa, repassado por você: Use o PR aberto"]);
      expect(absorvido.data.textos[0]).toContain("Responda a ela primeiro");
      expect(await m.repos.turnos.buscar(turnoDaFala!.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: m.daFrente.id });
      expect((await m.detalhe()).falasNaFila).toEqual([{ mensagemId: msgDaFala, situacao: "entregue" }]);

      // A resposta do bot, no turno vivo e depois da fala, tira o chip.
      await m.falaDoBot(m.daFrente.id, "Oi! Estou no CI do PR; sigo depois.");
      expect((await m.detalhe()).falasNaFila).toBeUndefined();

      // Critério 4: a fala e a resposta ficam na frente — a leitura da conversa as marca com o trabalho (a web as tira do chat).
      const lida = await lerConversa(m.deps, { conversaId: m.conversaId });
      expect(lida.data.mensagens.find((x) => x.id === msgDaFala)).toMatchObject({ trabalhoId: m.trabalhoId });
      expect(lida.data.mensagens.find((x) => x.texto.startsWith("Oi! Estou no CI"))).toMatchObject({ trabalhoId: m.trabalhoId });
    });
  });

  it("o turno vivo que acaba sem responder não deixa o chip preso em entregue", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await mensagemParaTrabalho(m.deps, { trabalhoId: m.trabalhoId, texto: "Oi" });
      await absorverNoTrabalho(m.deps, { turnoId: m.daFrente.id });
      expect((await m.detalhe()).falasNaFila?.[0]?.situacao).toBe("entregue");
      await m.repos.turnos.interromper(m.daFrente.id, "parado_pela_pessoa");
      expect((await m.detalhe()).falasNaFila).toBeUndefined();
    });
  });

  it("o comando / segue cru; um caminho que começa com barra é fala e ganha a moldura", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const entrada = async (texto: string) => (await m.repos.turnos.buscar((await mensagemParaTrabalho(m.deps, { trabalhoId: m.trabalhoId, texto })).data.mensagemTurnoId))?.entradaTexto;
      expect(await entrada("/review 420")).toBe("/review 420");
      expect(await entrada("/Users/x/a.txt está errado?")).toBe(molduraFalaNaFrente("/Users/x/a.txt está errado?"));
    });
  });

  it("frente esperando a CI (esperar_comando): a fala manda continuar, é respondida, e o fim do comando ainda acorda a frente", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const maquina = randomUUID();
      const espera = await m.repos.esperas.criar({ agenteId: m.agenteId, conversaId: m.conversaId, trabalhoId: m.trabalhoId, turnoId: m.daFrente.id, maquinaId: maquina, pasta: null, comando: "gh pr checks 539 --watch", motivo: "a CI do #539" });
      await m.repos.turnos.assentar(m.daFrente.id, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, m.trabalhoId);
      expect((await m.repos.trabalhos.buscar(m.trabalhoId))?.estado).toBe("rodando");

      const fala = await mensagemParaTrabalho(m.deps, { trabalhoId: m.trabalhoId, texto: "Como está a CI?" });
      const turno = (await m.repos.turnos.buscar(fala.data.mensagemTurnoId))!;
      expect(turno).toMatchObject({ estado: "pendente", entradaTexto: molduraFalaNaFrente("Como está a CI?") });
      expect(turno.decididoPor).not.toBe(FALA_DEPOIS_DO_FIM);
      expect(turno.entradaTexto).toContain("continue o trabalho de onde parou");
      expect((await m.detalhe()).falasNaFila).toEqual([{ mensagemId: turno.mensagemOrigemId, situacao: "na_fila" }]);

      // O bot responde e o turno da fala acaba: a frente segue esperando (a espera não foi cancelada).
      await m.repos.turnos.assentar(turno.id, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, m.trabalhoId);
      expect((await m.repos.trabalhos.buscar(m.trabalhoId))?.estado).toBe("rodando");
      expect((await m.repos.esperas.buscar(espera!.id))?.estado).toBe("rodando");

      // A CI acaba: a volta da espera nasce na frente, como sem a conversa.
      await relatarEspera(m.deps, { maquinaId: maquina, relato: { id: espera!.id, tipo: "terminou", codigo: 0, saida: "unit\tpass" } });
      const volta = (await m.repos.turnos.doTrabalho(m.trabalhoId)).find((t) => t.retomaTurnoId === m.daFrente.id && t.id !== turno.id && t.estado === "pendente");
      expect(volta).toBeTruthy();
    });
  });

  it("revisão 6: o turno da fala cai (máquina sem contato) — a volta de verdade leva a fala e o chip segue nela", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.turnos.assentar(m.daFrente.id, { estado: "concluido" });
      await m.repos.trabalhos.mudarEstado(m.trabalhoId, "terminado", Date.now());
      const fala = await mensagemParaTrabalho(m.deps, { trabalhoId: m.trabalhoId, texto: "Que PR foi?" });
      const maquina = randomUUID();
      for (let i = 0; i < 3 && (await m.repos.turnos.buscar(fala.data.mensagemTurnoId))?.estado === "pendente"; i++) await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
      expect((await m.repos.turnos.buscar(fala.data.mensagemTurnoId))?.estado).toBe("despachando");
      expect((await m.detalhe()).falasNaFila?.map((f) => f.situacao)).toEqual(["lendo"]);

      const caido = (await m.repos.turnos.assentar(fala.data.mensagemTurnoId, { estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" }))!;
      await aposQuedaDaMaquina(m.deps, caido, { perdidoDesde: Date.now() - 60_000 });
      const volta = (await m.repos.turnos.doTrabalho(m.trabalhoId)).find((t) => t.estado === "pendente");
      expect(volta?.entradaTexto).toContain(`${MARCA_DA_FALA_NA_FRENTE}${caido.entradaTexto}`);
      expect(volta?.entradaTexto).not.toContain("Pedido original da frente");
      expect((await m.detalhe()).falasNaFila?.map((f) => f.situacao)).toEqual(["na_fila"]);
    });
  });

  it("revisão 8: o bot respondeu no turno da fala e seguiu; a queda depois não manda responder de novo nem reacende o chip", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.turnos.assentar(m.daFrente.id, { estado: "concluido" });
      await m.repos.trabalhos.mudarEstado(m.trabalhoId, "parado", Date.now());
      const fala = await mensagemParaTrabalho(m.deps, { trabalhoId: m.trabalhoId, texto: "Pode seguir?" });
      const maquina = randomUUID();
      for (let i = 0; i < 3 && (await m.repos.turnos.buscar(fala.data.mensagemTurnoId))?.estado === "pendente"; i++) await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
      await m.falaDoBot(fala.data.mensagemTurnoId, "Sigo, sim.");
      const caido = (await m.repos.turnos.assentar(fala.data.mensagemTurnoId, { estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" }))!;
      await aposQuedaDaMaquina(m.deps, caido, { perdidoDesde: Date.now() - 60_000 });
      const volta = (await m.repos.turnos.doTrabalho(m.trabalhoId)).find((t) => t.estado === "pendente");
      expect(volta).toBeTruthy();
      expect(volta!.entradaTexto).not.toContain(MARCA_DA_FALA_NA_FRENTE);
      expect((await m.detalhe()).falasNaFila).toBeUndefined();
    });
  });

  it("revisão 7: o turno vivo que absorveu a fala cai antes de responder — a volta dele leva a fala; a já respondida não", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const maquina = randomUUID();
      await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
      await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
      expect((await m.repos.turnos.buscar(m.daFrente.id))?.estado).toBe("despachando");
      await mensagemParaTrabalho(m.deps, { trabalhoId: m.trabalhoId, texto: "Respondida?" });
      await absorverNoTrabalho(m.deps, { turnoId: m.daFrente.id });
      await m.falaDoBot(m.daFrente.id, "Sim.");
      await mensagemParaTrabalho(m.deps, { trabalhoId: m.trabalhoId, texto: "E o deploy?" });
      await absorverNoTrabalho(m.deps, { turnoId: m.daFrente.id });
      expect((await m.detalhe()).falasNaFila?.map((f) => f.situacao)).toEqual(["entregue"]);

      const caido = (await m.repos.turnos.assentar(m.daFrente.id, { estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" }))!;
      await aposQuedaDaMaquina(m.deps, caido, { perdidoDesde: Date.now() - 60_000 });
      const volta = (await m.repos.turnos.doTrabalho(m.trabalhoId)).find((t) => t.estado === "pendente");
      expect(volta?.entradaTexto).toContain(`${MARCA_DA_FALA_NA_FRENTE}${molduraFalaNaFrente("E o deploy?")}`);
      expect(volta?.entradaTexto).not.toContain("Respondida?");
      expect((await m.detalhe()).falasNaFila?.map((f) => f.situacao)).toEqual(["na_fila"]);
    });
  });

  it("revisão 6: \"Levar as tasks\" (NOD-310) guarda a fala na volta da cota que só leva a fala", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const moldura = molduraFalaNaFrente("Que PR foi?", { frenteAcabou: true });
      const v = (await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "retomada", retomaTurnoId: m.daFrente.id, trabalhoId: m.trabalhoId, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: `${ENTRADA_DA_VOLTA_DA_COTA}cota${MARCA_DA_FALA_NA_FRENTE}${moldura}`, entradaConfianca: "confiavel", modelo: "auto", harness: "claude-cli" }))!;
      const ids = await m.repos.turnos.levarTasksDoBot({ agenteId: m.agenteId, iaDe: "claude-cli", harness: "codex-cli", modelo: "auto", entradaDaVolta: `${ENTRADA_DA_VOLTA_DA_COTA}passou para o Codex.` });
      expect(ids).toContain(v.id);
      expect((await m.repos.turnos.buscar(v.id))?.entradaTexto).toBe(`${ENTRADA_DA_VOLTA_DA_COTA}passou para o Codex.${MARCA_DA_FALA_NA_FRENTE}${moldura}`);
    });
  });

  for (const [caso, estado] of [["esperando (fechada ociosa)", "fechado_ocioso"], ["terminada", "terminado"], ["parada", "parado"]] as const) {
    it(`frente ${caso}: a fala reabre a frente com a mesma moldura, e o chip diz que ela está na fila`, async () => {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        await m.repos.turnos.interromper(m.daFrente.id, "parado_pela_pessoa");
        await m.repos.trabalhos.mudarEstado(m.trabalhoId, estado, Date.now());

        const fala = await mensagemParaTrabalho(m.deps, { trabalhoId: m.trabalhoId, texto: "E o deploy?" });
        expect(fala.data.trabalho.estado).not.toBe(estado);
        const turno = await m.repos.turnos.buscar(fala.data.mensagemTurnoId);
        // A frente que terminou não é refeita: a moldura diz isso (revisão A1). A parada (Parar) a pessoa retoma pela
        // barra, como antes do PR (revisão 4, A1: NOD-256 F1.3): continue, sem a marca da conversa.
        const acabou = estado === "terminado";
        expect((await m.repos.turnos.buscar(fala.data.mensagemTurnoId))!.decididoPor === FALA_DEPOIS_DO_FIM).toBe(acabou);
        expect(turno).toMatchObject({ estado: "pendente", origem: "retomada", retomaTurnoId: m.daFrente.id, entradaTexto: molduraFalaNaFrente("E o deploy?", { frenteAcabou: acabou }) });
        expect(turno!.entradaTexto.includes("continue o trabalho de onde parou")).toBe(!acabou);
        expect((await m.detalhe()).falasNaFila).toEqual([{ mensagemId: turno!.mensagemOrigemId, situacao: "na_fila" }]);

        // O plano da frente reaberta leva a moldura na entrada e o reforço no prompt.
        const p = await m.plano(turno!.id);
        expect(p.entrada.texto).toContain("A pessoa escreveu nesta frente: «E o deploy?»");
        expect(p.entrada.texto).not.toContain("Pedido original da frente");
        expect(p.entrada.texto).toContain("Responda a ela primeiro");
        expect(p.promptSistema).toContain("Se a pessoa escrever nesta frente, responda a ela primeiro");

        // Rodando sem ter falado: lendo. Falou: some.
        for (let i = 0; i < 3 && (await m.repos.turnos.buscar(turno!.id))?.estado !== "despachando"; i++) await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
        expect((await m.repos.turnos.buscar(turno!.id))?.estado).toBe("despachando");
        expect((await m.detalhe()).falasNaFila).toEqual([{ mensagemId: turno!.mensagemOrigemId, situacao: "lendo" }]);
        await m.falaDoBot(turno!.id, "O deploy está verde.");
        expect((await m.detalhe()).falasNaFila).toBeUndefined();
      });
    });
  }

  it("revisão A1/4: conversar na frente que já voltou ao dono mantém o resumo (a cópia igual não gera complementar)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const frente = await m.repos.trabalhos.buscar(m.trabalhoId);
      expect(frente?.loteId).toBeTruthy();
      const resumo = { feito: "Lancei a NOD-370", pr: 1 };
      expect(await m.repos.frentes.gravarResumo(m.trabalhoId, resumo)).toBe(true);
      await m.repos.turnos.interromper(m.daFrente.id, "parado_pela_pessoa");
      await m.repos.trabalhos.mudarEstado(m.trabalhoId, "terminado", Date.now());
      await m.repos.frentes.marcarDevolvido(frente!.loteId!, null, Date.now());

      const fala = await mensagemParaTrabalho(m.deps, { trabalhoId: m.trabalhoId, texto: "Que PR foi?" });
      expect(fala.data.trabalho.estado).not.toBe("terminado");
      expect((await m.repos.trabalhos.buscar(m.trabalhoId))?.resumo).toEqual(resumo);
      // A cópia guardada é igual ao atual: o fecho não tem o que complementar e o dono não é acordado pela conversa (se a
      // conversa virar trabalho e devolver outro resumo, o complementar sai — frentes-retorno, revisão 4).
      expect(await m.repos.frentes.consumirResumoAnterior(m.trabalhoId)).toEqual({ anterior: resumo, atual: resumo });
    });
  });
});
