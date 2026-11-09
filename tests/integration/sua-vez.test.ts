import { expect, it } from "vitest";
import { criarRotasSuaVez } from "../../src/adapters/http/rotas/sua-vez.ts";
import type { SuaVezDto } from "../../src/contracts/api.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { listarSuaVez, type DepsSuaVez } from "../../src/use-cases/listar-sua-vez.ts";
import { dispensarDecisao } from "../../src/use-cases/dispensar-decisao.ts";
import { PRAZO_REABERTURA_MS, reabrirDecisao } from "../../src/use-cases/reabrir-decisao.ts";
import { emQuanto, foraDoArDesde, haQuanto, nadaEsperando } from "../../web/lib/relogio.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const H = 60 * 60 * 1000;
const DIA = 24 * H;

const deps = (trx: Tx, escopo: Escopo, agora: () => number): DepsSuaVez => ({ repos: criarRepos(trx, escopo), escopo, agora, tx: (fn) => fn(trx) });
const destino = { conector: "exemplo", ferramenta: "enviar_email", argumentos: { para: "bia@acme.com.br" } };

/**
 * "Sua vez" por PESSOA sob RLS de duas pernas (ADR-007, EMENDA 1) com a decisora como sujeito da
 * consulta; vencida visível com desfecho; reabrir volta ao topo com prazo novo; estados negativos
 * ESCRITOS (E3.3). Tudo sob withRollback: cada teste cria as próprias linhas.
 */
describeIntegracao("Sua vez (listar-sua-vez + reabrir-decisao)", () => {
  it("ana não vê a decisão de marlon; a decisora designada vê a dela; vencida fica visível em cinza com desfecho", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const agora = Date.now();
      const deMarlon = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "3 e-mails" });
      await repos.itensAprovacao.criarLote(deMarlon?.id ?? "", [{ idx: 0, texto: "e-mail para bia", destino, origemSensivel: false }]);
      const paraAna = await repos.decisoes.criar({ tipo: "falta_de_dado", decisorId: PESSOA_ANA, agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "falta o CNPJ" });
      const vaiVencer = await repos.decisoes.criar({ tipo: "gate_rotina", agenteId, conversaId, prazoDecisaoEm: agora + 1_000, frase: "rotina das 8h" });
      expect(await repos.decisoes.vencerPendentes(agora + 2_000)).toHaveLength(1);

      const { data: minha } = await listarSuaVez(deps(trx, MARLON, () => agora + 2_000));
      expect(minha.itens.map((i) => [i.decisao.id, i.estadoColuna])).toEqual([
        [deMarlon?.id, "pendente"],
        [vaiVencer?.id, "vencido"],
      ]);
      expect(minha.itens.map((i) => i.decisao.id)).not.toContain(paraAna?.id);
      expect(minha.itens[0]?.itensAprovacao.map((i) => i.textoFinal)).toEqual(["e-mail para bia"]);
      expect(minha.itens[0]?.agenteNome).toBe("Vera");
      expect(minha.itens[1]).toMatchObject({ itensAprovacao: [], decisao: { estado: "vencida", desfecho: { tipo: "expirou_sem_ninguem_ver" } } });
      expect(minha.vazio).toBe(false);

      await vincularEscopo(trx, ANA);
      const { data: daAna } = await listarSuaVez(deps(trx, ANA, () => agora + 2_000));
      expect(daAna.itens.map((i) => i.decisao.id)).toEqual([paraAna?.id]);
      expect(daAna.itens[0]?.agenteNome).toBe("agente");
    });
  });

  it("NOD-114: o item leva a task do turno que pediu; pedido de turno da conversa e sem turno levam null", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const agora = Date.now();
      const w = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Frente", origem: "pessoa" });
      const daTask = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", trabalhoId: w!.id, prazoEm: agora + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      const daConversa = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: agora + 600_000, profundidade: 0, entradaTexto: "y", entradaConfianca: "confiavel", modelo: "m" });
      const naTask = await repos.decisoes.criar({ tipo: "falta_de_dado", agenteId, conversaId, turnoId: daTask!.id, prazoDecisaoEm: agora + DIA, frase: "falta o CNPJ" });
      const naConversa = await repos.decisoes.criar({ tipo: "falta_de_dado", agenteId, conversaId, turnoId: daConversa!.id, prazoDecisaoEm: agora + DIA, frase: "falta o CPF" });
      const semTurno = await repos.decisoes.criar({ tipo: "gate_rotina", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "rotina das 8h" });

      const { data } = await listarSuaVez(deps(trx, MARLON, () => agora));
      const porId = new Map(data.itens.map((i) => [i.decisao.id, i.trabalhoId]));
      expect(porId.get(naTask!.id)).toBe(w!.id);
      expect(porId.get(naConversa!.id)).toBeNull();
      expect(porId.get(semTurno!.id)).toBeNull();
    });
  });

  it("reabrir volta ao topo (reaberto, prazo novo, sem desfecho) e devolve o evento; pendente → estado_invalido; desconhecida → nao_encontrado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const antiga = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: agora + 1_000, frase: "a" });
      const pendente = await repos.decisoes.criar({ tipo: "perfil", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "b" });
      await repos.decisoes.vencerPendentes(agora + 2_000);

      const d = deps(trx, MARLON, () => agora + 3_000);
      const r = await reabrirDecisao(d, { decisaoId: antiga?.id ?? "" });
      expect(r.data.decisao).toMatchObject({ id: antiga?.id, estado: "reaberta", desfecho: null, prazoDecisaoEm: new Date(agora + 3_000 + PRAZO_REABERTURA_MS).toISOString() });
      expect(r.events).toHaveLength(1);
      expect(r.events[0]).toMatchObject({
        kind: "decisao_criada",
        pessoaDestinoId: PESSOA_MARLON,
        conversaId,
        autoria: { autor_tipo: "pessoa", autor_id: PESSOA_MARLON, sob_procuracao_de: null, decidido_por: "pessoa" },
        dados: { decisao_id: antiga?.id, reaberta: true },
      });
      await repos.events.gravarComOutbox(r.events);
      expect((await repos.outbox.pendentes()).map((o) => o.tipo)).toEqual(["decisao_criada"]);

      const { data } = await listarSuaVez(d);
      expect(data.itens.map((i) => [i.decisao.id, i.estadoColuna])).toEqual([
        [antiga?.id, "reaberto"],
        [pendente?.id, "pendente"],
      ]);

      await expect(reabrirDecisao(d, { decisaoId: pendente?.id ?? "" })).rejects.toMatchObject({ codigo: "estado_invalido" });
      await expect(reabrirDecisao(d, { decisaoId: antiga?.id ?? "" })).rejects.toBeInstanceOf(ErroDeDominio);
      await expect(reabrirDecisao(d, { decisaoId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  it("HTTP: a decisora que não é dona reabre e a fase da dona sincroniza a frente para precisa_de_voce", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const frente = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Revisar o contrato", origem: "pessoa", forma: "frente" });
      if (!frente) throw new Error("frente");
      await repos.trabalhos.mudarEstado(frente.id, "falhou", agora);
      const turno = await repos.turnos.enfileirar({
        executor: "catcher",
        conversaId,
        agenteId,
        origem: "conversa",
        prazoEm: agora + DIA,
        profundidade: 0,
        entradaTexto: "revise",
        entradaConfianca: "confiavel",
        modelo: "sonnet",
        trabalhoId: frente.id,
        interrompidoCom: "maquina_sem_contato",
      });
      if (!turno) throw new Error("turno");
      const decisao = await repos.decisoes.criar({
        tipo: "aprovacao",
        decisorId: PESSOA_ANA,
        agenteId,
        conversaId,
        turnoId: turno.id,
        prazoDecisaoEm: agora + 1_000,
        frase: "enviar o contrato",
      });
      if (!decisao) throw new Error("decisão");
      await repos.decisoes.vencerPendentes(agora + 2_000);

      const escopos: Escopo[] = [];
      const srv = await servidorDeTeste(criarRotasSuaVez(async (escopo, fn) => {
        escopos.push(escopo);
        await vincularEscopo(trx, escopo);
        return fn(deps(trx, escopo, () => agora + 3_000));
      }));
      try {
        const ana = await srv.entrar("ana");
        const resposta = await srv.chamar(ana, "POST", `decisoes/${decisao.id}/reabrir`);
        expect(resposta.status).toBe(200);
        expect(await resposta.json()).toEqual({ ok: true, ids: { decisaoId: decisao.id } });
        expect(escopos).toEqual([ANA, MARLON]);
        expect((await repos.decisoes.buscar(decisao.id))?.estado).toBe("reaberta");
        expect((await repos.trabalhos.buscar(frente.id))?.estado).toBe("precisa_de_voce");
      } finally {
        await srv.close();
      }
    });
  });

  it("dispensar tira da fila a vencida (qualquer tipo) e a aberta que se responde com texto; aprovação aberta não sai pelo ×", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const vencida = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: agora + 1_000, frase: "velha" });
      await repos.decisoes.vencerPendentes(agora + 2_000);
      const falta = await repos.decisoes.criar({ tipo: "falta_de_dado", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "falta o Gmail" });
      const aprovacao = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "enviar" });
      const d = deps(trx, MARLON, () => agora + 3_000);

      const r = await dispensarDecisao(d, { decisaoId: vencida?.id ?? "" });
      expect(r.data.decisao).toMatchObject({ estado: "decidida", desfecho: { tipo: "dispensada", por: PESSOA_MARLON, antes: "vencida" } });
      expect(r.events[0]).toMatchObject({ kind: "decisao_decidida", conversaId, dados: { decisao_id: vencida?.id, dispensada: true } });
      expect((await dispensarDecisao(d, { decisaoId: falta?.id ?? "" })).data.decisao.desfecho).toMatchObject({ tipo: "dispensada", antes: "pendente" });
      await expect(dispensarDecisao(d, { decisaoId: aprovacao?.id ?? "" })).rejects.toMatchObject({ codigo: "estado_invalido" });
      await expect(dispensarDecisao(d, { decisaoId: falta?.id ?? "" })).rejects.toMatchObject({ codigo: "estado_invalido" });
      await expect(dispensarDecisao(d, { decisaoId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ codigo: "nao_encontrado" });

      const { data } = await listarSuaVez(d);
      expect(data.itens.map((i) => i.decisao.id)).toEqual([aprovacao?.id]);
    });
  });

  it("dispensar a decisão vencida de um pedido de acesso recusa a proposta de mesmo id: o card não volta com botões mortos", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const proposta = await repos.propostas.criar({ conversaId, agenteId, payload: { kind: "acesso", conector: "exemplo", capacidades: ["listar_contatos"], nivel: "leitura", naoPedido: [] } });
      await repos.decisoes.criar({ id: proposta?.id, tipo: "acesso", agenteId, conversaId, prazoDecisaoEm: agora + 1_000, frase: "ler contatos" });
      await repos.decisoes.vencerPendentes(agora + 2_000);

      await dispensarDecisao(deps(trx, MARLON, () => agora + 3_000), { decisaoId: proposta?.id ?? "" });
      expect((await repos.propostas.buscar(proposta?.id ?? ""))?.estado).toBe("recusada");
    });
  });

  it("a decisora designada dispensa o que é dela; quem não é dona nem decisora não consegue", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const paraAna = await repos.decisoes.criar({ tipo: "pergunta", decisorId: PESSOA_ANA, agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "qual CNPJ?" });
      await vincularEscopo(trx, ANA);
      const r = await dispensarDecisao(deps(trx, ANA, () => agora), { decisaoId: paraAna?.id ?? "" });
      expect(r.data.decisao.desfecho).toMatchObject({ tipo: "dispensada", por: PESSOA_ANA });
    });
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const minha = await repos.decisoes.criar({ tipo: "pergunta", agenteId, conversaId, prazoDecisaoEm: Date.now() + DIA, frase: "só minha" });
      await vincularEscopo(trx, ANA);
      await expect(dispensarDecisao(deps(trx, ANA, () => Date.now()), { decisaoId: minha?.id ?? "" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  it("'aguardando há 6h' e 'recusa automática em 18h' saem de coluna do banco (criado_em, prazo_decisao_em) e o cliente só interpola", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const criadaEm = Date.now();
      const d = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: criadaEm + DIA, frase: "x" });
      // medido em 2026-09-17: criado_em e prazo tinham bases 4 ms diferentes; a fixture usa uma origem comum.
      await trx`update decisoes set criado_em = ${new Date(criadaEm)} where id = ${d?.id ?? ""}`;
      const [linha] = await trx<{ criado_em: Date }[]>`select criado_em from decisoes where id = ${d?.id ?? ""}`;
      const agora = (linha?.criado_em.getTime() ?? criadaEm) + 6 * H;
      const { data } = await listarSuaVez(deps(trx, MARLON, () => agora));
      const item = data.itens[0];
      expect(item?.aguardandoHaMs).toBe(6 * H);
      expect(item?.recusaAutomaticaEmMs).toBe(18 * H);
      expect(haQuanto(item?.aguardandoHaMs ?? 0)).toBe("há 6h");
      expect(emQuanto(item?.recusaAutomaticaEmMs ?? 0)).toBe("em 18h");
    });
  });

  it("listar = ver: carimba vista_em nas abertas (não nas vencidas), idempotente; marcarVista:false não toca", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const aberta = await repos.decisoes.criar({ tipo: "pergunta", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "?" });
      const vencida = await repos.decisoes.criar({ tipo: "pergunta", agenteId, conversaId, prazoDecisaoEm: agora + 1, frase: "!" });
      await repos.decisoes.vencerPendentes(agora + 1_000);

      const semMarcar = await listarSuaVez(deps(trx, MARLON, () => agora + 2_000), { marcarVista: false });
      expect(semMarcar.data.itens.map((i) => i.decisao.vistaEm)).toEqual([null, null]);

      const marcada = await listarSuaVez(deps(trx, MARLON, () => agora + 2_000));
      expect(marcada.data.itens.find((i) => i.decisao.id === aberta?.id)?.decisao.vistaEm).toBe(new Date(agora + 2_000).toISOString());
      expect(marcada.data.itens.find((i) => i.decisao.id === vencida?.id)?.decisao.vistaEm).toBeNull();
      // A segunda listagem preserva o primeiro carimbo (coalesce).
      const deNovo = await listarSuaVez(deps(trx, MARLON, () => agora + 9_000));
      expect(deNovo.data.itens.find((i) => i.decisao.id === aberta?.id)?.decisao.vistaEm).toBe(new Date(agora + 2_000).toISOString());
      // E é o que separa os dois rótulos de expiração: a aberta, agora vista, vence como 'com alguém ciente'.
      const vencidas = await repos.decisoes.vencerPendentes(agora + 2 * DIA);
      expect(vencidas.map((v) => v.desfecho?.tipo)).toEqual(["expirou_com_alguem_ciente"]);
    });
  });

  // definido em 2026-09-24 ("aviso no Mac"): a janela escondida ou fora de foco lê a fila para o Dock e o
  // aviso, mas ninguém viu — `?ver=0` não carimba, senão "ninguém chegou a ver" viraria "alguém viu".
  it("HTTP: GET sua-vez?ver=0 não carimba vista_em (nem na gêmea); sem o parâmetro, listar continua sendo ver", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const srv = await servidorDeTeste(criarRotasSuaVez(async (escopo, fn) => {
        await vincularEscopo(trx, escopo);
        return fn(deps(trx, escopo, () => agora));
      }));
      try {
        const marlon = await srv.entrar("marlon");
        const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
        const pergunta = await repos.decisoes.criar({ tipo: "pergunta", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "qual CNPJ?" });
        const acesso = await repos.decisoes.criar({ tipo: "acesso", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "ler contatos" });
        const gemea = await repos.decisoes.criar({ tipo: "acesso", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "ler contatos" });

        const atras = await srv.chamar(marlon, "GET", "sua-vez?ver=0");
        expect(atras.status).toBe(200);
        const fila = (await atras.json()) as SuaVezDto;
        expect(fila.itens.map((i) => [i.decisao.id, i.gemeas, i.decisao.vistaEm])).toEqual([
          [pergunta?.id, [], null],
          [acesso?.id, [gemea?.id], null],
        ]);
        for (const id of [pergunta?.id, acesso?.id, gemea?.id]) expect((await repos.decisoes.buscar(id ?? ""))?.vistaEm).toBeNull();

        const naFrente = (await (await srv.chamar(marlon, "GET", "sua-vez")).json()) as SuaVezDto;
        expect(naFrente.itens.map((i) => i.decisao.vistaEm)).toEqual([new Date(agora).toISOString(), new Date(agora).toISOString()]);
        expect((await repos.decisoes.buscar(gemea?.id ?? ""))?.vistaEm).not.toBeNull();
      } finally {
        await srv.close();
      }
    });
  });

  it("vazio com carimbo da última decisão e motor 'fora do ar desde' como item escrito (E3.3)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const paraAna = await repos.decisoes.criar({ tipo: "permissao", decisorId: PESSOA_ANA, agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "posso?" });
      const desde = Date.UTC(2026, 8, 16, 14, 3, 0);

      await vincularEscopo(trx, ANA);
      const daAna = criarRepos(trx, ANA);
      expect((await daAna.decisoes.decidir(paraAna?.id ?? "", { por: PESSOA_ANA, agora }))?.estado).toBe("decidida");
      await daAna.inventario.registrar("claude-cli", { estado: "ausente", motivo: "binário não encontrado", em: desde });

      const { data } = await listarSuaVez(deps(trx, ANA, () => agora + 2 * H));
      expect(data).toMatchObject({ itens: [], vazio: true, ultimaDecisaoEm: new Date(agora).toISOString(), foraDoAr: [{ nome: "claude-cli", desde }] });
      expect(nadaEsperando(data.ultimaDecisaoEm, agora + 2 * H)).toBe("Nada esperando por você · última decisão há 2h");
      expect(foraDoArDesde(data.foraDoAr[0]?.nome ?? "", data.foraDoAr[0]?.desde ?? 0)).toBe("claude-cli fora do ar desde 14:03");

      await daAna.inventario.registrar("claude-cli", { estado: "pronto", versao: "2.1.272", em: desde + 60_000 });
      expect((await listarSuaVez(deps(trx, ANA, () => agora))).data.foraDoAr).toEqual([]);
    });
  });
});
