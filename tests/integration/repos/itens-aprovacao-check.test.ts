import { expect, it } from "vitest";
import { ITENS_APROVACAO } from "../../../src/db/schema/itens-aprovacao.ts";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { agenteComConversa } from "../../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const destino = (i: number) => ({ conector: "exemplo", ferramenta: "enviar_email", argumentos: { para: `p${i}@acme.com.br` } });

describeIntegracao("itensAprovacaoRepo: item sensível marcado exige pessoa (E4.2, CHECK no banco)", () => {
  it("origem sensível nasce desmarcada com justificativa; marcar sem pessoa é recusado pelo CHECK; marcar pelo repo grava quem e quando", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const d = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: Date.now() + 60_000, frase: "3 e-mails" });
      const itens = await repos.itensAprovacao.criarLote(d?.id ?? "", [
        { idx: 0, texto: "e-mail para ana", destino: destino(0), origemSensivel: false },
        { idx: 1, texto: "e-mail para bia", destino: destino(1), origemSensivel: true, justificativa: "dado veio de conector que toca dado pessoal" },
        { idx: 2, texto: "e-mail para caio", destino: destino(2), origemSensivel: false },
      ]);
      expect(itens.map((i) => [i.idx, i.selecionado, i.justificativa])).toEqual([
        [0, true, null],
        [1, false, "dado veio de conector que toca dado pessoal"],
        [2, true, null],
      ]);
      const sensivel = itens[1];

      const erro = await expectRejected(trx, () => trx`update itens_aprovacao set selecionado = true where id = ${sensivel?.id ?? ""}`, "23514");
      expect(erro.message).toContain(ITENS_APROVACAO.check.nome);
      expect((await repos.itensAprovacao.buscar(sensivel?.id ?? ""))?.selecionado).toBe(false);

      const marcado = await repos.itensAprovacao.marcar(sensivel?.id ?? "", { selecionado: true, textoFinal: "e-mail para bia (editado)", agora: Date.now() });
      expect(marcado).toMatchObject({ selecionado: true, marcadoPor: PESSOA_MARLON, editadoPor: PESSOA_MARLON, textoFinal: "e-mail para bia (editado)", textoOriginal: "e-mail para bia" });
      expect(marcado?.marcadoEm).not.toBeNull();

      // idx é único por decisão.
      await expectRejected(trx, () => repos.itensAprovacao.criarLote(d?.id ?? "", [{ idx: 0, texto: "dup", destino: destino(9), origemSensivel: false }]), "23505");

      expect((await repos.itensAprovacao.registrarDesfecho(itens[0]?.id ?? "", "executado"))?.desfecho).toBe("executado");
      expect((await repos.itensAprovacao.listar(d?.id ?? "")).map((i) => i.desfecho)).toEqual(["executado", null, null]);
    });
  });
});
