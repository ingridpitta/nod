import type { ItemDeAtividade } from "../../src/contracts/atividade.ts";
import type { EventoLinha } from "../../src/contracts/trabalho.ts";
import type { ExportarCsv, FiltroDecisoes } from "./decisoes-do-bot.ts";

/**
 * A Atividade do bot na tela (definido em 2026-10-18, chat limpo, PR 2; ADR-114): tudo o que saiu do chat, um dia por vez,
 * num nível da gaveta. Aqui só o que é puro — o dia e o fuso da pessoa, o filtro e a telemetria do gatilho de reversão. O
 * HTML mora em web/telas/atividade.ts; a lista vem pronta do servidor (`GET agentes/:id/atividade`), com título e detalhe
 * na redação de hoje.
 */

/**
 * Os filtros da tela "Atividade aberta no drawer": item sem categoria só aparece em "Tudo". "Sem aprovação" (PR 6 dos
 * modos de aprovação, tela Y3) logo depois de "Tudo": o que o modo rodou sem a pessoa — é para onde "ver na Atividade"
 * da linha embaixo da fala leva.
 */
export type FiltroAtividade = "tudo" | "sem_aprovacao" | "frentes" | "bloqueios" | "maquina_ia";

export const FILTROS_DA_ATIVIDADE: readonly { filtro: FiltroAtividade; rotulo: string }[] = [
  { filtro: "tudo", rotulo: "Tudo" },
  { filtro: "sem_aprovacao", rotulo: "Sem aprovação" },
  { filtro: "frentes", rotulo: "Frentes" },
  { filtro: "bloqueios", rotulo: "Bloqueios" },
  { filtro: "maquina_ia", rotulo: "Máquina e IA" },
];

/**
 * O que a gaveta mostra da Atividade: de que bot, que dia, que filtro e que mensagem está aberta (o texto inteiro). NOD-70:
 * a aba (Atividade | Decisões, o dia é o mesmo nas duas), o filtro das Decisões, a decisão aberta e o Exportar CSV.
 */
export type VistaDaAtividade = {
  agenteId: string;
  dia: string;
  filtro: FiltroAtividade;
  aberta: string | null;
  aba: AbaDaAtividade;
  desfecho: FiltroDecisoes;
  decisao: string | null;
  exportar: ExportarCsv | null;
};

export type AbaDaAtividade = "atividade" | "decisoes";

/** A vista de quem acaba de abrir a Atividade: hoje, aba Atividade, tudo. */
export function vistaInicial(agenteId: string, dia: string): VistaDaAtividade {
  return { agenteId, dia, filtro: "tudo", aberta: null, aba: "atividade", desfecho: "tudo", decisao: null, exportar: null };
}

const dois = (n: number): string => String(n).padStart(2, "0");

/** 'AAAA-MM-DD' do instante no relógio da pessoa (o fuso da máquina, como o resto da tela). */
export function diaLocal(instante: number): string {
  const d = new Date(instante);
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/** O dia seguinte, no calendário (aritmética de data, sem fuso). */
export function diaSeguinte(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1)).toISOString().slice(0, 10);
}

/** O mesmo validador do servidor (GET trilha e GET atividade): fuso IANA nomeado ou UTC. Fora disso, UTC. */
const FUSO = /^[A-Za-z_]+\/[A-Za-z_/+-]+$|^UTC$/;

/** O fuso da pessoa para a rota (o servidor recorta o dia nele). */
export function fusoLocal(intl: () => string = () => Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  try {
    const fuso = intl();
    return FUSO.test(fuso) ? fuso : "UTC";
  } catch {
    return "UTC";
  }
}

export const chaveDaAtividade = (agenteId: string, dia: string): string => `${agenteId}:${dia}`;

/** O filtro que a tela conhece (o `data-filtro` do botão); outro valor não muda nada. */
export function ehFiltroAtividade(x: string | undefined): x is FiltroAtividade {
  return FILTROS_DA_ATIVIDADE.some((f) => f.filtro === x);
}

/** Os itens que o filtro mostra; "Tudo" mostra todos, inclusive os sem categoria. */
export function itensDoFiltro(itens: readonly ItemDeAtividade[], filtro: FiltroAtividade): ItemDeAtividade[] {
  return filtro === "tudo" ? [...itens] : itens.filter((i) => i.categoria === filtro);
}

/** "Hoje", "Ontem" ou "seg., 13/10" (o dia da página, no cabeçalho da lista). */
export function rotuloDoDia(dia: string, hoje: string): string {
  if (dia === hoje) return "Hoje";
  if (diaSeguinte(dia) === hoje) return "Ontem";
  const [a, m, d] = dia.split("-").map(Number);
  const data = new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1);
  return data.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

/**
 * definido em 2026-10-18 (plano, gatilho da ADR-114): a Atividade aberta até 60 s depois de abrir a conversa conta como
 * "aberta"; mais de 30% das aberturas em 2 semanas diz que algo que importava saiu do chat.
 */
export const JANELA_DA_ATIVIDADE_MS = 60_000;

type Telemetria = { mostrada(e: Omit<EventoLinha, "acao">): void; aberta(e: Omit<EventoLinha, "acao">): void };

/**
 * A telemetria do gatilho (TipoLinha "atividade"): cada abertura da conversa própria é uma "mostrada" com uma chave nova
 * (`atividade:<conversa>:<instante>`); abrir a Atividade do mesmo bot até JANELA_DA_ATIVIDADE_MS depois é a "aberta" com
 * a MESMA chave. A tela avisa o que está à vista a cada desenho (`naTela`): a conversa só conta de novo quando sai e volta.
 */
export function criarVigiaDaAtividade(telemetria: Telemetria, relogio: () => number = Date.now) {
  let atual: { agenteId: string; conversaId: string; chave: string; em: number } | null = null;
  return {
    naTela(conversa: { agenteId: string; conversaId: string } | null): void {
      if (!conversa) {
        atual = null;
        return;
      }
      if (atual?.conversaId === conversa.conversaId) return;
      const em = relogio();
      atual = { ...conversa, chave: `atividade:${conversa.conversaId}:${em}`, em };
      telemetria.mostrada({ tipo: "atividade", agenteId: conversa.agenteId, chaveLinha: atual.chave });
    },
    atividadeAberta(agenteId: string): void {
      if (!atual || atual.agenteId !== agenteId || relogio() - atual.em > JANELA_DA_ATIVIDADE_MS) return;
      telemetria.aberta({ tipo: "atividade", agenteId, chaveLinha: atual.chave });
    },
  };
}
