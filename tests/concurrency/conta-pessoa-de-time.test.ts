import * as repoContas from "../../src/repositories/contas.repo.ts";
import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import type { Escopo } from "../../src/shared/types.ts";
import type { Quem } from "../../src/use-cases/conta.ts";
import { codigoDoEmail, comConta, emailNovo, ip, mundo, provisorio, SENHA } from "../helpers/conta-mundo.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-345 × ADR-030: a pessoa de time (e-mail do login em `pessoas`) de verdade. nod_app só lê `pessoas`, então o
 * dono a cria e COMMITA, num tenant próprio, e a apaga no fim (limpeza própria por id, como nod_dono). O serviço
 * roda sob withRollback; nada dele fica.
 */
async function comPessoaDeTime(fn: (time: Escopo, email: string) => Promise<void>, o: { semEmail?: boolean } = {}): Promise<void> {
  const email = emailNovo();
  const criadas: Escopo[] = [];
  try {
    {
      const t: Escopo = { tenantId: crypto.randomUUID(), pessoaId: crypto.randomUUID() };
      await dbDono`insert into tenants (id, nome) values (${t.tenantId}, 'Time')`;
      criadas.push(t);
      await dbDono`insert into pessoas (tenant_id, id, nome, iniciais, email) values (${t.tenantId}, ${t.pessoaId}, 'Time', 'TI', ${o.semEmail ? null : email})`;
    }
    await fn(criadas[0]!, email);
  } finally {
    for (const t of criadas) {
      await dbDono`delete from pessoas where tenant_id = ${t.tenantId}`;
      await dbDono`delete from tenants where id = ${t.tenantId}`;
    }
  }
}

describeIntegracao("conta (NOD-345): a pessoa de time não vira conta nem ganha senha", () => {
  it("pessoa de time (ADR-030, com e-mail do login) não vira conta, não abre escolha nem é importada; o Google também não a converte", async () => {
    await comPessoaDeTime((pessoa, email) => withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      expect(await repoContas.pessoaEhLegada(trx, pessoa)).toBe(true);
      const time: Quem = { escopo: pessoa, sid: crypto.randomUUID(), ip: ip(), aparelho: "macOS · Chrome" };
      // Sem conta, mas não é provisória: o menu mostra Sessões e Sair, não "Criar conta".
      expect((await m.s.estado(time)).legado).toEqual({ email });
      await expect(m.s.cadastrar(time, { email: emailNovo(), senha: SENHA })).rejects.toMatchObject({ codigo: "estado_invalido" });
      await expect(m.s.importar(time)).rejects.toMatchObject({ codigo: "estado_invalido" });
      // Entrar numa conta a partir do time troca de espaço (como sem sessão): nada do time é oferecido para levar.
      expect((await m.s.entrar(time, { email: dono.email, senha: SENHA })).resultado).toBe("entrou");
      const g = { iss: "https://accounts.google.com", sub: `sub-${randomBytes(4).toString("hex")}`, email: emailNovo(), autoridade: true };
      expect(await m.s.voltaGoogle({ ...time, sid: crypto.randomUUID() }, g)).toEqual({ resultado: "recusado" });
    }));
  });

  it("pessoa de time que já tem conta (ligada pelo Google): o código do e-mail não abre o espaço dela nem lhe dá senha", async () => {
    await comPessoaDeTime((pessoa, email) => withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const contaId = await repoContas.criarConta(trx, email);
      expect(await repoContas.ligarContaPessoa(trx, contaId!, pessoa)).toBe(true);
      const q = await provisorio(m);
      await m.s.cadastrar(q, { email, senha: SENHA });
      expect(await m.s.verificar(q, { codigo: codigoDoEmail(m) })).toEqual({ resultado: "pelo_google", email });
      expect(await repoContas.senhaDaConta(trx, contaId!)).toBeNull();
      expect((await m.s.estado(q)).escolha ?? null).toBeNull();
    }));
  });

  it("M2: pessoa de time SEM e-mail (nunca passou pela instalação) não é tratada como provisória", async () => {
    await comPessoaDeTime((pessoa) => withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      expect(await repoContas.ehProvisorio(trx, pessoa)).toBe(false);
      const time: Quem = { escopo: pessoa, sid: crypto.randomUUID(), ip: ip(), aparelho: "x" };
      await expect(m.s.cadastrar(time, { email: emailNovo(), senha: SENHA })).rejects.toMatchObject({ codigo: "estado_invalido" });
      await expect(m.s.importar(time)).rejects.toMatchObject({ codigo: "estado_invalido" });
    }), { semEmail: true });
  });

});
