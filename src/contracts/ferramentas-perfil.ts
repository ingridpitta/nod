import type { CodigoErro } from "./motivos.ts";
import type { JsonSchema } from "./json-schema.ts";
import { FERRAMENTAS_ROTINA, type ArgsCriarRotina, type RotinaListada } from "./ferramentas-rotina.ts";

/**
 * O que o bot É (atualizar_perfil) e o que os colegas dele FAZEM (ver_colegas). Mora fora de
 * ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26, como ferramentas-rotina.ts; a lista
 * continua FECHADA e única: estas entradas são espalhadas em FERRAMENTAS_NOD, não uma segunda lista.
 *
 * definido em 2026-09-28 (ADR-050, "bot novo é bot completo"): a Teodora recebeu "vire minha assistente
 * e pegue o que a Taga, a Ada e a Nina fazem" e respondeu cinco vezes "não consigo". O que cada colega
 * faz é dado do nod (perfil, rotinas, apps concedidos), não pergunta a outro modelo; e o perfil que
 * nasce do pedido chega com as rotinas dele, para a pessoa confirmar num card só.
 */
export const FERRAMENTAS_PERFIL = {
  atualizar_perfil: {
    type: "object",
    description: "Propõe nome, título e/ou descrição para este agente e, em rotinas, as tarefas recorrentes que vêm com a missão. A pessoa confirma tudo num card só; nada muda antes disso.",
    properties: {
      nome: { type: "string", description: "Nome curto do agente.", minLength: 1 },
      titulo: { type: "string", description: "Título de uma linha.", minLength: 1 },
      descricao: { type: "string", description: "O que o agente faz e como responde (regras duráveis).", minLength: 1 },
      rotinas: {
        type: "array",
        maxItems: 10,
        items: FERRAMENTAS_ROTINA.criar_rotina,
        description: "Rotinas que vêm com o perfil, cada uma na forma de criar_rotina. Confirmar o perfil cria todas e libera a leitura dos apps que elas declaram.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  ver_colegas: {
    type: "object",
    description: "Mostra o que os outros bots da pessoa fazem hoje: perfil, rotinas (id, horário, estado, instrução) e apps que cada um usa. É leitura do próprio nod: nada muda e nenhum colega é consultado.",
    properties: {
      agente: { type: "string", description: "Id do diretório de colegas ou nome único do bot. Ausente: todos os colegas.", minLength: 1 },
    },
    required: [],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsAtualizarPerfil = { nome?: string; titulo?: string; descricao?: string; rotinas?: ArgsCriarRotina[] };
/**
 * `rotina` no erro é o índice da primeira rotina recusada: nada foi criado, e o modelo corrige aquela
 * rotina e chama de novo (mesmo contrato tipado de criar_rotina).
 */
export type ResultadoAtualizarPerfil = { proposta_id: string; rotinas: { resumo: string }[] } | { erro: CodigoErro; rotina: number };

export type ArgsVerColegas = { agente?: string };
/** `nivel` pelo que foi concedido de fato: escrita se alguma capacidade concedida não é de leitura. */
export type AppDoColega = { slug: string; nome: string; nivel: "leitura" | "escrita" };
/** definido em 2026-10-30 (NOD-20, revisão 3 M2): as últimas versões do perfil, para o Nod escolher o número do restaurar_versao. */
export type VersaoListada = { versao: number; origem: string; autor: string; campos: string[]; atual: boolean };
export type ColegaListado = { id: string; nome: string; titulo: string; descricao: string; rotinas: RotinaListada[]; apps: AppDoColega[]; versoes?: VersaoListada[] };
export type ResultadoVerColegas = { colegas: ColegaListado[] } | { erro: CodigoErro };
