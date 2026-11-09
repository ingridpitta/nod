import type { TipoDecisao } from "../contracts/decisao.ts";
import type { Trabalho } from "../contracts/trabalho.ts";
import { ehFrente, resumoSemChamada } from "../domain/frente.ts";
import { trabalhoFinal } from "../domain/trabalho.ts";
import type { Deps } from "./tipos.ts";

/** definido em 2026-10-12 (I2): quantas falas do trabalho ler para achar a última do bot. */
const FALAS_LIDAS = 20;

/**
 * definido em 2026-10-12 (ADR-099, I2): a frente chegou a um estado final sem ter chamado `devolver_resumo` — o servidor
 * monta o resumo com a última fala dela (cortada) e o estado, para o dono nunca receber um lote com buraco. Quem chama é
 * quem grava o estado final (sincronizarTrabalho, marcarParado), na mesma transação da dona. O resumo que a frente já
 * devolveu nunca é trocado. Módulo folha (sem importar trabalhos.ts) para não fechar ciclo de import.
 */
export async function resumoSeFaltar(deps: Pick<Deps, "repos">, t: Trabalho, o: { perguntaVencida?: boolean; vencidaTipo?: TipoDecisao } = {}): Promise<void> {
  if (!ehFrente(t) || !trabalhoFinal(t.estado) || t.resumo) return;
  const falas = await deps.repos.mensagens.doTrabalho(t.id, FALAS_LIDAS);
  const ultima = [...falas].reverse().find((m) => m.kind === "texto" && m.autoria.autor_tipo === "agente");
  await deps.repos.frentes.gravarResumo(t.id, resumoSemChamada({ estado: t.estado, ultimaFala: ultima?.texto ?? null, ...(o.perguntaVencida ? { perguntaVencida: true, vencidaTipo: o.vencidaTipo ?? null } : {}) }));
}
