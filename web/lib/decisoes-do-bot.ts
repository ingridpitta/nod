import type { ContagemDasDecisoes, DecisaoDto, DesfechoDaDecisao } from "../../src/contracts/decisoes-do-bot.ts";

/**
 * A aba Decisões da Atividade do bot (definido em 2026-10-29, NOD-70; protótipo v2, W2/C2): cada decisão de autorização
 * do dia — permitida, negada ou cartão — com a regra que decidiu. Aqui só o que é puro: os filtros, o símbolo do desfecho,
 * as repetições em "N vezes", o período e o nome do CSV. O HTML mora em web/telas/atividade.ts; a frase da regra vem
 * pronta do servidor (`GET agentes/:id/decisoes`). A web não importa valor do domínio (ADR-018): o nome do arquivo repete
 * `nomeDoCsv` de src/domain/decisoes.ts, e o teste confere os dois.
 */

export type FiltroDecisoes = "tudo" | DesfechoDaDecisao;

export const FILTROS_DAS_DECISOES: readonly { filtro: FiltroDecisoes; rotulo: string }[] = [
  { filtro: "tudo", rotulo: "Tudo" },
  { filtro: "permitida", rotulo: "Permitidas" },
  { filtro: "negada", rotulo: "Negadas" },
  { filtro: "cartao", rotulo: "Cartões" },
];

export function ehFiltroDecisoes(x: string | undefined): x is FiltroDecisoes {
  return FILTROS_DAS_DECISOES.some((f) => f.filtro === x);
}

/** O desfecho à direita da linha: símbolo e palavra, sem cor própria (✕ em tinta 600, ✓ em tinta 3, ◇ em tinta 2). */
export const DESFECHO: Readonly<Record<DesfechoDaDecisao, { simbolo: string; rotulo: string }>> = {
  negada: { simbolo: "✕", rotulo: "Negada" },
  permitida: { simbolo: "✓", rotulo: "Permitida" },
  cartao: { simbolo: "◇", rotulo: "Cartão" },
};

/** A frase do vazio com filtro ("Nada negado neste dia." + Ver tudo). */
export const VAZIO_DO_FILTRO: Readonly<Record<FiltroDecisoes, string>> = {
  tudo: "Nenhuma decisão neste dia.",
  permitida: "Nada permitido neste dia.",
  negada: "Nada negado neste dia.",
  cartao: "Nenhum cartão neste dia.",
};

/** "2 decisões negadas hoje": o que o leitor de tela ouve ao trocar de filtro. */
export function anuncioDoFiltro(filtro: FiltroDecisoes, contagem: ContagemDasDecisoes, rotuloDoDia: string): string {
  const n = totalDoFiltro(contagem, filtro);
  const qual = filtro === "tudo" ? "" : ` ${n === 1 ? { permitida: "permitida", negada: "negada", cartao: "que virou cartão" }[filtro] : { permitida: "permitidas", negada: "negadas", cartao: "que viraram cartão" }[filtro]}`;
  return `${n} ${n === 1 ? "decisão" : "decisões"}${qual} · ${rotuloDoDia.toLowerCase()}`;
}

export function totalDoFiltro(c: ContagemDasDecisoes, filtro: FiltroDecisoes): number {
  return filtro === "tudo" ? c.permitida + c.negada + c.cartao : c[filtro];
}

/** A página do dia guardada na tela: as linhas já carregadas, a contagem do dia e o cursor da próxima. */
export type PaginaDasDecisoes = { linhas: DecisaoDto[]; contagem: ContagemDasDecisoes; proximo: string | null; haAntes: boolean; carregandoMais: boolean; erroMais: boolean };

export const chaveDasDecisoes = (agenteId: string, dia: string, filtro: FiltroDecisoes): string => `${agenteId}:${dia}:${filtro}`;

// Repetições (só na tela; o CSV lista todas): linhas seguidas com a mesma ferramenta, desfecho, regra e motivo em até
// 10 min viram uma linha com "N vezes" (decisão do plano de 29/10, lacuna 4 do protótipo).
export const JANELA_REPETICAO_MS = 10 * 60_000;

export type GrupoDeDecisoes = { linha: DecisaoDto; vezes: number; ids: string[] };

export function agruparRepeticoes(linhas: readonly DecisaoDto[]): GrupoDeDecisoes[] {
  const grupos: GrupoDeDecisoes[] = [];
  let ultimoEm = 0;
  for (const l of linhas) {
    const g = grupos[grupos.length - 1];
    const em = Date.parse(l.em);
    const igual = g && g.linha.ferramenta === l.ferramenta && g.linha.desfecho === l.desfecho && g.linha.regra === l.regra && g.linha.motivo === l.motivo;
    if (g && igual && Math.abs(ultimoEm - em) <= JANELA_REPETICAO_MS) {
      g.vezes += 1;
      g.ids.push(l.id);
    } else {
      grupos.push({ linha: l, vezes: 1, ids: [l.id] });
    }
    ultimoEm = em;
  }
  return grupos;
}

/** "App · ação" legível: `create_issue` → "create issue"; o app do catálogo com a inicial maiúscula. */
export function oQueTentou(l: Pick<DecisaoDto, "app" | "acao">): string {
  const app = l.app ? l.app.charAt(0).toUpperCase() + l.app.slice(1) : "";
  const acao = l.acao.replaceAll("_", " ").toLowerCase();
  return app && acao ? `${app} · ${acao}` : app || acao;
}

// Exportar CSV: Este dia / Últimos 7 dias / Últimos 30 dias, contados a partir do dia aberto, com o filtro da lista.

export type PeriodoDoCsv = 1 | 7 | 30;

export const PERIODOS_DO_CSV: readonly { dias: PeriodoDoCsv; rotulo: string }[] = [
  { dias: 1, rotulo: "Este dia" },
  { dias: 7, rotulo: "Últimos 7 dias" },
  { dias: 30, rotulo: "Últimos 30 dias" },
];

export function ehPeriodoDoCsv(n: number): n is PeriodoDoCsv {
  return n === 1 || n === 7 || n === 30;
}

/** O estado do Exportar CSV: as opções abertas, o arquivo saindo, o baixado (linha quieta) e o erro (Tentar de novo). */
export type ExportarCsv = { periodo: PeriodoDoCsv; fase: "opcoes" | "gerando" | "baixado" | "erro"; previa: number | null; linhas: number | null; cortado?: boolean };

/** O período [de, ate] do CSV terminando no dia aberto. */
export function periodoDoCsv(dia: string, dias: number): { de: string; ate: string } {
  const [a, m, d] = dia.split("-").map(Number);
  const de = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, (d ?? 1) - (dias - 1))).toISOString().slice(0, 10);
  return { de, ate: dia };
}

/** O dia antes de `dia` (AAAA-MM-DD), para o "Dia anterior" das Decisões. */
export function diaAnterior(dia: string): string {
  return periodoDoCsv(dia, 2).de;
}

/** O mesmo nome que o servidor manda no Content-Disposition (`nomeDoCsv`, src/domain/decisoes.ts). */
export function nomeDoCsv(bot: string, de: string, ate: string): string {
  const slug = bot.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bot";
  return `decisoes-${slug}-${de === ate ? de : `${de}_${ate}`}.csv`;
}

/** O fuso no rodapé das opções: "horário de Brasília" para São Paulo; outro fuso pelo nome. */
export function rotuloDoFuso(fuso: string): string {
  return fuso === "America/Sao_Paulo" ? "horário de Brasília" : `fuso ${fuso.replaceAll("_", " ")}`;
}

/** O passo do deslize no celular: para a esquerda, o dia anterior; para a direita, o seguinte (nunca depois de hoje). */
export function diaDoDeslize(dx: number, dy: number, limite = 60): -1 | 1 | 0 {
  if (Math.abs(dx) < limite || Math.abs(dy) > Math.abs(dx) / 2) return 0;
  return dx < 0 ? -1 : 1;
}
