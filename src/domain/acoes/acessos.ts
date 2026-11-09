import type { DefinicaoAcao } from "../../contracts/acoes.ts";
import { PROPRIEDADES_ACESSOS as PA } from "../../contracts/ferramentas-acessos.ts";
import { FERRAMENTAS_DO_NOD } from "../../contracts/ferramentas-do-nod.ts";
import type { JsonSchema } from "../../contracts/json-schema.ts";

/**
 * Apps e acessos dos bots (NOD-391, ADR-135). Dar acesso já existe no lote do Nod, pela decisão de acesso (ADR-044,
 * emendada pela ADR-082); o resto é da Onda 2. O que leva um segredo (token, chave, credencial do app) nunca passa
 * pelo chat: a conversa vai para o modelo e para o histórico.
 */

const P = FERRAMENTAS_DO_NOD.gerir_bots.properties.acoes.items.properties;
/**
 * ADA-241 (ADR-158): o acesso de vários bots, o padrão do app e o Desfazer do lote são `vivo`: a tela (rotas de
 * concessoes.ts) e o gerir_acessos de QUALQUER bot chamam o executor único (src/use-cases/acoes/acessos.ts), e o teste de
 * contrato leva os dois ao mesmo estado no banco. Ler e alterar dá a vários bots o poder de mudar coisas fora do nod:
 * `pessoa_confirma` (o card espera a pessoa em todo modo). Dar acesso também é cerca 3 (conteúdo de fora vira card).
 */
const objeto = (properties: Record<string, JsonSchema>, required: readonly string[]): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
const CONTRATO_ACESSOS = "tests/integration/paridade-acessos.test.ts";
const via = (tipoNoLote: "acessos_em_lote" | "padrao_acesso" | "desfazer_acessos") => ({ estado: "vivo", via: { ferramenta: "gerir_acessos", tipoNoLote }, contrato: CONTRATO_ACESSOS }) as const;
const riscoDoNivel = (a: { nivel_lote?: string }) => (a.nivel_lote === "escrita" ? "pessoa_confirma" : "muda") as "pessoa_confirma" | "muda";
const daAcesso = (a: { nivel_lote?: string }) => a.nivel_lote !== "nenhum";

const SEGREDO = "leva um segredo (token, chave ou credencial): só pelo campo seguro da tela, nunca pela conversa";

export const ACOES_ACESSOS = [
  {
    id: "acessos.dar",
    titulo: "Dar a um bot acesso a um app (Nenhum / Ler / Ler e alterar)",
    schema: { type: "object", properties: { bot: P.bot, app: P.app, nivel: P.nivel }, required: ["bot", "app", "nivel"], additionalProperties: false },
    risco: "muda",
    cartaoNoChat: true,
    chat: { estado: "parcial", via: { ferramenta: "gerir_bots", tipoNoLote: "dar_acesso" }, falta: "o lote só concede (sem o nível Nenhum, sem revogar o que sobra) e passa pela decisão de acesso, não pelo executor da tela" },
    lote: { tipo: "dar_acesso", deFora: () => true },
  },
  {
    id: "acessos.dar_em_lote",
    titulo: "Dar o mesmo nível de um app a vários bots (ou a todos) de uma vez",
    schema: objeto({ app: PA.app, nivel: PA.nivel, bots: PA.bots }, ["app", "nivel"]),
    risco: "muda",
    cartaoNoChat: true,
    chat: via("acessos_em_lote"),
    casoDeUso: "acessos.dar_em_lote",
    lote: { tipo: "acessos_em_lote", riscoDe: riscoDoNivel, deFora: daAcesso },
  },
  {
    id: "acessos.desfazer_lote",
    titulo: "Desfazer um lote de acessos (até 24 horas)",
    schema: objeto({ lote_id: PA.lote_id }, ["lote_id"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: via("desfazer_acessos"),
    casoDeUso: "acessos.desfazer_lote",
    lote: { tipo: "desfazer_acessos", deFora: () => true },
  },
  {
    id: "apps.padrao",
    titulo: "Definir o padrão do app (o nível com que os bots novos nascem)",
    schema: objeto({ app: PA.app, nivel: PA.nivel, aplicar: PA.aplicar }, ["app", "nivel"]),
    risco: "muda",
    cartaoNoChat: true,
    chat: via("padrao_acesso"),
    casoDeUso: "apps.padrao",
    lote: { tipo: "padrao_acesso", riscoDe: riscoDoNivel, deFora: daAcesso },
  },
  { id: "acessos.conceder", titulo: "Conceder uma capacidade de um app a um bot", risco: "muda", cartaoNoChat: true, chat: { estado: "falta", onda: "NOD-394" } },
  { id: "acessos.liberar", titulo: "Liberar num clique os apps que o bot ainda não tem", risco: "muda", cartaoNoChat: true, chat: { estado: "falta", onda: "NOD-394" } },
  { id: "acessos.dispensar", titulo: "Dispensar a oferta de liberar apps", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-394" } },
  { id: "acessos.revogar", titulo: "Revogar acessos de um bot", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-394" } },
  { id: "apps.criar", titulo: "Adicionar um app (conector)", risco: "arriscada", cartaoNoChat: true, chat: { estado: "falta", onda: "NOD-394" } },
  { id: "apps.sondar", titulo: "Testar um app de novo", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-394" } },
  { id: "apps.habilitar", titulo: "Ligar um app", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-394" } },
  { id: "apps.desabilitar", titulo: "Desligar um app", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-394" } },
  { id: "apps.conectar", titulo: "Conectar um app do Marketplace", risco: "muda", cartaoNoChat: true, chat: { estado: "falta", onda: "NOD-394" } },
  { id: "apps.verificar", titulo: "Verificar a conexão de um app do Marketplace", risco: "leitura", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-394" } },
  { id: "apps.credenciais", titulo: "Guardar as credenciais de um app", risco: "pessoa_confirma", cartaoNoChat: false, chat: { estado: "nunca", motivo: SEGREDO } },
  { id: "apps.configurar_marketplace", titulo: "Guardar a chave do Marketplace", risco: "pessoa_confirma", cartaoNoChat: false, chat: { estado: "nunca", motivo: SEGREDO } },
  { id: "apps.github_token", titulo: "Conectar o GitHub por token", risco: "pessoa_confirma", cartaoNoChat: false, chat: { estado: "nunca", motivo: SEGREDO } },
  { id: "apps.github_app", titulo: "Conectar o GitHub por app instalado", risco: "pessoa_confirma", cartaoNoChat: false, chat: { estado: "nunca", motivo: SEGREDO } },
] as const satisfies readonly DefinicaoAcao[];
