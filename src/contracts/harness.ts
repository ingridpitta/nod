import type { EsforcoAgente } from "./agente.ts";
import type { TipoAnexo } from "./anexo.ts";
import type { Inventario } from "./inventario.ts";

export type IdHarness = "claude-cli" | "codex-cli" | "cursor-cli" | "hermes";
export type PreferenciaHarness = "auto" | IdHarness;
/**
 * `raciocinios`: os níveis de raciocínio que o modelo aceita, na ordem (o `--effort` do Claude Code; o `effort` do
 * `turn/start` do Codex). Ausente = o harness não tem raciocínio escolhível.
 */
export type ModeloHarness = {
  id: string;
  nome: string;
  descricao: string;
  raciocinios?: readonly EsforcoAgente[];
  /** NOD-9 (definido em 2026-10-22): a versão do CLI a partir da qual ele conhece o modelo (x.y.z); ausente = o piso basta. */
  versaoMinima?: string;
};
export type OpcaoHarness = {
  id: IdHarness;
  nome: string;
  descricao: string;
  integrado: boolean;
  modelos: readonly ModeloHarness[];
  /** O "Recomendado" da IA (definido em 2026-10-10, decisão do Marlon): o modelo e o raciocínio de quem não escolheu. */
  recomendado?: { modelo: string; raciocinio: EsforcoAgente };
  /** O que o harness sabe fazer (CAPACIDADES_HARNESS): a web decide anexo e pasta por aqui, nunca pelo id (ADR-083). */
  capacidades: CapacidadesHarness;
  inventario: Inventario;
};
/** `legado`: o harness do bot `auto` (ou sem harness) quando a pergunta é "o que ele sabe fazer" (HARNESS_LEGADO). */
export type CatalogoHarness = { padrao: IdHarness | null; simulacao: boolean; legado: IdHarness; opcoes: OpcaoHarness[] };

/**
 * definido em 2026-09-18 (ADR-083, NOD-207 em 2026-10-11): o harness dos campos anteriores à escolha de IA. O `auto` com
 * um modelo do Claude fica nele, o bot `auto`/sem harness lê anexo e traduz comando como ele, e a fila trata o `auto`
 * fixado como ele. Um lugar só: o domínio, a fila (SQL do reivindicar) e o catálogo da web leem daqui.
 */
export const HARNESS_LEGADO = "claude-cli" satisfies IdHarness;

/**
 * O que um harness sabe fazer (definido em 2026-10-07, ADR-083). Toda diferença de comportamento entre harnesses passa
 * por aqui, nunca por comparar o id fora do driver: Cursor, Hermes e outros entram declarando as suas.
 *
 * - `mensagemNoMeio`: aceita texto num turno em andamento (Claude: stdin stream-json; Codex: `turn/steer` no
 *   app-server). É a promessa estática; se a entrada está aberta AGORA, quem diz é o `aceitaMensagens()` do adapter.
 * - `retomaSessao`: continua uma sessão pelo id (`--resume`). Sem isto o turno recebe o histórico recente.
 * - `bifurcaSessao`: copia uma sessão e segue nas duas (`--fork-session`). Na rede de 2 min, quem retoma sem bifurcar não
 *   promove; quem nem retoma promove e o dono segue com o histórico (revisto em 2026-10-12, ADR-099, I8).
 * - `processoProprio`: o driver sobe um processo local cujo grupo dá para medir (memória) e encerrar.
 * - `terminal`: o kit de terminal do nod (hook das nativas, ADR-055/065) vale para este harness.
 * - `anexos`: os tipos de anexo que o modelo lê como conteúdo (ADR-046). Claude: imagem e PDF viram blocos da mensagem
 *   (medido em 2026-09-24 com `claude -p --input-format stream-json`: leu PNG e PDF certo); Codex: `codex exec --image` só aceita
 *   imagem, PDF fica de fora; texto vira texto da mensagem nos dois. Vazio = o servidor recusa e o composer não oferece.
 * - `comandosDoCli`: os comandos da conversa viram os do CLI (/uso → /cost, NOD-179). Sem isto, /uso responde a frase
 *   fixa do nod (USO_FORA_DO_CLAUDE) e o modelo não inventa um uso.
 * - `pastaDeTrabalho`: o turno usa a pasta do bot no Mac (`~/nod/<bot>`, o cwd do kit do terminal, ADR-052) e a gaveta
 *   mostra o caminho. Sem isto a gaveta mostra só a linha "Pasta de trabalho", sem o caminho (desde 2026-09-28 o Codex
 *   continua só com as ferramentas do proxy, ADR-052).
 */
export type CapacidadesHarness = {
  mensagemNoMeio: boolean;
  retomaSessao: boolean;
  bifurcaSessao: boolean;
  processoProprio: boolean;
  terminal: boolean;
  anexos: readonly TipoAnexo[];
  comandosDoCli: boolean;
  pastaDeTrabalho: boolean;
  /** NOD-323 (revisão 3 do #507): o proxy desta versão atende `anexar_midia`; o app anterior não anuncia e não a recebe. */
  anexarMidia: boolean;
};

/** Harness desconhecido ou em preparação: nenhuma capacidade, todo caminho cai no "sem a capacidade". */
export const SEM_CAPACIDADES: CapacidadesHarness = { mensagemNoMeio: false, retomaSessao: false, bifurcaSessao: false, processoProprio: false, terminal: false, anexos: [], comandosDoCli: false, pastaDeTrabalho: false, anexarMidia: false };

/**
 * definido em 2026-10-07 (ADR-083): o Codex do chat roda no app-server quando a sonda o acha (`turn/steer`), mas
 * `thread/resume` e fork não foram medidos — continua recebendo o histórico recente. Mudou uma medição: troque aqui.
 * revisto em 2026-10-14 (ADR-103, paridade do Codex): o chat do Codex tem o kit do terminal (o hook PreToolUse do Codex
 * leva cada comando ao servidor), trabalha na pasta do bot e continua a thread (`thread/resume`, `thread/fork`). Quando
 * a máquina não consegue ligar o hook, o driver roda isolado e avisa o modelo, como o Claude sem o hook.
 */
export const CAPACIDADES_HARNESS: Record<IdHarness, CapacidadesHarness> = {
  "claude-cli": { mensagemNoMeio: true, retomaSessao: true, bifurcaSessao: true, processoProprio: true, terminal: true, anexos: ["imagem", "pdf", "texto"], comandosDoCli: true, pastaDeTrabalho: true, anexarMidia: true },
  "codex-cli": { mensagemNoMeio: true, retomaSessao: true, bifurcaSessao: true, processoProprio: true, terminal: true, anexos: ["imagem", "texto"], comandosDoCli: false, pastaDeTrabalho: true, anexarMidia: true },
  "cursor-cli": SEM_CAPACIDADES,
  hermes: SEM_CAPACIDADES,
};

/**
 * NOD-167: o id do Luna, o modelo rápido do Codex, num lugar só: o catálogo do chat e o padrão da ligação
 * (MODELOS_LIGACAO_PADRAO) leem daqui. Antes eram `gpt-5.6-luna` aqui e `gpt-6-luna` no padrão da ligação. Vale o
 * `gpt-5.6-luna` (a família do `gpt-5.6-sol`, já medido no Codex real), até o `model/list` da sonda
 * (scripts/sonda-codex-app-server.ts) mostrar o id de verdade: trocar é esta linha.
 */
export const MODELO_LUNA_CODEX = "gpt-5.6-luna";

/**
 * Os níveis de raciocínio medidos (definido em 2026-10-10, emenda da ADR-036).
 * - Claude Code: o `--effort` aceita low, medium, high, xhigh, max (medido no `--help` da 2.1.284 e da 2.1.296). O Haiku
 *   fica com os três primeiros, como no protótipo aprovado (não medido: o CLI não diz os níveis por modelo).
 * - Codex: `model/list` do `codex app-server` 0.147.0 (medido em 2026-10-10, sem turno, com a conta logada e com um HOME
 *   vazio): gpt-5.6-sol aceita low…max e "ultra" (que delega tarefas sozinho: fora da lista de propósito); gpt-5.6-luna
 *   aceita low…max. Os GPT-6 não aparecem no `model/list` dessa versão: ficam com os quatro níveis que todo modelo medido
 *   aceita (low…xhigh) até a sonda mostrar os deles. Trocar = esta tabela e tests/fixtures/codex-model-list-0.147.json.
 */
const RACIOCINIOS_TODOS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly EsforcoAgente[];
const RACIOCINIOS_CURTOS = ["low", "medium", "high"] as const satisfies readonly EsforcoAgente[];
const RACIOCINIOS_SEM_MAX = ["low", "medium", "high", "xhigh"] as const satisfies readonly EsforcoAgente[];

/**
 * definido em 2026-09-18: catálogo editorial; disponibilidade de conta vem da sonda, nunca desta lista. NOD-171
 * (2026-10-06): a lista só cresce; entra o modelo que o `model/list` do Codex real mostrou E que passou num turno real
 * do UAT (docs/uat-harnesses-e-modelos.md). revisto em 2026-10-10 (emenda da ADR-036): o padrão do automático é o
 * `recomendado` de cada IA — Opus no Claude, GPT-5.6 Sol no Codex, raciocínio médio (decisão do Marlon).
 */
export const HARNESSES = [
  { id: "claude-cli", nome: "Claude Code", descricao: "Usa sua conta do Claude.", integrado: true, recomendado: { modelo: "opus", raciocinio: "medium" },
    modelos: [{ id: "sonnet", nome: "Sonnet", descricao: "Equilíbrio para o dia a dia", raciocinios: RACIOCINIOS_TODOS }, { id: "haiku", nome: "Haiku", descricao: "Tarefas rápidas e simples", raciocinios: RACIOCINIOS_CURTOS }, { id: "opus", nome: "Opus", descricao: "Trabalhos mais complexos", raciocinios: RACIOCINIOS_TODOS }] },
  { id: "codex-cli", nome: "Codex", descricao: "Usa sua conta do Codex.", integrado: true, recomendado: { modelo: "gpt-5.6-sol", raciocinio: "medium" },
    modelos: [{ id: "gpt-5.6-sol", nome: "GPT-5.6 Sol", descricao: "Trabalho do dia a dia", raciocinios: RACIOCINIOS_TODOS }, { id: "gpt-6-astra", nome: "GPT-6 Astra", descricao: "Trabalhos mais complexos", raciocinios: RACIOCINIOS_SEM_MAX }, { id: MODELO_LUNA_CODEX, nome: "GPT-5.6 Luna", descricao: "Tarefas rápidas e simples", raciocinios: RACIOCINIOS_TODOS },
      { id: "gpt-6.1-sol", nome: "GPT-6.1 Sol", descricao: "Dia a dia, geração mais nova", raciocinios: RACIOCINIOS_SEM_MAX }, { id: "gpt-6-sol", nome: "GPT-6 Sol", descricao: "Dia a dia, geração 6", raciocinios: RACIOCINIOS_SEM_MAX }, { id: "gpt-6-luna", nome: "GPT-6 Luna", descricao: "Rápido, geração 6", raciocinios: RACIOCINIOS_SEM_MAX }] },
  { id: "cursor-cli", nome: "Cursor", descricao: "Integração em preparação.", integrado: false, modelos: [] },
  { id: "hermes", nome: "Hermes", descricao: "Integração em preparação; poderá oferecer modelos de diferentes provedores, como Grok.", integrado: false, modelos: [] },
] as const satisfies readonly Omit<OpcaoHarness, "inventario" | "capacidades">[];
