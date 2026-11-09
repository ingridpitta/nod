import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * NOD-298: o módulo de `urlDoModulo` (o `import.meta.url` de quem chama) é o script que o Node mandou rodar?
 * Compara pelo caminho real dos dois lados: o Node já resolve o link no `import.meta.url`, mas o `process.argv[1]`
 * chega cru (no macOS, `$TMPDIR` fica em `/var`, link para `/private/var`). Comparar cru fazia o proxy sair 0 sem
 * responder e o hook das nativas não decidir nada. Sem `argv1`, ou se o caminho não existe, é falso.
 */
export function ehPontoDeEntrada(urlDoModulo: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(urlDoModulo));
  } catch {
    return false;
  }
}
