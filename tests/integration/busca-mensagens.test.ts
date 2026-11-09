import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Escopo } from "../../src/shared/types.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { lerCursor } from "../../src/domain/biblioteca.ts";
import { ASSUNTOS_ANEXO, ASSUNTOS_ATIVIDADE } from "../../src/domain/destino-no-chat.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { buscarMensagens } from "../../src/use-cases/buscar-mensagens.ts";
import { lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { agenteComConversa, autoriaAgente, autoriaPessoa } from "../helpers/fabricas.ts";
import { ANA, depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { PESSOA_ANA, PESSOA_MARLON } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

const buscar = (trx: Trx, escopo: Escopo, termo: string, antes: string | null = null, limite = 20) =>
  executar(depsSobreTrx(trx, escopo), buscarMensagens, { termo, antes: antes ? lerCursor(antes) : null, limite }).then((r) => r.data);

async function falar(trx: Trx, escopo: Escopo, conversaId: string, texto: string, extra: { agenteId?: string; parcial?: boolean; em?: string } = {}) {
  const repos = criarRepos(trx, escopo);
  const m = await repos.mensagens.criar({ conversaId, autoria: extra.agenteId ? autoriaAgente(extra.agenteId, escopo.pessoaId) : autoriaPessoa(escopo.pessoaId), kind: "texto", texto, confianca: "confiavel", ...(extra.parcial ? { parcial: true } : {}) });
  if (!m) throw new Error("mensagem não criada");
  if (extra.em) await trx`update mensagens set criado_em = ${extra.em}::text::timestamptz where id = ${m.id}`;
  return m.id;
}

/** NOD-380: `GET /busca/mensagens` — o que a pessoa lê (RLS), sem acento e caixa, só falas inteiras, paginado por cursor. */
describeIntegracao("Busca de mensagens do celular (NOD-380)", () => {
  it("RLS com duas pessoas e dois tenants: cada uma acha só o que lê, inclusive a sala pelo grant do bot, que fecha ao remover", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const daMarlon = await falar(trx, MARLON, vera.conversaId, "o orçamento do girassol fecha amanhã");
      await vincularEscopo(trx, ANA);
      const tuca = await agenteComConversa(trx, ANA, { nome: "Tuca" });
      const daAna = await falar(trx, ANA, tuca.conversaId, "girassol da Ana, só dela");
      await vincularEscopo(trx, MARLON);
      const repos = criarRepos(trx, MARLON);
      const salaId = randomUUID();
      const conversaSala = (await repos.conversas.criar({ id: randomUUID(), tipo: "sala", salaId }))!;
      await repos.salas.criarComMembros({ id: salaId, nome: "revisão", conversaId: conversaSala.id, leadAgenteId: vera.agenteId }, [
        { agenteId: vera.agenteId, pessoaLeitoraId: PESSOA_MARLON },
        { agenteId: tuca.agenteId, pessoaLeitoraId: PESSOA_ANA },
      ]);
      const naSala = await falar(trx, MARLON, conversaSala.id, "@Tuca o girassol entra no PR?");
      const privadaId = randomUUID();
      const privada = (await repos.conversas.criar({ id: randomUUID(), tipo: "sala", salaId: privadaId }))!;
      await repos.salas.criarComMembros({ id: privadaId, nome: "privada", conversaId: privada.id }, [{ agenteId: vera.agenteId, pessoaLeitoraId: PESSOA_MARLON }]);
      const segredo = await falar(trx, MARLON, privada.id, "girassol secreto");

      const doMarlon = await buscar(trx, MARLON, "girassol");
      expect(new Set(doMarlon.itens.map((i) => i.id))).toEqual(new Set([daMarlon, naSala, segredo]));
      const itemSala = doMarlon.itens.find((i) => i.id === naSala)!;
      expect(itemSala).toMatchObject({ conversaId: conversaSala.id, conversaTipo: "sala", salaId, agenteId: null, autor: { tipo: "pessoa", id: PESSOA_MARLON } });
      expect(doMarlon.itens.find((i) => i.id === daMarlon)).toMatchObject({ conversaTipo: "propria", agenteId: vera.agenteId, salaId: null });

      await vincularEscopo(trx, ANA);
      expect(new Set((await buscar(trx, ANA, "girassol")).itens.map((i) => i.id))).toEqual(new Set([daAna, naSala]));

      // O outro tenant tem dados de verdade (a mesma pessoa, o mesmo termo): cada lado acha só o seu.
      const OUTRO_TENANT: Escopo = { tenantId: randomUUID(), pessoaId: PESSOA_MARLON };
      await vincularEscopo(trx, OUTRO_TENANT);
      const deFora = await agenteComConversa(trx, OUTRO_TENANT, { nome: "Zeca" });
      const doOutro = await falar(trx, OUTRO_TENANT, deFora.conversaId, "girassol do outro tenant");
      expect((await buscar(trx, OUTRO_TENANT, "girassol")).itens.map((i) => i.id)).toEqual([doOutro]);
      await vincularEscopo(trx, MARLON);
      expect((await buscar(trx, MARLON, "girassol")).itens.map((i) => i.id)).not.toContain(doOutro);

      // Tirar Tuca da sala fecha a busca de Ana nela.
      await vincularEscopo(trx, MARLON);
      expect(await repos.salas.removerMembro(salaId, tuca.agenteId, Date.now())).toBe(true);
      await vincularEscopo(trx, ANA);
      expect((await buscar(trx, ANA, "girassol")).itens.map((i) => i.id)).toEqual([daAna]);
    });
  });

  it("fala longa: o banco manda só a janela do acerto (não o texto inteiro), com reticências dos dois lados", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await agenteComConversa(trx, MARLON, { nome: "Lia" });
      const longa = `${"antes ".repeat(20_000)}o Girassol\nabriu ${"depois ".repeat(20_000)}`;
      const id = await falar(trx, MARLON, c.conversaId, longa);
      const linhas = (await criarRepos(trx, MARLON).mensagens.buscarTexto("girassol abriu", null, 20)).linhas;
      expect(linhas.map((l) => l.id)).toEqual([id]);
      expect(linhas[0]!.texto.length).toBeLessThanOrEqual(2000);
      expect(linhas[0]).toMatchObject({ cortado_inicio: true, cortado_fim: true });
      const [item] = (await buscar(trx, MARLON, "girassol abriu")).itens;
      expect(item!.trecho).toContain("Girassol abriu");
      expect(item!.trecho.startsWith("…") && item!.trecho.endsWith("…")).toBe(true);
    });
  });

  it("defesa em profundidade: o repo filtra o tenant do escopo dele, sem confiar só na RLS (QA, mutante do filtro)", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await agenteComConversa(trx, MARLON, { nome: "Lia" });
      await falar(trx, MARLON, c.conversaId, "o girassol abriu");
      expect((await criarRepos(trx, MARLON).mensagens.buscarTexto("girassol", null, 20)).linhas).toHaveLength(1);
      // A sessão (a RLS) segue sendo a do Marlon; o repo montado com outro tenant não pode devolver as falas dele.
      const outro: Escopo = { tenantId: randomUUID(), pessoaId: MARLON.pessoaId };
      expect((await criarRepos(trx, outro).mensagens.buscarTexto("girassol", null, 20)).linhas).toEqual([]);
    });
  });

  it("o pedido abortado (a web digitou outra letra) não segue no banco: a busca rejeita com o abort (revisão 7)", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await agenteComConversa(trx, MARLON, { nome: "Lia" });
      await falar(trx, MARLON, c.conversaId, "o girassol abriu");
      const corte = new AbortController();
      const busca = criarRepos(trx, MARLON).mensagens.buscarTexto("girassol", null, 20, corte.signal);
      corte.abort();
      await expect(busca).rejects.toMatchObject({ name: "AbortError" });
    });
  });

  it("ignora acento e caixa nos dois lados; % e _ são literais; fala parcial, não-texto e aviso que mora fora do chat ficam de fora", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await agenteComConversa(trx, MARLON, { nome: "Íris" });
      const acento = await falar(trx, MARLON, c.conversaId, "Reunião com a ÍRIS às três", { agenteId: c.agenteId });
      const cem = await falar(trx, MARLON, c.conversaId, "subiu 100% do lote");
      await falar(trx, MARLON, c.conversaId, "subiu 1000 do lote");
      const sub = await falar(trx, MARLON, c.conversaId, "arquivo a_b.txt");
      await falar(trx, MARLON, c.conversaId, "arquivo axb.txt");
      const barra = await falar(trx, MARLON, c.conversaId, "pasta c\\d\\e");
      await falar(trx, MARLON, c.conversaId, "pasta cxdxe");
      const quebra = await falar(trx, MARLON, c.conversaId, "oi\n  tudo bem");
      await falar(trx, MARLON, c.conversaId, "iris ainda escrevendo", { agenteId: c.agenteId, parcial: true });
      const repos = criarRepos(trx, MARLON);
      for (const assunto of [ASSUNTOS_ATIVIDADE[0]!, ASSUNTOS_ANEXO[0]!]) {
        await repos.mensagens.criar({ conversaId: c.conversaId, autoria: autoriaAgente(c.agenteId, MARLON.pessoaId), kind: "texto", texto: `iris aviso ${assunto}`, confianca: "confiavel", assunto });
      }

      expect((await buscar(trx, MARLON, "iris")).itens.map((i) => i.id)).toEqual([acento]);
      expect((await buscar(trx, MARLON, "REUNIAO")).itens.map((i) => i.id)).toEqual([acento]);
      expect((await buscar(trx, MARLON, "às TRÊS")).itens.map((i) => i.id)).toEqual([acento]);
      expect((await buscar(trx, MARLON, "100%")).itens.map((i) => i.id)).toEqual([cem]);
      expect((await buscar(trx, MARLON, "a_b")).itens.map((i) => i.id)).toEqual([sub]);
      expect((await buscar(trx, MARLON, "a\\b")).itens).toEqual([]);
      // A barra é literal: "c\d" acha só a pasta com barra, e não "cxd" (sem o escape, `\d` casaria com "d").
      expect((await buscar(trx, MARLON, "c\\d")).itens.map((i) => i.id)).toEqual([barra]);
      // Espaços juntados dos dois lados: quebra de linha e espaço duplo casam com um espaço.
      expect((await buscar(trx, MARLON, "oi tudo")).itens.map((i) => i.id)).toEqual([quebra]);
      // O unaccent vira ％ ＿ ＼ de largura total em % _ \; o escape vem depois de normalizar, então eles também são literais.
      expect((await buscar(trx, MARLON, "％％")).itens).toEqual([]);
      expect((await buscar(trx, MARLON, "a＿b")).itens.map((i) => i.id)).toEqual([sub]);
      expect((await buscar(trx, MARLON, "100％")).itens.map((i) => i.id)).toEqual([cem]);
      expect((await buscar(trx, MARLON, "iris")).itens[0]!.trecho).toBe("Reunião com a ÍRIS às três");
      // Bot na lixeira: a conversa dele some da busca, como some da sidebar.
      await trx`update agentes set excluido_em = now() where id = ${c.agenteId}`;
      expect((await buscar(trx, MARLON, "iris")).itens).toEqual([]);
    });
  });

  it("cursor: páginas de no máximo 20, sem repetir nem pular, com empate no mesmo instante e microssegundos", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await agenteComConversa(trx, MARLON, { nome: "Chico" });
      const ids: string[] = [];
      for (let i = 0; i < 45; i++) {
        // Grupos de 3 no mesmo instante (o id desempata) e µs diferentes entre os grupos.
        const em = `2026-10-20T10:00:00.${String(Math.floor(i / 3)).padStart(6, "0")}Z`;
        ids.push(await falar(trx, MARLON, c.conversaId, `deploy número ${i}`, { em }));
      }
      const vistos: string[] = [];
      let antes: string | null = null;
      let paginas = 0;
      do {
        const p = await buscar(trx, MARLON, "deploy", antes);
        expect(p.itens.length).toBeLessThanOrEqual(20);
        for (const [k, item] of p.itens.entries()) {
          const prox = p.itens[k + 1];
          if (prox) expect(item.em >= prox.em).toBe(true);
          expect(item.em).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u);
        }
        vistos.push(...p.itens.map((i) => i.id));
        antes = p.proximo;
        paginas++;
      } while (antes && paginas < 10);
      expect(paginas).toBe(3);
      expect(vistos).toHaveLength(45);
      expect(new Set(vistos)).toEqual(new Set(ids));
      // Páginas exatas: 45 = 3 × 15, e a última, cheia, não tem cursor (a fronteira do `limite + 1`).
      const exatas: number[] = [];
      let cursor: string | null = null;
      do {
        const p = await buscar(trx, MARLON, "deploy", cursor, 15);
        exatas.push(p.itens.length);
        cursor = p.proximo;
      } while (cursor && exatas.length < 10);
      expect(exatas).toEqual([15, 15, 15]);
      const um = await buscar(trx, MARLON, "deploy", null, 1);
      expect(um.itens).toHaveLength(1);
      expect(um.proximo).not.toBeNull();
    });
  });

  it("?ate= na conversa: a janela cresce até a fala achada, mesmo fora das 200 mais recentes; ate de outra conversa não muda nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const alvo = await falar(trx, MARLON, c.conversaId, "a fala antiga", { em: "2026-01-01T00:00:00Z" });
      for (let i = 0; i < 250; i++) await falar(trx, MARLON, c.conversaId, `recheio ${i}`);
      await trx`update mensagens set criado_em = '2026-02-01'::timestamptz + (random() * interval '30 days') where conversa_id = ${c.conversaId} and id <> ${alvo}`;
      const deps = depsSobreTrx(trx, MARLON);
      const semAte = (await executar(deps, lerConversa, { conversaId: c.conversaId })).data;
      expect(semAte.mensagens.some((m) => m.id === alvo)).toBe(false);
      const comAte = (await executar(deps, lerConversa, { conversaId: c.conversaId, ate: alvo })).data;
      expect(comAte.mensagens.some((m) => m.id === alvo)).toBe(true);
      const outra = await agenteComConversa(trx, MARLON, { nome: "Gil" });
      const deFora = await falar(trx, MARLON, outra.conversaId, "de outra conversa");
      const ignorado = (await executar(deps, lerConversa, { conversaId: c.conversaId, ate: deFora })).data;
      expect(ignorado.mensagens.some((m) => m.id === alvo)).toBe(false);
      // Igual à leitura sem ate: o ate de outra conversa não amplia a janela (mesmas falas, na mesma ordem).
      expect(ignorado.mensagens.map((m) => m.id)).toEqual(semAte.mensagens.map((m) => m.id));
      // Mais de 300 anexos depois do alvo, numa conversa só com eles: o piso dos anexos cortava a fala achada; com o ate, ela vem.
      const anexos = await agenteComConversa(trx, MARLON, { nome: "Lia" });
      const alvoAntigo = await falar(trx, MARLON, anexos.conversaId, "a fala antes dos anexos");
      const repos = criarRepos(trx, MARLON);
      for (let i = 0; i < 305; i++) {
        await repos.mensagens.criar({ conversaId: anexos.conversaId, autoria: autoriaAgente(anexos.agenteId, MARLON.pessoaId), kind: "texto", texto: `anexo ${i}`, confianca: "confiavel", assunto: ASSUNTOS_ANEXO[0]! });
      }
      expect((await executar(deps, lerConversa, { conversaId: anexos.conversaId })).data.mensagens.some((m) => m.id === alvoAntigo)).toBe(false);
      expect((await executar(deps, lerConversa, { conversaId: anexos.conversaId, ate: alvoAntigo })).data.mensagens.some((m) => m.id === alvoAntigo)).toBe(true);
      // Ana não usa o ate para sondar: a conversa nem existe para ela.
      await vincularEscopo(trx, ANA);
      await expect(executar(depsSobreTrx(trx, ANA), lerConversa, { conversaId: c.conversaId, ate: alvo })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  it("sem índice de texto (sob a RLS com FORCE ele não entraria no plano); a função de comparação é IMMUTABLE", async () => {
    await withRollback(MARLON, async (trx) => {
      expect(await trx`select 1 from pg_indexes where tablename = 'mensagens' and indexdef ilike '%nod_sem_acento%'`).toHaveLength(0);
      const [f] = await trx<{ provolatile: string }[]>`select provolatile from pg_proc where proname = 'nod_sem_acento'`;
      expect(f?.provolatile).toBe("i");
    });
  });
});
