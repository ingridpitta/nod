import type { ColunaDto } from "../../src/contracts/quadro.ts";

/**
 * ADA-28 (ADR-159, escopo D): a linha sutil embaixo do campo de comentário diz, antes de enviar, se ele aciona alguém.
 * A web não importa o domínio (ADR-018), então a regra é espelhada aqui e o teste tests/unit/web/previa-comentario.test.ts
 * confere contra o servidor (`mencionados`, `mencionaTodos` e `rotaDoComentario` de src/domain): uma regra só, provada
 * por teste. Quem comenta pela tela é sempre a pessoa; o freio (src/domain/freios-quadro.ts) só vale para comentário de
 * bot. 2026-11-10: o computador mostra os chips da prévia do servidor (GET …/comentarios/previa); este espelho segue no
 * campo do celular, sem thread. O responsável é acionado em qualquer coluna; @todos o tira.
 */
export type PreviaDoComentario = { acionados: string[]; motivo: "andamento" | "mencao" | "todos" | "sem_responsavel" | "nota" };

type Agente = { id: string; nome: string; nod?: boolean };

const LETRA = /[\p{L}\p{N}_]/u;
const normal = (s: string) => s.normalize("NFC").toLocaleLowerCase();

/** Igual a `mencionados` do domínio: o nome inteiro depois do @, o mais longo ganha, sem letra colada depois. */
function mencionadosNaTela(texto: string, agentes: readonly Agente[]): Agente[] {
  let resto = normal(texto);
  const achados: { a: Agente; pos: number }[] = [];
  for (const a of agentes.filter((x) => !x.nod && x.nome.trim() !== "").sort((x, y) => y.nome.trim().length - x.nome.trim().length)) {
    const alvo = `@${normal(a.nome.trim())}`;
    let i = resto.indexOf(alvo);
    let primeira = -1;
    while (i >= 0) {
      const antes = i === 0 ? "" : resto[i - 1]!;
      const depois = resto[i + alvo.length] ?? "";
      if (!LETRA.test(antes) && !LETRA.test(depois)) {
        if (primeira < 0) primeira = i;
        resto = resto.slice(0, i) + " ".repeat(alvo.length) + resto.slice(i + alvo.length);
      }
      i = resto.indexOf(alvo, i + 1);
    }
    if (primeira >= 0) achados.push({ a, pos: primeira });
  }
  return achados.sort((x, y) => x.pos - y.pos).map((x) => x.a);
}

/** Igual a `mencionaTodos` do domínio: @todos ou @all inteiros. */
const TODOS = /(^|[^\p{L}\p{N}_])@(todos|all)(?![\p{L}\p{N}_])/iu;

/** Igual a `ehNota` e `NOTA_NAO_ACIONA` do domínio (2026-11-10, o /note do Multica): anotação, não aciona ninguém. */
const NOTA = /^\s*\/note(?![\p{L}\p{N}_])/iu;
export const NOTA_NAO_ACIONA = "nota, não aciona";

export function previaDoComentario(p: { tarefa: { agenteId: string | null; status: string }; colunas: readonly Pick<ColunaDto, "id" | "grupo">[]; texto: string; agentes: readonly Agente[] }): PreviaDoComentario {
  if (NOTA.test(p.texto)) return { acionados: [], motivo: "nota" };
  const todos = TODOS.test(p.texto);
  const responsavel = !todos && p.tarefa.agenteId ? p.agentes.find((a) => a.id === p.tarefa.agenteId && !a.nod) ?? null : null;
  const mencoes = mencionadosNaTela(p.texto, p.agentes);
  const vistos = new Set<string>();
  const acionados = [...(responsavel ? [responsavel] : []), ...mencoes].filter((a) => !vistos.has(a.id) && vistos.add(a.id)).map((a) => a.nome.trim());
  if (mencoes.some((m) => m.id !== responsavel?.id)) return { acionados, motivo: "mencao" };
  if (responsavel) return { acionados, motivo: "andamento" };
  return { acionados, motivo: todos && p.tarefa.agenteId ? "todos" : "sem_responsavel" };
}

/** O texto da linha: "Faustino vai ver agora", "Faustino e Gil vão ver agora", "@todos é anúncio…". */
export function textoDaPrevia(p: PreviaDoComentario, _nomeDaColuna?: string | null): string {
  const n = p.acionados;
  if (n.length === 1) return `${n[0]} vai ver agora`;
  if (n.length > 1) return `${n.slice(0, -1).join(", ")} e ${n.at(-1)} vão ver agora`;
  if (p.motivo === "nota") return NOTA_NAO_ACIONA;
  if (p.motivo === "todos") return "@todos é anúncio: não aciona o responsável (@nome chama um bot)";
  return "fica só registrado (a tarefa não tem responsável; @nome chama um bot)";
}
