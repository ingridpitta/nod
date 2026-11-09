import { esc } from "./escape.ts";

/**
 * O aviso de estado do design system (componente Notice, definido em 2026-10-04): diz o que aconteceu, o motivo e,
 * quando há, o botão que resolve. Quatro tons, cada um com ícone e palavra, nunca só a cor:
 * - erro: o trabalho não começa ou parou;
 * - alerta: algo impede um agente, mas a pessoa resolve quando quiser;
 * - ok: confirmação curta;
 * - info: contexto neutro (sem azul: o azul é só do que é novo).
 */
export type TomDoAviso = "erro" | "alerta" | "ok" | "info";

const ICONES: Record<TomDoAviso, string> = {
  erro: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  alerta: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17.2v.01"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.7 2.7L16 9.7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.01"/>',
};

export function iconeDoAviso(tom: TomDoAviso): string {
  return `<svg class="aviso-estado-ic" aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONES[tom]}</svg>`;
}

/**
 * `titulo` e `texto` chegam como texto puro e são escapados aqui; `acao` e `extra` já são HTML pronto (um botao()
 * de render.ts e, por exemplo, um <details> com o texto técnico). `papel` só vai quando o aviso nasce agora:
 * um aviso antigo da conversa não deve ser anunciado de novo a cada render.
 */
export function avisoDeEstado(a: { tom: TomDoAviso; titulo?: string; texto: string; acao?: string; extra?: string; papel?: "alert" | "status"; classe?: string }): string {
  const titulo = a.titulo ? `<b>${esc(a.titulo)}</b> ` : "";
  const papel = a.papel ? ` role="${a.papel}"` : "";
  return `<div class="aviso-estado tom-${a.tom}${a.classe ? ` ${esc(a.classe)}` : ""}"${papel}>${iconeDoAviso(a.tom)}<div class="aviso-estado-txt">${titulo}${esc(a.texto)}${a.extra ?? ""}</div>${a.acao ?? ""}</div>`;
}
