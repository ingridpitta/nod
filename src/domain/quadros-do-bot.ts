import type { PayloadPropostaQuadroExclusao } from "../contracts/quadro-exclusao.ts";
import { LIMITES_QUADROS, NOME_QUADRO_PADRAO, type OpQuadrosDoBot } from "../contracts/quadros-do-bot.ts";

/**
 * ADA-14 (ADR-153): os quadros de um bot, puro. Qual abre, quem vira padrão, nome e projeto válidos, achar pelo nome e o
 * progresso do projeto. Sem banco nem relógio: quem chama passa o que leu.
 */

/** A chave que decide "é o mesmo nome": sem caixa, sem acento, espaços colapsados ("Operação" = " operacao "). */
export function chaveDoNome(nome: string): string {
  return nome.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** O nome como fica gravado: sem espaços nas pontas nem em sequência. */
export function limparNome(nome: string): string {
  return nome.replace(/\s+/g, " ").trim();
}

/** O título do card: "Excluir o quadro "Site" do Ana" (o sem nome, ou o card de antes, segue "o quadro do Ana"). */
export function tituloDaExclusaoDoQuadro(c: Pick<PayloadPropostaQuadroExclusao, "anfitriaoNome" | "quadroNome">): string {
  return c.quadroNome ? `Excluir o quadro "${c.quadroNome}" do ${c.anfitriaoNome}` : `Excluir o quadro do ${c.anfitriaoNome}`;
}

/** O nome que a tela e o chat mostram. */
export function nomeDoQuadro(q: { nome: string | null }): string {
  return q.nome ?? NOME_QUADRO_PADRAO;
}

/** O nome do quadro pedido: null tira (vira "Tarefas"); "" também. Erro com a frase para o bot. */
export function validarNomeQuadro(v: unknown): { nome: string | null } | { erro: string } {
  if (v === null) return { nome: null };
  if (typeof v !== "string") return { erro: "nome do quadro não é texto" };
  const limpo = limparNome(v);
  if (limpo === "") return { nome: null };
  if (limpo.length > LIMITES_QUADROS.nome) return { erro: `nome do quadro passa de ${LIMITES_QUADROS.nome} caracteres` };
  if (limpo.includes("/")) return { erro: "nome do quadro não pode ter / (é o separador de Bot/Quadro)" };
  return { nome: limpo };
}

/** O nome de um projeto (obrigatório). */
export function validarNomeProjeto(v: unknown): { nome: string } | { erro: string } {
  if (typeof v !== "string") return { erro: "nome do projeto não é texto" };
  const limpo = limparNome(v);
  if (limpo === "") return { erro: "nome do projeto vazio" };
  if (limpo.length > LIMITES_QUADROS.nome) return { erro: `nome do projeto passa de ${LIMITES_QUADROS.nome} caracteres` };
  return { nome: limpo };
}

/** O quadro que o app Quadro abre: o último aberto neste bot, se ainda vinculado; senão o padrão; senão o primeiro. */
export function quadroAoAbrir(vinculados: readonly { id: string; padrao: boolean }[], ultimoAberto: string | null | undefined): string | null {
  if (ultimoAberto && vinculados.some((q) => q.id === ultimoAberto)) return ultimoAberto;
  return (vinculados.find((q) => q.padrao) ?? vinculados[0])?.id ?? null;
}

/**
 * Quem vira padrão quando o padrão sai (removido ou desvinculado): o próximo pela posição, depois o mais recente. null =
 * não sobrou nenhum (o bot volta a agente comum).
 */
export function proximoPadrao<T extends { quadroId: string; posicao: number; criadoEm: number }>(vinculos: readonly T[], saindo: string): T | null {
  const resto = vinculos.filter((v) => v.quadroId !== saindo);
  resto.sort((a, b) => a.posicao - b.posicao || b.criadoEm - a.criadoEm || a.quadroId.localeCompare(b.quadroId));
  return resto[0] ?? null;
}

/** O novo dono quando o dono sai do quadro (desvincular ou excluir o bot): o próximo vínculo pela posição. */
export function proximoDono<T extends { agenteId: string; posicao: number; criadoEm: number }>(vinculos: readonly T[], saindo: string): T | null {
  const resto = vinculos.filter((v) => v.agenteId !== saindo);
  resto.sort((a, b) => a.posicao - b.posicao || a.criadoEm - b.criadoEm || a.agenteId.localeCompare(b.agenteId));
  return resto[0] ?? null;
}

/**
 * Acha um quadro pelo nome (pela chave; "Tarefas" acha o sem nome). Também aceita o prefixo (ZE). Vários com o mesmo nome
 * = ambíguo (o bot pergunta em qual, com bot e prefixo).
 */
export function acharPorNome<T extends { nome: string | null; prefixo: string | null }>(ref: string, quadros: readonly T[]): { um: T } | { varios: T[] } | null {
  const chave = chaveDoNome(ref);
  if (chave === "") return null;
  const porNome = quadros.filter((q) => chaveDoNome(nomeDoQuadro(q)) === chave);
  if (porNome.length === 1) return { um: porNome[0]! };
  if (porNome.length > 1) return { varios: porNome };
  const porPrefixo = quadros.filter((q) => q.prefixo !== null && q.prefixo.toLowerCase() === chave);
  return porPrefixo.length === 1 ? { um: porPrefixo[0]! } : null;
}

/** "Bot/Quadro": separa o nome do bot e o do quadro (só com uma barra e os dois lados preenchidos). */
export function separarBotEQuadro(ref: string): { bot: string; quadro: string } | null {
  const partes = ref.split("/");
  if (partes.length !== 2) return null;
  const [bot, quadro] = partes.map((p) => p.trim()) as [string, string];
  return bot && quadro ? { bot, quadro } : null;
}

/** O progresso do projeto: só dos quadros com meta (a regra do quadro, ADR-141); null se nenhum tem. */
export function progressoDoProjeto(quadros: readonly { meta: string | null; feitas: number; total: number }[]): { feitas: number; total: number } | null {
  const comMeta = quadros.filter((q) => q.meta !== null);
  if (comMeta.length === 0) return null;
  return comMeta.reduce((s, q) => ({ feitas: s.feitas + q.feitas, total: s.total + q.total }), { feitas: 0, total: 0 });
}

/**
 * Os grupos do seletor: os projetos ativos em ordem (posição, nome) com os quadros deles, e no fim "Sem projeto" (os soltos
 * e os de projeto arquivado). Projeto ativo sem quadro aparece vazio (a pessoa acabou de criar).
 */
export function agruparPorProjeto<Q extends { projetoId: string | null; nome: string }, P extends { id: string; nome: string; posicao: number; arquivadoEm: number | null }>(
  quadros: readonly Q[],
  projetos: readonly P[],
): { projeto: P | null; quadros: Q[] }[] {
  const ativos = projetos.filter((p) => p.arquivadoEm === null).sort((a, b) => a.posicao - b.posicao || a.nome.localeCompare(b.nome, "pt-BR"));
  const ids = new Set(ativos.map((p) => p.id));
  const porNome = (a: Q, b: Q) => a.nome.localeCompare(b.nome, "pt-BR");
  const grupos: { projeto: P | null; quadros: Q[] }[] = ativos.map((p) => ({ projeto: p, quadros: quadros.filter((q) => q.projetoId === p.id).sort(porNome) }));
  const soltos = quadros.filter((q) => q.projetoId === null || !ids.has(q.projetoId));
  if (soltos.length) grupos.push({ projeto: null, quadros: [...soltos].sort(porNome) });
  return grupos;
}

const texto = (v: unknown, campo: string, max: number, obrigatorio: boolean): string | undefined | { erro: string } => {
  if (v === undefined || v === null || v === "") return obrigatorio ? { erro: `${campo} é obrigatório` } : undefined;
  if (typeof v !== "string") return { erro: `${campo} deve ser texto` };
  const t = v.trim();
  if (t.length === 0) return obrigatorio ? { erro: `${campo} é obrigatório` } : undefined;
  return t.length > max ? { erro: `${campo} passa de ${max} caracteres` } : t;
};
const ehErro = (v: unknown): v is { erro: string } => typeof v === "object" && v !== null && "erro" in v;
const PRAZO = /^\d{4}-\d{2}-\d{2}$/;

/** Uma op dos N quadros vinda da ferramenta ou da tela (sem tipo confiável). Os tetos são os de LIMITES_QUADROS. */
export function lerOpQuadrosDoBot(v: unknown): OpQuadrosDoBot | { erro: string } {
  if (typeof v !== "object" || v === null) return { erro: "a ação deve ser um objeto" };
  const o = v as Record<string, unknown>;
  const ref = (campo: "quadro" | "bot" | "projeto") => texto(o[campo], campo, 200, true);
  const metaPrazo = (): { meta?: string | null; prazo?: string | null } | { erro: string } => {
    const r: { meta?: string | null; prazo?: string | null } = {};
    if (o.meta !== undefined) {
      const m = o.meta === null ? null : texto(o.meta, "meta", LIMITES_QUADROS.metaProjeto, false);
      if (ehErro(m)) return m;
      r.meta = m ?? null;
    }
    if (o.prazo !== undefined) {
      if (o.prazo !== null && o.prazo !== "" && (typeof o.prazo !== "string" || !PRAZO.test(o.prazo))) return { erro: "prazo fora do formato AAAA-MM-DD" };
      r.prazo = o.prazo === "" ? null : (o.prazo as string | null);
    }
    return r;
  };
  switch (o.tipo) {
    case "listar_quadros":
      return { tipo: "listar_quadros", ...(o.todos === true ? { todos: true } : {}) };
    case "abrir_quadro": {
      const quadro = ref("quadro");
      return ehErro(quadro) ? quadro : { tipo: "abrir_quadro", quadro: quadro! };
    }
    case "definir_padrao": {
      const quadro = ref("quadro");
      if (ehErro(quadro)) return quadro;
      const bot = texto(o.bot, "bot", 200, false);
      if (ehErro(bot)) return bot;
      return { tipo: "definir_padrao", quadro: quadro!, ...(bot ? { bot } : {}) };
    }
    case "vincular_bot":
    case "desvincular_bot": {
      const quadro = ref("quadro");
      if (ehErro(quadro)) return quadro;
      const bot = ref("bot");
      if (ehErro(bot)) return bot;
      return { tipo: o.tipo, quadro: quadro!, bot: bot! };
    }
    case "criar_projeto":
    case "editar_projeto": {
      const nome = o.nome === undefined && o.tipo === "editar_projeto" ? undefined : validarNomeProjeto(o.nome);
      if (nome && "erro" in nome) return nome;
      const descricao = texto(o.descricao, "descricao", LIMITES_QUADROS.descricaoProjeto, false);
      if (ehErro(descricao)) return descricao;
      const mp = metaPrazo();
      if (ehErro(mp)) return mp;
      const extra = { ...(descricao !== undefined ? { descricao } : o.descricao === "" ? { descricao: "" } : {}), ...mp };
      if (o.tipo === "criar_projeto") return { tipo: "criar_projeto", nome: nome!.nome, ...extra };
      const projeto = ref("projeto");
      if (ehErro(projeto)) return projeto;
      return { tipo: "editar_projeto", projeto: projeto!, ...(nome ? { nome: nome.nome } : {}), ...extra };
    }
    case "arquivar_projeto":
    case "restaurar_projeto": {
      const projeto = ref("projeto");
      return ehErro(projeto) ? projeto : { tipo: o.tipo, projeto: projeto! };
    }
    default:
      return { erro: `tipo desconhecido: ${String(o.tipo)}` };
  }
}
