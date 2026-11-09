import type { Estado } from "../estado/reducer.ts";
import { avatarAgente, botao, esc } from "../lib/render.ts";

/** Sala (2–6 bots, ADR-027): cabeçalho com membros, lead e Parar agora; @autocomplete vem do composer. */
export function renderCabecalhoSala(estado: Estado, salaId: string): string {
  const s = estado.salas.find((x) => x.sala.id === salaId);
  if (!s) return `<div class="cab-esq"><span class="nome">sala</span></div>`;
  const membros = s.membros
    .filter((m) => m.removidoEm === null)
    .map((m) => {
      const a = estado.frota?.agentes.find((x) => x.id === m.agenteId);
      const lead = m.agenteId === s.sala.leadAgenteId ? " (lead)" : "";
      return a ? `<span class="membro" title="${esc(a.nome)}${lead}">${avatarAgente(a, "sm")}${esc(a.nome)}${lead}</span>` : `<span class="membro mudo">bot de outra pessoa</span>`;
    })
    .join("");
  return `<div class="cab-esq"><span class="nome">#${esc(s.sala.nome)}</span><span class="tag">política: ${esc(s.sala.politica.replaceAll("_", " "))}</span><div class="membros">${membros}</div></div>
    <div class="cab-acoes">${botao("parar-sala", "Parar agora", { classe: "perigo", id: salaId, titulo: "interrompe todos os turnos desta sala" })}</div>`;
}

export function nomesDosMembros(estado: Estado, salaId: string): string[] {
  const s = estado.salas.find((x) => x.sala.id === salaId);
  if (!s) return [];
  return s.membros.filter((m) => m.removidoEm === null).map((m) => estado.frota?.agentes.find((a) => a.id === m.agenteId)?.nome ?? "").filter(Boolean);
}

/** Lista de salas (sidebar) e o formulário de criação: escolha de 2 a 6 bots com nome. */
export function renderNovaSala(estado: Estado): string {
  const agentes = estado.frota?.agentes ?? [];
  const opcoes = agentes.map((a) => `<label class="opcao"><input type="checkbox" name="agenteIds" value="${esc(a.id)}" /> ${avatarAgente(a, "sm")} ${esc(a.nome)}</label>`).join("");
  return `<section class="tela tela-nova-sala">
    <header class="tela-cab"><h1>Nova sala</h1><span class="chip">2 a 6 bots · entre os selecionados, o primeiro da lista lidera</span></header>
    <form class="form" data-form="criar-sala">
      <label>Nome <input name="nome" placeholder="revisão" required maxlength="60" /></label>
      <div class="opcoes">${opcoes || '<p class="mudo">Crie ao menos dois bots primeiro.</p>'}</div>
      <button class="bt pri" type="submit" data-act="criar-sala">Criar sala</button>
    </form>
  </section>`;
}
