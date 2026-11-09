import { afterEach, describe, expect, it, vi } from "vitest";
import type { MsgCerebroServidor, MsgMidiaServidor } from "../../../src/contracts/voz.ts";
import { criarServicoVoz, NOTA_CONEXAO_VOLTOU, prioridadeTts, type FalaParaGravar, type FonteDeEsperas, type MetricasVoz, type RegistroLigacao } from "../../../src/adapters/voz/orquestrador.ts";
import { criarProvedoresFalsos } from "../../../src/adapters/voz/voz-falsa.ts";
import type { OpcoesSessaoStt, PedidoTts, Sintetizador, Transcritor } from "../../../src/adapters/voz/spi.ts";
import type { CanalVoz } from "../../../src/adapters/voz/ws.ts";
import { FECHAMENTOS_VOZ, type MotivoFimLigacao } from "../../../src/contracts/voz.ts";
import { FALAS_DE_ESPERA } from "../../../src/domain/ligacao-espera.ts";

/**
 * Orquestrador de voz com canais e provedores falsos (definido em 2026-10-04, ADR-071/073/074): sem socket, sem banco,
 * com prazos curtos. O e2e (tests/concurrency/ligacao-catcher.test.ts) cobre o caminho feliz pelo servidor inteiro;
 * aqui ficam as bordas — interrupção, backchannel, quedas, tempo máximo e comando de voz.
 */
type CanalFalso = CanalVoz & { json: Record<string, unknown>[]; binarios: number; fechadoCom: number | null; receber(m: object | Uint8Array): void; cair(): void };

function canalFalso(): CanalFalso {
  let aoMsg: ((m: { texto: string } | { binario: Uint8Array }) => void) | null = null;
  let aoFim: ((c: number) => void) | null = null;
  const c: CanalFalso = {
    json: [],
    binarios: 0,
    fechadoCom: null,
    enviarJson(m) { c.json.push(m as Record<string, unknown>); },
    enviarBinario() { c.binarios++; },
    fechar(codigo) { c.fechadoCom = codigo; },
    aoMensagem(fn) { aoMsg = fn; },
    aoFechar(fn) { aoFim = fn; },
    pendente: () => 0,
    receber(m) { aoMsg?.(m instanceof Uint8Array ? { binario: m } : { texto: JSON.stringify(m) }); },
    cair() { aoFim?.(1006); },
  };
  return c;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ate<T>(f: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const fim = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > fim) throw new Error("tempo esgotado");
    await dormir(10);
  }
}

function quadro(seq: number, voz: boolean): Uint8Array {
  const b = new Uint8Array(5 + 640);
  const v = new DataView(b.buffer);
  v.setUint8(0, 1);
  v.setUint32(1, seq, true);
  for (let i = 0; i < 320; i++) v.setInt16(5 + i * 2, voz ? Math.round(Math.sin((i + seq * 320) / 6) * 9000) : 0, true);
  return b;
}

function montar(o: { roteiro?: string[]; maxS?: number; prazos?: Record<string, number>; tts?: Sintetizador; esperas?: FonteDeEsperas; aleatorio?: () => number; parciais?: boolean; stt?: Transcritor; ligacaoId?: string; relogio?: () => number } = {}) {
  const falsos = criarProvedoresFalsos({ roteiro: o.roteiro ?? [], silencioso: true, parciais: o.parciais === true });
  const provedores = o.tts ? { ...falsos, tts: o.tts } : falsos;
  const falas: FalaParaGravar[] = [];
  const fins: { motivo: MotivoFimLigacao; metricas: MetricasVoz }[] = [];
  const voz = criarServicoVoz({
    provedores: o.stt ? { ...provedores, stt: o.stt } : provedores,
    persistencia: {
      atender: async () => undefined,
      gravarFala: async (_r, f) => { falas.push(f); },
      encerrar: async (_r, motivo, metricas) => { fins.push({ motivo, metricas }); },
    },
    aleatorio: o.aleatorio ?? (() => 0.99),
    ...(o.esperas ? { esperas: o.esperas } : {}),
    ...(o.relogio ? { relogio: o.relogio } : {}),
    prazos: { midiaReconexaoMs: 100, cerebroReconexaoMs: 150, cerebroPrimeiroMs: 5000, confirmarInterrupcaoMs: 300, resumoMs: 50, ...o.prazos },
  });
  const id = o.ligacaoId ?? "l1";
  const reg: RegistroLigacao = { ligacaoId: id, tenantId: "t", pessoaId: "p", agenteId: "a", conversaId: "c", turnoId: "turno", voz: "clara", velocidade: 1, nomeBot: "Nina", genero: "feminina", maxS: o.maxS ?? 600 };
  voz.registrar(reg);
  const midia = canalFalso();
  const cerebro = canalFalso();
  return { voz, provedores, falas, fins, midia, cerebro, id };
}

/**
 * Uma fala no ritmo do app: blocos de 100 ms (5 quadros) em tempo real. Em rajada, ~2,3 s de áudio logo depois de a mídia
 * abrir passam de 1,2× o tempo real + 2 s e a guarda de abuso fecha a mídia no meio do teste (NOD-184).
 */
async function falarNoRitmo(midia: CanalFalso, seq: { n: number }, quadrosComVoz: number, quadrosDeSilencio: number): Promise<void> {
  const total = quadrosComVoz + quadrosDeSilencio;
  for (let i = 0; i < total; i++) {
    midia.receber(quadro(seq.n++, i < quadrosComVoz));
    if (i % 5 === 4) await dormir(100);
  }
}

/** O "alto-falante" do teste: relata que tudo o que já foi mandado terminou de tocar. */
function tocouTudo(midia: CanalFalso): void {
  for (const m of midia.json) if (m.t === "bot-fala") midia.receber({ t: "tocou-fim", utt: m.utt });
}

const msgs = (c: CanalFalso, t: string) => c.json.filter((m) => m.t === t) as (MsgMidiaServidor & MsgCerebroServidor & Record<string, unknown>)[];

/** TTS lento (como o Google, ~1,2 s por frase) que anota quando cada síntese começou e terminou. */
function ttsLento(ms: number, streaming = false) {
  const log: { texto: string; inicio: number; fim: number | null; abortada: boolean }[] = [];
  const tts: Sintetizador = {
    id: "lento",
    capacidades: { streaming, velocidade: true },
    async *sintetizar(p) {
      const reg = { texto: p.texto, inicio: Date.now(), fim: null as number | null, abortada: false };
      log.push(reg);
      await new Promise<void>((ok) => {
        const t = setTimeout(ok, ms);
        p.sinal?.addEventListener("abort", () => { clearTimeout(t); ok(); });
      });
      if (p.sinal?.aborted) {
        reg.abortada = true;
        return;
      }
      reg.fim = Date.now();
      yield new Int16Array(2400 * 10);
    },
  };
  return { tts, log };
}

describe("orquestrador de voz", () => {
  it("sintetiza a frase seguinte enquanto a da frente ainda está saindo (voz lenta não soma o tempo de cada frase)", async () => {
    const { tts, log } = ttsLento(150);
    const { voz, midia, cerebro } = montar({ tts });
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    await ate(() => log[0]?.fim);
    midia.receber({ t: "texto", conteudo: "me conta duas coisas" });
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Primeira coisa que eu queria te contar hoje. Segunda coisa importante também. Terceira e última coisa. " });
    cerebro.receber({ t: "fala-fim", n: 1 });
    await ate(() => log.length >= 4 && log.every((x) => x.fim));
    const [, a, b, c] = log;
    // A segunda começou antes de a primeira terminar; a terceira, antes de a segunda terminar.
    expect(b!.inicio).toBeLessThan(a!.fim!);
    expect(c!.inicio).toBeLessThan(b!.fim!);
    expect(msgs(midia, "bot-fala").filter((m) => m.tipo === "conteudo").map((m) => m.texto)).toEqual(["Oi! Aqui é Nina.", "Primeira coisa que eu queria te contar hoje.", "Segunda coisa importante também.", "Terceira e última coisa."]);
  });

  it("o 'Beleza,' repetido só sai da primeira frase da vez em que tocou o reconhecimento — não das vezes seguintes", async () => {
    const esperas: FonteDeEsperas = { obterPronto: () => new Int16Array(2400), aquecer: () => undefined };
    const { voz, midia, cerebro } = montar({ esperas, aleatorio: () => 0.1 });
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    await dormir(30);
    tocouTudo(midia);
    midia.receber({ t: "texto", conteudo: "me explica o que você faz" });
    await ate(() => msgs(midia, "bot-fala").find((m) => m.tipo === "espera"));
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Beleza, eu organizo suas tarefas. Beleza, e também lembro de tudo. " });
    cerebro.receber({ t: "fala-fim", n: 1 });
    await ate(() => msgs(midia, "bot-fala").find((m) => String(m.texto).includes("lembro")));
    tocouTudo(midia);
    midia.receber({ t: "texto", conteudo: "valeu pode desligar agora" });
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 2));
    cerebro.receber({ t: "fala", n: 2, seq: 0, delta: "Beleza, Marlon. Até a próxima! " });
    cerebro.receber({ t: "fala-fim", n: 2 });
    await ate(() => msgs(midia, "bot-fala").find((m) => String(m.texto).includes("próxima")));
    const ditas = msgs(midia, "bot-fala").filter((m) => m.tipo === "conteudo").map((m) => m.texto);
    expect(ditas).toContain("Eu organizo suas tarefas.");
    expect(ditas).toContain("Beleza, e também lembro de tudo.");
    expect(ditas).toContain("Beleza, Marlon.");
  });

  it("com a voz lenta, a espera toca enquanto a resposta ainda está sendo sintetizada (antes o texto calava a espera)", async () => {
    const { tts, log } = ttsLento(800);
    const esperas: FonteDeEsperas = { obterPronto: () => new Int16Array(2400), aquecer: () => undefined };
    const { voz, midia, cerebro } = montar({ tts, esperas, aleatorio: () => 0.1 });
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    await ate(() => log[0]?.fim);
    tocouTudo(midia);
    midia.receber({ t: "texto", conteudo: "me conta o que você faz" });
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    // O texto chega logo; o áudio dele, 800 ms depois.
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Eu organizo suas tarefas do dia a dia. " });
    cerebro.receber({ t: "fala-fim", n: 1 });
    const espera = await ate(() => msgs(midia, "bot-fala").find((m) => m.tipo === "espera"));
    const sinteseDaResposta = log.find((x) => x.texto.includes("organizo"))!;
    expect(espera).toBeTruthy();
    expect(sinteseDaResposta.fim).toBeNull();
    await ate(() => sinteseDaResposta.fim);
  });

  it("interromper cancela as sínteses adiantadas", async () => {
    const { tts, log } = ttsLento(300);
    const { voz, midia, cerebro } = montar({ tts });
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    await ate(() => log[0]?.fim);
    tocouTudo(midia);
    midia.receber({ t: "texto", conteudo: "me conta" });
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Primeira coisa que eu queria te contar hoje. Segunda coisa importante também. Terceira e última coisa. " });
    await ate(() => log.length >= 3);
    midia.receber({ t: "texto", conteudo: "para" });
    await ate(() => msgs(cerebro, "interromper").length > 0);
    await dormir(350);
    expect(log.slice(1).every((x) => x.abortada || x.fim !== null)).toBe(true);
    expect(log.slice(2).some((x) => x.abortada)).toBe(true);
  });

  it("anexa mídia e cérebro: saúda, aquece o cérebro com a vez 0 e recusa segunda mídia sem retomar", async () => {
    const { voz, midia, cerebro } = montar();
    expect(voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia })).toBeNull();
    expect(voz.anexarMidia({ pessoaId: "outra", ligacaoId: "l1", retomar: false, canal: canalFalso() })).toBe(4404);
    expect(voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: canalFalso() })).toBe(4409);
    expect(msgs(midia, "pronto")).toHaveLength(1);
    expect(msgs(midia, "bot-fala")[0]?.texto).toBe("Oi! Aqui é Nina.");
    expect(voz.anexarCerebro({ turnoId: "outro", ligacaoId: "l1", canal: cerebro })).toBe(4404);
    expect(voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro })).toBeNull();
    expect(msgs(cerebro, "vez")[0]).toMatchObject({ n: 0 });
    expect(msgs(midia, "cerebro").at(-1)).toMatchObject({ online: true });
  });

  it("texto vira vez; a fala do cérebro vira bot-fala com áudio; a vez 0 nunca é falada", async () => {
    const { voz, midia, cerebro, falas } = montar();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    cerebro.receber({ t: "fala", n: 0, seq: 0, delta: "ok" });
    midia.receber({ t: "texto", conteudo: "quero uma rotina" });
    const vez = await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    expect(vez.texto).toBe("quero uma rotina");
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Claro, vamos criar. " });
    cerebro.receber({ t: "fala-fim", n: 1 });
    await ate(() => msgs(midia, "bot-fala").find((m) => m.tipo === "conteudo" && String(m.texto).includes("vamos criar")));
    expect(msgs(midia, "bot-fala").some((m) => m.texto === "ok")).toBe(false);
    expect(midia.binarios).toBeGreaterThan(0);
    await ate(() => falas.find((f) => f.autor === "bot" && f.texto.includes("vamos criar")));
  });

  it("fala por cima do bot: confirma a interrupção, manda interromper ao cliente e ao cérebro, e a próxima vez leva o 'ouviu até'", async () => {
    const { voz, midia, cerebro, provedores } = montar();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    await dormir(30);
    tocouTudo(midia);
    midia.receber({ t: "texto", conteudo: "me explica tudo" });
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Esta é uma explicação muito longa que vai tocar por bastante tempo no alto-falante, com várias frases. " });
    await ate(() => msgs(midia, "bot-fala").find((m) => m.tipo === "conteudo" && String(m.texto).includes("explicação")));
    provedores.stt.empurrarTexto("espera, para");
    let seq = 0;
    for (let i = 0; i < 25; i++) midia.receber(quadro(seq++, true));
    for (let i = 0; i < 50; i++) midia.receber(quadro(seq++, false));
    await ate(() => msgs(midia, "interromper").length > 0);
    await ate(() => msgs(cerebro, "interromper").length > 0);
    const vez2 = await ate(() => msgs(cerebro, "vez").find((v) => v.n === 2));
    expect(vez2.texto).toContain("espera");
    expect(typeof vez2.ouvidoAte === "string" || vez2.ouvidoAte === undefined).toBe(true);
  });

  it.each([
    ["fone", true],
    ["alto-falante", false],
  ] as const)("com %s, 400 ms de fala sem texto por cima do bot interrompe? %s", async (rota, interrompe) => {
    const { voz, midia, cerebro } = montar({ prazos: { interrupcaoPorFalaFoneMs: 200, confirmarInterrupcaoMs: 5000 } });
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    midia.receber({ t: "saida", rota });
    await dormir(30);
    tocouTudo(midia);
    midia.receber({ t: "texto", conteudo: "me explica" });
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Esta é uma explicação muito longa que vai tocar por bastante tempo, com várias frases. " });
    await ate(() => msgs(midia, "bot-fala").find((m) => m.tipo === "conteudo" && String(m.texto).includes("explicação")));
    let seq = 0;
    for (let i = 0; i < 20; i++) {
      midia.receber(quadro(seq++, true));
      await dormir(20);
    }
    expect(msgs(cerebro, "interromper").length > 0).toBe(interrompe);
  });

  it("alto-falante: o eco da 3ª frase (mandada junto, tocando depois) é eco — não interrompe nem vira vez (teste do Marlon)", async () => {
    const { voz, midia, cerebro, provedores } = montar({ prazos: { confirmarInterrupcaoMs: 5000 } });
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    midia.receber({ t: "saida", rota: "alto-falante" });
    await dormir(30);
    tocouTudo(midia);
    midia.receber({ t: "texto", conteudo: "me conta três coisas" });
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    // Três frases de ~1,2 s mandadas de uma vez: a terceira só toca de ~2,4 s a ~3,6 s.
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Primeira coisa aqui. Segunda coisa aqui. Terceira coisa aqui. " });
    cerebro.receber({ t: "fala-fim", n: 1 });
    await ate(() => msgs(midia, "bot-fala").find((m) => String(m.texto).includes("Terceira")));
    await dormir(2300);
    // O microfone pega a terceira frase de volta, longa (mais que os 600 ms de antes).
    provedores.stt.empurrarTexto("Terceira coisa aqui.");
    let seq = 0;
    for (let i = 0; i < 40; i++) {
      midia.receber(quadro(seq++, true));
      if (i % 10 === 0) await dormir(100);
    }
    for (let i = 0; i < 40; i++) midia.receber(quadro(seq++, false));
    // A vez sairia 600 ms depois do fim da fala; espera de sobra.
    await dormir(1500);
    expect(msgs(cerebro, "interromper")).toHaveLength(0);
    expect(msgs(cerebro, "vez").find((v) => v.n === 2)).toBeUndefined();
  });

  it("'uhum' com o bot falando não interrompe: vai só para a transcrição e o volume volta", async () => {
    const { voz, midia, cerebro, provedores, falas } = montar();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    await dormir(30);
    tocouTudo(midia);
    midia.receber({ t: "texto", conteudo: "fala comigo" });
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Esta é uma resposta comprida que segue tocando por um bom tempo, sem pressa nenhuma. " });
    await ate(() => msgs(midia, "bot-fala").find((m) => m.tipo === "conteudo"));
    provedores.stt.empurrarTexto("uhum");
    let seq = 0;
    for (let i = 0; i < 8; i++) midia.receber(quadro(seq++, true));
    for (let i = 0; i < 40; i++) midia.receber(quadro(seq++, false));
    await ate(() => falas.find((f) => f.autor === "pessoa" && f.texto === "uhum"));
    expect(msgs(midia, "interromper")).toHaveLength(0);
    expect(msgs(cerebro, "vez").some((v) => v.n === 2)).toBe(false);
  });

  it("cérebro cai e não volta no prazo: a ligação encerra com cerebro_caiu", async () => {
    const { voz, midia, cerebro, fins } = montar();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    cerebro.cair();
    expect(msgs(midia, "cerebro").at(-1)).toMatchObject({ online: false });
    await ate(() => fins.length > 0, 2000);
    expect(fins[0]?.motivo).toBe("cerebro_caiu");
    expect(msgs(midia, "fim").at(-1)).toMatchObject({ motivo: "cerebro_caiu" });
  });

  it("mídia cai e volta com retomar no prazo: a ligação segue", async () => {
    const { voz, midia, fins } = montar({ prazos: { midiaReconexaoMs: 400 } });
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    midia.cair();
    await dormir(100);
    const nova = canalFalso();
    expect(voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: true, canal: nova })).toBeNull();
    await dormir(500);
    expect(fins).toHaveLength(0);
    expect(msgs(nova, "pronto")).toHaveLength(1);
  });

  it("tempo máximo: encerra com tempo_maximo", async () => {
    const { voz, midia, fins } = montar({ maxS: 0.3 });
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    await ate(() => fins.length > 0, 3000);
    expect(fins[0]?.motivo).toBe("tempo_maximo");
  });

  it("tchau encerra com pessoa_desligou e manda fim ao cérebro (que então pede o resumo)", async () => {
    const { voz, midia, cerebro, fins } = montar();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    midia.receber({ t: "tchau" });
    await ate(() => fins.length > 0);
    expect(fins[0]?.motivo).toBe("pessoa_desligou");
    expect(msgs(cerebro, "fim")).toHaveLength(1);
    expect(voz.vivas()).toBe(0);
  });

  it("aprovação por voz: comando só vale uma vez, para a decisão e a ação certas, e não vale para outra pessoa", async () => {
    const { voz, midia, cerebro, provedores } = montar();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    await dormir(50);
    for (const m of msgs(midia, "bot-fala")) midia.receber({ t: "tocou-fim", utt: m.utt });
    voz.pedirAprovacao("l1", { decisaoId: "d1", leitura: "Mandar 1 e-mail. Para aprovar, diga 'eu aprovo'.", perfil: "estrito" });
    const leitura = await ate(() => msgs(midia, "bot-fala").find((m) => m.tipo === "leitura"));
    midia.receber({ t: "tocou-fim", utt: leitura.utt });
    await ate(() => msgs(midia, "janela").length > 0);
    await dormir(80);
    provedores.stt.empurrarTexto("eu aprovo");
    let seq = 0;
    for (let i = 0; i < 20; i++) midia.receber(quadro(seq++, true));
    for (let i = 0; i < 40; i++) midia.receber(quadro(seq++, false));
    const cmd = await ate(() => msgs(midia, "comando")[0]);
    expect(cmd).toMatchObject({ decisaoId: "d1", acao: "aprovar" });
    expect(msgs(cerebro, "vez").some((v) => v.n === 1)).toBe(false);
    const comandoId = String(cmd.comandoId);
    expect(voz.conferirComando({ pessoaId: "outra", ligacaoId: "l1", comandoId, decisaoId: "d1", acao: "aprovar" })).toBe(false);
    expect(voz.conferirComando({ pessoaId: "p", ligacaoId: "l1", comandoId, decisaoId: "d1", acao: "recusar" })).toBe(false);
    expect(voz.conferirComando({ pessoaId: "p", ligacaoId: "l1", comandoId, decisaoId: "d1", acao: "aprovar" })).toBe(true);
    expect(voz.conferirComando({ pessoaId: "p", ligacaoId: "l1", comandoId, decisaoId: "d1", acao: "aprovar" })).toBe(false);
    voz.decisaoDecidida("l1", { decisaoId: "d1", resultado: "aprovado", porVoz: true });
    await ate(() => msgs(midia, "bot-fala").find((m) => String(m.texto).includes("aprovado")));
    await ate(() => msgs(cerebro, "nota").find((n) => String(n.texto).includes("aprovou por voz")));
  });

  it("desligar pelo bot: encerra com bot_desligou depois da última frase", async () => {
    const { voz, midia, cerebro, fins } = montar();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    midia.receber({ t: "texto", conteudo: "tchau" });
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Até mais! " });
    cerebro.receber({ t: "atividade", tipo: "inicio", nome: "mcp__nod__desligar" });
    cerebro.receber({ t: "atividade", tipo: "fim", nome: "mcp__nod__desligar" });
    cerebro.receber({ t: "fala", n: 1, seq: 1, delta: "Até mais de novo!" });
    cerebro.receber({ t: "fala-fim", n: 1 });
    await ate(() => fins.length > 0, 5000);
    expect(fins[0]?.motivo).toBe("bot_desligou");
    expect(msgs(midia, "bot-fala").some((m) => String(m.texto).includes("de novo"))).toBe(false);
  });

  it("refazer a vez: a pessoa volta a falar antes de o bot dizer algo — a resposta é descartada e a fala vira uma vez só", async () => {
    const { voz, midia, cerebro, provedores } = montar();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    await dormir(30);
    tocouTudo(midia);
    provedores.stt.empurrarTexto("Primeiro eu quero definir o que você faz.");
    provedores.stt.empurrarTexto("Quero que seja minha secretária.");
    const seq = { n: 0 };
    await falarNoRitmo(midia, seq, 30, 40);
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    // Volta a falar antes de qualquer áudio da resposta.
    await falarNoRitmo(midia, seq, 30, 40);
    await ate(() => msgs(cerebro, "interromper").find((m) => m.modo === "duro"));
    const vez2 = await ate(() => msgs(cerebro, "vez").find((v) => v.n === 2));
    expect(String(vez2.texto)).toContain("Primeiro eu quero definir");
    expect(String(vez2.texto)).toContain("minha secretária");
    expect(String(vez2.texto)).toContain("ainda não tinha terminado");
    // A resposta atrasada da vez 1 não é falada.
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Resposta velha." });
    await dormir(50);
    expect(msgs(midia, "bot-fala").some((m) => String(m.texto).includes("velha"))).toBe(false);
    expect(midia.fechadoCom).toBeNull();
  }, 10_000);

  it("uma batida curta enquanto a vez espera não vai ao STT, não refaz nada e a vez sai (antes ficava pendurada)", async () => {
    const { voz, midia, cerebro, provedores } = montar();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    await dormir(30);
    tocouTudo(midia);
    // Termina em "e": a vez espera 1,4 s; no meio dela, 100 ms de batida.
    provedores.stt.empurrarTexto("Quero criar uma rotina e");
    provedores.stt.empurrarTexto("isto não pode virar fala");
    // A primeira fala vai de uma vez (1,4 s cabe nos 2 s de folga da guarda) para a espera de 1,4 s começar já; a batida
    // vem no ritmo do app, senão a soma passa de 1,2× o tempo real + 2 s e a guarda fecha a mídia (NOD-184).
    const seq = { n: 0 };
    for (let i = 0; i < 70; i++) midia.receber(quadro(seq.n++, i < 30));
    await ate(() => msgs(midia, "legenda").find((l) => l.final === true));
    await dormir(200);
    // A batida tem de cair na espera: com a vez já fora, o teste passaria sem provar nada.
    expect(msgs(cerebro, "vez").some((v) => v.n === 1)).toBe(false);
    await falarNoRitmo(midia, seq, 5, 40);
    const vez = await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1), 4000);
    expect(vez.texto).toBe("Quero criar uma rotina e");
    expect(provedores.stt.restantes).toBe(1);
    expect(msgs(cerebro, "interromper")).toHaveLength(0);
    expect(midia.fechadoCom).toBeNull();
  }, 10_000);
});

/**
 * Ruído intermitente no ritmo do microfone (20 ms por quadro; a vigia conta tempo de verdade): quatro quadros acima do
 * limiar e um em silêncio. O silêncio nunca chega a 600 ms, e o piso do VAD não sobe (o mínimo da janela é zero) —
 * foi assim que um trecho ficou 35 s aberto na ligação do Marlon. Ruído constante é outro caso: vira piso em ~2 s.
 */
async function ruidoIntermitente(midia: CanalFalso, seq: { n: number }, quadros: number): Promise<void> {
  for (let i = 0; i < quadros; i++) {
    midia.receber(quadro(seq.n++, i % 5 !== 4));
    await dormir(20);
  }
}

/** STT com tudo na mão do teste: quando chegam a parcial e o final, se o trecho está guardado, e a queda. */
function sttNaMao(o: { parciais?: boolean; recusarDaAbertura?: number } = {}) {
  let sessao: OpcoesSessaoStt | null = null;
  const c = { enviados: 0, fins: 0, descartes: 0, guardando: false, aberturas: 0 };
  const stt: Transcritor = {
    id: "manual",
    capacidades: { parciais: o.parciais === true, vocabulario: false, fimDeFalaManual: true },
    async abrir(op) {
      c.aberturas++;
      if (o.recusarDaAbertura !== undefined && c.aberturas >= o.recusarDaAbertura) throw new Error("recusado");
      sessao = op;
      return { enviar() { c.enviados++; }, fimDeFala() { c.fins++; }, descartar() { c.descartes++; }, guardando: () => c.guardando, async fechar() {} };
    },
  };
  return {
    stt,
    c,
    parcial: (texto: string) => sessao!.aoResultado({ texto, final: false, confianca: null }),
    final: (texto: string) => sessao!.aoResultado({ texto, final: true, confianca: null }),
    cair: () => sessao!.aoErro(new Error("caiu")),
  };
}

describe("orquestrador de voz: a vez não fica pendurada (2026-10-04)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const atender = async (m: ReturnType<typeof montar>) => {
    m.voz.anexarMidia({ pessoaId: "p", ligacaoId: m.id, retomar: false, canal: m.midia });
    m.voz.anexarCerebro({ turnoId: "turno", ligacaoId: m.id, canal: m.cerebro });
    await dormir(30);
    tocouTudo(m.midia);
  };
  /** As linhas de log desta ligação (outras ligações de teste ainda vivas também escrevem no mesmo console). */
  const logDe = (linhas: string[], id: string) => linhas.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.ligacao_id === id);
  const conteudos = (midia: CanalFalso) => msgs(midia, "bot-fala").filter((m) => m.tipo === "conteudo").map((m) => m.texto);

  it("o que o bot diz logo antes de uma ferramenta é falado (antes o trecho era jogado fora)", async () => {
    const m = montar();
    await atender(m);
    m.midia.receber({ t: "texto", conteudo: "pode me chamar de Marlon" });
    await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1));
    // Sem espaço depois da pergunta: o modelo parou de escrever e chamou a ferramenta.
    m.cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Prazer, Marlon! Como você conheceu o nod?" });
    m.cerebro.receber({ t: "atividade", tipo: "inicio", nome: "mcp__nod__anotar_entrevista" });
    await ate(() => conteudos(m.midia).includes("Como você conheceu o nod?"));
    m.cerebro.receber({ t: "atividade", tipo: "fim", nome: "mcp__nod__anotar_entrevista" });
    m.cerebro.receber({ t: "fala-fim", n: 1 });
    await ate(() => m.falas.find((f) => f.autor === "bot" && f.texto.includes("conheceu")));
    expect(conteudos(m.midia)).toEqual(["Oi! Aqui é Nina.", "Prazer, Marlon!", "Como você conheceu o nod?"]);
    // A pergunta foi feita: a resposta curta que vier conta como resposta, não como "uhum".
    m.provedores.stt.empurrarTexto("sim");
    const seq = { n: 0 };
    tocouTudo(m.midia);
    for (let i = 0; i < 12; i++) m.midia.receber(quadro(seq.n++, true));
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    expect((await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 2))).texto).toBe("sim");
  });

  it("a guia fala antes de anotar: o 'ok' depois da ferramenta não é falado nem vai para a transcrição, e a pergunta conta como pergunta", async () => {
    const m = montar();
    await atender(m);
    m.midia.receber({ t: "texto", conteudo: "pode me chamar de Marlon" });
    await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1));
    m.cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Prazer, Marlon! Como você conheceu o nod?" });
    m.cerebro.receber({ t: "atividade", tipo: "inicio", nome: "mcp__nod__anotar_entrevista" });
    await ate(() => conteudos(m.midia).includes("Como você conheceu o nod?"));
    m.cerebro.receber({ t: "atividade", tipo: "fim", nome: "mcp__nod__anotar_entrevista" });
    m.cerebro.receber({ t: "fala", n: 1, seq: 1, delta: "ok" });
    m.cerebro.receber({ t: "fala-fim", n: 1 });
    const gravada = await ate(() => m.falas.find((f) => f.autor === "bot" && f.texto.includes("conheceu")));
    expect(gravada.texto).toBe("Prazer, Marlon! Como você conheceu o nod?");
    await dormir(600);
    expect(conteudos(m.midia)).toEqual(["Oi! Aqui é Nina.", "Prazer, Marlon!", "Como você conheceu o nod?"]);
    // Com a fala ainda saindo, a tela não pulou para "trabalhando" nem "pensando".
    const fases = msgs(m.midia, "estado").map((e) => e.fase);
    expect(fases.slice(fases.lastIndexOf("pensando") + 1)).not.toContain("trabalhando");
    // A resposta curta a seguir é resposta à pergunta, não "uhum".
    tocouTudo(m.midia);
    m.provedores.stt.empurrarTexto("sim");
    const seq = { n: 0 };
    for (let i = 0; i < 12; i++) m.midia.receber(quadro(seq.n++, true));
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    expect((await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 2))).texto).toBe("sim");
  });

  it("se a guia repete depois da ferramenta a pergunta que já tinha feito, ela não é falada de novo; pergunta nova é", async () => {
    const m = montar();
    await atender(m);
    m.midia.receber({ t: "texto", conteudo: "pode me chamar de Marlon" });
    await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1));
    m.cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Prazer, Marlon! Como você conheceu o nod?" });
    m.cerebro.receber({ t: "atividade", tipo: "inicio", nome: "mcp__nod__anotar_entrevista" });
    m.cerebro.receber({ t: "atividade", tipo: "fim", nome: "mcp__nod__anotar_entrevista" });
    m.cerebro.receber({ t: "fala", n: 1, seq: 1, delta: "Como você conheceu o nod? E quem te indicou? " });
    m.cerebro.receber({ t: "fala-fim", n: 1 });
    await ate(() => conteudos(m.midia).includes("E quem te indicou?"));
    expect(conteudos(m.midia).filter((t) => t === "Como você conheceu o nod?")).toHaveLength(1);
  });

  it("sem fala antes da ferramenta, o que vem depois dela é falado inteiro — inclusive um 'ok' de outra ferramenta", async () => {
    const m = montar();
    await atender(m);
    m.midia.receber({ t: "texto", conteudo: "lembra que eu prefiro café" });
    await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1));
    m.cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Vou anotar isso." });
    m.cerebro.receber({ t: "atividade", tipo: "inicio", nome: "mcp__nod__lembrar" });
    m.cerebro.receber({ t: "atividade", tipo: "fim", nome: "mcp__nod__lembrar" });
    m.cerebro.receber({ t: "fala", n: 1, seq: 1, delta: "Ok." });
    m.cerebro.receber({ t: "fala-fim", n: 1 });
    await ate(() => conteudos(m.midia).includes("Ok."));
    expect(conteudos(m.midia).slice(1)).toEqual(["Vou anotar isso.", "Ok."]);
  });

  it("a saudação é sintetizada no registro da ligação, antes de a mídia anexar; ligação nunca atendida cancela a síntese", async () => {
    const { tts, log } = ttsLento(200);
    const m = montar({ tts });
    // Ninguém atendeu ainda e a síntese já começou.
    await ate(() => log.length === 1);
    expect(log[0]!.texto).toBe("Oi! Aqui é Nina.");
    await ate(() => log[0]!.fim);
    const t0 = Date.now();
    m.voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: m.midia });
    await ate(() => m.midia.binarios > 0);
    // O áudio sai na hora: não espera outra síntese de 200 ms.
    expect(Date.now() - t0).toBeLessThan(150);
    expect(log).toHaveLength(1);
    await m.voz.encerrar("l1", "pessoa_desligou");

    const outra = ttsLento(5000);
    const n = montar({ tts: outra.tts });
    await ate(() => outra.log.length === 1);
    await n.voz.encerrar("l1", "nao_atendida");
    await ate(() => outra.log[0]!.abortada);
  });

  it("com a voz em streaming, o 'Hum, deixa eu ver…' não toca quando o conteúdo já está para soar; com a voz de frase inteira, toca", async () => {
    const esperas: FonteDeEsperas = { obterPronto: () => new Int16Array(2400), aquecer: () => undefined };
    for (const streaming of [true, false]) {
      const { tts, log } = ttsLento(1200, streaming);
      const m = montar({ tts, esperas });
      m.voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: m.midia });
      m.voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: m.cerebro });
      await ate(() => log[0]?.fim);
      tocouTudo(m.midia);
      m.midia.receber({ t: "texto", conteudo: "me conta o que você faz" });
      await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1));
      // O texto chega 0,8 s depois da vez; o relógio do "pensando" vence aos 1,6 s, com o áudio ainda por vir (aos 2,0 s).
      await dormir(800);
      m.cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Eu organizo suas tarefas do dia a dia. " });
      m.cerebro.receber({ t: "fala-fim", n: 1 });
      await ate(() => log.find((x) => x.texto.includes("organizo"))?.fim, 4000);
      expect(msgs(m.midia, "bot-fala").some((x) => x.tipo === "espera"), `streaming=${streaming}`).toBe(!streaming);
      await m.voz.encerrar("l1", "pessoa_desligou");
    }
  }, 15_000);

  it("anúncio sem ponto antes da ferramenta também sai, e o texto depois dela é outro trecho", async () => {
    const m = montar();
    await atender(m);
    m.midia.receber({ t: "texto", conteudo: "como está minha agenda" });
    await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1));
    m.cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Vou ver sua agenda" });
    m.cerebro.receber({ t: "atividade", tipo: "inicio", nome: "mcp__nod__ex__agenda" });
    m.cerebro.receber({ t: "atividade", tipo: "fim", nome: "mcp__nod__ex__agenda" });
    m.cerebro.receber({ t: "fala", n: 1, seq: 1, delta: "Hoje está livre. " });
    m.cerebro.receber({ t: "fala-fim", n: 1 });
    await ate(() => conteudos(m.midia).includes("Hoje está livre."));
    expect(conteudos(m.midia).slice(1)).toEqual(["Vou ver sua agenda.", "Hoje está livre."]);
  });

  it("'uhum' no meio da espera da vez não deixa a vez pendurada (o começo dele cancelou a decisão)", async () => {
    const m = montar();
    await atender(m);
    // Primeira troca sem pergunta do bot: o "uhum" seguinte é só a pessoa ouvindo.
    m.midia.receber({ t: "texto", conteudo: "oi" });
    await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1));
    m.cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Tudo certo por aqui. " });
    m.cerebro.receber({ t: "fala-fim", n: 1 });
    await ate(() => conteudos(m.midia).includes("Tudo certo por aqui."));
    await dormir(30);
    tocouTudo(m.midia);
    // Termina em "e": a vez espera 1,4 s. No meio dela, um "uhum".
    m.provedores.stt.empurrarTexto("Quero criar uma rotina e");
    m.provedores.stt.empurrarTexto("uhum");
    // Como na batida: a fala vai de uma vez (1,4 s cabe nos 2 s de folga da guarda) e o "uhum" no ritmo do app (NOD-184).
    const seq = { n: 0 };
    for (let i = 0; i < 70; i++) m.midia.receber(quadro(seq.n++, i < 30));
    await ate(() => msgs(m.midia, "legenda").find((l) => l.final === true));
    await dormir(200);
    // O "uhum" tem de cair na espera: com a vez 2 já fora, o teste passaria sem provar nada.
    expect(msgs(m.cerebro, "vez").some((v) => v.n === 2)).toBe(false);
    await falarNoRitmo(m.midia, seq, 12, 40);
    const vez = await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 2), 4000);
    expect(vez.texto).toBe("Quero criar uma rotina e");
    expect(m.provedores.stt.restantes).toBe(0);
    expect(m.midia.fechadoCom).toBeNull();
  }, 10_000);

  it("interromper vale para todas as falas que o app ainda tem, não só para a mais nova", async () => {
    const m = montar();
    await atender(m);
    m.midia.receber({ t: "texto", conteudo: "me conta três coisas" });
    await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1));
    m.cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Primeira coisa aqui. Segunda coisa aqui. Terceira coisa aqui. " });
    m.cerebro.receber({ t: "fala-fim", n: 1 });
    await ate(() => conteudos(m.midia).includes("Terceira coisa aqui."));
    await dormir(50);
    // O app está tocando a primeira e tem as outras duas na fila.
    const utts = msgs(m.midia, "bot-fala").filter((x) => String(x.texto).includes("coisa aqui")).map((x) => x.utt);
    m.midia.receber({ t: "texto", conteudo: "para" });
    expect(msgs(m.midia, "interromper").map((x) => x.utt)).toEqual(utts);
    expect(utts).toHaveLength(3);
  });

  it("leitura de aprovação cortada no meio abre a janela mesmo assim (antes a ligação ficava sem janela, espera e aviso)", async () => {
    const m = montar();
    await atender(m);
    m.voz.pedirAprovacao("l1", { decisaoId: "d1", leitura: "Novo bot: Atendente, para responder clientes. Para criar, diga 'pode criar'.", perfil: "proposta" });
    const leitura = await ate(() => msgs(m.midia, "bot-fala").find((x) => x.tipo === "leitura"));
    await dormir(50);
    m.midia.receber({ t: "texto", conteudo: "espera" });
    expect(msgs(m.midia, "interromper").map((x) => x.utt)).toContain(leitura.utt);
    m.midia.receber({ t: "interrompido", utt: leitura.utt, ms: 40 });
    await ate(() => msgs(m.midia, "janela").length > 0);
    await dormir(400);
    expect(msgs(m.midia, "janela")).toHaveLength(1);
  });

  it("ruído segurando o VAD: a vigia fecha o trecho quando a transcrição para de andar, a vez sai e o ruído seguinte não a refaz", async () => {
    const linhas: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: unknown) => void linhas.push(String(l)));
    const m = montar({ parciais: true, ligacaoId: "ruido" });
    await atender(m);
    m.provedores.stt.empurrarTexto("Quero uma rotina nova");
    const seq = { n: 0 };
    // A pessoa fala e o ruído segue acima do limiar: o VAD nunca vê 600 ms de silêncio.
    const ruido = ruidoIntermitente(m.midia, seq, 330);
    const vez = await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1), 6000);
    expect(vez.texto).toBe("Quero uma rotina nova");
    await ruido;
    // O ruído continuou por mais de 2 s depois da vez: nada de refazer a vez nem de interromper.
    expect(msgs(m.cerebro, "interromper")).toHaveLength(0);
    expect(msgs(m.cerebro, "vez").filter((v) => Number(v.n) > 0)).toHaveLength(1);
    // O bot responde por cima do ruído e a ligação segue.
    m.cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Vamos criar. " });
    m.cerebro.receber({ t: "fala-fim", n: 1 });
    await ate(() => conteudos(m.midia).includes("Vamos criar."));
    m.midia.receber({ t: "tchau" });
    await ate(() => m.fins.length > 0);
    const fim = logDe(linhas, m.id).find((l) => l.evento === "voz_ligacao_encerrada");
    expect(Number(fim?.fechados_pela_vigia)).toBeGreaterThanOrEqual(2);
    expect(Number(fim?.trechos_descartados)).toBeGreaterThanOrEqual(1);
    const medida = logDe(linhas, m.id).find((l) => l.evento === "ligacao_vez" && l.n === 1);
    expect(medida).toMatchObject({ origem: "voz", fechou: "vigia", desfecho: "respondida" });
  }, 20_000);

  it("fala que começa com o trecho anterior ainda fechando no STT não é descartada pela vigia (nenhuma parcial pode chegar)", async () => {
    const { stt, c, parcial, final } = sttNaMao({ parciais: true });
    const m = montar({ stt });
    await atender(m);
    const seq = { n: 0 };
    // O provedor ainda fecha um trecho anterior: o áudio desta fala fica guardado por 2 s.
    c.guardando = true;
    await ruidoIntermitente(m.midia, seq, 100);
    expect(c.descartes).toBe(0);
    expect(c.fins).toBe(0);
    // O áudio chegou ao provedor e a transcrição começa a andar.
    c.guardando = false;
    parcial("Quero uma rotina");
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    expect(c.fins).toBe(1);
    final("Quero uma rotina nova");
    expect((await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1))).texto).toBe("Quero uma rotina nova");
    expect(c.descartes).toBe(0);
  }, 15_000);

  it("na janela de ruído, 'para para' por cima do bot interrompe mesmo sem parcial e depois de outra interrupção", async () => {
    const { stt, final } = sttNaMao({ parciais: true });
    const m = montar({ stt });
    await atender(m);
    const seq = { n: 0 };
    const longa = "Esta é uma explicação muito longa que vai tocar por bastante tempo no alto-falante, com várias frases. ";
    // Uma interrupção confirmada antes: o estado dela não pode valer para os trechos seguintes.
    m.midia.receber({ t: "texto", conteudo: "me explica tudo" });
    await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1));
    m.cerebro.receber({ t: "fala", n: 1, seq: 0, delta: longa });
    await ate(() => conteudos(m.midia).some((t) => String(t).includes("explicação")));
    for (let i = 0; i < 25; i++) m.midia.receber(quadro(seq.n++, true));
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    final("espera, para");
    await ate(() => msgs(m.cerebro, "interromper").length === 1);
    await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 2));
    m.cerebro.receber({ t: "fala", n: 2, seq: 0, delta: "Parei. " });
    m.cerebro.receber({ t: "fala-fim", n: 2 });
    await ate(() => conteudos(m.midia).includes("Parei."));
    await dormir(700);
    tocouTudo(m.midia);
    // Uma batida com o bot calado abre a janela de ruído.
    for (let i = 0; i < 5; i++) m.midia.receber(quadro(seq.n++, true));
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    m.midia.receber({ t: "texto", conteudo: "agora me conta tudo" });
    await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 3));
    m.cerebro.receber({ t: "fala", n: 3, seq: 0, delta: longa });
    await ate(() => conteudos(m.midia).filter((t) => String(t).includes("explicação")).length === 2);
    await dormir(700);
    // A pessoa fala por cima, dentro da janela de ruído, e nenhuma parcial chega antes do final.
    for (let i = 0; i < 25; i++) m.midia.receber(quadro(seq.n++, true));
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    final("para para");
    await ate(() => msgs(m.cerebro, "interromper").length === 2);
    expect((await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 4))).texto).toBe("para para");
  }, 15_000);

  it("na janela de ruído, o começo de fala só segura a vez quando a transcrição traz texto", async () => {
    const { stt, parcial, final } = sttNaMao({ parciais: true });
    const m = montar({ stt });
    await atender(m);
    const seq = { n: 0 };
    // Uma batida abre a janela de ruído.
    for (let i = 0; i < 5; i++) m.midia.receber(quadro(seq.n++, true));
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    await dormir(800);
    for (let i = 0; i < 30; i++) m.midia.receber(quadro(seq.n++, true));
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    // Termina em "e": a vez espera 1,4 s.
    final("Quero uma rotina e");
    await dormir(300);
    // A pessoa continua; só o VAD ainda não segura nada, a parcial segura.
    for (let i = 0; i < 15; i++) m.midia.receber(quadro(seq.n++, true));
    parcial("para toda");
    await dormir(1600);
    expect(msgs(m.cerebro, "vez").some((v) => v.n === 1)).toBe(false);
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    final("para toda segunda");
    expect((await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1))).texto).toBe("Quero uma rotina e para toda segunda");
  }, 15_000);

  it("o STT cai com texto pendente e um trecho esperando final: a vez sai com o que já tinha", async () => {
    const { stt, final, cair } = sttNaMao();
    const m = montar({ stt });
    await atender(m);
    const seq = { n: 0 };
    for (let i = 0; i < 30; i++) m.midia.receber(quadro(seq.n++, true));
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    final("quero criar uma rotina e");
    await dormir(800);
    // A pessoa continua (o começo cancela a decisão), o trecho fecha, e a conexão do STT cai antes do final.
    for (let i = 0; i < 20; i++) m.midia.receber(quadro(seq.n++, true));
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    cair();
    expect((await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1), 3000)).texto).toBe("quero criar uma rotina e");
  });

  it("eco descartado no meio da espera da vez rearma a decisão", async () => {
    const { stt, final } = sttNaMao();
    const m = montar({ stt });
    await atender(m);
    const seq = { n: 0 };
    for (let i = 0; i < 30; i++) m.midia.receber(quadro(seq.n++, true));
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    final("quero criar uma rotina e");
    await dormir(800);
    // O bot dá um aviso e o microfone o pega de volta: o começo desse trecho cancela a decisão, e o final é eco.
    m.voz.iniciarDrenagem();
    const aviso = await ate(() => msgs(m.midia, "bot-fala").find((x) => x.tipo === "aviso"));
    for (let i = 0; i < 20; i++) m.midia.receber(quadro(seq.n++, true));
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    final(String(aviso.texto));
    expect((await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1), 3000)).texto).toBe("quero criar uma rotina e");
  });

  it("ligacao_vez: uma linha por vez, com os tempos de cada etapa e nenhum texto falado", async () => {
    const linhas: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: unknown) => void linhas.push(String(l)));
    const m = montar({ ligacaoId: "medida" });
    await atender(m);
    m.provedores.stt.empurrarTexto("quero saber da minha agenda");
    const seq = { n: 0 };
    for (let i = 0; i < 30; i++) m.midia.receber(quadro(seq.n++, true));
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1));
    m.cerebro.receber({ t: "atividade", tipo: "inicio", nome: "mcp__nod__ex__agenda" });
    await dormir(40);
    m.cerebro.receber({ t: "atividade", tipo: "fim", nome: "mcp__nod__ex__agenda" });
    m.cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Sua agenda está livre hoje. " });
    m.cerebro.receber({ t: "fala-fim", n: 1 });
    const fala = await ate(() => msgs(m.midia, "bot-fala").find((x) => String(x.texto).includes("livre")));
    await dormir(30);
    m.midia.receber({ t: "tocado", utt: fala.utt, ms: 100 });
    m.midia.receber({ t: "tchau" });
    await ate(() => m.fins.length > 0);
    const eventos = logDe(linhas, m.id);
    const vezes = eventos.filter((l) => l.evento === "ligacao_vez");
    expect(vezes).toHaveLength(1);
    expect(vezes[0]).toMatchObject({ ligacao_id: "medida", n: 1, origem: "voz", desfecho: "respondida", trechos: 1, fechou: "vad", espera_fim_de_turno_ms: 600, ferramenta_antes_do_texto: true, texto_depois_da_ferramenta: true, onboarding: false, tts_streaming: false });
    for (const campo of ["trecho_fechado_ms", "stt_final_ms", "vez_ms", "primeiro_delta_ms", "primeiro_trecho_ms", "primeiro_audio_ms", "primeiro_tocado_ms", "voz_a_voz_ms", "ferramenta_ms"]) expect(typeof vezes[0]![campo], campo).toBe("number");
    expect(Number(vezes[0]!.ferramenta_ms)).toBeGreaterThanOrEqual(30);
    const fim = eventos.find((l) => l.evento === "voz_ligacao_encerrada");
    expect(typeof fim?.voz_a_voz_p50_ms).toBe("number");
    expect(fim).toMatchObject({ trechos: 1, trechos_descartados: 0, fechados_pela_vigia: 0, quadros_perdidos: 0 });
    // O texto falado nunca vai para log.
    expect(linhas.some((l) => /agenda|livre hoje/.test(l))).toBe(false);
  });

  it("o final que chega com a pessoa já falando de novo não decide a vez no meio da fala", async () => {
    // O final do primeiro trecho só chega depois de o segundo ter começado.
    const { stt, final } = sttNaMao();
    const m = montar({ stt });
    await atender(m);
    const seq = { n: 0 };
    for (let i = 0; i < 30; i++) m.midia.receber(quadro(seq.n++, true));
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    // A pessoa volta a falar antes de o final do primeiro trecho chegar.
    for (let i = 0; i < 20; i++) m.midia.receber(quadro(seq.n++, true));
    final("Quero uma rotina");
    await dormir(900);
    expect(msgs(m.cerebro, "vez").some((v) => v.n === 1)).toBe(false);
    for (let i = 0; i < 40; i++) m.midia.receber(quadro(seq.n++, false));
    final("para toda segunda de manhã");
    const vez = await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === 1));
    expect(vez.texto).toBe("Quero uma rotina para toda segunda de manhã");
    expect(msgs(m.cerebro, "vez").filter((v) => Number(v.n) > 0)).toHaveLength(1);
  });

  it("quadros que o app descartou aparecem como salto na sequência", async () => {
    const linhas: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: unknown) => void linhas.push(String(l)));
    const m = montar({ ligacaoId: "saltos" });
    await atender(m);
    m.midia.receber(quadro(0, false));
    m.midia.receber(quadro(1, false));
    m.midia.receber(quadro(7, false));
    m.midia.receber({ t: "tchau" });
    await ate(() => m.fins.length > 0);
    const fim = logDe(linhas, m.id).find((l) => l.evento === "voz_ligacao_encerrada");
    expect(fim?.quadros_perdidos).toBe(5);
  });

  /**
   * NOD-184: o e2e da ligação mandava cada fala (1,8 s de áudio) numa rajada só. Com o Mac rápido, a segunda rajada chegava
   * ~1,2 s depois de a mídia abrir, com 3,6 s de áudio somados: acima de 1,2× o tempo real + 2 s. A guarda fechava a mídia
   * e o "pode criar" nunca virava comando — a espera estourava sem dizer por quê.
   */
  it("duas falas de 1,8 s mandadas em rajada logo depois de a mídia abrir: a guarda de abuso fecha a mídia (4429)", async () => {
    const linhas: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: unknown) => void linhas.push(String(l)));
    // O relógio da guarda para em 1,2 s depois da mídia abrir, como no Mac rápido: com a máquina carregada, o atender
    // sozinho podia passar de 1,3 s e a rajada deixava de estourar a guarda.
    const t0 = Date.now();
    let congelado: number | null = null;
    const m = montar({ roteiro: ["Oi, tudo bem?", "pode criar"], ligacaoId: "rajada", relogio: () => congelado ?? Date.now() });
    await atender(m);
    congelado = t0 + 1_200;
    let seq = 0;
    for (let fala = 0; fala < 2; fala++) for (let i = 0; i < 90; i++) m.midia.receber(quadro(seq++, i < 30));
    expect(m.midia.fechadoCom).toBe(FECHAMENTOS_VOZ.abuso);
    expect(logDe(linhas, m.id).some((l) => l.evento === "voz_audio_acima_do_tempo_real")).toBe(true);
  });

  it("no ritmo do app (blocos de 100 ms em tempo real), 3 s de áudio não disparam a guarda de abuso", async () => {
    const m = montar({ ligacaoId: "tempo-real" });
    await atender(m);
    let seq = 0;
    for (let bloco = 0; bloco < 30; bloco++) {
      for (let i = 0; i < 5; i++) m.midia.receber(quadro(seq++, false));
      await dormir(100);
    }
    expect(m.midia.fechadoCom).toBeNull();
  }, 10_000);

  it("cota do TTS: cada tipo de fala chega ao sintetizador com a sua prioridade, e o pico vai no voz_ligacao_encerrada", async () => {
    expect((["conteudo", "aviso", "leitura", "espera"] as const).map(prioridadeTts)).toEqual(["conteudo", "conteudo", "leitura", "espera"]);
    const linhas: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: unknown) => void linhas.push(String(l)));
    const pedidos: PedidoTts[] = [];
    const tts: Sintetizador = {
      id: "prioridades",
      capacidades: { streaming: false, velocidade: true },
      medirPico: () => () => 7,
      async *sintetizar(p) {
        pedidos.push(p);
        yield new Int16Array(2400);
      },
    };
    const m = montar({ tts, ligacaoId: "l-prioridade" });
    await atender(m);
    m.voz.pedirAprovacao(m.id, { decisaoId: "d1", leitura: "Mandar 1 e-mail. Para aprovar, diga 'eu aprovo'.", perfil: "estrito" });
    await ate(() => msgs(m.midia, "bot-fala").find((x) => x.tipo === "leitura"));
    m.midia.receber({ t: "tchau" });
    await ate(() => m.fins.length > 0);
    expect(pedidos.map((p) => [p.texto, p.prioridade])).toEqual([
      ["Oi! Aqui é Nina.", "conteudo"],
      ["Mandar 1 e-mail. Para aprovar, diga 'eu aprovo'.", "leitura"],
    ]);
    expect(logDe(linhas, m.id).find((l) => l.evento === "voz_ligacao_encerrada")?.tts_pico_min).toBe(7);
  });
});

describe("orquestrador de voz: resiliência (NOD-168)", () => {
  const atender = async (m: ReturnType<typeof montar>) => {
    m.voz.anexarMidia({ pessoaId: "p", ligacaoId: m.id, retomar: false, canal: m.midia });
    m.voz.anexarCerebro({ turnoId: "turno", ligacaoId: m.id, canal: m.cerebro });
    await dormir(30);
    tocouTudo(m.midia);
  };
  const avisos = (midia: CanalFalso) => msgs(midia, "aviso").map((a) => String(a.texto));
  const TECLADO = "Não estou conseguindo te ouvir direito. Se continuar, use o teclado.";

  it("o STT cai: reabre uma vez sem reanexar a mídia e sem aviso; caindo de novo, pede o teclado", async () => {
    const { stt, c, cair } = sttNaMao();
    const m = montar({ stt });
    await atender(m);
    expect(c.aberturas).toBe(1);
    cair();
    await ate(() => c.aberturas === 2);
    await dormir(30);
    expect(avisos(m.midia)).not.toContain(TECLADO);
    // A mídia é a mesma: nenhum `pronto` novo.
    expect(msgs(m.midia, "pronto")).toHaveLength(1);
    cair();
    await ate(() => avisos(m.midia).includes(TECLADO));
    expect(c.aberturas).toBe(2);
    await m.voz.fechar();
  });

  it("o STT cai e a reabertura falha: o aviso do teclado sai uma vez", async () => {
    const { stt, c, cair } = sttNaMao({ recusarDaAbertura: 2 });
    const m = montar({ stt });
    await atender(m);
    cair();
    await ate(() => avisos(m.midia).includes(TECLADO));
    expect(c.aberturas).toBe(2);
    expect(avisos(m.midia).filter((a) => a === TECLADO)).toHaveLength(1);
    await m.voz.fechar();
  });

  it("mídia e cérebro caem juntos (tampa fechada) e não voltam: encerra com cerebro_caiu, não midia_caiu", async () => {
    const m = montar({ prazos: { midiaReconexaoMs: 100, cerebroReconexaoMs: 5000 } });
    await atender(m);
    m.cerebro.cair();
    m.midia.cair();
    await ate(() => m.fins.length > 0, 2000);
    expect(m.fins.map((f) => f.motivo)).toEqual(["cerebro_caiu"]);
  });

  it("o cérebro religa com a ligação atendida: UMA nota \"A conexão voltou\" e nenhuma vez 0 nova; a vez que esperava segue", async () => {
    const m = montar({ prazos: { cerebroReconexaoMs: 5000 } });
    await atender(m);
    const vezes0 = () => msgs(m.cerebro, "vez").filter((v) => v.n === 0).length + msgs(novo, "vez").filter((v) => v.n === 0).length;
    const voltou = (c: CanalFalso) => msgs(c, "nota").filter((n) => n.texto === NOTA_CONEXAO_VOLTOU);
    const novo = canalFalso();
    expect(vezes0()).toBe(1);
    expect(voltou(m.cerebro)).toHaveLength(0);
    m.cerebro.cair();
    m.midia.receber({ t: "texto", conteudo: "ainda está aí?" });
    expect(m.voz.anexarCerebro({ turnoId: "turno", ligacaoId: m.id, canal: novo })).toBeNull();
    expect(voltou(novo)).toHaveLength(1);
    expect(voltou(novo)[0]).toMatchObject({ confiavel: true });
    expect(vezes0()).toBe(1);
    // A vez dita durante a queda chega ao cérebro que voltou, depois da nota.
    expect(msgs(novo, "vez").map((v) => v.texto)).toEqual(["ainda está aí?"]);
    expect(novo.json.findIndex((x) => x.t === "nota")).toBeLessThan(novo.json.findIndex((x) => x.t === "vez"));
    expect(msgs(m.midia, "estado").map((e) => e.fase)).toContain("reconectando");
    expect(msgs(m.midia, "estado").at(-1)).toMatchObject({ fase: "pensando" });
    await m.voz.fechar();
  });

  it("o cérebro religa antes de a ligação ser atendida: segue com a vez 0 da abertura, sem a nota", async () => {
    const m = montar();
    m.voz.anexarCerebro({ turnoId: "turno", ligacaoId: m.id, canal: m.cerebro });
    m.cerebro.cair();
    const novo = canalFalso();
    m.voz.anexarCerebro({ turnoId: "turno", ligacaoId: m.id, canal: novo });
    expect(msgs(novo, "vez").filter((v) => v.n === 0)).toHaveLength(1);
    expect(msgs(novo, "nota").filter((n) => n.texto === NOTA_CONEXAO_VOLTOU)).toHaveLength(0);
    await m.voz.fechar();
  });

  it("só a mídia cai e não volta: encerra com midia_caiu", async () => {
    const m = montar({ prazos: { midiaReconexaoMs: 100 } });
    await atender(m);
    m.midia.cair();
    await ate(() => m.fins.length > 0, 2000);
    expect(m.fins.map((f) => f.motivo)).toEqual(["midia_caiu"]);
  });
});

describe("orquestrador de voz: só legenda (NOD-168)", () => {
  /** TTS que falha nas frases com "falha" no texto e conta quantas vezes foi chamado. */
  function ttsQueFalha() {
    const pedidos: string[] = [];
    const tts: Sintetizador = {
      id: "falha",
      capacidades: { streaming: false, velocidade: true },
      async *sintetizar(p) {
        pedidos.push(p.texto);
        if (p.texto.includes("falha")) throw new Error("tts fora");
        yield new Int16Array(2400);
      },
    };
    return { tts, pedidos };
  }
  /** Só o clipe do aviso "voz fora" está no cache. */
  const soVozFora: FonteDeEsperas = { obterPronto: (f) => (f.categoria === "voz_fora" ? new Int16Array(2400) : null), aquecer: () => undefined };
  const VOZ_FORA = "A voz falhou. Sigo por escrito, na legenda e no chat.";

  async function falar(m: ReturnType<typeof montar>, n: number, delta: string): Promise<void> {
    m.midia.receber({ t: "texto", conteudo: `pergunta ${n}` });
    await ate(() => msgs(m.cerebro, "vez").find((v) => v.n === n));
    m.cerebro.receber({ t: "fala", n, seq: 0, delta });
    m.cerebro.receber({ t: "fala-fim", n });
    await ate(() => msgs(m.midia, "bot-fala").find((x) => String(x.texto) === delta.trim()));
    await dormir(80);
    tocouTudo(m.midia);
  }

  it("2 frases seguidas sem voz: um único aviso (escrito e o clipe voz_fora), e a 3ª frase sai só na legenda, sem chamar o TTS", async () => {
    const { tts, pedidos } = ttsQueFalha();
    const m = montar({ tts, esperas: soVozFora });
    m.voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: m.midia });
    m.voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: m.cerebro });
    await dormir(50);
    tocouTudo(m.midia);
    await falar(m, 1, "Primeira falha aqui. ");
    expect(msgs(m.midia, "aviso")).toHaveLength(0);
    await falar(m, 2, "Segunda falha aqui. ");
    await ate(() => msgs(m.midia, "aviso").length > 0);
    await ate(() => msgs(m.midia, "bot-fala").find((x) => x.texto === VOZ_FORA));
    const chamadas = pedidos.length;
    await falar(m, 3, "Terceira frase, essa teria voz. ");
    expect(pedidos.length).toBe(chamadas);
    expect(pedidos.some((t) => t.includes("Terceira"))).toBe(false);
    expect(msgs(m.midia, "aviso")).toHaveLength(1);
    expect(msgs(m.midia, "bot-fala").filter((x) => x.texto === VOZ_FORA)).toHaveLength(1);
    // A ligação segue: a pessoa ainda fala e a vez ainda sai.
    expect(m.fins).toHaveLength(0);
    expect(msgs(m.cerebro, "vez").some((v) => v.n === 3)).toBe(true);
    await m.voz.fechar();
  });

  it("uma falha seguida de uma frase com voz: nada de aviso nem só legenda", async () => {
    const { tts, pedidos } = ttsQueFalha();
    const m = montar({ tts, esperas: soVozFora });
    m.voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: m.midia });
    m.voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: m.cerebro });
    await dormir(50);
    tocouTudo(m.midia);
    await falar(m, 1, "Uma falha aqui. ");
    await falar(m, 2, "Agora com voz. ");
    await falar(m, 3, "Outra falha aqui. ");
    expect(msgs(m.midia, "aviso")).toHaveLength(0);
    expect(msgs(m.midia, "bot-fala").some((x) => x.texto === VOZ_FORA)).toBe(false);
    await falar(m, 4, "E de novo com voz. ");
    expect(pedidos.some((t) => t.includes("de novo com voz"))).toBe(true);
    await m.voz.fechar();
  });

  it("só legenda: uma decisão pendente não é lida nem abre a janela de voz (a aprovação fica na tela)", async () => {
    const { tts } = ttsQueFalha();
    const m = montar({ tts, esperas: soVozFora });
    m.voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: m.midia });
    m.voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: m.cerebro });
    await dormir(50);
    tocouTudo(m.midia);
    await falar(m, 1, "Primeira falha aqui. ");
    await falar(m, 2, "Segunda falha aqui. ");
    await ate(() => msgs(m.midia, "aviso").length > 0);
    tocouTudo(m.midia);
    m.voz.pedirAprovacao("l1", { decisaoId: "d1", leitura: "Mandar 1 e-mail. Para aprovar, diga 'eu aprovo'.", perfil: "estrito" });
    await dormir(1200);
    expect(msgs(m.midia, "bot-fala").some((x) => x.tipo === "leitura")).toBe(false);
    expect(msgs(m.midia, "janela")).toHaveLength(0);
    await m.voz.fechar();
  });
});

describe("vez sem resposta (NOD-167)", () => {
  const esperas: FonteDeEsperas = { obterPronto: () => new Int16Array(2400), aquecer: () => undefined };
  const avisos = FALAS_DE_ESPERA.filter((f) => f.categoria === "vez_sem_resposta").map((f) => f.texto);

  async function ligado(prazo: number, fonte: FonteDeEsperas | null = esperas) {
    const m = montar({ esperas: fonte ?? undefined, prazos: { vezSemRespostaMs: prazo } });
    m.voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: m.midia });
    m.voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: m.cerebro });
    await dormir(30);
    tocouTudo(m.midia);
    return m;
  }

  it("sem trecho nem ferramenta no prazo: fala o aviso, interrompe o cérebro, cala a resposta atrasada e a vez seguinte segue normal", async () => {
    const { midia, cerebro } = await ligado(200);
    midia.receber({ t: "texto", conteudo: "qual a minha próxima reunião" });
    await ate(() => msgs(cerebro, "interromper").find((m) => m.modo === "duro"));
    const aviso = await ate(() => msgs(midia, "bot-fala").find((m) => m.tipo === "espera" && avisos.includes(String(m.texto))));
    expect(aviso).toBeTruthy();
    // O Codex responde depois da interrupção: não é falado.
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Resposta atrasada que não deve soar. " });
    cerebro.receber({ t: "fala-fim", n: 1 });
    await dormir(600);
    expect(msgs(midia, "bot-fala").some((m) => String(m.texto).includes("atrasada"))).toBe(false);
    expect(msgs(cerebro, "interromper")).toHaveLength(1);

    tocouTudo(midia);
    midia.receber({ t: "texto", conteudo: "e a de amanhã" });
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 2));
    cerebro.receber({ t: "fala", n: 2, seq: 0, delta: "Amanhã às nove. " });
    cerebro.receber({ t: "fala-fim", n: 2 });
    await ate(() => msgs(midia, "bot-fala").find((m) => m.texto === "Amanhã às nove."));
  });

  it("com trecho ou ferramenta antes do prazo, nada de aviso nem interrupção", async () => {
    const { midia, cerebro } = await ligado(250);
    midia.receber({ t: "texto", conteudo: "me conta uma coisa" });
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Já te conto" });
    await dormir(500);
    cerebro.receber({ t: "fala-fim", n: 1 });
    tocouTudo(midia);
    midia.receber({ t: "texto", conteudo: "agora olha a agenda" });
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 2));
    cerebro.receber({ t: "atividade", tipo: "inicio", nome: "mcp__nod__lembrar" });
    await dormir(500);
    expect(msgs(cerebro, "interromper")).toHaveLength(0);
    expect(msgs(midia, "bot-fala").some((m) => avisos.includes(String(m.texto)))).toBe(false);
  });

  // Regressão (revisão NOD-167): sem o clipe em cache, o aviso saía mudo e a pessoa ficava em silêncio.
  it.each([
    ["clipe ainda não sintetizado", { obterPronto: () => null, aquecer: () => undefined } as FonteDeEsperas],
    ["sem fonte de esperas", null],
  ])("%s: o aviso sai pela voz normal, nunca em silêncio", async (_nome, fonte) => {
    const { midia, cerebro } = await ligado(200, fonte);
    midia.receber({ t: "texto", conteudo: "qual a minha próxima reunião" });
    await ate(() => msgs(cerebro, "interromper").find((m) => m.modo === "duro"));
    const aviso = await ate(() => msgs(midia, "bot-fala").find((m) => avisos.includes(String(m.texto))));
    expect(aviso.tipo).toBe("aviso");
    expect(msgs(midia, "bot-fala").filter((m) => avisos.includes(String(m.texto)))).toHaveLength(1);
  });
});
