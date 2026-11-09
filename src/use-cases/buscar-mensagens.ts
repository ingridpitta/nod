import type { PaginaDaBusca } from "../contracts/busca.ts";
import { codificarCursor, type CursorBiblioteca } from "../domain/biblioteca.ts";
import { trechoEmVolta } from "../domain/busca-mensagens.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * NOD-380: `GET /busca/mensagens`. O termo já vem validado (`termoDaBusca`) e o cursor lido (`lerCursor`); o que a pessoa
 * lê quem decide é a RLS da transação escopada. Cada página leva até `limite` falas e o cursor da próxima quando há mais.
 */
export const buscarMensagens: CasoDeUso<{ termo: string; antes: CursorBiblioteca | null; limite: number; sinal?: AbortSignal }, PaginaDaBusca> = async (deps, input) => {
  const r = await deps.repos.mensagens.buscarTexto(input.termo, input.antes, input.limite, input.sinal);
  const itens = r.linhas.map((l) => ({
    id: l.id,
    conversaId: l.conversa_id,
    conversaTipo: l.conversa_tipo,
    agenteId: l.conversa_tipo === "propria" ? l.agente_id : null,
    salaId: l.conversa_tipo === "sala" ? l.sala_id : null,
    autor: { tipo: l.autor_tipo, id: l.autor_id },
    em: l.criado_em_txt,
    trecho: trechoEmVolta(l.texto, input.termo, undefined, { inicio: l.cortado_inicio, fim: l.cortado_fim }),
  }));
  const u = r.linhas.at(-1);
  return { data: { itens, proximo: r.temMais && u ? codificarCursor({ criadoEm: u.criado_em_txt, id: u.id }) : null } };
};
