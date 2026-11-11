import type { AutorLote } from "../contracts/quadro.ts";
import type { EstadoDoAlvo, ModoAcionar, PorqueAciona } from "../contracts/quadro-comentarios.ts";

/**
 * Quem um comentário da tarefa aciona (definido em 2026-11-10, as regras da issue do Multica sobre o NOD-417). Puro: o
 * caso de uso (src/use-cases/comentar-tarefa.ts) grava e abre os turnos; a prévia do campo (os chips antes de enviar,
 * src/use-cases/previa-comentario.ts) chama ESTA função com os mesmos dados, para a tela nunca prometer outra coisa.
 *
 * 1. O comentário aciona o responsável em qualquer coluna (Feito também), sem precisar de @.
 * 2. A resposta numa thread vai ao agente daquela thread (quem respondeu ou foi acionado na raiz), não ao responsável.
 * 3. @agente aciona aquele agente (o responsável não muda); @pessoa só linka.
 * 4. @todos é anúncio: tira as rotas implícitas (responsável e agente da thread); a menção explícita no mesmo comentário
 *    ainda aciona.
 * 5. O autor nunca se aciona; o Nod nunca (ADR-081); quem a pessoa marcou "não acionar" sai depois da conta.
 */

export type AlvoDoComentario = { agenteId: string; porque: PorqueAciona };

const LETRA = /[\p{L}\p{N}_]/u;
/** @todos (e o @all do Multica): o nome inteiro, sem letra colada depois. */
const TODOS = /(^|[^\p{L}\p{N}_])@(todos|all)(?![\p{L}\p{N}_])/iu;

export const mencionaTodos = (texto: string): boolean => TODOS.test(texto);

/**
 * O agente da thread: do comentário mais novo ao mais velho, o primeiro escrito por um agente que não é quem comenta
 * agora; sem nenhum, o primeiro agente que a raiz acionou. null = thread só de pessoas (cai no responsável).
 * `mensagens` vem em ordem (a raiz primeiro).
 */
export function agenteDaThread(mensagens: readonly { autorAgenteId: string | null; acionados: readonly string[] }[], autorAgora: string | null): string | null {
  for (let i = mensagens.length - 1; i >= 0; i--) {
    const a = mensagens[i]!.autorAgenteId;
    if (a && a !== autorAgora) return a;
  }
  return mensagens[0]?.acionados.find((id) => id !== autorAgora) ?? null;
}

export function rotaDoComentario(p: {
  autor: AutorLote;
  responsavelId: string | null;
  /** Os bots @mencionados, na ordem do texto. */
  mencionados: readonly string[];
  /** O pedir_a_bot com a tarefa: acionado sem menção. */
  alvos?: readonly string[];
  todos?: boolean;
  /** É resposta numa thread; `agenteDaThread` é quem a thread segue (null = ninguém ainda: vale o responsável). */
  naThread?: boolean;
  agenteDaThread?: string | null;
  nods?: ReadonlySet<string>;
  suprimidos?: ReadonlySet<string>;
}): AlvoDoComentario[] {
  const autorId = p.autor.tipo === "agente" ? p.autor.agenteId : null;
  const implicito: AlvoDoComentario | null = p.todos ? null
    : p.naThread && p.agenteDaThread ? { agenteId: p.agenteDaThread, porque: "thread" }
    : p.responsavelId ? { agenteId: p.responsavelId, porque: "responsavel" } : null;
  const lista: AlvoDoComentario[] = [
    ...(implicito ? [implicito] : []),
    ...(p.alvos ?? []).map((agenteId) => ({ agenteId, porque: "pedido" as const })),
    ...p.mencionados.map((agenteId) => ({ agenteId, porque: "mencao" as const })),
  ];
  const vistos = new Set<string>();
  return lista.filter((a) => {
    if (vistos.has(a.agenteId)) return false;
    vistos.add(a.agenteId);
    return a.agenteId !== autorId && !p.nods?.has(a.agenteId) && !p.suprimidos?.has(a.agenteId);
  });
}

/**
 * As escolhas do chip de cada alvo (o menu antes de enviar). Rodando: mandar agora (entra no turno em andamento; só onde o
 * nod entrega recado no meio do turno), depois que terminar (fila) ou no lugar (cancela o atual e começa com isto). Na
 * fila: junta ao que espera. Parado: aciona. Sempre dá para não acionar.
 */
export function opcoesDoAlvo(estado: EstadoDoAlvo, podeAgora: boolean): ModoAcionar[] {
  if (estado === "rodando") return [...(podeAgora ? ["agora" as const] : []), "depois", "no_lugar", "nao"];
  if (estado === "fila") return ["depois", "nao"];
  return ["acionar", "nao"];
}

/**
 * O padrão do chip (o do Multica): com o agente rodando, "manda agora" só quando o turno em andamento é da MESMA thread (a
 * resposta na thread dele, ou o comentário solto com o trabalho da tarefa rodando, que não tem thread); senão, depois
 * que terminar. `mesmaThread` vem do caso de uso.
 */
export function padraoDoAlvo(estado: EstadoDoAlvo, podeAgora: boolean, mesmaThread: boolean): ModoAcionar {
  if (estado === "rodando") return podeAgora && mesmaThread ? "agora" : "depois";
  return opcoesDoAlvo(estado, podeAgora)[0]!;
}

/** O modo pedido vale só se está entre as escolhas daquele alvo; senão, o padrão (a tela velha não decide pelo servidor). */
export function modoValido(pedido: ModoAcionar | undefined, estado: EstadoDoAlvo, podeAgora: boolean, mesmaThread = false): ModoAcionar {
  return pedido && opcoesDoAlvo(estado, podeAgora).includes(pedido) ? pedido : padraoDoAlvo(estado, podeAgora, mesmaThread);
}

/** A frase do chip (o menu e o leitor de tela). */
export const ROTULO_DO_MODO: Readonly<Record<ModoAcionar, string>> = {
  acionar: "vai começar",
  agora: "manda agora",
  depois: "depois que terminar",
  no_lugar: "no lugar do atual",
  nao: "não aciona",
};

/** Os nomes @mencionados, para as pessoas do quadro (só linkam e avisam): o mesmo casamento do nome inteiro dos bots. */
export function nomesMencionados<T extends { nome: string }>(texto: string, quem: readonly T[]): T[] {
  const normal = (s: string) => s.normalize("NFC").toLocaleLowerCase();
  let resto = normal(texto);
  const achados: { a: T; pos: number }[] = [];
  for (const a of [...quem].filter((x) => x.nome.trim() !== "").sort((x, y) => y.nome.trim().length - x.nome.trim().length)) {
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
