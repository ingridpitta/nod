import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { criarProvedorGcp, URL_TOKEN_GOOGLE, VALIDADE_TOKEN_MS } from "../../src/adapters/nuvem/gcp.ts";
import type { CriarInstancia, RefInstancia } from "../../src/contracts/provedor-nuvem.ts";
import { ErroNuvemLancado, ErroNuvemTransitorio } from "../../src/domain/maquina-nuvem.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const CHAVE_JSON = JSON.stringify({ type: "service_account", client_email: "nod-1234abcd@proj.iam.gserviceaccount.com", private_key: PEM });
const REF: RefInstancia = { projeto: "proj", zona: "us-central1-a", nome: "nod-g-um" };
const URL_INSTANCIA = "https://compute.googleapis.com/compute/v1/projects/proj/zones/us-central1-a/instances/nod-g-um";

type Pedido = { url: string; metodo: string; corpo: string; auth: string | null };
type Rota = (p: Pedido) => Response;

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const erroGoogle = (status: number, reason: string) => json({ error: { code: status, message: "segredo do google", errors: [{ reason }] } }, status);

/** fetch falso: o token sai sempre; o resto vem da `rota`. Guarda os pedidos. */
function fetchFalso(rota: Rota, token: (n: number) => Response = (n) => json({ access_token: `tok-${n}`, expires_in: 3600 })) {
  const pedidos: Pedido[] = [];
  let tokens = 0;
  const f = vi.fn<typeof fetch>().mockImplementation(async (entrada, init) => {
    const headers = new Headers(init?.headers);
    const p: Pedido = { url: String(entrada), metodo: init?.method ?? "GET", corpo: typeof init?.body === "string" ? init.body : "", auth: headers.get("authorization") };
    pedidos.push(p);
    if (p.url === URL_TOKEN_GOOGLE) return token(++tokens);
    return rota(p);
  });
  return { f, pedidos, tokens: () => pedidos.filter((p) => p.url === URL_TOKEN_GOOGLE) };
}

describe("nuvem: provedor GCP", () => {
  let saidaLog: MockInstance;
  beforeEach(() => {
    saidaLog = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("troca um JWT RS256 assinado pela chave e mapeia o status da instância", async () => {
    let status = "RUNNING";
    const { f, pedidos } = fetchFalso(() => json({ status }));
    const prov = criarProvedorGcp({ chaveJson: CHAVE_JSON, fetchImpl: f });
    const casos: [string, string][] = [
      ["PROVISIONING", "provisionando"],
      ["STAGING", "provisionando"],
      ["RUNNING", "rodando"],
      ["STOPPING", "parando"],
      ["SUSPENDING", "parando"],
      ["TERMINATED", "parada"],
      ["STOPPED", "parada"],
      ["SUSPENDED", "parada"],
    ];
    for (const [s, esperado] of casos) {
      status = s;
      expect(await prov.estado(REF)).toBe(esperado);
    }
    const troca = pedidos[0] ?? { url: "", corpo: "" };
    expect(troca.url).toBe(URL_TOKEN_GOOGLE);
    const form = new URLSearchParams(troca.corpo);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [cab = "", corpo = "", assinatura = ""] = (form.get("assertion") ?? "").split(".");
    expect(JSON.parse(Buffer.from(cab, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(corpo, "base64url").toString());
    expect(claims).toMatchObject({ iss: "nod-1234abcd@proj.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/cloud-platform", aud: URL_TOKEN_GOOGLE });
    expect(createVerify("RSA-SHA256").update(`${cab}.${corpo}`).verify(publicKey, Buffer.from(assinatura, "base64url"))).toBe(true);
    expect(pedidos[1]).toMatchObject({ url: URL_INSTANCIA, metodo: "GET", auth: "Bearer tok-1" });
  });

  it("404 no estado é 'inexistente', sem lançar; 404 no excluir é sucesso", async () => {
    const { f } = fetchFalso(() => erroGoogle(404, "notFound"));
    const prov = criarProvedorGcp({ chaveJson: CHAVE_JSON, fetchImpl: f });
    expect(await prov.estado(REF)).toBe("inexistente");
    await expect(prov.excluir(REF)).resolves.toBeUndefined();
  });

  it("ligar, desligar e reiniciar fazem POST em start, stop e reset; excluir faz DELETE", async () => {
    const { f, pedidos } = fetchFalso(() => json({ name: "operation-1" }));
    const prov = criarProvedorGcp({ chaveJson: CHAVE_JSON, fetchImpl: f });
    await prov.ligar(REF);
    await prov.desligar(REF);
    await prov.reiniciar(REF);
    await prov.excluir(REF);
    const chamadas = pedidos.filter((p) => p.url !== URL_TOKEN_GOOGLE).map((p) => `${p.metodo} ${p.url.replace(URL_INSTANCIA, "")}`);
    expect(chamadas).toEqual(["POST /start", "POST /stop", "POST /reset", "DELETE "]);
  });

  it("criar manda requestId, sem conta de serviço na VM e com o startup-script; 409 conta como sucesso", async () => {
    const { f, pedidos } = fetchFalso(() => erroGoogle(409, "alreadyExists"));
    const prov = criarProvedorGcp({ chaveJson: CHAVE_JSON, fetchImpl: f });
    const req: CriarInstancia = { ...REF, subrede: "regions/us-central1/subnetworks/nod-maquinas", tamanho: "padrao", startupScript: "#!/bin/bash\necho oi", maquinaNuvemId: "3f0c2a8e-0000-4000-8000-000000000001" };
    await expect(prov.criar(req, "req-123")).resolves.toBeUndefined();
    const pedido = pedidos[1] ?? { url: "", corpo: "" };
    expect(pedido.url).toBe("https://compute.googleapis.com/compute/v1/projects/proj/zones/us-central1-a/instances?requestId=req-123");
    const corpo = JSON.parse(pedido.corpo);
    expect(corpo.serviceAccounts).toEqual([]);
    expect(corpo.metadata.items).toEqual([{ key: "startup-script", value: "#!/bin/bash\necho oi" }]);
    expect(corpo.machineType).toBe("zones/us-central1-a/machineTypes/e2-standard-8");
    expect(corpo.labels).toEqual({ "nod-maquina": "3f0c2a8e-0000-4000-8000-000000000001" });
    expect(corpo.networkInterfaces[0]).toEqual({ subnetwork: req.subrede, accessConfigs: [{ type: "ONE_TO_ONE_NAT", name: "External NAT" }] });
    expect(corpo.disks[0]).toMatchObject({ boot: true, autoDelete: true, initializeParams: { sourceImage: "projects/debian-cloud/global/images/family/debian-12", diskSizeGb: "30" } });
    await prov.criar({ ...req, tamanho: "menor" }, "req-124");
    expect(JSON.parse(pedidos[2]?.corpo ?? "").machineType).toBe("zones/us-central1-a/machineTypes/e2-standard-4");
  });

  it("reaproveita o token entre chamadas e renova depois de 50 min", async () => {
    let agora = 1_000_000;
    const { f, tokens, pedidos } = fetchFalso(() => json({ status: "RUNNING" }));
    const prov = criarProvedorGcp({ chaveJson: CHAVE_JSON, fetchImpl: f, agora: () => agora });
    await prov.estado(REF);
    await prov.ligar(REF);
    agora += VALIDADE_TOKEN_MS - 1;
    await prov.estado(REF);
    expect(tokens()).toHaveLength(1);
    agora += 1;
    await prov.estado(REF);
    expect(tokens()).toHaveLength(2);
    expect(pedidos.at(-1)?.auth).toBe("Bearer tok-2");
  });

  it("classifica: 503 e rede são transitórios; 403 é credencial; pool esgotado é sem_capacidade", async () => {
    const seq: (() => Response)[] = [() => erroGoogle(503, "backendError"), () => erroGoogle(403, "forbidden"), () => erroGoogle(400, "ZONE_RESOURCE_POOL_EXHAUSTED")];
    const { f } = fetchFalso(() => (seq.shift() ?? (() => json({})))());
    const prov = criarProvedorGcp({ chaveJson: CHAVE_JSON, fetchImpl: f });
    await expect(prov.ligar(REF)).rejects.toBeInstanceOf(ErroNuvemTransitorio);
    await expect(prov.ligar(REF)).rejects.toMatchObject({ name: "ErroNuvemLancado", motivo: "credencial_nuvem" });
    await expect(prov.ligar(REF)).rejects.toMatchObject({ motivo: "sem_capacidade" });

    const rede = vi.fn<typeof fetch>().mockImplementation(async (u) => {
      if (String(u) === URL_TOKEN_GOOGLE) return json({ access_token: "t" });
      throw new TypeError("fetch failed");
    });
    await expect(criarProvedorGcp({ chaveJson: CHAVE_JSON, fetchImpl: rede }).estado(REF)).rejects.toBeInstanceOf(ErroNuvemTransitorio);
  });

  it("troca de token: 400/401 é credencial, 5xx e rede são transitórios; chave inválida é credencial", async () => {
    const com = (r: () => Response) => criarProvedorGcp({ chaveJson: CHAVE_JSON, fetchImpl: fetchFalso(() => json({}), r).f });
    await expect(com(() => json({ error: "invalid_grant" }, 400)).estado(REF)).rejects.toMatchObject({ motivo: "credencial_nuvem" });
    await expect(com(() => json({ error: "unauthorized_client" }, 401)).estado(REF)).rejects.toMatchObject({ motivo: "credencial_nuvem" });
    await expect(com(() => json({}, 502)).estado(REF)).rejects.toBeInstanceOf(ErroNuvemTransitorio);
    const rede = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    await expect(criarProvedorGcp({ chaveJson: CHAVE_JSON, fetchImpl: rede }).estado(REF)).rejects.toBeInstanceOf(ErroNuvemTransitorio);

    for (const ruim of ["não é json", JSON.stringify({ client_email: "x@y" }), JSON.stringify({ client_email: "x@y", private_key: "-----BEGIN PRIVATE KEY-----\nlixo\n-----END PRIVATE KEY-----\n" })]) {
      const f = vi.fn<typeof fetch>();
      await expect(criarProvedorGcp({ chaveJson: ruim, fetchImpl: f }).estado(REF)).rejects.toMatchObject({ motivo: "credencial_nuvem", detalhe: "chave_invalida" });
      expect(f).not.toHaveBeenCalled();
    }
  });

  it("a chave e o token nunca aparecem em mensagem de erro nem no log", async () => {
    const { f } = fetchFalso(() => erroGoogle(403, "forbidden"));
    const prov = criarProvedorGcp({ chaveJson: CHAVE_JSON, fetchImpl: f });
    const erro: unknown = await prov.estado(REF).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroNuvemLancado);
    const texto = JSON.stringify(erro) + String(erro) + (erro instanceof Error ? (erro.stack ?? "") : "");
    expect(texto).not.toContain("PRIVATE KEY");
    expect(texto).not.toContain("tok-1");
    expect(texto).not.toContain("segredo do google");

    const ruim = await criarProvedorGcp({ chaveJson: CHAVE_JSON.replace("BEGIN PRIVATE KEY-----\n", "BEGIN PRIVATE KEY-----\nxx"), fetchImpl: f })
      .estado(REF)
      .catch((e: unknown) => e);
    expect(ruim).toMatchObject({ motivo: "credencial_nuvem" });
    expect(String(ruim) + (ruim instanceof Error ? (ruim.stack ?? "") : "")).not.toContain("PRIVATE KEY");
    const logs = saidaLog.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logs).not.toContain("PRIVATE KEY");
    expect(logs).not.toContain("tok-");
  });
});
