import { log } from "../../obs/log.ts";

/**
 * Porta de e-mail da conta (NOD-345, ADR-124 §4): verificação por código e recuperação por link. Três drivers:
 *  - Resend (produção): HTTPS direto, sem SDK; remetente do domínio nodbot.ai (NOD_EMAIL_REMETENTE);
 *  - caixa local (NOD_LOGIN=stub): guarda em memória e o `GET /api/dev/caixa` mostra, só em loopback;
 *  - memória (testes): o mesmo da caixa, lido direto pelo teste.
 * O corpo do e-mail leva o código/link; o LOG nunca: só o tipo e o resultado.
 */
import type { EmailConta } from "../../domain/email-conta.ts";

export type { EmailConta };

export interface EnviadorEmail {
  enviar(e: EmailConta): Promise<void>;
}

export type CaixaLocal = EnviadorEmail & { mensagens: (EmailConta & { em: number })[] };

/** Caixa em memória (testes e desenvolvimento). Guarda as 50 últimas. */
export function caixaLocal(): CaixaLocal {
  const mensagens: (EmailConta & { em: number })[] = [];
  return {
    mensagens,
    async enviar(e) {
      mensagens.push({ ...e, em: Date.now() });
      if (mensagens.length > 50) mensagens.shift();
    },
  };
}

/** definido em 2026-10-23: o mesmo teto de 5 s dos outros fornecedores HTTP do nod. */
const TIMEOUT_RESEND_MS = 5_000;

export function enviadorResend(p: { chave: string; remetente: string; fetchImpl?: typeof fetch; url?: string }): EnviadorEmail {
  const f = p.fetchImpl ?? fetch;
  return {
    async enviar(e) {
      const r = await f(p.url ?? "https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${p.chave}`, "content-type": "application/json" },
        body: JSON.stringify({ from: p.remetente, to: [e.para], subject: e.assunto, text: e.texto, html: e.html }),
        signal: AbortSignal.timeout(TIMEOUT_RESEND_MS),
      });
      if (!r.ok) {
        // Nada do corpo do Resend vai para o log (pode ecoar o destinatário).
        log("erro", "email_conta_falhou", { tipo: e.tipo, status: r.status });
        throw new Error(`resend ${r.status}`);
      }
      log("info", "email_conta_enviado", { tipo: e.tipo });
    },
  };
}
