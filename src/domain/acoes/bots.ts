import type { DefinicaoAcao } from "../../contracts/acoes.ts";
import { FERRAMENTAS_DO_NOD } from "../../contracts/ferramentas-do-nod.ts";
import type { JsonSchema } from "../../contracts/json-schema.ts";

/**
 * As ações sobre os bots da pessoa (NOD-391, ADR-135). O piloto `bots.*` é `vivo`: a rota (src/adapters/http/rotas/
 * agentes.ts) e o gerir_bots chamam o mesmo executor (src/use-cases/acoes/bots.ts), e o teste de contrato
 * (tests/integration/paridade-bots.test.ts) leva os dois ao mesmo estado no banco.
 *
 * O risco de cada id repete o do lote de antes do registro (o teste da ADR-082 o fixa): excluir e mudar o modo são
 * arriscados; ligar "Ignorar todas as aprovações" é sempre da pessoa; depois de conteúdo de fora, duplicar um bot com
 * acessos e editar a descrição ou o título viram cartão.
 */

const P = FERRAMENTAS_DO_NOD.gerir_bots.properties.acoes.items.properties;
const BOT = { type: "string", description: "O bot alvo: id ou nome exato.", minLength: 1 } as const satisfies JsonSchema;
const objeto = (properties: Record<string, JsonSchema>, required: readonly string[]): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
const VIA = "gerir_bots";
const CONTRATO = "tests/integration/paridade-bots.test.ts";

export const ACOES_BOTS = [
  {
    id: "bots.criar",
    titulo: "Criar um bot",
    schema: objeto({ nome: P.nome, titulo: P.titulo, descricao: P.descricao, secao: P.secao, modelo: P.modelo }, ["nome", "descricao"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: { estado: "vivo", via: { ferramenta: VIA, tipoNoLote: "criar" }, contrato: CONTRATO },
    casoDeUso: "bots.criar",
    lote: { tipo: "criar" },
  },
  {
    id: "bots.duplicar",
    titulo: "Duplicar um bot",
    schema: objeto({ bot: BOT }, ["bot"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: { estado: "vivo", via: { ferramenta: VIA, tipoNoLote: "duplicar" }, contrato: CONTRATO },
    casoDeUso: "bots.duplicar",
    lote: { tipo: "duplicar", deFora: (_a, s) => s.alvoTemAcessos },
  },
  {
    id: "bots.editar",
    titulo: "Editar o perfil de um bot",
    // definido em 2026-10-30 (NOD-20): o PATCH da tela também leva voz e vozVelocidade (o Salvar da missão com a voz vira
    // UMA versão), como já levava forma e cor; o gerir_bots edita só texto e inteligência. A voz no chat é a da ligação
    // (definirVozDoAgente), que também grava versão. Divergência de parâmetro registrada; não muda o estado da catraca.
    schema: objeto({ bot: BOT, nome: P.nome, titulo: P.titulo, descricao: P.descricao, modelo: P.modelo, esforco: P.esforco }, ["bot"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: { estado: "vivo", via: { ferramenta: VIA, tipoNoLote: "editar" }, contrato: CONTRATO },
    casoDeUso: "bots.editar",
    lote: { tipo: "editar", deFora: (a) => a.descricao !== undefined || a.titulo !== undefined },
  },
  {
    id: "bots.mover",
    titulo: "Mover um bot de time (e organizar a barra lateral)",
    schema: objeto({ bot: BOT, secao: P.secao }, ["bot", "secao"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: { estado: "vivo", via: { ferramenta: VIA, tipoNoLote: "mover" }, contrato: CONTRATO },
    casoDeUso: "bots.mover",
    lote: { tipo: "mover" },
  },
  {
    id: "bots.excluir",
    titulo: "Excluir um bot (e desligar o computador dele)",
    schema: objeto({ bot: BOT }, ["bot"]),
    risco: "arriscada",
    cartaoNoChat: true,
    chat: { estado: "vivo", via: { ferramenta: VIA, tipoNoLote: "excluir" }, contrato: CONTRATO },
    casoDeUso: "bots.excluir",
    lote: { tipo: "excluir" },
  },
  {
    id: "bots.mudar_modo",
    titulo: "Mudar o modo de aprovação de um bot",
    schema: objeto({ bot: BOT, modo: P.modo }, ["bot", "modo"]),
    risco: "arriscada",
    cartaoNoChat: true,
    chat: { estado: "vivo", via: { ferramenta: VIA, tipoNoLote: "mudar_modo" }, contrato: CONTRATO },
    casoDeUso: "bots.mudar_modo",
    lote: { tipo: "mudar_modo", riscoDe: (a) => (a.modo === "total" ? "pessoa_confirma" : "arriscada") },
  },
  {
    id: "bots.restaurar_versao",
    titulo: "Restaurar uma versão do perfil de um bot",
    schema: objeto({ bot: BOT, versao: P.versao }, ["bot", "versao"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: { estado: "vivo", via: { ferramenta: VIA, tipoNoLote: "restaurar_versao" }, contrato: CONTRATO },
    casoDeUso: "bots.restaurar_versao",
    // NOD-20: restaurar pode trazer de volta a descrição (o prompt do bot): depois de conteúdo de fora, vira cartão.
    lote: { tipo: "restaurar_versao", deFora: () => true },
  },
  { id: "bots.restaurar", titulo: "Restaurar um bot excluído", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "bots.fixar", titulo: "Fixar um bot no topo", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "bots.ocultar", titulo: "Ocultar um bot da barra", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "bots.definir_inteligencia", titulo: "Escolher a IA, o modelo e o raciocínio de um bot", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "bots.decidir_troca_de_ia", titulo: "Decidir o aviso de troca de IA de um bot", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-400" } },
  { id: "bots.mudar_voz", titulo: "Escolher a voz de um bot", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-397" } },
  { id: "bots.cobrar_colega", titulo: "Cobrar ou desistir da espera por um colega", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "memoria.criar", titulo: "Anotar uma memória no bot", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "memoria.editar", titulo: "Editar uma memória do bot", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "memoria.apagar", titulo: "Apagar uma memória do bot", risco: "arriscada", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "memoria.revisar_diario", titulo: "Revisar o diário da memória", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "memoria.desfazer_diario", titulo: "Desfazer uma entrada do diário da memória", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
] as const satisfies readonly DefinicaoAcao[];
