import { describe } from "vitest";

/**
 * Auto-skip para quem está sem Docker; ERRO sob CI (Práticas §6): um CI verde e vazio não é
 * ausência de prova, é prova falsa — os invariantes pulados seriam RLS e trilha LGPD.
 * `CI=1 npx vitest run --project integration` sem DATABASE_URL_TEST falha com a mensagem abaixo.
 */
export function describeIntegracao(nome: string, fn: () => void): void {
  if (process.env.DATABASE_URL_TEST) {
    describe(nome, fn);
    return;
  }
  if (process.env.CI) {
    throw new Error("DATABASE_URL_TEST ausente sob CI: a suíte de integração não pode ser pulada no CI");
  }
  describe.skip(nome, fn);
}
