import type { DefinicaoAcao } from "../../contracts/acoes.ts";
import { PROPRIEDADES_APPS as P } from "../../contracts/ferramentas-apps.ts";
import type { JsonSchema } from "../../contracts/json-schema.ts";

/**
 * As ações das páginas do bot (definido em 2026-11-02, NOD-445, ADR-146). O domínio é `paginas.` e não `apps.`: `apps.*` já são os
 * conectores (src/domain/acoes/acessos.ts); a spec diz apps.criar/editar/ordenar/remover. Todas `vivo`: a rota da tela
 * (src/adapters/http/rotas/apps.ts) e o gerir_apps de QUALQUER bot passam pelos mesmos executores
 * (src/use-cases/apps-do-bot.ts), e o teste de contrato (tests/integration/paridade-apps.test.ts) leva os dois ao mesmo
 * estado no banco.
 *
 * Criar e editar não têm rota de pessoa: "+ pedir um app" e "Editar" no menu do ícone levam à caixa da conversa com a
 * frase começada (o padrão da NOD-444), e criar pelo chat vira o card que a pessoa confirma (POST decisoes/:id/decidir).
 */

const objeto = (properties: Record<string, JsonSchema>, required: readonly string[]): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
const VIA = { ferramenta: "gerir_apps" } as const;
const CONTRATO = "tests/integration/paridade-apps.test.ts";
const vivo = { estado: "vivo", via: VIA, contrato: CONTRATO } as const;
const PELA_CONVERSA = "a tela leva à caixa da conversa com a frase começada (NOD-444); o card do chat se confirma em POST decisoes/:id/decidir";

export const ACOES_APPS = [
  {
    id: "paginas.criar_app",
    titulo: "Criar um app do bot (nome, ícone, fonte, forma, quem vê, regra do \"pede você\")",
    schema: objeto({ bot: P.bot, nome: P.nome, icone: P.icone, fonte: P.fonte, fonte_ref: P.fonte_ref, forma: P.forma, regra_pede: P.regra_pede, pede_quando: P.pede_quando }, ["nome", "fonte", "forma"]),
    risco: "muda",
    cartaoNoChat: true,
    chat: vivo,
    casoDeUso: "paginas.criar_app",
    semRotaDePessoa: PELA_CONVERSA,
  },
  {
    id: "paginas.editar_app",
    titulo: "Editar um app (nome, ícone, forma, fonte, regra) ou o retrato que ele mostra",
    schema: objeto({ bot: P.bot, app: P.app, nome: P.nome, icone: P.icone, forma: P.forma, fonte: P.fonte, fonte_ref: P.fonte_ref, regra_pede: P.regra_pede, pede_quando: P.pede_quando, dados: P.dados, erro_fonte: P.erro_fonte }, ["app"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "paginas.editar_app",
    semRotaDePessoa: PELA_CONVERSA,
  },
  {
    id: "paginas.ordenar",
    titulo: "Reordenar as páginas do bot (a Conversa inclusive; a primeira é a tela inicial)",
    schema: objeto({ bot: P.bot, ordem: P.ordem, pagina: P.pagina, posicao: P.posicao, antes_de: P.antes_de, depois_de: P.depois_de }, []),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "paginas.ordenar",
  },
  {
    id: "paginas.remover_app",
    titulo: "Tirar um app da pílula (o dado de origem fica; tem Desfazer)",
    schema: objeto({ bot: P.bot, app: P.app }, ["app"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "paginas.remover_app",
  },
  {
    id: "paginas.restaurar_app",
    titulo: "Trazer de volta um app removido (o Desfazer)",
    schema: objeto({ bot: P.bot, app: P.app }, ["app"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "paginas.restaurar_app",
  },
] as const satisfies readonly DefinicaoAcao[];
