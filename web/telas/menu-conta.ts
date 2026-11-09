import type { ContaIa } from "../../src/contracts/contas-ia.ts";
import { nesteAparelho } from "../lib/aparelho.ts";
import { ICONE } from "../lib/icones.ts";
import { esc } from "../lib/render.ts";
import { pilhaDeAvatares, PROVEDOR } from "./cartao-ia.ts";
import { contaEmUso } from "./contas-lista.ts";
import { ALERTA_USO, maiorUso, pctUsado, proximaDaFila, quandoNaTela } from "./uso-da-conta.ts";

/**
 * Menu da conta (definido em 2026-09-30, canvas "Menu, sidebar e gaveta"): o avatar do rodapé abre este menu.
 * NOD-367 (protótipo v2 do Gil, aprovado em 2026-10-26): o menu fica enxuto — quem está logado (só texto), Provedores de
 * IA, Configurações, Agentes, Enviar feedback, Ajuda e, por último, Sair. Os interruptores (Modo dev, experimentos), os
 * avisos, as máquinas, o onboarding e o banco moram em Configurações. A faixa do topo só existe quando algo precisa da
 * pessoa — a IA desconectada, um conector fora do ar ou o uso do plano (ADR-029: escrito) — e é uma linha discreta.
 */
export type DadosMenuConta = {
  faixa: { texto: string; botao: string } | null;
  conexao: string;
  /** NOD-367: o aviso das máquinas (o Este Mac sem disco ou ocupado, o computador do bot trabalhando), que abre Máquinas. */
  maquina?: { texto: string; tom: "atencao" | "neutro" | "ok" } | null;
  /** Quem está logado; null = servidor sem contas e sem nome conhecido (o bloco não aparece). */
  quem?: { nome: string | null; email: string | null } | null;
  /**
   * NOD-345 (ADR-124): ausente = servidor sem contas (sem Sair). `email: null` = espaço provisório: no lugar de Sair, o
   * convite "Criar conta ou entrar" (o lembrete permanente, opção 2 do Gil).
   */
  conta?: { email: string | null; senha: boolean; legado?: boolean };
  /** NOD-406: no espaço provisório, o login de equipe pelo Google (a URL), ou "app" (a tela de conexão do app, com a
   * chave de Chaves). O clique vai por `data-conta="equipe"`. */
  equipe?: string | null;
};

/** "AN" de "Ana"; sem nome, as duas primeiras letras do e-mail. */
export function iniciaisDeQuem(nome: string | null, email: string | null): string {
  const base = (nome ?? "").trim();
  if (base) {
    const partes = base.split(/\s+/).filter(Boolean);
    return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1]![0] ?? "" : partes[0]?.[1] ?? "")).toUpperCase();
  }
  return (email ?? "").slice(0, 2).toUpperCase();
}

/** "Gmail e ClickUp fora do ar"; com mais de três, os dois primeiros e quantos faltam. */
export function faixaDeConectores(nomes: readonly string[]): string {
  const lista = nomes.length > 3 ? [...nomes.slice(0, 2), `mais ${nomes.length - 2}`] : [...nomes];
  return `${new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(lista)} fora do ar`;
}

/** O uso do plano que segura as rotinas: o texto da faixa do menu e o resumo que entra no nome acessível do avatar. */
export type AvisoDoUso = { texto: string; resumo: string };

type IaTravada = { nome: string; apelido: string; limite: boolean; ate: number | null; pct: number; janela: "5 h" | "semana" };

/**
 * NOD-12 (definido em 2026-10-22, protótipo do Gil no PR #414): a faixa do menu da conta pelo uso do plano. Só aparece
 * quando as rotinas vão esperar: a conta em uso de alguma IA está a partir de 90% (ou no limite) e não há outra conta
 * dela pronta na fila. Com conta seguinte, nada aqui (a linha da conta já diz para onde vai). A conversa nunca é
 * segurada (ADR-099 §7), e o texto diz isso no limite.
 */
export function faixaDoUso(contas: readonly ContaIa[], agora: number): AvisoDoUso | null {
  const travadas: IaTravada[] = [];
  for (const ia of ["claude-cli", "codex-cli"] as const) {
    const nome = PROVEDOR[ia].nome;
    const logadas = contas.filter((c) => c.ia === ia && c.maquinas.some((v) => v.estado === "pronta"));
    if (logadas.length === 0) continue;
    const emUso = contaEmUso(contas, agora, { ia });
    if (!emUso) {
      // Nenhuma pronta fora do limite: a IA está no limite até a primeira voltar.
      const voltas = logadas.map((c) => c.noLimiteAte).filter((t): t is number => t !== null && t > agora);
      if (voltas.length) travadas.push({ nome, apelido: logadas[0]!.apelido, limite: true, ate: Math.min(...voltas), pct: 100, janela: "5 h" });
      continue;
    }
    const q = emUso.cota;
    const maior = maiorUso(q);
    if (!q || maior === null || maior < ALERTA_USO || proximaDaFila(emUso, contas, agora)) continue;
    const j = q.cincoHoras && q.cincoHoras.utilizacao === maior ? { j: q.cincoHoras, nome: "5 h" as const } : { j: q.semana!, nome: "semana" as const };
    travadas.push({ nome, apelido: emUso.apelido, limite: maior >= 1, ate: j.j.renovaEm, pct: pctUsado(maior), janela: j.nome });
  }
  if (travadas.length === 0) return null;
  const nomes = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(travadas.map((t) => t.nome));
  if (travadas.length > 1) {
    const todas = travadas.every((t) => t.limite);
    return todas
      ? { texto: `${nomes} no limite. As rotinas esperam até renovar; a conversa com você segue.`, resumo: `${nomes} no limite` }
      : { texto: `${nomes} perto do limite. Sem outra conta na fila, as rotinas esperam.`, resumo: `${nomes} perto do limite` };
  }
  const t = travadas[0]!;
  if (t.limite) {
    const ate = t.ate !== null ? ` até ${quandoNaTela(t.ate, agora)}` : "";
    return { texto: `${t.nome} no limite${ate}. As rotinas esperam até ${ate ? "lá" : "renovar"}; a conversa com você segue.`, resumo: `${t.nome} no limite${ate}` };
  }
  const renova = t.ate !== null ? `, renova ${quandoNaTela(t.ate, agora).includes(" às ") ? "em " : "às "}${quandoNaTela(t.ate, agora)}` : "";
  const janela = t.janela === "5 h" ? "da janela de 5 h" : "da semana";
  return {
    texto: `${t.nome} · ${t.apelido} em ${t.pct}% ${janela}${renova}. Sem outra conta na fila, as rotinas esperam até ${renova ? "lá" : "renovar"}.`,
    resumo: `${t.nome} perto do limite`,
  };
}

export function htmlMenuConta(d: DadosMenuConta): string {
  const item = (secao: string, icone: string, nome: string, meta = "", extra = "") => `<button type="button" role="menuitem" data-secao="${secao}"${extra}>${icone}<span class="mc-nome">${esc(nome)}</span>${meta ? `<span class="mc-meta">${esc(meta)}</span>` : ""}</button>`;
  const quem = d.quem && (d.quem.nome || d.quem.email)
    ? `<div class="mc-quem"><span class="mc-av" aria-hidden="true">${esc(iniciaisDeQuem(d.quem.nome, d.quem.email))}</span><span class="mc-quem-txt"><b>${esc(d.quem.nome ?? d.quem.email ?? "")}</b>${d.quem.nome && d.quem.email ? `<small>${esc(d.quem.email)}</small>` : ""}</span></div>`
    : "";
  // As faixas ficam fora do role=menu (um status não é item de menu); as setas do diálogo passam pelos botões delas.
  const faixa = d.faixa ? `<div class="mc-faixa" role="status"><i aria-hidden="true"></i><span>${esc(d.faixa.texto)}</span><button type="button" data-secao="conexao">${esc(d.faixa.botao)}</button></div>` : "";
  const maquina = d.maquina ? `<div class="mc-faixa mc-faixa-${d.maquina.tom}" role="status"><i aria-hidden="true"></i><span>${esc(d.maquina.texto)}</span><button type="button" data-secao="maquinas">Ver</button></div>` : "";
  const rotulo = d.quem?.nome ? `Menu da conta de ${d.quem.nome}` : "Menu da conta";
  // Sair por último; no espaço provisório (sem conta ainda), o convite fica no lugar dele.
  const fim = !d.conta ? ""
    : d.conta.email === null
      ? `<hr><button type="button" role="menuitem" data-conta="inicio">${ICONE.pessoa}<span class="mc-nome">Criar conta ou entrar</span><span class="mc-meta">Seu espaço está só ${nesteAparelho()}</span></button>${d.equipe ? `<button type="button" role="menuitem" data-conta="equipe">${ICONE.pessoa}<span class="mc-nome">${d.equipe === "app" ? "Sou da equipe: conectar com a chave" : "Sou da equipe: entrar com Google"}</span></button>` : ""}`
      : `<hr><button type="button" role="menuitem" data-conta="sair">${ICONE.sair}<span class="mc-nome">Sair</span></button>`;
  return `${quem}${faixa}${maquina}<div role="menu" aria-label="${esc(rotulo)}">
    ${item("conexao", pilhaDeAvatares(true), "Provedores de IA", d.conexao)}
    <hr>
    ${item("geral", ICONE.ajustes, "Configurações")}
    ${item("agentes", ICONE.agentes, "Agentes")}
    ${item("feedback", ICONE.bandeira, "Enviar feedback")}
    ${item("ajuda", ICONE.info, "Ajuda")}${fim}
  </div>`;
}
