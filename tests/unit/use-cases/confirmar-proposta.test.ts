import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Rotina } from "../../../src/contracts/rotina.ts";
import { atualizarPerfil } from "../../../src/use-cases/atualizar-perfil.ts";
import { idDaProposta } from "../../helpers/perfil.ts";
import { confirmarProposta } from "../../../src/use-cases/confirmar-proposta.ts";
import { criarAgente, NOME_INICIAL } from "../../../src/use-cases/criar-agente.ts";
import { pedirAcesso } from "../../../src/use-cases/pedir-acesso.ts";
import { recusarProposta } from "../../../src/use-cases/recusar-proposta.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { depsEmMemoria, esperarErro, executar } from "../../helpers/deps-l6.ts";

describe("propostas (E1.1): nada é aplicado antes da confirmação", () => {
  it("atualizar_perfil (ferramenta) só cria a proposta; confirmar aplica nome/título/descrição e marca confirmado", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const ctx = { turnoId: randomUUID(), agenteId: criado.agente.id, conversaId: criado.conversa.id };

    const proposta = await executar(deps, atualizarPerfil, { ...ctx, nome: "Vera", titulo: "Revisora", descricao: "Revisa PRs e responde curto" });
    expect(proposta.events.map((e) => e.kind)).toEqual(["proposta_criada"]);
    expect(await deps.repos.agentes.buscar(criado.agente.id)).toMatchObject({ nome: NOME_INICIAL, confirmado: false });
    expect((await deps.repos.propostas.buscar(idDaProposta(proposta.data)))?.estado).toBe("pendente");

    const { data, events } = await executar(deps, confirmarProposta, { propostaId: idDaProposta(proposta.data) });
    expect(data.proposta.estado).toBe("confirmada");
    expect(data.agente).toMatchObject({ nome: "Vera", titulo: "Revisora", descricao: "Revisa PRs e responde curto", confirmado: true });
    expect(events.map((e) => e.kind)).toEqual(["agente_atualizado", "mensagem_criada"]);
    const ultima = await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id);
    expect(ultima?.texto).toContain("Confirmado por");
    expect(ultima?.texto).toContain("nome: Vera");

    // NOD-190: o mesmo card de novo é idempotente — volta confirmada, sem evento e sem mensagem nova.
    const ultimaAntes = await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id);
    const de_novo = await executar(deps, confirmarProposta, { propostaId: idDaProposta(proposta.data) });
    expect(de_novo.data.proposta.estado).toBe("confirmada");
    expect(de_novo.data.obsoleta).toBeUndefined();
    expect(de_novo.events).toEqual([]);
    expect((await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id))?.id).toBe(ultimaAntes?.id);
    await esperarErro(() => confirmarProposta(deps, { propostaId: randomUUID() }), "nao_encontrado");
  });

  it("proposta vazia é recusada pela ferramenta (entrada_invalida)", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    await esperarErro(() => atualizarPerfil(deps, { turnoId: "t", agenteId: criado.agente.id, conversaId: criado.conversa.id }), "entrada_invalida");
  });

  it("recusar deixa de lado: mensagem 'Deixei isso de lado', agente inalterado, segunda recusa → estado_invalido", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const proposta = await executar(deps, atualizarPerfil, { turnoId: "t", agenteId: criado.agente.id, conversaId: criado.conversa.id, nome: "Vera" });
    const { data } = await executar(deps, recusarProposta, { propostaId: idDaProposta(proposta.data) });
    expect(data.proposta.estado).toBe("recusada");
    expect((await deps.repos.agentes.buscar(criado.agente.id))?.nome).toBe(NOME_INICIAL);
    expect((await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id))?.texto).toContain("Deixei isso de lado");
    await esperarErro(() => recusarProposta(deps, { propostaId: idDaProposta(proposta.data) }), "estado_invalido");
  });

  it("'rotina' confirma pelo services.rotinas.ativar (L7) na mesma tx e emite rotina_criada", async () => {
    const ativar = vi.fn(async (_trx: unknown, propostaId: string): Promise<Rotina> => ({
      tenantId: "t",
      id: "rotina-1",
      agenteId: "a",
      conversaId: "c",
      ownerId: "p",
      cron: "0 8 * * 1-5",
      fusoIana: "America/Sao_Paulo",
      instrucao: "resumo",
      fonte: "prs",
      entregavel: "resumo",
      limitesAprovacao: "nada sai sem aprovação",
      politicaSemDado: "diga que não houve",
      exigeAprovacao: true,
      estado: "ativa",
      proximaExecucao: 1,
      criadoEm: 0,
      excluidoEm: null,
      acessos: null,
      gatilho: "horario",
      provedor: null,
      eventos: null,
      ...(propostaId ? {} : {}),
    }));
    const { deps } = depsEmMemoria(undefined, { ativarRotina: ativar });
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const p = await deps.repos.propostas.criar({
      conversaId: criado.conversa.id,
      agenteId: criado.agente.id,
      payload: { kind: "rotina", cron: "0 8 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "resumo", fonte: "prs", entregavel: "resumo", limitesAprovacao: "x", politicaSemDado: "y", proximaExecucao: 1, resumo: "dias úteis às 08:00" },
    });
    const { data, events } = await executar(deps, confirmarProposta, { propostaId: p?.id ?? "" });
    expect(ativar).toHaveBeenCalledTimes(1);
    expect(ativar.mock.calls[0]?.[1]).toBe(p?.id);
    expect(data.rotina?.id).toBe("rotina-1");
    expect(events.map((e) => e.kind)).toEqual(["rotina_criada", "mensagem_criada"]);
  });

  it("'acesso' anterior (sem decisão) confirma como decisão tipo 'acesso' em Sua vez; nada é concedido aqui", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Vera" });
    await gmailConectado(deps);
    const p = await deps.repos.propostas.criar({ conversaId: criado.conversa.id, agenteId: criado.agente.id, payload: { kind: "acesso", conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "leitura", naoPedido: ["enviar_email"] } });
    const { data, events } = await executar(deps, confirmarProposta, { propostaId: p?.id ?? "" });
    expect(data.decisao).toMatchObject({ id: p?.id, tipo: "acesso", estado: "pendente", agenteId: criado.agente.id });
    // ADR-044: a frase é do domínio, sem nome de ferramenta; os nomes vão para o <details> do card.
    expect(data.decisao?.frase).toBe("Vera precisa ler seu Gmail. Não inclui: enviar, apagar, arquivar.");
    expect(events.map((e) => e.kind)).toEqual(["decisao_criada", "mensagem_criada"]);
    // "Confirmado por… A partir de agora vale" mentia: confirmar um pedido de acesso não concede.
    expect((await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id))?.texto).toBe("Pedido aberto; nada foi concedido ainda.");
    expect(await deps.repos.concessoes.doAgente(criado.agente.id)).toEqual([]);
  });

  it("ADR-044: pedido que já nasceu com a decisão de mesmo id → confirmar a devolve, sem conflito de chave, sem evento nem mudança", async () => {
    const { deps, banco } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Vera" });
    await gmailConectado(deps);
    const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: criado.conversa.id, agenteId: criado.agente.id, origem: "conversa", prazoEm: deps.agora() + 60_000, profundidade: 0, entradaTexto: "leia meus e-mails", entradaConfianca: "confiavel", harness: "claude-cli", modelo: "sonnet" });
    const pedido = await pedirAcesso(deps, { turnoId: turno?.id ?? "", agenteId: criado.agente.id, conversaId: criado.conversa.id, conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "leitura", nao_pedido: [] });
    const decisoesAntes = banco.decisoes.length;
    const { data, events } = await executar(deps, confirmarProposta, { propostaId: pedido.data.proposta_id });
    expect(data.decisao?.id).toBe(pedido.data.proposta_id);
    expect(events).toEqual([]);
    expect(banco.decisoes).toHaveLength(decisoesAntes);
    expect((await deps.repos.propostas.buscar(pedido.data.proposta_id))?.estado).toBe("pendente");
  });

  it("ADR-044: card de conexão com o app já conectado vira, no lugar, o card de concessão de um clique (leitura e, desde 2026-09-25, escrita)", async () => {
    const { deps, banco } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Vera" });
    const ctx = { turnoId: "turno", agenteId: criado.agente.id, conversaId: criado.conversa.id };
    const conectar = await pedirAcesso(deps, { ...ctx, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    const escrita = await pedirAcesso(deps, { ...ctx, conector: "gmail", capacidades: [], nivel: "escrita", nao_pedido: [] });
    expect(banco.propostas.find((p) => p.id === conectar.data.proposta_id)?.payload).toMatchObject({ conectar: true, capacidades: [] });
    // Ainda sem conexão: continua dizendo para conectar primeiro.
    await esperarErro(() => confirmarProposta(deps, { propostaId: conectar.data.proposta_id }), "estado_invalido");

    await gmailConectado(deps);
    const { data } = await executar(deps, confirmarProposta, { propostaId: conectar.data.proposta_id });
    expect((await deps.repos.propostas.buscar(conectar.data.proposta_id))?.estado).toBe("confirmada");
    expect(data.proposta.id).not.toBe(conectar.data.proposta_id);
    expect(data.proposta.payload).toMatchObject({ kind: "acesso", conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], nivel: "leitura", turnoId: "turno" });
    expect(data.proposta.payload).not.toHaveProperty("conectar");
    expect(data.decisao).toMatchObject({ id: data.proposta.id, tipo: "acesso", estado: "pendente" });
    expect(await deps.repos.concessoes.doAgente(criado.agente.id)).toEqual([]);
    // revisto em 2026-09-25: escrita também vira o card, com ler + escrita (apagar fica de fora), sem outro turno do agente.
    expect(escrita.data.proposta_id).not.toBe(conectar.data.proposta_id);
    const e = await executar(deps, confirmarProposta, { propostaId: escrita.data.proposta_id });
    expect(e.data.proposta.payload).toMatchObject({ kind: "acesso", conector: "gmail", nivel: "escrita", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS", "GMAIL_SEND_EMAIL"] });
    expect(e.data.decisao).toMatchObject({ tipo: "acesso", estado: "pendente" });
  });
});

/** Gmail conectado e habilitado, catálogo com duas ferramentas de leitura e uma de escrita. */
async function gmailConectado(deps: Deps): Promise<void> {
  const conector = await deps.repos.conectores.criar({ nome: "Gmail (Composio)", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!conector) throw new Error("conector");
  await deps.repos.conectores.registrarSonda(conector.id, {
    ok: true,
    agora: deps.agora(),
    catalogo: [
      { nome: "GMAIL_FETCH_EMAILS", descricao: "Lê e-mails", schema: { type: "object" }, readOnlyHint: true },
      { nome: "GMAIL_LIST_LABELS", descricao: "Lista rótulos", schema: { type: "object" }, readOnlyHint: true },
      { nome: "GMAIL_SEND_EMAIL", descricao: "Envia e-mail", schema: { type: "object" }, readOnlyHint: false },
    ],
  });
  await deps.repos.conectores.habilitar(conector.id, true);
}
