import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasAgentes } from "../../src/adapters/http/rotas/agentes.ts";
import { criarRotasConversas } from "../../src/adapters/http/rotas/conversas.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import { criarRotasFrota } from "../../src/adapters/http/rotas/frota.ts";
import { criarRotasPropostas } from "../../src/adapters/http/rotas/propostas.ts";
import { criarRotasTurnos } from "../../src/adapters/http/rotas/turnos.ts";
import type { ConversaDto, FrotaDto, RespostaMutacao } from "../../src/contracts/api.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { FaixaParada } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { atualizarPerfil } from "../../src/use-cases/atualizar-perfil.ts";
import { png } from "../fixtures/midia/construir.ts";
import { idDaProposta } from "../helpers/perfil.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Rotas da L6 sobre o servidor-de-teste (EMENDA 7/34, porta 0). O pool não entra: `abrirTx` da rota é
 * um SAVEPOINT dentro da transação do withRollback do teste em curso (`trxAtual`), re-vinculando o
 * escopo da SESSÃO a cada requisição — o servidor vive o arquivo inteiro e cada `it` roda sob rollback.
 */
describeIntegracao("rotas agentes/conversas/propostas/turnos/frota (L6) com servidor-de-teste", () => {
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
    servidor = await servidorDeTeste([...criarRotasFrota(deps), ...criarRotasAgentes(deps), ...criarRotasConversas(deps), ...criarRotasPropostas(deps), ...criarRotasTurnos(deps)]);
  });
  afterAll(() => servidor.close());

  it("sessão ausente → 401; tenant da URL ≠ sessão → 404; criar bot → 201 'Novo agente' e frota 'sem acessos · nunca executou'", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      expect((await fetch(`${servidor.url}/api/t/${marlon.tenantId}/frota`)).status).toBe(401);
      expect((await servidor.chamar({ ...marlon, tenantId: randomUUID() }, "GET", "frota")).status).toBe(404);

      const criado = await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa" });
      expect(criado.status).toBe(201);
      const { agente, conversa } = (await criado.json()) as { agente: Agente; conversa: Conversa };
      expect(agente.nome).toBe("Novo agente");
      const frota = (await (await servidor.chamar(marlon, "GET", "frota")).json()) as FrotaDto;
      expect(frota.agentes.find((a) => a.id === agente.id)).toMatchObject({ conversaId: conversa.id, descricaoEstado: "sem acessos · nunca executou" });

      const dono = await servidor.chamar(marlon, "PATCH", `agentes/${agente.id}`, { dono: "empresa" });
      expect(dono.status).toBe(403);
      expect(await dono.json()).toEqual({ codigo: "dono_imutavel", mensagem: "O dono do agente não pode ser trocado." });
      const vazio = await servidor.chamar(marlon, "POST", `agentes/${agente.id}/memoria`, { tipo: "fato", texto: "" });
      expect(vazio.status).toBe(400);
      expect(await vazio.json()).toEqual({ codigo: "texto_vazio", mensagem: "Escreva algo antes de enviar." });
      trxAtual = null;
    });
  });

  it("ana → 404 em recurso de marlon (privado); agente de empresa aparece na frota de ana", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const ana = await servidor.entrar("ana");
      const privado = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa" })).json()) as { agente: Agente; conversa: Conversa };
      const empresa = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "empresa", nome: "Tuca" })).json()) as { agente: Agente; conversa: Conversa };

      expect((await servidor.chamar(ana, "GET", `conversas/${privado.conversa.id}/mensagens`)).status).toBe(404);
      expect((await servidor.chamar(ana, "PATCH", `agentes/${privado.agente.id}`, { nome: "x" })).status).toBe(404);
      expect((await servidor.chamar(ana, "POST", `conversas/${privado.conversa.id}/mensagens`, { texto: "oi" })).status).toBe(404);
      expect((await servidor.chamar(ana, "POST", `agentes/${privado.agente.id}/memoria`, { tipo: "fato", texto: "x" })).status).toBe(404);
      const frotaAna = (await (await servidor.chamar(ana, "GET", "frota")).json()) as FrotaDto;
      expect(frotaAna.agentes.map((a) => a.id)).toContain(empresa.agente.id);
      expect(frotaAna.agentes.map((a) => a.id)).not.toContain(privado.agente.id);
      expect((await servidor.chamar(ana, "PATCH", `agentes/${empresa.agente.id}`, { nome: "x" })).status).toBe(403);
      trxAtual = null;
    });
  });

  it("mensagem → 201 com ids; GET mensagens devolve ConversaDto com turnosPendentes; parar devolve a faixa; retomar por turno", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const { agente, conversa } = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa" })).json()) as { agente: Agente; conversa: Conversa };
      await criarRepos(trx, MARLON).inventario.registrar("catcher", { estado: "pronto", versao: "teste", em: Date.now() });

      const enviado = await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/mensagens`, { texto: "oi Vera" });
      expect(enviado.status).toBe(201);
      const ids = ((await enviado.json()) as RespostaMutacao).ids;
      expect(ids).toEqual({ mensagem: expect.any(String), turno: expect.any(String) });
      const segundo = ((await (await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/mensagens`, { texto: "e aí?" })).json()) as RespostaMutacao).ids;
      expect((await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/mensagens`, { texto: " " })).status).toBe(400);

      await criarRepos(trx, MARLON).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      const lida = (await (await servidor.chamar(marlon, "GET", `conversas/${conversa.id}/mensagens`)).json()) as ConversaDto;
      expect(lida.conversa.id).toBe(conversa.id);
      expect(lida.mensagens.map((m) => m.kind)).toEqual(["sistema", "texto", "texto"]);
      expect(lida.turnosPendentes).toEqual([{ id: segundo.turno, motivo: "agente_ocupado_em", conversaId: conversa.id }]);

      const parada = await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/parar`);
      expect(parada.status).toBe(200);
      const faixa = (await parada.json()) as FaixaParada;
      expect(faixa).toMatchObject({ interrompidas: 1, nadaRodando: false });
      expect(faixa.naoInterrompidas).toEqual([{ turnoId: ids.turno, motivo: "sem_processo_neste_servidor_aguarda_renovacao_do_lease" }]);
      const global = (await (await servidor.chamar(marlon, "POST", "parar")).json()) as FaixaParada;
      expect(global.nadaRodando).toBe(false);

      const turno = (await (await servidor.chamar(marlon, "GET", `turnos/${segundo.turno}`)).json()) as { turno: { estado: string; motivoInterrupcao: string } };
      expect(turno.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      const retomado = await servidor.chamar(marlon, "POST", `turnos/${segundo.turno}/retomar`, { texto: "continue" });
      expect(retomado.status).toBe(201);
      expect(((await retomado.json()) as RespostaMutacao).ids.retomaTurno).toBe(segundo.turno);
      expect((await servidor.chamar(marlon, "POST", `turnos/${ids.turno}/retomar`, { texto: "x" })).status).toBe(409);
      expect(agente.id).toBe(conversa.agenteId);
      trxAtual = null;
    });
  });

  it("NOD-156: idEnvio que não é UUID → 400 entrada_invalida; o mesmo idEnvio duas vezes → 201 com os mesmos ids", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const { conversa } = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa" })).json()) as { conversa: Conversa };
      await criarRepos(trx, MARLON).inventario.registrar("catcher", { estado: "pronto", versao: "teste", em: Date.now() });

      for (const idEnvio of ["nao-e-uuid", 42, "", `${randomUUID()}x`]) {
        const r = await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/mensagens`, { texto: "oi", idEnvio });
        expect(r.status).toBe(400);
        expect(((await r.json()) as { codigo: string }).codigo).toBe("entrada_invalida");
      }
      const idEnvio = randomUUID();
      const primeiro = await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/mensagens`, { texto: "oi", idEnvio });
      const segundo = await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/mensagens`, { texto: "oi", idEnvio });
      expect([primeiro.status, segundo.status]).toEqual([201, 201]);
      expect(((await segundo.json()) as RespostaMutacao).ids).toEqual(((await primeiro.json()) as RespostaMutacao).ids);
      const reusado = await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/mensagens`, { texto: "outra", idEnvio });
      expect(reusado.status).toBe(409);
      expect(((await reusado.json()) as { codigo: string }).codigo).toBe("estado_invalido");
      trxAtual = null;
    });
  });

  it("propostas: confirmar aplica e devolve ids; recusar; memória CRUD; fixar/ocultar/duplicar", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const { agente, conversa } = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa" })).json()) as { agente: Agente; conversa: Conversa };
      const deps = depsSobreTrx(trx, MARLON);
      const p1 = (await executar(deps, atualizarPerfil, { turnoId: randomUUID(), agenteId: agente.id, conversaId: conversa.id, nome: "Vera", titulo: "Revisora" })).data;
      const p2 = (await executar(deps, atualizarPerfil, { turnoId: randomUUID(), agenteId: agente.id, conversaId: conversa.id, nome: "Outra" })).data;
      const p3 = (await executar(deps, atualizarPerfil, { turnoId: randomUUID(), agenteId: agente.id, conversaId: conversa.id, nome: "Terceira" })).data;

      const confirmada = await servidor.chamar(marlon, "POST", `propostas/${idDaProposta(p1)}/confirmar`);
      expect(confirmada.status).toBe(200);
      expect(((await confirmada.json()) as RespostaMutacao).ids).toEqual({ proposta: idDaProposta(p1), agente: agente.id });
      // NOD-190: o mesmo card de novo é idempotente; um card montado sobre o perfil anterior responde 409 (perfil_mudou).
      expect((await servidor.chamar(marlon, "POST", `propostas/${idDaProposta(p1)}/confirmar`)).status).toBe(200);
      const obsoleta = await servidor.chamar(marlon, "POST", `propostas/${idDaProposta(p3)}/confirmar`);
      expect(obsoleta.status).toBe(409);
      expect(((await obsoleta.json()) as { codigo: string }).codigo).toBe("estado_invalido");
      expect((await deps.repos.propostas.buscar(idDaProposta(p3)))?.estado).toBe("recusada");
      expect((await servidor.chamar(marlon, "POST", `propostas/${idDaProposta(p2)}/recusar`)).status).toBe(200);
      expect((await servidor.chamar(marlon, "POST", `propostas/${randomUUID()}/recusar`)).status).toBe(404);
      expect(await deps.repos.agentes.buscar(agente.id)).toMatchObject({ nome: "Vera", titulo: "Revisora", confirmado: true });

      const mem = await servidor.chamar(marlon, "POST", `agentes/${agente.id}/memoria`, { tipo: "preferencia", texto: "tópicos", conversaId: conversa.id });
      expect(mem.status).toBe(201);
      const { memoria } = (await mem.json()) as { memoria: { id: string } };
      expect((await servidor.chamar(marlon, "PATCH", `agentes/${agente.id}/memoria/${memoria.id}`, { texto: "tópicos curtos" })).status).toBe(200);
      const lista = (await (await servidor.chamar(marlon, "GET", `agentes/${agente.id}/memoria`)).json()) as { memorias: { texto: string }[] };
      expect(lista.memorias.map((m) => m.texto)).toEqual(["tópicos curtos"]);
      expect((await servidor.chamar(marlon, "DELETE", `agentes/${agente.id}/memoria/${memoria.id}`)).status).toBe(200);
      expect(((await (await servidor.chamar(marlon, "GET", `agentes/${agente.id}/memoria`)).json()) as { memorias: unknown[] }).memorias).toEqual([]);

      // NOD-58: o histórico, o desfazer (e o 409 de quem tenta de novo) e o revisar pela HTTP.
      const hist = await servidor.chamar(marlon, "GET", `agentes/${agente.id}/memoria/diario`);
      expect(hist.status).toBe(200);
      const pagina = (await hist.json()) as { entradas: { id: string; acao: string }[]; aRevisar: number; mais: boolean };
      expect(pagina.entradas.map((e) => e.acao)).toEqual(["apagada", "editada", "criada"]);
      expect(pagina).toMatchObject({ aRevisar: 0, mais: false });
      expect(Object.keys(pagina.entradas[0]!)).not.toContain("memoriaOrigem");
      const desfez = await servidor.chamar(marlon, "POST", `agentes/${agente.id}/memoria/diario/${pagina.entradas[0]!.id}/desfazer`);
      expect(desfez.status).toBe(200);
      expect(((await desfez.json()) as { memoria: { texto: string } }).memoria.texto).toBe("tópicos curtos");
      const deNovo = await servidor.chamar(marlon, "POST", `agentes/${agente.id}/memoria/diario/${pagina.entradas[0]!.id}/desfazer`);
      expect(deNovo.status).toBe(409);
      expect(((await deNovo.json()) as { codigo: string }).codigo).toBe("mudou_depois");
      expect((await servidor.chamar(marlon, "POST", `agentes/${agente.id}/memoria/diario/nao-e-uuid/desfazer`)).status).toBe(404);
      expect((await servidor.chamar(marlon, "GET", `agentes/${agente.id}/memoria/diario?antes=lixo`)).status).toBe(400);
      const revisou = await servidor.chamar(marlon, "POST", `agentes/${agente.id}/memoria/diario/revisar`, {});
      expect(revisou.status).toBe(200);
      expect(await revisou.json()).toMatchObject({ revisadas: 0, aRevisar: 0 });

      expect(((await (await servidor.chamar(marlon, "POST", `agentes/${agente.id}/fixar`)).json()) as { agente: Agente }).agente.fixado).toBe(true);
      expect(((await (await servidor.chamar(marlon, "POST", `agentes/${agente.id}/ocultar`, { oculto: true })).json()) as { agente: Agente }).agente.oculto).toBe(true);
      const dup = await servidor.chamar(marlon, "POST", `agentes/${agente.id}/duplicar`);
      expect(dup.status).toBe(201);
      expect(((await dup.json()) as { agente: Agente }).agente).toMatchObject({ nome: "Vera (cópia)", duplicadoDe: agente.id });
      trxAtual = null;
    });
  });

  it("NOD-58: diário da memória pela rota — Ana vê o bot de equipe de Marlon, mas listar, desfazer e revisar dão 404", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const ana = await servidor.entrar("ana");
      const { agente } = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "empresa" })).json()) as { agente: Agente };
      expect((await servidor.chamar(marlon, "POST", `agentes/${agente.id}/memoria`, { tipo: "fato", texto: "da equipe" })).status).toBe(201);
      const pagina = (await (await servidor.chamar(marlon, "GET", `agentes/${agente.id}/memoria/diario`)).json()) as { entradas: { id: string }[] };
      const entradaId = pagina.entradas[0]!.id;
      expect((await servidor.chamar(ana, "GET", `agentes/${agente.id}/memoria`)).status).toBe(200);
      expect((await servidor.chamar(ana, "GET", `agentes/${agente.id}/memoria/diario`)).status).toBe(404);
      expect((await servidor.chamar(ana, "POST", `agentes/${agente.id}/memoria/diario/${entradaId}/desfazer`)).status).toBe(404);
      expect((await servidor.chamar(ana, "POST", `agentes/${agente.id}/memoria/diario/revisar`, {})).status).toBe(404);
      const depois = (await (await servidor.chamar(marlon, "GET", `agentes/${agente.id}/memoria/diario`)).json()) as { entradas: { desfeitaEm: number | null }[] };
      expect(depois.entradas).toHaveLength(1);
      expect(depois.entradas[0]!.desfeitaEm).toBeNull();
    });
  });

  it("emenda de 2026-10-18 da ADR-059: POST modo-aprovacao exige confirmado: true para o total; manual e automático não pedem", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const { agente } = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa" })).json()) as { agente: Agente };
      const modo = (corpo: Record<string, unknown>) => servidor.chamar(marlon, "POST", `agentes/${agente.id}/modo-aprovacao`, corpo);
      for (const corpo of [{ modo: "total" }, { modo: "total", confirmado: false }, { modo: "total", confirmado: "true" }]) {
        const r = await modo(corpo);
        expect(r.status).toBe(400);
        expect(((await r.json()) as { codigo: string }).codigo).toBe("entrada_invalida");
      }
      // NOD-316: o bot nasce em Automático, e as recusas não o tiram de lá.
      expect(agente.modoAprovacao).toBe("automatico");
      expect((await criarRepos(trx, MARLON).agentes.buscar(agente.id))?.modoAprovacao).toBe("automatico");
      const manual = await modo({ modo: "manual" });
      expect(manual.status).toBe(200);
      expect(((await manual.json()) as { agente: Agente; mudou: boolean })).toMatchObject({ mudou: true, agente: { modoAprovacao: "manual" } });
      const total = await modo({ modo: "total", confirmado: true });
      expect(total.status).toBe(200);
      expect(((await total.json()) as { agente: Agente }).agente.modoAprovacao).toBe("total");
      // NOD-316: duplicar pela rota um bot em total devolve uma cópia em Automático — não herda.
      const copia = (await (await servidor.chamar(marlon, "POST", `agentes/${agente.id}/duplicar`)).json()) as { agente: Agente };
      expect(copia.agente.modoAprovacao).toBe("automatico");
      expect((await modo({ modo: "automatico" })).status).toBe(200);
      trxAtual = null;
    });
  });

  it("NOD-323 (QA 2 e revisão 4 do #507): GET do anexo pela rota — faixa 206, fora do arquivo 416, sem Range o inteiro", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const { conversa } = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa" })).json()) as { agente: Agente; conversa: Conversa };
      const arquivo = png(40, 30);
      const base = `${servidor.url}/api/t/${marlon.tenantId}/conversas/${conversa.id}/anexos`;
      const subido = await fetch(base, { method: "POST", headers: { cookie: marlon.cookie, "content-type": "image/png", "x-nod-nome": "a.png" }, body: arquivo });
      expect(subido.status).toBe(201);
      const { id } = (await subido.json()) as { id: string };
      const faixa = await fetch(`${base}/${id}`, { headers: { cookie: marlon.cookie, range: "bytes=0-9" } });
      expect(faixa.status).toBe(206);
      expect(faixa.headers.get("content-range")).toBe(`bytes 0-9/${arquivo.byteLength}`);
      expect(new Uint8Array(await faixa.arrayBuffer())).toEqual(arquivo.subarray(0, 10));
      const fora = await fetch(`${base}/${id}`, { headers: { cookie: marlon.cookie, range: `bytes=${arquivo.byteLength}-` } });
      expect(fora.status).toBe(416);
      await fora.arrayBuffer();
      // A vaga da faixa volta depois do 416: 7 seguidos (mais que as 6 por pessoa) e a faixa ainda sai.
      for (let i = 0; i < 7; i++) expect((await fetch(`${base}/${id}`, { headers: { cookie: marlon.cookie, range: `bytes=${arquivo.byteLength}-` } })).status).toBe(416);
      expect((await fetch(`${base}/${id}`, { headers: { cookie: marlon.cookie, range: "bytes=0-0" } })).status).toBe(206);
      // Várias faixas: o arquivo inteiro (200).
      const varias = await fetch(`${base}/${id}`, { headers: { cookie: marlon.cookie, range: "bytes=0-1,5-6" } });
      expect(varias.status).toBe(200);
      expect((await varias.arrayBuffer()).byteLength).toBe(arquivo.byteLength);
      const inteiro = await fetch(`${base}/${id}`, { headers: { cookie: marlon.cookie } });
      expect(inteiro.status).toBe(200);
      expect((await inteiro.arrayBuffer()).byteLength).toBe(arquivo.byteLength);
      trxAtual = null;
    });
  });

  it("NOD-326: GET da Biblioteca pela rota — 200 vazia na conversa nova, 404 para Ana e para id que não é uuid, 400 para cursor e limite inválidos", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const ana = await servidor.entrar("ana");
      const { conversa } = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa" })).json()) as { agente: Agente; conversa: Conversa };
      // Upload da pessoa não entra na Biblioteca.
      const subido = await fetch(`${servidor.url}/api/t/${marlon.tenantId}/conversas/${conversa.id}/anexos`, { method: "POST", headers: { cookie: marlon.cookie, "content-type": "image/png", "x-nod-nome": "a.png" }, body: png(4, 4) });
      expect(subido.status).toBe(201);
      const ok = await servidor.chamar(marlon, "GET", `conversas/${conversa.id}/biblioteca`);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ itens: [], proximo: null });
      expect((await servidor.chamar(ana, "GET", `conversas/${conversa.id}/biblioteca`)).status).toBe(404);
      expect((await servidor.chamar(marlon, "GET", `conversas/${randomUUID()}/biblioteca`)).status).toBe(404);
      expect((await servidor.chamar(marlon, "GET", "conversas/nao-e-uuid/biblioteca")).status).toBe(404);
      expect((await servidor.chamar(marlon, "GET", `conversas/${conversa.id}/biblioteca?antes=lixo`)).status).toBe(400);
      expect((await servidor.chamar(marlon, "GET", `conversas/${conversa.id}/biblioteca?limite=201`)).status).toBe(400);
      expect((await servidor.chamar(marlon, "GET", `conversas/${conversa.id}/biblioteca?limite=200&antes=${encodeURIComponent(`2026-10-24T03:32:00.123456Z_${randomUUID()}`)}`)).status).toBe(200);
      trxAtual = null;
    });
  });
});
