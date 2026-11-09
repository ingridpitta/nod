import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rotasInternas } from "../../src/adapters/http/rotas/interno.ts";
import { CODIGO } from "../../src/adapters/mcp-proxy/jsonrpc.ts";
import { TAG } from "../../src/adapters/mcp-proxy/moldura.ts";
import { FERRAMENTAS_NOD } from "../../src/contracts/ferramentas-nod.ts";
import { criarConectoresVivos } from "../../src/services/conectores-vivos.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { CAMINHO_MCP_SOMAR, dentroEmMemoria, inicializarProxy, planoDeTeste, servicosDeTeste, spawnProxy, type ProxyReal } from "../helpers/l5.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ESQUEMA_SOMAR = { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } as const;

type ConteudoTexto = { content: { type: string; text: string }[]; isError?: boolean };

/**
 * Proxy REAL spawnado contra o servidor de teste servindo o plano [lembrar, exemplo__somar]: o
 * tools/list vem do plano com schemas; tools/call exemplo__somar passa pelo servidor
 * (chamar-ferramenta → conectores-vivos → mcp-somar.mjs real) e volta marcado não confiável —
 * embrulhado na moldura só quando >= 32 caracteres (ADR-026); nome fora do plano é negado
 * LOCALMENTE (terminal) e registrado no servidor (trilha).
 */
describe("proxy com plano: tools/list do plano, tools/call despachado ao servidor", () => {
  const agora = () => Date.now();
  const tokens = criarTokenTurno({ agora });
  const conectores = criarConectoresVivos({
    carregar: async (id) => (id === "k1" ? { nome: "exemplo", transporte: "stdio", comando: process.execPath, args: [CAMINHO_MCP_SOMAR] } : null),
    agora,
    timeoutChamadaMs: 5_000,
  });
  const services = servicosDeTeste({ agora, tokens, conectores });
  const memoria = dentroEmMemoria({ services, agora });
  const turnoId = randomUUID();
  const agenteId = randomUUID();
  let srv: ServidorDeTeste;
  let proxy: ProxyReal;

  beforeAll(async () => {
    const repos = memoria.repos(MARLON);
    await repos.agentes.criar({ id: agenteId, nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    const conversa = await repos.conversas.criar({ tipo: "propria", agenteId });
    await repos.conectores.criar({ id: "k1", nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: process.execPath, args: [CAMINHO_MCP_SOMAR], declaracao: "nao-toca" });
    await repos.conectores.registrarSonda("k1", { ok: true, agora: agora(), catalogo: [{ nome: "somar", descricao: "soma", schema: ESQUEMA_SOMAR, readOnlyHint: true }, { nome: "gravar", descricao: "grava", schema: { type: "object" }, readOnlyHint: false }] });
    const consentimento = await repos.mensagens.criar({ conversaId: conversa?.id ?? "", autoria: { autor_tipo: "pessoa", autor_id: PESSOA_MARLON, sob_procuracao_de: null, conta_de_execucao: PESSOA_MARLON, executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 }, kind: "consentimento", texto: "ok", confianca: "confiavel" });
    await repos.concessoes.conceder({ agenteId, conectorId: "k1", capacidade: "somar", mensagemId: consentimento?.id ?? "" });
    await repos.turnos.enfileirar({ executor: "catcher", id: turnoId, conversaId: conversa?.id ?? "", agenteId, origem: "conversa", prazoEm: agora() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
    await repos.turnos.reivindicar({ machineId: "m1", agora: agora() });

    srv = await servidorDeTeste(rotasInternas({ dentro: memoria.dentro, tokens, agora }), { autorizarTokenTurno: tokens.autorizar });
    const token = tokens.cunhar(turnoId, { ...MARLON, agenteId });
    tokens.guardarPlano(planoDeTeste({ turnoId, agenteId, conversaId: conversa?.id ?? "", expiraEm: agora() + 600_000, tokenDeTurno: token }));
    proxy = spawnProxy({ NOD_URL: srv.url, NOD_TOKEN_TURNO: token });
    await inicializarProxy(proxy);
  });

  afterAll(async () => {
    await proxy.fechar();
    await srv.close();
    await conectores.fechar();
  });

  it("tools/list = catálogo do plano com inputSchema e readOnlyHint", async () => {
    const r = (await proxy.pedir("tools/list")).result as { tools: { name: string; inputSchema: unknown; annotations: { readOnlyHint: boolean } }[] };
    expect(r.tools.map((t) => t.name)).toEqual(["lembrar", "exemplo__somar"]);
    expect(r.tools[0]?.inputSchema).toEqual(FERRAMENTAS_NOD.lembrar);
    expect(r.tools[1]?.inputSchema).toEqual(ESQUEMA_SOMAR);
    expect(r.tools[1]?.annotations.readOnlyHint).toBe(true);
  });

  it("tools/call exemplo__somar chega ao conector real: 'RESULTADO_SOMA=42' (17 chars) vem cru; resultado >= 32 chars vem embrulhado como não confiável", async () => {
    const curto = (await proxy.pedir("tools/call", { name: "exemplo__somar", arguments: { a: 17, b: 25 } })).result as ConteudoTexto;
    expect(curto.isError).toBeUndefined();
    expect(curto.content).toEqual([{ type: "text", text: "RESULTADO_SOMA=42" }]);

    const longo = (await proxy.pedir("tools/call", { name: "exemplo__somar", arguments: { a: 1e20, b: 1e20 } })).result as ConteudoTexto;
    const texto = longo.content[0]?.text ?? "";
    expect(texto).toContain(`<${TAG} origem="exemplo">`);
    expect(texto).toContain("RESULTADO_SOMA=200000000000000000000");
    expect(texto.endsWith(`</${TAG}>`)).toBe(true);
    expect(memoria.banco.trilha.filter((l) => l.kind === "tool_call" && l.ferramenta === "exemplo__somar")).toHaveLength(2);
  });

  it("ferramenta nod (lembrar) despacha para deps.useCases e volta confiável, sem moldura", async () => {
    const r = (await proxy.pedir("tools/call", { name: "lembrar", arguments: { tipo: "fato", texto: "gosta de café e de código limpo" } })).result as ConteudoTexto;
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0]?.text ?? "")).toEqual({ ok: true, id: "memoria-falsa" });
    expect(r.content[0]?.text).not.toContain(TAG);
  });

  // Antes do "fora do plano": aquele pede a interrupção do turno, e desde a NOD-311 o turno com Parar pedido
  // (pararSolicitadoEm) tem toda ferramenta negada como parada_ativa.
  it("args inválidos para o conector → negação transitória vinda do servidor; JSON inválido → -32700", async () => {
    const r = (await proxy.pedir("tools/call", { name: "exemplo__somar", arguments: { a: "um" } })).result as ConteudoTexto;
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("negado (transitório)");
    expect(r.content[0]?.text).toContain("argumentos inválidos");
    proxy.processo.stdin?.write("{isto não é json}\n");
    const ping = await proxy.pedir("ping");
    expect(ping.result).toEqual({});
    expect(CODIGO.parseError).toBe(-32700);
  });

  it("nome fora do plano: negado LOCALMENTE como terminal e registrado no servidor (trilha + pedido de interrupção)", async () => {
    const r = (await proxy.pedir("tools/call", { name: "exemplo__gravar", arguments: { texto: "x" } })).result as ConteudoTexto;
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/^negado \(terminal\): não tente outro caminho\./);
    expect(r.content[0]?.text).toContain("fora do catálogo");
    await new Promise((res) => setTimeout(res, 100));
    expect(memoria.banco.trilha.some((l) => l.kind === "negacao" && l.ferramenta === "exemplo__gravar" && l.motivo === "fora_do_catalogo")).toBe(true);
    expect(memoria.banco.turnos.find((t) => t.id === turnoId)?.pararSolicitadoEm).not.toBeNull();
  });
});
