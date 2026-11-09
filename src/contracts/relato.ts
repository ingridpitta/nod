// Só tipos e `as const` (EMENDA 26): nada de lógica em src/contracts.
import type { Confianca } from "./mensagem.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { MotivoFalha, MotivoInterrupcao } from "./motivos.ts";
import type { EstadoTurno, OrigemTurno, SinaisTurno } from "./turno.ts";

/**
 * O que a pessoa diz que deu errado. União FECHADA como todo motivo do nod (ADR-004): o enum
 * `categoria_relato` da 0017 copia esta lista e tests/conformidade/motivos-enum.test.ts compara
 * pg_enum com ela. Categoria é escolha de UM clique — quem quiser detalhar escreve na etapa 2.
 */
export const CATEGORIAS_RELATO = [
  "resposta_errada",
  "nao_fez_o_pedido",
  "travou_ou_parou",
  "lento",
  "interface",
  "outro",
] as const;
export type CategoriaRelato = (typeof CATEGORIAS_RELATO)[number];

/**
 * definido em 2026-10-07 (0062, a caixa do Nod): o que o relato é — o botão da mensagem só registra 'bug'; o Nod registra
 * os três. E de onde veio: o botão numa mensagem (ADR-041) ou a conversa com o Nod (sem mensagem apontada).
 */
export const TIPOS_RELATO = ["bug", "melhoria", "duvida"] as const;
export type TipoRelato = (typeof TIPOS_RELATO)[number];
export const ORIGENS_RELATO = ["botao", "nod"] as const;
export type OrigemRelato = (typeof ORIGENS_RELATO)[number];

/** O que a pessoa escolheu anexar na etapa 1: só a mensagem apontada ou a janela que a precede. */
export const ALCANCES_RELATO = ["mensagem", "janela"] as const;
export type AlcanceRelato = (typeof ALCANCES_RELATO)[number];

/**
 * definido em 2026-09-21: 15 minutos cobre o turno problemático e o contexto imediato sem virar
 * dump da conversa inteira. A janela é resolvida no servidor a partir de `criadoEm` da mensagem
 * apontada — o cliente manda o alcance, nunca o intervalo (id de fora não escolhe o recorte).
 */
export const JANELA_RELATO_MS = 15 * 60 * 1000;

/** Teto do texto livre da etapa 2. Acima disso o domínio recusa com `entrada_invalida`. */
export const TETO_TEXTO_RELATO = 2000;

/**
 * Diagnóstico da execução copiado para dentro do relato no instante do envio. Sai de
 * `turno_diagnosticos` (0017), que a ponte grava quando o turno não conclui — antes isso só existia
 * como linha de log em stdout, que some no Electron empacotado (definido em 2026-09-21).
 */
export type DiagnosticoRelato = {
  erroCru: string | null;
  ferramentas: string[];
  negacoes: string[];
  sessaoCli: string | null;
};

/**
 * O estado técnico do momento, tudo já tipado e já persistido — a pessoa não digita nada disto.
 * `sinais` são os quatro write-ahead do ADR-009: dizem em que ponto do protocolo a coisa quebrou.
 */
export type MetadadosRelato = {
  estadoTurno: EstadoTurno | null;
  origemTurno: OrigemTurno | null;
  sinais: SinaisTurno | null;
  motivoFalha: MotivoFalha | null;
  motivoInterrupcao: MotivoInterrupcao | null;
  modelo: string | null;
  harness: string | null;
  executor: string | null;
  machineId: string | null;
  custoUsd: number | null;
  reenvios: number | null;
  confiancaMensagem: Confianca;
  mensagemParcial: boolean;
  versaoApp: string | null;
  /**
   * Correlaciona o relato com a linha de log do servidor. A web NÃO preenche hoje: o único
   * correlation_id que ela tem é o do último erro do app inteiro, que pode não ter relação com a
   * mensagem relatada (medido em 2026-09-21). A coluna fica para quem puder amarrar o id à
   * requisição certa — o campo é aceito na entrada e continua validado.
   */
  correlationId: string | null;
};

export type Relato = {
  tenantId: TenantId;
  id: string;
  /** null = contado ao Nod (origem 'nod'); o do botão sempre aponta a mensagem (CHECK relatos_botao_tem_mensagem). */
  mensagemId: string | null;
  tipo: TipoRelato;
  origem: OrigemRelato;
  /**
   * Só nos relatos da PRÓPRIA pessoa (a prosa é privada, ADR-004): o título que o Nod escreveu e o começo do texto.
   * Relato de outro membro do tenant vem sem os dois.
   */
  titulo?: string | null;
  resumo?: string | null;
  conversaId: string;
  turnoId: string | null;
  categoria: CategoriaRelato;
  alcance: AlcanceRelato;
  mensagensAnexadas: number;
  metadados: MetadadosRelato;
  diagnostico: DiagnosticoRelato | null;
  criadoEm: EpochMs;
};

/** O que a web manda. O servidor resolve o resto: o cliente não escolhe janela nem metadado. */
export type EntradaRelato = {
  mensagemId: string;
  categoria: CategoriaRelato;
  alcance: AlcanceRelato;
  texto?: string;
  versaoApp?: string;
  correlationId?: string;
};
