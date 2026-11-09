import type { Agente } from "../../src/contracts/agente.ts";
import type { Autoria } from "../../src/contracts/evento.ts";
import { esc } from "./escape.ts";
import { formatoData } from "./formato-data.ts";
import { htmlMascote, type EstadoMascote, type TamanhoMascote } from "./mascote.ts";
export { esc } from "./escape.ts";
export { atualizarMascote } from "./mascote.ts";

/**
 * O texto escapado com um trecho em fonte de código (PR 4b dos modos de aprovação: o comando sem frase, "Rodar ⟨npm run
 * deploy⟩"). `codigo` é [início, fim) no texto, vindo do servidor; fora dos limites, o texto sai todo sem código.
 */
export function textoComCodigo(texto: string, codigo?: readonly [number, number]): string {
  const [i, f] = codigo ?? [0, 0];
  if (!codigo || !Number.isInteger(i) || !Number.isInteger(f) || i < 0 || f <= i || f > texto.length) return esc(texto);
  return `${esc(texto.slice(0, i))}<code>${esc(texto.slice(i, f))}</code>${esc(texto.slice(f))}`;
}

export function iniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Linguagem visual de prototypes/fleet-is-home.html: círculo cheio = PESSOA, quadrado vazado = AGENTE.
 * Lê `autor_tipo`, nunca infere do nome (ADR-023). A cor do agente vem do perfil (`cor`).
 */
export function avatar(p: { tipo: Autoria["autor_tipo"]; nome: string; cor?: string; tamanho?: "sm" | "md" | "lg" }): string {
  const t = p.tamanho ?? "md";
  if (p.tipo === "pessoa") return `<span class="av av-pessoa ${t}" title="${esc(p.nome)}">${esc(iniciais(p.nome))}</span>`;
  return `<span class="av av-agente ${t} ${esc(p.cor ?? "c-black")}" title="${esc(p.nome)}">${esc(iniciais(p.nome))}</span>`;
}

export function avatarAgente(a: Pick<Agente, "nome" | "cor">, tamanho: "sm" | "md" | "lg" = "md"): string {
  return avatar({ tipo: "agente", nome: a.nome, cor: a.cor, tamanho });
}

/**
 * definido em 2026-09-17: rosto vetorial na forma e cor do perfil, conforme a referência visual.
 */
export function iconeAgente(a: Pick<Agente, "nome" | "cor" | "forma">, tamanho: TamanhoMascote = "", estado: EstadoMascote = "disponivel", extra = ""): string {
  return htmlMascote(a, tamanho, estado, extra);
}

/** 'HH:MM' no fuso da máquina da pessoa (a web só interpola; o servidor manda absoluto, ADR-007). */
export function hora(instante: number | string): string {
  const t = typeof instante === "number" ? instante : Date.parse(instante);
  if (Number.isNaN(t)) return "--:--";
  return formatoData("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}

export function dataHora(instante: number | string, fusoIana?: string): string {
  const t = typeof instante === "number" ? instante : Date.parse(instante);
  if (Number.isNaN(t)) return "instante inválido";
  return formatoData("pt-BR", { timeZone: fusoIana, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}

/** `rotulo` NÃO é escapado (aceita svg/span); `aria` dá nome acessível a botão só-ícone, onde o
 *  `title` sozinho não basta — várias combinações de leitor de tela não o anunciam. */
export function botao(act: string, rotulo: string, extra: { id?: string; classe?: string; dados?: Record<string, string>; desabilitado?: boolean; titulo?: string; descritoPor?: string; aria?: string; expandido?: boolean; vivo?: boolean } = {}): string {
  const dados = Object.entries(extra.dados ?? {})
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join("");
  return `<button type="button" class="bt ${extra.classe ?? ""}" data-act="${esc(act)}"${extra.id ? ` data-id="${esc(extra.id)}"` : ""}${dados}${extra.desabilitado ? " disabled" : ""}${extra.titulo ? ` title="${esc(extra.titulo)}"` : ""}${extra.descritoPor ? ` aria-describedby="${esc(extra.descritoPor)}"` : ""}${extra.aria ? ` aria-label="${esc(extra.aria)}"` : ""}${extra.expandido !== undefined ? ` aria-expanded="${extra.expandido}"` : ""}${extra.vivo ? ' aria-live="polite"' : ""}>${rotulo}</button>`;
}

/** Texto multilinha escapado com quebras preservadas. */
export function paragrafos(texto: string): string {
  return esc(texto).replaceAll("\n", "<br>");
}
