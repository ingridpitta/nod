import type { PayloadMensagem } from "../contracts/mensagem.ts";
import { ROTULO_DA_ACAO_MAX, rotuloFerramenta } from "./rotulo-ferramenta.ts";

/** Uma linha do resumo (o payload `acoes_do_turno`): "Leu um arquivo"; `falhou` quando o resultado voltou com erro; `vezes` (≥ 2) quando a mesma ação seguida foi juntada. */
export type AcaoDoTurno = Extract<PayloadMensagem, { kind: "acoes_do_turno" }>["acoes"][number];

/**
 * NOD-353 (definido em 2026-10-26; protótipo v2 do Gil): o resumo das ações que a fala final do bot guarda, para o
 * "Leu, escreveu e editou arquivos…" continuar depois da resposta e do recarregar. Só o rótulo no passado (o NOME da
 * ferramenta, nunca input/resultado) e se a chamada voltou com erro. A mesma ação seguida, com o mesmo desfecho, é uma
 * linha só (ler 5 arquivos em fila não vira 5 linhas iguais); a web aplica a mesma regra ao vivo (web/lib/atividade.ts).
 */
export const ACOES_DO_TURNO_MAX = 200;
export { ROTULO_DA_ACAO_MAX };

export function acoesDoTurno(ferramentas: readonly string[], falharam: readonly number[] = []): AcaoDoTurno[] {
  const comErro = new Set(falharam);
  const acoes: AcaoDoTurno[] = [];
  for (const [i, nome] of ferramentas.entries()) {
    const rotulo = rotuloFerramenta(nome).slice(0, ROTULO_DA_ACAO_MAX);
    const falhou = comErro.has(i);
    const ultima = acoes[acoes.length - 1];
    // Revisão 2 do #523: a linha juntada guarda quantas vezes rodou (5 leituras não viram "Leu um arquivo" no singular).
    if (ultima && ultima.rotulo === rotulo && (ultima.falhou === true) === falhou) { ultima.vezes = (ultima.vezes ?? 1) + 1; continue; }
    if (acoes.length >= ACOES_DO_TURNO_MAX) break;
    acoes.push(falhou ? { rotulo, falhou: true } : { rotulo });
  }
  return acoes;
}
