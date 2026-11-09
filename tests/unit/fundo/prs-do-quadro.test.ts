import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErroGithub } from "../../../src/adapters/conectores-locais/github/erros.ts";
import { ErroLimiteGithub, type FontePrs, type LeituraPrs, PAUSA_SEM_ACESSO_MS, fonteApi, fonteDoAmbiente, fonteGh, iniciarLacoPrsDoQuadro, planoPrsDoQuadro, reposDoAmbiente, tenantsQueSincronizam, voltaPrsDoQuadro } from "../../../src/adapters/fundo/prs-do-quadro.ts";
import type { PrDaTarefa } from "../../../src/contracts/quadro.ts";
import { AVISO_SEM_CONEXAO } from "../../../src/domain/prs-da-tarefa.ts";
import { definirDestinoDoLog } from "../../../src/obs/log.ts";
import type { Db, Escopo } from "../../../src/shared/types.ts";

/**
 * NOD-421: o laço que lê os PRs do GitHub para o quadro. A fonte é injetada (falsa aqui); o gh de verdade vira um `sh`
 * falso que responde o JSON de `gh pr list`. O caso de uso no Postgres está em tests/integration/prs-do-quadro.test.ts.
 */
const PESSOAS = [{ tenantId: "t1", id: "p1" }, { tenantId: "t1", id: "p2" }];
const T1 = new Set(["t1"]);
// paraCadaPessoa só monta a transação (preguiçosa): o db basta ter begin.
const DB = { begin: () => Promise.reject(new Error("não usado")) } as unknown as Db;
const pr = (numero: number): PrDaTarefa => ({ repo: "gamefik/nod", numero, url: `https://github.com/gamefik/nod/pull/${numero}`, branch: `nod-${numero}-x`, estado: "aberto", ci: null, conflito: false });

describe("voltaPrsDoQuadro", () => {
  it("lê cada repo uma vez e entrega a lista inteira a cada pessoa", async () => {
    const lidos: string[] = [];
    const fonte: FontePrs = { listar: async (r) => { lidos.push(r); return r === "gamefik/nod" ? [pr(1)] : [pr(2)]; } };
    const entregues: { escopo: Escopo; leitura: LeituraPrs }[] = [];
    const r = await voltaPrsDoQuadro({ db: DB, fonte, repos: ["gamefik/nod", "gamefik/site"], tenants: T1, processar: async (escopo, leitura) => { entregues.push({ escopo, leitura }); }, opcoes: { listarPessoas: async () => PESSOAS, sortearInicio: () => 0 } });
    expect(r).toEqual({ prs: 2, falhas: 0 });
    expect(lidos).toEqual(["gamefik/nod", "gamefik/site"]);
    expect(entregues.map((e) => e.escopo.pessoaId)).toEqual(["p1", "p2"]);
    expect(entregues[0]!.leitura.prs.map((p) => p.numero)).toEqual([1, 2]);
    expect(entregues[0]!.leitura.aviso).toBeNull();
  });

  it("um repo sem acesso (404) não impede o outro e vira o aviso \"sem acesso a dono/repo\" (revisão do PR #621)", async () => {
    const leituras: LeituraPrs[] = [];
    const processar = vi.fn(async (_e: Escopo, l: LeituraPrs) => { leituras.push(l); });
    const fonte: FontePrs = { listar: async (r) => { if (r === "a/x") throw new ErroGithub("nao_encontrado", "gh"); return [pr(3)]; } };
    const ultimaFalha = new Map<string, string>();
    expect(await voltaPrsDoQuadro({ db: DB, fonte, repos: ["a/x", "a/y"], tenants: T1, processar, opcoes: { listarPessoas: async () => PESSOAS }, ultimaFalha })).toEqual({ prs: 1, falhas: 1 });
    expect(ultimaFalha.get("a/x")).toBe("nao_encontrado");
    expect(leituras).toHaveLength(2);
    expect(leituras[0]).toEqual({ prs: [pr(3)], aviso: "GitHub · sem acesso a a/x" });
  });

  it("sem gh nem credencial: nenhum PR, mas o aviso \"não conectado\" chega a cada pessoa (revisão do PR #621)", async () => {
    const leituras: LeituraPrs[] = [];
    const fonte: FontePrs = { listar: async () => { throw new ErroGithub("gh_ausente", "gh"); } };
    await voltaPrsDoQuadro({ db: DB, fonte, repos: ["a/x", "a/y"], tenants: T1, processar: async (_e, l) => { leituras.push(l); }, opcoes: { listarPessoas: async () => PESSOAS } });
    expect(leituras).toEqual([{ prs: [], aviso: AVISO_SEM_CONEXAO }, { prs: [], aviso: AVISO_SEM_CONEXAO }]);
  });

  it("tudo lido e vazio = aviso null (limpa); só falha passageira = ninguém é chamado", async () => {
    const leituras: LeituraPrs[] = [];
    const processar = async (_e: Escopo, l: LeituraPrs) => { leituras.push(l); };
    await voltaPrsDoQuadro({ db: DB, fonte: { listar: async () => [] }, repos: ["a/y"], tenants: T1, processar, opcoes: { listarPessoas: async () => PESSOAS } });
    expect(leituras.map((l) => l.aviso)).toEqual([null, null]);
    leituras.length = 0;
    await voltaPrsDoQuadro({ db: DB, fonte: { listar: async () => { throw new ErroGithub("limite", "gh"); } }, repos: ["a/y"], tenants: T1, processar, opcoes: { listarPessoas: async () => PESSOAS } });
    expect(leituras).toEqual([]);
  });

  it("revisão do PR #621: só os tenants da lista recebem a leitura (dois tenants); lista vazia nem lê o GitHub", async () => {
    const T1 = "11111111-1111-4111-8111-111111111111";
    const T2 = "22222222-2222-4222-8222-222222222222";
    const pessoas = [{ tenantId: T1, id: "p1" }, { tenantId: T2, id: "p2" }, { tenantId: T1.toUpperCase(), id: "p3" }];
    const fonte: FontePrs = { listar: vi.fn(async () => [pr(1)]) };
    const vistos: string[] = [];
    const processar = async (e: Escopo) => { vistos.push(`${e.tenantId.slice(0, 1)}:${e.pessoaId}`); };
    await voltaPrsDoQuadro({ db: DB, fonte, repos: ["a/x"], processar, tenants: new Set([T1]), opcoes: { listarPessoas: async () => pessoas, sortearInicio: () => 0 } });
    expect(vistos).toEqual(["1:p1", "1:p3"]);
    vistos.length = 0;
    await voltaPrsDoQuadro({ db: DB, fonte, repos: ["a/x"], processar, tenants: new Set([T1, T2]), opcoes: { listarPessoas: async () => pessoas, sortearInicio: () => 0 } });
    expect(vistos).toEqual(["1:p1", "2:p2", "1:p3"]);
    vistos.length = 0;
    (fonte.listar as ReturnType<typeof vi.fn>).mockClear();
    expect(await voltaPrsDoQuadro({ db: DB, fonte, repos: ["a/x"], processar, tenants: new Set(), opcoes: { listarPessoas: async () => pessoas } })).toEqual({ prs: 0, falhas: 0 });
    expect(fonte.listar).not.toHaveBeenCalled();
    expect(vistos).toEqual([]);
  });

  it("2ª revisão do PR #621: o token não aparece em log, leitura nem erro (token falso, espião de log)", async () => {
    const TOKEN = "ghp_FALSO0000tokenDeTeste1111nuncaReal";
    const linhas: string[] = [];
    definirDestinoDoLog((l) => linhas.push(l));
    try {
      // A rede ecoa o token na mensagem do erro; a API devolve 401 e 500 com o token no corpo; um repo responde certo.
      let n = 0;
      const fetchImpl = (async () => {
        n++;
        if (n === 1) throw new Error(`connect ECONNREFUSED authorization: Bearer ${TOKEN}`);
        if (n === 2) return new Response(JSON.stringify({ message: `Bad credentials ${TOKEN}` }), { status: 401 });
        if (n === 3) return new Response(`erro ${TOKEN}`, { status: 500 });
        return new Response(JSON.stringify({ data: { repository: { pullRequests: { nodes: [{ number: 1, url: "https://github.com/a/w/pull/1", headRefName: "nod-1", state: "OPEN", mergeable: "MERGEABLE" }] } } } }), { status: 200 });
      }) as unknown as typeof fetch;
      const fonte = fonteApi({ token: TOKEN, base: "http://gh.local", fetchImpl });
      const erros: unknown[] = [];
      for (const r of ["a/x", "a/y", "a/z"]) await fonte.listar(r).catch((e: unknown) => erros.push(e));
      n = 0;
      const entregues: LeituraPrs[] = [];
      const ultimaFalha = new Map<string, string>();
      await voltaPrsDoQuadro({ db: DB, fonte, repos: ["a/x", "a/y", "a/z", "a/w"], tenants: T1, processar: async (_e, l) => { entregues.push(l); }, opcoes: { listarPessoas: async () => PESSOAS }, ultimaFalha });
      expect(erros).toHaveLength(3);
      expect(entregues).toHaveLength(2);
      expect(linhas.filter((l) => l.includes("prs_do_quadro_leitura_falhou"))).toHaveLength(3);
      const tudo = [...linhas, JSON.stringify(entregues), JSON.stringify([...ultimaFalha]), ...erros.map((e) => `${String(e)} ${(e as Error).message} ${(e as Error).stack ?? ""} ${JSON.stringify(e)}`)].join("\n");
      expect(tudo).not.toContain(TOKEN);
      expect(tudo).not.toContain("FALSO0000");
    } finally {
      definirDestinoDoLog(null);
    }
  });

  it("4ª revisão do PR #621: 3 falhas seguidas no mesmo repo vão ao log como erro, uma vez por sequência", async () => {
    let falhar = true;
    const fonte: FontePrs = { listar: async (r) => { if (falhar || r === "a/y") throw new ErroGithub("falha", "token"); return []; } };
    const linhas: string[] = [];
    definirDestinoDoLog((l) => linhas.push(l));
    const ultimaFalha = new Map<string, string>();
    const seguidas = new Map<string, number>();
    const volta = () => voltaPrsDoQuadro({ db: DB, fonte, repos: ["a/x", "a/y"], tenants: T1, processar: async () => undefined, opcoes: { listarPessoas: async () => [] }, ultimaFalha, seguidas });
    const doLog = () => linhas.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.evento === "prs_do_quadro_falhas_seguidas");
    try {
      for (let i = 0; i < 2; i++) await volta();
      expect(doLog()).toEqual([]);
      await volta();
      expect(doLog()).toEqual([
        expect.objectContaining({ nivel: "erro", repo: "a/x", codigo: "falha", seguidas: 3 }),
        expect.objectContaining({ nivel: "erro", repo: "a/y", codigo: "falha", seguidas: 3 }),
      ]);
      await volta();
      expect(doLog()).toHaveLength(2);
      // Um sucesso zera a sequência do a/x; três falhas de novo, um log de novo (o a/y segue na mesma sequência).
      falhar = false;
      await volta();
      falhar = true;
      for (let i = 0; i < 3; i++) await volta();
      expect(doLog().map((l) => l.repo)).toEqual(["a/x", "a/y", "a/x"]);
    } finally {
      definirDestinoDoLog(null);
    }
  });

  it("5ª revisão do PR #621: repo 404 e gh sem login não são falha seguida (sem log de erro) e ficam sem leitura por PAUSA_SEM_ACESSO_MS, com o aviso mantido", async () => {
    let agora = 1_000_000;
    const chamadas: string[] = [];
    const fonte: FontePrs = {
      listar: async (r) => {
        chamadas.push(r);
        if (r === "a/x") throw new ErroGithub("nao_encontrado", "token");
        if (r === "a/z") throw new ErroGithub("sem_login", "gh");
        return [pr(1)];
      },
    };
    const linhas: string[] = [];
    definirDestinoDoLog((l) => linhas.push(l));
    const entregues: LeituraPrs[] = [];
    const ultimaFalha = new Map<string, string>();
    const seguidas = new Map<string, number>();
    const pausa = new Map<string, number>();
    const volta = () => voltaPrsDoQuadro({ db: DB, fonte, repos: ["a/x", "a/y", "a/z"], tenants: T1, processar: async (_e, l) => { entregues.push(l); }, opcoes: { listarPessoas: async () => [PESSOAS[0]!] }, ultimaFalha, seguidas, pausa, agora: () => agora });
    try {
      for (let i = 0; i < 5; i++) {
        await volta();
        agora += 30_000;
      }
      // Só a 1ª volta chama a/x e a/z; nas outras eles ficam pausados e o aviso do topo segue o mesmo.
      expect(chamadas.filter((r) => r !== "a/y")).toEqual(["a/x", "a/z"]);
      expect(entregues.map((l) => l.aviso)).toEqual(Array.from({ length: 5 }, () => AVISO_SEM_CONEXAO));
      expect(linhas.filter((l) => l.includes("prs_do_quadro_falhas_seguidas"))).toEqual([]);
      expect(linhas.filter((l) => l.includes("prs_do_quadro_leitura_falhou"))).toHaveLength(2);
      // Passada a pausa, tenta de novo (a configuração/credencial pode ter mudado sem reiniciar).
      agora += PAUSA_SEM_ACESSO_MS;
      await volta();
      expect(chamadas.filter((r) => r !== "a/y")).toEqual(["a/x", "a/z", "a/x", "a/z"]);
      expect(linhas.filter((l) => l.includes("prs_do_quadro_falhas_seguidas"))).toEqual([]);
    } finally {
      definirDestinoDoLog(null);
    }
  });

  it("4ª revisão do PR #621: rate limit com hora de volta pausa só aquele repo até o reset (sem chamar o GitHub)", async () => {
    let agora = 1_000_000;
    const chamadas: string[] = [];
    const fonte: FontePrs = {
      listar: async (r) => {
        chamadas.push(r);
        if (r === "a/x") throw new ErroLimiteGithub("token", agora + 120_000);
        return [pr(1)];
      },
    };
    const entregues: LeituraPrs[] = [];
    const pausa = new Map<string, number>();
    const volta = () => voltaPrsDoQuadro({ db: DB, fonte, repos: ["a/x", "a/y"], tenants: T1, processar: async (_e, l) => { entregues.push(l); }, opcoes: { listarPessoas: async () => [PESSOAS[0]!] }, pausa, agora: () => agora });
    await volta();
    expect(chamadas).toEqual(["a/x", "a/y"]);
    agora += 60_000;
    expect(await volta()).toEqual({ prs: 1, falhas: 0 });
    expect(chamadas).toEqual(["a/x", "a/y", "a/y"]);
    // Pausado não é aviso novo: o topo do quadro fica como estava (undefined), os PRs do outro repo seguem.
    expect(entregues.at(-1)).toEqual({ prs: [pr(1)], aviso: undefined });
    agora += 61_000;
    await volta();
    expect(chamadas).toEqual(["a/x", "a/y", "a/y", "a/x", "a/y"]);
  });

  it("3ª revisão do PR #621: modo compartilhado sem token não roda o gh; o aviso \"não conectado\" sai sempre igual e o log uma vez", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nod-421-compartilhado-"));
    const linhas: string[] = [];
    definirDestinoDoLog((l) => linhas.push(l));
    try {
      // Um gh no PATH que, se rodasse, marcaria um arquivo e daria PRs: no servidor compartilhado ele é de quem opera.
      writeFileSync(join(dir, "gh"), `#!/bin/sh\ntouch "${dir}/rodou"\necho '[]'\n`);
      chmodSync(join(dir, "gh"), 0o755);
      const { fonte, jeito } = fonteDoAmbiente({ NOD_MODO: "compartilhado", PATH: `${dir}:${process.env.PATH ?? ""}`, HOME: dir });
      expect(jeito).toBe("nenhum");
      const entregues: LeituraPrs[] = [];
      const ultimaFalha = new Map<string, string>();
      for (let i = 0; i < 4; i++) await voltaPrsDoQuadro({ db: DB, fonte, repos: ["a/x", "a/y"], tenants: T1, processar: async (_e, l) => { entregues.push(l); }, opcoes: { listarPessoas: async () => [PESSOAS[0]!] }, ultimaFalha });
      expect(readdirSync(dir)).not.toContain("rodou");
      expect(entregues).toEqual(Array.from({ length: 4 }, () => ({ prs: [], aviso: AVISO_SEM_CONEXAO })));
      expect(linhas.filter((l) => l.includes("prs_do_quadro_leitura_falhou")).map((l) => (JSON.parse(l) as { codigo: string }).codigo)).toEqual(["sem_login", "sem_login"]);
    } finally {
      definirDestinoDoLog(null);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("o laço roda a cada intervalo (≤ 60 s) e para esperando a volta em curso", async () => {
    vi.useFakeTimers();
    try {
      const fonte: FontePrs = { listar: vi.fn(async () => [pr(1)]) };
      const processar = vi.fn(async () => undefined);
      const laco = iniciarLacoPrsDoQuadro({ db: DB, fonte, repos: ["gamefik/nod"], tenants: T1, processar, opcoes: { listarPessoas: async () => PESSOAS } });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fonte.listar).toHaveBeenCalledTimes(1);
      expect(processar).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fonte.listar).toHaveBeenCalledTimes(2);
      await laco.parar();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fonte.listar).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

it("tenantsQueSincronizam (2ª revisão do PR #621): só a lista, em qualquer jeito; vazia = ninguém", () => {
  const T1 = "172e1fdf-428d-48cb-b052-3bd7d2573e18";
  const T2 = "22222222-2222-4222-8222-222222222222";
  expect(tenantsQueSincronizam({})).toEqual(new Set());
  expect(tenantsQueSincronizam({ NOD_QUADRO_GITHUB_TENANTS: "  " })).toEqual(new Set());
  expect(tenantsQueSincronizam({ NOD_QUADRO_GITHUB_TENANTS: `${T1.toUpperCase()}, ${T2} lixo` })).toEqual(new Set([T1, T2]));
});

it("planoPrsDoQuadro (2ª revisão do PR #621): sem tenant na lista nenhum jeito sobe, nem o gh local no modo pessoal", () => {
  const T1 = "172e1fdf-428d-48cb-b052-3bd7d2573e18";
  const repos = { NOD_QUADRO_GITHUB_REPOS: "gamefik/nod" };
  expect(planoPrsDoQuadro({})).toBeNull();
  expect(planoPrsDoQuadro({ ...repos, NOD_QUADRO_GITHUB_TOKEN: "tk" })).toBeNull();
  expect(planoPrsDoQuadro({ ...repos, GH_TOKEN: "tk" })).toBeNull();
  expect(planoPrsDoQuadro({ ...repos, NOD_MODO: "compartilhado" })).toBeNull();
  expect(planoPrsDoQuadro({ ...repos, NOD_LOGIN: "stub" })).toBeNull();
  expect(planoPrsDoQuadro({ ...repos, NOD_QUADRO_GITHUB_TENANTS: T1 })).toMatchObject({ repos: ["gamefik/nod"], jeito: "gh", tenants: new Set([T1]) });
  expect(planoPrsDoQuadro({ ...repos, GH_TOKEN: "tk", NOD_QUADRO_GITHUB_TENANTS: T1 })?.jeito).toBe("gh_token");
  expect(planoPrsDoQuadro({ ...repos, NOD_QUADRO_GITHUB_TOKEN: "tk", NOD_QUADRO_GITHUB_TENANTS: T1 })?.jeito).toBe("token");
});

it("reposDoAmbiente: só dono/repo válidos, sem repetir", () => {
  expect(reposDoAmbiente(undefined)).toEqual([]);
  expect(reposDoAmbiente("gamefik/nod, gamefik/nod;rm -rf x, ../x gamefik/site")).toEqual(["gamefik/nod", "gamefik/site"]);
});

const GH_FALSO = `#!/bin/sh
printf '%s\\n' "$@" > "$HOME/argv"
MODO=$(cat "$HOME/modo" 2>/dev/null)
if [ "$MODO" = "sem_login" ]; then echo "To get started with GitHub CLI, please run:  gh auth login" >&2; exit 4; fi
if [ "$MODO" = "nao_achou" ]; then echo "GraphQL: Could not resolve to a Repository with the name 'a/x'." >&2; exit 1; fi
if [ "$MODO" = "lixo" ]; then echo "nao e json"; exit 0; fi
if [ "$MODO" = "lento" ]; then sleep 5; fi
echo '[{"number":612,"url":"https://github.com/gamefik/nod/pull/612","headRefName":"faustino/nod-421-pr","state":"OPEN","mergeable":"CONFLICTING","statusCheckRollup":[{"__typename":"CheckRun","status":"COMPLETED","conclusion":"FAILURE"}]},{"number":"x"}]'
`;

describe("fonteGh (gh falso)", () => {
  let dir: string;
  let bin: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nod-421-gh-"));
    bin = join(dir, "gh");
    writeFileSync(bin, GH_FALSO);
    chmodSync(bin, 0o755);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const fonte = (prazoMs = 15_000) => fonteGh({ env: { HOME: dir, PATH: process.env.PATH ?? "" }, bin, prazoMs });
  const modo = (m: string) => writeFileSync(join(dir, "modo"), m);

  it("roda gh pr list com argv próprio e converte o JSON (o item inválido cai)", { timeout: 20_000 }, async () => {
    expect(await fonte().listar("gamefik/nod")).toEqual([
      { repo: "gamefik/nod", numero: 612, url: "https://github.com/gamefik/nod/pull/612", branch: "faustino/nod-421-pr", estado: "aberto", ci: "falhou", conflito: true },
    ]);
    expect(readFileSync(join(dir, "argv"), "utf8").trim().split("\n")).toEqual(["pr", "list", "--repo", "gamefik/nod", "--state", "all", "--limit", "60", "--json", "number,url,headRefName,state,mergeable,statusCheckRollup,isCrossRepository,updatedAt"]);
  });

  it("erros viram código: sem login, repo que não existe, saída que não é JSON, prazo, repo inválido, gh ausente", { timeout: 20_000 }, async () => {
    const codigo = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof ErroGithub ? e.codigo : "outro"));
    modo("sem_login");
    expect(await codigo(fonte().listar("a/x"))).toBe("sem_login");
    modo("nao_achou");
    expect(await codigo(fonte().listar("a/x"))).toBe("nao_encontrado");
    modo("lixo");
    expect(await codigo(fonte().listar("a/x"))).toBe("falha");
    modo("lento");
    expect(await codigo(fonte(300).listar("a/x"))).toBe("falha");
    expect(await codigo(fonte().listar("--help"))).toBe("falha");
    expect(await codigo(fonteGh({ env: { PATH: "" }, bin: join(dir, "nao-existe") }).listar("a/x"))).toBe("gh_ausente");
  });
});

describe("fonteApi (produção: GraphQL por fetch, sem o gh)", () => {
  const no = (numero: number, o: Record<string, unknown> = {}) => ({ number: numero, url: `https://github.com/gamefik/nod/pull/${numero}`, headRefName: `nod-${numero}-x`, state: "OPEN", mergeable: "MERGEABLE", commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] }, ...o });
  const resposta = (corpo: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(corpo), { status, headers });
  const codigo = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof ErroGithub ? e.codigo : "outro"));

  it("uma chamada por repo, com o token só no cabeçalho, e o mesmo PR que o gh daria", async () => {
    const pedidos: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      pedidos.push({ url, init });
      return resposta({ data: { repository: { pullRequests: { nodes: [
        no(1),
        no(2, { mergeable: "CONFLICTING", commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } }),
        no(3, { state: "MERGED", mergeable: "UNKNOWN" }),
        no(4, { commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }),
        no(5, { commits: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] } }),
        { lixo: true },
      ] } } } });
    }) as unknown as typeof fetch;
    const prs = await fonteApi({ token: "tk-segredo", base: "http://gh.local/", fetchImpl }).listar("gamefik/nod");
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.url).toBe("http://gh.local/graphql");
    expect(pedidos[0]!.url).not.toContain("tk-segredo");
    expect((pedidos[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tk-segredo");
    expect(pedidos[0]!.init.redirect).toBe("manual");
    const corpo = JSON.parse(String(pedidos[0]!.init.body)) as { query: string; variables: unknown };
    expect(corpo.variables).toEqual({ dono: "gamefik", nome: "nod", n: 60 });
    // Título e corpo do PR (dado de fora) nem são pedidos.
    expect(corpo.query).not.toMatch(/\btitle\b|\bbody\b/);
    expect(corpo.query).toContain("isCrossRepository");
    expect(prs.map((p) => [p.numero, p.estado, p.ci, p.conflito])).toEqual([
      [1, "aberto", "ok", false],
      [2, "aberto", "falhou", true],
      [3, "mergeado", "ok", null],
      [4, "aberto", null, false],
      [5, "aberto", "pendente", false],
    ]);
  });

  it("4ª revisão do PR #621: o limite traz a hora de volta (retry-after ou x-ratelimit-reset), no máximo 1 h", async () => {
    const agora = 1_700_000_000_000;
    const com = (r: Response) => fonteApi({ token: "tk", agora: () => agora, fetchImpl: (async () => r) as unknown as typeof fetch });
    const volta = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof ErroLimiteGithub ? e.retomarEm : e instanceof ErroGithub ? e.codigo : "outro"));
    expect(await volta(com(resposta({}, 403, { "retry-after": "90" })).listar("a/x"))).toBe(agora + 90_000);
    expect(await volta(com(resposta({}, 429, { "retry-after": "5" })).listar("a/x"))).toBe(agora + 5_000);
    expect(await volta(com(resposta({}, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(agora / 1000 + 300) })).listar("a/x"))).toBe(agora + 300_000);
    expect(await volta(com(resposta({ errors: [{ type: "RATE_LIMITED" }] }, 200, { "x-ratelimit-reset": String(agora / 1000 + 30) })).listar("a/x"))).toBe(agora + 30_000);
    expect(await volta(com(resposta({}, 403, { "retry-after": "999999" })).listar("a/x"))).toBe(agora + 3_600_000);
    // Sem hora (ou hora inválida/passada): o limite de sempre, tenta na próxima volta.
    expect(await volta(com(resposta({}, 403, { "x-ratelimit-remaining": "0" })).listar("a/x"))).toBe("limite");
    expect(await volta(com(resposta({}, 403, { "retry-after": "lixo", "x-ratelimit-remaining": "0" })).listar("a/x"))).toBe("limite");
  });

  it("erros viram código, nunca a mensagem nem o token", async () => {
    const com = (r: Response | Error) => fonteApi({ token: "tk", fetchImpl: (async () => { if (r instanceof Error) throw r; return r; }) as unknown as typeof fetch });
    expect(await codigo(com(resposta({}, 401)).listar("a/x"))).toBe("sem_login");
    expect(await codigo(com(resposta({}, 403)).listar("a/x"))).toBe("sem_permissao");
    expect(await codigo(com(resposta({}, 403, { "x-ratelimit-remaining": "0" })).listar("a/x"))).toBe("limite");
    // 3ª revisão do PR #621: o secondary rate limit do GitHub é um 403 com retry-after e/ou essa frase no corpo.
    expect(await codigo(com(resposta({}, 403, { "retry-after": "60" })).listar("a/x"))).toBe("limite");
    expect(await codigo(com(resposta({ message: "You have exceeded a secondary rate limit. Please wait a few minutes before you try again." }, 403)).listar("a/x"))).toBe("limite");
    expect(await codigo(com(resposta({ message: "Resource not accessible by personal access token" }, 403)).listar("a/x"))).toBe("sem_permissao");
    expect(await codigo(com(new Response(null, { status: 301, headers: { location: "http://outro" } })).listar("a/x"))).toBe("movido");
    expect(await codigo(com(resposta({ data: { repository: null }, errors: [{ type: "NOT_FOUND" }] })).listar("a/x"))).toBe("nao_encontrado");
    expect(await codigo(com(resposta({ errors: [{ type: "RATE_LIMITED" }] })).listar("a/x"))).toBe("limite");
    expect(await codigo(com(new Response("não é json", { status: 200 })).listar("a/x"))).toBe("falha");
    expect(await codigo(com(new Error("rede tk")).listar("a/x"))).toBe("falha");
    expect(await codigo(com(resposta({})).listar("--help"))).toBe("falha");
  });

  it("fonteDoAmbiente: com NOD_QUADRO_GITHUB_TOKEN a API; sem, o gh desta máquina (com GH_TOKEN, gh_token)", () => {
    expect(fonteDoAmbiente({ NOD_QUADRO_GITHUB_TOKEN: "tk" }).jeito).toBe("token");
    expect(fonteDoAmbiente({ GH_TOKEN: "tk" }).jeito).toBe("gh_token");
    expect(fonteDoAmbiente({ NOD_QUADRO_GITHUB_TOKEN: "  " }).jeito).toBe("gh");
    expect(fonteDoAmbiente({}).jeito).toBe("gh");
    // 3ª revisão do PR #621: no servidor compartilhado sem token não há gh; com token, a API como sempre.
    expect(fonteDoAmbiente({ NOD_MODO: "compartilhado" }).jeito).toBe("nenhum");
    expect(fonteDoAmbiente({ NOD_MODO: "compartilhado", GH_TOKEN: "tk" }).jeito).toBe("nenhum");
    expect(fonteDoAmbiente({ NOD_MODO: "compartilhado", NOD_QUADRO_GITHUB_TOKEN: "tk" }).jeito).toBe("token");
  });

  describe("4ª revisão do PR #621: a base da API do token do quadro é própria e só https", () => {
    const urls: string[] = [];
    beforeEach(() => {
      urls.length = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => {
        urls.push(String(u));
        return new Response(JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } }), { status: 200 });
      });
    });
    afterEach(() => vi.restoreAllMocks());
    const codigoDe = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof ErroGithub ? e.codigo : "outro"));

    it("NOD_GITHUB_API (a do conector, compartilhada) não leva o token do quadro; o padrão é https://api.github.com", async () => {
      await fonteDoAmbiente({ NOD_QUADRO_GITHUB_TOKEN: "tk", NOD_GITHUB_API: "https://outro.example" }).fonte.listar("gamefik/nod");
      expect(urls).toEqual(["https://api.github.com/graphql"]);
    });
    it("NOD_QUADRO_GITHUB_API https (GitHub Enterprise) vale", async () => {
      await fonteDoAmbiente({ NOD_QUADRO_GITHUB_TOKEN: "tk", NOD_QUADRO_GITHUB_API: "https://ghe.example/api" }).fonte.listar("gamefik/nod");
      expect(urls).toEqual(["https://ghe.example/api/graphql"]);
    });
    it("http fora dos testes é recusado: nada vai para a rede, o quadro diz não conectado e o log diz por quê", async () => {
      const linhas: string[] = [];
      definirDestinoDoLog((l) => linhas.push(l));
      try {
        for (const base of ["http://127.0.0.1:9", "http://gh.local", "ftp://x", "lixo"]) {
          const { fonte, jeito } = fonteDoAmbiente({ NOD_QUADRO_GITHUB_TOKEN: "tk", NOD_QUADRO_GITHUB_API: base });
          expect(jeito, base).toBe("nenhum");
          expect(await codigoDe(fonte.listar("gamefik/nod")), base).toBe("sem_login");
        }
      } finally {
        definirDestinoDoLog(null);
      }
      expect(urls).toEqual([]);
      const recusas = linhas.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.evento === "prs_do_quadro_api_recusada");
      expect(recusas).toHaveLength(4);
      expect(linhas.join("\n")).not.toContain("tk");
    });
    it("nos testes (VITEST), http só para o loopback", async () => {
      await fonteDoAmbiente({ NOD_QUADRO_GITHUB_TOKEN: "tk", NOD_QUADRO_GITHUB_API: "http://127.0.0.1:9", VITEST: "true" }).fonte.listar("gamefik/nod");
      expect(urls).toEqual(["http://127.0.0.1:9/graphql"]);
      expect(fonteDoAmbiente({ NOD_QUADRO_GITHUB_TOKEN: "tk", NOD_QUADRO_GITHUB_API: "http://gh.local", VITEST: "true" }).jeito).toBe("nenhum");
    });
  });
});
