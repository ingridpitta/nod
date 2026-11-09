import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { ContaAnunciada } from "../../src/contracts/contas-ia.ts";
import { CAPACIDADES_HARNESS, type IdHarness } from "../../src/contracts/harness.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { promoverNaRede } from "../../src/use-cases/coordenar-trabalhos.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-312: o turno de conversa que recomeça sem a sessão que a conversa tinha guarda o porquê (turnos.motivo_recomeco),
 * leva o aviso na entrada e avisa a web no turno_despachado. A regra de sessão (ADR-107) não muda: os mesmos cenários
 * de sessao-por-maquina.test.ts seguem decidindo o mesmo `sessaoCli`.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.now();
const pronto: Inventario = { estado: "pronto", versao: "teste", em: AGORA };
const MODELO: Record<"claude-cli" | "codex-cli", string> = { "claude-cli": "sonnet", "codex-cli": "gpt-6-astra" };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const TOKENS = { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 };
const sucesso = (sessaoCli: string | null): ResultadoTurno => ({ desfecho: "sucesso", texto: "feito", sessaoCli, sinais: SINAIS, custoUsd: 0.1, tokens: TOKENS, ferramentasChamadas: [], negacoesPermissao: [] });
const rejeitada: ResultadoTurno = {
  desfecho: "interrompido", motivoInterrupcao: "sessao_rejeitada", texto: "", sessaoCli: null, sinais: { ...SINAIS, rejected: true, promptSubmitted: false, producedOutput: false },
  custoUsd: null, tokens: TOKENS, ferramentasChamadas: [], negacoesPermissao: [],
};
const codexRetoma = { "codex-cli": { ...CAPACIDADES_HARNESS["codex-cli"], retomaSessao: true }, "claude-cli": CAPACIDADES_HARNESS["claude-cli"] };

const anuncio = (n: number, apelido: string): ContaAnunciada => ({ impressao: n.toString(16).padStart(64, "0"), ia: "codex-cli", estado: "pronta", plano: "Plus", corporativa: false, logadaEm: AGORA - 60_000, apelidoSugerido: apelido });

const SEM_SESSAO = Symbol("sem-sessao");
const semResume = { ...codexRetoma, "codex-cli": { ...CAPACIDADES_HARNESS["codex-cli"], retomaSessao: false } };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
/** `reusar`: o mesmo bot e a mesma conversa, com outras capacidades da máquina (revisão 11). */
async function montar(trx: Trx, capacidades: typeof codexRetoma = codexRetoma, reusar?: Awaited<ReturnType<typeof agenteComConversa>>) {
  const base = reusar ?? await agenteComConversa(trx, MARLON, { nome: "Gil" });
  if (!reusar) await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const agora = () => Date.now();
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const enfileirar = (harness: "claude-cli" | "codex-cli", extra: Record<string, unknown> = {}) =>
    base.repos.turnos.enfileirar({ executor: "local", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "roda os testes", entradaConfianca: "confiavel", modelo: MODELO[harness], harness, ...extra });
  const emitir = async (turnoId: string, p: { machineId: string; ias: readonly IdHarness[]; ponte?: boolean }) =>
    emitirPlanoTurno(deps, { turnoId, machineId: p.machineId, executor: "local", harnesses: Object.fromEntries(p.ias.map((ia) => [ia, pronto])), capacidadesDaMaquina: capacidades, ...(p.ponte ? { sessaoPorMaquina: true } : {}) });
  /** Um turno inteiro: fila, máquina, plano e assentar com a sessão `sessao` (null = recusada). */
  // Revisão 10: `SEM_SESSAO` = sucesso sem sessão, como o `codex exec` (a IA que não retoma) devolve de verdade.
  const rodar = async (harness: "claude-cli" | "codex-cli", machineId: string, sessao: string | null | typeof SEM_SESSAO, ponte = true) => {
    const t = (await enfileirar(harness))!;
    expect((await base.repos.turnos.reivindicar({ machineId, agora: Date.now() }))?.id).toBe(t.id);
    const r = await emitir(t.id, { machineId, ias: [harness], ponte });
    await assentarTurno(deps, { turnoId: t.id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: sessao ? "feito" : "" }, resultado: sessao === SEM_SESSAO ? sucesso(null) : sessao ? sucesso(sessao) : rejeitada, executor: "local", harness });
    return { turno: t, plano: r.data, evento: (r.events ?? []).find((e) => e.kind === "turno_despachado")! };
  };
  const motivoNoBanco = async (id: string) => (await trx<{ motivo_recomeco: string | null }[]>`select motivo_recomeco from turnos where id = ${id}`)[0]!.motivo_recomeco;
  return { ...base, deps, enfileirar, emitir, rodar, motivoNoBanco, trx };
}

describeIntegracao("NOD-312: o bot avisa quando recomeça sem a sessão", () => {
  it("troca de IA: aviso na entrada, motivo no turno, no evento, no Raio-X e na fala; o turno seguinte retoma e não avisa de novo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      const t1 = await m.rodar("claude-cli", a, "sessao-do-claude");
      expect(t1.plano.entrada.sessaoCli).toBeNull();
      expect(await m.motivoNoBanco(t1.turno.id)).toBeNull(); // sem sessão anterior, nada a perder

      const t2 = await m.rodar("codex-cli", a, "thread-do-codex");
      expect(t2.plano.entrada.sessaoCli).toBeNull();
      expect(t2.plano.entrada.texto).toContain("[nod] Você recomeçou sem a memória da sessão anterior (a conversa passou para outra IA)");
      expect(t2.plano.entrada.texto.startsWith("roda os testes")).toBe(true);
      expect(t2.evento.dados).toMatchObject({ motivo_recomeco: "troca_de_ia" });
      expect(await m.motivoNoBanco(t2.turno.id)).toBe("troca_de_ia");
      const rx = await m.repos.raioX.doTurno(t2.turno.id);
      expect(rx?.composicao?.recomeco).toMatchObject({ motivo: "troca_de_ia" });
      expect(rx?.composicao?.recomeco?.avisoChars).toBeGreaterThan(50);
      const falas = await m.repos.mensagens.listarComTurno(m.conversaId);
      expect(falas.find((f) => f.turnoId === t2.turno.id)?.motivoRecomeco).toBe("troca_de_ia");
      expect(falas.find((f) => f.turnoId === t1.turno.id)?.motivoRecomeco).toBeUndefined();

      // Uma vez por mudança: o turno seguinte, na mesma IA, retoma a sessão nova e não leva aviso.
      const t3 = await m.rodar("codex-cli", a, "thread-do-codex");
      expect(t3.plano.entrada.sessaoCli).toBe("thread-do-codex");
      expect(t3.plano.entrada.texto).not.toContain("[nod] Você recomeçou");
      expect(t3.evento.dados).not.toHaveProperty("motivo_recomeco");
      expect(await m.motivoNoBanco(t3.turno.id)).toBeNull();
    });
  });

  it("troca para uma IA que não retoma nesta máquina (sem sessão, como o codex exec): avisa uma vez, e o turno seguinte nela não (revisões 7 e 10)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, semResume);
      const a = randomUUID();
      await m.rodar("claude-cli", a, "sessao-do-claude");
      const t2 = await m.rodar("codex-cli", a, SEM_SESSAO);
      expect(t2.plano.entrada.sessaoCli).toBeNull();
      expect(t2.plano.entrada.texto).toContain("(a conversa passou para outra IA)");
      expect(await m.motivoNoBanco(t2.turno.id)).toBe("troca_de_ia");
      for (let i = 0; i < 2; i++) {
        const t3 = await m.rodar("codex-cli", a, SEM_SESSAO);
        expect(t3.plano.entrada.texto).not.toContain("[nod] Você recomeçou");
        expect(await m.motivoNoBanco(t3.turno.id)).toBeNull();
      }
      // De volta ao Claude: a sessão dele segue na conversa (o Codex não gravou nenhuma) — retoma, nada a avisar.
      const t4 = await m.rodar("claude-cli", a, "sessao-do-claude");
      expect(t4.plano.entrada.sessaoCli).toBe("sessao-do-claude");
      expect(await m.motivoNoBanco(t4.turno.id)).toBeNull();
    });
  });

  it("revisão 11: Claude → Codex que não retoma → Claude com a sessão largada pela troca manual: avisa a volta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, semResume);
      const a = randomUUID();
      await m.rodar("claude-cli", a, "sessao-do-claude");
      await m.rodar("codex-cli", a, SEM_SESSAO);
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, null); // a troca manual zera a sessão da conversa
      const t4 = await m.rodar("claude-cli", a, "sessao-nova-do-claude");
      expect(t4.plano.entrada.sessaoCli).toBeNull();
      expect(t4.plano.entrada.texto).toContain("(a conversa passou para outra IA)");
      expect(await m.motivoNoBanco(t4.turno.id)).toBe("troca_de_ia");
    });
  });

  it("revisão 12: o turno da troca que não rodou (interrompido) não engole o aviso do turno seguinte", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      await m.rodar("claude-cli", a, "sessao-do-claude");
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, null); // a troca manual para o Codex
      const t2 = (await m.enfileirar("codex-cli"))!;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(t2.id);
      await m.emitir(t2.id, { machineId: a, ias: ["codex-cli"], ponte: true });
      expect(await m.motivoNoBanco(t2.id)).toBe("troca_de_ia");
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa' where id = ${t2.id}`;
      const t3 = await m.rodar("codex-cli", a, "thread-1");
      expect(t3.plano.entrada.texto).toContain("(a conversa passou para outra IA)");
      expect(await m.motivoNoBanco(t3.turno.id)).toBe("troca_de_ia");
    });
  });

  it("revisão 11: Claude → Codex que não retoma (avisou) → Codex que retoma: não avisa a mesma mudança de novo", async () => {
    await withRollback(MARLON, async (trx) => {
      const sem = await montar(trx, semResume);
      const a = randomUUID();
      await sem.rodar("claude-cli", a, "sessao-do-claude");
      expect(await sem.motivoNoBanco((await sem.rodar("codex-cli", a, SEM_SESSAO)).turno.id)).toBe("troca_de_ia");
      const com = await montar(trx, codexRetoma, sem);
      const t3 = await com.rodar("codex-cli", a, "thread-1");
      expect(t3.plano.entrada.texto).not.toContain("[nod] Você recomeçou");
      expect(await com.motivoNoBanco(t3.turno.id)).toBeNull();
    });
  });

  it("IA que não retoma: a retomada de conversa (aprovação respondida) que avisou conta como último turno (revisão 10)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, semResume);
      const a = randomUUID();
      const t0 = await m.rodar("claude-cli", a, "sessao-do-claude");
      const r1 = (await m.enfileirar("codex-cli", { origem: "retomada", retomaTurnoId: t0.turno.id }))!;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(r1.id);
      await m.emitir(r1.id, { machineId: a, ias: ["codex-cli"], ponte: true });
      expect(await m.motivoNoBanco(r1.id)).toBe("troca_de_ia");
      await assentarTurno(m.deps, { turnoId: r1.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso(null), executor: "local", harness: "codex-cli" });
      const t2 = await m.rodar("codex-cli", a, SEM_SESSAO);
      expect(t2.plano.entrada.texto).not.toContain("[nod] Você recomeçou");
      expect(await m.motivoNoBanco(t2.turno.id)).toBeNull();
    });
  });

  it("o turno da troca promovido pela rede de 2 min (sessão largada) conta como último: o seguinte não avisa de novo (revisão 8)", async () => {
    for (const [caps, sessao] of [[codexRetoma, "thread-1"], [semResume, null]] as const) {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx, caps);
        const a = randomUUID();
        await m.rodar("claude-cli", a, "sessao-do-claude");
        const t1 = (await m.enfileirar("codex-cli"))!;
        await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() });
        await m.emitir(t1.id, { machineId: a, ias: ["codex-cli"], ponte: true });
        expect(await m.motivoNoBanco(t1.id)).toBe("troca_de_ia");
        const r = await promoverNaRede(m.deps, { turnoId: t1.id, despachadoEm: Date.now() - 200_000, fezFerramenta: true, harness: "codex-cli", sessaoCli: sessao, sessaoExecutor: "local", maquinaBifurca: false, modo: "conversa" });
        expect(r.data.trabalho?.origem).toBe("rede");
        await m.repos.conversas.atualizarSessaoCli(m.conversaId, null); // largar_sessao, como na máquina que não bifurca
        await assentarTurno(m.deps, { turnoId: t1.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso(sessao), executor: "local", harness: "codex-cli" });
        const t2 = (await m.enfileirar("codex-cli"))!;
        const plano = await m.emitir(t2.id, { machineId: a, ias: ["codex-cli"], ponte: true });
        expect(plano.data.entrada.texto).not.toContain("[nod] Você recomeçou");
        expect(await m.motivoNoBanco(t2.id)).toBeNull();
      });
    }
  });

  it("troca manual de IA zera a sessão da conversa antes do turno: o aviso sai mesmo assim", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      await m.rodar("claude-cli", a, "sessao-do-claude");
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, null);
      const t2 = await m.rodar("codex-cli", a, "thread");
      expect(await m.motivoNoBanco(t2.turno.id)).toBe("troca_de_ia");
    });
  });

  it("troca de máquina na ponte: 'troca_de_maquina'; fora da ponte a sessão segue e nada é avisado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const [a, b] = [randomUUID(), randomUUID()];
      await m.rodar("claude-cli", a, "sessao-da-a");
      const naB = await m.rodar("claude-cli", b, "sessao-da-b");
      expect(naB.plano.entrada.sessaoCli).toBeNull();
      expect(await m.motivoNoBanco(naB.turno.id)).toBe("troca_de_maquina");
      // No Claude, a troca de conta não perde a sessão: o turno seguinte na mesma máquina retoma.
      const deNovo = await m.rodar("claude-cli", b, "sessao-da-b");
      expect(deNovo.plano.entrada.sessaoCli).toBe("sessao-da-b");
      expect(await m.motivoNoBanco(deNovo.turno.id)).toBeNull();
    });
  });

  it("sessão recusada: a repetição nasce com 'sessao_recusada' e a emissão não troca o motivo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      await m.rodar("claude-cli", a, "sessao-que-sumiu");
      const t2 = await m.rodar("claude-cli", a, null);
      expect(t2.plano.entrada.sessaoCli).toBe("sessao-que-sumiu"); // a regra não mudou: tentou retomar
      const [rep] = await trx<{ id: string; motivo_recomeco: string | null }[]>`select id, motivo_recomeco from turnos where conversa_id = ${m.conversaId} and reenvios = 1`;
      expect(rep?.motivo_recomeco).toBe("sessao_recusada");
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(rep!.id);
      const r = await m.emitir(rep!.id, { machineId: randomUUID(), ias: ["claude-cli"], ponte: true });
      expect(r.data.entrada.sessaoCli).toBeNull();
      expect(r.data.entrada.texto).toContain("a IA recusou a sessão anterior");
      expect((r.events ?? []).find((e) => e.kind === "turno_despachado")?.dados).toMatchObject({ motivo_recomeco: "sessao_recusada" });
      expect(await m.motivoNoBanco(rep!.id)).toBe("sessao_recusada");
    });
  });

  it("a repetição da sessão recusada absorvida por uma fala mais antiga leva o motivo junto (revisão 9)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      await m.rodar("claude-cli", a, "sessao-que-sumiu");
      const fala = async (texto: string) => (await m.repos.mensagens.criar({ conversaId: m.conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto, confianca: "confiavel" }))!.id;
      const t2 = (await m.enfileirar("claude-cli", { mensagemOrigemId: await fala("roda os testes") }))!;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(t2.id);
      await m.emitir(t2.id, { machineId: a, ias: ["claude-cli"], ponte: true });
      // A pessoa manda outra fala enquanto o turno roda; aí o CLI recusa a sessão.
      const tp = (await m.enfileirar("claude-cli", { mensagemOrigemId: await fala("e o lint também"), entradaTexto: "e o lint também" }))!;
      await assentarTurno(m.deps, { turnoId: t2.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: rejeitada, executor: "local", harness: "claude-cli" });
      const [rep] = await trx<{ id: string }[]>`select id from turnos where conversa_id = ${m.conversaId} and reenvios = 1`;
      expect(await m.motivoNoBanco(rep!.id)).toBe("sessao_recusada");
      const vez = await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() });
      expect(vez?.id).toBe(tp.id); // a fala mais antiga sai primeiro e absorve a repetição
      const { absorvidos } = await m.repos.turnos.absorverPendentes(vez!, (t) => t.join("\n"));
      expect(absorvidos.map((x) => x.id)).toContain(rep!.id);
      expect(await m.motivoNoBanco(tp.id)).toBe("sessao_recusada");
      const r = await m.emitir(tp.id, { machineId: a, ias: ["claude-cli"], ponte: true });
      expect(r.data.entrada.sessaoCli).toBeNull();
      expect(r.data.entrada.texto).toContain("a IA recusou a sessão anterior");
    });
  });

  it("IA que não retoma: um turno do meio cancelado na fila (sem IA gravada) não engole o aviso (revisão 9)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, semResume);
      const a = randomUUID();
      await m.rodar("claude-cli", a, "sessao-do-claude");
      const cancelado = (await m.enfileirar("codex-cli"))!;
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa' where id = ${cancelado.id}`;
      const t3 = await m.rodar("codex-cli", a, SEM_SESSAO);
      expect(await m.motivoNoBanco(t3.turno.id)).toBe("troca_de_ia");
    });
  });

  it("nada em rotina, em pedido de colega nem depois do /nova-sessao", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const [a, b] = [randomUUID(), randomUUID()];
      await m.rodar("claude-cli", a, "sessao-da-a");
      for (const origem of ["rotina", "peer"] as const) {
        const t = (await m.enfileirar("claude-cli", { origem }))!;
        expect((await m.repos.turnos.reivindicar({ machineId: b, agora: Date.now() }))?.id).toBe(t.id);
        const r = await m.emitir(t.id, { machineId: b, ias: ["claude-cli"], ponte: true });
        expect(r.data.entrada.texto).not.toContain("[nod] Você recomeçou");
        expect(await m.motivoNoBanco(t.id)).toBeNull();
        await trx`update turnos set estado = 'concluido' where id = ${t.id}`;
      }
      await m.repos.conversas.recomecar(m.conversaId);
      const depois = await m.rodar("claude-cli", b, "sessao-da-b");
      expect(depois.plano.entrada.texto).not.toContain("[nod] Você recomeçou");
      expect(await m.motivoNoBanco(depois.turno.id)).toBeNull();
    });
  });

  it("retomada de rotina, de delegação e sob procuração, em outra máquina na ponte: nunca avisa (revisão 1)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const [a, b] = [randomUUID(), randomUUID()];
      await m.rodar("claude-cli", a, "sessao-da-a");
      // A raiz de cada cadeia: a rotina com a janela ligada, a delegação e o pedido de conversa sob procuração.
      const rotina = (await m.enfileirar("claude-cli", { origem: "rotina" }))!;
      const r = await m.repos.rotinas.criar({ agenteId: m.agenteId, conversaId: m.conversaId, cron: "0 8 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", exigeAprovacao: false, proximaExecucao: Date.now() + 1000 });
      const instante = Date.now();
      await m.repos.rotinaJanelas.reivindicar({ rotinaId: r!.id, instanteAgendado: instante, machineId: b, executor: "local" });
      await m.repos.rotinaJanelas.vincularTurno({ rotinaId: r!.id, instanteAgendado: instante, turnoId: rotina.id });
      const delegacao = (await m.enfileirar("claude-cli", { origem: "delegacao", profundidade: 1, sobProcuracaoDe: PESSOA_MARLON }))!;
      const procuracao = (await m.enfileirar("claude-cli", { sobProcuracaoDe: PESSOA_MARLON }))!;
      await trx`update turnos set estado = 'concluido' where id in (${rotina.id}, ${delegacao.id}, ${procuracao.id})`;
      for (const raiz of [rotina, delegacao, procuracao]) {
        // A retomada da delegação não copia a procuração aqui: a cadeia sozinha tem de bastar.
        const extra = raiz === procuracao ? { sobProcuracaoDe: PESSOA_MARLON } : {};
        const t = (await m.enfileirar("claude-cli", { origem: "retomada", retomaTurnoId: raiz.id, ...extra }))!;
        expect((await m.repos.turnos.reivindicar({ machineId: b, agora: Date.now() }))?.id).toBe(t.id);
        const plano = await m.emitir(t.id, { machineId: b, ias: ["claude-cli"], ponte: true });
        expect(plano.data.entrada.texto).not.toContain("[nod] Você recomeçou");
        expect(await m.motivoNoBanco(t.id)).toBeNull();
        await trx`update turnos set estado = 'concluido' where id = ${t.id}`;
      }
    });
  });

  it("a sessão de uma retomada de rotina não conta como a da conversa: depois do /nova-sessao, nada a avisar (revisão 2)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const [a, b] = [randomUUID(), randomUUID()];
      await m.rodar("claude-cli", a, "sessao-da-a");
      await m.repos.conversas.recomecar(m.conversaId);
      await new Promise((r) => setTimeout(r, 5));
      const rotina = (await m.enfileirar("claude-cli", { origem: "rotina" }))!;
      await trx`update turnos set estado = 'concluido' where id = ${rotina.id}`;
      // A retomada da rotina roda na máquina B e grava a sessão dela no turno.
      const ret = (await m.enfileirar("claude-cli", { origem: "retomada", retomaTurnoId: rotina.id }))!;
      expect((await m.repos.turnos.reivindicar({ machineId: b, agora: Date.now() }))?.id).toBe(ret.id);
      await m.emitir(ret.id, { machineId: b, ias: ["claude-cli"], ponte: true });
      await assentarTurno(m.deps, { turnoId: ret.id, machineId: b, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso("sessao-da-rotina"), executor: "local", harness: "claude-cli" });
      expect((await trx<{ sessao_cli: string | null }[]>`select sessao_cli from turnos where id = ${ret.id}`)[0]?.sessao_cli).toBe("sessao-da-rotina");
      // A pessoa volta a falar, na máquina A: a conversa não tinha sessão depois do /nova-sessao.
      const depois = await m.rodar("claude-cli", a, "sessao-nova-da-a");
      expect(depois.plano.entrada.texto).not.toContain("[nod] Você recomeçou");
      expect(await m.motivoNoBanco(depois.turno.id)).toBeNull();
    });
  });

  it("a retomada de um pedido de conversa segue contando (a raiz é de conversa)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const [a, b] = [randomUUID(), randomUUID()];
      const raiz = (await m.enfileirar("claude-cli"))!;
      await trx`update turnos set estado = 'concluido' where id = ${raiz.id}`;
      const ret = (await m.enfileirar("claude-cli", { origem: "retomada", retomaTurnoId: raiz.id }))!;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(ret.id);
      await m.emitir(ret.id, { machineId: a, ias: ["claude-cli"], ponte: true });
      await assentarTurno(m.deps, { turnoId: ret.id, machineId: a, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso("sessao-da-retomada"), executor: "local", harness: "claude-cli" });
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, null);
      const naB = await m.rodar("claude-cli", b, "sessao-da-b");
      expect(await m.motivoNoBanco(naB.turno.id)).toBe("troca_de_maquina");
    });
  });

  it("turno de trabalho: nunca avisa, mesmo trocando de IA (revisão 3)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      await m.rodar("claude-cli", a, "sessao-do-claude");
      const { trabalho } = await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Dashboard", origem: "pessoa" });
      const t = (await m.enfileirar("codex-cli", { trabalhoId: trabalho.id }))!;
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(t.id);
      const r = await m.emitir(t.id, { machineId: a, ias: ["codex-cli"], ponte: true });
      expect(r.data.entrada.texto).not.toContain("[nod] Você recomeçou");
      expect(await m.motivoNoBanco(t.id)).toBeNull();
    });
  });

  it("/compactar ou skill do CLI (\"/review 123\") depois da troca de IA: a entrada segue crua e o motivo fica gravado (revisões 3 e 5)", async () => {
    for (const entradaTexto of ["/compactar", "/review 123"]) {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const a = randomUUID();
        await m.rodar("claude-cli", a, "sessao-do-claude");
        const t = (await m.enfileirar("codex-cli", { entradaTexto }))!;
        expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(t.id);
        const r = await m.emitir(t.id, { machineId: a, ias: ["codex-cli"], ponte: true });
        expect(r.data.entrada.texto).not.toContain("[nod]");
        expect(await m.motivoNoBanco(t.id)).toBe("troca_de_ia");
        // QA (bug 2): o Raio-X diz "recomeçou" como a marca da fala, sem aviso nem resumo na entrada.
        expect((await m.repos.raioX.doTurno(t.id))?.composicao?.recomeco).toMatchObject({ motivo: "troca_de_ia", avisoChars: 0, resumoChars: 0 });
      });
    }
  });

  it("QA: o motivo é gravado uma vez só — o segundo registro não sobrescreve o primeiro", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      await m.rodar("claude-cli", a, "sessao-do-claude");
      const t = (await m.enfileirar("codex-cli"))!;
      await m.repos.turnos.registrarMotivoRecomeco(t.id, "sessao_recusada");
      await m.repos.turnos.registrarMotivoRecomeco(t.id, "troca_de_ia");
      expect(await m.motivoNoBanco(t.id)).toBe("sessao_recusada");
    });
  });

  it("o resumo falha: o turno segue só com o aviso e o log registra (revisão 3)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      await m.rodar("claude-cli", a, "sessao-do-claude");
      const saida = vi.spyOn(console, "log").mockImplementation(() => {});
      const falha = vi.spyOn(m.repos.turnos, "ultimosDaConversa").mockRejectedValue(new TypeError("quebrou"));
      try {
        const t = (await m.enfileirar("codex-cli"))!;
        expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(t.id);
        const r = await m.emitir(t.id, { machineId: a, ias: ["codex-cli"], ponte: true });
        expect(falha).toHaveBeenCalled();
        expect(r.data.entrada.texto).toContain("[nod] Você recomeçou sem a memória da sessão anterior");
        expect(r.data.entrada.texto).not.toContain("[nod] Resumo do trabalho");
        expect(await m.motivoNoBanco(t.id)).toBe("troca_de_ia");
        const linhas = saida.mock.calls.map((c) => String(c[0]));
        expect(linhas.some((l) => l.includes("resumo_do_recomeco_falhou") && l.includes("TypeError"))).toBe(true);
      } finally {
        falha.mockRestore();
        saida.mockRestore();
      }
    });
  });

  it("troca de conta no Codex, na mesma máquina: 'troca_de_conta' no banco, no evento, no aviso e na fala (revisão 3)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      const t1 = await m.rodar("codex-cli", a, "thread-sem-conta");
      expect(t1.plano.conta).toBeUndefined();
      // A máquina passa a ter uma conta do ChatGPT: a thread ficou na pasta de antes.
      await m.repos.contasIa.doAnuncio(a, [anuncio(9, "Pessoal")], AGORA);
      const t2 = await m.rodar("codex-cli", a, "thread-da-conta");
      expect(t2.plano.conta?.apelido).toBe("Pessoal");
      expect(t2.plano.entrada.sessaoCli).toBeNull();
      expect(t2.plano.entrada.texto).toContain("(a conversa passou para outra conta da IA)");
      expect(t2.evento.dados).toMatchObject({ motivo_recomeco: "troca_de_conta" });
      expect(await m.motivoNoBanco(t2.turno.id)).toBe("troca_de_conta");
      const falas = await m.repos.mensagens.listarComTurno(m.conversaId);
      expect(falas.find((f) => f.turnoId === t2.turno.id)?.motivoRecomeco).toBe("troca_de_conta");
      // Na mesma conta, o turno seguinte retoma e não avisa.
      const t3 = await m.rodar("codex-cli", a, "thread-da-conta");
      expect(t3.plano.entrada.sessaoCli).toBe("thread-da-conta");
      expect(await m.motivoNoBanco(t3.turno.id)).toBeNull();
    });
  });

  it("o resumo chega ao prompt da troca; um erro do Postgres no resumo não derruba a emissão (revisão 4)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      const t1 = await m.rodar("claude-cli", a, "sessao-do-claude");
      for (let i = 0; i < 2; i++) await m.repos.trilha.registrar({ agenteId: m.agenteId, turnoId: t1.turno.id, ferramenta: "nativa__Bash", kind: "tool_call", regra: "regra:chamada", regraVersao: 1 });
      const t2 = await m.rodar("codex-cli", a, "thread-do-codex");
      expect(t2.plano.entrada.texto).toContain("[nod] Resumo do trabalho nesta conversa");
      expect(t2.plano.entrada.texto).toContain("nativa__Bash × 2");
      expect(t2.plano.entrada.texto).toContain("pelo resumo do trabalho abaixo");

      // O erro de SQL dentro do resumo aborta só o savepoint: a emissão segue, grava o motivo e o Raio-X.
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, null);
      const saida = vi.spyOn(console, "log").mockImplementation(() => {});
      const falha = vi.spyOn(m.repos.trilha, "doTurnos").mockImplementation(async () => { await trx`select * from tabela_que_nao_existe`; return []; });
      try {
        const t3 = (await m.enfileirar("claude-cli"))!;
        expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(t3.id);
        const r = await m.emitir(t3.id, { machineId: a, ias: ["claude-cli"], ponte: true });
        expect(falha).toHaveBeenCalled();
        expect(r.data.entrada.texto).toContain("[nod] Você recomeçou");
        expect(r.data.entrada.texto).not.toContain("[nod] Resumo do trabalho");
        expect(r.data.entrada.texto).not.toContain("resumo do trabalho abaixo");
        expect(await m.motivoNoBanco(t3.id)).toBe("troca_de_ia");
        expect((await m.repos.raioX.doTurno(t3.id))?.composicao?.recomeco).toMatchObject({ motivo: "troca_de_ia", resumoChars: 0 });
      } finally {
        falha.mockRestore();
        saida.mockRestore();
      }
    });
  });

  it("a repetição da sessão recusada que retoma uma sessão nova (gravada por outro turno) perde a marca (revisão 4)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      await m.rodar("claude-cli", a, "sessao-que-sumiu");
      await m.rodar("claude-cli", a, null);
      const [rep] = await trx<{ id: string }[]>`select id from turnos where conversa_id = ${m.conversaId} and reenvios = 1`;
      expect(await m.motivoNoBanco(rep!.id)).toBe("sessao_recusada");
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, "sessao-nova", "local", "claude-cli", a);
      expect((await m.repos.turnos.reivindicar({ machineId: a, agora: Date.now() }))?.id).toBe(rep!.id);
      const r = await m.emitir(rep!.id, { machineId: a, ias: ["claude-cli"], ponte: true });
      expect(r.data.entrada.sessaoCli).toBe("sessao-nova");
      expect(r.data.entrada.texto).not.toContain("[nod] Você recomeçou");
      expect(await m.motivoNoBanco(rep!.id)).toBeNull();
    });
  });

  it("o resumo não leva o trabalho de antes do /nova-sessao nem o de uma retomada de rotina (revisão 6)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      const trilha = (turnoId: string, ferramenta: string) => m.repos.trilha.registrar({ agenteId: m.agenteId, turnoId, ferramenta, kind: "tool_call", regra: "regra:chamada", regraVersao: 1 });
      const velho = await m.rodar("claude-cli", a, "sessao-velha");
      await trilha(velho.turno.id, "nativa__Antes");
      await m.repos.conversas.recomecar(m.conversaId);
      await new Promise((r) => setTimeout(r, 5));
      const t1 = await m.rodar("claude-cli", a, "sessao-do-claude");
      await trilha(t1.turno.id, "nativa__Depois");
      // A retomada de uma rotina, na mesma conversa, com trilha própria.
      const rotina = (await m.enfileirar("claude-cli", { origem: "rotina" }))!;
      await trx`update turnos set estado = 'concluido' where id = ${rotina.id}`;
      const ret = (await m.enfileirar("claude-cli", { origem: "retomada", retomaTurnoId: rotina.id }))!;
      await trx`update turnos set estado = 'concluido' where id = ${ret.id}`;
      await trilha(ret.id, "nativa__DaRotina");
      const t2 = await m.rodar("codex-cli", a, "thread-do-codex");
      expect(t2.plano.entrada.texto).toContain("nativa__Depois × 1");
      expect(t2.plano.entrada.texto).not.toContain("nativa__Antes");
      expect(t2.plano.entrada.texto).not.toContain("nativa__DaRotina");
    });
  });

  it("a sessão de uma task em outra IA não vira a sessão anterior da conversa (revisão 6)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = randomUUID();
      await m.rodar("claude-cli", a, "sessao-do-claude");
      const { trabalho } = await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Task", origem: "pessoa" });
      const task = (await m.enfileirar("codex-cli", { trabalhoId: trabalho.id }))!;
      await trx`update turnos set estado = 'concluido', sessao_cli = 'thread-da-task', harness_efetivo = 'codex-cli', machine_id = ${a} where id = ${task.id}`;
      // A conversa perdeu a sessão (troca manual desfeita): a anterior é a do turno de conversa, no Claude.
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, null);
      const t = await m.rodar("claude-cli", a, "sessao-nova");
      expect(t.plano.entrada.texto).not.toContain("[nod] Você recomeçou sem a memória da sessão anterior (a conversa passou para outra IA)");
      expect(await m.motivoNoBanco(t.turno.id)).not.toBe("troca_de_ia");
    });
  });
});
