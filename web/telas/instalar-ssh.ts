import type { EtapaInstalacao, InstalacaoSshDto } from "../../src/contracts/instalacoes-ssh.ts";
import type { Estado, InstalarSsh } from "../estado/reducer.ts";
import { botao, esc } from "../lib/render.ts";
import { ehIpPrivado } from "../lib/instalar-ssh.ts";

/**
 * NOD-94 (emenda 11 da ADR-090; protótipo nod-94, pranchas p_form…p_nao_pareou): o diálogo "Ligar o computador em outra
 * máquina sua". O formulário, o progresso em 5 etapas e o erro de cada motivo (seção 5 do plano), em âmbar.
 *
 * Nenhum segredo entra neste HTML: os campos de frase, senha e sudo saem sem `value` (main.ts devolve o valor da
 * memória do controlador depois de desenhar) e a chave colada vira uma linha com o tipo e a impressão.
 */

export const ETAPAS = ["Conectando por SSH", "Conferindo a máquina", "Instalando o computador", "Conectando ao Nod", "Pronto"] as const;
const INSTALANDO: readonly EtapaInstalacao[] = ["pacotes", "node", "usuario", "motor", "servico"];
/** Em `pareando` há mais que isso: a linha cinza "Ainda esperando…". */
export const ESPERA_LONGA_MS = 3 * 60_000;

/** O índice da etapa em que o pedido está (0…4). */
export function indiceDaEtapa(p: InstalacaoSshDto): number {
  if (p.estado === "pronta" || p.etapa === "pronta") return 4;
  if (p.estado === "pareando" || p.etapa === "pareamento") return 3;
  if (p.etapa && INSTALANDO.includes(p.etapa)) return 2;
  if (p.etapa === "conferencia") return 1;
  return 0;
}

const alvo = (p: InstalacaoSshDto | null, i: InstalarSsh) => p?.host ?? (i.endereco.trim() || "a máquina");
const nomeDaOrigem = (i: InstalarSsh, id: string | null | undefined) => i.instaladoras?.find((x) => x.id === id)?.nome ?? "outra máquina sua";

function campoErro(i: InstalarSsh, campo: NonNullable<InstalarSsh["campoErro"]>["campo"]): { attrs: string; texto: string } {
  if (i.campoErro?.campo !== campo) return { attrs: "", texto: "" };
  return { attrs: ` aria-invalid="true" aria-describedby="ssh-erro-${campo}"`, texto: `<p class="ssh-erro" id="ssh-erro-${campo}" role="alert">${esc(i.campoErro.texto)}</p>` };
}

function manual(i: InstalarSsh): string {
  if (!i.manual) return `<p class="ssh-nota">${botao("ssh-manual", "Prefere fazer você mesmo?", { classe: "link" })}</p>`;
  return `<div class="ssh-manual"><p>Prefere fazer você mesmo? Rode isto no servidor (ele pede a senha do sudo lá):</p>
    <div class="cx-cmd"><code>${esc(i.manual)}</code>${botao("copiar-texto", "Copiar", { classe: "sm", dados: { texto: i.manual } })}</div>
    <p class="ssh-nota">Ele instala o computador e conecta ao Nod sozinho. O convite vale uma vez.</p></div>`;
}

function formulario(i: InstalarSsh): string {
  const origem = i.instaladoras?.find((x) => x.id === i.origemId) ?? null;
  const noMac = origem?.plataforma === "darwin";
  const metodo = i.metodo === "apelido" && !noMac ? "chave" : i.metodo;
  const end = campoErro(i, "endereco");
  const usu = campoErro(i, "usuario");
  const ac = campoErro(i, "acesso");
  const metodos: [typeof metodo, string][] = [...(noMac ? [["apelido", "Este Mac"] as [typeof metodo, string]] : []), ["chave", "Chave SSH"], ["senha", "Senha"]];
  const seg = `<div class="segmentado ssh-acesso" role="group" aria-labelledby="ssh-acesso-rot">${metodos.map(([m, nome]) => `<button type="button" class="seg${metodo === m ? " ativo" : ""}" aria-pressed="${metodo === m}" data-act="ssh-metodo" data-metodo="${m}">${esc(nome)}</button>`).join("")}</div>`;
  let acesso = "";
  if (metodo === "apelido") {
    acesso = `<div class="ssh-este-mac"><span><b>Usar o acesso que este Mac já tem</b><small>O endereço pode ser um apelido do ~/.ssh/config. A chave do Mac não sai dele.</small></span></div>`;
  } else if (metodo === "chave" && i.chave) {
    acesso = `<div class="ssh-chave" role="group" aria-label="Chave SSH colada"><span class="ssh-chave-txt"><b>Chave ${esc(i.chave.tipo)}</b><small>${esc(i.chave.impressao ?? "sem impressão (formato PEM)")} · colada agora</small></span>${botao("ssh-trocar-chave", "Trocar", { classe: "link" })}</div>
      ${i.temFrase ? `<label class="ssh-campo"><span>Frase-senha da chave</span><input type="password" data-ssh-segredo="frase" data-manter-foco="ssh-frase" autocomplete="off"${ac.attrs}></label>` : `<p class="ssh-nota">${botao("ssh-tem-frase", "Tem frase-senha?", { classe: "link", dados: { sim: "1" } })}</p>`}`;
  } else if (metodo === "chave") {
    acesso = `<textarea class="ssh-chave-colar" data-ssh-chave data-manter-foco="ssh-chave" rows="4" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" aria-labelledby="ssh-acesso-rot"${ac.attrs}></textarea>
      <p class="ssh-nota"><label class="ssh-arquivo">Escolher arquivo…<input type="file" data-ssh-arquivo hidden></label> · a chave privada (por exemplo ~/.ssh/id_ed25519)</p>`;
  } else {
    acesso = `<label class="ssh-campo"><span class="sr-only">Senha do SSH</span><input type="password" data-ssh-segredo="senha" data-manter-foco="ssh-senha" autocomplete="off" aria-labelledby="ssh-acesso-rot"${ac.attrs}></label>`;
  }
  const substituir = i.substituir && !i.substituir.confirmado
    ? `<div class="ssh-aviso" role="alert"><p>Você já tem um computador ligado em <b>${esc(i.substituir.nome)}</b>. Substituir? O computador dos bots passa para a máquina nova quando ela conectar, e a ${esc(i.substituir.nome)} é desconectada.</p><div>${botao("ssh-substituir-nao", "Manter", { classe: "sm" })}${botao("ssh-substituir-sim", "Substituir", { classe: "sm pri" })}</div></div>`
    : "";
  const semInstaladora = i.instaladoras !== null && i.instaladoras.length === 0;
  const erro = i.erro ? `<p class="ssh-aviso" role="alert">${esc(i.erro)}</p>` : "";
  const de = i.instaladoras === null ? `<span class="ssh-de">Procurando uma máquina sua para conectar…</span>`
    : semInstaladora ? ""
      : i.trocarOrigem ? `<span class="ssh-de" role="group" aria-label="Conectar a partir de">${i.instaladoras.map((x) => botao("ssh-origem", esc(x.nome), { classe: `sm${x.id === i.origemId ? " pri" : ""}`, dados: { id: x.id } })).join("")}</span>`
        : `<span class="ssh-de">Conectando a partir de ${esc(nomeDaOrigem(i, i.origemId))}${i.instaladoras.length > 1 ? ` · ${botao("ssh-trocar-origem", "trocar", { classe: "link" })}` : ""}</span>`;
  return `<form data-form="instalar-ssh" novalidate>
    <h3 id="ssh-tit">Ligar o computador em outra máquina sua</h3>
    <p id="ssh-lead">Um servidor Linux seu (Debian ou Ubuntu). O nod entra nele por SSH, instala o computador e liga, sem terminal.</p>
    <div class="ssh-linha-campo">
      <label class="ssh-campo"><span>Endereço</span><input type="text" data-ssh-campo="endereco" data-manter-foco="ssh-end" data-cl-autofoco value="${esc(i.endereco)}" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="${noMac && metodo === "apelido" ? "servidor-casa" : "203.0.113.40"}"${end.attrs}>${end.texto || `<small class="ssh-nota">Porta 22, se não disser outra.</small>`}</label>
      <label class="ssh-campo"><span>Usuário${metodo === "apelido" ? " (opcional)" : ""}</span><input type="text" data-ssh-campo="usuario" data-manter-foco="ssh-usu" value="${esc(i.usuario)}" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="ubuntu"${usu.attrs}>${usu.texto}</label>
    </div>
    <div class="ssh-campo"><span class="ssh-rot" id="ssh-acesso-rot">Acesso</span>${seg}${acesso}${ac.texto}</div>
    <p class="ssh-seguro">${metodo === "apelido" ? "O nod usa o acesso do Mac uma vez, para instalar, e não guarda nada dele." : `O nod usa este acesso uma vez, para instalar, e não guarda. Ele vai cifrado direto para ${esc(nomeDaOrigem(i, i.origemId))}.`}</p>
    ${substituir}${erro}
    ${semInstaladora ? `<p class="ssh-aviso" role="alert">Nenhuma máquina sua está ligada para instalar agora. Abra o app do Mac ou ligue um motor e tente de novo.</p>${manual(i)}` : ""}
    <div class="cl-dialogo-acoes">${de}${botao("ssh-cancelar", "Cancelar")}<button type="submit" class="bt pri"${i.enviando || semInstaladora || i.instaladoras === null ? " disabled" : ""}>${i.enviando ? "Ligando…" : "Ligar o computador lá"}</button></div>
  </form>`;
}

function etapas(p: InstalacaoSshDto): string {
  const atual = indiceDaEtapa(p);
  const erro = p.estado === "erro";
  const detalhe = (n: number) => n === 0 ? `${p.host}:${p.porta}` : "";
  return `<div class="ssh-linha" aria-hidden="true"><i style="width:${Math.round((atual / (ETAPAS.length - 1)) * 100)}%"></i></div>
    <ol class="ssh-etapas" aria-live="polite">${ETAPAS.map((nome, n) => {
      const classe = n < atual || p.estado === "pronta" ? "feito" : n === atual ? (erro ? "erro" : "agora") : "";
      return `<li class="${classe}"${n === atual ? ' aria-current="step"' : ""}><span aria-hidden="true">${classe === "feito" ? "✓" : classe === "erro" ? "!" : n + 1}</span><b>${esc(nome)}</b>${detalhe(n) ? `<small>${esc(detalhe(n))}</small>` : ""}</li>`;
    }).join("")}</ol>`;
}

function haMin(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  return `há ${min} min`;
}

function ultimasLinhas(p: InstalacaoSshDto): string {
  return p.linhas.length ? `<details class="ssh-linhas"><summary>Ver as últimas linhas</summary><pre>${esc(p.linhas.join("\n"))}</pre></details>` : "";
}

/** O que mostrar no erro de cada motivo (seção 5 do plano). */
function erroDoPedido(i: InstalarSsh, p: InstalacaoSshDto): string {
  const nome = alvo(p, i);
  const tentar = botao("ssh-tentar", "Tentar de novo", { classe: "pri" });
  const fechar = botao("ssh-fechar", "Fechar");
  switch (p.motivo) {
    case "ssh_sem_rota": {
      const outras = (i.instaladoras ?? []).filter((x) => x.id !== p.origemId && !i.tentadas.includes(x.id));
      const privado = ehIpPrivado(p.host) ? ` Endereços ${esc(p.host.split(".").slice(0, 2).join("."))}… só se veem de dentro da mesma rede.` : "";
      return `<div class="ssh-aviso" role="alert"><p><b>Não consegui chegar a ${esc(p.host)}:${p.porta} a partir ${esc(/^[aeiou]/i.test(nomeDaOrigem(i, p.origemId)) ? "da" : "de")} ${esc(nomeDaOrigem(i, p.origemId))}.</b>${privado} Nada foi instalado.</p></div>
        <p class="ssh-acoes-erro">${outras.map((x) => botao("ssh-tentar", `Tentar a partir de ${esc(x.nome)}`, { classe: "sm", dados: { origem: x.id } })).join("")}${botao("ssh-conferir", "Conferir o endereço", { classe: "link" })}</p>
        ${manual(i)}<div class="cl-dialogo-acoes">${fechar}</div>`;
    }
    case "chave_do_servidor_mudou":
      return `<div class="ssh-aviso" role="alert"><p><b>A identidade de ${esc(p.host)} mudou desde a última vez.</b> Pode ser o servidor reinstalado, ou outra máquina no lugar dele. O nod parou antes de mandar o acesso.</p>
        <dl class="ssh-impressoes"><dt>Antes</dt><dd><code>${esc(p.impressoes?.antiga ?? "—")}</code></dd><dt>Agora</dt><dd><code>${esc(p.impressoes?.nova ?? "—")}</code></dd></dl>
        <p>Se não foi você quem reinstalou, confira com quem cuida do servidor antes de confiar.</p></div>
        <div class="cl-dialogo-acoes"><button type="button" class="bt" data-act="ssh-cancelar" data-cl-autofoco>Cancelar</button>${botao("ssh-confiar", "Confiar na nova")}</div>`;
    case "so_nao_suportado":
      return `<div class="ssh-aviso" role="alert"><p><b>O computador roda em Debian ou Ubuntu (x64 ou arm64).</b> ${esc(nome)} está com outro sistema. Nada foi instalado. Use outra máquina, ou uma VM Debian ou Ubuntu nela.</p></div>
        <div class="cl-dialogo-acoes">${botao("ssh-conferir", "Escolher outra máquina", { classe: "link" })}${fechar}</div>`;
    case "sem_saida_para_o_nod":
      return `<div class="ssh-aviso" role="alert"><p><b>${esc(nome)} não alcança o Nod.</b> Ela precisa sair para a internet (HTTPS) para baixar o computador e conectar. Libere a saída no firewall dela e tente outra vez.</p></div>
        <div class="cl-dialogo-acoes">${botao("ssh-conferir", "Escolher outra máquina", { classe: "link" })}${fechar}</div>`;
    case "instalacao_falhou": {
      const onde = p.etapa ? ETAPAS[indiceDaEtapa(p)] : "Instalando o computador";
      return `<div class="ssh-aviso" role="alert"><p><b>A instalação parou em ${esc(onde ?? "")}.</b> Tentar de novo continua de onde parou.</p></div>
        ${ultimasLinhas(p)}${manual(i)}<div class="cl-dialogo-acoes">${fechar}${tentar}</div>`;
    }
    case "nao_pareou":
    case "tempo_esgotado":
      return `<div class="ssh-aviso" role="alert"><p><b>${p.motivo === "nao_pareou" ? `${esc(nome)} não conectou ao Nod a tempo.` : "A instalação não começou a tempo."}</b> ${p.motivo === "nao_pareou" ? "Pode ser que a instalação tenha parado no meio, ou que a máquina de onde o nod entrou tenha reiniciado." : "A máquina de onde o nod entra não respondeu."}</p></div>
        ${ultimasLinhas(p)}${manual(i)}<div class="cl-dialogo-acoes">${fechar}${tentar}</div>`;
    default:
      return `<div class="ssh-aviso" role="alert"><p><b>A instalação parou.</b></p></div>${ultimasLinhas(p)}${manual(i)}<div class="cl-dialogo-acoes">${fechar}${tentar}</div>`;
  }
}

function progresso(estado: Pick<Estado, "agora">, i: InstalarSsh, p: InstalacaoSshDto): string {
  const nome = alvo(p, i);
  const titulo = p.estado === "pronta" ? `O computador está ligado em ${nome}` : `Ligando o computador em ${nome}`;
  let corpo: string;
  if (p.estado === "pronta") {
    corpo = `<p class="ssh-nota" role="status">Pronto. ${esc(nome)} aparece em Máquinas como só computador e passa a hospedar o computador dos seus bots.</p>
      <div class="cl-dialogo-acoes">${botao("ssh-fechar", "Fechar", { classe: "pri" })}</div>`;
  } else if (i.pedeSudo) {
    const s = campoErro(i, "sudo");
    const usuario = p.usuario || "o usuário";
    corpo = `<form data-form="ssh-sudo" novalidate><label class="ssh-campo"><span>Senha do sudo de ${esc(usuario)}</span><span class="ssh-sudo"><input type="${i.mostrarSudo ? "text" : "password"}" data-ssh-segredo="sudo" data-manter-foco="ssh-sudo" data-cl-autofoco autocomplete="off"${s.attrs}>${botao("ssh-sudo-mostrar", i.mostrarSudo ? "Ocultar" : "Mostrar", { classe: "sm" })}</span></label>${s.texto}
      <p class="ssh-nota">${esc(usuario)} pede senha para instalar. Ela vai cifrada para ${esc(nomeDaOrigem(i, p.origemId))} e não fica guardada.</p>
      <div class="cl-dialogo-acoes">${botao("ssh-cancelar", "Cancelar")}<button type="submit" class="bt pri"${i.enviando ? " disabled" : ""}>Continuar</button></div></form>`;
  } else if (p.estado === "erro") {
    corpo = erroDoPedido(i, p);
  } else {
    const parado = estado.agora - p.atualizadoEm;
    const espera = p.estado === "pareando" && parado > ESPERA_LONGA_MS
      ? `<p class="ssh-espera">Ainda esperando ${esc(nome)} conectar ao Nod · ${esc(haMin(parado))} · ${botao("ssh-tentar", "Tentar de novo", { classe: "link" })}</p>${manual(i)}`
      : `<p class="ssh-nota">Leva uns 5 minutos. Pode fechar: o progresso fica em Máquinas.</p>`;
    corpo = `${espera}${i.erro ? `<p class="ssh-aviso" role="alert">${esc(i.erro)}</p>` : ""}
      <div class="cl-dialogo-acoes">${botao("ssh-cancelar", "Cancelar instalação", { classe: "link" })}<button type="button" class="bt pri" data-act="ssh-segundo-plano" data-cl-autofoco>Continuar em segundo plano</button></div>`;
  }
  return `<h3 id="ssh-tit">${esc(titulo)}</h3>${etapas(p)}${corpo}`;
}

/** O diálogo (ou, em segundo plano, nada: a linha fica em Máquinas). */
export function renderInstalarSsh(estado: Pick<Estado, "agora" | "instalarSsh">): string {
  const i = estado.instalarSsh;
  if (!i || i.segundoPlano) return "";
  const corpo = i.fase === "progresso" && i.pedido ? progresso(estado, i, i.pedido) : formulario(i);
  return `<div class="cl-fundo" data-act="ssh-esc"></div><div class="cl-dialogo ssh-dialogo${i.fase === "progresso" ? " ssh-progresso" : ""}" role="dialog" aria-modal="true" aria-labelledby="ssh-tit">${corpo}</div>`;
}

/** Em segundo plano: uma linha compacta em Máquinas, com "Ver". */
export function linhaEmSegundoPlano(estado: Pick<Estado, "instalarSsh">): string {
  const i = estado.instalarSsh;
  const p = i?.pedido;
  if (!i || !i.segundoPlano || !p) return "";
  const nome = alvo(p, i);
  const txt = p.estado === "pronta" ? `O computador está ligado em ${nome}`
    : p.estado === "erro" ? `A instalação em ${nome} parou`
      : `Ligando o computador em ${nome} · ${ETAPAS[indiceDaEtapa(p)]}`;
  return `<div class="ssh-fundo${p.estado === "erro" ? " erro" : ""}" role="status"><span>${esc(txt)}</span>${p.estado === "pronta" ? botao("ssh-fechar", "Ok", { classe: "sm" }) : botao("ssh-reabrir", "Ver", { classe: "sm" })}</div>`;
}
