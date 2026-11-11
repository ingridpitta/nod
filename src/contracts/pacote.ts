/**
 * definido em 2026-11-11 (ADA-283, ADR-164): o pacote compartilhável do nod (`nod-pacote.json`), o formato estável para
 * publicar um app, um bot ou um time. É JSON declarativo: nunca traz código que rode no servidor. O validador
 * (`src/domain/pacote.ts`) rejeita campo desconhecido em qualquer nível, para que o formato abra devagar.
 */

/** A versão do formato. Muda só quando um campo existente muda de sentido; campo novo opcional não muda. */
export const FORMATO_PACOTE = 1 as const;
export const TIPOS_PACOTE = ["app", "bot", "time"] as const;
export type TipoPacote = (typeof TIPOS_PACOTE)[number];

export const MODELOS_PRECO = ["gratis", "unico", "assinatura"] as const;
export type ModeloPreco = (typeof MODELOS_PRECO)[number];
export const MOEDAS_PRECO = ["BRL", "USD", "EUR"] as const;
export type MoedaPreco = (typeof MOEDAS_PRECO)[number];
export const PERIODOS_ASSINATURA = ["mes", "ano"] as const;
export type PeriodoAssinatura = (typeof PERIODOS_ASSINATURA)[number];

/** O preço é só um dado no núcleo: cobrar fica em `fechado/` (ADR-160). */
export type PrecoPacote =
  | { modelo: "gratis" }
  | { modelo: "unico"; centavos: number; moeda: MoedaPreco }
  | { modelo: "assinatura"; centavos: number; moeda: MoedaPreco; periodo: PeriodoAssinatura };

/**
 * As permissões da plataforma que um pacote pode pedir (vocabulário fechado). Além delas, um app pode pedir as dele
 * mesmo, no próprio namespace (`<nome do slug>.<acao>`, ex.: `canvas.ver_comentar`), e os apps conectados viram
 * `conector:<slug>:ler|escrever`. Nada é concedido ao instalar: a pessoa dá cada uma por bot, na tela.
 */
export const PERMISSOES_PLATAFORMA = ["conversa.ler", "conversa.escrever", "quadro.ler", "quadro.escrever", "arquivos.ler"] as const;
export type PermissaoPlataforma = (typeof PERMISSOES_PLATAFORMA)[number];
/** Quem pede a de cima já tem a de baixo (ampliar = pedir uma que não estava coberta). */
export const IMPLICA: Readonly<Record<string, readonly string[]>> = {
  "conversa.escrever": ["conversa.ler"],
  "quadro.escrever": ["quadro.ler"],
};

export type PermissaoPedida = { id: string; motivo: string; implica?: string[] };
export type AppConectadoPedido = { slug: string; nivel: "ler" | "escrever"; motivo: string; opcional?: boolean };
export type TelaPacote = { id: string; titulo: string; html: string };

export type PerfilBotPacote = { nome: string; titulo: string; descricao: string; instrucoes: string; rotinas: RotinaPacote[] };
export type RotinaPacote = { nome: string; quando: string; pedido: string };
export type SecaoTimePacote = { nome: string; bots: string[] };

export type PacoteNod = {
  formato: typeof FORMATO_PACOTE;
  tipo: TipoPacote;
  /** `autor/nome`, minúsculas, dígitos e hífen. O autor `nod` é reservado aos pacotes do próprio nod. */
  slug: string;
  nome: string;
  descricao: string;
  autor: { nome: string; url?: string };
  /** semver: 1.2.3 ou 1.2.3-rc.1. */
  versao: string;
  /** A menor versão do nod que entende o pacote (semver). */
  nodMinimo: string;
  preco: PrecoPacote;
  permissoes: PermissaoPedida[];
  apps_conectados: AppConectadoPedido[];
  /** Os nomes das ferramentas do chat que o app entrega ao bot com acesso (só no pacote nativo, que o nod já tem). */
  ferramentas: string[];
  /** app nativo: o código já mora no nod e o pacote só o descreve. Só o autor `nod` usa. */
  nativo?: boolean;
  /** app de terceiro: as telas, que rodam em iframe sandbox sem rede (ADR-051). */
  telas?: TelaPacote[];
  /** tipo bot. */
  bot?: PerfilBotPacote;
  /** tipo time. */
  time?: { bots: PerfilBotPacote[]; secoes: SecaoTimePacote[] };
};

export type ProblemaPacote = { caminho: string; motivo: string };

/** Tetos: uma tela até 2 MB (o mesmo dos blobs do Canvas), o pacote inteiro até 8 MB, em bytes UTF-8. */
export const TETO_TELA_BYTES = 2 * 1024 * 1024;
export const TETO_PACOTE_BYTES = 8 * 1024 * 1024;
export const MAX_TELAS = 50;
export const MAX_PERMISSOES = 30;
export const MAX_BOTS_TIME = 20;
export const MAX_ROTINAS_BOT = 10;
export const TETO_TEXTO_CURTO = 120;
export const TETO_DESCRICAO = 2000;
export const TETO_INSTRUCOES = 20_000;
/** Profundidade máxima do JSON (o formato 1 vai até 5); passar disso é rejeitado antes de qualquer recursão. */
export const MAX_PROFUNDIDADE = 16;
/** Quantos problemas `lerPacote` devolve no máximo: um pacote de 8 MB não vira milhões de mensagens na memória. */
export const MAX_PROBLEMAS = 100;

/**
 * Os apps nativos que este nod conhece e as ferramentas do chat que cada um entrega. `nativo: true` com outro slug, ou
 * com ferramenta fora desta lista, é rejeitado: o arquivo não tem assinatura, então é o código do nod (não o pacote) que
 * diz quais ferramentas de servidor existem. `pacote-canvas.test.ts` amarra a do Canvas a `FERRAMENTAS_CANVAS`.
 */
export const FERRAMENTAS_NATIVAS: Readonly<Record<string, readonly string[]>> = {
  "nod/canvas": ["gerir_canvas"],
};
/**
 * O que cada nativo pode pedir (as permissões efetivas, com `conector:<slug>:<nivel>` dos apps conectados). Pelo mesmo
 * motivo das ferramentas: sem assinatura, um `nod/canvas` forjado não pede `quadro.escrever` nem um app conectado.
 * `pacote-canvas.test.ts` amarra a do Canvas aos `NIVEIS_CANVAS`.
 */
export const PERMISSOES_NATIVAS: Readonly<Record<string, readonly string[]>> = {
  "nod/canvas": ["canvas.criar_publicar", "canvas.ver_comentar"],
};

/**
 * Nomes de app (a parte depois da `/` no slug) que só o autor `nod` usa: os namespaces das permissões da plataforma e
 * os nomes dos apps nativos. Sem isso, `maria/quadro` pediria `quadro.apagar` e `maria/canvas` pediria
 * `canvas.criar_publicar`, ids que se confundem com os da plataforma e os do Canvas.
 */
export const NOMES_RESERVADOS: readonly string[] = ["conversa", "quadro", "arquivos", "conector", "nod", "canvas"];

/** O que já está instalado (a decisão de atualizar compara com o novo). */
export type InstalacaoPacote = { slug: string; tipo: TipoPacote; versao: string; hash: string; permissoes: string[]; preco: PrecoPacote };
export type DecisaoAtualizacao =
  | { decisao: "igual" }
  | { decisao: "automatica"; de: string; para: string }
  | { decisao: "pede_consentimento"; de: string; para: string; motivos: string[]; novas: string[] }
  | { decisao: "bloqueada"; motivo: string };
