import { execFile } from "node:child_process";
import { ErroDeDominio } from "../../domain/erro.ts";
import { log } from "../../obs/log.ts";

/**
 * Token OAuth do Google para a voz (definido em 2026-10-04, ADR-071).
 * - Na VM (`NODE_ENV=production`): metadata server, conta de serviço padrão da VM. Nada de chave em arquivo.
 * - Em dev: `gcloud auth print-access-token` (execFile, sem shell), a conta com que a pessoa logou no gcloud.
 * O token nunca vai para log. `NOD_VOZ_PROJETO` é o projeto GCP cobrado (`x-goog-user-project`) e o do modelo da Live.
 */
export const URL_METADATA_TOKEN = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

/** definido em 2026-10-04: renova 60 s antes de expirar (um pedido em voo nunca leva token vencido). */
export const MARGEM_RENOVACAO_MS = 60_000;
/**
 * definido em 2026-10-04: o `gcloud print-access-token` não diz quando o token vence (ele devolve o token que já tem em
 * cache, que pode estar no fim da hora). Assumimos 10 min de validade e pedimos de novo depois disso.
 */
export const VALIDADE_GCLOUD_MS = 10 * 60_000;
const TIMEOUT_METADATA_MS = 3_000;
const TIMEOUT_GCLOUD_MS = 15_000;

export type FonteTokenGoogle = {
  readonly origem: "metadata" | "gcloud";
  /** Projeto GCP (`NOD_VOZ_PROJETO`); null quando não configurado (na VM, o projeto da conta de serviço vale). */
  readonly projeto: string | null;
  token(): Promise<string>;
};

export type ExecFileTexto = (bin: string, args: readonly string[], opcoes: { timeout: number }) => Promise<string>;

const execFileTexto: ExecFileTexto = (bin, args, opcoes) =>
  new Promise((resolver, rejeitar) => {
    execFile(bin, [...args], { timeout: opcoes.timeout, encoding: "utf8", shell: false }, (erro, stdout) => {
      if (erro) rejeitar(erro);
      else resolver(stdout);
    });
  });

export type OpcoesFonteToken = {
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  execFileImpl?: ExecFileTexto;
  agora?: () => number;
  /** Força a origem; o padrão segue `NODE_ENV`. */
  origem?: "metadata" | "gcloud";
};

export function criarFonteDeToken(o: OpcoesFonteToken): FonteTokenGoogle {
  const fetchImpl = o.fetchImpl ?? fetch;
  const exec = o.execFileImpl ?? execFileTexto;
  const agora = o.agora ?? Date.now;
  const origem = o.origem ?? (o.env.NODE_ENV === "production" ? "metadata" : "gcloud");
  const projeto = o.env.NOD_VOZ_PROJETO?.trim() || null;
  let cache: { token: string; expiraEm: number } | null = null;
  let emVoo: Promise<string> | null = null;

  async function doMetadata(): Promise<{ token: string; expiraEm: number }> {
    let r: Response;
    try {
      r = await fetchImpl(URL_METADATA_TOKEN, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(TIMEOUT_METADATA_MS) });
    } catch (e) {
      throw new ErroDeDominio("integracao_nao_configurada", { cause: e });
    }
    if (!r.ok) throw new ErroDeDominio("integracao_autenticacao", { cause: new Error(`metadata ${r.status}`) });
    const corpo: unknown = await r.json();
    if (typeof corpo !== "object" || corpo === null) throw new ErroDeDominio("integracao_autenticacao");
    const token = "access_token" in corpo && typeof corpo.access_token === "string" ? corpo.access_token : "";
    const expiraS = "expires_in" in corpo && typeof corpo.expires_in === "number" ? corpo.expires_in : 0;
    if (!token || expiraS <= 0) throw new ErroDeDominio("integracao_autenticacao");
    return { token, expiraEm: agora() + expiraS * 1000 };
  }

  async function doGcloud(): Promise<{ token: string; expiraEm: number }> {
    let saida: string;
    try {
      saida = await exec(o.env.NOD_VOZ_GCLOUD_BIN || "gcloud", ["auth", "print-access-token"], { timeout: TIMEOUT_GCLOUD_MS });
    } catch (e) {
      const semBinario = typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT";
      throw new ErroDeDominio(semBinario ? "integracao_nao_configurada" : "integracao_autenticacao", { cause: e });
    }
    const token = saida.trim();
    if (!token || /\s/.test(token)) throw new ErroDeDominio("integracao_autenticacao");
    return { token, expiraEm: agora() + VALIDADE_GCLOUD_MS };
  }

  return {
    origem,
    projeto,
    async token() {
      if (cache && agora() < cache.expiraEm - MARGEM_RENOVACAO_MS) return cache.token;
      if (emVoo) return emVoo;
      emVoo = (async () => {
        try {
          cache = await (origem === "metadata" ? doMetadata() : doGcloud());
          return cache.token;
        } catch (e) {
          log("aviso", "voz_token_falhou", { origem, codigo: e instanceof ErroDeDominio ? e.codigo : "desconhecido" });
          throw e;
        } finally {
          emVoo = null;
        }
      })();
      return emVoo;
    },
  };
}
