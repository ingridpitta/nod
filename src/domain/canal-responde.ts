import type { PoliticaSala } from "../contracts/sala.ts";

/**
 * Procura "@Nome" como token: começa em '@', casa o nome inteiro (sem diferenciar maiúsculas) e o
 * caractere seguinte não é letra/dígito. Sem RegExp: nome com ']' ou '.' não quebra (Regra 9:
 * isto é comparação de dado tipado — o nome do membro — não interpretação de intenção).
 */
function mencionado(texto: string, nome: string): boolean {
  if (nome === "") return false;
  const t = texto.toLowerCase();
  const n = nome.toLowerCase();
  let i = t.indexOf("@");
  while (i !== -1) {
    const fim = i + 1 + n.length;
    if (t.slice(i + 1, fim) === n) {
      const seguinte = t[fim];
      if (seguinte === undefined || !ehAlfanumerico(seguinte)) return true;
    }
    i = t.indexOf("@", i + 1);
  }
  return false;
}

function ehAlfanumerico(c: string): boolean {
  return c.toLowerCase() !== c.toUpperCase() || (c >= "0" && c <= "9") || c === "_";
}

/**
 * Menção explícita vence nas três políticas (E12.1). Sem menção: 'lead' → o lead; 'todos' → todos;
 * 'so_mencoes' → ninguém. Só a PESSOA dispara resposta por política; fala de agente só por menção
 * (evita ricochete) — lê autorTipo, nunca infere (ADR-023).
 */
export function quemResponde(
  sala: { politica: PoliticaSala; leadAgenteId: string | null; membros: readonly string[]; nomes: Readonly<Record<string, string>> },
  mensagem: { texto: string; autorTipo: "pessoa" | "agente"; autorId?: string },
): string[] {
  const candidatos = sala.membros.filter((id) => id !== mensagem.autorId);
  const mencionados = candidatos.filter((id) => mencionado(mensagem.texto, sala.nomes[id] ?? ""));
  if (mencionados.length > 0) return mencionados;
  if (mensagem.autorTipo === "agente") return [];
  if (sala.politica === "todos") return [...candidatos];
  if (sala.politica === "lead") return sala.leadAgenteId && candidatos.includes(sala.leadAgenteId) ? [sala.leadAgenteId] : [];
  return [];
}
