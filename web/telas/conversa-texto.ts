import { esc } from "../lib/escape.ts";

/**
 * ADA-242 (spec onboarding-jornada-a §4, protótipo `jornadas.html#a` 3a): a conversa por TEXTO com o Nod, no lugar da
 * ligação, com NOD_ONBOARDING_TEXTO. Só duas perguntas (sem o tamanho do time): como chamar a pessoa e o que ela quer
 * que os bots façam, com chips. "Pular as perguntas" no topo. As respostas vão ao servidor junto da etapa
 * 'configurando' (a mesma ação `onboarding.etapa`); depois vêm os cards guiados de sempre.
 */
export const CHIPS_OBJETIVO = ["Atender clientes por e-mail", "Organizar minha agenda", "Cuidar do financeiro", "Mexer em código", "Só quero olhar"] as const;
/** O chip que não monta bot: a pessoa só quer olhar a plataforma. */
export const SO_OLHAR = "Só quero olhar";

export type PassoTexto = { passo: "apelido" } | { passo: "objetivo"; apelido: string | null } | { passo: "enviando"; apelido: string | null; objetivo: string | null };

/** O nome do e-mail ("ana.souza@x.com" → "Ana"): a sugestão da primeira pergunta. Null se não parece nome. */
export function nomeDoEmail(email: string | null | undefined): string | null {
  const local = (email ?? "").split("@")[0]?.split(/[._+-]/)[0] ?? "";
  if (!/^[\p{L}]{2,30}$/u.test(local)) return null;
  return local[0]!.toLocaleUpperCase("pt-BR") + local.slice(1).toLocaleLowerCase("pt-BR");
}

const fala = (texto: string) => `<div class="ct-fala"><b>Nod</b><p>${esc(texto)}</p></div>`;

export function htmlConversaTexto(p: PassoTexto, v: { sugestao: string | null; ocupado: boolean; erro: string | null }): string {
  const pular = `<button type="button" class="ob-link ct-pular" data-act="texto-pular"${v.ocupado ? " disabled" : ""}>Pular as perguntas</button>`;
  const erro = v.erro ? `<p class="cc-erro" role="alert">${esc(v.erro)}</p>` : "";
  let corpo: string;
  if (p.passo === "apelido") {
    const pergunta = v.sugestao ? `Oi! Eu sou o Nod. Antes de montar seus bots, duas perguntas rápidas. Posso te chamar de ${v.sugestao}?` : "Oi! Eu sou o Nod. Antes de montar seus bots, duas perguntas rápidas. Como posso te chamar?";
    const sim = v.sugestao ? `<button type="button" class="bt pri" data-act="texto-apelido-sim"${v.ocupado ? " disabled" : ""}>Pode, sim</button>` : "";
    corpo = `${fala(pergunta)}<div class="ct-resposta">${sim}<form data-form="texto-apelido" class="ct-form"><label class="cc-campo">${v.sugestao ? "Prefiro outro nome" : "Seu nome"}<input name="apelido" autocomplete="given-name" maxlength="60" required></label><button type="submit" class="bt"${v.ocupado ? " disabled" : ""}>Enviar</button></form></div>`;
  } else {
    const quem = p.apelido ? `Prazer, ${p.apelido}! ` : "";
    const chips = CHIPS_OBJETIVO.map((c) => `<button type="button" class="ct-chip" data-act="texto-objetivo" data-valor="${esc(c)}"${v.ocupado ? " disabled" : ""}>${esc(c)}</button>`).join("");
    corpo = `${fala(`${quem}O que você quer que os bots façam por você?`)}<div class="ct-resposta"><div class="ct-chips" role="group" aria-label="Sugestões">${chips}</div><form data-form="texto-objetivo" class="ct-form"><label class="cc-campo">Ou escreva com suas palavras<input name="objetivo" maxlength="500" required></label><button type="submit" class="bt"${v.ocupado ? " disabled" : ""}>Enviar</button></form></div>`;
  }
  return `<div class="ct-conversa" role="group" aria-label="Conversa com o Nod" data-passo="${p.passo}"><div class="ct-topo">${pular}</div>${corpo}${erro}</div>`;
}

/** A linha que fica na conversa do Nod quando a pessoa pula (ou só quer olhar): onde achar os bots depois. */
export const LINHA_PULOU = "Tudo bem. Quando quiser montar um bot, me diga aqui o que ele deve fazer, ou use Novo bot na barra lateral.";
