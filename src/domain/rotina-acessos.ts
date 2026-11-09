import type { AcessoPedido } from "../contracts/acesso.ts";
import type { Concessao } from "../contracts/concessao.ts";
import type { Conector } from "../contracts/conector.ts";
import type { ArgsPedirAcesso } from "../contracts/ferramentas-nod.ts";
import type { MotivoBloqueioRotina } from "../contracts/motivos.ts";
import type { ExecucaoRotina, Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "./erro.ts";
import { capacidadesDeLeitura, normalizarPedidoAcesso } from "./pedido-acesso.ts";

/**
 * O que uma rotina precisa de acesso, decidido ANTES de gastar um turno (definido em 2026-09-24, emenda
 * da ADR-044, "rotina se trava sozinha"). Puro: recebe os conectores registrados e as concessões do
 * agente; quem lê o banco e trava é o caso de uso (src/use-cases/pre-voo-rotina.ts).
 */

export type ConectorRegistrado = Pick<Conector, "id" | "slug" | "nome" | "habilitado" | "catalogo">;

/**
 * Acesso que a rotina DECLARA (rotinas.acessos, 0027): o que o pré-voo lê dele. `capacidades` vazia = a
 * rotina declarou LER um app que ainda não estava conectado quando nasceu — as de leitura do catálogo,
 * resolvidas quando o card nascer (definido em 2026-09-24, "rotina nasce com o acesso").
 */
export type AcessoDeclarado = { conector: string; capacidades: readonly string[] };

export type NecessidadeDaRotina = {
  slug: string;
  /** null = o app declarado não está registrado: falta conectar. */
  conector: ConectorRegistrado | null;
  /**
   * As capacidades exatas (declaradas, ou as do card aberto); null = rotina legada, que só cita o app na
   * fonte, ou leitura declarada sem capacidades (app por conectar): precisa ler, e UMA ferramenta de
   * leitura concedida basta.
   */
  capacidades: readonly string[] | null;
};

export type MotivoFaltaDeAcesso = Exclude<MotivoBloqueioRotina, "aguardando_resposta">;
export type FaltaDeAcesso = { motivo: MotivoFaltaDeAcesso; necessidade: NecessidadeDaRotina };

/**
 * Os conectores que a fonte da rotina cita — o casamento EXATO que confiancaDaFonte sempre fez (slug ou
 * nome contido na fonte, sem caixa), mas só sobre os que a pessoa REGISTROU: "regressão linear" nunca
 * cita o Linear se o Linear não está registrado. Não é interpretação de intenção: é casar nomes.
 */
export function conectoresCitados<C extends Pick<Conector, "slug" | "nome">>(fonte: string, registrados: readonly C[]): C[] {
  const f = fonte.toLowerCase();
  return registrados.filter((c) => f.includes(c.slug.toLowerCase()) || f.includes(c.nome.toLowerCase()));
}

/**
 * Declarado ganha da fonte: com `acessos` presente (mesmo vazio) a rotina diz o que usa e a fonte não é
 * lida; ausente ou null (toda rotina anterior ao PR 6) cai nos conectores citados. Ordenado por slug:
 * quem trava um conector por necessidade trava sempre na mesma ordem.
 */
export function necessidadesDaRotina(rotina: Pick<Rotina, "fonte"> & { acessos?: readonly AcessoDeclarado[] | null }, registrados: readonly ConectorRegistrado[]): NecessidadeDaRotina[] {
  const lista: NecessidadeDaRotina[] =
    rotina.acessos !== undefined && rotina.acessos !== null
      ? rotina.acessos.map((a) => ({ slug: a.conector, conector: registrados.find((c) => c.slug === a.conector) ?? null, capacidades: a.capacidades.length > 0 ? [...new Set(a.capacidades)] : null }))
      : conectoresCitados(rotina.fonte, registrados).map((c) => ({ slug: c.slug, conector: c, capacidades: null }));
  return lista.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Os `acessos` de criar_rotina/atualizar_rotina, validados como pedidos de acesso em modo DECLARAÇÃO
 * (definido em 2026-09-24, emenda da ADR-044, "rotina nasce com o acesso"): app registrado ou do
 * marketplace, capacidades do catálogo, leitura com [] num app conectado já sai com as ferramentas de
 * leitura (é o que fica guardado na proposta e o que a pessoa vê), escrita só com os nomes exatos. Um item
 * por app — dois para o mesmo app seriam dois consentimentos para uma concessão. Ordenado por slug.
 */
export function normalizarAcessosDeclarados(pedidos: readonly ArgsPedirAcesso[], conectorDe: (slug: string) => Pick<Conector, "habilitado" | "catalogo"> | null): AcessoPedido[] {
  const slugs = pedidos.map((p) => p.conector);
  if (new Set(slugs).size !== slugs.length) throw new ErroDeDominio("entrada_invalida", { cause: "um item de acessos por app" });
  return pedidos.map((pedido) => normalizarPedidoAcesso({ pedido, conector: conectorDe(pedido.conector), emRotina: false, declaracao: true })).sort((a, b) => a.conector.localeCompare(b.conector));
}

/** Mesma declaração: mesmos apps com as mesmas capacidades e nível (a ordem não conta). */
export function mesmosAcessos(a: readonly AcessoPedido[] | null, b: readonly AcessoPedido[] | null): boolean {
  const chave = (l: readonly AcessoPedido[] | null) => (l === null ? "null" : JSON.stringify([...l].map((x) => [x.conector, x.nivel, [...new Set(x.capacidades)].sort()]).sort()));
  return chave(a) === chave(b);
}

/** O que o card pede: as capacidades exatas, ou — rotina legada — as de leitura do catálogo sondado agora. */
export function capacidadesDoPedido(n: NecessidadeDaRotina): string[] {
  if (n.capacidades !== null) return [...n.capacidades];
  return n.conector ? capacidadesDeLeitura(n.conector.catalogo) : [];
}

/**
 * A primeira necessidade que falta, na ordem dada. sem_conexao: o app não está registrado ou está
 * desligado — não há o que conceder ainda. sem_acesso: falta concessão; capacidades exatas exigem todas,
 * a rotina legada se satisfaz com UMA de leitura (a regra do ADR-044: "só ler" é o grupo de leitura).
 * App legado sem ferramenta de leitura no catálogo não trava: não haveria o que pedir por botão.
 */
export function faltaDeAcesso(necessidades: readonly NecessidadeDaRotina[], concessoes: readonly Pick<Concessao, "conectorId" | "capacidade">[]): FaltaDeAcesso | null {
  for (const n of necessidades) {
    const conector = n.conector;
    if (!conector || !conector.habilitado) return { motivo: "sem_conexao", necessidade: n };
    const concedidas = new Set(concessoes.filter((c) => c.conectorId === conector.id).map((c) => c.capacidade));
    if (n.capacidades !== null) {
      if (n.capacidades.some((c) => !concedidas.has(c))) return { motivo: "sem_acesso", necessidade: n };
      continue;
    }
    const leitura = capacidadesDeLeitura(conector.catalogo);
    if (leitura.length > 0 && !leitura.some((c) => concedidas.has(c))) return { motivo: "sem_acesso", necessidade: n };
  }
  return null;
}

/**
 * As janelas que não rodaram por falta de conexão ou acesso, da mais recente para trás, até a primeira
 * execução que não foi essa (entrada: execuções mais recentes primeiro, como rotinaExecucoesRepo.listar).
 * É a parada ATUAL: uma execução que rodou no meio encerra a contagem.
 */
export function janelasQueNaoRodaram(execucoes: readonly Pick<ExecucaoRotina, "desfecho" | "motivo" | "instanteAgendado">[]): number[] {
  const janelas: number[] = [];
  for (const e of execucoes) {
    if (e.desfecho !== "bloqueada" || (e.motivo !== "sem_acesso" && e.motivo !== "sem_conexao")) break;
    janelas.push(e.instanteAgendado);
  }
  return janelas;
}
