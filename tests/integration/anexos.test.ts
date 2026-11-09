import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { lerAnexo, receberAnexo } from "../../src/use-cases/anexos.ts";
import { enviarMensagem, lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { ANA, depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = new TextEncoder().encode("%PDF-1.4 conteúdo");

/**
 * Anexos no chat (ADR-046) no Postgres de verdade: nasce solto, é preso à mensagem no envio, entra no
 * turno e volta nos metadados da conversa. A RLS separa pessoas; o CHECK da 0021 segura tipo e tamanho.
 */
describeIntegracao("anexos no chat (ADR-046)", () => {
  it("upload → envio: o anexo é preso à mensagem, entra no turno e aparece na conversa só com metadados", async () => {
    await withRollback(MARLON, async (trx) => {
      const { conversaId } = await agenteComConversa(trx, MARLON);
      const deps = depsSobreTrx(trx, MARLON);
      const img = (await executar(deps, receberAnexo, { conversaId, nome: "../pasta/print.png", mime: "image/png", conteudo: PNG })).data;
      expect(img).toMatchObject({ nome: "print.png", mime: "image/png", tamanho: PNG.byteLength });

      const { data } = await executar(deps, enviarMensagem, { conversaId, texto: "", anexos: [img.id] });
      expect(data.mensagem.anexos).toEqual([img]);
      expect(data.turno.entradaAnexos).toEqual([img.id]);

      const conversa = (await executar(deps, lerConversa, { conversaId })).data;
      const minha = conversa.mensagens.find((m) => m.id === data.mensagem.id);
      expect(minha?.anexos).toEqual([img]);
      expect(JSON.stringify(minha)).not.toContain("conteudo");

      const bytes = (await executar(deps, lerAnexo, { conversaId, anexoId: img.id })).data.bytes;
      expect(new Uint8Array(bytes)).toEqual(PNG);
    });
  });

  it("anexo já enviado, de outra conversa ou inexistente derruba o envio inteiro; texto e anexo vazios também", async () => {
    await withRollback(MARLON, async (trx) => {
      const a = await agenteComConversa(trx, MARLON);
      const b = await agenteComConversa(trx, MARLON);
      const deps = depsSobreTrx(trx, MARLON);
      const daOutra = (await executar(deps, receberAnexo, { conversaId: b.conversaId, nome: "x.png", mime: "image/png", conteudo: PNG })).data;
      await expect(executar(deps, enviarMensagem, { conversaId: a.conversaId, texto: "oi", anexos: [daOutra.id] })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      await expect(executar(deps, enviarMensagem, { conversaId: a.conversaId, texto: "", anexos: [] })).rejects.toMatchObject({ codigo: "texto_vazio" });

      const usado = (await executar(deps, receberAnexo, { conversaId: a.conversaId, nome: "y.png", mime: "image/png", conteudo: PNG })).data;
      await executar(deps, enviarMensagem, { conversaId: a.conversaId, texto: "primeira", anexos: [usado.id] });
      await expect(executar(deps, enviarMensagem, { conversaId: a.conversaId, texto: "de novo", anexos: [usado.id] })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    });
  });

  it("tipo fora da lista e arquivo vazio são recusados antes do banco", async () => {
    await withRollback(MARLON, async (trx) => {
      const { conversaId } = await agenteComConversa(trx, MARLON);
      const deps = depsSobreTrx(trx, MARLON);
      await expect(executar(deps, receberAnexo, { conversaId, nome: "a.mov", mime: "video/quicktime", conteudo: PNG })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      await expect(executar(deps, receberAnexo, { conversaId, nome: "a.png", mime: "image/png", conteudo: new Uint8Array() })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    });
  });

  it("agente no Codex não recebe PDF: recusa escrita no envio, não um arquivo que o modelo nunca vê", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      await trx`update agentes set harness = 'codex-cli' where id = ${agenteId}`;
      const deps = depsSobreTrx(trx, MARLON);
      const pdf = (await executar(deps, receberAnexo, { conversaId, nome: "c.pdf", mime: "application/pdf", conteudo: PDF })).data;
      await expect(executar(deps, enviarMensagem, { conversaId, texto: "leia", anexos: [pdf.id] })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      const img = (await executar(deps, receberAnexo, { conversaId, nome: "i.png", mime: "image/png", conteudo: PNG })).data;
      expect((await executar(deps, enviarMensagem, { conversaId, texto: "veja", anexos: [img.id] })).data.turno.entradaAnexos).toEqual([img.id]);
    });
  });

  it("RLS: outra pessoa não lê nem prende o anexo de Marlon", async () => {
    await withRollback(MARLON, async (trx) => {
      const { conversaId } = await agenteComConversa(trx, MARLON);
      const img = (await executar(depsSobreTrx(trx, MARLON), receberAnexo, { conversaId, nome: "p.png", mime: "image/png", conteudo: PNG })).data;
      await vincularEscopo(trx, ANA);
      const daAna = depsSobreTrx(trx, ANA);
      expect(await daAna.repos.anexos.conteudo(img.id)).toBeNull();
      expect(await daAna.repos.anexos.prender([img.id], { conversaId, mensagemId: img.id })).toEqual([]);
    });
  });
});
