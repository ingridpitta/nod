import { describe, expect, it } from "vitest";
import { conceder, concederLote, quandoUtc } from "../../../src/use-cases/conceder.ts";
import { revogar, revogarLote } from "../../../src/use-cases/revogar.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { depsFalsos } from "./deps-l5.ts";

const AGORA = 1_758_000_000_000;

async function cenario() {
  const { deps, banco } = depsFalsos({ agora: AGORA });
  banco.pessoas.push({ tenantId: TENANT_PADRAO, id: PESSOA_MARLON, nome: "Marlon", iniciais: "M", email: null });
  const agente = await deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const conector = await deps.repos.conectores.criar({ nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
  await deps.repos.conectores.registrarSonda(conector?.id ?? "", {
    ok: true,
    agora: AGORA,
    catalogo: [
      { nome: "listar_contatos", descricao: "lista contatos", schema: { type: "object" }, readOnlyHint: true },
      { nome: "enviar_email", descricao: "envia e-mail", schema: { type: "object" }, readOnlyHint: false },
      { nome: "ler_agenda", descricao: "lê a agenda", schema: { type: "object" }, readOnlyHint: true },
    ],
  });
  return { deps, banco, agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", conectorId: conector?.id ?? "" };
}

describe("conceder / revogar (E6.3, E12.5)", () => {
  it("concessão nasce presa à mensagem de consentimento na conversa do agente, com concedente, data/hora, escopo exato e o que NÃO inclui", async () => {
    const c = await cenario();
    const r = await conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "listar_contatos", autorTipo: "pessoa" });
    const mensagem = c.banco.mensagens.find((m) => m.id === r.data.mensagemId);
    expect(mensagem).toMatchObject({ kind: "consentimento", conversaId: c.conversaId, confianca: "confiavel", autoria: { autor_tipo: "pessoa", autor_id: PESSOA_MARLON } });
    expect(mensagem?.texto).toBe(`Concedido por Marlon em ${quandoUtc(AGORA)}: exemplo.listar_contatos; não inclui: enviar_email: envia e-mail; ler_agenda: lê a agenda.`);
    expect(quandoUtc(AGORA)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
    expect(mensagem?.payload).toEqual({ kind: "consentimento", conectorId: c.conectorId, slug: "exemplo", capacidades: ["listar_contatos"], naoInclui: ["enviar_email: envia e-mail", "ler_agenda: lê a agenda"] });
    const concessao = await c.deps.repos.concessoes.buscar(r.data.concessaoId);
    expect(concessao).toMatchObject({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "listar_contatos", mensagemId: r.data.mensagemId });
    expect(r.events?.map((e) => e.kind)).toEqual(["concessao_criada"]);

    await conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "ler_agenda" });
    const terceira = await conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar_email" });
    expect(c.banco.mensagens.find((m) => m.id === terceira.data.mensagemId)?.texto).toContain("não inclui: nada mais deste conector");
  });

  it("agente não concede a agente e capacidade fora do catálogo é recusada com código fechado", async () => {
    const c = await cenario();
    await expect(conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "listar_contatos", autorTipo: "agente" })).rejects.toMatchObject({ codigo: "nao_permitido" });
    await expect(conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "apagar_tudo" })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    await expect(conceder(c.deps, { agenteId: "nao-existe", conectorId: c.conectorId, capacidade: "listar_contatos" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
  });

  /**
   * definido em 2026-09-21: até aqui a segunda concessão era `rejects estado_invalido`, agrupada com
   * "fora do catálogo" como se fosse recusa. Não é: aquelas são entrada inválida e permissão, esta é
   * uma operação JÁ satisfeita. O contrato escrito do repositório sempre foi idempotente ("conceder
   * duas vezes não duplica") e o 409 do caso de uso travava o card de uma decisão de acesso duplicada.
   * A invariante que o teste antigo realmente protegia — UMA concessão por capacidade — segue aqui.
   */
  it("conceder de novo a mesma capacidade é idempotente: devolve a concessão existente, sem segunda concessão nem segundo consentimento", async () => {
    const c = await cenario();
    const primeira = await conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "listar_contatos" });
    const repetida = await conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "listar_contatos" });

    expect(repetida.data.concessaoId).toBe(primeira.data.concessaoId);
    // A mensagem citável é a ORIGINAL: nenhum consentimento novo entra na conversa própria.
    expect(repetida.data.mensagemId).toBe(primeira.data.mensagemId);
    expect(repetida.events ?? []).toEqual([]);
    expect(c.banco.concessoes).toHaveLength(1);
    expect(c.banco.mensagens.filter((m) => m.kind === "consentimento")).toHaveLength(1);
  });

  /**
   * ADR-044: um clique em "Permitir" nas ferramentas de leitura de um app inteiro escrevia UMA
   * mensagem de consentimento POR ferramenta (28 no Gmail). O lote escreve uma, e cada concessão
   * aponta para ela; a unicidade do banco continua por capacidade.
   */
  it("concederLote: N capacidades → UMA mensagem de consentimento imutável, N concessões apontando para ela", async () => {
    const c = await cenario();
    const r = await concederLote(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidades: ["listar_contatos", "ler_agenda", "listar_contatos"], autorTipo: "pessoa" });
    const consentimentos = c.banco.mensagens.filter((m) => m.kind === "consentimento");
    expect(consentimentos).toHaveLength(1);
    expect(consentimentos[0]?.id).toBe(r.data.mensagemId);
    expect(consentimentos[0]?.texto).toBe(`Concedido por Marlon em ${quandoUtc(AGORA)}: exemplo.listar_contatos, exemplo.ler_agenda; não inclui: enviar_email: envia e-mail.`);
    expect(consentimentos[0]?.payload).toEqual({ kind: "consentimento", conectorId: c.conectorId, slug: "exemplo", capacidades: ["listar_contatos", "ler_agenda"], naoInclui: ["enviar_email: envia e-mail"] });
    expect(c.banco.concessoes.map((g) => [g.capacidade, g.mensagemId])).toEqual([["listar_contatos", r.data.mensagemId], ["ler_agenda", r.data.mensagemId]]);
    expect(r.data.concessoes.map((g) => g.capacidade)).toEqual(["listar_contatos", "ler_agenda"]);
    expect(r.events?.map((e) => e.kind)).toEqual(["concessao_criada", "concessao_criada"]);

    // Lote com uma já concedida: a nova ganha consentimento próprio que cita SÓ ela; a antiga fica com o original.
    const depois = await concederLote(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidades: ["ler_agenda", "enviar_email"] });
    expect(c.banco.mensagens.filter((m) => m.kind === "consentimento")).toHaveLength(2);
    expect(c.banco.mensagens.find((m) => m.id === depois.data.mensagemId)?.payload).toMatchObject({ capacidades: ["enviar_email"] });
    expect(depois.data.concessoes).toEqual([
      { capacidade: "ler_agenda", concessaoId: r.data.concessoes[1]?.concessaoId, mensagemId: r.data.mensagemId },
      { capacidade: "enviar_email", concessaoId: expect.any(String), mensagemId: depois.data.mensagemId },
    ]);
    // Tudo já concedido: nada novo, nenhuma mensagem, nenhum evento.
    const repetido = await concederLote(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidades: ["listar_contatos", "ler_agenda"] });
    expect(repetido.data.mensagemId).toBeNull();
    expect(repetido.events ?? []).toEqual([]);
    expect(c.banco.concessoes).toHaveLength(3);
  });

  it("concederLote recusa lote vazio, capacidade fora do catálogo (sem gravar nada) e agente concedendo", async () => {
    const c = await cenario();
    await expect(concederLote(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidades: [] })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    await expect(concederLote(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidades: ["listar_contatos", "apagar_tudo"] })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    await expect(concederLote(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidades: ["listar_contatos"], autorTipo: "agente" })).rejects.toMatchObject({ codigo: "nao_permitido" });
    expect(c.banco.concessoes).toHaveLength(0);
    expect(c.banco.mensagens.filter((m) => m.kind === "consentimento")).toHaveLength(0);
  });

  it("revogarLote: o grupo do painel sai inteiro com UM registro escrito; concessão de outro agente é recusada", async () => {
    const c = await cenario();
    const r = await concederLote(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidades: ["listar_contatos", "ler_agenda"] });
    const antes = c.banco.mensagens.length;
    const rev = await revogarLote(c.deps, { agenteId: c.agenteId, concessaoIds: r.data.concessoes.map((g) => g.concessaoId) });
    expect(rev.data.revogadas).toBe(2);
    expect(c.banco.concessoes).toHaveLength(0);
    expect(c.banco.mensagens).toHaveLength(antes + 1);
    expect(c.banco.mensagens.find((m) => m.id === rev.data.mensagemId)?.texto).toBe(`Revogado por Marlon em ${quandoUtc(AGORA)}: exemplo.listar_contatos, exemplo.ler_agenda.`);
    // O consentimento original continua: é imutável e citável (E6.3).
    expect(c.banco.mensagens.find((m) => m.id === r.data.mensagemId)?.kind).toBe("consentimento");

    const outra = await conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "listar_contatos" });
    const outroAgente = await c.deps.repos.agentes.criar({ nome: "Tuca", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    await expect(revogarLote(c.deps, { agenteId: outroAgente?.id ?? "", concessaoIds: [outra.data.concessaoId] })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    await expect(revogarLote(c.deps, { agenteId: c.agenteId, concessaoIds: ["nao-e-uuid"] })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    expect(c.banco.concessoes).toHaveLength(1);
  });

  it("revogar apaga a concessão, deixa registro escrito e mantém a mensagem de consentimento original", async () => {
    const c = await cenario();
    const r = await conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "listar_contatos" });
    const rev = await revogar(c.deps, { concessaoId: r.data.concessaoId });
    expect(await c.deps.repos.concessoes.doAgente(c.agenteId)).toEqual([]);
    expect(c.banco.mensagens.find((m) => m.id === r.data.mensagemId)?.kind).toBe("consentimento");
    expect(c.banco.mensagens.find((m) => m.id === rev.data.mensagemId)?.texto).toBe(`Revogado por Marlon em ${quandoUtc(AGORA)}: exemplo.listar_contatos.`);
    await expect(revogar(c.deps, { concessaoId: r.data.concessaoId })).rejects.toMatchObject({ codigo: "nao_encontrado" });
  });
});
