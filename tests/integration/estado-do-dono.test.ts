import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { despacharPessoa } from "../../src/adapters/fundo/despachar-outbox.ts";
import type { FrameSse } from "../../src/contracts/frame.ts";
import { criarMetricas } from "../../src/obs/metricas.ts";
import { criarBarramento } from "../../src/services/barramento.ts";
import { criarSala } from "../../src/use-cases/criar-sala.ts";
import type { ServicoDasMaquinas } from "../../src/contracts/trabalho.ts";
import { lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { abrirFrentes } from "../../src/use-cases/frentes.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { eventoTrabalhoMudou, listarTrabalhos, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * O estado do dono para a tela (ADR-099 item 10, I10, 2026-10-12): `GET trabalhos` traz o dono de cada bot, o
 * `ConversaDto` o do bot da conversa própria, e o frame `trabalho.mudou` leva o estado. O caso: o Ze abriu 3 frentes —
 * uma trabalhando, uma esperando a CI do #845 por comando, uma na fila —, a pessoa mandou outra mensagem e a Ada pediu
 * algo a ele. A linha diz "Trabalhando em 1 frente", com 1 esperando e 3 na fila.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const ze = await agenteComConversa(trx, MARLON, { nome: "Ze" });
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  for (const a of [ze, ada]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  const turno = async (quem: typeof ze, texto: string) =>
    (await repos.turnos.enfileirar({ executor: "catcher", conversaId: quem.conversaId, agenteId: quem.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: texto, entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
  /** O turno passa a rodar (o que o reivindicar faria), sem a ordem da fila escolher outro antes. */
  const rodar = async (id: string) => trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = now() + interval '5 minutes' where id = ${id}`;

  // O dono abre 3 frentes e encerra o turno.
  const dono = await turno(ze, "conserte o login, veja a CI e escreva as notas");
  const r = await abrirFrentes(deps, { ...contexto(ze.agenteId, ze.conversaId, dono.id), frentes: [{ titulo: "Login", pedido: "Conserte o login." }, { titulo: "CI", pedido: "Veja a CI." }, { titulo: "Notas", pedido: "Escreva as notas." }] });
  if (!r.data.ok) throw new Error("abrir");
  await repos.turnos.assentar(dono.id, { estado: "concluido" });
  const [login, ci, notas] = r.data.frentes.map((f) => f.trabalho_id) as [string, string, string];
  const turnoDe = async (id: string) => (await repos.turnos.doTrabalho(id))[0]!;
  // Login trabalha (turno vivo).
  await rodar((await turnoDe(login)).id);
  await sincronizarTrabalho(deps, login);
  // CI deixou um comando esperando e o turno acabou: espera, não trabalha.
  const turnoCi = await turnoDe(ci);
  await repos.esperas.criar({ agenteId: ze.agenteId, conversaId: ze.conversaId, trabalhoId: ci, turnoId: turnoCi.id, maquinaId: randomUUID(), pasta: null, comando: "gh pr checks 845 --watch -R gamefik/gamefik", motivo: "a CI do #845" });
  await repos.turnos.assentar(turnoCi.id, { estado: "concluido" });
  await sincronizarTrabalho(deps, ci);
  // A pessoa escreve de novo (vai à fila do dono, na frente) e a Ada pede algo ao Ze (a triagem, atrás).
  const daPessoa = await turno(ze, "e o deploy?");
  const deAda = await turno(ada, "pergunte ao Ze");
  await rodar(deAda.id);
  const pedido = await pedirABot(deps, { turnoId: deAda.id, agenteId: ada.agenteId, conversaId: ada.conversaId, agente: "Ze", pedido: "revise o PR 42" });
  if (!pedido.data.ok) throw new Error("pedido");
  return { ze, ada, deps, repos, login, ci, notas, daPessoa, triagem: pedido.data.tarefa_id };
}

describeIntegracao("o estado do dono na tela: GET trabalhos, ConversaDto e o frame (ADR-099, I10)", () => {
  it("GET trabalhos: por bot, o estado (trabalhando em 1 · 1 esperando · 3 na fila), as esperas e a fila; e o lote em cada frente", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { data } = await listarTrabalhos(m.deps, {});
      const dono = data.donos?.find((d) => d.estado.agenteId === m.ze.agenteId);
      expect(dono?.estado).toMatchObject({ principal: "trabalhando", frentes: 1, conversaTrabalhando: false, conversaPropriaTrabalhando: false, esperandoVoce: 0, esperando: 1, fila: 3, motivoEspera: "a CI do #845" });
      expect(dono?.esperas).toEqual([expect.objectContaining({ tipo: "comando", trabalhoId: m.ci, motivo: "a CI do #845", comando: "gh pr checks 845 --watch -R gamefik/gamefik", ultimaLinha: null, tentativa: 1, tentativas: 3 })]);
      expect(dono?.fila.map((p) => [p.turnoId, p.de, p.nome])).toEqual([[m.daPessoa.id, "pessoa", null], [m.triagem, "colega", "Ada"]]);
      // A Ada, que pediu e segue no turno, trabalha; o pedido sem resposta dela fica contado como espera da conversa só
      // quando o turno acabar (esperar não é trabalhar).
      expect(data.donos?.find((d) => d.estado.agenteId === m.ada.agenteId)?.estado).toMatchObject({ principal: "trabalhando", conversaTrabalhando: true, conversaPropriaTrabalhando: true, esperando: 0 });

      const ci = data.trabalhos.find((t) => t.id === m.ci);
      expect(ci).toMatchObject({ forma: "frente", estado: "rodando", turnoVivoId: null, esperandoComando: { motivo: "a CI do #845" }, lote: { frentes: 3, abertas: 3 } });
      expect(ci?.lote?.id).toBe(ci?.loteId);

      // Só o bot pedido.
      const soZe = await listarTrabalhos(m.deps, { agenteId: m.ze.agenteId });
      expect(soZe.data.donos?.map((d) => d.estado.agenteId)).toEqual([m.ze.agenteId]);
    });
  });

  it("ConversaDto: o dono do bot da conversa própria; uma decisão aberta passa na frente de tudo (Esperando você)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const antes = (await lerConversa(m.deps, { conversaId: m.ze.conversaId })).data.dono;
      expect(antes?.estado).toMatchObject({ principal: "trabalhando", frentes: 1, esperando: 1, fila: 3 });
      const loginTurno = (await m.repos.turnos.doTrabalho(m.login))[0]!;
      await m.repos.decisoes.criar({ tipo: "retomar_turno", agenteId: m.ze.agenteId, conversaId: m.ze.conversaId, turnoId: loginTurno.id, prazoDecisaoEm: Date.now() + 86_400_000, frase: "Posso seguir?" });
      const depois = (await lerConversa(m.deps, { conversaId: m.ze.conversaId })).data.dono;
      expect(depois?.estado).toMatchObject({ principal: "esperando_voce", esperandoVoce: 1, esperando: 1, fila: 3 });
    });
  });

  it("o frame trabalho.mudou leva a forma, o lote e o estado do dono, lido na hora de publicar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const barramento = criarBarramento();
      const frames: FrameSse[] = [];
      barramento.inscrever(PESSOA_MARLON, (f) => frames.push(f));
      const ci = (await m.repos.trabalhos.buscar(m.ci))!;
      await m.repos.events.gravarComOutbox([eventoTrabalhoMudou(m.deps, ci)]);
      await despacharPessoa(trx, MARLON, barramento, { metricas: criarMetricas(), agora: () => Date.now() });
      const frame = frames.find((f) => f.tipo === "trabalho.mudou" && (f.dados as { trabalhoId?: string }).trabalhoId === m.ci);
      expect(frame?.dados).toMatchObject({ forma: "frente", loteId: ci.loteId, estadoDono: { agenteId: m.ze.agenteId, principal: "trabalhando", frentes: 1, esperando: 1, fila: 3, motivoEspera: "a CI do #845" } });
    });
  });

  it("a linha aberta: o comando da segunda volta é a tentativa 2 de 3, com a última linha da anterior; a volta marcada diz o motivo", async () => {
    await withRollback(MARLON, async (trx) => {
      const ze = await agenteComConversa(trx, MARLON, { nome: "Ze" });
      const { deps, repos } = depsSobre(trx, MARLON);
      const novo = (extra: { retomaTurnoId?: string; acordarEm?: number } = {}) =>
        repos.turnos.enfileirar({ executor: "catcher", conversaId: ze.conversaId, agenteId: ze.agenteId, origem: extra.retomaTurnoId ? "retomada" : "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "espere a CI", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: null, ...extra });
      const comando = "gh pr checks 845 --watch -R gamefik/gamefik";
      // O dono esperou a CI uma vez (falhou) e voltou; na volta, esperou de novo.
      const origem = (await novo())!;
      const primeira = await repos.esperas.criar({ agenteId: ze.agenteId, conversaId: ze.conversaId, trabalhoId: null, turnoId: origem.id, maquinaId: randomUUID(), pasta: null, comando, motivo: "a CI do #845" });
      await repos.esperas.finalizar(primeira!.id, { estado: "terminou", codigo: 1, saida: "build\tpass\nmobile\tfail\n", agora: Date.now() });
      await repos.turnos.assentar(origem.id, { estado: "concluido" });
      const volta = (await novo({ retomaTurnoId: origem.id, acordarEm: Date.now() - 1_000 }))!;
      await repos.esperas.criar({ agenteId: ze.agenteId, conversaId: ze.conversaId, trabalhoId: null, turnoId: volta.id, maquinaId: randomUUID(), pasta: null, comando, motivo: "a CI do #845" });
      await repos.turnos.assentar(volta.id, { estado: "concluido" });

      const dono = (await lerConversa(deps, { conversaId: ze.conversaId })).data.dono;
      expect(dono?.esperas).toEqual([expect.objectContaining({ tipo: "comando", trabalhoId: null, comando, tentativa: 2, tentativas: 3, ultimaLinha: "mobile\tfail" })]);
      expect(dono?.estado).toMatchObject({ principal: "esperando", esperando: 1, motivoEspera: "a CI do #845", frentes: 0, fila: 0 });

      // Uma volta marcada (me_chame_as) para daqui a 1 h: a espera diz o motivo que o turno anotou.
      const outro = (await novo())!;
      await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = now() + interval '5 minutes' where id = ${outro.id}`;
      const em = Date.now() + 3_600_000;
      expect(await repos.turnos.marcarDespertar(outro.id, em, "o deploy terminar")).toBe(true);
      await repos.turnos.assentar(outro.id, { estado: "concluido" });
      await novo({ retomaTurnoId: outro.id, acordarEm: em });
      const comVolta = (await lerConversa(deps, { conversaId: ze.conversaId })).data.dono;
      expect(comVolta?.esperas.find((e) => e.tipo === "volta")).toMatchObject({ trabalhoId: null, motivo: "o deploy terminar", acordaEm: em });
      expect(comVolta?.estado).toMatchObject({ principal: "esperando", esperando: 1 });
    });
  });

  it("NOD-260 (definido em 2026-10-15; antes NOD-219): o turno vivo numa SALA não faz o bot trabalhar — nem a conversa, nem a própria", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const { deps, repos } = depsSobre(trx, MARLON);
      for (const a of [vera, tuca]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
      const s = await criarSala(deps, { nome: "revisão", agenteIds: [vera.agenteId, tuca.agenteId] });
      const naSala = await repos.turnos.enfileirar({ executor: "catcher", conversaId: s.data.conversa.id, agenteId: vera.agenteId, origem: "sala", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "@Vera olha", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" });
      await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = now() + interval '5 minutes' where id = ${naSala?.id ?? ""}`;
      const { data } = await listarTrabalhos(deps, { agenteId: vera.agenteId });
      expect(data.donos?.[0]?.estado).toMatchObject({ principal: "livre", conversaTrabalhando: false, conversaPropriaTrabalhando: false });
    });
  });

  it("NOD-300 (CA 8): a frente com turno vivo numa máquina sem contato espera — GET trabalhos, a conversa e o frame dizem o mesmo", async () => {
    await withRollback(MARLON, async (trx) => {
      const ze = await agenteComConversa(trx, MARLON, { nome: "Ze" });
      const { deps, repos } = depsSobre(trx, MARLON);
      await repos.agentes.atualizarPerfil(ze.agenteId, { confirmado: true });
      const ultimoContato = Date.now() - 12 * 60_000;
      const vm = (await repos.maquinaTokens.criar({ nome: "VM-1", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!.id;
      await repos.maquinaTokens.marcarUso(vm, ultimoContato);
      const maquinas: ServicoDasMaquinas = { leituras: () => [], identificar: (_e, id) => (id === vm ? { nome: "VM-1", ehMac: false } : null), macDoServidor: null, conectada: () => false };
      const comMaquinas = { ...deps, services: { ...deps.services, maquinas } };
      const dono = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ze.conversaId, agenteId: ze.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "conserte o login", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
      const r = await abrirFrentes(deps, { ...contexto(ze.agenteId, ze.conversaId, dono.id), frentes: [{ titulo: "Login", pedido: "Conserte o login." }] });
      if (!r.data.ok) throw new Error("abrir");
      await repos.turnos.assentar(dono.id, { estado: "concluido" });
      const login = r.data.frentes[0]!.trabalho_id;
      const turnoLogin = (await repos.turnos.doTrabalho(login))[0]!;
      await trx`update turnos set estado = 'despachando', machine_id = ${vm}, lease_ate = now() + interval '5 minutes' where id = ${turnoLogin.id}`;
      await sincronizarTrabalho(deps, login);

      const esperado = { principal: "esperando", frentes: 0, esperando: 1, motivoEspera: "VM-1 · sem contato", desde: ultimoContato };
      const { data } = await listarTrabalhos(comMaquinas, {});
      expect(data.donos?.find((d) => d.estado.agenteId === ze.agenteId)?.estado).toMatchObject(esperado);
      expect(data.donos?.find((d) => d.estado.agenteId === ze.agenteId)?.esperas).toEqual([]);
      expect(data.trabalhos.find((t) => t.id === login)?.maquina?.semContatoDesde).toBe(ultimoContato);
      expect((await lerConversa(comMaquinas, { conversaId: ze.conversaId })).data.dono?.estado).toMatchObject(esperado);

      const barramento = criarBarramento();
      const frames: FrameSse[] = [];
      barramento.inscrever(PESSOA_MARLON, (f) => frames.push(f));
      await repos.events.gravarComOutbox([eventoTrabalhoMudou(deps, (await repos.trabalhos.buscar(login))!)]);
      await despacharPessoa(trx, MARLON, barramento, { metricas: criarMetricas(), agora: () => Date.now(), presenca: maquinas });
      const frame = frames.find((f) => f.tipo === "trabalho.mudou" && (f.dados as { trabalhoId?: string }).trabalhoId === login);
      expect(frame?.dados).toMatchObject({ estadoDono: esperado });

      // Achado do QA no #427: a ponte esquece a máquina 90 s depois do último contato (`identificar` null); o nome vem da chave.
      const esquecida = { ...comMaquinas, services: { ...deps.services, maquinas: { ...maquinas, identificar: () => null } } };
      const semPonte = (await listarTrabalhos(esquecida, {})).data;
      expect(semPonte.donos?.find((d) => d.estado.agenteId === ze.agenteId)?.estado).toMatchObject(esperado);
      expect(semPonte.trabalhos.find((t) => t.id === login)?.maquina).toMatchObject({ nome: "VM-1", semContatoDesde: ultimoContato });

      // Sem o serviço saber da presença: o estado de antes (trabalhando).
      expect((await listarTrabalhos(deps, {})).data.donos?.find((d) => d.estado.agenteId === ze.agenteId)?.estado).toMatchObject({ principal: "trabalhando", frentes: 1 });
    });
  });
});
