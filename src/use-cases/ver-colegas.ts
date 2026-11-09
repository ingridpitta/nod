import type { Agente } from "../contracts/agente.ts";
import { ehNod } from "../domain/nod.ts";
import type { AppDoColega, ColegaListado, VersaoListada } from "../contracts/ferramentas-perfil.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import { INSTRUCAO_ROTINA_NO_PROMPT } from "../domain/prompt-sistema.ts";
import { quandoDaRotina } from "../domain/rotina-texto.ts";
import { agenteVisivel, assertUuid } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";

/**
 * Cortes do resultado (definido em 2026-09-28, ADR-050): o proxy corta tudo em ORCAMENTO_RESULTADO_CHARS
 * (8 mil), e um corte no meio do JSON perde colegas inteiros. Sem `agente` a lista vem resumida, na mesma
 * medida do diretório do prompt; com `agente`, o colega vem inteiro — é o "vá mais a fundo".
 */
const DESCRICAO_RESUMIDA = 300;
const INSTRUCAO_INTEIRA = 1_500;
/** NOD-20: com `agente`, as últimas versões do perfil (o número que o restaurar_versao do gerir_bots pede). */
const VERSOES_NO_COLEGA = 5;

function cortar(texto: string, teto: number): string {
  return texto.length > teto ? `${texto.slice(0, teto - 1)}…` : texto;
}

/**
 * Quem este agente enxerga como colega: o MESMO filtro do diretório de colegas do prompt
 * (emitir-plano-turno.ts) — outro bot do mesmo dono, confirmado e visível. Também decide de quem é a
 * rotina que ele pode pausar a pedido da pessoa (rotinas-do-agente.ts).
 */
export function ehColega(eu: Pick<Agente, "id" | "ownerId">, a: Pick<Agente, "id" | "ownerId" | "confirmado" | "oculto" | "papel">): boolean {
  // ADR-081: o Nod não é colega de ninguém — só a pessoa fala com ele (as mãos dele sobre os bots são da pessoa).
  return a.id !== eu.id && a.ownerId === eu.ownerId && a.confirmado && !a.oculto && !ehNod(a);
}

/**
 * Ferramenta `ver_colegas` (definido em 2026-09-28, ADR-050): o que os outros bots da pessoa fazem, lido
 * do nod — perfil, rotinas e apps concedidos. Não pergunta nada a outro modelo (pedir_a_bot é para isso,
 * ADR-058), então o resultado sai na hora e é confiável: é a configuração que a própria pessoa confirmou.
 * `agente` aceita o id do diretório ou o nome único; fora dos colegas = nao_encontrado, nome repetido =
 * entrada_invalida, ambos tipados em {erro} para o modelo corrigir a chamada.
 */
export const verColegas: CasoNod<Deps, "ver_colegas"> = async (deps, input) => {
  assertUuid(input.agenteId, "agenteId");
  const eu = await agenteVisivel(deps.repos, input.agenteId);
  const colegas = (await deps.repos.agentes.listar()).filter((a) => ehColega(eu, a));
  const alvo = input.agente?.trim().replace(/^@/, "");
  let escolhidos = colegas;
  if (alvo) {
    const minusculo = alvo.toLocaleLowerCase("pt-BR");
    escolhidos = colegas.filter((a) => a.id === alvo || a.nome.toLocaleLowerCase("pt-BR") === minusculo);
    if (escolhidos.length === 0) return { data: { erro: "nao_encontrado" } };
    if (escolhidos.length > 1) return { data: { erro: "entrada_invalida" } };
  }
  const inteiro = Boolean(alvo);
  const conectores = await deps.repos.conectores.listar();
  const lista: ColegaListado[] = [];
  for (const a of escolhidos) {
    const rotinas = await deps.repos.rotinas.listarDoAgente(a.id);
    const concessoes = await deps.repos.concessoes.doAgente(a.id);
    const apps: AppDoColega[] = [];
    for (const c of conectores) {
      if (!c.habilitado) continue;
      const minhas = concessoes.filter((g) => g.conectorId === c.id).map((g) => g.capacidade);
      if (minhas.length === 0) continue;
      const leitura = new Set(c.catalogo.filter((cap) => cap.readOnlyHint).map((cap) => cap.nome));
      apps.push({ slug: c.slug, nome: c.nome, nivel: minhas.every((m) => leitura.has(m)) ? "leitura" : "escrita" });
    }
    lista.push({
      id: a.id,
      nome: a.nome,
      titulo: a.titulo,
      descricao: inteiro ? a.descricao : cortar(a.descricao, DESCRICAO_RESUMIDA),
      rotinas: rotinas.map((r) => ({ id: r.id, quando: quandoDaRotina(r), estado: r.estado, instrucao: cortar(r.instrucao, inteiro ? INSTRUCAO_INTEIRA : INSTRUCAO_ROTINA_NO_PROMPT) })),
      apps,
      ...(inteiro ? { versoes: await versoesDoColega(deps, a.id) } : {}),
    });
  }
  return { data: { colegas: lista } };
};

/** Só número, enum e a lista dos campos: o texto das versões fica no Histórico (é a pessoa quem o lê). */
async function versoesDoColega(deps: Deps, agenteId: string): Promise<VersaoListada[]> {
  const { versoes } = await deps.repos.versoesPerfil.listar(agenteId, null, VERSOES_NO_COLEGA);
  return versoes.map((v, i) => ({ versao: v.versao, origem: v.origem, autor: v.autor, campos: [...v.campos], atual: i === 0 }));
}
