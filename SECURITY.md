# Segurança

## Como relatar uma falha

**Não abra issue pública.** Use um destes caminhos:

1. O [relato privado de vulnerabilidade do GitHub](https://github.com/marlonwlv/nod-oss/security/advisories/new) (aba *Security* do repositório), ou
2. um e-mail para **seguranca@nodbot.ai**.

Conte o que encontrou, como reproduzir, o impacto que você vê e a versão ou o commit. Se tiver uma prova de conceito, mande junto. Não acesse, altere nem apague dados de outras pessoas para provar a falha.

## O que acontece depois

- Confirmamos o recebimento em até **3 dias úteis**.
- Damos um primeiro diagnóstico em até **10 dias úteis**.
- Combinamos com você a data da divulgação. O padrão é publicar depois que a correção estiver disponível, em até 90 dias.
- Damos crédito a você no aviso, se quiser.

## Escopo

Vale para o código deste repositório: o servidor, a web, o app desktop e o motor dos computadores dos bots. Interessa principalmente:

- vazamento entre pessoas ou entre organizações (a RLS por pessoa ser contornada);
- credenciais de conectores ou da IA saindo do cofre ou chegando ao modelo;
- uma ação com efeito externo rodando sem a aprovação que deveria pedir;
- execução de comando fora do que o turno permite.

Fica fora: o login `stub` de desenvolvimento (ele não tem prova nenhuma por definição e só escuta em `127.0.0.1`), ataques que dependem de acesso físico à máquina ou de uma conta de IA já comprometida, e falhas em dependências que já têm aviso público (abra um PR atualizando a dependência).

## Versões com correção

Corrigimos a versão mais recente da `main` e a última versão publicada do app.
