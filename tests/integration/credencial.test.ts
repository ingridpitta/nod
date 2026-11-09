import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { expect, it, onTestFinished, vi } from "vitest";
import { responderErro } from "../../src/adapters/http/erros.ts";
import { rotasCredencial } from "../../src/adapters/http/rotas/credencial.ts";
import { criarRotasDecisoes } from "../../src/adapters/http/rotas/decisoes.ts";
import type { ResultadoSonda } from "../../src/contracts/servicos.ts";
import { chaveDe, cifrar, decifrar } from "../../src/db/cifra.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { chaveCandidataDoConector } from "../../src/use-cases/guardar-credencial.ts";
import { pedirCredencial } from "../../src/use-cases/pedir-credencial.ts";
import { pedirAcesso } from "../../src/use-cases/pedir-acesso.ts";
import { recusarPropostaPelaConversa } from "../../src/use-cases/decidir-acesso.ts";
import { registrarConector } from "../../src/use-cases/registrar-conector.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import type { Tx } from "../../src/shared/types.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-10-28T10:00:00-03:00");
const CHAVE = chaveDe("teste-credencial-nod50");
const cifra = (s: string) => cifrar(s, CHAVE);
const decifra = (s: string) => decifrar(s, CHAVE);
/** Um valor que não aparece em nenhum outro lugar: achá-lo no banco ou no log é vazamento. */
const SEGREDO = "exk_live_NOD50_s3gr3d0_que_nao_pode_vazar_9f2c";

/**
 * NOD-50 no Postgres de verdade: pedir_credencial cria o cartão (proposta + decisão), o POST propostas/:id/credencial troca
 * só a chave pedida, sonda e fecha com a retomada `guardada`; a recusa retoma com `recusada`. O teste obrigatório procura o
 * VALOR em todas as tabelas legíveis (mensagens, events, propostas, decisões, trilha, turnos…) e em tudo o que foi logado.
 */
describeIntegracao("cartão de pedido de credencial (NOD-50)", () => {
  async function cenario(trx: Tx, opcoes: { modo?: "manual" | "automatico" | "total"; sonda?: (n: number, env: Record<string, string> | undefined) => ResultadoSonda | Promise<ResultadoSonda>; fetchImpl?: typeof fetch } = {}) {
    const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ada", ...(opcoes.modo ? { modo: opcoes.modo } : {}) });
    const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
    let sondas = 0;
    let txAbertas = 0;
    const eventos: string[] = [];
    const sonda = opcoes.sonda ?? (() => ({ ok: true, ferramentas: [{ nome: "listar_pedidos", descricao: "Lista", readOnlyHint: true, schema: { type: "object" as const } }] }));
    (deps.services as { conectores: Deps["services"]["conectores"] }).conectores = { ...deps.services.conectores, sondar: async (_c, o) => { eventos.push(`sonda:${txAbertas}${o?.manterVivos ? ":mantem" : ""}`); return sonda(++sondas, o?.env); }, descartar: async (id: string) => { eventos.push(`descartar:${id}:${txAbertas}`); } };
    const conector = await registrarConector(deps, { nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "npx", args: ["exemplo-mcp"], env: { EXEMPLO_API_KEY: "chave_velha", OUTRA_VAR: "fica_igual" }, declaracao: "nao-toca", cifrar: cifra } as Parameters<typeof registrarConector>[1]);
    const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "traga os pedidos de hoje da loja", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
    if (!turno) throw new Error("turno");
    const dentro = async <T,>(_e: unknown, fn: (d: Deps) => Promise<T>) => {
      txAbertas++;
      try { return await fn(deps); } finally { txAbertas--; eventos.push("commit"); }
    };
    const rota = rotasCredencial({ dentro, cifrar: cifra, decifrar: decifra, ...(opcoes.fetchImpl ? { fetchImpl: opcoes.fetchImpl, apiGithub: "https://api.github.test" } : {}) })[0];
    const decidir = criarRotasDecisoes({ dentro, services: deps.services }).find((r) => r.padrao.source.includes("decidir"));
    if (!rota || !decidir || decidir.publica) throw new Error("rotas");
    const chamar = async (r: typeof rota, id: string, corpo: unknown) => {
      const req = new IncomingMessage(new Socket());
      const json = vi.fn();
      try {
        await r.handler({ req, res: new ServerResponse(req), escopo: MARLON, params: { id }, corpo: async () => corpo, json });
      } catch (e) {
        // Como o servidor: a recusa passa por responderErro, que loga o código e o `cause` (QA do PR 553: um segredo no
        // `cause` sairia no log `requisicao_recusada`, e o semSegredoNoLog só o vê se o erro passar por aqui).
        responderErro(new ServerResponse(req), e, { metodo: "POST", caminho: `/propostas/${id}/credencial` });
        throw e;
      }
      return json.mock.calls[0]?.[1] as Record<string, unknown>;
    };
    const pedir = (args: Record<string, unknown>) => pedirCredencial(deps, { turnoId: turno.id, agenteId, conversaId, ...args } as Parameters<typeof pedirCredencial>[1]);
    return {
      deps, repos, agenteId, conversaId, turno, conector: conector.data, sondas: () => sondas, eventos, pedir,
      guardar: (id: string, valor: unknown) => chamar(rota, id, { valor }),
      recusar: (id: string) => chamar(decidir, id, { recusar: true }),
      env: async () => JSON.parse(decifra((await repos.conectores.buscar(conector.data.id))?.envCifrado ?? "{}")) as Record<string, string>,
    };
  }

  /** O valor não sai no log em nenhum caminho (falhas incluídas): espiona console.* e confere ao fim do teste. */
  function semSegredoNoLog() {
    const saidas: string[] = [];
    const espioes = (["log", "error", "warn"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { saidas.push(a.map(String).join(" ")); }));
    onTestFinished(() => { for (const e of espioes) e.mockRestore(); expect(saidas.join("\n")).not.toContain(SEGREDO); });
  }

  /** Procura o texto em toda tabela legível do schema public (cada uma num savepoint: a sem permissão não derruba a tx). */
  async function tabelasCom(trx: Tx, texto: string): Promise<{ achadas: string[]; lidas: string[] }> {
    const tabelas = await trx<{ t: string }[]>`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`;
    const achadas: string[] = [];
    const lidas: string[] = [];
    for (const { t } of tabelas) {
      try {
        const linhas = (await trx.savepoint((sp: Tx) => sp.unsafe(`select count(*)::int as n from "${t.replace(/"/g, "")}" x where x::text like '%' || $1 || '%'`, [texto]))) as unknown as { n: number }[];
        const linha = linhas[0];
        lidas.push(t);
        if ((linha?.n ?? 0) > 0) achadas.push(t);
      } catch { /* tabela sem permissão para o papel do teste */ }
    }
    return { achadas, lidas };
  }

  it("critérios 1, 3, 4, 5: o cartão nasce pendente, guardar troca só a chave, a sonda habilita, retoma com guardada e o valor não fica em lugar nenhum", async () => {
    const saidas: string[] = [];
    const espiao = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { saidas.push(a.map(String).join(" ")); });
    const espiaoErro = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { saidas.push(a.map(String).join(" ")); });
    const espiaoAviso = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => { saidas.push(a.map(String).join(" ")); });
    try {
      await withRollback(MARLON, async (trx) => {
        const c = await cenario(trx);
        const r = await c.pedir({ alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY", para: "ler os pedidos de hoje da loja" });
        expect(r.data).toMatchObject({ estado: "pendente" });
        const id = r.data.estado === "pendente" ? r.data.proposta_id : "";
        expect(await c.repos.propostas.buscar(id)).toMatchObject({ kind: "credencial", estado: "pendente", payload: { kind: "credencial", alvo: "conector", conectorId: c.conector.id, app: "Exemplo", chave: "EXEMPLO_API_KEY", para: "Ler os pedidos de hoje da loja." } });
        expect(await c.repos.decisoes.buscar(id)).toMatchObject({ tipo: "credencial", estado: "pendente", turnoId: c.turno.id });

        expect(await c.guardar(id, `  ${SEGREDO}  `)).toEqual({ estado: "guardada" });
        expect(await c.env()).toEqual({ EXEMPLO_API_KEY: SEGREDO, OUTRA_VAR: "fica_igual" });
        expect((await c.repos.conectores.buscar(c.conector.id))?.habilitado).toBe(true);
        expect(c.sondas()).toBe(1);
        expect(await c.repos.propostas.buscar(id)).toMatchObject({ estado: "confirmada" });
        expect((await c.repos.decisoes.buscar(id))?.estado).toBe("decidida");
        const recibo = (await c.repos.mensagens.listarDaConversa(c.conversaId)).find((m) => m.payload?.kind === "proposta_decidida");
        expect(recibo).toMatchObject({ kind: "sistema", texto: "Chave do Exemplo guardada no cofre.", payload: { kind: "proposta_decidida", propostaId: id, tipo: "credencial", estado: "confirmada", turnoId: c.turno.id } });
        const [retomada] = (await trx<{ id: string; entrada_texto: string; retoma_turno_id: string }[]>`select id, entrada_texto, retoma_turno_id from turnos where retoma_turno_id = ${c.turno.id}`);
        expect(retomada?.entrada_texto.startsWith("pedir_credencial: guardada.")).toBe(true);
        // stdio: a sonda (tools/list) não confere a chave; o bot não ouve que ela foi testada.
        expect(retomada?.entrada_texto).toContain("só se confere no primeiro uso");
        expect(retomada?.entrada_texto).not.toContain("foi testada");

        // O teste obrigatório da NOD-50: o valor não está em tabela nenhuma (o env é cifrado) nem no log.
        const { achadas, lidas } = await tabelasCom(trx, SEGREDO);
        for (const t of ["mensagens", "events", "propostas", "decisoes", "trilha", "turnos", "conectores"]) expect(lidas).toContain(t);
        expect(achadas).toEqual([]);
        // Sanidade da busca: ela acha o que existe (a chave que ficou igual vai cifrada, mas o nome dela está no conector).
        expect((await tabelasCom(trx, "EXEMPLO_API_KEY")).achadas).toContain("propostas");
      });
      expect(saidas.join("\n")).not.toContain(SEGREDO);
    } finally {
      espiao.mockRestore(); espiaoErro.mockRestore(); espiaoAviso.mockRestore();
    }
  });

  it("sonda que recusa a chave: o env volta ao de antes, o cartão continua aberto, o conector não ganha falha e o turno não retoma; a segunda tentativa guarda", async () => {
    semSegredoNoLog();
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, { sonda: (n) => (n === 1 ? { ok: false, motivo: "conector_indisponivel", causa: "acesso_recusado" } : { ok: true, ferramentas: [] }) });
      const r = await c.pedir({ alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY" });
      const id = r.data.estado === "pendente" ? r.data.proposta_id : "";
      const erro = await c.guardar(id, SEGREDO).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroDeDominio);
      expect((erro as ErroDeDominio).codigo).toBe("integracao_autenticacao");
      expect((await c.repos.conectores.buscar(c.conector.id))?.ultimaFalha ?? null).toBeNull();
      expect(String((erro as Error & { cause?: unknown }).cause)).not.toContain(SEGREDO);
      expect(await c.env()).toEqual({ EXEMPLO_API_KEY: "chave_velha", OUTRA_VAR: "fica_igual" });
      expect((await c.repos.decisoes.buscar(id))?.estado).toBe("pendente");
      expect((await c.repos.propostas.buscar(id))?.estado).toBe("pendente");
      expect(await trx`select 1 from turnos where retoma_turno_id = ${c.turno.id}`).toHaveLength(0);
      expect(await c.guardar(id, "outra_chave_boa")).toEqual({ estado: "guardada" });
      expect((await c.env()).EXEMPLO_API_KEY).toBe("outra_chave_boa");
    });
  });

  it("sonda que não alcança o serviço: conector_indisponivel (Tentar de novo), não 'chave recusada'; o env volta", async () => {
    semSegredoNoLog();
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, { sonda: () => ({ ok: false, motivo: "conector_indisponivel" }) });
      const r = await c.pedir({ alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY" });
      const id = r.data.estado === "pendente" ? r.data.proposta_id : "";
      await expect(c.guardar(id, SEGREDO)).rejects.toMatchObject({ codigo: "conector_indisponivel" });
      expect((await c.env()).EXEMPLO_API_KEY).toBe("chave_velha");
      expect((await c.repos.decisoes.buscar(id))?.estado).toBe("pendente");
    });
  });

  it("a sonda testa a chave CANDIDATA antes de gravar: durante a sonda o cofre ainda tem a chave velha", async () => {
    await withRollback(MARLON, async (trx) => {
      let noCofre: string | undefined;
      let sondado: Record<string, string> | undefined;
      const c = await cenario(trx, { sonda: async (_n, env) => {
        sondado = env;
        noCofre = (JSON.parse(decifra((await trx<{ e: string }[]>`select env_cifrado as e from conectores where slug = 'exemplo'`)[0]?.e ?? "")) as Record<string, string>).EXEMPLO_API_KEY;
        return { ok: true, ferramentas: [] };
      } });
      const r = await c.pedir({ alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY" });
      const id = r.data.estado === "pendente" ? r.data.proposta_id : "";
      expect(await c.guardar(id, "chave_nova")).toEqual({ estado: "guardada" });
      expect(sondado).toEqual({ EXEMPLO_API_KEY: "chave_nova", OUTRA_VAR: "fica_igual" });
      expect(noCofre).toBe("chave_velha");
      expect((await c.env()).EXEMPLO_API_KEY).toBe("chave_nova");
    });
  });

  it("a sonda roda FORA de transação e, depois do commit, os clientes vivos do conector são descartados (a chave velha não sobrevive)", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const r = await c.pedir({ alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY" });
      const id = r.data.estado === "pendente" ? r.data.proposta_id : "";
      c.eventos.length = 0;
      expect(await c.guardar(id, SEGREDO)).toEqual({ estado: "guardada" });
      expect(c.eventos).toEqual(["commit", "commit", "sonda:0:mantem", "commit", `descartar:${c.conector.id}:0`]);
    });
  });

  it("descartar os clientes vivos falhar depois do commit não vira erro: a chave já foi guardada", async () => {
    semSegredoNoLog();
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const r = await c.pedir({ alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY" });
      const id = r.data.estado === "pendente" ? r.data.proposta_id : "";
      const svc = c.deps.services as { conectores: Deps["services"]["conectores"] };
      svc.conectores = { ...svc.conectores, descartar: async () => { throw new Error("cliente travado"); } };
      expect(await c.guardar(id, SEGREDO)).toEqual({ estado: "guardada" });
      expect((await c.repos.decisoes.buscar(id))?.estado).toBe("decidida");
    });
  });

  it("o env mudou durante a sonda (PATCH da tela, outro cartão): nada é gravado, o cartão fica aberto (compare-and-set) e a pessoa tenta de novo", async () => {
    semSegredoNoLog();
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, { sonda: async () => {
        await trx`update conectores set env_cifrado = ${cifra(JSON.stringify({ EXEMPLO_API_KEY: "mudou_por_fora" }))} where slug = 'exemplo'`;
        return { ok: true, ferramentas: [] };
      } });
      const r = await c.pedir({ alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY" });
      const id = r.data.estado === "pendente" ? r.data.proposta_id : "";
      await expect(c.guardar(id, SEGREDO)).rejects.toMatchObject({ codigo: "conector_indisponivel" });
      expect(await c.env()).toEqual({ EXEMPLO_API_KEY: "mudou_por_fora" });
      expect((await c.repos.decisoes.buscar(id))?.estado).toBe("pendente");
    });
  });

  it("o pedido vence em 24h: vencido não guarda (estado_invalido, env igual); reaberto guarda", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const r = await c.pedir({ alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY" });
      const id = r.data.estado === "pendente" ? r.data.proposta_id : "";
      const vencidas = await c.repos.decisoes.vencerPendentes(AGORA + 24 * 3_600_000 + 1);
      expect(vencidas.map((d) => d.id)).toContain(id);
      await expect(c.guardar(id, SEGREDO)).rejects.toMatchObject({ codigo: "estado_invalido" });
      expect((await c.env()).EXEMPLO_API_KEY).toBe("chave_velha");
      expect(c.sondas()).toBe(0);
      expect(await c.repos.decisoes.reabrir(id, AGORA + 48 * 3_600_000)).toMatchObject({ estado: "reaberta" });
      expect(await c.guardar(id, SEGREDO)).toEqual({ estado: "guardada" });
      expect((await c.env()).EXEMPLO_API_KEY).toBe(SEGREDO);
    });
  });

  it("IDOR: outra pessoa não guarda nem recusa o cartão de quem pediu (nao_encontrado, nada muda)", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const r = await c.pedir({ alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY" });
      const id = r.data.estado === "pendente" ? r.data.proposta_id : "";
      const OUTRA = { ...MARLON, pessoaId: "00000000-0000-4000-8000-0000000000ff" };
      const dentro = async <T,>(e: typeof MARLON, fn: (d: Deps) => Promise<T>) => fn(e.pessoaId === MARLON.pessoaId ? c.deps : depsSobre(trx, e, { agora: () => AGORA }).deps);
      const rota = rotasCredencial({ dentro: dentro as never, cifrar: cifra, decifrar: decifra })[0];
      const decidir = criarRotasDecisoes({ dentro: dentro as never, services: c.deps.services }).find((x) => x.padrao.source.includes("decidir"));
      if (!rota || !decidir || decidir.publica) throw new Error("rotas");
      const req = new IncomingMessage(new Socket());
      const como = (corpo: unknown) => ({ req, res: new ServerResponse(req), escopo: OUTRA, params: { id }, corpo: async () => corpo, json: vi.fn() });
      await expect(rota.handler(como({ valor: SEGREDO }))).rejects.toMatchObject({ codigo: "nao_encontrado" });
      await expect(decidir.handler(como({ recusar: true }))).rejects.toMatchObject({ codigo: "nao_encontrado" });
      expect((await c.env()).EXEMPLO_API_KEY).toBe("chave_velha");
      expect((await c.repos.decisoes.buscar(id))?.estado).toBe("pendente");
    });
  });

  it("stdio só pede chave que o conector já declara: variável de sistema, de processo ou credencial nova = chave_invalida", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      for (const chave of ["NODE_OPTIONS", "LD_PRELOAD", "PATH", "BASH_ENV", "JDK_JAVA_OPTIONS", "QUALQUER_OPTS", "NODE_API_KEY", "GIT_CONFIG_KEY_0", "GOOGLE_APPLICATION_CREDENTIALS_FILE", "AWS_SHARED_CREDENTIALS_FILE", "TOKEN_PATH", "LOJA_API_KEY", "OPENAI_API_KEY"]) {
        expect((await c.pedir({ alvo: "conector", conector: "exemplo", chave })).data).toMatchObject({ estado: "recusada", erro: "chave_invalida" });
        await expect(chaveCandidataDoConector(c.deps, { conectorId: c.conector.id, chave, valor: "x", decifrar: decifra })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      }
      // Revisão 8: declarada mas sem cara de credencial (OUTRA_VAR) ou que é endereço (OPENAI_BASE_URL) também não.
      await registrarConector(c.deps, { nome: "IA", slug: "ia", transporte: "stdio", comando: "npx", args: ["ia-mcp"], env: { OPENAI_API_KEY: "k", OPENAI_BASE_URL: "https://api.openai.com", API_HOST: "h", AUTH_TOKEN_URL: "u" }, declaracao: "nao-toca", cifrar: cifra } as Parameters<typeof registrarConector>[1]);
      for (const chave of ["OPENAI_BASE_URL", "API_HOST", "AUTH_TOKEN_URL"]) expect((await c.pedir({ alvo: "conector", conector: "ia", chave })).data).toMatchObject({ estado: "recusada", erro: "chave_invalida" });
      expect((await c.pedir({ alvo: "conector", conector: "exemplo", chave: "OUTRA_VAR" })).data).toMatchObject({ estado: "recusada", erro: "chave_invalida" });
      expect(c.sondas()).toBe(0);
      // Só a já declarada no registro e com nome de credencial; chave nova se acrescenta na tela de apps.
      for (const [conector, chave] of [["exemplo", "EXEMPLO_API_KEY"], ["ia", "OPENAI_API_KEY"]] as const) expect((await c.pedir({ alvo: "conector", conector, chave })).data).toMatchObject({ estado: "pendente" });
    });
  });

  it("http só pede um header de credencial (ou Authorization) que o conector já declara (um header novo levaria a chave a cada chamada)", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await registrarConector(c.deps, { nome: "Loja", slug: "loja-http", transporte: "http", url: "https://mcp.loja.test/mcp", env: { "X-API-Key": "velha" }, declaracao: "nao-toca", cifrar: cifra } as Parameters<typeof registrarConector>[1]);
      for (const chave of ["X-OpenAI-Key", "Cookie", "Origin", "X-Token-Novo", "Authorization"]) expect((await c.pedir({ alvo: "conector", conector: "loja-http", chave })).data).toMatchObject({ estado: "recusada", erro: "chave_invalida" });
      expect((await c.pedir({ alvo: "conector", conector: "loja-http", chave: "X-API-Key" })).data).toMatchObject({ estado: "pendente" });
    });
  });

  it("revisão 7: conector do Composio (URL do Composio ou o da sessão do toolkit) é gerido pelo nod — nenhum cartão, e guardar recusa", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await registrarConector(c.deps, { nome: "Gmail", slug: "gmail", transporte: "http", url: "https://backend.composio.dev/v3/mcp/abc", env: { "x-api-key": "ak_do_time" }, declaracao: "toca", cifrar: cifra } as Parameters<typeof registrarConector>[1]);
      expect((await c.pedir({ alvo: "conector", conector: "gmail", chave: "x-api-key" })).data).toMatchObject({ estado: "recusada", erro: "conector_nativo" });
      const outro = await registrarConector(c.deps, { nome: "Slack", slug: "slack", transporte: "http", url: "https://mcp.proxy.test/mcp", env: { "x-api-key": "ak_do_time" }, declaracao: "toca", cifrar: cifra } as Parameters<typeof registrarConector>[1]);
      const r = await c.pedir({ alvo: "conector", conector: "slack", chave: "x-api-key" });
      expect(r.data).toMatchObject({ estado: "pendente" });
      // A sessão do toolkit aponta para ele depois que o cartão nasceu: guardar recusa e não mexe no env.
      await c.repos.composio.salvarSessao({ toolkit: "slack", sessaoId: "s1", contaId: "ca1", conectorId: outro.data.id });
      expect((await c.pedir({ alvo: "conector", conector: "slack", chave: "X-API-Key" })).data).toMatchObject({ estado: "recusada", erro: "conector_nativo" });
      const erro = await c.guardar(r.data.estado === "pendente" ? r.data.proposta_id : "", SEGREDO).catch((e: unknown) => e);
      expect((erro as ErroDeDominio).codigo).toBe("entrada_invalida");
      expect(JSON.parse(decifra((await c.repos.conectores.buscar(outro.data.id))?.envCifrado ?? "{}"))).toEqual({ "x-api-key": "ak_do_time" });
    });
  });

  it("http (revisões 6 e 7): header pedido em outra caixa troca o declarado sem duplicar; Authorization sem esquema ganha o Bearer de antes", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const loja = await registrarConector(c.deps, { nome: "Loja", slug: "loja-http", transporte: "http", url: "https://mcp.loja.test/mcp", env: { "X-API-Key": "velha", Authorization: "Bearer velho" }, declaracao: "nao-toca", cifrar: cifra } as Parameters<typeof registrarConector>[1]);
      const envDa = async (id: string) => JSON.parse(decifra((await c.repos.conectores.buscar(id))?.envCifrado ?? "{}")) as Record<string, string>;
      const idDe = (r: Awaited<ReturnType<typeof c.pedir>>) => (r.data.estado === "pendente" ? r.data.proposta_id : "");
      expect(await c.guardar(idDe(await c.pedir({ alvo: "conector", conector: "loja-http", chave: "x-api-key" })), "nova")).toEqual({ estado: "guardada" });
      expect(await envDa(loja.data.id)).toEqual({ "X-API-Key": "nova", Authorization: "Bearer velho" });
      expect(await c.guardar(idDe(await c.pedir({ alvo: "conector", conector: "loja-http", chave: "authorization" })), "tok123")).toEqual({ estado: "guardada" });
      expect(await envDa(loja.data.id)).toEqual({ "X-API-Key": "nova", Authorization: "Bearer tok123" });
      // O antigo sem esquema, ou Basic (usuário:senha, não "o token"): o novo fica como veio.
      const outra = await registrarConector(c.deps, { nome: "Outra", slug: "outra-http", transporte: "http", url: "https://mcp.outra.test/mcp", env: { Authorization: "Basic dTpw" }, declaracao: "nao-toca", cifrar: cifra } as Parameters<typeof registrarConector>[1]);
      expect(await c.guardar(idDe(await c.pedir({ alvo: "conector", conector: "outra-http", chave: "Authorization" })), "abc")).toEqual({ estado: "guardada" });
      expect((await envDa(outra.data.id)).Authorization).toBe("abc");
      expect(await c.guardar(idDe(await c.pedir({ alvo: "conector", conector: "outra-http", chave: "Authorization" })), "Token xyz")).toEqual({ estado: "guardada" });
      expect((await envDa(outra.data.id)).Authorization).toBe("Token xyz");
    });
  });

  it("Composio já configurado: nenhum cartão nasce (a chave do time se troca na tela de apps)", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await c.repos.composio.salvarChave(cifra("ak_que_ja_existe"));
      expect((await c.pedir({ alvo: "composio" })).data).toMatchObject({ estado: "recusada", erro: "composio_ja_configurado" });
      expect(await c.repos.propostas.pendentesDaConversa(c.conversaId)).toHaveLength(0);
    });
  });

  it("Composio configurado depois que o cartão nasceu: o cartão não troca a chave do time e fecha como guardada (o time tem chave)", async () => {
    const fetchImpl: typeof fetch = async (url) => (String(url).endsWith("/toolkits?limit=1") ? Response.json({ items: [] }) : new Response("{}", { status: 404 }));
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, { fetchImpl });
      const k = await c.pedir({ alvo: "composio" });
      const kid = k.data.estado === "pendente" ? k.data.proposta_id : "";
      await c.repos.composio.salvarChave(cifra("ak_configurada_na_tela"));
      expect(await c.guardar(kid, "ak_do_cartao")).toEqual({ estado: "guardada" });
      expect((await c.repos.decisoes.buscar(kid))?.estado).toBe("decidida");
      // Nem o recibo nem o bot ouvem que a chave colada foi usada.
      const recibo = (await c.repos.mensagens.listarDaConversa(c.conversaId)).find((m) => m.payload?.kind === "proposta_decidida");
      expect(recibo?.texto).toBe("O time já tinha uma chave do Composio; a colada não foi usada.");
      const [retomada] = await trx<{ entrada_texto: string }[]>`select entrada_texto from turnos where retoma_turno_id = ${c.turno.id}`;
      expect(retomada?.entrada_texto).toContain("a que a pessoa colou não foi usada");
      const cifrada = await c.repos.composio.chave();
      expect(cifrada && decifra(cifrada)).toBe("ak_configurada_na_tela");
    });
  });

  it("critério 2: conector de outra pessoa, inexistente ou nativo e chave inválida voltam erro tipado e nenhum cartão nasce", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      expect((await c.pedir({ alvo: "conector", conector: "nao-existe", chave: "X_KEY" })).data).toMatchObject({ estado: "recusada", erro: "conector_nao_encontrado" });
      expect((await c.pedir({ alvo: "conector", conector: "exemplo", chave: "com espaço" })).data).toMatchObject({ estado: "recusada", erro: "chave_invalida" });
      expect((await c.pedir({ alvo: "conector", conector: "exemplo" })).data).toMatchObject({ estado: "recusada", erro: "chave_invalida" });
      await trx`update conectores set comando = 'nod:github' where id = ${c.conector.id}`;
      expect((await c.pedir({ alvo: "conector", conector: "exemplo", chave: "GITHUB_TOKEN" })).data).toMatchObject({ estado: "recusada", erro: "conector_nativo" });
      expect(await c.repos.propostas.pendentesDaConversa(c.conversaId)).toHaveLength(0);
    });
  });

  it("critério 2 (dono): o conector de outra pessoa conta como inexistente", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const outra = { ...c.deps, escopo: { ...MARLON, pessoaId: "00000000-0000-4000-8000-0000000000ff" } };
      const r = await pedirCredencial(outra, { turnoId: c.turno.id, agenteId: c.agenteId, conversaId: c.conversaId, alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY" });
      expect(r.data).toMatchObject({ estado: "recusada", erro: "conector_nao_encontrado" });
    });
  });

  it("critério 7: recusar em Sua vez ou na conversa retoma o turno com recusada e não muda o env", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const r = await c.pedir({ alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY" });
      const id = r.data.estado === "pendente" ? r.data.proposta_id : "";
      // Em Sua vez o cartão não se "confirma" sem valor: só recusa.
      await c.recusar(id);
      expect(await c.repos.propostas.buscar(id)).toMatchObject({ estado: "recusada" });
      expect((await c.repos.decisoes.buscar(id))?.estado).toBe("decidida");
      const [retomada] = await trx<{ entrada_texto: string }[]>`select entrada_texto from turnos where retoma_turno_id = ${c.turno.id}`;
      expect(retomada?.entrada_texto.startsWith("pedir_credencial: recusada.")).toBe(true);
      expect(await c.env()).toEqual({ EXEMPLO_API_KEY: "chave_velha", OUTRA_VAR: "fica_igual" });
      // Guardar depois de recusado: 409, nada muda.
      await expect(c.guardar(id, SEGREDO)).rejects.toMatchObject({ codigo: "estado_invalido" });
      expect((await c.env()).EXEMPLO_API_KEY).toBe("chave_velha");

      const r2 = await c.pedir({ alvo: "github_token" });
      const id2 = r2.data.estado === "pendente" ? r2.data.proposta_id : "";
      const conv = await recusarPropostaPelaConversa(c.deps, { propostaId: id2, executor: "catcher" } as Parameters<typeof recusarPropostaPelaConversa>[1]);
      expect(conv.data.proposta.estado).toBe("recusada");
      expect(conv.data.decisao?.estado).toBe("decidida");
    });
  });

  it("Sua vez não confirma o cartão sem valor (decidir sem recusar = 409)", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const r = await c.pedir({ alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY" });
      const id = r.data.estado === "pendente" ? r.data.proposta_id : "";
      const rotas = criarRotasDecisoes({ dentro: async (_e, fn) => fn(c.deps), services: c.deps.services });
      const decidir = rotas.find((x) => x.padrao.source.includes("decidir"));
      if (!decidir || decidir.publica) throw new Error("rota");
      const req = new IncomingMessage(new Socket());
      await expect(decidir.handler({ req, res: new ServerResponse(req), escopo: MARLON, params: { id }, corpo: async () => ({}), json: vi.fn() })).rejects.toMatchObject({ codigo: "estado_invalido" });
      expect((await c.repos.decisoes.buscar(id))?.estado).toBe("pendente");
    });
  });

  it("critério 8: duas chamadas no mesmo turno e alvo não criam um segundo cartão; outro alvo cria", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const a = await c.pedir({ alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY", para: "uma coisa" });
      const b = await c.pedir({ alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY", para: "outra coisa" });
      expect(a.data).toMatchObject({ estado: "pendente" });
      expect(b.data).toEqual(a.data);
      const outro = await c.pedir({ alvo: "github_token" });
      expect(outro.data.estado === "pendente" && a.data.estado === "pendente" && outro.data.proposta_id !== a.data.proposta_id).toBe(true);
      expect((await c.repos.propostas.pendentesDaConversa(c.conversaId)).filter((p) => p.kind === "credencial")).toHaveLength(2);
      // QA do PR 553: o dedupe é por turno — outro turno pedindo o mesmo alvo ganha o próprio cartão (é ele que retoma).
      const outroTurno = await c.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.conversaId, agenteId: c.agenteId, origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "de novo", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
      if (!outroTurno) throw new Error("turno");
      const d = await pedirCredencial(c.deps, { turnoId: outroTurno.id, agenteId: c.agenteId, conversaId: c.conversaId, alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY" } as Parameters<typeof pedirCredencial>[1]);
      expect(d.data.estado === "pendente" && a.data.estado === "pendente" && d.data.proposta_id !== a.data.proposta_id).toBe(true);
    });
  });

  it("QA do PR 553: guardar a chave e a sonda passar transforma o 'Conecte o Exemplo' pendente em pedido de permissão (aoConectarApp)", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await pedirAcesso(c.deps, { agenteId: c.agenteId, conversaId: c.conversaId, turnoId: c.turno.id, conector: "exemplo", capacidades: [], nivel: "leitura", nao_pedido: [], para: "Ler os pedidos" });
      expect(await c.repos.propostas.conexoesPendentes("exemplo")).toHaveLength(1);
      const r = await c.pedir({ alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY" });
      const id = r.data.estado === "pendente" ? r.data.proposta_id : "";
      expect(await c.guardar(id, SEGREDO)).toEqual({ estado: "guardada" });
      expect(await c.repos.propostas.conexoesPendentes("exemplo")).toEqual([]);
    });
  });

  it("critério 9: em aprovação automática e em ignorar todas, o cartão nasce pendente e nada o resolve sozinho", async () => {
    for (const modo of ["automatico", "total"] as const) {
      await withRollback(MARLON, async (trx) => {
        const c = await cenario(trx, { modo });
        const r = await c.pedir({ alvo: "composio" });
        const id = r.data.estado === "pendente" ? r.data.proposta_id : "";
        expect(r.data.estado).toBe("pendente");
        expect((await c.repos.decisoes.buscar(id))?.estado).toBe("pendente");
        expect((await c.repos.propostas.buscar(id))?.estado).toBe("pendente");
        expect(await trx`select 1 from turnos where retoma_turno_id = ${c.turno.id}`).toHaveLength(0);
      });
    }
  });

  it("critério 6: github_token e composio gravam pelos caminhos atuais (GitHub e Composio conferem antes)", async () => {
    const TOKEN = "ghp_" + "a".repeat(36);
    const chamadas: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const u = String(url);
      chamadas.push(u);
      const h = new Headers(init?.headers);
      if (u === "https://api.github.test/user") return new Response("{}", { status: h.get("authorization") === `Bearer ${TOKEN}` ? 200 : 401 });
      if (u.includes("composio") && u.endsWith("/toolkits?limit=1")) return h.get("x-api-key") === "ak_composio_boa" ? Response.json({ items: [] }) : new Response("{}", { status: 401 });
      throw new Error(`endpoint inesperado ${u}`);
    };
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, { fetchImpl });
      const g = await c.pedir({ alvo: "github_token", para: "comentar no PR" });
      const gid = g.data.estado === "pendente" ? g.data.proposta_id : "";
      await expect(c.guardar(gid, "nao_e_token")).rejects.toMatchObject({ codigo: "entrada_invalida" });
      await expect(c.guardar(gid, "ghp_" + "b".repeat(36))).rejects.toMatchObject({ codigo: "integracao_autenticacao" });
      expect((await c.repos.decisoes.buscar(gid))?.estado).toBe("pendente");
      expect(await c.guardar(gid, TOKEN)).toEqual({ estado: "guardada" });
      const gh = await c.repos.conectores.buscarPorSlug("github");
      expect(gh?.envCifrado && JSON.parse(decifra(gh.envCifrado))).toMatchObject({ GITHUB_TOKEN: TOKEN });
      // Revisão 8: habilitado na mesma tx que fecha o cartão — a retomada nasce com o GitHub já ligado.
      expect(gh?.habilitado).toBe(true);
      // Revisão 9: a sonda do GitHub roda fora de tx (txAbertas 0), entre a gravação e o fechamento.
      expect(c.eventos.filter((e) => e.startsWith("sonda"))).toEqual(["sonda:0"]);
      expect((await c.repos.propostas.buscar(gid))?.estado).toBe("confirmada");

      const k = await c.pedir({ alvo: "composio" });
      const kid = k.data.estado === "pendente" ? k.data.proposta_id : "";
      await expect(c.guardar(kid, "ak_composio_ruim")).rejects.toBeInstanceOf(ErroDeDominio);
      expect((await c.repos.decisoes.buscar(kid))?.estado).toBe("pendente");
      expect(await c.guardar(kid, "ak_composio_boa")).toEqual({ estado: "guardada" });
      const cifrada = await c.repos.composio.chave();
      expect(cifrada && decifra(cifrada)).toBe("ak_composio_boa");
      expect((await tabelasCom(trx, TOKEN)).achadas).toEqual([]);
      expect((await tabelasCom(trx, "ak_composio_boa")).achadas).toEqual([]);
    });
  });

  it("valor vazio, com quebra de linha ou grande demais é entrada_invalida e não mexe no env", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const r = await c.pedir({ alvo: "conector", conector: "exemplo", chave: "EXEMPLO_API_KEY" });
      const id = r.data.estado === "pendente" ? r.data.proposta_id : "";
      for (const ruim of ["", "   ", "a\nb", "a\u0000b", "a\tb", "x".repeat(4097), 42, null, "a\u200bb", "a\ufeffb", "a\u00a0b", "ab\u2060"]) await expect(c.guardar(id, ruim)).rejects.toMatchObject({ codigo: "entrada_invalida" });
      expect((await c.env()).EXEMPLO_API_KEY).toBe("chave_velha");
      expect(c.sondas()).toBe(0);
    });
  });

  it("revisão 8: header http fora de Latin-1 é entrada_invalida (não 'não respondeu'); x-api-key e X-API-Key são o mesmo cartão", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await registrarConector(c.deps, { nome: "Loja", slug: "loja-http", transporte: "http", url: "https://mcp.loja.test/mcp", env: { "X-API-Key": "velha" }, declaracao: "nao-toca", cifrar: cifra } as Parameters<typeof registrarConector>[1]);
      const r = await c.pedir({ alvo: "conector", conector: "loja-http", chave: "x-api-key" });
      expect(await c.repos.propostas.buscar(r.data.estado === "pendente" ? r.data.proposta_id : "")).toMatchObject({ payload: { chave: "X-API-Key" } });
      const r2 = await c.pedir({ alvo: "conector", conector: "loja-http", chave: "X-API-Key" });
      expect(r2.data.estado === "pendente" && r2.data.proposta_id).toBe(r.data.estado === "pendente" && r.data.proposta_id);
      await expect(c.guardar(r.data.estado === "pendente" ? r.data.proposta_id : "", "chave\u2603")).rejects.toMatchObject({ codigo: "entrada_invalida" });
      expect(c.sondas()).toBe(0);
    });
  });

  it("revisão 8: GitHub aceita o token mas a sonda do conector falha — guarda, fecha, e a retomada diz que o conector não subiu", async () => {
    const TOKEN = "ghp_" + "c".repeat(36);
    const fetchImpl: typeof fetch = async (url, init) => (String(url) === "https://api.github.test/user" && new Headers(init?.headers).get("authorization") === `Bearer ${TOKEN}` ? new Response("{}") : new Response("{}", { status: 401 }));
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, { fetchImpl, sonda: () => ({ ok: false, motivo: "conector_indisponivel" }) });
      const g = await c.pedir({ alvo: "github_token" });
      const gid = g.data.estado === "pendente" ? g.data.proposta_id : "";
      expect(await c.guardar(gid, TOKEN)).toEqual({ estado: "guardada" });
      expect((await c.repos.propostas.buscar(gid))?.estado).toBe("confirmada");
      expect((await c.repos.conectores.buscarPorSlug("github"))?.habilitado).toBe(false);
      const [retomada] = await trx<{ entrada_texto: string }[]>`select entrada_texto from turnos where retoma_turno_id = ${c.turno.id}`;
      expect(retomada?.entrada_texto).toContain("o conector não subiu");
      expect(retomada?.entrada_texto).not.toContain("passam a usá-lo");
    });
  });
});
