import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { rotasContasIa } from "../../src/adapters/http/rotas/contas-ia.ts";
import type { DentroDeTx } from "../../src/adapters/http/rotas/dentro-de-tx.ts";
import type { FrenteAtivaDaConta } from "../../src/contracts/contas-ia.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Tx } from "../../src/shared/types.ts";
import { abrirFrentes } from "../../src/use-cases/frentes.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-293 C11 (definido em 2026-10-20): antes de "Sair desta máquina" ou "Remover", a tela pergunta ao servidor quais
 * frentes estão rodando com a conta (turnos `despachando` com `conta_id`, e `machine_id` quando é a saída de uma máquina,
 * colunas da 0074). Só lê, na transação escopada da pessoa: a conta de outra pessoa é 404.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const imp = (n: number) => n.toString(16).padStart(64, "0");

let trxAtual: Tx | null = null;
const dentro: DentroDeTx = async (escopo, fn) => {
  if (!trxAtual) throw new Error("teste sem transação aberta");
  await vincularEscopo(trxAtual, escopo);
  return fn(depsSobre(trxAtual, escopo).deps);
};

describeIntegracao("GET contas-ia/:id/frentes-ativas (NOD-293 C11)", () => {
  let srv: ServidorDeTeste;

  beforeAll(async () => {
    srv = await servidorDeTeste(rotasContasIa({
      dentro,
      logins: {} as never,
      dispositivo: {} as never,
      compartilhado: true,
      avisar: () => undefined,
      maquinaViva: () => false,
    }));
  });
  afterAll(() => srv.close());

  it("lista as frentes rodando com a conta (na máquina, ou em todas); outra pessoa recebe 404", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await srv.entrar("marlon");
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const { deps, repos } = depsSobre(trx, MARLON);
      const maquina = async (nome: string) => (await repos.maquinaTokens.criar({ nome, prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!.id;
      const vm = await maquina("vm-bots");
      const mac = await maquina("MacBook");
      const agora = Date.now();
      const anuncio = (n: number) => ({ impressao: imp(n), ia: "claude-cli" as const, estado: "pronta" as const, plano: "Max", corporativa: false, logadaEm: agora - 60_000 });
      await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(2)], agora);
      await repos.contasIa.doAnuncio(mac, [anuncio(1)], agora);
      const [pessoal, outra] = (await repos.contasIa.listar()).contas;

      const dono = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: agora + 600_000, profundidade: 0, entradaTexto: "duas frentes", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
      const r = await abrirFrentes(deps, { ...contexto(dono.agenteId, dono.conversaId, dono.id), frentes: [{ titulo: "Login no Safari", pedido: "Conserte o login." }, { titulo: "CI vermelha", pedido: "Descubra por que a CI quebrou." }, { titulo: "Ainda na fila", pedido: "Espere." }] });
      if (!r.data.ok) throw new Error("deveria abrir as frentes");
      const [safari, ci, fila] = r.data.frentes.map((f) => f.trabalho_id);
      const turnoDe = async (trabalhoId: string) => (await repos.turnos.doTrabalho(trabalhoId))[0]!;
      const rodar = async (turnoId: string, maquinaId: string, contaId: string) => {
        await trx`update turnos set estado = 'despachando', machine_id = ${maquinaId}, conta_id = ${contaId} where id = ${turnoId}`;
      };
      await rodar((await turnoDe(safari!)).id, vm, pessoal!.id);
      await rodar((await turnoDe(ci!)).id, mac, pessoal!.id);
      // A conversa rodando com a outra conta não entra; a frente pendente com a conta também não.
      await rodar(dono.id, vm, outra!.id);
      await trx`update turnos set conta_id = ${pessoal!.id} where id = ${(await turnoDe(fila!)).id}`;

      const ler = async (caminho: string) => {
        const res = await srv.chamar(marlon, "GET", caminho);
        expect(res.status).toBe(200);
        return (await res.json()) as FrenteAtivaDaConta[];
      };
      expect(await ler(`contas-ia/${pessoal!.id}/frentes-ativas?maquinaId=${vm}`)).toEqual([
        { trabalhoId: safari, titulo: "Login no Safari", agente: "Ada", conversaId: ada.conversaId, maquinaId: vm, maquina: "vm-bots" },
      ]);
      const todas = await ler(`contas-ia/${pessoal!.id}/frentes-ativas`);
      expect(todas.map((f) => [f.titulo, f.maquina]).sort()).toEqual([["CI vermelha", "MacBook"], ["Login no Safari", "vm-bots"]]);
      // A conversa (sem frente) vai com o título nulo e o nome do bot.
      expect(await ler(`contas-ia/${outra!.id}/frentes-ativas?maquinaId=${vm}`)).toEqual([
        { trabalhoId: null, titulo: null, agente: "Ada", conversaId: ada.conversaId, maquinaId: vm, maquina: "vm-bots" },
      ]);
      expect(await ler(`contas-ia/${outra!.id}/frentes-ativas?maquinaId=${mac}`)).toEqual([]);

      // Entrada ruim e conta de outra pessoa.
      expect((await srv.chamar(marlon, "GET", `contas-ia/${pessoal!.id}/frentes-ativas?maquinaId=x`)).status).toBe(400);
      expect((await srv.chamar(marlon, "GET", `contas-ia/${randomUUID()}/frentes-ativas`)).status).toBe(404);
      const ana = await srv.entrar("ana");
      expect((await srv.chamar(ana, "GET", `contas-ia/${pessoal!.id}/frentes-ativas`)).status).toBe(404);
      expect((await srv.chamar(ana, "GET", `contas-ia/${pessoal!.id}/frentes-ativas?maquinaId=${vm}`)).status).toBe(404);
    });
  });
});
