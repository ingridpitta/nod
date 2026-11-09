import type { Concessao } from "../../src/contracts/concessao.ts";
import type { Conector } from "../../src/contracts/conector.ts";
import { falhaVisivel } from "../lib/fora-do-ar.ts";
import type { Proposta } from "../../src/contracts/conversa.ts";
import type { ConversaEstado, Estado } from "../estado/reducer.ts";
import { botao, esc, iconeAgente } from "../lib/render.ts";
import { capacidadesDoNivel, ICONE_OK, listaPodeENao, nomeDoApp, podeENao, ROTULO_NIVEL } from "./app-acesso.ts";
import { logoApp } from "./marketplace.ts";

/**
 * O cartão que oferece liberar apps recém-conectados para o bot da conversa (definido em 2026-10-05, canvas "Acesso:
 * você conectou pelo Marketplace e o nod oferece liberar"). Medido no mesmo dia em produção: uma pessoa nova conectou
 * o Gmail e o Slack pelo Marketplace no meio da conversa, escreveu "já liberei" e o bot continuou sem acesso —
 * conectar o app e liberá-lo para UM bot são dois passos, e só o primeiro aparecia. Quando é o BOT que pede, o card de
 * acesso já leva do Conectar ao Permitir (card-acesso.ts); este cobre quem conectou por conta própria.
 *
 * O cartão não é proposta nem decisão: é desenhado do que a tela já tem (conectores, concessões do bot, propostas da
 * conversa) mais as dispensas (0054). Permitir concede pela rota de pessoa `acessos/liberar` (ADR-044: conceder é
 * sempre ato da pessoa); "Agora não" grava a dispensa por bot e app.
 */

/**
 * definido em 2026-10-05: "conectado recentemente" = a última verificação boa do app (`sondadoEm`, que o login pelo
 * Marketplace grava ao terminar) tem até 24 h. Sem coluna própria para "conectado em": reconectar também renova a
 * data, e aí a oferta volta só para o bot que continua sem nenhum acesso. Depois de 24 h o cartão some sozinho e o
 * caminho é o painel do bot. O servidor usa a mesma janela para chamar o bot de volta (retomar-apos-liberar.ts).
 */
export const JANELA_LIBERAR_MS = 86_400_000;

export type NivelLiberar = "leitura" | "escrita";

/** Um app que entra no cartão, com os níveis que o catálogo dele tem (o primeiro é o padrão do seletor). */
export type AppParaLiberar = { conectorId: string; slug: string; nome: string; conectadoEm: number; niveis: NivelLiberar[] };

export type EntradaAppsParaLiberar = {
  agora: number;
  pessoaId: string | undefined;
  conversa: { tipo: "propria" | "sala"; agenteId: string | null };
  /** O bot da conversa como a frota o devolve; ausente (excluído, ainda carregando) = sem cartão. */
  agente: { id: string; ownerId: string; excluidoEm?: number | null } | undefined;
  conectores: readonly Conector[];
  /** As concessões DESTE bot; undefined = ainda não carregaram. */
  concessoes: readonly Pick<Concessao, "conectorId">[] | undefined;
  /** conectorId → instante do "Agora não" para este bot; undefined = ainda não carregaram. */
  dispensadas: Readonly<Record<string, number>> | undefined;
  /** As propostas da conversa: um pedido de acesso do bot ainda aberto para o app já é o cartão dele. */
  propostas: readonly Pick<Proposta, "estado" | "payload">[];
};

/**
 * Quais apps entram no cartão. Fecha em tudo o que não sabe: sem sessão, sem as concessões ou sem as dispensas
 * carregadas, não há cartão. Entra o app que é DA pessoa, está conectado e sem falha mais nova que a última
 * verificação, foi verificado nas últimas 24 h, tem ao menos uma ação para algum nível, não foi dispensado depois
 * dessa conexão, não tem pedido de acesso do bot aberto na conversa — e para o qual este bot não tem NENHUMA
 * concessão. Só na conversa própria de um bot da pessoa; nunca em sala.
 */
export function appsParaLiberar(e: EntradaAppsParaLiberar): AppParaLiberar[] {
  if (!e.pessoaId || !e.agente || !e.concessoes || !e.dispensadas) return [];
  if (e.conversa.tipo !== "propria" || e.conversa.agenteId !== e.agente.id) return [];
  if (e.agente.ownerId !== e.pessoaId || e.agente.excluidoEm) return [];
  const comConcessao = new Set(e.concessoes.map((c) => c.conectorId));
  const pedidos = new Set(e.propostas.flatMap((p) => (p.estado === "pendente" && p.payload.kind === "acesso" ? [p.payload.conector] : [])));
  const dispensadas = e.dispensadas;
  return e.conectores
    .flatMap((c): AppParaLiberar[] => {
      if (c.ownerId !== e.pessoaId || !c.habilitado || c.sondadoEm === null) return [];
      if (c.ultimaFalha && falhaVisivel(c)) return [];
      if (e.agora - c.sondadoEm > JANELA_LIBERAR_MS) return [];
      if (comConcessao.has(c.id) || pedidos.has(c.slug)) return [];
      const dispensadoEm = dispensadas[c.id];
      if (dispensadoEm !== undefined && dispensadoEm >= c.sondadoEm) return [];
      const leitura = capacidadesDoNivel(c.catalogo, "leitura").length;
      const escrita = capacidadesDoNivel(c.catalogo, "escrita").length;
      // "Ler e alterar" só é opção quando dá algo além de ler; app sem ação em nível nenhum não tem o que liberar aqui.
      const niveis: NivelLiberar[] = [...(leitura > 0 ? ["leitura" as const] : []), ...(escrita > leitura ? ["escrita" as const] : [])];
      return niveis.length > 0 ? [{ conectorId: c.id, slug: c.slug, nome: c.nome, conectadoEm: c.sondadoEm, niveis }] : [];
    })
    .sort((a, b) => a.conectadoEm - b.conectadoEm || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** O que a pessoa deixou marcado no cartão: o app e o nível do seletor dele. */
export type EscolhaLiberar = { slug: string; nivel: NivelLiberar };

/**
 * O texto do botão primário segue o que está marcado: um app em leitura → "Permitir leitura"; dois → "… nos dois";
 * níveis diferentes ou algum "Ler e alterar" → só "Permitir" (o seletor ao lado já diz o nível de cada um).
 */
export function rotuloPermitir(escolhas: readonly EscolhaLiberar[]): string {
  if (escolhas.length === 0 || escolhas.some((e) => e.nivel !== "leitura")) return "Permitir";
  if (escolhas.length === 1) return "Permitir leitura";
  return escolhas.length === 2 ? "Permitir leitura nos dois" : `Permitir leitura nos ${escolhas.length}`;
}

/** "o Gmail e o Slack" / "no Gmail, no Slack e no Notion". */
function enumerar(nomes: readonly string[], artigo: "o" | "no"): string {
  const itens = nomes.map((n) => `${artigo} ${n}`);
  return itens.length <= 1 ? (itens[0] ?? "") : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`;
}

/**
 * A lista pode/não pode do que está marcado. Um app só usa as frases do card de acesso (com o "não inclui" curado do
 * app); vários juntam os nomes por nível, e "neles" só quando todos estão em leitura.
 */
export function oQuePodem(ctx: Pick<Estado, "conectores" | "marketplace">, escolhas: readonly EscolhaLiberar[]): { pode: string[]; nao: string[] } {
  const [unica] = escolhas;
  if (unica && escolhas.length === 1) return podeENao(ctx, unica.slug, unica.nivel);
  const nomes = (nivel: NivelLiberar) => escolhas.filter((e) => e.nivel === nivel).map((e) => nomeDoApp(ctx, e.slug));
  const ler = nomes("leitura");
  const alterar = nomes("escrita");
  const pode: string[] = [];
  const nao: string[] = [];
  if (ler.length > 0) {
    pode.push(`Ver e ler o que está ${enumerar(ler, "no")}`);
    nao.push(`Não cria, altera nem apaga nada ${alterar.length === 0 ? "neles" : enumerar(ler, "no")}`);
  }
  if (alterar.length > 0) {
    pode.push(`Ler, criar, editar e comentar ${enumerar(alterar, "no")}`);
    nao.push(`Apagar, desfazer e outras ações ficam de fora${ler.length > 0 ? ` ${enumerar(alterar, "no")}` : ""}`);
  }
  return { pode, nao };
}

/** A lista do cartão já em HTML: o `change` do checkbox e do seletor a regrava no lugar (main.ts), sem redesenhar o cartão. */
export function listaDoQuePodem(ctx: Pick<Estado, "conectores" | "marketplace">, escolhas: readonly EscolhaLiberar[]): string {
  return listaPodeENao(oQuePodem(ctx, escolhas));
}

function linhaDoApp(app: AppParaLiberar, estado: Estado): string {
  const nome = nomeDoApp(estado, app.slug);
  const opcoes = app.niveis.map((n, i) => `<option value="${n}"${i === 0 ? " selected" : ""}>${esc(ROTULO_NIVEL[n])}</option>`).join("");
  // Controles de verdade: o rótulo envolve o checkbox, o logo e o nome; o seletor fica fora dele, com nome próprio.
  // Um nível só não tem o que escolher: o seletor aparece desabilitado, dizendo qual é.
  return `<div class="lib-app"><label class="lib-marca"><input type="checkbox" checked data-liberar-app="${esc(app.conectorId)}" data-slug="${esc(app.slug)}" />${logoApp(estado, app.slug, nome)}<span class="lib-nome"><b>${esc(nome)}</b><small>${ICONE_OK}Conectado</small></span></label><select class="lib-nivel" data-liberar-nivel="${esc(app.conectorId)}" aria-label="Nível de acesso ao ${esc(nome)}"${app.niveis.length === 1 ? " disabled" : ""}>${opcoes}</select></div>`;
}

/** Os apps do cartão para a conversa aberta; vazio = não há cartão. */
function appsDoCartao(c: ConversaEstado, estado: Estado): AppParaLiberar[] {
  const agenteId = c.conversa.agenteId;
  if (!agenteId || !estado.carregado.conectores) return [];
  return appsParaLiberar({
    agora: estado.agora,
    pessoaId: estado.sessao?.pessoaId,
    conversa: { tipo: c.conversa.tipo, agenteId },
    agente: estado.frota?.agentes.find((a) => a.id === agenteId),
    conectores: estado.conectores,
    concessoes: estado.concessoes[agenteId],
    dispensadas: estado.liberacoesDispensadas[agenteId],
    propostas: c.propostas,
  });
}

/** "" = sem cartão nesta conversa. */
export function renderCardLiberar(c: ConversaEstado, estado: Estado): string {
  const apps = appsDoCartao(c, estado);
  const agente = estado.frota?.agentes.find((a) => a.id === c.conversa.agenteId);
  if (apps.length === 0 || !agente) return "";
  const um = apps.length === 1;
  const nomes = apps.map((a) => nomeDoApp(estado, a.slug));
  const escolhas: EscolhaLiberar[] = apps.map((a) => ({ slug: a.slug, nivel: a.niveis[0] ?? "leitura" }));
  const titulo = `O ${agente.nome} ainda não pode usar ${um ? "esse app" : "esses apps"}`;
  const sub = `Conectar o app é o primeiro passo. Falta dizer o que este bot pode fazer ${um ? "nele" : "neles"}.`;
  const cab = `<div class="ac-cab">${iconeAgente(agente, "lg")}<div class="ac-titulo"><b>${esc(titulo)}</b><small>${esc(sub)}</small></div></div>`;
  const permitir = botao("liberar-apps", esc(rotuloPermitir(escolhas)), { classe: "pri", id: agente.id });
  const agoraNao = botao("dispensar-liberar", "Agora não", { classe: "link", id: agente.id, dados: { conectores: apps.map((a) => a.conectorId).join(",") } });
  const rodape = `<div class="ac-rodape">${permitir}${agoraNao}<span class="ac-nota">Dá para revogar no painel do bot</span></div>`;
  return `<div class="msg-sistema">${esc(`Você conectou ${enumerar(nomes, "o")} no Marketplace.`)}</div><section class="acesso-card liberar-card" data-liberar="${esc(agente.id)}" aria-label="${esc(`Liberar apps para ${agente.nome}`)}">${cab}<div class="lib-apps">${apps.map((a) => linhaDoApp(a, estado)).join("")}</div>${listaDoQuePodem(estado, escolhas)}${rodape}</section>`;
}
