import type { ItemDaBiblioteca, PaginaDaBiblioteca } from "../../src/contracts/biblioteca.ts";

/**
 * NOD-326: a Biblioteca da gaveta do bot — os arquivos e mídias que o bot criou na conversa, do mais novo ao mais antigo,
 * em três grupos no relógio da pessoa. Puro (sem DOM): o reducer guarda as páginas e a tela desenha os grupos.
 */

export type GrupoBiblioteca = "hoje" | "semana" | "antigos";
export const GRUPOS_BIBLIOTECA: readonly GrupoBiblioteca[] = ["hoje", "semana", "antigos"];
export const ROTULO_GRUPO: Readonly<Record<GrupoBiblioteca, string>> = { hoje: "Hoje", semana: "Últimos 7 dias", antigos: "Mais antigos" };
/** Quantos itens cada grupo mostra de início, e quantos mais a cada "Mostrar mais". */
export const POR_VEZ = 5;

/** O que a gaveta guarda da Biblioteca de uma conversa: as páginas lidas, juntas, e o cursor da próxima. */
export type BibliotecaDaConversa = {
  itens: ItemDaBiblioteca[];
  proximo: string | null;
  /** A primeira leitura falhou (a tela mostra Tentar de novo); a de uma página seguinte falhou (o "Mostrar mais" volta). */
  erro: boolean;
  carregandoMais: boolean;
  /** A última página seguinte falhou: o rodapé mostra o aviso e o botão vira Tentar de novo. */
  falhouMais?: boolean;
  /** Quantos itens cada grupo mostra; ausente = POR_VEZ. */
  mostrando: Partial<Record<GrupoBiblioteca, number>>;
};

/** A meia-noite local do dia de `agora`, menos `dias` dias (setDate atravessa o horário de verão sem errar o dia). */
function meiaNoiteMenos(agora: number, dias: number): number {
  const d = new Date(agora);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - dias);
  return d.getTime();
}

/** Hoje = desde a meia-noite local; Últimos 7 dias = os 6 dias antes de hoje; o resto, Mais antigos. */
export function grupoDe(criadoEm: string, agora: number): GrupoBiblioteca {
  const t = Date.parse(criadoEm);
  if (t >= meiaNoiteMenos(agora, 0)) return "hoje";
  if (t >= meiaNoiteMenos(agora, 6)) return "semana";
  return "antigos";
}

export type GrupoVisivel = { grupo: GrupoBiblioteca; itens: ItemDaBiblioteca[]; total: number; maisLocal: boolean; maisNoServidor: boolean };

/**
 * Os grupos que aparecem (o vazio some), cada um com os itens à vista. "Mostrar mais" aparece quando o grupo tem mais
 * itens já lidos, ou quando é o último grupo e o servidor tem a próxima página (os mais antigos chegam sempre no fim).
 */
export function gruposVisiveis(b: Pick<BibliotecaDaConversa, "itens" | "proximo" | "mostrando">, agora: number): GrupoVisivel[] {
  const por = new Map<GrupoBiblioteca, ItemDaBiblioteca[]>();
  for (const i of b.itens) {
    const g = grupoDe(i.criadoEm, agora);
    por.set(g, [...(por.get(g) ?? []), i]);
  }
  const presentes = GRUPOS_BIBLIOTECA.filter((g) => (por.get(g)?.length ?? 0) > 0);
  return presentes.map((grupo, k) => {
    const todos = por.get(grupo)!;
    const n = Math.max(POR_VEZ, b.mostrando[grupo] ?? POR_VEZ);
    const maisLocal = todos.length > n;
    return { grupo, itens: todos.slice(0, n), total: todos.length, maisLocal, maisNoServidor: !maisLocal && k === presentes.length - 1 && b.proximo !== null };
  });
}

/** A chave de ordem do servidor: instante (com µs, texto de largura fixa) e id; maior = mais recente. */
const depois = (a: ItemDaBiblioteca, b: ItemDaBiblioteca): boolean => a.criadoEm > b.criadoEm || (a.criadoEm === b.criadoEm && a.id > b.id);

/**
 * Junta a página lida ao que já havia. A primeira página (releitura ao vivo) traz o que é novo sem perder o que a pessoa
 * já carregou com "Mostrar mais": fica o que é mais antigo que o fim da página nova, e o cursor de antes. A página
 * seguinte (`antes`) entra no fim.
 */
export function juntarPagina(antes: BibliotecaDaConversa | undefined, pagina: PaginaDaBiblioteca, seguinte: boolean): BibliotecaDaConversa {
  // A releitura não encerra o "Mostrar mais" que está a caminho (a página seguinte ainda vai chegar e juntar).
  const base = { erro: false, carregandoMais: seguinte ? false : antes?.carregandoMais ?? false, falhouMais: false, mostrando: antes?.mostrando ?? {} };
  if (seguinte && antes) {
    const vistos = new Set(antes.itens.map((i) => i.id));
    return { ...base, itens: [...antes.itens, ...pagina.itens.filter((i) => !vistos.has(i.id))], proximo: pagina.proximo };
  }
  const fim = pagina.itens.at(-1);
  if (!antes || !fim || pagina.proximo === null) return { ...base, itens: pagina.itens, proximo: pagina.proximo };
  // Revisão 2 (alto): sem nada em comum com o que havia, entre a página nova e o guardado pode haver itens que nenhuma
  // das duas tem; a lista recomeça da página nova (com o cursor dela), para não sumir arquivo sem aviso.
  const novos = new Set(pagina.itens.map((i) => i.id));
  // A página seguinte a caminho foi pedida com o cursor antigo: sem `carregandoMais`, ela é descartada ao chegar (revisão 3).
  if (!antes.itens.some((i) => novos.has(i.id))) return { ...base, carregandoMais: false, itens: pagina.itens, proximo: pagina.proximo, mostrando: {} };
  const resto = antes.itens.filter((i) => !novos.has(i.id) && depois(fim, i));
  return { ...base, itens: [...pagina.itens, ...resto], proximo: resto.length > 0 ? antes.proximo : pagina.proximo };
}

/**
 * Revisão 2: a resposta que chega depois de trocar a sessão (outra pessoa, ou o login de novo) não vale. `vigente` é
 * conferido DEPOIS da leitura; a falha da leitura vira null (a tela mostra o erro, sem faixa vermelha).
 */
export async function lerSeAindaVale<T>(ler: () => Promise<T>, vigente: () => boolean): Promise<{ vale: true; valor: T | null } | { vale: false }> {
  const valor = await ler().catch(() => null);
  return vigente() ? { vale: true, valor } : { vale: false };
}
