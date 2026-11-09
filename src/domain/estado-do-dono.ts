import type { EsperaDoDonoDto, EstadoDoDono, PedidoNaFilaDto, PrincipalDoDono } from "../contracts/dono.ts";
import type { EstadoTrabalho } from "../contracts/trabalho.ts";
import { VOLTAS_SEM_NOVIDADE } from "../contracts/ferramentas-trabalho.ts";
import { voltaSemNovidade, type VoltaDaCadeia } from "./voltas-sem-novidade.ts";

/**
 * O estado do dono (definido em 2026-10-12, ADR-099 item 10, issue I10): a linha acima do campo e a linha do bot em
 * Trabalhos dizem UMA coisa — a de maior prioridade — e contam o resto ao lado. Em 11/10 às 20:33 a tela dizia
 * "Trabalhando · 13" com um trabalhando de fato e dez esperando a CI do #845; aqui isso é "Trabalhando em 1 frente ·
 * 10 esperando". Puro: quem lê o banco é o caso de uso (src/use-cases/estado-do-dono.ts).
 *
 * Cada frente aberta e a própria conversa contam UMA vez, pelo que estão fazendo:
 * - a frente parada numa decisão (`precisa_de_voce`, `fechado_ocioso`) espera você;
 * - com turno vivo e rodando, trabalha; a conversa com turno vivo também — salvo (NOD-300, definido em 2026-10-20) a
 *   frente cujo turno vivo está numa máquina sem contato: ela espera, com o motivo "<máquina> · sem contato" desde o
 *   último contato (uma espera sintética, só para o motivo e o desde; não vira espera da linha aberta);
 * - sem turno vivo e com uma espera (comando, volta marcada, colega), espera — esperar não é trabalhar;
 * - sem turno vivo nem espera (na fila, ou entre um turno e outro), está na fila, com os pedidos ainda não começados.
 */

/** O que o estado lê de cada frente aberta do bot. */
export type FrenteParaODono = {
  id: string;
  estado: EstadoTrabalho;
  /** Tem turno vivo (despachando) agora. */
  vivo: boolean;
  iniciadoEm: number | null;
  criadoEm: number;
  /** NOD-300: a máquina do turno vivo está sem contato (nome e desde). Ausente ou null = fala (ou não se sabe). */
  semContato?: { maquina: string; desde: number } | null;
};

export type FatosDoDono = {
  agenteId: string;
  /** Os trabalhos abertos do bot (frentes, e as tasks de antes). */
  frentes: readonly FrenteParaODono[];
  /** Desde quando um turno do bot fora de frente roda; null = nenhum. */
  conversaTrabalhandoDesde: number | null;
  /** NOD-219: o mesmo, só na conversa própria (sem sala). Ausente = não lido; o estado sai sem `conversaPropriaTrabalhando`. */
  conversaPropriaTrabalhandoDesde?: number | null;
  /** As decisões abertas do bot (da conversa e das frentes) e a mais antiga. */
  decisoes: { quantas: number; desde: number | null };
  /** Todas as esperas do bot (da conversa: `trabalhoId` null; das frentes: o id dela). */
  esperas: readonly Pick<EsperaDoDonoDto, "trabalhoId" | "motivo" | "desde">[];
  /** Os pedidos na fila do dono, ainda não começados. */
  fila: readonly Pick<PedidoNaFilaDto, "desde">[];
};

type Situacao = "voce" | "trabalhando" | "esperando" | "fila" | "nada";

function situacaoDaFrente(f: FrenteParaODono, esperando: boolean): Situacao {
  if (f.estado === "precisa_de_voce" || f.estado === "fechado_ocioso") return "voce";
  if (f.estado === "rodando" && f.vivo && f.semContato) return "esperando";
  if (f.estado === "rodando" && f.vivo) return "trabalhando";
  if (f.estado === "rodando" && esperando) return "esperando";
  if (f.estado === "rodando" || f.estado === "na_fila") return "fila";
  return "nada";
}

const menor = (xs: readonly (number | null | undefined)[]): number | null => {
  const validos = xs.filter((x): x is number => typeof x === "number");
  return validos.length === 0 ? null : Math.min(...validos);
};

export function estadoDoDono(f: FatosDoDono): EstadoDoDono {
  const comEspera = new Set(f.esperas.map((e) => e.trabalhoId));
  const porSituacao = new Map<Situacao, FrenteParaODono[]>();
  for (const frente of f.frentes) {
    const s = situacaoDaFrente(frente, comEspera.has(frente.id));
    porSituacao.set(s, [...(porSituacao.get(s) ?? []), frente]);
  }
  const quantas = (s: Situacao) => porSituacao.get(s)?.length ?? 0;
  // NOD-260 (definido em 2026-10-15): o turno de uma sala não é "trabalhando na conversa" — a conversa do dono é a
  // própria. Lida a própria (`conversaPropriaTrabalhandoDesde`), ela decide; ausente (quem ainda não lê), vale a de antes.
  const conversaDesde = f.conversaPropriaTrabalhandoDesde === undefined ? f.conversaTrabalhandoDesde : f.conversaPropriaTrabalhandoDesde;
  const conversaTrabalhando = conversaDesde !== null;
  // A espera conta pela unidade que espera: a conversa (sem turno vivo) e as frentes que só esperam.
  const esperandoIds = new Set((porSituacao.get("esperando") ?? []).map((x) => x.id));
  const esperasValidas = f.esperas.filter((e) => (e.trabalhoId === null ? !conversaTrabalhando : esperandoIds.has(e.trabalhoId)));
  const conversaEsperando = !conversaTrabalhando && esperasValidas.some((e) => e.trabalhoId === null);
  // NOD-300: a frente presa a máquina sem contato entra só no motivo e no desde da linha fechada.
  const presas = (porSituacao.get("esperando") ?? []).flatMap((x) => (x.vivo && x.semContato ? [{ trabalhoId: x.id, motivo: `${x.semContato.maquina} · sem contato`, desde: x.semContato.desde }] : []));
  const maisAntiga = [...esperasValidas, ...presas].sort((a, b) => a.desde - b.desde)[0] ?? null;

  const esperandoVoce = Math.max(f.decisoes.quantas, quantas("voce"));
  const frentes = quantas("trabalhando");
  const esperando = quantas("esperando") + (conversaEsperando ? 1 : 0);
  const fila = f.fila.length + quantas("fila");

  const principal: PrincipalDoDono =
    esperandoVoce > 0 ? "esperando_voce" : frentes > 0 || conversaTrabalhando ? "trabalhando" : esperando > 0 ? "esperando" : fila > 0 ? "fila" : "livre";
  const desde =
    principal === "esperando_voce"
      ? menor([f.decisoes.desde, ...(porSituacao.get("voce") ?? []).map((x) => x.iniciadoEm ?? x.criadoEm)])
      : principal === "trabalhando"
        ? menor([conversaDesde, ...(porSituacao.get("trabalhando") ?? []).map((x) => x.iniciadoEm ?? x.criadoEm)])
        : principal === "esperando"
          ? (maisAntiga?.desde ?? null)
          : principal === "fila"
            ? menor([...f.fila.map((p) => p.desde), ...(porSituacao.get("fila") ?? []).map((x) => x.criadoEm)])
            : null;
  return {
    agenteId: f.agenteId,
    principal,
    frentes,
    conversaTrabalhando,
    ...(f.conversaPropriaTrabalhandoDesde === undefined ? {} : { conversaPropriaTrabalhando: f.conversaPropriaTrabalhandoDesde !== null }),
    esperandoVoce,
    esperando,
    fila,
    motivoEspera: maisAntiga?.motivo ?? null,
    desde,
  };
}

/**
 * A tentativa da espera de comando (definido em 2026-10-12, ADR-099 item 5): "tentativa 2 de 3". `anteriores` são as
 * voltas da mesma cadeia, da mais nova para a mais antiga, SEM o turno que deixou esta espera; `emVolta` diz se esse
 * turno já é uma volta da cadeia (ele conta como a volta que esperou de novo). A conta para no teto: na terceira volta
 * sem novidade o bot para e pergunta (voltas-sem-novidade.ts).
 */
export function tentativaDaEspera(anteriores: readonly VoltaDaCadeia[], emVolta: boolean, teto: number = VOLTAS_SEM_NOVIDADE): number {
  if (!emVolta) return 1;
  let seguidas = 0;
  for (const v of anteriores) {
    if (!voltaSemNovidade(v)) break;
    seguidas += 1;
  }
  return Math.min(seguidas + 2, teto);
}

/** A última linha não vazia de uma saída (o que a linha aberta mostra da espera); null sem saída. */
export function ultimaLinha(saida: string | null | undefined): string | null {
  const linhas = (saida ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  return linhas.at(-1)?.slice(0, 200) ?? null;
}
