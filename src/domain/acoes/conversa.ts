import type { DefinicaoAcao } from "../../contracts/acoes.ts";
import { FERRAMENTAS_DO_NOD } from "../../contracts/ferramentas-do-nod.ts";
import { PROPRIEDADES_NAO_LIDOS } from "../../contracts/ferramentas-nao-lidos.ts";
import { PROPRIEDADES_QUADRO } from "../../contracts/ferramentas-quadro.ts";
import type { JsonSchema } from "../../contracts/json-schema.ts";

/**
 * Conversa, cartões, salas, trabalhos, voz e preferências (NOD-391, ADR-135; Onda 5, NOD-397). Nunca pelo chat:
 * mandar mensagem e anexo (são o próprio chat), decidir um cartão (o Marlon decidiu: cartão se decide no cartão), o
 * que leva um segredo, o consentimento de voz, os passos do onboarding da tela e o que é só estado da tela.
 */

const falta = { estado: "falta", onda: "NOD-397" } as const;
/**
 * NOD-449 (definido em 2026-11-01): a leitura das conversas é `vivo` — a tela Não lidos e a ferramenta nao_lidos de
 * QUALQUER bot chamam os mesmos executores (src/use-cases/acoes/conversa.ts); o contrato prova o mesmo "lido até".
 */
const LEITURA = { estado: "vivo", via: { ferramenta: "nao_lidos" }, contrato: "tests/integration/paridade-nao-lidos.test.ts" } as const;
const objeto = (properties: Record<string, JsonSchema>, required: readonly string[]): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
const UMA_CONVERSA = objeto({ conversas: PROPRIEDADES_NAO_LIDOS.conversas }, ["conversas"]);
const INSTANTE: JsonSchema = { anyOf: [{ type: "string", minLength: 1, maxLength: 40 }, { type: "null" }] };
/** O que a marcação devolveu (o "lido até" de antes e de depois); o Desfazer só volta se nada mudou desde então. */
const LEITURAS = objeto({ leituras: { type: "array", minItems: 1, maxItems: 5000, items: objeto({ conversaId: { type: "string", minLength: 1, maxLength: 64 }, antes: INSTANTE, depois: INSTANTE }, ["conversaId", "antes", "depois"]) } }, ["leituras"]);
const PROPRIO_CHAT = { estado: "nunca", motivo: "é o próprio chat" } as const;
const CARTAO = { estado: "nunca", motivo: "cartão se decide no cartão: aprovar pelo chat não (decisão do Marlon)" } as const;
const ONBOARDING = { estado: "nunca", motivo: "passo do onboarding da tela; no chat, o mesmo efeito é bots.criar ou rotinas.criar" } as const;
const ESTADO_DA_TELA = { estado: "nunca", motivo: "estado da própria tela, sem efeito para os bots" } as const;

export const ACOES_CONVERSA = [
  { id: "conversas.enviar", titulo: "Mandar uma mensagem", risco: "muda", cartaoNoChat: false, chat: PROPRIO_CHAT },
  { id: "conversas.anexar", titulo: "Anexar um arquivo", risco: "muda", cartaoNoChat: false, chat: PROPRIO_CHAT },
  { id: "conversas.reagir", titulo: "Reagir a uma mensagem", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "conversas.desfazer_turno", titulo: "Desfazer os arquivos que o bot mudou num turno", risco: "arriscada", cartaoNoChat: true, chat: falta },
  { id: "conversas.parar", titulo: "Parar o bot desta conversa", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "conversas.parar_tudo", titulo: "Parar todos os bots", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "conversas.nova_sessao", titulo: "Começar uma sessão nova", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "conversas.marcar_lida", titulo: "Marcar a conversa como lida", schema: UMA_CONVERSA, risco: "muda", cartaoNoChat: false, chat: LEITURA, casoDeUso: "conversas.marcar_lida" },
  { id: "conversas.marcar_nao_lida", titulo: "Marcar a conversa como não lida", schema: UMA_CONVERSA, risco: "muda", cartaoNoChat: false, chat: LEITURA, casoDeUso: "conversas.marcar_nao_lida" },
  { id: "conversas.marcar_tudo_lido", titulo: "Marcar tudo como lido", schema: objeto({ todas: PROPRIEDADES_NAO_LIDOS.todas }, ["todas"]), risco: "muda", cartaoNoChat: false, chat: LEITURA, casoDeUso: "conversas.marcar_tudo_lido" },
  { id: "conversas.desfazer_leitura", titulo: "Desfazer a marcação como lida", schema: LEITURAS, risco: "muda", cartaoNoChat: false, chat: LEITURA, casoDeUso: "conversas.desfazer_leitura" },
  { id: "conversas.definir_pasta", titulo: "Escolher a pasta de trabalho da conversa", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "conversas.criar_pasta", titulo: "Criar uma pasta de trabalho", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "conversas.tirar_pasta", titulo: "Tirar a pasta de trabalho da conversa", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "cartoes.decidir", titulo: "Aprovar ou recusar um cartão", risco: "pessoa_confirma", cartaoNoChat: true, chat: CARTAO },
  { id: "cartoes.responder", titulo: "Responder a uma pergunta do bot no cartão", risco: "pessoa_confirma", cartaoNoChat: true, chat: CARTAO },
  { id: "cartoes.reabrir", titulo: "Reabrir um cartão", risco: "pessoa_confirma", cartaoNoChat: true, chat: CARTAO },
  { id: "cartoes.dispensar", titulo: "Dispensar um cartão", risco: "pessoa_confirma", cartaoNoChat: true, chat: CARTAO },
  { id: "cartoes.confirmar_proposta", titulo: "Confirmar uma proposta", risco: "pessoa_confirma", cartaoNoChat: true, chat: CARTAO },
  { id: "cartoes.recusar_proposta", titulo: "Recusar uma proposta", risco: "pessoa_confirma", cartaoNoChat: true, chat: CARTAO },
  { id: "cartoes.permitir_pasta", titulo: "Permitir uma pasta pedida pelo bot", risco: "pessoa_confirma", cartaoNoChat: true, chat: CARTAO },
  { id: "cartoes.guardar_credencial", titulo: "Guardar a chave pedida pelo bot", risco: "pessoa_confirma", cartaoNoChat: true, chat: { estado: "nunca", motivo: "o valor é segredo: só pelo campo seguro do cartão" } },
  { id: "turnos.retomar_decisao", titulo: "Retomar o turno de uma decisão", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "turnos.cancelar", titulo: "Cancelar um turno", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "turnos.retomar", titulo: "Retomar um turno interrompido", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "incidentes.dispensar", titulo: "Dispensar um incidente", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "modo.contestar", titulo: "Contestar uma ação que o modo aprovou sozinho", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "salas.criar", titulo: "Criar uma sala", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "salas.adicionar_membro", titulo: "Pôr um bot numa sala", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "salas.enviar", titulo: "Mandar uma mensagem numa sala", risco: "muda", cartaoNoChat: false, chat: PROPRIO_CHAT },
  { id: "salas.parar", titulo: "Parar a sala", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "trabalhos.parar", titulo: "Parar um trabalho", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "trabalhos.enviar", titulo: "Mandar uma mensagem num trabalho", risco: "muda", cartaoNoChat: false, chat: PROPRIO_CHAT },
  { id: "trabalhos.depois", titulo: "Deixar um trabalho para depois", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "trabalhos.fazer_aqui", titulo: "Fazer um trabalho aqui", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "voz.ligar", titulo: "Ligar para um bot", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "voz.encerrar", titulo: "Encerrar a ligação", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "voz.continuar", titulo: "Continuar a ligação", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "voz.apagar_falas", titulo: "Apagar as falas da ligação", risco: "arriscada", cartaoNoChat: false, chat: falta },
  { id: "voz.avaliar", titulo: "Avaliar a ligação", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "voz.consentir", titulo: "Dar o consentimento de voz", risco: "pessoa_confirma", cartaoNoChat: false, chat: { estado: "nunca", motivo: "consentimento é ato da pessoa na tela, não um pedido ao bot" } },
  { id: "preferencias.salvar", titulo: "Salvar as preferências", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "preferencias.fechar_aviso", titulo: "Fechar um aviso", risco: "muda", cartaoNoChat: false, chat: ESTADO_DA_TELA },
  // NOD-460: mostrar as colunas recolhidas e a densidade compacta do quadro em tela cheia (só a tela da pessoa lê).
  // ADA-18: ganha a visão do celular e fica viva pelo gerir_quadro (op exibir), com o mesmo executor do PUT.
  {
    id: "preferencias.exibir_quadro",
    titulo: "Mudar o Exibir do quadro (a visão no celular, as recolhidas, o compacto e as Opções do quadro)",
    schema: objeto({ quadro: PROPRIEDADES_QUADRO.quadro, visao: PROPRIEDADES_QUADRO.visao, recolhidas: PROPRIEDADES_QUADRO.recolhidas, compacto: PROPRIEDADES_QUADRO.compacto, vista: PROPRIEDADES_QUADRO.vista, agrupar: PROPRIEDADES_QUADRO.agrupar, ordenar: PROPRIEDADES_QUADRO.ordenar, inverter: PROPRIEDADES_QUADRO.inverter, ocultas: PROPRIEDADES_QUADRO.ocultas, propriedades: PROPRIEDADES_QUADRO.propriedades }, []),
    risco: "muda",
    cartaoNoChat: false,
    chat: { estado: "vivo", via: { ferramenta: "gerir_quadro" }, contrato: "tests/integration/paridade-quadro.test.ts" },
    casoDeUso: "preferencias.exibir_quadro",
  },
  { id: "artefatos.salvar_estado", titulo: "Salvar o que a pessoa marcou num artefato", risco: "muda", cartaoNoChat: false, chat: ESTADO_DA_TELA },
  { id: "telemetria.registrar", titulo: "Registrar linhas de telemetria da tela", risco: "muda", cartaoNoChat: false, chat: ESTADO_DA_TELA },
  { id: "onboarding.etapa", titulo: "Avançar uma etapa do onboarding", risco: "muda", cartaoNoChat: false, chat: ONBOARDING },
  { id: "onboarding.concluir", titulo: "Concluir o onboarding", risco: "muda", cartaoNoChat: false, chat: ONBOARDING },
  { id: "onboarding.bot", titulo: "Criar o primeiro bot no onboarding", risco: "muda", cartaoNoChat: false, chat: ONBOARDING },
  { id: "onboarding.rotina", titulo: "Criar a primeira rotina no onboarding", risco: "muda", cartaoNoChat: false, chat: ONBOARDING },
  {
    id: "relatos.registrar",
    titulo: "Contar um bug, uma melhoria ou uma dúvida",
    schema: FERRAMENTAS_DO_NOD.registrar_relato,
    risco: "muda",
    cartaoNoChat: false,
    chat: { estado: "parcial", via: { ferramenta: "registrar_relato" }, falta: "a ferramenta do Nod e o botão gravam por casos de uso diferentes e sem teste de contrato" },
  },
] as const satisfies readonly DefinicaoAcao[];
