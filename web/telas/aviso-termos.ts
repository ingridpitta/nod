import type { IaDesktop } from "../../src/contracts/desktop.ts";
import { esc } from "../lib/render.ts";
import { PROVEDOR } from "./cartao-ia.ts";

/**
 * O aviso ao ligar "Trocar sozinho" (ADR-101, NOD-211; protótipo v4, revisão do Gil em 2026-10-12). Cada frase diz de
 * onde vem: a Anthropic fala em uso individual só para Pro e Max, e na página legal do Claude Code, não nos Termos de
 * Consumo. Cancelar é o primário e recebe o foco; "Ligar mesmo assim" é secundário. Diálogo próprio (window.confirm
 * não deixa escolher o botão em foco nem pôr links).
 */
export type AvisoDosTermos = { texto: string; links: readonly { rotulo: string; url: string }[] };

/** definido em 2026-10-12, conferido nas páginas: code.claude.com/docs/en/legal-and-compliance e anthropic.com/legal/consumer-terms. */
export const TERMOS_DA_TROCA: Record<IaDesktop, AvisoDosTermos> = {
  "claude-cli": {
    texto: "A Anthropic diz que os limites dos planos Pro e Max supõem uso individual comum do Claude Code, e os Termos de Consumo proíbem burlar os sistemas e as proteções dela. Trocar sozinho de conta no limite pode ser visto assim. Se você ligar, a responsabilidade é sua.",
    links: [
      { rotulo: "Página legal do Claude Code", url: "https://code.claude.com/docs/en/legal-and-compliance" },
      { rotulo: "Termos de Consumo da Anthropic", url: "https://www.anthropic.com/legal/consumer-terms" },
    ],
  },
  "codex-cli": {
    texto: "Os Termos de Uso da OpenAI proíbem contornar limites de uso ou restrições. Trocar sozinho de conta no limite pode ser visto assim. Se você ligar, a responsabilidade é sua.",
    links: [{ rotulo: "Termos de Uso da OpenAI", url: "https://openai.com/policies/terms-of-use/" }],
  },
};

export function htmlDoAvisoDosTermos(ia: IaDesktop): string {
  const t = TERMOS_DA_TROCA[ia];
  const links = t.links.map((l) => `<a class="link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.rotulo)} ↗</a>`).join(" · ");
  return `<h2 id="aviso-termos-titulo">Trocar de conta sozinho no ${esc(PROVEDOR[ia].cli)}?</h2>
    <p>${esc(t.texto)}</p>
    <p>${links}</p>
    <div class="acoes"><button class="bt" data-sim type="button">Ligar mesmo assim</button> <button class="bt pri" data-nao type="button" autofocus>Cancelar</button></div>`;
}
