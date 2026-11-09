import { describe, expect, it } from "vitest";
import type { ColunaQuadro, PrDaTarefa } from "../../../src/contracts/quadro.ts";
import { COLUNAS_PADRAO } from "../../../src/domain/colunas.ts";
import {
  AVISO_SEM_CONEXAO, avisoDaLeitura, avisoSemAcesso, casaComTarefa, desfechoDoMerge, destinoDoMerge, estadoDoCi, fimDosPrs, fixarConflito, idNoBranch, lerPrDoGh, textoDaLinha, transicoes,
} from "../../../src/domain/prs-da-tarefa.ts";

const pr = (p: Partial<PrDaTarefa> = {}): PrDaTarefa => ({
  repo: "gamefik/nod", numero: 612, url: "https://github.com/gamefik/nod/pull/612", branch: "faustino/nod-421-pr", estado: "aberto", ci: "pendente", conflito: false, ...p,
});

describe("idNoBranch (NOD-421)", () => {
  it("casa o id com fronteira e sem diferenciar maiúscula", () => {
    expect(idNoBranch("NOD-421", "faustino/nod-421-pr-na-tarefa")).toBe(true);
    expect(idNoBranch("abc-12", "abc-12-corrigir-login")).toBe(true);
    expect(idNoBranch("ABC-1", "feature/abc-1")).toBe(true);
  });
  it("abc-1 não casa abc-12 nem xabc-1", () => {
    expect(idNoBranch("abc-1", "abc-12-x")).toBe(false);
    expect(idNoBranch("abc-1", "xabc-1-y")).toBe(false);
    expect(idNoBranch("", "abc-1")).toBe(false);
  });
  it("casaComTarefa: pelo id no branch ou pelo pr_url gravado", () => {
    expect(casaComTarefa({ ids: ["NOD-421"], prUrl: null }, pr())).toBe(true);
    expect(casaComTarefa({ ids: [], prUrl: "https://github.com/gamefik/nod/pull/612" }, pr({ branch: "qualquer" }))).toBe(true);
    expect(casaComTarefa({ ids: ["NOD-9"], prUrl: null }, pr())).toBe(false);
  });
  it("2ª revisão do PR #621: PR de fork (isCrossRepository) não casa, nem pelo id no branch nem pelo pr_url", () => {
    const deFork = { ...pr(), fork: true };
    expect(casaComTarefa({ ids: ["NOD-421"], prUrl: null }, deFork)).toBe(false);
    expect(casaComTarefa({ ids: [], prUrl: deFork.url }, deFork)).toBe(false);
    const u = (n: number) => `https://github.com/gamefik/nod/pull/${n}`;
    const lido = lerPrDoGh("gamefik/nod", { number: 9, url: u(9), headRefName: "nod-421-x", state: "OPEN", isCrossRepository: true });
    expect(lido?.fork).toBe(true);
    expect(casaComTarefa({ ids: ["NOD-421"], prUrl: null }, lido!)).toBe(false);
    expect(lerPrDoGh("gamefik/nod", { number: 9, url: u(9), headRefName: "nod-421-x", state: "OPEN", isCrossRepository: false })).not.toHaveProperty("fork");
    // O fork não vai para o que se grava.
    expect(fixarConflito(null, lido!)).not.toHaveProperty("fork");
  });
  it("5ª revisão do PR #621: o pr_url gravado casa sem diferenciar maiúscula nem barra final", () => {
    expect(casaComTarefa({ ids: [], prUrl: "https://github.com/Gamefik/Nod/pull/612/" }, pr({ branch: "qualquer" }))).toBe(true);
    expect(casaComTarefa({ ids: [], prUrl: "https://github.com/gamefik/nod/pull/612" }, pr({ url: "https://github.com/GameFik/NOD/pull/612", branch: "qualquer" }))).toBe(true);
    expect(casaComTarefa({ ids: [], prUrl: "https://github.com/gamefik/nod/pull/6120" }, pr({ branch: "qualquer" }))).toBe(false);
  });
});

describe("estadoDoCi", () => {
  it("sem checagem = null; tudo completo e verde = ok", () => {
    expect(estadoDoCi([])).toBeNull();
    expect(estadoDoCi(undefined)).toBeNull();
    expect(estadoDoCi([{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }, { __typename: "StatusContext", state: "SUCCESS" }])).toBe("ok");
  });
  it("qualquer falha = falhou, mesmo com outra pendente", () => {
    expect(estadoDoCi([{ status: "IN_PROGRESS", conclusion: "" }, { status: "COMPLETED", conclusion: "FAILURE" }])).toBe("falhou");
    expect(estadoDoCi([{ state: "ERROR" }])).toBe("falhou");
  });
  it("em andamento = pendente", () => {
    expect(estadoDoCi([{ status: "QUEUED", conclusion: null }, { status: "COMPLETED", conclusion: "SUCCESS" }])).toBe("pendente");
    expect(estadoDoCi([{ state: "PENDING" }])).toBe("pendente");
  });
});

describe("lerPrDoGh", () => {
  const u = (n: number, repo = "gamefik/nod") => `https://github.com/${repo}/pull/${n}`;
  it("converte o JSON do gh; UNKNOWN = conflito desconhecido (null), não \"sem conflito\"", () => {
    expect(lerPrDoGh("gamefik/nod", { number: 7, url: u(7), headRefName: "nod-1-x", state: "MERGED", mergeable: "UNKNOWN", statusCheckRollup: [] }))
      .toEqual({ repo: "gamefik/nod", numero: 7, url: u(7), branch: "nod-1-x", estado: "mergeado", ci: null, conflito: null });
    expect(lerPrDoGh("gamefik/nod", { number: 8, url: u(8), headRefName: "b", state: "OPEN", mergeable: "CONFLICTING" })?.conflito).toBe(true);
    expect(lerPrDoGh("gamefik/nod", { number: 8, url: u(8), headRefName: "b", state: "OPEN", mergeable: "MERGEABLE" })?.conflito).toBe(false);
  });
  it("inválido = null", () => {
    expect(lerPrDoGh("r/x", null)).toBeNull();
    expect(lerPrDoGh("r/x", { number: "1", url: u(1, "r/x"), state: "OPEN" })).toBeNull();
    expect(lerPrDoGh("r/x", { number: 1, url: u(1, "r/x"), state: "DRAFT?" })).toBeNull();
  });
  it("revisão do PR #621: a url tem de ser o PR do GitHub deste repo e número (PR_GITHUB)", () => {
    const com = (url: string) => lerPrDoGh("gamefik/nod", { number: 7, url, headRefName: "b", state: "OPEN" });
    expect(com(u(7))?.url).toBe(u(7));
    expect(com("https://github.com/Gamefik/Nod/pull/7")).not.toBeNull();
    for (const ruim of ["u", "javascript:alert(1)", "http://github.com/gamefik/nod/pull/7", "https://evil.com/gamefik/nod/pull/7", u(8), u(7, "gamefik/outro"), `${u(7)}/files`]) {
      expect(com(ruim)).toBeNull();
    }
  });
});

describe("fixarConflito (revisão do PR #621): mergeable UNKNOWN mantém o conflito visto antes", () => {
  it("conflito → UNKNOWN → conflito: só a linha do conflito, nenhuma falsa de resolvido", () => {
    const lido = (mergeable: string) => lerPrDoGh("gamefik/nod", { number: 612, url: "https://github.com/gamefik/nod/pull/612", headRefName: "nod-421", state: "OPEN", mergeable })!;
    let visto: PrDaTarefa | null = null;
    const linhas: string[][] = [];
    for (const m of ["CONFLICTING", "UNKNOWN", "CONFLICTING", "UNKNOWN", "MERGEABLE"]) {
      const p = fixarConflito(visto, lido(m));
      linhas.push(transicoes(visto, p));
      visto = p;
    }
    expect(linhas).toEqual([["pr_ligado", "conflito"], [], [], [], ["conflito_resolvido"]]);
  });
  it("sem PR visto antes, UNKNOWN = sem conflito; o conhecido vale sempre", () => {
    expect(fixarConflito(null, { ...pr(), conflito: null }).conflito).toBe(false);
    expect(fixarConflito(pr({ conflito: true }), { ...pr(), conflito: false }).conflito).toBe(false);
    expect(fixarConflito(pr({ conflito: false }), { ...pr(), conflito: true }).conflito).toBe(true);
  });
});

describe("avisoDaLeitura (revisão do PR #621): a linha do topo do quadro", () => {
  it("sem gh nem credencial (ou recusada) = não conectado, mesmo com outro repo lido", () => {
    expect(avisoDaLeitura([{ repo: "a/x", codigo: "gh_ausente" }])).toBe(AVISO_SEM_CONEXAO);
    expect(avisoDaLeitura([{ repo: "a/x", codigo: "sem_login" }, { repo: "a/y", codigo: null }])).toBe("GitHub não conectado no servidor: os PRs não sincronizam");
  });
  it("401/403/404 num repo = sem acesso a dono/repo; os outros seguem", () => {
    expect(avisoDaLeitura([{ repo: "a/x", codigo: "nao_encontrado" }, { repo: "a/y", codigo: null }])).toBe("GitHub · sem acesso a a/x");
    expect(avisoDaLeitura([{ repo: "a/x", codigo: "sem_permissao" }, { repo: "a/y", codigo: "movido" }, { repo: "a/z", codigo: "falha" }])).toBe("GitHub · sem acesso a a/x, a/y");
  });
  it("tudo lido = null (limpa); rede/rate limit sem outro aviso = undefined (fica como estava)", () => {
    expect(avisoDaLeitura([{ repo: "a/x", codigo: null }])).toBeNull();
    expect(avisoDaLeitura([{ repo: "a/x", codigo: "limite" }, { repo: "a/y", codigo: null }])).toBeUndefined();
    expect(avisoDaLeitura([{ repo: "a/x", codigo: "falha" }])).toBeUndefined();
  });
});

describe("avisoSemAcesso (4ª revisão do PR #621): cabe nos 300 caracteres de quadros.aviso_github", () => {
  it("com repos longos, corta e diz quantos faltam", () => {
    const longos = [1, 2, 3, 4, 5].map((i) => `dono-${i}/${"r".repeat(95)}${i}`);
    const aviso = avisoSemAcesso(longos);
    expect(aviso.length).toBeLessThanOrEqual(300);
    expect(aviso).toBe(`GitHub · sem acesso a ${longos[0]}, ${longos[1]} e mais 3`);
    // O pior caso de verdade: 5 repos com dono de 39 e nome de 100 caracteres.
    const maximos = [1, 2, 3, 4, 5].map((i) => `${"d".repeat(38)}${i}/${"n".repeat(100)}`);
    expect(avisoSemAcesso(maximos).length).toBeLessThanOrEqual(300);
    expect(avisoSemAcesso(maximos)).toMatch(/ e mais 4$/);
  });
  it("o que cabe sai inteiro, como antes", () => {
    expect(avisoSemAcesso(["a/x", "a/y"])).toBe("GitHub · sem acesso a a/x, a/y");
  });
});

describe("transicoes: só a mudança vira linha", () => {
  it("PR novo: ligado (+ o estado que já veio)", () => {
    expect(transicoes(null, pr())).toEqual(["pr_ligado"]);
    expect(transicoes(null, pr({ ci: "falhou", conflito: true }))).toEqual(["pr_ligado", "ci_falhou", "conflito"]);
  });
  it("5ª revisão do PR #621: PR que já chega mergeado ou fechado só é ligado (o merge antigo não é transição e não move)", () => {
    expect(transicoes(null, pr({ estado: "mergeado" }))).toEqual(["pr_ligado"]);
    expect(transicoes(null, pr({ estado: "fechado", ci: "falhou", conflito: true }))).toEqual(["pr_ligado"]);
    // A transição observada aberto→mergeado continua emitindo o merge.
    expect(transicoes(pr(), pr({ estado: "mergeado" }))).toEqual(["pr_mergeado"]);
  });
  it("CI pendente→ok, pendente→falhou; o mesmo estado duas vezes não gera nada", () => {
    expect(transicoes(pr(), pr({ ci: "ok" }))).toEqual(["ci_ok"]);
    expect(transicoes(pr(), pr({ ci: "falhou" }))).toEqual(["ci_falhou"]);
    expect(transicoes(pr({ ci: "ok" }), pr({ ci: "ok" }))).toEqual([]);
    expect(transicoes(pr({ ci: "ok" }), pr({ ci: "pendente" }))).toEqual([]);
  });
  it("conflito aparece e resolve", () => {
    expect(transicoes(pr(), pr({ conflito: true }))).toEqual(["conflito"]);
    expect(transicoes(pr({ conflito: true }), pr())).toEqual(["conflito_resolvido"]);
  });
  it("merge, fechado e reaberto; depois do merge CI/conflito não contam", () => {
    expect(transicoes(pr({ conflito: true }), pr({ estado: "mergeado", ci: "ok" }))).toEqual(["pr_mergeado"]);
    expect(transicoes(pr(), pr({ estado: "fechado" }))).toEqual(["pr_fechado"]);
    expect(transicoes(pr({ estado: "fechado" }), pr())).toEqual(["pr_reaberto"]);
  });
});

describe("fimDosPrs (4ª revisão do PR #621): o fechamento sem merge só move com um merge pendente", () => {
  const C = COLUNAS_PADRAO;
  const mergeado = pr({ estado: "mergeado" });
  const fechado = pr({ numero: 613, estado: "fechado" });
  it("merge com outro PR aberto fica pendente; o fechamento depois leva a Feito e limpa o pendente", () => {
    expect(fimDosPrs({ mergeouAgora: true, fechouAgora: false, pendente: false }, C, "fazendo", [mergeado, pr({ numero: 613 })])).toEqual({ destino: null, pendente: true });
    expect(fimDosPrs({ mergeouAgora: false, fechouAgora: true, pendente: true }, C, "fazendo", [mergeado, fechado])).toEqual({ destino: { mover: "feito", nome: "Feito" }, pendente: false });
  });
  it("sem merge pendente (o merge já moveu ou já ficou em Backlog), o fechamento não move nem registra desfecho", () => {
    expect(fimDosPrs({ mergeouAgora: false, fechouAgora: true, pendente: false }, C, "fazendo", [mergeado, fechado])).toEqual({ destino: null, pendente: false });
  });
  it("merge com desfecho (moveu ou ficou) não deixa pendente", () => {
    expect(fimDosPrs({ mergeouAgora: true, fechouAgora: false, pendente: false }, C, "fazendo", [mergeado])).toEqual({ destino: { mover: "feito", nome: "Feito" }, pendente: false });
    expect(fimDosPrs({ mergeouAgora: true, fechouAgora: false, pendente: true }, C, "backlog", [mergeado])).toEqual({ destino: { ficou: "Backlog" }, pendente: false });
  });
  it("fechamento com outro PR ainda aberto mantém o pendente", () => {
    expect(fimDosPrs({ mergeouAgora: false, fechouAgora: true, pendente: true }, C, "fazendo", [mergeado, fechado, pr({ numero: 614 })])).toEqual({ destino: null, pendente: true });
  });
});

describe("destinoDoMerge: a coluna atual permite?", () => {
  const C = COLUNAS_PADRAO;
  it("em Fazendo/Revisão com o último PR mergeado → a coluna padrão de feito", () => {
    expect(destinoDoMerge(C, "fazendo", [pr({ estado: "mergeado" })])).toEqual({ mover: "feito", nome: "Feito" });
    expect(destinoDoMerge(C, "revisao", [pr({ estado: "mergeado" }), pr({ numero: 2, estado: "fechado" })])).toEqual({ mover: "feito", nome: "Feito" });
  });
  it("com outro PR aberto, nada; ao mergear o segundo, vai", () => {
    expect(destinoDoMerge(C, "fazendo", [pr({ estado: "mergeado" }), pr({ numero: 2 })])).toBeNull();
    expect(destinoDoMerge(C, "fazendo", [pr({ estado: "mergeado" }), pr({ numero: 2, estado: "mergeado" })])).toEqual({ mover: "feito", nome: "Feito" });
  });
  it("todos fechados sem merge: nada", () => {
    expect(destinoDoMerge(C, "fazendo", [pr({ estado: "fechado" })])).toBeNull();
  });
  it("em Backlog, Precisa de você, Bloqueado ou já Feito: só registra onde ficou", () => {
    for (const s of ["backlog", "voce", "bloqueado", "feito", "cancelado"]) {
      const d = destinoDoMerge(C, s, [pr({ estado: "mergeado" })]);
      expect(d && "ficou" in d).toBe(true);
    }
    expect(desfechoDoMerge(destinoDoMerge(C, "backlog", [pr({ estado: "mergeado" })])!)).toBe("· ficou em Backlog");
  });
  it("colunas da pessoa: vai para a primeira do grupo feito; sem coluna feito, só registra", () => {
    const minhas: ColunaQuadro[] = [{ id: "c-dev", nome: "Dev", grupo: "iniciado" }, { id: "c-pronto", nome: "Pronto", grupo: "feito" }];
    expect(destinoDoMerge(minhas, "c-dev", [pr({ estado: "mergeado" })])).toEqual({ mover: "c-pronto", nome: "Pronto" });
    expect(destinoDoMerge([{ id: "c-dev", nome: "Dev", grupo: "iniciado" }], "c-dev", [pr({ estado: "mergeado" })])).toEqual({ ficou: "Dev" });
  });
});

it("textoDaLinha: só repo, número e estado", () => {
  expect(textoDaLinha("pr_ligado", pr())).toBe("GitHub · PR gamefik/nod #612 ligado");
  // 5ª revisão do PR #621: o PR que já chega mergeado/fechado diz o estado na linha de ligado.
  expect(textoDaLinha("pr_ligado", pr({ estado: "mergeado" }))).toBe("GitHub · PR gamefik/nod #612 ligado (mergeado)");
  expect(textoDaLinha("pr_ligado", pr({ estado: "fechado" }))).toBe("GitHub · PR gamefik/nod #612 ligado (fechado sem merge)");
  expect(textoDaLinha("ci_falhou", pr())).toBe("GitHub · CI falhou no #612");
  expect(textoDaLinha("pr_mergeado", pr(), "→ Feito")).toBe("GitHub · #612 mergeado → Feito");
});
