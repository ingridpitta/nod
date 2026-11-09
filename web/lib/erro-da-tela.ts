import { ErroApi, ehAbort } from "./erro-api.ts";
import { ehCodigoDeRede } from "./tentar-de-novo.ts";

/**
 * O erro como a tela o guarda (definido em 2026-10-13, NOD-215). A pessoa lê `mensagem` — a frase do servidor ou uma
 * das frases fechadas da web, nunca `err.message` de uma exceção (ADR-002). O resto só aparece em "Detalhes", para quem
 * depura: tipo da falha, rota, status HTTP e o correlation_id que liga a tela à linha de log do servidor (ADR-041).
 */
export type ErroNaTela = {
  codigo: string;
  mensagem: string;
  correlationId?: string | null;
  status?: number | null;
  rota?: string | null;
  /** Só em `acao_nao_concluida`: a falha de rede que derrubou a ação (sem_internet | servidor_indisponivel). */
  causa?: string | null;
};

/** Exceção da própria web (TypeError etc.): é bug nosso, não a conexão da pessoa. */
export const FRASE_ERRO_DA_TELA = "Algo deu errado nesta tela. Relate o problema para a gente corrigir.";
/**
 * Revisão NOD-215: a AÇÃO da pessoa que caiu por rede e não vai mais ser repetida (mutação sem chave, ou a que esgotou as
 * tentativas). Não é o "Reconectando…" que some sozinho: ninguém vai refazê-la, e a resposta perdida não prova que ela
 * não aconteceu — a frase diz isso e o banner fica até ela fechar.
 */
export const FRASE_ACAO_SEM_RESPOSTA = "O servidor não respondeu e a ação pode não ter sido concluída. Confira e tente de novo.";
export const FRASE_ACAO_SEM_INTERNET = "Seu dispositivo está sem internet e a ação não foi concluída. Tente de novo quando a conexão voltar.";

/**
 * O que se registra de uma exceção da web: nome, primeira linha da pilha, a pilha curta e a rota da tela. Nunca a
 * mensagem (pode trazer texto da pessoa, token, URL com segredo), nunca query/fragmento de URL.
 */
export type RegistroErroCliente = { nome: string; origem: string | null; pilha: string[]; rota: string | null };

/** Quadros da pilha que vão no registro (os primeiros bastam para achar o bug). */
export const QUADROS_NO_REGISTRO = 5;
/** Limite de registros distintos por janela e por carga da página: um bug que muda de origem não vira enxurrada. */
export const REGISTROS_POR_MINUTO = 5;
export const REGISTROS_POR_CARGA = 20;

const NOME_SEGURO = /^[A-Za-z_$][\w$.]{0,59}$/;
/**
 * Quadro de pilha: V8 (`at f (url:1:2)`), Firefox/Safari (`f@url:1:2`). Linha da mensagem (multilinha) e o cabeçalho
 * `Nome: mensagem` ficam de fora. QA NOD-215: só `@` não basta (o cabeçalho `Error: a@b` passava); o quadro Firefox/Safari
 * termina em `:linha:coluna`.
 */
const QUADRO = /^at\s|@.*:\d+:\d+$/;

/**
 * Tira query e fragmento de toda URL do quadro (token em `?t=`), mantendo `:linha:coluna`. QA NOD-215: o corte vai até o
 * `:linha:coluna` final (ou `)`/espaço), não até o primeiro `@` ou `:` — `?u=a@b` e `?t=12:34` vazavam o resto do valor.
 */
export function quadroLimpo(linha: string): string {
  return linha.replace(/[?#][^\s)]*?(?=(?::\d+){1,2}(?:\)|$)|[\s)]|$)/g, "").slice(0, 200);
}

export function registroDe(e: unknown, rota: string | null): RegistroErroCliente {
  const nomeCru = e instanceof Error ? e.name : typeof e;
  const nome = NOME_SEGURO.test(nomeCru) ? nomeCru : "ErroSemNome";
  const mensagem = e instanceof Error ? e.message.trim() : "";
  const linhas = e instanceof Error && typeof e.stack === "string" ? e.stack.split("\n").map((l) => l.trim()) : [];
  // Só os quadros: o cabeçalho (e a mensagem multilinha) repete err.message; por garantia, linha que contém um pedaço da
  // mensagem também sai.
  const pedacos = mensagem.split("\n").map((l) => l.trim()).filter((l) => l.length >= 4);
  const pilha = linhas
    .filter((l) => l !== "" && QUADRO.test(l) && !pedacos.some((p) => l.includes(p)))
    .slice(0, QUADROS_NO_REGISTRO)
    .map(quadroLimpo);
  return { nome, origem: pilha[0] ?? null, pilha, rota };
}

/** O que vai para `reportError`: um Error NOVO só com nome, origem e pilha curta — nunca a exceção original. */
export function erroParaRelatar(r: RegistroErroCliente): Error {
  const e = new Error(`${r.nome} na tela ${r.rota ?? "?"}${r.origem ? ` (${r.origem})` : ""}`);
  e.name = "ErroDaTela";
  e.stack = [`${e.name}: ${e.message}`, ...r.pilha.map((l) => `    ${l}`)].join("\n");
  return e;
}

/**
 * Registra cada exceção UMA vez por (nome, origem): um erro dentro do render se repete a cada quadro e não pode virar
 * enxurrada nem laço. Além disso, no máximo REGISTROS_POR_MINUTO assinaturas novas por minuto e REGISTROS_POR_CARGA por
 * carga da página. O destino recebe só o registro limpo (main.ts manda `erroParaRelatar(r)` para `reportError`, que cai
 * no console do navegador e no log do renderer do app do Mac sem `console.*` — AGENTS.md).
 */
export function criarRegistroDeErros(destino: (r: RegistroErroCliente) => void, agora: () => number = Date.now): (e: unknown, rota: string | null) => void {
  const vistos = new Set<string>();
  let janela: number[] = [];
  return (e, rota) => {
    const r = registroDe(e, rota);
    const chave = `${r.nome}|${r.origem ?? ""}`;
    if (vistos.has(chave) || vistos.size >= REGISTROS_POR_CARGA) return;
    const t = agora();
    janela = janela.filter((x) => t - x < 60_000);
    if (janela.length >= REGISTROS_POR_MINUTO) return;
    vistos.add(chave);
    janela.push(t);
    try {
      destino(r);
    } catch {
      // Registrar nunca derruba a tela.
    }
  };
}

/**
 * Traduz o que um `catch` pegou para o erro da tela. `null` = nada a mostrar (AbortError: a navegação cancelou).
 * - `ErroApi` segue como veio (frase do servidor ou das falhas de rede de api.ts);
 * - qualquer outra coisa é erro da web: `erro_da_tela`, frase de erro interno com "Relatar", e a exceção registrada.
 */
export function erroDe(e: unknown, registrar: (e: unknown, rota: string | null) => void, rotaDaTela: string | null = null): ErroNaTela | null {
  if (e instanceof ErroApi) return { codigo: e.codigo, mensagem: e.message, correlationId: e.correlationId, status: e.status, rota: e.rota };
  if (ehAbort(e)) return null;
  registrar(e, rotaDaTela);
  return { codigo: "erro_da_tela", mensagem: FRASE_ERRO_DA_TELA, rota: rotaDaTela };
}

/**
 * O erro de uma AÇÃO da pessoa (agir, gestão, conexão, onboarding). A falha de rede que chega aqui já não vai ser
 * repetida: vira `acao_nao_concluida` (banner com ×, não some sozinho), com a causa em "Detalhes". O resto segue igual.
 */
export function erroDaAcao(erro: ErroNaTela): ErroNaTela {
  if (!ehErroDeRede(erro)) return erro;
  const mensagem = erro.codigo === "sem_internet" ? FRASE_ACAO_SEM_INTERNET : FRASE_ACAO_SEM_RESPOSTA;
  return { ...erro, codigo: "acao_nao_concluida", mensagem, causa: erro.codigo };
}

export function ehErroDeRede(erro: ErroNaTela | null): boolean {
  return erro !== null && ehCodigoDeRede(erro.codigo);
}

/** A ação do reducer para um erro: o de rede vira "Reconectando…" (rede-caiu), o resto vai ao banner. */
export function acaoDoErro(erro: ErroNaTela): { tipo: "rede-caiu"; erro: ErroNaTela } | { tipo: "erro"; erro: ErroNaTela } {
  return ehErroDeRede(erro) ? { tipo: "rede-caiu", erro } : { tipo: "erro", erro };
}

/** A linha de "Detalhes": só o que ajuda a diagnosticar, em texto puro (quem renderiza escapa). */
export function detalhesDoErro(erro: ErroNaTela): string {
  const partes = [`tipo: ${erro.codigo}`];
  if (erro.causa) partes.push(`causa: ${erro.causa}`);
  if (erro.rota) partes.push(`rota: ${erro.rota}`);
  if (typeof erro.status === "number") partes.push(`status: ${erro.status === 0 ? "sem resposta" : erro.status}`);
  if (erro.correlationId) partes.push(`correlation_id: ${erro.correlationId}`);
  return partes.join(" · ");
}
