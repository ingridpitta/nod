import { renderMarketplace } from "./marketplace.ts";
import type { Estado } from "../estado/reducer.ts";
import { avatarAgente, botao, esc, hora } from "../lib/render.ts";
import { haQuanto } from "../lib/relogio.ts";
import type { NomeCapacidadeGithub } from "../../src/contracts/github.ts";
import { falhaVisivel } from "../lib/fora-do-ar.ts";

/**
 * definido em 2026-09-24 (ADR-048): o que o GitHub nativo sabe fazer, para dizer o que o jeito de
 * conectar em uso NÃO cumpre (o Composio não tem diff nem checks). Record: faltar um nome não compila.
 */
const CAPACIDADES_GITHUB: Record<NomeCapacidadeGithub, true> = { pr_ver: true, pr_diff: true, pr_arquivos: true, pr_comentarios: true, pr_checks: true, arquivo_ler: true, issue_ver: true, pr_comentar: true, pr_revisar: true };

function nativo(c: { comando: string | null }): boolean {
  return c.comando?.startsWith("nod:") === true;
}

/**
 * Conectores (E6, ADR-013/015): registrar (nasce desabilitado; env fica cifrado no servidor e a web
 * só vê chaves → true), sondar (catálogo com readOnlyHint), habilitar/desabilitar e conceder POR BOT
 * E POR CAPACIDADE — a concessão nasce com a mensagem de consentimento na conversa do bot.
 */
function indisponiveis(tem: readonly string[]): string {
  const faltam = Object.keys(CAPACIDADES_GITHUB).filter((n) => !tem.includes(n));
  return faltam.length ? `<p class="mudo">Indisponível neste jeito de conectar: ${faltam.map((n) => `<code>${esc(n)}</code>`).join(", ")}. Com o gh desta máquina ou um token pessoal, tudo fica disponível.</p>` : "";
}

/**
 * definido em 2026-09-24 (ADR-048): o GitHub conecta sozinho pelo gh desta máquina; o token pessoal
 * fica recolhido em "Avançado" para quem não tem gh. O valor nunca volta: só a marca de que existe.
 * revisto em 2026-09-25: mora na tela avançada, junto da chave do Composio.
 */
function avancadoGithub(temToken: boolean): string {
  return `<details class="github-avancado"><summary>GitHub: token pessoal${temToken ? " · ✓ guardado" : ""}</summary><form class="form" data-form="token-github"><label>Token do GitHub<input type="password" name="token" required autocomplete="off" placeholder="ghp_… ou github_pat_…" /></label><button class="bt" type="submit">Guardar e verificar</button></form><small>Use quando esta máquina não tem o gh logado. O token fica cifrado neste servidor e os comentários saem em nome da conta dele.</small></details><details class="github-avancado"><summary>GitHub da organização (rotinas no servidor)</summary><form class="form" data-form="app-github"><label>App ID<input name="appId" inputmode="numeric" required autocomplete="off" /></label><label>ID da instalação<input name="instalacaoId" inputmode="numeric" required autocomplete="off" /></label><label>Chave privada (.pem)<textarea name="chavePrivada" rows="3" required autocomplete="off" placeholder="-----BEGIN RSA PRIVATE KEY-----"></textarea></label><button class="bt" type="submit">Guardar e verificar</button></form><small>Só para quem administra o GitHub da organização (NOD_ADMINS). Só ROTINAS usam o App, e só de quem não tem gh, token nem Composio; os comentários saem em nome do App. A chave fica cifrada e nunca volta para a tela.</small></details>`;
}

function composio(configurado: boolean): string {
  return `<details class="composio-setup"${configurado ? "" : " open"}><summary>${configurado ? "✓ Composio configurado · alterar chave" : "Chave do Composio do time"}</summary><p>A chave do projeto Composio é do time: uma pessoa configura e todos conectam os próprios apps.</p><form class="form composio-form" data-form="configurar-composio"><label>Chave do projeto<input type="password" name="chave" required autocomplete="off" placeholder="Cole a chave do Composio" /></label><button class="bt pri" type="submit">Salvar e verificar</button></form><a href="https://platform.composio.dev" target="_blank" rel="noopener noreferrer">Abrir Composio ↗</a><small>A chave fica cifrada neste servidor. O Composio gerencia os logins dos apps.</small></details>`;
}

/**
 * Marketplace (a tela de sempre) ou a tela AVANÇADA (definido em 2026-09-25): chave do Composio, GitHub
 * por token ou App, MCP próprio, catálogos e concessão por ação — o que antes ficava embaixo da grade.
 */
export function renderConectores(estado: Estado): string {
  const t = estado.tela.tipo === "conectores" ? estado.tela : null;
  if (!t?.avancado) return `<section class="tela tela-conectores">${renderMarketplace(estado)}</section>`;
  const temToken = estado.conectores.some((c) => c.slug === "github" && c.ownerId === estado.sessao?.pessoaId && c.env.GITHUB_TOKEN === true);
  const agentes = estado.frota?.agentes ?? [];
  const cartoes = estado.conectores
    .map((c) => {
      const falha = c.ultimaFalha && falhaVisivel(c) ? `<div class="negacao negacao-conector_indisponivel">conector ${esc(c.slug)} indisponível: ${esc(c.ultimaFalha.causa === "acesso_recusado" ? "recusou o acesso" : c.ultimaFalha.motivo === "timeout_transporte" ? "a conexão com o app demorou demais" : c.ultimaFalha.motivo.replaceAll("_", " "))} desde ${hora(c.ultimaFalha.em)} (${haQuanto(estado.agora - c.ultimaFalha.em)})</div>` : "";
      const catalogo = c.catalogo.length
        ? `<ul class="catalogo">${c.catalogo.map((cap) => `<li><code>${esc(cap.nome)}</code> <span class="tag ${cap.readOnlyHint ? "tag-cinza" : "tag-ambar"}">${cap.readOnlyHint ? "só leitura" : "efeito externo"}</span> <span class="mudo">${esc(cap.descricao)}</span></li>`).join("")}</ul>`
        : '<p class="mudo">catálogo vazio — sonde para descobrir as ferramentas</p>';
      const conceder = c.catalogo.length && agentes.length
        ? `<form class="form linha" data-form="conceder" data-id="${esc(c.id)}">
            <select name="agenteId">${agentes.map((a) => `<option value="${esc(a.id)}">${esc(a.nome)}</option>`).join("")}</select>
            <select name="capacidade">${c.catalogo.map((cap) => `<option value="${esc(cap.nome)}">${esc(cap.nome)}</option>`).join("")}</select>
            <button class="bt pri" type="submit" data-act="conceder">Conceder</button>
          </form>`
        : "";
      const concedidas = agentes
        .flatMap((a) => (estado.concessoes[a.id] ?? []).filter((g) => g.conectorId === c.id).map((g) => `<li>${avatarAgente(a, "sm")} ${esc(a.nome)} · <code>${esc(g.capacidade)}</code> ${botao("revogar", "revogar", { classe: "sm", id: g.id, dados: { agente: a.id } })}</li>`))
        .join("");
      return `<li class="conector" data-conector="${esc(c.id)}">
        <div class="cn-cab"><b>${esc(c.nome)}</b> <code>${esc(c.slug)}</code> <span class="tag">${esc(c.transporte)}</span> <span class="tag ${c.habilitado ? "tag-ok" : "tag-cinza"}">${c.habilitado ? "habilitado" : "desabilitado"}</span> <span class="tag ${c.declaracao === "nao-toca" ? "tag-cinza" : "tag-ambar"}">${esc(c.declaracao === "nao-toca" ? "não toca dado pessoal" : c.declaracao === "toca" ? "toca dado pessoal" : "não declarou = toca")}</span>${c.sondadoEm ? `<span class="mudo">sondado ${hora(c.sondadoEm)}</span>` : ""}</div>
        <div class="mudo">${nativo(c) ? "conector do próprio nod · o jeito de conectar é escolhido sozinho (gh desta máquina, token, Composio)" : esc(c.transporte === "stdio" ? `${c.comando ?? ""} ${c.args.join(" ")}` : (c.url ?? ""))} · env: ${esc(Object.keys(c.env).join(", ") || "—")} (valores só no servidor)</div>
        ${falha}
        ${catalogo}
        ${nativo(c) && c.catalogo.length ? indisponiveis(c.catalogo.map((cap) => cap.nome)) : ""}
        <div class="acoes">${botao("sondar-conector", "Sondar", { id: c.id })}${c.habilitado ? botao("desabilitar-conector", "Desabilitar", { id: c.id }) : botao("habilitar-conector", "Habilitar", { id: c.id, titulo: "exige catálogo sondado" })}</div>
        ${nativo(c) ? "" : `<details><summary>Atualizar credenciais do MCP</summary><form class="form" data-form="credenciais-conector" data-id="${esc(c.id)}"><label>Novas credenciais (JSON)<textarea name="env" rows="2" required autocomplete="off" placeholder='{"Authorization":"Bearer …"}'></textarea></label><p class="mudo">Substitui as credenciais atuais. Depois de salvar, use Sondar para verificar e reativar a conexão.</p><button class="bt" type="submit">Salvar credenciais</button></form></details>`}
        ${conceder}
        ${concedidas ? `<ul class="lista">${concedidas}</ul>` : ""}
      </li>`;
    })
    .join("");
  return `<section class="tela tela-conectores tela-avancado">
    ${botao("navegar-marketplace", "← Marketplace", { classe: "link" })}
    <h1>Configurações avançadas</h1>
    ${estado.avisoConexao ? `<p class="connection-notice" role="status">${esc(estado.avisoConexao)}</p>` : ""}
    ${composio(estado.composioConfigurado)}
    ${avancadoGithub(temToken)}
    <h2 class="marketplace-heading">Seus MCPs e permissões</h2>
    <details class="registrar"><summary>＋ Adicionar servidor MCP próprio</summary>
      <form class="form" data-form="registrar-conector">
        <label>Nome <input name="nome" required placeholder="Exemplo" /></label>
        <label>Slug <input name="slug" required pattern="[a-z0-9][a-z0-9-]*" placeholder="exemplo" /></label>
        <label>Transporte <select name="transporte"><option value="stdio">stdio</option><option value="http">http</option></select></label>
        <label>Comando (stdio) <input name="comando" placeholder="node" /></label>
        <label>Args (um por linha) <textarea name="args" rows="2" placeholder="scripts/mcp-exemplo.mjs"></textarea></label>
        <label>URL (http) <input name="url" placeholder="http://127.0.0.1:1234/mcp" /></label>
        <label>Credenciais (JSON: env no stdio, headers no HTTP; cifradas) <textarea name="env" rows="2" placeholder='{"TOKEN":"…"}'></textarea></label>
        <label>Declaração <select name="declaracao"><option value="nao-toca">não toca dado pessoal</option><option value="toca">toca dado pessoal</option><option value="nao-declarou">não declaro (= toca)</option></select></label>
        <button class="bt pri" type="submit" data-act="registrar-conector">Registrar (nasce desabilitado)</button>
      </form>
    </details>
    ${estado.conectores.length ? `<ul class="lista">${cartoes}</ul>` : '<p class="mudo">Você também pode conectar ferramentas próprias por URL ou comando local.</p>'}
  </section>`;
}
