import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lerSha256 } from "./download.ts";

/**
 * definido em 2026-10-24 (NOD-93, revisão do #516; ADR-123 nota ADR-100, ADR-127 §8): de onde vem o disco da VM e
 * como o app sabe que ele é o certo. São duas fontes separadas:
 *
 *   o sha256  → embutido no app, em `<Resources>/vm-local/disco.sha256` (o `desktop-release` grava o do disco que o
 *               job `vm-local` construiu, por scripts/vm-local/digest-do-disco.ts). Assinado e notarizado com o app;
 *               nunca vem da mesma origem do disco.
 *   o disco   → `NOD_VM_DISCO_URL` (só `https:`), padrão a pasta da versão no bucket público de downloads
 *               (`nodbot-downloads`, o mesmo dos DMGs do site). Definido em 2026-11-04 (release 1.0.0-rc.3): o release
 *               do repo não serve, o repo é privado e o app baixa sem login. Uma origem trocada não passa do sha256
 *               embutido.
 *
 * Sem o sha256 embutido (build sem `NOD_VM_LOCAL=1`) ou com a URL inválida, o preparo vai a `falhou` com o motivo.
 */

export const ARQUIVO_DIGEST = "disco.sha256";

export const URL_DISCO_PADRAO = (versao: string) => `https://storage.googleapis.com/nodbot-downloads/v${versao}`;

export type OrigemDoDisco = { urlBase: string; sha256: string } | { erro: string };

/** A base da URL do disco, sem a barra do fim. Só `https:`: http, file e afins são recusados. */
export function urlBaseDoDisco(valor: string | undefined, versao: string): { urlBase: string } | { erro: string } {
  const bruto = valor?.trim() || URL_DISCO_PADRAO(versao);
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return { erro: `NOD_VM_DISCO_URL inválida: ${bruto}` };
  }
  if (url.protocol !== "https:") return { erro: `NOD_VM_DISCO_URL precisa ser https (veio ${url.protocol.replace(/:$/, "")})` };
  return { urlBase: bruto.replace(/\/+$/, "") };
}

/** O sha256 do disco `nome` que veio no app; null se o app saiu sem ele ou ele é de outro disco. */
export function digestEmbutido(recursos: string, nome: string, ler: (caminho: string) => string = (c) => readFileSync(c, "utf8")): string | null {
  try {
    return lerSha256(ler(join(recursos, "vm-local", ARQUIVO_DIGEST)), nome);
  } catch {
    return null;
  }
}

export function origemDoDisco(o: { ambiente: Record<string, string | undefined>; versao: string; recursos: string; nome: string; ler?: (caminho: string) => string }): OrigemDoDisco {
  const url = urlBaseDoDisco(o.ambiente.NOD_VM_DISCO_URL, o.versao);
  if ("erro" in url) return url;
  const sha256 = digestEmbutido(o.recursos, o.nome, o.ler);
  if (!sha256) return { erro: `o app saiu sem o sha256 de ${o.nome} (vm-local/${ARQUIVO_DIGEST})` };
  return { urlBase: url.urlBase, sha256 };
}
