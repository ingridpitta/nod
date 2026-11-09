import type { Mensagem } from "../contracts/mensagem.ts";
import type { TrabalhoDetalheDto } from "../contracts/trabalho.ts";
import type { Turno } from "../contracts/turno.ts";
import { ehVoltaDoFundo } from "./cota-da-ia.ts";
import { INICIO_FALA_NA_FRENTE } from "./mensagem-no-meio.ts";

export type FalaNaFila = NonNullable<TrabalhoDetalheDto["falasNaFila"]>[number];
type TurnoDaFala = Pick<Turno, "id" | "estado" | "motivoInterrupcao" | "absorvidoPor" | "mensagemOrigemId" | "entradaTexto" | "retomaTurnoId" | "criadoEm">;

/**
 * NOD-376 (revisão 3 do PR #539, definido em 2026-10-27): a marca (`turnos.decidido_por`, como RETORNO_DO_LOTE) do turno da fala da pessoa numa
 * frente que já tinha acabado — a frente reabre só para conversar. Marca no banco, não no texto da moldura.
 */
export const FALA_DEPOIS_DO_FIM = "regra:fala-depois-do-fim";

/**
 * A frente está numa conversa depois do fim: depois do último turno marcado só vieram outros marcados (as falas
 * seguintes dela) e voltas do fundo (cota, erro passageiro, queda). Um recado do bot, uma retomada de decisão ou um
 * pedido novo é trabalho de verdade e desfaz a conversa (aí a frente volta ao dono como antes). `turnos` na ordem.
 */
export function conversaDepoisDoFim(turnos: readonly Pick<Turno, "decididoPor" | "entradaTexto">[]): boolean {
  let i = turnos.length - 1;
  while (i >= 0 && turnos[i]!.decididoPor !== FALA_DEPOIS_DO_FIM) i--;
  return i >= 0 && turnos.slice(i + 1).every((t) => t.decididoPor === FALA_DEPOIS_DO_FIM || ehVoltaDoFundo(t.entradaTexto));
}
type MensagemDaFala = Pick<Mensagem, "id" | "turnoId" | "criadoEm" | "autoria" | "kind" | "texto">;

/**
 * NOD-376: onde está a fala que a pessoa escreveu na tela da frente. `na_fila` = o turno do recado ainda espera (a
 * renovação do turno vivo a oferece no próximo passo, ou a frente volta para respondê-la); `entregue` = já entrou na
 * sessão do turno vivo (absorvida) e o bot ainda não falou depois dela; `lendo` = a fala reabriu a frente e o turno dela roda. Sem situação: o
 * bot já respondeu, ou o turno que a leu acabou (a tela não promete uma resposta que não vem). Só a fala da barra da
 * frente (a entrada com a moldura dela): o pedido que abriu a frente (a fala da rede) não ganha chip.
 */
export function situacaoDasFalasNaFrente(turnos: readonly TurnoDaFala[], mensagens: readonly MensagemDaFala[]): FalaNaFila[] {
  const porId = new Map(turnos.map((t) => [t.id, t]));
  const daFala = new Map(turnos.filter((t) => t.mensagemOrigemId && t.entradaTexto.startsWith(INICIO_FALA_NA_FRENTE)).map((t) => [t.mensagemOrigemId!, t]));
  // Resposta = fala de texto do bot no turno que a leu, depois dela (a linha de sistema, o card e o artefato não contam).
  // O turno cortado (cota, erro passageiro, queda) segue na volta do fundo dele: a fala ainda vai ser respondida.
  // Revisão 6 do PR #539 (definido em 2026-10-27): a volta aponta para a raiz da retomada (`retomaTurnoId ?? id`, como
  // assentar-turno e interromper-por-maquina a criam), não para o turno cortado — é a primeira volta do fundo da mesma
  // raiz criada depois dele; a da fala leva o texto dela (a volta de outro corte da frente não conta).
  const respondeu = (turnoId: string, desde: number) => mensagens.some((m) => m.turnoId === turnoId && m.autoria.autor_tipo !== "pessoa" && m.kind === "texto" && m.texto.trim() !== "" && m.criadoEm > desde);
  // Revisão 8 (definido em 2026-10-27): o bot que respondeu em qualquer turno da cadeia (antes de um corte) já respondeu — sem chip.
  const vivoDaCadeia = (inicio: TurnoDaFala | undefined, desde: number): TurnoDaFala | undefined => {
    const fala = inicio?.entradaTexto.startsWith(INICIO_FALA_NA_FRENTE) ? inicio.entradaTexto : null;
    let t = inicio;
    for (let saltos = 0; t; saltos++) {
      if (respondeu(t.id, desde)) return undefined;
      if (t.estado !== "interrompido" || t.motivoInterrupcao === "absorvido" || saltos >= 10) return t;
      const atual: TurnoDaFala = t;
      const raiz = atual.retomaTurnoId ?? atual.id;
      const volta = turnos
        .filter((x) => x.id !== atual.id && x.retomaTurnoId === raiz && x.criadoEm >= atual.criadoEm && ehVoltaDoFundo(x.entradaTexto) && (fala === null || x.entradaTexto.includes(fala)))
        .sort((a, b) => a.criadoEm - b.criadoEm)[0];
      if (!volta) return t;
      t = volta;
    }
    return t;
  };
  const falas: FalaNaFila[] = [];
  for (const m of mensagens) {
    if (m.autoria.autor_tipo !== "pessoa") continue;
    const t = vivoDaCadeia(daFala.get(m.id), m.criadoEm);
    if (!t) continue;
    if (t.estado === "pendente") {
      falas.push({ mensagemId: m.id, situacao: "na_fila" });
      continue;
    }
    // A frente reaberta pela fala: o turno dela roda com ela na entrada — o bot já está lendo.
    if (t.estado === "despachando") {
      if (!respondeu(t.id, m.criadoEm)) falas.push({ mensagemId: m.id, situacao: "lendo" });
      continue;
    }
    // Absorvida pelo turno vivo: entrou na sessão, e o bot a lê na próxima fronteira (o fim do passo atual).
    const leitor = vivoDaCadeia(t.estado === "interrompido" && t.motivoInterrupcao === "absorvido" && t.absorvidoPor ? porId.get(t.absorvidoPor) : undefined, m.criadoEm);
    if (leitor?.estado === "pendente") falas.push({ mensagemId: m.id, situacao: "na_fila" }); // o leitor cortado espera a volta dele
    else if (leitor?.estado === "despachando" && !respondeu(leitor.id, m.criadoEm)) falas.push({ mensagemId: m.id, situacao: "entregue" });
  }
  return falas;
}

/**
 * NOD-376 (revisões 7 e 8 do PR #539, definido em 2026-10-27): as falas da pessoa que o turno ainda não respondeu (sem
 * fala de texto dele depois delas), na ordem — a dele próprio (o turno da fala) e as que ele absorveu. Se esse turno é
 * cortado (cota, erro passageiro, queda), a volta do fundo as leva com o rótulo da fala; a já respondida não volta.
 */
export function falasSemRespostaDoTurno(turno: TurnoDaFala, turnos: readonly TurnoDaFala[], mensagens: readonly MensagemDaFala[]): string[] {
  const daPessoa = new Map(mensagens.filter((m) => m.autoria.autor_tipo === "pessoa").map((m) => [m.id, m]));
  const respondeu = (desde: number) => mensagens.some((m) => m.turnoId === turno.id && m.autoria.autor_tipo !== "pessoa" && m.kind === "texto" && m.texto.trim() !== "" && m.criadoEm > desde);
  const semResposta = (t: TurnoDaFala) => {
    const m = t.mensagemOrigemId ? daPessoa.get(t.mensagemOrigemId) : undefined;
    return t.entradaTexto.startsWith(INICIO_FALA_NA_FRENTE) && m !== undefined && !respondeu(m.criadoEm);
  };
  const absorvidas = turnos.filter((t) => t.absorvidoPor === turno.id && t.motivoInterrupcao === "absorvido" && semResposta(t));
  return [...(semResposta(turno) ? [turno] : []), ...absorvidas].map((t) => t.entradaTexto);
}

/** Revisão 8: o turno falou (texto) — a fala que a volta anterior levava já foi respondida nele. */
export function turnoFalou(turnoId: string, mensagens: readonly MensagemDaFala[]): boolean {
  return mensagens.some((m) => m.turnoId === turnoId && m.autoria.autor_tipo !== "pessoa" && m.kind === "texto" && m.texto.trim() !== "");
}
