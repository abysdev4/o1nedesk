; ============================================================
;  OneDesk Agent - Instalador (Inno Setup 6+)
;  Compile com: iscc onedesk.iss
;  Ajuste MyHubWs / MyEnrollToken antes de distribuir.
; ============================================================

#define MyAppName "OneDesk Agent"
#define MyAppVersion "1.0.0"
#define MyCompany "OneData"
#define MyExeName "OneDeskAgent.exe"
; >>> ALTERE para o endereco do seu servidor em producao <<<
#define MyHubWs "ws://localhost:4000"
#define MyEnrollToken "177d4735c4e5fe67afeb5922752a878e"

[Setup]
AppId={{8E2C1A90-9C2F-4D6E-9A11-ONEDESK000001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyCompany}
DefaultDirName={autopf}\OneDesk
DefaultGroupName=OneDesk
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=OneDeskAgentSetup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
SetupIconFile=..\icon.ico

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
; O executavel publicado deve existir antes de compilar (rode build-agent.ps1)
Source: "..\agent\publish\OneDeskAgent.exe"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{commonappdata}\OneDesk"; Permissions: users-modify

[Run]
; Inicia o agente ao finalizar a instalacao
Filename: "{app}\{#MyExeName}"; Description: "Iniciar OneDesk Agent"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/c taskkill /im {#MyExeName} /f"; Flags: runhidden; RunOnceId: "KillAgent"
Filename: "{cmd}"; Parameters: "/c schtasks /delete /tn OneDeskAgent /f"; Flags: runhidden; RunOnceId: "DelTask"

[Registry]
; Auto-start: chave Run para todos os usuarios
Root: HKLM; Subkey: "SOFTWARE\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "OneDeskAgent"; ValueData: """{app}\{#MyExeName}"""; Flags: uninsdeletevalue

[Code]
var
  ConsentPage: TOutputMsgMemoWizardPage;
  ResultCode: Integer;

procedure InitializeWizard;
begin
  ConsentPage := CreateOutputMsgMemoPage(wpWelcome,
    'Termo de consentimento', 'Acesso remoto para suporte',
    'Leia e aceite para continuar:',
    'Ao instalar o OneDesk Agent, este computador ficara disponivel para suporte remoto pela equipe autorizada da sua empresa.' + #13#10 + #13#10 +
    'A equipe podera: visualizar estatisticas do sistema, abrir um terminal de comandos, durante uma sessao visualizar e controlar a area de trabalho, consultar a localizacao aproximada do dispositivo, bloquear o dispositivo remotamente (anti-furto) e ser notificada caso o agente seja encerrado.' + #13#10 + #13#10 +
    'Um icone na bandeja do sistema indicara que o agente esta ativo. Todas as acoes ficam registradas em auditoria. O agente inicia automaticamente com o Windows e e reiniciado automaticamente se for encerrado.' + #13#10 + #13#10 +
    'Prosseguir com a instalacao significa que voce concorda com estes termos.');
end;

// Grava o config.json apos a instalacao dos arquivos
procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigPath: string;
  Json: string;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigPath := ExpandConstant('{commonappdata}\OneDesk\config.json');
    Json := '{' + #13#10 +
            '  "HubWs": "{#MyHubWs}",' + #13#10 +
            '  "EnrollToken": "{#MyEnrollToken}"' + #13#10 +
            '}';
    SaveStringToFile(ConfigPath, Json, False);

    // Tarefa agendada no logon (robustez)
    Exec(ExpandConstant('{cmd}'),
      '/c schtasks /create /tn OneDeskAgent /tr "\"' + ExpandConstant('{app}\{#MyExeName}') + '\"" /sc onlogon /rl limited /f',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
