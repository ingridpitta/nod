import { classificarIgnorado } from "./limpeza-das-tasks.ts";

/**
 * NOD-295 A (definido em 2026-10-19): o clone (`.git` PASTA) dentro da pasta de uma task só sai sem guardar quando é
 * idêntico ao que está no remoto. Em 19/10 a VM dos bots tinha 87 GB em `~/nod/.guardado`, quase tudo clone limpo do
 * gamefik de frentes `detalhar-*` (~1,8 GB cada, ~20 GB/dia): a limpeza tratava qualquer clone como dúvida e guardava a
 * pasta inteira. Critério do Marlon: seguro para qualquer codebase — só sai o que se refaz com um `git clone`; na
 * dúvida, guarda. Aqui só as regras puras; quem confere o git é o executor (src/adapters/executor/limpeza-das-tasks.ts).
 */

/**
 * O caminho local de um remoto (`/x`, `../x`, `file:///x`), ou null quando o remoto é de rede (`https://…`, `ssh://…`,
 * `git@host:dono/repo`). O remoto local só vale se existir fora da pasta que vai sair: um clone de um clone que mora na
 * mesma pasta perderia os dois.
 */
export function caminhoDoRemotoLocal(url: string): string | null {
  const u = url.trim();
  if (u === "") return null;
  const esquema = /^([a-z][a-z0-9+.-]*):\/\//i.exec(u);
  if (esquema) {
    if (esquema[1]!.toLowerCase() !== "file") return null;
    // `file:///x` ou `file://host/x`: o caminho começa na barra depois do host.
    const resto = u.slice("file://".length);
    const caminho = resto.startsWith("/") ? resto : resto.slice(Math.max(0, resto.indexOf("/")));
    try { return decodeURIComponent(caminho); } catch { return caminho; }
  }
  // A forma scp do git (`[usuario@]host:caminho`): o `:` vem antes de qualquer `/`.
  const doisPontos = u.indexOf(":");
  const barra = u.indexOf("/");
  if (doisPontos > 0 && (barra === -1 || doisPontos < barra)) return null;
  return u;
}

/**
 * O `git ls-files -v` marca com minúscula o arquivo `assume-unchanged` e com `S` o `skip-worktree`: a alteração neles
 * não aparece no `git status`, então o clone que tem algum não prova que está limpo.
 */
export function temArquivoEscondidoDoStatus(lsFilesV: string): boolean {
  return lsFilesV.split("\n").some((l) => l !== "" && (l[0] === "S" || /^[a-z]/.test(l)));
}

/**
 * NOD-295 A: o caminho ignorado (relativo ao repositório, como o `git status --ignored=traditional` mostra) que sai do
 * guardado do clone ou da worktree suja, por se refazer (`dist/`, `coverage/`, os caches). Só o que `classificarIgnorado`
 * diz que se refaz; a pasta inteira regenerável (`conferir_env`) só quando quem chama já viu que não tem `.env*` dentro.
 * Caminho com caractere de padrão do `tar` (`*`, `?`, `[`, `\`) nunca é excluído: o padrão poderia casar com outra
 * coisa (`apps/[id]/.next` do Next.js). Excluir de menos só deixa o guardado maior.
 */
export function saiDoGuardado(caminho: string, semEnvDentro: boolean): boolean {
  if (/[*?[\\]/.test(caminho)) return false;
  const tipo = classificarIgnorado(caminho);
  return tipo === "regeneravel" || (tipo === "conferir_env" && semEnvDentro);
}

/** NOD-295 A: o teto de exclusões por guardado (cada uma é um argumento do `tar`); passou, as seguintes vão junto. */
export const EXCLUSOES_MAX = 2_000;

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * QA do #413 (2026-10-19, bug 1): o que o remoto DE VERDADE tem, lido do `git ls-remote --heads --tags`. `objetos` são
 * todos os ids anunciados (inclusive o objeto da tag anotada); `commits` são as pontas como commit — a branch, a tag
 * anotada já descascada (`^{}`) e a tag leve. Comparar com `refs/remotes/*` locais não prova nada: elas ficam velhas
 * quando a branch é apagada no servidor ou quando não há rede.
 */
export function lerLsRemote(stdout: string): { commits: string[]; objetos: Set<string>; tags: Map<string, string> } {
  const objetos = new Set<string>();
  const porRef = new Map<string, string>();
  const descascadas = new Map<string, string>();
  for (const linha of stdout.split("\n")) {
    const [sha = "", ref = ""] = linha.trim().split("\t");
    if (!SHA.test(sha) || ref === "") continue;
    objetos.add(sha);
    if (ref.endsWith("^{}")) descascadas.set(ref.slice(0, -3), sha);
    else porRef.set(ref, sha);
  }
  const commits = new Set<string>();
  // NOD-319: as tags anunciadas, pelo nome da ref, com o objeto que a ref aponta (o da tag anotada, não o descascado).
  const tags = new Map<string, string>();
  for (const [ref, sha] of porRef) {
    commits.add(descascadas.get(ref) ?? sha);
    if (ref.startsWith("refs/tags/")) tags.set(ref, sha);
  }
  return { commits: [...commits], objetos, tags };
}

/**
 * NOD-319 (ressalva 2 do QA do #413): há tag local (leve ou anotada) que nenhum remoto anuncia com o mesmo nome e o
 * mesmo objeto? A tag leve num commit do remoto passava (o commit está lá), e o nome dela sumia com o clone. `locais` é
 * a saída de `git for-each-ref --format='%(refname) %(objectname)' refs/tags`; `anunciadas`, as tags de cada remoto
 * (`lerLsRemote().tags`). Linha que não se lê = dúvida = sim.
 */
export function temTagSoLocal(locais: string, anunciadas: readonly ReadonlyMap<string, string>[]): boolean {
  for (const linha of locais.split("\n")) {
    const l = linha.trim();
    if (l === "") continue;
    const espaco = l.lastIndexOf(" ");
    const ref = l.slice(0, espaco);
    const sha = l.slice(espaco + 1);
    if (espaco <= 0 || !ref.startsWith("refs/tags/") || !SHA.test(sha)) return true;
    if (!anunciadas.some((t) => t.get(ref) === sha)) return true;
  }
  return false;
}

/**
 * QA do #413 (bug 2): os commits que o `git bundle` exige de quem o recebe (as linhas `-<sha>` do cabeçalho, até a
 * linha em branco). Só pode exigir o que o remoto tem: senão o `git fetch` do bundle num clone novo falha com
 * "Repository lacks these prerequisite commits" e o commit não enviado se perde.
 */
export function prerequisitosDoBundle(cabecalho: string): string[] {
  const linhas = cabecalho.split("\n");
  const fora: string[] = [];
  for (const linha of linhas.slice(1)) {
    if (linha === "") break;
    if (!linha.startsWith("-")) continue;
    const sha = linha.slice(1).split(" ")[0] ?? "";
    if (SHA.test(sha)) fora.push(sha);
  }
  return fora;
}

/** QA do #413 (bug 3): algum diretório de trabalho de processo (`/proc/<pid>/cwd`, `lsof -d cwd`) está em `dir`? */
export function algumCwdDentro(cwds: readonly string[], dir: string): boolean {
  const alvo = dir.replace(/\/+$/, "");
  return cwds.some((c) => {
    const x = c.replace(/ \(deleted\)$/, "");
    return x === alvo || x.startsWith(`${alvo}/`);
  });
}
