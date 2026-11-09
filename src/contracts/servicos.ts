import type { CapacidadeConector, Conector } from "./conector.ts";
import type { JeitoGithub } from "./github.ts";
import type { RuntimeEvent } from "./evento.ts";
import type { ContratoFerramentaNod, NomeFerramentaNod } from "./ferramentas-nod.ts";
import type { FrameSse, TipoFrame } from "./frame.ts";
import type { MotivoNegacao, MotivoPasse } from "./motivos.ts";
import type { PlanoTurno } from "./plano-turno.ts";
import type { ServicosLinear } from "./quadro-importacao.ts";
import type { ServicoRevisor } from "./revisao.ts";
import type { Rotina } from "./rotina.ts";
import type { LeituraDisco, NivelPressao, ServicoDasMaquinas } from "./trabalho.ts";

/** Identidade derivada do token de turno — o remetente nunca vem do texto (ADR-024). `IdentidadeSemTurno`: o que `cunhar` recebe. */
export type IdentidadeDeTurno = { turnoId: string; tenantId: string; pessoaId: string; agenteId: string };
export type IdentidadeSemTurno = Omit<IdentidadeDeTurno, "turnoId">;

/** definido em 2026-10-26 (NOD-374): `causa` = o app respondeu 401/403 à sonda (reconectar; re-sondar não resolve). */
export type ResultadoSonda = { ok: true; ferramentas: CapacidadeConector[] } | { ok: false; motivo: MotivoNegacao; causa?: "acesso_recusado" };

/**
 * Contrato `Services` completo (EMENDA 18). Genérico em `Trx` porque src/contracts não importa nada de fora (nem src/shared/types.ts); src/use-cases/tipos.ts fixa `Services = ServicesNod<Tx>`.
 * Fatias: planos/conectores/tokenTurno ← L5; interruptor ← L6; rotinas/sala ← L7; barramento ← L8;
 * catcher ← L4/L3; relogio ← L9 (relogio-sistema). L9 compõe.
 */
export interface ServicesNod<Trx> extends ServicosLinear {
  workspaces?: {
    id(i: { tenantId: string; pessoaId: string; conversaId: string }): Promise<string | null>;
    /** Pasta onde o harness abre e as que ele alcança; null quando não há projeto autorizado. */
    pastasDoHarness(i: { tenantId: string; pessoaId: string; conversaId: string }): Promise<{ ativa: string; aprovadas: string[] } | null>;
  };
  /**
   * definido em 2026-09-24 (ADR-048, revisto no mesmo dia): o GitHub pelo gh que a PESSOA já tem logado
   * no próprio Mac (anunciado pelo app ao conectar; no modo local, o deste processo e só para a dona
   * da máquina). null = o GitHub não nasce sozinho; segue pelo card de conexão.
   */
  github?: {
    /** O gh já logado no Mac conectado da pessoa do contexto: o registro automático nasce dele. */
    prontoSemConfiguracao(): Promise<Extract<JeitoGithub, "gh"> | null>;
    /**
     * Só no modo local (o servidor É o Mac): executa um item aprovado pelo gh desta máquina, se ela é da
     * dona (`escopo`). null = esta máquina não pode; o item espera o Mac da dona pela ponte.
     */
    executarNaMaquina?(escopo: { tenantId: string; pessoaId: string }, capacidade: string, argumentos: Record<string, unknown>): Promise<{ conteudo: string; isError: boolean } | null>;
  };
  computadores?: {
    /** NOD-96 (ADR-122): true = o computador da pessoa no motor; false = o docker por bot (só o vínculo 'por_bot' vale). */
    porPessoa?: boolean;
    executarAprovado(p: { tenantId: string; pessoaId: string; agenteId: string; turnoId: string; acaoId: string }): Promise<void>;
    /** ADR-083 (S5): o título do trabalho (ou "a conversa") que segura o computador que este turno pediu; null = não espera. */
    esperandoPor?(turnoId: string): string | null;
  };
  /**
   * definido em 2026-10-08 (NOD-200, ADR proposta): a última tela que o bot viu no turno, para virar anexo da fala.
   * `ler` não esquece (o assentar repetido por impasse acha a mesma tela); null = chave NOD_CAPTURA_NO_TRANSCRIPT
   * desligada ou sem tela. `esquecer` é da ponte, depois do assentar confirmado. Ausente = desligado.
   */
  capturas?: { ler(turnoId: string): Uint8Array | null; esquecer(turnoId: string): void };
  /**
   * definido em 2026-10-07 (ADR-083): o que só o processo sabe dos trabalhos — a última ferramenta de cada turno vivo
   * (o "último passo" da faixa) e a pressão de memória dos Macs da pessoa (#194). Ausente = nada a mostrar.
   */
  trabalhosVivos?: {
    ultimaFerramenta(turnoId: string): string | null;
    /** NOD-350: "2 subagentes trabalhando · 1 não terminou" (ou "Os 2 subagentes voltaram"); ganha da ferramenta no último passo. */
    resumoSubagentes?(turnoId: string): string | null;
    /**
     * ADR-085: com o pior processador e a maior carga por núcleo entre os Macs vivos dela (null = nenhum mandou). #219: e
     * o pior disco, com a histerese, e se algum app o mede. ADR-091: o maior uso da CPU e a pior fila (null = sem app novo).
     */
    memoria(pessoaId: string): { nivel: NivelPressao; totalMb: number; processador?: NivelPressao | null; carga?: number | null; uso?: number | null; fila?: NivelPressao | null; disco?: LeituraDisco | null; discoNivel?: NivelPressao | null; discoSuportado?: boolean; discoAcabaEmMs?: number | null } | null;
    /** ADR-085: a pessoa trocou o "uso do Mac" (gravado) — o puxar relê na próxima vez em vez de esperar o cache. */
    trocouUsoDoMac?(pessoaId: string): void;
  };
  /** A tela fala por máquina (2026-10-09): a leitura e o nome de cada máquina (trabalho.ts). Ausente = só a junta. */ maquinas?: ServicoDasMaquinas;
  /** ADA-13 (ADR-150): o importador do Canvas, fora da tx; ausente = importar recusa. */ canvas?: { importar(url: string): Promise<import("./ferramentas-canvas.ts").ResultadoImportarCanvas> }; /** ADR-115 (2026-10-18): o revisor do Automático (revisao.ts). Ausente ou `config.ligado: false` = a decisão de hoje. */ revisor?: ServicoRevisor;
  /** NOD-84 (ADR-139): a cifra do endereço do webhook; ausente = modo local. */ webhooks?: { cifrar(texto: string): string }; relogio: () => number;
  tokenTurno: {
    /** definido em 2026-09-16 (L9, pendência L5 §2): cunhar RECEBE a identidade — `autorizar` a devolve, logo ela entra aqui. */
    cunhar(turnoId: string, identidade: IdentidadeSemTurno): string;
    autorizar(token: string): IdentidadeDeTurno | null;
    revogar(turnoId: string): void;
  };
  planos: {
    emitir(trx: Trx, turnoId: string, machineId: string): Promise<PlanoTurno>;
    /** O plano emitido para um turno vivo (GET /api/interno/plano); null sem token/plano. */
    buscar(turnoId: string): PlanoTurno | null;
  };
  /** `semMensagem` (2026-09-28, ADR-050): as rotinas do perfil nascem pela confirmação dele, que escreve UMA linha com todas. */
  rotinas: { ativar(trx: Trx, propostaId: string, opcoes?: { semMensagem?: boolean }): Promise<Rotina> };
  conectores: {
    /** `contexto.rotina` (ADR-048): só turno de rotina pode usar o GitHub App da organização. Ausente = interativo. `somenteLeitura` (NOD-157): readOnlyHint da ferramenta; ausente = escrita, que só repete em 429. */
    chamar(conectorId: string, tool: string, args: Record<string, unknown>, contexto?: { rotina: boolean; somenteLeitura?: boolean }): Promise<{ conteudo: string; isError: boolean }>;
    // orcamentoMs (NOD-208): teto da sonda http inteira. manterVivos (NOD-374): não derruba o cliente vivo de outra chamada em curso. env (NOD-50): sonda este env candidato no lugar do guardado.
    sondar(conector: Conector, opcoes?: { orcamentoMs?: number; manterVivos?: boolean; env?: Record<string, string> }): Promise<ResultadoSonda>;
    descartar?(conectorId: string): Promise<void>; // NOD-50: fecha os clientes vivos (a chave mudou; o próximo uso sobe com o env novo)
  };
  interruptor: {
    registrar(turnoId: string, fn: () => Promise<void>): void;
    interromper(turnoId: string): Promise<boolean>;
  };
  /** `tipo` é rótulo snake_case ('plano_recebido', 'tool_use'), nunca prosa: CHECK catcher_registros_tipo (^[a-z_]+$) na 0002. */
  catcher: { registrar(trx: Trx, turnoId: string, tipo: string, dados: Record<string, unknown>): Promise<void> };
  sala: {
    encaminhar(trx: Trx, p: { turnoId: string; paraAgente: string; motivo: string }): Promise<{ ok: true }>;
    passar(trx: Trx, p: { turnoId: string; motivo: MotivoPasse }): Promise<{ ok: true }>;
    /** pedir_a_bot (ADR-058) para quem só tem o turnoId. */
    pedir(trx: Trx, p: { turnoId: string; agente: string; pedido: string; contexto?: string }): Promise<{ tarefaId: string }>;
  };
  barramento: /** null = um `turno.delta` guardado para sair junto com os próximos (src/services/barramento.ts, juntarDeltasMs). */ { publicar(pessoaId: string, tipo: TipoFrame, dados: Record<string, unknown>): FrameSse | null };
}

/**
 * Quem chamou a ferramenta, derivado do token (nunca do corpo). `plano` é o PLANO JÁ PUXADO (ADR-013/024): a regra de
 * aprovação automática é avaliada localmente a partir dele, nunca por consulta na hora da chamada. AUSENTE = nunca
 * automático — o caminho do computador (adapters/fundo/computadores.ts) chama pedirAprovacaoComputador sem plano, e
 * fail-closed é o comportamento certo ali (ADR-042 claim 1).
 */
export type ContextoFerramenta = { turnoId: string; agenteId: string; conversaId: string; plano?: PlanoTurno };

export type SaidaCasoDeUso<O> = { data: O; events?: RuntimeEvent[] };

/**
 * Uma implementação por ferramenta nod (EMENDA 5): chamar-ferramenta.ts valida args pelo schema, aplica gate de
 * parada/catálogo/trilha e DESPACHA para `deps.useCases[nome]`. Genérico em `Deps` pelo mesmo motivo de ServicesNod.
 * lembrar/atualizarPerfil ← L6; criarRotina/passar/encaminhar/pedirABot ← L7; pedirAcesso/pedirAprovacao/pedirAPessoa ← L5.
 */
export type CasoNod<Deps, N extends NomeFerramentaNod> = (
  deps: Deps,
  input: ContextoFerramenta & ContratoFerramentaNod[N]["args"],
) => Promise<SaidaCasoDeUso<ContratoFerramentaNod[N]["resultado"]>>;

export interface UseCasesNod<Deps> {
  lembrar: CasoNod<Deps, "lembrar">;
  atualizarPerfil: CasoNod<Deps, "atualizar_perfil">;
  pedirAcesso: CasoNod<Deps, "pedir_acesso">;
  criarRotina: CasoNod<Deps, "criar_rotina">;
  listarRotinasDoAgente: CasoNod<Deps, "listar_rotinas">; verAgendaPeloAgente: CasoNod<Deps, "ver_agenda">;
  pausarRotinaPeloAgente: CasoNod<Deps, "pausar_rotina">;
  reativarRotinaPeloAgente: CasoNod<Deps, "reativar_rotina">;
  atualizarRotinaPeloAgente: CasoNod<Deps, "atualizar_rotina">;
  excluirRotinaPeloAgente: CasoNod<Deps, "excluir_rotina">;
  pedirAprovacao: CasoNod<Deps, "pedir_aprovacao">;
  pedirAPessoa: CasoNod<Deps, "pedir_a_pessoa">;
  passar: CasoNod<Deps, "passar">;
  encaminhar: CasoNod<Deps, "encaminhar">;
  semNovidade: CasoNod<Deps, "sem_novidade">;
  pedirABot: CasoNod<Deps, "pedir_a_bot">;
  verColegas: CasoNod<Deps, "ver_colegas">;
  publicarArtefato: CasoNod<Deps, "publicar_artefato">;
  lerArtefato: CasoNod<Deps, "ler_artefato">;
  iniciarTarefa: CasoNod<Deps, "iniciar_tarefa">;
  desligar: CasoNod<Deps, "desligar">;
  anotarEntrevista: CasoNod<Deps, "anotar_entrevista">;
  concluirEntrevista: CasoNod<Deps, "concluir_entrevista">;
  proporBot: CasoNod<Deps, "propor_bot">;
  // ADR-099 (I2): abrir_task e mandar_para_task ficam como sinônimos de abrir_frentes e mandar_para_frente.
  abrirTask: CasoNod<Deps, "abrir_task">; mandarParaTask: CasoNod<Deps, "mandar_para_task">; meChameAs: CasoNod<Deps, "me_chame_as">;
  esperarComando: CasoNod<Deps, "esperar_comando">;
  abrirFrentes: CasoNod<Deps, "abrir_frentes">; mandarParaFrente: CasoNod<Deps, "mandar_para_frente">; devolverResumo: CasoNod<Deps, "devolver_resumo">;
  gerirBots: CasoNod<Deps, "gerir_bots">;
  verAppsConectados: CasoNod<Deps, "ver_apps_conectados">;
  registrarRelatoDoNod: CasoNod<Deps, "registrar_relato">;
  criarBots: CasoNod<Deps, "criar_bots">; responderPedido: CasoNod<Deps, "responder_pedido">; pedirCredencial: CasoNod<Deps, "pedir_credencial">;
  avisarPessoa: CasoNod<Deps, "avisar_pessoa">; ajustarBarraLateral: CasoNod<Deps, "ajustar_barra_lateral">;
  abrirConta: CasoNod<Deps, "abrir_conta">; buscarConversas: CasoNod<Deps, "buscar_conversas">; lerConversa: CasoNod<Deps, "ler_conversa">; gerirQuadro: CasoNod<Deps, "gerir_quadro">; gerirApps: CasoNod<Deps, "gerir_apps">; naoLidosNoChat: CasoNod<Deps, "nao_lidos">; gerirTimes: CasoNod<Deps, "gerir_times">; gerirAcessos: CasoNod<Deps, "gerir_acessos">; gerirCanvas: CasoNod<Deps, "gerir_canvas">; gerirMaquinas: CasoNod<Deps, "gerir_maquinas">; removerComputador: CasoNod<Deps, "remover_computador">;
}

/** Mapa nome da ferramenta → chave em UseCasesNod (o despacho é por tabela, não por if). */
export const USE_CASE_POR_FERRAMENTA = {
  lembrar: "lembrar",
  atualizar_perfil: "atualizarPerfil",
  pedir_acesso: "pedirAcesso",
  criar_rotina: "criarRotina",
  listar_rotinas: "listarRotinasDoAgente", ver_agenda: "verAgendaPeloAgente",
  pausar_rotina: "pausarRotinaPeloAgente",
  reativar_rotina: "reativarRotinaPeloAgente",
  atualizar_rotina: "atualizarRotinaPeloAgente",
  excluir_rotina: "excluirRotinaPeloAgente",
  pedir_aprovacao: "pedirAprovacao",
  pedir_a_pessoa: "pedirAPessoa",
  passar: "passar",
  encaminhar: "encaminhar",
  sem_novidade: "semNovidade",
  pedir_a_bot: "pedirABot",
  ver_colegas: "verColegas",
  publicar_artefato: "publicarArtefato",
  ler_artefato: "lerArtefato",
  iniciar_tarefa: "iniciarTarefa",
  desligar: "desligar",
  anotar_entrevista: "anotarEntrevista",
  concluir_entrevista: "concluirEntrevista",
  propor_bot: "proporBot",
  abrir_task: "abrirTask", mandar_para_task: "mandarParaTask", me_chame_as: "meChameAs", esperar_comando: "esperarComando",
  abrir_frentes: "abrirFrentes", mandar_para_frente: "mandarParaFrente", devolver_resumo: "devolverResumo",
  gerir_bots: "gerirBots",
  ver_apps_conectados: "verAppsConectados",
  registrar_relato: "registrarRelatoDoNod",
  criar_bots: "criarBots", responder_pedido: "responderPedido", pedir_credencial: "pedirCredencial", avisar_pessoa: "avisarPessoa", abrir_conta: "abrirConta", buscar_conversas: "buscarConversas", ler_conversa: "lerConversa", ajustar_barra_lateral: "ajustarBarraLateral", gerir_quadro: "gerirQuadro", gerir_apps: "gerirApps", nao_lidos: "naoLidosNoChat", gerir_times: "gerirTimes", gerir_acessos: "gerirAcessos", gerir_canvas: "gerirCanvas", gerir_maquinas: "gerirMaquinas", remover_computador: "removerComputador",
} as const satisfies Record<NomeFerramentaNod, keyof UseCasesNod<unknown>>;
