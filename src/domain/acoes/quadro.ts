import type { DefinicaoAcao } from "../../contracts/acoes.ts";
import { PROPRIEDADES_QUADRO as P } from "../../contracts/ferramentas-quadro.ts";
import type { JsonSchema } from "../../contracts/json-schema.ts";

/**
 * As ações do quadro (definido em 2026-10-31, NOD-442, ADR-135). Todas `vivo`: a rota da tela
 * (src/adapters/http/rotas/quadro.ts) e o gerir_quadro de QUALQUER bot passam pelo mesmo lote
 * (aplicarLoteQuadro, src/use-cases/quadro.ts), e o teste de contrato (tests/integration/paridade-quadro.test.ts) leva os
 * dois ao mesmo estado no banco. Não entram no gerir_bots (sem `lote`): o gerir_quadro é a via.
 *
 * Risco "muda": o quadro é da pessoa e cada lote tem Desfazer; começar uma tarefa abre um turno de delegação, que segue as
 * aprovações do bot responsável; o turno nasce contaminado quando a tarefa foi escrita por um turno não confiável (deFora).
 */

const objeto = (properties: Record<string, JsonSchema>, required: readonly string[]): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
const VIA = { ferramenta: "gerir_quadro" } as const;
/** A escolha de cada chip do comentário (id do agente → modo), como a tela manda. */
const ACIONAR: JsonSchema = { type: "array", maxItems: 20, description: "A escolha de cada chip, pela tela: [{agente, modo}].", items: objeto({ agente: { type: "string", minLength: 1, maxLength: 100 }, modo: { type: "string", enum: ["acionar", "agora", "depois", "no_lugar", "nao"] } }, ["agente", "modo"]) };
const CONTRATO = "tests/integration/paridade-quadro.test.ts";
const vivo = { estado: "vivo", via: VIA, contrato: CONTRATO } as const;
/** ADA-14: o contrato dos N quadros e dos projetos (cada lado num banco idêntico: os projetos são da pessoa toda). */
const vivoN = { estado: "vivo", via: VIA, contrato: "tests/integration/paridade-quadros-do-bot.test.ts" } as const;

export const ACOES_QUADRO = [
  {
    id: "quadro.criar",
    titulo: "Criar o quadro de um bot (meta e prazo opcionais; com nome, outro quadro no mesmo bot, ADA-14)",
    schema: objeto({ meta: P.meta, prazo: P.prazo, nome: P.nome, projeto: P.projeto }, []),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.criar",
  },
  {
    id: "quadro.editar",
    titulo: "Mudar a meta, o prazo, o nome, o projeto ou quem dá o Done no quadro",
    schema: objeto({ meta: P.meta, prazo: P.prazo, nome: P.nome, projeto: P.projeto, quem_fecha: P.quem_fecha }, []),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.editar",
  },
  {
    id: "quadro.criar_tarefa",
    titulo: "Criar uma tarefa no quadro",
    schema: objeto({ titulo: P.titulo, descricao: P.descricao, status: P.status, agente: P.agente, prioridade: P.prioridade, labels: P.labels, prazo_em: P.prazo_em }, ["titulo"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.criar_tarefa",
  },
  {
    id: "quadro.importar_linear",
    titulo: "Trazer itens do Linear para o quadro",
    schema: objeto({ itens: P.itens }, ["itens"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.importar_linear",
  },
  {
    // NOD-422: o servidor traz o time do Linear (só lê o Linear). Pela conversa vira o card de prévia (importacao_linear);
    // pela tela a pessoa vê a prévia e o clique é a confirmação. Tem Desfazer e não aciona ninguém.
    id: "quadro.importar_time_linear",
    titulo: "Trazer um time do Linear para o quadro (com prévia)",
    schema: objeto({ time: P.time, filtro: P.filtro }, ["time"]),
    risco: "muda",
    cartaoNoChat: true,
    chat: vivo,
    casoDeUso: "quadro.importar_time_linear",
  },
  {
    // NOD-422 (PR 2): o quadro assume a esteira. Lista as rotinas ativas dos bots do quadro (a bc381ef2 e a lista de
    // exclusão ficam de fora) e só pausa com a confirmação da pessoa: pela conversa o card 'assumir_quadro'; pela tela a
    // lista e o clique. Tem Desfazer (reativa só as que pausou): "muda".
    id: "quadro.assumir",
    titulo: "O quadro assume a esteira: pausar as rotinas dos bots do quadro (com confirmação e Desfazer)",
    schema: objeto({ desfazer: P.desfazer }, []),
    risco: "muda",
    cartaoNoChat: true,
    chat: vivo,
    casoDeUso: "quadro.assumir",
  },
  {
    id: "quadro.mudar_tarefa",
    titulo: "Mudar uma tarefa (status, responsável, PR, pergunta, labels, prazo) ou tirá-la do quadro",
    schema: objeto({ tarefa: P.tarefa, titulo: P.titulo, descricao: P.descricao, status: P.status, agente: P.agente, pr_url: P.pr_url, prioridade: P.prioridade, pergunta: P.pergunta, excluir: P.excluir, sem_iniciar: P.sem_iniciar, motivo: P.motivo, pela_fala: P.pela_fala, mensagem_id: P.mensagem_id, labels: P.labels, por_labels: P.por_labels, tirar_labels: P.tirar_labels, prazo_em: P.prazo_em }, ["tarefa"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.mudar_tarefa",
  },
  {
    id: "quadro.responder",
    titulo: "Responder a pergunta de uma tarefa bloqueada",
    schema: objeto({ tarefa: P.tarefa, resposta: P.resposta, avancar: P.avancar, pela_fala: P.pela_fala, mensagem_id: P.mensagem_id }, ["tarefa"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.responder",
  },
  {
    id: "quadro.comentar",
    titulo: "Comentar uma tarefa (aciona o responsável, o agente da thread ou o bot @mencionado; no quadro de outra pessoa, fica para a dona)",
    // 2026-11-10: responder_a (a thread) e acionar (a escolha de cada chip, só pela tela: o bot não decide pelo chip).
    schema: objeto({ tarefa: P.tarefa, texto: P.texto, responder_a: P.responder_a, acionar: ACIONAR }, ["texto"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.comentar",
  },
  {
    id: "quadro.desfazer",
    titulo: "Desfazer a última mudança no quadro",
    schema: objeto({ lote: P.lote }, []),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.desfazer",
  },
  {
    // NOD-416 (ADR-144): mudar a tarefa de quadro. Sem lote nem Desfazer, mas não aciona ninguém e volta com outro
    // mover: "muda". O código antigo continua abrindo; o histórico vai junto.
    id: "quadro.mover_tarefa",
    titulo: "Mudar a tarefa para o quadro de outro bot",
    schema: objeto({ tarefa: P.tarefa, quadro: P.quadro }, ["tarefa", "quadro"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.mover_tarefa",
  },
  {
    // NOD-415 (ADR-141): virar quadro e voltar. Arriscada: sem Desfazer. A tela confirma antes. NOD-430: pela conversa,
    // qualquer bot pede (o do próprio quadro ou de outro), num turno limpo da pessoa, com o nome do dono em `bot` — e vira
    // o card 'quadro_exclusao' (src/use-cases/quadro-exclusao.ts); no automático/total o modo confirma sozinho.
    id: "quadro.remover",
    titulo: "Remover o quadro (o bot volta a ser um agente comum; conversa e memória ficam)",
    schema: objeto({ bot: P.bot }, []),
    risco: "arriscada",
    cartaoNoChat: true,
    chat: vivo,
    casoDeUso: "quadro.remover",
  },
  // NOD-448 (ADR-140): as colunas. Pela conversa, criar, renomear, mover e remover saem na hora com Desfazer; substituir
  // o conjunto vira um card que a pessoa confirma (cartaoNoChat).
  {
    id: "quadro.criar_coluna",
    titulo: "Criar uma coluna no quadro (com o grupo)",
    schema: objeto({ nome: P.nome, grupo: P.grupo, depois_de: P.depois_de, prazo_min: P.prazo_min }, ["nome", "grupo"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.criar_coluna",
  },
  {
    id: "quadro.renomear_coluna",
    titulo: "Renomear uma coluna do quadro (ou pôr/tirar o prazo dela)",
    schema: objeto({ coluna: P.coluna, nome: P.nome, prazo_min: P.prazo_min }, ["coluna"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.renomear_coluna",
  },
  {
    id: "quadro.mover_coluna",
    titulo: "Mudar uma coluna de lugar (dentro do grupo)",
    schema: objeto({ coluna: P.coluna, antes_de: P.antes_de, depois_de: P.depois_de }, ["coluna"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.mover_coluna",
  },
  {
    id: "quadro.remover_coluna",
    titulo: "Remover uma coluna (as tarefas vão para o destino)",
    schema: objeto({ coluna: P.coluna, destino: P.destino }, ["coluna"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.remover_coluna",
  },
  {
    id: "quadro.substituir_colunas",
    titulo: "Trocar o conjunto de colunas do quadro",
    schema: objeto({ colunas: P.colunas, destinos: P.destinos }, ["colunas"]),
    risco: "muda",
    cartaoNoChat: true,
    chat: vivo,
    casoDeUso: "quadro.substituir_colunas",
  },
  // ADR-142: a passagem por coluna (quem pega a tarefa ao entrar nela) e o fim da etapa. O terminei leva à próxima
  // coluna pelo mesmo mudar_tarefa da pessoa e do bot.
  {
    id: "quadro.definir_passagem",
    titulo: "Definir quem pega a tarefa ao entrar numa coluna",
    schema: objeto({ coluna: P.coluna, agente: P.agente, instrucoes: P.instrucoes, proxima: P.proxima, volta_para: P.volta_para }, ["coluna"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.definir_passagem",
  },
  {
    id: "quadro.terminei",
    titulo: "Terminar a etapa (a tarefa vai para a próxima coluna)",
    schema: objeto({ tarefa: P.tarefa, pela_fala: P.pela_fala, mensagem_id: P.mensagem_id }, []),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.terminei",
  },
  // NOD-443 (ADR-143): as pessoas do quadro e o modo de conversa (só a dona; um bot dela só a pedido dela, num turno
  // limpo, como as colunas), cada um com Desfazer. O comentário é o caminho de quem participa no "só a dona" (D7).
  {
    id: "quadro.adicionar_pessoa",
    titulo: "Pôr alguém do time no quadro",
    schema: objeto({ pessoa: P.pessoa, modo: P.modo }, ["pessoa"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.adicionar_pessoa",
  },
  {
    id: "quadro.tirar_pessoa",
    titulo: "Tirar alguém do quadro (as pendências dela voltam para a dona)",
    schema: objeto({ pessoa: P.pessoa }, ["pessoa"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.tirar_pessoa",
  },
  {
    id: "quadro.mudar_modo",
    titulo: "Escolher como as pessoas conversam com o quadro",
    schema: objeto({ modo: P.modo }, ["modo"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.mudar_modo",
  },
  // NOD-419: os freios da esteira. A trava da coluna (menu "…" da coluna) e o Desfazer de um movimento do histórico.
  // O nao_e_comigo é só do bot (a pessoa troca o responsável pelo quadro.mudar_tarefa): não é ação da tela.
  {
    id: "quadro.travar_coluna",
    titulo: "Travar a saída de uma coluna (só sai para…, só a pessoa tira daqui)",
    schema: objeto({ coluna: P.coluna, sai_para: P.sai_para, so_pessoa: P.so_pessoa }, ["coluna"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.travar_coluna",
  },
  {
    id: "quadro.desfazer_movimento",
    titulo: "Desfazer um movimento do histórico da tarefa",
    // Revisão 3 do PR #629: `movimento` é opcional, como no gerir_quadro (sem ele, o último desfazível; ADR-142).
    schema: objeto({ tarefa: P.tarefa, movimento: P.movimento }, ["tarefa"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.desfazer_movimento",
  },
  // NOD-418: o trabalho da tarefa. Repetir e recado abrem um turno de delegação do responsável (como começar a tarefa);
  // cancelar para o turno vivo. O gerir_quadro só os aceita num turno da pessoa (a conversa com ela).
  {
    id: "quadro.repetir_trabalho",
    titulo: "Repetir o trabalho de uma tarefa (abre um novo; a Bloqueada volta para onde estava)",
    schema: objeto({ tarefa: P.tarefa }, ["tarefa"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.repetir_trabalho",
  },
  {
    id: "quadro.cancelar_trabalho",
    titulo: "Cancelar o trabalho em andamento de uma tarefa (a tarefa fica onde está)",
    schema: objeto({ tarefa: P.tarefa }, ["tarefa"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.cancelar_trabalho",
  },
  {
    id: "quadro.recado_trabalho",
    titulo: "Mandar um recado ao trabalho em andamento de uma tarefa",
    schema: objeto({ tarefa: P.tarefa, texto: P.texto }, ["tarefa", "texto"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.recado_trabalho",
  },
  // ADA-14 (ADR-153): os N quadros do bot e os projetos. Uma op por chamada (sem lote nem Desfazer: o inverso é a op
  // contrária); a tela e o gerir_quadro passam pelo mesmo aplicarQuadrosDoBot (src/use-cases/quadros-do-bot.ts).
  { id: "quadro.listar", titulo: "Listar os quadros do bot (ou de todos os bots) e os projetos", schema: objeto({ todos: P.todos }, []), risco: "leitura", cartaoNoChat: false, chat: vivoN, casoDeUso: "quadro.listar", semRotaDePessoa: "só leitura: a tela lê em GET /agentes/:id/quadros (a catraca B só conta as rotas que mudam algo)" },
  { id: "quadro.abrir", titulo: "Escolher em qual quadro o app Quadro do bot abre", schema: objeto({ quadro: P.quadro }, ["quadro"]), risco: "muda", cartaoNoChat: false, chat: vivoN, casoDeUso: "quadro.abrir" },
  { id: "quadro.definir_padrao", titulo: "Definir o quadro padrão de um bot", schema: objeto({ quadro: P.quadro, bot: P.bot }, ["quadro"]), risco: "muda", cartaoNoChat: false, chat: vivoN, casoDeUso: "quadro.definir_padrao" },
  { id: "quadro.vincular_bot", titulo: "Pôr um quadro também em outro bot (quadro compartilhado)", schema: objeto({ quadro: P.quadro, bot: P.bot }, ["quadro", "bot"]), risco: "muda", cartaoNoChat: false, chat: vivoN, casoDeUso: "quadro.vincular_bot" },
  { id: "quadro.desvincular_bot", titulo: "Tirar um bot de um quadro compartilhado (o próximo vira dono)", schema: objeto({ quadro: P.quadro, bot: P.bot }, ["quadro", "bot"]), risco: "muda", cartaoNoChat: false, chat: vivoN, casoDeUso: "quadro.desvincular_bot" },
  { id: "quadro.criar_projeto", titulo: "Criar um projeto (agrupa quadros)", schema: objeto({ nome: P.nome, descricao: P.descricao, meta: P.meta, prazo: P.prazo }, ["nome"]), risco: "muda", cartaoNoChat: false, chat: vivoN, casoDeUso: "quadro.criar_projeto" },
  { id: "quadro.editar_projeto", titulo: "Mudar o nome, a descrição, a meta ou o prazo de um projeto", schema: objeto({ projeto: P.projeto, nome: P.nome, descricao: P.descricao, meta: P.meta, prazo: P.prazo }, ["projeto"]), risco: "muda", cartaoNoChat: false, chat: vivoN, casoDeUso: "quadro.editar_projeto" },
  { id: "quadro.arquivar_projeto", titulo: "Arquivar um projeto (os quadros ficam, soltos)", schema: objeto({ projeto: P.projeto }, ["projeto"]), risco: "muda", cartaoNoChat: false, chat: vivoN, casoDeUso: "quadro.arquivar_projeto" },
  { id: "quadro.restaurar_projeto", titulo: "Restaurar um projeto arquivado", schema: objeto({ projeto: P.projeto }, ["projeto"]), risco: "muda", cartaoNoChat: false, chat: vivoN, casoDeUso: "quadro.restaurar_projeto" },
  // ADA-232 (ADR-155): "Acordar agora" no detalhe da tarefa — a volta marcada (hora ou CI) dispara já, na mesma cadeia.
  {
    id: "quadro.acordar_trabalho",
    titulo: "Acordar agora o trabalho de uma tarefa que espera uma volta (hora marcada ou CI)",
    schema: objeto({ tarefa: P.tarefa }, ["tarefa"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.acordar_trabalho",
  },
  // 0159: o catálogo de labels do quadro (sem Desfazer de lote: o inverso é a op contrária). Pôr e tirar label na tarefa
  // é o mudar_tarefa (labels, por_labels, tirar_labels), com Desfazer.
  { id: "quadro.criar_label", titulo: "Criar uma label no quadro (nome e cor)", schema: objeto({ nome: P.nome, cor: P.cor }, ["nome"]), risco: "muda", cartaoNoChat: false, chat: vivo, casoDeUso: "quadro.criar_label" },
  { id: "quadro.editar_label", titulo: "Renomear ou recolorir uma label do quadro", schema: objeto({ label: P.label, nome: P.nome, cor: P.cor }, ["label"]), risco: "muda", cartaoNoChat: false, chat: vivo, casoDeUso: "quadro.editar_label" },
  { id: "quadro.remover_label", titulo: "Remover uma label do quadro (sai de todas as tarefas)", schema: objeto({ label: P.label }, ["label"]), risco: "muda", cartaoNoChat: false, chat: vivo, casoDeUso: "quadro.remover_label" },
  // 2026-11-10: editar e apagar o próprio comentário (no fim do registro: a ordem das outras não muda o sorteio do fuzz).
  {
    id: "quadro.editar_comentario",
    titulo: "Editar o próprio comentário numa tarefa (não reaciona ninguém)",
    schema: objeto({ tarefa: P.tarefa, comentario: P.comentario, texto: P.texto }, ["tarefa", "comentario", "texto"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.editar_comentario",
  },
  {
    id: "quadro.apagar_comentario",
    titulo: "Apagar o próprio comentário numa tarefa (as respostas da thread ficam)",
    schema: objeto({ tarefa: P.tarefa, comentario: P.comentario }, ["tarefa", "comentario"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.apagar_comentario",
  },
] as const satisfies readonly DefinicaoAcao[];
