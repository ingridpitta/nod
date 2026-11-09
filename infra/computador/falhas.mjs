// definido em 2026-09-24 (emenda da ADR-037): o runtime responde com código FIXO, do mesmo enum do
// servidor (src/contracts/motivos.ts, MOTIVOS_FALHA_COMPUTADOR); o teste unitário compara as listas.
// Antes, qualquer erro virava "acao_falhou_observe_novamente" e a subida quebrada derrubava o
// processo — o Docker reiniciava em loop e ninguém via por quê.
export const CODIGOS_RUNTIME = ['nao_iniciou', 'cofre_invalido', 'navegador_nao_abriu', 'sem_resposta', 'acao_falhou', 'tela_alterada', 'ocupado'];

/** A 1ª linha não vazia, com até 200 caracteres. O servidor ainda redige antes de logar. */
export function primeiraLinha(texto) {
  const linha = String(texto ?? '').split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '');
  return linha ? linha.slice(0, 200) : null;
}

/** Erro de uma AÇÃO numa máquina viva: só a tela velha tem código próprio; o resto é acao_falhou. */
export function codigoDaAcao(erro) {
  return erro instanceof Error && erro.message === 'tela_alterada' ? 'tela_alterada' : 'acao_falhou';
}

/** Erro da SUBIDA: o código que o passo marcou, ou nao_iniciou. */
export function codigoDaSubida(erro) {
  const codigo = erro && typeof erro === 'object' ? erro.codigo : undefined;
  return CODIGOS_RUNTIME.includes(codigo) ? codigo : 'nao_iniciou';
}

/** Marca o erro de um passo da subida com o código que ele significa. */
export function falhaDe(codigo, erro) {
  return Object.assign(new Error(primeiraLinha(erro instanceof Error ? erro.message : erro) ?? codigo), { codigo });
}

/**
 * Travas do Chromium que um container anterior deixa no volume do perfil. Um container por volume
 * (ADR-037): quem as criou já morreu, e com elas o navegador não abre.
 */
export const TRAVAS_DO_PERFIL = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];

/** Limite para o navegador abrir; passou disso, a subida para em navegador_nao_abriu. */
export const PRAZO_NAVEGADOR_MS = 30000;
