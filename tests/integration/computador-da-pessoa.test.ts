import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** NOD-96 (0106, ADR-122): o computador da pessoa no motor — um por pessoa, uma tela por bot, logins em comum. */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

describeIntegracao("computador da pessoa no motor (0106)", () => {
  it("um computador por pessoa; vários bots no mesmo; o legado por bot segue um por bot e é arquivado", async () => {
    await withRollback(MARLON, async (trx) => {
      const a = await agenteComConversa(trx, MARLON);
      const b = await agenteComConversa(trx, MARLON);
      // O modo docker de hoje continua: um computador 'por_bot' para cada bot, mesmo com o motor na mesma pessoa.
      const legadoA = (await a.repos.computadores.obter(a.agenteId))!;
      const legadoB = (await a.repos.computadores.obter(b.agenteId))!;
      expect(legadoA.id).not.toBe(legadoB.id);

      expect(await a.repos.computadores.daPessoa()).toBeNull();
      const c = await a.repos.computadores.obterDaPessoa();
      expect(c).toMatchObject({ ownerId: PESSOA_MARLON, maquinaId: null, hospedeiraId: null, supervisorPub: null, operacao: null, falhasSeguidas: 0 });
      expect((await a.repos.computadores.obterDaPessoa()).id).toBe(c.id);
      expect((await a.repos.computadores.daPessoa())!.id).toBe(c.id);

      expect((await a.repos.computadores.arquivarLegado(5000)).sort()).toEqual([legadoA.id, legadoB.id].sort());
      expect(await a.repos.computadores.vincularBot(c.id, a.agenteId)).toBe(true);
      expect(await a.repos.computadores.vincularBot(c.id, b.agenteId)).toBe(true);
      expect(await a.repos.computadores.vincularBot(c.id, randomUUID())).toBe(false);
      const vinculos = await trx<{ computador_id: string }[]>`select computador_id from agentes where id in (${a.agenteId}, ${b.agenteId})`;
      expect(vinculos.map((v) => v.computador_id)).toEqual([c.id, c.id]);
      // O legado não entra no computador da pessoa nem o contrário.
      expect(await a.repos.computadores.travarDaPessoa(legadoA.id)).toBeNull();
      await expect(trx`insert into computadores (tenant_id, owner_id, modelo) values (${MARLON.tenantId}, ${MARLON.pessoaId}, 'por_pessoa')`).rejects.toThrow(/computadores_um_por_pessoa/);
    });
  });

  it("NOD-96: o docker por bot não trava o computador da pessoa; o modo motor segue achando o vínculo do bot", async () => {
    await withRollback(MARLON, async (trx) => {
      const a = await agenteComConversa(trx, MARLON);
      const c = await a.repos.computadores.obterDaPessoa();
      expect(await a.repos.computadores.vincularBot(c.id, a.agenteId)).toBe(true);
      // `travar` é só do 'por_bot': sem o filtro, o modo docker ligaria ou desligaria a máquina da pessoa. O painel do docker o vê sem computador.
      expect(await a.repos.computadores.travar(c.id)).toBeNull();
      expect(await a.repos.computadores.buscarDoAgente(a.agenteId)).toBeNull();
      // Sem `docker`, `obter` e `buscarVinculo` seguem achando o da pessoa (pedir_aprovacao e o plano do modo motor) e não criam nada.
      expect((await a.repos.computadores.obter(a.agenteId))!.id).toBe(c.id);
      expect((await a.repos.computadores.buscarVinculo(a.agenteId))!.id).toBe(c.id);
      // No docker (`soPorBot`), o vínculo e a saúde da máquina da pessoa não contam para o bot.
      expect(await a.repos.computadores.buscarVinculo(a.agenteId, "por_bot")).toBeNull();
      await a.repos.computadores.registrarFalha(c.id, { motivo: "sem_resposta", em: 1000, limite: 1 });
      expect((await a.repos.computadores.foraDoAr()).has(a.agenteId)).toBe(true);
      expect((await a.repos.computadores.foraDoAr("por_bot")).has(a.agenteId)).toBe(false);
      const vinculo = async () => (await trx<{ computador_id: string }[]>`select computador_id from agentes where id = ${a.agenteId}`)[0]!.computador_id;
      expect(await vinculo()).toBe(c.id);
      // De volta ao docker: o portão pede `obter(…, true)` e o bot ganha um 'por_bot' próprio, que trava; o da pessoa fica intacto.
      const proprio = (await a.repos.computadores.obter(a.agenteId, true))!;
      expect(proprio.id).not.toBe(c.id);
      expect(await vinculo()).toBe(proprio.id);
      expect((await a.repos.computadores.travar(proprio.id))!.agenteId).toBe(a.agenteId);
      expect((await a.repos.computadores.obter(a.agenteId, true))!.id).toBe(proprio.id);
      // E o motor o leva de volta ao da pessoa na 1ª ação.
      expect(await a.repos.computadores.vincularBot(c.id, a.agenteId)).toBe(true);
      expect(await vinculo()).toBe(c.id);
      // O 'por_bot' de outro bot segue travando e aparecendo no painel.
      const b = await agenteComConversa(trx, MARLON);
      const legado = (await a.repos.computadores.obter(b.agenteId))!;
      expect((await a.repos.computadores.travar(legado.id))!.agenteId).toBe(b.agenteId);
      expect((await a.repos.computadores.buscarDoAgente(b.agenteId))!.id).toBe(legado.id);
    });
  });

  it("NOD-96: a falha do computador da pessoa conta mesmo sem bot vinculado e com vários bots", async () => {
    await withRollback(MARLON, async (trx) => {
      const a = await agenteComConversa(trx, MARLON);
      const b = await agenteComConversa(trx, MARLON);
      const c = await a.repos.computadores.obterDaPessoa();
      // Acordar antes do 1º bot: sem vínculo, a transição para fora do ar ainda é devolvida.
      const r = await a.repos.computadores.registrarFalha(c.id, { motivo: "sem_resposta", em: 1000, limite: 1 });
      expect(r).toMatchObject({ virouIndisponivel: true, computador: { falhasSeguidas: 1, agenteId: "" } });
      expect(await a.repos.computadores.registrarSucesso(c.id)).toBe(true);
      expect(await a.repos.computadores.vincularBot(c.id, a.agenteId)).toBe(true);
      expect(await a.repos.computadores.vincularBot(c.id, b.agenteId)).toBe(true);
      const r2 = (await a.repos.computadores.registrarFalha(c.id, { motivo: "sem_resposta", em: 2000, limite: 3 }))!;
      expect(r2.computador.falhasSeguidas).toBe(1);
      expect([a.agenteId, b.agenteId]).toContain(r2.computador.agenteId);
    });
  });

  it("o supervisor é TOFU; Redefinir esquece a chave; uma operação de cada vez, com progresso entre 0 e 100", async () => {
    await withRollback(MARLON, async (trx) => {
      const a = await agenteComConversa(trx, MARLON);
      const c = await a.repos.computadores.obterDaPessoa();
      const chave = new Uint8Array(32).fill(1);
      expect(await a.repos.computadores.fixarSupervisor(c.id, chave)).toBe("gravada");
      expect(await a.repos.computadores.fixarSupervisor(c.id, chave)).toBe("igual");
      expect(await a.repos.computadores.fixarSupervisor(c.id, new Uint8Array(32).fill(2))).toBe("diferente");
      expect((await a.repos.computadores.daPessoa())!.supervisorPub).toBe(Buffer.from(chave).toString("base64"));
      await expect(a.repos.computadores.fixarSupervisor(c.id, new Uint8Array(31))).resolves.toBe("diferente");

      expect(await a.repos.computadores.iniciarOperacao(c.id, "redefinir", 1000)).toBe(true);
      expect(await a.repos.computadores.iniciarOperacao(c.id, "atualizar", 1100)).toBe(false);
      expect(await a.repos.computadores.progredirOperacao(c.id, "atualizar", { pct: 50, etapa: "x" })).toBe(false);
      expect(await a.repos.computadores.progredirOperacao(c.id, "redefinir", { pct: 140, etapa: "apagando o perfil" })).toBe(true);
      expect((await a.repos.computadores.daPessoa())!.operacao).toEqual({ tipo: "redefinir", progresso: 100, etapa: "apagando o perfil", desde: 1000 });
      await a.repos.computadores.esquecerSupervisor(c.id);
      expect(await a.repos.computadores.terminarOperacao(c.id, "redefinir")).toBe(true);
      expect(await a.repos.computadores.daPessoa()).toMatchObject({ operacao: null, supervisorPub: null });
      expect(await a.repos.computadores.fixarSupervisor(c.id, new Uint8Array(32).fill(2))).toBe("gravada");
    });
  });

  it("a máquina é uma chave da pessoa (contrato da NOD-94); nula = onde o nod roda", async () => {
    await withRollback(MARLON, async (trx) => {
      const a = await agenteComConversa(trx, MARLON);
      const chave = (await a.repos.maquinaTokens.criar({ nome: "Linux da sala", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!;
      const c = await a.repos.computadores.obterDaPessoa(chave.id);
      expect(c.maquinaId).toBe(chave.id);
      await a.repos.computadores.fixarMaquina(c.id, { maquinaId: null, hospedeiraId: chave.id });
      expect(await a.repos.computadores.daPessoa()).toMatchObject({ maquinaId: null, hospedeiraId: chave.id });
      await expect(a.repos.computadores.fixarMaquina(c.id, { maquinaId: randomUUID() })).rejects.toThrow(/computadores_maquina_id_fkey/);
    });
  });

  it("uma tela por bot; a fila da régua sai pela ordem de chegada; ações por bot e a tela some com o bot", async () => {
    await withRollback(MARLON, async (trx) => {
      const a = await agenteComConversa(trx, MARLON);
      const b = await agenteComConversa(trx, MARLON);
      const c = await a.repos.computadores.obterDaPessoa();
      const ta = (await a.repos.computadorTelas.obter(c.id, a.agenteId))!;
      const tb = (await a.repos.computadorTelas.obter(c.id, b.agenteId))!;
      expect(ta).toMatchObject({ estado: "fechada", controle: "bot", politica: "supervisionado", esperandoDesde: null, memoriaMb: null });
      expect((await a.repos.computadorTelas.obter(c.id, a.agenteId))!.id).toBe(ta.id);
      expect(await a.repos.computadorTelas.obter(c.id, randomUUID())).toBeNull();

      expect(await a.repos.computadorTelas.mudarEstado(tb.id, "esperando", 2000)).toBe(true);
      expect(await a.repos.computadorTelas.mudarEstado(ta.id, "esperando", 3000)).toBe(true);
      expect(await a.repos.computadorTelas.mudarEstado(tb.id, "esperando", 9000)).toBe(true);
      expect((await a.repos.computadorTelas.fila(c.id)).map((t) => [t.agenteId, t.esperandoDesde])).toEqual([[b.agenteId, 2000], [a.agenteId, 3000]]);
      expect(await a.repos.computadorTelas.mudarEstado(tb.id, "aberta", 4000, ["fechada"])).toBe(false);
      expect(await a.repos.computadorTelas.mudarEstado(tb.id, "abrindo", 4000, ["esperando"])).toBe(true);
      expect((await a.repos.computadorTelas.fila(c.id)).map((t) => t.agenteId)).toEqual([a.agenteId]);
      expect((await a.repos.computadorTelas.travar(tb.id))!.esperandoDesde).toBeNull();

      await a.repos.computadorTelas.registrarFalha(tb.id, "nao_ficou_pronto");
      expect((await a.repos.computadorTelas.travar(tb.id))!.falhaMotivo).toBe("nao_ficou_pronto");
      expect(await a.repos.computadorTelas.mudarEstado(tb.id, "aberta", 5000)).toBe(true);
      await a.repos.computadorTelas.relatar(tb.id, { memoriaMb: 512.4, ultimaAcaoEm: null });
      await a.repos.computadorTelas.configurar(tb.id, { controle: "pessoa", ajuda: "entre no Gmail", atividadeEm: 6000 });
      const lease = randomUUID();
      await a.repos.computadorTelas.ocupar(tb.id, lease, 7000);
      await a.repos.computadorTelas.liberar(tb.id, randomUUID());
      expect(await a.repos.computadorTelas.travar(tb.id)).toMatchObject({ estado: "aberta", falhaMotivo: null, memoriaMb: 512, controle: "pessoa", ajuda: "entre no Gmail", operacaoId: lease, ocupadoAte: 7000 });
      await a.repos.computadorTelas.liberar(tb.id, lease);
      expect((await a.repos.computadorTelas.travar(tb.id))!.operacaoId).toBeNull();

      await a.repos.computadores.registrar({ computadorId: c.id, autor: "bot", tipo: "navegar", estado: "concluida", agenteId: b.agenteId, telaId: tb.id });
      await a.repos.computadores.registrar({ computadorId: c.id, autor: "pessoa", tipo: "clicar", estado: "concluida", telaId: tb.id });
      await a.repos.computadores.registrar({ computadorId: c.id, autor: "bot", tipo: "navegar", estado: "concluida", agenteId: a.agenteId, telaId: ta.id });
      expect((await a.repos.computadores.atividadeDoBot(c.id, b.agenteId)).map((r) => r.tipo)).toEqual(["navegar"]);
      expect(await a.repos.computadores.atividade(c.id)).toHaveLength(3);
      // PR 4: a Atividade da tela traz as ações do bot e as da pessoa nela; "em uso por" olha só a tela pedida.
      expect((await a.repos.computadores.atividadeDaTela(c.id, tb.id)).map((r) => r.tipo).sort()).toEqual(["clicar", "navegar"]);
      expect((await a.repos.computadorTelas.porId(tb.id))!.agenteId).toBe(b.agenteId);
      // Revisão do PR #599: o último "assumir" é da tela pedida, sem o teto de 30 linhas da Atividade.
      expect(await a.repos.computadores.ultimoFreio(c.id, tb.id)).toBeNull();
      await a.repos.computadores.registrar({ computadorId: c.id, autor: "pessoa", tipo: "assumir", estado: "concluida", telaId: tb.id });
      for (let i = 0; i < 31; i++) await a.repos.computadores.registrar({ computadorId: c.id, autor: "pessoa", tipo: "clicar", estado: "concluida", telaId: tb.id });
      expect(await a.repos.computadores.ultimoFreio(c.id, tb.id)).toEqual({ tipo: "assumir", em: expect.any(Number) });
      expect(await a.repos.computadores.ultimoFreio(c.id, ta.id)).toBeNull();
      expect(await a.repos.computadores.ultimoFreio(c.id, null)).toBeNull();
      // 4ª revisão: o Parar também é freio (a mensagem de antes não retoma, o ao vivo não reabre a tela).
      await a.repos.computadores.registrar({ computadorId: c.id, autor: "pessoa", tipo: "parar", estado: "concluida", telaId: ta.id });
      expect(await a.repos.computadores.ultimoFreio(c.id, ta.id)).toEqual({ tipo: "parar", em: expect.any(Number) });
      await a.repos.computadores.registrar({ computadorId: c.id, autor: "pessoa", tipo: "digitar", estado: "executando", telaId: ta.id });
      expect(await a.repos.computadores.emUsoPor(c.id, ta.id)).toEqual({ titulo: "a pessoa", deFora: false });
      expect(await a.repos.computadores.emUsoPor(c.id, tb.id)).toBeNull();

      // A tela vai junto com o bot (ON DELETE CASCADE); a ação fica, sem bot e sem tela (SET NULL só da coluna).
      const fks = await trx<{ def: string }[]>`select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid in ('computador_telas'::regclass, 'computador_acoes'::regclass) and contype = 'f' and pg_get_constraintdef(oid) like '%agentes%'`;
      expect(fks.map((f) => f.def).sort()).toEqual([
        "FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes(tenant_id, id) ON DELETE CASCADE",
        "FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes(tenant_id, id) ON DELETE SET NULL (agente_id)",
      ]);
    });
  });

  it("PR 5: Redefinir troca a chave só com a operação viva; aviso de recriado uma vez; atividade do painel; tela apagada", async () => {
    await withRollback(MARLON, async (trx) => {
      const a = await agenteComConversa(trx, MARLON);
      await a.repos.computadores.obter(a.agenteId);
      await a.repos.computadores.arquivarLegado(5000);
      expect((await a.repos.computadores.legadosArquivados()).map((l) => l.arquivadoEm)).toEqual([5000]);
      const c = await a.repos.computadores.obterDaPessoa();
      await a.repos.computadores.fixarSupervisor(c.id, new Uint8Array(32).fill(1));
      const nova = new Uint8Array(32).fill(9);
      expect(await a.repos.computadores.trocarSupervisor(c.id, nova)).toBe(false);
      expect(await a.repos.computadores.iniciarOperacao(c.id, "redefinir", 1000)).toBe(true);
      expect(await a.repos.computadores.trocarSupervisor(c.id, nova)).toBe(true);
      expect((await a.repos.computadores.daPessoa())!.supervisorPub).toBe(Buffer.from(nova).toString("base64"));

      // O aviso "Entre nos sites de novo uma vez": a pessoa tinha computador por bot arquivado e ainda não o dispensou.
      expect(await a.repos.computadores.avisoRecriado(c.id)).toBe(true);
      await a.repos.computadores.registrar({ computadorId: c.id, autor: "pessoa", tipo: "aviso_recriado", estado: "concluida" });
      expect(await a.repos.computadores.avisoRecriado(c.id)).toBe(false);

      await a.repos.computadores.vincularBot(c.id, a.agenteId);
      const t = (await a.repos.computadorTelas.obter(c.id, a.agenteId))!;
      await a.repos.computadores.registrar({ computadorId: c.id, autor: "bot", tipo: "navegar", estado: "concluida", agenteId: a.agenteId, telaId: t.id });
      await a.repos.computadores.registrar({ computadorId: c.id, autor: "bot", tipo: "observar", estado: "concluida", agenteId: a.agenteId, telaId: t.id });
      await a.repos.computadores.registrar({ computadorId: c.id, autor: "pessoa", tipo: "atualizar", estado: "falhou" });
      const atividade = await a.repos.computadores.atividadeDaPessoa(c.id);
      expect(atividade.map((x) => [x.tipo, x.agenteId]).sort()).toEqual([["atualizar", null], ["navegar", a.agenteId]]);

      // Bot excluído: a tela sai do banco; a ação fica, sem tela.
      await a.repos.computadorTelas.apagar(t.id);
      expect(await a.repos.computadorTelas.porId(t.id)).toBeNull();
      expect((await a.repos.computadores.atividadeDaPessoa(c.id)).map((x) => x.tipo).sort()).toEqual(["atualizar", "navegar"]);
    });
  });

  it("NOD-365: o lugar só muda com a troca em curso; a segunda troca não começa; trocar sem os logins mostra o aviso até ser dispensado", async () => {
    await withRollback(MARLON, async (trx) => {
      const a = await agenteComConversa(trx, MARLON);
      const origem = (await a.repos.maquinaTokens.criar({ nome: "Linux A", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!;
      const destino = (await a.repos.maquinaTokens.criar({ nome: "Linux B", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!;
      const c = await a.repos.computadores.obterDaPessoa(origem.id);
      await a.repos.computadores.fixarSupervisor(c.id, new Uint8Array(32).fill(1));
      const paraB = { maquinaId: destino.id, hospedeiraId: destino.id, supervisorPub: null, saidasPendentesDe: [] };
      // Sem a operação 'trocar', nada muda (nem com outra operação em curso).
      expect(await a.repos.computadores.fixarLugar(c.id, paraB)).toBe(false);
      expect(await a.repos.computadores.iniciarOperacao(c.id, "atualizar", 1000)).toBe(true);
      expect(await a.repos.computadores.fixarLugar(c.id, paraB)).toBe(false);
      expect(await a.repos.computadores.terminarOperacao(c.id, "atualizar")).toBe(true);
      expect((await a.repos.computadores.daPessoa())!.maquinaId).toBe(origem.id);

      expect(await a.repos.computadores.iniciarOperacao(c.id, "trocar", 2000)).toBe(true);
      // A segunda troca (ou qualquer operação) ao mesmo tempo não começa: o serviço responde estado_invalido.
      expect(await a.repos.computadores.iniciarOperacao(c.id, "trocar", 2001)).toBe(false);
      expect(await a.repos.computadores.fixarLugar(c.id, paraB)).toBe(true);
      // O destino faz TOFU de novo: a chave da origem não vale lá.
      expect(await a.repos.computadores.daPessoa()).toMatchObject({ maquinaId: destino.id, hospedeiraId: destino.id, supervisorPub: null, operacao: { tipo: "trocar" } });
      // A volta (o iniciar falhou) devolve a chave de antes.
      expect(await a.repos.computadores.fixarLugar(c.id, { maquinaId: origem.id, hospedeiraId: origem.id, supervisorPub: new Uint8Array(32).fill(1), saidasPendentesDe: [] })).toBe(true);
      expect((await a.repos.computadores.daPessoa())!.supervisorPub).toBe(Buffer.from(new Uint8Array(32).fill(1)).toString("base64"));
      expect(await a.repos.computadores.terminarOperacao(c.id, "trocar")).toBe(true);

      // Trazer de volta para onde o nod roda: maquina_id nulo; a origem sem contato fica pendente.
      expect(await a.repos.computadores.iniciarOperacao(c.id, "trocar", 3000)).toBe(true);
      expect(await a.repos.computadores.adicionarSaidaPendente(c.id, destino.id)).toBe(true);
      expect(await a.repos.computadores.fixarLugar(c.id, { maquinaId: null, hospedeiraId: destino.id, supervisorPub: null, saidasPendentesDe: [origem.id] })).toBe(true);
      expect(await a.repos.computadores.daPessoa()).toMatchObject({ maquinaId: null, hospedeiraId: destino.id, saidasPendentesDe: [origem.id] });
      // A troca renova o prazo a cada parte (a loja grande não vence nos 15 min); sem renovarEm, o desde fica.
      await a.repos.computadores.progredirOperacao(c.id, "trocar", { pct: 50, etapa: "Copiando os logins", renovarEm: 900_000 });
      expect((await a.repos.computadores.daPessoa())!.operacao!.desde).toBe(900_000);
      await a.repos.computadores.progredirOperacao(c.id, "trocar", { pct: 60, etapa: "Copiando os logins" });
      expect((await a.repos.computadores.daPessoa())!.operacao!.desde).toBe(900_000);
      await a.repos.computadores.terminarOperacao(c.id, "trocar");
      // O marcar_saida de outra máquina não limpa; o da pendente limpa (fora da operação também).
      await a.repos.computadores.saidaMarcada(c.id, destino.id);
      expect((await a.repos.computadores.daPessoa())!.saidasPendentesDe).toEqual([origem.id]);
      await a.repos.computadores.saidaMarcada(c.id, origem.id);
      expect((await a.repos.computadores.daPessoa())!.saidasPendentesDe).toEqual([]);
      // O último uso gravado da chave é o "sem contato desde" que sobrevive à ponte.
      await trx`update maquina_tokens set ultimo_uso_em = to_timestamp(1700000000) where id = ${origem.id}`;
      expect(await a.repos.maquinaTokens.identificar(origem.id)).toMatchObject({ nome: "Linux A", ultimoUsoEm: 1_700_000_000_000 });

      // Sem computador por bot arquivado, o aviso só aparece depois de trocar sem os logins, e sai quando dispensado.
      expect(await a.repos.computadores.avisoRecriado(c.id)).toBe(false);
      await a.repos.computadores.registrar({ computadorId: c.id, autor: "pessoa", tipo: "trocar_sem_logins", estado: "concluida" });
      expect(await a.repos.computadores.avisoRecriado(c.id)).toBe(true);
      await a.repos.computadores.registrar({ computadorId: c.id, autor: "pessoa", tipo: "aviso_recriado", estado: "concluida" });
      expect(await a.repos.computadores.avisoRecriado(c.id)).toBe(false);
      // Uma nova troca sem os logins, depois do dispensar, mostra de novo.
      await trx`update computador_acoes set em = em - interval '1 minute' where computador_id = ${c.id} and tipo = 'aviso_recriado'`;
      expect(await a.repos.computadores.avisoRecriado(c.id)).toBe(true);
    });
  });
});
