import type { Estado } from "../estado/reducer.ts";
import { botao, esc, iconeAgente } from "../lib/render.ts";

export function renderNovoBot(estado: Estado): string {
  return `<section class="tela novo-contato"><h1>Nova conversa</h1>
    <label class="search"><span>Para:</span><input id="busca-destinatario" placeholder="Buscar ou criar bots" aria-label="Buscar ou criar bots" autocomplete="off" /></label>
    <div class="contact-picker">
      ${botao("criar-rapido", "<span class=picker-icon>＋</span><span>Criar novo bot<small>Conheça seu próximo parceiro</small></span>", { classe: "picker-row" })}
      ${botao("navegar", "<span class=picker-icon>♧</span><span>Criar chat em grupo<small>Reúna seus bots em uma sala</small></span>", { classe: "picker-row", dados: { tela: "nova-sala" } })}
      ${(estado.frota?.agentes ?? []).map((a) => `<button class="picker-row" data-busca="${esc(a.nome.toLowerCase())}" data-act="abrir-conversa" data-conversa="${esc(a.conversaId)}" data-agente="${esc(a.id)}">${iconeAgente(a)}<span>${esc(a.nome)}<small>${esc(a.titulo)}</small></span></button>`).join("")}
    </div></section>`;
}
