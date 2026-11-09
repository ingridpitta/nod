// definido em 2026-10-22 (NOD-96 PR 2, ADR-122 §4): o bwrap de cada tela. Sem container na VM-alvo, cada processo da
// tela (Xvfb, openbox, Chromium) roda num bwrap que vê o sistema só em leitura, o PRÓPRIO perfil, `logins/` em leitura e
// o workspace; perfis dos outros bots, keyring e chaves do supervisor somem atrás de um tmpfs, e o run de todos os
// computadores (tmp das outras telas, com tela.png e a `entrada` do digitar, e os sockets de dbus/keyring) também. Com userns, o Chromium
// usa o próprio sandbox dentro dele. Puro: monta argumentos e o script; quem executa é a tela.

/** Aspas de shell POSIX. */
export function aspas(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** O resolv.conf que aponta para o stub do systemd-resolved (127.0.0.53), que roda fora do cgroup e alcança o upstream. */
export const RESOLV_DO_STUB = '/run/systemd/resolve/stub-resolv.conf';

/**
 * Argumentos do bwrap. `raiz`: a pasta de todos os computadores e `run`: a raiz do run de todos eles (as duas somem
 * atrás de tmpfs); depois voltam só os caminhos desta tela: `perfil` e `workspace` (escrita), `logins` (leitura), `tmp`
 * (o TMPDIR da tela, onde o Playwright põe os downloads) e `x11` (os sockets do Xvfb). `bus`: a pasta do socket do dbus
 * deste computador (keyring). `resolv`: o resolv.conf do stub, montado em `resolvEm` (o destino real do
 * /etc/resolv.conf: o bwrap não monta por cima de um symlink, e no Debian com resolved ele aponta para
 * /run/systemd/resolve/resolv.conf) — o DNS da nuvem costuma ser link-local (169.254.169.254 no GCE, o mesmo IP da
 * metadata), que a unit bloqueia. `ocultar`: outras pastas que
 * somem atrás de tmpfs (a dos sockets de controle e do terminal: a tela não fala com eles).
 */
export function argsDoBwrap({ raiz, run, ocultar = [], perfil, workspace, logins, tmp, x11, x11Display, bus, resolv, resolvEm = '/etc/resolv.conf', semUsuario = false, tamanhoDoTmp = null, tmpSoLeitura = false, esconder = [] }) {
  // PR #600 (revisão 6): `tamanhoDoTmp` (bytes) dá teto ao /tmp (bwrap ≥ 0.8, o do Debian 12).
  // Revisão 10: `tmpSoLeitura` monta o `tmp` sem escrita (o do dock: um arquivo grande nele enchia o /run de todos).
  const tmpDaTela = tamanhoDoTmp ? ['--size', String(tamanhoDoTmp), '--tmpfs', '/tmp'] : ['--tmpfs', '/tmp'];
  const a = [
    '--die-with-parent', '--new-session', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup-try',
    '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', ...tmpDaTela,
  ];
  // PR #600: o dock (que roda shell) pede userns e nenhuma capacidade de forma explícita. No bwrap sem setuid isso já é o
  // padrão; não troca o usuário no host (continua nod-pc), só garante que nenhuma flag futura devolva capacidades.
  if (semUsuario) a.splice(1, 0, '--unshare-user', '--cap-drop', 'ALL');
  if (resolv) a.push('--ro-bind', resolv, resolvEm);
  if (raiz) a.push('--tmpfs', raiz);
  if (run) a.push('--tmpfs', run);
  for (const p of ocultar) if (p) a.push('--tmpfs', p);
  for (const [modo, p] of [['--bind', perfil], ['--bind', workspace], ['--ro-bind', logins], [tmpSoLeitura ? '--ro-bind' : '--bind', tmp], ['--bind', bus]]) {
    if (p) a.push(modo, p, p);
  }
  // PR #600: com `x11Display`, só o socket DESTA tela entra (o Xvfb já o criou); a pasta inteira só para o Xvfb, que o
  // cria. Montada com escrita, ela deixava apagar ou trocar o socket do display de outro bot.
  if (x11 && x11Display != null) a.push('--bind', `${x11}/X${x11Display}`, `/tmp/.X11-unix/X${x11Display}`);
  else if (x11) a.push('--bind', x11, '/tmp/.X11-unix');
  // Revisão 15: arquivos que somem atrás do /dev/null (os programas do dock no bwrap do Chrome e do openbox). Só
  // caminhos reais que existem: o bwrap não cria ponto de montagem no / só leitura nem monta por cima de symlink.
  for (const p of esconder) if (p) a.push('--ro-bind', '/dev/null', p);
  return a;
}

/**
 * Script que roda `binario` no bwrap: o Playwright precisa de um executável, e o CDP segue pelo pipe (fds 3 e 4).
 * `pidfile` (revisão 13 do PR #600): grava o PID do bwrap (o `exec` mantém o do shell), para a tela matar um Chrome que
 * não fecha; com `--unshare-pid` e `--die-with-parent`, matar o bwrap derruba tudo o que roda dentro dele.
 */
export function scriptDoBwrap({ bwrap = 'bwrap', args, binario, pidfile = null }) {
  const pid = pidfile ? `echo $$ > ${aspas(pidfile)}\n` : '';
  return `#!/bin/sh\n${pid}exec ${aspas(bwrap)} ${args.map(aspas).join(' ')} -- ${aspas(binario)} "$@"\n`;
}

/**
 * Revisão 21 do PR #600: o que a tela grava ao lado do seu tmp, fora do bwrap do Chrome (a pasta do dock e a captura
 * crua; ver caminhosDoDock e caminhoDaCaptura em tela.mjs). O supervisor apaga junto com o tmp quando o bot é excluído.
 */
export function vizinhosDoTmp(tmp) {
  const base = tmp.replace(/\/+$/, '');
  return [`${base}.dock`, `${base}.tela.png`];
}
