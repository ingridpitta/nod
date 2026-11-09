import { describe, expect, it } from "vitest";
import type { InstalacaoSshDto } from "../../../src/contracts/instalacoes-ssh.ts";
import type { InstalarSsh } from "../../../web/estado/reducer.ts";
import { ErroApi } from "../../../web/lib/erro-api.ts";
import { comandoManual, criarInstalarSsh, ehIpPrivado, lerEndereco, type ApiDaInstalacao } from "../../../web/lib/instalar-ssh.ts";
import { linhaEmSegundoPlano, renderInstalarSsh } from "../../../web/telas/instalar-ssh.ts";

const CHAVE = "-----BEGIN RSA PRIVATE KEY-----\nSEGREDO-DA-CHAVE\n-----END RSA PRIVATE KEY-----";
const ate = () => new Promise((r) => setTimeout(r, 0));

function montar(respostas: Partial<InstalacaoSshDto>[] = []) {
  let estado: InstalarSsh | null = null;
  const chamadas: { nome: string; args: unknown[] }[] = [];
  const agendadas: (() => void)[] = [];
  let prontas = 0;
  let pedirFalha: Error | null = null;
  let verFalha: Error | null = null;
  const base: InstalacaoSshDto = {
    id: "p1", origemId: "mac", host: "203.0.113.7", porta: 22, usuario: "ubuntu", metodo: "chave", estado: "esperando", etapa: null,
    motivo: null, impressoes: null, linhas: [], maquinaId: null, pedeCredencial: false, expiraEm: Date.now() + 60_000, atualizadoEm: Date.now(),
  };
  const api: ApiDaInstalacao = {
    instaladorasSsh: async () => ({ instaladoras: [{ id: "mac", nome: "Mac do Marlon", plataforma: "darwin" }] }),
    pedirInstalacaoSsh: async (p) => {
      chamadas.push({ nome: "pedir", args: [p] });
      if (pedirFalha) { const e = pedirFalha; pedirFalha = null; throw e; }
      return { id: "p1", origemId: "mac", chavePublica: "PUB", expiraEm: Date.now() + 60_000 };
    },
    verInstalacaoSsh: async () => { chamadas.push({ nome: "ver", args: [] }); if (verFalha) throw verFalha; return { ...base, ...(respostas.shift() ?? {}) }; },
    credencialSsh: async (id, cifrado) => { chamadas.push({ nome: "credencial", args: [id, cifrado] }); return {}; },
    confiarNaNovaSsh: async (id) => { chamadas.push({ nome: "confiar", args: [id] }); return {}; },
    cancelarInstalacaoSsh: async (id) => { chamadas.push({ nome: "cancelar", args: [id] }); return {}; },
    criarConvite: async (c) => { chamadas.push({ nome: "convite", args: [c] }); return { convite: "C0NV1TE", expiraEm: 0 }; },
  };
  const ctl = criarInstalarSsh({
    api,
    cifrar: async (chave, texto) => ({ chave, iv: "iv", dados: Buffer.from(texto).toString("base64") }),
    ler: () => estado,
    gravar: (i) => { estado = i; },
    agendar: (fn) => { agendadas.push(fn); return { cancelar: () => { const i = agendadas.indexOf(fn); if (i >= 0) agendadas.splice(i, 1); } }; },
    origem: "https://nod.exemplo",
    computadorAtual: () => "vm-velha",
    aoFicarPronta: () => { prontas++; },
  });
  return {
    ctl, chamadas, agendadas,
    estado: () => estado!,
    prontas: () => prontas,
    falharPedido: (e: Error) => { pedirFalha = e; },
    falharVer: (e: Error) => { verFalha = e; },
    credenciais: () => chamadas.filter((c) => c.nome === "credencial").map((c) => JSON.parse(Buffer.from((c.args[1] as { dados: string }).dados, "base64").toString())),
    proxima: async () => { const fn = agendadas.shift(); fn?.(); await ate(); },
  };
}

async function preencher(m: ReturnType<typeof montar>, o: { frase?: string } = {}) {
  await m.ctl.abrir();
  m.ctl.campo("endereco", "203.0.113.7");
  m.ctl.campo("usuario", "ubuntu");
  await m.ctl.colarChave(CHAVE);
  if (o.frase) { m.ctl.temFrase(true); m.ctl.segredo("frase", o.frase); }
}

describe("instalar por SSH: o controlador (NOD-94)", () => {
  it("lerEndereco: host, host:porta, [ipv6]:porta; recusa espaço, porta fora e host que começa com -", () => {
    expect(lerEndereco("vm.exemplo.com")).toEqual({ host: "vm.exemplo.com", porta: 22 });
    expect(lerEndereco(" 203.0.113.7:2222 ")).toEqual({ host: "203.0.113.7", porta: 2222 });
    expect(lerEndereco("[2001:db8::1]:2200")).toEqual({ host: "2001:db8::1", porta: 2200 });
    expect(lerEndereco("2001:db8::1")).toEqual({ host: "2001:db8::1", porta: 22 });
    for (const ruim of ["", "a b", "vm:0", "vm:70000", "-oProxyCommand=x", "vm;rm"]) expect(lerEndereco(ruim)).toBeNull();
  });

  it("ehIpPrivado e o comando manual", () => {
    expect(["10.0.0.1", "172.20.1.1", "192.168.0.9", "100.100.1.1"].every(ehIpPrivado)).toBe(true);
    expect(["8.8.8.8", "172.32.0.1", "vm.local"].some(ehIpPrivado)).toBe(false);
    expect(comandoManual("https://nod", "abc")).toBe('curl -fsSL "https://nod/motor?papel=computador&convite=abc" | sh');
  });

  it("confere o formulário antes de pedir", async () => {
    const m = montar();
    await m.ctl.abrir();
    await m.ctl.enviar();
    expect(m.estado().campoErro?.campo).toBe("endereco");
    m.ctl.campo("endereco", "vm");
    await m.ctl.enviar();
    expect(m.estado().campoErro?.campo).toBe("usuario");
    m.ctl.campo("usuario", "root");
    await m.ctl.enviar();
    expect(m.estado().campoErro).toMatchObject({ campo: "acesso" });
    await m.ctl.colarChave("ssh-ed25519 AAAAC3Nza m@mac");
    expect(m.estado().campoErro?.texto).toMatch(/chave pública/);
    expect(m.chamadas.some((c) => c.nome === "pedir")).toBe(false);
  });

  // NOD-94 (QA, nota do Revisor): o arquivo grande demais era ignorado em silêncio.
  it("chave por arquivo: grande demais avisa no campo, sem ler; do tamanho certo, lê como colada", async () => {
    const m = montar();
    await m.ctl.abrir();
    let lido = false;
    await m.ctl.chaveDoArquivo({ size: 64_000, text: async () => { lido = true; return CHAVE; } });
    expect(lido).toBe(false);
    expect(m.estado().campoErro).toMatchObject({ campo: "acesso", texto: expect.stringMatching(/grande demais/) });
    await m.ctl.chaveDoArquivo({ size: CHAVE.length, text: async () => CHAVE });
    expect(m.estado().campoErro).toBeNull();
    expect(m.estado().chave).not.toBeNull();
  });

  it("pede, manda a credencial cifrada uma vez quando a instaladora pede, e limpa tudo ao ficar pronta", async () => {
    const m = montar([{ estado: "instalando", etapa: "node", pedeCredencial: false }, { estado: "pronta", etapa: "pronta", maquinaId: "m9" }]);
    await preencher(m, { frase: "frase1" });
    expect(m.estado().chave).toEqual({ tipo: "RSA", impressao: null, temFrase: false });
    await m.ctl.enviar();
    await ate();
    expect(m.chamadas.find((c) => c.nome === "pedir")?.args[0]).toEqual({ host: "203.0.113.7", porta: 22, usuario: "ubuntu", metodo: "chave", origemId: "mac", substituir: false });
    expect(m.credenciais()).toEqual([{ chave: CHAVE, frase: "frase1" }]);
    expect(m.estado().fase).toBe("progresso");
    // Nenhum segredo no estado (que vira HTML).
    expect(JSON.stringify(m.estado())).not.toMatch(/SEGREDO|frase1/);
    await m.proxima();
    expect(m.estado().pedido?.etapa).toBe("node");
    await m.proxima();
    expect(m.estado().pedido?.estado).toBe("pronta");
    expect(m.prontas()).toBe(1);
    expect(m.ctl.valorDoSegredo("frase")).toBe("");
    expect(m.agendadas).toHaveLength(0);
  });

  it("frase errada volta ao formulário com o erro no acesso e apaga só a frase; tentar de novo reenvia a chave", async () => {
    const m = montar([{ estado: "erro", motivo: "frase_senha_errada" }]);
    await preencher(m, { frase: "errada" });
    await m.ctl.enviar();
    await m.proxima();
    expect(m.estado()).toMatchObject({ fase: "form", pedido: null, campoErro: { campo: "acesso" } });
    expect(m.ctl.valorDoSegredo("frase")).toBe("");
    m.ctl.segredo("frase", "certa");
    await m.ctl.enviar();
    expect(m.credenciais().at(-1)).toEqual({ chave: CHAVE, frase: "certa" });
  });

  it("sem_sudo com chave pede a senha do sudo e manda de novo com ela; sem ela, avisa", async () => {
    const m = montar([{ estado: "erro", motivo: "sem_sudo" }]);
    await preencher(m);
    await m.ctl.enviar();
    await m.proxima();
    expect(m.estado().pedeSudo).toBe(true);
    await m.ctl.enviarSudo();
    expect(m.estado().campoErro?.campo).toBe("sudo");
    m.ctl.segredo("sudo", "s3nha");
    await m.ctl.enviarSudo();
    expect(m.credenciais().at(-1)).toEqual({ chave: CHAVE, sudo: "s3nha" });
    expect(m.estado().pedeSudo).toBe(false);
  });

  it("409 ja_tem_computador pergunta Substituir e pede de novo com substituir: true", async () => {
    const m = montar();
    await preencher(m);
    m.falharPedido(new ErroApi(409, "ja_tem_computador", "já tem"));
    await m.ctl.enviar();
    expect(m.estado().substituir).toEqual({ nome: "vm-velha", confirmado: false });
    await m.ctl.confirmarSubstituir();
    expect((m.chamadas.filter((c) => c.nome === "pedir").at(-1)?.args[0] as { substituir: boolean }).substituir).toBe(true);
  });

  it("chave do servidor mudou: confiar na nova consulta de novo e reenvia a credencial", async () => {
    const m = montar([{ estado: "erro", motivo: "chave_do_servidor_mudou", impressoes: { antiga: "SHA256:a", nova: "SHA256:b" } }, { estado: "esperando", pedeCredencial: true }]);
    await preencher(m);
    await m.ctl.enviar();
    await m.proxima();
    expect(m.estado().pedido?.motivo).toBe("chave_do_servidor_mudou");
    await m.ctl.confiarNaNova();
    await ate();
    expect(m.chamadas.map((c) => c.nome)).toContain("confiar");
    expect(m.credenciais()).toHaveLength(2);
  });

  it("fechar com a instalação andando vai para segundo plano; cancelar chama o servidor e apaga os segredos", async () => {
    const m = montar();
    await preencher(m);
    await m.ctl.enviar();
    m.ctl.fechar();
    expect(m.estado().segundoPlano).toBe(true);
    await m.ctl.cancelar();
    expect(m.chamadas.at(-1)).toEqual({ nome: "cancelar", args: ["p1"] });
    expect(m.estado()).toBeNull();
    expect(m.ctl.valorDoSegredo("frase")).toBe("");
  });

  it("um 404 na consulta (servidor reiniciou) vira nao_pareou", async () => {
    const m = montar();
    await preencher(m);
    await m.ctl.enviar();
    m.falharVer(new ErroApi(404, "nao_encontrado", "sumiu"));
    await m.proxima();
    expect(m.estado().pedido).toMatchObject({ estado: "erro", motivo: "nao_pareou" });
    expect(m.agendadas).toHaveLength(0);
  });

  it("o comando manual usa um convite com papel computador", async () => {
    const m = montar();
    await m.ctl.abrir();
    await m.ctl.abrirManual();
    expect(m.chamadas.at(-1)).toEqual({ nome: "convite", args: [{ substituir: false }] });
    expect(m.estado().manual).toBe('curl -fsSL "https://nod.exemplo/motor?papel=computador&convite=C0NV1TE" | sh');
  });
});

describe("instalar por SSH: a tela (NOD-94)", () => {
  const pedido = (o: Partial<InstalacaoSshDto> = {}): InstalacaoSshDto => ({
    id: "p1", origemId: "mac", host: "203.0.113.7", porta: 22, usuario: "ubuntu", metodo: "chave", estado: "instalando", etapa: "node",
    motivo: null, impressoes: null, linhas: ["apt-get install ok"], maquinaId: null, pedeCredencial: false, expiraEm: 0, atualizadoEm: 0, ...o,
  });
  const tela = (i: Partial<InstalarSsh>) => {
    const base: InstalarSsh = {
      fase: "form", endereco: "203.0.113.7", usuario: "ubuntu", metodo: "chave", chave: null, temFrase: false,
      instaladoras: [{ id: "mac", nome: "Mac do Marlon", plataforma: "darwin" }], origemId: "mac", trocarOrigem: false, substituir: null, pedido: null,
      campoErro: null, erro: null, pedeSudo: false, mostrarSudo: false, manual: null, segundoPlano: false, enviando: false, tentadas: [],
    };
    return renderInstalarSsh({ agora: Date.now(), instalarSsh: { ...base, ...i } });
  };

  it("formulário: campos de segredo sem value, erro ligado ao campo por aria", () => {
    const html = tela({ temFrase: true, chave: { tipo: "ED25519", impressao: "SHA256:abc", temFrase: true }, campoErro: { campo: "acesso", texto: "Frase errada" } });
    expect(html).toContain('data-form="instalar-ssh"');
    expect(html).toContain("SHA256:abc");
    expect(html).toContain("Frase errada");
    expect(html).toMatch(/aria-describedby="ssh-erro-acesso"/);
    for (const m of html.matchAll(/<input[^>]*data-ssh-segredo[^>]*>/g)) expect(m[0]).not.toMatch(/value=/);
    expect(html).not.toContain("BEGIN");
  });

  it("progresso: etapas com aria-live e a linha de segundo plano", () => {
    const html = tela({ fase: "progresso", pedido: pedido() });
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Instalando o computador");
    expect(tela({ fase: "progresso", pedido: pedido(), segundoPlano: true })).toBe("");
    expect(linhaEmSegundoPlano({ instalarSsh: { ...({} as InstalarSsh), fase: "progresso", pedido: pedido(), segundoPlano: true } as InstalarSsh })).toContain('data-act="ssh-reabrir"');
  });

  it("cada motivo de erro tem texto e saída", () => {
    const motivos = ["ssh_sem_rota", "chave_do_servidor_mudou", "so_nao_suportado", "sem_saida_para_o_nod", "instalacao_falhou", "nao_pareou", "tempo_esgotado"] as const;
    for (const motivo of motivos) {
      const html = tela({ fase: "progresso", pedido: pedido({ estado: "erro", motivo, impressoes: motivo === "chave_do_servidor_mudou" ? { antiga: "SHA256:velha", nova: "SHA256:nova" } : null }) });
      expect(html, motivo).toContain('role="alert"');
      expect(html, motivo).toMatch(/data-act="ssh-(tentar|conferir|confiar|cancelar|fechar)"/);
    }
    expect(tela({ fase: "progresso", pedido: pedido({ estado: "erro", motivo: "chave_do_servidor_mudou", impressoes: { antiga: "SHA256:velha", nova: "SHA256:nova" } }) })).toContain("SHA256:nova");
  });

  it("escapa o que vem do servidor", () => {
    const html = tela({ fase: "progresso", pedido: pedido({ estado: "erro", motivo: "instalacao_falhou", host: "<img src=x>", linhas: ["<script>x</script>"] }) });
    expect(html).not.toContain("<script>x");
    expect(html).not.toContain("<img src=x>");
  });
});
