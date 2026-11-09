import { describe, expect, it } from "vitest";
import { criarLoginsNaMaquina, MAX_LOGINS_POR_PESSOA, PRAZO_LOGIN_MS, PRAZO_PEDIDO_ATUALIZAR_MS } from "../../../src/services/logins-na-maquina.ts";

/**
 * ADR-102 item 3: o login de uma conta numa máquina pela tela. O link da máquina só passa se for oficial; o código
 * cifrado sai do servidor na primeira puxada e nunca fica guardado; logins por pessoa têm teto e prazo.
 */
const MARLON = { tenantId: "t", pessoaId: "marlon" };
const ANA = { tenantId: "t", pessoaId: "ana" };
const VM = "11111111-1111-4111-8111-111111111111";
const IMP = "a".repeat(64);
const CIFRADO = { chave: "QUJD", iv: "REVG", dados: "R0hJ" };

function montar() {
  let agora = 1_760_000_000_000;
  const logins = criarLoginsNaMaquina(() => agora);
  return { logins, passar: (ms: number) => { agora += ms; } };
}

describe("logins na máquina", () => {
  it("o pedido aparece na puxada da máquina certa; o link oficial passa e o de fora é recusado", () => {
    const { logins } = montar();
    const l = logins.pedir({ escopo: MARLON, maquinaId: VM, ia: "claude-cli", contaId: "c1", impressao: IMP, apelido: "Lumen" })!;
    expect(logins.pendentes(MARLON, VM)).toEqual([{ id: l.id, ia: "claude-cli", impressao: IMP, apelido: "Lumen" }]);
    expect(logins.pendentes(MARLON, "outra")).toEqual([]);
    expect(logins.pendentes(ANA, VM)).toEqual([]);
    expect(logins.progresso(MARLON, VM, { loginId: l.id, fase: "aguardando_pessoa", url: "https://phishing.example/oauth/authorize", pedeCodigo: true }).aceito).toBe(false);
    const ok = logins.progresso(MARLON, VM, { loginId: l.id, fase: "aguardando_pessoa", url: "https://claude.com/cai/oauth/authorize?x=1", pedeCodigo: true, chavePublica: "TUlJQg==" });
    expect(ok.aceito).toBe(true);
    expect(logins.ver(MARLON, l.id)).toMatchObject({ fase: "aguardando_pessoa", url: "https://claude.com/cai/oauth/authorize?x=1", pedeCodigo: true, chavePublica: "TUlJQg==" });
    // Outra máquina da pessoa não relata o login desta.
    expect(logins.progresso(MARLON, "outra", { loginId: l.id, fase: "pronto" }).aceito).toBe(false);
  });

  it("o código cifrado sai do servidor UMA vez, só depois da chave pública; colar de novo é recusado", () => {
    const { logins } = montar();
    const l = logins.pedir({ escopo: MARLON, maquinaId: VM, ia: "claude-cli", contaId: null, impressao: null, apelido: "Freela" })!;
    expect(logins.colarCodigo(MARLON, l.id, CIFRADO)).toBe("nao_pede_codigo");
    logins.progresso(MARLON, VM, { loginId: l.id, fase: "aguardando_pessoa", url: "https://claude.com/cai/oauth/authorize", pedeCodigo: true, chavePublica: "TUlJQg==" });
    expect(logins.colarCodigo(MARLON, l.id, { chave: "não é base64!", iv: "x", dados: "y" })).toBe("invalido");
    expect(logins.colarCodigo(MARLON, l.id, CIFRADO)).toBe("ok");
    expect(logins.colarCodigo(MARLON, l.id, CIFRADO)).toBe("ja_enviado");
    expect(logins.pendentes(MARLON, VM)[0]?.codigo).toEqual(CIFRADO);
    expect(logins.pendentes(MARLON, VM)[0]?.codigo).toBeUndefined();
    expect(logins.ver(MARLON, l.id)?.fase).toBe("conferindo");
  });

  it("teto de logins abertos por pessoa; o mesmo login pedido de novo substitui o anterior", () => {
    const { logins } = montar();
    const primeiro = logins.pedir({ escopo: MARLON, maquinaId: VM, ia: "claude-cli", contaId: "c1", impressao: IMP, apelido: null })!;
    const de_novo = logins.pedir({ escopo: MARLON, maquinaId: VM, ia: "claude-cli", contaId: "c1", impressao: IMP, apelido: null })!;
    expect(logins.ver(MARLON, primeiro.id)?.fase).toBe("cancelado");
    // A máquina fica sabendo do cancelamento uma vez.
    expect(logins.pendentes(MARLON, VM).find((p) => p.id === primeiro.id)?.cancelado).toBe(true);
    expect(logins.pendentes(MARLON, VM).find((p) => p.id === primeiro.id)).toBeUndefined();
    for (let i = 1; i < MAX_LOGINS_POR_PESSOA; i++) expect(logins.pedir({ escopo: MARLON, maquinaId: VM, ia: "codex-cli", contaId: `x${i}`, impressao: null, apelido: null })).not.toBeNull();
    expect(logins.pedir({ escopo: MARLON, maquinaId: VM, ia: "codex-cli", contaId: "a-mais", impressao: null, apelido: null })).toBeNull();
    expect(logins.pedir({ escopo: ANA, maquinaId: VM, ia: "codex-cli", contaId: null, impressao: null, apelido: null })).not.toBeNull();
    expect(de_novo.fase).toBe("pedido");
  });

  it("vence em 15 min (tempo_esgotado) e não aceita mais progresso; cancelado avisa a máquina", () => {
    const { logins, passar } = montar();
    const l = logins.pedir({ escopo: MARLON, maquinaId: VM, ia: "codex-cli", contaId: null, impressao: null, apelido: null })!;
    passar(PRAZO_LOGIN_MS + 1);
    expect(logins.ver(MARLON, l.id)).toMatchObject({ fase: "falhou", erro: "tempo_esgotado" });
    expect(logins.progresso(MARLON, VM, { loginId: l.id, fase: "pronto" }).aceito).toBe(false);
    const outro = logins.pedir({ escopo: MARLON, maquinaId: VM, ia: "codex-cli", contaId: null, impressao: null, apelido: null })!;
    expect(logins.cancelar(MARLON, outro.id)).toBe(true);
    expect(logins.pendentes(MARLON, VM)).toEqual([{ id: outro.id, ia: "codex-cli", impressao: null, apelido: null, cancelado: true }]);
  });

  it("o código do aparelho do Codex só no formato dele; pronto liga a conta que entrou", () => {
    const { logins } = montar();
    const l = logins.pedir({ escopo: MARLON, maquinaId: VM, ia: "codex-cli", contaId: null, impressao: null, apelido: "Pessoal" })!;
    expect(logins.progresso(MARLON, VM, { loginId: l.id, fase: "aguardando_pessoa", url: "https://auth.openai.com/codex/device", codigoDispositivo: "rm -rf /" }).aceito).toBe(false);
    expect(logins.progresso(MARLON, VM, { loginId: l.id, fase: "aguardando_pessoa", url: "https://auth.openai.com/codex/device", codigoDispositivo: "QX7R-2MLA" }).aceito).toBe(true);
    expect(logins.progresso(MARLON, VM, { loginId: l.id, fase: "pronto", impressao: IMP }).aceito).toBe(true);
    logins.ligarConta(MARLON, l.id, "conta-nova");
    expect(logins.ver(MARLON, l.id)).toMatchObject({ fase: "pronto", contaFinalId: "conta-nova", codigoDispositivo: "QX7R-2MLA" });
  });

  it("NOD-8: `preparando` antes de `abrindo` guarda o passo 1; o preparo fica no concluído e a falha leva preparo_falhou", () => {
    const { logins } = montar();
    const l = logins.pedir({ escopo: MARLON, maquinaId: VM, ia: "codex-cli", contaId: null, impressao: null, apelido: "Pessoal" })!;
    expect(l.preparo).toBeNull();
    expect(logins.progresso(MARLON, VM, { loginId: l.id, fase: "preparando", preparo: { acao: "instalar", linha: "Baixando o Codex" } }).aceito).toBe(true);
    expect(logins.ver(MARLON, l.id)).toMatchObject({ fase: "preparando", preparo: { acao: "instalar", linha: "Baixando o Codex" } });
    // O fim do preparo traz a versão que ficou; o relato seguinte sem preparo não o apaga.
    expect(logins.progresso(MARLON, VM, { loginId: l.id, fase: "abrindo", preparo: { acao: "instalar", depois: "0.162.0" } }).aceito).toBe(true);
    expect(logins.progresso(MARLON, VM, { loginId: l.id, fase: "aguardando_pessoa", url: "https://auth.openai.com/codex/device", codigoDispositivo: "QX7R-2MLA" }).aceito).toBe(true);
    expect(logins.progresso(MARLON, VM, { loginId: l.id, fase: "pronto", impressao: IMP }).aceito).toBe(true);
    expect(logins.ver(MARLON, l.id)).toMatchObject({ fase: "pronto", preparo: { acao: "instalar", depois: "0.162.0" } });

    const f = logins.pedir({ escopo: MARLON, maquinaId: VM, ia: "claude-cli", contaId: null, impressao: null, apelido: null })!;
    expect(logins.progresso(MARLON, VM, { loginId: f.id, fase: "preparando", preparo: { acao: "atualizar", antes: "2.1.280" } }).aceito).toBe(true);
    expect(logins.progresso(MARLON, VM, { loginId: f.id, fase: "falhou", erro: "preparo_falhou" }).aceito).toBe(true);
    expect(logins.ver(MARLON, f.id)).toMatchObject({ fase: "falhou", erro: "preparo_falhou", preparo: { acao: "atualizar", antes: "2.1.280" } });
    // A máquina não puxa mais o login que falhou no preparo.
    expect(logins.pendentes(MARLON, VM).map((p) => p.id)).not.toContain(f.id);
  });

  it("NOD-8 passo 9: o motivo da falha do preparo (preparo.atualizacao) vai do motor ao login que a web lê", () => {
    const { logins } = montar();
    const l = logins.pedir({ escopo: MARLON, maquinaId: VM, ia: "codex-cli", contaId: null, impressao: null, apelido: null })!;
    const atualizacao = { fase: "falhou" as const, alvo: "0.159.0", motivo: "sem_espaco" as const, caminho: "npm_local" as const, em: 1, espaco: { livreMb: 1_200, precisaMb: 2_048 } };
    expect(logins.progresso(MARLON, VM, { loginId: l.id, fase: "falhou", erro: "preparo_falhou", preparo: { acao: "instalar", atualizacao } }).aceito).toBe(true);
    const visto = logins.ver(MARLON, l.id)!;
    expect(visto).toMatchObject({ fase: "falhou", erro: "preparo_falhou", preparo: { acao: "instalar", atualizacao } });
    // Cópia: mexer no relato depois não muda o guardado.
    atualizacao.espaco.livreMb = 0;
    expect(logins.ver(MARLON, l.id)?.preparo?.atualizacao?.espaco?.livreMb).toBe(1_200);
  });

  it("a desconexão pedida aparece até a máquina confirmar e vence em 10 min", () => {
    const { logins, passar } = montar();
    logins.pedirDesconexao(MARLON, VM);
    expect(logins.desconexaoPedida(MARLON, VM)).toBe(true);
    expect(logins.desconexaoPedida(ANA, VM)).toBe(false);
    expect(logins.concluirDesconexao(MARLON, VM)).toBe(true);
    expect(logins.desconexaoPedida(MARLON, VM)).toBe(false);
    logins.pedirDesconexao(MARLON, VM);
    passar(10 * 60_000 + 1);
    expect(logins.desconexaoPedida(MARLON, VM)).toBe(false);
  });

  it("NOD-9: o pedido de atualizar sai uma vez, só para a máquina e a pessoa dele, e vence no prazo", () => {
    const { logins, passar } = montar();
    logins.pedirAtualizacao(MARLON, VM, "claude-cli");
    logins.pedirAtualizacao(MARLON, VM, "claude-cli");
    logins.pedirAtualizacao(MARLON, VM, "codex-cli");
    expect(logins.atualizacoesPedidas(ANA, VM)).toEqual([]);
    expect(logins.atualizacoesPedidas(MARLON, "22222222-2222-4222-8222-222222222222")).toEqual([]);
    expect(logins.atualizacoesPedidas(MARLON, VM)).toEqual(["claude-cli", "codex-cli"]);
    expect(logins.atualizacoesPedidas(MARLON, VM)).toEqual([]);
    logins.pedirAtualizacao(MARLON, VM, "claude-cli");
    passar(PRAZO_PEDIDO_ATUALIZAR_MS + 1);
    expect(logins.atualizacoesPedidas(MARLON, VM)).toEqual([]);
    // O prazo é exclusivo: no instante exato em que vence, o pedido já não sai.
    logins.pedirAtualizacao(MARLON, VM, "codex-cli");
    passar(PRAZO_PEDIDO_ATUALIZAR_MS);
    expect(logins.atualizacoesPedidas(MARLON, VM)).toEqual([]);
  });

  it("devolução do #501: os pedidos vencidos de máquinas que nunca mais puxaram saem no próximo pedido", () => {
    const { logins, passar } = montar();
    for (let i = 0; i < 50; i++) logins.pedirAtualizacao(MARLON, `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, "claude-cli");
    logins.pedirAtualizacao(ANA, VM, "codex-cli");
    expect(logins.pedidosDeAtualizacaoGuardados()).toBe(51);
    passar(PRAZO_PEDIDO_ATUALIZAR_MS);
    logins.pedirAtualizacao(MARLON, VM, "claude-cli");
    expect(logins.pedidosDeAtualizacaoGuardados()).toBe(1);
    expect(logins.atualizacoesPedidas(MARLON, VM)).toEqual(["claude-cli"]);
    expect(logins.pedidosDeAtualizacaoGuardados()).toBe(0);
  });
});
