import type { FerramentaPlano } from "../contracts/plano-turno.ts";
import type { EventoRevisao, JeitoGithub, NomeCapacidadeGithub } from "../contracts/github.ts";
import { CAPACIDADES_GITHUB, COMPOSIO_POR_CAPACIDADE_GITHUB } from "../contracts/github.ts";

/**
 * revisto em 2026-09-24 (ADR-048, revisão): o jeito é decidido POR TURNO, nesta ordem —
 *   1. o gh logado na MÁQUINA do turno, e só se ela é da dona do conector (o login do gh serve a
 *      quem o fez; um colega no mesmo servidor nunca usa o gh de outra pessoa);
 *   2. o token pessoal da dona; 3. o login Composio da dona;
 *   4. o GitHub App da organização, SÓ em turno de rotina (sem ninguém olhando). Em turno interativo
 *      o App nunca entra: ele publicaria como `app[bot]` no lugar da pessoa, e uma revisão do App
 *      não conta como aprovação dela no PR.
 * O gh nunca roda no servidor: quando vence, a ferramenta vai marcada `execucao: "maquina"` no plano.
 */
export type JeitoDoServidor = Exclude<JeitoGithub, "gh">;
export const ORDEM_DO_SERVIDOR: readonly JeitoDoServidor[] = ["token", "composio", "app"];

export type JeitosProntos = Readonly<Partial<Record<JeitoGithub, boolean>>>;

export type EscolhaJeitoGithub = { ok: true; jeito: JeitoGithub } | { ok: false; frase: string };

/** A frase quando nenhum jeito serve: diz o que a PESSOA faz, nunca o nome de uma variável. */
export function fraseSemJeito(rotina: boolean): string {
  return rotina
    ? "Nenhum jeito de conectar o GitHub serve a esta rotina: deixe o app nod aberto no seu Mac com o gh logado, cole um token pessoal, entre pelo Composio ou, para rotinas com o Mac desligado, conecte o GitHub da organização."
    : "Nenhum jeito de conectar o GitHub está pronto: abra o app nod no seu Mac com o gh logado (`gh auth login`), cole um token pessoal no campo avançado ou entre pelo Composio.";
}

/**
 * `ghNaMaquina` já vem cruzado com a posse: true só quando a máquina do turno anunciou o gh E a
 * pessoa do turno é a dona do conector. `rotina` = turno de rotina (o único que o App atende).
 */
export function escolherJeitoGithub(p: { ghNaMaquina: boolean; prontos: JeitosProntos; rotina: boolean }): EscolhaJeitoGithub {
  if (p.ghNaMaquina) return { ok: true, jeito: "gh" };
  for (const jeito of ORDEM_DO_SERVIDOR) {
    if (jeito === "app" && !p.rotina) continue;
    if (p.prontos[jeito] === true) return { ok: true, jeito };
  }
  return { ok: false, frase: fraseSemJeito(p.rotina) };
}

/**
 * As ferramentas do conector nativo `github` de QUEM roda o turno passam a rodar na máquina do turno
 * quando ela tem o gh. `conectorId` null = não há o que marcar (sem gh, ou o conector é de outra pessoa).
 */
export function marcarExecucaoNaMaquina(ferramentas: readonly FerramentaPlano[], conectorId: string | null): FerramentaPlano[] {
  return ferramentas.map((f) => (conectorId !== null && f.origem === "conector" && f.conectorId === conectorId ? { ...f, execucao: "maquina" as const } : f));
}

export type AlvoGithub = { dono: string; repo: string };

export type ArgsGithub =
  | { capacidade: "pr_ver" | "pr_diff" | "pr_arquivos" | "pr_comentarios" | "pr_checks" | "issue_ver"; alvo: AlvoGithub; numero: number }
  | { capacidade: "arquivo_ler"; alvo: AlvoGithub; caminho: string; ref: string | null }
  | { capacidade: "pr_comentar"; alvo: AlvoGithub; numero: number; texto: string }
  | { capacidade: "pr_revisar"; alvo: AlvoGithub; numero: number; evento: EventoRevisao; texto: string | null };

/** Erro de entrada: vira resultado de ferramenta com isError, nunca chega a `gh` nem à rede. */
export class ArgumentoGithubInvalido extends Error {
  readonly campo: string;
  constructor(campo: string) {
    super(`argumento inválido: ${campo}`);
    this.name = "ArgumentoGithubInvalido";
    this.campo = campo;
  }
}

/**
 * definido em 2026-09-24: regras do próprio GitHub, apertadas. Dono: letras, dígitos e hífen, sem
 * hífen no começo, até 39. Repositório: letras, dígitos, `.`, `_`, `-`, sem começar por `-` nem ser
 * `.`/`..`. Nada disso deixa passar espaço, `;`, `=` ou `--repo=x`: o valor nunca vira opção de `gh`.
 */
const DONO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/;
const REF = /^[A-Za-z0-9_.][A-Za-z0-9_./-]{0,199}$/;
const SEGMENTO = /^[A-Za-z0-9_.@+-][A-Za-z0-9_.@+ -]{0,254}$/;
/** definido em 2026-09-24: 65.536 é o teto de corpo de comentário do GitHub. */
export const TETO_TEXTO_GITHUB = 65_536;

export function validarRepositorio(v: unknown): AlvoGithub {
  if (typeof v !== "string") throw new ArgumentoGithubInvalido("repositorio");
  const partes = v.trim().split("/");
  const [dono, bruto] = partes;
  // revisto em 2026-09-24: tira o `.git` ANTES de recusar "", "." e ".." — senão `x/..git` virava `x/.`.
  const repo = bruto?.endsWith(".git") ? bruto.slice(0, -4) : bruto;
  if (partes.length !== 2 || !dono || !repo || !DONO.test(dono) || !REPO.test(repo) || repo === "." || repo === "..") throw new ArgumentoGithubInvalido("repositorio");
  return { dono, repo };
}

export function validarNumero(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 999_999_999) throw new ArgumentoGithubInvalido("numero");
  return v;
}

function validarCaminho(v: unknown): string {
  if (typeof v !== "string") throw new ArgumentoGithubInvalido("caminho");
  const segmentos = v.replace(/^\/+/, "").split("/");
  if (segmentos.length === 0 || segmentos.length > 64 || segmentos.some((s) => !SEGMENTO.test(s) || s === "." || s === "..")) throw new ArgumentoGithubInvalido("caminho");
  return segmentos.join("/");
}

function validarRef(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !REF.test(v) || v.includes("..") || v.endsWith("/") || v.endsWith(".lock")) throw new ArgumentoGithubInvalido("ref");
  return v;
}

function validarTexto(v: unknown, campo: string): string {
  if (typeof v !== "string" || v.trim() === "" || v.length > TETO_TEXTO_GITHUB) throw new ArgumentoGithubInvalido(campo);
  return v;
}

const NOMES = new Set<string>(CAPACIDADES_GITHUB.map((c) => c.nome));

export function ehCapacidadeGithub(nome: string): nome is NomeCapacidadeGithub {
  return NOMES.has(nome);
}

/** Valida os argumentos de uma capacidade ANTES de qualquer processo ou requisição existir. */
export function validarArgsGithub(capacidade: NomeCapacidadeGithub, bruto: Readonly<Record<string, unknown>>): ArgsGithub {
  const alvo = validarRepositorio(bruto.repositorio);
  switch (capacidade) {
    case "arquivo_ler":
      return { capacidade, alvo, caminho: validarCaminho(bruto.caminho), ref: validarRef(bruto.ref) };
    case "pr_comentar":
      return { capacidade, alvo, numero: validarNumero(bruto.numero), texto: validarTexto(bruto.texto, "texto") };
    case "pr_revisar": {
      const evento = bruto.evento;
      if (evento !== "comment" && evento !== "approve" && evento !== "request_changes") throw new ArgumentoGithubInvalido("evento");
      // O GitHub recusa comment e request_changes sem corpo; approve aceita vazio.
      const texto = evento === "approve" && (bruto.texto === undefined || bruto.texto === "") ? null : validarTexto(bruto.texto, "texto");
      return { capacidade, alvo, numero: validarNumero(bruto.numero), evento, texto };
    }
    default:
      return { capacidade, alvo, numero: validarNumero(bruto.numero) };
  }
}

export type MigracaoDoComposio = {
  /** Nome antigo (GITHUB_*) → capacidades estáveis que a concessão passa a cobrir. */
  concessoes: Readonly<Record<string, readonly NomeCapacidadeGithub[]>>;
  /** "Sempre permitir": só o par EXATO de escrita; regra permanente nunca alarga (ADR-042). */
  permanentes: Readonly<Record<string, NomeCapacidadeGithub>>;
};

/**
 * definido em 2026-09-24 (ADR-048): ao trocar o `github` do Composio pelo nativo, os acessos que a
 * pessoa já tinha dado seguem valendo pelos nomes novos. A tabela COMPOSIO_POR_CAPACIDADE_GITHUB é
 * lida ao contrário e só o par EXATO migra.
 * revisto em 2026-09-25: ferramenta GITHUB_* sem par não vira mais o nível inteiro — "ver quem sou eu"
 * virava as 7 leituras (arquivo_ler inclusive) e "dar estrela" virava comentar em PR sem clique.
 * Sem par, a concessão fica sem capacidade e o agente pede com pedir_acesso. "Sempre permitir" só
 * migra o par exato de escrita.
 */
export function migracaoDoComposio(catalogoAntigo: readonly { nome: string; readOnlyHint: boolean }[]): MigracaoDoComposio {
  const direto = new Map<string, NomeCapacidadeGithub[]>();
  for (const [cap, slugs] of Object.entries(COMPOSIO_POR_CAPACIDADE_GITHUB) as [NomeCapacidadeGithub, readonly string[] | null][]) {
    for (const slug of slugs ?? []) direto.set(slug, [...(direto.get(slug) ?? []), cap]);
  }
  const escrita = CAPACIDADES_GITHUB.filter((c) => !c.readOnlyHint).map((c) => c.nome);
  const concessoes: Record<string, readonly NomeCapacidadeGithub[]> = {};
  const permanentes: Record<string, NomeCapacidadeGithub> = {};
  for (const antiga of catalogoAntigo) {
    const par = direto.get(antiga.nome);
    concessoes[antiga.nome] = par ?? [];
    const unico = par?.length === 1 ? par[0] : undefined;
    if (unico && escrita.includes(unico)) permanentes[antiga.nome] = unico;
  }
  return { concessoes, permanentes };
}
