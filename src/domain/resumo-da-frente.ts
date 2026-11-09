import { TETO_BYTES_RESUMO, TETO_TEXTO_RESUMO, type ResumoFrente } from "../contracts/frente.ts";
import { bytesUtf8 } from "./artefato.ts";

/**
 * O resumo que a frente devolve ao dono (definido em 2026-10-12, ADR-099, especificação das Partes 3/4): fatos curtos —
 * o que fez, o PR e o SHA, o branch e o que falta. Puro: sem banco, sem relógio. Quem chama (a ferramenta
 * `devolver_resumo`, issue seguinte) transforma o erro numa instrução ao bot.
 *
 * Estrito como a validação do servidor: campo fora da lista, tipo errado ou texto acima do teto é erro, nunca corte
 * silencioso (o bot reescreve mais curto). Texto opcional vazio é o mesmo que ausente; `feito` vazio é erro.
 */
export type ErroResumo = "nao_e_objeto" | "campo_desconhecido" | "feito_vazio" | "texto_invalido" | "texto_longo" | "pr_invalido" | "sha_invalido" | "resumo_grande";

export type ResultadoResumo = { ok: true; resumo: ResumoFrente } | { ok: false; erro: ErroResumo; campo?: string };

const CAMPOS = new Set(["feito", "pr", "sha", "branch", "falta"]);
/** O commit como o git o escreve: 7 (abreviado) a 40 hexadecimais minúsculos. */
const SHA = /^[0-9a-f]{7,40}$/;

type Texto = { ok: true; valor: string | undefined } | { ok: false; erro: "texto_invalido" | "texto_longo" };

function texto(v: unknown): Texto {
  if (v === undefined || v === null) return { ok: true, valor: undefined };
  if (typeof v !== "string") return { ok: false, erro: "texto_invalido" };
  const limpo = v.trim();
  if (limpo.length > TETO_TEXTO_RESUMO) return { ok: false, erro: "texto_longo" };
  return { ok: true, valor: limpo === "" ? undefined : limpo };
}

export function validarResumo(entrada: unknown): ResultadoResumo {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return { ok: false, erro: "nao_e_objeto" };
  const r = entrada as Record<string, unknown>;
  const estranho = Object.keys(r).find((k) => !CAMPOS.has(k));
  if (estranho !== undefined) return { ok: false, erro: "campo_desconhecido", campo: estranho };

  const resumo: ResumoFrente = { feito: "" };
  for (const campo of ["feito", "branch", "falta"] as const) {
    const t = texto(r[campo]);
    if (!t.ok) return { ok: false, erro: t.erro, campo };
    if (t.valor !== undefined) resumo[campo] = t.valor;
  }
  if (resumo.feito === "") return { ok: false, erro: "feito_vazio", campo: "feito" };

  if (r.pr !== undefined && r.pr !== null) {
    if (typeof r.pr !== "number" || !Number.isSafeInteger(r.pr) || r.pr <= 0) return { ok: false, erro: "pr_invalido", campo: "pr" };
    resumo.pr = r.pr;
  }
  if (r.sha !== undefined && r.sha !== null) {
    if (typeof r.sha !== "string" || !SHA.test(r.sha)) return { ok: false, erro: "sha_invalido", campo: "sha" };
    resumo.sha = r.sha;
  }
  // O CHECK trabalho_resumo da 0071 (octet_length do jsonb como texto): só passa do teto com texto cheio de caracteres
  // de controle (cada um vira \u00XX). O texto do jsonb põe um espaço depois de cada ":" e ",": 16 bytes cobrem os 5 campos.
  if (bytesUtf8(JSON.stringify(resumo)) + 16 > TETO_BYTES_RESUMO) return { ok: false, erro: "resumo_grande" };
  return { ok: true, resumo };
}
