import { FONTES_DO_APP, FORMAS_DO_APP, ICONES_DO_APP, MAX_ORDEM_GUARDADA, type ArgsGerirApps, type ResultadoGerirApps } from "./apps.ts";
import type { JsonSchema } from "./json-schema.ts";

/**
 * gerir_apps (definido em 2026-11-02, NOD-445, ADR-146): QUALQUER bot faz nas páginas do bot o que a pessoa faz na pílula
 * — propor um app (vira o card Criar/Ajustar), editar, reordenar as páginas (a Conversa inclusive), remover e restaurar.
 * O app só exibe o retrato que o bot grava aqui (`dados`) com os acessos dele. Mora fora de ferramentas-nod.ts pelo
 * gatilho de 200 linhas da EMENDA 26 e é espalhada em FERRAMENTAS_NOD.
 */

const PAGINA = { type: "string", minLength: 1, maxLength: 200, description: "A página: conversa, tarefas, o nome do app ou o id (app:<id>)." } as const satisfies JsonSchema;
const ouNull = (s: JsonSchema, description: string): JsonSchema => ({ anyOf: [s, { type: "null" }], description });

/** As propriedades de cada ação; o registro (src/domain/acoes/apps.ts) reusa as mesmas. */
export const PROPRIEDADES_APPS = {
  bot: { type: "string", minLength: 1, maxLength: 200, description: "O bot dono das páginas: o id ou o nome exato (\"cria um app de vagas para a Nina\"). Sem ele, você." },
  app: { type: "string", minLength: 1, maxLength: 200, description: "O app: o nome ou o id." },
  nome: { type: "string", minLength: 1, maxLength: 20, description: "Nome curto, até 20 caracteres, sem repetir outro app do bot." },
  icone: { type: "string", enum: [...ICONES_DO_APP], description: "O ícone (sugira um; a pessoa pode trocar)." },
  fonte: { type: "string", enum: [...FONTES_DO_APP], description: "De onde vêm os dados: tarefas (o quadro), conector (um app conectado), arquivo (um arquivo ou doc do bot) ou bot (você mantém)." },
  fonte_ref: ouNull({ type: "string", minLength: 1, maxLength: 500 }, "O slug do conector ou o caminho do arquivo."),
  forma: { type: "string", enum: [...FORMAS_DO_APP], description: "Como mostrar: lista, quadro (itens com coluna), painel (números) ou doc (texto)." },
  regra_pede: ouNull({ type: "string", maxLength: 300 }, "O que conta como \"pede você\", em linguagem natural (\"vaga sem resposta há 2 dias\"), para a pessoa ler. Sem regra, o app nunca acende."),
  pede_quando: ouNull({
    type: "object",
    properties: {
      coluna: { type: "string", minLength: 1, maxLength: 40, description: "O item pede quando a coluna dele é esta (sem acento nem caixa)." },
      dias_desde: { type: "number", description: "O item pede quando espera há mais de N dias (de 0 a 3650; conta do desde do item)." },
      valor_acima: { type: "number", description: "O item pede quando o número do valor passa disto." },
      valor_abaixo: { type: "number", description: "O item pede quando o número do valor fica abaixo disto." },
    },
    additionalProperties: false,
  }, "A regra do \"pede você\" que o servidor confere em cada item, valendo todas juntas, ao menos uma (\"vaga sem resposta há 2 dias\" = {coluna: \"Sem resposta\", dias_desde: 2}). Prefira sempre que a regra couber nela: com ela o app acende mesmo quando você atualiza depois de ler a fonte, e a marca pede dos itens é ignorada."),
  dados: ouNull({
    type: "object",
    properties: {
      itens: {
        type: "array",
        maxItems: 200,
        items: {
          type: "object",
          properties: {
            titulo: { type: "string", minLength: 1, maxLength: 200 },
            detalhe: { type: "string", maxLength: 300 },
            coluna: { type: "string", maxLength: 40 },
            valor: { type: "string", maxLength: 40 },
            desde: { type: "string", maxLength: 40, description: "Desde quando o item espera (data ISO, 2026-10-30): o dias_desde da regra conta daqui." },
            pede: { type: "boolean", description: "true quando o item cumpre a regra do \"pede você\" em texto; com pede_quando, o servidor decide e isto é ignorado." },
          },
          required: ["titulo"],
          additionalProperties: false,
        },
      },
      texto: { type: "string", maxLength: 20000 },
    },
    required: ["itens"],
    additionalProperties: false,
  }, "O retrato que a página mostra, lido por você com os seus acessos. Regrave quando a fonte mudar."),
  erro_fonte: ouNull({ type: "string", maxLength: 300 }, "Por que a fonte não respondeu (conector revogado, arquivo sumiu); null quando voltou."),
  ordem: { type: "array", maxItems: MAX_ORDEM_GUARDADA, items: PAGINA, description: "A ordem inteira das páginas; a primeira é a tela inicial do bot." },
  pagina: PAGINA,
  posicao: { type: "integer", description: "A posição nova (1 = a primeira, a tela inicial)." },
  antes_de: PAGINA,
  depois_de: PAGINA,
} as const satisfies Record<string, JsonSchema>;

const P = PROPRIEDADES_APPS;

export const FERRAMENTAS_APPS = {
  gerir_apps: {
    type: "object",
    description:
      "As páginas do bot na pílula: a Conversa, Tarefas (quando o bot tem quadro) e os apps que a pessoa pede. O app só EXIBE o retrato que você grava em dados com os seus acessos; as ações saem pela conversa. Ops: listar {bot?}; propor {bot?, nome, icone?, fonte, fonte_ref?, forma, regra_pede?} (vira o card Criar/Ajustar na conversa: nada nasce até a pessoa confirmar; para ajustar, proponha de novo com o mesmo nome, e só o card anterior desse app sai); editar {bot?, app, nome?, icone?, forma?, fonte?, fonte_ref?, regra_pede?, pede_quando?, dados?, erro_fonte?}; ordenar {bot?, ordem} ou {bot?, pagina, posicao | antes_de | depois_de} (qualquer página, a Conversa inclusive; a primeira é a tela inicial, a view padrão: o que abre primeiro no bot; abrir no quadro = pagina tarefas, posicao 1); remover {bot?, app} (sai direto, sem card; o dado de origem fica; a Conversa não sai); restaurar {bot?, app} (o id que remover devolveu, ou o nome: volta o removido mais recente com esse nome). O retrato (dados, erro_fonte) só nas suas próprias páginas (nas de outro bot, só a configuração), e erro_fonte só num turno sem conteúdo de fora. Fora de uma conversa com a pessoa, só o retrato muda; remover, ordenar e mudar regra_pede, pede_quando, fonte ou fonte_ref também não valem depois de ler conteúdo de fora no turno, e nesse turno as páginas de outro bot ficam como estão. Até 11 apps por bot (a 12ª página é de Tarefas). Se faltar acesso a um conector, use pedir_acesso.",
    properties: {
      op: { type: "string", enum: ["listar", "propor", "editar", "ordenar", "remover", "restaurar"] },
      ...P,
    },
    required: ["op"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ContratoFerramentasApps = {
  gerir_apps: { args: ArgsGerirApps; resultado: ResultadoGerirApps };
};
