import { compararVersoesDoApp, versaoDoAppValida } from "./versao-app.ts";

/**
 * NOD-132 (ADR-149): o feed da atualização do app do Mac. Só anuncia uma versão ESTRITAMENTE maior que a instalada,
 * sempre da mesma arquitetura (o app x64 recebe x64, mesmo no Rosetta). Nunca há downgrade: uma versão ruim se corrige
 * publicando outra mais nova. Versão inválida (instalada ou publicada) não anuncia nada — falha fechado.
 */
export const ARQUITETURAS_DO_APP = ["arm64", "x64"] as const;
export type ArquiteturaDoApp = (typeof ARQUITETURAS_DO_APP)[number];

export function arquiteturaDoApp(valor: unknown): ArquiteturaDoApp | null {
  return ARQUITETURAS_DO_APP.find((a) => a === valor) ?? null;
}

/** ADA-229 (ADR-152): o app do Windows usa o mesmo feed com `plataforma=windows`; só x64 por ora. */
export const PLATAFORMAS_DO_APP = ["mac", "windows"] as const;
export type PlataformaDoApp = (typeof PLATAFORMAS_DO_APP)[number];

/** Ausente = mac (o app do Mac não manda o parâmetro). Valor desconhecido = null (400). */
export function plataformaDoApp(valor: unknown): PlataformaDoApp | null {
  if (valor === null || valor === undefined || valor === "") return "mac";
  return PLATAFORMAS_DO_APP.find((p) => p === valor) ?? null;
}

export type DecisaoAtualizacaoApp = { anunciar: false } | { anunciar: true; versao: string; objeto: string; sha256: string };

/** O nome do ZIP no bucket: `<versao>/nod-<versao>-mac-<arch>.zip` (o `artifactName` do electron-builder.yml). */
export function objetoDoZip(versao: string, arch: ArquiteturaDoApp): string {
  return `${versao}/nod-${versao}-mac-${arch}.zip`;
}

/** O instalador NSIS no bucket: `<versao>/nod-<versao>-win-x64.exe`. */
export function objetoDoExe(versao: string): string {
  return `${versao}/nod-${versao}-win-x64.exe`;
}

/**
 * `config` null = desligada. O `sha256` vai no feed para o Squirrel.Mac que o confere (a partir do commit c4a95b0c); o do
 * Electron 43 (0e5d146b) ainda o ignora, e a defesa real hoje é a assinatura de código (Team 5FFF5696N4). O hash
 * obrigatório também prende o anúncio ao ZIP que o script de publicação conferiu.
 */
export function decidirAtualizacaoDoApp(e: { atual: unknown; config: ConfigAtualizacaoApp; arch: ArquiteturaDoApp; plataforma?: PlataformaDoApp }): DecisaoAtualizacaoApp {
  if (!e.config) return { anunciar: false };
  const c = compararVersoesDoApp(e.config.versao, e.atual);
  if (c === null || c <= 0) return { anunciar: false };
  if (e.plataforma === "windows") {
    // Sem o hash do .exe a versão não saiu para o Windows: nada a oferecer (seguro por padrão). Só x64 é publicado.
    const sha = e.config.sha256["win-x64"];
    if (!sha || e.arch !== "x64") return { anunciar: false };
    return { anunciar: true, versao: e.config.versao, objeto: objetoDoExe(e.config.versao), sha256: sha };
  }
  return { anunciar: true, versao: e.config.versao, objeto: objetoDoZip(e.config.versao, e.arch), sha256: e.config.sha256[e.arch] };
}

export type Sha256DoApp = Record<ArquiteturaDoApp, string> & { "win-x64"?: string };
export type ConfigAtualizacaoApp = { versao: string; bucket: string; sha256: Sha256DoApp } | null;

const SHA256 = /^[0-9a-f]{64}$/;

/** `arm64=<hex>,x64=<hex>[,win-x64=<hex>]` (a linha que scripts/desktop/publicar-atualizacao.sh imprime): as duas do Mac e, opcional, o .exe. */
function lerSha256(texto: string): Sha256DoApp {
  const pares = new Map<string, string>();
  for (const parte of texto.split(",")) {
    const [arch, hex, ...resto] = parte.trim().split("=");
    const chave = arch?.trim();
    const a = chave === "win-x64" ? chave : arquiteturaDoApp(chave);
    const h = hex?.trim().toLowerCase() ?? "";
    if (!a || resto.length || !SHA256.test(h) || pares.has(a)) throw new Error("NOD_APP_ATUALIZACAO_SHA256 fora de arm64=<sha256>,x64=<sha256>[,win-x64=<sha256>]");
    pares.set(a, h);
  }
  const arm64 = pares.get("arm64");
  const x64 = pares.get("x64");
  if (!arm64 || !x64) throw new Error("NOD_APP_ATUALIZACAO_SHA256 exige arm64 e x64");
  const win = pares.get("win-x64");
  return win ? { arm64, x64, "win-x64": win } : { arm64, x64 };
}

/** Nome de bucket do Cloud Storage (3 a 63 caracteres; minúsculas, dígitos, `-`, `_` e `.`; começa e termina alfanumérico). */
const BUCKET = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;

/**
 * A flag da atualização do app (config.env → deploy.sh → env do servidor). Versão vazia = desligada: o feed responde 204
 * a todo app (o bucket pode ficar preenchido). Versão sem bucket ou sem o SHA-256 dos dois ZIPs, versão fora de x.y.z[-rc.N] ou bucket inválido = erro
 * de configuração: o boot recusa subir, como as outras flags (a cor nova nunca fica saudável e a velha segue atendendo).
 */
export function lerConfigAtualizacaoApp(env: Readonly<Record<string, string | undefined>>): ConfigAtualizacaoApp {
  const versao = env.NOD_APP_VERSAO_PUBLICADA?.trim() ?? "";
  const bucket = env.NOD_APP_ATUALIZACAO_BUCKET?.trim() ?? "";
  const sha256 = env.NOD_APP_ATUALIZACAO_SHA256?.trim() ?? "";
  if (!versao) return null;
  if (!bucket) throw new Error("NOD_APP_VERSAO_PUBLICADA exige NOD_APP_ATUALIZACAO_BUCKET");
  if (!versaoDoAppValida(versao)) throw new Error("NOD_APP_VERSAO_PUBLICADA fora de x.y.z ou x.y.z-rc.N");
  if (!BUCKET.test(bucket)) throw new Error("NOD_APP_ATUALIZACAO_BUCKET não é um nome de bucket válido");
  if (!sha256) throw new Error("NOD_APP_VERSAO_PUBLICADA exige NOD_APP_ATUALIZACAO_SHA256");
  return { versao, bucket, sha256: lerSha256(sha256) };
}
