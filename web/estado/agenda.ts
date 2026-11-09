import type { AgendaDto } from "../../src/contracts/agenda.ts";
import { dentro, diaValido, janelaDe } from "../lib/agenda.ts";

/**
 * NOD-85: o estado da agenda das rotinas (Configurações › Rotinas). `janela` é o que se pede ao servidor (dias do
 * navegador, `ate` exclusivo); `dto` o que chegou dela. A UI guarda o que está aberto e o filtro; `alvo` é o dia até onde
 * rolar no próximo desenho (o main rola e limpa), `null` com `rolarAgora` = abrir no agora.
 */
export type AgendaUi = {
  /** A linha aberta no lugar (computador) ou na folha de baixo (celular). Uma por vez. */
  aberto: string | null;
  /** Celular: a linha segurada, com o menu de contexto. */
  menu: string | null;
  bots: string[];
  soProblema: boolean;
  alvo: string | null;
  rolarAgora: boolean;
  /** "AAAA-MM" do mini mês aberto; null = fechado. */
  mes: string | null;
  /** A busca de bots (com 6 ou mais); null = fechada. */
  busca: string | null;
  pausadasAbertas: boolean;
  /** O dia em foco: a semana da régua e o dia que fica mesmo vazio com filtro. null = hoje. */
  foco: string | null;
  /** O bloco de 6 ou mais no mesmo minuto que está aberto (a linha aberta dentro dele segue em `aberto`). */
  bloco: string | null;
};

export type EstadoAgenda = { dto: AgendaDto | null; erro: boolean; janela: { de: string; ate: string } | null; ui: AgendaUi };

export const AGENDA_UI_INICIAL: AgendaUi = { aberto: null, menu: null, bots: [], soProblema: false, alvo: null, rolarAgora: true, mes: null, busca: null, pausadasAbertas: false, foco: null, bloco: null };
export const AGENDA_INICIAL: EstadoAgenda = { dto: null, erro: false, janela: null, ui: AGENDA_UI_INICIAL };

export type AcaoAgenda =
  /** Abre (ou reabre) a agenda: em hoje e no agora, ou num dia (o link do chat), com o filtro de problema. */
  | { tipo: "agenda-abrir"; hoje: string; dia?: string; soProblema?: boolean }
  | { tipo: "hidratar-agenda"; janela: { de: string; ate: string }; dto: AgendaDto }
  | { tipo: "agenda-falhou"; janela: { de: string; ate: string } }
  | { tipo: "agenda-tentar" }
  /** Ir até um dia (régua, mini mês, link): fora da janela lida, a janela muda e a leitura volta. */
  | { tipo: "agenda-ir"; dia: string }
  | { tipo: "agenda-rolou" }
  | { tipo: "agenda-ui"; mudanca: Partial<Omit<AgendaUi, "alvo" | "rolarAgora" | "foco">> }
  | { tipo: "agenda-bot"; id: string };

/** Precisa ler a janela: ainda não leu (a janela mudou ou abriu agora) e a última leitura não falhou. */
export const agendaPorLer = (a: EstadoAgenda): boolean => !!a.janela && !a.erro && !a.dto;

const TIPOS: ReadonlySet<string> = new Set<AcaoAgenda["tipo"]>(["agenda-abrir", "hidratar-agenda", "agenda-falhou", "agenda-tentar", "agenda-ir", "agenda-rolou", "agenda-ui", "agenda-bot"]);
export const ehAcaoDaAgenda = (a: { tipo: string }): a is AcaoAgenda => TIPOS.has(a.tipo);

export function reduzirAgenda(a: EstadoAgenda, acao: AcaoAgenda): EstadoAgenda {
  switch (acao.tipo) {
    case "agenda-abrir": {
      const dia = acao.dia && diaValido(acao.dia) ? acao.dia : acao.hoje;
      const janela = dentro(dia, a.janela) ? a.janela : janelaDe(dia);
      const ui: AgendaUi = { ...AGENDA_UI_INICIAL, bots: a.ui.bots, soProblema: !!acao.soProblema, alvo: acao.dia ? dia : null, rolarAgora: !acao.dia, foco: dia };
      // Revisão 1 do PR #595: abrir relê sempre — a lida de ontem deixaria previstas que já passaram acima do agora.
      return { dto: null, erro: false, janela, ui };
    }
    case "hidratar-agenda":
      if (!a.janela || acao.janela.de !== a.janela.de || acao.janela.ate !== a.janela.ate) return a;
      return { ...a, dto: acao.dto, erro: false };
    case "agenda-falhou":
      if (!a.janela || acao.janela.de !== a.janela.de || acao.janela.ate !== a.janela.ate) return a;
      return { ...a, erro: true };
    case "agenda-tentar":
      return { ...a, erro: false, dto: null };
    case "agenda-ir": {
      if (!diaValido(acao.dia)) return a;
      const ui = { ...a.ui, alvo: acao.dia, rolarAgora: false, mes: null, aberto: null, menu: null, foco: acao.dia };
      if (dentro(acao.dia, a.janela)) return { ...a, ui };
      return { ...a, janela: janelaDe(acao.dia), dto: null, erro: false, ui };
    }
    case "agenda-rolou":
      return a.ui.alvo === null && !a.ui.rolarAgora ? a : { ...a, ui: { ...a.ui, alvo: null, rolarAgora: false } };
    case "agenda-ui":
      return { ...a, ui: { ...a.ui, ...acao.mudanca } };
    case "agenda-bot": {
      const bots = a.ui.bots.includes(acao.id) ? a.ui.bots.filter((b) => b !== acao.id) : [...a.ui.bots, acao.id];
      return { ...a, ui: { ...a.ui, bots, aberto: null } };
    }
  }
}

/**
 * O Esc na agenda fecha uma coisa por vez, na ordem em que estão por cima: o mês, a busca de bots, a folha ou o menu do
 * celular, a linha aberta e, por fim, o bloco. Devolve a mudança e o seletor do controle que recebe o foco de volta;
 * null quando não há nada aberto (o Esc segue para fechar as Configurações).
 */
export function escNaAgenda(ui: AgendaUi): { mudanca: Partial<AgendaUi>; foco: string } | null {
  if (ui.mes !== null) return { mudanca: { mes: null }, foco: '[data-act="agenda-mes"]' };
  if (ui.busca !== null) return { mudanca: { busca: null }, foco: '[data-act="agenda-busca-abrir"]' };
  const linha = ui.menu ?? ui.aberto;
  if (linha !== null) return { mudanca: { aberto: null, menu: null }, foco: `[data-act="agenda-linha"][data-chave="${linha}"]` };
  if (ui.bloco !== null) return { mudanca: { bloco: null }, foco: `[data-act="agenda-bloco"][data-chave="${ui.bloco}"]` };
  return null;
}
