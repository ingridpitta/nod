/**
 * Nome e iniciais de quem entra pela primeira vez por domínio admitido (emenda de 2026-10-05 da ADR-030).
 * O login pede só `openid email` ao Google, então o nome sai do endereço: "ana.souza@x.com" vira
 * "Ana Souza" / "AS". É provisório: o onboarding pergunta o apelido, que é o que os prompts usam (ADR-077).
 * null = endereço sem nenhuma letra ou dígito antes do "@"; quem chama recusa.
 */
export const NOME_MAX = 80;

export function identidadeDoEmail(email: string): { nome: string; iniciais: string } | null {
  const arroba = email.indexOf("@");
  if (arroba <= 0) return null;
  // "ana+nod@x.com" é a mesma caixa de "ana@x.com": a etiqueta não entra no nome.
  const local = (email.slice(0, arroba).split("+")[0] ?? "").toLowerCase();
  const partes = local.split(/[^a-z0-9]+/).filter((p) => p !== "");
  const primeira = partes[0];
  const ultima = partes[partes.length - 1];
  if (!primeira || !ultima) return null;
  const nome = partes
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ")
    .slice(0, NOME_MAX)
    .trimEnd();
  const iniciais = (partes.length > 1 ? primeira.charAt(0) + ultima.charAt(0) : primeira.slice(0, 2)).toUpperCase();
  return { nome, iniciais };
}
