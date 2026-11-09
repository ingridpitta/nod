import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * ADA-242 (ADR-157 §4): "Já vi a tela Este computador" mora no app, por máquina (um arquivo na pasta do app), não no
 * servidor: outra máquina da mesma pessoa mostra a tela de novo, e uma reinstalação limpa também.
 */
export type PonteEsteComputador = { jaViu(): Promise<boolean>; marcar(): Promise<void> };

const ARQUIVO = "este-computador.json";

export function esteComputadorEm(pasta: string): PonteEsteComputador {
  const caminho = join(pasta, ARQUIVO);
  return {
    async jaViu() {
      try {
        const o = JSON.parse(await readFile(caminho, "utf8")) as { visto?: unknown };
        return o.visto === true;
      } catch {
        return false;
      }
    },
    async marcar() {
      await mkdir(pasta, { recursive: true });
      await writeFile(caminho, JSON.stringify({ visto: true, em: new Date().toISOString() }), "utf8");
    },
  };
}
