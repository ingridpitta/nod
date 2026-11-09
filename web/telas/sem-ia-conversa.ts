/**
 * Jornada C do onboarding (docs/specs/onboarding-jornada-c.md): a fala fixa do bot sem IA e o card "Conectar uma IA neste
 * computador" na conversa. Tudo é guiado pelo dado: a negação com `aguardaIa` só existe quando o servidor roda com
 * NOD_ONBOARDING_TEXTO=1, então a tela não precisa saber da flag.
 *
 * Um card por conversa (critério 2): a PRIMEIRA fala da sequência de falas guardadas mais recente leva o card, e as
 * seguintes ("…é só conectar no card acima") ficam só como fala, embaixo dele. Quando uma IA fica pronta depois da fala, o
 * card vira a linha "Claude conectado como …" (critério 3). O card, a barra e a dica do composer só valem enquanto algum
 * turno guardado da sequência segue vivo (na fila): a fala antiga, cuja mensagem já rodou ou foi cancelada, não volta a
 * pedir para conectar quando a IA cai de novo.
 */
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { EstadoDaIa } from "../../src/contracts/estado-ia.ts";
import type { Estado } from "../estado/reducer.ts";
import { botao, esc } from "../lib/render.ts";
import { IAS_MAC, logoDaIa, PROVEDOR, type IaMac } from "./cartao-ia.ts";

/** A fala fixa do bot sem IA: a negação com `aguardaIa` (o servidor a gera em src/domain/sem-ia.ts). */
export function ehFalaSemIa(m: Pick<Mensagem, "payload">): boolean {
  return m.payload?.kind === "negacao" && m.payload.aguardaIa === true;
}

/** A linha em que o card se transforma ao conectar (sem conta conhecida, sem e-mail: o inventário não guarda e-mail). */
export function linhaConectada(nomeIa: string, conta: string | null | undefined): string {
  const c = conta?.trim();
  return c ? `${nomeIa} conectado como ${c}` : `${nomeIa} conectado`;
}

/** A dica do composer no lugar da trava de envio. */
export function dicaDoComposerSemIa(nomeBot: string): string {
  return `${nomeBot} responde quando uma IA estiver conectada aqui`;
}

/** O id do card na conversa: a barra rola até ele. */
export const idDoCardSemIa = (conversaId: string): string => `cp-sem-ia-${conversaId}`;

/** O que a tela sabe de cada IA: o estado do app (no Mac) ou o inventário do servidor, e a conta quando o app diz. */
export type IaNoCard = { ia: IaMac; app?: EstadoDaIa | undefined; inventario?: Inventario | null | undefined; email?: string | null | undefined };

/** O que a tela tem de cada IA: o app do Mac primeiro; senão o `GET /ias`, o catálogo do executor e o inventário legado. */
export function iasNoCard(estado: Pick<Estado, "iasMac" | "ias" | "executor" | "inventario">): IaNoCard[] {
  return IAS_MAC.map((ia) => {
    const app = estado.iasMac.noApp ? estado.iasMac.estados[ia] : undefined;
    const inventario = estado.ias?.ias.find((i) => i.id === ia)?.inventario ?? estado.executor?.harnesses?.opcoes.find((o) => o.id === ia)?.inventario ?? (ia === "claude-cli" ? estado.inventario : null);
    return { ia, app: app?.estado, inventario, email: app?.conta?.email ?? null };
  });
}

type Situacao = "pronta" | "falta_entrar" | "instalar";

export function situacaoDaIa(i: IaNoCard): Situacao {
  if (i.app) return i.app === "pronta" || i.app === "no_limite" ? "pronta" : i.app === "falta_entrar" || i.app === "entrando" || i.app === "sem_acesso" || i.app === "testando" ? "falta_entrar" : "instalar";
  if (i.inventario?.estado === "pronto") return "pronta";
  return i.inventario?.estado === "nao_autenticado" ? "falta_entrar" : "instalar";
}

/** A última fala guardada da conversa. */
export function ultimaFalaSemIa(mensagens: readonly Mensagem[]): Mensagem | null {
  for (let i = mensagens.length - 1; i >= 0; i--) {
    const m = mensagens[i];
    if (m && ehFalaSemIa(m)) return m;
  }
  return null;
}

/**
 * A sequência de falas guardadas mais recente, na ordem: da última para trás, passando pelas falas da pessoa e pelas
 * linhas de sistema, até uma fala do bot que não seja a fixa (a IA respondeu ali; o que veio antes é outra sequência).
 */
export function sequenciaSemIa(mensagens: readonly Mensagem[]): Mensagem[] {
  let i = mensagens.length - 1;
  while (i >= 0 && !(mensagens[i] && ehFalaSemIa(mensagens[i]!))) i--;
  const falas: Mensagem[] = [];
  for (; i >= 0; i--) {
    const m = mensagens[i];
    if (!m) continue;
    if (ehFalaSemIa(m)) falas.unshift(m);
    else if (m.autoria.autor_tipo === "agente") break;
  }
  return falas;
}

/**
 * O card da conversa: a fala que o leva (a primeira da sequência) e se algum turno guardado dela segue vivo. `vivos` são
 * os turnos em curso que a tela conhece (`estado.turnosVivos`). null sem fala guardada.
 */
export function cardDaConversa(mensagens: readonly Mensagem[], vivos: ReadonlySet<string>): { falaId: string; falaEm: number; vivo: boolean } | null {
  const seq = sequenciaSemIa(mensagens);
  const primeira = seq[0];
  if (!primeira) return null;
  return { falaId: primeira.id, falaEm: primeira.criadoEm, vivo: seq.some((m) => m.turnoId !== null && vivos.has(m.turnoId)) };
}

/** A IA que ficou pronta depois da fala (a primeira na ordem Claude, ChatGPT); null enquanto nenhuma. */
export function iaConectadaDepois(ias: readonly IaNoCard[], falaEm: number): IaNoCard | null {
  return ias.find((i) => situacaoDaIa(i) === "pronta" && (i.app === "pronta" || i.app === "no_limite" || (i.inventario?.estado === "pronto" && i.inventario.em > falaEm))) ?? null;
}

function linhaDaIa(i: IaNoCard): string {
  const s = situacaoDaIa(i);
  const nome = PROVEDOR[i.ia].nome;
  const sub = s === "falta_entrar" ? "instalado, falta entrar" : s === "pronta" ? "pronto" : "instala em menos de um minuto";
  const acao = s === "pronta" ? "" : botao("secao-espaco", s === "falta_entrar" ? "Entrar" : "Instalar", { classe: "sm", dados: { secao: "conexao", ia: i.ia } });
  return `<li class="cp-ia">${logoDaIa(i.ia, "cp-logo")}<span class="cp-ia-txt"><b>${esc(nome)}</b> <span class="cp-rot">· ${esc(sub)}</span></span>${acao}</li>`;
}

/** O card "Conectar uma IA neste computador" (padrão .cp) ou, depois de conectar, a linha encolhida. */
export function cardSemIa(conversaId: string, ias: readonly IaNoCard[], falaEm: number): string {
  const id = esc(idDoCardSemIa(conversaId));
  const conectada = iaConectadaDepois(ias, falaEm);
  if (conectada) return `<div class="cp-linha cp-ok" id="${id}" role="status">${esc(linhaConectada(PROVEDOR[conectada.ia].nome, conectada.email))}</div>`;
  const porIa = new Map(ias.map((i) => [i.ia, i]));
  const linhas = IAS_MAC.map((ia) => linhaDaIa(porIa.get(ia) ?? { ia })).join("");
  return `<section class="cp cp-sem-ia" id="${id}" tabindex="-1" aria-label="Conectar uma IA neste computador"><p class="cp-titulo">Conectar uma IA neste computador</p><ul class="cp-linhas">${linhas}</ul><p class="cp-rot cp-rodape">Outras IAs · Grok e Gemini em breve</p></section>`;
}

/**
 * A fala fixa do bot (balão, como qualquer fala) e, se ela leva o card, o card logo abaixo: o de conectar enquanto o turno
 * guardado espera, a linha "… conectado" quando uma IA ficou pronta; nada quando a espera acabou sem IA (a mensagem já
 * rodou ou foi cancelada).
 */
export function falaSemIaHtml(p: { mensagem: Mensagem; balao: string; comCard: boolean; vivo: boolean; ias: readonly IaNoCard[] }): string {
  if (!p.comCard) return p.balao;
  if (!p.vivo && !iaConectadaDepois(p.ias, p.mensagem.criadoEm)) return p.balao;
  return p.balao + cardSemIa(p.mensagem.conversaId, p.ias, p.mensagem.criadoEm);
}

/**
 * A conversa com fala guardada ainda na fila e nenhuma IA pronta: o composer mostra a dica no lugar de travar, e a barra
 * leva ao card. null quando não há (o caminho de sempre).
 */
export function conversaAguardandoIa(conversas: Readonly<Record<string, { mensagens: readonly Mensagem[] } | undefined>>, ias: readonly IaNoCard[], vivos: ReadonlySet<string>, preferida?: string): { conversaId: string } | null {
  const ordem = preferida ? [preferida, ...Object.keys(conversas).filter((k) => k !== preferida)] : Object.keys(conversas);
  for (const id of ordem) {
    const card = cardDaConversa(conversas[id]?.mensagens ?? [], vivos);
    if (card?.vivo && !iaConectadaDepois(ias, card.falaEm)) return { conversaId: id };
  }
  return null;
}

/** Os turnos em curso que a tela conhece (o que segura o card, a barra e a dica). */
export function turnosVivosDe(estado: Pick<Estado, "turnosVivos">): ReadonlySet<string> {
  return new Set(Object.keys(estado.turnosVivos));
}

/** O aviso da barra: um botão de verdade (focável, persistente enquanto não houver IA) que leva ao card. */
export function botaoDaBarraSemIa(conversaId: string, agenteId: string): string {
  return `<button type="button" class="aviso-sem-ia" data-act="ir-card-sem-ia" data-conversa="${esc(conversaId)}" data-agente="${esc(agenteId)}">Sem IA neste computador · <b>Conectar</b></button>`;
}

/*
 * Ponto de integração com a jornada A (PR #691): a conversa por texto com o Nod (chips) e a tela "Este computador" ainda
 * não existem no código. Quando chegarem, elas usam estas duas peças; até lá ninguém as chama na tela.
 */

/** Texto livre no onboarding sem IA: a conversa com o Nod só anda pelos chips. */
export const FALA_ONBOARDING_SO_CHIPS = "Sem IA aqui eu só consigo seguir pelas opções.";

/** A linha "Pensa com" do card de proposta: sem IA conectada, não cita o Claude como certo. */
export function pensaCom(iaConectada: string | null | undefined): string {
  const ia = iaConectada?.trim();
  return ia ? `Pensa com: ${ia}` : "Pensa com: a IA que você conectar";
}
