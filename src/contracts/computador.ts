import type { EpochMs } from "./ids.ts";
import type { MotivoFalhaComputador } from "./motivos.ts";
import type { VmLocalAnunciada } from "./vm-local.ts";

export type ControleComputador = "bot" | "pessoa" | "aguardando_pessoa";
export type PoliticaComputador = "supervisionado" | "autonomo";
/**
 * definido em 2026-10-22 (NOD-97, parte 3): de onde veio a troca de controle. `botao`: os botões (padrão, como antes);
 * `clique`: o primeiro clique ou tecla na tela em Assistindo; `fechou_tela`: a pessoa fechou a tela no controle
 * (fetch keepalive da web), que devolve ao bot — menos no pedido de ajuda.
 */
export const ORIGENS_CONTROLE = ["botao", "clique", "fechou_tela"] as const;
export type OrigemControle = typeof ORIGENS_CONTROLE[number];
export type Computador = {
  id: string;
  agenteId: string;
  habilitado: boolean;
  controle: ControleComputador;
  politica: PoliticaComputador;
  ajuda: string | null;
  ajudaDecisaoId: string | null;
  ocupadoAte: number | null;
  operacaoId: string | null;
  criadoEm: number;
  /**
   * Saúde (definido em 2026-09-24, emenda da ADR-037): falhas SEGUIDAS da máquina (só as que contam
   * para a saúde), o motivo da última e quando ela foi dada como fora do ar — a partir daí o plano sai
   * sem as ferramentas computador_* e a pessoa religa. Uma resposta da máquina zera tudo.
   */
  falhasSeguidas: number;
  falhaMotivo: MotivoFalhaComputador | null;
  indisponivelDesde: EpochMs | null;
};
export type AcaoComputador =
  /** `forcar` (NOD-161): devolve imagem e texto mesmo se iguais à última entrega; não vai ao runtime. */
  | { tipo: "observar"; forcar?: boolean }
  | { tipo: "navegar"; url: string }
  | { tipo: "clicar"; x: number; y: number; quadro: string; botao?: number; vezes?: number }
  | { tipo: "arrastar"; x: number; y: number; destinoX: number; destinoY: number; quadro: string }
  | { tipo: "dialogo"; aceitar: boolean; texto?: string; quadro: string }
  | { tipo: "audio"; segundos: number }
  | { tipo: "digitar"; texto: string; quadro: string }
  | { tipo: "tecla"; tecla: string; quadro: string }
  | { tipo: "rolar"; delta: number; quadro: string }
  | { tipo: "abas"; aba?: number }
  | { tipo: "arquivos"; caminho: string }
  | { tipo: "ler_arquivo"; caminho: string }
  | { tipo: "ler_texto"; caminho: string; inicio: number; revisao?: string }
  | { tipo: "gravar_texto"; caminho: string; texto: string; revisao: string }
  | { tipo: "gravar_arquivo"; caminho: string; base64: string }
  | { tipo: "anexar"; caminho: string; quadro: string }
  | { tipo: "terminal"; comando: string };
export type TelaComputador = {
  quadro: string;
  imagem: string;
  largura: number;
  altura: number;
  url: string;
  titulo: string;
  texto: string;
  dialogo?: { tipo: string; mensagem: string };
  abas: { titulo: string; url: string; ativa: boolean }[];
  /** NOD-97 PR 5: o Chrome preencheu uma senha salva nesta origem (uma vez por origem). O valor nunca vem; só a origem. */
  senhaPreenchida?: { origem: string };
};
export type ArquivoComputador = { nome: string; caminho: string; tamanho: number; diretorio: boolean };
export type ResultadoComputador = {
  tela?: TelaComputador;
  arquivos?: ArquivoComputador[];
  arquivo?: { nome: string; base64: string };
  texto?: { conteudo: string; inicio: number; proximo: number | null; total: number; revisao: string };
  revisao?: string;
  saida?: string;
  codigoSaida?: number;
  audio?: { mimeType: "audio/wav"; data: string };
};
export type RegistroComputador = {
  id: string;
  computadorId: string;
  turnoId: string | null;
  autor: "bot" | "pessoa";
  tipo: string;
  estado: "pendente" | "executando" | "concluida" | "falhou" | "recusada";
  /** Só na ação que falhou: o código fechado, para a atividade dizer o que houve. */
  motivo: MotivoFalhaComputador | null;
  em: number;
};
/**
 * NOD-192: o que o painel vê. Um bot que nunca usou o computador não tem linha em `computadores`: o GET
 * devolve o padrão (computadorPadrao) com `id` e `criadoEm` nulos, sem criar nada. A web age pelo agente.
 */
export type ComputadorVisto = Omit<Computador, "id" | "criadoEm"> & { id: string | null; criadoEm: number | null };
export type ComputadorDto = {
  computador: ComputadorVisto;
  disponivel: boolean;
  ativo: boolean;
  motivo: string | null;
  /** Quantas vezes o Docker reiniciou o container (docker inspect); null quando não se sabe. */
  reinicios?: number | null;
  /** NOD-170: o teto de computadores ligados no host e a ociosidade em minutos (0 = não desliga), para o cartão do limite. */
  limite?: { maximo: number; ociosoMin: number };
  atividade: RegistroComputador[];
};
/** O ambiente do servidor (Docker, cofre, imagem), sem olhar nenhuma máquina. */
export type AmbienteComputador = { disponivel: boolean; motivo: string | null; limite?: { maximo: number; ociosoMin: number } };
/** O escopo de quem chama (o mesmo formato de `Escopo` em shared/types; contracts é fechado). */
type EscopoDoDriver = { tenantId: string; pessoaId: string };

/** NOD-96 PR 5: a máquina do computador da pessoa, como o driver motor a vê. */
export type MaquinaDoComputador = {
  id: string;
  nome: string;
  contato: number | null;
  foto: { ligadoDesde: number | null; memoriaTotalMb: number | null; titulos: Record<string, string | null> } | null;
  /** NOD-93: o preparo da VM local, quando a máquina é o Mac. */
  preparo?: VmLocalAnunciada;
  /** NOD-365: sem contato agora, o último contato que a ponte viu (para "sem contato desde HH:MM"); null = nunca. */
  ultimoContato?: number | null;
  /** NOD-407: só quando o app conectado não atende ao protocolo mínimo do computador. */
  appDesatualizado?: { atual: string; minima: string; plataforma?: string };
};

/** NOD-365: uma opção da seção "Onde o computador mora" (domínio: opcoesDeLugar). */
export type LugarDoComputador = { maquinaId: string; nome: string; tipo: "onde_o_nod_roda" | "este_mac" | "outra_maquina"; atual: boolean; pronta: boolean; conectada?: boolean };
/** NOD-365: o progresso da troca de máquina, parte a parte. */
export type ProgressoDaTroca = (p: { pct: number; etapa: string }) => Promise<void> | void;

export interface DriverComputador {
  /** NOD-192: o painel de um bot sem computador mostra só o ambiente — não há container para inspecionar. */
  ambiente(): Promise<AmbienteComputador>;
  // NOD-96 PR 3: o escopo de quem chama vai junto — o driver motor localiza o computador e a máquina da pessoa por ele
  // (RLS); o docker ignora.
  estado(id: string, escopo?: EscopoDoDriver): Promise<{ disponivel: boolean; ativo: boolean; motivo: string | null; reinicios?: number | null; limite?: { maximo: number; ociosoMin: number } }>;
  iniciar(id: string, escopo?: EscopoDoDriver): Promise<void>;
  parar(id: string, escopo?: EscopoDoDriver): Promise<void>;
  executar(id: string, acao: AcaoComputador, escopo?: EscopoDoDriver, autor?: "bot" | "pessoa"): Promise<ResultadoComputador>;
  /** NOD-170: os ids dos computadores ligados NESTE host (de qualquer pessoa; os proxies nod-egress-* não contam). */
  ligados(): Promise<Set<string>>;
  // NOD-96 PR 5 (só o driver motor): as operações do computador da pessoa, o perfil do bot excluído e a máquina dele.
  /** Atualizar, Redefinir ou Sair de todos os sites; no Redefinir devolve a X25519 nova do supervisor. */
  operar?(id: string, tipo: "atualizar" | "redefinir" | "sair_de_todos" | "esquecer_senhas", escopo?: EscopoDoDriver): Promise<{ supervisorPub?: string }>;
  /** Fecha a tela do bot e apaga o perfil do Chrome dele (bot excluído); os logins em comum ficam. */
  apagarPerfil?(id: string, agenteId: string, escopo?: EscopoDoDriver): Promise<void>;
  /**
   * A máquina onde o computador roda (ou rodaria): `contato` é o último contato (nulo = sem contato agora) e `foto` o
   * que a foto viva do supervisor diz (desde quando está ligado, a memória total e o título de cada tela); null =
   * nenhuma máquina escolhida.
   */
  maquinaDoComputador?(id: string, escopo?: EscopoDoDriver): Promise<MaquinaDoComputador | null>;
  /** O `iniciar` deste computador está em curso. */
  ligando?(id: string): boolean;
  /**
   * NOD-95 (ADR-138, só o driver motor): pede à máquina a tela ao vivo deste bot. A máquina liga o VNC da tela e abre o
   * WebSocket de volta ao servidor com `sessao` e `token`; resolve quando o supervisor aceitou (o fluxo chega em seguida).
   */
  vivo?(id: string, sessao: { sessao: string; token: string }, escopo?: EscopoDoDriver): Promise<void>;
  /**
   * NOD-365: muda o computador para a máquina `destinoId`, levando a loja de logins cifrada (sem `semLogins`), liga lá e
   * marca a pasta da origem para sair em 30 dias. Se o `iniciar` no destino falhar, o banco volta a apontar para a origem.
   */
  trocar?(id: string, destinoId: string, opcoes: { semLogins: boolean; aoProgresso?: ProgressoDaTroca }, escopo?: EscopoDoDriver): Promise<void>;
  /** NOD-365: uma máquina antiga reconectou; entrega as marcas de saída pendentes sem precisar ligar a atual. */
  reconciliarSaidasPendentes?(id: string, escopo?: EscopoDoDriver): Promise<void>;
  /** NOD-365: as opções de lugar (as máquinas que anunciam o computador e a atual). */
  lugares?(id: string, escopo?: EscopoDoDriver): Promise<LugarDoComputador[]>;
}
