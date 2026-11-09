// NOD-365: o driver motor muda o computador de máquina levando a loja de logins cifrada, e volta atrás se o destino não ligar.
import { describe, expect, it } from "vitest";
import { criarCanalComputador } from "../../../src/adapters/computador/canal.ts";
import { criarDriverMotor, type LugarGravado, type MaquinaDaPessoa, PACOTE_VAZIO } from "../../../src/adapters/computador/motor.ts";
import { abrirSelo, chaveDaMaquina, conferirAssinatura, gerarParX25519, publicaDeAssinatura } from "../../../src/adapters/computador/selo.ts";
import type { ComandoComputador } from "../../../src/contracts/computador-motor.ts";
import { ehFalhaComputador } from "../../../src/domain/computador.ts";

const CHAVE = "cd".repeat(32);
const ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const escopo = { tenantId: "t1", pessoaId: "p1" };
/** O que a origem "tem" na loja: duas partes já cifradas (o servidor só repassa). */
const PARTES = [Buffer.from("cifrado-parte-1").toString("base64"), Buffer.from("cifrado-parte-2").toString("base64")];

type Opcoes = { conectadas?: string[]; anuncioDestino?: MaquinaDaPessoa["computador"]; iniciarFalha?: boolean; reversaoFalha?: boolean; lugar?: Partial<LugarGravado>; padraoId?: string | null };

function mundo(o: Opcoes = {}) {
  let t = 1_000_000;
  const sups = { A: gerarParX25519(), B: gerarParX25519() } as const;
  const canal = criarCanalComputador({ agora: () => t });
  const vistos: { maquina: "A" | "B"; c: ComandoComputador }[] = [];
  const conectadas = new Set(o.conectadas ?? ["A", "B"]);
  const lugar: LugarGravado = { maquinaId: "A", hospedeiraId: "A", supervisorPub: sups.A.publica, saidasPendentesDe: [], ...o.lugar };
  const historico: LugarGravado[] = [];
  const maquinas = (): MaquinaDaPessoa[] => (["A", "B"] as const).filter((m) => conectadas.has(m)).map((m) => ({
    machineId: m, nome: `${m}-nome`, plataforma: "linux", papel: m === "A" ? "motor" : "computador", computador: m === "B" && o.anuncioDestino !== undefined ? o.anuncioDestino : "pronto", ultimoContato: t,
  }));
  const passo = () => {
    for (const m of ["A", "B"] as const) {
      if (!conectadas.has(m)) continue;
      canal.relatarEstado(escopo, m, { computadorId: "", ligado: false, supervisorPub: sups[m].publica, telas: [] });
      for (const c of canal.puxar(escopo, m)) {
        if (c.assinatura === "") { canal.resultado(escopo, m, { id: c.id, desfecho: "falhou", motivo: "acao_falhou" }); continue; }
        vistos.push({ maquina: m, c });
        if (c.tipo === "exportar_logins") canal.resultado(escopo, m, { id: c.id, desfecho: "ok", logins: { parte: c.parte!, total: PARTES.length, dados: PARTES[c.parte!]! } });
        else if (c.tipo === "iniciar" && o.iniciarFalha) canal.resultado(escopo, m, { id: c.id, desfecho: "falhou", motivo: "nao_iniciou" });
        else canal.resultado(escopo, m, { id: c.id, desfecho: "ok" });
      }
    }
  };
  const driver = criarDriverMotor({
    env: { NOD_CREDENTIAL_KEY: CHAVE },
    canal,
    localizar: async (id) => (id === ID ? { escopo, agenteId: null, ...lugar, padraoId: o.padraoId ?? null, uso: "equilibrado" } : null),
    maquinas,
    nomeDaMaquina: async (_e, m) => `${m}-nome`,
    fixarHospedeira: async (_e, _id, m) => { lugar.hospedeiraId = m; },
    fixarSupervisor: async (_e, _id, pub) => { if (lugar.supervisorPub && lugar.supervisorPub !== pub) return "diferente"; const novo = !lugar.supervisorPub; lugar.supervisorPub = pub; return novo ? "gravada" : "igual"; },
    fixarLugar: async (_e, _id, l) => {
      if (o.reversaoFalha && historico.length > 0) throw new Error("banco indisponível na reversão");
      historico.push({ ...l }); Object.assign(lugar, l);
    },
    adicionarSaidaPendente: async (_e, _id, maquinaId) => { if (!lugar.saidasPendentesDe.includes(maquinaId)) lugar.saidasPendentesDe.push(maquinaId); },
    maquinaGravada: async (_e, mId) => (mId === "A" ? { nome: "A-gravada", plataforma: "darwin", papel: "motor", ultimoUsoEm: 4242 } : null),
    saidaMarcada: async (_e, _id, maquinaId) => { lugar.saidasPendentesDe = lugar.saidasPendentesDe.filter((m) => m !== maquinaId); },
    agora: () => t,
    dormir: async (ms) => { t += ms; passo(); await Promise.resolve(); },
    novoId: (() => { let n = 0; return () => `cmd-${++n}`; })(),
  });
  const de = (m: "A" | "B", tipo: ComandoComputador["tipo"]) => vistos.filter((v) => v.maquina === m && v.c.tipo === tipo).map((v) => v.c);
  return { driver, canal, sups, lugar, historico, vistos, de, conectadas };
}

async function falha(p: Promise<unknown>) {
  try { await p; } catch (e) { if (ehFalhaComputador(e)) return e; throw e; }
  throw new Error("não falhou");
}

describe("driver motor: trocar (NOD-365)", () => {
  it("leva a loja parte a parte, aponta o banco para o destino, liga lá com a chave do destino e marca a saída da origem", async () => {
    const m = mundo();
    const progresso: number[] = [];
    await m.driver.trocar!(ID, "B", { semLogins: false, aoProgresso: ({ pct }) => { progresso.push(pct); } }, escopo);
    const exp = m.de("A", "exportar_logins");
    const imp = m.de("B", "importar_logins");
    expect(exp.map((c) => c.parte)).toEqual([0, 1]);
    expect(imp.map((c) => [c.parte, c.total, c.dados])).toEqual([[0, 2, PARTES[0]], [1, 2, PARTES[1]]]);
    // Uma troca só, com o mesmo id nas duas pontas; todo comando assinado e com a chave do servidor para o TOFU do destino.
    expect(new Set([...exp, ...imp].map((c) => c.troca)).size).toBe(1);
    for (const c of [...exp, ...imp]) {
      expect(conferirAssinatura(publicaDeAssinatura(CHAVE, ID), c)).toBe(true);
      expect(c.servidorPub).toBe(publicaDeAssinatura(CHAVE, ID));
    }
    const iniciar = m.de("B", "iniciar")[0]!;
    expect(JSON.parse(abrirSelo(m.sups.B.privada, iniciar.segredoSelado!).toString())).toMatchObject({ chaveMaquina: chaveDaMaquina(CHAVE, ID) });
    // A origem ficou pendente até o marcar_saida responder; depois, limpa.
    expect(m.historico.at(-1)).toMatchObject({ maquinaId: "B", hospedeiraId: "B", saidasPendentesDe: ["A"] });
    expect(m.lugar).toEqual({ maquinaId: "B", hospedeiraId: "B", supervisorPub: m.sups.B.publica, saidasPendentesDe: [] });
    expect(m.de("A", "marcar_saida")).toHaveLength(1);
    expect(m.de("A", "iniciar")).toHaveLength(0);
    expect(progresso.at(-1)).toBe(100);
    expect(progresso).toEqual([...progresso].sort((a, b) => a - b));
  });

  it("o canal só leva o que a origem mandou (cifrado): o servidor não decifra nem muda os dados", async () => {
    const m = mundo();
    await m.driver.trocar!(ID, "B", { semLogins: false }, escopo);
    expect(m.de("B", "importar_logins").map((c) => c.dados).join("|")).toBe(PARTES.join("|"));
  });

  it("origem sem contato: 'A-nome está sem contato', nada muda no banco e o destino não recebe nada", async () => {
    const m = mundo({ conectadas: ["B"] });
    const e = await falha(m.driver.trocar!(ID, "B", { semLogins: false }, escopo));
    expect(e.motivo).toBe("maquina_sem_contato");
    expect(e.maquina).toBe("A-nome");
    expect(m.historico).toEqual([]);
    expect(m.vistos.filter((v) => v.maquina === "B")).toEqual([]);
  });

  it("sem os logins, a origem sem contato não segura a troca: o destino recebe a loja vazia e a origem fica pendente", async () => {
    const m = mundo({ conectadas: ["B"] });
    await m.driver.trocar!(ID, "B", { semLogins: true }, escopo);
    const imp = m.de("B", "importar_logins");
    expect(imp.map((c) => [c.parte, c.total, c.dados])).toEqual([[0, 1, PACOTE_VAZIO]]);
    expect(JSON.parse(Buffer.from(PACOTE_VAZIO, "base64").toString())).toEqual({ versao: 1, arquivos: [] });
    expect(m.lugar).toMatchObject({ maquinaId: "B", saidasPendentesDe: ["A"] });
    // A origem volta: no próximo ligar ela recebe o marcar_saida e a pendência some.
    m.conectadas.add("A");
    m.lugar.supervisorPub = m.sups.B.publica;
    // O destino segue ligado: só a foto de reconexão da origem dispara a marca, sem operar nem religar a atual.
    m.canal.relatarEstado(escopo, "B", { computadorId: ID, ligado: true, supervisorPub: m.sups.B.publica, telas: [] });
    await m.driver.reconciliarSaidasPendentes!(ID, escopo);
    for (let i = 0; i < 20 && m.lugar.saidasPendentesDe.length; i++) await new Promise((r) => setTimeout(r, 0));
    expect(m.de("A", "marcar_saida")).toHaveLength(1);
    expect(m.lugar.saidasPendentesDe).toEqual([]);
  });

  it("Trazer de volta para onde o nod roda grava maquina_id null e só a hospedeira", async () => {
    const m = mundo({ lugar: { maquinaId: "B", hospedeiraId: "B", supervisorPub: null } });
    await m.driver.trocar!(ID, "A", { semLogins: false }, escopo);
    expect(m.historico[0]).toMatchObject({ maquinaId: null, hospedeiraId: "A", saidasPendentesDe: ["B"] });
    expect(m.lugar).toMatchObject({ maquinaId: null, hospedeiraId: "A", saidasPendentesDe: [] });
    expect(m.de("B", "marcar_saida")).toHaveLength(1);
  });

  it("o destino não liga: o banco volta à origem com a chave de antes, e a origem não é marcada", async () => {
    const m = mundo({ iniciarFalha: true });
    const e = await falha(m.driver.trocar!(ID, "B", { semLogins: false }, escopo));
    expect(e.motivo).toBe("nao_iniciou");
    expect(m.lugar).toMatchObject({ maquinaId: "A", hospedeiraId: "A", supervisorPub: m.sups.A.publica });
    expect(m.historico.at(-1)).toEqual({ maquinaId: "A", hospedeiraId: "A", supervisorPub: m.sups.A.publica, saidasPendentesDe: ["B"] });
    expect(m.de("A", "marcar_saida")).toHaveLength(0);
    // O destino já tinha recebido a loja: recebe o marcar_saida, para a cópia não ficar lá para sempre.
    for (let i = 0; i < 20 && m.de("B", "marcar_saida").length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    expect(m.de("B", "marcar_saida")).toHaveLength(1);
    expect(m.de("A", "cancelar_exportacao")).toHaveLength(1);
    for (let i = 0; i < 20 && m.lugar.saidasPendentesDe.length; i++) await new Promise((r) => setTimeout(r, 0));
    expect(m.lugar.saidasPendentesDe).toEqual([]);
  });

  it("se a reversão do banco falha, não apaga o destino nem libera a origem", async () => {
    const m = mundo({ iniciarFalha: true, reversaoFalha: true });
    const e = await falha(m.driver.trocar!(ID, "B", { semLogins: false }, escopo));
    expect(e).toMatchObject({ motivo: "acao_falhou", detalhe: "a reversão do lugar falhou" });
    expect(m.lugar.maquinaId).toBe("B");
    expect(m.de("B", "marcar_saida")).toHaveLength(0);
    expect(m.de("A", "cancelar_exportacao")).toHaveLength(0);
  });

  it("registra o destino antes de importar e preserva saídas antigas em trocas encadeadas", async () => {
    const m = mundo({ lugar: { saidasPendentesDe: ["antiga"] } });
    await m.driver.trocar!(ID, "B", { semLogins: false }, escopo);
    expect(m.historico[0]).toMatchObject({ maquinaId: "B", saidasPendentesDe: ["antiga", "A"] });
    // B foi removida ao virar atual; a pendência antiga não foi sobrescrita e A foi limpa ao responder.
    expect(m.lugar.saidasPendentesDe).toEqual(["antiga"]);
  });

  it("destino sem contato ou sem os pacotes: falha antes de mexer em qualquer coisa", async () => {
    const semContato = mundo({ conectadas: ["A"] });
    expect((await falha(semContato.driver.trocar!(ID, "B", { semLogins: false }, escopo))).motivo).toBe("maquina_sem_contato");
    expect(semContato.vistos).toEqual([]);
    const semPacotes = mundo({ anuncioDestino: "faltam_pacotes" });
    expect((await falha(semPacotes.driver.trocar!(ID, "B", { semLogins: false }, escopo))).motivo).toBe("faltam_pacotes");
    expect(semPacotes.historico).toEqual([]);
  });

  it("a atual sem contato vem da chave gravada: nome, tipo e o último uso (a ponte já esqueceu a conexão)", async () => {
    const m = mundo({ conectadas: ["B"] });
    expect(await m.driver.maquinaDoComputador!(ID, escopo)).toMatchObject({ id: "A", nome: "A-gravada", contato: null, ultimoContato: 4242 });
    expect(await m.driver.lugares!(ID, escopo)).toContainEqual({ maquinaId: "A", nome: "A-gravada", tipo: "este_mac", atual: true, pronta: false, conectada: false });
  });

  it("lugares: a atual marcada, o tipo pelo papel e pela plataforma", async () => {
    const m = mundo();
    expect(await m.driver.lugares!(ID, escopo)).toEqual([
      { maquinaId: "A", nome: "A-nome", tipo: "onde_o_nod_roda", atual: true, pronta: true, conectada: true },
      { maquinaId: "B", nome: "B-nome", tipo: "outra_maquina", atual: false, pronta: true, conectada: true },
    ]);
  });
});
