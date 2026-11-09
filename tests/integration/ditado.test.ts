import { expect, it } from "vitest";
import { VERSAO_CONSENTIMENTO_VOZ } from "../../src/contracts/ligacao.ts";
import { autorizarDitado, disponibilidadeDitado, type ContextoDitado } from "../../src/use-cases/ditado.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Ditado no campo (ADR-095): a disponibilidade do 🎤 e a autorização do `ola` do canal leem o consentimento da voz sob
 * RLS. Sem o aviso da voz aceito na versão atual (2, a que fala do ditado), o áudio nunca abre.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const LIGADO: ContextoDitado = { habilitado: true, permitido: true, vozDisponivel: true };

describeIntegracao("ditado: disponibilidade e autorização (ADR-095)", () => {
  it("sem o aviso aceito: disponível pedindo o aviso, e o canal recusa com sem_consentimento", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps } = depsSobre(trx, MARLON);
      expect((await disponibilidadeDitado(deps, { contexto: LIGADO })).data).toEqual({ disponivel: true, consentimentoNecessario: true, versaoConsentimento: VERSAO_CONSENTIMENTO_VOZ });
      expect((await autorizarDitado(deps, { contexto: LIGADO })).data).toEqual({ ok: false, codigo: "sem_consentimento" });
    });
  });

  it("o aviso da ligação antigo (v1) não vale para o ditado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = await agenteComConversa(trx, MARLON, { nome: "Nina" });
      await repos.ligacoes.consentir(1, Date.now());
      const { deps } = depsSobre(trx, MARLON);
      expect((await disponibilidadeDitado(deps, { contexto: LIGADO })).data).toMatchObject({ disponivel: true, consentimentoNecessario: true });
      expect((await autorizarDitado(deps, { contexto: LIGADO })).data).toEqual({ ok: false, codigo: "sem_consentimento" });
    });
  });

  it("com o aviso aceito: abre, e o vocabulário traz os nomes dos bots", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = await agenteComConversa(trx, MARLON, { nome: "Kassandra" });
      await repos.ligacoes.consentir(VERSAO_CONSENTIMENTO_VOZ, Date.now());
      const { deps } = depsSobre(trx, MARLON);
      expect((await disponibilidadeDitado(deps, { contexto: LIGADO })).data).toEqual({ disponivel: true, consentimentoNecessario: false, versaoConsentimento: VERSAO_CONSENTIMENTO_VOZ });
      const r = (await autorizarDitado(deps, { contexto: LIGADO })).data;
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.vocabulario).toContain("Kassandra");
    });
  });

  it("desligado, sem permissão ou com a voz fora: o 🎤 some e o canal recusa", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = await agenteComConversa(trx, MARLON, { nome: "Nina" });
      await repos.ligacoes.consentir(VERSAO_CONSENTIMENTO_VOZ, Date.now());
      const { deps } = depsSobre(trx, MARLON);
      const casos: [ContextoDitado, string, string][] = [
        [{ ...LIGADO, habilitado: false }, "desligado", "sem_permissao"],
        [{ ...LIGADO, permitido: false }, "sem_permissao", "sem_permissao"],
        [{ ...LIGADO, vozDisponivel: false }, "voz_fora", "voz_fora"],
      ];
      for (const [contexto, motivo, codigo] of casos) {
        expect((await disponibilidadeDitado(deps, { contexto })).data).toEqual({ disponivel: false, motivo });
        expect((await autorizarDitado(deps, { contexto })).data).toEqual({ ok: false, codigo });
      }
    });
  });
});
