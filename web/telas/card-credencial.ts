import type { PayloadPropostaCredencial, Proposta } from "../../src/contracts/conversa.ts";
import { esc } from "../lib/render.ts";

/**
 * O cartão de pedido de credencial (definido em 2026-10-28, NOD-50; protótipo nod-prototipos/nod-50). O bot chamou
 * pedir_credencial; a pessoa cola a chave num campo de senha e o valor vai direto ao cofre (POST
 * propostas/:id/credencial). O VALOR MORA SÓ NO CAMPO DA TELA: nada no estado do app, no armazenamento do navegador ou
 * na conversa. Aqui fica só a fase da UI de cada cartão (ocupado, qual erro), sem o valor.
 */

export type FaseCredencial = { ocupado: boolean; erro: ErroDoCartao | null; mostrando?: boolean };
export type ErroDoCartao = "vazio" | "recusada" | "formato" | "indisponivel" | "rede" | "resolvido";

const fases = new Map<string, FaseCredencial>();
let versao = 0;

/**
 * Muda a cada `marcarFase`. A conversa desenha o histórico por `lembrar` (web/lib/lembrar.ts), que só enxerga o estado
 * do app; a fase mora aqui fora, então entra nos extras dessa lembrança. Sem isso o erro e o "Guardando…" só
 * apareciam depois de sair e voltar (QA do PR 553).
 */
export function versaoDasFases(): number {
  return versao;
}

export function faseDoCartao(id: string): FaseCredencial {
  return fases.get(id) ?? { ocupado: false, erro: null };
}

export function marcarFase(id: string, fase: FaseCredencial | null): void {
  if (fase === null) fases.delete(id);
  else fases.set(id, fase);
  versao++;
}

/** O que o erro da rota vira no cartão: o código, nunca a mensagem crua. */
export function erroDaResposta(status: number | null, codigo: string | null): ErroDoCartao {
  if (status === null) return "rede";
  if (codigo === "integracao_autenticacao") return "recusada";
  if (codigo === "entrada_invalida") return "formato";
  if (codigo === "estado_invalido" || codigo === "nao_encontrado") return "resolvido";
  return "indisponivel";
}

export function tituloDoCartao(p: PayloadPropostaCredencial): string {
  return p.alvo === "github_token" ? "Token do GitHub" : p.alvo === "composio" ? "Chave do Composio do time" : `Chave para ${p.app}`;
}

function fraseDoErro(p: PayloadPropostaCredencial, erro: ErroDoCartao): string {
  const coisa = p.alvo === "github_token" ? "o token" : "a chave";
  const app = p.alvo === "github_token" ? "GitHub" : p.alvo === "composio" ? "Composio" : p.app;
  switch (erro) {
    case "vazio": return `Cole ${coisa} antes de guardar.`;
    case "recusada": return `O ${app} recusou ${p.alvo === "github_token" ? "esse token" : "essa chave"}. Confira se copiou inteira e cole de novo.`;
    case "formato": return p.alvo === "github_token" ? "Isso não parece um token do GitHub. Ele começa com ghp_ ou github_pat_." : `Isso não parece ${coisa}: confira se não colou espaço ou quebra de linha.`;
    case "indisponivel": return `O ${app} não respondeu agora. Tente de novo em instantes.`;
    case "rede": return `Não deu para confirmar se ${coisa} foi ${p.alvo === "github_token" ? "guardado" : "guardada"}. Tente de novo.`;
    case "resolvido": return "Esse pedido já foi resolvido ou venceu.";
  }
}

const ICONE_CHAVE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M17 6l2.5 2.5M14.5 8.5 16.5 10.5"/></svg>';
const ICONE_CADEADO = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

/**
 * O cartão aberto (quem chama só o desenha com a decisão aberta; fechada ou vencida, o recibo encolhido ou o Reabrir de Sua
 * vez ocupam o lugar). `local` separa os ids do mesmo cartão na conversa e em Sua vez (os dois podem estar no DOM).
 * autocomplete="off" + data-1p-ignore/data-lpignore: não é senha do nod — o gerenciador não oferece, não gera nem salva
 * (uma senha gerada ali viraria uma "chave" inválida; revisão 4 do PR #553).
 */
export function renderCardCredencial(p: Proposta & { payload: PayloadPropostaCredencial }, agente: string, local: "c" | "sv" = "c"): string {
  const c = p.payload;
  const id = esc(p.id);
  const base = `cr-${local}-${id}`;
  const fase = faseDoCartao(p.id);
  const erro = fase.erro ? `<p class="p50-erro" id="${base}-erro" role="alert">${esc(fraseDoErro(c, fase.erro))}</p>` : "";
  const rotulo = c.alvo === "github_token" ? "Token pessoal" : c.alvo === "composio" ? "Chave da API" : `Chave <code>${esc(c.chave ?? "")}</code>`;
  const dica = c.alvo === "github_token" ? "ghp_… ou github_pat_…" : c.chave?.toLowerCase() === "authorization" ? "Cole só o token (o Bearer de antes se mantém)" : "Cole a chave aqui";
  const coisa = c.alvo === "github_token" ? "o token" : "a chave";
  const invalido = fase.erro === "vazio" || fase.erro === "recusada" || fase.erro === "formato";
  const guardar = fase.ocupado ? "Guardando…" : fase.erro === "rede" || fase.erro === "indisponivel" ? "Tentar de novo" : "Guardar";
  const app = c.alvo === "github_token" ? "GitHub" : c.alvo === "composio" ? "Composio" : c.app;
  return `<form class="p50-cartao" role="group" aria-labelledby="${base}-t" data-proposta="${id}" data-decisao="${id}" data-form="guardar-credencial" data-id="${id}" novalidate>
    <div class="p50-cab"><span class="p50-ic">${ICONE_CHAVE}</span><h3 class="p50-titulo" id="${base}-t">${esc(tituloDoCartao(c))}</h3></div>
    <p class="p50-para">${esc(c.para)}</p>
    <label class="cc-campo p50-campo" for="${base}-v"><span class="p50-rotulo">${rotulo}</span><span class="cc-senha p50-senha"><input id="${base}-v" type="${fase.mostrando ? "text" : "password"}" name="valor" data-resposta="valor" autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" maxlength="4096" placeholder="${esc(dica)}"${fase.ocupado ? " readonly" : ""}${invalido ? ` aria-invalid="true" aria-describedby="${base}-erro"` : ""} /><button type="button" class="cc-mostrar p50-mostrar" data-act="mostrar-credencial" data-id="${id}" aria-pressed="${fase.mostrando === true}" aria-controls="${base}-v">${fase.mostrando ? "Ocultar" : "Mostrar"}</button></span></label>
    ${erro}${fase.ocupado ? `<p class="p50-status" role="status">Guardando e testando o ${esc(app)}…</p>` : ""}
    <p class="p50-sigilo">${ICONE_CADEADO}Vai direto para o cofre. ${esc(agente)} não vê ${coisa}.</p>
    <div class="p50-acoes">${fase.ocupado ? "" : `<button type="button" class="p50-deixar" data-act="recusar-credencial" data-id="${id}">Deixar de lado</button>`}<button type="submit" class="p50-guardar" data-id="${id}"${fase.ocupado ? ' aria-busy="true" disabled' : ""}>${guardar}</button></div>
  </form>`;
}

export function ehCartaoCredencial(p: Proposta | null | undefined): p is Proposta & { payload: PayloadPropostaCredencial } {
  return p?.payload.kind === "credencial";
}
