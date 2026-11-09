import type { AssumeBots, ItemRemocao, OpcoesRemover, PonteRemoverDesktop, PreviaRemoverDto, ResultadoRemoverDto } from "../../src/contracts/remover-computador.ts";
import { esc } from "../lib/render.ts";

/**
 * ADA-245 (jornada D do onboarding, docs/specs/onboarding-jornada-d.md): o diálogo "Remover o nod deste computador?" (D2)
 * e a tela de Fim (D3), atrás de `ModoSessaoDto.onboardingTexto`. Mora fora de maquinas.ts, que já passa de 600 linhas.
 * O texto é função pura do estado (`textoDeRemover`, `itensDoServidor`), testável sem DOM; main.ts só faz o POST, chama a
 * ponte do app e despacha `remover-ui`.
 */

/** Um item da lista do Fim: os três estados da ponte e `espera` (o computador desligado se limpa quando ligar). */
export type ItemDoFim = { texto: string; nota?: string; estado: ItemRemocao["estado"] | "espera" };

export type UiRemover = {
  /** O diálogo aberto: a prévia do servidor, as duas caixas e o envio. `aqui` = é o computador em que o app roda. */
  dialogo: { previa: PreviaRemoverDto; aqui: boolean; manterIas: boolean; manterConexao: boolean; enviando: boolean; erro: string | null } | null;
  /** A tela de Fim, até a pessoa clicar em "Fechar" (definido em 2026-11-06 na spec: não fecha sozinha). */
  fim: { maquinaId: string; nome: string; aqui: boolean; itens: ItemDoFim[] } | null;
};

export const UI_REMOVER_INICIAL: UiRemover = { dialogo: null, fim: null };

/** Os bots, no singular ou no plural, a partir de onde se fala ("daqui" ou "de lá"). */
function sujeitoDosBots(bots: readonly string[], aqui: boolean): { sujeito: string; plural: boolean } {
  const onde = aqui ? "daqui" : "de lá";
  if (bots.length === 1) return { sujeito: `O bot ${onde}, ${bots[0]},`, plural: false };
  return { sujeito: `Os ${bots.length} bots ${onde}`, plural: true };
}

/** O que acontece com os bots: passam para quem assume (nomeado) ou esperam um computador. */
function fraseDosBots(bots: readonly string[], assume: AssumeBots, aqui: boolean): string {
  if (bots.length === 0) return aqui ? "Nenhum bot trabalha aqui." : "Nenhum bot trabalha lá.";
  const { sujeito, plural } = sujeitoDosBots(bots, aqui);
  if (assume) return `${sujeito} ${plural ? "passam" : "passa"} para o ${assume.nome}; se ele estiver desligado, ${plural ? "esperam" : "espera"} até um computador com IA conectar.`;
  return `${sujeito} ${plural ? "esperam" : "espera"} um computador: ${plural ? "voltam" : "volta"} a trabalhar quando outro computador com IA conectar à sua conta.`;
}

/**
 * D2: o título e o parágrafo do diálogo, pelo estado de verdade (critério 4: o número real de bots e o nome real de quem
 * assume; sem ninguém, "esperam um computador"). `aqui`: o computador da linha é o deste app (a frase diz "aqui").
 */
export function textoDeRemover(previa: PreviaRemoverDto, contexto: { aqui: boolean; manterConexao?: boolean }): { titulo: string; texto: string } {
  const { aqui } = contexto;
  // Desligado: só com "Continuar ligado" o pedido espera ele ligar; saindo da conta, a chave cai agora e ele não puxa mais
  // nada (compor.ts, removerDepoisDoCommit). O texto segue a caixa (revisão do PR #694).
  const abertura = aqui ? "O nod para de rodar aqui e tira o que instalou."
    : previa.online ? `O nod para de rodar no ${previa.nome} e tira o que instalou lá.`
      : contexto.manterConexao ? `O ${previa.nome} está desligado agora: o nod tira o que instalou lá quando ele ligar de novo.`
        : `O ${previa.nome} está desligado agora: ele sai da sua conta já, e o que o nod instalou fica lá até você remover por ele.`;
  return { titulo: "Remover o nod deste computador?", texto: `${abertura} ${fraseDosBots(previa.bots, previa.assume, aqui)} Seus bots e conversas continuam na sua conta.` };
}

/**
 * D3 sem a ponte do app (outro computador, ou o navegador): os itens a partir da resposta do servidor. O computador que
 * ainda vai se limpar (`aguardandoComputador`) aparece como espera; sem isso, os programas do nod ficam lá.
 */
export function itensDoServidor(r: ResultadoRemoverDto, contexto: { online: boolean; opcoes: OpcoesRemover }): ItemDoFim[] {
  const ias = contexto.opcoes.manterIas ? "" : " e as IAs que ele instalou";
  const limpeza: ItemDoFim = r.aguardandoComputador
    ? { estado: "espera", texto: contexto.online ? `O ${r.nome} vai tirar o nod${ias} em instantes` : `O ${r.nome} vai se limpar quando ligar`, nota: contexto.online ? undefined : `Quando ele ligar, o nod sai de lá${ias}.` }
    : { estado: "mantido", texto: `Os programas do nod continuam instalados no ${r.nome}`, nota: "Ele não estava conectado. Para tirar, abra o nod nele e remova por lá." };
  const bots: ItemDoFim[] = r.bots.length === 0 ? [] : [{
    estado: "feito",
    texto: r.assume
      ? `${r.bots.length === 1 ? "1 bot passou" : `${r.bots.length} bots passaram`} para o ${r.assume.nome}`
      : `${r.bots.length === 1 ? "1 bot espera" : `${r.bots.length} bots esperam`} um computador`,
  }];
  const conta: ItemDoFim = r.saiuDaConta
    ? { estado: "feito", texto: `O ${r.nome} saiu da sua conta`, nota: "Ao instalar de novo, ele entra como um computador novo." }
    : { estado: "mantido", texto: `O ${r.nome} continua ligado à sua conta`, nota: "Para instalar de novo sem entrar outra vez, como você escolheu." };
  return [limpeza, ...bots, conta];
}

/** Os itens da ponte do app (o que ele fez neste computador), como vieram; uma falha da ponte vira um item que falhou. */
export function itensDaPonte(itens: readonly ItemRemocao[]): ItemDoFim[] {
  return itens.map((i) => ({ estado: i.estado, texto: i.texto }));
}

/**
 * D3, "Fechar": true só quando a ponte confirma que o app encerra (o removido é este computador e a limpeza rodou aqui).
 * Qualquer outra resposta (false, erro, ponte antiga sem resposta, sem ponte) e a tela volta a Computadores: o Fim nunca
 * fica preso (critério 5; revisão do PR #694).
 */
export async function appEncerraNoFim(aqui: boolean, ponte: Pick<PonteRemoverDesktop, "fecharAposRemover"> | undefined): Promise<boolean> {
  if (!aqui || !ponte?.fecharAposRemover) return false;
  return (await ponte.fecharAposRemover().catch(() => false)) === true;
}

export const ITEM_PONTE_FALHOU: ItemDoFim = { estado: "falhou", texto: "Não deu para limpar este computador", nota: "Ele já saiu da lista. Para tirar o que ficou, desinstale o nod pelo sistema." };

/** O texto da caixa e do rodapé de cada caixa do diálogo (o protótipo, prancha D2). */
export const CAIXAS_REMOVER = {
  ias: { rotulo: "Tirar também o Claude e o ChatGPT instalados pelo nod", nota: "Seus logins neles são seus e ficam." },
  conexao: { rotulo: "Continuar ligado à minha conta", nota: "Para instalar de novo sem entrar outra vez. Sem isso, este computador sai da conta." },
} as const;

/** D2: o diálogo (aria-modal; o foco vai ao título ao abrir, `data-cl-autofoco`; Esc e Cancelar fecham). */
export function dialogoRemover(ui: UiRemover): string {
  const d = ui.dialogo;
  if (!d) return "";
  const { titulo, texto } = textoDeRemover(d.previa, { aqui: d.aqui, manterConexao: d.manterConexao });
  const caixa = (campo: "ias" | "conexao", marcada: boolean) =>
    `<label class="cl-check rm-caixa"><input type="checkbox" data-rm-caixa="${campo}"${marcada ? " checked" : ""}${d.enviando ? " disabled" : ""}><span>${esc(CAIXAS_REMOVER[campo].rotulo)}<small>${esc(CAIXAS_REMOVER[campo].nota)}</small></span></label>`;
  const erro = d.erro ? `<p class="cx-erro" role="alert">${esc(d.erro)}</p>` : "";
  return `<div class="cl-fundo" data-act="rm-fechar"></div><div class="cl-dialogo rm-dialogo" role="dialog" aria-modal="true" aria-labelledby="rm-titulo" aria-describedby="rm-texto" data-rm-maquina="${esc(d.previa.id)}">
    <h3 id="rm-titulo" tabindex="-1" data-cl-autofoco>${esc(titulo)}</h3>
    <p id="rm-texto">${esc(texto)}</p>
    ${caixa("ias", !d.manterIas)}${caixa("conexao", d.manterConexao)}${erro}
    <div class="cl-dialogo-acoes"><button type="button" class="bt" data-act="rm-fechar"${d.enviando ? " disabled" : ""}>Cancelar</button><button type="button" class="bt perigo" data-act="rm-confirmar"${d.enviando ? " disabled" : ""}>${d.enviando ? "Removendo…" : "Remover"}</button></div>
  </div>`;
}

const MARCA: Record<ItemDoFim["estado"], { simbolo: string; rotulo: string }> = {
  feito: { simbolo: "✓", rotulo: "feito" },
  falhou: { simbolo: "!", rotulo: "não deu certo" },
  mantido: { simbolo: "–", rotulo: "ficou" },
  espera: { simbolo: "…", rotulo: "acontece depois" },
};

/** D3: a lista do que aconteceu e o "Fechar". Fica até a pessoa fechar; o foco vai ao título. */
export function telaFimRemover(ui: UiRemover): string {
  const f = ui.fim;
  if (!f) return "";
  const falhou = f.itens.some((i) => i.estado === "falhou");
  const espera = f.itens.some((i) => i.estado === "espera");
  const titulo = falhou ? "O nod saiu, mas nem tudo deu certo." : f.aqui ? "O nod saiu deste computador." : espera ? `O nod vai sair do ${f.nome}.` : `O nod saiu do ${f.nome}.`;
  const intro = f.aqui ? "Seus bots e conversas continuam na sua conta. Para usá-los de novo aqui, é só instalar o nod outra vez." : "Seus bots e conversas continuam na sua conta.";
  const itens = f.itens.map((i) => `<li class="rm-item rm-${i.estado}"><span class="rm-marca" aria-hidden="true">${MARCA[i.estado].simbolo}</span><span class="rm-item-txt"><span class="sr-only">${MARCA[i.estado].rotulo}: </span>${esc(i.texto)}${i.nota ? `<small>${esc(i.nota)}</small>` : ""}</span></li>`).join("");
  return `<section class="espaco-secao cfg-secao rm-fim" aria-labelledby="rm-fim-tit">
    <p class="rm-fim-onde">${esc(f.aqui ? "Este computador" : f.nome)}</p>
    <h2 id="rm-fim-tit" tabindex="-1" data-cl-autofoco>${esc(titulo)}</h2>
    <p class="intro">${esc(intro)}</p>
    <ul class="rm-lista">${itens}</ul>
    <div class="rm-fim-acoes"><button type="button" class="bt pri" data-act="rm-fim-fechar">Fechar</button></div>
  </section>`;
}
