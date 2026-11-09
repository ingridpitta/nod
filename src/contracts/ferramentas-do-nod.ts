import type { JsonSchema } from "./json-schema.ts";
import type { ModoAprovacao } from "./agente.ts";

/**
 * As ferramentas que só o Nod tem (definido em 2026-10-07, ADR-081/082): as mãos dele sobre os bots da pessoa
 * (gerir_bots, ver_apps_conectados) e a caixa de bugs, melhorias e dúvidas (registrar_relato). Moram fora de
 * ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26, como ferramentas-artefato.ts: são espalhadas em
 * FERRAMENTAS_NOD e a lista continua FECHADA. Entram no catálogo só quando o bot do turno é o Nod e quem fala é a pessoa
 * (plano-turno.ts, FERRAMENTAS_DO_NOD); o caso de uso confere de novo (cerca 2).
 *
 * As ações do lote têm um schema só, plano, com `tipo` e os campos de todas: o validador do proxy é um subconjunto de
 * JSON Schema e o modelo erra menos com um objeto só. O que cada tipo exige o domínio confere (src/domain/lote-bots.ts).
 */

/** definido em 2026-10-07: um pedido do Nod mexe em até 20 bots — acima disso, é melhor ele dividir e a pessoa ver. */
export const MAX_ACOES_LOTE = 20;

export const TIPOS_ACAO_LOTE = ["criar", "duplicar", "editar", "mover", "excluir", "criar_rotina", "dar_acesso", "mudar_modo", "restaurar_versao", "excluir_time", "acessos_em_lote", "padrao_acesso", "desfazer_acessos", "remover_computador"] as const;
/** O que só outra ferramenta põe no card: excluir_time (gerir_times, NOD-437) os de acesso em lote (gerir_acessos, ADA-241) e remover_computador (só a ferramenta remover_computador, ADA-245). */
const SO_DE_OUTRA_FERRAMENTA: ReadonlySet<string> = new Set(["excluir_time", "acessos_em_lote", "padrao_acesso", "desfazer_acessos", "remover_computador"]);
/** NOD-437: o que o gerir_bots aceita — o lote sem o que só outra ferramenta põe no card. */
export const TIPOS_ACAO_GERIR_BOTS = TIPOS_ACAO_LOTE.filter((t) => !SO_DE_OUTRA_FERRAMENTA.has(t));
export type TipoAcaoLote = (typeof TIPOS_ACAO_LOTE)[number];

/** Teto do título e do texto de um relato contado ao Nod (o texto é o mesmo teto do relato pelo botão, TETO_TEXTO_RELATO). */
export const TETO_TITULO_RELATO = 120;

export const FERRAMENTAS_DO_NOD = {
  gerir_bots: {
    type: "object",
    description:
      "Muda vários bots da pessoa de uma vez, na ordem: criar, duplicar, editar, mover de time, excluir, criar rotina, dar acesso a um app já conectado, mudar o modo de aprovação e restaurar uma versão antiga do perfil (ver_colegas com o agente lista as últimas versões e o número de cada uma; se falhar com versao_redigida, um segredo sumiria: só a pessoa decide isso, no Histórico do bot). Uma chamada só por pedido. O seu modo decide: o que precisa da pessoa vira UM card com as ações marcáveis; o resto é feito na hora. Para usar um bot criado ou duplicado no mesmo pedido, dê a ele um ref e aponte as ações seguintes para \"@ref\".",
    properties: {
      resumo: { type: "string", description: "O pedido em uma frase, como a pessoa vai ler no card.", minLength: 1, maxLength: 200 },
      acoes: {
        type: "array",
        minItems: 1,
        maxItems: MAX_ACOES_LOTE,
        description: "As mudanças, na ordem em que devem acontecer.",
        items: {
          type: "object",
          properties: {
            tipo: { type: "string", enum: TIPOS_ACAO_GERIR_BOTS },
            bot: { type: "string", description: "O bot alvo (todos menos criar): id, nome exato ou \"@ref\" de uma ação anterior.", minLength: 1 },
            ref: { type: "string", description: "Só em criar e duplicar: um apelido curto para o bot novo, usado depois como \"@ref\".", minLength: 1, maxLength: 30 },
            nome: { type: "string", description: "criar (obrigatório) e editar.", minLength: 1, maxLength: 60 },
            titulo: { type: "string", description: "criar e editar: o papel em poucas palavras (ex.: \"Revisor\").", maxLength: 120 },
            descricao: { type: "string", description: "criar (obrigatório) e editar: o que o bot faz, em segunda pessoa.", maxLength: 8000 },
            secao: { type: "string", description: "criar e mover: o time da barra lateral; \"\" põe em Sem time.", maxLength: 60 },
            modelo: { type: "string", description: "criar e editar: o modelo (ex.: \"auto\", \"sonnet\", \"opus\").", minLength: 1 },
            esforco: { type: "string", enum: ["low", "medium", "high", "xhigh", "max", ""], description: "editar: o esforço; \"\" volta ao padrão do modelo." },
            cron: { type: "string", description: "criar_rotina: cron de 5 campos, ex.: '0 8 * * 1-5'.", minLength: 1 },
            fuso_iana: { type: "string", description: "criar_rotina: fuso IANA nomeado, ex.: America/Sao_Paulo.", minLength: 1 },
            instrucao: { type: "string", description: "criar_rotina: o que fazer a cada execução.", minLength: 1 },
            entregavel: { type: "string", description: "criar_rotina (opcional): o que sai ao final; padrão, uma mensagem curta na conversa do bot.", minLength: 1 },
            app: { type: "string", description: "dar_acesso: o slug do app já conectado (veja ver_apps_conectados).", minLength: 1 },
            nivel: { type: "string", enum: ["leitura", "escrita"], description: "dar_acesso." },
            modo: { type: "string", enum: ["manual", "automatico", "total"], description: "mudar_modo. \"total\" (Ignorar todas as aprovações) sempre espera a pessoa num card." },
            versao: { type: "integer", description: "restaurar_versao: o número (a partir de 1) da versão do perfil a restaurar (o Histórico do perfil do bot). Vira uma versão nova." },
          },
          required: ["tipo"],
          additionalProperties: false,
        },
      },
    },
    required: ["resumo", "acoes"],
    additionalProperties: false,
  },
  ver_apps_conectados: {
    type: "object",
    description: "Lista os apps que a pessoa já conectou (slug, nome e os níveis de acesso possíveis). Só lê. Use antes de dar_acesso.",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  registrar_relato: {
    type: "object",
    description:
      "Anota para o time do nod um bug, um pedido de melhoria ou uma dúvida que você não soube responder, contado pela pessoa nesta conversa. O trecho recente da conversa vai junto. Aparece para ela em Relatos.",
    properties: {
      tipo: { type: "string", enum: ["bug", "melhoria", "duvida"] },
      titulo: { type: "string", description: "Uma frase curta do problema ou da ideia.", minLength: 1, maxLength: TETO_TITULO_RELATO },
      texto: { type: "string", description: "O que a pessoa contou e as respostas dela (onde, o que apareceu).", minLength: 1, maxLength: 2000 },
      categoria: { type: "string", enum: ["resposta_errada", "nao_fez_o_pedido", "travou_ou_parou", "lento", "interface", "outro"], description: "Só para bug: a categoria mais próxima." },
    },
    required: ["tipo", "titulo", "texto"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type AcaoLote = {
  tipo: TipoAcaoLote;
  bot?: string;
  ref?: string;
  nome?: string;
  titulo?: string;
  descricao?: string;
  secao?: string;
  modelo?: string;
  esforco?: "low" | "medium" | "high" | "xhigh" | "max" | "";
  cron?: string;
  fuso_iana?: string;
  instrucao?: string;
  entregavel?: string;
  app?: string;
  nivel?: "leitura" | "escrita";
  modo?: ModoAprovacao;
  versao?: number;
  /** NOD-437, só em excluir_time (o gerir_times monta): o time e os nomes dos bots dele, para o card ler sem consultar. */
  time_id?: string;
  membros?: string[];
  /** ADA-245, só em remover_computador (a ferramenta remover_computador monta): o computador e as duas opções do diálogo. */
  maquina_id?: string;
  manter_ias?: boolean;
  manter_conexao?: boolean;
  /** Quem assume os bots de lá (o nome, como na prévia); null = ninguém, eles esperam um computador. O card e o recibo nomeiam. */
  assume_nome?: string | null;
  /**
   * ADA-241, só nos de acesso em lote (o gerir_acessos monta): o app, o nível (com Nenhum), os bots (ids e nomes, para o
   * card ler sem consultar) ou `todos`, a chave do clique, o `aplicar` do padrão e o lote do Desfazer.
   */
  conector_id?: string;
  nivel_lote?: "nenhum" | "leitura" | "escrita";
  bots_ids?: string[];
  bots_nomes?: string[];
  todos?: boolean;
  chave?: string;
  aplicar?: boolean;
  lote_id?: string;
};
export type ArgsGerirBots = { resumo: string; acoes: AcaoLote[] };

export type ResultadoGerirBots =
  | {
      ok: true;
      /** `aviso`: o que a pessoa precisa saber da ação feita (NOD-289: "rotinas da cópia vieram pausadas"). */
      feitas: { i: number; tipo: TipoAcaoLote; bot_id: string | null; nome: string; aviso?: string }[];
      esperando: number[];
      falhas: { i: number; erro: string }[];
      decisao_id: string | null;
      instrucao: string;
    }
  | { ok: false; erro: "fora_da_conversa" | "entrada_invalida"; problemas: { i: number; motivo: string }[]; instrucao: string };

export type ArgsVerAppsConectados = { _?: never };
export type AppConectado = { slug: string; nome: string; niveis: ("leitura" | "escrita")[] };
export type ResultadoVerAppsConectados = { ok: true; apps: AppConectado[] } | { ok: false; erro: "fora_da_conversa" };

export type ArgsRegistrarRelato = {
  tipo: "bug" | "melhoria" | "duvida";
  titulo: string;
  texto: string;
  categoria?: "resposta_errada" | "nao_fez_o_pedido" | "travou_ou_parou" | "lento" | "interface" | "outro";
};
export type ResultadoRegistrarRelato = { ok: true; relato_id: string; instrucao: string } | { ok: false; erro: "fora_da_conversa" | "limite_do_dia"; instrucao: string };

/** Args ↔ resultado das três, intersectado em ContratoFerramentaNod. */
export type ContratoFerramentasDoNod = {
  gerir_bots: { args: ArgsGerirBots; resultado: ResultadoGerirBots };
  ver_apps_conectados: { args: ArgsVerAppsConectados; resultado: ResultadoVerAppsConectados };
  registrar_relato: { args: ArgsRegistrarRelato; resultado: ResultadoRegistrarRelato };
};
