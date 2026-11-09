import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { definirCotaDoProvisorio } from "../../src/repositories/cota-provisorio.ts";
import * as repoContas from "../../src/repositories/contas.repo.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobreTrx } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { PRONTO } from "../helpers/conta-mundo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

const escopado = <T>(escopo: Escopo, fn: (trx: Tx) => Promise<T>): Promise<T> => db.begin(async (trx) => { await vincularEscopo(trx, escopo); return fn(trx); }) as Promise<T>;
const portao = () => { let abrir = () => undefined as void; const aberto = new Promise<void>((r) => { abrir = r; }); return { abrir, aberto }; };

describeIntegracao("NOD-408: cota concorrente do espaço provisório", () => {
  it("um burst no último lugar admite exatamente um turno", async () => {
    const escopo = { tenantId: randomUUID(), pessoaId: randomUUID() };
    let ids = { agentes: [] as string[], conversas: [] as string[] };
    try {
      await dbDono`insert into tenants (id, nome) values (${escopo.tenantId}, 'Cota concorrente')`;
      await dbDono`insert into pessoas (tenant_id, id, nome, iniciais) values (${escopo.tenantId}, ${escopo.pessoaId}, 'Cota', 'CO')`;
      await dbDono`insert into bootstrap_instalacoes (verificador_hash, tenant_id, pessoa_id) values (${randomBytes(32)}, ${escopo.tenantId}, ${escopo.pessoaId})`;
      const bot = await escopado(escopo, async (trx) => (await criarAgente(depsSobreTrx(trx, escopo), { dono: "pessoa" })).data);
      ids = { agentes: [bot.agente.id], conversas: [bot.conversa.id] };
      definirCotaDoProvisorio(1);
      const enviar = (texto: string) => escopado(escopo, (trx) => enviarMensagem(depsSobreTrx(trx, escopo), { conversaId: bot.conversa.id, texto, inventario: PRONTO }));
      const resultados = await Promise.allSettled([enviar("um"), enviar("dois"), enviar("três"), enviar("quatro")]);
      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(resultados.filter((r) => r.status === "rejected")).toHaveLength(3);
      expect(await escopado(escopo, (trx) => trx`select 1 from turnos where tenant_id = ${escopo.tenantId}`)).toHaveLength(1);
    } finally {
      definirCotaDoProvisorio(null);
      await dbDono`delete from bootstrap_instalacoes where tenant_id = ${escopo.tenantId}`;
      await limparPessoaE2E(db, dbDono, escopo, ids);
      await dbDono`delete from tenants where id = ${escopo.tenantId}`;
    }
  });

  it("se a conversão ganha a trava, o envio que esperou já passa sem cota", async () => {
    const escopo = { tenantId: randomUUID(), pessoaId: randomUUID() };
    let ids = { agentes: [] as string[], conversas: [] as string[] };
    try {
      await dbDono`insert into tenants (id, nome) values (${escopo.tenantId}, 'Cota e conversão')`;
      await dbDono`insert into pessoas (tenant_id, id, nome, iniciais) values (${escopo.tenantId}, ${escopo.pessoaId}, 'Cota', 'CO')`;
      await dbDono`insert into bootstrap_instalacoes (verificador_hash, tenant_id, pessoa_id) values (${randomBytes(32)}, ${escopo.tenantId}, ${escopo.pessoaId})`;
      const bot = await escopado(escopo, async (trx) => (await criarAgente(depsSobreTrx(trx, escopo), { dono: "pessoa" })).data);
      ids = { agentes: [bot.agente.id], conversas: [bot.conversa.id] };
      definirCotaDoProvisorio(1);
      const enviar = (texto: string) => escopado(escopo, (trx) => enviarMensagem(depsSobreTrx(trx, escopo), { conversaId: bot.conversa.id, texto, inventario: PRONTO }));
      await enviar("antes da conversão");
      const travou = portao();
      const concluir = portao();
      const conversao = escopado(escopo, async (trx) => {
        expect(await repoContas.travarInstalacaoViva(trx, escopo)).toBe(true);
        await repoContas.aposentarInstalacao(trx, escopo);
        travou.abrir();
        await concluir.aberto;
      });
      await travou.aberto;
      const depois = enviar("depois da conversão");
      concluir.abrir();
      await Promise.all([conversao, depois]);
      expect(await escopado(escopo, (trx) => trx`select 1 from turnos where tenant_id = ${escopo.tenantId}`)).toHaveLength(2);
    } finally {
      definirCotaDoProvisorio(null);
      await dbDono`delete from bootstrap_instalacoes where tenant_id = ${escopo.tenantId}`;
      await limparPessoaE2E(db, dbDono, escopo, ids);
      await dbDono`delete from tenants where id = ${escopo.tenantId}`;
    }
  });
});
