// NOD-485 (ADR-161): junta a config privada da produção ao infra/gcp/config.env no deploy.yml.
//
//   NOD_CONFIG_PRIVADA="$(secret)" node scripts/ci/config-producao.ts infra/gcp/config.env
//
// O config.env do repo público traz as flags reais e os identificadores de EXEMPLO. O secret NOD_CONFIG_PRIVADA (linhas
// CHAVE=valor) traz os reais. Este script:
//   1. valida o secret (só CHAVE=valor, comentário ou linha vazia; as chaves obrigatórias presentes e sem valor de exemplo);
//   2. imprime ::add-mask:: de cada valor ANTES de qualquer outra saída (os logs do Actions são públicos);
//   3. acrescenta as linhas no fim do config.env (o `source` do deploy.sh fica com a última);
//   4. escreve as linhas CHAVE= do resultado no $GITHUB_ENV (também fica a última).
// Sai 1 com o secret ausente ou inválido, sem escrever nada.

import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const OBRIGATORIAS: readonly string[] = ["PROJETO", "REGISTRO", "SQL_IP", "NOD_ADMINS", "NOD_ADMISSAO_DOMINIOS", "NOD_APP_ATUALIZACAO_BUCKET"];
/** Valores que só existem no exemplo público: se um deles chega à produção, o secret está errado. */
const EXEMPLO = /nod-exemplos|exemplo\.com|^10\.0\.0\.3$/;
const LINHA = /^([A-Z][A-Z0-9_]*)=(.*)$/;
/** O valor como o `source` do bash o vê nos casos do config.env: sem as aspas de fora (duplas ou simples). */
export const semAspas = (v: string): string => v.replace(/^"(.*)"$|^'(.*)'$/, "$1$2");

/** Lê o secret. Devolve { linhas, valores } ou lança com a primeira linha culpada (sem ecoar o valor). */
export function lerConfigPrivada(texto: string): { linhas: string[]; valores: Map<string, string> } {
  if (!texto || !texto.trim()) throw new Error("NOD_CONFIG_PRIVADA ausente ou vazio no environment producao");
  const linhas: string[] = [];
  const valores = new Map<string, string>();
  for (const [i, bruta] of texto.replace(/\r/g, "").split("\n").entries()) {
    const l = bruta.trim();
    if (!l || l.startsWith("#")) continue;
    const m = LINHA.exec(l);
    if (!m) throw new Error(`NOD_CONFIG_PRIVADA linha ${i + 1}: esperado CHAVE=valor`);
    linhas.push(l);
    valores.set(m[1]!, semAspas(m[2]!));
  }
  for (const k of OBRIGATORIAS) {
    if (!valores.get(k)) throw new Error(`NOD_CONFIG_PRIVADA sem ${k}`);
    if (EXEMPLO.test(valores.get(k) ?? "")) throw new Error(`NOD_CONFIG_PRIVADA: ${k} está com valor de exemplo`);
  }
  return { linhas, valores };
}

/**
 * As linhas CHAVE=valor do config final para o $GITHUB_ENV, na ordem (a última de cada chave vence). O $GITHUB_ENV não
 * tira aspas como o `source`: `REGISTRO="x/y"` viraria uma tag de imagem com aspas. Por isso vai o valor sem elas.
 */
export function linhasDeAmbiente(config: string): string[] {
  return config.split("\n").flatMap((l) => {
    const m = LINHA.exec(l.trim());
    return m ? [`${m[1]}=${semAspas(m[2]!)}`] : [];
  });
}

/** Os valores a mascarar: cada valor não vazio e, para os compostos (a,b ou x/y), cada parte com 4+ caracteres. */
export function mascaras(valores: Map<string, string>): string[] {
  const s = new Set<string>();
  for (const v of valores.values()) {
    if (!v) continue;
    s.add(v);
    for (const parte of v.split(/[,/@\s]+/)) if (parte.length >= 4) s.add(parte);
  }
  return [...s];
}

function main(): void {
  const arquivo = process.argv[2];
  if (!arquivo) {
    process.stderr.write("uso: config-producao.ts <config.env>\n");
    process.exit(2);
  }
  let lido: ReturnType<typeof lerConfigPrivada>;
  try {
    lido = lerConfigPrivada(process.env.NOD_CONFIG_PRIVADA ?? "");
  } catch (e) {
    process.stdout.write(`::error::${(e as Error).message}\n`);
    process.exit(1);
  }
  for (const m of mascaras(lido.valores)) process.stdout.write(`::add-mask::${m}\n`);
  appendFileSync(arquivo, `\n# --- NOD_CONFIG_PRIVADA (deploy.yml, NOD-485) ---\n${lido.linhas.join("\n")}\n`);
  const env = process.env.GITHUB_ENV;
  if (env) appendFileSync(env, `${linhasDeAmbiente(readFileSync(arquivo, "utf8")).join("\n")}\n`);
  process.stdout.write(`config privada aplicada: ${lido.valores.size} chave(s)\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
