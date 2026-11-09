import { MODELO_SONDA_PADRAO } from "../src/contracts/modelos.ts";
import { sondarDetalhado } from "../src/adapters/executor/sonda.ts";
import { log } from "../src/obs/log.ts";

/**
 * Sonda manual (ADR-019): `node scripts/sonda.ts` (ou `npx tsx scripts/sonda.ts`).
 * Lê NOD_CLAUDE_BIN (ausente = claude no PATH aumentado) e NOD_MODELO_SONDA (default MODELO_SONDA_PADRAO, Sonnet 4.6 desde a NOD-164),
 * roda `claude --version` + UM turno real de uma palavra com ambiente limpo (custa a assinatura da
 * pessoa: US$0,003–0,02 medido em 2026-09-16) e imprime o Inventario. Saída 0 = pronto, 1 = outro.
 *
 *   node scripts/sonda.ts                          → {estado:'pronto', versao:'2.1.272'}
 *   HOME=$(mktemp -d) node scripts/sonda.ts        → nao_autenticado (sem login nesse HOME)
 *   NOD_CLAUDE_BIN=/nao/existe node scripts/sonda.ts → ausente
 */
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: variáveis vêm do ambiente
}

const modelo = process.env.NOD_MODELO_SONDA ?? MODELO_SONDA_PADRAO;
const inicio = Date.now();
const s = await sondarDetalhado(process.env.NOD_CLAUDE_BIN, process.env, modelo);
const inv = s.inventario;
log("info", "sonda", {
  estado: inv.estado,
  versao: "versao" in inv ? (inv.versao ?? null) : null,
  motivo: "motivo" in inv ? inv.motivo : null,
  em: inv.em,
  binario: s.binario,
  flags_no_help: s.flagsNoHelp?.length ?? null,
  custo_usd: s.custoUsd,
  modelo,
  duracao_ms: Date.now() - inicio,
});
process.exit(inv.estado === "pronto" ? 0 : 1);
