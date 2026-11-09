import { createSign } from "node:crypto";
import type { CriarInstancia, EstadoInstancia, ProvedorNuvem, RefInstancia } from "../../contracts/provedor-nuvem.ts";
import { classificarErroNuvem, ErroNuvemLancado, ErroNuvemTransitorio } from "../../domain/maquina-nuvem.ts";
import { log } from "../../obs/log.ts";

/**
 * ADR-121 (NOD-92): o provedor do Google. Fala com a Compute Engine REST v1 como a conta de serviço do projeto da pessoa
 * (a chave JSON que o preparo criou). Não espera a operação terminar: o reconciliador consulta o estado na volta seguinte.
 * A chave e o token nunca saem daqui: nem em log, nem em mensagem de erro (o erro lançado leva só o motivo fechado).
 */

export const URL_TOKEN_GOOGLE = "https://oauth2.googleapis.com/token";
export const ESCOPO_CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";
export const URL_COMPUTE = "https://compute.googleapis.com/compute/v1";
// definido em 2026-10-22 (plano da NOD-92): o token do Google vale 1 h; guardamos 50 min para nunca usar um vencido.
export const VALIDADE_TOKEN_MS = 50 * 60_000;
// definido em 2026-10-22 (plano da NOD-92): teto de cada chamada ao Google; estourou, é transitório.
export const PRAZO_CHAMADA_MS = 10_000;

const IMAGEM_BOOT = "projects/debian-cloud/global/images/family/debian-12";
const DISCO_GB = "30";
const TIPO_POR_TAMANHO = { padrao: "e2-standard-8", menor: "e2-standard-4" } as const;

/** Resposta lida de uma chamada ao Google: o corpo já em JSON (ou null quando não é JSON). */
export type RespostaGoogle = { status: number; corpo: unknown };

/**
 * Uma chamada ao Google com prazo. Rede que falha (ou prazo estourado) vira `ErroNuvemTransitorio`; o status volta para
 * quem chamou decidir (404 e 409 têm sentido diferente em cada operação).
 */
export async function chamarGoogle(fetchImpl: typeof fetch, token: string, metodo: string, url: string, corpo?: unknown): Promise<RespostaGoogle> {
  let r: Response;
  try {
    r = await fetchImpl(url, {
      method: metodo,
      headers: { authorization: `Bearer ${token}`, ...(corpo === undefined ? {} : { "content-type": "application/json" }) },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      signal: AbortSignal.timeout(PRAZO_CHAMADA_MS),
    });
  } catch (e) {
    log("aviso", "nuvem_gcp_rede_falhou", { metodo, erro: e instanceof Error ? e.name : "desconhecido" });
    throw new ErroNuvemTransitorio();
  }
  return { status: r.status, corpo: await lerJson(r) };
}

async function lerJson(r: Response): Promise<unknown> {
  try {
    const texto = await r.text();
    return texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
}

/** Lança o erro classificado da resposta (nunca a mensagem do Google). */
export function lancarErroGoogle(r: RespostaGoogle, operacao?: "criar_chave"): never {
  const c = classificarErroNuvem(r.status, r.corpo, operacao);
  if (c === "transitorio") throw new ErroNuvemTransitorio();
  throw new ErroNuvemLancado(c);
}

export const ok = (status: number) => status >= 200 && status < 300;

type ChaveDeServico = { email: string; chavePrivada: string };

function lerChave(chaveJson: string): ChaveDeServico {
  let dado: unknown;
  try {
    dado = JSON.parse(chaveJson);
  } catch {
    throw new ErroNuvemLancado({ motivo: "credencial_nuvem", detalhe: "chave_invalida" });
  }
  if (typeof dado !== "object" || dado === null) throw new ErroNuvemLancado({ motivo: "credencial_nuvem", detalhe: "chave_invalida" });
  const email = "client_email" in dado ? dado.client_email : undefined;
  const chavePrivada = "private_key" in dado ? dado.private_key : undefined;
  if (typeof email !== "string" || !email || typeof chavePrivada !== "string" || !chavePrivada) {
    throw new ErroNuvemLancado({ motivo: "credencial_nuvem", detalhe: "chave_invalida" });
  }
  return { email, chavePrivada };
}

const base64url = (s: string) => Buffer.from(s).toString("base64url");

/** O JWT RS256 que a conta de serviço troca por um token (fluxo jwt-bearer do OAuth do Google). */
function assinarJwt(chave: ChaveDeServico, agoraMs: number): string {
  const iat = Math.floor(agoraMs / 1000);
  const cabecalho = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = base64url(JSON.stringify({ iss: chave.email, scope: ESCOPO_CLOUD_PLATFORM, aud: URL_TOKEN_GOOGLE, iat, exp: iat + 3600 }));
  const entrada = `${cabecalho}.${corpo}`;
  try {
    const assinatura = createSign("RSA-SHA256").update(entrada).sign(chave.chavePrivada).toString("base64url");
    return `${entrada}.${assinatura}`;
  } catch {
    throw new ErroNuvemLancado({ motivo: "credencial_nuvem", detalhe: "chave_invalida" });
  }
}

/** Mapa do `status` da instância na Compute para o estado do nod. Status desconhecido conta como em transição. */
export function estadoDoStatus(status: unknown): EstadoInstancia {
  switch (status) {
    case "RUNNING":
      return "rodando";
    case "STOPPING":
    case "SUSPENDING":
      return "parando";
    case "TERMINATED":
    case "STOPPED":
    case "SUSPENDED":
      return "parada";
    default:
      return "provisionando";
  }
}

const urlInstancia = (ref: RefInstancia) =>
  `${URL_COMPUTE}/projects/${encodeURIComponent(ref.projeto)}/zones/${encodeURIComponent(ref.zona)}/instances/${encodeURIComponent(ref.nome)}`;

/** O corpo do `instances.insert`: sem conta de serviço na VM (ela não fala com o Google), só o script de partida. */
export function corpoDaCriacao(req: CriarInstancia): Record<string, unknown> {
  return {
    name: req.nome,
    machineType: `zones/${req.zona}/machineTypes/${TIPO_POR_TAMANHO[req.tamanho]}`,
    disks: [
      {
        boot: true,
        autoDelete: true,
        initializeParams: { sourceImage: IMAGEM_BOOT, diskSizeGb: DISCO_GB, diskType: `zones/${req.zona}/diskTypes/pd-balanced` },
      },
    ],
    networkInterfaces: [{ subnetwork: req.subrede, accessConfigs: [{ type: "ONE_TO_ONE_NAT", name: "External NAT" }] }],
    serviceAccounts: [],
    labels: { "nod-maquina": req.maquinaNuvemId },
    metadata: { items: [{ key: "startup-script", value: req.startupScript }] },
  };
}

export function criarProvedorGcp(p: { chaveJson: string; fetchImpl?: typeof fetch; agora?: () => number }): ProvedorNuvem {
  const fetchImpl = p.fetchImpl ?? fetch;
  const agora = p.agora ?? Date.now;
  let cache: { token: string; obtidoEm: number } | null = null;
  let emVoo: Promise<string> | null = null;

  async function trocarToken(): Promise<string> {
    const chave = lerChave(p.chaveJson);
    const corpo = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: assinarJwt(chave, agora()) });
    let r: Response;
    try {
      r = await fetchImpl(URL_TOKEN_GOOGLE, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: corpo.toString(),
        signal: AbortSignal.timeout(PRAZO_CHAMADA_MS),
      });
    } catch (e) {
      log("aviso", "nuvem_gcp_token_falhou", { status: 0, erro: e instanceof Error ? e.name : "desconhecido" });
      throw new ErroNuvemTransitorio();
    }
    const resposta = await lerJson(r);
    if (!r.ok) {
      log("aviso", "nuvem_gcp_token_falhou", { status: r.status });
      if (r.status === 429 || r.status >= 500) throw new ErroNuvemTransitorio();
      throw new ErroNuvemLancado({ motivo: "credencial_nuvem", detalhe: "token_recusado" });
    }
    const token = typeof resposta === "object" && resposta !== null && "access_token" in resposta ? resposta.access_token : undefined;
    if (typeof token !== "string" || !token) throw new ErroNuvemLancado({ motivo: "credencial_nuvem", detalhe: "token_recusado" });
    return token;
  }

  async function obterToken(): Promise<string> {
    if (cache && agora() - cache.obtidoEm < VALIDADE_TOKEN_MS) return cache.token;
    if (emVoo) return emVoo;
    emVoo = (async () => {
      try {
        const obtidoEm = agora();
        const token = await trocarToken();
        cache = { token, obtidoEm };
        return token;
      } finally {
        emVoo = null;
      }
    })();
    return emVoo;
  }

  async function chamar(metodo: string, url: string, corpo?: unknown): Promise<RespostaGoogle> {
    const r = await chamarGoogle(fetchImpl, await obterToken(), metodo, url, corpo);
    // Token recusado (chave revogada, por exemplo): a próxima chamada troca de novo em vez de reusar o mesmo.
    if (r.status === 401) cache = null;
    return r;
  }

  async function acao(ref: RefInstancia, verbo: "start" | "stop" | "reset"): Promise<void> {
    const r = await chamar("POST", `${urlInstancia(ref)}/${verbo}`);
    if (!ok(r.status)) lancarErroGoogle(r);
  }

  return {
    async estado(ref) {
      const r = await chamar("GET", urlInstancia(ref));
      if (r.status === 404) return "inexistente";
      if (!ok(r.status)) lancarErroGoogle(r);
      const status = typeof r.corpo === "object" && r.corpo !== null && "status" in r.corpo ? r.corpo.status : undefined;
      return estadoDoStatus(status);
    },
    ligar: (ref) => acao(ref, "start"),
    desligar: (ref) => acao(ref, "stop"),
    reiniciar: (ref) => acao(ref, "reset"),
    async excluir(ref) {
      const r = await chamar("DELETE", urlInstancia(ref));
      if (r.status === 404 || ok(r.status)) return;
      lancarErroGoogle(r);
    },
    async definirScript(ref, script) {
      // setMetadata exige o fingerprint atual (concorrência otimista do Google): lê a instância e troca só o startup-script.
      const g = await chamar("GET", urlInstancia(ref));
      if (!ok(g.status)) lancarErroGoogle(g);
      const meta = (g.corpo as { metadata?: { fingerprint?: string; items?: { key: string; value?: string }[] } } | null)?.metadata ?? {};
      const items = [...(meta.items ?? []).filter((i) => i.key !== "startup-script"), { key: "startup-script", value: script }];
      const r = await chamar("POST", `${urlInstancia(ref)}/setMetadata`, { fingerprint: meta.fingerprint, items });
      if (!ok(r.status)) lancarErroGoogle(r);
    },
    async criar(req, requestId) {
      const url = `${URL_COMPUTE}/projects/${encodeURIComponent(req.projeto)}/zones/${encodeURIComponent(req.zona)}/instances?requestId=${encodeURIComponent(requestId)}`;
      const r = await chamar("POST", url, corpoDaCriacao(req));
      // 409 = a instância já existe (nova tentativa da mesma criação): sucesso.
      if (r.status === 409 || ok(r.status)) return;
      lancarErroGoogle(r);
    },
  };
}
