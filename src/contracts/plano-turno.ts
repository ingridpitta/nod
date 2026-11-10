import type { ContaDoPlano } from "./contas-ia.ts";
import type { AnexoMeta } from "./anexo.ts";
import type { EsforcoAgente, ModoAprovacao } from "./agente.ts";
import type { IdHarness } from "./harness.ts";
import type { Autoria, Executor } from "./evento.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { Confianca } from "./mensagem.ts";
import type { Profundidade } from "./turno.ts";
import type { JsonSchema } from "./ferramentas-nod.ts";
import type { TransporteConector } from "./conector.ts";

/** Modo do turno decide quais ferramentas nod entram no catálogo (src/domain/plano-turno.ts). */
export type ModoTurno = "criacao" | "conversa" | "sala" | "rotina" | "peer" | "delegacao" | "ligacao";

/**
 * definido em 2026-10-04 (ADR-072): o turno é o cérebro de uma ligação por voz. O executor abre o canal do cérebro
 * (`/api/interno/voz/v1/cerebro`) com o token do turno e conversa por ele até a ligação acabar.
 */
export type LigacaoVozPlano = {
  ligacaoId: string;
  modelo: string;
  nomeBot: string;
  generoVoz: "feminina" | "masculina";
  /** NOD-164: só Claude; vira `--effort` (se o `--help` listar). Ausente = o padrão do modelo. App antigo ignora. */
  esforco?: EsforcoAgente;
  /** NOD-164: só Claude; `false` => `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` no filho. App antigo ignora. */
  pensamentoAdaptativo?: boolean;
};

export type FerramentaPlano = {
  /** 'lembrar' | 'exemplo__enviar_email' (conector = `${slug}__${tool}`). */
  nome: string;
  /** Nome que o CLI enxerga: mcp__nod__<nome> (--allowedTools exato, mapa-cli). */
  nomeMcp: `mcp__nod__${string}`;
  /** "proxy" (2026-09-28): atendida pelo próprio proxy do turno, sem ida ao servidor — hoje só `ler_mais`. */
  origem: "nod" | "conector" | "computador" | "workspace" | "proxy";
  conectorId: string | null;
  /** Capturado na DESCOBERTA (sonda), nunca em tempo de chamada (ADR-013). */
  readOnlyHint: boolean;
  tocaDadoPessoal: boolean;
  schema: JsonSchema;
  /**
   * definido em 2026-09-24 (ADR-048): "maquina" = a ferramenta roda NA MÁQUINA do turno (o gh logado
   * no Mac da dona do conector). O servidor decide tudo (parada, concessão, schema, trilha) e devolve
   * `executarLocal`; o proxy executa. Ausente = o servidor executa, como sempre.
   */
  execucao?: "maquina";
};

export type ServidorPlano = {
  conectorId: string;
  nome: string;
  trust: "full" | "untrusted";
  transporte: TransporteConector;
};

/**
 * Plano de turno (ADR-024): emitido pelo servidor no PUXAR, único insumo do proxy MCP.
 * Sem cwd (EMENDA 11): o driver cria mkdtemp por turno. superficie tem UM valor (ADR-028).
 */
export type PlanoTurno = {
  tenantId: TenantId;
  turnoId: string;
  conversaId: string;
  agenteId: string;
  localidade: "local";
  machineId: string;
  executor: Executor;
  /**
   * NOD-402 (ADR-130): o turno roda nos bastidores da conversa (rotina, colega, sob procuração, ou a retomada deles). Os
   * frames ao vivo levam a marca e a web não os põe no chat. Ausente = da faixa da pessoa.
   */
  bastidores?: true;
  harness?: IdHarness;
  /**
   * ADR-102 (2026-10-13): a conta da lista da pessoa que este turno usa. A máquina acha a pasta dela pela impressão
   * (CLAUDE_CONFIG_DIR/CODEX_HOME). Ausente = a pasta padrão da máquina (máquina que não anunciou contas).
   */
  conta?: ContaDoPlano;
  workspaceId?: string | null;
  /**
   * definido em 2026-09-18: onde o harness abre (pasta preparada do projeto ativo) e o que ele
   * alcança (todos os projetos aprovados nesta conversa). Ausente = nenhum projeto autorizado,
   * e o driver mantém o diretório temporário vazio com as ferramentas nativas desligadas.
   */
  workspacePastas?: { ativa: string; aprovadas: string[] } | null;
  /**
   * definido em 2026-09-28: ferramentas nativas do harness liberadas neste turno (`nativasDoTurno`). O prompt
   * e o driver leem daqui — antes o prompt sempre dizia "Não há Read…" mesmo com elas ligadas. Ausente
   * (plano de servidor antigo) = o driver cai na regra anterior (nativas de arquivo quando há pasta).
   */
  nativas?: readonly string[];
  /**
   * definido em 2026-09-28 (ADR-052): o nome da pasta do bot no Mac da pessoa, `~/nod/<pastaDoBot>`. Presente
   * só quando o turno tem o kit do terminal; o driver a cria e a usa como diretório do turno.
   */
  pastaDoBot?: string;
  superficie: "maquina_da_pessoa";
  decididoPor: `regra:${string}`;
  autoria: Autoria;
  confiancaEntrada: Confianca;
  profundidade: Profundidade;
  catalogo: { ferramentas: FerramentaPlano[]; servidores: ServidorPlano[] };
  promptSistema: string;
  /**
   * definido em 2026-10-06 (NOD-183, ADR-080): as duas partes do `promptSistema` do turno de texto, para o driver do
   * claude-cli pôr o marcador de cache entre elas no `--system-prompt`. Juntadas com "\n" dão o `promptSistema`.
   * Ausente = só o `promptSistema` (ligação, planos antigos); quem não sabe usar ignora.
   */
  promptSistemaPartes?: { estavel: string; volatil: string };
  /**
   * definido em 2026-10-22 (NOD-315, ADR-119): a frente na máquina Linux com repo e GitHub concedido. O executor prepara o
   * clone bare `caminho` (`~/nod/.clones/<dono>/<nome>.git`) antes do turno e, se der certo, troca `semClone` por
   * `comClone` no prompt; se cair numa saída, o prompt fica como está e o bot clona na pasta dele. Executor antigo ignora
   * o campo: o prompt já vem com `semClone`.
   */
  cloneDaMaquina?: { repo: string; caminho: string; semClone: string; comClone: string };
  /**
   * `anexos` (ADR-046): metadados dos arquivos da mensagem deste turno; o driver baixa os bytes em
   * GET interno/anexos/:id com o token do turno. Ausente = nenhum (planos antigos e a maioria dos turnos).
   */
  /**
   * `bifurcar` (definido em 2026-10-07, ADR-083, rede de 2 min): continuar `sessaoCli` numa CÓPIA (`--fork-session` no
   * Claude), porque a original segue com o trabalho promovido. Só vem com harness que declara `bifurcaSessao`.
   */
  /**
   * `passagem` (definido em 2026-10-20, NOD-310, emenda da ADR-108 §5): o texto já leva a passagem de bastão do servidor
   * (a task tinha sessão e este turno não a retoma). `git: true` = o executor anexa o "Estado do branch" lido na pasta da
   * task antes de chamar o driver. Ausente = turno comum; executor antigo ignora.
   */
  entrada: { texto: string; sessaoCli: string | null; modelo: string; anexos?: AnexoMeta[]; esforco?: EsforcoAgente; bifurcar?: boolean; passagem?: { git: boolean } };
  /**
   * revisto em 2026-10-01 (ADR-066, "o bot tem o que você deu; o modo decide"): saíram o gate da rotina
   * (`efeitoExternoSoPorAprovacao`, EMENDA 15) e a trava herdada (ADR-058/059). Quem decide quando o bot para e
   * pergunta é só o modo de aprovação, igual em toda origem de turno.
   */
  politicaExecucao: {
    prazoMs: number;
    orcamentoResultadoChars: number;
  };
  /**
   * NOD-480 (emenda da ADR-040): o orçamento de contexto pela janela do modelo (domain/orcamento-contexto.ts). O driver do
   * Claude Code força a busca de ferramentas com `enxuto` e põe os tetos de Bash e Read quando vierem. Ausente (Codex,
   * ligação, servidor antigo) = como antes; app antigo ignora.
   */
  orcamento?: {
    janela: number;
    limiar: number;
    parteFixa: number;
    enxuto: boolean;
    resultadoChars: number;
    saidaBashChars?: number;
    leituraTokens?: number;
  };
  /**
   * ADR-059: o modo de aprovação do agente NA EMISSÃO, para o prompt e o Raio-X. Quem decide cada pedido lê o modo
   * ATUAL do agente (trocar vale na próxima ação); este campo só diz ao modelo como o turno começou. Ausente = 'manual'.
   */
  modoAprovacao?: ModoAprovacao;
  /**
   * definido em 2026-09-30 (ADR-059, emenda): o modo do TURNO. Conversa e criação = a pessoa está falando com o bot;
   * no automático, apagar num app e merge que ela pediu ali saem sem card. Ausente (plano antigo) = não é conversa.
   */
  modoTurno?: ModoTurno;
  /**
   * definido em 2026-10-27 (ADR-131): o turno é o que a pessoa espera agora (a fala dela na conversa, a ligação, o que ela
   * olha). O motor que se atualiza espera só estes acabarem; os outros (frente, rotina, colega) ele reinicia no meio e o
   * servidor os retoma. Ausente (servidor antigo) = conta como da pessoa: o motor não reinicia por cima dele.
   */
  daPessoa?: boolean;
  /** Presente só no turno da ligação (modoTurno = "ligacao"). */
  ligacaoVoz?: LigacaoVozPlano;
  /**
   * definido em 2026-09-21 (ADR-042): ferramentas que a PESSOA marcou como "sempre permitir",
   * resolvidas no PUXAR e embarcadas aqui — a avaliação é LOCAL, nunca consulta por chamada
   * (ADR-013). Nomes no mesmo namespace de `FerramentaPlano.nome` (`${slug}__${tool}`), e sempre
   * um SUBCONJUNTO do catálogo deste plano: a regra evita a pergunta, nunca amplia alcance.
   * VAZIA em turno com entrada não confiável (ADR-026 + ADR-042 claim 6).
   */
  semprePermitir: readonly string[];
  tokenDeTurno: string;
  expiraEm: EpochMs;
};
