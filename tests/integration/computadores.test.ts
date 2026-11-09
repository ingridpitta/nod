import { expect, it } from "vitest";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { randomUUID } from "node:crypto";
import { computadorPadrao } from "../../src/domain/computador.ts";
const escopo = {tenantId:TENANT_PADRAO,pessoaId:PESSOA_MARLON};
describeIntegracao("computador persistente por bot",()=>{
  it("mantém IDs distintos, vínculo estável e libera somente a reserva correta",async()=>{
    await withRollback(escopo,async trx=>{
      const a=await agenteComConversa(trx,escopo);const b=await agenteComConversa(trx,escopo);
      const c=await a.repos.computadores.obter(a.agenteId);const outro=await b.repos.computadores.obter(b.agenteId);
      expect(c!.id).not.toBe(outro!.id);expect(c!.id).not.toBe(a.agenteId);
      expect((await a.repos.computadores.obter(a.agenteId))!.id).toBe(c!.id);
      const lease=randomUUID();const ate=Date.now()+60000;
      await a.repos.computadores.ocupar(c!.id,lease,ate);
      await a.repos.computadores.liberar(c!.id,randomUUID());
      expect((await a.repos.computadores.travar(c!.id))!.ocupadoAte).toBe(ate);
      await a.repos.computadores.liberar(c!.id,lease);
      expect((await a.repos.computadores.travar(c!.id))!.ocupadoAte).toBeNull();
    });
  });
  it("saúde (emenda da ADR-037): a 3ª falha seguida tira do ar UMA vez; resposta zera; a atividade mostra o observar que falhou",async()=>{
    await withRollback(escopo,async trx=>{
      const a=await agenteComConversa(trx,escopo);
      const c=(await a.repos.computadores.obter(a.agenteId))!;
      expect(c).toMatchObject({falhasSeguidas:0,falhaMotivo:null,indisponivelDesde:null});
      const falhar=(em:number)=>a.repos.computadores.registrarFalha(c.id,{motivo:"navegador_nao_abriu",em,limite:3});
      const r=[await falhar(1000),await falhar(2000),await falhar(3000),await falhar(4000)];
      expect(r.map(x=>x?.virouIndisponivel)).toEqual([false,false,true,false]);
      expect(r[3]!.computador).toMatchObject({falhasSeguidas:4,falhaMotivo:"navegador_nao_abriu",indisponivelDesde:3000,agenteId:a.agenteId});
      expect(await a.repos.computadores.foraDoAr()).toEqual(new Map([[a.agenteId,{desde:3000,motivo:"navegador_nao_abriu"}]]));
      const falhou=await a.repos.computadores.registrar({computadorId:c.id,autor:"bot",tipo:"observar",estado:"executando"});
      await a.repos.computadores.concluir(falhou.id,"falhou","navegador_nao_abriu");
      const deuCerto=await a.repos.computadores.registrar({computadorId:c.id,autor:"bot",tipo:"observar",estado:"executando"});
      await a.repos.computadores.concluir(deuCerto.id,"concluida","navegador_nao_abriu");
      expect((await a.repos.computadores.atividade(c.id)).map(x=>[x.tipo,x.estado,x.motivo])).toEqual([["observar","falhou","navegador_nao_abriu"]]);
      expect(await a.repos.computadores.registrarSucesso(c.id)).toBe(true);
      expect(await a.repos.computadores.registrarSucesso(c.id)).toBe(false);
      expect(await a.repos.computadores.travar(c.id)).toMatchObject({falhasSeguidas:0,falhaMotivo:null,indisponivelDesde:null});
      expect((await a.repos.computadores.foraDoAr()).size).toBe(0);
      // 0022: motivo só em ação que falhou (o último comando: o erro aborta a transação do teste).
      await expect(trx`update computador_acoes set motivo = 'ocupado' where id = ${deuCerto.id}`).rejects.toThrow(/computador_acao_motivo_so_na_falha/);
    });
  });
  it("outra pessoa não vê nem muda computador, arquivos ou ações de um bot compartilhado em leitura",async()=>{
    await withRollback(escopo,async trx=>{
      const a=await agenteComConversa(trx,escopo);
      const c=await a.repos.computadores.obter(a.agenteId);
      const acao=await a.repos.computadores.registrar({computadorId:c!.id,autor:"bot",tipo:"digitar",estado:"pendente",argumentosCifrados:"cifrado"});
      await trx`update agentes set visibility = 'equipe' where id = ${a.agenteId}`;
      const ana={tenantId:TENANT_PADRAO,pessoaId:PESSOA_ANA};await vincularEscopo(trx,ana);
      const repos=criarRepos(trx,ana);
      expect(await repos.computadores.obter(a.agenteId)).toBeNull();
      expect(await repos.computadores.travar(c!.id)).toBeNull();
      expect(await repos.computadores.buscarAcao(acao.id)).toBeNull();
      expect(await trx`select * from computadores where id = ${c!.id}`).toHaveLength(0);
      expect(await trx`update computadores set controle = 'pessoa' where id = ${c!.id} returning id`).toHaveLength(0);
      await vincularEscopo(trx,escopo);
      expect((await a.repos.computadores.travar(c!.id))!.controle).toBe("bot");
    });
  });
  it("NOD-192: buscarDoAgente só lê; o padrão do domínio bate com os defaults da 0014/0022 de uma linha nova",async()=>{
    await withRollback(escopo,async trx=>{
      const a=await agenteComConversa(trx,escopo);
      const linhas=async()=>(await trx<{n:number}[]>`select count(*)::int as n from computadores`)[0]!.n;
      const antes=await linhas();
      expect(await a.repos.computadores.buscarDoAgente(a.agenteId)).toBeNull();
      expect(await linhas()).toBe(antes);
      expect((await trx<{computador_id:string|null}[]>`select computador_id from agentes where id = ${a.agenteId}`)[0]!.computador_id).toBeNull();
      // A 1ª ação cria pela migração (obter); o padrão é ela sem id e sem criado_em.
      const criado=(await a.repos.computadores.obter(a.agenteId))!;
      expect(await linhas()).toBe(antes+1);
      expect({...criado,id:null,criadoEm:null}).toEqual(computadorPadrao(a.agenteId));
      expect(await a.repos.computadores.buscarDoAgente(a.agenteId)).toEqual(criado);
      // 404 como obter: inexistente, de outra pessoa ou excluído.
      expect(await a.repos.computadores.buscarDoAgente(randomUUID())).toBeUndefined();
      const ana={tenantId:TENANT_PADRAO,pessoaId:PESSOA_ANA};await vincularEscopo(trx,ana);
      expect(await criarRepos(trx,ana).computadores.buscarDoAgente(a.agenteId)).toBeUndefined();
      await vincularEscopo(trx,escopo);
      await trx`update agentes set excluido_em = now() where id = ${a.agenteId}`;
      expect(await a.repos.computadores.buscarDoAgente(a.agenteId)).toBeUndefined();
    });
  });
});
