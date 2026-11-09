// ADA-229: a tela de conexão do Windows. Só textContent (nada de HTML vindo do processo principal).
const telas = ["conectar", "aguardando", "instalando", "erro", "abrindo"];
const $ = (id) => document.getElementById(id);
function mostrar(t) {
  if (!t || typeof t.tela !== "string" || !telas.includes(t.tela)) return;
  for (const nome of telas) $(nome).hidden = nome !== t.tela;
  if (t.tela === "conectar") { $("aviso").hidden = !t.aviso; $("aviso").textContent = t.aviso || ""; $("bt-conectar").disabled = false; }
  if (t.tela === "aguardando") $("codigo").textContent = String(t.codigo || "");
  if (t.tela === "instalando") $("linhas").replaceChildren(...(Array.isArray(t.linhas) ? t.linhas : []).map((l) => { const li = document.createElement("li"); li.textContent = String(l); return li; }));
  if (t.tela === "erro") { $("mensagem").textContent = String(t.mensagem || ""); $("bt-tentar").hidden = !t.podeTentar; }
}
$("bt-conectar").addEventListener("click", () => { $("bt-conectar").disabled = true; void window.nodWin.conectar(); });
$("bt-link").addEventListener("click", () => void window.nodWin.abrirLink());
$("bt-tentar").addEventListener("click", () => { mostrar({ tela: "abrindo" }); void window.nodWin.tentar(); });
$("bt-baixar").addEventListener("click", () => void window.nodWin.baixar());
window.nodWin.aoMudar(mostrar);
window.nodWin.aoMudarAtualizacao((linha) => { $("atualizacao").hidden = !linha; $("atualizacao").textContent = linha; });
void window.nodWin.estado().then(mostrar);
