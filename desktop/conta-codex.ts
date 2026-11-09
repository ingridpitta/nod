import type { ContaDaIa } from "../src/contracts/estado-ia.ts";
import { contaDoAccountRead, notificacaoInitialized, pedidoAccountRead, pedidoInitialize } from "../src/domain/codex-app-server.ts";
import { criarClienteAppServer } from "../src/adapters/executor/drivers/cliente-app-server.ts";

/** definido em 2026-10-12 (NOD-209): prazo do app-server que só pergunta a conta (medido no Codex 0.162.1: responde em ~1 s). */
export const PRAZO_CONTA_CODEX_MS = 10_000;

/**
 * QUAL conta está logada no Codex (NOD-209): `initialize` → `initialized` → `account/read` num `codex app-server` curto,
 * sem chamar modelo nem ler `~/.codex/auth.json`. O processo é sempre encerrado no fim — respondeu, deu erro, saiu
 * sozinho ou estourou o prazo.
 *
 * revisto em 2026-10-12 (revisão do PR #266): separa "respondeu sem conta" (null: deslogado ou login por chave, que não
 * tem e-mail) de "não respondeu" (undefined: prazo, erro do protocolo, processo que caiu). A impressão do login usa a
 * diferença para não mudar só porque o app-server falhou uma vez (ia-mac.ts, textoDaImpressaoComConta).
 */
export async function contaDoCodex(o: { bin: string; env: Record<string, string>; cwd: string; versao: string; prazoMs?: number; sigtermParaSigkillMs?: number }): Promise<ContaDaIa | null | undefined> {
  let cliente: ReturnType<typeof criarClienteAppServer>;
  try {
    cliente = criarClienteAppServer({ bin: o.bin, args: ["app-server"], env: o.env, cwd: o.cwd, sigtermParaSigkillMs: o.sigtermParaSigkillMs, aoEvento: () => undefined, aoTurnoConcluido: () => undefined });
  } catch {
    return undefined;
  }
  let prazo: ReturnType<typeof setTimeout> | null = null;
  try {
    const ler = async (): Promise<ContaDaIa | null> => {
      await cliente.pedir((id) => pedidoInitialize(id, { nome: "nod", versao: o.versao }));
      cliente.processo.escrever(notificacaoInitialized());
      return contaDoAccountRead(await cliente.pedir(pedidoAccountRead));
    };
    const estourou = new Promise<undefined>((resolver) => { prazo = setTimeout(() => resolver(undefined), o.prazoMs ?? PRAZO_CONTA_CODEX_MS); });
    const saiu = cliente.processo.fim.then(() => undefined, () => undefined);
    return await Promise.race([ler().catch(() => undefined), estourou, saiu]);
  } finally {
    if (prazo) clearTimeout(prazo);
    cliente.fechar();
    // Sem esperar o SIGKILL (até 5 s): quem chama já tem a resposta; o grupo do processo morre de qualquer jeito.
    void cliente.processo.interromper().catch(() => undefined);
  }
}
