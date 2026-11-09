import { randomBytes } from "node:crypto";
import { expect } from "vitest";
import { segredoDeTroca } from "../../desktop/conta-provisoria.ts";
import { caixaLocal, type CaixaLocal } from "../../src/adapters/email/enviador.ts";
import * as repoContas from "../../src/repositories/contas.repo.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { servicoConta, type Quem, type ServicoConta } from "../../src/use-cases/conta.ts";

/**
 * NOD-345 (ADR-124): o serviço de conta sobre uma transação de teste. Cada `d.transacao` vira um savepoint: o que
 * falha volta só aquele pedaço, como em produção volta a transação inteira. Usado pelos testes de integração e de
 * concorrência da conta.
 */

export const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
export const SENHA = "uma senha boa de teste";
/** O segredo de troca do processo principal do app (a página só manda o desafio). */
export const APP = segredoDeTroca();

export type Mundo = { s: ServicoConta; caixa: CaixaLocal; trx: Tx; chaves: Escopo[]; agora: { t: number }; falhar: { importacao: boolean } };

export function mundo(trx: Tx, opcoes: { enviarFalha?: boolean; repo?: typeof repoContas; antiAbuso?: boolean } = {}): Mundo {
  const caixa = caixaLocal();
  const chaves: Escopo[] = [];
  const agora = { t: Date.now() };
  const falhar = { importacao: false };
  const s = servicoConta({
    // Com `falhar.importacao`, o banco cai no meio da cópia (o `unsafe` que a importação usa para ler e gravar).
    transacao: (fn) => trx.savepoint(async (sp) => {
      if (!falhar.importacao) return fn(sp as unknown as Tx);
      const quebrado = new Proxy(sp, { get: (alvo, k, r) => (k === "unsafe" ? () => Promise.reject(new Error("conexão caiu")) : Reflect.get(alvo, k, r)) });
      return fn(quebrado as unknown as Tx);
    }) as never,
    segredo: "segredo-de-teste-com-mais-de-32-caracteres",
    enviador: opcoes.enviarFalha ? { enviar: async () => { throw new Error("fora do ar"); } } : caixa,
    urlBase: "https://nod.teste",
    agora: () => agora.t,
    repo: opcoes.repo ?? repoContas,
    antiAbuso: opcoes.antiAbuso === true,
    emitirChaveMaquina: async (escopo) => { chaves.push(escopo); return `nodm_${randomBytes(8).toString("hex")}`; },
  });
  return { s, caixa, trx, chaves, agora, falhar };
}

export const ip = () => `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
export const emailNovo = () => `teste-${randomBytes(5).toString("hex")}@exemplo.com.br`;

export const verificador = () => randomBytes(24).toString("base64url");

/** Um espaço provisório pela web, com a sessão dele. */
export async function provisorio(m: Mundo, nome = "Ana"): Promise<Quem> {
  const r = await m.s.provisorio({ escopo: null, sid: null, ip: ip(), aparelho: "macOS · Chrome" }, { verificador: verificador(), nome, forma: "web" });
  return { escopo: r.escopo, sid: r.sessao!.sid, ip: ip(), aparelho: "macOS · Chrome" };
}

export function codigoDoEmail(m: Mundo): string {
  const ultimo = m.caixa.mensagens.at(-1);
  const c = /(\d{6})/.exec(ultimo?.texto ?? "")?.[1];
  if (!c) throw new Error("sem código na caixa");
  return c;
}

/** Cria uma conta de e-mail+senha a partir de um provisório (o caminho #j2). */
export async function comConta(m: Mundo, email = emailNovo()): Promise<Quem & { email: string }> {
  const q = await provisorio(m, "Dono");
  await m.s.cadastrar(q, { email, senha: SENHA });
  expect(await m.s.verificar(q, { codigo: codigoDoEmail(m) })).toEqual({ resultado: "convertida", email });
  return { ...q, email };
}
