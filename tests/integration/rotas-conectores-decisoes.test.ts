import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rotasConcessoes } from "../../src/adapters/http/rotas/concessoes.ts";
import { rotasConectores } from "../../src/adapters/http/rotas/conectores.ts";
import { rotasInternas } from "../../src/adapters/http/rotas/interno.ts";
import { rotasTrilha } from "../../src/adapters/http/rotas/trilha.ts";
import { FERRAMENTAS_NOD } from "../../src/contracts/ferramentas-nod.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { CAMINHO_MCP_SOMAR, dentroEmMemoria, planoDeTeste, servicosDeTeste } from "../helpers/l5.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const CATALOGO = [
  { nome: "somar", descricao: "soma", schema: { type: "object" as const }, readOnlyHint: true },
  { nome: "gravar", descricao: "grava", schema: { type: "object" as const }, readOnlyHint: false },
];

/**
 * Rotas finas da L5 sobre o servidor de teste (porta 0, EMENDA 34) com `dentro` em memória: a
 * forma HTTP (status, códigos fechados, RespostaMutacao, filtro da trilha) e as rotas internas
 * autenticadas pelo token de turno (Origin → 403, GET plano, tools/call despachado, long-poll de
 * consultas curtas, negação local registrada).
 */
describe("rotas: conectores, concessões, trilha e internas", () => {
  const agora = () => Date.now();
  const tokens = criarTokenTurno({ agora });
  const services = servicosDeTeste({ agora, tokens, sonda: () => ({ ok: true, ferramentas: CATALOGO }) });
  const memoria = dentroEmMemoria({ services, agora });
  let srv: ServidorDeTeste;
  let sessao: { cookie: string; tenantId: string; pessoaId: string };
  let agenteId: string;
  let conversaId: string;
  let conectorId: string;

  beforeAll(async () => {
    srv = await servidorDeTeste(
      [
        ...rotasConectores({ dentro: memoria.dentro, cifrar: (t) => `cifrado(${t})`, decifrar: (t) => t.replace(/^cifrado\((.*)\)$/, "$1") }),
        ...rotasConcessoes({ dentro: memoria.dentro }),
        ...rotasTrilha({ dentro: memoria.dentro }),
        ...rotasInternas({ dentro: memoria.dentro, tokens, agora, longpollMs: 300, intervaloMs: 40 }),
      ],
      { autorizarTokenTurno: tokens.autorizar },
    );
    sessao = await srv.entrar("marlon");
    const repos = memoria.repos(MARLON);
    memoria.banco.pessoas.push({ tenantId: TENANT_PADRAO, id: PESSOA_MARLON, nome: "Marlon", iniciais: "M", email: null });
    const agente = await repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    agenteId = agente?.id ?? "";
    conversaId = (await repos.conversas.criar({ tipo: "propria", agenteId }))?.id ?? "";
  });
  afterAll(() => srv.close());

  it("POST conectores nasce desabilitado com env só em chaves; recusas viram 400 com código fechado; GET lista", async () => {
    const r = await srv.chamar(sessao, "POST", "conectores", { nome: "Somar", slug: "somar", transporte: "stdio", comando: process.execPath, args: [CAMINHO_MCP_SOMAR], env: { TOKEN: "segredo" }, declaracao: "nao-toca" });
    expect(r.status).toBe(201);
    const corpo = (await r.json()) as { ok: true; ids: { conector: string }; conector: { habilitado: boolean; env: Record<string, unknown>; envCifrado?: unknown } };
    conectorId = corpo.ids.conector;
    expect(corpo.conector).toMatchObject({ habilitado: false, env: { TOKEN: true } });
    expect(corpo.conector).not.toHaveProperty("envCifrado");
    expect(JSON.stringify(corpo)).not.toContain("segredo");

    const http = await srv.chamar(sessao, "POST", "conectores", { nome: "X", slug: "x", transporte: "http", url: "http://127.0.0.1:1/mcp", declaracao: "toca" });
    expect(http.status).toBe(400);
    expect(((await http.json()) as { codigo: string }).codigo).toBe("http_toca_dado_pessoal");
    const placeholder = await srv.chamar(sessao, "POST", "conectores", { nome: "Y", slug: "y", transporte: "stdio", comando: "node", env: { A: true } });
    expect(placeholder.status).toBe(400);
    expect(((await placeholder.json()) as { codigo: string }).codigo).toBe("env_placeholder_chave_nova");

    const lista = (await (await srv.chamar(sessao, "GET", "conectores")).json()) as { conectores: { slug: string }[] };
    expect(lista.conectores.map((c) => c.slug)).toEqual(["somar"]);
  });

  it("habilitar sem catálogo → 409; sondar habilita com o catálogo da sonda; desabilitar volta a false", async () => {
    expect((await srv.chamar(sessao, "POST", `conectores/${conectorId}/habilitar`)).status).toBe(409);
    const sonda = (await (await srv.chamar(sessao, "POST", `conectores/${conectorId}/sondar`)).json()) as { ok: boolean; conector: { habilitado: boolean; catalogo: { nome: string }[] } };
    expect(sonda.ok).toBe(true);
    expect(sonda.conector.habilitado).toBe(true);
    expect(sonda.conector.catalogo.map((c) => c.nome)).toEqual(["somar", "gravar"]);
    const off = (await (await srv.chamar(sessao, "POST", `conectores/${conectorId}/desabilitar`)).json()) as { conector: { habilitado: boolean } };
    expect(off.conector.habilitado).toBe(false);
    expect(((await (await srv.chamar(sessao, "POST", `conectores/${conectorId}/habilitar`)).json()) as { conector: { habilitado: boolean } }).conector.habilitado).toBe(true);
    expect((await srv.chamar(sessao, "POST", `conectores/${randomUUID()}/sondar`)).status).toBe(404);
  });

  it("concessões: POST cria com mensagem de consentimento, GET lista, DELETE revoga; sem campos → 400", async () => {
    const r = await srv.chamar(sessao, "POST", `agentes/${agenteId}/concessoes`, { conectorId, capacidade: "somar" });
    expect(r.status).toBe(201);
    const corpo = (await r.json()) as { ok: true; ids: { concessao: string; mensagem: string }; naoInclui: string[] };
    expect(corpo.naoInclui).toEqual(["gravar: grava"]);
    expect(memoria.banco.mensagens.find((m) => m.id === corpo.ids.mensagem)?.kind).toBe("consentimento");
    const lista = (await (await srv.chamar(sessao, "GET", `agentes/${agenteId}/concessoes`)).json()) as { concessoes: { id: string; capacidade: string }[] };
    expect(lista.concessoes.map((c) => c.capacidade)).toEqual(["somar"]);
    expect((await srv.chamar(sessao, "POST", `agentes/${agenteId}/concessoes`, { conectorId })).status).toBe(400);
    // definido em 2026-09-21: conceder de novo a MESMA capacidade é idempotente (era 409). Devolve a
    // concessão que já existe, sem criar outra nem um segundo consentimento — ver conceder.ts.
    const repetida = await srv.chamar(sessao, "POST", `agentes/${agenteId}/concessoes`, { conectorId, capacidade: "somar" });
    expect(repetida.status).toBe(201);
    expect(((await repetida.json()) as { ids: { concessao: string } }).ids.concessao).toBe(corpo.ids.concessao);
    expect(memoria.banco.mensagens.filter((m) => m.kind === "consentimento")).toHaveLength(1);
    expect((await srv.chamar(sessao, "DELETE", `concessoes/${corpo.ids.concessao}`)).status).toBe(200);
    expect((await srv.chamar(sessao, "DELETE", `concessoes/${corpo.ids.concessao}`)).status).toBe(404);
    // Recria para as rotas internas usarem.
    expect((await srv.chamar(sessao, "POST", `agentes/${agenteId}/concessoes`, { conectorId, capacidade: "somar" })).status).toBe(201);
  });

  it("GET trilha: dia malformado → 400, fuso inválido → 400, recorte devolve linhas", async () => {
    expect((await srv.chamar(sessao, "GET", "trilha?dia=ontem")).status).toBe(400);
    expect((await srv.chamar(sessao, "GET", "trilha?fuso=-0300")).status).toBe(400);
    const r = await srv.chamar(sessao, "GET", `trilha?agente=${agenteId}`);
    expect(r.status).toBe(200);
    expect((await r.json()) as { linhas: unknown[] }).toEqual({ linhas: [] });
  });

  it("internas: Origin → 403; GET plano pelo token; tools/call despachado; pedir_aprovacao → aguardar → long-poll pendente/decidida; negação local registrada", async () => {
    const turnoId = randomUUID();
    const repos = memoria.repos(MARLON);
    await repos.turnos.enfileirar({ executor: "catcher", id: turnoId, conversaId, agenteId, origem: "conversa", prazoEm: agora() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
    const token = tokens.cunhar(turnoId, { ...MARLON, agenteId });
    const plano = planoDeTeste({
      turnoId,
      agenteId,
      conversaId,
      expiraEm: agora() + 60_000,
      tokenDeTurno: token,
      catalogo: {
        ferramentas: [
          { nome: "lembrar", nomeMcp: "mcp__nod__lembrar", origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD.lembrar },
          { nome: "pedir_aprovacao", nomeMcp: "mcp__nod__pedir_aprovacao", origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD.pedir_aprovacao },
          { nome: "somar__somar", nomeMcp: "mcp__nod__somar__somar", origem: "conector", conectorId, readOnlyHint: true, tocaDadoPessoal: false, schema: { type: "object" } },
        ],
        servidores: [{ conectorId, nome: "somar", trust: "untrusted", transporte: "stdio" }],
      },
    });
    tokens.guardarPlano(plano);
    const cabecalho = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const interno = (metodo: string, caminho: string, corpo?: unknown, extra: Record<string, string> = {}) =>
      fetch(`${srv.url}/api/interno/${caminho}`, { method: metodo, headers: { ...cabecalho, ...extra }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });

    expect((await interno("GET", "plano", undefined, { origin: "http://evil" })).status).toBe(403);
    expect((await fetch(`${srv.url}/api/interno/plano`)).status).toBe(401);
    const p = await interno("GET", "plano");
    expect(p.status).toBe(200);
    expect(((await p.json()) as { turnoId: string }).turnoId).toBe(turnoId);

    const lembrar = (await (await interno("POST", "ferramentas/lembrar", { argumentos: { tipo: "fato", texto: "x" }, remetente: "impostor" })).json()) as { ok: boolean; confianca: string };
    expect(lembrar).toEqual({ ok: true, conteudo: JSON.stringify({ ok: true, id: "memoria-falsa" }), confianca: "confiavel" });
    const somar = (await (await interno("POST", "ferramentas/somar__somar", { argumentos: { a: 1, b: 2 } })).json()) as { ok: boolean; conteudo: string; confianca: string };
    expect(somar).toEqual({ ok: true, conteudo: "ok:somar", confianca: "nao_confiavel" });
    const negada = (await (await interno("POST", "ferramentas/somar__gravar", { argumentos: {} })).json()) as { ok: boolean; negacao: { motivo: string } };
    expect(negada).toMatchObject({ ok: false, negacao: { motivo: "fora_do_catalogo" } });

    await repos.concessoes.conceder({ agenteId, conectorId, capacidade: "gravar", mensagemId: "m" });
    const pedido = (await (await interno("POST", "ferramentas/pedir_aprovacao", { argumentos: { resumo: "r", itens: [{ texto: "a", destino: { conector: "somar", ferramenta: "gravar", argumentos: { texto: "a" } } }] } })).json()) as { aguardar: string };
    expect(typeof pedido.aguardar).toBe("string");
    const inicio = Date.now();
    const pendente = (await (await interno("GET", `decisoes/${pedido.aguardar}/aguardar`)).json()) as { estado: string };
    expect(pendente).toEqual({ estado: "pendente" });
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(200);
    expect(Date.now() - inicio).toBeLessThan(2_000);

    await repos.decisoes.decidir(pedido.aguardar, { por: PESSOA_MARLON, agora: agora() });
    // definido em 2026-09-28: decidida só com o efeito assentado — a fase 1 fecha antes de executar.
    expect(((await (await interno("GET", `decisoes/${pedido.aguardar}/aguardar`)).json()) as { estado: string }).estado).toBe("pendente");
    for (const item of await repos.itensAprovacao.listar(pedido.aguardar)) await repos.itensAprovacao.registrarDesfecho(item.id, "executado");
    const decidida = (await (await interno("GET", `decisoes/${pedido.aguardar}/aguardar`)).json()) as { estado: string; itens: { idx: number }[] };
    expect(decidida.estado).toBe("decidida");
    expect(decidida.itens.map((i) => i.idx)).toEqual([0]);
    // ADR-089 (revisão do #223): uma retomada já ficou com a decisão — a rota solta na hora (antes: "pendente" até o fim
    // da espera, com o turno e a retomada vivos na mesma task).
    const outro = (await (await interno("POST", "ferramentas/pedir_aprovacao", { argumentos: { resumo: "r2", itens: [{ texto: "b", destino: { conector: "somar", ferramenta: "gravar", argumentos: { texto: "b" } } }] } })).json()) as { aguardar: string };
    await repos.decisoes.decidir(outro.aguardar, { por: PESSOA_MARLON, agora: agora() });
    for (const item of await repos.itensAprovacao.listar(outro.aguardar)) await repos.itensAprovacao.registrarDesfecho(item.id, "executado");
    expect(await repos.decisoes.reivindicarContinuacao(outro.aguardar, "retomada", agora())).not.toBeNull();
    expect(await (await interno("GET", `decisoes/${outro.aguardar}/aguardar`)).json()).toEqual({ estado: "pendente", soltar: true });
    expect((await interno("GET", `decisoes/${randomUUID()}/aguardar`)).status).toBe(404);

    const n = await interno("POST", "negacoes", { nome: "x__y", motivo: "fora_do_catalogo", classe: "ferramenta_negada" });
    expect(n.status).toBe(200);
    expect(memoria.banco.trilha.some((l) => l.ferramenta === "x__y" && l.kind === "negacao")).toBe(true);
    expect((await interno("POST", "negacoes", { nome: "x", motivo: "inventado", classe: "ferramenta_negada" })).status).toBe(400);
  });

  // definido em 2026-09-25 (jornadas de conexão): "Quem pode usar o X?" — o nível escolhido vira exatamente o conjunto concedido.
  it("POST agentes/:id/acessos: o nível concede o seu num lote; Ler/Ler e alterar não tocam o que foi dado à parte; Nenhum tira tudo; nível inválido → 400", async () => {
    const lista = async () => ((await (await srv.chamar(sessao, "GET", `agentes/${agenteId}/concessoes`)).json()) as { concessoes: { capacidade: string }[] }).concessoes.map((c) => c.capacidade).sort();
    // Começa do zero: os testes anteriores deixam concessões neste bot.
    expect((await srv.chamar(sessao, "POST", `agentes/${agenteId}/acessos`, { conectorId, nivel: "nenhum" })).status).toBe(200);
    expect(await lista()).toEqual([]);
    // "gravar" não diz o que faz: fica em "outras", que nenhum nível concede (revisão do PR #68).
    const escrita = await srv.chamar(sessao, "POST", `agentes/${agenteId}/acessos`, { conectorId, nivel: "escrita" });
    expect(escrita.status).toBe(200);
    expect(((await escrita.json()) as { ids: Record<string, string> }).ids).toEqual({ concedidas: "1", revogadas: "0" });
    expect(await lista()).toEqual(["somar"]);
    expect(memoria.banco.mensagens.filter((m) => m.kind === "consentimento").length).toBeGreaterThan(0);
    // Dada à parte, ação por ação: Ler não a revoga.
    expect((await srv.chamar(sessao, "POST", `agentes/${agenteId}/concessoes`, { conectorId, capacidade: "gravar" })).status).toBe(201);
    const leitura = (await (await srv.chamar(sessao, "POST", `agentes/${agenteId}/acessos`, { conectorId, nivel: "leitura" })).json()) as { ids: Record<string, string> };
    expect(leitura.ids).toEqual({ concedidas: "0", revogadas: "0" });
    expect(await lista()).toEqual(["gravar", "somar"]);
    expect((await srv.chamar(sessao, "POST", `agentes/${agenteId}/acessos`, { conectorId, nivel: "tudo" })).status).toBe(400);
    const catalogo = ((await (await srv.chamar(sessao, "GET", "conectores")).json()) as { conectores: { catalogo: { nome: string; grupo: string }[] }[] }).conectores[0]?.catalogo;
    expect(catalogo?.map((c) => [c.nome, c.grupo])).toEqual([["somar", "ler"], ["gravar", "outras"]]);
    expect((await srv.chamar(sessao, "POST", `agentes/${agenteId}/acessos`, { conectorId, nivel: "nenhum" })).status).toBe(200);
    expect(await lista()).toEqual([]);
  });

  // revisão do PR #68: o nível é só da DONA do bot e do app, e só mexe no que é dele.
  it("POST agentes/:id/acessos: conector ou bot inexistente/de outra pessoa → 404 em todo nível; desabilitado → 409", async () => {
    expect((await srv.chamar(sessao, "POST", `agentes/${agenteId}/acessos`, { conectorId: randomUUID(), nivel: "leitura" })).status).toBe(404);
    expect((await srv.chamar(sessao, "POST", `agentes/${randomUUID()}/acessos`, { conectorId, nivel: "nenhum" })).status).toBe(404);
    const repos = memoria.repos(MARLON);
    const alheio = await repos.agentes.criar({ nome: "Da Ana", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    if (!alheio) throw new Error("agente");
    Object.assign(alheio, { ownerId: "outra-pessoa" });
    const noBanco = memoria.banco.agentes.find((a) => a.id === alheio.id);
    if (noBanco) Object.assign(noBanco, { ownerId: "outra-pessoa" });
    expect((await srv.chamar(sessao, "POST", `agentes/${alheio.id}/acessos`, { conectorId, nivel: "leitura" })).status).toBe(404);
    expect((await srv.chamar(sessao, "POST", `conectores/${conectorId}/desabilitar`)).status).toBe(200);
    expect((await srv.chamar(sessao, "POST", `agentes/${agenteId}/acessos`, { conectorId, nivel: "leitura" })).status).toBe(409);
    expect((await srv.chamar(sessao, "POST", `agentes/${agenteId}/acessos`, { conectorId, nivel: "nenhum" })).status).toBe(200);
  });
});
