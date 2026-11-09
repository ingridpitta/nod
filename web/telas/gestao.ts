import type { FrotaDto } from "../../src/contracts/api.ts";

/** Os tipos e textos da gestão de agentes (a tela é Configurações › Agentes, config-agentes.ts); os menus e diálogos moram em gestao-agentes.ts. */
export type BotGerido = FrotaDto["agentes"][number];
export type AcaoGestao = "fixar" | "mover" | "nao-lido" | "renomear" | "perfil" | "duplicar" | "copiar" | "ocultar" | "excluir" | "restaurar" | "ver-perfil";

/**
 * O texto da caixa de duplicar. definido em 2026-09-28 (emenda da ADR-034): a dona leva o bot inteiro; bot de equipe de
 * outra pessoa, só o perfil. revisto em 2026-10-20 (NOD-316): a cópia nasce em Aprovar automaticamente e não herda o
 * modo do original — a caixa diz isso, nos dois ramos.
 */
export function textoDuplicar(dona: boolean): string {
  const modo = "<p>A cópia começa em Aprovar automaticamente; mude em Aprovações.</p>";
  return dona
    ? `<p>A cópia leva perfil, avatar, memória, acessos e rotinas. Rotinas ativas também rodam na cópia. Só o histórico da conversa não vem.</p>${modo}`
    : `<p>A cópia mantém perfil e avatar. Rotinas começam pausadas. Como o bot não é seu, memória e acessos ficam com a dona; o histórico também não vem.</p>${modo}`;
}
