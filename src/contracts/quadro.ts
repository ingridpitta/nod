import type { ImportacaoDto, OpImportarTimeLinear } from "./quadro-importacao.ts";
import type { OpAssumirQuadro } from "./quadro-assumir.ts";
import type { MovimentoDto, OpFreio, TravaColuna } from "./freios-quadro.ts";
import type { CamposDeLabel, LabelDto, OpLabel } from "./quadro-labels.ts";
/**
 * O quadro-agente (definido em 2026-10-31, NOD-442; base visual NOD-429): uma meta com prazo, tarefas em colunas de
 * status, e cada tarefa com um bot responsável que começa sozinho. Só tipos (EMENDA 26): o domínio puro mora em
 * src/domain/quadro.ts, o banco na 0133.
 *
 * Um quadro por bot anfitrião (quem o criou): ele mora na aba Quadro da conversa desse bot (NOD-429). Qualquer bot da
 * pessoa mexe nele pelas mesmas ações (ADR-135, domínio `quadro`).
 */
import type { LinhaDeSistema, PrNaTela } from "./prs-da-tarefa.ts"; import type { OpcoesDoQuadro, Prioridade } from "./quadro-opcoes.ts";
export type { CiPr, EstadoPr, LinhaDeSistema, PrDaTarefa, PrLido, PrNaTela, TipoLinhaTarefa } from "./prs-da-tarefa.ts";

/**
 * As colunas padrão, na ordem (os mesmos de web/lib/quadro.ts, que a NOD-429 já desenha). Definido em 2026-11-01
 * (NOD-448): são ids reservados com o comportamento de sempre. ADR-162: `voce` não é coluna, é a marca "esperando a pessoa".
 */
export const STATUS_TAREFA = ["backlog", "afazer", "fazendo", "revisao", "bloqueado", "voce", "feito", "cancelado"] as const;
export type StatusTarefa = (typeof STATUS_TAREFA)[number];

/**
 * NOD-448 (definido em 2026-11-01): toda coluna é de um grupo, e o grupo dá o comportamento. Não iniciado não aciona
 * ninguém; Iniciado (o "andamento") aciona o responsável ao entrar; Feito conta no progresso; Fechado sai da conta.
 */
export const GRUPOS_COLUNA = ["nao_iniciado", "iniciado", "feito", "fechado"] as const;
export type GrupoColuna = (typeof GRUPOS_COLUNA)[number];

/** Uma coluna do quadro. `id` é uma das chaves de STATUS_TAREFA ou `c-<slug>` (criada pela pessoa; não muda ao renomear).
 * Passagem (ADR-142): `responsavel` = o bot que pega a tarefa ao entrar (null/ausente = o responsável continua); `instrucoes` = "o que essa etapa faz", no contexto do turno; `proxima`/`volta` (2026-11-10, Multica) = as saídas "etapa concluída" e "precisa de ajustes" (ausentes = o padrão).
 * `trava` (NOD-419): "só sai para…", "só a pessoa tira daqui"; ausente = flexível. `prazoMin` (NOD-420, só onde o trabalho anda): a tarefa parada além disso nesta coluna faz o quadro cobrar o responsável. */
export type ColunaQuadro = { id: string; nome: string; grupo: GrupoColuna; responsavel?: string | null; instrucoes?: string | null; proxima?: string | null; volta?: string | null; trava?: TravaColuna; prazoMin?: number };

/** A coluna como a web e o bot a recebem: `fixa` = não move nem sai (Cancelado); `recebe` (2026-11-10): o texto da etapa que vai ao turno (textoDaEtapa), na coluna com responsável ou "o que essa etapa faz". */
export type ColunaDto = ColunaQuadro & { fixa: boolean; daPessoa: boolean; recolhida: boolean; responsavelNome?: string | null; recebe?: string };

/** O id de uma coluna (o `status` da tarefa): uma chave padrão ou `c-<slug>`. */
export type IdColuna = string;

/** O trabalho do bot na tarefa (null = nada vivo nem falho); "esperando" = aberto sem turno vivo (ADR-163). */
export type ExecucaoTarefa = "fila" | "rodando" | "esperando" | "falhou" | null;

export type TarefaQuadro = {
  id: string;
  quadroId: string;
  titulo: string;
  descricao: string;
  /** O id da coluna (NOD-448). */
  status: IdColuna;
  /** A coluna de antes da espera (Bloqueado, ou a pergunta à pessoa — ADR-162: onde o card aparece enquanto ela não responde). */
  voltarPara: IdColuna | null;
  agenteId: string | null;
  ordem: number;
  /** O item do Linear de onde veio (NOD-416): identificador "NOD-12" e a url; nulos quando nasceu no quadro. */
  linearId: string | null;
  linearUrl: string | null;
  prUrl: string | null;
  /** O bloqueio (NOD-420): a pergunta à pessoa e, depois, a resposta dela. */
  pergunta: string | null;
  resposta: string | null;
  /** O conteúdo veio do Linear ou de um turno não confiável (ADR-062): o turno que a tarefa abrir nasce contaminado. */
  deFora: boolean;
  turnoId: string | null;
  criadoEm: number;
  mudadoEm: number;
  /** Quando entrou em feito/cancelado (null enquanto aberta). Só muda com o status, não com título ou ordem (revisão 3). */
  terminadaEm: number | null;
  /** NOD-416 (ADR-144): o número da tarefa no quadro (o código é o prefixo do quadro + ele). Null só na tarefa que o servidor de antes criou durante o deploy. */
  numero: number | null;
  /** NOD-443 (ADR-143): quem pediu (a dona ou quem participa). Null antes da 0146 ou num turno do próprio quadro; ausente na foto de um lote de antes. */
  pedidoPor?: string | null; prioridade: Prioridade; // NOD-463 (0160): sem, urgente, alta, média, baixa
  labelIds?: string[]; prazoEm?: string | null; // 0161: as labels (ids do catálogo) e o prazo AAAA-MM-DD; ausentes na foto de antes = mantém
} & ProvenienciaResposta; // ADA-15 (ADR-154): de qual fala da pessoa veio a resposta

export { MODOS_CONVERSA, MODOS_ESCOLHIVEIS, type ModoConversa } from "./quadro-pessoas.ts";

export type Quadro = {
  id: string;
  agenteId: string;
  /** NOD-415 (ADR-141): opcional. Sem meta é o fluxo contínuo: sem fração, sem progresso, sem risco de prazo. */
  meta: string | null;
  /** AAAA-MM-DD, ou null. */
  prazo: string | null;
  cumpridoEm: number | null;
  resumo: string | null;
  /** NOD-448: as colunas, na ordem; null = as padrão (todo quadro de antes fica assim, sem mudança). */
  colunas: ColunaQuadro[] | null;
  criadoEm: number;
  atualizadoEm: number;
  /** NOD-415 (revisão 2): quando a meta foi posta (de sem meta para com meta); o risco e o "N de M" partem dali. */
  metaDesde: number;
  /** NOD-416 (ADR-144): o prefixo do código das tarefas (ex.: ZE), fixo depois de criado. Null só no quadro que o servidor de antes criou. */
  prefixo: string | null;
  modoConversa: ModoConversa; // NOD-443: como as pessoas conversam com o quadro (padrão: cada um na sua conversa).
  quemFecha?: QuemFecha; // ADA-28 (ADR-159, E): quem dá o Done — o bot (o padrão; ausente = bot) ou a pessoa (o bot para antes e pede).
  /** ADA-14 (ADR-153): o nome (null = "Tarefas") e o projeto (null = solto). */ nome: string | null; projetoId: string | null;
}; export type QuemFecha = "bot" | "pessoa";

/** Quem fez o lote: a pessoa (na tela) ou um bot (pela ferramenta). */
export type AutorLote = { tipo: "pessoa" } | { tipo: "agente"; agenteId: string };

/** NOD-416 (ADR-144): o histórico, o link pelo código e os quadros da pessoa moram em quadro-historico.ts. */ export type { AutorHistorico, CampoHistorico, MudancaTarefa, EntradaHistoricoDto, TarefaPorCodigoDto, TarefaAchadaDto, OpcaoDeTarefaDto, QuadroDaPessoaDto } from "./quadro-historico.ts";

export type LoteQuadro = {
  id: string;
  quadroId: string;
  autor: AutorLote;
  resumo: string;
  tarefaIds: string[];
  desfeitoEm: number | null;
  criadoEm: number;
  /** NOD-443/NOD-430 (0143): quem pediu (a dona ou quem participa). Null = o bot sozinho ou procuração: lido como da dona. */
  pedidoPor?: string | null;
  /** NOD-443: o nome do bot pelo qual a pessoa pediu ("Ana, pela Ada"), do momento. Null = pela tela. */
  viaNome?: string | null;
};

/** NOD-443 (ADR-143): as pessoas, quem decide, o mural e os comentários moram em quadro-pessoas.ts. */ export type { MembroQuadroDto, QuemDecideDto, LinhaMuralDto, ComentarioQuadroDto, AutorComentario, ComentarioTarefa, ComentarioDto, QuadroCompartilhadoDto } from "./quadro-pessoas.ts";
import type { ComentarioQuadroDto, MembroQuadroDto, ModoConversa, QuemDecideDto } from "./quadro-pessoas.ts";
import type { ItemLinear, PelaFala, ProvenienciaResposta } from "./quadro-bot.ts";

/** O que a web e o bot recebem: o quadro com as tarefas, a execução de cada uma e o último lote que dá para desfazer. */
export type TarefaDto = TarefaQuadro & {
  execucao: ExecucaoTarefa;
  agenteNome: string | null;
  codigo: string; // NOD-416: o código da tarefa (prefixo do quadro + número, ex.: ZE-12)
  /** NOD-416: o branch sugerido (o código e o título em slug, ex.: ze-12-secao-de-planos). */
  branch: string;
  /** NOD-443: "Movido por Ana" (o nome de quem pediu a última mudança; "você" para quem lê). Null = a dona, sem mais ninguém. */
  pedidoPorNome?: string | null;
  /** NOD-443 (D5): quem responde a pergunta, só com a tarefa esperando alguém ("Precisa de alguém"). */
  decide?: QuemDecideDto | null;
  naColunaDesde?: number | null; // NOD-420: epoch ms da entrada na coluna atual; null fora do Postgres
  /** NOD-460: epoch ms do despacho do turno vivo (null = não roda). ADR-163: na fila desde e o motivo real (série ou portão). */
  trabalhandoDesde?: number | null; naFilaDesde?: number | null; motivoFila?: "mesma_tarefa" | "memoria" | "processador" | "disco" | null;
  prs?: PrNaTela[]; // NOD-421: os PRs ligados e as linhas de sistema (CI, conflito, merge)
  linhas?: LinhaDeSistema[]; estadoLinha?: import("./quadro-execucoes.ts").EstadoLinhaTarefa | null; // ADA-232: o card numa linha
  movimentos?: MovimentoDto[]; // NOD-419: os últimos movimentos (o mais novo primeiro)
  respostaAgenteNome?: string | null; esperaPessoa?: boolean; // ADA-15: o bot com quem a pessoa falava; ADR-162: perguntou à pessoa (o status já é a coluna em que aparece)
  labels?: LabelDto[]; // 0161: as labels da tarefa, resolvidas do catálogo (na ordem do catálogo)
};
export type QuadroDto = Omit<Quadro, "colunas"> & {
  agenteNome: string;
  /** As colunas de verdade (as padrão quando o quadro não tem as dele). */
  colunas: ColunaDto[];
  tarefas: TarefaDto[];
  /** O último lote ainda não desfeito (o Desfazer da faixa e do aviso). */
  ultimoLote: LoteQuadro | null;
  feitas: number;
  total: number; /** NOD-422: a última importação do Linear (a linha de progresso e o resultado); null = nunca houve. */ importacao?: ImportacaoDto | null;
  /** NOD-422 (PR 2): quando o quadro assumiu a esteira (as rotinas dos bots pausadas); null = não assumiu. */ assumidoEm?: number | null;
  /** NOD-443: quem lê (a dona ou quem participa), a dona e as pessoas do quadro. Ausente no quadro de uma pessoa só. */
  voce?: { pessoaId: string; papel: "dona" | "membro"; podeDesfazer: boolean };
  dona?: { pessoaId: string; nome: string };
  membros?: MembroQuadroDto[];
  comentarios?: ComentarioQuadroDto[];
  avisoGithub?: string | null; // NOD-421: a linha do GitHub no topo ("não conectado", "sem acesso a dono/repo")
  labels?: LabelDto[]; // 0161: o catálogo de labels do quadro
};

/** Uma operação no quadro (a ferramenta manda uma lista; a rota, uma). Cada tipo é um id do registro `quadro.*`. */
export type OpQuadro =
  | { tipo: "criar_quadro"; meta?: string | null; prazo?: string | null; /** ADA-14: o nome (null = "Tarefas") e o projeto (id ou nome). */ nome?: string | null; projeto?: string | null }
  | ({ tipo: "criar_tarefa"; titulo: string; descricao?: string; status?: string; agente?: string | null; prioridade?: Prioridade } & CamposDeLabel) | OpLabel
  | { tipo: "importar_linear"; itens: ItemLinear[] }
  | OpImportarTimeLinear
  | OpAssumirQuadro
  | ({ tipo: "mudar_tarefa"; tarefa: string; titulo?: string; descricao?: string; status?: string; agente?: string | null; pr_url?: string | null; prioridade?: Prioridade; pergunta?: string | null; excluir?: boolean; sem_iniciar?: boolean; /** 2026-11-10 (ADR-142): ao mover para outra etapa, para o turno vivo de quem trabalhava nela (padrão: ele termina, preso à etapa dele). */ parar_anterior?: boolean; /** NOD-419: o porquê de bloquear ou cancelar (o agente precisa dizer). */ motivo?: string } & PelaFala & CamposDeLabel)
  | ({ tipo: "responder"; tarefa: string; resposta: string; /** ADA-15: responder e seguir (o "aprovado"). */ avancar?: true } & PelaFala)
  /** NOD-418: o trabalho da tarefa (sozinhos, sem Desfazer). Repetir abre um novo; cancelar para o vivo; o recado entra nele. */
  | { tipo: "repetir_trabalho"; tarefa: string } | { tipo: "cancelar_trabalho"; tarefa: string } | { tipo: "recado"; tarefa: string; texto: string }
  | { tipo: "acordar_trabalho"; tarefa: string } /* ADA-232: "Acordar agora", a volta marcada dispara já */
  | { tipo: "editar_quadro"; meta?: string | null; prazo?: string | null; nome?: string | null; /** null = tira do projeto. */ projeto?: string | null; /** ADA-28 (E). */ quem_fecha?: QuemFecha } | { tipo: "desfazer"; lote?: string }
  /** NOD-415 (ADR-141): o bot volta a ser um agente comum. Apaga o quadro, as tarefas e o histórico; conversa e memória ficam. */
  | { tipo: "remover_quadro"; bot?: string }
  /** NOD-416 (ADR-144): para o quadro de outro bot, com o código do destino (o antigo abre), no mesmo grupo, sem acionar. `quadro` = id, nome do anfitrião ou prefixo. */
  | { tipo: "mover_quadro"; tarefa: string; quadro: string }
  /* NOD-448: as colunas. `coluna`, `depois_de`, `antes_de`, `destino` = o id ou o nome da coluna. */
  | { tipo: "criar_coluna"; nome: string; grupo: GrupoColuna; depois_de?: string; prazo_min?: number | null }
  | { tipo: "renomear_coluna"; coluna: string; nome?: string; prazo_min?: number | null } // NOD-420: prazo_min põe/tira (null) o prazo; com ele, nome pode faltar
  | { tipo: "mover_coluna"; coluna: string; antes_de?: string; depois_de?: string }
  | { tipo: "remover_coluna"; coluna: string; destino?: string }
  | { tipo: "definir_passagem"; coluna: string; agente?: string | null; instrucoes?: string | null; proxima?: string | null; volta_para?: string | null } // proxima/volta_para: as saídas da etapa (null = padrão)
  | ({ tipo: "terminei"; tarefa?: string } & PelaFala) | { tipo: "devolver"; tarefa?: string; motivo: string } | OpFreio // devolver (2026-11-10): a saída "precisa de ajustes"; OpFreio (NOD-419)
  | { tipo: "substituir_colunas"; colunas: { id?: string; nome: string; grupo: GrupoColuna }[]; destinos?: { de: string; para: string }[] }
  /* NOD-443 (ADR-143): pessoas e modo (só a dona) e o comentário, sozinhos. Um só comentar: no próprio quadro, numa tarefa, aciona (NOD-417); de quem participa ou sem tarefa, fica para a dona (D7). */
  /** `modo`: o da conversa, escolhido junto com a primeira pessoa (D3), no mesmo lote (revisão 1, achado 11). */
  | { tipo: "adicionar_pessoa"; pessoa: string; modo?: ModoConversa }
  | { tipo: "tirar_pessoa"; pessoa: string }
  | { tipo: "mudar_modo"; modo: ModoConversa }
  | import("./quadro-comentarios.ts").OpComentar | import("./quadro-comentarios.ts").OpComentario // 2026-11-10: thread, chips, editar/apagar (quadro-comentarios.ts)
  | ({ tipo: "exibir"; visao?: "lista" | "colunas" | "minhas"; recolhidas?: boolean; compacto?: boolean } & OpcoesDoQuadro); // ADA-18: o Exibir da pessoa (sozinho, sem Desfazer); + as Opções do quadro
export type TipoOpQuadro = OpQuadro["tipo"];
/** A ferramenta gerir_quadro (quadro-bot.ts) e o quadro como o bot o lê (quadro-resumo-bot.ts) moram fora (o teto de linhas). */
export type { ItemLinear, ArgsGerirQuadro, ResultadoGerirQuadro, PelaFala, ProvenienciaResposta } from "./quadro-bot.ts";
export type { ResumoQuadroParaBot } from "./quadro-resumo-bot.ts"; export type { CamposDeLabel, CorLabel, LabelDto, LabelQuadro, OpLabel, OpcaoPrazo } from "./quadro-labels.ts"; // 0161
/** Os tetos do quadro (a ferramenta, o domínio e a tela usam os mesmos). */ export const LIMITES_QUADRO = { comentario: 4000, comentariosPorPessoa: 50, membros: 50, meta: 200, titulo: 200, descricao: 4000, pergunta: 1000, resposta: 4000, ops: 50, itens: 50, identificador: 40, url: 500, coluna: 40, colunas: 30, instrucoes: 2000, motivo: 600, prazoMin: 30 * 24 * 60 } as const;
/** NOD-448 (ADR-140): o card de substituir as colunas mora em quadro-proposta-colunas.ts (teto de linhas dos contratos). */ export type { ColunaNaProposta, PayloadPropostaColunasQuadro } from "./quadro-proposta-colunas.ts";
