import { createHash } from "node:crypto";
import type { FonteTokenGoogle } from "../voz/token-google.ts";

/**
 * NOD-132 (ADR-149): URL assinada V4 de um objeto num bucket privado do Cloud Storage, sem chave privada no servidor e
 * sem biblioteca nova. A VM assina pela API IAM Credentials (`signBlob`) como a própria conta de serviço — exige
 * `iam.serviceAccounts.signBlob` dela sobre ela mesma (o papel custom `nodAssinarBlob`) e `roles/storage.objectViewer` no bucket
 * (docs/release-desktop.md). Referência do formato: cloud.google.com/storage/docs/access-control/signing-urls-manually.
 * O token e a assinatura nunca vão para log; quem chama só loga o código do erro.
 */
export const HOST_GCS = "storage.googleapis.com";
/** definido em 2026-11-04: a URL vale 10 min — o Squirrel começa o download logo depois de ler o feed. */
export const VALIDADE_URL_S = 600;
export const URL_METADATA_EMAIL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email";
const TIMEOUT_MS = 5_000;

export type AssinadorDeUrl = (objeto: string) => Promise<string>;

/** definido em 2026-11-04: a mesma URL serve por 3 min (sobram 7 dos 10 para o download), um `signBlob` por objeto nesse tempo. */
export const CACHE_URL_MS = 3 * 60_000;

/**
 * Reaproveita a URL assinada de cada objeto por `CACHE_URL_MS`: um app em laço de reconexão (abaixo da mínima, cada
 * 426 procura de novo) ou a frota inteira procurando junto não viram uma chamada à IAM por pedido. Falha não fica em
 * cache: o pedido seguinte tenta de novo.
 */
export function cachearAssinador(assinar: AssinadorDeUrl, o: { agora?: () => number; validadeMs?: number } = {}): AssinadorDeUrl {
  const agora = o.agora ?? Date.now;
  const validade = o.validadeMs ?? CACHE_URL_MS;
  const cache = new Map<string, { ate: number; url: Promise<string> }>();
  return (objeto) => {
    const t = agora();
    const viva = cache.get(objeto);
    if (viva && viva.ate > t) return viva.url;
    const url = assinar(objeto);
    cache.set(objeto, { ate: t + validade, url });
    url.catch(() => { if (cache.get(objeto)?.url === url) cache.delete(objeto); });
    return url;
  };
}

/** RFC 3986: o encodeURIComponent deixa `!'()*` sem codificar, e a assinatura V4 exige que vão codificados. */
export function codificar(texto: string): string {
  return encodeURIComponent(texto).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function carimbo(ms: number): { data: string; instante: string } {
  const iso = new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { data: iso.slice(0, 8), instante: iso };
}

/** A parte pura: a URL sem a assinatura e o texto que a conta de serviço assina. Exportada para o teste do formato. */
export function prepararAssinatura(o: { bucket: string; objeto: string; conta: string; agora: number; validadeS?: number }): { base: string; consulta: string; textoParaAssinar: string } {
  const { data, instante } = carimbo(o.agora);
  const escopo = `${data}/auto/storage/goog4_request`;
  const caminho = `/${codificar(o.bucket)}/${o.objeto.split("/").map(codificar).join("/")}`;
  const params: [string, string][] = [
    ["X-Goog-Algorithm", "GOOG4-RSA-SHA256"],
    ["X-Goog-Credential", `${o.conta}/${escopo}`],
    ["X-Goog-Date", instante],
    ["X-Goog-Expires", String(o.validadeS ?? VALIDADE_URL_S)],
    ["X-Goog-SignedHeaders", "host"],
  ];
  const consulta = params.map(([k, v]) => [codificar(k), codificar(v)]).sort(([a], [b]) => (a! < b! ? -1 : a! > b! ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
  const pedidoCanonico = ["GET", caminho, consulta, `host:${HOST_GCS}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const textoParaAssinar = ["GOOG4-RSA-SHA256", instante, escopo, createHash("sha256").update(pedidoCanonico).digest("hex")].join("\n");
  return { base: `https://${HOST_GCS}${caminho}`, consulta, textoParaAssinar };
}

export function criarAssinadorGcs(o: {
  bucket: string;
  fonteToken: Pick<FonteTokenGoogle, "token">;
  /** O e-mail da conta de serviço; ausente = o da VM, lido do metadata server (uma vez). */
  conta?: string;
  fetchImpl?: typeof fetch;
  agora?: () => number;
}): AssinadorDeUrl {
  const fetchImpl = o.fetchImpl ?? fetch;
  const agora = o.agora ?? Date.now;
  let conta: Promise<string> | null = o.conta ? Promise.resolve(o.conta) : null;

  function contaDaVm(): Promise<string> {
    conta ??= (async () => {
      const r = await fetchImpl(URL_METADATA_EMAIL, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const email = r.ok ? (await r.text()).trim() : "";
      if (!/^[^\s@/]+@[^\s@/]+$/.test(email)) throw new Error(`metadata_email_${r.status}`);
      return email;
    })().catch((e: unknown) => { conta = null; throw e; });
    return conta;
  }

  return async (objeto) => {
    const email = await contaDaVm();
    const p = prepararAssinatura({ bucket: o.bucket, objeto, conta: email, agora: agora() });
    const token = await o.fonteToken.token();
    const r = await fetchImpl(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(email)}:signBlob`, {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ payload: Buffer.from(p.textoParaAssinar, "utf8").toString("base64") }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`sign_blob_${r.status}`);
    const corpo: unknown = await r.json();
    const assinado = typeof corpo === "object" && corpo !== null && "signedBlob" in corpo && typeof corpo.signedBlob === "string" ? corpo.signedBlob : "";
    if (!assinado) throw new Error("sign_blob_vazio");
    return `${p.base}?${p.consulta}&X-Goog-Signature=${Buffer.from(assinado, "base64").toString("hex")}`;
  };
}
