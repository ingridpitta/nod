import type { CotaDaContaDto } from "./cota-da-conta.ts";
import type { EpochMs } from "./ids.ts";
import type { PreparoDoLogin } from "./preparo-do-login.ts";

/**
 * As contas de IA da pessoa em todas as máquinas (definido em 2026-10-13, ADR-102). O servidor guarda a lista (apelido,
 * plano, ordem, limite) e, por máquina, se a conta está logada nela. A chave da conta é a impressão (sha256, ADR-102
 * item 4). Desde 2026-10-15 (ADR-105) o e-mail e a organização também chegam, só para a tela dizer qual conta é qual:
 * nada autoriza nem casa conta por eles (ADR-019 regra 2).
 */

/** As IAs que têm conta (as do Mac e da VM). */
export const IAS_COM_CONTA = ["claude-cli", "codex-cli"] as const;
export type IaComConta = (typeof IAS_COM_CONTA)[number];

export type EstadoContaNaMaquina = "pronta" | "sem_login" | "sem_acesso";
export const ESTADOS_CONTA_NA_MAQUINA: readonly EstadoContaNaMaquina[] = ["pronta", "sem_login", "sem_acesso"];

/** O que a máquina anuncia de cada conta logada nela (no `conectar` e no `inventario` da ponte). */
export type ContaAnunciada = {
  /** sha256 hex (impressaoDaConta, src/domain/contas-da-pessoa.ts). */
  impressao: string;
  ia: IaComConta;
  estado: EstadoContaNaMaquina;
  /** O plano legível ("Max", "Team", "Plus"); null = o CLI não disse. */
  plano: string | null;
  /** A regra da ADR-101 (contaCorporativa), decidida na máquina, que sabe qual é a conta de sempre. */
  corporativa: boolean;
  /** Quando esta pasta entrou nesta máquina (R4 da revisão: uma conta removida só volta com um login mais novo). */
  logadaEm: EpochMs;
  /** O apelido que a máquina conhece (o do `contas.json` do Mac), usado só quando a conta é nova no servidor. */
  apelidoSugerido?: string;
  /**
   * ADR-105: o que o CLI disse da conta. Ausente = a máquina não sabe agora (app ou motor anterior a 2026-10-15, ou a
   * conta ainda não relida) e o servidor mantém o que já tinha. O Codex não informa organização.
   */
  email?: string;
  organizacao?: string;
};

/** Teto do anúncio: 6 contas por IA (CONTAS_POR_IA_MAX) nas duas IAs. */
export const CONTAS_ANUNCIADAS_MAX = 12;
/**
 * Revisão do PR #306: o teto da lista da pessoa (contas não removidas). Uma máquina que anuncia além disso não cria
 * conta nova — sem teto, a lista crescia sem fim e passava do limite do `PUT contas-ia/ordem` (50).
 */
export const CONTAS_DA_PESSOA_MAX = 24;

export type MaquinaDaConta = { maquinaId: string; nome: string; estado: EstadoContaNaMaquina };

export type { FrenteAtivaDaConta } from "./frentes-da-conta.ts";

export type ContaIa = {
  id: string;
  ia: IaComConta;
  /** A impressão, para a máquina local casar com o que ela sabe (qual pasta do Mac é esta conta). */
  impressao: string;
  apelido: string;
  /** ADR-105: o último e-mail e a organização que alguma máquina anunciou; null = nenhuma disse ainda. */
  email: string | null;
  organizacao: string | null;
  plano: string | null;
  corporativa: boolean;
  posicao: number;
  entraNaTrocaAutomatica: boolean;
  noLimiteAte: EpochMs | null;
  maquinas: MaquinaDaConta[];
  /**
   * NOD-302 (continuação da NOD-253): a cota desta conta pela última leitura que um turno dela trouxe — as janelas ainda
   * vigentes (5 horas e semana), a situação (livre, reserva ou limite) e quando volta. null = nenhum turno dela leu ainda.
   */
  cota?: CotaDaContaDto | null;
};

export type { CotaDaContaDto } from "./cota-da-conta.ts";

export type ModoDasContas = "perguntar" | "automatico";

export type ContasIaDto = {
  /** false no modo local (ADR-092): a web mostra a tela da ADR-101. */
  disponivel: boolean;
  modo: ModoDasContas;
  contas: ContaIa[];
};

/** A conta que o plano manda a máquina usar (ADR-102 item 5). */
export type ContaDoPlano = { id: string; impressao: string; apelido: string };

// ── Login de uma conta numa máquina pela tela (ADR-102 item 3) ──────────────────────────────────────────────────────

export type FaseLogin = "pedido" | "preparando" | "abrindo" | "aguardando_pessoa" | "conferindo" | "pronto" | "falhou" | "cancelado";
export const FASES_LOGIN_FINAIS: readonly FaseLogin[] = ["pronto", "falhou", "cancelado"];

export type LoginNaMaquina = {
  id: string;
  maquinaId: string;
  ia: IaComConta;
  /** A conta existente que se quer logar nesta máquina; null = uma conta nova (`apelido`). */
  contaId: string | null;
  apelido: string | null;
  fase: FaseLogin;
  /** O link oficial do login (só da lista LINKS_OFICIAIS). */
  url: string | null;
  /** Codex: o código que a pessoa digita na página da OpenAI. */
  codigoDispositivo: string | null;
  /** Claude: a página devolve um código que a pessoa cola aqui. */
  pedeCodigo: boolean;
  /** A chave pública (SPKI, base64) que a máquina gerou para este login: o navegador cifra o código com ela. */
  chavePublica: string | null;
  /** O código já foi entregue à máquina (a tela mostra "Conferindo…"). */
  codigoEnviado: boolean;
  /**
   * Código curto do erro (falhou): "tempo_esgotado" e "codigo_ilegivel"/"contas_demais" (do motor), as causas do login
   * do CLI (CausaFalhaLogin, estado-ia.ts) e os motivos de colar o código (ResultadoColarCodigo).
   */
  erro: string | null;
  /** A conta que entrou (pronto). Diferente de `contaId` = a pessoa entrou com outra conta (a tela avisa). */
  contaFinalId: string | null;
  preparo?: PreparoDoLogin | null; // NOD-8: o passo 1 (null = sem passo 1; ausente = servidor de antes)
  criadoEm: EpochMs;
  atualizadoEm: EpochMs;
};

/** O código do Claude cifrado no navegador: a chave AES-GCM envolvida em RSA-OAEP, o IV e os dados (base64). */
export type CodigoCifrado = { chave: string; iv: string; dados: string };

/** O que a máquina recebe na puxada de contas. */
export type LoginPendente = {
  id: string;
  ia: IaComConta;
  /** A impressão esperada (login de conta existente); null = conta nova. */
  impressao: string | null;
  apelido: string | null;
  /** Presente uma vez, quando a pessoa colou o código. */
  codigo?: CodigoCifrado;
  cancelado?: boolean;
};

export type PuxadaDeContas = {
  logins: LoginPendente[];
  /** As impressões de que esta máquina deve sair (logout + apagar a pasta). */
  sair: string[];
  /** A pessoa desconectou a máquina pedindo para sair das contas: sair de todas e parar. */
  desconectar: boolean;
  /** NOD-9 (definido em 2026-10-22): as IAs a atualizar pelo botão da tela; vai uma vez por pedido (o motor antigo ignora). */
  atualizar?: IaComConta[];
  /** ADA-245: junto de `desconectar`, a pessoa removeu o nod deste computador por outro lugar: rodar a limpeza local. */
  remover?: import("./remover-computador.ts").PedidoRemoverNaPuxada;
};

/** O progresso que a máquina relata de um login. */
export type ProgressoDoLogin = {
  loginId: string;
  fase: Exclude<FaseLogin, "pedido" | "cancelado">;
  url?: string;
  codigoDispositivo?: string;
  pedeCodigo?: boolean;
  chavePublica?: string;
  erro?: string;
  impressao?: string; // pronto: a impressão da conta que entrou (o anúncio seguinte a registra, com o plano)
  preparo?: PreparoDoLogin; // NOD-8: o passo 1, com `preparando` antes de `abrindo` (src/contracts/preparo-do-login.ts)
};

// ── O limite de uma conta na conversa (payload `limite_do_plano.contas`) ─────────────────────────────────────────────

export type ContaLivre = {
  id: string;
  apelido: string;
  ia: IaComConta;
  /** Logada na máquina do turno: "Seguir com". */
  naMaquina: boolean;
  /** Livre só noutra máquina viva da pessoa: "Rodar no <nome> desta vez" (ou "Entrar com ela na <máquina>"). */
  outraMaquina: { id: string; nome: string } | null;
};

/**
 * NOD-284 (definido em 2026-10-15): por que um passo da nota de limite ("Seguir com", "Rodar no X desta vez", "Tentar de
 * novo") não refez a fala. null = refez (ou não havia fala a refazer e a escolha foi gravada).
 */
export type MotivoDaNota =
  | "ja_refeito"
  | "turno_nao_interrompido"
  | "conta_de_outra_ia"
  | "conta_no_limite"
  | "conta_fora_da_maquina"
  | "orcamento_da_sala"
  | "bot_fora_da_sala"
  | "maquina_sem_contato";

export type ContasNoLimite = {
  de: { id: string; apelido: string; ia: IaComConta };
  livres: ContaLivre[];
  /** A máquina do turno (para "Entrar com ela na <máquina>"). */
  maquina: { id: string; nome: string } | null;
  voltaEm: EpochMs | null;
};
