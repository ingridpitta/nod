import type { IaDesktop } from "./desktop.ts";

/**
 * As várias contas de uma IA como a página as vê (definido em 2026-10-12, ADR-101). Só existe no app do Mac: apelido e
 * plano nunca vão ao servidor; a conversa fala só em posições ("conta 1", "conta 2").
 */
export type ContaNaTela = {
  posicao: number;
  apelido: string;
  plano: string | null;
  /** Plano de empresa ou desconhecido, fora da conta 1: só o selo (NOD-308: entra na troca como qualquer conta). */
  corporativa: boolean;
  /** O antigo opt-in da corporativa (NOD-308: não pesa mais; fica por compat). */
  entraNaTrocaAutomatica: boolean;
  /** O que vale no "Trocar sozinho": NOD-308, sempre true (corporativa ou não). */
  entraNaTroca: boolean;
  noLimiteAte: number | null;
  emUso: boolean;
  /** A conta do diretório padrão (~/.claude, ~/.codex): não sai pela lista; muda por "Trocar conta". */
  principal: boolean;
};
export type ContasNaTela = {
  ia: IaDesktop;
  modo: "perguntar" | "automatico";
  contas: ContaNaTela[];
  /** O login de uma conta nova em curso (o cartão da IA mostra os passos dele). */
  adicionando: { apelido: string } | null;
  /**
   * QA do NOD-211 (2026-10-12): o login da conta nova falhou ou expirou (nada foi salvo). A página mostra o erro com
   * "Tentar de novo" (adiciona de novo, com o mesmo apelido) e "Cancelar". Opcional: o app anterior não manda.
   */
  adicaoFalhou?: { apelido: string } | null;
  max: number;
};
/**
 * ADR-102 (2026-10-13): o que a tela mostra de cada conta logada neste Mac, achada pela impressão (a mesma que o servidor
 * guarda). E-mail e organização vêm do CLI; o servidor recebe os mesmos pelo anúncio (ADR-105) e a tela prefere estes,
 * os mais novos.
 */
export type DetalheDaConta = { impressao: string; ia: IaDesktop; email: string; organizacao: string | null; plano: string | null };
/** O que a ponte devolve: as contas deste Mac e a máquina que ele é no servidor (null = ainda sem conexão). */
export type DetalhesDasContas = { maquinaId: string | null; contas: DetalheDaConta[] };
export type PonteContas = {
  listar(): Promise<ContasNaTela[]>;
  usar(ia: IaDesktop, posicao: number): Promise<ContasNaTela | null>;
  /** Cria a pasta da conta nova e começa o login nela; false = já no máximo ou já adicionando. */
  adicionar(ia: IaDesktop, apelido: string): Promise<boolean>;
  remover(ia: IaDesktop, posicao: number): Promise<{ contas: ContasNaTela; logout: boolean }>;
  /** Fecha o aviso de que a adição falhou. Opcional: o app anterior não tem. */
  fecharFalha?(ia: IaDesktop): Promise<ContasNaTela>;
  mover(ia: IaDesktop, de: number, para: number): Promise<ContasNaTela>;
  renomear(ia: IaDesktop, posicao: number, apelido: string): Promise<ContasNaTela>;
  definirModo(ia: IaDesktop, modo: "perguntar" | "automatico"): Promise<ContasNaTela>;
  definirTrocaAutomatica(ia: IaDesktop, posicao: number, ligado: boolean): Promise<ContasNaTela>;
  /** Um ouvinte só (registrar de novo troca o anterior). */
  aoMudar(fn: (contas: ContasNaTela[]) => void): void;
  /** ADR-102: e-mail e organização das contas deste Mac, pela impressão. Opcional: o app anterior a 2026-10-13 não tem. */
  detalhes?(): Promise<DetalhesDasContas>;
};
