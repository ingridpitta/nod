import type { PayloadPropostaApp } from "../../src/contracts/apps.ts";
import type { Proposta } from "../../src/contracts/conversa.ts";
import { cardProposta } from "../lib/card-proposta.ts";
import { botao, esc } from "../lib/render.ts";
import { ICONE_DA_PAGINA } from "./paginas.ts";

const FONTE: Readonly<Record<PayloadPropostaApp["fonte"], string>> = { tarefas: "as tarefas do bot", conector: "um app conectado", arquivo: "um arquivo do bot", bot: "o que o bot mantém" };
const FORMA: Readonly<Record<PayloadPropostaApp["forma"], string>> = { lista: "lista", quadro: "quadro", painel: "painel de números", doc: "doc" };

/** A frase que "Ajustar" põe na caixa: o ajuste é feito pela conversa (o card segue aberto até Criar). */
export const fraseDeAjustar = (nome: string): string => `No app ${nome}, ajusta `;

/**
 * NOD-445 (Bloco 2): o card Criar / Ajustar do app pedido pela conversa ("cria um app de vagas para a Nina"): nome, para
 * qual bot, o ícone (no título, decorativo: aria-hidden, o nome já diz o app), fonte, forma, quem vê e a regra do "pede
 * você". Criar confirma a proposta (decisoes/:id/decidir cria o app, que chega à pílula como o último pontinho); Ajustar
 * leva à caixa com a frase começada. `aberto` = a decisão de mesmo id aberta (quem chama confere).
 */
export function renderCardApp(p: Pick<Proposta, "id" | "estado">, c: PayloadPropostaApp, aberto: boolean): string {
  const fonte = `${FONTE[c.fonte]}${c.fonteRef ? ` (${c.fonteRef})` : ""}`;
  const linhas = [
    esc(`Mostra ${fonte} como ${FORMA[c.forma]}`),
    esc("Quem vê: só você"),
    esc(c.regraPede ? `Pede você quando: ${c.regraPede}` : "Sem regra: o app nunca acende o laranja"),
  ];
  const desfecho = p.estado === "confirmada" ? `<p class="cp-rodape">${esc(`${c.nome} está na pílula de ${c.alvoNome}.`)}</p>`
    : p.estado === "recusada" ? '<p class="cp-rodape">App não criado.</p>' : "";
  return cardProposta({
    id: p.id,
    classe: "card-app",
    logo: `<span class="cp-logo cp-app-ic" aria-hidden="true">${ICONE_DA_PAGINA[c.icone] ?? ICONE_DA_PAGINA.app}</span>`,
    titulo: aberto ? `Criar o app ${c.nome} para ${c.alvoNome}` : `App ${c.nome} de ${c.alvoNome}`,
    linhas,
    acoes: aberto ? `${botao("decidir-proposta", "Criar", { classe: "cp-sim", id: p.id })}${botao("preencher-prompt", "Ajustar", { classe: "cp-nao", dados: { texto: fraseDeAjustar(c.nome) } })}` : "",
    rodape: desfecho,
  });
}
