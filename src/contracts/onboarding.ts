import type { CorAgente, FormaAgente } from "./agente.ts";
import type { EpochMs } from "./ids.ts";
import type { CausaDoMac, CausaInventario, CausaSemIa } from "./inventario.ts";
import type { Ligacao, MotivoRecusaLigacao } from "./ligacao.ts";

/**
 * Onboarding por ligação (definido em 2026-10-04, ADR-077; protótipo "Proposta 2" aprovado em 2026-10-03). A etapa
 * mora em `preferencias.onboarding_etapa` (0049) e a web só a lê e pede para mudar; quem decide o que cada etapa liga
 * (a Nina, a ligação, o fim) é o servidor.
 */
export const ETAPAS_ONBOARDING = ["ola", "executor", "chamando", "entrevista", "configurando", "concluido"] as const;
export type EtapaOnboarding = (typeof ETAPAS_ONBOARDING)[number];

/** O tamanho do time (CHECK `preferencias_tamanho_time` da 0049). */
export const TAMANHOS_TIME = ["so_eu", "2_10", "11_50", "51_mais"] as const;
export type TamanhoTime = (typeof TAMANHOS_TIME)[number];

/** O que `anotar_entrevista` grava, na ordem das perguntas do roteiro. */
export const CAMPOS_ENTREVISTA = ["apelido", "como_conheceu", "objetivo", "tamanho_time"] as const;
export type CampoEntrevista = (typeof CAMPOS_ENTREVISTA)[number];

/** Tetos dos campos (CHECKs da 0049). */
export const APELIDO_MAX = 60;
export const COMO_CONHECEU_MAX = 200;
export const OBJETIVO_MAX = 500;

export type CamposEntrevista = {
  apelido: string | null;
  comoConheceu: string | null;
  objetivo: string | null;
  tamanhoTime: TamanhoTime | null;
};

/** Os quatro objetivos com modelo de bot pronto (src/domain/roteiro-onboarding.ts). */
export type IdObjetivo = "clientes" | "time" | "dia" | "codigo";

/** O modelo de bot do objetivo: o card "Novo bot", o app que ele usa e as três rotinas sugeridas. */
export type ModeloDeBot = {
  objetivo: IdObjetivo;
  /** Como a pessoa diria (o chip "Diga algo como"). */
  fala: string;
  /** "responder clientes mais rápido" — entra no meio da frase da Nina. */
  curto: string;
  nome: string;
  papel: string;
  descricao: string;
  forma: FormaAgente;
  cor: CorAgente;
  app: { slug: string; nome: string; letra: string; cor: string };
  pode: string[];
  nao: string;
  rotinas: { quando: string; oque: string; cron: string; instrucao: string }[];
};

/** Em que passo da configuração guiada a pessoa está (calculado do banco, nunca guardado). */
export type PassoConfiguracao = "bot" | "app" | "rotina" | "fim";

export type BotDoOnboarding = { id: string; nome: string; conversaId: string; forma: FormaAgente; cor: CorAgente };

/** Os cards pendentes que a Nina abriu na ligação (ou o servidor, no caminho sem voz). */
export type PendentesOnboarding = {
  bot: { decisaoId: string; nome: string; descricao: string; forma: FormaAgente; cor: CorAgente; voz: string | null } | null;
  acesso: { decisaoId: string; app: string; conectar: boolean } | null;
  rotina: { decisaoId: string; resumo: string } | null;
};

/**
 * `causa` (definido em 2026-10-05): a IA está logada, mas o teste de verdade a reprovou (src/contracts/inventario.ts).
 * NOD-171: com `cli_antigo`, `versao` (a instalada) e `minima` (o piso) vão juntas, para o card dizer "Atualizar".
 */
export type IaNoMac = { id: "claude-cli" | "codex-cli"; estado: "pronto" | "nao_autenticado" | "ausente"; motivo?: string; causa?: CausaSemIa | Exclude<CausaInventario, CausaDoMac>; versao?: string; minima?: string };

/** GET /api/t/:tenant/onboarding. */
export type EstadoOnboarding = {
  etapa: EtapaOnboarding | null;
  /** A web abre o onboarding no lugar do app? (não concluiu e é pessoa nova ou está no meio). */
  mostrar: boolean;
  campos: CamposEntrevista;
  modelo: ModeloDeBot;
  guia: BotDoOnboarding | null;
  bot: BotDoOnboarding | null;
  passo: PassoConfiguracao;
  pendentes: PendentesOnboarding;
  /** O app do modelo já está conectado e concedido ao bot novo. */
  appConectado: boolean;
  rotinaCriada: { resumo: string } | null;
  concluidoEm: EpochMs | null;
  /** A ligação viva da Nina (etapas chamando/entrevista/configurando). */
  ligacao: Ligacao | null;
  /** Por que a ligação não pôde começar (o onboarding segue sem voz). */
  recusa: { motivo: MotivoRecusaLigacao; texto: string } | null;
  /** A IA dos bots neste Mac: sem nenhuma pronta, a web mostra os cards de IA. */
  executor: { pronto: boolean; ias: IaNoMac[] };
};

/** POST onboarding/etapa. `semVoz` só com 'configurando' (o "Configurar sem voz": encerra a ligação como recusada). */
export type PedidoEtapaOnboarding = { etapa: Exclude<EtapaOnboarding, "concluido">; semVoz?: boolean; /** ADA-242: as duas respostas da conversa por texto (só com NOD_ONBOARDING_TEXTO). */ respostas?: { apelido?: string; objetivo?: string } };
