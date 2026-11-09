const url = document.querySelector('#url');
const chave = document.querySelector('#chave');
const estado = document.querySelector('#estado');
const parear = document.querySelector('#parear');
const conectar = document.querySelector('#conectar');
const avancado = document.querySelector('#avancado');
const botoes = [parear, conectar];
const ocupar = (sim) => { for (const b of botoes) b.disabled = sim; };
// NOD-132: a linha da atualização do app e o botão de reiniciar quando a versão nova está pronta.
const atualizacao = document.querySelector('#atualizacao');
const reiniciar = document.querySelector('#reiniciar');
const mostrarAtualizacao = (linha, pronta) => { atualizacao.textContent = linha; atualizacao.hidden = !linha; reiniciar.hidden = !pronta; };
window.nod.estado().then((s) => { url.value = s.url; estado.textContent = s.mensagem; if (!s.url) avancado.open = true; mostrarAtualizacao(s.atualizacao || '', !!s.prontaParaReiniciar); });
window.nod.aoMudarAtualizacao((linha) => { window.nod.estado().then((s) => mostrarAtualizacao(linha, !!s.prontaParaReiniciar)); });
reiniciar.addEventListener('click', async () => { reiniciar.disabled = true; try { await window.nod.reiniciarParaAtualizar(); } finally { reiniciar.disabled = false; } });
document.querySelector('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!url.reportValidity()) { avancado.open = true; return; }
  ocupar(true);
  estado.textContent = 'Abrimos o navegador. Entre com Google e clique em Conectar este Mac.';
  try { const r = await window.nod.parear(url.value); estado.textContent = r.mensagem; }
  catch { estado.textContent = 'Não foi possível conectar. Confira o endereço e tente novamente.'; }
  finally { ocupar(false); }
});
document.querySelector('#login').addEventListener('click', async () => {
  const r = await window.nod.abrirLogin(url.value);
  estado.textContent = r.mensagem;
});
conectar.addEventListener('click', async () => {
  if (!url.reportValidity() || !chave.value.trim()) { estado.textContent = 'Informe o endereço e cole a chave.'; return; }
  ocupar(true);
  estado.textContent = 'Conectando e encontrando sua conta de IA…';
  try { const r = await window.nod.conectar({ url: url.value, chave: chave.value.trim() }); estado.textContent = r.mensagem; }
  catch { estado.textContent = 'Não foi possível conectar. Confira o endereço e tente novamente.'; }
  finally { chave.value = ''; ocupar(false); }
});
