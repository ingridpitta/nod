import { ErroDeDominio } from "../../src/domain/erro.ts";
import { redigirECortar } from "../../src/domain/segredos.ts";

/**
 * Saída de erro dos scripts de voz (definido em 2026-10-05, QA da NOD-166). Um erro que escapava do script ia para o
 * terminal com a pilha e a `cause` inteira, e a `cause` traz texto cru do Google e do gcloud (o stderr do
 * `gcloud auth print-access-token` pode trazer token). Aqui sai uma linha em pt-BR, e a causa só passa pelo redator.
 */

/** Argumento errado na linha de comando: a mensagem já está em pt-BR e sai sem pilha nem causa. */
export class UsoInvalido extends Error {}

const EXPLICACAO: Partial<Record<string, string>> = {
  integracao_nao_configurada: "credencial do Google não encontrada: confira NOD_VOZ_PROJETO e NOD_VOZ_GCLOUD_BIN (gcloud instalado e logado)",
  integracao_autenticacao: "o Google recusou a credencial: rode `gcloud auth login` (ou confira o ADC) e tente de novo",
  conector_indisponivel: "o Google não respondeu ou caiu no meio do pedido: tente de novo em alguns minutos",
  entrada_invalida: "o Google recusou o pedido (texto, voz ou parâmetro inválido)",
};

const MAX_CAUSA = 500;

function causas(e: unknown): string[] {
  const out: string[] = [];
  let c = e instanceof Error ? e.cause : undefined;
  for (let i = 0; i < 3 && c !== undefined; i++) {
    out.push(c instanceof Error ? c.message : String(c));
    c = c instanceof Error ? c.cause : undefined;
  }
  return out;
}

export function mensagemDeFalha(e: unknown): string {
  if (e instanceof UsoInvalido) return e.message;
  let principal: string;
  if (e instanceof ErroDeDominio) principal = `${EXPLICACAO[e.codigo] ?? "o Google falhou"} (${e.codigo})`;
  else if (typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT" && "path" in e) principal = `arquivo não encontrado: ${String(e.path)}`;
  else principal = `${redigirECortar(e instanceof Error ? e.message : String(e), MAX_CAUSA) ?? "sem mensagem"}`;
  const detalhe = causas(e).map((c) => redigirECortar(c, MAX_CAUSA)).filter((c): c is string => c !== null);
  return detalhe.length === 0 ? principal : `${principal}\n  causa: ${detalhe.join("\n  causa: ")}`;
}

export function encerrarComFalha(e: unknown): never {
  process.stderr.write(`erro: ${mensagemDeFalha(e)}\n`);
  process.exit(1);
}

export function inteiroPositivo(nome: string, valor: string | undefined): number {
  const n = valor !== undefined && /^\d+$/.test(valor.trim()) ? Number(valor) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) throw new UsoInvalido(`--${nome} precisa ser um número inteiro ≥ 1 (veio ${valor === undefined ? "nada" : `"${valor}"`})`);
  return n;
}

/** `12m` são minutos; só o número são segundos. Zero ou vazio não mede nada e faria a sonda passar sem testar. */
export function duracaoEmMs(valor: string | undefined): number {
  const m = /^(\d+)(m?)$/.exec(valor?.trim() ?? "");
  const ms = m ? Number(m[1]) * (m[2] ? 60_000 : 1_000) : NaN;
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new UsoInvalido(`--duracao precisa ser minutos, como 12m, ou segundos, como 90 (veio ${valor === undefined ? "nada" : `"${valor}"`})`);
  return ms;
}
