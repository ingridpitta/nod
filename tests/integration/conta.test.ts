import * as repoContas from "../../src/repositories/contas.repo.ts";
import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import type { Quem } from "../../src/use-cases/conta.ts";
import { segredoDeTroca } from "../../desktop/conta-provisoria.ts";
import { resolverDesafio } from "../../src/services/desafio-provisorio.ts";
import { definirCotaDoProvisorio } from "../../src/repositories/cota-provisorio.ts";
import { ANTIABUSO, DIA_MS, dominioParaLimite } from "../../src/domain/salvaguardas-provisorio.ts";
import { chaveDeLimite } from "../../src/services/segredos-conta.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { APP, codigoDoEmail, type Mundo, comConta, emailNovo, ip, mundo, provisorio, PRONTO, SENHA, verificador } from "../helpers/conta-mundo.ts";

/**
 * NOD-345 (ADR-124): o serviço de conta no Postgres real, sob rollback. Cada `d.transacao` vira um savepoint da
 * transação do teste: o que falha volta só aquele pedaço, como em produção volta a transação inteira.
 */

describeIntegracao("conta (NOD-345): provisório, cadastro, escolha, recuperação, sessões e pareamento", () => {
  it("#j1: o provisório nasce sem cadastro e a mesma instalação volta ao MESMO espaço", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const v = verificador();
      const q: Quem = { escopo: null, sid: null, ip: ip(), aparelho: "macOS · app do nod" };
      const a = await m.s.provisorio(q, { verificador: v, forma: "app" });
      expect(a.novo).toBe(true);
      expect(a.chave).toMatch(/^nodm_/);
      const b = await m.s.provisorio(q, { verificador: v, forma: "app" });
      expect(b).toMatchObject({ novo: false, escopo: a.escopo });
      const [p] = await trx<{ email: string | null }[]>`select email from pessoas where tenant_id = ${a.escopo.tenantId} and id = ${a.escopo.pessoaId}`;
      expect(p).toEqual({ email: null });
      await expect(m.s.provisorio(q, { verificador: "curto", forma: "app" })).rejects.toBeInstanceOf(ErroDeDominio);
    });
  });

  it("NOD-408: depois de três espaços no mesmo IP exige prova de trabalho, válida uma vez", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx, { antiAbuso: true });
      const q: Quem = { escopo: null, sid: null, ip: ip(), aparelho: "macOS · Chrome" };
      for (let i = 0; i < 3; i++) expect((await m.s.provisorio(q, { verificador: verificador(), forma: "web" })).novo).toBe(true);
      const v = verificador();
      await expect(m.s.provisorio(q, { verificador: v, forma: "web" })).rejects.toMatchObject({ codigo: "limite_atingido", cause: "desafio_provisorio" });
      const prova = m.s.emitirDesafioProvisorio(q.ip);
      const resposta = resolverDesafio(prova.desafio, prova.bits);
      expect(resposta).not.toBeNull();
      expect((await m.s.provisorio(q, { verificador: v, forma: "web", desafio: prova.desafio, resposta })).novo).toBe(true);
      await expect(m.s.provisorio(q, { verificador: verificador(), forma: "web", desafio: prova.desafio, resposta })).rejects.toMatchObject({ cause: "desafio_provisorio" });
    });
  });

  it("NOD-408: tetos duros barram espaços e contas por IP/domínio, inclusive Google e recuperação", async () => {
    await withRollback(MARLON, async (trx) => {
      const segredo = "segredo-de-teste-com-mais-de-32-caracteres";
      const chaveDeslizante = chaveDeLimite(segredo, "janela_deslizante", randomBytes(8).toString("hex"));
      const t0 = Date.now() - (Date.now() % (60 * 60_000)) + 60 * 60_000 - 10;
      expect(await repoContas.consumirLimiteDeslizante(trx, chaveDeslizante, 60 * 60_000, 2, t0)).toBe(true);
      expect(await repoContas.consumirLimiteDeslizante(trx, chaveDeslizante, 60 * 60_000, 2, t0)).toBe(true);
      expect(await repoContas.consumirLimiteDeslizante(trx, chaveDeslizante, 60 * 60_000, 2, t0 + 20)).toBe(false);
      expect(await trx`select 1 from limites_conta where chave = ${chaveDeslizante}`).toHaveLength(1);
      expect(await repoContas.consumirLimiteDeslizante(trx, chaveDeslizante, 60 * 60_000, 2, t0 + 60 * 60_000 + 1)).toBe(true);
      const chaveFixa = chaveDeLimite(segredo, "janela_fixa_legada", randomBytes(8).toString("hex"));
      expect(await repoContas.consumirLimite(trx, chaveFixa, 60 * 60_000, 1, t0)).toBe(true);
      expect(await repoContas.consumirLimite(trx, chaveFixa, 60 * 60_000, 1, t0 + 20)).toBe(true);
      const esgotar = async (tipo: string, valor: string, teto: number, janela = DIA_MS) => {
        for (let i = 0; i < teto; i++) expect(await repoContas.consumirLimiteDeslizante(trx, chaveDeLimite(segredo, tipo, valor), janela, teto, Date.now())).toBe(true);
      };
      const m = mundo(trx, { antiAbuso: true });
      const antiga = `desafio_provisorio:${randomBytes(16).toString("base64url")}`;
      await trx`insert into limites_conta (chave, janela, contagem) values (${antiga}, ${new Date(Date.now() - 3 * DIA_MS)}, 1)`;
      await repoContas.podarLimitesConta(trx, Date.now());
      expect(await trx`select 1 from limites_conta where chave = ${antiga}`).toHaveLength(0);
      const ipEspaco = ip();
      await esgotar("provisorio_ip_dia", ipEspaco, ANTIABUSO.provisorioPorIpDia);
      const [linhaAntes] = await trx<{ n: number }[]>`select count(*)::int as n from limites_conta`;
      await expect(m.s.provisorio({ escopo: null, sid: null, ip: ipEspaco, aparelho: "x" }, { verificador: verificador(), forma: "web" })).rejects.toMatchObject({ cause: "provisorio por ip" });
      const [linhaDepois] = await trx<{ n: number }[]>`select count(*)::int as n from limites_conta`;
      expect(linhaDepois?.n).toBe(linhaAntes?.n);

      const porIp = await provisorio(m);
      await esgotar("cadastro_ip_dia", porIp.ip, ANTIABUSO.cadastroPorIpDia);
      const dominioNaoEnvenenado = `empresa-${randomBytes(4).toString("hex")}.com`;
      const emailNaoEnvenenado = `bloqueada@${dominioNaoEnvenenado}`;
      await expect(m.s.cadastrar(porIp, { email: emailNaoEnvenenado, senha: SENHA })).rejects.toMatchObject({ cause: "cadastro" });
      expect(await trx`select 1 from limites_conta where chave = ${chaveDeLimite(segredo, "cadastro_email", emailNaoEnvenenado)}`).toHaveLength(0);
      expect(await trx`select 1 from limites_conta where chave = ${chaveDeLimite(segredo, "cadastro_dominio", dominioNaoEnvenenado)}`).toHaveLength(0);

      const emailDominio = `nova@empresa-${randomBytes(4).toString("hex")}.com`;
      const dominio = dominioParaLimite(emailDominio)!;
      const porDominio = await provisorio(m);
      await esgotar("cadastro_dominio", dominio, ANTIABUSO.cadastroPorDominioHora, 60 * 60_000);
      await m.s.cadastrar(porDominio, { email: emailDominio, senha: SENHA });
      await expect(m.s.verificar(porDominio, { codigo: codigoDoEmail(m) })).rejects.toMatchObject({ cause: "cadastro" });

      const google = await provisorio(m);
      await expect(m.s.voltaGoogle(google, { iss: "https://accounts.google.com", sub: `sub-${randomBytes(4).toString("hex")}`, email: emailDominio, autoridade: true })).rejects.toMatchObject({ cause: "cadastro Google" });

      const emailRecuperacao = `dono@recuperar-${randomBytes(4).toString("hex")}.com`;
      const dominioDaRecuperacao = dominioParaLimite(emailRecuperacao)!;
      const donoRecuperacao = await provisorio(m);
      const contaRecuperacao = await repoContas.criarConta(trx, emailRecuperacao);
      expect(contaRecuperacao).not.toBeNull();
      expect(await repoContas.ligarContaPessoa(trx, contaRecuperacao!, donoRecuperacao.escopo!)).toBe(true);
      const antes = m.caixa.mensagens.length;
      await esgotar("recuperar_dominio", dominioDaRecuperacao, ANTIABUSO.recuperarPorDominioHora, 60 * 60_000);
      expect(await m.s.recuperar({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { email: emailRecuperacao })).toEqual({ ok: true });
      expect(m.caixa.mensagens).toHaveLength(antes);

      const ipRecuperacao = ip();
      const dominioRecuperacao = `recuperar-${randomBytes(4).toString("hex")}.com`;
      await esgotar("recuperar_ip_dia", ipRecuperacao, ANTIABUSO.recuperarPorIpDia);
      expect(await m.s.recuperar({ escopo: null, sid: null, ip: ipRecuperacao, aparelho: "x" }, { email: `alvo@${dominioRecuperacao}` })).toEqual({ ok: true });
      expect(await trx`select 1 from limites_conta where chave = ${chaveDeLimite(segredo, "recuperar_dominio", dominioRecuperacao)}`).toHaveLength(0);
    });
  });

  it("NOD-408: espaço provisório para de enfileirar turnos novos no teto", async () => {
    await withRollback(MARLON, async (trx) => {
      definirCotaDoProvisorio(1);
      try {
        const m = mundo(trx);
        const q = await provisorio(m, "Com cota");
        await vincularEscopo(trx, q.escopo!);
        const dp = depsSobreTrx(trx, q.escopo!);
        const bot = (await executar(dp, criarAgente, { dono: "pessoa" })).data;
        await executar(dp, enviarMensagem, { conversaId: bot.conversa.id, texto: "primeira", inventario: PRONTO });
        await expect(executar(dp, enviarMensagem, { conversaId: bot.conversa.id, texto: "segunda", inventario: PRONTO })).rejects.toMatchObject({ codigo: "cota_provisorio" });
        expect(await trx`select 1 from turnos where tenant_id = ${q.escopo!.tenantId}`).toHaveLength(1);
      } finally {
        definirCotaDoProvisorio(null);
      }
    });
  });

  it("NOD-408: fala nova interrompida consome a cota; a repetição futura não abre um bypass", async () => {
    await withRollback(MARLON, async (trx) => {
      definirCotaDoProvisorio(1);
      try {
        const m = mundo(trx);
        const q = await provisorio(m, "Interrompido conta");
        await vincularEscopo(trx, q.escopo!);
        const dp = depsSobreTrx(trx, q.escopo!);
        const bot = (await executar(dp, criarAgente, { dono: "pessoa" })).data;
        await executar(dp, enviarMensagem, { conversaId: bot.conversa.id, texto: "sem executor", inventario: { estado: "ausente", motivo: "sem IA", em: 0 } });
        await expect(executar(dp, enviarMensagem, { conversaId: bot.conversa.id, texto: "não passa", inventario: PRONTO })).rejects.toMatchObject({ codigo: "cota_provisorio" });
        expect(await trx<{ conta: boolean }[]>`select conta_cota_provisorio as conta from turnos where tenant_id = ${q.escopo!.tenantId}`).toEqual([{ conta: true }]);
      } finally {
        definirCotaDoProvisorio(null);
      }
    });
  });

  it("#j2: cadastro converte o MESMO espaço; código errado diz 'Restam N' e morre na 5ª", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const q = await provisorio(m);
      const email = emailNovo();
      expect(await m.s.cadastrar(q, { email, senha: SENHA })).toEqual({ enviado: true, email });
      expect((await m.s.estado(q)).verificando).toEqual({ email });
      const certo = codigoDoEmail(m);
      const errado = certo === "000000" ? "111111" : "000000";
      for (const restantes of [4, 3, 2, 1]) expect(await m.s.verificar(q, { codigo: errado })).toEqual({ resultado: "errado", restantes });
      expect(await m.s.verificar(q, { codigo: errado })).toEqual({ resultado: "vencido" });
      // Morto: nem o certo vale mais.
      expect(await m.s.verificar(q, { codigo: certo })).toEqual({ resultado: "vencido" });

      // Reenviar dá um código novo e ele converte esta pessoa (nada se move).
      await m.s.reenviar(q);
      expect(await m.s.verificar(q, { codigo: codigoDoEmail(m) })).toEqual({ resultado: "convertida", email });
      expect((await m.s.estado(q)).conta).toEqual({ email, senha: true, google: false });
      // Convertida: reenviar não manda outro código com a senha de antes.
      const n = m.caixa.mensagens.length;
      await expect(m.s.reenviar(q)).rejects.toMatchObject({ codigo: "estado_invalido" });
      expect(m.caixa.mensagens.length).toBe(n);
    });
  });

  it("com conta, o verificador da instalação é aposentado: não reabre o espaço nem ganha um novo e vazio", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const v = verificador();
      const anon: Quem = { escopo: null, sid: null, ip: ip(), aparelho: "macOS · Chrome" };
      const a = await m.s.provisorio(anon, { verificador: v, nome: "Ana", forma: "web" });
      const q: Quem = { escopo: a.escopo, sid: a.sessao!.sid, ip: ip(), aparelho: "macOS · Chrome" };
      await m.s.cadastrar(q, { email: emailNovo(), senha: SENHA });
      expect(await m.s.verificar(q, { codigo: codigoDoEmail(m) })).toMatchObject({ resultado: "convertida" });
      const [n] = await trx<{ n: number }[]>`select count(*)::int as n from bootstrap_instalacoes where tenant_id = ${a.escopo.tenantId} and aposentada_em is not null`;
      expect(n?.n).toBe(1);
      const chavesAntes = m.chaves.length;
      const [t0] = await trx<{ n: number }[]>`select count(*)::int as n from bootstrap_instalacoes`;
      // Sessão da conta caiu (vencida, "sair das outras", senha trocada): a instalação volta à tela de entrar, sem
      // ganhar um espaço novo e vazio em silêncio.
      for (const forma of ["app", "web"] as const) {
        await expect(m.s.provisorio(anon, { verificador: v, nome: "Ana", forma })).rejects.toMatchObject({ codigo: "estado_invalido" });
      }
      expect(m.chaves.length).toBe(chavesAntes);
      const [t1] = await trx<{ n: number }[]>`select count(*)::int as n from bootstrap_instalacoes`;
      expect(t1?.n).toBe(t0?.n);
    });
  });

  it("#j2-4: provedor fora do ar não derruba o cadastro: enviado=false", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx, { enviarFalha: true });
      const q = await provisorio(m);
      expect(await m.s.cadastrar(q, { email: emailNovo(), senha: SENHA })).toMatchObject({ enviado: false });
    });
  });

  it("cadastro não diz se o e-mail tem conta: mesma resposta; a posse provada abre a escolha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const q = await provisorio(m, "Visitante");
      expect(await m.s.cadastrar(q, { email: dono.email, senha: "outra senha qualquer" })).toEqual({ enviado: true, email: dono.email });
      expect(await m.s.verificar(q, { codigo: codigoDoEmail(m) })).toEqual({ resultado: "escolher", email: dono.email });
      expect((await m.s.estado(q)).escolha).toMatchObject({ email: dono.email });
    });
  });

  it("#j3-2: importar leva bots, conversas e rotinas (pausadas) e preserva o destino; repetir não duplica", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const destinoAntes = await contar(trx, dono.escopo!);

      const q = await provisorio(m, "Provisório");
      await vincularEscopo(trx, q.escopo!);
      const dp = depsSobreTrx(trx, q.escopo!);
      const bot = (await executar(dp, criarAgente, { dono: "pessoa" })).data;
      await executar(dp, enviarMensagem, { conversaId: bot.conversa.id, texto: "oi do provisório", inventario: PRONTO });
      const origemAntes = await contar(trx, q.escopo!);

      expect((await m.s.entrar(q, { email: dono.email, senha: SENHA })).resultado).toBe("escolher");
      const r = await m.s.importar(q);
      if (r.resultado !== "importado") throw new Error("não importou");
      expect(r.sessao.escopo).toEqual(dono.escopo);
      expect(r.trocaApp).toBeNull(); // navegador: sem código de troca do app
      expect(r.contagem.bots).toBe(1);
      expect(r.contagem.mensagens).toBeGreaterThan(0);

      const destinoDepois = await contar(trx, dono.escopo!);
      expect(destinoDepois.agentes).toBe(destinoAntes.agentes + 1);
      expect(destinoDepois.mensagens).toBe(destinoAntes.mensagens + origemAntes.mensagens);
      // A origem não perde nada.
      expect(await contar(trx, q.escopo!)).toEqual(origemAntes);
      // A sessão do provisório foi revogada; a nova é do destino.
      expect(await vivas(trx, q.escopo!)).toBe(0);
      // O turno que a mensagem abriu na origem parou (nada mais escreve no espaço levado).
      await vincularEscopo(trx, q.escopo!);
      expect(await trx`select 1 from turnos where tenant_id = ${q.escopo!.tenantId} and owner_id = ${q.escopo!.pessoaId} and estado in ('pendente', 'despachando')`).toHaveLength(0);
      // Repetir a mesma importação (outra sessão, mesma origem e destino) não duplica.
      const { importarEspaco } = await import("../../src/use-cases/importar-espaco.ts");
      expect(await importarEspaco(trx, q.escopo!, dono.escopo!)).toEqual(r.contagem);
      expect((await contar(trx, dono.escopo!)).agentes).toBe(destinoDepois.agentes);
    });
  });

  it("importar: bot excluído fica de fora com as conversas; artefatoId do payload e anexos vêm com ids do destino", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const q = await provisorio(m, "Provisório");
      const o = q.escopo!;
      await vincularEscopo(trx, o);
      const dp = depsSobreTrx(trx, o);
      const bot = (await executar(dp, criarAgente, { dono: "pessoa" })).data;
      await executar(dp, enviarMensagem, { conversaId: bot.conversa.id, texto: "com anexo e artefato", inventario: PRONTO });
      const excluido = (await executar(dp, criarAgente, { dono: "pessoa" })).data;
      await executar(dp, enviarMensagem, { conversaId: excluido.conversa.id, texto: "do bot que saiu", inventario: PRONTO });
      await vincularEscopo(trx, o);
      await trx`update agentes set excluido_em = now() where tenant_id = ${o.tenantId} and id = ${excluido.agente.id}`;
      const [art] = await trx<{ id: string }[]>`insert into artefatos (tenant_id, owner_id, agente_id, conversa_id, titulo)
        values (${o.tenantId}, ${o.pessoaId}, ${bot.agente.id}, ${bot.conversa.id}, 'Painel') returning id`;
      const [msg] = await trx<{ id: string }[]>`select id from mensagens where tenant_id = ${o.tenantId} and conversa_id = ${bot.conversa.id} and texto = 'com anexo e artefato'`;
      await trx`update mensagens set payload = ${trx.json({ artefatoId: art!.id })} where tenant_id = ${o.tenantId} and id = ${msg!.id}`;
      await trx`insert into anexos (tenant_id, owner_id, conversa_id, mensagem_id, nome, mime, tamanho, conteudo)
        values (${o.tenantId}, ${o.pessoaId}, ${bot.conversa.id}, ${msg!.id}, 'nota.txt', 'text/plain', 3, ${Buffer.from("abc")})`;
      // NOD-323: a mídia do bot aponta para o turno e a máquina da origem, que não vêm junto (sem soltar, o FK estoura).
      const [mac] = await trx<{ id: string }[]>`insert into maquinas (tenant_id, owner_id, nome) values (${o.tenantId}, ${o.pessoaId}, 'MacBook') returning id`;
      const [tu] = await trx<{ id: string }[]>`insert into turnos (tenant_id, owner_id, conversa_id, agente_id, origem, estado, prazo_em, entrada_texto, entrada_confianca, modelo)
        values (${o.tenantId}, ${o.pessoaId}, ${bot.conversa.id}, ${bot.agente.id}, 'conversa', 'concluido', now() + interval '1 day', 'p', 'confiavel', 'sonnet') returning id`;
      const [demo] = await trx<{ id: string }[]>`insert into anexos (tenant_id, owner_id, conversa_id, mensagem_id, nome, mime, tamanho, conteudo, origem, turno_id, machine_id, caminho_relativo, sha256, sem_bytes)
        values (${o.tenantId}, ${o.pessoaId}, ${bot.conversa.id}, ${msg!.id}, 'demo.mp4', 'video/mp4', 90000000, ${Buffer.alloc(0)}, 'bot', ${tu!.id}, ${mac!.id}, 'Bot/demo.mp4', ${"a".repeat(64)}, true) returning id`;
      // O link da J6 no texto aponta para o anexo: no destino, para o id novo (Codex no #507).
      await trx`update mensagens set texto = ${`com anexo e artefato [o vídeo](nod-anexo:${demo!.id.toUpperCase()}) e [outro](nod-anexo:00000000-0000-4000-8000-000000000000)`} where tenant_id = ${o.tenantId} and id = ${msg!.id}`;
      // Uma versão publicada fora do que vem junto (aqui, na conversa do bot excluído): o conteúdo vem, a referência solta.
      const [fora] = await trx<{ id: string }[]>`select id from mensagens where tenant_id = ${o.tenantId} and conversa_id = ${excluido.conversa.id} limit 1`;
      await trx`insert into artefato_versoes (tenant_id, owner_id, artefato_id, versao, html, mensagem_id) values (${o.tenantId}, ${o.pessoaId}, ${art!.id}, 1, '<p>v1</p>', ${msg!.id}), (${o.tenantId}, ${o.pessoaId}, ${art!.id}, 2, '<p>v2</p>', ${fora!.id})`;
      // Rotina ativa na origem: depois de levar, ela para lá (ninguém mais vê aquele espaço).
      await trx`insert into rotinas (tenant_id, owner_id, agente_id, conversa_id, cron, fuso_iana, instrucao, fonte, entregavel, limites_aprovacao, politica_sem_dado, proxima_execucao)
        values (${o.tenantId}, ${o.pessoaId}, ${bot.agente.id}, ${bot.conversa.id}, '0 8 * * *', 'America/Sao_Paulo', 'i', 'f', 'e', 'l', 'p', now())`;

      expect((await m.s.entrar(q, { email: dono.email, senha: SENHA })).resultado).toBe("escolher");
      const r = await m.s.importar(q);
      if (r.resultado !== "importado") throw new Error(`não importou: ${r.resultado}`);
      expect(r.contagem).toMatchObject({ bots: 1, artefatos: 1 });

      const d = dono.escopo!;
      await vincularEscopo(trx, d);
      const [copia] = await trx<{ id: string; texto: string; payload: { artefatoId: string } }[]>`select id, texto, payload from mensagens where tenant_id = ${d.tenantId} and texto like 'com anexo e artefato%'`;
      expect(copia!.payload.artefatoId).not.toBe(art!.id);
      expect((await trx`select 1 from artefatos where tenant_id = ${d.tenantId} and id = ${copia!.payload.artefatoId}`).length).toBe(1);
      const anexos = await trx<{ conteudo: Buffer; conversa_id: string }[]>`select conteudo, conversa_id from anexos where tenant_id = ${d.tenantId} and mensagem_id = ${copia!.id} and origem <> 'bot'`;
      expect(anexos.map((a) => a.conteudo.toString())).toEqual(["abc"]);
      const doBot = await trx<{ id: string }[]>`select id, nome, turno_id, machine_id, caminho_relativo, sem_bytes from anexos where tenant_id = ${d.tenantId} and mensagem_id = ${copia!.id} and origem = 'bot'`;
      expect(doBot).toEqual([{ id: expect.any(String), nome: "demo.mp4", turno_id: null, machine_id: null, caminho_relativo: null, sem_bytes: true }]);
      expect(copia!.texto).toBe(`com anexo e artefato [o vídeo](nod-anexo:${doBot[0]!.id}) e [outro](nod-anexo:00000000-0000-4000-8000-000000000000)`);
      expect(anexos[0]!.conversa_id).not.toBe(bot.conversa.id);
      expect((await trx`select 1 from mensagens where tenant_id = ${d.tenantId} and texto = 'do bot que saiu'`).length).toBe(0);
      const versoes = await trx<{ versao: number; mensagem_id: string | null }[]>`select versao, mensagem_id from artefato_versoes where tenant_id = ${d.tenantId} and artefato_id = ${copia!.payload.artefatoId} order by versao`;
      expect(versoes).toEqual([{ versao: 1, mensagem_id: copia!.id }, { versao: 2, mensagem_id: null }]);
      await vincularEscopo(trx, o);
      expect(await trx`select estado from rotinas where tenant_id = ${o.tenantId} and owner_id = ${o.pessoaId}`).toEqual([{ estado: "pausada" }]);
    });
  });

  it("importar: a resposta se perdeu (sessão de origem já revogada); o retry devolve a mesma contagem e uma sessão no destino", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const q = await provisorio(m, "Provisório");
      expect((await m.s.entrar(q, { email: dono.email, senha: SENHA })).resultado).toBe("escolher");
      const r = await m.s.importar(q);
      if (r.resultado !== "importado") throw new Error("não importou");
      // O cookie velho chega como revogado: sem sessão viva, com o sid antigo.
      const velho: Quem = { escopo: null, sid: null, ip: q.ip, aparelho: q.aparelho, revogada: { escopo: q.escopo!, sid: q.sid! } };
      const de = await m.s.importar(velho);
      if (de.resultado !== "importado") throw new Error("retry não importou");
      expect(de.contagem).toEqual(r.contagem);
      expect(de.sessao.escopo).toEqual(dono.escopo);
      expect(de.sessao.sid).not.toBe(r.sessao.sid);
      // Passada a janela, o sid revogado não vale mais nada.
      m.agora.t += 11 * 60_000;
      await expect(m.s.importar(velho)).rejects.toMatchObject({ codigo: "nao_permitido" });
      // Sid revogado sem importação feita (ex.: saiu) também não.
      const outro = await provisorio(m, "Outro");
      await expect(m.s.importar({ ...velho, revogada: { escopo: outro.escopo!, sid: outro.sid! } })).rejects.toMatchObject({ codigo: "nao_permitido" });
    });
  });

  it("entrar: se a senha mudou entre a conferência e a sessão (redefinição no meio), a senha velha não abre sessão", async () => {
    await withRollback(MARLON, async (trx) => {
      const base = mundo(trx);
      const dono = await comConta(base);
      const repo = { ...repoContas, senhaDaConta: (async (c: Tx, id: string, travar?: boolean) => (travar ? "$scrypt$outra" : repoContas.senhaDaConta(c, id))) as typeof repoContas.senhaDaConta };
      const m = mundo(trx, { repo });
      expect(await m.s.entrar({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { email: dono.email, senha: SENHA })).toEqual({ resultado: "recusado" });
    });
  });

  it("conta só com Google: /conta/senha não cria a primeira senha (só a prova do e-mail cria)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const q = await provisorio(m);
      await m.s.voltaGoogle(q, { iss: "https://accounts.google.com", sub: `sub-${randomBytes(4).toString("hex")}`, email: emailNovo(), autoridade: true });
      expect(await m.s.trocarSenha(q, { atual: "", nova: "outra senha boa de teste" })).toEqual({ resultado: "recusado", encerradas: 0 });
    });
  });

  it("#j3-4: a importação que falha no meio não muda nada dos dois lados e a escolha continua aberta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const destinoAntes = await contar(trx, dono.escopo!);
      const q = await provisorio(m);
      await vincularEscopo(trx, q.escopo!);
      const bot = (await executar(depsSobreTrx(trx, q.escopo!), criarAgente, { dono: "pessoa" })).data;
      expect(bot.agente.id).toBeTruthy();
      const origemAntes = await contar(trx, q.escopo!);
      expect((await m.s.entrar(q, { email: dono.email, senha: SENHA })).resultado).toBe("escolher");
      m.falhar.importacao = true;
      expect(await m.s.importar(q)).toEqual({ resultado: "falhou" });
      m.falhar.importacao = false;
      expect(await contar(trx, dono.escopo!)).toEqual(destinoAntes);
      expect(await contar(trx, q.escopo!)).toEqual(origemAntes);
      expect(await vivas(trx, q.escopo!)).toBe(1);
      expect((await m.s.estado(q)).escolha).toMatchObject({ email: dono.email });
      // "Tentar de novo" funciona.
      expect((await m.s.importar(q)).resultado).toBe("importado");
    });
  });

  it("#j3-3: cancelar mantém o provisório e a sessão dele; 'outra' também fecha a escolha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const q = await provisorio(m);
      expect((await m.s.entrar(q, { email: dono.email, senha: SENHA })).resultado).toBe("escolher");
      await m.s.fecharEscolha(q, "cancelada");
      expect((await m.s.estado(q)).escolha).toBeNull();
      expect(await vivas(trx, q.escopo!)).toBe(1);
      await expect(m.s.importar(q)).rejects.toBeInstanceOf(ErroDeDominio);
    });
  });

  it("#j4: entrar errado ou sem conta dá a mesma recusa; entrar sem sessão troca direto", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const anonimo: Quem = { escopo: null, sid: null, ip: ip(), aparelho: "Linux · Firefox" };
      expect(await m.s.entrar(anonimo, { email: dono.email, senha: "senha errada demais" })).toEqual({ resultado: "recusado" });
      expect(await m.s.entrar(anonimo, { email: emailNovo(), senha: SENHA })).toEqual({ resultado: "recusado" });
      const ok = await m.s.entrar(anonimo, { email: dono.email.toUpperCase(), senha: SENHA });
      expect(ok).toMatchObject({ resultado: "entrou", sessao: { escopo: dono.escopo } });
    });
  });

  it("limite: o 11º entrar do mesmo e-mail pelo mesmo IP é barrado mesmo com a senha certa; de outro IP a dona entra", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const atacante = ip();
      // 10/h por e-mail+IP; o teto por IP (entrar_ip) é maior, então quem barra aqui é o par e-mail+IP.
      for (let i = 0; i < 10; i++) await m.s.entrar({ escopo: null, sid: null, ip: atacante, aparelho: "x" }, { email: dono.email, senha: "errada errada" });
      await expect(m.s.entrar({ escopo: null, sid: null, ip: atacante, aparelho: "x" }, { email: dono.email, senha: SENHA })).rejects.toMatchObject({ codigo: "limite_atingido" });
      // O ataque de um IP não tranca a dona fora: de outro IP ela entra.
      expect((await m.s.entrar({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { email: dono.email, senha: SENHA })).resultado).toBe("entrou");
    });
  });

  it("#j4-4..6: recuperação com token único; expirado ou usado falha; troca encerra todas e abre uma nova", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const anonimo: Quem = { escopo: null, sid: null, ip: ip(), aparelho: "x" };
      const antes = m.caixa.mensagens.length;
      expect(await m.s.recuperar(anonimo, { email: emailNovo() })).toEqual({ ok: true });
      expect(m.caixa.mensagens.length).toBe(antes);
      expect(await m.s.recuperar(anonimo, { email: dono.email })).toEqual({ ok: true });
      const primeiro = tokenDoEmail(m);
      expect(await m.s.recuperar(anonimo, { email: dono.email })).toEqual({ ok: true });
      const token = tokenDoEmail(m);
      // Pedir outro invalida o anterior.
      expect(await m.s.redefinir(anonimo, { token: primeiro, senha: "senha nova e boa" })).toEqual({ resultado: "invalido" });
      const r = await m.s.redefinir(anonimo, { token, senha: "senha nova e boa" });
      expect(r).toMatchObject({ resultado: "trocada", sessao: { escopo: dono.escopo } });
      expect(await m.s.redefinir(anonimo, { token, senha: "outra nova e boa" })).toEqual({ resultado: "invalido" });
      // Só a sessão nova está viva.
      expect(await vivas(trx, dono.escopo!)).toBe(1);
      expect((await m.s.entrar(anonimo, { email: dono.email, senha: "senha nova e boa" })).resultado).toBe("entrou");

      // Vencido: 31 min depois.
      await m.s.recuperar(anonimo, { email: dono.email });
      const velho = tokenDoEmail(m);
      await trx`update codigos_conta set expira_em = now() - interval '1 minute' where finalidade = 'recuperacao' and usado_em is null`;
      expect(await m.s.redefinir(anonimo, { token: velho, senha: "mais uma boa senha" })).toEqual({ resultado: "invalido" });
    });
  });

  it("#j5: trocar a senha encerra as outras sessões e mantém a atual", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const anonimo: Quem = { escopo: null, sid: null, ip: ip(), aparelho: "x" };
      const outra = await m.s.entrar(anonimo, { email: dono.email, senha: SENHA });
      if (outra.resultado !== "entrou") throw new Error("não entrou");
      const atual: Quem = { escopo: dono.escopo, sid: outra.sessao.sid, ip: ip(), aparelho: "x" };
      expect(await m.s.trocarSenha(atual, { atual: "errada errada", nova: "nova senha boa" })).toEqual({ resultado: "recusado", encerradas: 0 });
      const r = await m.s.trocarSenha(atual, { atual: SENHA, nova: "nova senha boa" });
      expect(r.resultado).toBe("trocada");
      expect(r.encerradas).toBeGreaterThanOrEqual(1);
      const lista = await m.s.sessoes(atual);
      expect(lista.sessoes.filter((x) => x.revogadaEm === null).map((x) => x.id)).toEqual([outra.sessao.sid]);
    });
  });

  it("pareamento: código sorteado que colide com outro vivo (23505) é sorteado de novo", async () => {
    await withRollback(MARLON, async (trx) => {
      let colisoes = 1;
      const repo = { ...repoContas, abrirPareamento: (async (...a: Parameters<typeof repoContas.abrirPareamento>) => {
        if (colisoes-- > 0) throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
        return repoContas.abrirPareamento(...a);
      }) as typeof repoContas.abrirPareamento };
      const m = mundo(trx, { repo });
      const dono = await comConta(m);
      expect((await m.s.gerarPareamento(dono)).codigo).toMatch(/^\d{6}$/);
      expect(colisoes).toBe(-1);
    });
  });

  it("#j5-4..8: pareamento de uso único; gerar outro invalida o anterior; troca do app de uso único", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const novo = { ...(await provisorio(m, "Computador novo")), desafioApp: APP.desafio };
      const primeiro = await m.s.gerarPareamento(dono);
      const { codigo } = await m.s.gerarPareamento(dono);
      expect(await m.s.pedirPareamento(novo, { codigo: primeiro.codigo })).toEqual({ resultado: "invalido" });
      const pedido = await m.s.pedirPareamento(novo, { codigo });
      if (pedido.resultado !== "pedido") throw new Error("sem pedido");
      expect(await m.s.pareamentoAberto(dono)).toMatchObject({ estado: "pedido", simbolos: pedido.simbolos });
      expect(await m.s.esperarPareamento(novo)).toEqual({ estado: "esperando" });
      await m.s.decidirPareamento(dono, { confirmar: true });
      // O computador novo é um espaço provisório: entra pela mesma escolha do "entrar" (ADR-124 §3), sem descartar nada.
      expect(await m.s.esperarPareamento(novo)).toEqual({ estado: "escolher", email: dono.email });
      expect((await m.s.esperarPareamento(novo)).estado).toBe("vencido");
      const e = await m.s.importar(novo);
      if (e.resultado !== "importado") throw new Error("não entrou");
      expect(e.sessao.escopo).toEqual(dono.escopo);
      // O mesmo código não serve de novo.
      const outro = await provisorio(m, "Intruso");
      expect(await m.s.pedirPareamento(outro, { codigo })).toEqual({ resultado: "invalido" });
      // A troca do app vale uma vez, com a prova do processo principal, e dá a chave da pessoa nova.
      const chave = await m.s.trocarApp({ escopo: null, sid: null, ip: ip(), aparelho: "app" }, { codigo: e.trocaApp, prova: APP.prova });
      expect(chave?.chave).toMatch(/^nodm_/);
      expect(m.chaves.at(-1)).toEqual(dono.escopo);
      expect(await m.s.trocarApp({ escopo: null, sid: null, ip: ip(), aparelho: "app" }, { codigo: e.trocaApp, prova: APP.prova })).toBeNull();
    });
  });

  it("pareamento vencido não se confirma nem se usa depois do prazo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const novo = await provisorio(m, "Computador novo");
      const { codigo } = await m.s.gerarPareamento(dono);
      if ((await m.s.pedirPareamento(novo, { codigo })).resultado !== "pedido") throw new Error("sem pedido");
      await trx`update pareamentos_conta set expira_em = clock_timestamp() - interval '1 second' where tenant_id = ${dono.escopo!.tenantId} and pessoa_id = ${dono.escopo!.pessoaId}`;
      await expect(m.s.decidirPareamento(dono, { confirmar: true })).rejects.toMatchObject({ codigo: "estado_invalido" });
      // Confirmado ainda no prazo, mas usado depois dele: não entra.
      const outro = await provisorio(m, "Outro");
      const g = await m.s.gerarPareamento(dono);
      if ((await m.s.pedirPareamento(outro, { codigo: g.codigo })).resultado !== "pedido") throw new Error("sem pedido");
      await m.s.decidirPareamento(dono, { confirmar: true });
      await trx`update pareamentos_conta set expira_em = clock_timestamp() - interval '1 second' where tenant_id = ${dono.escopo!.tenantId} and pessoa_id = ${dono.escopo!.pessoaId} and estado = 'confirmado'`;
      expect(await m.s.esperarPareamento(outro)).toEqual({ estado: "vencido" });
    });
  });

  it("troca do app não vale se a sessão que a gerou já foi encerrada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const novo = { ...(await provisorio(m, "Computador novo")), desafioApp: APP.desafio };
      const { codigo } = await m.s.gerarPareamento(dono);
      if ((await m.s.pedirPareamento(novo, { codigo })).resultado !== "pedido") throw new Error("sem pedido");
      await m.s.decidirPareamento(dono, { confirmar: true });
      expect((await m.s.esperarPareamento(novo)).estado).toBe("escolher");
      const e = await m.s.importar(novo);
      if (e.resultado !== "importado" || !e.trocaApp) throw new Error("não entrou");
      // A dona encerra as outras sessões antes de o app trocar o código: a troca morre junto.
      await repoContas.revogarOutrasSessoes(trx, dono.escopo!, dono.sid);
      expect(await m.s.trocarApp({ escopo: null, sid: null, ip: ip(), aparelho: "app" }, { codigo: e.trocaApp, prova: APP.prova })).toBeNull();
    });
  });

  it("escolha aberta com a senha antiga morre quando a dona redefine ou troca a senha (e o retry da importação também)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const anonimo: Quem = { escopo: null, sid: null, ip: ip(), aparelho: "x" };
      // Quem tem a senha vazada abre a escolha a partir de um provisório; a dona redefine pelo link.
      const atacante = await provisorio(m, "Atacante");
      expect((await m.s.entrar(atacante, { email: dono.email, senha: SENHA })).resultado).toBe("escolher");
      await m.s.recuperar(anonimo, { email: dono.email });
      const r = await m.s.redefinir(anonimo, { token: tokenDoEmail(m), senha: "senha nova e boa" });
      if (r.resultado !== "trocada") throw new Error("não trocou");
      await expect(m.s.importar(atacante)).rejects.toMatchObject({ codigo: "estado_invalido" });
      // Pela troca de senha (estando dentro), idem; e a importação já feita não repete a resposta depois disso.
      const atual: Quem = { escopo: dono.escopo, sid: r.sessao.sid, ip: ip(), aparelho: "x" };
      const outro = await provisorio(m, "Outro");
      expect((await m.s.entrar(outro, { email: dono.email, senha: "senha nova e boa" })).resultado).toBe("escolher");
      const feito = await provisorio(m, "Já levado");
      expect((await m.s.entrar(feito, { email: dono.email, senha: "senha nova e boa" })).resultado).toBe("escolher");
      expect((await m.s.importar(feito)).resultado).toBe("importado");
      expect((await m.s.trocarSenha(atual, { atual: "senha nova e boa", nova: "mais uma senha boa" })).resultado).toBe("trocada");
      await expect(m.s.importar(outro)).rejects.toMatchObject({ codigo: "estado_invalido" });
      await expect(m.s.importar({ escopo: null, sid: null, ip: feito.ip, aparelho: feito.aparelho, revogada: { escopo: feito.escopo!, sid: feito.sid! } })).rejects.toMatchObject({ codigo: "nao_permitido" });
    });
  });

  it("A1: palpites de código somam por e-mail entre sessões; passou do teto, nem o certo prova a posse", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      // A conta da dona gastou 1 palpite (o certo, ao criá-la). O atacante, em duas sessões, gasta mais 5 + 4 errados.
      for (const [nome, n] of [["A", 5], ["B", 4]] as const) {
        const q = await provisorio(m, nome);
        await m.s.cadastrar(q, { email: dono.email, senha: SENHA });
        const certo = codigoDoEmail(m);
        const errado = certo === "000000" ? "111111" : "000000";
        for (let i = 0; i < n; i++) expect((await m.s.verificar(q, { codigo: errado })).resultado).not.toBe("escolher");
      }
      // A terceira sessão recebe o código certo, mas o e-mail já gastou os palpites do dia.
      const c = await provisorio(m, "C");
      await m.s.cadastrar(c, { email: dono.email, senha: SENHA });
      await expect(m.s.verificar(c, { codigo: codigoDoEmail(m) })).rejects.toMatchObject({ codigo: "limite_atingido" });
      expect((await m.s.estado(c)).escolha).toBeNull();
      // Outro e-mail não é afetado.
      const d = await provisorio(m, "D");
      const outro = emailNovo();
      await m.s.cadastrar(d, { email: outro, senha: SENHA });
      expect(await m.s.verificar(d, { codigo: codigoDoEmail(m) })).toEqual({ resultado: "convertida", email: outro });
    });
  });

  it("A2: redefinir a senha ou parear a partir de um provisório abre a escolha (não descarta o provisório)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const prov = await provisorio(m, "Com trabalho");
      await m.s.recuperar(prov, { email: dono.email });
      const r = await m.s.redefinir(prov, { token: tokenDoEmail(m), senha: "senha nova e boa" });
      expect(r).toEqual({ resultado: "escolher", email: dono.email });
      // A senha mudou de verdade, e o provisório segue vivo, com a escolha aberta.
      expect((await m.s.entrar({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { email: dono.email, senha: "senha nova e boa" })).resultado).toBe("entrou");
      expect((await m.s.estado(prov)).escolha?.email).toBe(dono.email);
      expect((await m.s.fecharEscolha(prov, "cancelada"))).toEqual({ ok: true });
      expect(await vivas(trx, prov.escopo!)).toBe(1);
      // A própria conta (não provisório) redefine e troca direto.
      const atual = (await m.s.entrar({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { email: dono.email, senha: "senha nova e boa" }));
      if (atual.resultado !== "entrou") throw new Error("não entrou");
      await m.s.recuperar(prov, { email: dono.email });
      expect((await m.s.redefinir({ escopo: dono.escopo, sid: atual.sessao.sid, ip: ip(), aparelho: "x" }, { token: tokenDoEmail(m), senha: "outra senha boa" })).resultado).toBe("trocada");
    });
  });

  it("pareamento: código vencido antes do pedido não vale", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const novo = await provisorio(m, "Computador novo");
      const { codigo } = await m.s.gerarPareamento(dono);
      await trx`update pareamentos_conta set expira_em = clock_timestamp() - interval '1 second' where tenant_id = ${dono.escopo!.tenantId} and pessoa_id = ${dono.escopo!.pessoaId}`;
      expect(await m.s.pedirPareamento(novo, { codigo })).toEqual({ resultado: "invalido" });
    });
  });

  it("trocar a senha derruba o pareamento já confirmado e ainda não usado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const novo = await provisorio(m, "Computador novo");
      const { codigo } = await m.s.gerarPareamento(dono);
      if ((await m.s.pedirPareamento(novo, { codigo })).resultado !== "pedido") throw new Error("sem pedido");
      await m.s.decidirPareamento(dono, { confirmar: true });
      expect((await m.s.trocarSenha(dono, { atual: SENHA, nova: "nova senha boa de teste" })).resultado).toBe("trocada");
      expect((await m.s.esperarPareamento(novo)).estado).not.toBe("entrou");
    });
  });

  it("sair das outras sessões derruba o pareamento já confirmado e ainda não usado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const novo = await provisorio(m, "Computador novo");
      const { codigo } = await m.s.gerarPareamento(dono);
      if ((await m.s.pedirPareamento(novo, { codigo })).resultado !== "pedido") throw new Error("sem pedido");
      await m.s.decidirPareamento(dono, { confirmar: true });
      await repoContas.revogarOutrasSessoes(trx, dono.escopo!, dono.sid);
      expect((await m.s.esperarPareamento(novo)).estado).not.toBe("entrou");
    });
  });

  it("corrida do bootstrap: quem perde volta ao espaço de quem ganhou, sem 409 e sem espaço a mais", async () => {
    await withRollback(MARLON, async (trx) => {
      const v = verificador();
      const anon: Quem = { escopo: null, sid: null, ip: ip(), aparelho: "macOS · Chrome" };
      const a = await mundo(trx).s.provisorio(anon, { verificador: v, nome: "Ana", forma: "web" });
      // A segunda chamada leu "nenhuma instalação" antes de a primeira gravar (a corrida), e só depois tenta registrar.
      let leituras = 0;
      const atrasado = { ...repoContas, instalacaoPorVerificador: async (c: Parameters<typeof repoContas.instalacaoPorVerificador>[0], h: Buffer) => (leituras++ === 0 ? null : repoContas.instalacaoPorVerificador(c, h)) };
      const [t0] = await trx<{ n: number }[]>`select count(*)::int as n from tenants`;
      const b = await mundo(trx, { repo: atrasado }).s.provisorio(anon, { verificador: v, nome: "Ana", forma: "app" });
      expect(b.escopo).toEqual(a.escopo);
      expect(b.novo).toBe(false);
      expect(b.chave).toBeTruthy();
      const [t1] = await trx<{ n: number }[]>`select count(*)::int as n from tenants`;
      expect(t1?.n).toBe(t0?.n);
    });
  });

  it("troca do app só sai para o app: o navegador (sem desafio) não recebe código; sem a prova certa o código morre", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      // Navegador: entra, mas sem código de troca no JSON.
      const web = await provisorio(m, "Navegador");
      const { codigo } = await m.s.gerarPareamento(dono);
      if ((await m.s.pedirPareamento(web, { codigo })).resultado !== "pedido") throw new Error("sem pedido");
      await m.s.decidirPareamento(dono, { confirmar: true });
      expect((await m.s.esperarPareamento(web)).estado).toBe("escolher");
      const w = await m.s.importar(web);
      if (w.resultado !== "importado") throw new Error("não entrou");
      expect(w.trocaApp).toBeNull();
      // App: recebe o código, mas quem só o leu (sem a prova do processo principal) não o troca, e ele não serve mais.
      const app = { ...(await provisorio(m, "App")), desafioApp: APP.desafio };
      const g = await m.s.gerarPareamento(dono);
      if ((await m.s.pedirPareamento(app, { codigo: g.codigo })).resultado !== "pedido") throw new Error("sem pedido");
      await m.s.decidirPareamento(dono, { confirmar: true });
      expect((await m.s.esperarPareamento(app)).estado).toBe("escolher");
      const a = await m.s.importar(app);
      if (a.resultado !== "importado" || !a.trocaApp) throw new Error("não entrou");
      const anon: Quem = { escopo: null, sid: null, ip: ip(), aparelho: "curl" };
      expect(await m.s.trocarApp(anon, { codigo: a.trocaApp, prova: segredoDeTroca().prova })).toBeNull();
      expect(await m.s.trocarApp(anon, { codigo: a.trocaApp, prova: APP.prova })).toBeNull();
      expect(await m.s.trocarApp(anon, { codigo: a.trocaApp, prova: undefined })).toBeNull();
    });
  });

  it("pessoa de antes das contas (e-mail sem conta) não é tomada por cadastro: provar o e-mail não leva à escolha", async () => {
    await withRollback(MARLON, async (trx) => {
      const email = emailNovo();
      // O app não escreve em `pessoas`: a pessoa legada com este e-mail vem do repositório trocado aqui.
      const repo = { ...repoContas, existePessoaLegada: (async (c: Tx, e: string) => (e === email ? true : repoContas.existePessoaLegada(c, e))) as typeof repoContas.existePessoaLegada };
      const m = mundo(trx, { repo });
      const q = await provisorio(m, "Visitante");
      expect(await m.s.cadastrar(q, { email, senha: SENHA })).toEqual({ enviado: true, email });
      const codigo = codigoDoEmail(m);
      // A resposta orienta (entra pelo Google) sem criar conta nem abrir a escolha; o código fica gasto.
      expect(await m.s.verificar(q, { codigo })).toEqual({ resultado: "pelo_google", email });
      expect((await m.s.estado(q)).escolha ?? null).toBeNull();
      expect((await m.s.estado(q)).conta).toBeNull();
      expect(await repoContas.contaPorEmail(trx, email)).toBeNull();
      expect(await m.s.verificar(q, { codigo })).toEqual({ resultado: "vencido" });
    });
  });

  it("Google: conta nova converte; e-mail de conta existente sem autoridade é recusado; com autoridade abre a escolha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const q = await provisorio(m);
      const g = { iss: "https://accounts.google.com", sub: `sub-${randomBytes(4).toString("hex")}`, email: emailNovo(), autoridade: true };
      expect(await m.s.voltaGoogle(q, g)).toEqual({ resultado: "convertida" });
      // A mesma identidade, sem sessão: entra na pessoa convertida.
      const de = await m.s.voltaGoogle({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, g);
      expect(de).toMatchObject({ resultado: "entrou", sessao: { escopo: q.escopo } });

      const dono = await comConta(m);
      const outro = await provisorio(m, "Outro");
      expect(await m.s.voltaGoogle(outro, { iss: g.iss, sub: "sub-x", email: dono.email, autoridade: false })).toEqual({ resultado: "recusado" });
      expect(await m.s.voltaGoogle(outro, { iss: g.iss, sub: "sub-y", email: dono.email, autoridade: true })).toEqual({ resultado: "escolher" });
    });
  });

  it("limite: o mesmo verificador não abre sessões sem fim (o 31º pedido na hora é barrado)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const v = verificador();
      for (let i = 0; i < 30; i++) await m.s.provisorio({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { verificador: v, forma: "web" });
      await expect(m.s.provisorio({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { verificador: v, forma: "web" })).rejects.toMatchObject({ codigo: "limite_atingido" });
    });
  });

  it("importar traz tudo privado: bot de empresa do provisório não abre para a equipe do destino", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const q = await provisorio(m, "Provisório");
      await vincularEscopo(trx, q.escopo!);
      const bot = (await executar(depsSobreTrx(trx, q.escopo!), criarAgente, { dono: "empresa" })).data;
      const [antes] = await trx<{ visibility: string }[]>`select visibility from agentes where tenant_id = ${q.escopo!.tenantId} and id = ${bot.agente.id}`;
      expect(antes?.visibility).toBe("equipe");
      expect((await m.s.entrar(q, { email: dono.email, senha: SENHA })).resultado).toBe("escolher");
      expect((await m.s.importar(q)).resultado).toBe("importado");
      await vincularEscopo(trx, dono.escopo!);
      const levados = await trx<{ visibility: string; dono: string }[]>`select visibility, dono from agentes where tenant_id = ${dono.escopo!.tenantId} and owner_id = ${dono.escopo!.pessoaId} and nome = ${bot.agente.nome} and papel is distinct from 'nod'`;
      expect(levados.length).toBeGreaterThan(0);
      for (const l of levados) expect(l).toEqual({ visibility: "privado", dono: "pessoa" });
    });
  });

  it("importar aposenta a instalação de origem: o mesmo verificador não volta ao espaço levado nem ganha um vazio", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const v = verificador();
      const anon: Quem = { escopo: null, sid: null, ip: ip(), aparelho: "macOS · Chrome" };
      const a = await m.s.provisorio(anon, { verificador: v, nome: "Ana", forma: "web" });
      const q: Quem = { escopo: a.escopo, sid: a.sessao!.sid, ip: ip(), aparelho: "macOS · Chrome" };
      expect((await m.s.provisorio(anon, { verificador: v, forma: "web" })).escopo).toEqual(a.escopo);
      expect((await m.s.entrar(q, { email: dono.email, senha: SENHA })).resultado).toBe("escolher");
      // Uma chave de máquina do espaço (o app pede uma por abertura) e uma sessão de outra aba, de antes.
      await vincularEscopo(trx, a.escopo);
      await trx`insert into maquina_tokens (tenant_id, owner_id, nome, prefixo, hash) values (${a.escopo.tenantId}, ${a.escopo.pessoaId}, 'Mac', 'abcdefgh', ${randomBytes(32)})`;
      const outraAba = await m.s.provisorio(anon, { verificador: v, forma: "web" });
      expect((await m.s.importar(q)).resultado).toBe("importado");
      // ADR-124 §3: o espaço levado fica sem acesso. Nenhuma chave nem sessão dele continua viva.
      await vincularEscopo(trx, a.escopo);
      expect(await trx`select 1 from maquina_tokens where tenant_id = ${a.escopo.tenantId} and owner_id = ${a.escopo.pessoaId} and revogado_em is null`).toHaveLength(0);
      expect(await repoContas.sessaoViva(trx, outraAba.sessao!.sid, a.escopo)).toBeNull();
      expect(await vivas(trx, a.escopo)).toBe(0);
      // O trabalho foi para a conta: sem sessão, a instalação volta à tela de entrar (nem o espaço levado, nem um vazio).
      await expect(m.s.provisorio(anon, { verificador: v, forma: "web" })).rejects.toMatchObject({ codigo: "estado_invalido" });
    });
  });

  it("R8: o mesmo provisório não é levado duas vezes (outra aba escolheu outra conta antes da primeira importar)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const a = await comConta(m);
      const b = await comConta(m);
      const v = verificador();
      const anon: Quem = { escopo: null, sid: null, ip: ip(), aparelho: "macOS · Chrome" };
      const p1 = await m.s.provisorio(anon, { verificador: v, forma: "web" });
      const p2 = await m.s.provisorio(anon, { verificador: v, forma: "web" });
      const aba1: Quem = { escopo: p1.escopo, sid: p1.sessao!.sid, ip: ip(), aparelho: "x" };
      const aba2: Quem = { escopo: p2.escopo, sid: p2.sessao!.sid, ip: ip(), aparelho: "x" };
      expect((await m.s.entrar(aba1, { email: a.email, senha: SENHA })).resultado).toBe("escolher");
      expect((await m.s.entrar(aba2, { email: b.email, senha: SENHA })).resultado).toBe("escolher");
      expect((await m.s.importar(aba1)).resultado).toBe("importado");
      await expect(m.s.importar(aba2)).rejects.toMatchObject({ codigo: "estado_invalido" });
      expect(await repoContas.ehProvisorio(trx, p1.escopo)).toBe(false);
    });
  });

  it("R9: converter (código ou Google) trava a instalação viva antes de conferir o provisório, como a importação", async () => {
    await withRollback(MARLON, async (trx) => {
      const ordem: string[] = [];
      const repo = { ...repoContas,
        travarInstalacaoViva: async (c: Parameters<typeof repoContas.travarInstalacaoViva>[0], e: Escopo) => { ordem.push("trava"); return repoContas.travarInstalacaoViva(c, e); },
        ehProvisorio: async (c: Parameters<typeof repoContas.ehProvisorio>[0], e: Escopo) => { ordem.push("confere"); return repoContas.ehProvisorio(c, e); },
      };
      const m = mundo(trx, { repo });
      const q = await provisorio(m);
      await m.s.cadastrar(q, { email: emailNovo(), senha: SENHA });
      ordem.length = 0;
      expect((await m.s.verificar(q, { codigo: codigoDoEmail(m) })).resultado).toBe("convertida");
      expect(ordem.slice(0, 2)).toEqual(["trava", "confere"]);
      const g = await provisorio(m);
      ordem.length = 0;
      expect(await m.s.voltaGoogle(g, { iss: "https://accounts.google.com", sub: `sub-${randomBytes(4).toString("hex")}`, email: emailNovo(), autoridade: true })).toEqual({ resultado: "convertida" });
      expect(ordem.slice(0, 2)).toEqual(["trava", "confere"]);
      // Espaço já levado (instalação aposentada): a trava não acha linha viva e a conversão recusa.
      const h = await provisorio(m);
      await m.s.cadastrar(h, { email: emailNovo(), senha: SENHA });
      await repoContas.aposentarInstalacao(trx, h.escopo!);
      await expect(m.s.verificar(h, { codigo: codigoDoEmail(m) })).rejects.toMatchObject({ codigo: "estado_invalido" });
    });
  });

  it("R8: o app que pede o provisório de novo (perdeu a chave) não deixa a chave anterior viva", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const v = verificador();
      const anon: Quem = { escopo: null, sid: null, ip: ip(), aparelho: "macOS · App" };
      const p = await m.s.provisorio(anon, { verificador: v, forma: "app" });
      await vincularEscopo(trx, p.escopo);
      await trx`insert into maquina_tokens (tenant_id, owner_id, nome, prefixo, hash) values (${p.escopo.tenantId}, ${p.escopo.pessoaId}, 'Mac', 'abcdefgh', ${randomBytes(32)})`;
      expect((await m.s.provisorio(anon, { verificador: v, forma: "app" })).escopo).toEqual(p.escopo);
      await vincularEscopo(trx, p.escopo);
      expect(await trx`select 1 from maquina_tokens where tenant_id = ${p.escopo.tenantId} and owner_id = ${p.escopo.pessoaId} and revogado_em is null`).toHaveLength(0);
    });
  });

  it("R8: trocar a senha tem teto de palpites da senha atual por conta, somando IPs", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const de = (): Quem => ({ ...dono, ip: ip() });
      for (let i = 0; i < 10; i++) expect((await m.s.trocarSenha(de(), { atual: "errada errada", nova: "nova senha boa" })).resultado).toBe("recusado");
      await expect(m.s.trocarSenha(de(), { atual: SENHA, nova: "nova senha boa" })).rejects.toMatchObject({ codigo: "limite_atingido" });
    });
  });

  it("R11: trocar a senha fecha as portas antes de travar a senha (ordem única de travas)", async () => {
    await withRollback(MARLON, async (trx) => {
      const ordem: string[] = [];
      const repo = { ...repoContas,
        revogarOutrasSessoes: async (c: Parameters<typeof repoContas.revogarOutrasSessoes>[0], e: Escopo, manter: string | null) => { ordem.push("portas"); return repoContas.revogarOutrasSessoes(c, e, manter); },
        senhaDaConta: async (c: Parameters<typeof repoContas.senhaDaConta>[0], id: string, travar = false) => { if (travar) ordem.push("senha"); return repoContas.senhaDaConta(c, id, travar); },
      };
      const m = mundo(trx, { repo });
      const dono = await comConta(m);
      expect((await m.s.trocarSenha(dono, { atual: SENHA, nova: "nova senha boa" })).resultado).toBe("trocada");
      expect(ordem).toEqual(["portas", "senha"]);
    });
  });

  it("R11: a senha que mudou no meio da troca recusa e não fecha nada (a transação volta inteira)", async () => {
    await withRollback(MARLON, async (trx) => {
      let mudou = false;
      const repo = { ...repoContas,
        senhaDaConta: async (c: Parameters<typeof repoContas.senhaDaConta>[0], id: string, travar = false) => (travar && mudou ? "outro-hash" : repoContas.senhaDaConta(c, id, travar)),
      };
      const m = mundo(trx, { repo });
      const dono = await comConta(m);
      const outra = await m.s.entrar({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { email: dono.email, senha: SENHA });
      if (outra.resultado !== "entrou") throw new Error("não entrou");
      mudou = true;
      expect(await m.s.trocarSenha(dono, { atual: SENHA, nova: "nova senha boa" })).toEqual({ resultado: "recusado", encerradas: 0 });
      const vivas = (await m.s.sessoes(dono)).sessoes.filter((x) => x.revogadaEm === null).map((x) => x.id);
      expect(vivas).toContain(outra.sessao.sid);
      mudou = false;
      // A senha não mudou: a nova não vale e a atual continua abrindo sessão.
      expect((await m.s.entrar({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { email: dono.email, senha: SENHA })).resultado).toBe("entrou");
    });
  });

  it("R11: entrar trava as escolhas da sessão antes da senha; cancelar/outra gasta o código antes da escolha", async () => {
    await withRollback(MARLON, async (trx) => {
      const ordem: string[] = [];
      const repo = { ...repoContas,
        travarEntradasDaSessao: async (c: Parameters<typeof repoContas.travarEntradasDaSessao>[0], sid: string) => { ordem.push("entradas"); return repoContas.travarEntradasDaSessao(c, sid); },
        senhaDaConta: async (c: Parameters<typeof repoContas.senhaDaConta>[0], id: string, travar = false) => { if (travar) ordem.push("senha"); return repoContas.senhaDaConta(c, id, travar); },
        invalidarCodigos: async (c: Parameters<typeof repoContas.invalidarCodigos>[0], f: Parameters<typeof repoContas.invalidarCodigos>[1], k: string) => { ordem.push("codigo"); return repoContas.invalidarCodigos(c, f, k); },
        entradaDaSessao: async (c: Parameters<typeof repoContas.entradaDaSessao>[0], sid: string, travar = false) => { if (travar) ordem.push("entrada"); return repoContas.entradaDaSessao(c, sid, travar); },
      };
      const m = mundo(trx, { repo });
      const dono = await comConta(m);
      const q = await provisorio(m);
      ordem.length = 0;
      expect((await m.s.entrar(q, { email: dono.email, senha: SENHA })).resultado).toBe("escolher");
      expect(ordem).toEqual(["entradas", "senha"]);
      ordem.length = 0;
      await m.s.fecharEscolha(q, "outra");
      expect(ordem).toEqual(["codigo", "entrada"]);
      expect((await m.s.estado(q)).escolha ?? null).toBeNull();
    });
  });

  it("Google sem autoridade sobre o e-mail (domínio próprio fora do Workspace) não cria conta com esse e-mail", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const q = await provisorio(m);
      const email = emailNovo();
      expect(await m.s.voltaGoogle(q, { iss: "https://accounts.google.com", sub: "sub-sem-autoridade", email, autoridade: false })).toEqual({ resultado: "recusado" });
      expect(await repoContas.contaPorEmail(trx, email)).toBeNull();
      expect((await m.s.estado(q)).conta).toBeNull();
    });
  });
  // ------------------------------------------------------------------- ADA-242 (ADR-157): conta sem senha e Google no app
  it("ADA-242: código por e-mail sem senha cria a conta com a identidade `email` (sem senha, sem Google)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const q = await provisorio(m);
      const email = emailNovo();
      expect(await m.s.pedirCodigo(q, { email })).toEqual({ enviado: true, email });
      expect((await m.s.estado(q)).verificando).toEqual({ email });
      // Reenviar segue sem senha.
      await m.s.reenviar(q);
      expect(await m.s.verificar(q, { codigo: codigoDoEmail(m) })).toEqual({ resultado: "convertida", email });
      expect((await m.s.estado(q)).conta).toEqual({ email, senha: false, google: false });
      const conta = await repoContas.contaPorEmail(trx, email);
      const ids = await trx<{ tipo: string; senha_hash: string | null }[]>`select tipo, senha_hash from identidades_conta where conta_id = ${conta!.id}`;
      expect(ids).toEqual([{ tipo: "email", senha_hash: null }]);
    });
  });

  it("ADA-242: código sem senha para e-mail com conta abre a escolha e não cria identidade nova; e-mail inválido é recusado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const conta = await repoContas.contaPorEmail(trx, dono.email);
      const antes = await trx<{ tipo: string }[]>`select tipo from identidades_conta where conta_id = ${conta!.id} order by tipo`;
      const q = await provisorio(m, "Visitante");
      expect(await m.s.pedirCodigo(q, { email: dono.email })).toEqual({ enviado: true, email: dono.email });
      expect(await m.s.verificar(q, { codigo: codigoDoEmail(m) })).toEqual({ resultado: "escolher", email: dono.email });
      expect(await trx<{ tipo: string }[]>`select tipo from identidades_conta where conta_id = ${conta!.id} order by tipo`).toEqual(antes);
      await expect(m.s.pedirCodigo(q, { email: "nao-e-email" })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      // Já convertido: não pede código de novo.
      await expect(m.s.pedirCodigo(dono, { email: emailNovo() })).rejects.toMatchObject({ codigo: "estado_invalido" });
    });
  });

  it("ADA-242: código sem senha respeita os limites do cadastro (o 6º pedido do mesmo e-mail é barrado e não manda e-mail)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const q = await provisorio(m);
      const email = emailNovo();
      for (let i = 0; i < 5; i++) await m.s.pedirCodigo(q, { email });
      const enviados = m.caixa.mensagens.length;
      await expect(m.s.pedirCodigo(q, { email })).rejects.toMatchObject({ codigo: "limite_atingido" });
      expect(m.caixa.mensagens).toHaveLength(enviados);
    });
  });

  it("ADA-242: pessoa de antes das contas continua indo para o Google pelo código sem senha", async () => {
    await withRollback(MARLON, async (trx) => {
      const email = emailNovo();
      const repo = { ...repoContas, existePessoaLegada: (async (c: Tx, e: string) => (e === email ? true : repoContas.existePessoaLegada(c, e))) as typeof repoContas.existePessoaLegada };
      const m = mundo(trx, { repo });
      const q = await provisorio(m, "Visitante");
      await m.s.pedirCodigo(q, { email });
      expect(await m.s.verificar(q, { codigo: codigoDoEmail(m) })).toEqual({ resultado: "pelo_google", email });
      expect(await repoContas.contaPorEmail(trx, email)).toBeNull();
    });
  });

  it("ADA-242: Google no app só liga a conta quando o processo principal prova; sem a prova o código morre", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const q = await provisorio(m);
      const g = { iss: "https://accounts.google.com", sub: `sub-${randomBytes(4).toString("hex")}`, email: emailNovo(), autoridade: true };
      const anon: Quem = { escopo: null, sid: null, ip: ip(), aparelho: "Windows · nod" };
      // Guardar não liga nada.
      const roubado = await m.s.guardarGoogleApp({ escopo: q.escopo!, sid: q.sid!, desafio: APP.desafio }, g);
      expect((await m.s.estado(q)).conta).toBeNull();
      // Quem só leu o código (sem a prova certa) não troca, e o código não serve mais nem com a prova.
      expect(await m.s.trocarGoogleApp(anon, { codigo: roubado, prova: segredoDeTroca().prova })).toBeNull();
      expect(await m.s.trocarGoogleApp(anon, { codigo: roubado, prova: APP.prova })).toBeNull();
      expect(await m.s.trocarGoogleApp(anon, { codigo: "x".repeat(10), prova: APP.prova })).toBeNull();
      expect((await m.s.estado(q)).conta).toBeNull();
      // O app de verdade: prova certa → converte esta pessoa.
      const codigo = await m.s.guardarGoogleApp({ escopo: q.escopo!, sid: q.sid!, desafio: APP.desafio }, g);
      expect(await m.s.trocarGoogleApp(anon, { codigo, prova: APP.prova })).toEqual({ resultado: "convertida" });
      expect((await m.s.estado(q)).conta).toEqual({ email: g.email, senha: false, google: true });
      expect(await m.s.trocarGoogleApp(anon, { codigo, prova: APP.prova })).toBeNull();
      // Outro app (com o seu provisório) e o mesmo Google: abre a escolha de sempre (importar/entrar), como na web.
      const outro = await provisorio(m, "Outro app");
      const c2 = await m.s.guardarGoogleApp({ escopo: outro.escopo!, sid: outro.sid!, desafio: APP.desafio }, g);
      expect(await m.s.trocarGoogleApp(anon, { codigo: c2, prova: APP.prova })).toEqual({ resultado: "escolher" });
      expect((await m.s.estado(outro)).escolha).toMatchObject({ email: g.email });
    });
  });

  it("ADA-242: Google no app com a sessão que pediu já morta não liga nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const q = await provisorio(m);
      const g = { iss: "https://accounts.google.com", sub: `sub-${randomBytes(4).toString("hex")}`, email: emailNovo(), autoridade: true };
      const codigo = await m.s.guardarGoogleApp({ escopo: q.escopo!, sid: q.sid!, desafio: APP.desafio }, g);
      await trx`update sessoes set revogada_em = now() where id = ${q.sid!}`;
      expect(await m.s.trocarGoogleApp({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { codigo, prova: APP.prova })).toBeNull();
      expect(await repoContas.contaPorGoogle(trx, g.iss, g.sub)).toBeNull();
    });
  });

  // Regression: QA-691 — o teto de trocas do Google no app por IP não tinha teste (mutante sem o limite passava verde).
  // Found by /qa on 2026-11-08
  it("ADA-242: limite: a 31ª troca do Google no app do mesmo IP é barrada mesmo com código e prova certos; de outro IP vale", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const q = await provisorio(m);
      const g = { iss: "https://accounts.google.com", sub: `sub-${randomBytes(4).toString("hex")}`, email: emailNovo(), autoridade: true };
      const atacante = ip();
      const de = (i: string): Quem => ({ escopo: null, sid: null, ip: i, aparelho: "x" });
      for (let i = 0; i < 30; i++) expect(await m.s.trocarGoogleApp(de(atacante), { codigo: randomBytes(24).toString("base64url"), prova: APP.prova })).toBeNull();
      const codigo = await m.s.guardarGoogleApp({ escopo: q.escopo!, sid: q.sid!, desafio: APP.desafio }, g);
      await expect(m.s.trocarGoogleApp(de(atacante), { codigo, prova: APP.prova })).rejects.toMatchObject({ codigo: "limite_atingido" });
      // Barrado antes de gastar o código: o app de verdade, de outro IP, ainda troca.
      expect(await m.s.trocarGoogleApp(de(ip()), { codigo, prova: APP.prova })).toEqual({ resultado: "convertida" });
    });
  });
});

function tokenDoEmail(m: Mundo): string {
  const t = /#redefinir=([A-Za-z0-9_-]+)/.exec(m.caixa.mensagens.at(-1)?.texto ?? "")?.[1];
  if (!t) throw new Error("sem token na caixa");
  return t;
}

async function contar(trx: Tx, e: Escopo): Promise<{ agentes: number; conversas: number; mensagens: number }> {
  await vincularEscopo(trx, e);
  const [r] = await trx<{ agentes: number; conversas: number; mensagens: number }[]>`select
    (select count(*)::int from agentes where tenant_id = ${e.tenantId} and owner_id = ${e.pessoaId} and excluido_em is null) as agentes,
    (select count(*)::int from conversas where tenant_id = ${e.tenantId} and owner_id = ${e.pessoaId}) as conversas,
    (select count(*)::int from mensagens where tenant_id = ${e.tenantId} and owner_id = ${e.pessoaId}) as mensagens`;
  return r!;
}

async function vivas(trx: Tx, e: Escopo): Promise<number> {
  const [r] = await trx<{ n: number }[]>`select count(*)::int as n from sessoes where tenant_id = ${e.tenantId} and pessoa_id = ${e.pessoaId} and revogada_em is null`;
  return r!.n;
}
