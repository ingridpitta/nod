/**
 * NOD_ADMISSAO_DOMINIOS (emenda de 2026-10-05 da ADR-030): domínios Google Workspace cuja primeira entrada
 * cria a pessoa. Lista separada por vírgula; "@" na frente é tolerado. Vazio = ninguém é admitido pelo
 * domínio e só entra quem já está no cadastro.
 *
 * Valor inválido impede o boot, como NOD_LOGIN: um domínio digitado errado que fosse ignorado deixaria o
 * time de fora sem erro em lugar nenhum.
 */
const FORMA_DOMINIO = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * definido em 2026-10-05: provedores de e-mail aberto nunca são "o domínio de uma organização". O login já
 * exige a claim `hd` (que o Gmail não tem), então estes não entrariam; recusar aqui avisa quem configurou.
 */
const DOMINIOS_ABERTOS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"]);

export function lerDominiosAdmitidos(env: Readonly<Record<string, string | undefined>>): string[] {
  const dominios = new Set<string>();
  for (const bruto of (env.NOD_ADMISSAO_DOMINIOS ?? "").split(",")) {
    const d = bruto.trim().toLowerCase().replace(/^@/, "");
    if (d === "") continue;
    if (!FORMA_DOMINIO.test(d)) throw new Error(`NOD_ADMISSAO_DOMINIOS: "${d}" não é um domínio (exemplo: acme.com.br)`);
    if (DOMINIOS_ABERTOS.has(d)) throw new Error(`NOD_ADMISSAO_DOMINIOS: "${d}" é e-mail aberto a qualquer pessoa; use o domínio da organização`);
    dominios.add(d);
  }
  return [...dominios].sort();
}
