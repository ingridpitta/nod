import type { FrotaDto } from "../../src/contracts/api.ts";
import type { PayloadPropostaPasta, Proposta } from "../../src/contracts/conversa.ts";
import type { Estado } from "../estado/reducer.ts";
import { botao, esc } from "../lib/render.ts";
import { mudouQuando } from "../lib/relogio.ts";

/**
 * definido em 2026-09-25 (card de pasta simplificado, mockup "Pasta do projeto" no canvas do nod): o
 * card listava todos os caminhos absolutos, cada um com o seu "Permitir", e a pessoa lia um por um para
 * decidir. Agora o produto sugere a mais provável e pergunta "é essa?", com um botão só; as outras ficam
 * atrás de "Não é essa", primeiro as {@link CURTA} mais prováveis.
 */
export const CURTA = 3;

type Agente = FrotaDto["agentes"][number];
type Candidata = PayloadPropostaPasta["candidatas"][number];

/** "mudou hoje" é o dia de quem olha: o fuso do navegador, escolhido aqui e não no formatador. */
const FUSO_LOCAL = Intl.DateTimeFormat().resolvedOptions().timeZone;

const PASTA = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.3l2 2.2h8.7A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>';
const PASTA_BUSCA = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.3l2 2.2h8.7A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><circle cx="11.5" cy="13.5" r="2.3"/><path d="M13.2 15.2l1.8 1.8"/></svg>';
const RAMO = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="6" r="1.6"/><path d="M4.5 5.1v5.8"/><path d="M11.5 7.6c0 2.2-2 2.9-7 3.3"/></svg>';
const CADEADO = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';

/**
 * "code › acme › main-repos": a pasta-mãe, relativa à pasta pessoal. Propostas gravadas antes de
 * 2026-09-25 não têm `onde`: tira o prefixo da pasta pessoal do próprio caminho.
 */
export function ondeLegivel(c: { caminho: string; onde?: string }): string {
  const relativo = c.onde ?? c.caminho.replace(/^\/(?:Users|home)\/[^/]+\/?/, "").split("/").slice(0, -1).join("/");
  const partes = relativo.split("/").filter(Boolean);
  return partes.length === 0 ? "pasta pessoal" : partes.join(" › ");
}

/** Nome, local e último uso de uma candidata: o mesmo miolo na sugerida e em cada opção da lista. */
function miolo(x: Candidata, agora: number, algumGit: boolean): string {
  const quando = typeof x.modificadoEm === "number" && agora > 0 ? mudouQuando(x.modificadoEm, agora, FUSO_LOCAL) : "";
  const semGit = algumGit && !x.git ? " · sem Git" : "";
  return `<span class="pa-nome"><b>${esc(x.nome)}</b><small>${esc(ondeLegivel(x))}${semGit}</small></span>${quando ? `<span class="pa-quando">${esc(quando)}</span>` : ""}`;
}

/** A moldura dos três estados: cabeça (o título nomeia o card e a lista), corpo, a linha de acesso e o rodapé. */
function moldura(p: Proposta, cab: { icone: string; titulo: string; sub: string; mudo?: boolean }, corpo: string, agente: Agente | undefined, rodape: string): string {
  const id = `pa-titulo-${esc(p.id)}`;
  return `<section class="card-pasta" data-proposta="${esc(p.id)}" aria-labelledby="${id}"><div class="pa-corpo">
    <div class="pa-cabeca"><span class="pa-icone${cab.mudo ? " mudo" : ""}">${cab.icone}</span><div><b class="pa-titulo" id="${id}">${cab.titulo}</b><p class="pa-sub">${cab.sub}</p></div></div>
    ${corpo}<p class="pa-acesso">${CADEADO}${esc(agente?.nome ?? "O agente")} só mexe nas pastas que você abrir.</p></div>
    <div class="pa-rodape">${rodape}</div></section>`;
}

/** O card da proposta de pasta: a sugerida, a lista (depois de "Não é essa") ou o "não achei". */
export function renderCardPasta(p: Proposta, c: PayloadPropostaPasta, estado: Estado, agente: Agente | undefined): string {
  const recusar = botao("recusar-proposta", "Agora não", { classe: "link pa-agora-nao", id: p.id });
  const procurar = (rotulo: string, classe: string) => botao("abrir-workspace", rotulo, { classe, id: p.agenteId });
  const sugerida = c.candidatas[0];
  if (!sugerida) {
    return moldura(p, { icone: PASTA_BUSCA, titulo: `Não achei o ${esc(c.buscaTermo)} no seu computador`, sub: "Procurei nas pastas onde projetos costumam ficar.", mudo: true }, "", agente, `${procurar("Escolher pasta…", "pri")}${recusar}`);
  }
  const algumGit = c.candidatas.some((x) => x.git);
  const lista = c.candidatas.length > 1 ? estado.listaDePasta[p.id] : undefined;
  if (!lista) {
    const outra = c.candidatas.length > 1
      ? botao("lista-de-pasta", "Não é essa", { id: p.id, dados: { lista: "curta" }, expandido: false })
      : procurar("Não é essa", "");
    const pasta = `<div class="pa-pasta" title="${esc(sugerida.caminho)}">${sugerida.git ? RAMO : PASTA}${miolo(sugerida, estado.agora, algumGit)}</div>`;
    return moldura(p, { icone: PASTA, titulo: `Abrir o projeto ${esc(sugerida.nome)}?`, sub: esc(c.motivo) }, pasta, agente,
      `${botao("permitir-pasta", "Usar esta pasta", { classe: "pri", id: p.id, dados: { pasta: sugerida.caminho } })}${outra}${recusar}`);
  }
  const mesmoNome = c.candidatas.every((x) => x.nome.toLowerCase() === sugerida.nome.toLowerCase());
  const visiveis = lista === "todas" ? c.candidatas : c.candidatas.slice(0, CURTA);
  // A lista só abre depois de "Não é essa": a marcada é a próxima mais provável, não a que a pessoa recusou.
  const opcoes = visiveis.map((x, i) => `<label class="pa-opcao" title="${esc(x.caminho)}"><input type="radio" name="pasta-${esc(p.id)}" value="${esc(x.caminho)}" data-pasta-de="${esc(p.id)}"${i === 1 ? " checked" : ""}>${miolo(x, estado.agora, algumGit)}</label>`).join("");
  // Sem "Mostrar menos": recolher escondia a opção marcada e armava outra pasta sem a pessoa ver.
  const resto = c.candidatas.length - CURTA;
  const mais = resto > 0 && lista !== "todas"
    ? botao("lista-de-pasta", `Mostrar mais ${resto}`, { classe: "link", id: p.id, dados: { lista: "todas" }, expandido: false })
    : "";
  const corpo = `<fieldset class="pa-lista" aria-labelledby="pa-titulo-${esc(p.id)}">${opcoes}</fieldset>
    <div class="pa-links">${mais}${procurar("Procurar em outro lugar…", "link")}</div>`;
  return moldura(p, {
    icone: PASTA,
    titulo: mesmoNome ? `Qual é o ${esc(sugerida.nome)} certo?` : "Qual destas pastas?",
    sub: `Achei ${c.candidatas.length} pastas${mesmoNome ? " com esse nome" : " parecidas"}. Marquei a próxima mais provável.`,
  }, corpo, agente, `${botao("permitir-pasta", "Usar esta pasta", { classe: "pri", id: p.id })}${recusar}`);
}
