import type { CapacidadesHarness } from "../../contracts/harness.ts";
import type { Inventario } from "../../contracts/inventario.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno, SinaisTurno } from "../../contracts/turno.ts";
import type { CamadaDoPath } from "./caminho.ts";

/**
 * SPI de três camadas (ADR-012): UM Driver com campo `locality`, nunca duas implementações.
 * O executor recebe o PLANO e os SINKS e devolve o resultado; quem grava é o servidor (ADR-018).
 * Nesta rodada há dois drivers no mesmo SPI: claude-cli (real) e catcher (default de dev/CI).
 */
export type IdDriver = "claude-cli" | "codex-cli" | "cursor-cli" | "hermes" | "catcher";

export type Localidade = "local" | "servidor" | "ambos";

export type ConfigDriver = {
  /** Caminho do binário; ausente = resolver no PATH aumentado (ADR-014). */
  bin?: string;
  bins?: Partial<Record<IdDriver, string>>;
  /** Ambiente já filtrado por montarAmbiente(regime, source) — o driver não lê process.env. */
  env: Record<string, string>;
  /** Base para o mkdtemp por turno (EMENDA 11): NOD_HOME/turnos. */
  cwdBase: string;
  /** Roteiro do catcher (marcadores → sequência de eventos); ignorado pelo claude-cli. */
  roteiro?: unknown;
  /** definido em 2026-10-09: de onde veio cada pasta de `env.PATH` (caminho.ts), para dizer qual binário rodou. */
  camadas?: readonly CamadaDoPath[];
  /**
   * definido em 2026-10-09 (revisão do PR 1, ADR-093): variáveis só de um driver. O Codex instalado pelo app roda o
   * binário nativo direto e recebe o que o `codex.js` daria a ele (CODEX_MANAGED_BY_NPM, CODEX_MANAGED_PACKAGE_ROOT).
   * revisto em 2026-10-12 (ADR-101): é também por onde vai a conta em uso — CLAUDE_CONFIG_DIR ou CODEX_HOME.
   */
  envPorDriver?: Partial<Record<IdDriver, Record<string, string>>>;
};

/**
 * Sinks do turno (ADR-009): `sinal` é AWAITED antes do efeito que ele anuncia (promptSubmitted
 * antes de escrever no stdin); `evento`/`delta` alimentam renovação de lease e streaming.
 */
export type SinksTurno = {
  sinal(s: keyof SinaisTurno): Promise<void>;
  evento(e: EventoStream): void;
  delta(texto: string): void;
  /**
   * Sessão viva (definido em 2026-10-01, ADR-067): a fala de uma volta do modelo que NÃO encerra o turno — há comando
   * em segundo plano ou mensagem nova. O laço a manda ao servidor, que a grava na conversa na hora.
   */
  falaIntermediaria?(texto: string): void;
  /**
   * Sessão viva: o modelo respondeu e nada roda em segundo plano. O laço pergunta ao servidor se chegou mensagem nova
   * da pessoa e a entrega por `receberMensagem` antes de responder. `true` = chegou, a sessão segue; `false` = pode
   * fechar, e daqui em diante o servidor não absorve mais nada para este turno.
   */
  ocioso?(): Promise<boolean>;
  /**
   * revisto em 2026-10-08 (revisão do épico #188, X2): a mensagem `id` (de `receberMensagem`) ENTROU na sessão — o
   * stdin do CLI a aceitou, o app-server aceitou o steer ou abriu a volta com ela. Só então o laço a confirma ao
   * servidor; antes disso ela continua `pendente` na fila e, se nunca entrar, vira turno próprio.
   */
  mensagemEntrou?(id: string): void;
  /** X2: a mensagem `id` não vai entrar (a volta que a levaria foi recusada, ou a sessão acabou com ela na fila). */
  mensagemDevolvida?(id: string): void;
};

export interface Adapter {
  rodarTurno(sinks: SinksTurno): Promise<ResultadoTurno>;
  /** SIGTERM → 5s → SIGKILL. A sonda de 2026-09-16 mediu (s6.log): exit 143 em ~640ms, signal null, filho MCP morre junto. */
  interromper(): Promise<void>;
  /**
   * Sessão viva (ADR-067): uma mensagem nova da pessoa entra no meio do trabalho, como no Claude Code. `false` = este
   * adapter não tem sessão viva ou ela já fechou a entrada; o laço então não pede mensagens ao servidor.
   * revisto em 2026-10-08 (X2): `true` = aceita para entrar; a confirmação vem depois por `mensagemEntrou(id)` (ou
   * `mensagemDevolvida(id)`) nos sinks do turno. Sem `id`, nada é confirmado.
   */
  receberMensagem?(texto: string, id?: string): boolean;
  /** true enquanto o adapter aceita mensagem nova (sessão viva com a entrada aberta). */
  aceitaMensagens?(): boolean;
  /**
   * definido em 2026-10-07 (ADR-083, #194): o grupo de processos do turno (o pid do líder, que nasce com
   * `detached: true`), para o amostrador somar a memória dele. null = ainda não subiu ou já saiu. Só os drivers com
   * `processoProprio` respondem; o laço nem pergunta aos outros.
   */
  grupoDeProcessos?(): number | null;
}

/** O veredito do teste de verdade de uma IA e o que ela respondeu (null quando não ficou pronta). */
export type TesteDoMotor = { inventario: Inventario; resposta: string | null };

export interface Instance {
  sondar(): Promise<Inventario>;
  /**
   * definido em 2026-10-05 (emenda da ADR-019): o TESTE de verdade — um turno de uma frase com `pergunta`, pago pela
   * assinatura da pessoa. `sondar()` pode ser só a conferência do login (o app do Mac); isto é o que prova que a conta
   * responde. Ausente no catcher.
   */
  testar?(pergunta: string): Promise<TesteDoMotor>;
  /**
   * NOD-167: este motor, já pronto, roda o laço de voz da ligação? false = não roda (o Codex sem `app-server`); null =
   * não deu para saber agora (sonda lenta). Ausente = o motor não tem esse piso (o Claude Code).
   */
  lacoDeVoz?(): Promise<boolean | null>;
  /**
   * definido em 2026-10-08 (revisão do épico #188, X9): as capacidades de `meta.capacidades` ajustadas pelo CLI
   * instalado (ex.: `bifurcaSessao` só com `--fork-session` no help). É o que o app anuncia ao servidor. Ausente = as do
   * `meta`, sem ajuste.
   */
  capacidades?(): Promise<CapacidadesHarness>;
  adapter(plano: PlanoTurno): Adapter;
  dispose(): Promise<void>;
}

export interface Driver {
  /**
   * `capacidades` (definido em 2026-10-07, ADR-083): o que o driver promete fazer, lido de `CAPACIDADES_HARNESS` pelo
   * id (uma fonte só). Ausente = `capacidadesDe(id)`; o catcher e os drivers de teste declaram as suas. O laço nunca
   * compara o id: deixa de pedir mensagens quando `!mensagemNoMeio` e não mede memória quando `!processoProprio`.
   */
  meta: { id: IdDriver; locality: Localidade; capacidades?: CapacidadesHarness };
  create(cfg: ConfigDriver): Promise<Instance>;
}

/** create() que falha vira sombra com motivo escrito, nunca derruba o servidor (ADR-012). */
export type RegistroDriver = { estado: "pronto"; driver: Driver; instance: Instance } | { estado: "sombra"; motivo: string };

export type Registry = Record<"claude-cli" | "catcher", RegistroDriver> & Partial<Record<IdDriver, RegistroDriver>>;
