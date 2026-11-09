import { expect, it } from "vitest";
import { criarRepos } from "../../../src/repositories/index.ts";
import { aposSondaFalha, ESTADO_LIMPO } from "../../../src/domain/disjuntor-conector.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const T0 = Date.UTC(2026, 9, 26, 12, 0);

describeIntegracao("conectoresRepo: disjuntor por app (NOD-374)", () => {
  it("nasce limpo; grava e lê o estado travado; comFalhaAberta só lista quem tem falha; limparFalha só escreve se havia algo", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      const c = (await repos.conectores.criar({ nome: "Gmail", slug: "gmail", transporte: "stdio", comando: "node", declaracao: "nao-toca" }))!;
      expect(c).toMatchObject({ falhasSeguidas: 0, timeoutsSeguidos: 0, proximaSondaEm: null, foraDoArDesde: null });
      expect(await repos.conectores.estadoFalhaTravado(c.id)).toEqual(ESTADO_LIMPO);
      expect(await repos.conectores.limparFalha(c.id)).toBe(false);
      expect(await repos.conectores.comFalhaAberta()).toEqual([]);

      const so = { ...ESTADO_LIMPO, timeoutsSeguidos: 2 };
      expect(await repos.conectores.gravarEstadoFalha(c.id, so)).toBe(true);
      expect(await repos.conectores.comFalhaAberta()).toEqual([]);
      expect(await repos.conectores.limparFalha(c.id)).toBeNull();
      expect(await repos.conectores.limparFalha(c.id)).toBe(false);

      const aberto = aposSondaFalha(aposSondaFalha(ESTADO_LIMPO, "conector_indisponivel", T0, 0.5), "conector_indisponivel", T0 + 10 * 60_000, 0.5);
      await repos.conectores.gravarEstadoFalha(c.id, aberto);
      expect(await repos.conectores.estadoFalhaTravado(c.id)).toEqual(aberto);
      // Revisão 3: desabilitado (a 1ª sonda falhou, sem catálogo) fica fora do laço; habilitado entra.
      expect(await repos.conectores.comFalhaAberta()).toEqual([]);
      await repos.conectores.habilitar(c.id, true);
      expect(await repos.conectores.comFalhaAberta()).toEqual([{ id: c.id, slug: "gmail", nome: "Gmail", estado: aberto }]);
      expect(await repos.conectores.buscar(c.id)).toMatchObject({ ultimaFalha: aberto.ultimaFalha, foraDoArDesde: aberto.foraDoArDesde, proximaSondaEm: aberto.proximaSondaEm, falhasSeguidas: 2 });

      expect(await repos.conectores.limparFalha(c.id)).toEqual(aberto.ultimaFalha);
      expect(await repos.conectores.estadoFalhaTravado(c.id)).toEqual(ESTADO_LIMPO);
    });
  });

  it("causa acesso_recusado sobrevive ao jsonb; sonda ok e reconectar zeram o disjuntor; sonda manual falhando já mostra", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      const c = (await repos.conectores.criar({ nome: "Linear", slug: "linear", transporte: "stdio", comando: "node", declaracao: "nao-toca" }))!;
      const recusado = { ...ESTADO_LIMPO, ultimaFalha: { motivo: "falha_tecnica" as const, em: T0, causa: "acesso_recusado" as const }, foraDoArDesde: T0, falhasSeguidas: 3, timeoutsSeguidos: 1 };
      await repos.conectores.gravarEstadoFalha(c.id, recusado);
      expect((await repos.conectores.buscar(c.id))?.ultimaFalha).toEqual(recusado.ultimaFalha);

      await repos.conectores.registrarSonda(c.id, { ok: true, catalogo: [], agora: T0 + 1 });
      expect(await repos.conectores.estadoFalhaTravado(c.id)).toEqual(ESTADO_LIMPO);

      const manual = await repos.conectores.registrarSonda(c.id, { ok: false, motivo: "conector_indisponivel", agora: T0 + 2 });
      expect(manual).toMatchObject({ ultimaFalha: { motivo: "conector_indisponivel", em: T0 + 2 }, foraDoArDesde: T0 + 2 });
      // Revisão L4: a sonda manual que falha de novo mantém o começo da falha ("desde"), e o 401 dela vira acesso recusado.
      const deNovo = await repos.conectores.registrarSonda(c.id, { ok: false, motivo: "conector_indisponivel", agora: T0 + 9 });
      expect(deNovo).toMatchObject({ ultimaFalha: { motivo: "conector_indisponivel", em: T0 + 2 } });
      const recusou = await repos.conectores.registrarSonda(c.id, { ok: false, motivo: "falha_tecnica", causa: "acesso_recusado", agora: T0 + 10 });
      expect(recusou).toMatchObject({ ultimaFalha: { motivo: "falha_tecnica", em: T0 + 2, causa: "acesso_recusado" } });

      await repos.conectores.gravarEstadoFalha(c.id, recusado);
      await repos.conectores.atualizarEndpoint(c.id, "https://exemplo.test/mcp", "v1:x", []);
      expect(await repos.conectores.estadoFalhaTravado(c.id)).toEqual(ESTADO_LIMPO);
      await repos.conectores.gravarEstadoFalha(c.id, recusado);
      await repos.conectores.tornarNativo(c.id, { comando: "nod:github", envCifrado: null, envChaves: [] });
      expect(await repos.conectores.estadoFalhaTravado(c.id)).toEqual(ESTADO_LIMPO);
    });
  });

  it("o CHECK recusa contagem negativa", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      const c = (await repos.conectores.criar({ nome: "X", slug: "x", transporte: "stdio", comando: "node", declaracao: "nao-toca" }))!;
      await expect(repos.conectores.gravarEstadoFalha(c.id, { ...ESTADO_LIMPO, falhasSeguidas: -1 })).rejects.toMatchObject({ code: "23514" });
    });
  });
});
