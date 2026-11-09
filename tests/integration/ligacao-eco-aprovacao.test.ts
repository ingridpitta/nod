import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { criarServicoVoz } from "../../src/adapters/voz/orquestrador.ts";
import { criarProvedoresFalsos } from "../../src/adapters/voz/voz-falsa.ts";
import type { CanalVoz } from "../../src/adapters/voz/ws.ts";
import { decidir } from "../../src/use-cases/decidir.ts";
import { leituraDaDecisao } from "../../src/use-cases/ligacoes.ts";
import { pedirAprovacao } from "../../src/use-cases/pedir-aprovacao.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-165: o eco do alto-falante na janela de aprovação por voz (ADR-074) nunca vira decisão. Uma aprovação pendente de
 * verdade no banco, a leitura que o servidor monta para ela, e o orquestrador com canais e STT falsos devolvendo o que o
 * microfone ouviu do bot. O eco que começou durante a leitura e terminou já com a janela aberta não vira comando; a
 * decisão segue pendente. Controle: a mesma frase falada depois da abertura vira comando e decide.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
type CanalFalso = CanalVoz & { json: Record<string, unknown>[]; fechadoCom: number | null; receber(m: object | Uint8Array): void };

function canalFalso(): CanalFalso {
  let aoMsg: ((m: { texto: string } | { binario: Uint8Array }) => void) | null = null;
  const c: CanalFalso = {
    json: [],
    fechadoCom: null,
    enviarJson(m) { c.json.push(m as Record<string, unknown>); },
    enviarBinario() {},
    fechar(codigo) { c.fechadoCom = codigo; },
    aoMensagem(fn) { aoMsg = fn; },
    aoFechar() {},
    pendente: () => 0,
    receber(m) { aoMsg?.(m instanceof Uint8Array ? { binario: m } : { texto: JSON.stringify(m) }); },
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

const msgs = (c: CanalFalso, t: string) => c.json.filter((m) => m.t === t);

/** Uma aprovação pendente de verdade (e-mail para a Ana) e a leitura que a ligação faria dela. */
async function aprovacaoPendente(trx: Trx) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Nina" });
  const email = await repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
  await repos.conectores.registrarSonda(email?.id ?? "", { ok: true, catalogo: [{ nome: "enviar", descricao: "envia", schema: { type: "object" }, readOnlyHint: false }], agora: Date.now() });
  const consentimento = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "consentimento", texto: "ok", confianca: "confiavel" });
  await repos.concessoes.conceder({ agenteId, conectorId: email?.id ?? "", capacidade: "enviar", mensagemId: consentimento?.id ?? "" });
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "manda o e-mail", entradaConfianca: "confiavel", modelo: "m" });
  await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
  const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
  const texto = "Ana, o relatório segue em anexo.";
  const p = await pedirAprovacao(deps, { turnoId: turno?.id ?? "", agenteId, conversaId, resumo: "e-mail para a Ana", itens: [{ texto, destino: { conector: "email", ferramenta: "enviar", argumentos: { texto } } }] });
  if (p.data.estado !== "pendente") throw new Error("esperava pendente");
  const decisaoId = p.data.decisao_id;
  const leitura = (await leituraDaDecisao(deps, { decisaoId })).data;
  if (!leitura) throw new Error("sem leitura");
  const estado = async () => (await repos.decisoes.buscar(decisaoId))?.estado;
  return { deps, decisaoId, leitura, estado };
}

/** A ligação atendida, com a saudação já tocada: pronta para ler a aprovação. */
async function ligacao(roteiro: string[]) {
  const provedores = criarProvedoresFalsos({ roteiro, silencioso: true });
  const voz = criarServicoVoz({
    provedores,
    persistencia: { atender: async () => undefined, gravarFala: async () => undefined, encerrar: async () => undefined },
    aleatorio: () => 0.99,
    prazos: { midiaReconexaoMs: 100, cerebroReconexaoMs: 150, cerebroPrimeiroMs: 5000, confirmarInterrupcaoMs: 300, resumoMs: 50 },
  });
  voz.registrar({ ligacaoId: "l1", tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON, agenteId: "a", conversaId: "c", turnoId: "turno", voz: "clara", velocidade: 1, nomeBot: "Nina", genero: "feminina", maxS: 600 });
  const midia = canalFalso();
  const cerebro = canalFalso();
  voz.anexarMidia({ pessoaId: PESSOA_MARLON, ligacaoId: "l1", retomar: false, canal: midia });
  voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
  await dormir(50);
  for (const m of msgs(midia, "bot-fala")) midia.receber({ t: "tocou-fim", utt: m.utt });
  let seq = 0;
  const falar = (quadros: number) => { for (let i = 0; i < quadros; i++) midia.receber(quadro(seq++, true)); };
  const calar = (quadros: number) => { for (let i = 0; i < quadros; i++) midia.receber(quadro(seq++, false)); };
  return { voz, provedores, midia, cerebro, falar, calar };
}

describeIntegracao("eco na janela de aprovação por voz não decide (NOD-165)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("o eco da leitura, inteiro ou só o 'eu aprovo', que começa com o bot falando e termina na janela, dá zero decisões", async () => {
    await withRollback(MARLON, async (trx) => {
      const a = await aprovacaoPendente(trx);
      expect(a.leitura.perfil).toBe("estrito");
      expect(a.leitura.leitura).toContain("eu aprovo");
      const linhas: string[] = [];
      vi.spyOn(console, "log").mockImplementation((x: unknown) => void linhas.push(String(x)));
      const l = await ligacao([]);
      try {
        l.voz.pedirAprovacao("l1", a.leitura);
        const leitura = await ate(() => msgs(l.midia, "bot-fala").find((m) => m.tipo === "leitura"));
        // 1) A leitura inteira volta pelo microfone enquanto o bot ainda lê: a guarda de eco descarta.
        l.provedores.stt.empurrarTexto(a.leitura.leitura);
        l.falar(20);
        l.calar(40);
        await ate(() => linhas.some((x) => x.includes('"voz_eco_descartado"')));
        // 2) O fim da leitura ("…diga eu aprovo") volta pelo microfone, começa com o bot tocando e o trecho só fecha
        //    depois de a janela abrir. Na janela a guarda de similaridade fica desligada (ADR-074): quem protege é o
        //    começo do trecho, que foi antes da abertura.
        l.provedores.stt.empurrarTexto("eu aprovo");
        l.falar(20);
        l.midia.receber({ t: "tocou-fim", utt: leitura.utt });
        await ate(() => msgs(l.midia, "janela").length > 0);
        await dormir(80);
        l.calar(40);
        // O STT entregou o "eu aprovo" com a janela aberta (a legenda prova), e mesmo assim não houve comando.
        await ate(() => msgs(l.midia, "legenda").find((m) => m.final === true && m.texto === "eu aprovo"));
        await dormir(300);
        expect(msgs(l.midia, "comando")).toHaveLength(0);
        // Zero comandos só vale com a mídia aberta: fechada pela guarda de abuso (4429), também daria zero (NOD-184).
        expect(l.midia.fechadoCom).toBeNull();
        // Nada de decisão: o card segue pendente no banco.
        expect(await a.estado()).toBe("pendente");
      } finally {
        await l.voz.fechar();
      }
    });
  });

  it("controle: o mesmo 'eu aprovo' falado depois da abertura da janela vira comando e decide", async () => {
    await withRollback(MARLON, async (trx) => {
      const a = await aprovacaoPendente(trx);
      const l = await ligacao([]);
      try {
        l.voz.pedirAprovacao("l1", a.leitura);
        const leitura = await ate(() => msgs(l.midia, "bot-fala").find((m) => m.tipo === "leitura"));
        l.midia.receber({ t: "tocou-fim", utt: leitura.utt });
        await ate(() => msgs(l.midia, "janela").length > 0);
        await dormir(80);
        l.provedores.stt.empurrarTexto("eu aprovo");
        l.falar(20);
        l.calar(40);
        const cmd = await ate(() => msgs(l.midia, "comando")[0]);
        expect(cmd).toMatchObject({ decisaoId: a.decisaoId, acao: "aprovar" });
        expect(l.voz.conferirComando({ pessoaId: PESSOA_MARLON, ligacaoId: "l1", comandoId: String(cmd.comandoId), decisaoId: a.decisaoId, acao: "aprovar" })).toBe(true);
        await decidir(a.deps, { decisaoId: a.decisaoId });
        expect(await a.estado()).not.toBe("pendente");
      } finally {
        await l.voz.fechar();
      }
    });
  });
});
