import type { TipoDecisao } from "./decisao.ts";
import type { JsonSchema } from "./json-schema.ts";
import type { OrigemTurno } from "./turno.ts";

/**
 * pedir_a_pessoa (EMENDA 16) em contrato próprio: ferramentas-nod.ts encostava no gatilho de 200
 * linhas da EMENDA 26. Os três tipos se RESPONDEM com texto da pessoa, nunca com um botão de decidir.
 */
export const TIPOS_PEDIDO_A_PESSOA = ["pergunta", "falta_de_dado", "permissao"] as const satisfies readonly TipoDecisao[];
export type TipoPedidoAPessoa = (typeof TIPOS_PEDIDO_A_PESSOA)[number];

/**
 * definido em 2026-09-16: o gate de uma rotina é QUALQUER pedido de aprovação pendente ligado ao turno
 * dela — tipo 'gate_rotina' (rótulo do plano) ou 'aprovacao' (o que pedirAprovacao da L5 cria hoje).
 * Assim o caminho real (rotina roda → pedir_aprovacao → ninguém responde) chega a passou_em_branco
 * sem depender de a L5 trocar o rótulo; a ligação é o turno_id, dado tipado, nunca a frase.
 * revisto em 2026-10-15 (NOD-255): mora no contrato para o pré-voo ler sem importar disparar-rotina.ts (ciclo).
 */
export const TIPOS_GATE_ROTINA: ReadonlySet<TipoDecisao> = new Set<TipoDecisao>(["gate_rotina", "aprovacao"]);

/**
 * definido em 2026-09-24 (fio da pergunta, emenda da ADR-045): o que SEGURA o desfecho da execução — o
 * gate e as perguntas de pedir_a_pessoa. A execução que pergunta não "executou" ao encerrar o turno da
 * pergunta: todas as rodadas do fio são da mesma janela, e o desfecho é do fio inteiro — 'executou' quando
 * a retomada segue sem perguntar de novo, 'passou_em_branco' quando a pergunta é deixada pra lá ou vence.
 * revisto em 2026-10-15 (NOD-255): também é o que segura a janela SEGUINTE no pré-voo do agendador — antes só as
 * perguntas seguravam, e o card de aprovação aberto deixava a rotina abrir outro igual (a ação saía em dobro).
 */
export const TIPOS_QUE_SEGURAM_A_EXECUCAO: ReadonlySet<TipoDecisao> = new Set<TipoDecisao>([...TIPOS_GATE_ROTINA, ...TIPOS_PEDIDO_A_PESSOA]);

/**
 * A regra que fala no lugar do bot quando as voltas param (ADR-099 §5; a autoria da pergunta e da mensagem diz que foi
 * ela). revisto em 2026-10-15 (NOD-270): no contrato porque o pré-voo a reconhece — essa pergunta não segura o cron.
 */
export const REGRA_VOLTAS_SEM_NOVIDADE = "regra:voltas_sem_novidade" as const;

/**
 * definido em 2026-09-24 (emenda da ADR-045): respostas prontas viram opções de um toque na pergunta.
 * revisto em 2026-10-18 (plano "pergunta com botões", Parte 1): a pergunta é um cartão com a lista de opções A a D, uma
 * por linha; quatro letras cabem na lista sem rolar no celular, e 60 caracteres cabem numa linha da lista.
 */
export const MAX_OPCOES = 4;
export const MAX_CARACTERES_OPCAO = 60;

/**
 * `recomendada` (definido em 2026-10-18, plano "pergunta com botões", Parte 1): o índice em `opcoes` da opção que o bot
 * recomenda. A normalização (pedir-a-pessoa.ts) põe a recomendada em primeiro e o payload grava `recomendada: 0`.
 */
export type ArgsPedirAPessoa = { tipo: TipoPedidoAPessoa; texto: string; dado?: string; quem_destrava?: string; opcoes?: string[]; recomendada?: number };

/**
 * definido em 2026-09-24 (fio da pergunta, emenda da ADR-045): o fio é DERIVADO, sem coluna de estado
 * (src/domain/fio-da-pergunta.ts). Esperando você: a última rodada está aberta. Lendo sua mensagem: a
 * última foi respondida e a retomada ainda não terminou. Resolvida: a retomada terminou sem perguntar
 * de novo. Deixada pra lá: dispensada. Vencida: o prazo da última rodada passou.
 */
export type EstadoFio = "esperando_voce" | "lendo_sua_mensagem" | "resolvida" | "deixada_pra_la" | "vencida";

/**
 * O fio como a conversa o desenha (ConversaDto.fios). `id` é a primeira decisão; `rodada` é quantas
 * perguntas o fio já teve; `mensagens` são os ids das mensagens do fio na janela carregada, em ordem —
 * as perguntas, as respostas e as falas do agente nas retomadas que perguntaram de novo.
 */
/** `decisorId` (definido em 2026-10-18, plano "pergunta com botões"): quem responde a última rodada — o cartão só abre as opções para ela. */
export type FioDaPergunta = { id: string; agenteId: string; estado: EstadoFio; rodada: number; decisoes: string[]; mensagens: string[]; decisorId?: string };

/** O fio de uma pergunta em "Sua vez": a faixa diz a rodada e os contadores contam fios, não rodadas. */
export type FioDoItem = { id: string; rodada: number };

/**
 * O balão da pergunta num item de "Sua vez" (definido em 2026-10-18, plano "pergunta com botões", Parte 4): a fala, as
 * opções e a recomendada do payload `pedido_a_pessoa`, para a fila desenhar o mesmo cartão da conversa, e a origem genérica
 * do turno que perguntou (a raiz da cadeia: "rotina", "peer"…). Lido em lote (mensagens.pedidosAPessoaDasDecisoes). Null
 * sem balão legível: a decisora que não é dona da conversa (RLS de mensagens), a sala esfriada e as perguntas antigas.
 */
export type PedidoDoItem = { texto: string; opcoes?: string[]; recomendada?: number; ajudaDoComputador?: true; origem: OrigemTurno | null };

/**
 * A pergunta é a fala do agente na conversa (emenda da ADR-045): `texto` aparece num balão, então a
 * descrição pede fala natural dirigida à pessoa, e `opcoes` quando as respostas são previsíveis.
 * definido em 2026-09-24 (fio da pergunta): quem distingue pedido de explicação de resposta é o
 * agente, não a interface — a descrição diz o que fazer quando a pessoa pede esclarecimento.
 */
export const SCHEMA_PEDIR_A_PESSOA = {
  type: "object",
  description:
    "Para o turno e pergunta à pessoa. O texto aparece na conversa como a sua própria fala, no alto de um cartão de pergunta: escreva como você falaria com ela, direto e em uma ou duas frases, dizendo o que precisa e para quê. Prefira opções: sempre que 2 a 4 respostas cobrirem o que ela diria, mande opcoes, escritas como a pessoa responderia; omita só quando a resposta for livre (um nome, um texto, um link). A pessoa ainda pode responder com as próprias palavras. Quando você tiver uma recomendação, marque qual em recomendada e diga o motivo em uma frase no texto; não cite letra nem posição da opção, o nod põe a recomendada em primeiro. tipo: 'pergunta' (julgamento), 'falta_de_dado' (diga em dado o que falta) ou 'permissao'. Depois de chamar, encerre o turno sem repetir a pergunta em texto e sem tentar de novo: a resposta dela retoma o trabalho de onde parou. Se a pessoa pedir esclarecimento em vez de responder, explique e chame pedir_a_pessoa de novo: a pergunta continua no mesmo fio. Pedido de explicação não é resposta.",
  properties: {
    tipo: { type: "string", enum: TIPOS_PEDIDO_A_PESSOA },
    texto: { type: "string", description: "A pergunta como você diria à pessoa, em uma ou duas frases (\"Qual é o processo de lançamento do gamefik? Pode ser um link ou duas linhas.\"). É a sua fala, nunca um molde.", minLength: 1 },
    dado: { type: "string", description: "Nome curto do dado que falta (em falta_de_dado).", minLength: 1 },
    quem_destrava: { type: "string", description: "Nome da pessoa que pode destravar (entre as pessoas do tenant).", minLength: 1 },
    opcoes: {
      type: "array",
      description: "De 2 a 4 respostas, escritas como a pessoa responderia (\"Sim, pode arquivar\"), cada uma com até 60 caracteres. Omita só quando a resposta for livre (um nome, um texto, um link).",
      items: { type: "string", minLength: 1, maxLength: MAX_CARACTERES_OPCAO },
      maxItems: MAX_OPCOES,
    },
    recomendada: { type: "integer", description: "Índice (a partir de 0) em opcoes da opção que você recomenda, quando tiver uma. Diga o motivo no texto, sem citar letra nem posição." },
  },
  required: ["tipo", "texto"],
  additionalProperties: false,
} as const satisfies JsonSchema;
