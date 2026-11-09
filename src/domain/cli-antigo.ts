/**
 * A frase que a pessoa lê quando o CLI está instalado, mas abaixo do piso testado (NOD-171): nunca "Instale". Diz a
 * versão que está no Mac e a mínima, para a pessoa saber o que atualizar sem abrir terminal.
 */
export function motivoCliAntigo(nome: string, versao: string, minima: string): string {
  return `O ${nome} deste Mac (${versao}) é mais antigo que o testado pelo nod. Atualize para a versão ${minima} ou mais nova.`;
}

/**
 * A frase de quando o nod está atualizando o CLI naquela máquina (NOD-9, definido em 2026-10-22): o turno fixado espera
 * na fila e roda depois. Nunca "Instale" nem "não encontrado".
 */
export function motivoAtualizando(nome: string): string {
  return `Atualizando o ${nome}… Os pedidos para ele esperam e rodam assim que terminar.`;
}
