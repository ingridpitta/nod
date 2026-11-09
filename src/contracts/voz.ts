import type { CamposEntrevista, EtapaOnboarding } from "./onboarding.ts";

/**
 * Protocolo nod-voz/1 (definido em 2026-10-04, ADR-071): dois canais WebSocket por ligação.
 *
 * - Mídia (`/api/t/:tenant/voz/v1/midia`): o renderer do app abre com o cookie da sessão. Sobe o microfone e desce a
 *   voz do bot em quadros binários; o controle vai em JSON `{t, …}`.
 * - Cérebro (`/api/interno/voz/v1/cerebro`): o executor do Mac abre com o token do turno da ligação (o Mac disca, o
 *   servidor nunca disca — ADR-021). Leva a vez da pessoa ao CLI e traz a fala do bot.
 *
 * Quadro binário: byte 0 = tipo, bytes 1–4 = sequência (u32 LE), bytes 5–6 = `utt` (u16 LE, só na voz do bot), o
 * resto é PCM16LE mono. Microfone a 16 kHz, voz do bot a 24 kHz.
 */
export const VERSAO_PROTOCOLO_VOZ = 1;
export const QUADRO_MICROFONE = 0x01;
export const QUADRO_VOZ = 0x02;
export const TAXA_MICROFONE_HZ = 16_000;
export const TAXA_VOZ_HZ = 24_000;
/** definido em 2026-10-04: 20 ms por quadro de microfone (320 amostras a 16 kHz). */
export const QUADRO_MS = 20;
export const CABECALHO_MICROFONE_BYTES = 5;
export const CABECALHO_VOZ_BYTES = 7;
/** definido em 2026-10-04: teto de uma mensagem em qualquer canal (o maior quadro de voz cabe com folga). */
export const MENSAGEM_MAX_BYTES = 64 * 1024;

/** Códigos de fechamento do WebSocket (faixa 4000–4999 é da aplicação). */
export const FECHAMENTOS_VOZ = {
  versao: 4400,
  sessao: 4401,
  origem: 4403,
  naoEncontrada: 4404,
  jaEmLigacao: 4409,
  encerrada: 4410,
  abuso: 4429,
  vozFora: 4503,
} as const;

/** Por que a ligação acabou (CHECK `ligacao_motivo_fim` da 0048, refeito na 0055). */
export const MOTIVOS_FIM_LIGACAO = [
  "pessoa_desligou",
  "bot_desligou",
  "tempo_maximo",
  "limite_diario",
  "cerebro_caiu",
  "midia_caiu",
  "reinicio_servidor",
  "drenagem",
  "nao_atendida",
  "recusada",
  "voz_indisponivel",
  "ociosidade",
  "limite_da_assinatura",
  "erro",
  // definido em 2026-10-05 (0055): a IA do Mac caiu no meio da ligação e a pessoa não escolheu o que fazer no prazo.
  "sem_ia",
] as const;
export type MotivoFimLigacao = (typeof MOTIVOS_FIM_LIGACAO)[number];

/** Fase que a tela mostra (a pílula e a tela cheia leem daqui). */
export type FaseLigacao = "chamando" | "conectando" | "ouvindo" | "pensando" | "falando" | "trabalhando" | "reconectando" | "aguardando_escolha" | "encerrada";

/**
 * A IA do Mac caiu com a ligação em curso (definido em 2026-10-05, rede de segurança da ligação): o turno-cérebro
 * terminou sem a ligação ter acabado. A ligação não fica muda nem cai: o bot diz uma frase fixa, a tela mostra as saídas
 * e a ligação espera a escolha (`aguardando_escolha`).
 */
export const IAS_DA_LIGACAO = ["claude-cli", "codex-cli"] as const;
export type IaDaLigacao = (typeof IAS_DA_LIGACAO)[number];
/**
 * Código fechado, nunca o texto do fornecedor: `conta_sem_acesso` vem do `causaSemIa` do turno; `limite` é a assinatura
 * no teto com outra IA pronta (NOD-168, ADR-078: o cérebro ainda está vivo, mas não responde mais); o resto é `falhou`.
 */
export const CAUSAS_CEREBRO_CAIU = ["conta_sem_acesso", "falhou", "limite"] as const;
export type CausaCerebroCaiu = (typeof CAUSAS_CEREBRO_CAIU)[number];
export const ESTADOS_IA_DA_LIGACAO = ["pronto", "nao_autenticado", "ausente"] as const;
/** Como cada IA está neste Mac agora (o inventário que o Mac anunciou): é o que decide os botões do aviso. */
export type EstadoIaDaLigacao = {
  id: IaDaLigacao;
  estado: (typeof ESTADOS_IA_DA_LIGACAO)[number];
  /**
   * NOD-178: o CLI só demorou para responder à sonda; a tela não pede "Instalar" nem "Entrar". NOD-171: `cli_antigo` é
   * o CLI instalado abaixo do piso (`ausente`); `versao` e `minima` vão junto, para o card dizer "Atualize". NOD-9
   * (definido em 2026-10-23): `atualizando` é o nod trocando o CLI por um mais novo; a tela só espera.
   */
  causa?: "sonda_lenta" | "cli_antigo" | "atualizando";
  versao?: string;
  minima?: string;
};
/** definido em 2026-10-05: sem escolha em 2 min a ligação encerra com `sem_ia`. */
export const ESPERA_DA_ESCOLHA_MS = 120_000;

/** De onde veio uma fala do bot: o cérebro, uma espera gravada, uma leitura de aprovação montada pelo servidor ou um aviso. */
export type TipoFalaBot = "conteudo" | "espera" | "leitura" | "aviso";

export type AcaoComandoVoz = "aprovar" | "recusar";

/** definido em 2026-10-04 (ADR-077): no máximo 4 chips "Diga algo como", cada um com até 80 caracteres. */
export const SUGESTOES_MAX = 4;
export const SUGESTAO_MAX_CHARS = 80;

/**
 * Por onde a voz do bot sai no aparelho da pessoa (definido em 2026-10-04, análise do Buzz): com fone não há eco, e a
 * interrupção pode ser mais rápida; no alto-falante (ou sem saber), o servidor é conservador.
 */
export type RotaSaida = "fone" | "alto-falante" | "desconhecida";

/** Cliente → servidor, canal de mídia. */
export type MsgMidiaCliente =
  | { t: "ola"; v: number; ligacaoId: string; entrada: "pcm16"; saida: "pcm16"; retomar?: boolean }
  /** Quanto da fala `utt` já tocou no alto-falante (a cada 250 ms enquanto toca). */
  | { t: "tocado"; utt: number; ms: number }
  | { t: "tocou-fim"; utt: number }
  /** O cliente esvaziou o buffer de `utt` depois de `interromper`; `ms` = quanto tinha tocado. */
  | { t: "interrompido"; utt: number; ms: number }
  /** O composer durante a ligação: entra como uma vez da pessoa, sem passar pelo STT. */
  | { t: "texto"; conteudo: string }
  | { t: "mudo"; ativo: boolean }
  /** A saída de áudio padrão, ao abrir e a cada troca de aparelho. */
  | { t: "saida"; rota: RotaSaida }
  /**
   * Com o aviso "sem IA" na tela, a pessoa abriu o login ou a instalação de uma IA: a espera pela escolha recomeça
   * (até 5 vezes por queda; o login acontece no navegador, fora da tela da ligação).
   */
  | { t: "resolvendo" }
  | { t: "ping" }
  | { t: "tchau" };

/** Servidor → cliente, canal de mídia. */
export type MsgMidiaServidor =
  | { t: "pronto"; maxS: number; stt: { parciais: boolean } }
  | { t: "estado"; fase: FaseLigacao; rotulo?: string }
  /** Legenda da pessoa: `final=false` é parcial e será trocada pela mesma `id`. */
  | { t: "legenda"; id: number; texto: string; final: boolean }
  /** Texto de uma fala do bot que começa a tocar em `utt`; `tipo:"espera"` aparece apagada e nunca entra na transcrição. */
  | { t: "bot-fala"; utt: number; tipo: TipoFalaBot; texto: string }
  /** O volume baixou no cliente por uma fala que não se confirmou: pode voltar. */
  | { t: "subir"; utt: number }
  | { t: "interromper"; utt: number }
  /** Janela de aprovação aberta para `decisaoId` até `ate` (epoch ms). */
  | { t: "janela"; decisaoId: string; ate: number }
  | { t: "janela-fechada"; decisaoId: string }
  /** A fala da pessoa foi um comando de voz válido: o cliente chama a rota de decisão com este `comandoId`. */
  | { t: "comando"; comandoId: string; decisaoId: string; acao: AcaoComandoVoz }
  | { t: "cerebro"; online: boolean }
  | { t: "aviso"; texto: string }
  /**
   * ADR-077 (onboarding por ligação): a entrevista anotou um campo (`etapa:"entrevista"`) ou terminou
   * (`etapa:"configurando"`: a tela encolhe para a pílula e a configuração guiada aparece).
   */
  | { t: "onboarding"; etapa: EtapaOnboarding; campos: CamposEntrevista }
  /** ADR-077: os chips "Diga algo como" da etapa; lista vazia some com eles. Cada chip vira um `texto` da pessoa. */
  | { t: "sugestoes"; itens: string[] }
  /**
   * A IA do Mac caiu: `ia` é a que respondia (null = não se sabe), `ias` o estado das IAs do Mac agora e `ate` (epoch
   * ms) até quando a ligação espera a escolha. Reenviada quando o estado de uma IA muda e quando a mídia reconecta.
   */
  | { t: "sem-ia"; causa: CausaCerebroCaiu; ia: IaDaLigacao | null; ias: EstadoIaDaLigacao[]; ate: number }
  /** A pessoa escolheu e o cérebro novo atendeu: `trocou` = é outra IA (o aviso neutro "agora usa o …"). */
  | { t: "ia-voltou"; ia: IaDaLigacao | null; trocou: boolean }
  | { t: "fim"; motivo: MotivoFimLigacao }
  | { t: "pong" };

/** Servidor → Mac, canal do cérebro. */
export type MsgCerebroServidor =
  /** A vez da pessoa. `ouvidoAte`: até onde ela ouviu a fala anterior do bot, quando houve interrupção. */
  | { t: "vez"; n: number; texto: string; ouvidoAte?: string }
  /** Aviso do sistema ([nod] …): resultado de tarefa, decisão, resposta de colega. `confiavel=false` vem moldurado. */
  | { t: "nota"; texto: string; confiavel: boolean; n?: number }
  | { t: "interromper"; modo: "suave" | "duro" }
  /** Pede o resumo final (não será falado) e encerra o laço. */
  | { t: "fim"; motivo: MotivoFimLigacao }
  | { t: "pong" };

/** Mac → servidor, canal do cérebro. */
export type MsgCerebroCliente =
  | { t: "ola"; ligacaoId: string; capacidades: { interrupcao: boolean; harness: string } }
  /** Pedaço de texto da resposta da vez `n`. */
  | { t: "fala"; n: number; seq: number; delta: string }
  /** A resposta da vez `n` acabou (o CLI fechou a volta). */
  | { t: "fala-fim"; n: number }
  /** O bot começou ou terminou uma ferramenta (só o nome, nunca entrada nem resultado). */
  | { t: "atividade"; tipo: "inicio" | "fim"; nome: string }
  /**
   * NOD-168 (ADR-078): a assinatura da IA chegou ao teto (`rate_limit_event` com `rejected`). Vai uma vez por ligação;
   * quem decide o desfecho é o servidor (oferece a outra IA pronta ou encerra com `limite_da_assinatura`).
   */
  | { t: "limite" }
  | { t: "ping" };
