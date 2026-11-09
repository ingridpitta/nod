import type { CiPr, ColunaQuadro, EstadoPr, IdColuna, PrDaTarefa, PrLido, TipoLinhaTarefa } from "../contracts/quadro.ts";
import { andando, PR_GITHUB } from "./quadro.ts";

/**
 * definido em 2026-11-02 (NOD-421): o PR na tarefa e a tarefa fechar sozinha no merge. Puro: o laço de fundo lê os PRs
 * (gh, JSON de `gh pr list --json ...`), o caso de uso guarda o último estado visto e este módulo decide o que mudou,
 * que linha de sistema escrever e se a tarefa vai para Feito.
 */

/** dono/repo do GitHub: o login só tem letra, dígito e hífen; o nome do repo não é "." nem "..". */
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
export const repoValido = (r: string): boolean => REPO.test(r) && !/\/\.{1,2}$/.test(r);

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * O id da tarefa aparece no branch, sem diferenciar maiúscula, com fronteira: antes não pode vir letra/dígito, depois não
 * pode vir dígito (`abc-1` não casa `abc-12-x`; casa `faustino/abc-1-login` e `ABC-1`).
 */
export function idNoBranch(id: string, branch: string): boolean {
  if (!id.trim()) return false;
  return new RegExp(`(^|[^a-z0-9])${escapar(id.trim().toLowerCase())}($|[^0-9])`).test(branch.toLowerCase());
}

/** 5ª revisão do PR #621: a url do PR comparada sem maiúscula nem barra final (o GitHub não diferencia dono/repo). */
export const normalizarUrlPr = (u: string): string => u.trim().toLowerCase().replace(/\/+$/, "");

/** A tarefa casa com o PR pelo id no branch (hoje o item do Linear; a NOD-416 soma o id da tarefa) ou pelo pr_url gravado. */
export function casaComTarefa(t: { ids: readonly string[]; prUrl: string | null }, pr: Pick<PrLido, "url" | "branch" | "fork">): boolean {
  // 2ª revisão do PR #621: PR de fork (isCrossRepository) nunca casa. Qualquer pessoa abre um PR de fork com `nod-421` no
  // branch; casar levaria a linha, o estado e o merge de um estranho à tarefa (e o merge dele a Feito).
  if (pr.fork) return false;
  if (t.prUrl && normalizarUrlPr(t.prUrl) === normalizarUrlPr(pr.url)) return true;
  return t.ids.some((id) => idNoBranch(id, pr.branch));
}

const FALHAS = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
const PENDENTES = new Set(["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"]);

/**
 * O CI do PR a partir do `statusCheckRollup` do gh (CheckRun: status/conclusion; StatusContext: state). Qualquer falha
 * = falhou; senão qualquer em andamento = pendente; senão ok. Sem checagem nenhuma = null (o repo não tem CI).
 */
export function estadoDoCi(rollup: unknown): CiPr | null {
  if (!Array.isArray(rollup) || rollup.length === 0) return null;
  let pendente = false;
  for (const c of rollup) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const conclusao = typeof o.conclusion === "string" ? o.conclusion.toUpperCase() : "";
    const status = typeof o.status === "string" ? o.status.toUpperCase() : "";
    const state = typeof o.state === "string" ? o.state.toUpperCase() : "";
    if (FALHAS.has(conclusao) || FALHAS.has(state)) return "falhou";
    if (PENDENTES.has(state) || (status !== "" && status !== "COMPLETED")) pendente = true;
  }
  return pendente ? "pendente" : "ok";
}

const ESTADOS: Record<string, EstadoPr> = { OPEN: "aberto", MERGED: "mergeado", CLOSED: "fechado" };

/**
 * Um item de `gh pr list --json number,url,headRefName,state,mergeable,statusCheckRollup` → PR; inválido = null. A url
 * tem de ser o PR do GitHub deste repo e número (a mesma regra do pr_url, PR_GITHUB): o card e a tarefa a viram link.
 * `mergeable` UNKNOWN (o GitHub ainda calculando) = conflito null, que o caso de uso resolve com o último visto.
 */
export function lerPrDoGh(repo: string, v: unknown): PrLido | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const numero = o.number;
  const estado = typeof o.state === "string" ? ESTADOS[o.state.toUpperCase()] : undefined;
  if (typeof numero !== "number" || !Number.isInteger(numero) || numero <= 0 || !estado) return null;
  if (typeof o.url !== "string" || o.url.length > 300 || !PR_GITHUB.test(o.url)) return null;
  if (o.url.toLowerCase() !== `https://github.com/${repo}/pull/${numero}`.toLowerCase()) return null;
  const branch = typeof o.headRefName === "string" ? o.headRefName.slice(0, 300) : "";
  const conflito = o.mergeable === "CONFLICTING" ? true : o.mergeable === "MERGEABLE" ? false : null;
  return { repo, numero, url: o.url, branch, estado, ci: estadoDoCi(o.statusCheckRollup), conflito, ...(o.isCrossRepository === true ? { fork: true } : {}) };
}

/** O conflito desconhecido (UNKNOWN) fica como estava: sem PR visto antes, sem conflito. */
export function fixarConflito(antes: Pick<PrDaTarefa, "conflito"> | null, lido: PrLido): PrDaTarefa {
  const { fork: _fork, ...resto } = lido;
  return { ...resto, conflito: lido.conflito ?? antes?.conflito ?? false };
}

/**
 * Só a transição vira linha. PR novo: "ligado" e, se já chegou aberto com CI falhando/em conflito, a linha do estado.
 * CI e conflito só contam com o PR aberto (o gh devolve mergeable UNKNOWN depois do merge).
 * 5ª revisão do PR #621: o PR que já chega mergeado ou fechado na primeira leitura só é ligado (o texto diz o estado,
 * textoDaLinha): não houve transição observada, e só um merge NOVO (aberto→mergeado) move a tarefa ou fica pendente.
 * Sem isso, um PR antigo com o id no branch levava a tarefa recém-importada para Feito.
 */
export function transicoes(antes: PrDaTarefa | null, depois: PrDaTarefa): TipoLinhaTarefa[] {
  const r: TipoLinhaTarefa[] = [];
  if (!antes) {
    r.push("pr_ligado");
    if (depois.estado === "aberto") {
      if (depois.ci === "falhou") r.push("ci_falhou");
      if (depois.conflito) r.push("conflito");
    }
    return r;
  }
  if (antes.estado !== depois.estado) {
    if (depois.estado === "mergeado") r.push("pr_mergeado");
    else if (depois.estado === "fechado") r.push("pr_fechado");
    else r.push("pr_reaberto");
  }
  if (depois.estado !== "aberto") return r;
  if (antes.ci !== depois.ci) {
    if (depois.ci === "ok") r.push("ci_ok");
    else if (depois.ci === "falhou") r.push("ci_falhou");
  }
  if (!antes.conflito && depois.conflito) r.push("conflito");
  else if (antes.conflito && !depois.conflito) r.push("conflito_resolvido");
  return r;
}

const FRASES: Record<TipoLinhaTarefa, (pr: string) => string> = {
  pr_ligado: (pr) => `PR ${pr} ligado`,
  ci_ok: (pr) => `CI ok no ${pr}`,
  ci_falhou: (pr) => `CI falhou no ${pr}`,
  conflito: (pr) => `conflito no ${pr}`,
  conflito_resolvido: (pr) => `conflito resolvido no ${pr}`,
  pr_mergeado: (pr) => `${pr} mergeado`,
  pr_fechado: (pr) => `${pr} fechado sem merge`,
  pr_reaberto: (pr) => `${pr} reaberto`,
};

const JA_CHEGOU: Partial<Record<EstadoPr, string>> = { mergeado: " (mergeado)", fechado: " (fechado sem merge)" };

/**
 * O texto da linha, montado só com repo, número e estado (título e corpo do PR são de fora e não entram). O "ligado" de
 * um PR que já chegou mergeado/fechado diz o estado: "PR gamefik/nod #170 ligado (mergeado)".
 */
export function textoDaLinha(tipo: TipoLinhaTarefa, pr: Pick<PrDaTarefa, "repo" | "numero"> & Partial<Pick<PrDaTarefa, "estado">>, desfecho?: string): string {
  const ref = tipo === "pr_ligado" ? `${pr.repo} #${pr.numero}` : `#${pr.numero}`;
  const estado = tipo === "pr_ligado" && pr.estado ? (JA_CHEGOU[pr.estado] ?? "") : "";
  return `GitHub · ${FRASES[tipo](ref)}${estado}${desfecho ? ` ${desfecho}` : ""}`;
}

export type DestinoDoMerge = { mover: IdColuna; nome: string } | { ficou: string };

/**
 * Depois de um merge: com algum PR ainda aberto (ou nenhum mergeado), nada. Senão vai para a primeira coluna do grupo
 * feito se a coluna atual permite (grupo iniciado, fora de "Precisa de você" e Bloqueado, a mesma regra de `andando`);
 * senão só registra onde ficou. Quem chama só pergunta quando um PR da tarefa ACABOU de virar mergeado ou fechado (3ª
 * revisão do PR #621: PR1 mergeado e PR2 fechado sem merge também fecha, mas só com o merge pendente: fimDosPrs, 4ª
 * revisão): tirada de Feito pela pessoa, a tarefa não volta pelo mesmo merge.
 */
export function destinoDoMerge(colunas: readonly ColunaQuadro[], status: IdColuna, prs: readonly Pick<PrDaTarefa, "estado">[]): DestinoDoMerge | null {
  if (prs.some((p) => p.estado === "aberto") || !prs.some((p) => p.estado === "mergeado")) return null;
  const atual = colunas.find((c) => c.id === status);
  const nomeAtual = atual?.nome ?? status;
  if (!andando(colunas, status)) return { ficou: nomeAtual };
  const feito = colunas.find((c) => c.grupo === "feito");
  if (!feito) return { ficou: nomeAtual };
  return { mover: feito.id, nome: feito.nome };
}

/**
 * definido em 2026-11-02 (4ª revisão do PR #621): quando o fim de um PR pergunta o destino e como fica o "merge
 * pendente" da tarefa. O merge pergunta sempre; o fechamento sem merge só pergunta com um merge PENDENTE (um merge que
 * não teve desfecho porque havia outro PR aberto). Sem isso, um merge antigo que já moveu a tarefa (ou já "ficou em
 * Backlog") a levaria a Feito no fechamento de qualquer PR novo, mesmo depois de a pessoa a tirar de Feito.
 * Com desfecho (moveu ou ficou), o pendente some; merge sem desfecho (outro PR aberto) deixa pendente.
 */
export function fimDosPrs(
  g: { mergeouAgora: boolean; fechouAgora: boolean; pendente: boolean },
  colunas: readonly ColunaQuadro[],
  status: IdColuna,
  prs: readonly Pick<PrDaTarefa, "estado">[],
): { destino: DestinoDoMerge | null; pendente: boolean } {
  if (!g.mergeouAgora && !(g.fechouAgora && g.pendente)) return { destino: null, pendente: g.pendente };
  const destino = destinoDoMerge(colunas, status, prs);
  if (destino) return { destino, pendente: false };
  return { destino: null, pendente: g.pendente || g.mergeouAgora };
}

/** O complemento da linha de merge: "→ Feito" ou "· ficou em Backlog". */
export function desfechoDoMerge(d: DestinoDoMerge): string {
  return "mover" in d ? `→ ${d.nome}` : `· ficou em ${d.ficou}`;
}

/** O PR numa linha curta (o resumo do quadro para o bot e o título do chip): "gamefik/nod #612 · aberto · CI ok · conflito". */
export function resumoDoPr(p: Pick<PrDaTarefa, "repo" | "numero" | "estado" | "ci" | "conflito">): string {
  const partes = [`${p.repo} #${p.numero}`, p.estado];
  if (p.estado === "aberto" && p.ci) partes.push(`CI ${p.ci}`);
  if (p.estado === "aberto" && p.conflito) partes.push("conflito");
  return partes.join(" · ");
}

/** definido em 2026-11-02 (NOD-421, revisão do PR #621): as frases do aviso no topo do quadro (texto, não alerta). */
export const AVISO_SEM_CONEXAO = "GitHub não conectado no servidor: os PRs não sincronizam";
/** O teto de quadros.aviso_github (0142). */
export const TETO_AVISO_GITHUB = 300;
/**
 * 4ª revisão do PR #621: o aviso cabe na coluna. Entram os repos que couberem, na ordem, e o resto vira "e mais N"
 * ("GitHub · sem acesso a a/x, a/y e mais 3"). Um repo válido tem até 140 caracteres, então o primeiro sempre cabe.
 */
export function avisoSemAcesso(repos: readonly string[]): string {
  for (let k = repos.length; k > 0; k--) {
    const resto = repos.length - k;
    const texto = `GitHub · sem acesso a ${repos.slice(0, k).join(", ")}${resto > 0 ? ` e mais ${resto}` : ""}`;
    if (texto.length <= TETO_AVISO_GITHUB) return texto;
  }
  return `GitHub · sem acesso a ${repos.length} repos`.slice(0, TETO_AVISO_GITHUB);
}

const SEM_CONEXAO = new Set(["gh_ausente", "sem_login"]);
const SEM_ACESSO = new Set(["sem_permissao", "nao_encontrado", "movido"]);

/**
 * O aviso do quadro a partir da leitura de cada repo (codigo null = leu): sem gh nem credencial (ou credencial recusada)
 * = "não conectado"; 401/403/404 num repo = "sem acesso a dono/repo" (os outros seguem); tudo lido = null (limpa).
 * Rede, 5xx ou rate limit (sem outro aviso) = undefined: não se sabe, o aviso fica como estava (sem linha para a pessoa).
 * Quem grava só escreve quando muda: o aviso aparece uma vez por quadro até mudar.
 */
export function avisoDaLeitura(resultados: readonly { repo: string; codigo: string | null }[]): string | null | undefined {
  if (resultados.some((r) => r.codigo !== null && SEM_CONEXAO.has(r.codigo))) return AVISO_SEM_CONEXAO;
  const semAcesso = resultados.filter((r) => r.codigo !== null && SEM_ACESSO.has(r.codigo)).map((r) => r.repo);
  if (semAcesso.length > 0) return avisoSemAcesso(semAcesso);
  return resultados.some((r) => r.codigo !== null) ? undefined : null;
}
