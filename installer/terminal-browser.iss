#define MyAppName "terminal-browser"
#ifndef MyAppVersion
#define MyAppVersion "0.1.0"
#endif
#define MyAppPublisher "Zenbu Labs, Inc."
#define MyAppURL "https://github.com/zenbu-labs/terminal-browser"
#define MyAppExeName "electron\electron.exe"

[Setup]
AppId={{A246C19C-B579-4EFA-9101-1AB8E4314527}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL=https://github.com/fukuyori/terminal-browser/issues
AppUpdatesURL=https://github.com/fukuyori/terminal-browser/releases
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Windows installer
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
LicenseFile=..\LICENSE
UninstallDisplayIcon={app}\{#MyAppExeName}
OutputDir=..\dist-release
OutputBaseFilename=terminal-browser-{#MyAppVersion}-windows-x64
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
ChangesEnvironment=yes
RestartApplications=no
#ifdef SignTool
SignTool={#SignTool}
SignedUninstaller=yes
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"

[CustomMessages]
english.AddToPath=Add terminal-browser to the user PATH
japanese.AddToPath=terminal-browser をユーザー PATH に追加する
english.CreateWezTermShortcut=Create a Start menu shortcut for WezTerm
japanese.CreateWezTermShortcut=WezTerm 用のスタートメニューショートカットを作成する
english.AdditionalTasks=Additional tasks:
japanese.AdditionalTasks=追加タスク:
english.UninstallShortcut=Uninstall terminal-browser
japanese.UninstallShortcut=terminal-browser をアンインストール

[Tasks]
Name: "addtopath"; Description: "{cm:AddToPath}"; GroupDescription: "{cm:AdditionalTasks}"; Flags: checkedonce
Name: "startmenu"; Description: "{cm:CreateWezTermShortcut}"; GroupDescription: "{cm:AdditionalTasks}"; Flags: checkedonce; Check: HasWezTerm

[Files]
Source: "..\dist-release\terminal-browser\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\terminal-browser (WezTerm)"; Filename: "{code:GetWezTermPath}"; Parameters: "start --always-new-process --cwd ""{%USERPROFILE}"" -- cmd.exe /d /c """"{app}\bin\terminal-browser.cmd"""""; WorkingDir: "{%USERPROFILE}"; Tasks: startmenu; Check: HasWezTerm
Name: "{group}\{cm:UninstallShortcut}"; Filename: "{uninstallexe}"; Tasks: startmenu; Check: HasWezTerm

[Code]
const
  UserEnvironmentKey = 'Environment';

function GetWezTermPath(Param: String): String;
begin
  if RegQueryStringValue(HKCU,
       'Software\Microsoft\Windows\CurrentVersion\App Paths\wezterm.exe', '', Result) and
     FileExists(Result) then
    Exit;
  if RegQueryStringValue(HKLM,
       'Software\Microsoft\Windows\CurrentVersion\App Paths\wezterm.exe', '', Result) and
     FileExists(Result) then
    Exit;

  Result := ExpandConstant('{pf}\WezTerm\wezterm.exe');
  if FileExists(Result) then
    Exit;

  Result := ExpandConstant('{localappdata}\Programs\WezTerm\wezterm.exe');
  if FileExists(Result) then
    Exit;

  Result := '';
end;

function HasWezTerm: Boolean;
begin
  Result := GetWezTermPath('') <> '';
end;

function UserPathContains(Entry: String): Boolean;
var
  ExistingPath: String;
begin
  if not RegQueryStringValue(HKCU, UserEnvironmentKey, 'Path', ExistingPath) then
    ExistingPath := '';
  Result := Pos(';' + Lowercase(Entry) + ';',
    ';' + Lowercase(ExistingPath) + ';') > 0;
end;

procedure AddToUserPath(Entry: String);
var
  ExistingPath: String;
begin
  if UserPathContains(Entry) then
    Exit;
  if not RegQueryStringValue(HKCU, UserEnvironmentKey, 'Path', ExistingPath) then
    ExistingPath := '';
  if (ExistingPath <> '') and (ExistingPath[Length(ExistingPath)] <> ';') then
    ExistingPath := ExistingPath + ';';
  RegWriteExpandStringValue(HKCU, UserEnvironmentKey, 'Path', ExistingPath + Entry);
end;

procedure RemoveFromUserPath(Entry: String);
var
  ExistingPath: String;
  PaddedPath: String;
  MatchAt: Integer;
begin
  if not RegQueryStringValue(HKCU, UserEnvironmentKey, 'Path', ExistingPath) then
    Exit;

  PaddedPath := ';' + ExistingPath + ';';
  MatchAt := Pos(';' + Lowercase(Entry) + ';', Lowercase(PaddedPath));
  while MatchAt > 0 do
  begin
    Delete(PaddedPath, MatchAt, Length(Entry) + 1);
    MatchAt := Pos(';' + Lowercase(Entry) + ';', Lowercase(PaddedPath));
  end;

  while Pos(';;', PaddedPath) > 0 do
    StringChangeEx(PaddedPath, ';;', ';', True);
  if (Length(PaddedPath) > 0) and (PaddedPath[1] = ';') then
    Delete(PaddedPath, 1, 1);
  if (Length(PaddedPath) > 0) and (PaddedPath[Length(PaddedPath)] = ';') then
    Delete(PaddedPath, Length(PaddedPath), 1);

  if PaddedPath <> ExistingPath then
    RegWriteExpandStringValue(HKCU, UserEnvironmentKey, 'Path', PaddedPath);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('addtopath') then
    AddToUserPath(ExpandConstant('{app}\bin'));
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    RemoveFromUserPath(ExpandConstant('{app}\bin'));
end;
