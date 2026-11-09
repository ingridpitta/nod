import { COMANDO_ESPERA_MAX, MOTIVO_ESPERA_MAX } from "../contracts/ferramentas-trabalho.ts";
import { esperaEmLaco, type EsperaEmLaco } from "./espera-em-laco.ts";
import { MAX_QUEDAS_POR_PEDIDO } from "./pedido-parado.ts";

/**
 * Regras puras do `esperar_comando` (definido em 2026-10-12, ADR-099 item 4, parte 2). Quem lê o banco e grava é o caso de
 * uso (src/use-cases/esperar-comando.ts); quem roda o comando é o motor da máquina (src/adapters/executor/esperas.ts).
 *
 * Em 11/10, 11 tasks do Ze 1 esperavam a mesma CI do GitHub acordando por horário: 67 voltas, cerca de US$ 114, nenhuma
 * com novidade. Com um comando que só sai quando a CI acaba (`gh pr checks 845 --watch`), o bot volta uma vez, quando há
 * fato novo.
 */

/** definido em 2026-10-12: o comando é uma linha de shell, não um script (CHECKs espera_comando/espera_motivo da 0070). */
export { COMANDO_ESPERA_MAX, MOTIVO_ESPERA_MAX };
/** definido em 2026-10-12: as últimas linhas da saída, até 4 KB (CHECK espera_saida da 0070) — o que diz por que a CI falhou. */
export const SAIDA_ESPERA_MAX = 4_096;
/**
 * definido em 2026-10-12 (decisão a confirmar com o Marlon): a máquina que não deu notícia (o puxar das esperas, a cada
 * 5 s) por 30 min derruba a espera. Cobre a VM que travou ~20 min sem memória em 11/10 sem acordar o bot à toa; o Mac com
 * a tampa fechada mais que isso acorda o bot com "a espera caiu", e a volta só roda quando o Mac voltar (a sessão é dele).
 */
export const ESPERA_SEM_CONTATO_MS = 30 * 60_000;
/**
 * definido em 2026-10-12: a espera que nenhuma máquina pegou em 3 min cai. O motor puxa a cada 5 s; o que sobra é o app
 * antigo, que não conhece esperas — o bot acorda dizendo isso e segue com me_chame_as.
 */
export const ESPERA_SEM_INICIO_MS = 3 * 60_000;
/** As quedas (o motor relançou o comando) toleradas antes de desistir: a mesma conta da ADR-084. */
export const MAX_QUEDAS_ESPERA = MAX_QUEDAS_POR_PEDIDO;

export type PedidoEspera = { comando: string; motivo: string };
export type RecusaEspera = { erro: "comando_vazio" | "comando_longo" | "motivo_vazio" | "multilinha" | "laco_com_sleep"; espera?: EsperaEmLaco };

/**
 * O pedido bem formado: uma linha só (o comando que sai quando a espera acaba, não um script), dentro dos tetos, e sem o
 * laço com sleep ou o sleep longo da ADR-089 — o motor rodaria o mesmo desperdício, só que fora do CLI. `gh pr checks
 * --watch`, `gh run watch` e `kubectl rollout status` não têm sleep: passam.
 */
export function validarPedidoEspera(p: PedidoEspera): { ok: true; pedido: PedidoEspera } | ({ ok: false } & RecusaEspera) {
  const comando = p.comando.trim();
  const motivo = p.motivo.trim().replace(/\s+/g, " ").slice(0, MOTIVO_ESPERA_MAX);
  if (comando === "") return { ok: false, erro: "comando_vazio" };
  if (comando.length > COMANDO_ESPERA_MAX) return { ok: false, erro: "comando_longo" };
  if (motivo === "") return { ok: false, erro: "motivo_vazio" };
  if (/[\r\n]/.test(comando)) return { ok: false, erro: "multilinha" };
  const espera = esperaEmLaco(comando);
  if (espera) return { ok: false, erro: "laco_com_sleep", espera };
  return { ok: true, pedido: { comando, motivo } };
}

/** A instrução que o bot lê na recusa do pedido (o caso de uso junta as do servidor: aprovação, task fechada…). */
export function instrucaoDaRecusa(r: RecusaEspera): string {
  switch (r.erro) {
    case "comando_vazio": return "Diga o comando que termina quando a espera acabar (ex.: gh pr checks 845 --watch -R dono/repo).";
    case "comando_longo": return `O comando passa de ${COMANDO_ESPERA_MAX} caracteres. Use um comando curto que só termina quando a espera acabar.`;
    case "motivo_vazio": return "Diga em uma frase o que você está esperando (ex.: \"a CI do PR #845\").";
    case "multilinha": return "Use um comando de uma linha só, que termina quando a espera acabar (ex.: gh run watch 123 -R dono/repo). Não mande um script.";
    case "laco_com_sleep": return "Não use laço com sleep nem sleep longo: o Nod rodaria o mesmo desperdício. Use um comando que acompanha e só sai quando acabar, como gh pr checks <n> --watch, gh run watch <id> ou kubectl rollout status. Se não houver comando assim, use me_chame_as.";
  }
}

/** O texto mais recente da saída, até `max` caracteres, começando numa linha inteira quando dá. */
export function ultimasLinhas(texto: string, max: number = SAIDA_ESPERA_MAX): string {
  const limpo = texto.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (limpo.length <= max) return limpo;
  const cauda = limpo.slice(limpo.length - max);
  const quebra = cauda.indexOf("\n");
  return quebra >= 0 && quebra < cauda.length - 1 ? cauda.slice(quebra + 1) : cauda;
}

/**
 * Uma queda é o motor relançando o comando (a máquina reiniciou no meio). Na MAX_QUEDAS_ESPERA-ésima o Nod desiste e
 * acorda o bot dizendo que caiu essas vezes — esperar de novo sozinho é o mesmo laço sem fato novo (ADR-099 item 5).
 */
export function decidirQuedaDaEspera(quedasAntes: number): { tipo: "relancar"; quedas: number } | { tipo: "desistir"; quedas: number } {
  const quedas = quedasAntes + 1;
  return quedas >= MAX_QUEDAS_ESPERA ? { tipo: "desistir", quedas } : { tipo: "relancar", quedas };
}

/** A máquina sumiu? Nunca deu notícia em ESPERA_SEM_INICIO_MS, ou parou de dar por ESPERA_SEM_CONTATO_MS. */
export function esperaSemNoticia(p: { criadoEm: number; vistoEm: number | null; agora: number }): "sem_inicio" | "sem_contato" | null {
  if (p.vistoEm === null) return p.agora - p.criadoEm >= ESPERA_SEM_INICIO_MS ? "sem_inicio" : null;
  return p.agora - p.vistoEm >= ESPERA_SEM_CONTATO_MS ? "sem_contato" : null;
}

/** Por que a espera caiu, na frase que vai em `motivo_fim` e na volta do bot. */
export const MOTIVO_QUEDA_ESPERA = {
  sem_inicio: "a máquina deste trabalho não começou o comando (o app dela pode ser anterior às esperas)",
  sem_contato: "a máquina deste trabalho ficou mais de 30 min sem dar notícia",
  pasta_ausente: "a pasta deste trabalho não existe mais na máquina",
  nao_iniciou: "o comando não conseguiu começar na máquina",
  quedas: `a máquina caiu ${MAX_QUEDAS_ESPERA} vezes no meio da espera`,
} as const;
export type CausaQuedaEspera = keyof typeof MOTIVO_QUEDA_ESPERA;

/** A saída num bloco que o modelo lê como dado: três crases dentro dela viram aspas simples, para não fechar o bloco. */
function blocoDeSaida(saida: string): string {
  const s = saida.replace(/```/g, "'''").trim();
  return s === "" ? "(sem saída)" : `\`\`\`\n${s}\n\`\`\``;
}

/**
 * A entrada da volta (o turno que retoma o de origem). Terminou: código e últimas linhas, e siga de onde parou. Caiu: o
 * motivo; na queda repetida, parar e perguntar à pessoa (ADR-099 item 5) em vez de esperar de novo.
 */
export function fraseDaVolta(e: { estado: "terminou" | "caiu"; comando: string; motivo: string; codigo?: number | null; saida?: string | null; causa?: CausaQuedaEspera }): string {
  if (e.estado === "terminou") {
    const codigo = e.codigo === null || e.codigo === undefined ? "sem código: foi encerrado por sinal" : `código ${e.codigo}`;
    return `[nod] O comando que você esperava terminou (${codigo}): ${e.motivo}\n$ ${e.comando}\nÚltimas linhas da saída:\n${blocoDeSaida(e.saida ?? "")}\nConfira e siga de onde parou. Se ainda não acabou, chame esperar_comando de novo e encerre o turno.`;
  }
  const porque = MOTIVO_QUEDA_ESPERA[e.causa ?? "sem_contato"];
  if (e.causa === "quedas") {
    return `[nod] A espera caiu ${MAX_QUEDAS_ESPERA} vezes (${porque}): ${e.motivo}\n$ ${e.comando}\nNão espere de novo sozinho: confira o estado agora uma vez, diga à pessoa o que está esperando e pergunte como seguir.`;
  }
  return `[nod] A espera caiu: ${porque}. Você esperava: ${e.motivo}\n$ ${e.comando}\nConfira o estado agora. Se ainda precisar esperar, chame esperar_comando de novo e encerre o turno.`;
}
