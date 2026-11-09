/**
 * Chave de idempotência do envio (definido em 2026-10-06, NOD-156): uma por fala, criada no compositor e não dentro
 * de `api.enviar`. Se a resposta se perde e a pessoa manda a MESMA fala de novo (mesmo texto e mesmos anexos), a
 * chave pendente é reusada e o servidor devolve a mensagem já gravada. Depois de um envio que deu certo, a próxima
 * fala ganha chave nova, mesmo com o mesmo texto. Com um envio em voo na conversa, outro é ignorado (Enter + botão).
 */
type Pendente = { chave: string; assinatura: string };

export type Envios = {
  /**
   * A chave deste envio, ou `null` se já há um em voo nesta conversa. `respondeA` (ADR-113) entra na assinatura: a mesma
   * fala com outra citação (ou sem a que tinha) é outra mensagem, e o servidor não pode devolver a gravada antes.
   */
  iniciar(conversaId: string, texto: string, anexos: readonly string[], respondeA?: string, chave?: string): string | null;
  /** Fecha o envio em voo; com `ok`, a chave pendente some e a próxima fala ganha outra. */
  concluir(conversaId: string, ok: boolean): void;
};

export function criarEnvios(gerar: () => string = () => crypto.randomUUID()): Envios {
  const pendentes = new Map<string, Pendente>();
  const emVoo = new Set<string>();
  return {
    iniciar(conversaId, texto, anexos, respondeA, dada) {
      if (emVoo.has(conversaId)) return null;
      const assinatura = JSON.stringify([texto, [...anexos], respondeA ?? null]);
      const anterior = pendentes.get(conversaId);
      // `dada` (revisão do PR do pensamento no chat, 27/10): o "Tentar de novo" da fala pendente manda a chave que ela já
      // tem — a de cá só lembra a última fala da conversa, e outra fala no meio trocaria a chave e gravaria a primeira
      // de novo se o POST tinha chegado ao servidor.
      const chave = dada ?? (anterior && anterior.assinatura === assinatura ? anterior.chave : gerar());
      pendentes.set(conversaId, { chave, assinatura });
      emVoo.add(conversaId);
      return chave;
    },
    concluir(conversaId, ok) {
      emVoo.delete(conversaId);
      if (ok) pendentes.delete(conversaId);
    },
  };
}

/**
 * Um envio por vez para `alvo` (definido em 2026-10-08, revisão W3): com outro em voo para o mesmo alvo, `enviar` não
 * roda e a volta é `false`. É a trava do chat para quem não leva chave de idempotência (o campo da tela da task:
 * `POST trabalhos/:id/mensagens` não aceita `idEnvio`).
 */
export async function enviarUmaVez(envios: Envios, alvo: string, texto: string, enviar: (idEnvio: string) => Promise<unknown>): Promise<boolean> {
  const idEnvio = envios.iniciar(alvo, texto, []);
  if (idEnvio === null) return false;
  let ok = false;
  try {
    await enviar(idEnvio);
    ok = true;
  } finally {
    envios.concluir(alvo, ok);
  }
  return true;
}

/**
 * O corpo do POST conversas/:id/mensagens: `anexos`, `idEnvio` e `respondeA` só entram quando existem (cliente antigo =
 * só texto). `respondeA` (ADR-113) leva só o id da fala citada: o trecho é do servidor.
 */
export function corpoDoEnvio(texto: string, anexos: readonly string[] = [], idEnvio?: string, respondeA?: string): { texto: string; anexos?: readonly string[]; idEnvio?: string; respondeA?: { mensagemId: string } } {
  return { texto, ...(anexos.length ? { anexos } : {}), ...(idEnvio ? { idEnvio } : {}), ...(respondeA ? { respondeA: { mensagemId: respondeA } } : {}) };
}
