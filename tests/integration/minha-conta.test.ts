import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { REAUTENTICACAO_MS } from "../../src/domain/minha-conta.ts";
import * as repoContas from "../../src/repositories/contas.repo.ts";
import * as repoMinhaConta from "../../src/repositories/minha-conta.repo.ts";
import type { Tx } from "../../src/shared/types.ts";
import type { Quem } from "../../src/use-cases/conta.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { lerZip } from "../../src/services/zip.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { codigoDoEmail, comConta, emailNovo, ip, PRONTO, provisorio, SENHA } from "../helpers/conta-mundo.ts";
import { mundoMinhaConta, tokenDoLink, type MundoMinhaConta } from "../helpers/minha-conta-mundo.ts";

/**
 * NOD-346 (ADR-126): a Minha conta no Postgres real, sob rollback. Os critérios de aceite da issue, um por bloco.
 */

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

async function contaId(trx: Tx, q: Quem): Promise<string> {
  const [l] = await trx<{ conta_id: string }[]>`select conta_id from conta_pessoas where tenant_id = ${q.escopo!.tenantId} and pessoa_id = ${q.escopo!.pessoaId}`;
  return l!.conta_id;
}

async function ligarGoogle(trx: Tx, q: Quem): Promise<void> {
  await trx`insert into identidades_conta (conta_id, tipo, google_iss, google_sub) values (${await contaId(trx, q)}, 'google', 'https://accounts.google.com', ${`sub-${Math.random()}`})`;
}

async function confirmar(m: MundoMinhaConta, q: Quem): Promise<void> {
  expect(await m.mc.reautenticarComSenha(q, { senha: SENHA })).toMatchObject({ resultado: "ok" });
}

describeIntegracao("minha conta (NOD-346): perfil, acesso, e-mail, exportação e exclusão", () => {
  it("perfil: nome e Sobre mim salvam, validam no servidor e voltam no estado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundoMinhaConta(trx);
      const q = await comConta(m);
      expect(await m.mc.salvarPerfil(q, { nome: "  Ana Souza ", sobreMim: "Sou designer.\nPrefiro respostas curtas." })).toEqual({ nome: "Ana Souza", sobreMim: "Sou designer.\nPrefiro respostas curtas.", temFoto: false });
      await expect(m.mc.salvarPerfil(q, { nome: "   " })).rejects.toMatchObject({ codigo: "entrada_invalida", cause: "nome:nome_vazio" });
      await expect(m.mc.salvarPerfil(q, { sobreMim: "x".repeat(2001) })).rejects.toMatchObject({ cause: "sobreMim:sobre_mim_longo" });
      // Só o que veio muda; null apaga o Sobre mim.
      expect(await m.mc.salvarPerfil(q, { sobreMim: null })).toEqual({ nome: "Ana Souza", sobreMim: null, temFoto: false });
      const e = await m.mc.estado(q);
      expect(e.perfil).toEqual({ nome: "Ana Souza", sobreMim: null, temFoto: false });
      expect(e.conta).toMatchObject({ email: q.email, formas: { senha: true, google: false }, trocaEmail: null, exclusao: null, podeExcluir: true });
      expect(e.reautenticadaAte).toBeNull();
    });
  });

  it("foto: PNG/JPEG pela assinatura, até 256 KiB; o resto é recusado; null tira", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundoMinhaConta(trx);
      const q = await comConta(m);
      expect(await m.mc.definirFoto(q, { base64: b64(PNG) })).toMatchObject({ temFoto: true });
      expect(await m.mc.foto(q)).toEqual({ bytes: expect.any(Uint8Array), tipo: "image/png" });
      await expect(m.mc.definirFoto(q, { base64: b64(new TextEncoder().encode("<svg onload=alert(1)>")) })).rejects.toMatchObject({ cause: "foto:tipo" });
      await expect(m.mc.definirFoto(q, { base64: b64(new Uint8Array(262_145).fill(0xff)) })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      await expect(m.mc.definirFoto(q, { base64: "não é base64!" })).rejects.toMatchObject({ cause: "foto:formato" });
      expect(await m.mc.definirFoto(q, { base64: null })).toMatchObject({ temFoto: false });
      expect(await m.mc.foto(q)).toBeNull();
    });
  });

  it("reautenticação: senha certa vale 10 min nesta sessão; errada não marca; outra sessão não herda", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundoMinhaConta(trx);
      const q = await comConta(m);
      expect(await m.mc.reautenticarComSenha(q, { senha: "errada errada errada" })).toEqual({ resultado: "recusado" });
      expect((await m.mc.estado(q)).reautenticadaAte).toBeNull();
      await expect(m.mc.excluir(q)).rejects.toMatchObject({ codigo: "nao_permitido", cause: "reautenticar" });
      const r = await m.mc.reautenticarComSenha(q, { senha: SENHA });
      expect(r).toEqual({ resultado: "ok", ate: m.agora.t + REAUTENTICACAO_MS });
      // Outro aparelho da mesma conta precisa confirmar de novo.
      const outro = await m.s.entrar({ escopo: null, sid: null, ip: ip(), aparelho: "iPhone" }, { email: q.email, senha: SENHA });
      expect(outro.resultado).toBe("entrou");
      const q2: Quem = { escopo: (outro as { sessao: { escopo: Quem["escopo"] } }).sessao.escopo, sid: (outro as { sessao: { sid: string } }).sessao.sid, ip: ip(), aparelho: "iPhone" };
      expect((await m.mc.estado(q2)).reautenticadaAte).toBeNull();
      // Passados 10 min, vence.
      m.agora.t += REAUTENTICACAO_MS;
      expect((await m.mc.estado(q)).reautenticadaAte).toBeNull();
    });
  });

  it("reautenticação por código no e-mail (alternativa à senha): certo vale, errado conta tentativas", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundoMinhaConta(trx);
      const q = await comConta(m);
      expect(await m.mc.enviarCodigo(q)).toMatchObject({ enviado: true });
      expect(m.caixa.mensagens.at(-1)?.para).toBe(q.email);
      const certo = codigoDoEmail(m);
      const errado = certo === "000000" ? "111111" : "000000";
      expect(await m.mc.reautenticarComCodigo(q, { codigo: errado })).toEqual({ resultado: "errado", restantes: 4 });
      expect(await m.mc.reautenticarComCodigo(q, { codigo: certo })).toMatchObject({ resultado: "ok" });
      // Usado: não vale de novo.
      expect(await m.mc.reautenticarComCodigo(q, { codigo: certo })).toEqual({ resultado: "vencido" });
      // O código de uma sessão não serve na outra.
      await m.mc.enviarCodigo(q);
      const deQ = codigoDoEmail(m);
      const outro = await m.s.entrar({ escopo: null, sid: null, ip: ip(), aparelho: "iPhone" }, { email: q.email, senha: SENHA });
      const s = (outro as { sessao: { escopo: Quem["escopo"]; sid: string } }).sessao;
      expect(await m.mc.reautenticarComCodigo({ escopo: s.escopo, sid: s.sid, ip: ip(), aparelho: "iPhone" }, { codigo: deQ })).toEqual({ resultado: "vencido" });
    });
  });

  it("formas de entrada: tira o Google com senha; nunca a última (domínio e banco)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundoMinhaConta(trx);
      const q = await comConta(m);
      await ligarGoogle(trx, q);
      expect((await m.mc.estado(q)).conta?.formas).toEqual({ senha: true, google: true });
      await expect(m.mc.removerGoogle(q)).rejects.toMatchObject({ cause: "reautenticar" });
      await confirmar(m, q);
      expect(await m.mc.removerGoogle(q)).toEqual({ formas: { senha: true, google: false } });

      // A conta só com Google (o Google é a última forma e não sai) está em tests/concurrency/minha-conta-purga.test.ts:
      // montá-la exige apagar a senha, e o teste de integração não apaga.
    });
  });

  it("troca de e-mail: só vale com o clique no link; o antigo é avisado; outras sessões caem; a recuperação antiga morre", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundoMinhaConta(trx);
      const q = await comConta(m);
      const novo = emailNovo();
      await expect(m.mc.pedirTrocaEmail(q, { email: novo })).rejects.toMatchObject({ cause: "reautenticar" });
      await confirmar(m, q);
      await expect(m.mc.pedirTrocaEmail(q, { email: q.email })).rejects.toMatchObject({ cause: "email_igual" });
      await expect(m.mc.pedirTrocaEmail(q, { email: "sem-arroba" })).rejects.toMatchObject({ codigo: "entrada_invalida" });

      // Uma recuperação pendente no endereço antigo.
      await m.s.recuperar({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { email: q.email });
      const tokenRecuperacao = tokenDoLink(m, "redefinir");

      const r = await m.mc.pedirTrocaEmail(q, { email: novo });
      expect(r).toMatchObject({ enviado: true, para: novo });
      const paraNovo = m.caixa.mensagens.find((e) => e.para === novo);
      expect(paraNovo?.texto).toContain("#confirmar-email=");
      await new Promise((ok) => setTimeout(ok, 10)); // o aviso ao antigo sai sem esperar
      const aviso = [...m.caixa.mensagens].reverse().find((e) => e.para === q.email);
      expect(aviso?.texto).toContain(novo.split("@")[1]);
      expect(aviso?.texto).not.toContain(novo.split("@")[0]);
      // Pendente: o e-mail ainda é o antigo.
      const e1 = await m.mc.estado(q);
      expect(e1.conta).toMatchObject({ email: q.email, trocaEmail: { para: novo } });

      const outro = await m.s.entrar({ escopo: null, sid: null, ip: ip(), aparelho: "iPhone" }, { email: q.email, senha: SENHA });
      const s2 = (outro as { sessao: { escopo: Quem["escopo"]; sid: string } }).sessao;

      const c = await m.mc.confirmarTrocaEmail(q, { token: tokenDoLink(m) });
      expect(c).toMatchObject({ resultado: "trocado", email: novo });
      expect((await m.mc.estado(q)).conta).toMatchObject({ email: novo, trocaEmail: null });
      // A outra sessão caiu; esta continua.
      const [viva] = await trx<{ revogada: boolean }[]>`select revogada_em is not null as revogada from sessoes where id = ${s2.sid}`;
      expect(viva?.revogada).toBe(true);
      // Revisão do PR 506: e o cookie antigo sem sid também deixa de valer (o corte, como no "sair dos outros").
      const [corte] = await trx<{ n: number }[]>`select count(*)::int as n from sessoes_corte where tenant_id = ${q.escopo!.tenantId} and pessoa_id = ${q.escopo!.pessoaId}`;
      expect(corte?.n).toBe(1);
      const [esta] = await trx<{ revogada: boolean }[]>`select revogada_em is not null as revogada from sessoes where id = ${q.sid}`;
      expect(esta?.revogada).toBe(false);
      // O link de recuperação mandado ao antigo não vale mais; o link de troca também não vale de novo.
      expect(await m.s.redefinir({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { token: tokenRecuperacao, senha: "outra senha boa demais" })).toMatchObject({ resultado: "invalido" });
      expect(await m.mc.confirmarTrocaEmail(q, { token: tokenDoLink(m) })).toEqual({ resultado: "invalido" });
      // Entra com o novo.
      expect((await m.s.entrar({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { email: novo, senha: SENHA })).resultado).toBe("entrou");
    });
  });

  it("troca de e-mail: cancelar mata o link; e-mail de outra conta é recusado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundoMinhaConta(trx);
      const outra = await comConta(m);
      const q = await comConta(m);
      await confirmar(m, q);
      // Revisão do PR 506: a resposta é igual à de um e-mail livre (sem oráculo); o endereço recebe o aviso, sem link.
      expect(await m.mc.pedirTrocaEmail(q, { email: outra.email })).toMatchObject({ enviado: true, para: outra.email });
      const aviso = m.caixa.mensagens.at(-2)?.para === outra.email ? m.caixa.mensagens.at(-2) : [...m.caixa.mensagens].reverse().find((e) => e.para === outra.email);
      expect(aviso?.tipo).toBe("troca_email_em_uso");
      expect(aviso?.texto).not.toContain("#confirmar-email=");
      expect((await m.mc.estado(q)).conta?.trocaEmail).toMatchObject({ para: outra.email });
      await m.mc.pedirTrocaEmail(q, { email: emailNovo() });
      const token = tokenDoLink(m);
      await m.mc.cancelarTrocaEmail(q);
      expect((await m.mc.estado(q)).conta?.trocaEmail).toBeNull();
      expect(await m.mc.confirmarTrocaEmail(q, { token })).toEqual({ resultado: "invalido" });
    });
  });

  it("exportação: pede, o laço prepara o zip com os dados e sem segredos, baixa só com confirmação e só a própria", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundoMinhaConta(trx);
      const q = await comConta(m);
      await m.mc.salvarPerfil(q, { nome: "Ana", sobreMim: "Sou designer." });
      await m.mc.definirFoto(q, { base64: b64(PNG) });
      await vincularEscopo(trx, q.escopo!);
      const dp = depsSobreTrx(trx, q.escopo!);
      const bot = (await executar(dp, criarAgente, { dono: "pessoa" })).data;
      await executar(dp, enviarMensagem, { conversaId: bot.conversa.id, texto: "oi, guarda isso", inventario: PRONTO });

      // Revisão do PR 506: uma fala de OUTRA pessoa na mesma conversa (sala de equipe) não entra no arquivo de Ana.
      const [modelo] = await trx<{ j: Record<string, unknown> }[]>`select to_jsonb(m) as j from mensagens m where m.conversa_id = ${bot.conversa.id} limit 1`;
      const bruno = crypto.randomUUID();
      await trx`select set_config('nod.pessoa_id', ${bruno}, true)`;
      // QA do PR 506: visível à equipe, para que só o filtro de dono da exportação a segure (a RLS deixaria passar).
      await trx`insert into mensagens select (jsonb_populate_record(null::mensagens, ${trx.json({ ...modelo!.j, id: crypto.randomUUID(), owner_id: bruno, visibility: "equipe", texto: "fala do Bruno", id_envio: null } as never)})).*`;
      await vincularEscopo(trx, q.escopo!);
      const [vista] = await trx<{ n: number }[]>`select count(*)::int as n from mensagens where texto = 'fala do Bruno'`;
      expect(vista?.n).toBe(1);
      // Uma linha de trilha com prosa e hash: a prosa sai (trilha legível), o hash não.
      const [tr] = await trx<{ id: string }[]>`insert into trilha (tenant_id, owner_id, agente_id, ferramenta, kind, regra, regra_versao, hash)
        values (${q.escopo!.tenantId}, ${q.escopo!.pessoaId}, ${bot.agente.id}, 'buscar_web', 'acao_executada', 'regra_teste', 1, '\\xdeadbeefcafe'::bytea) returning id`;
      await trx`insert into trilha_prosa (tenant_id, owner_id, trilha_id, texto) values (${q.escopo!.tenantId}, ${q.escopo!.pessoaId}, ${tr!.id}, 'Buscou o preço do voo para Lisboa')`;

      // NOD-58: o diário da memória vai no arquivo.
      await dp.repos.memorias.criar({ agenteId: bot.agente.id, tipo: "fato", texto: "gosta de café sem açúcar", origem: "agente" });

      // NOD-20: as versões do perfil vão no arquivo.
      await executar(dp, editarPerfil, { agenteId: bot.agente.id, descricao: "Cuida da agenda da Ana." });

      const p = await m.mc.pedirExportacao(q);
      expect(p.estado).toBe("pedida");
      // Pedir de novo enquanto prepara devolve a mesma.
      expect((await m.mc.pedirExportacao(q)).id).toBe(p.id);
      expect(await m.mc.prepararExportacoes(q.escopo!)).toBe(1);
      const e = (await m.mc.estado(q)).exportacao;
      expect(e).toMatchObject({ id: p.id, estado: "pronta", tamanho: expect.any(Number) });
      expect(e!.expiraEm! - e!.prontaEm!).toBe(7 * 24 * 3_600_000);

      await expect(m.mc.baixarExportacao(q, p.id)).rejects.toMatchObject({ cause: "reautenticar" });
      await confirmar(m, q);
      const arquivos = lerZip(await m.mc.baixarExportacao(q, p.id));
      expect([...arquivos.keys()]).toEqual(expect.arrayContaining(["LEIA-ME.txt", "perfil.json", "bots.json", "conversas.json", "memorias.json", "memoria_diario.json", "perfil_versoes.json", "rotinas.json", "decisoes.json", "trilha.json", "foto.png", `conversas/${bot.conversa.id}.json`]));
      const texto = (n: string) => new TextDecoder().decode(arquivos.get(n));
      expect(JSON.parse(texto("perfil.json"))).toMatchObject({ email: q.email, nome: "Ana", sobre_mim: "Sou designer." });
      expect(texto(`conversas/${bot.conversa.id}.json`)).toContain("oi, guarda isso");
      expect(texto(`conversas/${bot.conversa.id}.json`)).not.toContain("fala do Bruno");
      expect(JSON.parse(texto("memoria_diario.json"))).toEqual(expect.arrayContaining([expect.objectContaining({ acao: "criada", autor: "agente", depois_texto: "gosta de café sem açúcar" })]));
      expect((JSON.parse(texto("perfil_versoes.json")) as Record<string, unknown>[]).map((v) => [v.versao, v.origem, v.agente_id])).toEqual([[1, "inicial", bot.agente.id], [2, "tela", bot.agente.id]]);
      const tudo = [...arquivos].filter(([n]) => n !== "LEIA-ME.txt").map(([, b]) => new TextDecoder().decode(b)).join("\n");
      expect(tudo).not.toMatch(/senha_hash|scrypt|nodm_|token|refresh/i);
      const trilha = JSON.parse(texto("trilha.json")) as Record<string, unknown>[];
      const linha = trilha.find((l) => l.id === tr!.id);
      expect(linha).toMatchObject({ kind: "acao_executada", prosa: "Buscou o preço do voo para Lisboa" });
      expect(Object.keys(linha!)).not.toContain("hash");
      expect(tudo).not.toMatch(/deadbeefcafe|"hash"/i);

      // Outra pessoa não baixa a de Ana, nem com confirmação.
      const intrusa = await comConta(m);
      await confirmar(m, intrusa);
      await expect(m.mc.baixarExportacao(intrusa, p.id)).rejects.toMatchObject({ codigo: "nao_encontrado" });
      // Vencida (7 dias), some.
      m.agora.t += 7 * 24 * 3_600_000;
      await confirmar(m, q);
      await expect(m.mc.baixarExportacao(q, p.id)).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  it("QA do PR 506: cada assunto da exportação filtra pelo dono (a RLS deixaria passar o que a equipe vê)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundoMinhaConta(trx);
      const q = await comConta(m);
      await vincularEscopo(trx, q.escopo!);
      const dp = depsSobreTrx(trx, q.escopo!);
      const bot = (await executar(dp, criarAgente, { dono: "pessoa" })).data;
      const { tenantId: t, pessoaId: ana } = q.escopo!;
      const agente = bot.agente.id;
      const conversa = bot.conversa.id;
      await trx`insert into agente_memorias (tenant_id, owner_id, agente_id, tipo, texto, origem) values (${t}, ${ana}, ${agente}, 'preferencia', 'resumos curtos', 'pessoa')`;
      await trx`insert into decisoes (tenant_id, owner_id, decisor_id, agente_id, conversa_id, tipo, prazo_decisao_em, frase)
        values (${t}, ${ana}, ${ana}, ${agente}, ${conversa}, 'pergunta', now() + interval '1 day', 'posso?')`;
      await executar(dp, enviarMensagem, { conversaId: conversa, texto: "oi", inventario: PRONTO });
      const [tr] = await trx<{ id: string }[]>`insert into trilha (tenant_id, owner_id, agente_id, ferramenta, kind, regra, regra_versao)
        values (${t}, ${ana}, ${agente}, 'buscar_web', 'acao_executada', 'regra_teste', 1) returning id`;
      await trx`insert into trilha_prosa (tenant_id, owner_id, trilha_id, texto) values (${t}, ${ana}, ${tr!.id}, 'prosa da Ana')`;
      await trx`insert into rotinas (tenant_id, owner_id, agente_id, conversa_id, cron, fuso_iana, instrucao, fonte, entregavel, limites_aprovacao, politica_sem_dado, proxima_execucao)
        values (${t}, ${ana}, ${agente}, ${conversa}, '*/30 * * * *', 'UTC', 'PRs', 'f', 'e', 'l', 'p', now() + interval '1 hour')`;

      // Uma cópia de cada linha de Ana em nome de Bruno, visível à equipe: só o filtro de dono a segura.
      const bruno = crypto.randomUUID();
      const tabelas = ["agentes", "conversas", "agente_memorias", "decisoes", "trilha", "trilha_prosa", "rotinas"] as const;
      const copias = new Map<string, string>();
      const modelos = new Map<string, string>();
      for (const tbl of tabelas) {
        const [l] = await trx.unsafe<{ j: string }[]>(`select to_jsonb(x)::text as j from ${tbl} x where x.tenant_id = $1 and x.owner_id = $2 limit 1`, [t, ana]);
        modelos.set(tbl, l!.j);
      }
      await trx`select set_config('nod.pessoa_id', ${bruno}, true)`;
      for (const tbl of tabelas) {
        const id = crypto.randomUUID();
        copias.set(tbl, id);
        const cols = (await trx<{ c: string }[]>`select quote_ident(attname) as c from pg_attribute
          where attrelid = ${tbl}::regclass and attnum > 0 and not attisdropped and attgenerated = '' order by attnum`).map((l) => l.c).join(", ");
        await trx.unsafe(
          `insert into ${tbl} (${cols}) select ${cols} from jsonb_populate_record(null::${tbl}, $1::text::jsonb || $2::text::jsonb)`,
          [modelos.get(tbl)!, JSON.stringify({
            id,
            owner_id: bruno,
            visibility: "equipe",
            ...(tbl === "agentes" ? { nome: "Bot do Bruno" } : { agente_id: copias.get("agentes") }),
            ...(tbl === "decisoes" || tbl === "rotinas" ? { conversa_id: copias.get("conversas"), decisor_id: bruno } : {}),
          })],
        );
      }
      await vincularEscopo(trx, q.escopo!);
      for (const tbl of tabelas) {
        const [v] = await trx.unsafe<{ n: number }[]>(`select count(*)::int as n from ${tbl} where id = $1`, [copias.get(tbl)!]);
        expect(v?.n, `${tbl}: a cópia do Bruno precisa ser visível para Ana, senão o teste não prova o filtro`).toBe(1);
      }

      const d = await repoMinhaConta.exportacoesRepo(trx, q.escopo!).dados();
      const ids = (l: Record<string, unknown>[]) => l.map((x) => String(x.id));
      expect(ids(d.bots)).toContain(agente);
      expect(ids(d.bots)).not.toContain(copias.get("agentes"));
      expect(ids(d.conversas)).toContain(conversa);
      expect(ids(d.conversas)).not.toContain(copias.get("conversas"));
      expect(d.memorias).toHaveLength(1);
      expect(ids(d.memorias)).not.toContain(copias.get("agente_memorias"));
      expect(d.decisoes).toHaveLength(1);
      expect(ids(d.decisoes)).not.toContain(copias.get("decisoes"));
      expect(d.rotinas).toHaveLength(1);
      expect(ids(d.rotinas)).not.toContain(copias.get("rotinas"));
      expect(ids(d.trilha)).toEqual([tr!.id]);
      // A prosa do Bruno pendurada na linha de Ana não entra no texto dela.
      expect(d.trilha[0]).toMatchObject({ prosa: "prosa da Ana" });
    });
  });

  it("revisão do PR 506: a exportação nova tira o arquivo das prontas anteriores (o banco guarda uma por pessoa)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundoMinhaConta(trx);
      const q = await comConta(m);
      const a = await m.mc.pedirExportacao(q);
      expect(await m.mc.prepararExportacoes(q.escopo!)).toBe(1);
      const b = await m.mc.pedirExportacao(q);
      expect(b.id).not.toBe(a.id);
      expect(await m.mc.prepararExportacoes(q.escopo!)).toBe(1);
      await vincularEscopo(trx, q.escopo!);
      const ls = await trx<{ id: string; estado: string; com_arquivo: boolean }[]>`select id, estado, arquivo is not null as com_arquivo from exportacoes
        where owner_id = ${q.escopo!.pessoaId} order by pedida_em`;
      expect(ls).toEqual([{ id: a.id, estado: "falhou", com_arquivo: false }, { id: b.id, estado: "pronta", com_arquivo: true }]);
    });
  });

  it("exportação: um erro no meio vira 'falhou' e a próxima pode ser pedida", async () => {
    await withRollback(MARLON, async (trx) => {
      const quebrado = { ...repoMinhaConta, exportacoesRepo: (c: Tx, e: Parameters<typeof repoMinhaConta.exportacoesRepo>[1]) => ({ ...repoMinhaConta.exportacoesRepo(c, e), dados: () => Promise.reject(new Error("banco caiu")) }) } as typeof repoMinhaConta;
      const m = mundoMinhaConta(trx, { mc: quebrado });
      const q = await comConta(m);
      const p = await m.mc.pedirExportacao(q);
      expect(await m.mc.prepararExportacoes(q.escopo!)).toBe(0);
      expect((await m.mc.estado(q)).exportacao).toMatchObject({ id: p.id, estado: "falhou", motivo: "erro_interno" });
      expect((await m.mc.pedirExportacao(q)).id).not.toBe(p.id);
    });
  });

  it("exclusão: exige confirmação, programa 30 dias, desfaz; depois do prazo (com a purga ligada) o login falha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundoMinhaConta(trx, { purga: true });
      const q = await comConta(m);
      await expect(m.mc.excluir(q)).rejects.toMatchObject({ cause: "reautenticar" });
      await confirmar(m, q);
      const ex = await m.mc.excluir(q);
      expect(ex.purgarEm - ex.pedidaEm).toBe(30 * 24 * 3_600_000);
      // Repetir devolve a mesma.
      expect(await m.mc.excluir(q)).toEqual(ex);
      expect((await m.mc.estado(q)).conta?.exclusao).toEqual(ex);
      expect(await m.mc.desfazerExclusao(q)).toEqual({ desfeita: true });
      expect((await m.mc.estado(q)).conta?.exclusao).toBeNull();
      // Não vence antes do prazo.
      await m.mc.excluir(q);
      expect(await m.mc.purgarVencidas()).toBe(0);
      // A purga depois do prazo (linhas commitadas, o dono adianta o relógio): tests/concurrency/minha-conta-purga.test.ts.
    });
  });

  it("exclusão: só no espaço pessoal (o tenant com mais de uma pessoa é de equipe)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundoMinhaConta(trx);
      const q = await comConta(m);
      await confirmar(m, q);
      const id = await contaId(trx, q);
      // Uma segunda conta ligada à mesma conta = não é mais "uma pessoa, uma conta".
      const stub = { ...repoMinhaConta, espacoPessoal: async () => false } as typeof repoMinhaConta;
      const m2 = mundoMinhaConta(trx, { mc: stub });
      await expect(m2.mc.excluir(q)).rejects.toMatchObject({ cause: "conta_de_equipe" });
      expect(await repoMinhaConta.espacoPessoal(trx, q.escopo!, id)).toBe(true);
      expect((await m2.mc.estado(q)).conta?.podeExcluir).toBe(false);
    });
  });

  it("revisão do PR 506: o link de troca de e-mail morre quando a sessão que pediu é revogada (sair dos outros, senha nova)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundoMinhaConta(trx);
      const vitima = await comConta(m);
      // O invasor: outra sessão da mesma conta, que confirma a senha e pede a troca.
      const r = await m.s.entrar({ escopo: null, sid: null, ip: ip(), aparelho: "invasor" }, { email: vitima.email, senha: SENHA });
      const s = (r as { sessao: { escopo: Quem["escopo"]; sid: string } }).sessao;
      const invasor: Quem = { escopo: s.escopo, sid: s.sid, ip: ip(), aparelho: "invasor" };
      await confirmar(m, invasor);
      await m.mc.pedirTrocaEmail(invasor, { email: emailNovo() });
      const token = tokenDoLink(m);
      // A vítima reage: sai das outras sessões (o mesmo que a senha nova e a redefinição fazem).
      await repoContas.revogarOutrasSessoes(trx, vitima.escopo!, vitima.sid);
      expect(await m.mc.confirmarTrocaEmail({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { token })).toEqual({ resultado: "invalido" });
      expect((await m.mc.estado(vitima)).conta?.email).toBe(vitima.email);

      // Com a sessão viva, o mesmo caminho troca (o link vale de qualquer aparelho).
      await confirmar(m, vitima);
      const novo = emailNovo();
      await m.mc.pedirTrocaEmail(vitima, { email: novo });
      expect(await m.mc.confirmarTrocaEmail({ escopo: null, sid: null, ip: ip(), aparelho: "x" }, { token: tokenDoLink(m) })).toMatchObject({ resultado: "trocado", email: novo });
    });
  });

  it("sessão sem conta (provisória): perfil funciona, as ações de conta não", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundoMinhaConta(trx);
      const q = await provisorio(m);
      expect((await m.mc.estado(q)).conta).toBeNull();
      expect(await m.mc.salvarPerfil(q, { nome: "Ana" })).toMatchObject({ nome: "Ana" });
      await expect(m.mc.excluir(q)).rejects.toMatchObject({ cause: "sem conta" });
      // QA do PR 506: sem conta não há como reautenticar e baixar; a exportação nem começa.
      await expect(m.mc.pedirExportacao(q)).rejects.toMatchObject({ cause: "sem conta" });
      await expect(m.mc.estado({ escopo: null, sid: null, ip: ip(), aparelho: "x" })).rejects.toMatchObject({ codigo: "nao_permitido" });
    });
  });
});
