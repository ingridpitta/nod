import type { JsonSchema } from "./json-schema.ts";
import { LIMITES_QUADROS, OPS_QUADROS_DO_BOT } from "./quadros-do-bot.ts";
import { VISOES_DO_QUADRO } from "./raio-x.ts";
import { GRUPOS_COLUNA, LIMITES_QUADRO, MODOS_ESCOLHIVEIS, type ArgsGerirQuadro, type ResultadoGerirQuadro } from "./quadro.ts";

/**
 * gerir_quadro (definido em 2026-10-31, NOD-442, ADR-135): QUALQUER bot faz no quadro o que a pessoa faz na tela — criar o
 * quadro com a meta e o prazo, criar e importar tarefas do Linear, mudar a tarefa de quadro, mudar status, responsável, PR e pergunta, responder o
 * bloqueio e desfazer o último lote. Cada chamada é um lote atômico (tudo ou nada) com um Desfazer. O servidor não fala
 * com o Linear: o bot busca os itens com a ferramenta dele e os passa em `importar_linear`. Mora fora de
 * ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26 e é espalhada em FERRAMENTAS_NOD.
 */

// NOD-448: o status é a coluna (o id ou o nome que o quadro mostra). O padrão: backlog, afazer, fazendo, revisao, bloqueado, voce, feito, cancelado.
const STATUS = { type: "string", minLength: 1, maxLength: 60, description: "A coluna: o id ou o nome (resumo_quadro traz as colunas). Padrão: backlog, afazer (o bot responsável começa sozinho; num quadro sem A fazer, leva à coluna de andamento), fazendo, revisao (PR aberto), bloqueado, voce (Precisa de você; exige pergunta), feito, cancelado." } as const satisfies JsonSchema;
const COLUNA = { type: "string", minLength: 1, maxLength: 60, description: "A coluna: o id ou o nome." } as const satisfies JsonSchema;
const GRUPO = { type: "string", enum: [...GRUPOS_COLUNA], description: "nao_iniciado (espera), iniciado (andamento: o bot começa ao entrar), feito (conta no progresso) ou fechado (sai da conta). Não muda depois." } as const satisfies JsonSchema;
const TAREFA = { type: "string", description: "A tarefa: o código do quadro (ZE-12), o id, o identificador do Linear (NOD-12) ou o título exato.", minLength: 1 } as const satisfies JsonSchema;
const ouNull = (s: JsonSchema, description: string): JsonSchema => ({ anyOf: [s, { type: "null" }], description });
const AGENTE = { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }], description: "O bot responsável: id ou nome exato (sem o Nod). null tira o responsável." } as const satisfies JsonSchema;

/** As propriedades de cada tipo de ação; o registro (src/domain/acoes/quadro.ts) reusa as mesmas. */
export const PROPRIEDADES_QUADRO = {
  meta: ouNull({ type: "string", maxLength: LIMITES_QUADRO.meta }, "Opcional: a meta em uma frase (o que é 'pronto'). Sem meta é o fluxo contínuo (sem progresso nem risco de prazo); null tira."),
  prazo: ouNull({ type: "string" }, "O prazo, AAAA-MM-DD; null tira."),
  titulo: { type: "string", minLength: 1, maxLength: LIMITES_QUADRO.titulo },
  descricao: { type: "string", maxLength: LIMITES_QUADRO.descricao },
  status: STATUS,
  agente: AGENTE,
  tarefa: TAREFA,
  pr_url: ouNull({ type: "string" }, "O PR do GitHub (https://github.com/dono/repo/pull/N). Sem status, a tarefa vai para revisao."),
  pergunta: ouNull({ type: "string", maxLength: LIMITES_QUADRO.pergunta }, "O que a pessoa precisa responder (com status voce). null tira."),
  excluir: { type: "boolean", description: "true tira a tarefa do quadro (o Desfazer a traz de volta)." },
  sem_iniciar: { type: "boolean", description: "true: muda de coluna (e de responsável, pela passagem) sem acionar ninguém." },
  instrucoes: ouNull({ type: "string", maxLength: LIMITES_QUADRO.instrucoes }, "definir_passagem: o que essa etapa faz (vai no pedido de quem pega a tarefa nela). null tira."),
  // NOD-419: os freios da esteira.
  motivo: { type: "string", minLength: 1, maxLength: LIMITES_QUADRO.motivo, description: "nao_e_comigo: por que não é com você (obrigatório). mudar_tarefa: o motivo ao cancelar (obrigatório para o bot que manda para Cancelado)." },
  movimento: { type: "string", minLength: 1, maxLength: 64, description: "desfazer_movimento: o id do movimento (em movimentos da tarefa, no resultado). Sem ele, o último que mudou a tarefa." },
  sai_para: ouNull({ type: "array", maxItems: LIMITES_QUADRO.colunas, items: COLUNA }, "travar_coluna: as únicas colunas para onde a tarefa sai desta (Precisa de você e Bloqueado valem sempre). null tira."),
  so_pessoa: { type: "boolean", description: "travar_coluna: true = só a pessoa tira a tarefa desta coluna (o bot não move); false tira." },
  resposta: { type: "string", minLength: 1, maxLength: LIMITES_QUADRO.resposta },
  texto: { type: "string", minLength: 1, maxLength: LIMITES_QUADRO.comentario, description: "comentar: o texto (no seu quadro, @Nome de um bot o aciona; no quadro de outra pessoa, o pedido para a dona, em uma frase). recado: o que a pessoa disse, como ela disse." },
  lote: { type: "string", description: "O lote a desfazer; sem ele, o último." },
  quadro: { type: "string", minLength: 1, maxLength: 200, description: "mover_quadro: o quadro de destino (o nome do bot anfitrião, o nome do quadro, \"Bot / Quadro\", o prefixo do código, como ZE, ou o id). abrir_quadro, definir_padrao, vincular_bot, desvincular_bot: qual quadro (o nome, \"Bot / Quadro\" ou o id)." },
  bot: { type: "string", minLength: 1, maxLength: 200, description: "remover_quadro: o nome do bot dono do quadro, como a pessoa disse (obrigatório para o bot). vincular_bot/desvincular_bot: o bot que entra ou sai do quadro. definir_padrao: de qual bot (sem ele, você)." },
  pessoa: { type: "string", minLength: 1, maxLength: 200, description: "adicionar_pessoa/tirar_pessoa: o nome (ou o id) de alguém do time." },
  quem_fecha: { type: "string", enum: ["bot", "pessoa"], description: "editar_quadro (ADA-28): quem dá o Done. bot (padrão): o bot leva a tarefa a Feito. pessoa: o bot para antes (o terminei na última etapa pede o Done à pessoa) e não move para Feito; só a dona, a pedido dela na conversa." },
  modo: { type: "string", enum: [...MODOS_ESCOLHIVEIS], description: "mudar_modo (e adicionar_pessoa, opcional: o modo junto com a primeira pessoa, no mesmo lote): so_dono (só a dona conversa; quem participa comenta numa tarefa) ou individual (cada um na sua conversa; o padrão)." },
  nome: { type: "string", description: "O nome da coluna (criar_coluna, renomear_coluna); do quadro (criar_quadro: um nome novo cria OUTRO quadro neste bot; editar_quadro renomeia; null volta a Tarefas); ou do projeto (criar_projeto, editar_projeto).", minLength: 1, maxLength: Math.max(LIMITES_QUADRO.coluna, LIMITES_QUADROS.nome) },
  projeto: ouNull({ type: "string", minLength: 1, maxLength: 200 }, "O projeto: o nome ou o id. criar_quadro/editar_quadro: o projeto do quadro (null tira do projeto, o quadro fica solto); editar/arquivar/restaurar_projeto: qual."),
  todos: { type: "boolean", description: "listar_quadros: true lista os quadros de todos os bots da pessoa (sem ele, os deste bot)." },
  grupo: GRUPO,
  coluna: COLUNA,
  depois_de: { ...COLUNA, description: "A coluna (do mesmo grupo) que fica antes." },
  // ADA-18: o Exibir do quadro (op exibir), da pessoa: a visão no celular e as do computador.
  visao: { type: "string", enum: [...VISOES_DO_QUADRO], description: "exibir: a visão do quadro no celular — lista (agrupada por coluna), colunas (uma por tela, com snap) ou minhas (só o que está com a pessoa)." },
  recolhidas: { type: "boolean", description: "exibir: true mostra as colunas recolhidas no quadro em tela cheia." },
  compacto: { type: "boolean", description: "exibir: true deixa os cards do quadro em tela cheia compactos." },
  prazo_min: ouNull({ type: "integer" }, "Prazo da coluna em minutos (só onde o trabalho anda): a tarefa parada além dele faz o quadro cobrar o responsável e, se continuar parada, avisar a pessoa. null tira."),
  antes_de: { ...COLUNA, description: "A coluna (do mesmo grupo) que fica depois." },
  destino: { ...COLUNA, description: "Para onde vão as tarefas da coluna removida (obrigatório se ela tiver tarefas)." },
  colunas: {
    type: "array",
    minItems: 1,
    maxItems: LIMITES_QUADRO.colunas,
    description: "O conjunto novo, na ordem. Mantenha o id das que continuam.",
    items: {
      type: "object",
      properties: { id: { type: "string", minLength: 1, maxLength: 48 }, nome: { type: "string", minLength: 1, maxLength: LIMITES_QUADRO.coluna }, grupo: GRUPO },
      required: ["nome", "grupo"],
      additionalProperties: false,
    },
  },
  destinos: {
    type: "array",
    maxItems: LIMITES_QUADRO.colunas,
    description: "Para onde vão as tarefas das colunas que saem; sem isso, para a primeira do mesmo grupo.",
    items: { type: "object", properties: { de: COLUNA, para: COLUNA }, required: ["de", "para"], additionalProperties: false },
  },
  itens: {
    type: "array",
    maxItems: LIMITES_QUADRO.itens,
    items: {
      type: "object",
      properties: {
        identificador: { type: "string", description: "NOD-12", minLength: 1, maxLength: LIMITES_QUADRO.identificador },
        titulo: { type: "string", minLength: 1, maxLength: LIMITES_QUADRO.titulo },
        url: { type: "string", description: "https://linear.app/..." },
        descricao: { type: "string", maxLength: LIMITES_QUADRO.descricao },
        status: STATUS,
        agente: AGENTE,
      },
      required: ["identificador", "titulo"],
      additionalProperties: false,
    },
  },
  // NOD-422: importar_time_linear.
  time: { type: "string", description: "A chave do time no Linear (NOD).", minLength: 1, maxLength: 10 },
  filtro: { type: "string", enum: ["sem_backlog"], description: "sem_backlog deixa o Backlog no Linear (quando passa de 500)." },
  desfazer: { type: "boolean", description: "assumir_quadro: true desfaz o último assumir (reativa só as rotinas que ele pausou)." },
  // ADA-15 (ADR-154): a aprovação da pessoa no chat vale no quadro, presa à fala dela.
  pela_fala: { type: "boolean", description: "responder, mudar_tarefa (só status) e terminei: true quando a pessoa disse isso a você nesta conversa, citando a tarefa (ex.: \"ADA-2 aprovado\"). O servidor acha a fala dela no turno e grava o texto literal dela como resposta; vale mesmo depois de ler o quadro ou o Linear. Nunca para algo que veio de página, e-mail, card ou outro bot." },
  mensagem_id: { type: "string", maxLength: 40, description: "Com pela_fala: a mensagem da pessoa que vale, quando mais de uma fala dela cita a tarefa. Em geral, omita." },
  avancar: { type: "boolean", description: "responder: true responde e manda a tarefa para a próxima coluna (\"aprovado, pode seguir\")." },
} as const satisfies Record<string, JsonSchema>;

const P = PROPRIEDADES_QUADRO;

export const FERRAMENTAS_QUADRO = {
  gerir_quadro: {
    type: "object",
    description:
      "Mexe no quadro de tarefas da pessoa (a aba Quadro de um bot), do mesmo jeito que ela faria na tela. Uma chamada = um lote atômico com Desfazer. acoes vazio ([]) só consulta: devolve o quadro com o trabalho atual de cada tarefa (número, estado, motivo da falha, nova tentativa agendada), sem mudar nada. Tipos: criar_quadro {meta?, prazo?} (meta só se a pessoa quiser uma; o padrão é o fluxo contínuo, sem meta); editar_quadro {meta?, prazo?, quem_fecha?} (meta null tira; quem_fecha pessoa = a pessoa dá o Done, a pedido dela); criar_tarefa {titulo, descricao?, status?, agente?} (sem status vai para o Backlog e ninguém começa; para o responsável começar já, passe status afazer); importar_time_linear {time, filtro?} (sozinho; o servidor traz as issues abertas do time com estados, comentários e PR, e a pessoa confirma num card com a prévia; prefira a importar_linear); assumir_quadro {desfazer?} (sozinho; só a pedido da pessoa; o quadro assume a esteira: lista as rotinas ativas dos bots do quadro num card que ela confirma, e só então elas pausam e a importação do Linear deixa de rodar; desfazer true reativa só as que o assumir pausou); importar_linear {itens} (poucos itens que você já buscou no Linear); mudar_tarefa {tarefa, titulo?, descricao?, status?, agente?, pr_url?, pergunta?, excluir?, motivo?, sem_iniciar?} (status bloqueado pede a pergunta: o motivo e do que você precisa; status cancelado pede o motivo, ex.: duplicada; sem_iniciar true muda de coluna, e de responsável pela passagem, sem acionar ninguém); responder {tarefa, resposta, avancar?, pela_fala?} (quando a pessoa respondeu a você nesta conversa citando a tarefa, como \"ADA-2 aprovado\", passe pela_fala true: vale mesmo depois de ler o quadro ou o Linear e o card guarda a fala literal dela; se a fala não citar a tarefa ou houver duas, pergunte a ela com o código; avancar true responde e manda para a próxima coluna; pela_fala também vale em mudar_tarefa só com status e em terminei); comentar {tarefa, texto} (sozinho; sem Desfazer; no seu quadro; aciona o responsável só com a tarefa em andamento, como Fazendo e Em revisão; em Backlog, A fazer, Feito ou Cancelado fica na tarefa sem acioná-lo; @Nome aciona aquele bot sem trocar o responsável; o seu comentário não aciona você); desfazer {lote?} (sozinho no lote); mover_quadro {tarefa, quadro} (sozinho; leva a tarefa para o quadro de outro bot da pessoa com o histórico e os comentários, cai na coluna do mesmo grupo e não aciona ninguém; ela ganha o código do destino e o antigo continua abrindo; sem Desfazer); remover_quadro {bot} (sozinho; o seu quadro ou o de outro bot dela, com quadro = o nome do dono; o dono volta a agente comum: apaga o quadro, as tarefas e o histórico, sem Desfazer; a conversa e a memória ficam; só quando a pessoa pedir: passe em bot o nome do dono, como ela disse; vira um card Excluir / Agora não que ela confirma, ou sai na hora no automático). Colunas: criar_coluna {nome, grupo, depois_de?, prazo_min?}; renomear_coluna {coluna, nome?, prazo_min?} (prazo_min sozinho põe ou tira o prazo); mover_coluna {coluna, antes_de? | depois_de?} (só dentro do grupo); remover_coluna {coluna, destino?} (com tarefas, o destino é obrigatório; Precisa de você e Cancelado não saem); substituir_colunas {colunas, destinos?} (sozinho no lote; vira uma proposta que a pessoa confirma num card); definir_passagem {coluna, agente?, instrucoes?} (a coluna passa a tarefa que entra nela para o bot agente: em A fazer e nas colunas de andamento ele começa na hora; nas outras de Não iniciado, como Backlog, a tarefa passa para ele, sem acionar; agente null tira a passagem). Etapas: terminei {tarefa?} manda a tarefa para a próxima coluna (sem tarefa, a do seu turno) e, se a coluna aciona, quem cuida dela começa — use ao acabar a sua etapa. nao_e_comigo {tarefa, motivo}: a tarefa que é sua mas não é com você — você sai de responsável, o motivo fica, e o quadro passa ao responsável da coluna ou à pessoa. desfazer_movimento {tarefa, movimento?} desfaz o último movimento que mudou a tarefa de coluna ou de mão (sem movimento, esse; os ids vêm em movimentos de cada tarefa no resultado; um mais antigo não se desfaz), só num turno limpo (o seu; o dos outros só a pedido da pessoa). travar_coluna {coluna, sai_para?, so_pessoa?} trava a saída da coluna (A fazer não se trava); se uma trava recusar, siga a frase do erro (mova para a coluna que ela aceita, ou peça à pessoa). Ir e voltar sem parar entre as mesmas colunas, ou acionar demais a mesma tarefa, a manda para Bloqueado. Trabalho da tarefa (cada um sozinho, sem Desfazer, só a pedido da pessoa na conversa com você): repetir_trabalho {tarefa} abre um trabalho novo (para o atual; a tarefa Bloqueada volta para onde estava); cancelar_trabalho {tarefa} para o trabalho atual e os recados que aguardavam, sem mover a tarefa; recado {tarefa, texto} leva o que a pessoa disse ao trabalho em andamento (entra no próximo passo; sem trabalho, vira um novo); acordar_trabalho {tarefa} dispara já a volta marcada do trabalho (me_chame_as na hora ou na CI), na mesma sessão. Criar, renomear, mover e remover coluna não pedem confirmação: conte o que mudou em uma frase, a pessoa tem Desfazer. Tarefa em afazer com responsável faz o bot responsável começar sozinho. Ao terminar a sua tarefa, ponha o PR (vai para revisao) e depois status feito (no quadro com quem_fecha pessoa, use terminei: ela recebe o pedido de Done); quando travar numa decisão da pessoa, use status voce com a pergunta (o quadro avisa a pessoa e junta as decisões pendentes numa mensagem só). Várias pessoas (sozinhos no lote): adicionar_pessoa {pessoa, modo?}, tirar_pessoa {pessoa} e mudar_modo {modo} só a dona do quadro; no quadro de outra pessoa, comentar {texto, tarefa?} deixa o pedido para a dona (é o caminho no modo so_dono). No quadro de outra pessoa do time, passe em quadro o id dele: o que você fizer sai assinado por quem te pediu. Vários quadros (cada um sozinho na chamada, sem Desfazer de lote: o inverso é a op contrária): um bot pode ter mais de um quadro (um é o padrão, o que abre e o que vale quando ninguém diz qual); criar_quadro {nome, projeto?} cria outro quadro neste bot; editar_quadro {nome?, projeto?} renomeia ou põe/tira do projeto; listar_quadros {todos?} lista os quadros (deste bot ou de todos) com os projetos; abrir_quadro {quadro} faz o app Quadro deste bot abrir nele; definir_padrao {quadro, bot?}; vincular_bot {quadro, bot} põe o quadro também em outro bot (o dono segue o mesmo; as passagens e responsáveis valem para qualquer bot do quadro); desvincular_bot {quadro, bot} (se sai o dono, o próximo bot vira dono; o último bot não sai: use remover_quadro); criar_projeto {nome, descricao?, meta?, prazo?}, editar_projeto {projeto, nome?, descricao?, meta?, prazo?}, arquivar_projeto {projeto} (os quadros ficam, soltos) e restaurar_projeto {projeto}. Padrão, vínculo e projetos só a pedido da pessoa, na conversa com você. Para mexer num quadro que não é o padrão, passe em quadro o nome dele (ou \"Bot / Quadro\"). Exibir (sozinho, sem Desfazer, só a pedido da pessoa na conversa com você; é a preferência dela, não muda o quadro de ninguém): exibir {visao?, recolhidas?, compacto?} troca como ela vê este quadro (visao lista, colunas ou minhas é a do celular).",
    properties: {
      quadro: { type: "string", description: "O quadro: o id, o nome do bot anfitrião (o quadro padrão dele), o nome do quadro ou \"Bot / Quadro\" (o de outra pessoa do time: o id ou o prefixo). Sem ele, o seu padrão; senão, o único da pessoa." },
      acoes: {
        type: "array",
        minItems: 0,
        maxItems: LIMITES_QUADRO.ops,
        items: {
          type: "object",
          properties: {
            tipo: { type: "string", enum: ["criar_quadro", "editar_quadro", "criar_tarefa", "importar_linear", "importar_time_linear", "assumir_quadro", "mudar_tarefa", "responder", "comentar", "desfazer", "mover_quadro", "remover_quadro", "criar_coluna", "renomear_coluna", "mover_coluna", "remover_coluna", "substituir_colunas", "definir_passagem", "terminei", "repetir_trabalho", "cancelar_trabalho", "acordar_trabalho", "adicionar_pessoa", "tirar_pessoa", "mudar_modo", "recado", "nao_e_comigo", "desfazer_movimento", "travar_coluna", "exibir", ...OPS_QUADROS_DO_BOT] },
            ...P,
          },
          required: ["tipo"],
          additionalProperties: false,
        },
      },
    },
    required: ["acoes"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ContratoFerramentasQuadro = {
  gerir_quadro: { args: ArgsGerirQuadro; resultado: ResultadoGerirQuadro };
};
