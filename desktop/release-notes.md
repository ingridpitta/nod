# nod 1.0.0-rc.7

Sétima candidata da 1.0.0, só com uma correção crítica: **o turno não para mais com "o histórico enche de novo logo depois de resumido"** no Opus de 1M. Macs: DMGs assinados (Developer ID) e notarizados; quem está numa rc anterior recebe pelo atualizador automático quando a versão for anunciada, ou instala o DMG por cima. Windows: instalador `.exe` de 1 clique, por usuário, ainda sem assinatura (o SmartScreen pede "Mais informações > Executar assim mesmo", NOD-471). Downloads e versões anteriores: [releases](https://github.com/marlonwlv/nod/releases).

## O que entra nesta versão (desde a rc.6, 8/11)

- **Turno não para mais por "Autocompact is thrashing"** (#712, emenda na ADR-040): o motor passava `--autocompact 200000` fixo ao Claude Code. No Opus de 1M, com ~130 mil tokens de parte fixa por chamada, o CLI compactava a cada 1 ou 2 chamadas e parava o turno. Agora usa `--autocompact auto`, a janela real do modelo; nos modelos de 200k nada muda.
- Nada mais entra: a main desde a rc.6 tem só este commit.

## Registro da versão

```text
Versão / tag / SHA: 1.0.0-rc.7 / v1.0.0-rc.7 / <SHA> (último PR no commit: <PR>)
PR e execução do Actions: desktop-release run <RUN> (verify, vm-local arm64 e amd64, windows, mac arm64 e x64, draft)
Servidor e migrações compatíveis: https://app.nodbot.ai, mesma tag
DMGs, ZIPs, .exe e hashes: ver SHA256-arm64.txt, SHA256-x64.txt e SHA256-win-x64.txt anexos
Disco da VM local (Mac): nod-vm-1.0.0-rc.7-arm64.img.zst e -amd64.img.zst, com .sha256, anexos e em gs://nodbot-downloads/v1.0.0-rc.7/
Windows: nod-windows-x64.exe (nome estável, /download/windows e o botão do site) e nod-1.0.0-rc.7-win-x64.exe (feed da atualização) em gs://nodbot-downloads
Atualização automática (ZIPs e .exe no bucket, NOD_APP_VERSAO_PUBLICADA e NOD_APP_ATUALIZACAO_SHA256, deploy): pendente
Assinatura e notarização: Mac ok nas duas arquiteturas (Developer ID, notarizado e grampeado); Windows sem assinatura (NOD-471)
Aceite Intel (pessoa, Mac, macOS, resultado): pendente
Aceite ARM (pessoa, Mac, macOS, resultado): pendente
Aceite Windows (pessoa, versão do Windows, resultado): pendente (instalar, onboarding e remover pelo desinstalador)
Atualização desde a versão anterior: pendente (origem 1.0.0-rc.6)
Custo dos turnos do aceite: pendente
Limitações e recuperação: candidata (pre-release). Windows: SmartScreen na primeira execução; a ligação de voz do onboarding não roda na janela do app (microfone negado): use "Configurar sem voz"; se o navegador não abrir ao clicar em Entrar, rode o comando no PowerShell (o cartão mostra qual). Mac: primeira abertura baixa o disco da VM (~750 MB).
O que falhou e o que melhorar na próxima versão: o desinstalador da rc.5 deixava o motor e as IAs para trás no Windows (corrigido). Falta: ligar NOD_ONBOARDING_TEXTO depois do aceite das jornadas A, B e D, login dentro do app com link e código na tela (como o Mac faz desde 10/10), entrar numa conta existente de dentro do provisório na janela do Windows, assinatura do .exe (NOD-471).
```

Aceite Intel/ARM/Windows: pendente.
