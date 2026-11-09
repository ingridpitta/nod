import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { iniciarComputador, type CanalDoMotor, type LacoComputador } from "../../../src/adapters/executor/computador.ts";
import type { ComandoComputador, EstadoComputadorRelatado, MensagemAoSupervisor, ResultadoComandoComputador } from "../../../src/contracts/computador-motor.ts";

/** NOD-96 PR 3: o laço do motor com um supervisor falso no socket (o real é do PR 2) e uma ponte falsa. */
const comando = (id: string): ComandoComputador => ({ id, computadorId: "00000000-0000-4000-8000-0000000000c1", tipo: "acao", uso: "equilibrado", prazoMs: 1, assinatura: "x" });
const esperarAte = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); expect(cond()).toBe(true); };

let limpar: (() => void)[] = [];
afterEach(() => { for (const f of limpar) f(); limpar = []; });

function supervisorFalso(caminho: string, responder: (m: MensagemAoSupervisor, s: Socket) => void): Promise<{ recebidas: MensagemAoSupervisor[]; servidor: Server }> {
  const recebidas: MensagemAoSupervisor[] = [];
  const servidor = createServer((s) => {
    let resto = "";
    s.setEncoding("utf8");
    s.on("data", (d: string) => {
      resto += d;
      let i: number;
      while ((i = resto.indexOf("\n")) >= 0) { const m = JSON.parse(resto.slice(0, i)) as MensagemAoSupervisor; resto = resto.slice(i + 1); recebidas.push(m); responder(m, s); }
    });
  });
  limpar.push(() => servidor.close());
  return new Promise((r) => servidor.listen(caminho, () => r({ recebidas, servidor })));
}

function ponteFalsa(fila: (ComandoComputador[] | "sem_rota" | null)[]) {
  const resultados: ResultadoComandoComputador[] = [];
  const estados: EstadoComputadorRelatado[] = [];
  let aceitar = true;
  const canal: CanalDoMotor = {
    puxar: async () => { await new Promise((r) => setTimeout(r, 5)); return fila.shift() ?? []; },
    resultado: async (r) => { if (!aceitar) return false; resultados.push(r); return true; },
    estado: async (e) => { if (!aceitar) return false; estados.push(e); return true; },
  };
  return { canal, resultados, estados, recusar: (v: boolean) => { aceitar = !v; } };
}

function pasta() { const d = mkdtempSync(join(tmpdir(), "nod-comp-")); limpar.push(() => rmSync(d, { recursive: true, force: true })); return join(d, "ctl.sock"); }
function laco(l: LacoComputador) { limpar.unshift(() => l.parar()); return l; }

describe("laço do computador no motor", () => {
  it("repassa o comando como veio e posta a resposta; pede a foto e posta", async () => {
    const sock = pasta();
    const foto = { tipo: "estado", computadorId: "", ligado: false, supervisorPub: "p", telas: [] };
    const sup = await supervisorFalso(sock, (m, s) => {
      if (m.tipo === "comando") s.write(`${JSON.stringify({ tipo: "resultado", id: m.comando.id, desfecho: "ok", resultado: { saida: "oi" } })}\n`);
      else s.write(`${JSON.stringify(foto)}\n`);
    });
    const p = ponteFalsa([[comando("c1")]]);
    laco(iniciarComputador({ canal: p.canal, socket: sock, batimentoMs: 60_000, dormir: async () => undefined }));
    await esperarAte(() => p.resultados.length === 1 && p.estados.length >= 1);
    expect(sup.recebidas.find((m) => m.tipo === "comando")).toEqual({ tipo: "comando", comando: comando("c1") });
    expect(p.resultados[0]).toEqual({ id: "c1", desfecho: "ok", resultado: { saida: "oi" } });
    expect(p.estados[0]).toEqual({ computadorId: "", ligado: false, supervisorPub: "p", telas: [] });
  });

  it("vivo (NOD-95): abre uma conexão só dele, manda o comando, e depois do ok liga o VNC ao fluxo do servidor nos dois sentidos", async () => {
    const sock = pasta();
    const linhasDoVivo: string[] = [];
    const brutoDoVivo: Buffer[] = [];
    const sup = await supervisorFalso(sock, (m, s) => {
      if (m.tipo !== "vivo") return;
      linhasDoVivo.push(JSON.stringify(m));
      s.setEncoding(undefined as unknown as BufferEncoding);
      s.removeAllListeners("data");
      s.on("data", (b: Buffer) => brutoDoVivo.push(Buffer.from(b)));
      // Como o supervisor de verdade: um estado antes, o ok, e o servidor do VNC fala primeiro, no mesmo pedaço.
      s.write(`${JSON.stringify({ tipo: "estado", computadorId: "", ligado: true, supervisorPub: "p", telas: [] })}\n${JSON.stringify({ tipo: "vivo", ok: true })}\nRFB 003.008\n`);
    });
    const p = ponteFalsa([[{ ...comando("v1"), tipo: "vivo", agenteId: "a1", vivo: { sessao: "s1", token: "t1" } }]]);
    const aoServidor: Buffer[] = [];
    let aoMotor: ((b: Uint8Array) => void) | null = null;
    const fluxo = { enviar: (b: Uint8Array) => aoServidor.push(Buffer.from(b)), aoDados: (fn: (b: Uint8Array) => void) => { aoMotor = fn; }, aoFechar: () => {}, fechar: () => {} };
    const pedidos: unknown[] = [];
    p.canal.vivo = async (sessao) => { pedidos.push(sessao); return fluxo; };
    laco(iniciarComputador({ canal: p.canal, socket: sock, batimentoMs: 60_000, dormir: async () => undefined }));
    await esperarAte(() => p.resultados.length === 1 && aoServidor.length >= 1);
    expect(pedidos).toEqual([{ sessao: "s1", token: "t1" }]);
    expect(JSON.parse(linhasDoVivo[0]!)).toMatchObject({ tipo: "vivo", comando: { id: "v1", tipo: "vivo" } });
    expect(p.resultados[0]).toEqual({ id: "v1", desfecho: "ok" });
    expect(Buffer.concat(aoServidor).toString()).toBe("RFB 003.008\n");
    aoMotor!(new Uint8Array([1, 2, 3]));
    await esperarAte(() => brutoDoVivo.length >= 1);
    expect([...Buffer.concat(brutoDoVivo)]).toEqual([1, 2, 3]);
    // A conexão de sempre não viu o vivo.
    expect(sup.recebidas.filter((m) => m.tipo === "comando")).toEqual([]);
  });

  it("vivo recusado pelo supervisor volta com o motivo; sem servidor para o fluxo, sem_resposta", async () => {
    const sock = pasta();
    let vez = 0;
    await supervisorFalso(sock, (m, s) => {
      if (m.tipo !== "vivo") return;
      s.write(`${JSON.stringify(vez++ === 0 ? { tipo: "vivo", ok: false, motivo: "faltam_pacotes" } : { tipo: "vivo", ok: true })}\n`);
    });
    const v = (id: string) => ({ ...comando(id), tipo: "vivo" as const, agenteId: "a1", vivo: { sessao: id, token: "t" } });
    const p = ponteFalsa([[v("v1")], [v("v2")]]);
    p.canal.vivo = async () => null;
    laco(iniciarComputador({ canal: p.canal, socket: sock, batimentoMs: 60_000, dormir: async () => undefined }));
    await esperarAte(() => p.resultados.length === 2);
    expect([...p.resultados].sort((a, b) => a.id.localeCompare(b.id))).toEqual([{ id: "v1", desfecho: "falhou", motivo: "faltam_pacotes" }, { id: "v2", desfecho: "falhou", motivo: "sem_resposta" }]);
  });

  /** Um supervisor que aceita o vivo e devolve, por `vnc`, o lado cru da conexão (como o x11vnc). */
  async function vivoAceito(sock: string, depoisDoOk?: (s: Socket) => void) {
    const vnc: { socket: Socket | null; recebido: Buffer[] } = { socket: null, recebido: [] };
    const sup = await supervisorFalso(sock, (m, s) => {
      if (m.tipo === "comando") { s.write(`${JSON.stringify({ tipo: "resultado", id: m.comando.id, desfecho: "ok" })}\n`); return; }
      if (m.tipo !== "vivo") return;
      s.setEncoding(undefined as unknown as BufferEncoding);
      s.removeAllListeners("data");
      s.on("data", (b: Buffer) => vnc.recebido.push(Buffer.from(b)));
      vnc.socket = s;
      s.write(`${JSON.stringify({ tipo: "vivo", ok: true })}\n`);
      depoisDoOk?.(s);
    });
    return { sup, vnc };
  }
  const fluxoFalso = (atraso: () => number = () => 0) => {
    const aoServidor: Buffer[] = [];
    return { aoServidor, fluxo: { enviar: (b: Uint8Array) => aoServidor.push(Buffer.from(b)), aoDados: () => {}, aoFechar: () => {}, fechar: () => {}, atraso } };
  };

  it("revisão do PR #599: a saudação do VNC num pedaço próprio, antes de o WebSocket abrir, chega ao servidor", async () => {
    const sock = pasta();
    await vivoAceito(sock, (s) => { setTimeout(() => s.write("RFB 003.008\n"), 5); });
    const p = ponteFalsa([[{ ...comando("v1"), tipo: "vivo", agenteId: "a1", vivo: { sessao: "s1", token: "t1" } }]]);
    const { aoServidor, fluxo } = fluxoFalso();
    // O WebSocket demora a abrir: a saudação já chegou e precisa esperar no socket, não sumir.
    p.canal.vivo = async () => { await new Promise((r) => setTimeout(r, 60)); return fluxo; };
    laco(iniciarComputador({ canal: p.canal, socket: sock, batimentoMs: 60_000, dormir: async () => undefined }));
    await esperarAte(() => p.resultados.length === 1 && aoServidor.length >= 1);
    expect(Buffer.concat(aoServidor).toString()).toBe("RFB 003.008\n");
  });

  it("revisão do PR #599: o vivo esperando o WebSocket não segura os outros comandos da fila", async () => {
    const sock = pasta();
    await vivoAceito(sock);
    const p = ponteFalsa([[{ ...comando("v1"), tipo: "vivo", agenteId: "a1", vivo: { sessao: "s1", token: "t1" } }, comando("c2")]]);
    p.canal.vivo = () => new Promise(() => {});
    laco(iniciarComputador({ canal: p.canal, socket: sock, batimentoMs: 60_000, dormir: async () => undefined }));
    await esperarAte(() => p.resultados.some((r) => r.id === "c2"));
    expect(p.resultados.find((r) => r.id === "v1")).toBeUndefined();
  });

  it("revisão do PR #599: com o WebSocket atrasado, o motor para de ler o VNC até a fila baixar", async () => {
    const sock = pasta();
    const { vnc } = await vivoAceito(sock, (s) => { s.write(Buffer.from("A")); });
    const p = ponteFalsa([[{ ...comando("v1"), tipo: "vivo", agenteId: "a1", vivo: { sessao: "s1", token: "t1" } }]]);
    let atraso = 5 * 1024 * 1024;
    const { aoServidor, fluxo } = fluxoFalso(() => atraso);
    p.canal.vivo = async () => fluxo;
    laco(iniciarComputador({ canal: p.canal, socket: sock, batimentoMs: 60_000, dormir: async () => undefined }));
    await esperarAte(() => Buffer.concat(aoServidor).toString() === "A");
    vnc.socket!.write(Buffer.from("B"));
    await new Promise((r) => setTimeout(r, 80));
    expect(Buffer.concat(aoServidor).toString()).toBe("A");
    atraso = 0;
    await esperarAte(() => Buffer.concat(aoServidor).toString() === "AB");
  });

  // QA do PR #599 (2026-10-30): o mutante que tirava o teto do lado do VNC sobrevivia; o motor crescia a memória sem fim.
  it("QA do PR #599: o VNC que parou de ler derruba o ao vivo em vez de acumular no motor", async () => {
    const sock = pasta();
    const { vnc } = await vivoAceito(sock, (s) => { s.pause(); });
    const p = ponteFalsa([[{ ...comando("v1"), tipo: "vivo", agenteId: "a1", vivo: { sessao: "s1", token: "t1" } }]]);
    let aoDados: ((b: Uint8Array) => void) | null = null;
    let fechou = false;
    p.canal.vivo = async () => ({ enviar: () => {}, aoDados: (fn) => { aoDados = fn; }, aoFechar: () => {}, fechar: () => { fechou = true; } });
    laco(iniciarComputador({ canal: p.canal, socket: sock, batimentoMs: 60_000, dormir: async () => undefined }));
    await esperarAte(() => aoDados !== null && p.resultados.length === 1);
    const mega = new Uint8Array(1024 * 1024);
    for (let i = 0; i < 12 && !fechou; i++) { aoDados!(mega); await new Promise((r) => setTimeout(r, 5)); }
    await esperarAte(() => fechou);
    expect(vnc.socket).not.toBeNull();
  });

  it("revisão do PR #599 (codex, 4ª rodada): parar o laço derruba o ao vivo ligado e o que ainda abria o WebSocket", async () => {
    const sock = pasta();
    const fechados: number[] = [];
    const conexoes: Socket[] = [];
    await supervisorFalso(sock, (m, s) => {
      if (m.tipo !== "vivo") return;
      s.removeAllListeners("data");
      conexoes.push(s);
      s.on("close", () => fechados.push(conexoes.indexOf(s)));
      s.write(`${JSON.stringify({ tipo: "vivo", ok: true })}\n`);
    });
    const v = (id: string) => ({ ...comando(id), tipo: "vivo" as const, agenteId: "a1", vivo: { sessao: id, token: "t" } });
    const p = ponteFalsa([[v("ligado"), v("abrindo")]]);
    let fluxoFechado = 0;
    let soltar: (() => void) | null = null;
    p.canal.vivo = async (sessao) => {
      const fluxo = { enviar: () => {}, aoDados: () => {}, aoFechar: () => {}, fechar: () => { fluxoFechado++; } };
      if (sessao.sessao === "abrindo") await new Promise<void>((r) => { soltar = r; });
      return fluxo;
    };
    const l = iniciarComputador({ canal: p.canal, socket: sock, batimentoMs: 60_000, dormir: async () => undefined });
    await esperarAte(() => p.resultados.some((r) => r.id === "ligado") && conexoes.length === 2 && soltar !== null);
    l.parar();
    await esperarAte(() => fechados.length === 2);
    // O WebSocket que abriu depois do parar fecha na hora e não liga nada.
    soltar!();
    await esperarAte(() => fluxoFechado === 2);
    expect(p.resultados.find((r) => r.id === "abrindo")).toBeUndefined();
  });

  it("supervisor fora do ar: o comando volta na hora como nao_iniciou", async () => {
    const p = ponteFalsa([[comando("c1")]]);
    laco(iniciarComputador({ canal: p.canal, socket: pasta(), batimentoMs: 60_000, dormir: async () => undefined }));
    await esperarAte(() => p.resultados.length === 1);
    expect(p.resultados[0]).toEqual({ id: "c1", desfecho: "falhou", motivo: "nao_iniciou" });
  });

  it("servidor fora: o relato fica guardado e vai no batimento seguinte", async () => {
    const p = ponteFalsa([[comando("c1")]]);
    p.recusar(true);
    const l = laco(iniciarComputador({ canal: p.canal, socket: pasta(), batimentoMs: 60_000, dormir: async () => undefined }));
    await new Promise((r) => setTimeout(r, 100));
    expect(p.resultados).toEqual([]);
    p.recusar(false);
    await l.batimento();
    expect(p.resultados.map((r) => r.id)).toEqual(["c1"]);
  });

  it("servidor sem a flag (404): dorme 10 min antes de puxar de novo", async () => {
    const sonos: number[] = [];
    const p = ponteFalsa(["sem_rota"]);
    laco(iniciarComputador({ canal: p.canal, socket: pasta(), batimentoMs: 60_000, dormir: async (ms) => { sonos.push(ms); await new Promise((r) => setTimeout(r, 1_000)); } }));
    await esperarAte(() => sonos.length > 0);
    expect(sonos[0]).toBe(600_000);
  });


  describe("ganchos (NOD-93, ADR-127 §3)", () => {
    it("antesDeRepassar: null segue ao supervisor; resposta volta na hora sem tocar o socket; erro vira nao_iniciou", async () => {
      const sock = pasta();
      const sup = await supervisorFalso(sock, (m, s) => {
        if (m.tipo === "comando") s.write(`${JSON.stringify({ tipo: "resultado", id: m.comando.id, desfecho: "ok" })}\n`);
      });
      const p = ponteFalsa([[comando("segue"), comando("segura"), comando("quebra")]]);
      const vistos: string[] = [];
      laco(iniciarComputador({
        canal: p.canal, socket: sock, batimentoMs: 60_000, dormir: async () => undefined,
        antesDeRepassar: async (c) => {
          vistos.push(c.id);
          if (c.id === "segura") return { desfecho: "esperando_tela", progresso: { pct: 79, etapa: "baixando" } };
          if (c.id === "quebra") throw new Error("x");
          return null;
        },
      }));
      await esperarAte(() => p.resultados.length === 3);
      expect(vistos).toEqual(["segue", "segura", "quebra"]);
      expect(sup.recebidas.filter((m) => m.tipo === "comando").map((m) => m.tipo === "comando" && m.comando.id)).toEqual(["segue"]);
      // A resposta do supervisor chega pelo socket, depois das que o gancho deu na hora: a ordem não importa.
      expect([...p.resultados].sort((x, y) => x.id.localeCompare(y.id))).toEqual([
        { id: "quebra", desfecho: "falhou", motivo: "nao_iniciou" },
        { id: "segue", desfecho: "ok" },
        { id: "segura", desfecho: "esperando_tela", progresso: { pct: 79, etapa: "baixando" } },
      ]);
    });

    it("aoRelato vê cada foto do supervisor (sem o tipo) e a foto ainda sobe; erro no gancho não para o fio", async () => {
      const sock = pasta();
      const foto = { tipo: "estado", computadorId: "c", ligado: true, supervisorPub: "p", telas: [] };
      await supervisorFalso(sock, (m, s) => { if (m.tipo === "pedir_estado") s.write(`${JSON.stringify(foto)}\n`); });
      const p = ponteFalsa([]);
      const fotos: EstadoComputadorRelatado[] = [];
      const l = laco(iniciarComputador({ canal: p.canal, socket: sock, batimentoMs: 60_000, dormir: async () => undefined, aoRelato: (e) => { fotos.push(e); throw new Error("x"); } }));
      await esperarAte(() => p.estados.length === 1);
      await l.batimento();
      await esperarAte(() => p.estados.length === 2);
      expect(fotos).toEqual([{ computadorId: "c", ligado: true, supervisorPub: "p", telas: [] }, { computadorId: "c", ligado: true, supervisorPub: "p", telas: [] }]);
    });
  });
});
