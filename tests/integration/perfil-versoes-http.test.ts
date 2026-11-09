import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasAgentes } from "../../src/adapters/http/rotas/agentes.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import type { ErroDto } from "../../src/contracts/api.ts";
import type { DetalheVersaoPerfil, ListaVersoesPerfil } from "../../src/contracts/versoes-perfil.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { MARLON, depsSobreTrx, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-20 pela API: o Salvar da tela com a voz junto vira UMA versão; a lista, o detalhe e o restaurar respondem com os
 * códigos certos (404 versão inexistente, 400 número ruim, 409 igual à atual) e a outra pessoa não lê nem restaura.
 */
describeIntegracao("histórico de versões do perfil pela API (NOD-20)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx:
        (escopo: Escopo) =>
        async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: T } = {};
          await trx.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(sp);
          });
          return caixa.valor as T;
        },
      services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON),
      useCases: useCasesDeTeste(),
      prazoDecisaoMs: 60_000,
      executor: "catcher",
    };
    servidor = await servidorDeTeste(criarRotasAgentes(deps));
  });
  afterAll(() => servidor.close());

  it("Salvar com voz junto = 1 versão; lista, detalhe, restaurar e os erros", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { agenteId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const s = await servidor.entrar("marlon");

      // Sem nada gravado: a v1 virtual.
      let lista = (await (await servidor.chamar(s, "GET", `agentes/${agenteId}/perfil/versoes`)).json()) as ListaVersoesPerfil;
      expect(lista).toMatchObject({ total: 1, atual: 1, virtual: true });

      const patch = await servidor.chamar(s, "PATCH", `agentes/${agenteId}`, { descricao: "Missão nova.", voz: "luna", vozVelocidade: 1.25 });
      expect(patch.status).toBe(200);
      expect(((await patch.json()) as { versao: number | null }).versao).toBe(2);
      lista = (await (await servidor.chamar(s, "GET", `agentes/${agenteId}/perfil/versoes`)).json()) as ListaVersoesPerfil;
      expect(lista.versoes.map((v) => [v.versao, v.origem, v.campos])).toEqual([[2, "tela", ["descricao", "voz", "vozVelocidade"]], [1, "inicial", []]]);

      const detalhe = (await (await servidor.chamar(s, "GET", `agentes/${agenteId}/perfil/versoes/1`)).json()) as DetalheVersaoPerfil;
      expect(detalhe).toMatchObject({ numeroAtual: 2, proxima: 3, restauravel: true, propostaPendente: null });
      expect(detalhe.atual.voz).toBe("luna");

      expect((await servidor.chamar(s, "GET", `agentes/${agenteId}/perfil/versoes/9`)).status).toBe(404);
      expect((await servidor.chamar(s, "GET", `agentes/${agenteId}/perfil/versoes/0`)).status).toBe(400);
      expect((await servidor.chamar(s, "GET", `agentes/${agenteId}/perfil/versoes?antes=abc`)).status).toBe(400);
      const igual = await servidor.chamar(s, "POST", `agentes/${agenteId}/perfil/versoes/2/restaurar`);
      expect(igual.status).toBe(409);
      expect(((await igual.json()) as ErroDto).codigo).toBe("estado_invalido");

      // A outra pessoa não lê nem restaura.
      const ana = await servidor.entrar("ana");
      expect([403, 404]).toContain((await servidor.chamar(ana, "GET", `agentes/${agenteId}/perfil/versoes`)).status);
      expect([403, 404]).toContain((await servidor.chamar(ana, "POST", `agentes/${agenteId}/perfil/versoes/1/restaurar`)).status);

      // A guarda: a tela manda a versão que viu; se outra escrita entrou, 409 com motivo perfil_mudou (a tela distingue).
      const mudou = await servidor.chamar(s, "POST", `agentes/${agenteId}/perfil/versoes/1/restaurar`, { esperada: 1 });
      expect(mudou.status).toBe(409);
      expect(await mudou.json()).toMatchObject({ codigo: "estado_invalido", motivo: "perfil_mudou" });

      // Revisão 2 M2: `esperada` presente e inválida não desliga a guarda, é 400.
      for (const esperada of ["2", null, 0, 1.5, -1]) {
        expect((await servidor.chamar(s, "POST", `agentes/${agenteId}/perfil/versoes/1/restaurar`, { esperada })).status, String(esperada)).toBe(400);
      }

      const r = await servidor.chamar(s, "POST", `agentes/${agenteId}/perfil/versoes/1/restaurar`, { esperada: 2 });
      expect(r.status).toBe(200);
      const corpo = (await r.json()) as { versao: { versao: number; restauradaDe: number }; agente: { voz: string | null } };
      expect(corpo.versao).toMatchObject({ versao: 3, restauradaDe: 1 });
      expect(corpo.agente.voz ?? null).toBeNull();
      const repo = depsSobreTrx(trx, MARLON).repos.versoesPerfil;
      expect(await repo.contar(agenteId)).toBe(3);
    });
  });

  it("bot de equipe de outra pessoa: 403 na lista, no detalhe e no restaurar (critério 8)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { agenteId } = await agenteComConversa(trx, MARLON, { nome: "Equipe", dono: "empresa" });
      const s = await servidor.entrar("marlon");
      expect((await servidor.chamar(s, "PATCH", `agentes/${agenteId}`, { descricao: "Missão nova." })).status).toBe(200);
      const ana = await servidor.entrar("ana");
      expect((await servidor.chamar(ana, "GET", `agentes/${agenteId}/perfil/versoes`)).status).toBe(403);
      expect((await servidor.chamar(ana, "GET", `agentes/${agenteId}/perfil/versoes/1`)).status).toBe(403);
      expect((await servidor.chamar(ana, "POST", `agentes/${agenteId}/perfil/versoes/1/restaurar`, { esperada: 2 })).status).toBe(403);
    });
  });
});
