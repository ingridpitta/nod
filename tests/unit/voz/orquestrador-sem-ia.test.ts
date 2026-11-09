import { describe, expect, it } from "vitest";
import type { EstadoIaDaLigacao, MotivoFimLigacao, MsgCerebroServidor, MsgMidiaServidor } from "../../../src/contracts/voz.ts";
import { criarServicoVoz, type DepsVoz, type FalaParaGravar, type FonteDeEsperas, type RegistroLigacao, type ServicoVoz } from "../../../src/adapters/voz/orquestrador.ts";
import { criarProvedoresFalsos } from "../../../src/adapters/voz/voz-falsa.ts";
import type { CanalVoz } from "../../../src/adapters/voz/ws.ts";

/**
 * A rede de segurança da ligação no orquestrador (definido em 2026-10-05), com canais e provedores falsos e prazos
 * curtos: o turno-cérebro termina com a ligação viva e ela NÃO fica muda — fala a frase fixa, avisa a tela, para de
 * ouvir (nenhuma vez pendurada), espera a escolha e, com a escolha, aceita o turno-cérebro novo. Reproduz a ligação de
 * 2026-10-05 em produção (a conta do Claude Code sem acesso: saudação, e depois silêncio).
 */
type CanalFalso = CanalVoz & { json: Record<string, unknown>[]; receber(m: object | Uint8Array): void; cair(): void };

function canalFalso(): CanalFalso {
  let aoMsg: ((m: { texto: string } | { binario: Uint8Array }) => void) | null = null;
  let aoFim: ((c: number) => void) | null = null;
  const c: CanalFalso = {
    json: [],
    enviarJson(m) { c.json.push(m as Record<string, unknown>); },
    enviarBinario: () => undefined,
    fechar: () => undefined,
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

const FRASE = "Não consegui usar a IA deste Mac. As opções estão na tela.";
const DUAS_PRONTAS: EstadoIaDaLigacao[] = [{ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado: "pronto" }];

function montar(o: { ias?: () => EstadoIaDaLigacao[]; prazos?: Record<string, number>; roteiro?: string[]; esperas?: FonteDeEsperas; relogio?: () => number; continuarCom?: DepsVoz["continuarCom"] } = {}) {
  const falas: FalaParaGravar[] = [];
  const fins: MotivoFimLigacao[] = [];
  const voz = criarServicoVoz({
    provedores: criarProvedoresFalsos({ roteiro: o.roteiro ?? [], silencioso: true }),
    persistencia: {
      atender: async () => undefined,
      gravarFala: async (_r, f) => { falas.push(f); },
      encerrar: async (_r, motivo) => { fins.push(motivo); },
    },
    aleatorio: () => 0.99,
    iasDoMac: o.ias ?? (() => DUAS_PRONTAS),
    ...(o.esperas ? { esperas: o.esperas } : {}),
    ...(o.relogio ? { relogio: o.relogio } : {}),
    ...(o.continuarCom ? { continuarCom: o.continuarCom } : {}),
    prazos: { midiaReconexaoMs: 100, cerebroReconexaoMs: 150, cerebroPrimeiroMs: 5000, confirmarInterrupcaoMs: 300, resumoMs: 50, vigiaDasIasMs: 30, ...o.prazos },
  });
  const reg: RegistroLigacao = { ligacaoId: "l1", tenantId: "t", pessoaId: "p", agenteId: "a", conversaId: "c", turnoId: "turno-1", voz: "clara", velocidade: 1, nomeBot: "Nina", genero: "feminina", maxS: 600 };
  voz.registrar(reg);
  const midia = canalFalso();
  const cerebro = canalFalso();
  return { voz, falas, fins, midia, cerebro };
}

const msgs = (c: CanalFalso, t: string) => c.json.filter((m) => m.t === t) as (MsgMidiaServidor & MsgCerebroServidor & Record<string, unknown>)[];
const falasDoBot = (c: CanalFalso) => msgs(c, "bot-fala").map((m) => String(m.texto));

/** Liga, conecta o cérebro (que se apresenta como Claude) e deixa a saudação sair. */
async function emLigacao(m: ReturnType<typeof montar>): Promise<void> {
  expect(m.voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: m.midia })).toBeNull();
  expect(m.voz.anexarCerebro({ turnoId: "turno-1", ligacaoId: "l1", canal: m.cerebro })).toBeNull();
  m.cerebro.receber({ t: "ola", ligacaoId: "l1", capacidades: { interrupcao: true, harness: "claude-cli" } });
  await ate(() => falasDoBot(m.midia).some((t) => t.includes("Nina")));
}

/** O que a composição faz quando o frame do turno chega: o canal do cérebro fecha e o desfecho do turno é entregue. */
function cairCerebro(m: ReturnType<typeof montar>, p: { sucesso?: boolean; motivo?: string | null; causaSemIa?: string | null; ia?: string | null; turnoId?: string } = {}): boolean {
  m.cerebro.cair();
  return m.voz.cerebroTerminou("l1", { turnoId: p.turnoId ?? "turno-1", sucesso: p.sucesso ?? false, motivo: p.motivo ?? "sem_progresso", causaSemIa: p.causaSemIa ?? null, ia: p.ia ?? null });
}

describe("rede de segurança: a IA do Mac cai com a ligação em curso", () => {
  it("fala a frase fixa, manda o aviso à mídia com a causa e as IAs, e a tela passa a 'esperando a escolha'", async () => {
    const m = montar();
    await emLigacao(m);
    expect(cairCerebro(m, { causaSemIa: "conta_sem_acesso", ia: "claude-cli" })).toBe(true);
    const aviso = await ate(() => msgs(m.midia, "sem-ia")[0]);
    expect(aviso).toMatchObject({ t: "sem-ia", causa: "conta_sem_acesso", ia: "claude-cli", ias: DUAS_PRONTAS });
    expect(Number(aviso.ate)).toBeGreaterThan(Date.now());
    await ate(() => falasDoBot(m.midia).includes(FRASE));
    // A frase é roteiro: sai como aviso (não como espera apagada) e entra na transcrição.
    expect(msgs(m.midia, "bot-fala").find((x) => x.texto === FRASE)).toMatchObject({ tipo: "aviso" });
    expect(m.falas.some((f) => f.autor === "bot" && f.texto === FRASE)).toBe(true);
    await ate(() => msgs(m.midia, "estado").at(-1)?.fase === "aguardando_escolha");
    expect(m.voz.aguardandoEscolha({ pessoaId: "p", ligacaoId: "l1" })).toBe(true);
    // De outra pessoa, a ligação não existe.
    expect(m.voz.aguardandoEscolha({ pessoaId: "outra", ligacaoId: "l1" })).toBe(false);
    // A ligação não caiu: passou do prazo de reconexão do cérebro (150 ms) e segue viva.
    await dormir(250);
    expect(m.fins).toEqual([]);
    expect(msgs(m.midia, "fim")).toEqual([]);
    await m.voz.fechar();
  });

  it("sem a causa do turno, a causa é a genérica; a IA vem do `ola` do cérebro", async () => {
    const m = montar();
    await emLigacao(m);
    cairCerebro(m, { motivo: "trabalho_incompleto" });
    expect(await ate(() => msgs(m.midia, "sem-ia")[0])).toMatchObject({ causa: "falhou", ia: "claude-cli" });
    await m.voz.fechar();
  });

  it("turno que termina 'com sucesso' com a ligação viva também é queda: ninguém mais responde", async () => {
    const m = montar();
    await emLigacao(m);
    cairCerebro(m, { sucesso: true, motivo: null });
    expect(await ate(() => msgs(m.midia, "sem-ia")[0])).toMatchObject({ causa: "falhou" });
    await m.voz.fechar();
  });

  it("Parar e Mac sem contato não acionam a rede: vale o caminho antigo (reconexão e `cerebro_caiu`)", async () => {
    for (const motivo of ["parado_pela_pessoa", "maquina_sem_contato"]) {
      const m = montar();
      await emLigacao(m);
      expect(cairCerebro(m, { motivo })).toBe(true);
      await ate(() => m.fins.length > 0);
      expect(m.fins).toEqual(["cerebro_caiu"]);
      expect(msgs(m.midia, "sem-ia")).toEqual([]);
      expect(falasDoBot(m.midia)).not.toContain(FRASE);
      await m.voz.fechar();
    }
  });

  it("o fim de um turno que não é o cérebro desta ligação não é com ela (tarefa pedida na ligação)", async () => {
    const m = montar();
    await emLigacao(m);
    expect(m.voz.cerebroTerminou("l1", { turnoId: "tarefa-9", sucesso: false, motivo: "sem_progresso" })).toBe(false);
    expect(m.voz.cerebroTerminou("ligacao-que-nao-existe", { turnoId: "turno-1", sucesso: false })).toBe(false);
    await dormir(40);
    expect(msgs(m.midia, "sem-ia")).toEqual([]);
    await m.voz.fechar();
  });

  it("esperando a escolha, o que a pessoa diz ou escreve não vira vez (nada fica pendurado sem resposta)", async () => {
    const m = montar({ roteiro: ["tem alguém aí?"] });
    await emLigacao(m);
    cairCerebro(m, { causaSemIa: "conta_sem_acesso", ia: "claude-cli" });
    await ate(() => msgs(m.midia, "sem-ia")[0]);
    const estadosAntes = msgs(m.midia, "estado").length;
    // Fala: 600 ms de voz e 1,2 s de silêncio (no caminho normal, isso vira legenda, vez e "pensando").
    let seq = 0;
    for (let i = 0; i < 30; i++) m.midia.receber(quadro(seq++, true));
    for (let i = 0; i < 60; i++) m.midia.receber(quadro(seq++, false));
    m.midia.receber({ t: "texto", conteudo: "alô?" });
    await dormir(900);
    expect(msgs(m.midia, "legenda")).toEqual([]);
    expect(msgs(m.midia, "estado").slice(estadosAntes).map((e) => e.fase).filter((f) => f === "pensando" || f === "ouvindo")).toEqual([]);
    expect(m.falas.filter((f) => f.autor === "pessoa")).toEqual([]);
    await m.voz.fechar();
  });

  it("a vez que estava sem resposta quando o cérebro caiu é solta, e as esperas dela param", async () => {
    const m = montar();
    await emLigacao(m);
    m.midia.receber({ t: "texto", conteudo: "quero criar uma rotina" });
    await ate(() => msgs(m.cerebro, "vez").some((v) => v.n === 1));
    cairCerebro(m);
    await ate(() => msgs(m.midia, "sem-ia")[0]);
    // O cérebro que caiu ainda manda um resto de resposta por um canal que sobrou: não é falado.
    m.cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Claro, vamos criar a rotina. " });
    m.cerebro.receber({ t: "fala-fim", n: 1 });
    await dormir(60);
    expect(falasDoBot(m.midia).some((t) => t.includes("rotina"))).toBe(false);
    await m.voz.fechar();
  });

  it("sem escolha no prazo, a ligação encerra com o motivo próprio `sem_ia`", async () => {
    const m = montar({ prazos: { escolhaSemIaMs: 120 } });
    await emLigacao(m);
    cairCerebro(m);
    await ate(() => m.fins.length > 0);
    expect(m.fins).toEqual(["sem_ia"]);
    expect(msgs(m.midia, "fim").at(-1)).toMatchObject({ motivo: "sem_ia" });
    await m.voz.fechar();
  });

  it("`resolvendo` (a pessoa abriu o login) recomeça a espera, com teto de renovações", async () => {
    // Relógio na mão do teste (os timers são de verdade, mas o prazo anunciado sai daqui): sem corrida com a máquina.
    let agora = 1_000_000;
    const m = montar({ prazos: { escolhaSemIaMs: 1_500 }, relogio: () => agora });
    await emLigacao(m);
    cairCerebro(m);
    const primeiro = Number((await ate(() => msgs(m.midia, "sem-ia")[0])).ate);
    expect(primeiro).toBe(agora + 1_500);
    // Cada `resolvendo` rearma o prazo inteiro a partir de agora e reenvia o aviso com o prazo novo.
    for (let i = 1; i <= 5; i++) {
      agora += 100;
      m.midia.receber({ t: "resolvendo" });
      expect(msgs(m.midia, "sem-ia")).toHaveLength(1 + i);
      expect(Number(msgs(m.midia, "sem-ia").at(-1)?.ate)).toBe(agora + 1_500);
    }
    // O teto: da 6ª em diante nada é rearmado nem reenviado.
    for (let i = 0; i < 4; i++) m.midia.receber({ t: "resolvendo" });
    expect(msgs(m.midia, "sem-ia")).toHaveLength(1 + 5);
    expect(m.fins).toEqual([]);
    // E o prazo vence de verdade: a ligação encerra com `sem_ia`.
    await ate(() => m.fins.length > 0, 8_000);
    expect(m.fins).toEqual(["sem_ia"]);
    await m.voz.fechar();
  });

  it("uma IA que fica pronta enquanto a ligação espera atualiza o aviso (o Mac reanunciou o inventário)", async () => {
    let ias: EstadoIaDaLigacao[] = [{ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado: "ausente" }];
    const m = montar({ ias: () => ias });
    await emLigacao(m);
    cairCerebro(m, { causaSemIa: "conta_sem_acesso", ia: "claude-cli" });
    expect((await ate(() => msgs(m.midia, "sem-ia")[0])).ias).toEqual(ias);
    ias = [{ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado: "pronto" }];
    const novo = await ate(() => msgs(m.midia, "sem-ia").find((x) => JSON.stringify(x.ias) === JSON.stringify(ias)));
    expect(novo).toMatchObject({ causa: "conta_sem_acesso", ia: "claude-cli" });
    // Sem mudança, o aviso não é reenviado a cada volta da vigia.
    const n = msgs(m.midia, "sem-ia").length;
    await dormir(120);
    expect(msgs(m.midia, "sem-ia").length).toBe(n);
    await m.voz.fechar();
  });

  it("a página que recarrega no meio da espera recebe o aviso de novo, e a frase não é repetida", async () => {
    const m = montar();
    await emLigacao(m);
    cairCerebro(m, { ia: "claude-cli" });
    await ate(() => falasDoBot(m.midia).includes(FRASE));
    const outra = canalFalso();
    expect(m.voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: true, canal: outra })).toBeNull();
    expect(msgs(outra, "sem-ia")[0]).toMatchObject({ causa: "falhou", ia: "claude-cli" });
    expect(msgs(outra, "estado").at(-1)).toMatchObject({ fase: "aguardando_escolha" });
    await dormir(60);
    expect(falasDoBot(outra)).not.toContain(FRASE);
    await m.voz.fechar();
  });

  it("continuar com a outra IA: o turno novo é o cérebro da MESMA ligação, recebe o fio da conversa e a ligação volta a ouvir", async () => {
    const m = montar();
    await emLigacao(m);
    m.midia.receber({ t: "texto", conteudo: "quero criar uma rotina" });
    await ate(() => msgs(m.cerebro, "vez").some((v) => v.n === 1));
    cairCerebro(m, { causaSemIa: "conta_sem_acesso", ia: "claude-cli" });
    await ate(() => falasDoBot(m.midia).includes(FRASE));

    // Só quem espera a escolha reabre; de outra pessoa, nada.
    expect(m.voz.reabrirCerebro({ pessoaId: "outra", ligacaoId: "l1", turnoId: "turno-2", ia: "codex-cli" })).toBe(false);
    expect(m.voz.reabrirCerebro({ pessoaId: "p", ligacaoId: "l1", turnoId: "turno-2", ia: "codex-cli" })).toBe(true);
    expect(m.voz.aguardandoEscolha({ pessoaId: "p", ligacaoId: "l1" })).toBe(false);
    expect(msgs(m.midia, "estado").at(-1)).toMatchObject({ fase: "conectando" });
    // Duas vezes não: já não há o que escolher.
    expect(m.voz.reabrirCerebro({ pessoaId: "p", ligacaoId: "l1", turnoId: "turno-3", ia: "codex-cli" })).toBe(false);

    // O canal do cérebro agora só aceita o turno novo.
    expect(m.voz.anexarCerebro({ turnoId: "turno-1", ligacaoId: "l1", canal: canalFalso() })).toBe(4404);
    const novo = canalFalso();
    expect(m.voz.anexarCerebro({ turnoId: "turno-2", ligacaoId: "l1", canal: novo })).toBeNull();
    novo.receber({ t: "ola", ligacaoId: "l1", capacidades: { interrupcao: true, harness: "codex-cli" } });

    // A vez 0 diz que ele chegou no meio; a transcrição vai como nota NÃO confiável.
    const vez0 = msgs(novo, "vez").find((v) => v.n === 0);
    expect(String(vez0?.texto)).toContain("assumindo agora uma ligação que já estava em curso");
    const fio = msgs(novo, "nota").find((n) => n.confiavel === false);
    expect(String(fio?.texto)).toContain("Pessoa: quero criar uma rotina");
    expect(String(fio?.texto)).toContain(`Nina: ${FRASE}`);

    expect(msgs(m.midia, "ia-voltou").at(-1)).toEqual({ t: "ia-voltou", ia: "codex-cli", trocou: true });
    expect(msgs(m.midia, "cerebro").at(-1)).toMatchObject({ online: true });
    // O bot retoma em voz, numa brecha (o app relata que a frase fixa acabou de tocar): o pedido de retomada chega como
    // uma VEZ do sistema, com número próprio (o laço do Codex responde a `nota` com o número da vez anterior, que aqui
    // seria a 0 e nunca seria falada), e a resposta do cérebro novo é falada.
    for (const x of msgs(m.midia, "bot-fala")) m.midia.receber({ t: "tocou-fim", utt: x.utt });
    const retomada = await ate(() => msgs(novo, "vez").find((v) => Number(v.n) > 0));
    expect(String(retomada.texto)).toContain("retome de onde a conversa parou");
    expect(String(retomada.texto).startsWith("[nod] ")).toBe(true);
    expect(msgs(novo, "nota").filter((n) => typeof n.n === "number")).toEqual([]);
    novo.receber({ t: "fala", n: Number(retomada.n), seq: 0, delta: "Voltei. Você queria criar uma rotina, certo? " });
    novo.receber({ t: "fala-fim", n: Number(retomada.n) });
    await ate(() => falasDoBot(m.midia).some((t) => t.includes("Você queria criar uma rotina")));

    // E a ligação voltou a ouvir: o texto vira vez para o cérebro novo.
    m.midia.receber({ t: "texto", conteudo: "isso, todo dia às oito" });
    const vez = await ate(() => msgs(novo, "vez").find((v) => String(v.texto).includes("todo dia às oito")));
    expect(Number(vez.n)).toBeGreaterThan(Number(retomada.n));
    expect(m.fins).toEqual([]);
    await m.voz.fechar();
  });

  it("com o clipe em cache, a frase de retomada do roteiro ('Voltei!') toca e a nota diz ao cérebro para não repetir", async () => {
    const esperas: FonteDeEsperas = { obterPronto: () => new Int16Array(2400), aquecer: () => undefined };
    const m = montar({ esperas });
    await emLigacao(m);
    cairCerebro(m, { ia: "claude-cli" });
    await ate(() => falasDoBot(m.midia).includes(FRASE));
    m.voz.reabrirCerebro({ pessoaId: "p", ligacaoId: "l1", turnoId: "turno-2", ia: "codex-cli" });
    const novo = canalFalso();
    m.voz.anexarCerebro({ turnoId: "turno-2", ligacaoId: "l1", canal: novo });
    expect(msgs(m.midia, "bot-fala").some((x) => x.tipo === "espera" && /[Vv]olt/.test(String(x.texto)))).toBe(true);
    for (const x of msgs(m.midia, "bot-fala")) m.midia.receber({ t: "tocou-fim", utt: x.utt });
    const retomada = await ate(() => msgs(novo, "vez").find((v) => Number(v.n) > 0));
    expect(String(retomada.texto)).toContain("já ouviu que você voltou");
    await m.voz.fechar();
  });

  it("tentar de novo com a MESMA IA não é 'trocou'", async () => {
    const m = montar();
    await emLigacao(m);
    cairCerebro(m, { ia: "claude-cli" });
    await ate(() => msgs(m.midia, "sem-ia")[0]);
    m.voz.reabrirCerebro({ pessoaId: "p", ligacaoId: "l1", turnoId: "turno-2", ia: "claude-cli" });
    m.voz.anexarCerebro({ turnoId: "turno-2", ligacaoId: "l1", canal: canalFalso() });
    expect(msgs(m.midia, "ia-voltou").at(-1)).toEqual({ t: "ia-voltou", ia: "claude-cli", trocou: false });
    await m.voz.fechar();
  });

  it("o cérebro novo também cai (ou nem aparece): a ligação volta ao aviso, não cai nem fica muda", async () => {
    const m = montar({ prazos: { cerebroPrimeiroMs: 120 } });
    await emLigacao(m);
    cairCerebro(m, { causaSemIa: "conta_sem_acesso", ia: "claude-cli" });
    await ate(() => msgs(m.midia, "sem-ia").length === 1);
    // 1) O turno novo falha antes de discar: o desfecho dele reabre o aviso, agora com a IA escolhida.
    m.voz.reabrirCerebro({ pessoaId: "p", ligacaoId: "l1", turnoId: "turno-2", ia: "codex-cli" });
    expect(m.voz.cerebroTerminou("l1", { turnoId: "turno-2", sucesso: false, motivo: "sem_progresso", ia: "codex-cli" })).toBe(true);
    expect((await ate(() => msgs(m.midia, "sem-ia").length === 2 && msgs(m.midia, "sem-ia")[1]))).toMatchObject({ causa: "falhou", ia: "codex-cli" });
    // A frase sai de novo: é outra queda.
    await ate(() => falasDoBot(m.midia).filter((t) => t === FRASE).length === 2);
    // 2) O turno seguinte nunca disca: vencido o prazo do cérebro, o aviso volta (em vez de `cerebro_caiu`).
    m.voz.reabrirCerebro({ pessoaId: "p", ligacaoId: "l1", turnoId: "turno-3", ia: "claude-cli" });
    await ate(() => msgs(m.midia, "sem-ia").length === 3);
    expect(m.fins).toEqual([]);
    // 3) E se ele discar atrasado, com a ligação já de volta ao aviso, assume do mesmo jeito.
    expect(m.voz.anexarCerebro({ turnoId: "turno-3", ligacaoId: "l1", canal: canalFalso() })).toBeNull();
    expect(m.voz.aguardandoEscolha({ pessoaId: "p", ligacaoId: "l1" })).toBe(false);
    expect(msgs(m.midia, "ia-voltou").length).toBe(1);
    await m.voz.fechar();
  });

  it("a IA cai antes de a mídia abrir (a pessoa ainda não atendeu): o aviso e a frase saem ao atender", async () => {
    const m = montar();
    expect(m.voz.anexarCerebro({ turnoId: "turno-1", ligacaoId: "l1", canal: m.cerebro })).toBeNull();
    cairCerebro(m, { causaSemIa: "conta_sem_acesso", ia: "claude-cli" });
    expect(m.voz.aguardandoEscolha({ pessoaId: "p", ligacaoId: "l1" })).toBe(true);
    expect(m.voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: m.midia })).toBeNull();
    expect(msgs(m.midia, "sem-ia")[0]).toMatchObject({ causa: "conta_sem_acesso", ia: "claude-cli" });
    const ditas = await ate(() => (falasDoBot(m.midia).includes(FRASE) ? falasDoBot(m.midia) : null));
    // A saudação vem antes: é roteiro, e foi o que aconteceu em produção.
    expect(ditas.findIndex((t) => t.includes("Nina"))).toBeLessThan(ditas.indexOf(FRASE));
    await m.voz.fechar();
  });

  it("desligar durante a espera encerra como a pessoa pediu; o fim do turno que chega depois não reabre nada", async () => {
    const m = montar();
    await emLigacao(m);
    cairCerebro(m);
    await ate(() => msgs(m.midia, "sem-ia")[0]);
    m.midia.receber({ t: "tchau" });
    await ate(() => m.fins.length > 0);
    expect(m.fins).toEqual(["pessoa_desligou"]);
    expect(m.voz.reabrirCerebro({ pessoaId: "p", ligacaoId: "l1", turnoId: "turno-2", ia: "codex-cli" })).toBe(false);
    await m.voz.fechar();
  });
});

describe("limite da assinatura (NOD-168, ADR-078)", () => {
  const SO_CLAUDE: EstadoIaDaLigacao[] = [{ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado: "nao_autenticado" }];

  it("com a outra IA pronta: aviso escrito e falado, o 'sem IA' com causa `limite` (sem a frase fixa por cima) e nenhum `limite_da_assinatura`", async () => {
    const m = montar();
    await emLigacao(m);
    m.cerebro.receber({ t: "limite" });
    const aviso = await ate(() => msgs(m.midia, "sem-ia")[0]);
    expect(aviso).toMatchObject({ causa: "limite", ia: "claude-cli", ias: DUAS_PRONTAS });
    expect(msgs(m.midia, "aviso").map((x) => x.texto)).toContain("Sua assinatura de IA chegou ao limite.");
    await ate(() => falasDoBot(m.midia).some((t) => t.includes("chegou ao limite") && t.includes("outra IA")));
    await ate(() => msgs(m.midia, "estado").at(-1)?.fase === "aguardando_escolha");
    expect(falasDoBot(m.midia)).not.toContain(FRASE);
    // Um segundo `limite` (o CLI manda um só, mas o canal é de fora) não muda nada.
    m.cerebro.receber({ t: "limite" });
    await dormir(250);
    expect(msgs(m.midia, "sem-ia")).toHaveLength(1);
    expect(m.fins).toEqual([]);
    expect(m.voz.aguardandoEscolha({ pessoaId: "p", ligacaoId: "l1" })).toBe(true);
    await m.voz.fechar();
  });

  it("sem outra IA pronta: aviso escrito e falado, e a ligação encerra com `limite_da_assinatura` depois da fala", async () => {
    const m = montar({ ias: () => SO_CLAUDE });
    await emLigacao(m);
    m.cerebro.receber({ t: "limite" });
    await ate(() => falasDoBot(m.midia).some((t) => t.includes("vou encerrar a ligação")));
    expect(msgs(m.midia, "aviso").map((x) => x.texto)).toContain("Sua assinatura de IA chegou ao limite.");
    // A fala toca até o cliente dizer que tocou: a ligação ainda não encerrou.
    expect(m.fins).toEqual([]);
    for (const f of msgs(m.midia, "bot-fala")) m.midia.receber({ t: "tocou-fim", utt: Number(f.utt) });
    await ate(() => m.fins.length > 0);
    expect(m.fins).toEqual(["limite_da_assinatura"]);
    expect(msgs(m.midia, "sem-ia")).toEqual([]);
    expect(msgs(m.cerebro, "fim").at(-1)).toMatchObject({ motivo: "limite_da_assinatura" });
    await m.voz.fechar();
  });

  it("sem outra IA pronta e o cliente sem confirmar a fala: o teto encerra mesmo assim", async () => {
    const m = montar({ ias: () => SO_CLAUDE, prazos: { limiteFalaMs: 400 } });
    await emLigacao(m);
    m.cerebro.receber({ t: "limite" });
    await ate(() => m.fins.length > 0, 4000);
    expect(m.fins).toEqual(["limite_da_assinatura"]);
    await m.voz.fechar();
  });

  it("sem outra IA pronta, até encerrar: o que a pessoa diz não vira vez, nada do cérebro é falado e a queda dele não muda o motivo", async () => {
    const m = montar({ ias: () => SO_CLAUDE, prazos: { limiteFalaMs: 400 } });
    await emLigacao(m);
    m.cerebro.receber({ t: "limite" });
    await ate(() => falasDoBot(m.midia).some((t) => t.includes("vou encerrar a ligação")));
    const estadosAntes = msgs(m.midia, "estado").length;
    // A pessoa fala por cima do aviso: não há vez nova para o cérebro (antes, a resposta dele, o erro do CLI, era falada).
    m.midia.receber({ t: "texto", conteudo: "alô?" });
    m.cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "You've hit your limit. " });
    m.cerebro.receber({ t: "fala-fim", n: 1 });
    await dormir(60);
    expect(msgs(m.cerebro, "vez").filter((v) => Number(v.n) > 0)).toEqual([]);
    expect(falasDoBot(m.midia).some((t) => t.includes("hit your limit"))).toBe(false);
    // O CLI encerra o turno e o canal do cérebro fecha: nem reconexão, nem "sem IA".
    expect(cairCerebro(m, { ia: "claude-cli" })).toBe(true);
    await ate(() => m.fins.length > 0, 4000);
    expect(m.fins).toEqual(["limite_da_assinatura"]);
    expect(msgs(m.midia, "sem-ia")).toEqual([]);
    expect(msgs(m.midia, "estado").slice(estadosAntes).map((e) => e.fase)).not.toContain("reconectando");
    await m.voz.fechar();
  });

  it("a IA que assumiu também bate no limite: o `limite` dela vale (sem outra pronta, encerra)", async () => {
    let ias: EstadoIaDaLigacao[] = DUAS_PRONTAS;
    const m = montar({ ias: () => ias, prazos: { limiteFalaMs: 400 } });
    await emLigacao(m);
    m.cerebro.receber({ t: "limite" });
    await ate(() => m.voz.aguardandoEscolha({ pessoaId: "p", ligacaoId: "l1" }));
    expect(m.voz.reabrirCerebro({ pessoaId: "p", ligacaoId: "l1", turnoId: "turno-2", ia: "codex-cli" })).toBe(true);
    const novo = canalFalso();
    expect(m.voz.anexarCerebro({ turnoId: "turno-2", ligacaoId: "l1", canal: novo })).toBeNull();
    novo.receber({ t: "ola", ligacaoId: "l1", capacidades: { interrupcao: true, harness: "codex-cli" } });
    ias = [{ id: "claude-cli", estado: "nao_autenticado" }, { id: "codex-cli", estado: "pronto" }];
    novo.receber({ t: "limite" });
    await ate(() => m.fins.length > 0, 4000);
    expect(m.fins).toEqual(["limite_da_assinatura"]);
    await m.voz.fechar();
  });

  it("revisto em 2026-10-10 (emenda da ADR-078): com outra IA pronta, a ligação segue SOZINHA por ela, sem esperar a escolha", async () => {
    const pedidos: string[] = [];
    const servico: { voz: ServicoVoz | null } = { voz: null };
    const m = montar({
      continuarCom: async (ref, ia) => {
        pedidos.push(`${ref.ligacaoId}:${ia}`);
        return servico.voz?.reabrirCerebro({ pessoaId: ref.pessoaId, ligacaoId: ref.ligacaoId, turnoId: "turno-2", ia }) ?? false;
      },
    });
    servico.voz = m.voz;
    await emLigacao(m);
    m.cerebro.receber({ t: "limite" });
    await ate(() => pedidos.length === 1);
    expect(pedidos).toEqual(["l1:codex-cli"]);
    await ate(() => falasDoBot(m.midia).some((t) => t.includes("Vou continuar com o ChatGPT")));
    expect(falasDoBot(m.midia).some((t) => t.includes("escolha na tela"))).toBe(false);
    const novo = canalFalso();
    expect(m.voz.anexarCerebro({ turnoId: "turno-2", ligacaoId: "l1", canal: novo })).toBeNull();
    expect(msgs(m.midia, "ia-voltou").at(-1)).toEqual({ t: "ia-voltou", ia: "codex-cli", trocou: true });
    expect(m.fins).toEqual([]);
    await m.voz.fechar();
  });

  it("continuar sozinha não deu (o turno novo não nasceu): fica a escolha na tela, como antes", async () => {
    const m = montar({ continuarCom: async () => { throw new Error("banco fora"); } });
    await emLigacao(m);
    m.cerebro.receber({ t: "limite" });
    await ate(() => msgs(m.midia, "estado").at(-1)?.fase === "aguardando_escolha");
    expect(m.voz.aguardandoEscolha({ pessoaId: "p", ligacaoId: "l1" })).toBe(true);
    expect(m.fins).toEqual([]);
    await m.voz.fechar();
  });

  it("um `limite` que chega depois do fim é ignorado", async () => {
    const m = montar({ ias: () => SO_CLAUDE });
    await emLigacao(m);
    m.midia.receber({ t: "tchau" });
    await ate(() => m.fins.length > 0);
    m.cerebro.receber({ t: "limite" });
    await dormir(200);
    expect(m.fins).toEqual(["pessoa_desligou"]);
    expect(msgs(m.midia, "aviso")).toEqual([]);
    await m.voz.fechar();
  });
});
