import type { IdAcao } from "../../domain/acoes/index.ts";
import { exibirDoQuadro } from "../raio-x.ts";
import { desfazerLeitura, marcarConversaLida, marcarConversaNaoLida, marcarTudoLido } from "../nao-lidos.ts";
import type { CasoDeUso } from "../tipos.ts";

/**
 * Os executores únicos da leitura das conversas (definido em 2026-11-01, NOD-449, ADR-135): a rota da tela Não lidos e a
 * ferramenta nao_lidos de QUALQUER bot chamam os mesmos casos de uso, e o teste de contrato
 * (tests/integration/paridade-nao-lidos.test.ts) leva os dois ao mesmo "lido até".
 */
export const EXECUTORES_CONVERSA = {
  "conversas.marcar_lida": marcarConversaLida,
  "conversas.marcar_nao_lida": marcarConversaNaoLida,
  "conversas.marcar_tudo_lido": marcarTudoLido,
  "conversas.desfazer_leitura": desfazerLeitura,
  // ADA-18: o PUT /preferencias/quadros/:id/exibir e a op exibir do gerir_quadro.
  "preferencias.exibir_quadro": exibirDoQuadro,
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;
