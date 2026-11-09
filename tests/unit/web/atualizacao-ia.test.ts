import { describe, expect, it } from "vitest";
import type { AtualizacaoDaIa, EstadoIa } from "../../../src/contracts/estado-ia.ts";
import { HARNESSES } from "../../../src/contracts/harness.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import { estadoDaIa } from "../../../src/domain/estado-ia.ts";
import { estadoIaDaLigacao } from "../../../src/domain/ligacao-sem-ia.ts";
import { atualizacaoEmCurso, comandoDoTerminal, fraseDaAtualizacao, versaoAbaixo } from "../../../web/lib/atualizacao-ia.ts";
import { lerMsgServidor } from "../../../web/lib/ligacao-protocolo.ts";
import { AVISO_SUCESSO_MS, renderCartaoIa, UI_IAS_INICIAL, vistaDaIa, type ContextoCartao, type IaMac } from "../../../web/telas/cartao-ia.ts";
import { htmlSemIa, type EstadoSemIa } from "../../../web/telas/ligacao-sem-ia.ts";

/**
 * A atualização do CLI na tela (NOD-9, PR 2): as frases da spec, o botão "Atualizar" no cartão desatualizado, o estado
 * "atualizando" (no Mac, no servidor e na ligação) e o comando do "Prefere o terminal?".
 */
const AGORA = Date.UTC(2026, 9, 23, 15, 0);
const at = (p: Partial<AtualizacaoDaIa>): AtualizacaoDaIa => ({ fase: "esperando", alvo: "2.1.300", em: AGORA, ...p });
const mac = (ia: IaMac, estado: EstadoIa["estado"], extra: Partial<EstadoIa> = {}): EstadoIa => ({ ia, estado, mensagem: "", em: AGORA, ...extra });
const ctx = (estados: Partial<Record<IaMac, EstadoIa>>, noApp = true): ContextoCartao => ({ servidor: [], ui: { ...UI_IAS_INICIAL, noApp, estados }, agora: AGORA, onde: "provedores" });

describe("as frases da atualização", () => {
  it("cada fase com a frase da spec; sem atualização, nada", () => {
    expect(fraseDaAtualizacao(null, "Claude Code")).toBeNull();
    expect(fraseDaAtualizacao(at({ fase: "esperando" }), "Claude Code")).toBe("Vamos atualizar o Claude Code quando seus bots terminarem.");
    expect(fraseDaAtualizacao(at({ fase: "atualizando" }), "Claude Code")).toBe("Atualizando o Claude Code…");
    expect(fraseDaAtualizacao(at({ fase: "pedindo_aprovacao" }), "Claude Code")).toBe("Confirme com a senha do Mac para continuar.");
    expect(fraseDaAtualizacao(at({ fase: "sucesso", depois: "2.1.301" }), "Claude Code")).toBe("Claude Code atualizado para a 2.1.301.");
    expect(fraseDaAtualizacao(at({ fase: "insuficiente", depois: "2.1.299" }), "Claude Code")).toBe("Atualizamos o Claude Code para a 2.1.299, mas o nod precisa da 2.1.300, que ainda não saiu. Vamos tentar de novo amanhã.");
    expect(fraseDaAtualizacao(at({ fase: "falhou", motivo: "recusou" }), "Claude Code")).toBe("Você não autorizou a atualização.");
    expect(fraseDaAtualizacao(at({ fase: "falhou", motivo: "sem_espaco", espaco: { livreMb: 1200, precisaMb: 2000 } }), "Claude Code")).toContain("tem 1200 MB livres e precisa de 2000 MB");
    expect(fraseDaAtualizacao(at({ fase: "falhou" }), "Claude Code")).toBe("Não deu para atualizar sozinho.");
  });

  it("em curso só atualizando e pedindo a senha", () => {
    expect(atualizacaoEmCurso(at({ fase: "atualizando" }))).toBe(true);
    expect(atualizacaoEmCurso(at({ fase: "pedindo_aprovacao" }))).toBe(true);
    expect(atualizacaoEmCurso(at({ fase: "esperando" }))).toBe(false);
    expect(atualizacaoEmCurso(undefined)).toBe(false);
  });

  it("'Prefere o terminal?': `claude update` no Mac, `nod-motor atualizar-ia` na VM; o Codex no Mac não tem comando", () => {
    expect(comandoDoTerminal("mac", "claude-cli")).toBe("claude update");
    expect(comandoDoTerminal("mac", "codex-cli")).toBeNull();
    expect(comandoDoTerminal("vm", "claude-cli")).toBe("nod-motor atualizar-ia claude");
    expect(comandoDoTerminal("vm", "codex-cli")).toBe("nod-motor atualizar-ia codex");
  });
});

describe("versaoAbaixo (a regra do compararVersoes, na web)", () => {
  it("compara como número, com o pré-release antes da final", () => {
    expect(versaoAbaixo("2.1.290", "2.1.300")).toBe(true);
    expect(versaoAbaixo("2.1.9", "2.1.10")).toBe(true);
    expect(versaoAbaixo("2.1.300", "2.1.300")).toBe(false);
    expect(versaoAbaixo("2.2.0", "2.1.300")).toBe(false);
    expect(versaoAbaixo("0.159.0-alpha.1", "0.159.0")).toBe(true);
    expect(versaoAbaixo("0.159.0", "0.159")).toBe(false);
  });
});

describe("o cartão da IA", () => {
  it("desatualizada no app: 'Atualizar' sem tentativa; esperando a brecha, sem botão e a frase no explica (role=status)", () => {
    const sem = vistaDaIa("claude-cli", ctx({ "claude-cli": mac("claude-cli", "desatualizada", { versao: "2.1.290", minima: "2.1.300" }) }));
    expect(sem.botao?.act).toBe("ia-atualizar");
    expect(sem.botao?.rotulo).toBe("Atualizar");
    expect(sem.botao?.agora).toBeFalsy();
    const v = vistaDaIa("claude-cli", ctx({ "claude-cli": mac("claude-cli", "desatualizada", { versao: "2.1.290", minima: "2.1.300", atualizacao: at({ fase: "esperando" }) }) }));
    expect(v.botao).toBeNull();
    expect(v.explica).toBe("Vamos atualizar o Claude Code quando seus bots terminarem.");
    expect(renderCartaoIa(v, UI_IAS_INICIAL)).toContain('<div class="ia-explica" role="status"><p>Vamos atualizar o Claude Code quando seus bots terminarem.</p></div>');
  });

  it("aviso e pedidos segurados: 'Atualizar agora' com data-agora=1 (o E0 alcançável pelo web/main.ts)", () => {
    for (const fase of ["aviso", "segurando"] as const) {
      const v = vistaDaIa("claude-cli", ctx({ "claude-cli": mac("claude-cli", "desatualizada", { versao: "2.1.290", minima: "2.1.300", atualizacao: at({ fase }) }) }));
      expect(v.botao).toMatchObject({ act: "ia-atualizar", rotulo: "Atualizar agora", agora: true });
      expect(renderCartaoIa(v, UI_IAS_INICIAL)).toMatch(/data-act="ia-atualizar" data-ia="claude-cli" data-agora="1">Atualizar agora<\/button>/);
    }
    // Sem `agora`, o botão não leva o atributo.
    const sem = vistaDaIa("claude-cli", ctx({ "claude-cli": mac("claude-cli", "desatualizada", { versao: "2.1.290", minima: "2.1.300" }) }));
    expect(renderCartaoIa(sem, UI_IAS_INICIAL)).not.toContain("data-agora");
  });

  it("desatualizada no navegador: a nota só manda ao app, sem o comando do terminal (fora do app vale a NOD-171)", () => {
    const antigo = (id: "claude-cli" | "codex-cli"): ContextoCartao => ({ ...ctx({}, false), servidor: HARNESSES.map((h) => ({
      id: h.id, nome: h.nome, integrado: h.integrado, limite: null, recomendado: null, modelos: [],
      inventario: h.id === id ? { estado: "ausente", motivo: "x", causa: "cli_antigo", versao: "1.0.0", minima: "2.0.0", em: AGORA } : { estado: "ausente", motivo: "x", em: AGORA },
    })) });
    const claude = vistaDaIa("claude-cli", antigo("claude-cli"));
    expect(claude.botao).toBeFalsy();
    expect(claude.nota).toBe("Para atualizar, abra o app do nod no seu Mac.");
    expect(claude.terminal).toBeFalsy();
    expect(renderCartaoIa(claude, UI_IAS_INICIAL)).not.toContain("claude update");
    const codex = vistaDaIa("codex-cli", antigo("codex-cli"));
    expect(codex.nota).toBe("Para atualizar, abra o app do nod no seu Mac.");
  });

  it("'Prefere o terminal?' só depois de uma falha, recolhido; a recusa da senha vira 'Tentar de novo'", () => {
    const com = (a: AtualizacaoDaIa) => vistaDaIa("claude-cli", ctx({ "claude-cli": mac("claude-cli", "desatualizada", { versao: "2.1.290", minima: "2.1.300", atualizacao: a }) }));
    expect(com(at({ fase: "esperando" })).terminal).toBeNull();
    const falhou = com(at({ fase: "falhou" }));
    expect(falhou.terminal).toBe("claude update");
    expect(falhou.botao?.rotulo).toBe("Atualizar");
    const html = renderCartaoIa(falhou, UI_IAS_INICIAL);
    expect(html).toMatch(/<details class="ia-terminal"><summary class="cl-terminal-link">Prefere o terminal\?<\/summary>/);
    expect(html).toContain("<code>claude update</code>");
    const recusou = com(at({ fase: "falhou", motivo: "recusou" }));
    expect(recusou.botao?.rotulo).toBe("Tentar de novo");
    expect(recusou.explica).toBe("Você não autorizou a atualização.");
    const pouco = com(at({ fase: "insuficiente", depois: "2.1.299" }));
    expect(pouco.terminal).toBe("claude update");
    expect(pouco.botao?.rotulo).toBe("Tentar de novo");
    // O Codex no Mac não tem comando: o link não aparece.
    expect(vistaDaIa("codex-cli", ctx({ "codex-cli": mac("codex-cli", "desatualizada", { atualizacao: at({ fase: "falhou" }) }) })).terminal).toBeNull();
  });

  it("binário instalado pelo próprio nod (origem nod): nada de `claude update` no cartão, nem depois da falha", () => {
    const doNod = (estado: EstadoIa["estado"], a: AtualizacaoDaIa) => vistaDaIa("claude-cli", ctx({ "claude-cli": mac("claude-cli", estado, { versao: "2.1.290", minima: "2.1.300", detalhe: { binario: "~/.nod/ias/claude", origem: "nod" }, atualizacao: a }) }));
    expect(doNod("desatualizada", at({ fase: "falhou" })).terminal).toBeNull();
    expect(doNod("desatualizada", at({ fase: "insuficiente", depois: "2.1.299" })).terminal).toBeNull();
    expect(doNod("pronta", at({ fase: "insuficiente", depois: "2.1.299" })).terminal).toBeNull();
    expect(renderCartaoIa(doNod("desatualizada", at({ fase: "falhou" })), UI_IAS_INICIAL)).not.toContain("claude update");
    // Um binário de fora (npm global) mantém o comando.
    const deFora = vistaDaIa("claude-cli", ctx({ "claude-cli": mac("claude-cli", "desatualizada", { versao: "2.1.290", minima: "2.1.300", detalhe: { binario: "/usr/local/bin/claude", origem: "path" }, atualizacao: at({ fase: "falhou" }) }) }));
    expect(deFora.terminal).toBe("claude update");
  });

  it("pronta depois do sucesso: 'Claude Code atualizado para a X.' por um dia, depois some", () => {
    const ok = (em: number) => vistaDaIa("claude-cli", ctx({ "claude-cli": mac("claude-cli", "pronta", { versao: "2.1.301", atualizacao: at({ fase: "sucesso", depois: "2.1.301", em }) }) }));
    const agora = ok(AGORA - 60_000);
    expect(agora.tom).toBe("ok");
    expect(agora.explica).toBe("Claude Code atualizado para a 2.1.301.");
    expect(agora.botao).toBeFalsy();
    expect(renderCartaoIa(agora, UI_IAS_INICIAL)).toContain('<div class="ia-explica" role="status"><p>Claude Code atualizado para a 2.1.301.</p></div>');
    expect(ok(AGORA - AVISO_SUCESSO_MS - 1).explica).toBeNull();
  });

  it("pronta com 'subiu pouco' (modelo acima do piso): a frase, 'Tentar de novo' e o 'Prefere o terminal?'", () => {
    const v = vistaDaIa("claude-cli", ctx({ "claude-cli": mac("claude-cli", "pronta", { versao: "2.1.299", atualizacao: at({ fase: "insuficiente", depois: "2.1.299", alvo: "2.1.310" }) }) }));
    expect(v.tom).toBe("ok");
    expect(v.explica).toBe("Atualizamos o Claude Code para a 2.1.299, mas o nod precisa da 2.1.310, que ainda não saiu. Vamos tentar de novo amanhã.");
    expect(v.botao).toMatchObject({ act: "ia-atualizar", rotulo: "Tentar de novo" });
    expect(v.terminal).toBe("claude update");
    const html = renderCartaoIa(v, UI_IAS_INICIAL);
    expect(html).toContain('data-act="ia-atualizar" data-ia="claude-cli">Tentar de novo</button>');
    expect(html).toContain("Prefere o terminal?");
    // O binário configurado pela pessoa: o nod não mexe, então não oferece tentar de novo.
    const conf = vistaDaIa("claude-cli", ctx({ "claude-cli": mac("claude-cli", "pronta", { versao: "2.1.299", atualizacao: at({ fase: "falhou", motivo: "configurado" }) }) }));
    expect(conf.botao).toBeFalsy();
    // No navegador: só a frase, sem botão.
    expect(vistaDaIa("claude-cli", { ...ctx({}, false), servidor: [] }).botao).toBeFalsy();
  });

  it("atualizando: gira sem botão; pedindo a senha não gira e diz o que fazer", () => {
    const gira = vistaDaIa("claude-cli", ctx({ "claude-cli": mac("claude-cli", "atualizando", { atualizacao: at({ fase: "atualizando" }) }) }));
    expect(gira.texto).toBe("Atualizando o Claude Code…");
    expect(gira.botao).toBeFalsy();
    const senha = vistaDaIa("claude-cli", ctx({ "claude-cli": mac("claude-cli", "atualizando", { atualizacao: at({ fase: "pedindo_aprovacao" }) }) }));
    expect(senha.texto).toBe("Confirme com a senha do Mac para continuar.");
  });
});

describe("o estado único e a ligação", () => {
  it("o domínio: a atualização em curso por cima do inventário vira 'atualizando', com a versão de antes", () => {
    const inv: Inventario = { estado: "ausente", motivo: "x", causa: "cli_antigo", versao: "2.1.290", minima: "2.1.300", em: AGORA };
    expect(estadoDaIa({ ia: "claude-cli", inventario: inv, agora: AGORA, atualizacao: at({ fase: "atualizando", antes: "2.1.290" }) })).toMatchObject({ estado: "atualizando", versao: "2.1.290" });
    expect(estadoDaIa({ ia: "claude-cli", inventario: inv, agora: AGORA, atualizacao: at({ fase: "esperando" }) }).estado).toBe("desatualizada");
    expect(estadoDaIa({ ia: "claude-cli", inventario: { estado: "ausente", motivo: "x", causa: "atualizando", em: AGORA }, agora: AGORA }).estado).toBe("atualizando");
  });

  it("a linha da IA no aviso leva `atualizando`, o protocolo aceita e a tela só espera (nem Instalar, nem 'não está neste Mac')", () => {
    expect(estadoIaDaLigacao("claude-cli", { estado: "ausente", motivo: "x", causa: "atualizando", em: AGORA })).toEqual({ id: "claude-cli", estado: "ausente", causa: "atualizando" });
    const ias = [{ id: "codex-cli", estado: "pronto" }, { id: "claude-cli", estado: "ausente", causa: "atualizando" }] as const;
    expect(lerMsgServidor(JSON.stringify({ t: "sem-ia", causa: "falhou", ia: null, ias, ate: 1 }))).toEqual({ t: "sem-ia", causa: "falhou", ia: null, ias, ate: 1 });
    // Só em `ausente`: em outro estado a causa cai.
    expect(lerMsgServidor(JSON.stringify({ t: "sem-ia", causa: "falhou", ia: null, ias: [{ id: "claude-cli", estado: "pronto", causa: "atualizando" }], ate: 1 }))).toEqual({ t: "sem-ia", causa: "falhou", ia: null, ias: [{ id: "claude-cli", estado: "pronto" }], ate: 1 });
    const s: EstadoSemIa = { causa: "falhou", ia: "codex-cli", ias: [...ias], ate: 0, entrando: null, nota: null, ocupado: false, ponte: { entrar: true, instalar: true }, onboarding: true };
    const html = htmlSemIa(s, { nome: "Nina", genero: "feminina" });
    expect(html).toContain("Atualizando o Claude Code deste Mac. A ligação percebe quando ficar pronto.");
    expect(html).not.toMatch(/Instal|não está neste Mac/);
  });
});
