import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-lease.ts";
import { ENTRADA_DA_RETOMADA_DA_QUEDA } from "../../src/domain/cota-da-ia.ts";
import { assuntoDoTexto } from "../../src/domain/assunto-do-texto.ts";
import { destinoDe } from "../../src/domain/destino-no-chat.ts";
import { criarMetricas } from "../../src/obs/metricas.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { ligar, type ContextoLigacao } from "../../src/use-cases/ligacoes.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
const CONTEXTO_LIGACAO: ContextoLigacao = { permitido: true, habilitada: true, maquinaComLigacao: true, iaPronta: true, codexSemVoz: false, drenando: false, vozDisponivel: true, vivasNoServidor: 0, maxSimultaneas: 20, limiteDiarioMs: 0, inicioDoDia: 0, provedorStt: "falso", provedorTts: "falso" };

/** Uma rotina com o turno JÁ reivindicado por uma máquina (despachando, lease até agora + LEASE_MS). */
async function rotinaRodando(deps: Deps, conversaId: string, agenteId: string, maquina: string, agora: number) {
  const rotina = await deps.repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resumo dos e-mails", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: agora });
  if (!rotina) throw new Error("rotina");
  const r = await dispararRotina(deps, { rotina, instanteAgendado: agora, machineId: maquina, executor: "catcher" });
  if (!("turno" in r.data)) throw new Error("sem turno");
  const turno = await deps.repos.turnos.reivindicar({ machineId: maquina, agora });
  expect(turno?.id).toBe(r.data.turno.id);
  return { rotina, turnoId: r.data.turno.id };
}

describeIntegracao("varredor de lease (ADR-010/021, E9.4; ADR-045): conversa com UM Retomar, rotina só no histórico, UM aviso por queda", () => {
  it("conversa: lease vencido → interrompido maquina_sem_contato, fala parcial, decisão 'retomar_turno', mensagem com o Mac, eventos e UM aviso; 2x → nada novo; nunca 'pendente'", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const maquina = randomUUID();
      const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      await deps.repos.mensagens.criar({ conversaId: criado.conversa.id, turnoId, autoria: { ...(await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id))!.autoria, autor_tipo: "agente", autor_id: criado.agente.id }, kind: "texto", texto: "comecei a resp", confianca: "confiavel" });

      expect(await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS - 1)).toEqual({ interrompidos: [], decisoes: [] });
      const metricas = criarMetricas();
      const primeira = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1, { metricas });
      expect(primeira.interrompidos).toEqual([turnoId]);
      expect(primeira.decisoes).toHaveLength(1);
      expect(await deps.repos.turnos.buscar(turnoId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato", leaseAte: null });
      const decisao = await deps.repos.decisoes.buscar(primeira.decisoes[0] ?? "");
      expect(decisao).toMatchObject({ tipo: "retomar_turno", estado: "pendente", turnoId, conversaId: criado.conversa.id, decisorId: MARLON.pessoaId });
      const mensagens = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.turnoId === turnoId);
      expect(mensagens.map((m) => [m.kind, m.parcial])).toEqual([
        ["texto", true],
        ["sistema", false],
      ]);
      expect(mensagens[1]?.texto).toContain("seu Mac parou de responder (repouso, sem rede ou nod fechado)");
      // Chat limpo (QA do PR 1, 2026-10-18): a queda vem com o "Retomar", pede ação e fica no chat; o assunto é o mesmo
      // que o backfill dá à frase (assuntoDaInterrupcao).
      const [gravada] = await trx<{ assunto: string | null }[]>`select assunto from mensagens where id = ${mensagens[1]?.id ?? ""}`;
      expect(gravada?.assunto).toBe("turno.queda_da_maquina");
      expect(assuntoDoTexto(mensagens[1]?.texto ?? "")).toBe("turno.queda_da_maquina");
      expect(destinoDe(gravada?.assunto ?? null)).toBe("chat");
      const eventos = await trx<{ kind: string }[]>`select kind from events where turno_id = ${turnoId} and created_at > ${new Date(agora)}`;
      expect(eventos.map((e) => e.kind).sort()).toEqual(["decisao_criada", "mensagem_criada", "turno_interrompido"]);
      // UM aviso, do Mac que voltou (modo local: o varredor roda nele), com a conversa contada.
      const [aviso, ...outros] = await deps.repos.incidentes.visiveis(0);
      expect(outros).toEqual([]);
      expect(aviso).toMatchObject({ id: primeira.incidenteId, tipo: "mac_sem_contato", machineId: maquina, comecouEm: agora, voltouEm: agora + LEASE_MS + 1, rotinas: 0, conversas: 1, agentes: [criado.agente.id] });
      expect(metricas.ler({ metrica: "pos_restart", desfecho: "perdido", origem: "maquina_sumida", tenant_id: MARLON.tenantId })).toBe(1);

      const segunda = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 5000);
      expect(segunda).toEqual({ interrompidos: [], decisoes: [] });
      expect(await deps.repos.decisoes.pendentesDaConversa(criado.conversa.id)).toHaveLength(1);
      expect(await deps.repos.turnos.renovarLease(turnoId, maquina, {}, agora + LEASE_MS + 5000)).toEqual({ ativo: false, motivo: "lease_vencido" });
      expect(await deps.repos.turnos.reivindicar({ machineId: maquina, agora: agora + LEASE_MS + 5000 })).toBeNull();
      const estados = await trx<{ estado: string }[]>`select estado from turnos where conversa_id = ${criado.conversa.id}`;
      expect(estados.map((e) => e.estado)).toEqual(["interrompido"]);
    });
  });

  it("conversa: duas quedas na mesma conversa → UM Retomar aberto (o anterior, mesmo reaberto, fecha por regra:retomada_substituida); o aviso soma as duas", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const maquina = randomUUID();
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "primeira", inventario: PRONTO });
      const t1 = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      const r1 = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1);
      // A pessoa deixa vencer e reabre o primeiro Retomar: reaberta também é substituída.
      await deps.repos.decisoes.vencerPendentes(agora + 2 * 86_400_000);
      expect(await deps.repos.decisoes.reabrir(r1.decisoes[0] ?? "", agora + 3 * 86_400_000)).toMatchObject({ estado: "reaberta" });

      agora += 2 * 60_000;
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "segunda", inventario: PRONTO });
      const t2 = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      const r2 = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1);
      expect(r2.interrompidos).toEqual([t2]);
      const abertas = (await deps.repos.decisoes.pendentesDaConversa(criado.conversa.id)).filter((d) => d.tipo === "retomar_turno");
      expect(abertas.map((d) => d.turnoId)).toEqual([t2]);
      expect(await deps.repos.decisoes.buscar(r1.decisoes[0] ?? "")).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: "regra:retomada_substituida", regraVersao: 1 } });
      expect(t1).not.toBe(t2);
      const avisos = await deps.repos.incidentes.visiveis(0);
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({ id: r1.incidenteId, conversas: 2, rotinas: 0 });
      expect(r2.incidenteId).toBe(r1.incidenteId);
    });
  });

  // revisto em 2026-10-20 (NOD-309, PR 3, emenda da ADR-045): a rotina não cai mais calada nem perde a janela — volta para a
  // fila sozinha (pendente até a máquina puxar), com UMA linha na conversa da rotina; a execução fica aberta para a volta.
  it("rotina: 0 decisões, a retomada na fila, UMA linha 'retoma quando o contato voltar', execução aberta, aviso com a rotina; idempotente", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Taga" });
      const maquina = randomUUID();
      const { rotina, turnoId } = await rotinaRodando(deps, criado.conversa.id, criado.agente.id, maquina, agora);
      const mensagensAntes = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).length;

      const r = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1);
      expect(r).toMatchObject({ interrompidos: [turnoId], decisoes: [] });
      expect(await deps.repos.turnos.buscar(turnoId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" });
      expect(await deps.repos.decisoes.pendentesDaConversa(criado.conversa.id)).toEqual([]);
      const novas = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).slice(mensagensAntes);
      expect(novas.map((m) => m.texto)).toEqual([expect.stringMatching(/está sem contato\. Esta execução da rotina fica na fila e retoma quando o contato voltar/)]);
      const volta = (await deps.repos.turnos.listarDaConversa(criado.conversa.id, 50)).find((t) => t.origem === "retomada" && t.retomaTurnoId === turnoId);
      expect(volta).toMatchObject({ estado: "pendente" });
      expect(volta!.entradaTexto.startsWith(ENTRADA_DA_RETOMADA_DA_QUEDA)).toBe(true);
      expect(await deps.repos.rotinaExecucoes.listar(rotina.id)).toEqual([]);
      expect(await deps.repos.incidentes.visiveis(0)).toMatchObject([{ id: r.incidenteId, rotinas: 1, conversas: 0, agentes: [criado.agente.id] }]);
      const eventos = await trx<{ kind: string; dados: Record<string, unknown> }[]>`select kind, dados from events where turno_id = ${turnoId} and created_at > ${new Date(agora)}`;
      expect(eventos.map((e) => e.kind).sort()).toEqual(["mensagem_criada", "turno_interrompido"]);
      expect(eventos.find((e) => e.kind === "turno_interrompido")?.dados).toMatchObject({ espera_no_fundo: "maquina_sem_contato", espera_da_cota: "espera", volta_turno_id: volta!.id });

      expect(await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 5000)).toEqual({ interrompidos: [], decisoes: [] });
      expect(await deps.repos.rotinaExecucoes.listar(rotina.id)).toHaveLength(0);
      expect(await deps.repos.incidentes.visiveis(0)).toMatchObject([{ rotinas: 1 }]);
    });
  });

  it("ligação (NOD-168): lease vencido → interrompido, 0 decisões, 0 mensagens de sistema, o evento do turno; o aviso conta a conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const maquina = randomUUID();
      const { turno } = (await executar(deps, ligar, { agenteId: criado.agente.id, contexto: CONTEXTO_LIGACAO, executor: "local", iniciadaPor: "produto" })).data;
      expect((await deps.repos.turnos.reivindicar({ machineId: maquina, agora, aceitaLigacao: true }))?.id).toBe(turno.id);
      const mensagensAntes = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).length;

      const r = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1);
      expect(r).toMatchObject({ interrompidos: [turno.id], decisoes: [] });
      expect(await deps.repos.turnos.buscar(turno.id)).toMatchObject({ origem: "ligacao", estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" });
      expect(await deps.repos.decisoes.pendentesDaConversa(criado.conversa.id)).toEqual([]);
      expect(await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).toHaveLength(mensagensAntes);
      // O evento fica: é por ele que o orquestrador sabe que o cérebro caiu (ADR-072).
      const eventos = await trx<{ kind: string }[]>`select kind from events where turno_id = ${turno.id} and created_at > ${new Date(agora)}`;
      expect(eventos.map((e) => e.kind)).toEqual(["turno_interrompido"]);
      expect(await deps.repos.incidentes.visiveis(0)).toMatchObject([{ id: r.incidenteId, conversas: 1, rotinas: 0 }]);
      expect(await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 5000)).toEqual({ interrompidos: [], decisoes: [] });
    });
  });

  it("modo compartilhado: sem sinal desde antes do boot é reinicio_servidor, sem aviso do Mac; o aviso fica em curso até a máquina voltar a puxar", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const antiga = randomUUID();
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "antes do reinício", inventario: PRONTO });
      const doServidor = (await executar(deps, despacharTurno, { machineId: antiga, inventario: PRONTO })).data.plano?.turnoId ?? "";
      const metricas = criarMetricas();
      // O processo subiu DEPOIS do último sinal do turno: quem o perdeu foi o servidor reiniciado.
      const reinicio = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1, { metricas, inicioDoProcesso: agora + 1, ultimoContato: () => null });
      expect(reinicio.interrompidos).toEqual([doServidor]);
      expect(await deps.repos.turnos.buscar(doServidor)).toMatchObject({ motivoInterrupcao: "reinicio_servidor" });
      expect((await deps.repos.decisoes.buscar(reinicio.decisoes[0] ?? ""))?.frase).toContain("o servidor reiniciou");
      expect(await deps.repos.incidentes.visiveis(0)).toEqual([]);
      expect(metricas.ler({ metrica: "pos_restart", desfecho: "perdido", origem: "restart_servidor", tenant_id: MARLON.tenantId })).toBe(1);

      // Uma rotina do Mac que sumiu (o servidor seguiu no ar): aviso EM CURSO, até o Mac puxar de novo.
      const mac = randomUUID();
      const agora2 = agora + LEASE_MS + 10;
      const deps2 = depsSobreTrx(trx, MARLON, { relogio: () => agora2 });
      const { turnoId } = await rotinaRodando(deps2, criado.conversa.id, criado.agente.id, mac, agora2);
      let contato: number | null = agora2 - 10 * 60_000;
      const opcoes = { inicioDoProcesso: agora, ultimoContato: (id: string) => (id === mac ? contato : null) };
      const queda = await varrerPessoa(deps2.tx, MARLON, agora2 + LEASE_MS + 1, opcoes);
      expect(queda.interrompidos).toEqual([turnoId]);
      expect(await deps2.repos.incidentes.emCurso()).toMatchObject([{ id: queda.incidenteId, voltouEm: null, rotinas: 1, machineId: mac }]);
      // Ainda sem contato: nada muda.
      expect((await varrerPessoa(deps2.tx, MARLON, agora2 + LEASE_MS + 15_000, opcoes)).voltaram).toBeUndefined();
      // O Mac voltou a puxar: o aviso fecha com a hora da volta.
      contato = agora2 + LEASE_MS + 29_000;
      const volta = await varrerPessoa(deps2.tx, MARLON, agora2 + LEASE_MS + 30_000, opcoes);
      expect(volta.voltaram).toEqual([queda.incidenteId]);
      expect(await deps2.repos.incidentes.emCurso()).toEqual([]);
      expect(await deps2.repos.incidentes.visiveis(0)).toMatchObject([{ id: queda.incidenteId, voltouEm: agora2 + LEASE_MS + 30_000 }]);
    });
  });

  it("NOD-386: conversa com a máquina em contato — o Retomar diz que foi o servidor, sem culpar o Mac e sem incidente", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const mac = randomUUID();
      const turnoId = (await executar(deps, despacharTurno, { machineId: mac, inventario: PRONTO })).data.plano?.turnoId ?? "";
      const quando = agora + LEASE_MS + 1;
      const queda = await varrerPessoa(deps.tx, MARLON, quando, { inicioDoProcesso: 0, ultimoContato: (id: string) => (id === mac ? quando - 5_000 : null) });
      expect(queda.interrompidos).toEqual([turnoId]);
      expect(queda.decisoes).toHaveLength(1);
      expect(queda.incidenteId ?? null).toBeNull();
      const frase = (await deps.repos.decisoes.buscar(queda.decisoes[0] ?? ""))?.frase ?? "";
      expect(frase).toContain("o servidor do nod não respondeu a tempo");
      expect(frase).not.toMatch(/Mac|máquina/);
      const sistema = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.turnoId === turnoId && m.kind === "sistema");
      expect(sistema.map((m) => m.texto).join(" ")).not.toMatch(/Mac parou|máquina .* parou/);
      expect(await deps.repos.incidentes.emCurso()).toEqual([]);
    });
  });

  it("NOD-241 (CA4f/CA4i): a queda grava o último sinal — o varredor, lease_ate − LEASE_MS; o despacho recusado, a hora da recusa; o primeiro valor vence", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const sinal = async (id: string) => (await trx<{ u: Date | null }[]>`select ultimo_sinal_em as u from turnos where id = ${id}`)[0]!.u?.getTime() ?? null;
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const turnoId = (await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO })).data.plano?.turnoId ?? "";
      const leaseAte = (await deps.repos.turnos.buscar(turnoId))!.leaseAte!;
      // Notada 10 min depois (o Mac dormiu): o último sinal é a última renovação do lease, não a hora da varredura.
      expect((await varrerPessoa(deps.tx, MARLON, leaseAte + 10 * 60_000)).interrompidos).toEqual([turnoId]);
      expect(await sinal(turnoId)).toBe(leaseAte - LEASE_MS);

      // O despacho recusado (sem IA pronta na máquina): o último sinal é a hora da recusa.
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "de novo", inventario: PRONTO });
      const recusa = await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: { estado: "nao_autenticado", motivo: "faça login", em: agora } });
      const recusado = recusa.data.turno?.id ?? "";
      expect(await deps.repos.turnos.buscar(recusado)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "executor_indisponivel" });
      expect(await sinal(recusado)).toBe(agora);

      // O primeiro valor vence (coalesce): um sinal já gravado não é trocado por quem interrompe ou assenta depois.
      const primeiro = new Date(agora - 3_600_000);
      for (const fim of ["interromper", "assentar"] as const) {
        await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: fim, inventario: PRONTO });
        const id = (await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO })).data.plano?.turnoId ?? "";
        await trx`update turnos set ultimo_sinal_em = ${primeiro} where id = ${id}`;
        if (fim === "interromper") expect(await deps.repos.turnos.interromper(id, "maquina_sem_contato", { ultimoSinalEm: agora })).not.toBeNull();
        else expect(await deps.repos.turnos.assentar(id, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel", ultimoSinalEm: agora })).not.toBeNull();
        expect(await sinal(id)).toBe(primeiro.getTime());
      }
    });
  });
});

describeIntegracao("NOD-252: Parar com a máquina fora do ar termina como parada, não como queda", () => {
  it("conversa: Parar pendente + lease vencido → parado_pela_pessoa, sem Retomar, sem aviso de queda, sem métrica pos_restart", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const maquina = randomUUID();
      const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      // O Mac dorme; a pessoa aperta Parar (o lease congela e vence sem ninguém entregar).
      await deps.repos.turnos.pedirInterrupcao([turnoId], agora + 1000);

      const metricas = criarMetricas();
      const r = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1, { metricas });
      expect(r.interrompidos).toEqual([turnoId]);
      expect(r.decisoes).toEqual([]);
      expect(r.incidenteId ?? null).toBeNull();
      expect(await deps.repos.turnos.buscar(turnoId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa", leaseAte: null });
      expect(await deps.repos.decisoes.pendentesDaConversa(criado.conversa.id)).toEqual([]);
      expect(await deps.repos.incidentes.visiveis(0)).toEqual([]);
      expect((await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.turnoId === turnoId && m.kind === "sistema")).toEqual([]);
      expect(metricas.ler({ metrica: "pos_restart", desfecho: "perdido", origem: "maquina_sumida", tenant_id: MARLON.tenantId }) ?? 0).toBe(0);
      const eventos = await trx<{ kind: string; dados: { motivo?: string } }[]>`select kind, dados from events where turno_id = ${turnoId} and kind = 'turno_interrompido' and created_at > ${new Date(agora)}`;
      expect(eventos.map((e) => e.dados.motivo)).toEqual(["parado_pela_pessoa"]);
      // Idempotente.
      expect(await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 5000)).toEqual({ interrompidos: [], decisoes: [] });
    });
  });

  it("Parar e queda real ao mesmo tempo, no modo compartilhado (sem sinal desde antes do boot): o Parar vence", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const turnoId = (await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO })).data.plano?.turnoId ?? "";
      await deps.repos.turnos.pedirInterrupcao([turnoId], agora + 1000);
      const r = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1, { inicioDoProcesso: agora + 10_000, ultimoContato: () => null });
      expect(r).toMatchObject({ interrompidos: [turnoId], decisoes: [] });
      expect(await deps.repos.turnos.buscar(turnoId)).toMatchObject({ motivoInterrupcao: "parado_pela_pessoa" });
    });
  });

  it("rotina: Parar pendente + lease vencido → execução 'interrompida' (parado_pela_pessoa), sem aviso de queda", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Taga" });
      const maquina = randomUUID();
      const { rotina, turnoId } = await rotinaRodando(deps, criado.conversa.id, criado.agente.id, maquina, agora);
      await deps.repos.turnos.pedirInterrupcao([turnoId], agora + 1000);
      const mensagensAntes = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).length;

      const r = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1);
      expect(r).toMatchObject({ interrompidos: [turnoId], decisoes: [] });
      expect(await deps.repos.turnos.buscar(turnoId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      const execucoes = await deps.repos.rotinaExecucoes.listar(rotina.id);
      expect(execucoes.map((e) => [e.desfecho, e.motivo, e.turnoId])).toEqual([["interrompida", "parado_pela_pessoa", turnoId]]);
      expect(await deps.repos.incidentes.visiveis(0)).toEqual([]);
      expect(await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).toHaveLength(mensagensAntes);
    });
  });
});
