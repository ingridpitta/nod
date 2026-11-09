import type { Agente } from "../../src/contracts/agente.ts";
import type { CapacidadeConector, Conector } from "../../src/contracts/conector.ts";
import { falhaVisivel } from "../lib/fora-do-ar.ts";
import type { Estado } from "../estado/reducer.ts";
import { esc } from "../lib/render.ts";
import { avisoErro } from "../lib/card-proposta.ts";
import { acessosNaTela } from "../lib/acessos-otimistas.ts";

/**
 * O que o card do chat, o marketplace e o painel do bot dizem sobre um app (definido em 2026-09-25,
 * jornadas de conexão). A web só importa tipos de src/: o grupo de cada ação chega pronto de
 * GET /conectores (`grupo`, src/domain/grupos-de-acesso.ts) e o nível é a mesma regra daquele arquivo.
 */

export type Nivel = "nenhum" | "leitura" | "escrita";
/** O nível que o bot TEM num app; "personalizado" = ações dadas uma a uma que não formam um nível. */
export type NivelAtual = Nivel | "personalizado";
export type IdGrupo = NonNullable<CapacidadeConector["grupo"]>;
type Ctx = Pick<Estado, "conectores" | "marketplace" | "sessao">;

// Espelho de ROTULOS_GRUPO e GRUPOS_DA_ESCRITA (src/domain/grupos-de-acesso.ts): o Record não compila se faltar um grupo.
export const ROTULO_GRUPO: Record<IdGrupo, string> = { ler: "Ler", criar: "Criar e enviar", alterar: "Editar", comentar: "Comentar", outras: "Outras ações", apagar: "Apagar e desfazer" };
const ORDEM: readonly IdGrupo[] = ["ler", "criar", "alterar", "comentar", "outras", "apagar"];
const DA_ESCRITA: ReadonlySet<IdGrupo> = new Set<IdGrupo>(["ler", "criar", "alterar", "comentar"]);
export const ROTULO_NIVEL: Record<Nivel, string> = { nenhum: "Nenhum", leitura: "Ler", escrita: "Ler e alterar" };

export function nomeDoApp(ctx: Pick<Estado, "conectores" | "marketplace">, slug: string): string {
  return ctx.marketplace.find((a) => a.slug === slug)?.nome ?? ctx.conectores.find((c) => c.slug === slug)?.nome ?? slug;
}

/** O conector DESTA pessoa para o app (o habilitado, se houver dois registros). */
export function conectorDoApp(ctx: Ctx, slug: string): Conector | undefined {
  const meus = ctx.conectores.filter((c) => c.slug === slug && (!ctx.sessao || c.ownerId === ctx.sessao.pessoaId));
  return meus.find((c) => c.habilitado) ?? meus[0];
}

export type SituacaoApp = "nao_conectado" | "conectando" | "conectado" | "atencao";

/**
 * Um estado só por app (o marketplace mostrava ✓ e erro no mesmo cartão). A falha só vale se é MAIS
 * NOVA que a última sonda boa: um erro velho de rede não pinta de âmbar um app que já voltou.
 */
export function situacaoDoApp(estado: Ctx & Pick<Estado, "conectando">, slug: string): SituacaoApp {
  const c = conectorDoApp(estado, slug);
  if (estado.conectando[slug] && !estado.conectando[slug]?.falhou) return "conectando";
  if (!c) return "nao_conectado";
  // NOD-374 (revisão 2 do PR #538): a sonda boa limpa a falha no servidor, e a falha que persiste guarda o começo dela
  // (anterior à última sonda): `falhaVisivel` é o critério, sem comparar com `sondadoEm`.
  const falhaNova = c.ultimaFalha && falhaVisivel(c);
  if (falhaNova) return "atencao";
  return c.habilitado ? "conectado" : c.sondadoEm ? "atencao" : "nao_conectado";
}

/** Sem o grupo vindo do servidor, fecha: leitura só se a sonda disse; o resto não entra em nível nenhum. */
function grupoDe(cap: Pick<CapacidadeConector, "readOnlyHint" | "grupo">): IdGrupo {
  return cap.grupo ?? (cap.readOnlyHint ? "ler" : "outras");
}

/** Mesma regra de capacidadesDoNivel (src/domain/grupos-de-acesso.ts). */
export function capacidadesDoNivel(catalogo: readonly CapacidadeConector[], nivel: Nivel): string[] {
  if (nivel === "nenhum") return [];
  return catalogo.filter((c) => (nivel === "leitura" ? grupoDe(c) === "ler" : DA_ESCRITA.has(grupoDe(c)))).map((c) => c.nome);
}

const mesmoConjunto = (a: ReadonlySet<string>, b: readonly string[]): boolean => a.size === b.length && b.every((x) => a.has(x));

/**
 * O nível que o bot tem, só se o conjunto concedido É um nível (revisto em 2026-09-25, revisão do PR #68):
 * uma ação de escrita dada pela rotina não pinta "Ler e alterar" como ativo — clicar nele concederia o resto.
 */
export function nivelDoBot(estado: Pick<Estado, "concessoes">, agenteId: string, conector: Conector): NivelAtual {
  // ADA-241: o clique ainda sem resposta (ou à espera da recarga) aparece na hora — web/lib/acessos-otimistas.ts.
  return acessosNaTela.nivel({ agenteId, conectorId: conector.id }, nivelReal(estado, agenteId, conector), Date.now());
}

/** O nível que as concessões carregadas dizem (sem o clique otimista). */
export function nivelReal(estado: Pick<Estado, "concessoes">, agenteId: string, conector: Conector): NivelAtual {
  const concedidas = new Set((estado.concessoes[agenteId] ?? []).filter((g) => g.conectorId === conector.id).map((g) => g.capacidade));
  if (concedidas.size === 0) return "nenhum";
  if (mesmoConjunto(concedidas, capacidadesDoNivel(conector.catalogo, "leitura"))) return "leitura";
  if (mesmoConjunto(concedidas, capacidadesDoNivel(conector.catalogo, "escrita"))) return "escrita";
  return "personalizado";
}

export function botsQueUsam(estado: Pick<Estado, "concessoes" | "frota" | "sessao">, conector: Conector): { agente: Agente; nivel: NivelAtual }[] {
  return meusBots(estado).map((agente) => ({ agente, nivel: nivelDoBot(estado, agente.id, conector) })).filter((b) => b.nivel !== "nenhum");
}

export function meusBots(estado: Pick<Estado, "frota" | "sessao">): Agente[] {
  return (estado.frota?.agentes ?? []).filter((a) => a.ownerId === estado.sessao?.pessoaId && a.confirmado);
}

/** Os grupos de um conjunto de ações, na ordem fixa: "Ler · 12 ações". */
export function gruposDe(catalogo: readonly CapacidadeConector[], nomes: readonly string[]): { id: IdGrupo; rotulo: string; capacidades: string[] }[] {
  const por = new Map<IdGrupo, string[]>();
  const porNome = new Map(catalogo.map((c) => [c.nome, c]));
  for (const n of nomes) {
    const cap = porNome.get(n);
    const g = cap ? grupoDe(cap) : "outras";
    por.set(g, [...(por.get(g) ?? []), n]);
  }
  return ORDEM.filter((g) => por.has(g)).map((g) => ({ id: g, rotulo: ROTULO_GRUPO[g], capacidades: por.get(g) ?? [] }));
}

export const acoes = (n: number): string => `${n} ${n === 1 ? "ação" : "ações"}`;

/**
 * O que o nível deixa o bot fazer e o que fica de fora, em frases — antes do login não há catálogo, então
 * a frase é do nível; o "não inclui" curado (naoIncluiNaLeitura) ganha da genérica.
 */
export function podeENao(ctx: Pick<Estado, "conectores" | "marketplace">, slug: string, nivel: "leitura" | "escrita", naoPedido: readonly string[] = []): { pode: string[]; nao: string[] } {
  const nome = nomeDoApp(ctx, slug);
  const curado = ctx.marketplace.find((m) => m.slug === slug)?.naoIncluiNaLeitura;
  if (nivel === "leitura") {
    const nao = curado?.length ? [`Não inclui: ${curado.join(", ")}`] : [`Não cria, altera nem apaga nada no ${nome}`];
    return { pode: [`Ver e ler o que está no ${nome}`], nao: [...nao, ...naoPedido.map((n) => `Não inclui: ${n}`)] };
  }
  return { pode: [`Ler, criar, editar e comentar no ${nome}`], nao: ["Apagar, desfazer e outras ações ficam de fora", ...naoPedido.map((n) => `Não inclui: ${n}`)] };
}

const CHECK = '<svg class="ic-ok" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7"></path></svg>';
const XIS = '<svg class="ic-nao" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"></path></svg>';
export const SETA_EXTERNA = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h7v7M13 3 5 11"></path></svg>';
export const GIRO = '<span class="giro" aria-hidden="true"></span>';
export { CHECK as ICONE_OK };

export function listaPodeENao(pn: { pode: string[]; nao: string[] }): string {
  return `<ul class="pode-nao">${pn.pode.map((t) => `<li>${CHECK}${esc(t)}</li>`).join("")}${pn.nao.map((t) => `<li class="nao">${XIS}${esc(t)}</li>`).join("")}</ul>`;
}

/** Os dois passos do card: 1 entrar no app, 2 permitir ao bot. */
export function passos(app: string, bot: string, ativo: 1 | 2): string {
  const passo = (n: 1 | 2, rotulo: string) => {
    const estado = n < ativo ? "feito" : n === ativo ? "ativo" : "depois";
    return `<li class="passo passo-${estado}"><span class="passo-num">${n < ativo ? CHECK : n}</span>${esc(rotulo)}</li>`;
  };
  return `<ol class="passos" aria-label="Passos">${passo(1, `Entrar no ${app}`)}${passo(2, `Permitir ao ${bot}`)}</ol>`;
}

/** O bloco "esperando você entrar" (card do chat, gaveta e cartão do marketplace). */
/**
 * `semJanela` (revisão do PR #264, NOD-208): a janela não abriu. Sem o link, o card curto ficava girando até o
 * prazo de 10 min sem caminho para entrar — o caso comum do "Tentar de novo" depois da re-sonda.
 * definido em 2026-10-12 (GFK-2019): o desktop também mantém o link, porque não confirma a abertura externa.
 */
export function blocoEsperando(nome: string, url: string | null, curto = false, semJanela = false): string {
  const abrir = (texto: string) => `<a class="link" href="${esc(url ?? "")}" target="_blank" rel="noopener noreferrer">${texto} ${SETA_EXTERNA}</a>`;
  if (semJanela && url) {
    return curto
      ? `<div class="esperando esperando-curto">${GIRO}<span>Esperando você entrar no ${esc(nome)}…</span></div>${abrir("Abrir o login")}`
      : `<div class="esperando">${GIRO}<div><b>Esperando você entrar no ${esc(nome)}</b><p>Se a janela de login não abriu, use o link. Quando terminar, isto continua sozinho.</p>${abrir("Abrir o login")}</div></div>`;
  }
  const link = url ? abrir("Abrir o login de novo") : "";
  // Sem URL ainda (o conectar em voo ou a re-sonda da NOD-208, que pode levar 20 s sem janela): nada de "está aberta".
  const frase = url ? "A janela de login está aberta. Quando terminar, isto continua sozinho." : `Preparando o login do ${esc(nome)}.`;
  return curto
    ? `<div class="esperando esperando-curto">${GIRO}<span>Esperando você entrar no ${esc(nome)}…</span></div>`
    : `<div class="esperando">${GIRO}<div><b>Esperando você entrar no ${esc(nome)}</b><p>${frase}</p>${link}</div></div>`;
}

export function blocoFalhou(frase: string, acoes = "", mais?: string): string {
  // NOD-399 (definido em 2026-10-30): o aviso neutro do componente comum — círculo vermelho com "!" e a frase, nunca o
  // texto em vermelho. Solto: dentro de um card, gaveta ou lista, sem caixa própria.
  return avisoErro({ frase, acoes, solto: true, classe: "conexao-falhou", ...(mais ? { mais } : {}) });
}

/**
 * Um checkbox por grupo do pedido (revisão do PR #68: no chat E em "Sua vez"). O input fica sob
 * [data-decisao] para o render preservar a marcação (main.ts); "permitir-acesso" manda só os marcados.
 * Um grupo só não tem o que desmarcar: devolve "".
 */
export function checkboxesDosGrupos(catalogo: readonly CapacidadeConector[], capacidades: readonly string[]): string {
  const grupos = gruposDe(catalogo, capacidades);
  if (grupos.length <= 1) return "";
  return `<div class="ac-grupos">${grupos.map((g) => `<label class="ac-grupo"><input type="checkbox" data-item="grupo-${esc(g.id)}" data-caps="${esc(g.capacidades.join(","))}" checked /><span><b>${esc(g.rotulo)}</b><small>${esc(acoes(g.capacidades.length))}</small></span></label>`).join("")}</div>`;
}
