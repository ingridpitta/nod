import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ContaAnunciada } from "../../src/contracts/contas-ia.ts";
import { cotaDaContaNaLista } from "../../src/use-cases/contas-ia.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * 0074 (ADR-102): as contas de IA da pessoa em todas as máquinas. A mesma conta (a mesma impressão) anunciada por duas
 * máquinas vira UMA linha com dois vínculos; a lista é da pessoa (RLS); a remoção não ressuscita por uma máquina que
 * estava desligada (R4 da revisão).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const AGORA = Date.now();
const imp = (n: number) => n.toString(16).padStart(64, "0");
const anuncio = (n: number, extra: Partial<ContaAnunciada> = {}): ContaAnunciada => ({ impressao: imp(n), ia: "claude-cli", estado: "pronta", plano: "Max", corporativa: false, logadaEm: AGORA - 60_000, ...extra });

describeIntegracao("contas de IA da pessoa (0074, ADR-102)", () => {
  it("duas máquinas, a mesma conta: uma linha com os dois vínculos; conta nova vai para o fim com o apelido sugerido", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const mac = randomUUID();
      const vm = randomUUID();
      expect(await repos.contasIa.doAnuncio(mac, [anuncio(1, { apelidoSugerido: "Pessoal" }), anuncio(2, { ia: "codex-cli", plano: "Plus" })], AGORA)).toMatchObject({ sair: [], mudou: true });
      expect(await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(3, { plano: "Team", corporativa: true })], AGORA)).toMatchObject({ sair: [], mudou: true });
      const { contas, vinculos } = await repos.contasIa.listar();
      expect(contas.map((c) => [c.apelido, c.ia, c.posicao, c.corporativa])).toEqual([["Pessoal", "claude-cli", 1, false], ["Conta 2", "codex-cli", 2, false], ["Conta 3", "claude-cli", 3, true]]);
      const pessoal = contas[0]!.id;
      expect(vinculos.filter((v) => v.contaId === pessoal).map((v) => v.maquinaId).sort()).toEqual([mac, vm].sort());
      // O mesmo anúncio de novo não muda nada.
      expect(await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(3, { plano: "Team", corporativa: true })], AGORA)).toMatchObject({ sair: [], mudou: false });
    });
  });

  it("a máquina que não anuncia mais uma conta perde o vínculo; a saída pedida aparece na puxada até ela sair", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const vm = randomUUID();
      await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(2)], AGORA);
      const [a, b] = (await repos.contasIa.listar()).contas;
      expect(await repos.contasIa.pedirSaida(b!.id, vm, AGORA)).toBe(true);
      expect(await repos.contasIa.saidasPendentes(vm)).toEqual([imp(2)]);
      expect(await repos.contasIa.saiu(vm, [imp(2)])).toBe(1);
      expect(await repos.contasIa.saidasPendentes(vm)).toEqual([]);
      await repos.contasIa.doAnuncio(vm, [], AGORA);
      expect((await repos.contasIa.listar()).vinculos.filter((v) => v.contaId === a!.id)).toEqual([]);
    });
  });

  it("removida some da lista; a máquina desligada que volta com o login antigo recebe a saída (R4); um login novo a devolve", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const vm = randomUUID();
      await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(2)], AGORA - 3_600_000);
      const [, b] = (await repos.contasIa.listar()).contas;
      expect(await repos.contasIa.remover(b!.id, AGORA)).toBe(true);
      expect(await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(2, { logadaEm: AGORA - 7_200_000 })], AGORA + 1000)).toMatchObject({ sair: [imp(2)] });
      expect((await repos.contasIa.buscar(b!.id))?.removidaEm).toBe(AGORA);
      await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(2, { logadaEm: AGORA + 5_000 })], AGORA + 10_000);
      const voltou = await repos.contasIa.buscar(b!.id);
      expect(voltou?.removidaEm).toBeNull();
      expect(voltou?.posicao).toBe(2);
    });
  });

  it("NOD-283: a conta sem acesso resiste ao anúncio 'pronta' do mesmo login; um login mais novo a solta", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const vm = randomUUID();
      await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(2)], AGORA);
      const [, team] = (await repos.contasIa.listar()).contas;
      expect(await repos.contasIa.marcarSemAcesso(team!.id, vm, AGORA + 1000)).toBe(true);
      const estado = async () => (await repos.contasIa.listar()).vinculos.find((v) => v.contaId === team!.id)?.estado;
      expect(await estado()).toBe("sem_acesso");
      await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(2)], AGORA + 60_000);
      expect(await estado()).toBe("sem_acesso");
      await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(2, { logadaEm: AGORA + 90_000 })], AGORA + 120_000);
      expect(await estado()).toBe("pronta");
    });
  });

  it("NOD-253: o uso do plano é gravado também por conta; a linha por IA segue como antes", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const vm = randomUUID();
      await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(2)], AGORA);
      const [max, team] = (await repos.contasIa.listar()).contas;
      const uso = (utilizacao: number, medidoEm: number) => ({ harness: "claude-cli" as const, situacao: "normal" as const, cincoHoras: { utilizacao, renovaEm: AGORA + 3_600_000 }, semana: null, medidoEm });
      await repos.usoDoPlano.gravar(uso(0.995, AGORA), vm, max!.id);
      await repos.usoDoPlano.gravar(uso(0.2, AGORA + 1000), vm, team!.id);
      const porConta = await repos.usoDoPlano.listarPorConta();
      expect(porConta.map((u) => [u.contaId, u.cincoHoras?.utilizacao]).sort()).toEqual([[max!.id, 0.995], [team!.id, 0.2]].sort());
      expect((await repos.usoDoPlano.listar()).map((u) => u.cincoHoras?.utilizacao)).toEqual([0.2]);
      // Conta que não existe (apagada no meio do turno): a linha por IA fica, a entrega não cai.
      await repos.usoDoPlano.gravar(uso(0.5, AGORA + 2000), vm, randomUUID());
      expect(await repos.usoDoPlano.listarPorConta()).toHaveLength(2);
    });
  });

  it("NOD-12: a leitura por conta traz a máquina que mediu; o DTO da lista leva maquinaId e a janela que renovou", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const vm = randomUUID();
      await repos.contasIa.doAnuncio(vm, [anuncio(1)], AGORA);
      const [max] = (await repos.contasIa.listar()).contas;
      await repos.usoDoPlano.gravar({ harness: "claude-cli", situacao: "normal", cincoHoras: { utilizacao: 0.4, renovaEm: AGORA + 60_000 }, semana: { utilizacao: 0.3, renovaEm: AGORA + 86_400_000 }, medidoEm: AGORA }, vm, max!.id);
      const usos = await repos.usoDoPlano.listarPorConta();
      expect(usos.map((u) => u.maquinaId)).toEqual([vm]);
      // Dois minutos depois a janela de 5 h já renovou: sai das janelas e vai para `renovou`.
      expect(cotaDaContaNaLista(usos, AGORA + 120_000).get(max!.id)).toMatchObject({ cincoHoras: null, semana: { utilizacao: 0.3 }, maquinaId: vm, renovou: { cincoHoras: AGORA + 60_000, semana: null } });
      // Sem máquina na entrega, null (nunca um id inventado).
      await repos.usoDoPlano.gravar({ harness: "claude-cli", situacao: "normal", cincoHoras: null, semana: null, medidoEm: AGORA + 1000 }, null, max!.id);
      expect((await repos.usoDoPlano.listarPorConta()).map((u) => u.maquinaId)).toEqual([null]);
    });
  });

  it("ADR-108 (revisão do PR 2, C4) + NOD-308: a conta que volta segue a regra de nascimento; a que vira corporativa fica na fila", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const vm = randomUUID();
      await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(2)], AGORA - 3_600_000);
      const [a, b] = (await repos.contasIa.listar()).contas;
      expect([a!.entraNaTrocaAutomatica, b!.entraNaTrocaAutomatica]).toEqual([true, false]);
      // A 2ª entra na fila (a pessoa ligou, com o aviso dos termos) e depois a 1ª é removida e volta com um login novo:
      // volta FORA da fila (a 2ª é agora a pessoal ativa), não com a marca antiga.
      await repos.contasIa.definirTrocaAutomatica(b!.id, true);
      await repos.contasIa.remover(a!.id, AGORA);
      await repos.contasIa.doAnuncio(vm, [anuncio(1, { logadaEm: AGORA + 5_000 }), anuncio(2)], AGORA + 10_000);
      expect((await repos.contasIa.buscar(a!.id))?.entraNaTrocaAutomatica).toBe(false);
      // Removida a única pessoal e devolvida sozinha: volta na fila (é de novo a 1ª pessoal da IA).
      await repos.contasIa.remover(a!.id, AGORA + 20_000);
      await repos.contasIa.remover(b!.id, AGORA + 20_000);
      await repos.contasIa.doAnuncio(vm, [anuncio(2, { logadaEm: AGORA + 30_000 })], AGORA + 40_000);
      expect((await repos.contasIa.buscar(b!.id))?.entraNaTrocaAutomatica).toBe(true);
      // NOD-308: a mesma conta anunciada agora como corporativa (o plano mudou para Team) fica na fila.
      await repos.contasIa.doAnuncio(vm, [anuncio(2, { logadaEm: AGORA + 30_000, plano: "Team", corporativa: true })], AGORA + 50_000);
      expect(await repos.contasIa.buscar(b!.id)).toMatchObject({ corporativa: true, entraNaTrocaAutomatica: true });
    });
  });

  it("NOD-308: a corporativa segue a regra da pessoal — 1ª da IA nasce na fila, Team como 2ª nasce fora, devolvida segue o nascimento", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const vm = randomUUID();
      const r = await repos.contasIa.doAnuncio(vm, [anuncio(1, { plano: "Team", corporativa: true }), anuncio(2, { plano: "Enterprise", corporativa: true })], AGORA - 3_600_000);
      expect(r.prontasAgora.map((c) => [c.corporativa, c.entraNaTrocaAutomatica])).toEqual([[true, true], [true, false]]);
      const [a, b] = (await repos.contasIa.listar()).contas;
      expect([a!.entraNaTrocaAutomatica, b!.entraNaTrocaAutomatica]).toEqual([true, false]);
      // Removidas as duas, a 2ª volta sozinha: é a 1ª ativa da IA e volta na fila, mesmo corporativa.
      await repos.contasIa.remover(a!.id, AGORA);
      await repos.contasIa.remover(b!.id, AGORA);
      await repos.contasIa.doAnuncio(vm, [anuncio(2, { plano: "Enterprise", corporativa: true, logadaEm: AGORA + 5_000 })], AGORA + 10_000);
      expect((await repos.contasIa.buscar(b!.id))?.entraNaTrocaAutomatica).toBe(true);
    });
  });

  it("QA do PR 341 (NOD-277 + NOD-221): prontasAgora leva a marca da fila gravada neste anúncio, não a da linha antiga", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const vm = randomUUID();
      // Conta nova: a 1ª nasce na fila e a corporativa (2ª do Claude) nasce fora, e o anúncio diz isso.
      const r1 = await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(3, { plano: "Team", corporativa: true })], AGORA - 3_600_000);
      expect(r1.prontasAgora.map((c) => [c.ia, c.corporativa, c.entraNaTrocaAutomatica])).toEqual([["claude-cli", false, true], ["claude-cli", true, false]]);
      const corp = (await repos.contasIa.listar()).contas.find((c) => c.corporativa)!;
      // A corporativa ligada na fila, removida e devolvida com um login novo: volta FORA (regra de nascimento) e o anúncio
      // não pode dizer "na fila" pela marca antiga, senão o gatilho de conta nova acordaria as esperas da cota (NOD-221).
      await repos.contasIa.definirTrocaAutomatica(corp.id, true);
      await repos.contasIa.remover(corp.id, AGORA);
      const r2 = await repos.contasIa.doAnuncio(randomUUID(), [anuncio(1), anuncio(3, { plano: "Team", corporativa: true, logadaEm: AGORA + 5_000 })], AGORA + 10_000);
      expect((await repos.contasIa.buscar(corp.id))?.entraNaTrocaAutomatica).toBe(false);
      expect(r2.prontasAgora.find((c) => c.contaId === corp.id)?.entraNaTrocaAutomatica).toBe(false);
      // NOD-308: a pessoal na fila que passa a ser corporativa, pronta numa máquina nova, fica na fila e o anúncio diz isso.
      const pessoal = (await repos.contasIa.listar()).contas.find((c) => !c.corporativa)!;
      const r3 = await repos.contasIa.doAnuncio(randomUUID(), [anuncio(1, { plano: "Team", corporativa: true })], AGORA + 20_000);
      expect((await repos.contasIa.buscar(pessoal.id))?.entraNaTrocaAutomatica).toBe(true);
      expect(r3.prontasAgora).toEqual([{ contaId: pessoal.id, ia: "claude-cli", corporativa: true, entraNaTrocaAutomatica: true }]);
    });
  });

  it("reordenar exige exatamente as contas da lista; renomear, limite, na fila e a escolhida (o modo antigo só guardado)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      await repos.contasIa.doAnuncio(randomUUID(), [anuncio(1), anuncio(2, { ia: "codex-cli" }), anuncio(3)], AGORA);
      const ids = (await repos.contasIa.listar()).contas.map((c) => c.id);
      expect(await repos.contasIa.reordenar([ids[0]!, ids[1]!])).toBe(false);
      expect(await repos.contasIa.reordenar([ids[2]!, ids[0]!, ids[1]!])).toBe(true);
      expect((await repos.contasIa.listar()).contas.map((c) => c.id)).toEqual([ids[2], ids[0], ids[1]]);
      expect(await repos.contasIa.renomear(ids[0]!, "Lumen")).toBe(true);
      await repos.contasIa.marcarLimite(ids[0]!, AGORA + 3_600_000);
      expect((await repos.contasIa.buscar(ids[0]!))?.noLimiteAte).toBe(AGORA + 3_600_000);
      expect(await repos.contasIa.limparLimite(ids[0]!)).toBe(true);
      expect(await repos.contasIa.limparLimite(ids[0]!)).toBe(false);
      // ADR-108: "na fila" por conta. A 1ª do Claude nasceu nela, a 2ª (anuncio 3) fora; ligar e desligar é da dona.
      expect((await repos.contasIa.listar()).contas.map((c) => c.entraNaTrocaAutomatica)).toEqual([false, true, true]);
      expect(await repos.contasIa.definirTrocaAutomatica(ids[2]!, true)).toBe(true);
      expect((await repos.contasIa.buscar(ids[2]!))?.entraNaTrocaAutomatica).toBe(true);
      // O modo ("Perguntar antes"/"Trocar sozinho") continua guardado só para o app antigo; nenhuma decisão o lê (ADR-108).
      expect(await repos.contasIa.modo()).toEqual({ modo: "perguntar", escolhidas: {} });
      await repos.contasIa.definirModo("automatico");
      await repos.contasIa.definirEscolhida("claude-cli", ids[2]!);
      expect(await repos.contasIa.modo()).toEqual({ modo: "automatico", escolhidas: { "claude-cli": ids[2] } });
      await repos.contasIa.definirEscolhida("claude-cli", null);
      expect((await repos.contasIa.modo()).escolhidas).toEqual({});
    });
  });

  it("RLS: as contas são da pessoa (a Ana não vê as do Marlon)", async () => {
    await withRollback(MARLON, async (trx) => {
      await depsSobre(trx, MARLON).repos.contasIa.doAnuncio(randomUUID(), [anuncio(1)], AGORA);
    });
    await withRollback(ANA, async (trx) => {
      expect((await depsSobre(trx, ANA).repos.contasIa.listar()).contas).toEqual([]);
    });
  });
});
