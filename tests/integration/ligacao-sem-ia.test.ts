import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { MODELOS_LIGACAO_PADRAO } from "../../src/contracts/modelos.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { encerrarLigacao, ligar, reabrirCerebroDaLigacao, type ContextoLigacao } from "../../src/use-cases/ligacoes.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { esperarErro } from "../helpers/deps-l6.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Rede de segurança da ligação no banco (definido em 2026-10-05): o segundo turno-cérebro da mesma ligação com o
 * harness forçado, o motivo de fim `sem_ia` (0055) e o evento do turno-cérebro que leva por que ele parou.
 */
const escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
const contexto: ContextoLigacao = { permitido: true, habilitada: true, maquinaComLigacao: true, iaPronta: true, codexSemVoz: false, drenando: false, vozDisponivel: true, vivasNoServidor: 0, maxSimultaneas: 20, limiteDiarioMs: 0, inicioDoDia: 0, provedorStt: "falso", provedorTts: "falso" };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false };
const FALHA = { desfecho: "falha" as const, motivoFalha: "erro_execucao" as const, texto: "", sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };

describeIntegracao("rede de segurança da ligação: outro turno-cérebro na mesma ligação", () => {
  it("reabrir força o harness escolhido (o modelo de voz é o dele), na mesma ligação, sem mexer na preferência do bot", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      // Um modelo do Claude escolhido no perfil: com o Codex forçado, o turno novo não pode herdá-lo (o plano recusaria).
      await editarPerfil(deps, { agenteId, harness: "auto", modelo: "haiku" });
      const { ligacao, turno: primeiro } = (await ligar(deps, { agenteId, contexto, executor: "local", iniciadaPor: "produto" })).data;

      const r = await reabrirCerebroDaLigacao(deps, { ligacaoId: ligacao.id, ia: "codex-cli", iasProntas: ["claude-cli", "codex-cli"], executor: "local" });
      const novo = r.data.turno;
      expect(novo.id).not.toBe(primeiro.id);
      expect(novo).toMatchObject({ origem: "ligacao", ligacaoId: ligacao.id, conversaId, agenteId, harness: "codex-cli", modelo: "auto", estado: "pendente" });
      expect(r.data.ligacao).toMatchObject({ id: ligacao.id, religacoes: 1 });
      expect((await repos.ligacoes.buscar(ligacao.id))?.religacoes).toBe(1);
      expect(r.events?.map((e) => e.kind)).toEqual(["ligacao_mudou"]);
      expect(r.events?.[0]).toMatchObject({ turnoId: novo.id, conversaId, dados: { ligacao_id: ligacao.id, cerebro_reaberto: true, harness: "codex-cli" } });

      const plano = (await emitirPlanoTurno(deps, { turnoId: novo.id, machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto }, harnessPreferido: "claude-cli" })).data;
      expect(plano.harness).toBe("codex-cli");
      expect(plano.modoTurno).toBe("ligacao");
      // NOD-183: o prompt de voz substitui o de texto; as partes do de texto não vão junto.
      expect(plano.promptSistemaPartes).toBeUndefined();
      expect(plano.ligacaoVoz).toMatchObject({ ligacaoId: ligacao.id, modelo: MODELOS_LIGACAO_PADRAO["codex-cli"].modelo });
      // A preferência do bot é da pessoa: continuar a ligação com outra IA não a troca.
      // (0068: o `auto` com modelo do Claude é gravado como o Claude fixo, que é como ele já rodava.)
      expect(await repos.agentes.buscar(agenteId)).toMatchObject({ harness: "claude-cli", modelo: "haiku", inteligencia: { modo: "fixa", fixa: "claude-cli" } });
      // A linha "Chat de voz" é uma só.
      expect((await repos.mensagens.listarDaConversa(conversaId, 20)).filter((m) => m.payload?.kind === "ligacao")).toHaveLength(1);
    });
  });

  it("recusa a IA que não está pronta, a ligação encerrada e a ligação que não existe; em simulação não confere a IA", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      const { ligacao } = (await ligar(deps, { agenteId, contexto, executor: "catcher", iniciadaPor: "produto" })).data;
      await esperarErro(() => reabrirCerebroDaLigacao(deps, { ligacaoId: ligacao.id, ia: "codex-cli", iasProntas: ["claude-cli"] }), "estado_invalido");
      await esperarErro(() => reabrirCerebroDaLigacao(deps, { ligacaoId: ligacao.id, ia: "codex-cli", iasProntas: [] }), "estado_invalido");
      await esperarErro(() => reabrirCerebroDaLigacao(deps, { ligacaoId: randomUUID(), ia: "codex-cli", iasProntas: null }), "nao_encontrado");
      expect((await repos.ligacoes.buscar(ligacao.id))?.religacoes).toBe(0);
      // Simulação (catcher): não há inventário de IA para conferir.
      expect((await reabrirCerebroDaLigacao(deps, { ligacaoId: ligacao.id, ia: "codex-cli", iasProntas: null })).data.turno.harness).toBe("codex-cli");
      await repos.ligacoes.encerrar(ligacao.id, { motivo: "pessoa_desligou", agora: agora() });
      await esperarErro(() => reabrirCerebroDaLigacao(deps, { ligacaoId: ligacao.id, ia: "codex-cli", iasProntas: null }), "estado_invalido");
    });
  });

  it("a ligação que ninguém resolveu encerra com `sem_ia` (o CHECK da 0055 aceita) e a linha da conversa fecha", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      const { ligacao } = (await ligar(deps, { agenteId, contexto, executor: "catcher", iniciadaPor: "produto" })).data;
      await repos.ligacoes.atender(ligacao.id, agora());
      const fim = (await encerrarLigacao(deps, { ligacaoId: ligacao.id, motivo: "sem_ia" })).data;
      expect(fim).toMatchObject({ estado: "encerrada", motivoFim: "sem_ia" });
      const linha = (await repos.mensagens.listarDaConversa(conversaId, 20)).find((m) => m.payload?.kind === "ligacao");
      expect(linha?.texto).toMatch(/^Chat de voz · \d\d:\d\d$/);
    });
  });

  it("o turno-cérebro que falha conta por que parou no evento, só em código: motivo, harness e a causa 'conta sem acesso'", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      // A trava da fila da pessoa ANTES da ligação (definido em 2026-10-10): `ligar` ocupa o índice "uma ligação viva por
      // pessoa" e `reivindicar` pede a trava da pessoa. Outro teste de ligação em paralelo, na mesma pessoa, faz na ordem
      // contrária, e as duas transações se travavam (deadlock medido no `check` de 2026-10-10, também sem este PR).
      await trx`select pg_advisory_xact_lock(hashtext(${`${escopo.tenantId}:${escopo.pessoaId}`}))`;
      const { turno } = (await ligar(deps, { agenteId, contexto, executor: "local", iniciadaPor: "produto" })).data;
      const machineId = randomUUID();
      expect((await repos.turnos.reivindicar({ machineId, agora: agora(), aceitaLigacao: true }))?.id).toBe(turno.id);
      // O resultado como o laço de voz do Claude o entrega (comContaSemAcesso, src/domain/conta-da-ia.ts).
      const r = await assentarTurno(deps, { turnoId: turno.id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: { ...FALHA, motivoFalha: "nao_autenticado", causaSemIa: "conta_sem_acesso", erroCru: "Your organization has disabled Claude subscription access" }, executor: "local", harness: "claude-cli", outraIa: "codex-cli" });
      expect(r.data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha: "nao_autenticado" });
      // NOD-241: a entrega que interrompe grava o último sinal (a hora da entrega: a máquina estava aqui).
      const [sinal] = await trx<{ u: Date | null }[]>`select ultimo_sinal_em as u from turnos where id = ${turno.id}`;
      expect(sinal?.u?.getTime()).toBeGreaterThan(Date.now() - 60_000);
      // Um evento só para o turno, o da ligação (com `origem`): é ele que o orquestrador de voz lê.
      const eventos = r.events?.filter((e) => e.kind === "turno_interrompido") ?? [];
      expect(eventos).toHaveLength(1);
      const ev = eventos[0];
      expect(ev?.dados).toMatchObject({ origem: "ligacao", estado: "interrompido", motivo: "executor_indisponivel", motivo_falha: "nao_autenticado", harness: "claude-cli", causa_sem_ia: "conta_sem_acesso" });
      // O texto do fornecedor nunca entra no evento (vai só para o log de diagnóstico do executor).
      expect(JSON.stringify(ev?.dados)).not.toContain("organization");
      // O turno-cérebro não é repetido sozinho na outra IA nem ganha negação na conversa: quem decide é a pessoa, pelo
      // aviso da ligação (a repetição automática de assentar-turno é só da fala escrita a um bot em automático).
      expect(r.events?.some((e) => e.kind === "turno_criado")).toBe(false);
      expect((await repos.mensagens.listarDaConversa(turno.conversaId, 20)).filter((m) => m.kind === "negacao" || m.payload?.kind === "ia_trocada")).toEqual([]);
      expect((await repos.turnos.listarDaConversa(turno.conversaId, 20)).filter((t) => t.origem !== "ligacao")).toEqual([]);
    });
  });

  it("sem a causa do driver, o evento não inventa uma", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      // A trava da fila da pessoa ANTES da ligação (definido em 2026-10-10): `ligar` ocupa o índice "uma ligação viva por
      // pessoa" e `reivindicar` pede a trava da pessoa. Outro teste de ligação em paralelo, na mesma pessoa, faz na ordem
      // contrária, e as duas transações se travavam (deadlock medido no `check` de 2026-10-10, também sem este PR).
      await trx`select pg_advisory_xact_lock(hashtext(${`${escopo.tenantId}:${escopo.pessoaId}`}))`;
      const { turno } = (await ligar(deps, { agenteId, contexto, executor: "local", iniciadaPor: "produto" })).data;
      const machineId = randomUUID();
      await repos.turnos.reivindicar({ machineId, agora: agora(), aceitaLigacao: true });
      const r = await assentarTurno(deps, { turnoId: turno.id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: FALHA, executor: "local" });
      const dados = r.events?.find((e) => e.kind === "turno_interrompido")?.dados ?? {};
      expect(dados).toMatchObject({ origem: "ligacao", motivo: "sem_progresso", harness: null });
      expect("causa_sem_ia" in dados).toBe(false);
    });
  });
});
