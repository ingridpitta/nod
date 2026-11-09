import type { Conector } from "../../contracts/conector.ts";
import type { ResultadoSonda } from "../../contracts/servicos.ts";
import { randomUUID } from "node:crypto";
import { ErroBancoOcupado } from "../../db/tx.ts";
import { falhaVisivel, type EstadoDisjuntor } from "../../domain/disjuntor-conector.ts";
import { executarComContexto } from "../../obs/contexto.ts";
import { log } from "../../obs/log.ts";
import { PROBE_MS } from "../../shared/constantes.ts";
import type { Db, Escopo } from "../../shared/types.ts";
import { aplicarResultadoDaSonda, promoverFalha, type ResultadoDaSondaDeFundo } from "../../use-cases/disjuntor-conector.ts";
import { conectorPublico } from "../../use-cases/registrar-conector.ts";
import { executar, type DentroDeTx } from "../http/rotas/dentro-de-tx.ts";
import { logarTickLento, paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/** definido em 2026-10-26 (NOD-374): o laço re-sonda as falhas vencidas uma vez por minuto (a menor espera é 1 min ±25%). */
export const INTERVALO_DISJUNTOR_MS = 60_000;
/** Teto de cada sonda de fundo (tools/list): os 8 s da sonda (critério 2 da NOD-374), para um app travado não segurar a volta. */
export const ORCAMENTO_SONDA_DE_FUNDO_MS = PROBE_MS;
/**
 * Confirmações ao mesmo tempo: no processo e por pessoa (um dono com muitos apps caídos não ocupa a vaga dos outros). A
 * descartada é logada (`conector_confirmacao_adiada`): a próxima chamada que falhar confirma de novo, e o timeout contado
 * já está no banco.
 */
export const CONFIRMACOES_SIMULTANEAS = 16;
export const CONFIRMACOES_POR_PESSOA = 4;

export type SondarDeFundo = (conector: Conector, opcoes: { orcamentoMs: number; manterVivos: true }) => Promise<ResultadoSonda>;

export type Disjuntor = {
  /** Depois de uma chamada que falhou por timeout ou queda: sonda o app fora de tx e aplica. Não espera; não lança. */
  confirmar(escopo: Escopo, conectorId: string): void;
  /** Uma volta do laço (exposta para o teste). */
  varrer(opcoes?: OpcoesLaco): Promise<void>;
  /** Sobe o laço de re-sonda (só na cor ativa); o `parar` devolvido para o laço sem barrar as confirmações. */
  iniciarLaco(o?: { intervaloMs?: number; opcoes?: OpcoesLaco }): { parar(): Promise<void> };
  /** Avisa a tela da pessoa (frota e conectores) — a chamada que limpou a falha usa (rotas/interno.ts). Não lança. */
  mudou(escopo: Escopo): void;
  /** Para tudo: o laço e as confirmações (fechar do servidor). */
  parar(): Promise<void>;
};

/**
 * definido em 2026-10-26 (NOD-374): o disjuntor por app em produção. Duas entradas — a confirmação depois da chamada que
 * falhou e o laço que re-sonda a falha aberta — e a mesma regra: ler o conector numa tx curta, sondar FORA de tx
 * (`manterVivos`: não derruba o cliente de outra chamada em curso) e aplicar o resultado numa tx nova da dona. Um app só
 * tem uma sonda de cada vez no processo (`emSonda`). Uma sonda que lança conta como queda (conector_indisponivel).
 */
export function criarDisjuntor(p: { db: Db; dentro: DentroDeTx; sondar: SondarDeFundo; mudou?: (escopo: Escopo) => void }): Disjuntor {
  const emSonda = new Set<string>();
  const confirmacoes = new Set<Promise<void>>();
  const porPessoa = new Map<string, number>();
  // A tela relê a frota e os conectores quando o app entra ou sai de Fora do ar (sem esperar a pessoa navegar).
  const avisar = (escopo: Escopo, antes: Pick<EstadoDisjuntor, "ultimaFalha" | "foraDoArDesde"> | null, depois: Pick<EstadoDisjuntor, "ultimaFalha" | "foraDoArDesde"> | null) => {
    if (antes && depois && falhaVisivel(antes) === falhaVisivel(depois)) return;
    try {
      p.mudou?.(escopo);
    } catch {
      // o aviso à tela é melhor-esforço: a próxima leitura da frota mostra o estado certo
    }
  };
  let parado = false;

  // Sob o contexto de log da dona: sem ele, o `carregar` do conector não sabe de quem é a sonda (compor.ts), e o log sai sem pessoa.
  function sondarEAplicar(escopo: Escopo, conector: Conector, via: "confirmacao" | "laco"): Promise<void> {
    return executarComContexto({ tenantId: escopo.tenantId, pessoaId: escopo.pessoaId, correlationId: randomUUID() }, async () => {
      let resultado: ResultadoDaSondaDeFundo;
      try {
        const r = await p.sondar(conector, { orcamentoMs: ORCAMENTO_SONDA_DE_FUNDO_MS, manterVivos: true });
        resultado = r.ok ? { ok: true } : { ok: false, motivo: r.motivo, ...(r.causa ? { causa: r.causa } : {}) };
      } catch (e) {
        log("aviso", "conector_sonda_falhou", { conector_id: conector.id, via, erro: e instanceof Error ? e.name : "desconhecido" });
        resultado = { ok: false, motivo: "conector_indisponivel" };
      }
      const saida = await p.dentro(escopo, (d) => executar(d, aplicarResultadoDaSonda, { conectorId: conector.id, slug: conector.slug, resultado }));
      avisar(escopo, { ultimaFalha: conector.ultimaFalha, foraDoArDesde: conector.foraDoArDesde ?? null }, saida.estado);
      if (!resultado.ok) log("info", "conector_sonda_sem_resposta", { conector_id: conector.id, via, motivo: resultado.motivo, falhas_seguidas: saida.estado?.falhasSeguidas ?? null, fora_do_ar: saida.estado?.foraDoArDesde != null });
    });
  }

  async function exclusivo(id: string, fn: () => Promise<void>): Promise<void> {
    if (emSonda.has(id)) return;
    emSonda.add(id);
    try {
      await fn();
    } finally {
      emSonda.delete(id);
    }
  }

  function confirmar(escopo: Escopo, conectorId: string): void {
    if (parado || emSonda.has(conectorId)) return;
    const daPessoa = porPessoa.get(escopo.pessoaId) ?? 0;
    if (confirmacoes.size >= CONFIRMACOES_SIMULTANEAS || daPessoa >= CONFIRMACOES_POR_PESSOA) {
      log("aviso", "conector_confirmacao_adiada", { conector_id: conectorId, em_voo: confirmacoes.size, da_pessoa: daPessoa });
      return;
    }
    porPessoa.set(escopo.pessoaId, daPessoa + 1);
    const feita: Promise<void> = exclusivo(conectorId, async () => {
      const conector = await p.dentro(escopo, (d) => d.repos.conectores.buscar(conectorId));
      if (!conector) return;
      await sondarEAplicar(escopo, conectorPublico(conector), "confirmacao");
    })
      .catch((e: unknown) => {
        log("erro", "conector_confirmacao_falhou", { conector_id: conectorId, erro: e instanceof Error ? e.name : "desconhecido" });
      })
      .finally(() => {
        confirmacoes.delete(feita);
        const n = (porPessoa.get(escopo.pessoaId) ?? 1) - 1;
        if (n > 0) porPessoa.set(escopo.pessoaId, n);
        else porPessoa.delete(escopo.pessoaId);
      });
    confirmacoes.add(feita);
  }

  async function varrer(opcoes: OpcoesLaco = {}): Promise<void> {
    await paraCadaPessoa(p.db, async (escopo) => {
      const abertos = await p.dentro(escopo, (d) => d.repos.conectores.comFalhaAberta());
      // Um app por vez: a volta é sequencial e cada sonda tem teto; um app que falha não impede os outros.
      for (const a of abertos) {
        if (parado) return;
        await exclusivo(a.id, async () => {
          const { sondar, promovida } = await p.dentro(escopo, (d) => executar(d, promoverFalha, { conectorId: a.id }));
          if (promovida) avisar(escopo, null, null);
          if (!sondar) return;
          const conector = await p.dentro(escopo, (d) => d.repos.conectores.buscar(a.id));
          if (conector) await sondarEAplicar(escopo, conectorPublico(conector), "laco");
        }).catch((e: unknown) => {
          // Banco ocupado encerra a volta inteira do laço (NOD-266): insistir app a app só soma carga ao pool cheio.
          if (e instanceof ErroBancoOcupado) throw e;
          log("erro", "conector_ressonda_falhou", { conector_id: a.id, erro: e instanceof Error ? e.name : "desconhecido" });
        });
      }
    }, opcoes);
  }

  let rodando = false;
  let emVoo: Promise<unknown> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    confirmar,
    varrer,
    mudou: (escopo) => avisar(escopo, null, null),
    // NOD-218: o laço só sobe na cor ativa (boot.ts, ligarLacos); a confirmação vale nas duas cores (ela atende HTTP).
    iniciarLaco(o = {}) {
      if (timer || parado) return { parar: async () => undefined };
      const intervaloMs = o.intervaloMs ?? INTERVALO_DISJUNTOR_MS;
      timer = setInterval(() => {
        if (rodando || parado) return;
        rodando = true;
        const inicio = Date.now();
        emVoo = varrer(o.opcoes)
          .catch((e: unknown) => log("erro", "disjuntor_conectores_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }))
          .finally(() => {
            logarTickLento("disjuntor_conectores", Date.now() - inicio, intervaloMs);
            rodando = false;
            emVoo = null;
          });
      }, intervaloMs);
      return {
        async parar() {
          if (timer) clearInterval(timer);
          timer = null;
          if (emVoo) await emVoo;
        },
      };
    },
    // A drenagem espera a volta e as confirmações em voo; depois de parar, nada novo começa.
    async parar() {
      parado = true;
      if (timer) clearInterval(timer);
      timer = null;
      if (emVoo) await emVoo;
      await Promise.all([...confirmacoes]);
    },
  };
}
