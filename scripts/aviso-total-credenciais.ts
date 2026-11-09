import { fileURLToPath } from "node:url";
import { paraCadaPessoa } from "../src/adapters/fundo/escopos-de-fundo.ts";
import { criarDb } from "../src/db/client.ts";
import { log } from "../src/obs/log.ts";
import { criarRepos } from "../src/repositories/index.ts";
import { avisarTotalCredenciais, type ContagemDoAviso } from "../src/use-cases/aviso-total-credenciais.ts";

/**
 * definido em 2026-10-19 (plano dos modos de aprovação, PR 6; decisão 3 do Marlon, 18/10): os bots que já estão em
 * "Ignorar todas as aprovações" passam à regra nova no deploy (o total usa as credenciais do Mac sem pedir), e a conversa
 * de cada um ganha uma linha dizendo isso (`avisarTotalCredenciais`).
 *
 *   node scripts/aviso-total-credenciais.ts --seco   # só conta (transação só de leitura)
 *   node scripts/aviso-total-credenciais.ts          # grava
 *
 * Roda no deploy (infra/gcp/vm/deploy.sh, depois de o servidor novo ficar saudável) e pode rodar de novo à vontade:
 * idempotente por bot (a linha já escrita não se repete; o bot posto no total depois do deploy não ganha a linha, porque a
 * troca de modo já disse a regra nova). Pessoa por pessoa (paraCadaPessoa, nod_app com RLS), uma transação por pessoa.
 * Imprime só contagens, nunca texto de conversa. Uma pessoa que falha não impede as outras (o log diz quem).
 */
export async function rodarAviso(db: Parameters<typeof paraCadaPessoa>[0], opcoes: { seco: boolean }): Promise<ContagemDoAviso & { pessoas: number; falhas: number }> {
  const total = { avisados: 0, jaAvisados: 0, ligadosDepois: 0, semConversa: 0, pessoas: 0, falhas: 0 };
  await paraCadaPessoa(
    db,
    async (escopo, tx) => {
      total.pessoas += 1;
      const c = await tx(async (trx) => {
        if (opcoes.seco) await trx`set local transaction_read_only = on`;
        return avisarTotalCredenciais({ repos: criarRepos(trx, escopo), escopo, agora: Date.now }, { seco: opcoes.seco });
      });
      total.avisados += c.avisados;
      total.jaAvisados += c.jaAvisados;
      total.ligadosDepois += c.ligadosDepois;
      total.semConversa += c.semConversa;
    },
    {
      aoFalhar: (escopo, erro) => {
        total.falhas += 1;
        log("erro", "aviso_total_credenciais_falhou", { tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId, erro: erro instanceof Error ? erro.name : "desconhecido" });
      },
      sortearInicio: () => 0,
    },
  );
  return total;
}

async function principal(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // sem .env: variáveis vêm do ambiente
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    log("erro", "aviso_total_credenciais_sem_url", { variavel: "DATABASE_URL" });
    process.exit(1);
  }
  const seco = process.argv.includes("--seco");
  const db = criarDb(url, { max: 1 });
  try {
    const t = await rodarAviso(db, { seco });
    log("info", "aviso_total_credenciais", { seco, pessoas: t.pessoas, avisados: t.avisados, ja_avisados: t.jaAvisados, ligados_depois: t.ligadosDepois, sem_conversa: t.semConversa, falhas: t.falhas });
    if (t.falhas > 0) process.exitCode = 1;
  } finally {
    await db.end({ timeout: 2 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await principal();
