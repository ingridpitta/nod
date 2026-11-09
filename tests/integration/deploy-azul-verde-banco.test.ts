import { expect, it } from "vitest";
import { despacharPessoa } from "../../src/adapters/fundo/despachar-outbox.ts";
import type { FrameSse } from "../../src/contracts/frame.ts";
import { criarMetricas } from "../../src/obs/metricas.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarBarramento } from "../../src/services/barramento.ts";
import { agenteComConversa, autoriaAgente } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const NOVA = { iniciadaPor: "pessoa" as const, harness: "claude-cli", modelo: null, provedorStt: "falso", provedorTts: "falso", voz: "v1" };

/** NOD-218 (deploy azul/verde): o que o banco precisa saber para dois processos vivos não se atropelarem. */
describeIntegracao("NOD-218: ligações por cor e outbox só publicar", () => {
  it("ligacoes.instancia: criar grava a cor; vivas filtra por cor; semInstancia inclui as nulas (transição)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const l = await repos.ligacoes.criar({ ...NOVA, agenteId, conversaId, instancia: "azul" });
      if (!l) throw new Error("ligação não criada");
      const [linha] = await trx<{ instancia: string | null }[]>`select instancia from ligacoes where id = ${l.id}`;
      expect(linha?.instancia).toBe("azul");
      expect((await repos.ligacoes.vivas()).map((x) => x.id)).toEqual([l.id]);
      expect((await repos.ligacoes.vivas({ instancia: "azul" })).map((x) => x.id)).toEqual([l.id]);
      expect(await repos.ligacoes.vivas({ instancia: "verde" })).toEqual([]);
      expect(await repos.ligacoes.vivas({ instancia: "verde", semInstancia: true })).toEqual([]);
      await trx`update ligacoes set instancia = null where id = ${l.id}`;
      expect(await repos.ligacoes.vivas({ instancia: "verde" })).toEqual([]);
      expect((await repos.ligacoes.vivas({ instancia: "verde", semInstancia: true })).map((x) => x.id)).toEqual([l.id]);
    });
  });

  it("despacharPessoa com soPublicar: publica, NÃO marca entregue, não conta tentativa e não repete o id", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      await repos.events.gravarComOutbox([
        { kind: "mensagem_criada", autoria: autoriaAgente(agenteId, PESSOA_MARLON), pessoaDestinoId: PESSOA_MARLON, conversaId, dados: { mensagem_id: "m1", conversa_id: conversaId } },
      ]);
      const barramento = criarBarramento();
      const frames: FrameSse[] = [];
      barramento.inscrever(PESSOA_MARLON, (f) => frames.push(f));
      const vistos = new Set<string>();
      const [{ desde } = { desde: new Date() }] = await trx<{ desde: Date }[]>`select now() as desde`;
      const opcoes = { metricas: criarMetricas(), soPublicar: { vistos, desde } };
      expect(await despacharPessoa(trx, MARLON, barramento, opcoes)).toMatchObject({ publicados: 1, falhas: 0 });
      expect(await despacharPessoa(trx, MARLON, barramento, opcoes)).toMatchObject({ publicados: 0 });
      expect(frames.map((f) => f.tipo)).toEqual(["mensagem.nova"]);
      const pendentes = await criarRepos(trx, MARLON).outbox.pendentes();
      expect(pendentes).toHaveLength(1);
      expect(pendentes[0]?.tentativas).toBe(0);
      // A cor ativa (despachante normal) é quem marca: depois dela, nada pendente.
      expect(await despacharPessoa(trx, MARLON, criarBarramento(), { metricas: criarMetricas() })).toMatchObject({ publicados: 1 });
      expect(await criarRepos(trx, MARLON).outbox.pendentes()).toEqual([]);
    });
  });

  it("soPublicar também publica o que a cor ativa já entregou desde o início do modo (ela ganha a corrida), e só uma vez", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const repos = criarRepos(trx, MARLON);
      const evento = (m: string) => ({ kind: "mensagem_criada" as const, autoria: autoriaAgente(agenteId, PESSOA_MARLON), pessoaDestinoId: PESSOA_MARLON, conversaId, dados: { mensagem_id: m, conversa_id: conversaId } });
      // Entregue ANTES do modo começar: este processo já o publicou pelo laço normal; não repete.
      await repos.events.gravarComOutbox([evento("antes")]);
      await trx`update events_outbox set entregue_em = now() - interval '1 minute' where owner_id = ${PESSOA_MARLON} and entregue_em is null`;
      const [{ desde } = { desde: new Date() }] = await trx<{ desde: Date }[]>`select now() as desde`;
      // Nasce e a cor ativa entrega na hora, antes da passada deste processo.
      await repos.events.gravarComOutbox([evento("depois")]);
      expect(await despacharPessoa(trx, MARLON, criarBarramento(), { metricas: criarMetricas() })).toMatchObject({ publicados: 1 });
      expect(await repos.outbox.pendentes()).toEqual([]);

      const barramento = criarBarramento();
      const frames: FrameSse[] = [];
      barramento.inscrever(PESSOA_MARLON, (f) => frames.push(f));
      const opcoes = { metricas: criarMetricas(), soPublicar: { vistos: new Set<string>(), desde } };
      expect(await despacharPessoa(trx, MARLON, barramento, opcoes)).toMatchObject({ publicados: 1 });
      expect(await despacharPessoa(trx, MARLON, barramento, opcoes)).toMatchObject({ publicados: 0 });
      expect(frames.map((f) => f.dados.mensagem_id)).toEqual(["depois"]);
    });
  });
});
