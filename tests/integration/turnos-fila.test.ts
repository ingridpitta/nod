import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { classificarResultado, interpretarLinhaStreamJson } from "../../src/domain/stream-json.ts";
import { assentarTurno, desfechoDaEntrega } from "../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { enviarMensagem, lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { depsSobreTrx, esperarErro, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const sucesso = (texto: string, extra: Partial<ResultadoTurno> = {}): ResultadoTurno => ({
  desfecho: "sucesso",
  texto,
  sessaoCli: "sessao-1",
  sinais: SINAIS,
  custoUsd: 0.0207631,
  tokens: { entrada: 120, saida: 30, cacheLeitura: 0, cacheCriacao: 0 },
  ferramentasChamadas: [],
  negacoesPermissao: [],
  ...extra,
});
const interrompido = (extra: Partial<ResultadoTurno> = {}): ResultadoTurno => ({
  desfecho: "interrompido",
  texto: "parte da resp",
  sessaoCli: null,
  sinais: { ...SINAIS, producedOutput: true },
  custoUsd: null,
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 },
  ferramentasChamadas: [],
  negacoesPermissao: [],
  ...extra,
});

describeIntegracao("fila de turnos (ADR-010): enviar → despachar → assentar, tudo transacional", () => {
  it("enviar-mensagem grava mensagem + turno + outbox e o ROLLBACK derruba os três", async () => {
    const ids = await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const { data, events } = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      expect(await deps.repos.mensagens.buscar(data.mensagem.id)).not.toBeNull();
      expect(await deps.repos.turnos.buscar(data.turno.id)).toMatchObject({ estado: "pendente" });
      const outbox = await trx<{ n: number }[]>`select count(*)::int as n from events_outbox where evento_id in ${trx(events.map((e) => e.id))}`;
      expect(outbox[0]?.n).toBe(2);
      return { mensagem: data.mensagem.id, turno: data.turno.id, eventos: events.map((e) => e.id) };
    });
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      expect(await deps.repos.mensagens.buscar(ids.mensagem)).toBeNull();
      expect(await deps.repos.turnos.buscar(ids.turno)).toBeNull();
      const outbox = await trx<{ n: number }[]>`select count(*)::int as n from events_outbox where evento_id in ${trx(ids.eventos)}`;
      expect(outbox[0]?.n).toBe(0);
    });
  });

  it("2ª mensagem não é reivindicada até a 1ª assentar; a fila é visível como 'na fila'; a 2ª leva --resume", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const m1 = (await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "primeira", inventario: PRONTO })).data;
      const maquina = randomUUID();
      // A 2ª chega com a 1ª já rodando (duas pendentes juntas seriam lidas num turno só: fila-lida-junta).
      const d1 = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data;
      const m2 = (await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "segunda", inventario: PRONTO })).data;
      expect(d1.plano).toMatchObject({ turnoId: m1.turno.id, machineId: maquina, tokenDeTurno: `tok-${m1.turno.id}`, entrada: { texto: "primeira", sessaoCli: null } });
      expect((await deps.repos.turnos.buscar(m1.turno.id))?.estado).toBe("despachando");
      expect((await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data).toMatchObject({ plano: null, motivo: "fila_vazia" });
      expect((await lerConversa(deps, { conversaId: criado.conversa.id })).data.turnosPendentes).toEqual([{ id: m2.turno.id, motivo: "agente_ocupado_em", conversaId: criado.conversa.id }]);

      const a1 = (await executar(deps, assentarTurno, { turnoId: m1.turno.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "resposta 1" }, resultado: sucesso("resposta 1") })).data;
      expect(a1.turno).toMatchObject({ estado: "concluido", custoUsd: 0.0207631, sinais: SINAIS, leaseAte: null, motivoInterrupcao: null });
      expect(a1.mensagem).toMatchObject({ kind: "texto", texto: "resposta 1", parcial: false, autoria: { autor_tipo: "agente", autor_id: criado.agente.id, conta_de_execucao: MARLON.pessoaId, machine_id: maquina } });
      expect((await deps.repos.gastos.doTurno(m1.turno.id)).map((g) => [g.custoUsd, g.tokensEntrada, g.tokensSaida])).toEqual([[0.0207631, 120, 30]]);
      expect((await deps.repos.conversas.buscar(criado.conversa.id))?.sessaoCli).toBe("sessao-1");

      const d2 = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data;
      expect(d2.plano).toMatchObject({ turnoId: m2.turno.id, entrada: { texto: "segunda", sessaoCli: "sessao-1" } });
      expect((await lerConversa(deps, { conversaId: criado.conversa.id })).data.mensagens.map((m) => m.texto)).toEqual([expect.stringContaining("identidade"), "primeira", "segunda", "resposta 1"]);
    });
  });

  it("assentar rotina ou colega não substitui a sessão interativa salva", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await deps.repos.conversas.atualizarSessaoCli(criado.conversa.id, "sessao-interativa", "local");
      for (const origem of ["rotina", "peer"] as const) {
        const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: criado.conversa.id, agenteId: criado.agente.id, origem, prazoEm: Date.now() + 600_000, profundidade: origem === "peer" ? 1 : 0, entradaTexto: "teste", entradaConfianca: "nao_confiavel", modelo: criado.agente.modelo });
        const maquina = randomUUID();
        const plano = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano;
        expect(plano?.turnoId).toBe(turno?.id);
        await executar(deps, assentarTurno, { turnoId: turno?.id ?? "", machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso("feito", { sessaoCli: "sessao-de-fundo" }) });
        expect((await deps.repos.conversas.buscar(criado.conversa.id))?.sessaoCli).toBe("sessao-interativa");
      }
    });
  });

  it("entrega é idempotente por (turno, seq_local): repetir não grava mensagem nem gasto de novo", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const maquina = randomUUID();
      const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      const entrega = { turnoId, machineId: maquina, seqLocal: 7, fala: { tipo: "texto" as const, texto: "resp" }, resultado: sucesso("resp") };
      const primeira = (await executar(deps, assentarTurno, entrega)).data;
      const segunda = (await executar(deps, assentarTurno, entrega)).data;
      expect(primeira.duplicada).toBe(false);
      expect(segunda).toMatchObject({ duplicada: true, turno: null, mensagem: null });
      expect((await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.turnoId === turnoId)).toHaveLength(1);
      expect(await deps.repos.gastos.doTurno(turnoId)).toHaveLength(1);
      await esperarErro(() => assentarTurno(deps, { ...entrega, seqLocal: 8, machineId: randomUUID() }), "nao_permitido");
    });
  });

  it("interrompido sem motivo: parado_pela_pessoa se a pessoa pediu, senão pelo sinal de saída; fala fica parcial; falha técnica guarda motivo_falha", async () => {
    expect(desfechoDaEntrega({ pararSolicitadoEm: 1, leaseAte: null }, interrompido(), 0)).toEqual({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa", motivoFalha: null });
    const mudo = { ...interrompido(), sinais: { ...interrompido().sinais, producedOutput: false } };
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: null }, mudo, 0)).toEqual({ estado: "interrompido", motivoInterrupcao: "sem_progresso", motivoFalha: null });
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: null }, interrompido({ motivoInterrupcao: "sessao_rejeitada" }), 0)).toMatchObject({ motivoInterrupcao: "sessao_rejeitada" });
    // definido em 2026-09-18 (ADR-040): quem produziu saída e não concluiu não é 'sem_progresso'.
    // O motivo_falha continua guardando o subtipo técnico, inclusive erro_max_turns da sonda.
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: null }, { ...sucesso(""), desfecho: "falha", motivoFalha: "erro_max_turns" }, 0)).toEqual({ estado: "interrompido", motivoInterrupcao: "trabalho_incompleto", motivoFalha: "erro_max_turns" });
    const semSaida = { ...sucesso(""), desfecho: "falha" as const, motivoFalha: "erro_execucao" as const, sinais: { ...sucesso("").sinais, producedOutput: false } };
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: null }, semSaida, 0)).toEqual({ estado: "interrompido", motivoInterrupcao: "sem_progresso", motivoFalha: "erro_execucao" });
    // interrompido() já vem com producedOutput: quem falou antes de morrer é trabalho incompleto.
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: null }, interrompido(), 0)).toMatchObject({ motivoInterrupcao: "trabalho_incompleto" });
    // ADR-045: lease VENCIDO sem Parar e sem sucesso é a máquina que caiu — o mesmo desfecho do varredor.
    // Sucesso com o lease vencido é trabalho terminado; Parar pedido continua sendo parado_pela_pessoa.
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: 1_000 }, interrompido(), 1_001)).toEqual({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato", motivoFalha: null });
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: 1_000 }, { ...sucesso(""), desfecho: "falha", motivoFalha: "erro_execucao" }, 1_001)).toMatchObject({ motivoInterrupcao: "maquina_sem_contato", motivoFalha: "erro_execucao" });
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: 1_000 }, sucesso("pronto"), 1_001)).toEqual({ estado: "concluido", motivoInterrupcao: null, motivoFalha: null });
    expect(desfechoDaEntrega({ pararSolicitadoEm: 900, leaseAte: 1_000 }, interrompido(), 1_001)).toMatchObject({ motivoInterrupcao: "parado_pela_pessoa" });
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: 2_000 }, interrompido(), 1_001)).toMatchObject({ motivoInterrupcao: "trabalho_incompleto" });

    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const maquina = randomUUID();
      const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      await deps.repos.turnos.pedirInterrupcao([turnoId], Date.now());
      const { data, events } = await executar(deps, assentarTurno, { turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "parte da resp" }, resultado: interrompido() });
      expect(data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa", motivoFalha: null });
      expect(data.mensagem).toMatchObject({ texto: "parte da resp", parcial: true });
      const kinds = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.turnoId === turnoId).map((m) => [m.kind, m.parcial]);
      expect(kinds).toEqual([
        ["texto", true],
        ["sistema", false],
      ]);
      expect(events.map((e) => e.kind)).toEqual(["mensagem_criada", "mensagem_criada", "turno_interrompido"]);
      // definido em 2026-09-18: a frase traduz o motivo — a pessoa lia "erro_max_turns" cru no chat.
      expect((await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id))?.texto).toContain("Turno interrompido: você pediu para parar");
    });
  });

  it("negação de permissão do CLI vira mensagem 'negacao' + evento (ADR-029), sem ser erro do turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const maquina = randomUUID();
      const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      const { data, events } = await executar(deps, assentarTurno, { turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "preciso de permissão" }, resultado: sucesso("preciso de permissão", { negacoesPermissao: ["mcp__nod__somar"] }) });
      expect(data.turno?.estado).toBe("concluido");
      const negacao = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).find((m) => m.kind === "negacao");
      expect(negacao).toMatchObject({ payload: { kind: "negacao", classe: "ferramenta_negada", nome: "mcp__nod__somar", motivo: "fora_do_catalogo", terminal: false } });
      expect(negacao?.texto).toContain("ferramenta mcp__nod__somar negada");
      expect(events.map((e) => e.kind)).toEqual(["mensagem_criada", "negacao", "turno_encerrado"]);
    });
  });

  it("definido em 2026-10-11: com os motivos do hook, uma pílula por causa, com as vezes, no lugar de 'peça aprovação'", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const maquina = randomUUID();
      const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      const cerca = "git worktree add cria a worktree numa pasta que não deu para conferir. Crie dentro dela: …";
      const negacoesDoNod = [{ nome: "Bash", motivo: cerca }, { nome: "Bash", motivo: "a pessoa não aprovou este comando" }, { nome: "Bash", motivo: cerca }];
      await executar(deps, assentarTurno, { turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso("feito", { negacoesPermissao: ["Bash"], negacoesDoNod }) });
      const pilulas = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.kind === "negacao");
      expect(pilulas.map((m) => m.texto)).toEqual([
        "ferramenta Bash negada: git fora da pasta da task; o bot recebeu o caminho certo (2 vezes)",
        "ferramenta Bash negada: você não aprovou o comando",
      ]);
      expect(pilulas[0]?.payload).toMatchObject({ motivo: "alcance_insuficiente", causaNativa: "git_fora_da_pasta", vezes: 2 });
    });
  });

  it("entrega tardia com sucesso de turno caído e sem retomada: conclui o turno, a fala inteira (NOD-264, E8)", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const maquina = randomUUID();
      const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      await deps.repos.turnos.interromper(turnoId, "maquina_sem_contato");
      const { data } = await executar(deps, assentarTurno, { turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "cheguei tarde" }, resultado: sucesso("cheguei tarde") });
      expect(data).toMatchObject({ tardia: true, mensagem: { texto: "cheguei tarde", parcial: false } });
      expect(await deps.repos.turnos.buscar(turnoId)).toMatchObject({ estado: "concluido" });
    });
  });

  it("gate pré-spawn (ADR-019): inventário nao_autenticado interrompe o turno reivindicado com executor_indisponivel + negação", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const { data: enviado } = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const { data, events } = await executar(deps, despacharTurno, { machineId: randomUUID(), executor: "local", inventario: { estado: "nao_autenticado", motivo: "faça login no claude", em: 5 } });
      expect(data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
      expect(await deps.repos.turnos.buscar(enviado.turno.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha: "nao_autenticado" });
      expect((await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id))?.texto).toContain("nenhuma IA pronta na máquina deste bot");
      expect(events.map((e) => e.kind)).toEqual(["turno_interrompido", "mensagem_criada"]);
    });
  });

  /**
   * NOD-174: o erro do Claude Code vinha como balão do bot ("Credit balance is too low"). Agora o `result` de falha e o
   * `assistant` sintético não viram fala; o que o modelo escreveu antes fica, parcial, e o aviso sai em pt-BR.
   */
  it("falha do fornecedor não vira balão em inglês: fala anterior parcial e aviso em pt-BR com a frase da classe", async () => {
    const linhas = (erro: string) => [
      { type: "system", subtype: "init", session_id: randomUUID(), tools: [], model: "m", claude_code_version: "v", apiKeySource: "none" },
      { type: "assistant", message: { model: "claude", content: [{ type: "text", text: "Vou olhar a planilha." }] } },
      { type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: erro }] } },
      { type: "result", subtype: "success", is_error: true, result: erro, session_id: randomUUID(), total_cost_usd: 0, usage: {}, num_turns: 1 },
    ].map((l) => interpretarLinhaStreamJson(JSON.stringify(l)));
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const casos = [
        { erro: "Credit balance is too low", aviso: "Turno interrompido: a IA parou por um erro; tente de novo e, se repetir, relate o problema nesta mensagem." },
        { erro: "Invalid API key · Please run /login", aviso: "Turno interrompido: sua conta do Claude Code saiu deste Mac; use Conectar IA para entrar de novo." },
      ];
      for (const c of casos) {
        const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
        await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
        const maquina = randomUUID();
        const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
        const resultado = classificarResultado({ eventos: linhas(c.erro), exitCode: 1, signal: null, stderr: "" });
        expect(resultado).toMatchObject({ desfecho: "falha", motivoFalha: "erro_execucao", texto: "Vou olhar a planilha." });
        expect(resultado.erroCru).toContain(c.erro);
        const { data } = await executar(deps, assentarTurno, { turnoId, machineId: maquina, seqLocal: 1, harness: "claude-cli", fala: { tipo: "texto", texto: resultado.texto }, resultado });
        expect(data.turno).toMatchObject({ estado: "interrompido", motivoFalha: "erro_execucao" });
        const doTurno = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.turnoId === turnoId);
        expect(doTurno.map((m) => [m.kind, m.parcial])).toEqual([["texto", true], ["sistema", false]]);
        expect(doTurno.map((m) => m.texto).join("\n")).not.toContain(c.erro);
        expect(doTurno[1]?.texto).toContain(c.aviso);
        expect(doTurno[1]?.texto).not.toMatch(/[a-z]+_[a-z]+/);
      }
    });
  });

  /**
   * 2026-11-09 (o laço da Helena depois do #712): o Mac com o app anterior à rc.7 roda o driver com `--autocompact 200000`
   * e entra no laço de compactação com o Opus de 1M; `/nova-sessao` não tira dele, atualizar o app tira. O `result` é o do
   * Claude Code 2.1.309 medido no repro (api_error autocompact_thrashing). A versão do app vai também para o Raio-X.
   */
  it("laço de compactação num app anterior à rc.7: o aviso manda reiniciar para atualizar, e o Raio-X guarda a versão do app", async () => {
    const erro = "Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row. A file being read or a tool output is likely too large for the context window. Try reading in smaller chunks, or use /clear to start fresh.";
    const linhas = [
      { type: "system", subtype: "init", session_id: randomUUID(), tools: [], model: "claude-opus-5-5", claude_code_version: "2.1.309", apiKeySource: "none" },
      { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 159_004, post_tokens: 20_594 } },
      { type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: erro }] }, error: "invalid_request", api_error: "autocompact_thrashing" },
      { type: "result", subtype: "success", is_error: true, result: erro, api_error: "autocompact_thrashing", session_id: randomUUID(), total_cost_usd: 0, usage: {}, num_turns: 4 },
    ].map((l) => interpretarLinhaStreamJson(JSON.stringify(l)));
    const execucao = { chamadas: [], chamadasOmitidas: 0, compactacoes: [{ em: 148_890, antes: 159_004, depois: 20_594, gatilho: "auto" }], janela: 1_000_000, modelo: "claude-opus-5-5", versaoCli: "2.1.309", custoSessaoUsd: 50.57, ferramentasNoInit: 928, buscaDeFerramentas: true, duracaoMs: 166_140 };
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const casos = [
        { versaoApp: "1.0.0-rc.6", aviso: "o nod deste computador está na versão 1.0.0-rc.6, que resume cedo demais: reinicie o nod para atualizar e peça de novo", raioX: { versaoApp: "1.0.0-rc.6" } },
        // NOD-480: no app com a janela real, a 1ª vez recomeça sozinha numa sessão nova (sem aviso); só a 2ª avisa.
        { versaoApp: "1.0.0-rc.7", aviso: null, raioX: { versaoApp: "1.0.0-rc.7" } },
        { versaoApp: undefined, aviso: null, raioX: {} },
      ];
      for (const c of casos) {
        const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
        await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
        const maquina = randomUUID();
        const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
        const resultado = { ...classificarResultado({ eventos: linhas, exitCode: 0, signal: null, stderr: "" }), execucao };
        expect(resultado.erroCru).toContain("Autocompact is thrashing");
        await executar(deps, assentarTurno, { turnoId, machineId: maquina, seqLocal: 1, harness: "claude-cli", ...(c.versaoApp ? { versaoApp: c.versaoApp } : {}), fala: { tipo: "texto", texto: resultado.texto }, resultado });
        const aviso = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.turnoId === turnoId && m.kind === "sistema")[0]?.texto ?? "";
        const repeticao = (await deps.repos.turnos.listarDaConversa(criado.conversa.id, 50)).find((t) => t.estado === "pendente" && t.id !== turnoId);
        if (c.aviso === null) {
          expect(aviso).toBe("");
          expect(repeticao?.motivoRecomeco).toBe("autocompactacao");
          // A repetição sai da fila: o próximo caso reivindica o turno dele, não esta.
          await deps.repos.turnos.assentar(repeticao!.id, { estado: "concluido" });
        } else {
          expect(aviso).toContain("Turno interrompido: o histórico enche de novo logo depois de resumido e o Claude Code parou");
          expect(aviso).toContain(c.aviso);
          // O app antigo resume cedo demais: repetir daria o mesmo, então não repete.
          expect(repeticao).toBeUndefined();
        }
        const raioX = await deps.repos.raioX.doTurno(turnoId);
        expect(raioX?.execucao).toMatchObject({ ...execucao, ...c.raioX });
        if (!c.versaoApp) expect(raioX?.execucao).not.toHaveProperty("versaoApp");
      }
    });
  });

  /** NOD-171: o plano do Claude Code no teto. O motivo vem do protocolo (0058) e o aviso diz quando volta. */
  it("limite do plano: rate_limit rejected vira limite_do_plano gravado e o aviso diz a hora em que volta", async () => {
    const voltaEm = Date.now() + 2 * 3_600_000;
    const linhas = [
      { type: "system", subtype: "init", session_id: randomUUID(), tools: [], model: "m", claude_code_version: "2.1.290", apiKeySource: "none" },
      { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: Math.floor(voltaEm / 1000), rateLimitType: "five_hour", unifiedWindows: { five_hour: { utilization: 1 } } } },
      { type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached", session_id: randomUUID(), total_cost_usd: 0, usage: {}, num_turns: 1 },
    ].map((l) => interpretarLinhaStreamJson(JSON.stringify(l)));
    const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Math.floor(voltaEm / 1000) * 1000));
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const maquina = randomUUID();
      const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      const resultado = classificarResultado({ eventos: linhas, exitCode: 0, signal: null, stderr: "" });
      expect(resultado).toMatchObject({ desfecho: "falha", motivoFalha: "limite_do_plano" });
      const { data } = await executar(deps, assentarTurno, { turnoId, machineId: maquina, seqLocal: 1, harness: "claude-cli", fala: { tipo: "texto", texto: resultado.texto }, resultado });
      expect(data.turno).toMatchObject({ estado: "interrompido", motivoFalha: "limite_do_plano" });
      const ultima = await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id);
      expect(ultima?.payload).toEqual({ kind: "limite_do_plano", harness: "claude-cli", voltaEm: Math.floor(voltaEm / 1000) * 1000 });
      const aviso = ultima?.texto ?? "";
      expect(aviso).toContain("Turno interrompido: seu plano do Claude Code atingiu o limite de uso; volta a funcionar ");
      expect(aviso).toContain(hora);
      expect(aviso).not.toContain("usage limit");
    });
  });
});
