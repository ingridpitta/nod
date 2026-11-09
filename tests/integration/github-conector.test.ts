import { generateKeyPairSync, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { chaveDe, cifrar, decifrar } from "../../src/db/cifra.ts";
import { configGithubNativo, sondaGithubNativa } from "../../src/adapters/conectores-locais/github/nativo.ts";
import { rotasConectores } from "../../src/adapters/http/rotas/conectores.ts";
import type { DentroDeTx } from "../../src/adapters/http/rotas/dentro-de-tx.ts";
import { rotasMarketplace } from "../../src/adapters/http/rotas/marketplace.ts";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import { CAPACIDADES_GITHUB, COMANDO_GITHUB_NATIVO } from "../../src/contracts/github.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import { criarConectoresVivos } from "../../src/services/conectores-vivos.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { chamarFerramenta, registrarExecucaoLocal } from "../../src/use-cases/chamar-ferramenta.ts";
import { assentarAprovacao, executarItens, marcarEDecidir } from "../../src/use-cases/decidir.ts";
import { decidirAcesso } from "../../src/use-cases/decidir-acesso.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { concluirItemNaMaquina, expirarItensNaMaquina, itensParaAMaquina } from "../../src/use-cases/itens-na-maquina.ts";
import { pedirAcesso } from "../../src/use-cases/pedir-acesso.ts";
import { pedirAprovacao } from "../../src/use-cases/pedir-aprovacao.ts";
import { permitirSempre } from "../../src/use-cases/permitir-sempre.ts";
import { dispensarDecisao } from "../../src/use-cases/dispensar-decisao.ts";
import { REGRA_TRABALHO_PARADO } from "../../src/use-cases/trabalhos.ts";
import { registrarConector } from "../../src/use-cases/registrar-conector.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const CHAVE = chaveDe("teste-github-local");
const LEITURA = CAPACIDADES_GITHUB.filter((c) => c.readOnlyHint).map((c) => c.nome);
const TODAS = CAPACIDADES_GITHUB.map((c) => c.nome);
// revisto em 2026-09-25 (ADR-049, revisão do PR #68): "escrita" pelo nível não leva pr_revisar (aprovar PR não
// diz que só edita: grupo "outras"); ela continua podendo ser pedida pelo nome.
const DA_ESCRITA = TODAS.filter((n) => n !== "pr_revisar");
const HORA = 3_600_000;

type Opcoes = { carregarDaTx?: boolean; executarNaMaquina?: NonNullable<Deps["services"]["github"]>["executarNaMaquina"] };

/**
 * Deps sobre a tx real com o que o GitHub nativo toca de verdade: a "sonda" estática (a mesma função
 * da composição), o gh do Mac (falso: é a máquina do teste) e o spawn de servidor pelos jeitos do
 * servidor. `carregarDaTx` faz `carregar` ler a tx do teste como a composição lê uma linha gravada.
 * `chamadas` espiona o contexto (rotina ou não) com que o servidor chama o conector.
 */
function depsGithub(trx: Tx, escopo: Escopo, gh: boolean, opcoes: Opcoes = {}): { deps: Deps; repos: Repos; chamadas: { tool: string; rotina: boolean }[] } {
  const base = depsSobre(trx, escopo);
  const chamadas: { tool: string; rotina: boolean }[] = [];
  const vivos = criarConectoresVivos({
    agora: () => Date.now(),
    carregar: async (id, contexto) => {
      if (!opcoes.carregarDaTx) return null;
      const c = await base.repos.conectores.buscar(id);
      if (!c) return null;
      const r = configGithubNativo({ envConector: c.envCifrado ? (JSON.parse(decifrar(c.envCifrado, CHAVE)) as Record<string, string>) : {}, app: null, rotina: contexto.rotina, ambiente: process.env });
      return r.ok ? { nome: c.slug, transporte: "stdio", comando: r.cfg.comando, args: r.cfg.args, env: r.cfg.env } : null;
    },
    sondarNativo: async (c) => sondaGithubNativa({ ghNaMaquina: gh, envChaves: Object.keys(c.env), appConfigurado: false }),
  });
  const conectores = { sondar: vivos.sondar, chamar: async (_id: string, tool: string, _args: Record<string, unknown>, contexto?: { rotina: boolean }) => {
    chamadas.push({ tool, rotina: contexto?.rotina ?? false });
    return { conteudo: `servidor:${tool}`, isError: false };
  } };
  const github = { prontoSemConfiguracao: async () => (gh ? ("gh" as const) : null), ...(opcoes.executarNaMaquina ? { executarNaMaquina: opcoes.executarNaMaquina } : {}) };
  const deps: Deps = { ...base.deps, services: { ...base.deps.services, conectores, github } };
  return { deps, repos: base.repos, chamadas };
}

async function turnoDaConversa(repos: Repos, conversaId: string, agenteId: string): Promise<string> {
  const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "revise o PR 466", entradaConfianca: "confiavel", modelo: "m" });
  if (!t) throw new Error("turno");
  return t.id;
}

/** GitHub nativo pronto pelo gh + acesso de escrita permitido pela pessoa (o caminho de pedir_acesso). */
async function githubComAcesso(deps: Deps, repos: Repos, conversaId: string, agenteId: string): Promise<string> {
  const pedido = await pedirAcesso(deps, { turnoId: await turnoDaConversa(repos, conversaId, agenteId), conversaId, agenteId, conector: "github", capacidades: TODAS, nivel: "escrita", nao_pedido: [] });
  await decidirAcesso(deps, { decisaoId: pedido.data.proposta_id, recusar: false, executor: "catcher" });
  return (await repos.conectores.buscarPorSlug("github"))?.id ?? "";
}

async function planoDoTurno(deps: Deps, turnoId: string, ghNaMaquina: boolean): Promise<PlanoTurno> {
  return (await emitirPlanoTurno(deps, { turnoId, machineId: randomUUID(), executor: "catcher", ghNaMaquina })).data;
}

describeIntegracao("GitHub nativo: registro sem configuração e execução na máquina (ADR-048)", () => {
  it("gh do Mac: pedir_acesso cria o conector nativo habilitado e o card já sai com o botão de permitir (escrita = o nível, sem aprovar PR)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Dev 1" });
      const { deps, repos } = depsGithub(trx, MARLON, true);
      const turnoId = await turnoDaConversa(repos, conversaId, agenteId);

      const r = await pedirAcesso(deps, { turnoId, conversaId, agenteId, conector: "github", capacidades: [], nivel: "escrita", nao_pedido: [] });
      expect(r.data.estado).toBe("aguardando_pessoa");
      const conector = await repos.conectores.buscarPorSlug("github");
      expect(conector).toMatchObject({ transporte: "stdio", comando: COMANDO_GITHUB_NATIVO, habilitado: true, env: {}, envCifrado: null, declaracao: "toca" });
      expect(conector?.catalogo.map((c) => [c.nome, c.readOnlyHint])).toEqual(CAPACIDADES_GITHUB.map((c) => [c.nome, c.readOnlyHint]));
      expect((await repos.propostas.buscar(r.data.proposta_id))?.payload).toEqual({ kind: "acesso", turnoId, conector: "github", capacidades: DA_ESCRITA, nivel: "escrita", naoPedido: [] });
      expect(await repos.decisoes.buscar(r.data.proposta_id)).toMatchObject({ tipo: "acesso", estado: "pendente", frase: "Dev 1 precisa ler e alterar seu GitHub (8 ações). Não inclui a outra ação do GitHub." });
      expect((await decidirAcesso(deps, { decisaoId: r.data.proposta_id, recusar: false, executor: "catcher" })).data).toMatchObject({ concessoes: 8 });

      // O segundo pedido não recria nada: o conector já está pronto.
      await pedirAcesso(deps, { turnoId: await turnoDaConversa(repos, conversaId, agenteId), conversaId, agenteId, conector: "github", capacidades: ["pr_ver"], nivel: "leitura", nao_pedido: [] });
      expect((await repos.conectores.listar()).filter((c) => c.slug === "github")).toHaveLength(1);
    });
  });

  it("A(b,c): máquina do turno com gh → o plano marca o GitHub DELA para a máquina e o servidor devolve executarLocal depois de todos os portões; sem gh, o servidor executa", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos, chamadas } = depsGithub(trx, MARLON, true);
      const conectorId = await githubComAcesso(deps, repos, conversaId, agenteId);

      const turnoId = await turnoDaConversa(repos, conversaId, agenteId);
      const plano = await planoDoTurno(deps, turnoId, true);
      const doGithub = plano.catalogo.ferramentas.filter((f) => f.conectorId === conectorId);
      expect(doGithub).toHaveLength(9);
      expect(doGithub.every((f) => f.execucao === "maquina")).toBe(true);
      expect(plano.catalogo.ferramentas.filter((f) => f.origem === "nod").every((f) => f.execucao === undefined)).toBe(true);

      const args = { repositorio: "acme/nod", numero: 466 };
      const r = await chamarFerramenta(deps, { turnoId, agenteId, nome: "github__pr_ver", argumentos: args, plano });
      expect(r.data).toEqual({ executarLocal: { capacidade: "pr_ver", argumentos: args } });
      expect(chamadas).toEqual([]);
      // Portões valem igual: schema errado é negado ANTES de qualquer coisa sair para a máquina.
      expect((await chamarFerramenta(deps, { turnoId, agenteId, nome: "github__pr_ver", argumentos: { repositorio: "acme/nod" }, plano })).data).toMatchObject({ ok: false, negacao: { motivo: "args_invalidos" } });
      // A trilha tem a chamada e, relatado pela máquina, o desfecho; ferramenta não marcada não ganha linha.
      expect(await registrarExecucaoLocal(deps, { turnoId, agenteId, plano, nome: "github__pr_ver", codigo: "sem_login" })).toBe(true);
      expect(await registrarExecucaoLocal(deps, { turnoId, agenteId, plano, nome: "lembrar", codigo: "ok" })).toBe(false);
      const trilha = (await repos.trilha.filtrar({ agenteId })).filter((t) => t.ferramenta === "github__pr_ver");
      expect(trilha.filter((t) => t.kind !== "negacao").map((t) => [t.kind, t.motivo]).sort()).toEqual([["execucao_local", "sem_login"], ["tool_call", null]]);
      expect(trilha.filter((t) => t.kind === "negacao").map((t) => t.motivo)).toEqual(["args_invalidos"]);

      // Concessão revogada: a máquina nem é chamada.
      const concessao = (await repos.concessoes.doAgente(agenteId)).find((c) => c.capacidade === "pr_comentar");
      await repos.concessoes.revogar(concessao?.id ?? "");
      expect((await chamarFerramenta(deps, { turnoId, agenteId, nome: "github__pr_comentar", argumentos: { ...args, texto: "oi" }, plano })).data).toMatchObject({ ok: false, negacao: { motivo: "capacidade_desligada" } });

      // Máquina sem gh neste turno: nada marcado; o servidor chama pelo jeito dele, como turno INTERATIVO (sem App).
      const semGh = await planoDoTurno(deps, await turnoDaConversa(repos, conversaId, agenteId), false);
      expect(semGh.catalogo.ferramentas.some((f) => f.execucao === "maquina")).toBe(false);
      await chamarFerramenta(deps, { turnoId: semGh.turnoId, agenteId, nome: "github__pr_ver", argumentos: args, plano: semGh });
      expect(chamadas).toEqual([{ tool: "pr_ver", rotina: false }]);
    });
  });

  // revisto em 2026-10-01 (ADR-066, "o bot tem o que você deu; o modo decide"): aprovar PR não é mais negado direto em
  // todo modo, e o catálogo do turno não confiável não encolhe mais para a leitura.
  it("ADR-047 × ADR-048 × ADR-066: aprovar PR marcado para a máquina passa pela decisão do modo antes do executarLocal — no manual é recusado, no automático vai para a máquina (e marca o turno); turno não confiável leva o catálogo inteiro para a máquina", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos, chamadas } = depsGithub(trx, MARLON, true);
      const conectorId = await githubComAcesso(deps, repos, conversaId, agenteId);

      const plano = await planoDoTurno(deps, await turnoDaConversa(repos, conversaId, agenteId), true);
      expect(plano.catalogo.ferramentas.find((f) => f.nome === "github__pr_revisar")?.execucao).toBe("maquina");
      const aprovar = { repositorio: "acme/nod", numero: 466, evento: "approve" };
      // Manual: aprovar PR nunca vira "Sempre permitir" e pede a pessoa — negação transitória, nada sai para a máquina.
      const r = await chamarFerramenta(deps, { turnoId: plano.turnoId, agenteId, nome: "github__pr_revisar", argumentos: aprovar, plano });
      expect(r.data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
      expect(r.data).not.toHaveProperty("executarLocal");
      expect(chamadas).toEqual([]);
      expect(await repos.turnos.contaminado(plano.turnoId)).toBe(false);

      // Automático: a mesma chamada passa por todos os portões e volta como executarLocal (antes: negada em QUALQUER modo).
      await repos.agentes.definirModoAprovacao(agenteId, "automatico");
      const auto = await chamarFerramenta(deps, { turnoId: plano.turnoId, agenteId, nome: "github__pr_revisar", argumentos: aprovar, plano });
      expect(auto.data).toEqual({ executarLocal: { capacidade: "pr_revisar", argumentos: aprovar } });
      expect(chamadas).toEqual([]);
      // O GitHub é app de fora: chamá-lo marca o turno, também quando roda no gh do Mac.
      expect(await repos.turnos.contaminado(plano.turnoId)).toBe(true);

      const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "veio de fora", entradaConfianca: "nao_confiavel", modelo: "m" });
      const naoConfiavel = await planoDoTurno(deps, t?.id ?? "", true);
      const doGithub = naoConfiavel.catalogo.ferramentas.filter((f) => f.conectorId === conectorId);
      expect(doGithub.map((f) => f.nome).sort()).toEqual(CAPACIDADES_GITHUB.map((c) => `github__${c.nome}`).sort());
      expect(doGithub.every((f) => f.execucao === "maquina")).toBe(true);
      // No automático, o conteúdo de fora não para a escrita: comentar vai para a máquina.
      const comentar = { repositorio: "acme/nod", numero: 466, texto: "ok" };
      expect((await chamarFerramenta(deps, { turnoId: naoConfiavel.turnoId, agenteId, nome: "github__pr_comentar", argumentos: comentar, plano: naoConfiavel })).data).toEqual({ executarLocal: { capacidade: "pr_comentar", argumentos: comentar } });
    });
  });

  it("pedido de leitura sem capacidades nomeadas entra só com as de leitura", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsGithub(trx, MARLON, true);
      const r = await pedirAcesso(deps, { turnoId: await turnoDaConversa(repos, conversaId, agenteId), conversaId, agenteId, conector: "github", capacidades: [], nivel: "leitura", nao_pedido: [] });
      expect((await repos.propostas.buscar(r.data.proposta_id))?.payload).toMatchObject({ capacidades: LEITURA, nivel: "leitura" });
      expect((await repos.decisoes.buscar(r.data.proposta_id))?.frase).toContain("Não inclui: comentar, revisar pull requests.");
    });
  });

  it("sem gh logado: nada nasce e o pedido vira o card de conexão de sempre", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsGithub(trx, MARLON, false);
      const r = await pedirAcesso(deps, { turnoId: await turnoDaConversa(repos, conversaId, agenteId), conversaId, agenteId, conector: "github", capacidades: [], nivel: "leitura", nao_pedido: [] });
      expect((await repos.propostas.buscar(r.data.proposta_id))?.payload).toMatchObject({ conectar: true, conector: "github" });
      expect(await repos.decisoes.buscar(r.data.proposta_id)).toBeNull();
      expect(await repos.conectores.buscarPorSlug("github")).toBeNull();
    });
  });

  it("D+G: o github do Composio (HTTP) é trocado só pelo clique, sem sondar a URL velha, e os acessos e o 'Sempre permitir' seguem pelos nomes estáveis", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsGithub(trx, MARLON, true, { carregarDaTx: true });
      const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome, schema: { type: "object" }, readOnlyHint });
      const legado = await repos.conectores.criar({ nome: "GitHub", slug: "github", transporte: "http", url: "https://backend.composio.dev/tool_router/v3/trs_x/mcp", envCifrado: "v1:x:y:z", envChaves: ["x-api-key"], declaracao: "toca" });
      if (!legado) throw new Error("legado");
      await repos.conectores.registrarSonda(legado.id, { ok: true, catalogo: [cap("GITHUB_GET_A_PULL_REQUEST", true), cap("GITHUB_CREATE_AN_ISSUE_COMMENT", false), cap("GITHUB_LIST_BRANCHES", true)], agora: Date.now() });
      // A pessoa tinha dado leitura + comentar pelo Composio, e "Sempre permitir" para comentar.
      const acesso = await pedirAcesso(deps, { turnoId: await turnoDaConversa(repos, conversaId, agenteId), conversaId, agenteId, conector: "github", capacidades: ["GITHUB_GET_A_PULL_REQUEST", "GITHUB_CREATE_AN_ISSUE_COMMENT", "GITHUB_LIST_BRANCHES"], nivel: "escrita", nao_pedido: [] });
      const concedido = await decidirAcesso(deps, { decisaoId: acesso.data.proposta_id, recusar: false, executor: "catcher" });
      const origem = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, turnoId: null, prazoDecisaoEm: Date.now() + HORA, frase: "comentar" });
      const [item] = await repos.itensAprovacao.criarLote(origem?.id ?? "", [{ idx: 0, texto: "comentar", destino: { conector: "github", ferramenta: "GITHUB_CREATE_AN_ISSUE_COMMENT", argumentos: {} }, origemSensivel: false }]);
      await repos.permissoesPermanentes.criar({ agenteId, conectorId: legado.id, capacidade: "GITHUB_CREATE_AN_ISSUE_COMMENT", itemOrigemId: item?.id ?? "", mensagemId: concedido.data.consentimentoId ?? "", regraVersao: 1 });

      // Um AGENTE pedindo acesso nunca troca o conector que a pessoa ligou pelo Composio.
      await pedirAcesso(deps, { turnoId: await turnoDaConversa(repos, conversaId, agenteId), conversaId, agenteId, conector: "github", capacidades: ["GITHUB_GET_A_PULL_REQUEST"], nivel: "leitura", nao_pedido: [] });
      expect(await repos.conectores.buscar(legado.id)).toMatchObject({ transporte: "http" });

      const dentro: DentroDeTx = (escopo, fn) => fn({ ...deps, escopo, repos: depsSobre(trx, escopo).repos });
      // fetch que explode: nem o Composio nem a URL velha são tocados — a sonda do nativo é o contrato.
      const srv = await servidorDeTeste([
        ...rotasMarketplace({ dentro, cifrar: (s) => s, decifrar: (s) => s, fetchImpl: async () => { throw new Error("nada de rede"); } }),
        ...rotasConectores({ dentro, cifrar: (s) => s, decifrar: (s) => s, fetchImpl: async () => { throw new Error("nada de rede"); } }),
      ]);
      try {
        const sessao = await srv.entrar("marlon");
        const r = await srv.chamar(sessao, "POST", "marketplace/github/conectar");
        expect(await r.json()).toEqual({ conectado: true, conectorId: legado.id });
        expect(await repos.conectores.buscar(legado.id)).toMatchObject({ transporte: "stdio", comando: COMANDO_GITHUB_NATIVO, url: null, habilitado: true, envCifrado: null });
      } finally {
        await srv.close();
      }
      const concessoes = await repos.concessoes.doAgente(agenteId);
      // Revisão 2026-09-25: GITHUB_LIST_BRANCHES não tem par e não vira as 7 leituras; a concessão antiga some.
      expect(concessoes.map((c) => c.capacidade).sort()).toEqual(["pr_comentar", "pr_ver"]);
      expect(new Set(concessoes.map((c) => c.mensagemId))).toEqual(new Set([concedido.data.consentimentoId]));
      const regras = await repos.permissoesPermanentes.listar(agenteId);
      expect(regras.filter((p) => p.inativoEm === null).map((p) => p.capacidade)).toEqual(["pr_comentar"]);
      expect(regras.find((p) => p.capacidade === "GITHUB_CREATE_AN_ISSUE_COMMENT")?.inativoMotivo).toBe("capacidade_fora_do_catalogo");
      // O plano do agente já sai com os nomes estáveis e o "Sempre permitir" de comentar.
      const plano = await planoDoTurno(deps, await turnoDaConversa(repos, conversaId, agenteId), true);
      expect(plano.semprePermitir).toEqual(["github__pr_comentar"]);
    });
  });

  it("github registrado À MÃO (stdio) nunca é trocado, nem pelo clique", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, repos } = depsGithub(trx, MARLON, true);
      const manual = await repos.conectores.criar({ nome: "Meu GitHub", slug: "github", transporte: "stdio", comando: "npx", args: ["github-mcp"], declaracao: "toca" });
      const dentro: DentroDeTx = (escopo, fn) => fn({ ...deps, escopo, repos: depsSobre(trx, escopo).repos });
      const srv = await servidorDeTeste(rotasMarketplace({ dentro, cifrar: (s) => s, decifrar: (s) => s }));
      try {
        const sessao = await srv.entrar("marlon");
        const r = await (await srv.chamar(sessao, "POST", "marketplace/github/conectar")).json() as { conectado: boolean; frase: string };
        expect(r.conectado).toBe(false);
        expect(r.frase).toContain("registrado à mão");
        expect((await srv.chamar(sessao, "POST", "marketplace/github/token", { token: "ghp_aceitoaceitoaceitoaceito1" })).status).not.toBe(200);
      } finally {
        await srv.close();
      }
      expect(await repos.conectores.buscar(manual?.id ?? "")).toMatchObject({ comando: "npx", args: ["github-mcp"] });
    });
  });

  it("token pessoal (campo avançado): o GitHub é perguntado antes, o token vai cifrado e o conector fica pronto pelo jeito token", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, repos } = depsGithub(trx, MARLON, false, { carregarDaTx: true });
      const dentro: DentroDeTx = (escopo, fn) => fn({ ...deps, escopo, repos: depsSobre(trx, escopo).repos });
      const perguntas: string[] = [];
      const fakeFetch: typeof fetch = async (url, init) => {
        perguntas.push(String(url));
        return new Headers(init?.headers).get("authorization") === "Bearer ghp_aceitoaceitoaceitoaceito1" ? Response.json({ login: "marlon" }) : new Response("{}", { status: 401 });
      };
      const cifra = (s: string) => cifrar(s, CHAVE);
      const srv = await servidorDeTeste([
        ...rotasMarketplace({ dentro, cifrar: cifra, decifrar: (s) => decifrar(s, CHAVE), fetchImpl: fakeFetch, apiGithub: "https://api.github.test" }),
        ...rotasConectores({ dentro, cifrar: cifra, decifrar: (s) => decifrar(s, CHAVE), fetchImpl: async () => { throw new Error("sem provedor"); } }),
      ]);
      try {
        const sessao = await srv.entrar("marlon");
        expect((await srv.chamar(sessao, "POST", "marketplace/github/token", { token: "nao-e-token" })).status).toBe(400);
        expect((await srv.chamar(sessao, "POST", "marketplace/github/token", { token: "ghp_recusadorecusadorecusado1" })).status).toBe(403);
        expect(await repos.conectores.buscarPorSlug("github")).toBeNull();

        const r = await srv.chamar(sessao, "POST", "marketplace/github/token", { token: "ghp_aceitoaceitoaceitoaceito1" });
        expect(await r.json()).toMatchObject({ conectado: true, conector: { slug: "github", habilitado: true, env: { GITHUB_TOKEN: true } } });
        expect(perguntas).toEqual(["https://api.github.test/user", "https://api.github.test/user"]);
        const guardado = await repos.conectores.buscarPorSlug("github");
        expect(guardado?.envCifrado).not.toContain("ghp_");
        expect(JSON.parse(decifrar(guardado?.envCifrado ?? "", CHAVE))).toEqual({ GITHUB_TOKEN: "ghp_aceitoaceitoaceitoaceito1" });
        expect(guardado?.catalogo).toHaveLength(9);
        expect(await (await srv.chamar(sessao, "GET", "conectores")).text()).not.toContain("ghp_aceito");
        // Sem gh, Conectar usa o token já guardado: nada de Composio, nada de nova tela.
        expect(await (await srv.chamar(sessao, "POST", "marketplace/github/conectar")).json()).toEqual({ conectado: true, conectorId: guardado?.id, jeito: "token" });
      } finally {
        await srv.close();
      }
    });
  });

  it("sem gh e sem token: o Composio vira um jeito DENTRO do GitHub nativo — mesmos nomes, menos o que o Composio não tem", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, repos } = depsGithub(trx, MARLON, false, { carregarDaTx: true });
      const dentro: DentroDeTx = (escopo, fn) => fn({ ...deps, escopo, repos: depsSobre(trx, escopo).repos });
      await repos.composio.salvarChave(cifrar("ak_segredo", CHAVE));
      const userId = `nod:${TENANT_PADRAO}:${PESSOA_MARLON}`;
      const fakeFetch: typeof fetch = async (url) => {
        const u = String(url);
        if (u.endsWith("/tool_router/session")) return Response.json({ session_id: "trs_gh", mcp: { url: "https://backend.composio.dev/tool_router/v3/trs_gh/mcp" } });
        if (u.endsWith("/link")) return Response.json({ redirect_url: "https://connect.composio.dev/link/lk_gh", connected_account_id: "ca_gh" });
        if (u.endsWith("/connected_accounts/ca_gh")) return Response.json({ status: "ACTIVE", user_id: userId, toolkit: { slug: "github" } });
        if (u.endsWith("/tool_router/session/trs_gh")) return Response.json({});
        throw new Error(`inesperado: ${u}`);
      };
      const cifra = (s: string) => cifrar(s, CHAVE);
      const srv = await servidorDeTeste(rotasMarketplace({ dentro, cifrar: cifra, decifrar: (s) => decifrar(s, CHAVE), fetchImpl: fakeFetch }));
      try {
        const sessao = await srv.entrar("marlon");
        const inicio = await (await srv.chamar(sessao, "POST", "marketplace/github/conectar")).json() as { url: string; conectorId: string };
        expect(inicio.url).toBe("https://connect.composio.dev/link/lk_gh");
        const antes = await repos.conectores.buscar(inicio.conectorId);
        expect(antes).toMatchObject({ slug: "github", comando: COMANDO_GITHUB_NATIVO, habilitado: false, env: { COMPOSIO_API_KEY: true, COMPOSIO_URL: true } });
        expect(antes?.envCifrado).not.toContain("ak_segredo");
        expect(await (await srv.chamar(sessao, "POST", "marketplace/github/verificar")).json()).toMatchObject({ conectado: true, conector: { habilitado: true } });
        expect((await repos.conectores.buscar(inicio.conectorId))?.catalogo.map((c) => c.nome)).toEqual(["pr_ver", "pr_arquivos", "pr_comentarios", "arquivo_ler", "issue_ver", "pr_comentar", "pr_revisar"]);
      } finally {
        await srv.close();
      }
    });
  });

  it("sem gh, sem token e sem Composio: Conectar GitHub devolve a frase do que fazer, não um erro", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps } = depsGithub(trx, MARLON, false);
      const dentro: DentroDeTx = (escopo, fn) => fn({ ...deps, escopo, repos: depsSobre(trx, escopo).repos });
      const srv = await servidorDeTeste(rotasMarketplace({ dentro, cifrar: (s) => s, decifrar: (s) => s }));
      try {
        const sessao = await srv.entrar("marlon");
        const r = await (await srv.chamar(sessao, "POST", "marketplace/github/conectar")).json() as { conectado: boolean; frase: string };
        expect(r.conectado).toBe(false);
        expect(r.frase).toContain("gh auth login");
      } finally {
        await srv.close();
      }
    });
  });

  it("d: escrita aprovada que roda no Mac espera o Mac ('aguardando seu Mac'), o Mac puxa, executa e relata; aí sai o resultado e a retomada — uma vez só", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos, chamadas } = depsGithub(trx, MARLON, true);
      await githubComAcesso(deps, repos, conversaId, agenteId);
      const turnoId = await turnoDaConversa(repos, conversaId, agenteId);
      const plano = await planoDoTurno(deps, turnoId, true);
      const pedido = await pedirAprovacao(deps, { turnoId, agenteId, conversaId, plano, resumo: "Comentar no PR 466", itens: [{ texto: "Faltou teste", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: { repositorio: "acme/nod", numero: 466, texto: "Faltou teste" } } }] });
      expect(pedido.data).toMatchObject({ estado: "pendente" });
      const decisaoId = pedido.data.estado === "pendente" ? pedido.data.decisao_id : "";
      expect((await repos.itensAprovacao.listar(decisaoId))[0]?.destino.execucao).toBe("maquina");

      // A pessoa aprova: o servidor NÃO executa (é o gh do Mac dela) e a conversa diz que espera o Mac.
      const fase1 = await marcarEDecidir(deps, { decisaoId });
      const desfechos = await executarItens(deps.services, fase1.data.aExecutar);
      expect(desfechos).toEqual([]);
      expect(chamadas).toEqual([]);
      const fase2 = await assentarAprovacao(deps, { decisaoId, desfechos });
      expect(fase2.data.turnoRetomadaId).toBeNull();
      const espera = (await repos.mensagens.listarDaConversa(conversaId, 50)).find((m) => m.id === fase2.data.mensagemId);
      expect(espera?.texto).toContain("aguarda seu Mac");

      // O Mac puxa: recebe capacidade e argumentos com o texto final; executa e relata.
      const itens = await itensParaAMaquina(deps);
      expect(itens).toEqual([{ itemId: expect.any(String), capacidade: "pr_comentar", argumentos: { repositorio: "acme/nod", numero: 466, texto: "Faltou teste" } }]);
      const fechou = await concluirItemNaMaquina(deps, { itemId: itens[0]?.itemId ?? "", desfecho: "executado" });
      expect(fechou.events.some((e) => e.kind === "turno_criado")).toBe(true);
      expect(await itensParaAMaquina(deps)).toEqual([]);
      expect((await repos.itensAprovacao.listar(decisaoId))[0]?.desfecho).toBe("executado");
      // O relato repetido (retry da ponte) não refaz nada.
      expect((await concluirItemNaMaquina(deps, { itemId: itens[0]?.itemId ?? "", desfecho: "falhou_na_execucao" })).events).toEqual([]);
      expect((await repos.itensAprovacao.listar(decisaoId))[0]?.desfecho).toBe("executado");
      // NOD-70: o cartão e o clique que o Mac executou vão à trilha, uma linha cada (o relato repetido não duplica).
      const trilha = (await repos.trilha.doTurno(turnoId)).filter((l) => l.ferramenta === "github__pr_comentar");
      expect(trilha.map((l) => [l.kind, l.regra, l.motivo])).toEqual([["cartao", "regra:cartao", expect.any(String)], ["tool_call", "regra:clique", "item_de_aprovacao"]]);
      const retomadas = (await repos.turnos.listarDaConversa(conversaId, 50)).filter((t) => t.origem === "retomada" && t.retomaTurnoId === turnoId);
      expect(retomadas).toHaveLength(1);
    });
  });

  it("d: o Mac que nunca aparece — o item expira como as decisões, vira falha e a decisão fecha", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = Date.now();
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const base = depsGithub(trx, MARLON, true);
      const deps: Deps = { ...base.deps, agora: () => agora };
      await githubComAcesso(deps, base.repos, conversaId, agenteId);
      const turnoId = await turnoDaConversa(base.repos, conversaId, agenteId);
      const plano = await planoDoTurno(deps, turnoId, true);
      const pedido = await pedirAprovacao(deps, { turnoId, agenteId, conversaId, plano, resumo: "Comentar", itens: [{ texto: "oi", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: { repositorio: "acme/nod", numero: 1, texto: "oi" } } }] });
      const decisaoId = pedido.data.estado === "pendente" ? pedido.data.decisao_id : "";
      const fase1 = await marcarEDecidir(deps, { decisaoId });
      await assentarAprovacao(deps, { decisaoId, desfechos: await executarItens(deps.services, fase1.data.aExecutar) });
      agora += 23 * HORA;
      expect((await expirarItensNaMaquina(deps)).expirados).toBe(0);
      agora += 2 * HORA;
      expect(await itensParaAMaquina(deps)).toEqual([]);
      const r = await expirarItensNaMaquina(deps);
      expect(r.expirados).toBe(1);
      expect((await base.repos.itensAprovacao.listar(decisaoId))[0]?.desfecho).toBe("falhou_na_execucao");
      // NOD-70: a pessoa autorizou; o Mac não rodou. Na trilha é "permitida" pelo clique (a trilha registra a autorização).
      expect((await base.repos.trilha.doTurno(turnoId)).filter((l) => l.kind === "tool_call").map((l) => l.regra)).toEqual(["regra:clique"]);
      expect((await base.repos.mensagens.listarDaConversa(conversaId, 50)).some((m) => m.kind === "resultado_aprovacao")).toBe(true);
    });
  });

  it("d: card do Mac fechado por outra regra (o Parar do trabalho) que o Mac ainda executa vai à trilha com essa regra (NOD-70, revisão 7)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsGithub(trx, MARLON, true);
      await githubComAcesso(deps, repos, conversaId, agenteId);
      const turnoId = await turnoDaConversa(repos, conversaId, agenteId);
      const plano = await planoDoTurno(deps, turnoId, true);
      const pedido = await pedirAprovacao(deps, { turnoId, agenteId, conversaId, plano, resumo: "Comentar", itens: [{ texto: "oi", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: { repositorio: "acme/nod", numero: 1, texto: "oi" } } }] });
      const decisaoId = pedido.data.estado === "pendente" ? pedido.data.decisao_id : "";
      expect(await repos.decisoes.fecharPorRegra(decisaoId, { regra: REGRA_TRABALHO_PARADO, regraVersao: 1, agora: deps.agora() })).not.toBeNull();
      // Hoje o Mac ainda puxa o item (causa raiz em issue à parte); o efeito que sai não pode sumir da trilha.
      const puxados = await itensParaAMaquina(deps);
      expect(puxados).toHaveLength(1);
      await concluirItemNaMaquina(deps, { itemId: puxados[0]?.itemId ?? "", desfecho: "executado" });
      const linhas = (await repos.trilha.doTurno(turnoId)).filter((l) => l.kind === "tool_call" && l.ferramenta === "github__pr_comentar").map((l) => l.regra);
      expect(linhas).toEqual([REGRA_TRABALHO_PARADO]);
    });
  });

  it("d: card parado que o Mac nunca rodou e venceu não vira 'Permitida' na trilha (NOD-70, revisão 9)", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = Date.now();
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const base = depsGithub(trx, MARLON, true);
      const deps: Deps = { ...base.deps, agora: () => agora };
      await githubComAcesso(deps, base.repos, conversaId, agenteId);
      const turnoId = await turnoDaConversa(base.repos, conversaId, agenteId);
      const plano = await planoDoTurno(deps, turnoId, true);
      const pedido = await pedirAprovacao(deps, { turnoId, agenteId, conversaId, plano, resumo: "Comentar", itens: [{ texto: "oi", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: { repositorio: "acme/nod", numero: 1, texto: "oi" } } }] });
      const decisaoId = pedido.data.estado === "pendente" ? pedido.data.decisao_id : "";
      expect(await base.repos.decisoes.fecharPorRegra(decisaoId, { regra: REGRA_TRABALHO_PARADO, regraVersao: 1, agora })).not.toBeNull();
      agora += 25 * HORA;
      expect((await expirarItensNaMaquina(deps)).expirados).toBe(1);
      expect((await base.repos.trilha.doTurno(turnoId)).filter((l) => l.kind === "tool_call")).toEqual([]);
    });
  });

  // Revisão 10: sem autorização, a linha só existe porque o efeito saiu; o Mac relata falha também quando o gh nem rodou.
  for (const fechar of ["parado", "dispensado"] as const) {
    for (const como of ["relato de falha", "varredor"] as const) {
      it(`d: card ${fechar} do Mac com ${como} não vai à trilha como 'Permitida' (NOD-70, revisão 10)`, async () => {
        await withRollback(MARLON, async (trx) => {
          let agora = Date.now();
          const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
          const base = depsGithub(trx, MARLON, true);
          const deps: Deps = { ...base.deps, agora: () => agora };
          await githubComAcesso(deps, base.repos, conversaId, agenteId);
          const turnoId = await turnoDaConversa(base.repos, conversaId, agenteId);
          const plano = await planoDoTurno(deps, turnoId, true);
          const pedido = await pedirAprovacao(deps, { turnoId, agenteId, conversaId, plano, resumo: "Comentar", itens: [{ texto: "oi", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: { repositorio: "acme/nod", numero: 1, texto: "oi" } } }] });
          const decisaoId = pedido.data.estado === "pendente" ? pedido.data.decisao_id : "";
          if (fechar === "parado") expect(await base.repos.decisoes.fecharPorRegra(decisaoId, { regra: REGRA_TRABALHO_PARADO, regraVersao: 1, agora })).not.toBeNull();
          else {
            await base.repos.decisoes.vencerPendentes(agora + 30 * HORA);
            await dispensarDecisao(deps, { decisaoId });
          }
          if (como === "varredor") {
            agora += 25 * HORA;
            await expirarItensNaMaquina(deps);
          } else {
            const puxados = await itensParaAMaquina(deps);
            expect(puxados).toHaveLength(1);
            await concluirItemNaMaquina(deps, { itemId: puxados[0]?.itemId ?? "", desfecho: "falhou_na_execucao" });
          }
          expect((await base.repos.itensAprovacao.listar(decisaoId))[0]?.desfecho).toBe("falhou_na_execucao");
          expect((await base.repos.trilha.doTurno(turnoId)).filter((l) => l.kind === "tool_call")).toEqual([]);
        });
      });
    }
  }

  it("d: card vencido e dispensado (×) que o Mac ainda roda NÃO vira 'Você aprovou no cartão' (NOD-70, revisão 8)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsGithub(trx, MARLON, true);
      await githubComAcesso(deps, repos, conversaId, agenteId);
      const turnoId = await turnoDaConversa(repos, conversaId, agenteId);
      const plano = await planoDoTurno(deps, turnoId, true);
      const pedido = await pedirAprovacao(deps, { turnoId, agenteId, conversaId, plano, resumo: "Comentar", itens: [{ texto: "oi", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: { repositorio: "acme/nod", numero: 1, texto: "oi" } } }] });
      const decisaoId = pedido.data.estado === "pendente" ? pedido.data.decisao_id : "";
      await repos.decisoes.vencerPendentes(deps.agora() + 30 * HORA);
      await dispensarDecisao(deps, { decisaoId });
      // Hoje o Mac ainda puxa o item (NOD-423); se puxar, a linha não pode dizer que a pessoa aprovou.
      for (const i of await itensParaAMaquina(deps)) await concluirItemNaMaquina(deps, { itemId: i.itemId, desfecho: "executado" });
      const regras = (await repos.trilha.doTurno(turnoId)).filter((l) => l.kind === "tool_call" && l.ferramenta === "github__pr_comentar").map((l) => l.regra);
      expect(regras).toEqual(["regra:cartao_dispensado"]);
    });
  });

  it("d: 'Sempre permitir' num turno vivo — o turno espera (aguardar) o Mac executar; a fala 'Fiz sem perguntar' sai quando ele relata, sem retomada", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsGithub(trx, MARLON, true);
      await githubComAcesso(deps, repos, conversaId, agenteId);
      const turnoId = await turnoDaConversa(repos, conversaId, agenteId);
      const plano = await planoDoTurno(deps, turnoId, true);
      const comentar = () => pedirAprovacao(deps, { turnoId, agenteId, conversaId, plano, resumo: "Comentar", itens: [{ texto: "oi", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: { repositorio: "acme/nod", numero: 1, texto: "oi" } } }] });
      // ADR-062: a regra vale pela linha ativa AGORA — o clique no primeiro card já dispensa o segundo, no mesmo turno.
      const primeiro = await comentar();
      const primeiroId = primeiro.data.estado === "pendente" ? primeiro.data.decisao_id : "";
      const [origem] = await repos.itensAprovacao.listar(primeiroId);
      expect((await permitirSempre(deps, { decisaoId: primeiroId, itemIds: [origem?.id ?? ""] })).data.criadas).toHaveLength(1);
      const pedido = await comentar();
      expect(pedido.data).toMatchObject({ estado: "pendente" });
      const decisaoId = pedido.data.estado === "pendente" ? pedido.data.decisao_id : "";
      expect(await repos.decisoes.buscar(decisaoId)).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida_por_regra" } });
      // NOD-70 (revisão 5): o item do Mac liberado por regra vai à trilha NA AUTORIZAÇÃO, com a regra dele, uma vez só.
      const linhasDoItem = async () => (await repos.trilha.doTurno(turnoId)).filter((l) => l.kind === "tool_call" && l.motivo === "item_de_aprovacao").map((l) => [l.ferramenta, l.regra]);
      expect(await linhasDoItem()).toEqual([["github__pr_comentar", "regra:aprovacao_permanente"]]);
      const [item] = await itensParaAMaquina(deps);
      const fim = await concluirItemNaMaquina(deps, { itemId: item?.itemId ?? "", desfecho: "executado" });
      expect(fim.events.map((e) => e.kind)).toEqual(["mensagem_criada"]);
      // O relato do Mac não grava outra linha.
      expect(await linhasDoItem()).toEqual([["github__pr_comentar", "regra:aprovacao_permanente"]]);
      expect((await repos.mensagens.listarDaConversa(conversaId, 50)).some((m) => m.texto.startsWith("Fiz sem perguntar"))).toBe(true);

      // Lote misto de regras no Mac: o comentário (Sempre permitir) e a leitura (consulta). A decisão fecha pela que mais
      // concede; cada item grava a SUA regra na trilha.
      const n = (await linhasDoItem()).length;
      const misto = await pedirAprovacao(deps, { turnoId, agenteId, conversaId, plano, resumo: "Ler e comentar", itens: [
        { texto: "oi", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: { repositorio: "acme/nod", numero: 2, texto: "oi" } } },
        { texto: "ler", destino: { conector: "github", ferramenta: "issue_ver", argumentos: { repositorio: "acme/nod", numero: 2 } } },
      ] });
      const mistoId = misto.data.estado === "pendente" ? misto.data.decisao_id : "";
      expect(await repos.decisoes.buscar(mistoId)).toMatchObject({ desfecho: { tipo: "decidida_por_regra", regra: "regra:aprovacao_permanente" } });
      // As duas linhas têm o mesmo `em` (a ordem segue o id aleatório): compara sem ordem.
      expect((await linhasDoItem()).slice(n).sort()).toEqual([["github__issue_ver", "regra:consulta_sem_decisao"], ["github__pr_comentar", "regra:aprovacao_permanente"]]);
      for (const i of await itensParaAMaquina(deps)) await concluirItemNaMaquina(deps, { itemId: i.itemId, desfecho: "executado" });
      expect(await linhasDoItem()).toHaveLength(n + 2);
    });
  });

  it("d, modo local: o servidor É o Mac da dona — o item aprovado roda na hora, sem esperar", async () => {
    await withRollback(MARLON, async (trx) => {
      const executados: string[] = [];
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsGithub(trx, MARLON, true, { executarNaMaquina: async (escopo, capacidade) => { executados.push(`${escopo.pessoaId}:${capacidade}`); return { conteudo: "{}", isError: false }; } });
      await githubComAcesso(deps, repos, conversaId, agenteId);
      const turnoId = await turnoDaConversa(repos, conversaId, agenteId);
      const plano = await planoDoTurno(deps, turnoId, true);
      const pedido = await pedirAprovacao(deps, { turnoId, agenteId, conversaId, plano, resumo: "Comentar", itens: [{ texto: "oi", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: { repositorio: "acme/nod", numero: 1, texto: "oi" } } }] });
      const decisaoId = pedido.data.estado === "pendente" ? pedido.data.decisao_id : "";
      const fase1 = await marcarEDecidir(deps, { decisaoId });
      const desfechos = await executarItens(deps.services, fase1.data.aExecutar);
      expect(desfechos.map((d) => d.desfecho)).toEqual(["executado"]);
      expect(executados).toEqual([`${PESSOA_MARLON}:pr_comentar`]);
      expect((await assentarAprovacao(deps, { decisaoId, desfechos })).data.turnoRetomadaId).not.toBeNull();
    });
  });

  it("d, modo local + 'Sempre permitir': o item roda na hora e vai à trilha UMA vez, pela regra (NOD-70, revisão 6)", async () => {
    await withRollback(MARLON, async (trx) => {
      const executados: string[] = [];
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsGithub(trx, MARLON, true, { executarNaMaquina: async (_escopo, capacidade) => { executados.push(capacidade); return { conteudo: "{}", isError: false }; } });
      await githubComAcesso(deps, repos, conversaId, agenteId);
      const turnoId = await turnoDaConversa(repos, conversaId, agenteId);
      const plano = await planoDoTurno(deps, turnoId, true);
      const comentar = () => pedirAprovacao(deps, { turnoId, agenteId, conversaId, plano, resumo: "Comentar", itens: [{ texto: "oi", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: { repositorio: "acme/nod", numero: 1, texto: "oi" } } }] });
      const primeiro = await comentar();
      const primeiroId = primeiro.data.estado === "pendente" ? primeiro.data.decisao_id : "";
      const [origem] = await repos.itensAprovacao.listar(primeiroId);
      await permitirSempre(deps, { decisaoId: primeiroId, itemIds: [origem?.id ?? ""] });
      const linhasDoItem = async () => (await repos.trilha.doTurno(turnoId)).filter((l) => l.kind === "tool_call" && l.motivo === "item_de_aprovacao").map((l) => [l.ferramenta, l.regra]);
      const antes = (await linhasDoItem()).length;
      await comentar();
      expect(executados).toContain("pr_comentar");
      expect((await linhasDoItem()).slice(antes)).toEqual([["github__pr_comentar", "regra:aprovacao_permanente"]]);
    });
  });

  it("C: o GitHub App da organização só é cadastrado por quem está em NOD_ADMINS; a Ana lê, não troca; a chave nunca volta", async () => {
    await withRollback(MARLON, async (trx) => {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
      const { deps, repos } = depsGithub(trx, MARLON, false);
      const dentro: DentroDeTx = (escopo, fn) => fn({ ...deps, escopo, repos: depsSobre(trx, escopo).repos });
      const trocas: string[] = [];
      let status = 201;
      const fakeFetch: typeof fetch = async (url) => {
        expect(String(url)).toBe("https://api.github.test/app/installations/987/access_tokens");
        return Response.json({ token: "ghs_tokendeinstalacao1234567890", expires_at: "2099-01-01T00:00:00Z" }, { status });
      };
      const rotas = (admins: string[]) => rotasMarketplace({ dentro, cifrar: (s) => cifrar(s, CHAVE), decifrar: (s) => decifrar(s, CHAVE), fetchImpl: fakeFetch, apiGithub: "https://api.github.test", admins, aoTrocarApp: (t) => trocas.push(t) });
      const semAdmin = await servidorDeTeste(rotas([]));
      try {
        const sessao = await semAdmin.entrar("marlon");
        expect(await (await semAdmin.chamar(sessao, "GET", "marketplace/github/app")).json()).toEqual({ configurado: false, podeCadastrar: false });
        expect((await semAdmin.chamar(sessao, "POST", "marketplace/github/app", { appId: "123", instalacaoId: "987", chavePrivada: pem })).status).toBe(403);
      } finally {
        await semAdmin.close();
      }
      const srv = await servidorDeTeste(rotas([PESSOA_MARLON]));
      try {
        const sessao = await srv.entrar("marlon");
        expect((await srv.chamar(sessao, "POST", "marketplace/github/app", { appId: "12a", instalacaoId: "987", chavePrivada: pem })).status).toBe(400);
        status = 404;
        expect((await srv.chamar(sessao, "POST", "marketplace/github/app", { appId: "123", instalacaoId: "987", chavePrivada: pem })).status).toBe(403);
        expect(await repos.githubApp.config()).toBeNull();
        status = 201;
        expect((await srv.chamar(sessao, "POST", "marketplace/github/app", { appId: "123", instalacaoId: "987", chavePrivada: pem })).status).toBe(200);
        expect(trocas).toEqual([TENANT_PADRAO]);
        expect(await (await srv.chamar(sessao, "GET", "marketplace/github/app")).json()).toEqual({ configurado: true, appId: "123", instalacaoId: "987", podeTrocar: true });
        const guardada = await repos.githubApp.config();
        expect(guardada?.chavePrivadaCifrada).not.toContain("PRIVATE KEY");
        expect(decifrar(guardada?.chavePrivadaCifrada ?? "", CHAVE)).toBe(pem.trim());
      } finally {
        await srv.close();
      }
      await vincularEscopo(trx, ANA);
      const daAna = criarRepos(trx, ANA);
      expect(await daAna.githubApp.config()).toMatchObject({ appId: "123", ownerId: PESSOA_MARLON });
      await expectRejected(trx, () => daAna.githubApp.salvar({ appId: "999", instalacaoId: "1", chavePrivadaCifrada: "x" }), "42501");
      await vincularEscopo(trx, MARLON);
    });
  });

  it("a marca nod: é do nod: registrar à mão com ela é recusado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps } = depsGithub(trx, MARLON, true);
      await expect(registrarConector(deps, { nome: "x", slug: "x", transporte: "stdio", comando: COMANDO_GITHUB_NATIVO, cifrar: (s) => s })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    });
  });
});
