/**
 * Fábricas de entrada do prompt de sistema, comuns a prompt-sistema.test.ts e prompt-referencia.test.ts (NOD-163).
 * Tudo fictício e fixo: sem Date.now, id aleatório, e-mail real ou id de produção — as referências de
 * tests/unit/domain/__prompts__/ são versionadas e lidas no diff do PR.
 */
import type { Conector } from "../../../src/contracts/conector.ts";
import type { Memoria } from "../../../src/contracts/memoria.ts";
import type { FerramentaPlano } from "../../../src/contracts/plano-turno.ts";

export const agente = { nome: "Vera", titulo: "revisora de PRs", descricao: "Revisa PRs do time nod e responde curto." };

export const f = (nome: string): FerramentaPlano => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: { type: "object" } });

/** Ferramenta de outra origem (computador, workspace) com o mesmo formato de `f`. */
export const daOrigem = (nome: string, origem: FerramentaPlano["origem"]): FerramentaPlano => ({ ...f(nome), origem });

export const mem = (id: string, texto: string, criadoEm: number): Memoria => ({ tenantId: "t", id, agenteId: "a", tipo: "preferencia", texto, origem: "pessoa", criadoEm });

/** Conector fictício com duas capacidades; `doConector` dá a ferramenta concedida dele no plano do turno. */
export const conectorTarefas: Conector = {
  tenantId: "t", id: "c-tarefas", ownerId: "p", visibility: "privado", nome: "Tarefas", slug: "tarefas", transporte: "http",
  comando: null, args: [], url: "https://tarefas.exemplo", env: {}, declaracao: "nao-toca", habilitado: true, sondadoEm: 1, ultimaFalha: null, criadoEm: 1,
  catalogo: [
    { nome: "TAREFAS_LISTAR", descricao: "lista tarefas", schema: { type: "object" }, readOnlyHint: true },
    { nome: "TAREFAS_CRIAR", descricao: "cria tarefa", schema: { type: "object" }, readOnlyHint: false },
  ],
};
export const doConector = (c: Conector, capacidade: string): FerramentaPlano => ({ ...f(`${c.slug}__${capacidade}`), origem: "conector", conectorId: c.id });
