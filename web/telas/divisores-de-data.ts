import { esc, hora } from "../lib/render.ts";

/**
 * Divisores de data entre blocos de horário (chat limpo, PR 6; plano, Parte 5; como o "Today 00:25" do Grok e o protótipo
 * F1 do Eng 1: "Hoje 15:02", "15:40", "17:20"). Puro: recebe os blocos já na ordem da tela e devolve os mesmos com os
 * divisores no meio.
 */

/**
 * definido em 2026-10-18 (decisão tomada 6 do plano do chat limpo): uma pausa de 30 min ou mais entre dois itens visíveis
 * abre um bloco novo, com divisor. A mesma pausa separa duas trocas vizinhas (`juntarTrocas`, ./linhas-do-chat.ts): na tela
 * do Eng 1, as trocas das 15:02, das 15:40 e das 17:20 ficam em três linhas, cada uma embaixo do seu divisor.
 */
export const PAUSA_QUE_ABRE_BLOCO_MS = 30 * 60_000;

/**
 * O tempo de um bloco da timeline: `id` é a primeira mensagem dele (a chave do divisor é `sep:<id>`), `em` o primeiro
 * instante que ele mostra e `ate` o último (a troca de 15:02 a 15:09, o fio com várias mensagens, os avisos recolhidos da
 * sala). `em: null` é o bloco que só leva a linha "Novas" porque a mensagem dele sumiu do chat: ele não abre nem fecha
 * bloco, e o divisor do item seguinte entra antes dele. O bloco sem `tempo` (o pedido ancorado, o cartão encolhido que
 * subiu para a fala que pediu) também não conta: fica onde está, embaixo do divisor da fala a que pertence. `instantes`
 * (QA do PR 6): cada instante que o bloco mostra, quando são vários (a troca, o fio); sem ele, só `em` e `ate`.
 */
export type TempoDoBloco = { id: string; em: number; ate: number; instantes?: readonly number[] } | { id: string; em: null };

type Bloco = { chave: string; html: string; tempo?: TempoDoBloco };

const DIA_MS = 24 * 60 * 60_000;
const doisDigitos = (n: number): string => String(n).padStart(2, "0");
const inicioDoDia = (t: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** O mesmo dia no relógio da máquina (a tela mostra HH:MM no fuso dela, `hora`). */
export function mesmoDia(a: number, b: number): boolean {
  return inicioDoDia(a) === inicioDoDia(b);
}

/** "Hoje", "Ontem", "17/10" ou, de outro ano, "17/10/2025". */
export function rotuloDoDia(em: number, agora: number): string {
  const dia = inicioDoDia(em);
  const hoje = inicioDoDia(agora);
  if (dia === hoje) return "Hoje";
  // O dia de ontem pelo calendário (o meio-dia de hoje menos 24 h cai em ontem mesmo na troca do horário de verão).
  if (dia === inicioDoDia(hoje + DIA_MS / 2 - DIA_MS)) return "Ontem";
  const d = new Date(em);
  const ano = d.getFullYear() === new Date(agora).getFullYear() ? "" : `/${d.getFullYear()}`;
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}${ano}`;
}

/**
 * O divisor: "Hoje 08:00" no topo e quando o dia muda; só "15:40" no mesmo dia do item de cima. O nome acessível
 * (`role="separator"` não lê o conteúdo) leva sempre o texto inteiro, com o dia.
 */
export function htmlDivisor(em: number, agora: number, comDia: boolean): string {
  const inteiro = `${rotuloDoDia(em, agora)} ${hora(em)}`;
  return `<div class="time-sep" role="separator" aria-label="${esc(inteiro)}">${esc(comDia ? inteiro : hora(em))}</div>`;
}

/**
 * Põe um divisor antes do primeiro item visível (o topo) e antes de cada item que vem depois de uma pausa de
 * PAUSA_QUE_ABRE_BLOCO_MS ou mais, ou num dia diferente do item de cima. Roda depois de esconder o que foi para a
 * Atividade ou é anexo (um aviso escondido não abre bloco), de juntar as trocas e de encolher os cartões: só o que está na
 * tela conta. A pausa é medida desde o último instante já mostrado (o maior `ate` até ali): a linha que desce para depois
 * da fala que a anunciou é mais antiga que a fala e não abre bloco. O `ate` de um bloco só vale até o item à vista seguinte
 * (`fimNaTela`): a troca fica na posição do pedido, e a resposta do colega pode chegar horas depois, com a conversa
 * seguindo embaixo dela. O bloco sai como entrou, menos o `tempo`: o resto (o `inicio` da troca agrupada, QA do PR 4)
 * segue para quem lê os blocos.
 */
export function comDivisores<B extends Bloco>(blocos: readonly B[], agora: number): (Omit<B, "tempo"> | { chave: string; html: string })[] {
  const saida: (Omit<B, "tempo"> | { chave: string; html: string })[] = [];
  const semTempo = ({ tempo: _tempo, ...resto }: B): Omit<B, "tempo"> => resto;
  let ultimo: number | null = null;
  // Onde começa a sequência de blocos só com a linha "Novas" logo antes do item atual (null: o anterior não é um deles).
  let inicioDasNovas: number | null = null;
  // O `em` do próximo bloco à vista, para cada posição (undefined: nada à vista depois).
  const proximoEm: (number | undefined)[] = [];
  let seguinte: number | undefined;
  for (let i = blocos.length - 1; i >= 0; i--) {
    proximoEm[i] = seguinte;
    const t = blocos[i]?.tempo;
    if (t && t.em !== null) seguinte = t.em;
  }
  for (const [i, b] of blocos.entries()) {
    const t = b.tempo;
    if (!t || t.em === null) {
      if (t?.em === null) inicioDasNovas ??= saida.length;
      else inicioDasNovas = null;
      saida.push(semTempo(b));
      continue;
    }
    // Só o que vem DEPOIS do que já está à vista abre bloco: a linha da véspera que desceu para depois da fala de hoje (o
    // turno que virou a meia-noite) não ganha um "Ontem 23:59" embaixo do "Hoje 00:02".
    const outroDia = ultimo !== null && t.em > ultimo && !mesmoDia(ultimo, t.em);
    if (ultimo === null || outroDia || t.em - ultimo >= PAUSA_QUE_ABRE_BLOCO_MS) {
      const divisor = { chave: `sep:${t.id}`, html: htmlDivisor(t.em, agora, ultimo === null || outroDia) };
      // "Novas" fica embaixo do divisor, como quando ela vem dentro do próprio bloco da mensagem.
      if (inicioDasNovas !== null) saida.splice(inicioDasNovas, 0, divisor);
      else saida.push(divisor);
    }
    inicioDasNovas = null;
    saida.push(semTempo(b));
    const fim = fimNaTela(t, proximoEm[i]);
    ultimo = ultimo === null ? fim : Math.max(ultimo, fim);
  }
  return saida;
}

/**
 * Até onde o bloco segura o bloco de horário aberto: o `ate` dele, mas, quando o item à vista seguinte vem depois do
 * começo dele e antes do fim, só o último instante que ele mostra antes desse item. A troca de 23:00 cuja resposta chegou
 * às 09:00 fica na posição das 23:00; a conversa das 23:45 e a da manhã, embaixo dela, abrem os seus divisores (senão a
 * manhã ficava sob o "Ontem 23:00"). QA do PR 6: cortar no próprio item seguinte (`min(ate, proximo)`) zerava a pausa até
 * ele, e a conversa das 23:45, 44 min depois da troca das 23:00, ficava sem divisor. O item seguinte mais antigo que o
 * começo (a linha que desceu para depois da fala) não encurta nada.
 */
function fimNaTela(t: { em: number; ate: number; instantes?: readonly number[] }, proximo: number | undefined): number {
  if (proximo === undefined || proximo < t.em || t.ate <= proximo) return t.ate;
  return Math.max(t.em, ...(t.instantes ?? []).filter((x) => x <= proximo));
}
