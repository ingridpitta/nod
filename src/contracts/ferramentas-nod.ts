import type { ResultadoPedirAcesso } from "./acesso.ts";
import type { MotivoPasse, MotivoSemNovidade } from "./motivos.ts";
import { FERRAMENTAS_ROTINA, PARA_BOT } from "./ferramentas-rotina.ts";
import { FERRAMENTAS_PERFIL, type ArgsAtualizarPerfil, type ArgsVerColegas, type ResultadoAtualizarPerfil, type ResultadoVerColegas } from "./ferramentas-perfil.ts";
import { FERRAMENTAS_ARTEFATO, type ContratoFerramentasArtefato } from "./ferramentas-artefato.ts";
import { FERRAMENTAS_LIGACAO, type ContratoFerramentasLigacao } from "./ferramentas-ligacao.ts";
import { FERRAMENTAS_TRABALHO, type ContratoFerramentasTrabalho } from "./ferramentas-trabalho.ts";
import { FERRAMENTAS_FRENTE, type ContratoFerramentasFrente } from "./ferramentas-frente.ts";
import { FERRAMENTAS_DO_NOD, type ContratoFerramentasDoNod } from "./ferramentas-do-nod.ts";
import { FERRAMENTAS_CRIAR_BOTS, type ContratoFerramentasCriarBots } from "./ferramentas-criar-bots.ts";
import { FERRAMENTAS_RESPONDER_PEDIDO, type ContratoFerramentasResponderPedido } from "./ferramentas-responder-pedido.ts";
import { FERRAMENTAS_CREDENCIAL, type ContratoFerramentasCredencial } from "./ferramentas-credencial.ts";
import { FERRAMENTAS_AVISO, type ContratoFerramentasAviso } from "./ferramentas-aviso.ts"; import { FERRAMENTAS_BARRA, type ContratoFerramentasBarra } from "./ferramentas-barra.ts";
import { FERRAMENTAS_CONTA, type ContratoFerramentasConta } from "./ferramentas-conta.ts"; import { FERRAMENTAS_QUADRO, type ContratoFerramentasQuadro } from "./ferramentas-quadro.ts"; import { FERRAMENTAS_APPS, type ContratoFerramentasApps } from "./ferramentas-apps.ts"; import { FERRAMENTAS_CONVERSAS, type ContratoFerramentasConversas } from "./ferramentas-conversas.ts"; import { FERRAMENTAS_NAO_LIDOS, type ContratoFerramentasNaoLidos } from "./ferramentas-nao-lidos.ts"; import { FERRAMENTAS_TIMES, type ContratoFerramentasTimes } from "./ferramentas-times.ts"; import { FERRAMENTAS_ACESSOS, type ContratoFerramentasAcessos } from "./ferramentas-acessos.ts"; import { FERRAMENTAS_CANVAS, type ContratoFerramentasCanvas } from "./ferramentas-canvas.ts"; import { FERRAMENTAS_MAQUINAS, type ContratoFerramentasMaquinas } from "./ferramentas-maquinas.ts"; import { FERRAMENTAS_COMPUTADORES, type ContratoFerramentasComputadores } from "./ferramentas-computadores.ts";
import { SCHEMA_PEDIR_A_PESSOA, type ArgsPedirAPessoa } from "./pedido.ts";
import type { ArgsAtualizarRotina, ArgsCriarRotina, ArgsExcluirRotina, ArgsListarRotinas, ArgsPausarRotina, ArgsReativarRotina, ArgsVerAgenda, ResultadoAlternarRotina, ResultadoCriarRotina, ResultadoListarRotinas, ResultadoPropostaRotina, ResultadoVerAgenda } from "./ferramentas-rotina.ts";
import type { JsonSchema } from "./json-schema.ts";
export type { JsonSchema } from "./json-schema.ts";
export type { ArgsPedirAPessoa } from "./pedido.ts";
export type { ArgsAtualizarPerfil, ArgsVerColegas, AppDoColega, ColegaListado, ResultadoAtualizarPerfil, ResultadoVerColegas } from "./ferramentas-perfil.ts";
export type { ArgsAtualizarRotina, ArgsCriarRotina, ArgsExcluirRotina, ArgsListarRotinas, ArgsPausarRotina, ArgsReativarRotina, ArgsVerAgenda, ResultadoAlternarRotina, ResultadoCriarRotina, ResultadoListarRotinas, ResultadoPropostaRotina, ResultadoVerAgenda, RotinaListada } from "./ferramentas-rotina.ts";

/**
 * As ferramentas nod (cinquenta em 2026-11-08, com o gerir_maquinas da ADA-243 e o remover_computador da ADA-245; quarenta e oito em 2026-11-07, com o gerir_acessos da ADA-241; quarenta e sete em 2026-11-04, com o gerir_canvas da ADA-13; quarenta e seis em 2026-11-02, com o gerir_times da NOD-437 e o gerir_apps da NOD-445; quarenta e quatro em 2026-11-01, com o nao_lidos da NOD-449; quarenta e três em 2026-10-31, com o gerir_quadro da NOD-442; quarenta e duas em 2026-10-29: ajustar_barra_lateral da NOD-119, buscar_conversas e ler_conversa da NOD-61 e ver_agenda da NOD-85; contadas pelo teste; eram VINTE E UMA na contagem original) (EMENDA 16 acrescenta pedir_a_pessoa; sem_novidade entra em 2026-09-21
 * para que uma rotina possa encerrar em silêncio; o ciclo de vida de rotina, do mesmo dia, mora em
 * ferramentas-rotina.ts pelo gatilho de 200 linhas da EMENDA 26; pedir_a_bot substitui perguntar_a_bot e
 * delegar_tarefa em 2026-09-29, ADR-058; ver_colegas entra em 2026-09-28, ADR-050, e mora com atualizar_perfil em
 * ferramentas-perfil.ts pelo mesmo gatilho; publicar_artefato/ler_artefato também em 2026-09-28, ADR-051,
 * em ferramentas-artefato.ts (as três do "A fazer", de 2026-09-30, ADR-064, saíram na NOD-317); gerir_bots, ver_apps_conectados e registrar_relato, só do Nod, em 2026-10-07, ADR-081/082,
 * em ferramentas-do-nod.ts; criar_bots, NOD-210/ADR-104, responder_pedido, NOD-262, avisar_pessoa, NOD-114, e abrir_conta, NOD-351, nos arquivos com o nome delas).
 * Lista FECHADA: cada nome tem um case em chamar-ferramenta.ts (tests/conformidade/capabilities-consumidas, L5) e uma entrada em
 * UseCasesNod (servicos.ts). O CLI as vê como mcp__nod__<nome>. Ferramenta de conector é `${slug}__${tool}` e não mora aqui.
 */
export const FERRAMENTAS_NOD = {
  ...FERRAMENTAS_ROTINA,
  ...FERRAMENTAS_PERFIL,
  ...FERRAMENTAS_ARTEFATO,
  ...FERRAMENTAS_LIGACAO,
  ...FERRAMENTAS_TRABALHO,
  ...FERRAMENTAS_FRENTE,
  ...FERRAMENTAS_DO_NOD, ...FERRAMENTAS_CRIAR_BOTS, ...FERRAMENTAS_RESPONDER_PEDIDO, ...FERRAMENTAS_CREDENCIAL, ...FERRAMENTAS_AVISO, ...FERRAMENTAS_BARRA, ...FERRAMENTAS_CONTA, ...FERRAMENTAS_CONVERSAS, ...FERRAMENTAS_QUADRO, ...FERRAMENTAS_APPS, ...FERRAMENTAS_NAO_LIDOS, ...FERRAMENTAS_TIMES, ...FERRAMENTAS_ACESSOS, ...FERRAMENTAS_CANVAS, ...FERRAMENTAS_MAQUINAS, ...FERRAMENTAS_COMPUTADORES,
  lembrar: {
    type: "object",
    description: "Guarda uma memória deste agente (preferência, fato ou resumo). A memória não substitui fonte autoritativa.",
    properties: {
      tipo: { type: "string", enum: ["preferencia", "fato", "resumo"], description: "Tipo da memória." },
      texto: { type: "string", description: "O que lembrar, em uma frase.", minLength: 1 },
    },
    required: ["tipo", "texto"],
    additionalProperties: false,
  },
  pedir_acesso: {
    type: "object",
    description: "Pede à pessoa acesso a capacidades de um conector. Vira um pedido com botão; nada é concedido aqui: diga que pediu e encerre o turno.",
    properties: {
      conector: { type: "string", description: "Slug do conector registrado ou do marketplace.", minLength: 1 },
      capacidades: { type: "array", items: { type: "string" }, description: "Nomes exatos das ferramentas do catálogo, ou [] para pedir pelo nível: leitura = as ferramentas de leitura do app; escrita = ler, criar, editar e comentar (apagar, desfazer e ações sem verbo claro ficam de fora). Nunca invente nomes." },
      nivel: { type: "string", enum: ["leitura", "escrita"] },
      para: { type: "string", description: "Para que você precisa do acesso, numa frase curta que começa com verbo no infinitivo, sem citar a pessoa. Ex.: \"Listar as tarefas atrasadas do time\"." },
      nao_pedido: { type: "array", items: { type: "string" }, description: "O que explicitamente NÃO está sendo pedido." },
      para_bot: PARA_BOT,
    },
    required: ["conector", "capacidades", "nivel", "nao_pedido"],
    additionalProperties: false,
  },
  pedir_aprovacao: {
    type: "object",
    description:
      "Submete itens de efeito externo para aprovação em lista. Se voltar 'pendente', ENCERRE o turno: a decisão retoma depois.",
    properties: {
      resumo: { type: "string", description: "Resumo do lote em uma frase.", minLength: 1 },
      itens: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            texto: { type: "string", description: "O item como a pessoa vai ler.", minLength: 1 },
            destino: {
              type: "object",
              properties: {
                conector: { type: "string", description: "Slug do conector.", minLength: 1 },
                ferramenta: { type: "string", description: "Ferramenta do conector.", minLength: 1 },
                argumentos: { type: "object", description: "Argumentos da chamada." },
              },
              required: ["conector", "ferramenta", "argumentos"],
              additionalProperties: false,
            },
            origem_conector: { type: "string", description: "Slug do conector de onde o dado veio, se veio de conector.", minLength: 1 },
          },
          required: ["texto", "destino"],
          additionalProperties: false,
        },
      },
    },
    required: ["resumo", "itens"],
    additionalProperties: false,
  },
  /** O schema mora em pedido.ts desde 2026-09-24 (emenda da ADR-045): a pergunta virou fala com respostas prontas. */
  pedir_a_pessoa: SCHEMA_PEDIR_A_PESSOA,
  passar: {
    type: "object",
    description: "Passa a vez na sala sem falar. O motivo é tipado.",
    properties: { motivo: { type: "string", enum: ["passei_sem_nada_a_dizer", "negado_fail_closed", "ausente_offline", "cota_esgotada"] } },
    required: ["motivo"],
    additionalProperties: false,
  },
  encaminhar: {
    type: "object",
    description: "Encaminha a rodada da sala para outro bot membro (handoff visível). No máximo 3 por rodada sem fala humana.",
    properties: {
      para_agente: { type: "string", description: "Nome do bot destinatário.", minLength: 1 },
      motivo: { type: "string", description: "Por que ele é o certo para continuar.", minLength: 1 },
    },
    required: ["para_agente", "motivo"],
    additionalProperties: false,
  },
  sem_novidade: {
    type: "object",
    description: "Encerra a rotina em SILÊNCIO: você consultou a fonte e nada mudou. Nenhuma mensagem aparece na conversa; a execução fica só no histórico da rotina. Use sempre que a verificação não revelou nada que mude o que a pessoa já sabe — em vez de escrever um texto dizendo que não há novidade. Não chame se houver qualquer coisa a relatar, nem se a consulta falhou (aí relate o bloqueio em texto).",
    properties: { motivo: { type: "string", enum: ["nada_mudou", "fonte_vazia", "ja_relatado"] } },
    required: ["motivo"],
    additionalProperties: false,
  },
  /** ADR-058: UM jeito de pedir a um colega; a mensagem da pessoa que abriu o turno vai junto. NOD-417: `tarefa` vira comentário. */
  pedir_a_bot: {
    type: "object",
    description: "Pede a um colega (outro bot da pessoa) uma resposta ou um trabalho: explicar, consultar, levantar, revisar, corrigir, preparar. Ele resolve com os acessos e ferramentas DELE e pede o que faltar. Agenda trabalho assíncrono: diga que pediu e encerre; o resultado chega em um novo turno.",
    properties: {
      agente: { type: "string", description: "Id do diretório de colegas, ou nome único do bot.", minLength: 1 },
      pedido: { type: "string", description: "O que você precisa, autocontido: a pergunta ou a tarefa e o que deve voltar.", minLength: 1 },
      contexto: { type: "string", description: "Onde achar o trabalho: links, números, nomes, o que já se sabe." },
      tarefa: { type: "string", description: "Id ou título de uma tarefa do quadro da pessoa: o pedido vira um comentário seu nela e aciona o colega (um bot da pessoa) sem trocar o responsável. O resultado volta a você como sem a tarefa.", minLength: 1 },
    },
    required: ["agente", "pedido"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type NomeFerramentaNod = keyof typeof FERRAMENTAS_NOD;

/**
 * Lista LITERAL (EMENDA 26: nada de Object.keys em src/contracts). `satisfies` recusa nome fora de
 * FERRAMENTAS_NOD; ferramentas-nod.test.ts prova (no tipo e em runtime) que cobre TODAS as chaves.
 */
export const NOMES_FERRAMENTAS_NOD = [
  "lembrar", "atualizar_perfil", "pedir_acesso", "criar_rotina",
  "listar_rotinas", "ver_agenda", "pausar_rotina", "reativar_rotina", "atualizar_rotina", "excluir_rotina", "pedir_aprovacao",
  "pedir_a_pessoa", "passar", "encaminhar", "sem_novidade", "pedir_a_bot", "ver_colegas", "publicar_artefato", "ler_artefato",
  "iniciar_tarefa", "desligar",
  "anotar_entrevista", "concluir_entrevista", "propor_bot", "abrir_task", "mandar_para_task",
  "gerir_bots", "ver_apps_conectados", "registrar_relato", "me_chame_as", "esperar_comando", "abrir_frentes", "mandar_para_frente", "devolver_resumo", "criar_bots", "responder_pedido", "pedir_credencial", "avisar_pessoa", "abrir_conta", "buscar_conversas", "ler_conversa", "ajustar_barra_lateral", "gerir_quadro", "nao_lidos", "gerir_apps", "gerir_times", "gerir_canvas", "gerir_acessos", "gerir_maquinas", "remover_computador",
] as const satisfies readonly NomeFerramentaNod[];

export type ArgsLembrar = { tipo: "preferencia" | "fato" | "resumo"; texto: string };
export type ArgsPedirAcesso = { conector: string; capacidades: string[]; nivel: "leitura" | "escrita"; nao_pedido: string[]; para?: string; para_bot?: string };
export type ItemPedidoAprovacao = {
  texto: string;
  destino: { conector: string; ferramenta: string; argumentos: Record<string, unknown> };
  origem_conector?: string;
};
export type ArgsPedirAprovacao = { resumo: string; itens: ItemPedidoAprovacao[] };
export type ArgsPassar = { motivo: MotivoPasse };
export type ArgsSemNovidade = { motivo: MotivoSemNovidade };
export type ArgsEncaminhar = { para_agente: string; motivo: string };
export type ArgsPedirABot = { agente: string; pedido: string; contexto?: string; tarefa?: string };

/** ADR-065: capacidade que muda de turno para turno não vira memória — volta recusada, com o motivo para o bot ler. */
export type ResultadoLembrar = { ok: true; id: string } | { ok: false; recusado: string };
export type ResultadoPedirAprovacao =
  | { estado: "decidida"; itens: { idx: number; desfecho: string }[] }
  | { estado: "pendente"; decisao_id: string; instrucao: "encerre o turno; a decisão retoma depois" }
  /** ADR-062: argumento fora do schema do conector — o bot corrige e pede de novo. NOD-443: quem pediu saiu do quadro. */
  | { estado: "recusada"; erros: string[]; instrucao: "corrija os argumentos e chame pedir_aprovacao de novo" | "não peça de novo; encerre o turno" };
export type ResultadoPedirAPessoa = { estado: "pendente"; decisao_id: string; instrucao: "encerre o turno; a resposta retoma depois" };
export type ResultadoOk = { ok: true };
export type ResultadoPedirABot = { ok: true; tarefa_id: string; instrucao: string; livres: { id: string; nome: string }[] } | { ok: false; erro: "espera_circular" | "ja_pedido" | "experimento_desligado" | "sem_quadro" | "tarefa_invalida" | "colega_fora_do_quadro" | "colega_nao_acionado"; instrucao: string }; // ADR-099: espera circular; NOD-259: ja_pedido; NOD-417: os da tarefa

/** Args ↔ resultado por nome: contrato entre proxy, chamar-ferramenta e UseCasesNod. */
export type ContratoFerramentaNod = ContratoFerramentasArtefato & ContratoFerramentasLigacao & ContratoFerramentasTrabalho & ContratoFerramentasFrente & ContratoFerramentasDoNod & ContratoFerramentasCriarBots & ContratoFerramentasResponderPedido & ContratoFerramentasCredencial & ContratoFerramentasAviso & ContratoFerramentasBarra & ContratoFerramentasConta & ContratoFerramentasConversas & ContratoFerramentasQuadro & ContratoFerramentasApps & ContratoFerramentasNaoLidos & ContratoFerramentasTimes & ContratoFerramentasAcessos & ContratoFerramentasCanvas & ContratoFerramentasMaquinas & ContratoFerramentasComputadores & {
  lembrar: { args: ArgsLembrar; resultado: ResultadoLembrar };
  atualizar_perfil: { args: ArgsAtualizarPerfil; resultado: ResultadoAtualizarPerfil };
  pedir_acesso: { args: ArgsPedirAcesso; resultado: ResultadoPedirAcesso };
  criar_rotina: { args: ArgsCriarRotina; resultado: ResultadoCriarRotina };
  listar_rotinas: { args: ArgsListarRotinas; resultado: ResultadoListarRotinas }; ver_agenda: { args: ArgsVerAgenda; resultado: ResultadoVerAgenda };
  pausar_rotina: { args: ArgsPausarRotina; resultado: ResultadoAlternarRotina };
  reativar_rotina: { args: ArgsReativarRotina; resultado: ResultadoAlternarRotina };
  atualizar_rotina: { args: ArgsAtualizarRotina; resultado: ResultadoPropostaRotina };
  excluir_rotina: { args: ArgsExcluirRotina; resultado: ResultadoPropostaRotina };
  pedir_aprovacao: { args: ArgsPedirAprovacao; resultado: ResultadoPedirAprovacao };
  pedir_a_pessoa: { args: ArgsPedirAPessoa; resultado: ResultadoPedirAPessoa };
  passar: { args: ArgsPassar; resultado: ResultadoOk };
  encaminhar: { args: ArgsEncaminhar; resultado: ResultadoOk };
  sem_novidade: { args: ArgsSemNovidade; resultado: ResultadoOk };
  pedir_a_bot: { args: ArgsPedirABot; resultado: ResultadoPedirABot };
  ver_colegas: { args: ArgsVerColegas; resultado: ResultadoVerColegas };
};
