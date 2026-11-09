import type { RuntimeEvent } from "../contracts/evento.ts";
import { capacidadesDoNivel } from "../domain/grupos-de-acesso.ts";
import { conexaoViraPedido } from "./confirmar-proposta.ts";
import type { CasoDeUso } from "./tipos.ts";

export type SaidaAoConectarApp = { cards: number };

/**
 * definido em 2026-09-25: o login de um app terminou (Verificar do marketplace, que a web chama sozinha
 * enquanto a janela de login está aberta). Cada card "Conecte o X" desta pessoa ainda aberto vira, no
 * mesmo lugar, o card de permitir do nível que o agente pediu — a pessoa não volta ao card para clicar em
 * "Continuar tarefa". Nada é concedido aqui: conceder continua sendo o clique em Permitir (ADR-044).
 * revisto em 2026-09-25 (revisão do PR #68): o que impede um card de virar (app sem ferramenta daquele
 * nível) é conferido ANTES de qualquer escrita, e erro no meio não é engolido — engolido, o card de
 * conexão saía confirmado sem o de permitir no lugar, na mesma transação que commitava.
 */
export const aoConectarApp: CasoDeUso<{ slug: string }, SaidaAoConectarApp> = async (deps, input) => {
  const conector = await deps.repos.conectores.buscarPorSlug(input.slug);
  if (!conector?.habilitado) return { data: { cards: 0 } };
  const events: RuntimeEvent[] = [];
  let cards = 0;
  for (const p of await deps.repos.propostas.conexoesPendentes(input.slug)) {
    if (p.payload.kind !== "acesso" || !p.payload.conectar) continue;
    if (capacidadesDoNivel(conector.catalogo, p.payload.rotinaId ? "leitura" : p.payload.nivel).length === 0) continue;
    const r = await conexaoViraPedido(deps, p, p.payload);
    events.push(...r.events);
    cards++;
  }
  return { data: { cards }, events };
};
