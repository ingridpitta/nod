import { lstat, realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { CAMINHO_MIDIA_MAX } from "../src/contracts/midia-desktop.ts";
import { caminhoRecusado } from "../src/domain/arquivo-do-mac.ts";

/**
 * NOD-323 (J5, ADR-126): resolve o caminho relativo à `~/nod` que a PÁGINA mandou (dado de fora) para o arquivo real,
 * ou null. As mesmas regras do anexar_midia: string curta sem `..`, sem absoluto, sem `~`, sem NUL; o 1º segmento é a
 * pasta do bot; o realpath tem de ficar dentro do realpath de `~/nod/<pasta>`; nunca credencial; só arquivo regular.
 */
export async function arquivoDaMidia(caminhoRelativo: unknown, home: string): Promise<string | null> {
  if (typeof caminhoRelativo !== "string" || !caminhoRelativo || caminhoRelativo.length > CAMINHO_MIDIA_MAX) return null;
  if (caminhoRelativo.includes("\0") || caminhoRelativo.includes("\\") || caminhoRelativo.startsWith("/") || caminhoRelativo.startsWith("~")) return null;
  const segs = caminhoRelativo.split("/");
  if (segs.length < 2 || segs.some((s) => s === "" || s === "." || s === "..")) return null;
  if (caminhoRecusado(caminhoRelativo)) return null;
  // A raiz é a pasta de um bot: nunca uma oculta (`.clones`, `.cache`), e nunca um symlink (lstat) que a leve para fora.
  if (segs[0]!.startsWith(".")) return null;
  const nod = join(home, "nod");
  const alvo = resolve(nod, ...segs);
  if (caminhoRecusado(alvo)) return null;
  try {
    if (!(await lstat(join(nod, segs[0]!))).isDirectory()) return null;
    const raiz = await realpath(join(nod, segs[0]!));
    const real = await realpath(alvo);
    if (!real.startsWith(raiz + sep) || caminhoRecusado(real)) return null;
    return (await stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}
