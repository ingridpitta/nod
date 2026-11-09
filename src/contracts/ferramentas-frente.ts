import { TETO_TEXTO_RESUMO } from "./frente.ts";
import type { JsonSchema } from "./json-schema.ts";
import type { ArgsMandarParaTask, ResultadoMandarParaTask } from "./ferramentas-trabalho.ts";

/**
 * As ferramentas das frentes (definido em 2026-10-12, ADR-099, partes 3/4, issue I2). Moram fora de ferramentas-nod.ts e
 * de ferramentas-trabalho.ts pelo gatilho de 200 linhas da EMENDA 26; são espalhadas em FERRAMENTAS_NOD.
 * - `abrir_frentes` é do dono (a conversa do bot) e da execução de rotina sem mãe, no lugar de `abrir_task`: um pedido,
 *   um lote, N frentes. `abrir_task` continua como sinônimo (um lote de uma frente) para os turnos de antes;
 * - `mandar_para_frente` substitui `mandar_para_task` (mesmos argumentos; `mandar_para_task` continua como sinônimo);
 * - `devolver_resumo` é só da frente: o que ela devolve ao dono, em fatos curtos.
 * O teto do título (200) é o CHECK trabalho_titulo da 0063; o do pedido, o mesmo de `abrir_task`.
 * revisto em 2026-10-18 (plano chat limpo, PR 5, decisões 15 e 17): o título pede 2 a 5 palavras na DESCRIÇÃO, e o teto
 * continua 200 — um teto de 60 faria a chamada inteira falhar na validação (`validarArgsNod`) e o modelo podia desistir
 * das frentes e fazer o trabalho na conversa; o tamanho é medido e a tela corta. `titulo_do_lote` (opcional, sem
 * `minLength` pelo mesmo motivo: vazio vira "sem título") vai para `lotes_de_frentes.titulo` (0092).
 */
const FRENTE: JsonSchema = {
  type: "object",
  properties: {
    titulo: { type: "string", description: "Título da frente em 2 a 5 palavras, como a pessoa diria (ex.: \"Roteiros de animação\"). Não repita o pedido.", minLength: 1, maxLength: 200 },
    pedido: { type: "string", description: "O que esta frente faz, autocontido: ela não vê esta conversa. Inclua nomes, links e o que a pessoa já disse.", minLength: 1, maxLength: 8000 },
    repo: { type: "string", description: "Opcional: o repositório em que ela trabalha (ex.: dono/repo).", minLength: 1, maxLength: 200 },
    branch_base: { type: "string", description: "Opcional: o branch de onde ela parte (padrão: origin/main).", minLength: 1, maxLength: 200 },
    // definido em 2026-10-12 (ADR-099, I4; decisão 5): a frente só empurra o branch que criou, e só quando o dono pede.
    pode_empurrar: { type: "boolean", description: "Opcional: true só quando esta frente deve empurrar o próprio branch e abrir o PR dela. O padrão (false) é ela devolver o branch e o SHA para você integrar." },
  },
  required: ["titulo", "pedido"],
  additionalProperties: false,
};

export const FERRAMENTAS_FRENTE = {
  abrir_frentes: {
    type: "object",
    description:
      "Abre frentes para UM pedido: cada frente é um trabalho que roda à parte, com sessão e pasta próprias, enquanto você segue livre. Use para o que leva mais que alguns minutos ou mexe em arquivos e código; partes independentes do mesmo pedido vão juntas, numa chamada só. Devolve na hora; cada frente devolve um resumo curto quando termina.",
    properties: {
      frentes: { type: "array", minItems: 1, items: FRENTE, description: "As frentes deste pedido, uma por parte independente." },
      titulo_do_lote: { type: "string", description: "Opcional: o que este pedido faz, em 2 a 4 palavras (ex.: \"frentes de hero\"). Útil com mais de uma frente.", maxLength: 200 },
      avisar_a_cada_uma: { type: "boolean", description: "Opcional: true quando as frentes são independentes e você quer o resultado de cada uma quando ela termina; o padrão é voltarem juntas, quando a última termina." },
    },
    required: ["frentes"],
    additionalProperties: false,
  },
  mandar_para_frente: {
    type: "object",
    description: "Repassa um recado a uma frente aberta (o id está em \"Trabalhos em andamento\"). Se ela estiver rodando, o recado entra no meio do trabalho; senão, vira o próximo passo dela. Uma cópia fica na sua conversa.",
    properties: {
      trabalho_id: { type: "string", description: "O id da frente, como veio na lista.", minLength: 1 },
      texto: { type: "string", description: "O recado, autocontido.", minLength: 1, maxLength: 8000 },
    },
    required: ["trabalho_id", "texto"],
    additionalProperties: false,
  },
  devolver_resumo: {
    type: "object",
    description: "Devolve ao dono o que esta frente fez, em fatos curtos: o que fez, o PR, o SHA, o branch e o que falta. Chame uma vez, no fim, e encerre o turno com uma frase.",
    properties: {
      feito: { type: "string", description: "O que você fez, em fatos (ex.: \"Corrigi o login no Safari e abri o PR\").", minLength: 1, maxLength: TETO_TEXTO_RESUMO },
      pr: { type: "integer", description: "Opcional: o número do PR que você abriu ou mexeu (inteiro positivo)." },
      sha: { type: "string", description: "Opcional: o commit (7 a 40 caracteres hexadecimais minúsculos)." },
      branch: { type: "string", description: "Opcional: o branch em que você trabalhou.", minLength: 1, maxLength: TETO_TEXTO_RESUMO },
      falta: { type: "string", description: "Opcional: o que ficou para depois e por quê (o CI ainda rodando, uma resposta de fora, uma decisão).", minLength: 1, maxLength: TETO_TEXTO_RESUMO },
    },
    required: ["feito"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type FrentePedida = { titulo: string; pedido: string; repo?: string; branch_base?: string; pode_empurrar?: boolean };
export type ArgsAbrirFrentes = { frentes: FrentePedida[]; titulo_do_lote?: string; avisar_a_cada_uma?: boolean };
export type ArgsDevolverResumo = { feito: string; pr?: number; sha?: string; branch?: string; falta?: string };

export type ResultadoAbrirFrentes =
  | { ok: true; lote_id: string; frentes: { trabalho_id: string; titulo: string }[]; instrucao: string }
  | { ok: false; erro: "nao_abre_frente" | "sem_frentes" | "teto_de_tasks"; instrucao: string };
export type ResultadoDevolverResumo =
  | { ok: true; instrucao: string }
  | { ok: false; erro: "nao_e_frente" | "resumo_invalido"; instrucao: string };

/** Args ↔ resultado das três, intersectado em ContratoFerramentaNod. */
export type ContratoFerramentasFrente = {
  abrir_frentes: { args: ArgsAbrirFrentes; resultado: ResultadoAbrirFrentes };
  mandar_para_frente: { args: ArgsMandarParaTask; resultado: ResultadoMandarParaTask };
  devolver_resumo: { args: ArgsDevolverResumo; resultado: ResultadoDevolverResumo };
};
