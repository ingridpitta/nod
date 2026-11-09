import type { DefinicaoAcao } from "../../contracts/acoes.ts";
import { PROPRIEDADES_TIMES as P } from "../../contracts/ferramentas-times.ts";
import type { JsonSchema } from "../../contracts/json-schema.ts";

/**
 * As ações dos times de bots (definido em 2026-11-02, NOD-437, ADR-135). Todas `vivo`: a rota da tela
 * (src/adapters/http/rotas/times.ts) e o gerir_times de QUALQUER bot chamam o mesmo executor (src/use-cases/acoes/times.ts),
 * e o teste de contrato (tests/integration/paridade-times.test.ts) leva os dois ao mesmo estado no banco. Mover bots entre
 * times é o bots.mover de sempre (a tela em lote, o gerir_times também).
 *
 * Risco "muda" (aplica direto em todo modo: só reorganiza a barra e se desfaz pela tela ou pedindo de novo). Excluir é
 * "arriscada" (emenda NOD-437 da ADR-135): com bots, vira card no manual e no automático e roda direto só no "Ignorar
 * todas as aprovações"; time vazio sai direto (não há o que desfazer além do nome). O gerir_bots não o aceita.
 */

const objeto = (properties: Record<string, JsonSchema>, required: readonly string[]): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
const VIA = { ferramenta: "gerir_times" } as const;
const CONTRATO = "tests/integration/paridade-times.test.ts";
const vivo = { estado: "vivo", via: VIA, contrato: CONTRATO } as const;

export const ACOES_TIMES = [
  { id: "times.criar", titulo: "Criar um time de bots (no lugar pedido, já com bots)", schema: objeto({ time: P.time, posicao: P.posicao, recolhido: P.recolhido, bots: P.bots }, ["time"]), risco: "muda", cartaoNoChat: false, chat: vivo, casoDeUso: "times.criar" },
  { id: "times.renomear", titulo: "Renomear um time", schema: objeto({ time: P.time, nome: P.nome }, ["time", "nome"]), risco: "muda", cartaoNoChat: false, chat: vivo, casoDeUso: "times.renomear" },
  {
    id: "times.excluir",
    titulo: "Excluir um time (os bots vão para Sem time)",
    schema: objeto({ time: P.time }, ["time"]),
    risco: "arriscada",
    cartaoNoChat: true,
    chat: { estado: "vivo", via: { ferramenta: "gerir_times", tipoNoLote: "excluir_time" }, contrato: CONTRATO },
    casoDeUso: "times.excluir",
    lote: { tipo: "excluir_time" },
  },
  { id: "times.ordenar", titulo: "Mudar um time de lugar na barra", schema: objeto({ time: P.time, posicao: P.posicao }, ["time", "posicao"]), risco: "muda", cartaoNoChat: false, chat: vivo, casoDeUso: "times.ordenar" },
  { id: "times.recolher", titulo: "Recolher ou abrir um time", schema: objeto({ time: P.time, recolhido: P.recolhido }, ["time", "recolhido"]), risco: "muda", cartaoNoChat: false, chat: vivo, casoDeUso: "times.recolher" },
] as const satisfies readonly DefinicaoAcao[];
