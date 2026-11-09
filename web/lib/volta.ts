import type { Estado, Tela } from "../estado/reducer.ts";
import { iconeAgente } from "./render.ts";

/** Para onde "‹" volta, escrito: o nome do bot (com o mascote), da sala ou da tela. */
export type Volta = { rotulo: string; icone: string };

const NOMES: Partial<Record<Tela["tipo"], string>> = { conectores: "Marketplace", "nao-lidos": "Não lidos", "sua-vez": "Sua vez", "novo-bot": "Novo bot", "nova-sala": "Nova sala", rotinas: "Rotinas", "nova-rotina": "Nova rotina", trabalhos: "Trabalhos", trabalho: "a task", linha: "a conversa", "quadro-compartilhado": "o quadro" };

/**
 * "‹ <de onde veio>" de Seu espaço e do Marketplace (definido em 2026-10-04): o bot com o mascote, a sala com #, ou o
 * nome da tela. O bot sai da frota ou da gestão (o oculto só está na gestão), como no menu do bot.
 */
export function voltaDaTela(estado: Estado, t: Tela): Volta {
  if (t.tipo === "conversa") {
    const a = [...(estado.frota?.agentes ?? []), ...(estado.gestao?.agentes ?? [])].find((x) => x.id === t.agenteId && !x.excluidoEm);
    return a ? { rotulo: a.nome, icone: iconeAgente(a, "sm") } : { rotulo: "a conversa", icone: "" };
  }
  if (t.tipo === "sala") return { rotulo: `# ${estado.salas.find((x) => x.sala.id === t.salaId)?.sala.nome ?? "sala"}`, icone: "" };
  return { rotulo: NOMES[t.tipo] ?? "Voltar", icone: "" };
}
