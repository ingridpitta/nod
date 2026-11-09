import {
  APPS_MARKETPLACE,
  CATEGORIA_PADRAO,
  DESCRICAO_PADRAO,
  type AppComLogo,
} from "../contracts/marketplace.ts";

/** O que o provedor diz existir: só o mínimo que o `GET /auth_configs` garante. */
export type AppDoProvedor = { slug: string; nome: string; logo: string | null };

/**
 * definido em 2026-09-29 (ADR-057): um toolkit do catálogo público com login gerenciado pelo Composio —
 * conecta sem auth config no painel. Traz o que o `GET /toolkits` dá a mais: descrição e categorias, em inglês.
 */
export type AppGerenciado = AppDoProvedor & { descricao: string; categorias: readonly string[] };

const CURADORIA = new Map(APPS_MARKETPLACE.map((a) => [a.slug, a]));
const ORDEM = new Map(APPS_MARKETPLACE.map((a, i) => [a.slug, i]));

/**
 * definido em 2026-09-29 (ADR-057): o slug que vira conector. É o `SLUG` de
 * src/use-cases/registrar-conector.ts e o grupo das rotas `/marketplace/:slug/conectar|verificar`, com
 * o teto de 64 do provedor: toolkit com `_` no slug não cabe num conector, e botão que não conecta não
 * entra na grade.
 */
const SLUG_CONECTAVEL = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * definido em 2026-09-29 (ADR-057): a categoria do provedor em português, por palavra. A primeira linha
 * que casar ganha (por isso "Productivity & Project Management" vira Projetos); o que não casar com
 * nada cai em CATEGORIA_PADRAO. É só rótulo do cartão: errar aqui não muda o que o app faz.
 */
const CATEGORIAS: readonly (readonly [RegExp, string])[] = [
  [/developer|devops|engineering|\bcode\b|coding|database|monitoring|hosting/, "Desenvolvimento"],
  [/project|task|issue/, "Projetos"],
  [/communication|e-?mail|\bchat|messag|meeting|conferenc|phone|\bsms\b|telephony/, "Comunicação"],
  [/\bcrm\b|sales|marketing|advertis|\bseo\b|social/, "Vendas e marketing"],
  [/financ|accounting|payment|billing|invoic|bank/, "Finanças"],
  [/e-?commerce|shopping|retail/, "E-commerce"],
  [/document|knowledge|\bnotes?\b|wiki|\bfiles?\b|storage|content management/, "Conhecimento"],
  [/analytic|business intelligence|\bdata\b|spreadsheet|survey|\bforms?\b/, "Dados"],
  [/design|creative|image|video|media/, "Design e mídia"],
  [/support|help ?desk|customer service|ticket/, "Atendimento"],
  [/\bhr\b|human resources|recruit|hiring|talent/, "Pessoas"],
  [/\bai\b|artificial intelligence|machine learning|\bllm/, "IA"],
  [/security|identity|authentication|password/, "Segurança"],
  [/education|learning|course/, "Educação"],
  [/calendar|schedul|booking|productiv|automation|workflow|collaboration/, "Produtividade"],
];

export function categoriaEmPortugues(categorias: readonly string[]): string {
  for (const c of categorias) {
    const nome = c.toLowerCase();
    const achada = CATEGORIAS.find(([padrao]) => padrao.test(nome));
    if (achada) return achada[1];
  }
  return CATEGORIA_PADRAO;
}

/** A descrição do provedor cabe no cartão: um parágrafo, cortado na palavra. */
const TETO_DESCRICAO = 160;
function resumir(texto: string): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (limpo.length <= TETO_DESCRICAO) return limpo;
  const corte = limpo.slice(0, TETO_DESCRICAO);
  return `${corte.slice(0, corte.lastIndexOf(" ") > 0 ? corte.lastIndexOf(" ") : TETO_DESCRICAO).replace(/[\s,.;:]+$/, "")}…`;
}

/** Curadoria por cima; o que ela não diz, o catálogo público diz em inglês; o que nenhum diz, o padrão. */
function montar(p: AppDoProvedor, g: AppGerenciado | undefined): AppComLogo {
  const c = CURADORIA.get(p.slug);
  const descricao = g?.descricao ? resumir(g.descricao) : "";
  return {
    slug: p.slug,
    nome: c?.nome ?? p.nome,
    descricao: c?.descricao ?? (descricao || DESCRICAO_PADRAO),
    categoria: c?.categoria ?? (g ? categoriaEmPortugues(g.categorias) : CATEGORIA_PADRAO),
    // definido em 2026-09-24 ("rotina nasce com o acesso"): o card da rotina escreve o "Não inclui" curado.
    ...(c?.naoIncluiNaLeitura ? { naoIncluiNaLeitura: c.naoIncluiNaLeitura } : {}),
    logo: p.logo ?? g?.logo ?? null,
  };
}

/**
 * definido em 2026-09-21 (ADR-041): quem diz o que EXISTE é o provedor; quem diz como se CHAMA em
 * português é a curadoria. App configurado no painel e sem curadoria entra com o nome do provedor
 * e a descrição padrão — aparece torto, mas aparece, que é o ponto do ADR.
 *
 * A ordem é a da curadoria primeiro (o dia a dia conhecido), o resto em ordem alfabética: app novo
 * no painel entra no fim da grade, não no meio dela.
 *
 * revisto em 2026-09-29 (ADR-057): `gerenciados` é o catálogo público com login gerenciado pelo
 * Composio — conecta sem nada no painel. App curado que está ali (Notion, Linear, Sheets) volta para o
 * dia a dia; o resto entra depois de tudo, em ordem alfabética, marcado `doCatalogo`.
 */
export function mesclarCatalogo(doProvedor: readonly AppDoProvedor[], gerenciados: readonly AppGerenciado[] = []): AppComLogo[] {
  const doCatalogo = new Map<string, AppGerenciado>();
  for (const g of gerenciados) if (!doCatalogo.has(g.slug)) doCatalogo.set(g.slug, g);
  // definido em 2026-09-24 (ADR-048): app nativo entra mesmo sem auth config no provedor.
  const nativos = APPS_MARKETPLACE.filter((a) => a.nativo && !doProvedor.some((p) => p.slug === a.slug)).map((a) => ({ slug: a.slug, nome: a.nome, logo: null }));
  const doPainel = [...doProvedor, ...nativos];
  const noPainel = new Set(doPainel.map((p) => p.slug));
  const soNoCatalogo = [...doCatalogo.values()].filter((g) => !noPainel.has(g.slug) && SLUG_CONECTAVEL.test(g.slug));
  const doTime = [...doPainel, ...soNoCatalogo.filter((g) => CURADORIA.has(g.slug))].map((p) => montar(p, doCatalogo.get(p.slug)));
  const mais = soNoCatalogo.filter((g) => !CURADORIA.has(g.slug)).map((g) => ({ ...montar(g, g), doCatalogo: true as const }));
  const porNome = (a: AppComLogo, b: AppComLogo) => a.nome.localeCompare(b.nome, "pt-BR");
  doTime.sort((a, b) => {
    const ia = ORDEM.get(a.slug) ?? Infinity;
    const ib = ORDEM.get(b.slug) ?? Infinity;
    return ia !== ib ? ia - ib : porNome(a, b);
  });
  return [...doTime, ...mais.sort(porNome)];
}

/**
 * O piso: a curadoria inteira, sem logo. É o que a tela mostra quando não há chave configurada ou
 * quando a chamada ao provedor falha — catálogo velho é melhor que grade vazia, e a curadoria é a
 * única lista que não depende de rede.
 */
export function catalogoDoPiso(): AppComLogo[] {
  return APPS_MARKETPLACE.map((a) => ({ ...a, logo: null }));
}
