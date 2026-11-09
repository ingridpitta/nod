import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { MIDIAS_POR_TURNO, type CabecalhoMidia } from "../../src/contracts/anexo.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { lerAnexo, lerFaixaDoAnexo, localDaMidia, receberAnexo } from "../../src/use-cases/anexos.ts";
import { lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { receberMidiaDoBot, registrarRecusasDeMidia } from "../../src/use-cases/midia-do-bot.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { faixaPedida } from "../../src/adapters/http/util.ts";
import { agenteComConversa, autoriaAgente } from "../helpers/fabricas.ts";
import { ANA, depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { mp4, png, svg } from "../fixtures/midia/construir.ts";

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function turnoRodando(trx: Trx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Chico" });
  const t = (await base.repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "gere a capa", entradaConfianca: "confiavel", modelo: "m" }))!;
  const machineId = randomUUID();
  await trx`update turnos set estado = 'despachando', machine_id = ${machineId}, lease_ate = now() + interval '5 minutes' where id = ${t.id}`;
  const plano = { turnoId: t.id, conversaId: base.conversaId, machineId, pastaDoBot: "Chico" };
  return { ...base, turnoId: t.id, plano, deps: depsSobreTrx(trx, MARLON) };
}

const cab = (b: Uint8Array, o: Partial<CabecalhoMidia> = {}): CabecalhoMidia => ({ nome: "capa.png", caminhoRelativo: "Chico/saida/capa.png", sha256: sha(b), mime: "image/png", ...o });

/**
 * NOD-323 (ADR-126) no Postgres: a mídia do bot nasce solta no turno, idempotente por sha256, com o tipo refarejado no
 * servidor, o caminho preso à pasta do bot e o teto por turno; o assentar a prende à fala; a RLS separa pessoas.
 */
describeIntegracao("mídia gerada pelo bot (NOD-323)", () => {
  it("png: nasce solta com medidas, a nova tentativa devolve o mesmo id, prende na fala e aparece na conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, plano, repos, turnoId, agenteId, conversaId } = await turnoRodando(trx);
      const b = png(1200, 630);
      const um = (await executar(deps, receberMidiaDoBot, { plano, cabecalho: cab(b), conteudo: b, sha256Recebido: sha(b) })).data;
      expect(um).toMatchObject({ ok: true, familia: "imagem", exibicao: "midia", semBytes: false, novo: true });
      const dois = (await executar(deps, receberMidiaDoBot, { plano, cabecalho: cab(b), conteudo: b, sha256Recebido: sha(b) })).data;
      expect(dois).toMatchObject({ ok: true, novo: false });
      if (!um.ok || !dois.ok) throw new Error("upload");
      expect(dois.id).toBe(um.id);

      const fala = await repos.mensagens.criar({ conversaId, kind: "texto", texto: "Pronto, a capa:", confianca: "confiavel", turnoId, autoria: autoriaAgente(agenteId, MARLON.pessoaId) });
      const mensagemId = fala!.id;
      expect(await repos.anexos.prenderDoTurno(turnoId, mensagemId)).toEqual([um.id]);
      const conversa = (await executar(deps, lerConversa, { conversaId })).data;
      const m = conversa.mensagens.find((x) => x.id === mensagemId);
      expect(m?.anexos).toEqual([{ id: um.id, nome: "capa.png", mime: "image/png", tamanho: b.byteLength, origem: "bot", largura: 1200, altura: 630 }]);
    });
  });

  it("apagar o turno não quebra no CHECK: a mídia fica, sem turno (revisão do #507, B1)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, plano, turnoId } = await turnoRodando(trx);
      const b = png(8, 8);
      const r = (await executar(deps, receberMidiaDoBot, { plano, cabecalho: cab(b), conteudo: b, sha256Recebido: sha(b) })).data;
      if (!r.ok) throw new Error("upload");
      // O FK `ON DELETE SET NULL (turno_id)` faz o mesmo que este update; o CHECK da mídia do bot tem de aceitar.
      await trx`update anexos set turno_id = null where id = ${r.id} and turno_id = ${turnoId}`;
      const [l] = await trx<{ turno_id: string | null }[]>`select turno_id from anexos where id = ${r.id}`;
      expect(l).toEqual({ turno_id: null });
      const [fk] = await trx<{ def: string }[]>`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'anexo_turno_fk'`;
      expect(fk!.def).toContain("ON DELETE SET NULL (turno_id)");
    });
  });

  it("recusa: tipo declarado diferente, SVG, sha256 que não bate, caminho fora da pasta e turno que já assentou", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, plano, turnoId } = await turnoRodando(trx);
      const b = png(10, 10);
      const enviar = (cabecalho: CabecalhoMidia, conteudo: Uint8Array = b, s: string | null = sha(conteudo)) =>
        executar(deps, receberMidiaDoBot, { plano, cabecalho, conteudo, sha256Recebido: s }).then((r) => r.data);
      expect(await enviar(cab(b, { mime: "image/jpeg" }))).toEqual({ ok: false, motivo: "tipo_nao_suportado" });
      const s = svg();
      expect(await enviar(cab(s, { mime: "image/svg+xml" }), s)).toEqual({ ok: false, motivo: "tipo_nao_suportado" });
      expect(await enviar(cab(b), b, "0".repeat(64))).toEqual({ ok: false, motivo: "entrada_invalida" });
      for (const caminhoRelativo of ["Outro/capa.png", "Chico/../Outro/x.png", "/Users/m/nod/Chico/x.png", "Chico"]) {
        expect(await enviar(cab(b, { caminhoRelativo }))).toEqual({ ok: false, motivo: "entrada_invalida" });
      }
      // Cabe no limite e veio sem bytes: não vira cartão (o proxy não escolhe o que o servidor guarda).
      expect(await enviar(cab(b, { tamanhoReal: 100 }), new Uint8Array(), null)).toEqual({ ok: false, motivo: "entrada_invalida" });
      await trx`update turnos set estado = 'concluido' where id = ${turnoId}`;
      expect(await enviar(cab(b))).toEqual({ ok: false, motivo: "turno_encerrado" });
    });
  });

  it("vídeo acima de 50 MiB vira cartão sem bytes (nada é servido); abaixo, o Range devolve só a fatia", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, plano, conversaId } = await turnoRodando(trx);
      const grande = (await executar(deps, receberMidiaDoBot, {
        plano, cabecalho: { nome: "demo.mp4", caminhoRelativo: "Chico/demo.mp4", sha256: "a".repeat(64), mime: "video/mp4", tamanhoReal: 80 * 1024 * 1024, largura: 1920, altura: 1080, duracaoMs: 42_000 },
        conteudo: new Uint8Array(), sha256Recebido: null,
      })).data;
      expect(grande).toMatchObject({ ok: true, familia: "video", exibicao: "cartao_grande", semBytes: true });
      if (!grande.ok) throw new Error("upload");
      await expect(executar(deps, lerAnexo, { conversaId, anexoId: grande.id })).rejects.toMatchObject({ codigo: "nao_encontrado" });

      const v = mp4(640, 360, 3000);
      const ok = (await executar(deps, receberMidiaDoBot, { plano, cabecalho: { nome: "v.mp4", caminhoRelativo: "Chico/v.mp4", sha256: sha(v), mime: "video/mp4" }, conteudo: v, sha256Recebido: sha(v) })).data;
      if (!ok.ok) throw new Error(`upload: ${ok.motivo}`);
      const f = (await executar(deps, lerFaixaDoAnexo, { conversaId, anexoId: ok.id, faixa: (t) => faixaPedida("bytes=4-11", t) })).data;
      expect(f && "faixa" in f ? f.faixa : null).toEqual({ inicio: 4, fim: 11, total: v.byteLength });
      expect(f && "bytes" in f ? new Uint8Array(f.bytes) : null).toEqual(v.subarray(4, 12));
      const fora = (await executar(deps, lerFaixaDoAnexo, { conversaId, anexoId: ok.id, faixa: (t) => faixaPedida(`bytes=${v.byteLength}-`, t) })).data;
      expect(fora).toEqual({ invalida: v.byteLength });
    });
  });

  it("arquivo de 3 GiB vira cartão sem estourar a coluna int; medida fora do int é recusada (revisão 2, M1)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, plano } = await turnoRodando(trx);
      const enorme = (await executar(deps, receberMidiaDoBot, {
        plano, cabecalho: { nome: "longo.mov", caminhoRelativo: "Chico/longo.mov", sha256: "b".repeat(64), mime: "video/quicktime", tamanhoReal: 3 * 2 ** 30 },
        conteudo: new Uint8Array(), sha256Recebido: null,
      })).data;
      expect(enorme).toMatchObject({ ok: true, exibicao: "cartao_grande", semBytes: true });
      const [linha] = await trx<{ tamanho: number }[]>`select tamanho from anexos where origem = 'bot' and sha256 = ${"b".repeat(64)}`;
      expect(linha!.tamanho).toBe(2 ** 31 - 1);
      const torto = (await executar(deps, receberMidiaDoBot, {
        plano, cabecalho: { nome: "x.mp4", caminhoRelativo: "Chico/x.mp4", sha256: "c".repeat(64), mime: "video/mp4", tamanhoReal: 80 * 1024 * 1024, largura: 2 ** 31 },
        conteudo: new Uint8Array(), sha256Recebido: null,
      })).data;
      expect(torto).toEqual({ ok: false, motivo: "entrada_invalida" });
    });
  });

  it(`teto de ${MIDIAS_POR_TURNO} por turno; a repetição de uma já guardada ainda devolve o id`, async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, plano } = await turnoRodando(trx);
      const ids: string[] = [];
      for (let i = 1; i <= MIDIAS_POR_TURNO; i++) {
        const b = png(i, i);
        const r = (await executar(deps, receberMidiaDoBot, { plano, cabecalho: cab(b), conteudo: b, sha256Recebido: sha(b) })).data;
        if (!r.ok) throw new Error(r.motivo);
        ids.push(r.id);
      }
      const nova = png(999, 999);
      expect((await executar(deps, receberMidiaDoBot, { plano, cabecalho: cab(nova), conteudo: nova, sha256Recebido: sha(nova) })).data).toEqual({ ok: false, motivo: "limite_por_turno" });
      const repetida = png(1, 1);
      expect((await executar(deps, receberMidiaDoBot, { plano, cabecalho: cab(repetida), conteudo: repetida, sha256Recebido: sha(repetida) })).data).toMatchObject({ ok: true, id: ids[0] });
    });
  });

  it("recusas somam por código num UPDATE só; turno encerrado não muda", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, turnoId, repos } = await turnoRodando(trx);
      await executar(deps, registrarRecusasDeMidia, { turnoId, recusas: [{ motivo: "credencial", n: 1 }] });
      await executar(deps, registrarRecusasDeMidia, { turnoId, recusas: [{ motivo: "credencial", n: 2 }, { motivo: "fora_da_pasta", n: 1 }] });
      expect(await repos.turnos.recusasDeMidia(turnoId)).toEqual([{ motivo: "credencial", n: 3 }, { motivo: "fora_da_pasta", n: 1 }]);
      await expect(executar(deps, registrarRecusasDeMidia, { turnoId, recusas: [{ motivo: "/etc/passwd", n: 1 }] })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      await trx`update turnos set estado = 'concluido' where id = ${turnoId}`;
      expect((await executar(deps, registrarRecusasDeMidia, { turnoId, recusas: [{ motivo: "vazio", n: 1 }] })).data).toEqual({ ok: false });
    });
  });

  it("CHECKs: a pessoa continua sem vídeo; o bot não guarda caminho com ..", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, conversaId, turnoId } = await turnoRodando(trx);
      await expect(executar(deps, receberAnexo, { conversaId, nome: "v.mp4", mime: "video/mp4", conteudo: mp4(1, 1, 1) })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      await expect(trx.savepoint((sp) => sp`insert into anexos (tenant_id, owner_id, conversa_id, nome, mime, tamanho, conteudo)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${conversaId}, 'v.mp4', 'video/mp4', 4, '\\x00000000'::bytea)`)).rejects.toThrow(/anexo_mime/);
      await expect(trx.savepoint((sp) => sp`insert into anexos (tenant_id, owner_id, conversa_id, nome, mime, tamanho, conteudo, origem, turno_id, sha256, caminho_relativo)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${conversaId}, 'x.png', 'image/png', 4, '\\x00000000'::bytea, 'bot', ${turnoId}, ${"b".repeat(64)}, 'Chico/../x')`)).rejects.toThrow(/anexo_caminho_relativo/);
    });
  });

  it("Mostrar no Finder (J5): a dona recebe só o caminho relativo e a máquina; outra conversa e outra pessoa, 404", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, plano: p0, conversaId } = await turnoRodando(trx);
      const [mac] = await trx<{ id: string }[]>`insert into maquinas (tenant_id, owner_id, nome) values (${MARLON.tenantId}, ${MARLON.pessoaId}, 'MacBook') returning id`;
      if (!mac) throw new Error("máquina");
      await trx`update turnos set machine_id = ${mac.id} where id = ${p0.turnoId}`;
      const plano = { ...p0, machineId: mac.id };
      const grande = (await executar(deps, receberMidiaDoBot, {
        plano, cabecalho: { nome: "demo.mp4", caminhoRelativo: "Chico/demo.mp4", sha256: "b".repeat(64), mime: "video/mp4", tamanhoReal: 80 * 1024 * 1024 },
        conteudo: new Uint8Array(), sha256Recebido: null,
      })).data;
      if (!grande.ok) throw new Error(grande.motivo);
      expect((await executar(deps, localDaMidia, { conversaId, anexoId: grande.id })).data).toEqual({ caminhoRelativo: "Chico/demo.mp4", maquinaId: plano.machineId });
      await expect(executar(deps, localDaMidia, { conversaId: randomUUID(), anexoId: grande.id })).rejects.toMatchObject({ codigo: "nao_encontrado" });
      await vincularEscopo(trx, ANA);
      await expect(executar(depsSobreTrx(trx, ANA), localDaMidia, { conversaId, anexoId: grande.id })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  it("RLS: outra pessoa não lê a mídia do bot de Marlon", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, plano, conversaId } = await turnoRodando(trx);
      const b = png(5, 5);
      const r = (await executar(deps, receberMidiaDoBot, { plano, cabecalho: cab(b), conteudo: b, sha256Recebido: sha(b) })).data;
      if (!r.ok) throw new Error(r.motivo);
      await vincularEscopo(trx, ANA);
      const daAna = depsSobreTrx(trx, ANA);
      expect(await daAna.repos.anexos.buscar(r.id)).toBeNull();
      await expect(executar(daAna, lerAnexo, { conversaId, anexoId: r.id })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
  const resultado = (texto: string) => ({ desfecho: "sucesso" as const, texto, sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] });

  it("assentar prende a mídia do turno à fala final, na ordem; a linha de recusas vai só nela; sem texto a fala entra vazia", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, plano, turnoId, conversaId } = await turnoRodando(trx);
      const a = png(30, 20);
      const b = png(40, 20);
      const r1 = (await executar(deps, receberMidiaDoBot, { plano, cabecalho: cab(a, { nome: "a.png" }), conteudo: a, sha256Recebido: sha(a) })).data;
      const r2 = (await executar(deps, receberMidiaDoBot, { plano, cabecalho: cab(b, { nome: "b.png" }), conteudo: b, sha256Recebido: sha(b) })).data;
      if (!r1.ok || !r2.ok) throw new Error("upload");
      await executar(deps, registrarRecusasDeMidia, { turnoId, recusas: [{ motivo: "fora_da_pasta", n: 1 }] });
      const s = (await executar(deps, assentarTurno, { turnoId, machineId: plano.machineId, seqLocal: 1, fala: { tipo: "texto", texto: "Anexei abaixo." }, resultado: resultado("Anexei abaixo."), executor: "catcher" })).data;
      expect(s.mensagem?.anexos?.map((x) => x.id)).toEqual([r1.id, r2.id]);
      const conversa = (await executar(deps, lerConversa, { conversaId })).data;
      const fala = conversa.mensagens.find((m) => m.id === s.mensagem?.id);
      expect(fala?.anexos?.map((x) => x.nome)).toEqual(["a.png", "b.png"]);
      expect(fala?.midiaRecusas).toEqual([{ motivo: "fora_da_pasta", n: 1 }]);
      expect(conversa.mensagens.filter((m) => m.id !== fala?.id).some((m) => m.midiaRecusas)).toBe(false);
      // Depois do assentar, nada mais entra no turno.
      const tarde = png(50, 50);
      expect((await executar(deps, receberMidiaDoBot, { plano, cabecalho: cab(tarde), conteudo: tarde, sha256Recebido: sha(tarde) })).data).toEqual({ ok: false, motivo: "turno_encerrado" });
    });
    await withRollback(MARLON, async (trx) => {
      const { deps, plano, turnoId } = await turnoRodando(trx);
      const a = png(8, 8);
      const r = (await executar(deps, receberMidiaDoBot, { plano, cabecalho: cab(a), conteudo: a, sha256Recebido: sha(a) })).data;
      if (!r.ok) throw new Error("upload");
      // NOD-353 (QA do #523): a fala vazia que leva a mídia também leva o resumo das ações do turno.
      const s = (await executar(deps, assentarTurno, { turnoId, machineId: plano.machineId, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: { ...resultado(""), ferramentasChamadas: ["Write", "Bash"], ferramentasFalharam: [1] }, executor: "catcher" })).data;
      expect(s.mensagem).toMatchObject({ kind: "texto", texto: "", payload: { kind: "acoes_do_turno", acoes: [{ rotulo: "Escreveu um arquivo" }, { rotulo: "Rodou um comando", falhou: true }] } });
      expect(s.mensagem?.anexos?.map((x) => x.id)).toEqual([r.id]);
    });
  });

  it("o varredor apaga a mídia do bot solta há mais de um dia (turno já acabado) e deixa a presa, a recente e a do turno vivo", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, plano, repos, turnoId, agenteId, conversaId } = await turnoRodando(trx);
      const ids: string[] = [];
      for (const w of [1, 2, 3]) {
        const b = png(w, w);
        const r = (await executar(deps, receberMidiaDoBot, { plano, cabecalho: cab(b), conteudo: b, sha256Recebido: sha(b) })).data;
        if (!r.ok) throw new Error("upload");
        ids.push(r.id);
      }
      const fala = await repos.mensagens.criar({ conversaId, kind: "texto", texto: "x", confianca: "confiavel", turnoId, autoria: autoriaAgente(agenteId, MARLON.pessoaId) });
      await trx`update anexos set mensagem_id = ${fala!.id} where id = ${ids[0]!}`;
      await trx`update anexos set criado_em = now() - interval '25 hours' where id = any(${[ids[0]!, ids[1]!]}::uuid[])`;
      // O turno ainda roda (sem relógio, ADR-067): nada dele sai, por mais antigo que seja (Codex no #507).
      expect(await repos.anexos.apagarSoltosDoBot(new Date(Date.now() - 24 * 3600_000))).toBe(0);
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'turno_travado' where id = ${turnoId}`;
      const apagados = await repos.anexos.apagarSoltosDoBot(new Date(Date.now() - 24 * 3600_000));
      expect(apagados).toBe(1);
      expect(await repos.anexos.buscar(ids[0]!)).not.toBeNull();
      expect(await repos.anexos.buscar(ids[1]!)).toBeNull();
      expect(await repos.anexos.buscar(ids[2]!)).not.toBeNull();
    });
  });
});
