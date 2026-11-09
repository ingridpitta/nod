import type { AppDto, PaginasDto } from "../../src/contracts/apps.ts";
import { estadoDoApp } from "../../src/domain/apps-do-bot.ts";

/** NOD-445: um app como o servidor devolve, com o mínimo preenchido (os testes da web montam as páginas com ele). */
export function appDe(nome: string, o: Partial<AppDto> = {}): AppDto {
  const id = o.id ?? `id-${nome.toLowerCase()}`;
  const base: Omit<AppDto, "estado"> = {
    id, nome, icone: "app", fonte: "bot", fonteRef: null, forma: "lista", quemVe: "so_eu", regraPede: null, pedeQuando: null,
    dados: { itens: [] }, erroFonte: null, pedeVoce: false, criadoEm: 1, atualizadoEm: 1, ...o,
  };
  // O estado vem do servidor (`paraDto`); aqui sai da mesma regra, a não ser que o teste diga outro.
  return { ...base, estado: o.estado ?? estadoDoApp(base) };
}

/** As páginas de um bot: com Tarefas (o bot tem quadro) e os apps na ordem de criação; a ordem é a de sempre. */
export function paginasDe(apps: readonly AppDto[], o: { temTarefas?: boolean; ordem?: string[]; agenteId?: string } = {}): PaginasDto {
  const temTarefas = o.temTarefas ?? true;
  const comCriacao = apps.map((a, i) => ({ ...a, criadoEm: a.criadoEm === 1 ? i + 1 : a.criadoEm }));
  return {
    agenteId: o.agenteId ?? "a",
    ordem: o.ordem ?? ["conversa", ...(temTarefas ? ["tarefas"] : []), ...comCriacao.map((a) => `app:${a.id}`)],
    apps: comCriacao, temTarefas, cabeMais: comCriacao.length < 11, limite: 12,
  };
}

/** Os 7 apps do protótipo do Gil (depois de Tarefas): os cenários 0, 1, 3 e 8 apps saem daqui. */
export const APPS_DO_PROTOTIPO: readonly AppDto[] = [
  appDe("Painel", { icone: "painel", forma: "painel" }),
  appDe("Doc", { icone: "doc", forma: "doc" }),
  appDe("Vagas", { pedeVoce: true, regraPede: "vaga sem resposta há 2 dias", dados: { itens: [{ titulo: "Designer", pede: true }] } }),
  appDe("Leads", { forma: "quadro" }),
  appDe("Custos", { icone: "dinheiro", forma: "painel" }),
  appDe("Wiki", { icone: "doc", forma: "doc" }),
  appDe("Agenda", { icone: "agenda" }),
];

/** N apps contando Tarefas (como o protótipo): 0 = só a conversa, 1 = Tarefas, 3 = Tarefas + 2, 8 = Tarefas + 7. */
export function cenario(n: number): PaginasDto {
  return n === 0 ? paginasDe([], { temTarefas: false }) : paginasDe(APPS_DO_PROTOTIPO.slice(0, n - 1));
}
