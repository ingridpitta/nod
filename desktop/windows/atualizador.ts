import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { UpdaterDoApp } from "../atualizacao.ts";

/**
 * ADA-229 (ADR-152, item 7): o updater do Windows, sem electron-updater. Cumpre o mesmo `UpdaterDoApp` do Squirrel.Mac,
 * então o coordenador de desktop/atualizacao.ts (prazos, menu, reinício) é o mesmo. O feed é o do servidor
 * (`?plataforma=windows&arch=x64`): 204 = em dia; 200 = `{url, name, sha256}`. Baixa o .exe por https, confere o sha256
 * antes de gravar o nome final e, no reinício, roda o NSIS com `/S --updated --force-run` num processo destacado e sai do app.
 * Rede, disco e processo são injetados (tests/unit/desktop/windows/atualizador.test.ts).
 */
export type AnuncioWindows = { url: string; versao: string; sha256: string };

/**
 * O host do .exe: a URL assinada do Cloud Storage (src/adapters/atualizacao-app/assinador-gcs.ts). O sha256 vem na mesma
 * resposta do feed, então ele só prova a integridade; prender o host impede que um feed adulterado mande baixar e rodar um
 * .exe de qualquer lugar (codex #1). A assinatura Authenticode entra com a NOD-471.
 */
export const HOST_DO_DOWNLOAD = "storage.googleapis.com";

/** O corpo do 200: só https no host do Cloud Storage, versão curta e sha256 hexadecimal. Torto = null (vira erro, nunca download). */
export function lerAnuncio(bruto: unknown): AnuncioWindows | null {
  if (typeof bruto !== "object" || bruto === null) return null;
  const { url, name, sha256 } = bruto as Record<string, unknown>;
  if (typeof url !== "string" || typeof name !== "string" || typeof sha256 !== "string") return null;
  if (!/^[0-9a-f]{64}$/i.test(sha256) || !/^[0-9A-Za-z.+-]{1,32}$/.test(name)) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.host !== HOST_DO_DOWNLOAD || u.username || u.password) return null;
  } catch { return null; }
  return { url, versao: name, sha256: sha256.toLowerCase() };
}

export type DepsAtualizadorWindows = {
  fetchImpl?: typeof fetch;
  /** Grava o .exe: recebe os pedaços e devolve o caminho final, só depois de o hash conferir (ver `baixarConferindo`). */
  gravar(nome: string, pedacos: AsyncIterable<Uint8Array>, sha256: string): Promise<string>;
  /** Roda o instalador destacado (`exe /S --updated --force-run`) e sai do app. */
  instalar(exe: string): void;
};

/** Conta o sha256 enquanto passa os pedaços adiante; no fim, `hash()` devolve o hex (antes do fim, lança). */
export function contarHash(fonte: AsyncIterable<Uint8Array>): { pedacos: AsyncIterable<Uint8Array>; hash(): string } {
  const h = createHash("sha256");
  let fim: string | null = null;
  return {
    pedacos: (async function* () {
      for await (const p of fonte) { h.update(p); yield p; }
      fim = h.digest("hex");
    })(),
    hash: () => { if (fim === null) throw new Error("download_incompleto"); return fim; },
  };
}

type Ouvintes = { [k: string]: ((...a: unknown[]) => void)[] };

export function criarAtualizadorWindows(d: DepsAtualizadorWindows): UpdaterDoApp {
  const ouvintes: Ouvintes = {};
  let feed: { url: string; headers: Record<string, string> } | null = null;
  let baixado: string | null = null;
  const emitir = (ev: string, ...a: unknown[]) => { for (const f of ouvintes[ev] ?? []) f(...a); };
  const f = d.fetchImpl ?? fetch;

  async function procurar(alvo: { url: string; headers: Record<string, string> }) {
    emitir("checking-for-update");
    const r = await f(alvo.url, { headers: alvo.headers, redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (r.status === 204) { emitir("update-not-available"); return; }
    if (r.status !== 200) throw new Error(`feed respondeu ${r.status}`);
    const anuncio = lerAnuncio(await r.json().catch(() => null));
    if (!anuncio) throw new Error("feed com anúncio inválido");
    emitir("update-available");
    // A URL assinada leva ao bucket (outro host): sem a chave da máquina, e sem seguir redirecionamento.
    const exe = await f(anuncio.url, { redirect: "error", signal: AbortSignal.timeout(25 * 60_000) });
    if (!exe.ok || !exe.body) throw new Error(`download respondeu ${exe.status}`);
    const caminho = await d.gravar(`nod-${anuncio.versao}-win-x64.exe`, exe.body as unknown as AsyncIterable<Uint8Array>, anuncio.sha256);
    baixado = caminho;
    emitir("update-downloaded", {}, "", anuncio.versao);
  }

  return {
    setFeedURL(o) { feed = { url: o.url, headers: { ...(o.headers ?? {}) } }; },
    checkForUpdates() {
      const alvo = feed;
      if (!alvo) { emitir("error", new Error("sem feed")); return; }
      void procurar(alvo).catch((e: unknown) => emitir("error", e instanceof Error ? e : new Error(String(e))));
    },
    quitAndInstall() {
      if (!baixado) throw new Error("nada baixado");
      d.instalar(baixado);
    },
    on: ((ev: string, fn: (...a: unknown[]) => void) => { (ouvintes[ev] ??= []).push(fn); }) as UpdaterDoApp["on"],
  };
}

/**
 * Os argumentos do NSIS do electron-builder na atualização (os mesmos do NsisUpdater): silencioso, `--updated` (mantém
 * os atalhos e a pasta) e `--force-run` (reabre o app no fim; o silencioso sozinho não abre).
 */
export const ARGS_DO_INSTALADOR = ["/S", "--updated", "--force-run"] as const;

/**
 * O `gravar` de verdade: escreve num temporário da pasta, confere o sha256 e só então dá o nome final. Hash diferente
 * apaga o temporário e lança (o coordenador mostra o erro; nada fica para instalar).
 */
export function gravadorConferindo(pasta: string): DepsAtualizadorWindows["gravar"] {
  return async (nome, pedacos, sha256) => {
    if (!/^nod-[0-9A-Za-z.+-]{1,32}-win-x64\.exe$/.test(nome)) throw new Error("nome inválido");
    await mkdir(pasta, { recursive: true });
    const tmp = join(pasta, `.baixando-${randomBytes(6).toString("hex")}`);
    const contado = contarHash(pedacos);
    try {
      await pipeline(Readable.from(contado.pedacos), createWriteStream(tmp, { mode: 0o600 }));
      if (contado.hash() !== sha256.toLowerCase()) throw new Error("sha256 do instalador não confere");
      const final = join(pasta, nome);
      await rename(tmp, final);
      return final;
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  };
}
