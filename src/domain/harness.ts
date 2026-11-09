import type { EsforcoAgente } from "../contracts/agente.ts";
import { CAPACIDADES_HARNESS, HARNESS_LEGADO, HARNESSES, SEM_CAPACIDADES } from "../contracts/harness.ts";
import type { CapacidadesHarness, CatalogoHarness, IdHarness, ModeloHarness, OpcaoHarness, PreferenciaHarness } from "../contracts/harness.ts";
import type { TipoAnexo } from "../contracts/anexo.ts";
import type { EscolhasIa } from "../contracts/inteligencia.ts";
import type { Inventario } from "../contracts/inventario.ts";
import { MODELO_MAIS_POTENTE, VERSAO_MINIMA_POR_APELIDO } from "../contracts/modelos.ts";
import { ErroDeDominio } from "./erro.ts";
import { iaAceitaModelo, iaDoModelo } from "./ia-do-modelo.ts";
import { iaDoAutomatico, modeloERaciocinio, ordemEfetiva } from "./inteligencia.ts";

export function validarInteligencia(harness: unknown, modelo: unknown): asserts harness is PreferenciaHarness {
  if (typeof modelo !== "string" || !modelo.trim() || modelo.length > 160 || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(modelo)) throw new ErroDeDominio("entrada_invalida");
  if (harness === "auto") {
    // NOD-213: `auto` com um modelo escolhido vale para a IA DONA do modelo (iaDoModelo): o Claude para os do Claude
    // (a regra de 2026-09-18), o Codex para os GPT. Modelo fora do catálogo continua recusado.
    if (modelo === "auto" || iaDoModelo(modelo) !== null) return;
    throw new ErroDeDominio("entrada_invalida");
  }
  if (!HARNESSES.some((h) => h.id === harness && h.integrado)) throw new ErroDeDominio("entrada_invalida");
  if (modelo === "auto" || iaAceitaModelo(harness as IdHarness, modelo)) return;
  throw new ErroDeDominio("entrada_invalida");
}

/**
 * NOD-171: a causa do `executor_indisponivel` que `resolverHarness` lança. Diz qual harness faltou, para a negação
 * usar o inventário DELE e nunca o do motor. `modelo_invalido` = o agente gravou um modelo que o harness não aceita:
 * vira recusa escrita no despacho, em vez de um `entrada_invalida` que desfazia a reivindicação a cada puxar.
 * `inventario` é anexado por quem conhece o inventário de cada harness (emitir-plano-turno).
 * NOD-285 (2026-10-15): `anexo_nao_lido` = no Automático, nenhuma IA pronta lê um dos anexos da fala (`tipo`). Nega antes de
 * rodar, em vez de o Codex trocar o PDF por "não pôde ser lido". `harness` é a IA que o Automático pegaria sem o anexo.
 */
export type CausaHarnessIndisponivel = { harness: IdHarness; modelo?: string; motivo?: "modelo_invalido" | "anexo_nao_lido"; tipo?: TipoAnexo; inventario?: Inventario };

export function causaHarnessIndisponivel(e: unknown): CausaHarnessIndisponivel | null {
  if (!(e instanceof ErroDeDominio) || e.codigo !== "executor_indisponivel") return null;
  const c = e.cause as Partial<CausaHarnessIndisponivel> | undefined;
  return c && typeof c === "object" && typeof c.harness === "string" ? (c as CausaHarnessIndisponivel) : null;
}

/**
 * O harness em que o turno está fixado; null = `auto`/`auto`, que vai para qualquer harness pronto. NOD-213: o `auto` com
 * modelo escolhido fica na IA DONA do modelo (iaDoModelo: GPT → Codex, Claude → Claude Code); modelo desconhecido, no
 * legado (é o `validarInteligencia` que o recusa, nomeando esse harness).
 */
export function harnessFixado(harness: string | undefined, modelo: string): IdHarness | null {
  const pedido = harness ?? "auto";
  if (pedido !== "auto") return pedido as IdHarness;
  return modelo === "auto" ? null : (iaDoModelo(modelo) ?? HARNESS_LEGADO);
}

/**
 * A IA, o modelo e o raciocínio do turno (revisto em 2026-10-10, emenda da ADR-036). Fixado (o bot em "Uma IA só", ou o
 * `auto` antigo com modelo do Claude): aquela IA, pronta ou nada. Automático: a primeira PRONTA da `ordem` (a do bot, a
 * da pessoa ou a padrão) fora do limite (`noLimite`); todas no limite = a primeira pronta (iaDoAutomatico). Sem `ordem`,
 * vale a padrão com o `preferido` na frente. O modelo `auto` vira a escolha do bot para a IA, senão o recomendado
 * (Opus / GPT-5.6 Sol); o raciocínio vem da escolha, senão o médio, sempre um nível que o modelo aceita.
 */
export function resolverHarness(p: { harness?: PreferenciaHarness; modelo: string; prontos: readonly IdHarness[]; preferido?: IdHarness | null; ordem?: readonly IdHarness[]; noLimite?: readonly IdHarness[]; escolhas?: EscolhasIa; tiposDeAnexo?: readonly TipoAnexo[] }): { harness: IdHarness; modelo: string; raciocinio?: EsforcoAgente } {
  const pedido = p.harness ?? "auto";
  const fixo = harnessFixado(pedido, p.modelo);
  try {
    validarInteligencia(pedido, p.modelo);
  } catch (e) {
    if (e instanceof ErroDeDominio && e.codigo === "entrada_invalida") {
      throw new ErroDeDominio("executor_indisponivel", { cause: { harness: fixo ?? HARNESS_LEGADO, modelo: p.modelo, motivo: "modelo_invalido" } satisfies CausaHarnessIndisponivel });
    }
    throw e;
  }
  const ordem = p.ordem ?? ordemEfetiva({ preferido: p.preferido });
  // NOD-285 (K1): com anexo, o Automático só considera a IA pronta que lê TODOS os tipos (o `noLimite` continua valendo
  // entre elas). A IA fixa já foi conferida na entrada (enviar-mensagem) e segue a regra de antes.
  const tipos = [...new Set(p.tiposDeAnexo ?? [])];
  const naoLido = (ia: IdHarness) => tipos.find((t) => !capacidadesDe(ia).anexos.includes(t));
  const prontos = fixo || tipos.length === 0 ? p.prontos : p.prontos.filter((ia) => naoLido(ia) === undefined);
  if (!fixo && tipos.length > 0 && prontos.length === 0) {
    const semAnexo = iaDoAutomatico({ ordem, prontos: p.prontos, noLimite: p.noLimite }) ?? HARNESS_LEGADO;
    throw new ErroDeDominio("executor_indisponivel", { cause: { harness: semAnexo, motivo: "anexo_nao_lido", tipo: naoLido(semAnexo) ?? tipos[0] } satisfies CausaHarnessIndisponivel });
  }
  const escolhido = fixo ?? iaDoAutomatico({ ordem, prontos, noLimite: p.noLimite });
  if (!escolhido || !p.prontos.includes(escolhido)) throw new ErroDeDominio("executor_indisponivel", { cause: escolhido ? ({ harness: escolhido } satisfies CausaHarnessIndisponivel) : undefined });
  return { harness: escolhido, ...modeloERaciocinio(escolhido, p.escolhas, p.modelo) };
}

/** O modelo mais potente do harness (MODELO_MAIS_POTENTE); null para harness ainda sem catálogo. */
export function modeloMaisPotente(harness: IdHarness): string | null {
  return MODELO_MAIS_POTENTE[harness] ?? null;
}

/**
 * NOD-9 (definido em 2026-10-22): a versão do CLI que o modelo pede — a do catálogo (ModeloHarness.versaoMinima) e, fora
 * dele, a dos apelidos (VERSAO_MINIMA_POR_APELIDO). Modelo ou IA desconhecidos: null (o piso do CLI basta).
 */
export function versaoMinimaDoModelo(ia: IdHarness, id: string): string | null {
  const modelos: readonly ModeloHarness[] = HARNESSES.find((h) => h.id === ia)?.modelos ?? [];
  const doCatalogo = modelos.find((m) => m.id === id)?.versaoMinima;
  return doCatalogo ?? VERSAO_MINIMA_POR_APELIDO[ia]?.[id] ?? null;
}

/**
 * NOD-220: a IA que uma negação de executor indisponível registra — o harness do turno, quando é do catálogo. Sem harness
 * (o executor faltou), "catcher", "ia" e ids desconhecidos: undefined (a web não infere outra no lugar).
 */
export function iaDaNegacao(harness: string | null | undefined): IdHarness | undefined {
  return HARNESSES.find((h) => h.id === harness)?.id;
}

const SEM_SONDA_DO_HARNESS = "não está pronto em nenhum computador conectado";

/** Nenhuma máquina viva da pessoa anunciou este harness: não se sabe se falta instalar, logar ou atualizar. */
export function inventarioHarnessSemSonda(agora: number): Inventario {
  return { estado: "ausente", motivo: SEM_SONDA_DO_HARNESS, em: agora };
}

/**
 * #313 (2026-10-15): o estado "da máquina" que os portões leem (envio, puxar, despacho, executor do plano) — pronta se
 * QUALQUER IA dela está pronta, na ordem do catálogo (o Claude antes do Codex). Sem nenhuma, o `inv` de quem chama, que
 * já é a melhor explicação da falta. Antes cada lado tinha a regra à mão, e o anúncio passou a mandar o estado do Claude
 * (d14c7b1e): quem só tinha o ChatGPT nunca rodava nada.
 */
export function estadoDaMaquina(inv: Inventario, ias: Partial<Record<IdHarness, Inventario>>): Inventario {
  if (inv.estado === "pronto") return inv;
  for (const h of HARNESSES) {
    const i = ias[h.id];
    if (i?.estado === "pronto") return i;
  }
  return inv;
}

/**
 * #313: a negação que não tem uma IA para nomear (o bot no Automático) diz onde faltou, sem chamar o motor de Claude Code;
 * o motivo do inventário segue depois (é o diagnóstico: "Entre na conta…", "NOD_EXECUTOR desconhecido…").
 */
export function motivoSemIaPronta(onde: "maquinas" | "maquina_do_bot", inventario: Inventario): string {
  const lugar = onde === "maquinas" ? "nenhuma IA pronta nas suas máquinas" : "nenhuma IA pronta na máquina deste bot";
  return inventario.estado !== "pronto" && inventario.motivo ? `${lugar}: ${inventario.motivo}` : lugar;
}

/**
 * NOD-171: o motivo da negação de harness indisponível, sempre do harness ESCOLHIDO e com o estado DELE, em pt-BR.
 * Nunca "motor pronto": um harness pronto só chega aqui se outra regra o recusou, e então diz só que está indisponível.
 * Sem sonda do harness não afirma "não instalado": diz só que nenhum computador conectado o tem pronto.
 */
export function motivoHarnessIndisponivel(harness: string, inventario: Inventario, modeloInvalido?: string, anexoNaoLido?: TipoAnexo): string {
  const nome = HARNESSES.find((h) => h.id === harness)?.nome ?? harness;
  if (modeloInvalido !== undefined) return `${nome}: o modelo ${modeloInvalido} não é aceito; escolha outro modelo no agente`;
  if (anexoNaoLido !== undefined) return fraseAnexoNaoLido(anexoNaoLido);
  if (inventario.estado === "pronto") return `${nome} indisponível`;
  if (inventario.estado === "ausente" && inventario.motivo === SEM_SONDA_DO_HARNESS) return `${nome} ${SEM_SONDA_DO_HARNESS}`;
  const estado = inventario.estado === "nao_autenticado" ? (inventario.causa === "limite" ? "no limite da assinatura" : "sem conta conectada")
    : inventario.causa === "cli_antigo" ? "desatualizado"
    : inventario.causa === "sem_node" ? "sem o Node"
    : inventario.causa === "config_invalida" ? "com a configuração quebrada"
    : inventario.causa === "sonda_lenta" ? "sem resposta"
    : inventario.causa === "atualizando" ? "atualizando"
    : "não instalado";
  return `${nome} ${estado}: ${inventario.motivo}`;
}

const NOME_DO_TIPO: Readonly<Record<TipoAnexo, string>> = { pdf: "PDF", imagem: "imagem", texto: "arquivo de texto" };

/** NOD-285: os nomes das IAs integradas que leem o tipo de arquivo (a web e a frase do servidor dizem quais deixar prontas). */
export function iasQueLeem(tipo: TipoAnexo): string[] {
  return HARNESSES.filter((h) => h.integrado && capacidadesDe(h.id).anexos.includes(tipo)).map((h) => h.nome);
}

/**
 * NOD-285: a frase da negação `anexo_nao_lido` (revisão do Gil no PR). Diz o que falta e o que a pessoa pode fazer, sem
 * nomear a IA que não lê: o Automático não escolheu nenhuma.
 */
export function fraseAnexoNaoLido(tipo: TipoAnexo): string {
  const leem = iasQueLeem(tipo);
  return leem.length > 0
    ? `nenhuma IA pronta agora lê ${NOME_DO_TIPO[tipo]}; deixe o ${leem.join(" ou o ")} pronto ou cole o conteúdo como texto`
    : `nenhuma IA pronta agora lê ${NOME_DO_TIPO[tipo]}; cole o conteúdo como texto`;
}

/**
 * NOD-171: a IA que o GET executor do modo compartilhado chama de "atual". Sem nenhuma pronta, a que está no Mac
 * (desatualizada ou sem login) vence um Claude ausente: senão o rodapé diria "não foi encontrada" com o Codex instalado
 * e só desatualizado.
 */
export function iaAtualDoCatalogo(catalogo: CatalogoHarness): IdHarness {
  const noMac = catalogo.opcoes.find((h) => h.integrado && ((h.inventario.estado === "ausente" && h.inventario.causa === "cli_antigo") || h.inventario.estado === "nao_autenticado"));
  return catalogo.padrao ?? noMac?.id ?? HARNESS_LEGADO;
}

/**
 * definido em 2026-10-07 (ADR-083): o que o harness sabe fazer. Toda diferença entre harnesses fora do driver passa
 * por aqui; harness desconhecido (ou ausente) não tem nenhuma capacidade.
 */
export function capacidadesDe(harness: string | null | undefined): CapacidadesHarness {
  if (!harness || !Object.hasOwn(CAPACIDADES_HARNESS, harness)) return SEM_CAPACIDADES;
  return CAPACIDADES_HARNESS[harness as IdHarness];
}

/**
 * As opções do catálogo (`catalogoHarness` na composição): cada harness com as capacidades do contrato e o inventário de
 * quem chama (o registry local ou as máquinas da pessoa, no compartilhado). A web decide anexo e pasta por `capacidades`.
 */
export function opcoesDoCatalogo(inventarioDe: (id: IdHarness) => Inventario): OpcaoHarness[] {
  return HARNESSES.map((h) => ({ ...h, capacidades: capacidadesDe(h.id), inventario: inventarioDe(h.id) }));
}
