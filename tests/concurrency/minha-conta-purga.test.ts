import { randomBytes } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { caixaLocal } from "../../src/adapters/email/enviador.ts";
import { criarGuardaSessao } from "../../src/adapters/http/sessao-revogavel.ts";
import * as repoContas from "../../src/repositories/contas.repo.ts";
import * as repoMinhaConta from "../../src/repositories/minha-conta.repo.ts";
import { perfilRepo } from "../../src/repositories/perfil.repo.ts";
import type { Tx } from "../../src/shared/types.ts";
import { servicoConta, type Quem } from "../../src/use-cases/conta.ts";
import { servicoMinhaConta } from "../../src/use-cases/minha-conta.ts";
import { abrirTxEscopada } from "../../src/db/tx.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * NOD-346 (ADR-126 §5–6): a purga de verdade, com linhas COMMITADAS. O prazo de 30 dias nasce no banco (o nod_app não o
 * escolhe), então o dono adianta o relógio da exclusão, como o tempo faria. A purga apaga o tenant inteiro; o que sobra
 * (a linha da exclusão, os limites) a dona apaga no afterAll.
 */
const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres";
const SENHA = "uma senha boa de teste";
const ip = () => `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const exclusoes: string[] = [];

function servicos(purga: boolean) {
  const caixa = caixaLocal();
  const transacao = <T,>(fn: (trx: Tx) => Promise<T>) => db.begin((trx) => fn(trx as unknown as Tx)) as Promise<T>;
  const conta = servicoConta({ transacao, segredo: SEGREDO, enviador: caixa, urlBase: "https://nod.teste", agora: Date.now, repo: repoContas, emitirChaveMaquina: async () => `nodm_${randomBytes(8).toString("hex")}` });
  const mc = servicoMinhaConta({ transacao, segredo: SEGREDO, enviador: caixa, urlBase: "https://nod.teste", agora: Date.now, repo: repoContas, mc: repoMinhaConta, perfil: perfilRepo, purgaLigada: purga });
  return { conta, mc, caixa };
}

async function contaNova(s: ReturnType<typeof servicos>): Promise<Quem & { email: string; contaId: string }> {
  const email = `purga-${randomBytes(5).toString("hex")}@exemplo.com.br`;
  const r = await s.conta.provisorio({ escopo: null, sid: null, ip: ip(), aparelho: "macOS · Chrome" }, { verificador: randomBytes(24).toString("base64url"), nome: "Ana", forma: "web" });
  const q: Quem = { escopo: r.escopo, sid: r.sessao!.sid, ip: ip(), aparelho: "macOS · Chrome" };
  await s.conta.cadastrar(q, { email, senha: SENHA });
  const codigo = /(\d{6})/.exec(s.caixa.mensagens.at(-1)!.texto)![1]!;
  expect(await s.conta.verificar(q, { codigo })).toMatchObject({ resultado: "convertida" });
  const [l] = await dbDono<{ id: string }[]>`select id from contas where email = ${email}`;
  return { ...q, email, contaId: l!.id };
}

async function vencer(contaId: string): Promise<string> {
  const [l] = await dbDono<{ id: string }[]>`update exclusoes_conta set purgar_em = clock_timestamp() - interval '1 second'
    where conta_id = ${contaId} and estado = 'programada' returning id`;
  exclusoes.push(l!.id);
  return l!.id;
}

afterAll(async () => {
  if (exclusoes.length) await dbDono`delete from exclusoes_conta where id in ${dbDono(exclusoes)}`;
  await dbDono.end({ timeout: 1 });
});

describeIntegracao("purga da conta (NOD-346): 30 dias depois, tudo some e o login falha", () => {
  it("com NOD_PURGA_CONTA, a vencida é purgada: conta, pessoa e tenant somem e o login dá falha genérica", async () => {
    const s = servicos(true);
    const q = await contaNova(s);
    await s.mc.salvarPerfil(q, { nome: "Ana", sobreMim: "algo pessoal" });
    expect(await s.mc.reautenticarComSenha(q, { senha: SENHA })).toMatchObject({ resultado: "ok" });
    await s.mc.excluir(q);
    // Antes do prazo, nada.
    const antes = await s.mc.purgarVencidas(1000);
    expect(antes).toBe(0);
    await vencer(q.contaId);
    expect(await s.mc.purgarVencidas(1000)).toBeGreaterThanOrEqual(1);
    const [sobra] = await dbDono<{ contas: number; pessoas: number; tenants: number; sessoes: number }[]>`select
      (select count(*)::int from contas where id = ${q.contaId}) as contas,
      (select count(*)::int from pessoas where tenant_id = ${q.escopo!.tenantId}) as pessoas,
      (select count(*)::int from tenants where id = ${q.escopo!.tenantId}) as tenants,
      (select count(*)::int from sessoes where tenant_id = ${q.escopo!.tenantId}) as sessoes`;
    expect(sobra).toEqual({ contas: 0, pessoas: 0, tenants: 0, sessoes: 0 });
    // Revisão do PR 506: o código do cadastro (`cadastro:<sid>`, com o e-mail e o hash da senha) também some.
    const [codigos] = await dbDono<{ n: number }[]>`select count(*)::int as n from codigos_conta
      where chave = ${`cadastro:${q.sid}`} or chave = ${q.sid!} or dados->>'email' = ${q.email}`;
    expect(codigos?.n).toBe(0);
    const [ex] = await dbDono<{ estado: string }[]>`select estado from exclusoes_conta where conta_id = ${q.contaId}`;
    expect(ex?.estado).toBe("purgada");
    expect(await s.conta.entrar({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { email: q.email, senha: SENHA })).toEqual({ resultado: "recusado" });
  });

  it("sem NOD_PURGA_CONTA, a vencida fica; desfeita, não purga nem com a flag", async () => {
    const desligada = servicos(false);
    const q = await contaNova(desligada);
    expect(await desligada.mc.reautenticarComSenha(q, { senha: SENHA })).toMatchObject({ resultado: "ok" });
    await desligada.mc.excluir(q);
    const id = await vencer(q.contaId);
    expect(await desligada.mc.purgarVencidas(1000)).toBe(0);
    const [c] = await dbDono<{ n: number }[]>`select count(*)::int as n from contas where id = ${q.contaId}`;
    expect(c?.n).toBe(1);
    // Desfeita: a função recusa mesmo chamada direto.
    expect(await desligada.mc.desfazerExclusao(q)).toEqual({ desfeita: true });
    expect(await db.begin((trx) => repoMinhaConta.purgar(trx as unknown as Tx, id))).toEqual({ resultado: "ignorada" });
    const [c2] = await dbDono<{ n: number }[]>`select count(*)::int as n from contas where id = ${q.contaId}`;
    expect(c2?.n).toBe(1);
    // Limpeza da conta que ficou: programa de novo, vence e purga.
    await desligada.mc.excluir(q);
    await vencer(q.contaId);
    expect(await servicos(true).mc.purgarVencidas(1000)).toBeGreaterThanOrEqual(1);
  });

  it("revisão do PR 506: uma exclusão que não pode ser purgada sai da fila (bloqueada) e não trava a válida de trás", async () => {
    const s = servicos(true);
    const travada = await contaNova(s);
    expect(await s.mc.reautenticarComSenha(travada, { senha: SENHA })).toMatchObject({ resultado: "ok" });
    await s.mc.excluir(travada);
    const idTravada = await vencer(travada.contaId);
    // O espaço ganhou outra pessoa durante os 30 dias: a purga recusa. E fica na frente da fila (vence antes).
    await dbDono`update exclusoes_conta set purgar_em = clock_timestamp() - interval '400 days' where id = ${idTravada}`;
    const outra = (await dbDono<{ id: string }[]>`insert into pessoas (tenant_id, id, nome, iniciais) values (${travada.escopo!.tenantId}, gen_random_uuid(), 'Bruno', 'B') returning id`)[0]!;
    const valida = await contaNova(s);
    expect(await s.mc.reautenticarComSenha(valida, { senha: SENHA })).toMatchObject({ resultado: "ok" });
    await s.mc.excluir(valida);
    await vencer(valida.contaId);
    // Limite 1: a da frente é a travada. A primeira volta a tira da fila; a segunda purga a válida.
    await s.mc.purgarVencidas(1);
    const [ex] = await dbDono<{ estado: string; motivo: string | null }[]>`select estado, motivo from exclusoes_conta where id = ${idTravada}`;
    expect(ex).toEqual({ estado: "bloqueada", motivo: "espaco_de_equipe" });
    for (let i = 0; i < 20; i++) {
      const [c] = await dbDono<{ n: number }[]>`select count(*)::int as n from contas where id = ${valida.contaId}`;
      if (c?.n === 0) break;
      await s.mc.purgarVencidas(1);
    }
    const [c] = await dbDono<{ n: number }[]>`select count(*)::int as n from contas where id = ${valida.contaId}`;
    expect(c?.n).toBe(0);
    // A travada continua inteira (ninguém perdeu nada) até uma pessoa decidir.
    const [t] = await dbDono<{ n: number }[]>`select count(*)::int as n from pessoas where tenant_id = ${travada.escopo!.tenantId}`;
    expect(t?.n).toBe(2);
    // Limpeza (o banco é dividido: um tenant a mais quebra quem conta tenants): tira o Bruno, programa de novo e purga.
    await dbDono`delete from pessoas where id = ${outra.id}`;
    await s.mc.excluir(travada);
    await vencer(travada.contaId);
    expect(await s.mc.purgarVencidas(1000)).toBeGreaterThanOrEqual(1);
    const [fim] = await dbDono<{ n: number }[]>`select count(*)::int as n from tenants where id = ${travada.escopo!.tenantId}`;
    expect(fim?.n).toBe(0);
  });

  it("revisão do PR 506: a purga leva as FKs cruzadas (entrada aberta por uma sessão daqui para outra conta, pareamento pedido daqui)", async () => {
    const s = servicos(true);
    const a = await contaNova(s);
    const b = await contaNova(s);
    // A sessão de A tentou entrar na conta B (entrada com destino em B) e pediu o pareamento de B.
    await dbDono`insert into entradas_conta (sessao_id, destino_tenant_id, destino_pessoa_id, conta_id, email, expira_em)
      values (${a.sid!}, ${b.escopo!.tenantId}, ${b.escopo!.pessoaId}, ${b.contaId}, ${b.email}, clock_timestamp() + interval '5 minutes')`;
    await dbDono`insert into pareamentos_conta (tenant_id, pessoa_id, hash, estado, pedido_sessao_id, expira_em)
      values (${b.escopo!.tenantId}, ${b.escopo!.pessoaId}, ${randomBytes(32)}, 'pedido', ${a.sid!}, clock_timestamp() + interval '5 minutes')`;
    expect(await s.mc.reautenticarComSenha(a, { senha: SENHA })).toMatchObject({ resultado: "ok" });
    await s.mc.excluir(a);
    const id = await vencer(a.contaId);
    await s.mc.purgarVencidas(1000);
    const [ex] = await dbDono<{ estado: string; motivo: string | null }[]>`select estado, motivo from exclusoes_conta where id = ${id}`;
    expect(ex).toEqual({ estado: "purgada", motivo: null });
    const [sobra] = await dbDono<{ entradas: number; pareamentos: number; contaB: number }[]>`select
      (select count(*)::int from entradas_conta where sessao_id = ${a.sid!}) as entradas,
      (select count(*)::int from pareamentos_conta where pedido_sessao_id = ${a.sid!}) as pareamentos,
      (select count(*)::int from contas where id = ${b.contaId}) as "contaB"`;
    expect(sobra).toEqual({ entradas: 0, pareamentos: 0, contaB: 1 });
    // Limpeza de B.
    expect(await s.mc.reautenticarComSenha(b, { senha: SENHA })).toMatchObject({ resultado: "ok" });
    await s.mc.excluir(b);
    await vencer(b.contaId);
    await s.mc.purgarVencidas(1000);
  });

  // Revisão 4 do PR 506: a purga com um tenant de verdade, passando pelos ciclos de FK (mensagem ↔ turno, trabalho ↔ lote)
  // e pelos SET NULL que esbarram em CHECK e trigger. Tem de terminar 'purgada' e sem uma linha do tenant em nenhuma tabela.
  it("revisão do PR 506: purga um tenant cheio (bot, conversa, turnos, mensagens em ciclo, frente com lote, memória, rotina, decisão)", async () => {
    const s = servicos(true);
    const q = await contaNova(s);
    const escopo = q.escopo!;
    await abrirTxEscopada(db, escopo)(async (trx) => {
      const bot = await agenteComConversa(trx, escopo, { nome: "Zé" });
      const { repos, agenteId, conversaId } = bot;
      const turno = (await repos.turnos.enfileirar({ executor: "local", agenteId, conversaId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" }))!;
      const fala = (await repos.mensagens.criar({ conversaId, turnoId: turno.id, autoria: autoriaPessoa(escopo.pessoaId), kind: "texto", texto: "oi", confianca: "confiavel" }))!;
      await trx`update turnos set mensagem_origem_id = ${fala.id} where id = ${turno.id}`;
      const [frente] = await trx<{ id: string }[]>`insert into trabalhos (tenant_id, owner_id, agente_id, conversa_id, titulo, origem, forma)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${agenteId}, ${conversaId}, 'Frente', 'pessoa', 'frente') returning id`;
      const [lote] = await trx<{ id: string }[]>`insert into lotes_de_frentes (tenant_id, owner_id, agente_id, aberto_por_turno_id, trabalho_id)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${agenteId}, ${turno.id}, ${frente!.id}) returning id`;
      await trx`update trabalhos set lote_id = ${lote!.id} where id = ${frente!.id}`;
      await repos.memorias.criar({ agenteId, tipo: "preferencia", texto: "resumos curtos", origem: "pessoa" });
      // NOD-20: versões do perfil (só acrescenta para o nod_app; a purga tem de levá-las).
      await repos.versoesPerfil.inserir({ agenteId, versao: 1, origem: "inicial", perfil: { nome: "Zé", titulo: "", descricao: "", forma: "shape-hex", cor: "c-purple", voz: null, vozVelocidade: 1 }, campos: [] });
      await repos.versoesPerfil.inserir({ agenteId, versao: 2, origem: "tela", perfil: { nome: "Zé", titulo: "", descricao: "Missão.", forma: "shape-hex", cor: "c-purple", voz: null, vozVelocidade: 1 }, campos: ["descricao"] });
      await repos.rotinas.criar({ agenteId, conversaId, cron: "*/30 * * * *", fusoIana: "UTC", instrucao: "PRs", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() + 3_600_000 });
      await trx`insert into decisoes (tenant_id, owner_id, decisor_id, agente_id, conversa_id, tipo, prazo_decisao_em, frase)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${escopo.pessoaId}, ${agenteId}, ${conversaId}, 'pergunta', now() + interval '1 day', 'posso?')`;
    });
    expect(await s.mc.reautenticarComSenha(q, { senha: SENHA })).toMatchObject({ resultado: "ok" });
    await s.mc.excluir(q);
    const id = await vencer(q.contaId);
    await s.mc.purgarVencidas(1000);
    const [ex] = await dbDono<{ estado: string; motivo: string | null }[]>`select estado, motivo from exclusoes_conta where id = ${id}`;
    expect(ex).toEqual({ estado: "purgada", motivo: null });
    // Nenhuma tabela com tenant_id guarda linha do tenant (exclusoes_conta é global, sem tenant_id: a prova da purga).
    const tabelas = await dbDono<{ tabela: string }[]>`select c.table_name as tabela from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name <> 'exclusoes_conta'`;
    const sobras: string[] = [];
    await dbDono.begin(async (trx) => {
      await trx`select set_config('nod.purga_tenant', ${escopo.tenantId}, true)`;
      for (const { tabela } of tabelas) {
        const [l] = await trx.unsafe<{ n: number }[]>(`select count(*)::int as n from public.${tabela} where tenant_id = $1`, [escopo.tenantId]);
        if (l?.n) sobras.push(`${tabela}=${l.n}`);
      }
    });
    expect(sobras).toEqual([]);
    expect((await dbDono<{ n: number }[]>`select count(*)::int as n from tenants where id = ${escopo.tenantId}`)[0]?.n).toBe(0);
  });

  it("revisão do PR 506: o que um turno em curso grava depois da purga sai na varredura da hora seguinte", async () => {
    const s = servicos(true);
    const q = await contaNova(s);
    expect(await s.mc.reautenticarComSenha(q, { senha: SENHA })).toMatchObject({ resultado: "ok" });
    await s.mc.excluir(q);
    await vencer(q.contaId);
    await s.mc.purgarVencidas(1000);
    // Uma escrita atrasada no tenant purgado (o nod_app grava com o escopo que tinha).
    await db.begin(async (trx) => {
      await trx`select set_config('nod.tenant_id', ${q.escopo!.tenantId}, true), set_config('nod.pessoa_id', ${q.escopo!.pessoaId}, true)`;
      await trx`insert into exportacoes (tenant_id, owner_id) values (${q.escopo!.tenantId}, ${q.escopo!.pessoaId})`;
    });
    await s.mc.purgarVencidas(1000);
    const [n] = await dbDono<{ n: number }[]>`select count(*)::int as n from exportacoes where tenant_id = ${q.escopo!.tenantId}`;
    expect(n?.n).toBe(0);
  });

  it("revisão do PR 506: espaço pessoal é a marca do tenant sem domínio admitido; a empresa de uma pessoa só não sai", async () => {
    const s = servicos(true);
    const q = await contaNova(s);
    expect(await s.mc.reautenticarComSenha(q, { senha: SENHA })).toMatchObject({ resultado: "ok" });
    // A mesma forma (uma pessoa, uma ligação), mas o tenant não é pessoal: a exclusão nem é programada.
    await dbDono`update tenants set pessoal = false where id = ${q.escopo!.tenantId}`;
    await expect(s.mc.excluir(q)).rejects.toMatchObject({ cause: "conta_de_equipe" });
    expect((await s.mc.estado(q)).conta?.podeExcluir).toBe(false);
    await dbDono`update tenants set pessoal = true where id = ${q.escopo!.tenantId}`;
    // Programada enquanto era pessoal; nos 30 dias o tenant ganhou um domínio admitido (virou de empresa): a purga recusa.
    await s.mc.excluir(q);
    const id = await vencer(q.contaId);
    const dominio = `empresa-${randomBytes(4).toString("hex")}.com.br`;
    await dbDono`insert into dominios_admitidos (tenant_id, dominio) values (${q.escopo!.tenantId}, ${dominio})`;
    expect((await s.mc.estado(q)).conta?.podeExcluir).toBe(false);
    await s.mc.purgarVencidas(1000);
    const [ex] = await dbDono<{ estado: string; motivo: string | null }[]>`select estado, motivo from exclusoes_conta where id = ${id}`;
    expect(ex).toEqual({ estado: "bloqueada", motivo: "espaco_de_equipe" });
    const [t] = await dbDono<{ n: number }[]>`select count(*)::int as n from tenants where id = ${q.escopo!.tenantId}`;
    expect(t?.n).toBe(1);
    // Limpeza: sem o domínio, programa de novo e purga.
    await dbDono`delete from dominios_admitidos where dominio = ${dominio}`;
    await s.mc.excluir(q);
    await vencer(q.contaId);
    expect(await s.mc.purgarVencidas(1000)).toBeGreaterThanOrEqual(1);
  });

  it("revisão do PR 506: erro passageiro (linha travada) conta tentativa e deixa programada; na 5ª, bloqueada", async () => {
    const s = servicos(true);
    const q = await contaNova(s);
    expect(await s.mc.reautenticarComSenha(q, { senha: SENHA })).toMatchObject({ resultado: "ok" });
    await s.mc.excluir(q);
    const id = await vencer(q.contaId);
    // Outra transação segura a linha da conta além do lock_timeout da purga (3 s).
    const comTrava = async (fn: () => Promise<unknown>) => {
      let soltar!: () => void;
      const solta = new Promise<void>((ok) => (soltar = ok));
      let pronta!: () => void;
      const travou = new Promise<void>((ok) => (pronta = ok));
      const trava = dbDono.begin(async (trx) => {
        await trx`select id from contas where id = ${q.contaId} for update`;
        pronta();
        await solta;
      });
      await travou;
      try { await fn(); } finally { soltar(); await trava; }
    };
    await comTrava(() => s.mc.purgarVencidas(1000));
    const [a] = await dbDono<{ estado: string; tentativas: number }[]>`select estado, tentativas from exclusoes_conta where id = ${id}`;
    expect(a).toEqual({ estado: "programada", tentativas: 1 });
    await dbDono`update exclusoes_conta set tentativas = 4 where id = ${id}`;
    await comTrava(() => s.mc.purgarVencidas(1000));
    const [b] = await dbDono<{ estado: string; motivo: string | null; tentativas: number }[]>`select estado, motivo, tentativas from exclusoes_conta where id = ${id}`;
    expect(b).toEqual({ estado: "bloqueada", motivo: "erro_55p03", tentativas: 5 });
    // Limpeza.
    await s.mc.excluir(q);
    await vencer(q.contaId);
    expect(await s.mc.purgarVencidas(1000)).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("codex no PR 506: a pessoa travada por outra transação não pendura o laço (o lock_timeout vale desde a 1ª trava)", async () => {
    const s = servicos(true);
    const q = await contaNova(s);
    expect(await s.mc.reautenticarComSenha(q, { senha: SENHA })).toMatchObject({ resultado: "ok" });
    await s.mc.excluir(q);
    const id = await vencer(q.contaId);
    let soltar!: () => void;
    const solta = new Promise<void>((ok) => (soltar = ok));
    let pronta!: () => void;
    const travou = new Promise<void>((ok) => (pronta = ok));
    const trava = dbDono.begin(async (trx) => {
      await trx`select id from pessoas where tenant_id = ${q.escopo!.tenantId} and id = ${q.escopo!.pessoaId} for update`;
      pronta();
      await solta;
    });
    await travou;
    // Sem o limite antes da trava da pessoa, a purga esperaria os 12 s da outra transação.
    const solto = setTimeout(soltar, 12_000);
    const t0 = Date.now();
    try {
      await s.mc.purgarVencidas(1000);
    } finally {
      clearTimeout(solto);
      soltar();
      await trava;
    }
    expect(Date.now() - t0).toBeLessThan(8_000);
    const [a] = await dbDono<{ estado: string }[]>`select estado from exclusoes_conta where id = ${id}`;
    expect(a?.estado).toBe("programada");
    // Solta, a próxima volta purga (e limpa o tenant para os outros testes).
    expect(await s.mc.purgarVencidas(1000)).toBeGreaterThanOrEqual(1);
  }, 40_000);

  it("revisão do PR 506: depois da purga, o cookie antigo (sem sid) da pessoa não vale mais", async () => {
    const s = servicos(true);
    const q = await contaNova(s);
    const guarda = criarGuardaSessao(db);
    expect(await guarda.conferir(q.escopo!, null)).toBe(true);
    expect(await s.mc.reautenticarComSenha(q, { senha: SENHA })).toMatchObject({ resultado: "ok" });
    await s.mc.excluir(q);
    await vencer(q.contaId);
    expect(await s.mc.purgarVencidas(1000)).toBeGreaterThanOrEqual(1);
    expect(await criarGuardaSessao(db).conferir(q.escopo!, null)).toBe(false);
  });

  it("formas de entrada: na conta só com Google, o Google é a última forma e não sai (domínio e banco)", async () => {
    const s = servicos(true);
    const q = await contaNova(s);
    await db`insert into identidades_conta (conta_id, tipo, google_iss, google_sub) values (${q.contaId}, 'google', 'https://accounts.google.com', ${`sub-${randomBytes(6).toString("hex")}`})`;
    // A senha sai enquanto o Google ainda está lá: o banco deixa.
    await db`delete from identidades_conta where conta_id = ${q.contaId} and tipo = 'senha'`;
    expect((await s.mc.estado(q)).conta?.formas).toEqual({ senha: false, google: true });
    // Sem senha, reautentica por código no e-mail.
    await s.mc.enviarCodigo(q);
    const codigo = /(\d{6})/.exec(s.caixa.mensagens.at(-1)!.texto)![1]!;
    expect(await s.mc.reautenticarComCodigo(q, { codigo })).toMatchObject({ resultado: "ok" });
    await expect(s.mc.removerGoogle(q)).rejects.toMatchObject({ codigo: "estado_invalido", cause: "ultima_forma_de_entrada" });
    // E o banco recusa mesmo se o domínio errar.
    await expect(db.begin((trx) => repoMinhaConta.removerGoogle(trx as unknown as Tx, q.contaId))).rejects.toThrow(/última forma de entrada/);
    // Limpeza: exclui, vence e purga.
    await s.mc.excluir(q);
    await vencer(q.contaId);
    expect(await s.mc.purgarVencidas(1000)).toBeGreaterThanOrEqual(1);
  });

  it("duas exclusões ao mesmo tempo: uma programada só", async () => {
    const s = servicos(false);
    const q = await contaNova(s);
    expect(await s.mc.reautenticarComSenha(q, { senha: SENHA })).toMatchObject({ resultado: "ok" });
    const [a, b] = await Promise.all([s.mc.excluir(q), s.mc.excluir(q)]);
    expect(a).toEqual(b);
    const [n] = await dbDono<{ n: number }[]>`select count(*)::int as n from exclusoes_conta where conta_id = ${q.contaId} and estado = 'programada'`;
    expect(n?.n).toBe(1);
    await vencer(q.contaId);
    expect(await servicos(true).mc.purgarVencidas(1000)).toBeGreaterThanOrEqual(1);
  });
});
