/**
 * O que a saída de um CLI de IA diz sobre o PRÓPRIO CLI, e não sobre a conta (definido em 2026-10-09, teste do Breno).
 * Puro: quem roda o processo passa o stderr/stdout; aqui só se reconhece o padrão. Os textos foram medidos:
 *  - sem node: o `#!/usr/bin/env node` do `codex` instalado por npm, num PATH sem node, sai com 127 e
 *    "env: node: No such file or directory" (macOS, Codex 0.162.1 instalado pelo app, 2026-10-09);
 *  - config com erro: `codex login status` com um ~/.codex/config.toml quebrado sai com 1 e
 *    "Error loading configuration: <arquivo>:1:9: …" (Codex 0.147.0, 2026-10-09). Chave desconhecida SEM
 *    `--strict-config` é ignorada pelo CLI; com ela (o turno do nod), quem trata é negociarConfigCodex.
 */

/** O processo não achou o node para rodar o script do CLI. */
export function faltaNode(texto: string): boolean {
  return /env: ['‘’"]?node['‘’"]?: No such file or directory|(?:^|\s)node: (?:command )?not found|exec: node: not found/im.test(texto);
}

/**
 * O sistema não deixou gravar onde o CLI está instalado (NOD-9): o npm sem acesso à pasta global, o `claude update` de
 * uma instalação do sistema. Vale para o instalador do nod e para a atualização; é o que leva ao passo seguinte.
 */
export function falhaPorPermissao(texto: string): boolean {
  return /\bEACCES\b|\bEPERM\b|permission denied|(?:isn't|not) writable/i.test(texto);
}

/**
 * O CLI recusou a configuração da pessoa (não é falta de login). A recusa de uma chave passada pelo próprio nod
 * ("… in -c/--config override", a negociação de codex-comum.ts) não conta: essa é do nod, não da pessoa.
 */
export function configInvalida(texto: string): boolean {
  if (/-c\/--config override/i.test(texto)) return false;
  return /error loading config(?:uration)?\b|failed to (?:load|parse) (?:the )?config(?:uration)?\b|invalid configuration file/i.test(texto);
}

/** A frase de cada caso, para quem lê o inventário (o motivo); o código fechado vai na `causa`. */
export function motivoSemNode(nome: string): string {
  return `O ${nome} deste Mac precisa do Node.js, que não foi encontrado. Instale o ${nome} pelo nod ou instale o Node.js.`;
}
export function motivoConfigInvalida(nome: string, arquivo: string): string {
  return `A configuração do ${nome} (${arquivo}) tem um erro e o ${nome} não abre. Corrija ou renomeie o arquivo e verifique de novo.`;
}
