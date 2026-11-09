import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { despacharPessoa, frameDoEvento, FRAME_POR_EVENTO, iniciarDespachanteOutbox } from "../../src/adapters/fundo/despachar-outbox.ts";
import type { FrameSse } from "../../src/contracts/frame.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { criarMetricas } from "../../src/obs/metricas.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { listarTodas } from "../../src/repositories/pessoas.repo.ts";
import { criarBarramento, type Barramento } from "../../src/services/barramento.ts";
import { OUTBOX_IDADE_MIN_MS, OUTBOX_TETO_TENTATIVAS } from "../../src/shared/constantes.ts";
import type { Tx } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { withRollbackDono } from "../helpers/db-dono.ts";
import { agenteComConversa, autoriaAgente } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.UTC(2026, 8, 16, 12, 0, 0);

function coletor(barramento: Barramento, pessoaId: string): FrameSse[] {
  const frames: FrameSse[] = [];
  barramento.inscrever(pessoaId, (f) => frames.push(f));
  return frames;
}

async function eventoDeMensagem(trx: Tx): Promise<{ eventoId: string; conversaId: string }> {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
  const { ids } = await repos.events.gravarComOutbox([
    { kind: "mensagem_criada", autoria: autoriaAgente(agenteId, PESSOA_MARLON), pessoaDestinoId: PESSOA_MARLON, conversaId, dados: { mensagem_id: "m1", conversa_id: conversaId } },
  ]);
  return { eventoId: ids[0] ?? "", conversaId };
}

/**
 * ADR-010 refinado / Práticas §7: o evento gravado na tx do domínio sai como frame da PESSOA de destino;
 * falha ao publicar incrementa; cancelado (Parar) não sai; abandono só com as DUAS condições, contado
 * na métrica. A unidade exercitada é despacharPessoa sobre o trx do withRollback — o laço
 * (iniciarDespachanteOutbox) abre a própria tx por pessoa e é provado à parte, sem linhas.
 */
describeIntegracao("outbox → barramento (despachante)", () => {
  it("evento gravado na tx aparece como frame da pessoa, com kind e eventoId; a segunda passada não repete", async () => {
    await withRollback(MARLON, async (trx) => {
      const barramento = criarBarramento();
      const frames = coletor(barramento, PESSOA_MARLON);
      const { eventoId, conversaId } = await eventoDeMensagem(trx);
      const r = await despacharPessoa(trx, MARLON, barramento, { metricas: criarMetricas(), agora: () => AGORA });
      expect(r).toEqual({ publicados: 1, falhas: 0, abandonadosAgora: 0 });
      expect(frames).toEqual([
        // conversaId/turnoId vêm do evento (LEFT JOIN em events) para a web reidratar a conversa certa (L9).
        { streamId: barramento.posicao(PESSOA_MARLON).streamId, seq: 1, pessoaId: PESSOA_MARLON, tipo: "mensagem.nova", dados: { mensagem_id: "m1", conversa_id: conversaId, kind: "mensagem_criada", eventoId, conversaId, turnoId: null } },
      ]);
      expect(await criarRepos(trx, MARLON).outbox.pendentes()).toEqual([]);
      expect(await despacharPessoa(trx, MARLON, barramento, { metricas: criarMetricas(), agora: () => AGORA })).toMatchObject({ publicados: 0 });
      expect(frames).toHaveLength(1);
    });
  });

  it("falha injetada ao publicar incrementa tentativas e o item continua pendente; o próximo despachante sadio entrega", async () => {
    await withRollback(MARLON, async (trx) => {
      const quebrado: Barramento = {
        ...criarBarramento(),
        publicar() {
          throw new Error("socket morto");
        },
      };
      await eventoDeMensagem(trx);
      const r = await despacharPessoa(trx, MARLON, quebrado, { metricas: criarMetricas(), agora: () => AGORA });
      expect(r).toMatchObject({ publicados: 0, falhas: 1 });
      const [pendente] = await criarRepos(trx, MARLON).outbox.pendentes();
      expect(pendente?.tentativas).toBe(1);

      const sadio = criarBarramento();
      const frames = coletor(sadio, PESSOA_MARLON);
      expect(await despacharPessoa(trx, MARLON, sadio, { metricas: criarMetricas(), agora: () => AGORA })).toMatchObject({ publicados: 1, falhas: 0 });
      expect(frames.map((f) => f.tipo)).toEqual(["mensagem.nova"]);
    });
  });

  it("cancelado (Parar, E8.3) nunca sai; kind fora da tabela é linha envenenada (falha, tentativa) e nunca frame", async () => {
    await withRollback(MARLON, async (trx) => {
      const barramento = criarBarramento();
      const frames = coletor(barramento, PESSOA_MARLON);
      await eventoDeMensagem(trx);
      const repos = criarRepos(trx, MARLON);
      expect(await repos.outbox.cancelarPendentesDaPessoa(AGORA)).toBe(1);
      const envenenada = randomUUID();
      await trx`insert into events_outbox (id, owner_id, evento_id, tipo) values (${envenenada}, ${PESSOA_MARLON}, ${randomUUID()}, 'kind_que_nao_existe')`;
      const r = await despacharPessoa(trx, MARLON, barramento, { metricas: criarMetricas(), agora: () => AGORA });
      expect(r).toMatchObject({ publicados: 0, falhas: 1 });
      expect(frames).toEqual([]);
      expect((await repos.outbox.pendentes()).map((p) => [p.id, p.tentativas])).toEqual([[envenenada, 1]]);
      expect(() => frameDoEvento("kind_que_nao_existe")).toThrow(ErroDeDominio);
      for (const [kind, tipo] of Object.entries(FRAME_POR_EVENTO)) expect(frameDoEvento(kind)).toBe(tipo);
    });
  });

  it("abandonado só com as DUAS condições, contado na métrica outbox_abandonados e mantido na tabela", async () => {
    await withRollback(MARLON, async (trx) => {
      const metricas = criarMetricas();
      const barramento = criarBarramento();
      const frames = coletor(barramento, PESSOA_MARLON);
      const inserir = async (tentativas: number, idadeMs: number): Promise<string> => {
        const id = randomUUID();
        await trx`insert into events_outbox (id, owner_id, evento_id, tipo, tentativas, criado_em)
          values (${id}, ${PESSOA_MARLON}, ${randomUUID()}, 'negacao', ${tentativas}, ${new Date(AGORA - idadeMs)})`;
        return id;
      };
      const ambas = await inserir(OUTBOX_TETO_TENTATIVAS, OUTBOX_IDADE_MIN_MS * 2);
      const soTeto = await inserir(OUTBOX_TETO_TENTATIVAS + 3, 1_000);
      const soIdade = await inserir(0, OUTBOX_IDADE_MIN_MS * 3);

      // Um barramento que só falha: nada entrega, e o abandono acontece na varredura da mesma passada.
      const quebrado: Barramento = { ...barramento, publicar: () => { throw new Error("fora"); } };
      const r = await despacharPessoa(trx, MARLON, quebrado, { metricas, agora: () => AGORA });
      expect(r).toMatchObject({ abandonadosAgora: 1 });
      expect(metricas.ler({ metrica: "outbox_abandonados", tenant_id: TENANT_PADRAO, pessoa_id: PESSOA_MARLON })).toBe(1);
      expect(metricas.renderizarPrometheus()).toContain(`nod_outbox_abandonados{pessoa_id="${PESSOA_MARLON}",tenant_id="${TENANT_PADRAO}"} 1`);
      const repos = criarRepos(trx, MARLON);
      expect((await repos.outbox.pendentes()).map((p) => p.id).sort()).toEqual([soTeto, soIdade].sort());
      expect(await trx`select count(*)::int as n from events_outbox where id = ${ambas} and abandonado_em is not null`).toEqual([{ n: 1 }]);
      expect(frames).toEqual([]);
      // Sem varredura, a métrica não é tocada nesta passada.
      const outras = criarMetricas();
      await despacharPessoa(trx, MARLON, quebrado, { metricas: outras, agora: () => AGORA, varrerAbandono: false });
      expect(outras.renderizarPrometheus()).toBe("");
    });
  });

  it("o laço abre uma tx REAL por pessoa (paraCadaPessoa sobre o pool), roda passadas e para limpo", async () => {
    await withRollbackDono(async (trxDono) => {
      await trxDono`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
      await trxDono`insert into pessoas (tenant_id, id, nome, iniciais) values
        (${TENANT_PADRAO}, ${PESSOA_MARLON}, 'Marlon', 'MW'), (${TENANT_PADRAO}, ${PESSOA_ANA}, 'Ana', 'AN') on conflict do nothing`;
      const nossas = new Set([PESSOA_MARLON, PESSOA_ANA]);
      const metricas = criarMetricas();
      const falhas: string[] = [];
      const laco = iniciarDespachanteOutbox(db, criarBarramento(), {
        intervaloMs: 10,
        metricas,
        listarPessoas: async () => (await listarTodas(trxDono)).filter((p) => nossas.has(p.id)),
        aoFalhar: (escopo) => falhas.push(escopo.pessoaId),
      });
      await laco.passada();
      await new Promise((r) => setTimeout(r, 60));
      await laco.parar();
      expect(falhas).toEqual([]);
      // A primeira passada coleta os gauges por pessoa (sem linhas commitadas: 0) e o custo por tenant (0 por construção).
      expect(metricas.ler({ metrica: "pendencia_mais_velha_s", tenant_id: TENANT_PADRAO, pessoa_id: PESSOA_MARLON })).toBe(0);
      expect(metricas.ler({ metrica: "pendencia_mais_velha_s", tenant_id: TENANT_PADRAO, pessoa_id: PESSOA_ANA })).toBe(0);
      expect(metricas.ler({ metrica: "custo_servidor_mes", tenant_id: TENANT_PADRAO })).toBe(0);
      expect(metricas.ler({ metrica: "outbox_abandonados", tenant_id: TENANT_PADRAO, pessoa_id: PESSOA_MARLON })).toBeDefined();
      // Depois de parar nenhuma conexão do pool carrega pessoa (a tx por pessoa morreu com o escopo).
      const [fora] = await db<{ p: string | null }[]>`select current_setting('nod.pessoa_id', true) as p`;
      expect(fora?.p ?? "").toBe("");
    });
  });
});
