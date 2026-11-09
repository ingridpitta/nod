import type { EntradaDiario, Memoria, PaginaDiario, TipoMemoria } from "../contracts/memoria.ts";
import type { Agente } from "../contracts/agente.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

const TIPOS: readonly TipoMemoria[] = ["preferencia", "fato", "resumo"];
/** Para a API: sem os campos internos do desfazer (origem e data da memória). */
const entradaPublica = <E extends EntradaDiario>(e: E): EntradaDiario => {
  const { id, agenteId, memoriaId, acao, autor, antes, depois, desfazId, desfeitaEm, revisadaEm, criadoEm } = e;
  return { id, agenteId, memoriaId, acao, autor, antes, depois, desfazId, desfeitaEm, revisadaEm, criadoEm };
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** NOD-58: o diário é só da dona do bot. Bot de outra pessoa (mesmo visível na equipe) responde como inexistente. */
async function botDaDona(deps: Deps, agenteId: string): Promise<Agente> {
  const agente = await deps.repos.agentes.buscar(agenteId);
  if (!agente || agente.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado");
  return agente;
}

/** Memória editável pela pessoa (Grok Bot): listar, editar texto/tipo, apagar. Sempre pela dona (repositório filtra owner_id). */
export const listarMemorias: CasoDeUso<{ agenteId: string }, { memorias: Memoria[]; aRevisar: number }> = async (deps, input) => {
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado");
  const aRevisar = agente.ownerId === deps.escopo.pessoaId ? await deps.repos.memoriasDiario.contarARevisar(agente.id) : 0;
  return { data: { memorias: await deps.repos.memorias.listarDoAgente(agente.id), aRevisar } };
};

export const editarMemoria: CasoDeUso<{ memoriaId: string; texto?: string; tipo?: TipoMemoria }, { memoria: Memoria }> = async (deps, input) => {
  const campos: { texto?: string; tipo?: TipoMemoria } = {};
  if (input.texto !== undefined) {
    if (typeof input.texto !== "string" || input.texto.trim() === "") throw new ErroDeDominio("texto_vazio");
    campos.texto = input.texto.trim();
  }
  if (input.tipo !== undefined) {
    if (!TIPOS.includes(input.tipo)) throw new ErroDeDominio("entrada_invalida", { cause: "tipo" });
    campos.tipo = input.tipo;
  }
  if (campos.texto === undefined && campos.tipo === undefined) throw new ErroDeDominio("entrada_invalida", { cause: "nada a editar" });
  await deps.repos.memorias.travar(input.memoriaId);
  const existente = await deps.repos.memorias.buscar(input.memoriaId);
  if (!existente) throw new ErroDeDominio("nao_encontrado");
  const memoria = await deps.repos.memorias.atualizar(input.memoriaId, campos, { autor: "pessoa" });
  if (!memoria) throw new ErroDeDominio("nao_permitido");
  const agora = deps.agora();
  return {
    data: { memoria },
    events: [evento(deps.escopo, { kind: "agente_atualizado", autoria: autoriaPessoa(deps.escopo), agora, dados: { agente_id: memoria.agenteId, acao: "memoria_editada", memoria_id: memoria.id } })],
  };
};

export const apagarMemoria: CasoDeUso<{ memoriaId: string }, { apagada: true; agenteId: string }> = async (deps, input) => {
  await deps.repos.memorias.travar(input.memoriaId);
  const existente = await deps.repos.memorias.buscar(input.memoriaId);
  if (!existente) throw new ErroDeDominio("nao_encontrado");
  const apagada = await deps.repos.memorias.apagar(input.memoriaId, { autor: "pessoa" });
  if (!apagada) throw new ErroDeDominio("nao_permitido");
  const agora = deps.agora();
  return {
    data: { apagada: true, agenteId: existente.agenteId },
    events: [evento(deps.escopo, { kind: "agente_atualizado", autoria: autoriaPessoa(deps.escopo), agora, dados: { agente_id: existente.agenteId, acao: "memoria_apagada", memoria_id: existente.id } })],
  };
};

/** NOD-58: o histórico da memória do bot, 50 por página, mais novas primeiro, com o contador do que falta revisar. */
export const listarDiarioMemoria: CasoDeUso<{ agenteId: string; antes?: string | null }, PaginaDiario> = async (deps, input) => {
  const agente = await botDaDona(deps, input.agenteId);
  if (input.antes && !UUID.test(input.antes)) throw new ErroDeDominio("entrada_invalida", { cause: "antes" });
  const { entradas, mais } = await deps.repos.memoriasDiario.listar(agente.id, input.antes ?? null);
  const aRevisar = await deps.repos.memoriasDiario.contarARevisar(agente.id);
  return { data: { entradas: entradas.map(entradaPublica), aRevisar, mais } };
};

const mesmo = (m: Memoria | null, v: { tipo: TipoMemoria; texto: string } | null): boolean =>
  m !== null && v !== null && m.tipo === v.tipo && m.texto === v.texto;

/**
 * NOD-58: desfaz uma entrada do diário. Só a dona; só a entrada MAIS NOVA da memória e só se a memória está como a
 * entrada a deixou (sem merge). Criada → apaga; editada → volta texto e tipo; apagada → recria com o mesmo id, tipo,
 * texto, origem e data. O desfazer vira entrada nova (desfaz_id) e a original fica desfeita (e revisada).
 * A trava da memória vem ANTES das checagens: dois desfazer, ou desfazer e edição, não se cruzam; o segundo vê a
 * entrada nova e recebe 409 `mudou_depois`, sem mudar nada.
 */
export const desfazerEntradaDiario: CasoDeUso<{ agenteId: string; entradaId: string }, { entrada: EntradaDiario; memoria: Memoria | null; aRevisar: number }> = async (deps, input) => {
  const agente = await botDaDona(deps, input.agenteId);
  if (!UUID.test(input.entradaId)) throw new ErroDeDominio("nao_encontrado");
  const achada = await deps.repos.memoriasDiario.buscar(agente.id, input.entradaId);
  if (!achada) throw new ErroDeDominio("nao_encontrado");
  await deps.repos.memorias.travar(achada.memoriaId);
  const entrada = await deps.repos.memoriasDiario.buscar(agente.id, input.entradaId);
  if (!entrada || entrada.desfeitaEm !== null) throw new ErroDeDominio("mudou_depois", { cause: "já desfeita" });
  // Sem Refazer (decisão do protótipo): a entrada que desfaz não se desfaz.
  if (entrada.desfazId !== null) throw new ErroDeDominio("estado_invalido", { cause: "entrada de desfazer" });
  const ultima = await deps.repos.memoriasDiario.ultimaDaMemoria(entrada.memoriaId);
  if (ultima?.id !== entrada.id) throw new ErroDeDominio("mudou_depois", { cause: "há mudança mais nova" });
  const atual = await deps.repos.memorias.buscar(entrada.memoriaId);
  const bate = entrada.acao === "apagada" ? atual === null : mesmo(atual, entrada.depois);
  if (!bate) throw new ErroDeDominio("mudou_depois", { cause: "estado não bate" });

  const op = { autor: "pessoa" as const, desfazId: entrada.id };
  let memoria: Memoria | null = null;
  if (entrada.acao === "criada") {
    if (!(await deps.repos.memorias.apagar(entrada.memoriaId, op))) throw new ErroDeDominio("mudou_depois");
  } else if (entrada.acao === "editada" && entrada.antes) {
    memoria = await deps.repos.memorias.atualizar(entrada.memoriaId, { texto: entrada.antes.texto, tipo: entrada.antes.tipo }, op);
    if (!memoria) throw new ErroDeDominio("mudou_depois");
  } else if (entrada.acao === "apagada" && entrada.antes) {
    memoria = await deps.repos.memorias.criar(
      { id: entrada.memoriaId, agenteId: agente.id, tipo: entrada.antes.tipo, texto: entrada.antes.texto, origem: entrada.memoriaOrigem, criadoEm: entrada.memoriaCriadoEm },
      op,
    );
    if (!memoria) throw new ErroDeDominio("mudou_depois");
  } else {
    throw new ErroDeDominio("estado_invalido", { cause: "entrada sem antes" });
  }
  await deps.repos.memoriasDiario.marcarDesfeita(entrada.id);
  const nova = await deps.repos.memoriasDiario.ultimaDaMemoria(entrada.memoriaId);
  if (!nova || nova.desfazId !== entrada.id) throw new ErroDeDominio("estado_invalido", { cause: "desfazer sem entrada" });
  const aRevisar = await deps.repos.memoriasDiario.contarARevisar(agente.id);
  const agora = deps.agora();
  return {
    data: { entrada: entradaPublica(nova), memoria, aRevisar },
    events: [evento(deps.escopo, { kind: "agente_atualizado", autoria: autoriaPessoa(deps.escopo), agora, dados: { agente_id: agente.id, acao: "memoria_desfeita", memoria_id: entrada.memoriaId, entrada_id: entrada.id } })],
  };
};

/** NOD-58: marca como revisadas as mudanças do bot, uma (`entradaId`) ou todas. As da pessoa nunca contam. */
export const revisarDiarioMemoria: CasoDeUso<{ agenteId: string; entradaId?: string | null }, { revisadas: number; aRevisar: number }> = async (deps, input) => {
  const agente = await botDaDona(deps, input.agenteId);
  if (input.entradaId && !UUID.test(input.entradaId)) throw new ErroDeDominio("nao_encontrado");
  if (input.entradaId && !(await deps.repos.memoriasDiario.buscar(agente.id, input.entradaId))) throw new ErroDeDominio("nao_encontrado");
  const revisadas = await deps.repos.memoriasDiario.revisar(agente.id, input.entradaId ?? null);
  const aRevisar = await deps.repos.memoriasDiario.contarARevisar(agente.id);
  // O contador das outras abas e aparelhos acompanha (o reducer relê em qualquer `memoria_*`).
  const events = revisadas > 0 ? [evento(deps.escopo, { kind: "agente_atualizado", autoria: autoriaPessoa(deps.escopo), agora: deps.agora(), dados: { agente_id: agente.id, acao: "memoria_revisada" } })] : [];
  return { data: { revisadas, aRevisar }, events };
};
