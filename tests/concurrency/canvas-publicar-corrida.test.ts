import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { INTELIGENCIA_PADRAO } from "../../src/domain/inteligencia.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { darAcessoCanvas, desinstalarCanvas } from "../../src/use-cases/acoes/canvas.ts";
import { comentar, publicar } from "../../src/use-cases/canvas.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre } from "../helpers/l5.ts";

/**
 * ADA-13, revisão 1 do #649 (A1, A2): publicar e comentar ao mesmo tempo, com duas conexões de verdade. A publicação
 * trava a linha do canvas (FOR UPDATE) antes de ler a versão anterior, e o comentário a segura (FOR SHARE) até entrar.
 * Linhas COMMITADAS e apagadas por id no afterEach.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const agentes: string[] = [];

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    await trx`set local lock_timeout = '10s'`;
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}
const depsDe = (trx: Tx) => depsSobre(criarRepos(trx, PESSOA), PESSOA, { trx });
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const conteudo = (telas: { id: string; html?: string }[]) => ({ issue: "ADA-13", titulo: "Canvas", jornadas: [{ titulo: "J", telas }] });

async function fixture(): Promise<{ agenteId: string; canvasId: string }> {
  const agenteId = randomUUID();
  agentes.push(agenteId);
  const canvasId = await escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    await repos.agentes.criar({ id: agenteId, nome: "Gil", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "auto" });
    await repos.agentes.atualizarPerfil(agenteId, { inteligencia: INTELIGENCIA_PADRAO });
    const r = await publicar(depsDe(trx), { agenteId, bruto: conteudo([{ id: "J1-1", html: "<p>v1</p>" }, { id: "J1-2", html: "<p>outra</p>" }]), origemUrl: null, confianca: "confiavel" });
    if (!r.ok) throw new Error(r.detalhe);
    return r.canvas.id;
  });
  return { agenteId, canvasId };
}

/** Abre a transação A, roda `a` e segura o commit até `soltar` ser chamado. */
function segurando<T>(a: (trx: Tx) => Promise<T>): { feito: Promise<T>; pronto: Promise<void>; soltar: () => void } {
  let soltar!: () => void;
  let avisar!: () => void;
  const pronto = new Promise<void>((r) => (avisar = r));
  const solto = new Promise<void>((r) => (soltar = r));
  const feito = escopado(async (trx) => {
    const v = await a(trx);
    avisar();
    await solto;
    return v;
  });
  return { feito, pronto, soltar };
}

afterEach(async () => {
  await escopado(async (trx) => {
    await trx`delete from canvas_comentarios where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from canvas_versoes where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from canvas where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from canvas_blobs where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from canvas_acessos where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from canvas_instalacoes where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from agentes where id in ${trx(agentes)}`;
  });
  agentes.length = 0;
});

describeIntegracao("canvas: publicar e comentar em corrida (ADA-13, #649 A1/A2)", () => {
  it("duas publicações juntas: a segunda espera e reaproveita a tela da primeira, não a da versão velha", async () => {
    const { agenteId, canvasId } = await fixture();
    const a = segurando((trx) => publicar(depsDe(trx), { agenteId, canvas: canvasId, bruto: conteudo([{ id: "J1-1", html: "<p>v2</p>" }, { id: "J1-2" }]), origemUrl: null, confianca: "confiavel" }));
    await a.pronto;
    // B não manda o HTML da J1-1: reaproveita o da versão anterior. Sem a trava, leria a v1 (A ainda não commitou).
    const b = escopado((trx) => publicar(depsDe(trx), { agenteId, canvas: canvasId, bruto: conteudo([{ id: "J1-1" }, { id: "J1-2" }]), origemUrl: null, confianca: "confiavel" }));
    await esperar(300);
    a.soltar();
    const [ra, rb] = await Promise.all([a.feito, b]);
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
    expect([ra.canvas.versaoAtual, rb.canvas.versaoAtual]).toEqual([2, 3]);
    const htmlDe = (r: typeof ra) => r.estrutura.jornadas[0]!.telas[0]!.html;
    expect(htmlDe(rb)).toBe(htmlDe(ra));
  });

  it("comentário numa tela que a publicação em curso tira: não fica ativo numa tela que não existe mais", async () => {
    const { agenteId, canvasId } = await fixture();
    const a = segurando((trx) => publicar(depsDe(trx), { agenteId, canvas: canvasId, bruto: conteudo([{ id: "J1-1" }]), origemUrl: null, confianca: "confiavel" }));
    await a.pronto;
    const b = escopado((trx) => comentar(depsDe(trx), { canvasId, autor: { tipo: "pessoa", id: PESSOA.pessoaId, nome: null }, confianca: "confiavel", endereco: "J1-2", tipo: "pino", x: 0.5, y: 0.5, texto: "e esta?" }));
    await esperar(300);
    a.soltar();
    const [, rb] = await Promise.all([a.feito, b]);
    const ativos = await escopado((trx) => criarRepos(trx, PESSOA).canvas.comentarios(canvasId));
    expect(ativos.filter((c) => c.telaId === "J1-2" && !c.arquivadoEm)).toEqual([]);
    expect(rb.ok).toBe(false);
  });

  it("revisão 5 do #649 (baixo 7): dar acesso e desinstalar juntos não deixam um acesso dormente que volta ao reinstalar", async () => {
    const { agenteId } = await fixture();
    await escopado((trx) => criarRepos(trx, PESSOA).canvas.instalar());
    const a = segurando((trx) => darAcessoCanvas(depsDe(trx), { agenteId, nivel: "criar_publicar" }));
    await a.pronto;
    const b = escopado((trx) => desinstalarCanvas(depsDe(trx), {}));
    await esperar(300);
    a.soltar();
    await Promise.all([a.feito, b]);
    const acessos = await escopado((trx) => trx`select agente_id from canvas_acessos where owner_id = ${PESSOA.pessoaId}`);
    expect(acessos).toHaveLength(0);
  });
});
