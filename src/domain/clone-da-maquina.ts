/**
 * definido em 2026-10-22 (NOD-315, ADR-119): o clone da máquina. Cada frente baixava o repo inteiro na própria pasta
 * (19/10: 18 clones do gamefik, ~24,6 GB só de `.git`). Agora a máquina Linux guarda UM clone bare por repo em
 * `~/nod/.clones/<dono>/<nome>.git`, que o executor prepara antes do turno; a frente faz a worktree a partir dele.
 * Este arquivo é a parte pura: o nome do repo, o caminho e a troca do texto no prompt.
 */

/** Rollback (ADR-119): com `false`, o servidor não manda `cloneDaMaquina` no plano e o prompt é o de antes. */
export const CLONE_DA_MAQUINA = true;

/** Por que o turno ficou sem o clone da máquina (log `clone_da_maquina_saida`). Em todos, o bot clona como antes. */
export type MotivoSaida = "sem_credencial" | "submodulo" | "lfs" | "clone" | "fetch" | "trava" | "clone_quebrado" | "prompt_sem_trecho" | "abortado";

const REPO = /^[a-z0-9-]{1,39}\/[a-z0-9._-]{1,100}$/;

/**
 * `dono/nome` do GitHub, em minúsculas, a partir de `dono/nome`, `https://github.com/dono/nome(.git)` ou
 * `git@github.com:dono/nome.git`. Qualquer outra coisa (outro host, `a/b/c`, `..`, nome começando com ponto) é `null`:
 * o texto vem do modelo e vira caminho no disco.
 */
export function repoDoGithub(texto: string): string | null {
  let s = texto.trim().toLowerCase();
  const url = /^(?:https?:\/\/(?:www\.)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)(.+)$/.exec(s);
  if (url) s = url[1]!;
  s = s.replace(/\/+$/, "");
  if (s.endsWith(".git")) s = s.slice(0, -4);
  if (!REPO.test(s)) return null;
  const nome = s.slice(s.indexOf("/") + 1);
  if (nome.startsWith(".")) return null;
  return s;
}

/** `<home>/nod/.clones/<dono>/<nome>.git`. Com `home = "~"`, é o texto que vai no prompt. */
export function caminhoDoClone(home: string, repo: string): string {
  return `${home}/nod/.clones/${repo}.git`;
}

/** O arquivo da trava do repo (`flock`), fora do clone para valer também antes de ele existir. */
export function caminhoDaTrava(home: string, repo: string): string {
  return `${home}/nod/.clones/.travas/${repo.replace("/", "__")}.lock`;
}

function trocarUma(texto: string, de: string, para: string): string | null {
  const i = texto.indexOf(de);
  if (i < 0 || texto.indexOf(de, i + 1) >= 0) return null;
  return texto.slice(0, i) + para + texto.slice(i + de.length);
}

/**
 * Troca `de` por `para` no prompt do plano: exatamente uma ocorrência em `promptSistema` e, havendo partes, exatamente
 * uma na parte que o contém. 0 ou mais de 1 é `null` — o executor segue com o prompt intacto (`prompt_sem_trecho`).
 */
export function trocarNoPrompt<P extends { promptSistema: string; promptSistemaPartes?: { estavel: string; volatil: string } }>(plano: P, de: string, para: string): P | null {
  if (!de) return null;
  const prompt = trocarUma(plano.promptSistema, de, para);
  if (prompt === null) return null;
  const partes = plano.promptSistemaPartes;
  if (!partes) return { ...plano, promptSistema: prompt };
  const naEstavel = partes.estavel.includes(de);
  const naVolatil = partes.volatil.includes(de);
  if (naEstavel === naVolatil) return null;
  const parte = trocarUma(naEstavel ? partes.estavel : partes.volatil, de, para);
  if (parte === null) return null;
  return { ...plano, promptSistema: prompt, promptSistemaPartes: naEstavel ? { ...partes, estavel: parte } : { ...partes, volatil: parte } };
}
