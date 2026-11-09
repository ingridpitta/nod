import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { DefinicaoAcao } from "../../src/contracts/acoes.ts";
import { REGISTRO_DE_ACOES } from "../../src/domain/acoes/index.ts";
import { planoDeFuzz, type CasoDeFuzz } from "../../src/domain/fuzz/gerador.ts";
import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, connect } from "node:net";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { acoesNovasSemLeitura, acoesSemHandler, bloquearRedeExterna, rotasPublicasSemHandler, vereditoDeDecisao, sementeDoPr, chegouNoHandler, enxugarCasos, executarFuzz, lerN, processosBloqueados, planoDoServidor, relatarViolacoes, type AlvoDoFuzz, type Retrato, type RotaDoServidor } from "../helpers/fuzz.ts";
import { ACOES_CONHECIDAS_NOD398 } from "../helpers/acoes-conhecidas-nod398.ts";

/**
 * Sentinelas do fuzz (NOD-398): provam que o fuzz PEGA o que promete pegar. Um servidor de mentira com uma ação quebrada
 * de propósito — se uma destas passar sem violação, o fuzz parou de medir.
 */

const IDS = { daPessoa: ["11111111-1111-4111-8111-111111111111"], deOutraPessoa: ["22222222-2222-4222-8222-222222222222"] };
const acao = (id: string, schema?: DefinicaoAcao["schema"]): DefinicaoAcao => ({ id, titulo: id, risco: "muda", cartaoNoChat: false, chat: { estado: "nunca", motivo: "fixture" }, ...(schema ? { schema } : {}) });

/** Um servidor em memória: `boa` responde 400 sem mexer em nada; `quebrada` faz o que o modo pedir. */
function servidorFalso(modo: "500" | "escreve_no_erro" | "mexe_na_outra" | "morre" | "nada", o: { marca?: boolean; retratos?: { minha: number; dela: number } } = {}) {
  let minha: Retrato = { bots: "0:" };
  let dela: Retrato = { bots: "1:abc" };
  let vivo = true;
  // Como o xid do Postgres: toda escrita avança (é o que `marcaDoBanco` lê).
  let escritas = 0;
  const alvo: AlvoDoFuzz = {
    async chamar(c: CasoDeFuzz) {
      if (!vivo) throw new Error("ECONNREFUSED");
      if (c.acao !== "f.quebrada" || modo === "nada") return { status: 400, corpo: '{"codigo":"entrada_invalida"}' };
      if (modo === "500") return { status: 500, corpo: '{"codigo":"interno"}' };
      if (modo === "escreve_no_erro") { minha = { bots: `${Math.random()}` }; escritas++; return { status: 400, corpo: "{}" }; }
      if (modo === "mexe_na_outra") { dela = { bots: "1:mudou" }; escritas++; return { status: 404, corpo: "{}" }; }
      vivo = false;
      throw new Error("socket hang up");
    },
    saude: async () => vivo,
    retrato: async () => { if (o.retratos) o.retratos.minha++; return minha; },
    retratoDaOutra: async () => { if (o.retratos) o.retratos.dela++; return dela; },
    ...(o.marca ? { marca: async () => String(escritas) } : {}),
  };
  return alvo;
}

const REGISTRO = [acao("f.boa", { type: "object", properties: { nome: { type: "string" } } }), acao("f.quebrada")];
const ROTAS = [{ metodo: "POST", padrao: "^\\/boa$", acao: "f.boa" }, { metodo: "POST", padrao: "^\\/quebrada$", acao: "f.quebrada" }];
const plano = (semente = 11) => planoDeFuzz({ registro: REGISTRO, rotas: ROTAS, semente, n: 8, ids: IDS });

describe("sentinelas do fuzz (NOD-398)", () => {
  it("servidor certo: zero violações (o fuzz não acusa à toa)", async () => {
    expect(await executarFuzz(servidorFalso("nada"), plano().casos)).toEqual([]);
  });

  it("ação que dá 500 é pega, com a ação e o caso", async () => {
    const v = await executarFuzz(servidorFalso("500"), plano().casos);
    expect(v.length).toBe(8);
    expect(v.every((x) => x.acao === "f.quebrada" && /status 500/.test(x.motivo))).toBe(true);
  });

  it("erro que deixa dado pela metade no banco da pessoa é pego", async () => {
    const v = await executarFuzz(servidorFalso("escreve_no_erro"), plano().casos);
    expect(v.some((x) => /banco da pessoa mudou em: bots/.test(x.motivo))).toBe(true);
  });

  it("ação que mexe no banco de OUTRA pessoa é pega (mesmo num 404) e para o fuzz", async () => {
    const v = await executarFuzz(servidorFalso("mexe_na_outra"), plano().casos);
    expect(v.at(-1)?.motivo).toMatch(/OUTRA pessoa mudou em: bots/);
  });

  it("com a marca do banco, o caso que não gravou nada não paga retrato, e quem grava no erro segue pego (custo do PR)", async () => {
    const retratos = { minha: 0, dela: 0 };
    expect(await executarFuzz(servidorFalso("nada", { marca: true, retratos }), plano().casos)).toEqual([]);
    // Só os retratos de partida: nenhum caso gravou, então nenhum retrato novo (sem a marca, um por caso).
    expect(retratos).toEqual({ minha: 1, dela: 1 });
    const v = await executarFuzz(servidorFalso("escreve_no_erro", { marca: true }), plano().casos);
    expect(v.filter((x) => /banco da pessoa mudou em: bots/.test(x.motivo)).length).toBe(8);
    expect((await executarFuzz(servidorFalso("mexe_na_outra", { marca: true }), plano().casos)).at(-1)?.motivo).toMatch(/OUTRA pessoa mudou em: bots/);
    // Marca nula (escrita em curso no banco): retrato em todo caso, como sem marca.
    const semGarantia = { minha: 0, dela: 0 };
    const nula = { ...servidorFalso("nada", { retratos: semGarantia }), marca: async () => null };
    expect(await executarFuzz(nula, plano().casos)).toEqual([]);
    expect(semGarantia.minha).toBe(plano().casos.length + 1);
  });

  it("ação que derruba o servidor é pega e para o fuzz", async () => {
    const v = await executarFuzz(servidorFalso("morre"), plano().casos);
    expect(v.at(-1)?.motivo).toBe("o servidor morreu");
  });

  it("a mensagem de falha começa pela semente que reproduz", async () => {
    const v = await executarFuzz(servidorFalso("500"), plano(42).casos);
    expect(relatarViolacoes(42, 8, v).split("\n")[0]).toBe("fuzz falhou — reproduza com FUZZ_SEMENTE=42 FUZZ_N=8");
  });

  it("a mesma semente reproduz exatamente os mesmos casos (e, contra o mesmo servidor, as mesmas violações)", async () => {
    expect(plano(42)).toEqual(plano(42));
    expect(await executarFuzz(servidorFalso("500"), plano(42).casos)).toEqual(await executarFuzz(servidorFalso("500"), plano(42).casos));
  });

  it("ação nova no registro entra no fuzz sem editar teste nenhum (pelo MESMO plano que o teste de conformidade usa)", () => {
    // planoDoServidor é o que tests/concurrency/fuzz-acoes.test.ts roda contra o servidor de verdade: aqui ele recebe o
    // registro inteiro mais uma ação nova, e as rotas como o roteador as monta (RegExp, interno, máquina, pública).
    const nova = acao("fixture.nova_do_nod398", { type: "object", properties: { x: { type: "string" } } });
    const registro = [...(REGISTRO_DE_ACOES as readonly DefinicaoAcao[]), nova];
    const rotas: RotaDoServidor[] = [
      { metodo: "POST", padrao: /^\/fixture$/, acao: nova.id },
      { metodo: "POST", padrao: /^\/interna$/, acao: "bots.criar", interno: true },
      { metodo: "POST", padrao: /^\/maquina$/, acao: "bots.criar", maquina: true },
    ];
    const p = planoDoServidor({ registro, pendentes: registro.map((a) => a.id), rotas, semente: 5, n: 3, ids: IDS });
    expect(p.casos.filter((c) => c.acao === nova.id)).toHaveLength(3);
    expect(p.semRota).not.toContain(nova.id);
    // Rota interna ou de máquina não conta como cobertura da ação (o fuzz não a chama como pessoa).
    expect(p.semRota).toContain("bots.criar");
    // Fora das pendentes (já coberta por outro servidor), não entra de novo.
    expect(planoDoServidor({ registro, pendentes: [], rotas, semente: 5, n: 3, ids: IDS }).casos).toEqual([]);
  });

  it("ADA-242: /conta/codigo e /conta/google/trocar contam como conta.entrar (não viram ação sintética sem leitura)", () => {
    const registro = REGISTRO_DE_ACOES as readonly DefinicaoAcao[];
    const rotas: RotaDoServidor[] = [{ metodo: "POST", padrao: new RegExp("^\\/conta\\/codigo$"), publica: true }, { metodo: "POST", padrao: new RegExp("^\\/conta\\/google\\/trocar$"), publica: true }];
    const p = planoDoServidor({ registro, pendentes: ["conta.entrar"], rotas, semente: 1, n: 2, ids: IDS });
    expect(p.casos.filter((c) => c.acao.startsWith("conta.sem_acao"))).toEqual([]);
    expect(p.casos.filter((c) => c.acao === "conta.entrar").length).toBeGreaterThan(0);
    expect(p.semRota).not.toContain("conta.entrar");
  });

  it("as ações de conta (sem rota de pessoa) só contam quando a rota de /conta DELAS existe", () => {
    const registro = REGISTRO_DE_ACOES as readonly DefinicaoAcao[];
    const contas = registro.filter((a) => a.id.startsWith("conta.")).map((a) => a.id);
    expect(contas.length).toBeGreaterThan(0);
    const soSenha: RotaDoServidor[] = [{ metodo: "POST", padrao: new RegExp("^/conta/senha$"), publica: true }, { metodo: "POST", padrao: new RegExp("^/conta/coisa-nova$"), publica: true }];
    const p = planoDoServidor({ registro, pendentes: contas, rotas: soSenha, semente: 1, n: 2, ids: IDS });
    expect(p.casos.filter((c) => c.acao === "conta.trocar_senha").every((c) => c.publica)).toBe(true);
    expect(p.semRota).toEqual(contas.filter((id) => id !== "conta.trocar_senha"));
    // A rota de conta que nenhuma ação reconhece também leva fuzz (sintética), sem virar cobertura.
    expect(p.casos.some((c) => c.acao === "conta.sem_acao POST /conta/coisa-nova")).toBe(true);
  });

  it("cobertura é chegar ao HANDLER: 404 do roteador e 401 de sessão não contam", () => {
    const tenant = { publica: false };
    expect(chegouNoHandler(tenant, 404, '{"codigo":"nao_encontrado","mensagem":"rota não encontrada"}')).toBe(false);
    expect(chegouNoHandler(tenant, 401, '{"codigo":"nao_permitido"}')).toBe(false);
    expect(chegouNoHandler({ publica: true }, 401, '{"codigo":"nao_permitido"}')).toBe(true);
    expect(chegouNoHandler(tenant, 404, '{"codigo":"nao_encontrado","mensagem":"Não achei esse bot."}')).toBe(true);
    expect(chegouNoHandler(tenant, 400, "{}")).toBe(true);
    const casos = plano().casos;
    expect(acoesSemHandler(casos, new Set(["f.boa"]))).toEqual(["f.quebrada"]);
  });

  it("rota de conta: 403 da trava de Origin e 429 (limite) não contam, e a cobertura é por rota, não por ação (revisão 2, médio 8)", () => {
    const publica = { publica: true };
    expect(chegouNoHandler(publica, 403, '{"codigo":"nao_permitido"}')).toBe(false);
    expect(chegouNoHandler(publica, 429, '{"codigo":"limite_atingido"}')).toBe(false);
    expect(chegouNoHandler(publica, 400, '{"codigo":"entrada_invalida"}')).toBe(true);
    // O 403 da regra de Minha conta (com motivo) é o handler respondendo.
    expect(chegouNoHandler(publica, 403, '{"codigo":"nao_permitido","mensagem":"x","motivo":"reautenticar"}')).toBe(true);
    // Dentro do tenant, 403 é regra do handler (nod_protegido, p.ex.) e conta.
    expect(chegouNoHandler({ publica: false }, 403, '{"codigo":"nod_protegido"}')).toBe(true);
    const p = planoDoServidor({
      registro: [{ id: "conta.entrar", titulo: "Entrar", risco: "muda", cartaoNoChat: false, chat: { estado: "nunca", motivo: "x" } }],
      pendentes: ["conta.entrar"],
      rotas: [
        { metodo: "POST", padrao: /^\/conta\/entrar$/, publica: true },
        { metodo: "POST", padrao: /^\/conta\/cadastro$/, publica: true },
      ],
      semente: 1,
      n: 2,
      ids: { daPessoa: [], deOutraPessoa: [] },
    });
    // Só a de entrar chegou: a ação conta como coberta, mas a rota de cadastro fica de fora e o fuzz falha.
    const entrar = p.casos.find((c) => c.caminho === "/conta/entrar")!.rota;
    expect(acoesSemHandler(p.casos, new Set(["conta.entrar"]))).toEqual([]);
    expect(rotasPublicasSemHandler(p.casos, new Set([entrar]))).toEqual([p.casos.find((c) => c.caminho === "/conta/cadastro")!.rota]);
  });

  it("as que destroem vão depois das outras, e as públicas (conta) por último: excluir o alvo não esvazia o resto", () => {
    const registro = [acao("a.excluir"), acao("a.editar"), acao("conta.x")];
    const rotas = [
      { metodo: "DELETE", padrao: "^\\/a$", acao: "a.excluir" },
      { metodo: "POST", padrao: "^\\/c$", acao: "conta.x", publica: true },
      { metodo: "PATCH", padrao: "^\\/a$", acao: "a.editar" },
    ];
    const ordem = [...new Set(planoDeFuzz({ registro, rotas, semente: 3, n: 2, ids: IDS }).casos.map((c) => c.acao))];
    expect(ordem).toEqual(["a.editar", "a.excluir", "conta.x"]);
  });

  it("violação na outra pessoa diz o intervalo de casos onde está o culpado", async () => {
    const v = await executarFuzz(servidorFalso("mexe_na_outra"), plano().casos);
    expect(v.at(-1)?.motivo).toMatch(/entre os casos \d+ e \d+: .*f\.quebrada|no caso \d+/);
  });

  it("rede fora do loopback é recusada para qualquer cliente (net.connect), e o loopback continua", async () => {
    const srv = createServer((s) => s.end("ok"));
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
    const porta = (srv.address() as { port: number }).port;
    const desbloquear = bloquearRedeExterna();
    try {
      const fora = await new Promise<string>((ok) => connect(443, "203.0.113.7").on("error", (e) => ok(e.message)).on("connect", () => ok("conectou")));
      expect(fora).toMatch(/rede bloqueada para 203\.0\.113\.7/);
      const dentro = await new Promise<string>((ok, erro) => { const s = connect({ port: porta, host: "127.0.0.1" }); let d = ""; s.on("data", (b) => (d += b)).on("end", () => ok(d)).on("error", erro); });
      expect(dentro).toBe("ok");
      await expect(fetch("http://203.0.113.7/")).rejects.toThrow();
      // http/https do Node chegam ao Socket.connect com `path: null`: também são barrados pelo host.
      for (const cliente of [httpGet, httpsGet]) {
        const msg = await new Promise<string>((ok) => cliente("http" + (cliente === httpsGet ? "s" : "") + "://203.0.113.7/", () => ok("conectou")).on("error", (e) => ok(e.message)));
        expect(msg).toMatch(/rede bloqueada para 203\.0\.113\.7/);
      }
    } finally {
      desbloquear();
      srv.close();
    }
  });

  it("nenhum processo-filho roda durante o fuzz (gh, MCP): quem chamou recebe ENOENT; depois, volta ao normal (revisão 8)", async () => {
    const rodar = () => new Promise<string>((ok) => execFile(process.execPath, ["-e", "process.stdout.write('rodou')"], (e, out) => ok(e ? (e as NodeJS.ErrnoException).code ?? e.message : out)));
    const desbloquear = bloquearRedeExterna();
    const antes = processosBloqueados.length;
    try {
      expect(await rodar()).toBe("ENOENT");
      expect(await new Promise<string>((ok) => spawn("gh", ["auth", "status"]).on("error", (e) => ok((e as NodeJS.ErrnoException).code ?? "")).on("spawn", () => ok("subiu")))).toBe("ENOENT");
      expect(processosBloqueados.slice(antes)).toEqual([process.execPath, "gh"]);
    } finally {
      desbloquear();
    }
    expect(await rodar()).toBe("rodou");
  });

  it("o trabalho em segundo plano de um sucesso não vira falso 'erro mexeu no banco' no caso seguinte, com `quieto` (revisão 9)", async () => {
    let minha: Record<string, string> = { turnos: "0" };
    const casos = planoDeFuzz({ registro: [acao("f.x")], rotas: [{ metodo: "POST", padrao: "^\\/x$", acao: "f.x" }], semente: 2, n: 2, ids: IDS }).casos.slice(0, 2);
    const alvo = (): AlvoDoFuzz => {
      let i = 0;
      return {
        chamar: async () => {
          if (i++ === 0) {
            // O sucesso dispara um turno que escreve 30 ms depois e de novo aos 60 ms.
            setTimeout(() => (minha = { turnos: "1" }), 30);
            setTimeout(() => (minha = { turnos: "2" }), 60);
            return { status: 200, corpo: "{}" };
          }
          await new Promise((ok) => setTimeout(ok, 100));
          return { status: 400, corpo: "{}" };
        },
        saude: async () => true,
        retrato: async () => minha,
      };
    };
    expect(await executarFuzz(alvo(), casos, { quieto: { prazoMs: 1_000, intervaloMs: 40 } })).toEqual([]);
    minha = { turnos: "0" };
    const sem = await executarFuzz(alvo(), casos);
    expect(sem[0]?.motivo).toMatch(/status 400 e o banco da pessoa mudou em: turnos/);
  });

  it("socket unix só o do Postgres e os permitidos; execFileSync também é barrado (revisão 9)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fuzz-unix-"));
    const permitido = join(dir, "ok.sock");
    const servidor = createServer((c) => c.end("oi")).listen(permitido);
    await new Promise((ok) => servidor.once("listening", ok));
    const tentar = (caminho: string) => new Promise<string>((ok) => connect(caminho).on("data", () => ok("conectou")).on("error", (e) => ok(e.message)));
    const desbloquear = bloquearRedeExterna({ unixPermitidos: [dir] });
    try {
      expect(await tentar(permitido)).toBe("conectou");
      expect(await tentar("/var/run/docker.sock")).toMatch(/fuzz: rede bloqueada para \/var\/run\/docker\.sock/);
      expect(() => execFileSync(process.execPath, ["-e", "1"])).toThrow(/ENOENT/);
    } finally {
      desbloquear();
      servidor.close();
      rmSync(dir, { recursive: true, force: true });
    }
    expect(execFileSync(process.execPath, ["-e", "process.stdout.write('rodou')"], { encoding: "utf8" })).toBe("rodou");
  });

  it("enxugarCasos (NOD-420): k por rota só nas ações escolhidas, com as fixas e um caso que passa da busca, na ordem do plano", () => {
    const schema: DefinicaoAcao["schema"] = { type: "object", properties: { nome: { type: "string" }, n: { type: "integer" } }, required: ["nome"] };
    const registro = [acao("q.mudar", schema), acao("q.excluir", schema), acao("f.boa", schema)];
    const rotas = [
      { metodo: "PATCH", padrao: "^\\/agentes\\/(?<id>[^/]+)\\/t\\/(?<tid>[^/]+)$", acao: "q.mudar" },
      { metodo: "DELETE", padrao: "^\\/agentes\\/(?<id>[^/]+)\\/t\\/(?<tid>[^/]+)$", acao: "q.excluir" },
      { metodo: "POST", padrao: "^\\/boa$", acao: "f.boa" },
    ];
    const ids = { ...IDS, porRecurso: { t: { daPessoa: ["t-1"], deOutraPessoa: [] } } };
    for (const semente of [1, 2, 3, 4, 5]) {
      const casos = planoDeFuzz({ registro, rotas, semente, n: 20, ids }).casos;
      const menos = enxugarCasos(casos, { acoes: (a) => a.startsWith("q."), k: 10, idsDaPessoa: new Set([IDS.daPessoa[0]!, "t-1"]) });
      for (const a of ["q.mudar", "q.excluir"]) {
        const deA = menos.filter((c) => c.acao === a);
        expect(deA.length).toBe(Math.min(10, casos.filter((c) => c.acao === a).length));
        expect(deA.map((c) => c.entrada.rotulo)).toEqual(expect.arrayContaining(["base plausível", "json quebrado", "sem corpo"]));
        if (casos.some((c) => c.acao === a && c.caminho.includes(IDS.daPessoa[0]!) && c.caminho.endsWith("/t-1"))) expect(deA.some((c) => c.caminho.includes(IDS.daPessoa[0]!) && c.caminho.endsWith("/t-1"))).toBe(true);
      }
      // As outras intactas, e a ordem do plano (o DELETE por último) mantida.
      expect(menos.filter((c) => c.acao === "f.boa")).toEqual(casos.filter((c) => c.acao === "f.boa"));
      expect(menos).toEqual(casos.filter((c) => menos.includes(c)));
    }
  });

  it("FUZZ_N inválido é erro, nunca um fuzz verde de zero casos", () => {
    expect(lerN(undefined, 20)).toBe(20);
    expect(lerN("200", 20)).toBe(200);
    for (const ruim of ["abc", "0", "-1", "1.5", "99999"]) expect(() => lerN(ruim, 20)).toThrow(/FUZZ_N inválido/);
  });
});

describe("invariante de decisão (revisão 3): a sentinela que prova que o fuzz pega uma ação arriscada que rodou", () => {
  it("feita sem decisão é violação; esperar com cartão ou recusar não é", () => {
    expect(vereditoDeDecisao({ ok: true, feitas: [{ i: 0 }], esperando: [], falhas: [] })).toBe("rodou");
    // Até se também diz que espera: se alguma coisa foi feita, rodou.
    expect(vereditoDeDecisao({ ok: true, feitas: [{ i: 0 }], esperando: [0], falhas: [], decisao_id: "d" })).toBe("rodou");
    expect(vereditoDeDecisao({ ok: true, feitas: [], esperando: [0], falhas: [], decisao_id: "d" })).toBe("esperou");
    // Esperando sem cartão de decisão: ninguém vai decidir, então não conta como espera.
    expect(vereditoDeDecisao({ ok: true, feitas: [], esperando: [0], falhas: [], decisao_id: null })).toBe("rodou");
    expect(vereditoDeDecisao({ ok: true, feitas: [], esperando: [], falhas: [{ i: 0 }] })).toBe("recusou");
    expect(vereditoDeDecisao({ ok: false })).toBe("recusou");
    expect(vereditoDeDecisao({ ok: true, feitas: [], esperando: [], falhas: [] })).toBe("rodou");
  });

  it("semente do PR: a mesma para o mesmo commit, null fora do CI", () => {
    expect(sementeDoPr("deadbeef0123")).toBe(0xdeadbeef);
    expect(sementeDoPr("deadbeef0123")).toBe(sementeDoPr("deadbeefffff"));
    expect(sementeDoPr(undefined)).toBeNull();
    expect(sementeDoPr("")).toBeNull();
  });
});

describe("teto das ações novas só 404/403 (revisão 14 do #590)", () => {
  const conhecidas = new Set(["velha.a"]);
  it("ação nova que em nenhum servidor passou da busca reprova", () => {
    expect(acoesNovasSemLeitura({ fuzzadas: ["velha.a", "nova.b"], alemDaBusca: new Set(), conhecidas })).toEqual(["nova.b"]);
  });
  it("ação nova lida em qualquer servidor passa; a conhecida nunca reprova no PR", () => {
    expect(acoesNovasSemLeitura({ fuzzadas: ["velha.a", "nova.b", "nova.b"], alemDaBusca: new Set(["nova.b"]), conhecidas })).toEqual([]);
  });
  it("a foto das ações conhecidas não cresce e está contida no registro", () => {
    const registro = new Set<string>(REGISTRO_DE_ACOES.map((a) => a.id));
    expect(ACOES_CONHECIDAS_NOD398.size).toBe(134);
    // Hash da lista ordenada: trocar uma ação velha por uma nova (mesmo tamanho) também reprova.
    expect(createHash("sha256").update([...ACOES_CONHECIDAS_NOD398].sort().join("\n")).digest("hex")).toBe("7a5a3068ad6cbbd04ce09769c4219443ab4fb66746b2f78441e7cc64a3fce20a");
    expect([...ACOES_CONHECIDAS_NOD398].filter((a) => !registro.has(a))).toEqual([]);
  });
});
