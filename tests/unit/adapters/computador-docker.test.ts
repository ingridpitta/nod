import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * NOD-170: o driver Docker sem Docker. `spawn` é trocado por um falso que responde pela tabela `responder` e
 * guarda cada `docker ...` chamado — o teste lê a sequência para provar o que NÃO foi chamado (create, start, rm -v).
 */
type Resposta = { codigo?: number; saida?: string; erro?: string };
const chamadas: string[][] = [];
/** O stdin de cada `docker ...` (o cofre vai por aqui no unlock). */
const entradas: string[] = [];
let responder: (args: string[]) => Resposta = () => ({});

vi.mock("node:child_process", () => ({
  spawn: (_cmd: string, args: string[]) => {
    chamadas.push(args);
    const p = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: Object.assign(new EventEmitter(), { end: (e?: string) => { entradas.push(e ?? ""); } }),
      kill: () => true,
    });
    const r = responder(args);
    setImmediate(() => {
      if (r.saida) p.stdout.emit("data", Buffer.from(r.saida));
      if (r.erro) p.stderr.emit("data", Buffer.from(r.erro));
      p.emit("close", r.codigo ?? 0);
    });
    return p;
  },
}));

const { criarDriverDocker } = await import("../../../src/adapters/computador/docker.ts");
const { FalhaComputador } = await import("../../../src/domain/computador.ts");

const ID = "11111111-2222-4333-8444-555555555555";
const OUTROS = ["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002", "aaaaaaaa-0000-4000-8000-000000000003"];
const ENV = { NOD_COMPUTADORES: "docker", NOD_CREDENTIAL_KEY: "0".repeat(63) + "2", NOD_COMPUTADOR_IMAGEM: "nod-computador:1" };
const PRONTO = JSON.stringify({ resultado: { pronto: true } });

/** Um host com `ligados` de pé e a máquina deste teste parada (ou rodando), com a imagem `imagemDoContainer`. */
function host(o: { ligados: string[]; proxies?: string[]; rodando?: boolean; existe?: boolean; imagemDoContainer?: string; imagemDaTag?: string }) {
  let rodando = o.rodando ?? false;
  let existe = o.existe ?? true;
  let proxy = o.existe ?? true;
  responder = (args) => {
    const [cmd, ...resto] = args;
    const alvo = resto.at(-1);
    if (cmd === "ps") {
      // O docker real aplica o filtro de nome; o falso devolve tudo — a conferência do driver tem de bastar.
      return { saida: [...o.ligados.map((id) => `nod-computador-${id}`), ...(o.proxies ?? []).map((id) => `nod-egress-${id}`)].join("\n") + "\n" };
    }
    if (cmd === "inspect" && alvo === `nod-computador-${ID}`) {
      if (!existe) return { codigo: 1, erro: "No such object" };
      if (resto.includes("{{.Image}}")) return { saida: `${o.imagemDoContainer ?? "sha256:igual"}\n` };
      if (resto.includes("{{.State.Running}} {{.RestartCount}}")) return { saida: `${rodando} 0\n` };
      return { saida: "[]" };
    }
    if (cmd === "inspect" && alvo === `nod-egress-${ID}` && !proxy) return { codigo: 1, erro: "No such object" };
    if (cmd === "inspect") return { saida: rodando ? "true 0\n" : "[]" };
    if (cmd === "image" && resto.includes("{{.Id}}")) return { saida: `${o.imagemDaTag ?? "sha256:igual"}\n` };
    if (cmd === "rm") { if (alvo === `nod-egress-${ID}`) proxy = false; else existe = false; return {}; }
    if (cmd === "create") { if (resto[1] === `nod-egress-${ID}`) proxy = true; else existe = true; return {}; }
    if (cmd === "start" && alvo === `nod-computador-${ID}`) { rodando = true; return {}; }
    if (cmd === "exec") return { saida: rodando ? PRONTO : "" };
    return {};
  };
}
const comandos = () => chamadas.map((a) => a.join(" "));

beforeEach(() => {
  chamadas.length = 0;
  entradas.length = 0;
});

describe("driver Docker: teto de computadores ligados (NOD-170)", () => {
  it("ligados() lê UMA vez, com o filtro de rótulo e nome, e só devolve máquinas (proxies e lixo não contam)", async () => {
    host({ ligados: OUTROS.slice(0, 2), proxies: OUTROS });
    responder = ((anterior) => (args: string[]) => args[0] === "ps" ? { saida: `${anterior(args).saida}nod-computador-nao-e-uuid\n/nod-computador-${OUTROS[2]}\n` } : anterior(args))(responder);
    const ligados = await criarDriverDocker(ENV).ligados();
    expect([...ligados].sort()).toEqual(OUTROS.slice(0, 2));
    expect(chamadas).toEqual([["ps", "--filter", "label=nod.computador=true", "--filter", "name=^nod-computador-", "--format", "{{.Names}}"]]);
  });

  it("no teto, recusa com limite_de_computadores ANTES de qualquer network, create ou start", async () => {
    host({ ligados: OUTROS, proxies: OUTROS });
    const erro = await criarDriverDocker(ENV).iniciar(ID).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(FalhaComputador);
    expect(erro).toMatchObject({ motivo: "limite_de_computadores", limite: { maximo: 3, ociosoMin: 15 } });
    expect(comandos().some((c) => /^(network|create|start|rm)\b/.test(c))).toBe(false);
  });

  it("os proxies não contam e o teto vem do ambiente: 2 máquinas + 3 proxies com máximo 3 liga", async () => {
    host({ ligados: OUTROS.slice(0, 2), proxies: OUTROS });
    await criarDriverDocker(ENV).iniciar(ID);
    expect(comandos()).toContain(`start nod-computador-${ID}`);
    chamadas.length = 0;
    host({ ligados: OUTROS.slice(0, 2) });
    await expect(criarDriverDocker({ ...ENV, NOD_COMPUTADORES_MAX: "2" }).iniciar(ID)).rejects.toMatchObject({ motivo: "limite_de_computadores", limite: { maximo: 2 } });
  });

  it("a máquina já ligada não conta contra si mesma: rodando e pronta, o teto nem é consultado", async () => {
    host({ ligados: [...OUTROS, ID], rodando: true });
    await criarDriverDocker(ENV).iniciar(ID);
    expect(comandos().some((c) => c.startsWith("ps "))).toBe(false);
  });

  it("inspect que diz 'parada' com a própria máquina em ligados(): ela não conta contra si mesma no teto", async () => {
    host({ ligados: [...OUTROS.slice(0, 2), ID], rodando: false });
    await criarDriverDocker(ENV).iniciar(ID);
    expect(comandos()).toContain(`start nod-computador-${ID}`);
  });

  it("estado() devolve o teto e a ociosidade do ambiente, para o cartão", async () => {
    host({ ligados: [] });
    expect((await criarDriverDocker({ ...ENV, NOD_COMPUTADOR_OCIOSO_MIN: "0" }).estado(ID)).limite).toEqual({ maximo: 3, ociosoMin: 0 });
  });

  it("NOD-192: ambiente() só olha a imagem (nenhuma máquina) e diz o mesmo que estado() sobre o ambiente", async () => {
    host({ ligados: [] });
    const driver = criarDriverDocker(ENV);
    expect(await driver.ambiente()).toEqual({ disponivel: true, motivo: null, limite: { maximo: 3, ociosoMin: 15 } });
    expect(comandos().filter((c) => !c.startsWith("image inspect"))).toEqual([]);
    expect(await driver.estado(ID)).toMatchObject(await driver.ambiente());
    for (const env of [{ ...ENV, NOD_COMPUTADORES: "" }, { ...ENV, NOD_CREDENTIAL_KEY: "" }]) {
      const d = criarDriverDocker(env);
      const a = await d.ambiente();
      expect(a.disponivel).toBe(false);
      expect(await d.estado(ID)).toEqual({ ...a, ativo: false });
    }
  });
});

describe("driver Docker: imagem nova chega à máquina parada (NOD-170)", () => {
  it("imagem diferente com a máquina PARADA: rm da máquina e do proxy sem -v, e o fluxo recria", async () => {
    host({ ligados: [], imagemDoContainer: "sha256:velha", imagemDaTag: "sha256:nova" });
    await criarDriverDocker(ENV).iniciar(ID);
    const c = comandos();
    const rms = c.filter((x) => x.startsWith("rm "));
    expect(rms).toEqual([`rm nod-computador-${ID}`, `rm --force nod-egress-${ID}`]);
    expect(rms.some((x) => /(^|\s)(-v|--volumes)(\s|$)/.test(x))).toBe(false);
    expect(c.some((x) => x.startsWith("volume "))).toBe(false);
    // Recriada com os MESMOS volumes nomeados (o login e o workspace ficam).
    const create = c.findIndex((x) => x.startsWith("create --name nod-computador-"));
    expect(create).toBeGreaterThan(c.indexOf(`rm nod-computador-${ID}`));
    expect(c[create]).toContain(`source=nod-computador-${ID}-home`);
    expect(c[create]).toContain(`source=nod-computador-${ID}-workspace`);
    expect(c).toContain(`create --name nod-egress-${ID} --label nod.computador=true --restart unless-stopped --network bridge --cap-drop ALL --security-opt no-new-privileges --read-only --memory 128m --pids-limit 64 nod-computador:1 node egress.mjs`);
  });

  it("mesma imagem, máquina parada: liga sem rm nem create", async () => {
    host({ ligados: [] });
    await criarDriverDocker(ENV).iniciar(ID);
    const c = comandos();
    expect(c.some((x) => x.startsWith("rm ") || x.startsWith("create --name nod-computador-"))).toBe(false);
    expect(c).toContain(`start nod-computador-${ID}`);
  });

  it("imagem diferente com a máquina LIGADA: não faz nada (a troca espera ela parar)", async () => {
    host({ ligados: [ID], rodando: true, imagemDoContainer: "sha256:velha", imagemDaTag: "sha256:nova" });
    await criarDriverDocker(ENV).iniciar(ID);
    const c = comandos();
    expect(c.some((x) => x.startsWith("rm ") || x.startsWith("create ") || x.includes("{{.Image}}"))).toBe(false);
  });

  it("máquina que nunca existiu: nada a comparar, cria do zero", async () => {
    host({ ligados: [], existe: false });
    await criarDriverDocker(ENV).iniciar(ID);
    const c = comandos();
    expect(c.some((x) => x.startsWith("rm "))).toBe(false);
    expect(c.some((x) => x.startsWith("create --name nod-computador-"))).toBe(true);
  });
});

describe("driver Docker: log computador_iniciado mede o boot (NOD-162)", () => {
  let linhas: Record<string, unknown>[] = [];
  let brutas: string[] = [];
  beforeEach(() => {
    linhas = [];
    brutas = [];
    vi.spyOn(console, "log").mockImplementation((l: string) => { brutas.push(l); linhas.push(JSON.parse(l) as Record<string, unknown>); });
    return () => vi.restoreAllMocks();
  });
  const iniciados = () => linhas.filter((l) => l.evento === "computador_iniciado");

  it("máquina nova: frio, duração numérica, sem imagem recriada nem reinício", async () => {
    host({ ligados: [], existe: false });
    await criarDriverDocker(ENV).iniciar(ID);
    expect(iniciados()).toEqual([expect.objectContaining({ nivel: "info", computador_id: ID, partida: "frio", ok: true, imagem_recriada: false, reiniciou: false })]);
    expect(typeof iniciados()[0]!.duracao_ms).toBe("number");
  });

  it("máquina parada: quente", async () => {
    host({ ligados: [] });
    await criarDriverDocker(ENV).iniciar(ID);
    expect(iniciados()).toEqual([expect.objectContaining({ partida: "quente", ok: true, imagem_recriada: false, reiniciou: false })]);
  });

  it("imagem velha: frio com imagem_recriada", async () => {
    host({ ligados: [], imagemDoContainer: "sha256:velha", imagemDaTag: "sha256:nova" });
    await criarDriverDocker(ENV).iniciar(ID);
    expect(iniciados()).toEqual([expect.objectContaining({ partida: "frio", imagem_recriada: true, ok: true })]);
  });

  it("de pé com o cofre trancado (docker restart): quente com reiniciou", async () => {
    host({ ligados: [ID], rodando: true });
    let primeiroPing = true;
    responder = ((anterior) => (args: string[]) => {
      if (args[0] === "exec" && primeiroPing) { primeiroPing = false; return { saida: JSON.stringify({ resultado: { pronto: false } }) }; }
      return anterior(args);
    })(responder);
    await criarDriverDocker(ENV).iniciar(ID);
    expect(iniciados()).toEqual([expect.objectContaining({ partida: "quente", reiniciou: true, ok: true })]);
  });

  // QA NOD-162: no Mac carregado o 1º ping estoura os 3 s. Ping sem resposta não mostra cofre trancado nem
  // código parado, e nada foi reiniciado: não pode contar como reinício na medição.
  it("de pé, mas o 1º ping não responde (prazo estourado): quente sem reiniciou", async () => {
    host({ ligados: [ID], rodando: true });
    let primeiroPing = true;
    responder = ((anterior) => (args: string[]) => {
      if (args[0] === "exec" && args.includes("/opt/nod/client.mjs") && primeiroPing) { primeiroPing = false; return { codigo: 1, erro: "context deadline exceeded" }; }
      return anterior(args);
    })(responder);
    await criarDriverDocker(ENV).iniciar(ID);
    expect(iniciados()).toEqual([expect.objectContaining({ partida: "quente", reiniciou: false, ok: true })]);
    expect(comandos().some((c) => c.startsWith("restart "))).toBe(false);
  });

  it("ligada e pronta: nenhum computador_iniciado (executar passa por iniciar em toda ação)", async () => {
    host({ ligados: [ID], rodando: true });
    await criarDriverDocker(ENV).iniciar(ID);
    expect(iniciados()).toEqual([]);
  });

  it("nao_permitido não loga", async () => {
    await expect(criarDriverDocker({ ...ENV, NOD_COMPUTADORES: "" }).iniciar(ID)).rejects.toMatchObject({ codigo: "nao_permitido" });
    expect(iniciados()).toEqual([]);
  });

  it("falha no start: aviso com ok:false e o motivo fechado, sem o detalhe do stderr, e relança", async () => {
    host({ ligados: [] });
    responder = ((anterior) => (args: string[]) => args[0] === "start" && args.at(-1) === `nod-computador-${ID}` ? { codigo: 1, erro: "OCI runtime: segredo-do-stderr" } : anterior(args))(responder);
    await expect(criarDriverDocker(ENV).iniciar(ID)).rejects.toMatchObject({ motivo: "nao_iniciou" });
    expect(iniciados()).toEqual([expect.objectContaining({ nivel: "aviso", ok: false, motivo: "nao_iniciou", partida: "quente" })]);
    expect(typeof iniciados()[0]!.duracao_ms).toBe("number");
    expect(brutas.join("\n")).not.toContain("segredo-do-stderr");
  });

  it("falha mede a duração até o ponto da falha, não até o log", async () => {
    let agora = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => agora);
    host({ ligados: [] });
    responder = ((anterior) => (args: string[]) => {
      if (args[0] === "start" && args.at(-1) === `nod-computador-${ID}`) { agora += 4321; return { codigo: 1, erro: "falhou" }; }
      return anterior(args);
    })(responder);
    const p = criarDriverDocker(ENV).iniciar(ID);
    await expect(p).rejects.toMatchObject({ motivo: "nao_iniciou" });
    agora += 99_999;
    expect(iniciados()).toEqual([expect.objectContaining({ ok: false, duracao_ms: 4321 })]);
  });

  it("máquina nova que falha antes do create (rede): frio, não quente", async () => {
    host({ ligados: [], existe: false });
    responder = ((anterior) => (args: string[]) => (args[0] === "network" ? { codigo: 1, erro: "sem rede" } : anterior(args)))(responder);
    await expect(criarDriverDocker(ENV).iniciar(ID)).rejects.toMatchObject({ motivo: "nao_iniciou" });
    expect(iniciados()).toEqual([expect.objectContaining({ ok: false, partida: "frio", imagem_recriada: false })]);
  });

  it("imagem velha que falha no create da máquina: frio com imagem_recriada", async () => {
    host({ ligados: [], imagemDoContainer: "sha256:velha", imagemDaTag: "sha256:nova" });
    responder = ((anterior) => (args: string[]) => (args[0] === "create" && args[2] === `nod-computador-${ID}` ? { codigo: 1, erro: "create falhou" } : anterior(args)))(responder);
    await expect(criarDriverDocker(ENV).iniciar(ID)).rejects.toMatchObject({ motivo: "nao_iniciou" });
    expect(iniciados()).toEqual([expect.objectContaining({ ok: false, partida: "frio", imagem_recriada: true })]);
  });

  it("falha depois do unlock (ok:false): nem a chave, nem o HMAC, nem o detalhe do runtime vão ao log", async () => {
    const cofre = createHmac("sha256", Buffer.from(ENV.NOD_CREDENTIAL_KEY, "hex")).update(`nod-computador:${ID}`).digest("hex");
    host({ ligados: [], existe: false });
    // O runtime devolve o detalhe com o pior conteúdo possível: o próprio cofre e a chave.
    const detalhe = `cofre recusado: ${cofre} ${ENV.NOD_CREDENTIAL_KEY} detalhe-cru-do-runtime`;
    responder = ((anterior) => (args: string[]) => (args[0] === "exec" && args.includes("/opt/nod/client.mjs") ? { saida: JSON.stringify({ resultado: { pronto: false, falha: "cofre_invalido", detalhe } }) } : anterior(args)))(responder);
    await expect(criarDriverDocker(ENV).iniciar(ID)).rejects.toMatchObject({ motivo: "cofre_invalido" });
    expect(entradas).toContain(cofre);
    expect(iniciados()).toEqual([expect.objectContaining({ nivel: "aviso", ok: false, motivo: "cofre_invalido", partida: "frio" })]);
    expect(iniciados()[0]).not.toHaveProperty("detalhe");
    const tudo = brutas.join("\n");
    expect(tudo).not.toContain(ENV.NOD_CREDENTIAL_KEY);
    expect(tudo).not.toContain(cofre);
    expect(tudo).not.toContain("detalhe-cru-do-runtime");
  });

  it("teto: ok:false com limite_de_computadores, sem boot", async () => {
    host({ ligados: OUTROS });
    await expect(criarDriverDocker(ENV).iniciar(ID)).rejects.toMatchObject({ motivo: "limite_de_computadores" });
    expect(iniciados()).toEqual([expect.objectContaining({ ok: false, motivo: "limite_de_computadores" })]);
  });

  it("nem a NOD_CREDENTIAL_KEY nem o HMAC do cofre aparecem no log", async () => {
    const cofre = createHmac("sha256", Buffer.from(ENV.NOD_CREDENTIAL_KEY, "hex")).update(`nod-computador:${ID}`).digest("hex");
    host({ ligados: [], existe: false });
    await criarDriverDocker(ENV).iniciar(ID);
    expect(iniciados()).toHaveLength(1);
    const tudo = brutas.join("\n");
    expect(tudo).not.toContain(ENV.NOD_CREDENTIAL_KEY);
    expect(tudo).not.toContain(cofre);
    // O cofre foi mesmo para o unlock (prova de que o teste compara o HMAC certo).
    expect(entradas).toContain(cofre);
  });
});
