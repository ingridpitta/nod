import type { AcaoComputador, ControleComputador, LugarDoComputador, PoliticaComputador, ResultadoComputador } from "./computador.ts";
import type { EpochMs } from "./ids.ts";
import type { MotivoFalhaComputador } from "./motivos.ts";
import type { SessaoVivo } from "./computador-vivo.ts";
import type { UsoDoMac } from "./raio-x.ts";
import type { VmLocalAnunciada } from "./vm-local.ts";

/**
 * definido em 2026-10-22 (NOD-96, ADR-122): o computador da pessoa roda no motor, numa máquina dela, atrás de
 * NOD_COMPUTADORES=motor. Um computador por pessoa (`modelo` 'por_pessoa'), uma tela e um Chrome por bot, logins em
 * comum. Com a flag desligada nada disto é lido: o modo docker segue com `modelo` 'por_bot'.
 */
export const MODELOS_COMPUTADOR = ["por_bot", "por_pessoa"] as const;
export type ModeloComputador = (typeof MODELOS_COMPUTADOR)[number];
/** Mesma ordem do enum estado_tela_computador (0106); o gate motivos-enum compara. */
export const ESTADOS_TELA_COMPUTADOR = ["fechada", "esperando", "abrindo", "aberta", "fechando"] as const;
export type EstadoTelaComputador = (typeof ESTADOS_TELA_COMPUTADOR)[number];
/** Mesma ordem do enum operacao_computador (0106; `esquecer_senhas` acrescentado ao fim na 0112, NOD-97 PR 6). */
export const OPERACOES_COMPUTADOR = ["atualizar", "redefinir", "sair_de_todos", "esquecer_senhas", "trocar"] as const;
export type OperacaoComputador = (typeof OPERACOES_COMPUTADOR)[number];

/** A operação em curso no computador da pessoa (Atualizar, Redefinir, Sair de todos os sites), com o progresso relatado. */
export type OperacaoEmCurso = { tipo: OperacaoComputador; progresso: number | null; etapa: string | null; desde: EpochMs };

/** O computador da pessoa no motor (ADR-122). `maquinaId` nulo = "onde o nod roda" (contrato da NOD-94). */
export type ComputadorDaPessoa = {
  id: string;
  ownerId: string;
  maquinaId: string | null;
  hospedeiraId: string | null;
  /** X25519 do supervisor, em base64, gravada no primeiro contato (TOFU); nula até lá e depois do Redefinir. */
  supervisorPub: string | null;
  /** NOD-365: máquinas de onde saiu sem receber `marcar_saida`; cada uma recebe quando voltar. */
  saidasPendentesDe: string[];
  operacao: OperacaoEmCurso | null;
  falhasSeguidas: number;
  falhaMotivo: MotivoFalhaComputador | null;
  indisponivelDesde: EpochMs | null;
  ultimaAtividadeEm: EpochMs;
  criadoEm: EpochMs;
};

/** A tela de um bot no computador da pessoa: o controle, a política e o pedido de ajuda passam a ser por tela. */
export type TelaComputadorBot = {
  id: string;
  computadorId: string;
  agenteId: string;
  estado: EstadoTelaComputador;
  esperandoDesde: EpochMs | null;
  controle: ControleComputador;
  politica: PoliticaComputador;
  ajuda: string | null;
  ajudaDecisaoId: string | null;
  operacaoId: string | null;
  ocupadoAte: EpochMs | null;
  ultimaAtividadeEm: EpochMs;
  memoriaMb: number | null;
  falhaMotivo: MotivoFalhaComputador | null;
  criadoEm: EpochMs;
};

export const TIPOS_COMANDO_COMPUTADOR = ["iniciar", "abrir_tela", "acao", "fechar_tela", "parar", "atualizar", "redefinir", "sair_de_todos", "esquecer_senhas", "apagar_perfil", "exportar_logins", "importar_logins", "cancelar_exportacao", "marcar_saida", "vivo"] as const;
export type TipoComandoComputador = (typeof TIPOS_COMANDO_COMPUTADOR)[number];

/**
 * O que o servidor manda ao supervisor do computador pela ponte. Assinado com Ed25519 pela chave do servidor; o
 * supervisor recusa comando sem assinatura válida ou com prazo vencido. `agenteId` diz a tela (ausente nos comandos do
 * computador inteiro); `acao` só em `tipo: "acao"`. `segredoSelado`: segredo da loja de logins selado para
 * `supervisorPub` (X25519), nunca em claro. `uso` é a régua da pessoa (ADR-085/097): o supervisor recusa abrir tela
 * além dela e responde `esperando_tela`.
 */
export type ComandoComputador = {
  id: string;
  computadorId: string;
  tipo: TipoComandoComputador;
  agenteId?: string; acao?: AcaoComputador;
  uso: UsoDoMac;
  segredoSelado?: string;
  /**
   * Chave pública Ed25519 do servidor (base64, crua). Só no `iniciar`: o supervisor não tem a NOD_CREDENTIAL_KEY e fixa
   * esta chave no primeiro `iniciar` (TOFU, ADR-122); depois disso o campo é ignorado.
   */
  servidorPub?: string;
  /**
   * NOD-365 (definido em 2026-10-28): a troca de máquina. `troca` liga as partes de uma mesma troca; `parte` é a pedida
   * (`exportar_logins`) ou a que vai (`importar_logins`, com `total` e `dados`, o pacote cifrado em base64). O servidor
   * só repassa: os arquivos da loja estão cifrados com a chave do computador.
   */
  troca?: string;
  /** Época monotônica da troca nesta máquina; cerca comandos atrasados mesmo depois de reiniciar o supervisor. */
  epocaTroca?: number;
  parte?: number; total?: number; dados?: string;
  pessoa?: true; // PR #600: só na `acao` da pessoa no controle (solta a trava do dock); assinado como o resto
  vivo?: SessaoVivo; // NOD-95 (ADR-138): só em `tipo: "vivo"`; ver `SessaoVivo`
  /** Epoch em ms até quando o comando vale (no máximo 2 min à frente). */
  prazoMs: number;
  /** Ed25519 em base64 sobre a forma canônica do comando sem este campo. */
  assinatura: string;
};

export const DESFECHOS_COMANDO_COMPUTADOR = ["ok", "falhou", "esperando_tela"] as const;
export type DesfechoComandoComputador = (typeof DESFECHOS_COMANDO_COMPUTADOR)[number];

/** A resposta a um comando. `quem`: em `esperando_tela`, os bots cujas telas ocupam a vez. `motivo` só em `falhou`. */
export type ResultadoComandoComputador = {
  id: string;
  desfecho: DesfechoComandoComputador;
  resultado?: ResultadoComputador;
  motivo?: MotivoFalhaComputador;
  quem?: string[];
  progresso?: { pct: number; etapa: string };
  /** Só no `ok` do `redefinir`: a X25519 nova do supervisor, que o servidor fixa no lugar da antiga (NOD-96 PR 5). */
  supervisorPub?: string;
  /** NOD-365: no `ok` do `exportar_logins`, a parte pedida do pacote da loja (cifrado, base64) e quantas são. */
  logins?: PartePacoteLogins;
};
export type PartePacoteLogins = { parte: number; total: number; dados: string };
/** definido em 2026-10-28 (NOD-365): a parte em base64 cabe no corpo da ponte (1 MiB); o supervisor manda até ~512 KiB. */
export const TETO_PARTE_LOGINS_B64 = 600 * 1024;

/** A foto do computador que o supervisor manda sem ser perguntado (ao ligar, a cada mudança de tela e no batimento). */
export type EstadoComputadorRelatado = {
  computadorId: string;
  ligado: boolean;
  /** X25519 em base64. */
  supervisorPub: string;
  telas: { agenteId: string; estado: EstadoTelaComputador; ultimaAcaoEm: EpochMs | null; memoriaMb: number | null; titulo?: string | null }[];
  /** Desde quando está ligado e a memória total da máquina (NOD-96 PR 5); ausentes = supervisor antigo. */
  ligadoDesde?: EpochMs | null;
  memoriaTotalMb?: number | null;
  /** A operação em curso e o progresso dela (NOD-96 PR 5); `null` = nenhuma; ausente = supervisor antigo. */
  operacao?: { tipo: OperacaoComputador; pct: number; etapa: string } | null;
};

/** O que sobe do supervisor ao servidor: a resposta de um comando ou a foto do computador. */
export type RelatoComputador = ({ tipo: "resultado" } & ResultadoComandoComputador) | ({ tipo: "estado" } & EstadoComputadorRelatado);

export const ESTADOS_ANUNCIO_COMPUTADOR = ["pronto", "faltam_pacotes", "sem_suporte"] as const;
export type EstadoAnuncioComputador = (typeof ESTADOS_ANUNCIO_COMPUTADOR)[number];
/** Parte do anúncio da máquina (AnuncioMaquina.computador): se ela roda o computador e, se não, o que falta instalar. */
export type AnuncioComputador = { estado: EstadoAnuncioComputador; falta?: string[] };

/**
 * definido em 2026-10-22 (NOD-96 PR 3): o que o motor fala com o supervisor pelo socket `/run/nod-computador/ctl.sock`,
 * uma mensagem JSON por linha. O motor manda o comando assinado como veio do servidor (não abre, não reassina) e pede a
 * foto a cada 15 s; o supervisor responde com `RelatoComputador` (o resultado de um comando, pelo id, ou a foto, também
 * sem ser perguntado quando algo muda). O supervisor ainda sem computador (antes do primeiro `iniciar`) manda a foto com
 * `computadorId: ""`: o servidor só aprende a X25519 dele para selar o `iniciar`.
 */
export type MensagemAoSupervisor = { tipo: "comando"; comando: ComandoComputador } | { tipo: "pedir_estado" } | { tipo: "vivo"; comando: ComandoComputador };

/**
 * definido em 2026-10-22 (NOD-96 PR 5): o computador da pessoa como a web o vê (`GET /computador`). `estado`:
 * dormindo (desligado), ligando, pronto, fora_do_ar (falhas seguidas ou máquina sem contato) e operando (Atualizar,
 * Redefinir ou Sair de todos em curso, com `operacao`). `maquina` nula = ainda sem máquina escolhida. `esperando`: os
 * bots que esperam a vez de uma tela. `aviso_recriado`: a pessoa tinha computadores por bot (modo antigo) e ainda não
 * viu o "Entre nos sites de novo uma vez".
 */
export const ESTADOS_COMPUTADOR_DA_PESSOA = ["dormindo", "ligando", "pronto", "fora_do_ar", "operando"] as const;
export type EstadoComputadorDaPessoa = (typeof ESTADOS_COMPUTADOR_DA_PESSOA)[number];
export type ComputadorDaPessoaDto = {
  estado: EstadoComputadorDaPessoa;
  /** `contato`: último contato da máquina (epoch ms); nulo = sem contato agora. */
  maquina: { id: string; nome: string; contato: EpochMs | null } | null;
  /** `ultimaAcaoEm` vira "ativo agora"/"parado há" na web; `titulo` é o da página aberta, quando o supervisor relata. */
  telas: {
    agenteId: string;
    estado: EstadoTelaComputador;
    controle: ControleComputador;
    memoriaMb: number | null;
    titulo?: string | null;
    ultimaAcaoEm?: EpochMs | null;
    ajuda?: string | null;
  }[];
  esperando: string[];
  /** `etapa` com os nomes que a web conhece (Preparando, Apagando seus dados, Criando, Iniciando, Reconectando...). */
  operacao?: { tipo: OperacaoComputador; pct: number | null; etapa: string | null } | null;
  /** Em `fora_do_ar`: o motivo e desde quando (para a web dizer o porquê e oferecer Tentar de novo). */
  falha?: { motivo: MotivoFalhaComputador; desde: EpochMs } | null;
  /** Soma da memória das telas; `totalMb` nulo enquanto o supervisor não relata o total da máquina. */
  memoria?: { usadaMb: number; totalMb: number | null } | null;
  /** NOD-93 (passo 9): o preparo da VM local quando a máquina escolhida é o Mac. Ausente = Linux ou app antigo. */
  preparo?: VmLocalAnunciada | null;
  ligadoDesde?: EpochMs | null;
  /** As últimas ações no computador, mais nova primeiro; `agenteId` nulo = a pessoa. */
  atividade?: { agenteId: string | null; texto: string; em: EpochMs }[];
  aviso_recriado?: boolean;
  /** NOD-365: as máquinas onde o computador pode morar (a atual marcada). */
  lugares?: LugarDoComputador[];
  semContatoDesde?: EpochMs | null; // NOD-365: sem contato desde este instante (o último contato que a ponte viu)
  appDesatualizado?: { atual: string; minima: string; plataforma?: string }; // NOD-407: só quando o app está abaixo do piso do computador
};

/**
 * As operações do `POST /computador` (NOD-96 PR 5). `dispensar_aviso` é extensão deste PR: marca o
 * `aviso_recriado` como visto (a web chama ao fechar o aviso).
 */
export const OPERACOES_DA_PESSOA = ["acordar", "dormir", "atualizar", "redefinir", "sair_de_todos", "esquecer_senhas", "tentar_de_novo", "dispensar_aviso"] as const;
export type OperacaoDaPessoa = (typeof OPERACOES_DA_PESSOA)[number];
