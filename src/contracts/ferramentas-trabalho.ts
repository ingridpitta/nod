import type { JsonSchema } from "./json-schema.ts";
import { ESTADOS_ESPERADOS, QUANDO_VOLTA, type EstadoEsperado, type QuandoVolta } from "./quadro-execucoes.ts";

/** Os tetos do `esperar_comando` (CHECKs da 0070); moram aqui porque o schema é contrato (EMENDA 26: só `as const`). */
export const COMANDO_ESPERA_MAX = 4_000;
export const MOTIVO_ESPERA_MAX = 300;

/**
 * As ferramentas da conversa coordenadora (definido em 2026-10-07, ADR-083 §7, issue #193). Moram fora de
 * ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26, como as de pendência; são espalhadas em FERRAMENTAS_NOD.
 * `abrir_task` entra no turno de conversa (sem trabalho) e no da task de rotina sem mãe; `mandar_para_task`, só na
 * conversa. O teto do título (200) é o CHECK trabalho_titulo da 0063.
 */
/**
 * ADR-086 (revisão do #212): de 5 min a 24 h — menos que isso, cada volta relê a sessão inteira e sai mais caro que
 * esperar; mais que um dia é rotina. `VOLTAS_SEGUIDAS_MAX`: voltas encadeadas antes de o bot ter de falar com a pessoa.
 */
export const ACORDAR_MIN_MINUTOS = 5;
export const ACORDAR_MAX_MINUTOS = 24 * 60;
export const MOTIVO_MAX_DESPERTAR = 300;
export const VOLTAS_SEGUIDAS_MAX = 24;
/**
 * definido em 2026-10-12 (ADR-099 §5, parte 1; o gatilho de reversão da ADR-086 virando regra): voltas seguidas da mesma
 * espera sem nada novo antes de a próxima virar pergunta à pessoa ("Precisa de você"). Em 11/10 uma task voltou 12 vezes
 * seguidas sem nada novo, acima das 10 em que a ADR-086 mandava rever. O teto de 24 continua como rede.
 */
export const VOLTAS_SEM_NOVIDADE = 3;

export const FERRAMENTAS_TRABALHO = {
  abrir_task: {
    type: "object",
    description:
      "Abre uma task: um trabalho que roda à parte, com sessão e pasta próprias, enquanto esta conversa segue livre. Use para o que leva mais que alguns minutos ou mexe em arquivos e código. Devolve na hora; o resultado e as perguntas da task chegam aqui depois.",
    properties: {
      titulo: { type: "string", description: "Título curto, como a pessoa diria (ex.: \"Dashboard de churn\").", minLength: 1, maxLength: 200 },
      pedido: { type: "string", description: "O que fazer, autocontido: a task não vê esta conversa. Inclua nomes, links e o que a pessoa já disse.", minLength: 1, maxLength: 8000 },
      depois_de: { type: "string", description: "Opcional: o id de uma task aberta que precisa terminar antes desta começar.", minLength: 1 },
    },
    required: ["titulo", "pedido"],
    additionalProperties: false,
  },
  mandar_para_task: {
    type: "object",
    description: "Repassa um recado a uma task aberta (o id está em \"Trabalhos em andamento\"). Se ela estiver rodando, o recado entra no meio do trabalho; senão, vira o próximo passo dela.",
    properties: {
      trabalho_id: { type: "string", description: "O id da task, como veio na lista.", minLength: 1 },
      texto: { type: "string", description: "O recado, autocontido.", minLength: 1, maxLength: 8000 },
    },
    required: ["trabalho_id", "texto"],
    additionalProperties: false,
  },
  // definido em 2026-10-08 (ADR-086): esperar fora do Mac. O teto de 24 h é o de um dia de trabalho; mais que isso é rotina.
  me_chame_as: {
    type: "object",
    description:
      "Sai do Mac e volta sozinho mais tarde, na mesma sessão e no mesmo ponto. Use para hora marcada (\"me chame amanhã às 9 h\") ou para esperar algo de fora que não tem comando que acompanhe — a resposta de alguém, um fornecedor — em vez de ficar num laço com sleep ou checando de tempos em tempos. Para CI, deploy ou processo que um comando acompanha até o fim, use esperar_comando se ele estiver disponível. Depois de chamar, pare os comandos que deixou em segundo plano e encerre o turno; a volta só é marcada quando o turno termina.",
    properties: {
      em_minutos: { type: "integer", description: `Daqui a quantos minutos voltar, inteiro de ${ACORDAR_MIN_MINUTOS} a ${ACORDAR_MAX_MINUTOS} (24 h). Dispensado com quando.` },
      // ADA-232 (ADR-155): no trabalho de uma tarefa do quadro com PR, voltar quando a CI do PR terminar (prazo máximo 24 h).
      // 2026-11-10 (os wakeups do Multica): também o merge, o conflito do PR e outra tarefa do quadro, pelo mesmo varredor.
      quando: { type: "string", enum: [...QUANDO_VOLTA], description: "Volta por evento, no máximo em 24 h, no trabalho de uma tarefa do quadro; dispensa em_minutos. \"ci\": os checks do PR da tarefa terminaram (passou, falhou, mergeado ou fechado). \"merge\": o PR da tarefa mergeou (ou fechou). \"conflito\": o PR aberto da tarefa ficou com conflito (ou saiu de aberto). ci, merge e conflito só com PR na tarefa. \"tarefa\": outra tarefa do mesmo quadro (tarefa) chegou em estado (feito, revisao ou bloqueado; sem estado, qualquer um), foi cancelada ou apagada." },
      tarefa: { type: "string", description: "Com quando \"tarefa\": o código da outra tarefa do quadro (ex.: \"ENG-12\") ou o id.", minLength: 1, maxLength: 80 },
      estado: { type: "string", enum: [...ESTADOS_ESPERADOS], description: "Com quando \"tarefa\": o estado que você espera (feito, revisao ou bloqueado). Sem ele, o primeiro dos três." },
      motivo: { type: "string", description: "O que você vai conferir quando voltar, numa frase (ex.: \"ver se o CI do PR #212 passou\").", minLength: 1, maxLength: MOTIVO_MAX_DESPERTAR },
    },
    required: ["motivo"],
    additionalProperties: false,
  },
  // definido em 2026-10-12 (ADR-099 item 4, parte 2): esperar o que um comando acompanha até o fim. O Nod roda o comando
  // fora do CLI, na máquina e na pasta deste turno, e o fim acorda o bot uma vez — em vez de voltas por horário.
  esperar_comando: {
    type: "object",
    description:
      "Espera algo de fora terminar sem ficar acordado: o Nod roda o comando na sua máquina e na sua pasta, fora deste turno, e você volta sozinho nesta mesma sessão quando ele terminar, com o código de saída e as últimas linhas. Use para CI, deploy e processos que um comando acompanha até o fim (gh pr checks 845 --watch -R dono/repo, gh run watch 123 -R dono/repo, kubectl rollout status deploy/app). O comando segue as regras do seu terminal e não pode ser laço com sleep. Um por turno. Depois de chamar, diga em uma frase o que vai esperar e encerre o turno.",
    properties: {
      comando: { type: "string", description: "Uma linha de shell que só termina quando a espera acabar (ex.: \"gh pr checks 845 --watch -R gamefik/app\").", minLength: 1, maxLength: COMANDO_ESPERA_MAX },
      motivo: { type: "string", description: "O que você está esperando, numa frase (ex.: \"a CI do PR #845\").", minLength: 1, maxLength: MOTIVO_ESPERA_MAX },
    },
    required: ["comando", "motivo"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsAbrirTask = { titulo: string; pedido: string; depois_de?: string };
export type ArgsMandarParaTask = { trabalho_id: string; texto: string };
export type ArgsMeChameAs = { em_minutos?: number; motivo: string; quando?: QuandoVolta; tarefa?: string; estado?: EstadoEsperado };
export type ArgsEsperarComando = { comando: string; motivo: string };

export type ResultadoAbrirTask =
  | { ok: true; trabalho_id: string; instrucao: string }
  | { ok: false; erro: "nao_abre_task" | "depois_de_invalido" | "teto_de_tasks"; instrucao: string };
export type ResultadoMandarParaTask =
  | { ok: true; entrou: "no_meio" | "na_fila"; instrucao: string }
  | { ok: false; erro: "task_nao_encontrada" | "nao_repassa" | "task_fechada"; instrucao: string };
/** `volta_as`: a hora no fuso de São Paulo (horaDaFrase; o servidor não guarda o da pessoa); `acordar_em`: o instante (ISO). */
export type ResultadoMeChameAs =
  | { ok: true; volta_as: string; acordar_em: string; instrucao: string }
  | { ok: false; erro: "turno_parado" | "task_fechada" | "voltas_demais" | "ja_esperando" | "sem_pr" | "sem_tarefa"; instrucao: string };
/** ADR-099 (parte 2): `espera_id` para a tela e o Raio-X; o resto é instrução. */
export type ResultadoEsperarComando =
  | { ok: true; espera_id: string; instrucao: string }
  | { ok: false; erro: "turno_parado" | "task_fechada" | "ja_esperando" | "sem_maquina" | "sem_terminal" | "precisa_aprovacao" | "comando_invalido" | "voltas_demais"; instrucao: string };

/** Args ↔ resultado destas ferramentas, intersectado em ContratoFerramentaNod. */
export type ContratoFerramentasTrabalho = {
  abrir_task: { args: ArgsAbrirTask; resultado: ResultadoAbrirTask };
  mandar_para_task: { args: ArgsMandarParaTask; resultado: ResultadoMandarParaTask };
  me_chame_as: { args: ArgsMeChameAs; resultado: ResultadoMeChameAs };
  esperar_comando: { args: ArgsEsperarComando; resultado: ResultadoEsperarComando };
};
