import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { receberAnexo } from "../../src/use-cases/anexos.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** As falas da pessoa gravadas depois de `antes` (criarAgente já grava a primeira mensagem da conversa). */
async function falasDaPessoa(deps: ReturnType<typeof depsSobreTrx>, conversaId: string, antes: ReadonlySet<string>) {
  return (await deps.repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.autoria.autor_tipo === "pessoa" && !antes.has(m.id));
}

async function idsDe(deps: ReturnType<typeof depsSobreTrx>, conversaId: string): Promise<Set<string>> {
  return new Set((await deps.repos.mensagens.listarDaConversa(conversaId)).map((m) => m.id));
}

/**
 * NOD-156: a mesma fala reenviada (resposta perdida, duplo clique, Enter + botão) vira UMA mensagem e UM turno. A chave
 * `idEnvio` vem do cliente, vale por conversa e não expira. A corrida entre duas transações de verdade mora em
 * tests/concurrency/idempotencia-envio.test.ts: aqui tudo roda na mesma conexão do withRollback.
 */
describeIntegracao("idempotência de envio (NOD-156)", () => {
  it("mesma chave e mesmo texto duas vezes → 1 mensagem, 1 turno; a 2ª devolve os mesmos ids e nenhum evento", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const antes = await idsDe(deps, criado.conversa.id);
      const idEnvio = randomUUID();
      const primeira = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", idEnvio, inventario: PRONTO });
      const segunda = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: " oi ", idEnvio, inventario: PRONTO });

      expect(primeira.events.length).toBeGreaterThan(0);
      expect(segunda.events).toEqual([]);
      expect(segunda.data.mensagem.id).toBe(primeira.data.mensagem.id);
      expect(segunda.data.turno.id).toBe(primeira.data.turno.id);
      expect(segunda.data.negacao).toBeNull();
      const mensagens = await falasDaPessoa(deps, criado.conversa.id, antes);
      expect(mensagens.map((m) => m.id)).toEqual([primeira.data.mensagem.id]);
      const turnos = await deps.repos.turnos.listarDaConversa(criado.conversa.id);
      expect(turnos.map((t) => t.id)).toEqual([primeira.data.turno.id]);
      const outbox = await trx<{ n: number }[]>`select count(*)::int as n from events_outbox where owner_id = ${MARLON.pessoaId} and evento_id in ${trx(primeira.events.map((e) => e.id))}`;
      expect(outbox[0]?.n).toBe(primeira.events.length);
    });
  });

  it("mesma chave com texto diferente → estado_invalido / id_envio_reusado, e nada é criado", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const antes = await idsDe(deps, criado.conversa.id);
      const idEnvio = randomUUID();
      const primeira = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", idEnvio, inventario: PRONTO });

      const erro = await enviarMensagem(deps, { conversaId: criado.conversa.id, texto: "outra coisa", idEnvio, inventario: PRONTO }).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroDeDominio);
      expect(erro).toMatchObject({ codigo: "estado_invalido", cause: "id_envio_reusado" });
      const mensagens = await falasDaPessoa(deps, criado.conversa.id, antes);
      expect(mensagens.map((m) => m.texto)).toEqual(["oi"]);
      expect((await deps.repos.turnos.listarDaConversa(criado.conversa.id)).map((t) => t.id)).toEqual([primeira.data.turno.id]);
    });
  });

  it("sem idEnvio, duas chamadas iguais criam duas mensagens e dois turnos, como antes (cliente antigo)", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const antes = await idsDe(deps, criado.conversa.id);
      const a = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const b = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      expect(b.data.mensagem.id).not.toBe(a.data.mensagem.id);
      expect(b.data.turno.id).not.toBe(a.data.turno.id);
      expect(b.events.length).toBeGreaterThan(0);
      const mensagens = await falasDaPessoa(deps, criado.conversa.id, antes);
      expect(mensagens).toHaveLength(2);
    });
  });

  it("a mesma chave em outra conversa cria normalmente (a chave vale por conversa)", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: um } = await executar(deps, criarAgente, { dono: "pessoa" });
      const { data: dois } = await executar(deps, criarAgente, { dono: "pessoa" });
      const idEnvio = randomUUID();
      const a = await executar(deps, enviarMensagem, { conversaId: um.conversa.id, texto: "oi", idEnvio, inventario: PRONTO });
      const b = await executar(deps, enviarMensagem, { conversaId: dois.conversa.id, texto: "oi", idEnvio, inventario: PRONTO });
      expect(b.data.mensagem.id).not.toBe(a.data.mensagem.id);
      expect(b.data.turno.id).not.toBe(a.data.turno.id);
      expect(b.data.mensagem.conversaId).toBe(dois.conversa.id);
      expect(b.events.length).toBeGreaterThan(0);
    });
  });

  it("o reenvio não encerra de novo as paradas: um Parar entre os dois envios continua valendo", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const idEnvio = randomUUID();
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", idEnvio, inventario: PRONTO });
      const parada = await deps.repos.paradas.ativar({ conversaId: criado.conversa.id, agora: Date.now() });
      expect(parada).not.toBeNull();
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", idEnvio, inventario: PRONTO });
      expect((await deps.repos.paradas.listarAbertas()).map((p) => p.id)).toContain(parada?.id);
    });
  });
  it("envio novo com chave encerra as paradas abertas como antes (o encerrarAbertas só mudou de lugar)", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const parada = await deps.repos.paradas.ativar({ conversaId: criado.conversa.id, agora: Date.now() });
      expect(parada).not.toBeNull();
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "voltei", idEnvio: randomUUID(), inventario: PRONTO });
      expect((await deps.repos.paradas.listarAbertas()).map((p) => p.id)).not.toContain(parada?.id);
    });
  });

  it("anexos no reenvio: os mesmos (até em maiúsculas) devolvem a fala; outros com a mesma chave são id_envio_reusado", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const conversaId = criado.conversa.id;
      const img = (await executar(deps, receberAnexo, { conversaId, nome: "a.png", mime: "image/png", conteudo: PNG })).data;
      const outra = (await executar(deps, receberAnexo, { conversaId, nome: "b.png", mime: "image/png", conteudo: PNG })).data;
      const idEnvio = randomUUID();
      const primeira = await executar(deps, enviarMensagem, { conversaId, texto: "veja", anexos: [img.id], idEnvio, inventario: PRONTO });

      const repetida = await executar(deps, enviarMensagem, { conversaId, texto: "veja", anexos: [img.id.toUpperCase()], idEnvio, inventario: PRONTO });
      expect(repetida.data.mensagem.id).toBe(primeira.data.mensagem.id);
      expect(repetida.data.mensagem.anexos?.map((a) => a.id)).toEqual([img.id]);
      expect(repetida.events).toEqual([]);

      for (const anexos of [[], [outra.id], [img.id, outra.id]]) {
        const erro = await enviarMensagem(deps, { conversaId, texto: "veja", anexos, idEnvio, inventario: PRONTO }).catch((e: unknown) => e);
        expect(erro).toMatchObject({ codigo: "estado_invalido", cause: "id_envio_reusado" });
      }
      // O anexo novo segue solto: pode sair numa fala de verdade.
      const nova = await executar(deps, enviarMensagem, { conversaId, texto: "e esta", anexos: [outra.id], idEnvio: randomUUID(), inventario: PRONTO });
      expect(nova.data.mensagem.anexos?.map((a) => a.id)).toEqual([outra.id]);
    });
  });
});
