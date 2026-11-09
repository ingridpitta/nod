import type { FrotaDto } from "../../src/contracts/api.ts";
import type { PayloadPropostaRotina, Proposta } from "../../src/contracts/conversa.ts";
import type { Estado } from "../estado/reducer.ts";
import { botao, esc, iconeAgente } from "../lib/render.ts";
import { cardProposta, rotulada } from "../lib/card-proposta.ts";
import { conectorDoApp, nomeDoApp } from "./app-acesso.ts";
import { logoApp } from "./marketplace.ts";

/**
 * O perfil que vem com as rotinas (definido em 2026-09-28, ADR-050, "bot novo é bot completo"): UM card
 * com quem o bot passa a ser, o que ele vai fazer e que apps vai ler. Confirmar cria tudo e libera a
 * leitura (confirmar-proposta.ts). As propostas 'rotina' do perfil não viram card próprio: somem da
 * linha do tempo (idsNoPerfil) e aparecem aqui dentro. Perfil sem rotinas segue no card de sempre.
 */

/** Instrução de rotina escrita pelo modelo pode ser um parágrafo; o card mostra o começo e o resto no title. */
const INSTRUCAO_NO_CARD = 140;

type Rotina = { id: string; payload: PayloadPropostaRotina };

/** As propostas 'rotina' pendentes que algum perfil pendente carrega: não viram card próprio. */
export function idsNoPerfil(propostas: readonly Proposta[]): Set<string> {
  const ids = new Set<string>();
  for (const p of propostas) if (p.payload.kind === "perfil" && p.estado === "pendente") for (const id of p.payload.rotinas ?? []) ids.add(id);
  return ids;
}

function rotinasDe(p: Proposta, propostas: readonly Proposta[]): Rotina[] {
  if (p.payload.kind !== "perfil") return [];
  const porId = new Map(propostas.map((x) => [x.id, x]));
  return (p.payload.rotinas ?? []).flatMap((id) => {
    const r = porId.get(id);
    return r && r.estado === "pendente" && r.payload.kind === "rotina" ? [{ id, payload: r.payload }] : [];
  });
}

/** Os apps que as rotinas declaram, um por slug, com o nível mais alto pedido para ele. */
function appsDe(rotinas: readonly Rotina[]): { slug: string; escrita: boolean }[] {
  const apps = new Map<string, boolean>();
  for (const r of rotinas) for (const a of r.payload.acessos ?? []) apps.set(a.conector, (apps.get(a.conector) ?? false) || a.nivel === "escrita");
  return [...apps].map(([slug, escrita]) => ({ slug, escrita }));
}

function cortar(texto: string, teto: number): string {
  return texto.length > teto ? `${texto.slice(0, teto - 1)}…` : texto;
}

/** null = o perfil não traz rotinas (ou elas já saíram de pendente): o card de sempre desenha. */
export function renderCardPerfil(p: Proposta, propostas: readonly Proposta[], estado: Estado, agente: FrotaDto["agentes"][number] | undefined): string | null {
  if (p.payload.kind !== "perfil") return null;
  const rotinas = rotinasDe(p, propostas);
  if (rotinas.length === 0) return null;
  const c = p.payload;
  const nome = c.nome ?? agente?.nome ?? "O bot";
  const titulo = c.titulo ?? agente?.titulo ?? "";
  // NOD-399 (definido em 2026-10-30): o componente comum. Título com o verbo, até 3 linhas (quem é, as rotinas, os apps),
  // o resto — cada rotina, a descrição, o que falta conectar — em Detalhes. Sem o "Nada vale antes de você confirmar".
  const quem = titulo ? `${nome} · ${titulo}` : nome;
  const rotulo = rotinas.length === 1 ? "1 rotina" : `${rotinas.length} rotinas`;
  const resumoRotinas = rotinas.length === 1 ? cortar(rotinas[0]?.payload.instrucao ?? "", INSTRUCAO_NO_CARD) : rotinas.map((r) => r.payload.resumo).join(" · ");
  const apps = appsDe(rotinas);
  const nomesApps = apps.map(({ slug }) => nomeDoApp(estado, slug));
  // App ainda por conectar não trava o card: a rotina nasce e pede o acesso quando precisar (pré-voo, ADR-044).
  const faltam = apps.filter(({ slug }) => !conectorDoApp(estado, slug)?.habilitado).map(({ slug }) => nomeDoApp(estado, slug));
  const lerOuAlterar = apps.some((a) => a.escrita) ? "Ler e alterar" : "Ler";
  const linhas = [
    rotulada("Quem", quem),
    rotulada(rotulo === "1 rotina" ? "Rotina" : rotulo, resumoRotinas),
    ...(apps.length > 0 ? [rotulada("Vai poder", `${lerOuAlterar} ${nomesApps.join(", ")}`)] : []),
  ];
  const detalhes: [string, string][] = [
    ...(c.descricao ? [["Descrição", esc(c.descricao)] as [string, string]] : []),
    ...rotinas.map((r, i): [string, string] => [rotinas.length === 1 ? "Quando" : `Rotina ${i + 1}`, esc(rotinas.length === 1 ? r.payload.resumo : `${r.payload.resumo} · ${r.payload.instrucao}`)]),
    ...(apps.length > 0 ? [["Apps", apps.map(({ slug }) => `<span class="pc-app">${logoApp(estado, slug, nomeDoApp(estado, slug))}${esc(nomeDoApp(estado, slug))}</span>`).join(" ")] as [string, string]] : []),
    ...(faltam.length > 0 ? [["Falta conectar", esc(`${faltam.join(", ")}: ${nome} pede quando a rotina precisar.`)] as [string, string]] : []),
  ];
  const acoes = [
    botao("confirmar-proposta", apps.length > 0 ? "Salvar e permitir" : "Salvar", { classe: "cp-sim", id: p.id }),
    botao("preencher-prompt", "Ajustar", { classe: "cp-nao", dados: { texto: "Quero ajustar a proposta: " } }),
    botao("recusar-proposta", "Agora não", { classe: "cp-nao", id: p.id }),
  ].join("");
  return cardProposta({ id: p.id, classe: "perfil-card", titulo: `Configurar o bot ${nome}`, logo: agente ? iconeAgente({ ...agente, nome }, "sm") : "", linhas, detalhes, chaveDetalhes: `proposta-${p.id}`, acoes });
}
