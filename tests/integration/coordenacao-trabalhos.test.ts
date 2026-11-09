import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { CAPACIDADES_HARNESS, type IdHarness } from "../../src/contracts/harness.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { absorverNoTrabalho, fazerAqui, fazerDepois, mensagemParaTrabalho, promoverNaRede } from "../../src/use-cases/coordenar-trabalhos.ts";
import { abrirTask, mandarParaTask } from "../../src/use-cases/frentes.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { criarTrabalho, fecharPorMemoria, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
const harnesses: Partial<Record<IdHarness, typeof pronto>> = { "claude-cli": pronto };
const CLAUDE_ORIGINAL = { ...CAPACIDADES_HARNESS["claude-cli"] };
afterEach(() => {
  Object.assign(CAPACIDADES_HARNESS["claude-cli"], CLAUDE_ORIGINAL);
});

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx, agora = () => Date.now()) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const turno = (extra: { trabalhoId?: string | null; origem?: "conversa" | "rotina" } = {}) =>
    base.repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: extra.origem ?? "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "monte o dashboard de churn", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: extra.trabalhoId ?? null });
  const ctx = (turnoId: string) => ({ turnoId, agenteId: base.agenteId, conversaId: base.conversaId });
  const plano = async (turnoId: string) => (await emitirPlanoTurno(deps, { turnoId, machineId: randomUUID(), executor: "local", harnesses })).data;
  return { ...base, deps, turno, ctx, plano };
}

describeIntegracao("a conversa coordena (#193, ADR-083 §7)", () => {
  it("abrir_task (sinônimo, ADR-099 I2): abre uma frente da pessoa num lote, a linha \"Começou a frente\" e o turno dela; a conversa recebe a seção Trabalhos em andamento", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const conversa = await m.turno();
      const r = await abrirTask(m.deps, { ...m.ctx(conversa!.id), titulo: "Dashboard de churn", pedido: "Monte o dashboard de churn com os dados de setembro." });
      if (!r.data.ok) throw new Error("deveria abrir");
      const t = await m.repos.trabalhos.buscar(r.data.trabalho_id);
      expect(t).toMatchObject({ origem: "pessoa", titulo: "Dashboard de churn", estado: "na_fila", conversaId: m.conversaId, forma: "frente", loteId: expect.any(String) });
      const daTask = (await m.repos.turnos.doTrabalho(t!.id))[0];
      expect(daTask).toMatchObject({ origem: "conversa", estado: "pendente", trabalhoId: t!.id });
      expect(daTask?.entradaTexto).toContain("Monte o dashboard de churn com os dados de setembro.");
      const linha = (await m.repos.mensagens.listarDaConversa(m.conversaId)).find((x) => x.payload?.kind === "frentes_abertas");
      expect(linha).toMatchObject({ kind: "sistema", texto: "Começou a frente Dashboard de churn", payload: { loteId: t!.loteId, origem: "pessoa", frentes: [{ trabalhoId: t!.id, titulo: "Dashboard de churn" }] } });
      expect((r.events ?? []).map((e) => e.kind)).toEqual(["trabalho_mudou", "turno_criado", "mensagem_criada"]);

      // O próximo turno da conversa vê a task e tem as duas ferramentas; o turno da task não tem nenhuma das duas.
      const pConversa = await m.plano((await m.turno())!.id);
      expect(pConversa.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["abrir_frentes", "mandar_para_frente"]));
      expect(pConversa.promptSistemaPartes?.volatil).toContain(`"id":"${t!.id}"`);
      const pTask = await m.plano(daTask!.id);
      expect(pTask.catalogo.ferramentas.map((f) => f.nome)).not.toContain("abrir_frentes");
      expect(pTask.catalogo.ferramentas.map((f) => f.nome)).not.toContain("mandar_para_frente");
      expect(pTask.promptSistema).toContain('Frente atual: você está na frente "Dashboard de churn"');

      // A task não abre outra (2ª camada, além do catálogo).
      const recusa = await abrirTask(m.deps, { ...m.ctx(daTask!.id), titulo: "Outra", pedido: "x" });
      expect(recusa.data).toMatchObject({ ok: false, erro: "nao_abre_task" });
    });
  });

  it("ADR-099 (parte 1): a task que só espera a volta marcada vai à conversa como \"esperando\", não \"rodando\"", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Acompanhar a CI", origem: "pessoa" })).trabalho;
      await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "retomada", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "volta", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: t.id, acordarEm: Date.now() + 3_600_000 });
      await sincronizarTrabalho(m.deps, t.id);
      expect((await m.repos.trabalhos.buscar(t.id))?.estado).toBe("rodando");
      const linha = ((await m.plano((await m.turno())!.id)).promptSistemaPartes?.volatil ?? "").split("\n").find((l) => l.startsWith("Trabalhos em andamento")) ?? "";
      expect(linha).toContain(`{"id":"${t.id}","titulo":"Acompanhar a CI","estado":"esperando"`);
    });
  });

  it("depois_de espera; \"Fazer depois\" grava, recusa ciclo; a task de rotina abre filhas (profundidade 1) e a filha não abre", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t1 = await m.turno();
      const a = await abrirTask(m.deps, { ...m.ctx(t1!.id), titulo: "Primeira", pedido: "primeira" });
      if (!a.data.ok) throw new Error("abrir");
      const b = await abrirTask(m.deps, { ...m.ctx(t1!.id), titulo: "Segunda", pedido: "segunda", depois_de: a.data.trabalho_id });
      if (!b.data.ok) throw new Error("abrir 2");
      expect((await m.repos.trabalhos.buscar(b.data.trabalho_id))?.depoisDeTrabalhoId).toBe(a.data.trabalho_id);
      expect((await abrirTask(m.deps, { ...m.ctx(t1!.id), titulo: "X", pedido: "x", depois_de: randomUUID() })).data).toMatchObject({ ok: false, erro: "depois_de_invalido" });
      await expect(fazerDepois(m.deps, { trabalhoId: a.data.trabalho_id, depoisDe: b.data.trabalho_id })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      const tirado = await fazerDepois(m.deps, { trabalhoId: b.data.trabalho_id, depoisDe: null });
      expect(tirado.data.trabalho.depoisDeTrabalhoId).toBeNull();

      const rotina = await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Triagem", origem: "rotina", pasta: null });
      const turnoRotina = await m.turno({ trabalhoId: rotina.trabalho.id, origem: "rotina" });
      expect((await m.plano(turnoRotina!.id)).catalogo.ferramentas.map((f) => f.nome)).toContain("abrir_frentes");
      const filha = await abrirTask(m.deps, { ...m.ctx(turnoRotina!.id), titulo: "Responder chamado", pedido: "responda o chamado 42" });
      if (!filha.data.ok) throw new Error("filha");
      expect(await m.repos.trabalhos.buscar(filha.data.trabalho_id)).toMatchObject({ origem: "rotina", trabalhoMaeId: rotina.trabalho.id, forma: "frente" });
      const turnoFilha = (await m.repos.turnos.doTrabalho(filha.data.trabalho_id))[0];
      expect(turnoFilha?.origem).toBe("rotina");
      const pFilha = await m.plano(turnoFilha!.id);
      expect(pFilha.catalogo.ferramentas.map((f) => f.nome)).not.toContain("abrir_frentes");
      expect(pFilha.promptSistema).toContain("Uma frente não abre outras");
    });
  });

  it("\"Fazer depois\" com a task já rodando: o turno vivo para, o mesmo pedido volta à fila e a task espera a outra (achado do e2e, 2026-10-08)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const conversa = await m.turno();
      await m.repos.turnos.assentar(conversa!.id, { estado: "concluido" });
      const a = await abrirTask(m.deps, { ...m.ctx(conversa!.id), titulo: "Migrar relatórios", pedido: "migre os relatórios" });
      const b = await abrirTask(m.deps, { ...m.ctx(conversa!.id), titulo: "Dashboard de churn", pedido: "monte o dashboard de churn" });
      if (!a.data.ok || !b.data.ok) throw new Error("abrir");
      const [idA, idB] = [a.data.trabalho_id, b.data.trabalho_id];
      for (let i = 0; i < 2; i++) await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await sincronizarTrabalho(m.deps, idA);
      await sincronizarTrabalho(m.deps, idB);
      const [vivoB] = await m.repos.turnos.doTrabalho(idB);
      expect(vivoB).toMatchObject({ estado: "despachando" });
      expect(await m.repos.trabalhos.buscar(idB)).toMatchObject({ estado: "rodando" });

      const r = await fazerDepois(m.deps, { trabalhoId: idB, depoisDe: idA });
      expect(r.data.trabalho).toMatchObject({ depoisDeTrabalhoId: idA, estado: "na_fila" });
      const turnosB = await m.repos.turnos.doTrabalho(idB);
      expect(turnosB.map((t) => [t.estado, t.pararSolicitadoEm !== null])).toEqual([["despachando", true], ["pendente", false]]);
      expect(turnosB[1]).toMatchObject({ origem: vivoB!.origem, entradaTexto: vivoB!.entradaTexto, trabalhoId: idB });
      expect((r.events ?? []).map((e) => e.kind)).toContain("turno_criado");

      // O turno parado assenta; a task continua na fila, e o pedido não roda enquanto a outra não acabar.
      await m.repos.turnos.assentar(vivoB!.id, { estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      await sincronizarTrabalho(m.deps, idB);
      expect((await m.repos.trabalhos.buscar(idB))?.estado).toBe("na_fila");
      expect(await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() })).toBeNull();
      const [vivoA] = await m.repos.turnos.doTrabalho(idA);
      await m.repos.turnos.assentar(vivoA!.id, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, idA);
      expect((await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }))?.id).toBe(turnosB[1]!.id);
      // ADR-099 (I3): a frente A acabou e o lote dela volta ao dono (a retomada do turno da conversa). Ela sai da fila aqui.
      const retornoA = (await m.repos.turnos.listarDaConversa(m.conversaId, 100)).filter((t) => t.origem === "retomada" && t.retomaTurnoId === conversa!.id);
      expect(retornoA).toHaveLength(1);
      await m.repos.turnos.assentar(retornoA[0]!.id, { estado: "concluido" });

      // Sem a outra aberta (ou numa task de rotina), "Fazer depois" só grava: nada para.
      const c = await abrirTask(m.deps, { ...m.ctx(conversa!.id), titulo: "Outra", pedido: "outra" });
      if (!c.data.ok) throw new Error("abrir 3");
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await fazerDepois(m.deps, { trabalhoId: c.data.trabalho_id, depoisDe: idA });
      expect((await m.repos.turnos.doTrabalho(c.data.trabalho_id)).map((t) => [t.estado, t.pararSolicitadoEm])).toEqual([["despachando", null]]);
    });
  });

  it("mandar_para_task chega à task certa (mensagem + turno na faixa dela) e entra no turno vivo dela, nunca no da conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const conversa = await m.turno();
      const a = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "A", origem: "pessoa" })).trabalho;
      const b = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "B", origem: "pessoa" })).trabalho;
      const vivoA = await m.turno({ trabalhoId: a.id });
      await m.turno({ trabalhoId: b.id });
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      expect((await m.repos.turnos.buscar(vivoA!.id))?.estado).toBe("despachando");

      const r = await mandarParaTask(m.deps, { ...m.ctx(conversa!.id), trabalho_id: a.id, texto: "Use o mês passado também" });
      expect(r.data).toMatchObject({ ok: true, entrou: "no_meio" });
      const recado = (await m.repos.turnos.doTrabalho(a.id)).find((t) => t.estado === "pendente");
      expect(recado).toMatchObject({ origem: "retomada", retomaTurnoId: vivoA!.id, trabalhoId: a.id });
      expect((await m.repos.turnos.doTrabalho(b.id)).filter((t) => t.estado === "pendente")).toHaveLength(0);

      // A renovação do turno vivo da task A absorve o recado; a da conversa não pega nada dela.
      expect((await absorverNoTrabalho(m.deps, { turnoId: conversa!.id })).data.textos).toEqual([]);
      const absorvido = await absorverNoTrabalho(m.deps, { turnoId: vivoA!.id });
      expect(absorvido.data.textos).toEqual(["[nod] Recado da conversa com a pessoa, repassado por você: Use o mês passado também"]);
      expect((await m.repos.turnos.buscar(recado!.id))).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: vivoA!.id });

      // A leitura da conversa marca a fala do recado com o trabalho (a web a tira do chat e a põe na task).
      const lida = await lerConversa(m.deps, { conversaId: m.conversaId });
      const fala = lida.data.mensagens.find((x) => x.texto === "Use o mês passado também");
      expect(fala).toMatchObject({ trabalhoId: a.id, origemTurno: null });

      // Do turno de uma task, não repassa; id de outro bot, não acha.
      expect((await mandarParaTask(m.deps, { ...m.ctx(vivoA!.id), trabalho_id: b.id, texto: "x" })).data).toMatchObject({ ok: false, erro: "nao_repassa" });
      expect((await mandarParaTask(m.deps, { ...m.ctx(conversa!.id), trabalho_id: randomUUID(), texto: "x" })).data).toMatchObject({ ok: false, erro: "task_nao_encontrada" });
    });
  });

  it("a pessoa escreve na task parada: vira o próximo passo dela; \"Fazer aqui\" desfaz a task e manda o pedido para a conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const conversa = await m.turno();
      const aberta = await abrirTask(m.deps, { ...m.ctx(conversa!.id), titulo: "Login do app", pedido: "Conserte o login do app." });
      if (!aberta.data.ok) throw new Error("abrir");
      const id = aberta.data.trabalho_id;
      const msg = await mensagemParaTrabalho(m.deps, { trabalhoId: id, texto: "Comece pelo Safari" });
      expect((await m.repos.turnos.buscar(msg.data.mensagemTurnoId))).toMatchObject({ trabalhoId: id, estado: "pendente" });
      await expect(mensagemParaTrabalho(m.deps, { trabalhoId: id, texto: "  " })).rejects.toMatchObject({ codigo: "texto_vazio" });

      const aqui = await fazerAqui(m.deps, { trabalhoId: id });
      expect(aqui.data.trabalho.estado).toBe("parado");
      expect((await m.repos.turnos.doTrabalho(id)).every((t) => t.estado === "interrompido")).toBe(true);
      const daConversa = await m.repos.turnos.buscar(aqui.data.turnoId);
      expect(daConversa).toMatchObject({ trabalhoId: null, origem: "conversa", estado: "pendente" });
      expect(daConversa?.entradaTexto).toContain("Conserte o login do app.");
      // QA do épico (2026-10-08): o pedido vai para a conversa sem a moldura da task ("acompanha pela tela da task").
      expect(daConversa?.entradaTexto).not.toContain("tela da task");
      expect(daConversa?.entradaTexto).toBe('[nod] A pessoa pediu para fazer aqui, na conversa, o que ia virar a task "Login do app". Faça agora:\nConserte o login do app.');
      await expect(fazerAqui(m.deps, { trabalhoId: id })).rejects.toMatchObject({ codigo: "estado_invalido" });
    });
  });

  it("rede de 2 min: o turno de conversa com ferramenta vira frente `rede` e a próxima mensagem sai com bifurcar", async () => {
    await withRollback(MARLON, async (trx) => {
      let relogio = Date.now();
      const m = await montar(trx, () => relogio);
      const s = randomUUID();
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, s, "local", "claude-cli");
      const vivo = await m.turno();
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: relogio });
      const despachadoEm = relogio;
      relogio += 119_000;
      expect((await promoverNaRede(m.deps, { turnoId: vivo!.id, despachadoEm, fezFerramenta: true, harness: "claude-cli", sessaoCli: s, maquinaBifurca: true })).data.trabalho).toBeNull();
      relogio += 1_000;
      expect((await promoverNaRede(m.deps, { turnoId: vivo!.id, despachadoEm, fezFerramenta: false, harness: "claude-cli", sessaoCli: s, maquinaBifurca: true })).data.trabalho).toBeNull();
      // revisto em 2026-10-12 (ADR-099, I8): sem bifurcar (Codex, ou a máquina que não anuncia) também promove, com o
      // histórico — em tests/integration/frentes-rede.test.ts.
      const r = await promoverNaRede(m.deps, { turnoId: vivo!.id, despachadoEm, fezFerramenta: true, harness: "claude-cli", sessaoCli: s, maquinaBifurca: true });
      // Revisão do épico (S13): a task da rede ganha pasta própria (os turnos seguintes rodam nela).
      expect(r.data.trabalho).toMatchObject({ origem: "rede", forma: "frente", estado: "rodando", sessaoCli: s, pasta: expect.stringMatching(/^~\/nod\/Ada\//) });
      expect((await m.repos.turnos.buscar(vivo!.id))?.trabalhoId).toBe(r.data.trabalho?.id);
      expect((r.events ?? []).map((e) => e.kind)).toEqual(["trabalho_mudou", "mensagem_criada"]);

      // A conversa ficou livre: a próxima mensagem é despachada já, e numa cópia da sessão.
      const proxima = await m.turno();
      expect((await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: relogio }))?.id).toBe(proxima!.id);
      expect((await m.plano(proxima!.id)).entrada).toMatchObject({ sessaoCli: s, bifurcar: true });
    });
  });

  it("#194: sob pressão, a task esperando a pessoa fecha (fechado_ocioso) com uma linha na conversa e segue fechada até a resposta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const w = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Esperando", origem: "pessoa" })).trabalho;
      const t = await m.turno({ trabalhoId: w.id });
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await m.repos.decisoes.criar({ tipo: "aprovacao", agenteId: m.agenteId, conversaId: m.conversaId, turnoId: t!.id, prazoDecisaoEm: Date.now() + 60_000, frase: "Posso publicar?" });
      await sincronizarTrabalho(m.deps, w.id);
      expect((await m.repos.trabalhos.buscar(w.id))?.estado).toBe("precisa_de_voce");
      const r = await fecharPorMemoria(m.deps, t!.id);
      expect(r.fechou).toBe(true);
      expect((await m.repos.trabalhos.buscar(w.id))?.estado).toBe("fechado_ocioso");
      expect((await m.repos.mensagens.listarDaConversa(m.conversaId)).at(-1)?.texto).toContain("para liberar memória");
      // A renovação seguinte (turno ainda acabando) e o assentar mantêm a task fechada enquanto a decisão espera.
      await sincronizarTrabalho(m.deps, w.id);
      await m.repos.turnos.assentar(t!.id, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, w.id);
      expect((await m.repos.trabalhos.buscar(w.id))?.estado).toBe("fechado_ocioso");
      // Turno sem trabalho nunca é fechado por memória.
      const conversa = await m.turno();
      expect((await fecharPorMemoria(m.deps, conversa!.id)).fechou).toBe(false);
    });
  });
});
