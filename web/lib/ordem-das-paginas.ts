/**
 * NOD-445 (ADR-146): as páginas de cada agente como o servidor as deu (`GET /agentes/:id/paginas`), com a ordem que vale
 * em todos os aparelhos. O main busca e guarda aqui; a pílula (web/telas/paginas.ts) e o web/lib/quadro-na-tela.ts leem.
 * Mover na doca muda a ordem aqui na hora (otimista) e chama `salvar` (o PUT); a resposta do servidor substitui.
 * As regras puras moram em web/lib/paginas.ts.
 */
import type { PaginasDto } from "../../src/contracts/apps.ts";
import { idsDaOrdem, ordemDasPaginas, paginasDoDto, type Pagina } from "./paginas.ts";

const doServidor = new Map<string, PaginasDto>();
let salvar: ((agenteId: string, ids: string[]) => void) | null = null;

/** O main liga aqui o PUT da ordem. */
export function aoGuardarOrdem(f: ((agenteId: string, ids: string[]) => void) | null): void {
  salvar = f;
}

/** Guarda o que o servidor deu e devolve os apps que chegaram desde a última leitura (na primeira, nenhum). */
export function definirPaginas(dto: PaginasDto): string[] {
  const antes = doServidor.get(dto.agenteId);
  doServidor.set(dto.agenteId, dto);
  if (!antes) return [];
  const tinha = new Set(antes.apps.map((a) => a.id));
  return dto.apps.filter((a) => !tinha.has(a.id)).map((a) => a.id);
}

export function paginasDtoDe(agenteId: string | null | undefined): PaginasDto | undefined {
  return agenteId ? doServidor.get(agenteId) : undefined;
}

/** As páginas do agente (ordem de dentro). Sem resposta ainda, só a conversa. */
export function paginasDoAgente(agenteId: string | null | undefined, o: { tarefasPedem?: boolean } = {}): Pagina[] {
  return paginasDoDto(paginasDtoDe(agenteId), o);
}

/** A ordem de exibição do agente (índices das páginas). Sem agente ou sem resposta, a de sempre. */
export function ordemDoAgente(agenteId: string | null | undefined, paginas: readonly Pagina[]): number[] {
  const dto = paginasDtoDe(agenteId);
  return dto ? ordemDasPaginas(paginas, dto.ordem) : paginas.map((_, i) => i);
}

/** Guarda a ordem nova (na hora, aqui) e pede ao servidor. */
export function guardarOrdem(agenteId: string, paginas: readonly Pagina[], ordem: readonly number[]): void {
  const ids = idsDaOrdem(paginas, ordem);
  const dto = doServidor.get(agenteId);
  if (dto) doServidor.set(agenteId, { ...dto, ordem: ids });
  salvar?.(agenteId, ids);
}

/** Só para os testes. */
export function esquecerPaginas(): void {
  doServidor.clear();
  salvar = null;
}
