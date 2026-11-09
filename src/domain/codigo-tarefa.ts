/**
 * definido em 2026-11-02 (NOD-416, ADR-144): o código da tarefa. Cada quadro tem um prefixo (as 3 primeiras letras do
 * nome do bot anfitrião, sem acento, em maiúsculas; colisão no mesmo dono ganha 2, 3…) e cada tarefa um número
 * sequencial no quadro: `ZE-12`. O código não muda; ao mudar de quadro a tarefa ganha o do destino e o antigo continua
 * abrindo (a 0137 guarda todos). Puro: a mesma regra da migração, que fez o backfill.
 */

const ACENTOS: Record<string, string> = {
  á: "a", à: "a", â: "a", ã: "a", ä: "a", é: "e", è: "e", ê: "e", ë: "e", í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", õ: "o", ö: "o", ú: "u", ù: "u", û: "u", ü: "u", ç: "c", ñ: "n",
};

/** A raiz do prefixo: as 3 primeiras letras (A-Z) do nome, sem acento; sem letra nenhuma, `Q`. */
export function raizDoPrefixo(nome: string): string {
  const letras = [...nome]
    .map((c) => ACENTOS[c] ?? ACENTOS[c.toLowerCase()]?.toUpperCase() ?? c)
    .join("")
    .replace(/[^A-Za-z]/g, "");
  return letras.slice(0, 3).toUpperCase() || "Q";
}

/** O prefixo de um quadro novo: a raiz, ou a raiz + 2, 3… quando a pessoa já usa (em outro quadro ou num código antigo). */
export function prefixoDoNome(nome: string, usados: ReadonlySet<string>): string {
  const raiz = raizDoPrefixo(nome);
  if (!usados.has(raiz)) return raiz;
  for (let n = 2; ; n++) if (!usados.has(`${raiz}${n}`)) return `${raiz}${n}`;
}

export function formatarCodigo(prefixo: string, numero: number): string {
  return `${prefixo}-${numero}`;
}

/** Lê "ze-12", " ZE-12 " ou "#ZE-12". null = não tem cara de código. */
export function lerCodigo(texto: string): { prefixo: string; numero: number } | null {
  const m = /^#?([A-Za-z]{1,3}[0-9]*)-([1-9][0-9]{0,8})$/.exec(texto.trim());
  return m ? { prefixo: m[1]!.toUpperCase(), numero: Number(m[2]) } : null;
}

/**
 * O código que a tela mostra. A tarefa sem número (o servidor de antes a criou durante o deploy) ou do quadro sem prefixo
 * mostra o código de antes: o do Linear, ou `#` + 4 do id. O próximo lote do quadro numera.
 */
export function codigoDaTarefa(prefixo: string | null, t: { id: string; numero: number | null; linearId: string | null }): string {
  if (prefixo !== null && t.numero !== null) return formatarCodigo(prefixo, t.numero);
  return t.linearId ?? `#${t.id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

/** O branch sugerido: `ze-12-corrigir-o-login-do-mac` (minúsculas, sem acento, até 60 caracteres). */
export function branchSugerido(codigo: string, titulo: string): string {
  const semAcento = [...titulo.toLowerCase()].map((c) => ACENTOS[c] ?? c).join("");
  const slug = semAcento.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const base = codigo.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const tudo = slug ? `${base}-${slug}` : base;
  return tudo.length <= 60 ? tudo : tudo.slice(0, 60).replace(/-[^-]*$/, "") || tudo.slice(0, 60);
}
