/**
 * ADR-125 (NOD-349, definido em 2026-10-23): a identidade editável no topo da gaveta e o teclado das abas e do popover
 * do avatar. As regras puras, sem DOM (o tsconfig do servidor compila os testes); os eventos ficam em gaveta-identidade.ts.
 */

export const ERRO_NOME_VAZIO = "O nome não pode ficar vazio";
export const ERRO_AO_SALVAR = "Não deu para salvar. Tente de novo.";
/** Quanto tempo o aviso fica na linha de erro (o critério pede uns 2 s). */
export const AVISO_MS = 2500;
/** Forma e cor por setas: um PATCH só depois que a pessoa para (o último vence). */
export const DEBOUNCE_AVATAR_MS = 300;

export type CampoIdentidade = "nome" | "titulo";
export type DecisaoDoCampo = { tipo: "nada" } | { tipo: "vazio" } | { tipo: "salvar"; valor: string };

/** O que fazer quando o campo perde o foco: nada (igual ao salvo), o nome vazio volta e avisa, ou salvar sem espaços nas pontas. */
export function decidirCampo(campo: CampoIdentidade, digitado: string, salvo: string): DecisaoDoCampo {
  const valor = digitado.trim();
  if (campo === "nome" && !valor) return { tipo: "vazio" };
  if (valor === salvo.trim()) return { tipo: "nada" };
  return { tipo: "salvar", valor };
}

/** As setas numa grade de rádios (formas 4×2, cores 6×2): ← → andam um, ↑ ↓ uma linha, Home e End vão às pontas; dá a volta. */
export function proximoRadio(indice: number, total: number, colunas: number, tecla: string): number | null {
  if (total <= 0) return null;
  if (tecla === "Home") return 0;
  if (tecla === "End") return total - 1;
  const passo = tecla === "ArrowRight" ? 1 : tecla === "ArrowLeft" ? -1 : tecla === "ArrowDown" ? colunas : tecla === "ArrowUp" ? -colunas : 0;
  if (!passo) return null;
  return (((indice + passo) % total) + total) % total;
}

/** As setas numa lista de abas (ADR-125, padrão da NOD-326): ← → dão a volta; Home e End vão às pontas. */
export function proximaAba(total: number, atual: number, tecla: string): number | null {
  if (total <= 0) return null;
  if (tecla === "Home") return 0;
  if (tecla === "End") return total - 1;
  if (tecla === "ArrowRight") return (atual + 1) % total;
  if (tecla === "ArrowLeft") return (atual - 1 + total) % total;
  return null;
}

/** O PATCH de forma e cor com debounce: só o último pedido de cada bot sai, `DEBOUNCE_AVATAR_MS` depois do último toque. */
// Revisão 2 da NOD-349: os toques que esperam o debounce se juntam aqui (forma + cor) e somem quando o PATCH sai; antes o
// acumulado vivia fora e sobrava quando o popover fechava pelo reducer, reenviando no próximo toque uma escolha velha.
export function criarSalvarAvatar<T extends object>(salvar: (agenteId: string, mudanca: T) => Promise<void>, espera = DEBOUNCE_AVATAR_MS) {
  const pendentes = new Map<string, { timer: ReturnType<typeof setTimeout>; mudanca: T }>();
  return {
    pedir(agenteId: string, toque: T): void {
      const antes = pendentes.get(agenteId);
      if (antes) clearTimeout(antes.timer);
      const mudanca = { ...antes?.mudanca, ...toque } as T;
      const timer = setTimeout(() => { pendentes.delete(agenteId); void salvar(agenteId, mudanca); }, espera);
      pendentes.set(agenteId, { timer, mudanca });
    },
    /** Há um toque esperando o debounce deste bot. */
    pendente(agenteId: string): boolean {
      return pendentes.has(agenteId);
    },
    /** Sai já o que estiver pendente (fechar o popover não pode perder a última escolha). */
    agora(agenteId: string): void {
      const p = pendentes.get(agenteId);
      if (!p) return;
      clearTimeout(p.timer);
      pendentes.delete(agenteId);
      void salvar(agenteId, p.mudanca);
    },
  };
}

/**
 * Um PATCH de perfil por bot de cada vez (revisão da NOD-349): o que chega com um em curso espera e se junta ao que já
 * espera (o último valor de cada campo vence), então um pedido antigo nunca chega depois de um novo. Cada `enviar`
 * resolve ou rejeita com o pedido que levou a sua mudança; `semEspera` diz se nada espera atrás do pedido em curso.
 */
export function criarFilaDePerfil<T extends object>(salvar: (agenteId: string, mudanca: T) => Promise<void>) {
  type Espera = { mudanca: T; avisos: { ok: () => void; falha: (e: unknown) => void }[] };
  const emCurso = new Set<string>();
  const esperando = new Map<string, Espera>();
  const rodar = (agenteId: string, e: Espera): void => {
    emCurso.add(agenteId);
    salvar(agenteId, e.mudanca).then(
      () => { for (const a of e.avisos) a.ok(); },
      (erro: unknown) => { for (const a of e.avisos) a.falha(erro); },
    ).finally(() => {
      emCurso.delete(agenteId);
      const prox = esperando.get(agenteId);
      if (prox) { esperando.delete(agenteId); rodar(agenteId, prox); }
    });
  };
  return {
    enviar(agenteId: string, mudanca: T): Promise<void> {
      return new Promise<void>((ok, falha) => {
        const antes = esperando.get(agenteId);
        const e: Espera = { mudanca: { ...antes?.mudanca, ...mudanca } as T, avisos: [...(antes?.avisos ?? []), { ok, falha }] };
        if (emCurso.has(agenteId)) { esperando.set(agenteId, e); return; }
        rodar(agenteId, e);
      });
    },
    semEspera(agenteId: string): boolean {
      return !esperando.has(agenteId);
    },
  };
}

/**
 * O PATCH de `tentado` falhou: como o campo fica agora. Nada muda se outro valor já foi salvo depois; o texto só volta ao
 * `anterior` se a pessoa não digitou outra coisa desde então (o que ela digita não se apaga).
 */
export function desfazerAoFalhar(campo: { salvo: string; valor: string }, tentado: string, anterior: string): { salvo: string; valor: string } | null {
  if (campo.salvo !== tentado) return null;
  return { salvo: anterior, valor: campo.valor.trim() === tentado ? anterior : campo.valor };
}

/**
 * A frota relida no meio de um salvamento traz o valor antigo: o que ainda vai sair (ou está saindo) fica por cima,
 * para a forma, a cor ou o nome escolhidos não piscarem de volta (revisão da NOD-349).
 */
export function comPendentes<A extends { id: string }>(agentes: readonly A[], pendentes: Readonly<Record<string, Partial<A>>>): A[] {
  return agentes.map((a) => (pendentes[a.id] ? { ...a, ...pendentes[a.id] } : a));
}

/**
 * Revisão 2 da NOD-349: toda frota que entra no estado — pelo dispatch ou pela releitura do SSE (`reidratar`, que reduz
 * direto) — passa por aqui, para a releitura no meio do debounce ou do PATCH não desfazer na tela o que ainda vai sair.
 */
export function sobreporPendentes<T extends { tipo: string }>(acao: T, pendentes: Readonly<Record<string, object>>): T {
  if (acao.tipo !== "hidratar-frota" || Object.keys(pendentes).length === 0) return acao;
  const frota = (acao as unknown as { frota: { agentes: { id: string }[] } }).frota;
  return { ...acao, frota: { ...frota, agentes: comPendentes(frota.agentes, pendentes as Record<string, Partial<{ id: string }>>) } };
}
