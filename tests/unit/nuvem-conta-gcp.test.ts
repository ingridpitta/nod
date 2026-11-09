import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarContaGcp } from "../../src/adapters/nuvem/conta-gcp.ts";
import type { RefInstancia } from "../../src/contracts/provedor-nuvem.ts";
import { condicaoGerenciarProjeto, condicaoLerProjeto, condicaoLigar, ErroNuvemTransitorio, PERMISSOES_DOS_PAPEIS, PREFIXO_INSTANCIA_NOD } from "../../src/domain/maquina-nuvem.ts";

const PESSOA = "0b7c2f6e-1111-4a2b-9c3d-123456789abc";
const HASH8 = createHash("sha256").update(PESSOA).digest("hex").slice(0, 8);
const PROJETO = "nod-0b7c2f6e-beef";
const EMAIL = `nod-${HASH8}@${PROJETO}.iam.gserviceaccount.com`;
const CHAVE = JSON.stringify({ type: "service_account", client_email: EMAIL, private_key: "pem" });

type Pedido = { url: string; metodo: string; corpo: unknown; auth: string | null };
type Vinculo = { role: string; members: string[]; condition?: { title: string; expression: string } };

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });
const erroGoogle = (status: number, extra: Record<string, unknown> = {}) => json({ error: { code: status, message: "texto do google", ...extra } }, status);
const existe = () => erroGoogle(409, { status: "ALREADY_EXISTS" });

/**
 * Um Google de mentira com estado: o que já foi criado devolve 409 (como o de verdade). `sobrescrever` troca a resposta
 * de toda rota cujo `MÉTODO url` termina com a chave para roteirizar falhas.
 */
function googleFalso(o: { contas?: unknown[]; faturado?: boolean; politica?: Vinculo[]; instancia?: boolean } = {}) {
  const pedidos: Pedido[] = [];
  const criados = new Set<string>();
  let politica: Vinculo[] = o.politica ?? [];
  let faturado = o.faturado ?? false;
  let consultasOp = 0;
  let numChave = 0;
  const chaves: string[] = [];
  const sobrescrever = new Map<string, () => Response>();
  const f = vi.fn<typeof fetch>().mockImplementation(async (entrada, init) => {
    const url = String(entrada);
    const metodo = init?.method ?? "GET";
    const corpo: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    pedidos.push({ url, metodo, corpo, auth: new Headers(init?.headers).get("authorization") });
    const chave = `${metodo} ${url}`;
    for (const [padrao, r] of sobrescrever) if (chave.endsWith(padrao)) return r();
    const criar = (id: string, resposta: () => Response) => {
      if (criados.has(id)) return existe();
      criados.add(id);
      return resposta();
    };
    if (metodo === "POST" && url.endsWith("/v3/projects")) return criar("projeto", () => json({ name: "operations/cp.1", done: false }));
    if (metodo === "GET" && /\/v3\/projects\/[^/:]+$/.test(url)) return criados.has("projeto") ? json({ projectId: url.split("/").at(-1) }) : erroGoogle(403);
    if (metodo === "GET" && url.endsWith("/v3/operations/cp.1")) return json({ name: "operations/cp.1", done: ++consultasOp >= 2, response: {} });
    if (url.endsWith("/billingInfo")) {
      if (metodo === "PUT") {
        faturado = true;
        return json({ billingEnabled: true });
      }
      return json({ billingEnabled: faturado });
    }
    if (url.endsWith("/v1/billingAccounts")) return json({ billingAccounts: o.contas ?? [{ name: "billingAccounts/FECHADA", open: false }, { name: "billingAccounts/ABERTA-1", open: true }] });
    if (url.endsWith("services:batchEnable")) return criar("servicos", () => json({ name: "operations/acf.1", done: true }));
    if (url.endsWith("/global/networks")) return criar("rede", () => json({ name: "operation-rede", status: "RUNNING" }));
    if (url.endsWith("/global/operations/operation-rede")) return json({ name: "operation-rede", status: "DONE" });
    if (url.endsWith("/serviceAccounts")) return criar("conta", () => json({ email: EMAIL }));
    if (url.endsWith("/roles")) {
      const id = (corpo as { roleId: string }).roleId;
      return criar(`papel:${id}`, () => json({ name: `projects/${PROJETO}/roles/${id}` }));
    }
    if (url.endsWith(":getIamPolicy")) return json({ version: 3, etag: "BwX", bindings: politica });
    if (url.endsWith(":setIamPolicy")) {
      politica = (corpo as { policy: { bindings: Vinculo[] } }).policy.bindings;
      return json({ version: 3, bindings: politica });
    }
    if (metodo === "POST" && url.endsWith("/keys")) {
      const nome = `projects/${PROJETO}/serviceAccounts/${EMAIL}/keys/k${++numChave}`;
      chaves.push(nome);
      return json({ name: nome, privateKeyData: Buffer.from(CHAVE).toString("base64") });
    }
    if (metodo === "GET" && url.includes("/keys?keyTypes=USER_MANAGED")) return json({ keys: chaves.map((name) => ({ name, keyType: "USER_MANAGED" })) });
    if (metodo === "DELETE" && url.includes("/keys/")) {
      const nome = url.replace("https://iam.googleapis.com/v1/", "");
      if (!chaves.includes(nome)) return erroGoogle(404);
      chaves.splice(chaves.indexOf(nome), 1);
      return json({});
    }
    if (url.includes("/instances/")) return o.instancia === false ? erroGoogle(404) : json({ status: "RUNNING" });
    return erroGoogle(500);
  });
  return {
    f,
    pedidos,
    sobrescrever,
    politica: () => politica,
    criados,
    chaves,
    contar: (trecho: string, metodo = "POST") => pedidos.filter((p) => p.metodo === metodo && p.url.includes(trecho)).length,
  };
}

const conta = (g: ReturnType<typeof googleFalso>, extra: { contaFaturamento?: string | null } = {}) =>
  criarContaGcp({ fetchImpl: g.f, aleatorioHex: () => "beef", esperar: async () => {}, ...extra });

describe("nuvem: preparo da conta GCP", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prepara do zero com o token da pessoa e devolve a chave decodificada", async () => {
    const g = googleFalso();
    const r = await conta(g).preparar({ pessoaId: PESSOA, tokenAcesso: "ya29.pessoa" });
    expect(r).toEqual({ projeto: PROJETO, contaServico: EMAIL, chaveJson: CHAVE, chaveNome: `projects/${PROJETO}/serviceAccounts/${EMAIL}/keys/k1` });
    expect(g.pedidos.every((p) => p.auth === "Bearer ya29.pessoa")).toBe(true);
    expect(g.contar("/v3/operations/cp.1", "GET")).toBe(2);
    expect(g.pedidos.find((p) => p.metodo === "PUT")?.corpo).toEqual({ billingAccountName: "billingAccounts/ABERTA-1" });
    expect(g.pedidos.find((p) => p.url.endsWith("services:batchEnable"))?.corpo).toEqual({ serviceIds: ["compute.googleapis.com", "iam.googleapis.com"] });
    expect(g.pedidos.find((p) => p.url.endsWith("/global/networks"))?.corpo).toEqual({ name: "nod-maquinas", autoCreateSubnetworks: true });
    expect(g.pedidos.find((p) => p.url.endsWith("/serviceAccounts"))?.corpo).toMatchObject({ accountId: `nod-${HASH8}` });
    const papeis = g.pedidos.filter((p) => p.url.endsWith("/roles")).map((p) => p.corpo as { roleId: string; role: { includedPermissions: string[] } });
    expect(papeis.map((p) => p.roleId)).toEqual(["nodMaquinasGerenciar", "nodMaquinasLigar", "nodMaquinasLer"]);
    expect(papeis[0]?.role.includedPermissions).toEqual([...PERMISSOES_DOS_PAPEIS.nodMaquinasGerenciar]);
    expect(g.pedidos.find((p) => p.url.endsWith(":getIamPolicy"))?.corpo).toEqual({ options: { requestedPolicyVersion: 3 } });
    const set = g.pedidos.find((p) => p.url.endsWith(":setIamPolicy"))?.corpo as { policy: { version: number } };
    expect(set.policy.version).toBe(3);
    expect(g.politica()).toEqual([
      { role: `projects/${PROJETO}/roles/nodMaquinasGerenciar`, members: [`serviceAccount:${EMAIL}`], condition: { title: "nod gerenciar", expression: condicaoGerenciarProjeto(PROJETO) } },
      { role: `projects/${PROJETO}/roles/nodMaquinasLer`, members: [`serviceAccount:${EMAIL}`], condition: { title: "nod ler", expression: condicaoLerProjeto(PROJETO) } },
    ]);
    expect(g.pedidos.find((p) => p.metodo === "POST" && p.url.endsWith("/keys"))?.url).toBe(`https://iam.googleapis.com/v1/projects/${PROJETO}/serviceAccounts/${encodeURIComponent(EMAIL)}/keys`);
  });

  it("é idempotente: refeito, cada passo recebe 409 e segue; a política não ganha vínculo duplicado", async () => {
    const g = googleFalso();
    const c = conta(g);
    await c.preparar({ pessoaId: PESSOA, tokenAcesso: "t" });
    const politica = g.politica();
    // A segunda vez o projeto já é da pessoa (409 + GET ok) e todo o resto já existe.
    const r = await c.preparar({ pessoaId: PESSOA, tokenAcesso: "t" });
    expect(r.projeto).toBe(PROJETO);
    expect(g.contar(":setIamPolicy")).toBe(1);
    expect(g.politica()).toEqual(politica);
    expect(g.contar("/billingInfo", "PUT")).toBe(1);
    // Com o projeto informado, nem tenta criar.
    await c.preparar({ pessoaId: PESSOA, tokenAcesso: "t", projetoExistente: PROJETO });
    expect(g.pedidos.filter((p) => p.metodo === "POST" && p.url.endsWith("/v3/projects"))).toHaveLength(2);
  });

  it("id de projeto ocupado por outra pessoa: tenta outro nome", async () => {
    const g = googleFalso();
    const nomes = ["aaaa", "bbbb"];
    g.sobrescrever.set(`POST https://cloudresourcemanager.googleapis.com/v3/projects`, () => (nomes.length === 1 ? existe() : json({ name: "operations/cp.1", done: true })));
    g.sobrescrever.set(`GET https://cloudresourcemanager.googleapis.com/v3/projects/nod-0b7c2f6e-aaaa`, () => erroGoogle(403));
    const c = criarContaGcp({ fetchImpl: g.f, aleatorioHex: () => nomes.shift() ?? "zzzz", esperar: async () => {} });
    expect((await c.preparar({ pessoaId: PESSOA, tokenAcesso: "t" })).projeto).toBe("nod-0b7c2f6e-bbbb");
  });

  it("sem conta de faturamento aberta: cota_ou_cobranca/sem_faturamento", async () => {
    const g = googleFalso({ contas: [{ name: "billingAccounts/X", open: false }] });
    await expect(conta(g).preparar({ pessoaId: PESSOA, tokenAcesso: "t" })).rejects.toMatchObject({ motivo: "cota_ou_cobranca", detalhe: "sem_faturamento" });
    // A conta informada é usada sem listar.
    const h = googleFalso({ contas: [] });
    await conta(h, { contaFaturamento: "0000-1111" }).preparar({ pessoaId: PESSOA, tokenAcesso: "t" });
    expect(h.pedidos.find((p) => p.metodo === "PUT")?.corpo).toEqual({ billingAccountName: "billingAccounts/0000-1111" });
    expect(h.contar("/v1/billingAccounts", "GET")).toBe(0);
  });

  it("organização que bloqueia chave: credencial_nuvem/org_bloqueia_chave", async () => {
    const g = googleFalso();
    g.sobrescrever.set("/keys", () => erroGoogle(400, { status: "FAILED_PRECONDITION" }));
    await expect(conta(g).preparar({ pessoaId: PESSOA, tokenAcesso: "t" })).rejects.toMatchObject({ motivo: "credencial_nuvem", detalhe: "org_bloqueia_chave" });
  });

  it("B2/item 12: 400 genérico na criação de chave não é a organização; 412 ou a constraint nomeada é", async () => {
    const g = googleFalso();
    g.sobrescrever.set("POST https://iam.googleapis.com/v1/projects/" + PROJETO + "/serviceAccounts/" + encodeURIComponent(EMAIL) + "/keys", () => erroGoogle(400, { status: "INVALID_ARGUMENT" }));
    await expect(conta(g).preparar({ pessoaId: PESSOA, tokenAcesso: "t" })).rejects.toMatchObject({ motivo: "credencial_nuvem", detalhe: null });
    for (const r of [() => erroGoogle(412), () => erroGoogle(400, { message: "constraints/iam.disableServiceAccountKeyCreation" })]) {
      const h = googleFalso();
      h.sobrescrever.set("/keys", r);
      await expect(conta(h).preparar({ pessoaId: PESSOA, tokenAcesso: "t" })).rejects.toMatchObject({ detalhe: "org_bloqueia_chave" });
    }
  });

  it("B2: apagarOutrasChaves apaga as chaves do usuário menos a mantida; 404 no meio não quebra", async () => {
    const g = googleFalso();
    const c = conta(g);
    await c.preparar({ pessoaId: PESSOA, tokenAcesso: "t" });
    const nova = await c.preparar({ pessoaId: PESSOA, tokenAcesso: "t", projetoExistente: PROJETO });
    g.chaves.push(`projects/${PROJETO}/serviceAccounts/${EMAIL}/keys/sumiu`);
    g.sobrescrever.set("/keys/sumiu", () => erroGoogle(404));
    const apagadas = await c.apagarOutrasChaves({ tokenAcesso: "t", projeto: PROJETO, contaServico: EMAIL, manter: nova.chaveNome });
    expect(apagadas).toBe(1);
    expect(g.chaves.filter((k) => !k.endsWith("/sumiu"))).toEqual([nova.chaveNome]);
    expect(g.pedidos.filter((p) => p.metodo === "DELETE").map((p) => p.url.split("/keys/")[1]).sort()).toEqual(["k1", "sumiu"]);
    // Erro que não é 404 sobe classificado (a rota registra e segue; a chave nova já está gravada).
    g.sobrescrever.set(`/keys/${nova.chaveNome.split("/").at(-1)}`, () => erroGoogle(403));
    const outra = await c.preparar({ pessoaId: PESSOA, tokenAcesso: "t", projetoExistente: PROJETO });
    await expect(c.apagarOutrasChaves({ tokenAcesso: "t", projeto: PROJETO, contaServico: EMAIL, manter: outra.chaveNome })).rejects.toMatchObject({ motivo: "credencial_nuvem" });
  });

  it("operação que não termina vira transitório; erro HTTP passa pela classificação", async () => {
    const g = googleFalso();
    g.sobrescrever.set("/v3/operations/cp.1", () => json({ done: false }));
    await expect(conta(g).preparar({ pessoaId: PESSOA, tokenAcesso: "t" })).rejects.toBeInstanceOf(ErroNuvemTransitorio);
    const h = googleFalso();
    h.sobrescrever.set("services:batchEnable", () => erroGoogle(403));
    await expect(conta(h).preparar({ pessoaId: PESSOA, tokenAcesso: "t", projetoExistente: PROJETO })).rejects.toMatchObject({ motivo: "credencial_nuvem" });
  });

  it("autorizarInstancia acrescenta o papel de ligar com a condição da VM, sem duplicar", async () => {
    const ref: RefInstancia = { projeto: PROJETO, zona: "us-central1-a", nome: "minha-vm" };
    const existente: Vinculo = { role: "roles/owner", members: ["user:dona@x.com"] };
    const g = googleFalso({ politica: [existente] });
    const c = conta(g);
    const p = { tokenAcesso: "t", projeto: PROJETO, contaServico: EMAIL, ref };
    await c.autorizarInstancia(p);
    await c.autorizarInstancia(p);
    expect(g.contar(":setIamPolicy")).toBe(1);
    expect(g.politica()).toEqual([existente, { role: `projects/${PROJETO}/roles/nodMaquinasLigar`, members: [`serviceAccount:${EMAIL}`], condition: { title: "nod ligar minha-vm", expression: condicaoLigar(ref) } }]);
    expect(g.pedidos[0]).toMatchObject({ metodo: "GET", url: `https://compute.googleapis.com/compute/v1/projects/${PROJETO}/zones/us-central1-a/instances/minha-vm` });
  });

  it("autorizarInstancia de VM que não existe: excluida, sem tocar na política", async () => {
    const g = googleFalso({ instancia: false });
    const ref: RefInstancia = { projeto: PROJETO, zona: "us-central1-a", nome: "sumiu" };
    await expect(conta(g).autorizarInstancia({ tokenAcesso: "t", projeto: PROJETO, contaServico: EMAIL, ref })).rejects.toMatchObject({ motivo: "excluida" });
    expect(g.contar(":getIamPolicy")).toBe(0);
  });
});

describe("domínio: condicaoGerenciarProjeto", () => {
  it("vale para qualquer zona do projeto e só para instâncias e discos com o prefixo do nod", () => {
    const c = condicaoGerenciarProjeto("p1");
    expect(c).toBe(
      `resource.name.startsWith("projects/p1/zones/") && (resource.name.extract("/instances/{nome}").startsWith("${PREFIXO_INSTANCIA_NOD}") || resource.name.extract("/disks/{nome}").startsWith("${PREFIXO_INSTANCIA_NOD}"))`,
    );
  });
});
