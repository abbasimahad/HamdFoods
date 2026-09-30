#ifndef AppVersion
  #error AppVersion must be supplied by scripts/installer.ts
#endif
#ifndef PayloadRoot
  #error PayloadRoot must be supplied by scripts/installer.ts
#endif
#ifndef BuildId
  #define BuildId "local"
#endif

#define Publisher "Hamd Foods"
#ifdef DrillBuild
  #define ProductName "Hamd Foods ERP Installer Drill"
  #define ShortcutName "Hamd Foods ERP Installer Drill"
  #define ShortcutGroup "Hamd Foods ERP Installer Drill"
  #define ProductId "{{EEEA3D20-202A-4B36-8145-41EC53AECA63}"
  #define InstallFolder "HamdFoodsERP-InstallDrill"
  #define DataFolder "HamdFoodsERP-InstallDrill"
  #define AppTask "HamdFoodsERP-InstallDrill"
  #define BackupTask "HamdFoodsERP-InstallDrill-Backup"
  #define AppPort "3200"
  #define DatabaseName "hamd_foods_erp_installer_drill"
  #define RoleName "hamd_erp_installer_drill"
  #define OutputName "HamdFoodsERP-" + AppVersion + "-" + BuildId + "-InstallDrill-DEVELOPMENT-UNSIGNED"
  #define DrillSwitch " -Drill"
#else
  #define ProductName "Hamd Foods ERP"
  #define ShortcutName "Hamd Foods ERP"
  #define ShortcutGroup "Hamd Foods ERP"
  #define ProductId "{{B751DA7E-CAEF-4619-981F-BD49A7CDE978}"
  #define InstallFolder "HamdFoodsERP"
  #define DataFolder "HamdFoodsERP"
  #define AppTask "HamdFoodsERP"
  #define BackupTask "HamdFoodsERP-Backup"
  #ifndef AppPort
    #define AppPort "3100"
  #endif
  #define DatabaseName "hamd_foods_erp"
  #define RoleName "hamd_erp"
  #ifdef InstallerSignTool
    #define OutputName "HamdFoodsERP-" + AppVersion + "-" + BuildId + "-Setup"
  #else
    #define OutputName "HamdFoodsERP-" + AppVersion + "-" + BuildId + "-Setup-DEVELOPMENT-UNSIGNED"
  #endif
  #define DrillSwitch ""
#endif

[Setup]
AppId={#ProductId}
AppName={#ProductName}
AppVersion={#AppVersion}
AppVerName={#ProductName} {#AppVersion} (build {#BuildId})
AppPublisher={#Publisher}
AppPublisherURL=https://github.com/abbasimahad/HamdFoods
DefaultDirName={autopf}\{#InstallFolder}
DisableDirPage=yes
DefaultGroupName={#ShortcutGroup}
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
MinVersion=10.0.17763
OutputDir=output
OutputBaseFilename={#OutputName}
Compression=lzma2/ultra64
SolidCompression=yes
SetupLogging=yes
UninstallDisplayName={#ProductName}
Uninstallable=yes
CloseApplications=no
RestartApplications=no
WizardStyle=modern
#ifdef InstallerSignTool
SignTool={#InstallerSignTool}
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
Name: "dailybackup"; Description: "Run a daily backup at 02:00"; GroupDescription: "Backup automation:"; Flags: checkedonce

[InstallDelete]
; INST-8: installing over an existing build replaces the runtime completely, so no stale files from
; the previous build are left in the application folders. The runtime was already stopped in
; PrepareToInstall; business data lives under ProgramData and in PostgreSQL and is never touched.
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\operations"

[Files]
Source: "{#PayloadRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#ShortcutName}"; Filename: "http://127.0.0.1:{#AppPort}"
Name: "{group}\Account Recovery"; Filename: "{sysnative}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\Account-Recovery-HamdFoodsERP.ps1"" -AppRoot ""{app}"" -DataRoot ""{commonappdata}\{#DataFolder}""{#DrillSwitch}"; WorkingDir: "{app}"
Name: "{group}\Restore Backup"; Filename: "{sysnative}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\Restore-HamdFoodsERP.ps1"" -AppRoot ""{app}"" -DataRoot ""{commonappdata}\{#DataFolder}""{#DrillSwitch}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#ShortcutName}"; Filename: "http://127.0.0.1:{#AppPort}"; Tasks: desktopicon

[UninstallRun]
Filename: "{sysnative}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\windows\Setup-HamdFoodsERP.ps1"" -Mode UninstallTasks -AppRoot ""{app}"" -DataRoot ""{commonappdata}\{#DataFolder}"" -TaskName ""{#AppTask}"" -BackupTaskName ""{#BackupTask}"" -Port {#AppPort} -DatabaseName ""{#DatabaseName}"" -RoleName ""{#RoleName}""{#DrillSwitch}"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveHamdFoodsTasks"

[Code]
var
  BusinessDataRemoved: Boolean;

function HasDailyBackupTask(): Boolean;
begin
  Result := WizardIsTaskSelected('dailybackup');
end;

function SetupParameters(): String;
var
  ModeName: String;
  BackupSwitch: String;
begin
  if FileExists(ExpandConstant('{commonappdata}\{#DataFolder}\config\.env.production')) then
    ModeName := 'Repair'
  else
    ModeName := 'Install';
  if HasDailyBackupTask() then
    BackupSwitch := ' -InstallBackupTask'
  else
    BackupSwitch := '';
  Result := '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\windows\Setup-HamdFoodsERP.ps1') + '" -Mode ' + ModeName +
    ' -AppRoot "' + ExpandConstant('{app}') + '"' +
    ' -DataRoot "' + ExpandConstant('{commonappdata}\{#DataFolder}') + '"' +
    ' -TaskName "{#AppTask}" -BackupTaskName "{#BackupTask}"' +
    ' -Port {#AppPort} -DatabaseName "{#DatabaseName}" -RoleName "{#RoleName}"' +
    '{#DrillSwitch}' + BackupSwitch;
end;

function StopRuntimeParameters(): String;
begin
  Result := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\windows\Setup-HamdFoodsERP.ps1') + '" -Mode StopRuntime' +
    ' -AppRoot "' + ExpandConstant('{app}') + '"' +
    ' -DataRoot "' + ExpandConstant('{commonappdata}\{#DataFolder}') + '"' +
    ' -TaskName "{#AppTask}" -BackupTaskName "{#BackupTask}"' +
    ' -Port {#AppPort} -DatabaseName "{#DatabaseName}" -RoleName "{#RoleName}"' +
    '{#DrillSwitch}';
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  InstalledSetup: String;
begin
  Result := '';
  if FileExists(ExpandConstant('{commonappdata}\{#DataFolder}\config\.env.production')) then begin
    InstalledSetup := ExpandConstant('{app}\windows\Setup-HamdFoodsERP.ps1');
    { Data kept under ProgramData but the program was uninstalled: uninstall already removed the
      scheduled tasks and stopped the runtime, so there is nothing to stop. Continue; the
      post-install step then repairs onto the preserved configuration and database. }
    if not FileExists(InstalledSetup) then
      Log('Preserved data found without an installed program; reinstalling over preserved data.')
    else if not Exec(
      ExpandConstant('{sysnative}\WindowsPowerShell\v1.0\powershell.exe'),
      StopRuntimeParameters(),
      ExpandConstant('{app}'),
      SW_HIDE,
      ewWaitUntilTerminated,
      ResultCode
    ) then
      Result := 'Could not launch the protected repair runtime stop.'
    else if ResultCode <> 0 then
      Result := 'Setup could not stop the running Hamd Foods ERP before updating it, so nothing was changed and your data is untouched. Close the ERP in every browser, wait a minute and run Setup again. Details: ' +
        ExpandConstant('{commonappdata}\{#DataFolder}\logs\installer\runtime-stop.log');
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  SetupLogDirectory: String;
begin
  if CurStep = ssPostInstall then begin
    if not Exec(
      ExpandConstant('{sysnative}\WindowsPowerShell\v1.0\powershell.exe'),
      SetupParameters(),
      ExpandConstant('{app}'),
      SW_SHOW,
      ewWaitUntilTerminated,
      ResultCode
    ) then
      RaiseException('Could not launch the protected Hamd Foods ERP setup step.');
    if ResultCode <> 0 then
      RaiseException('Hamd Foods ERP setup failed. Review ' + ExpandConstant('{commonappdata}\{#DataFolder}\logs\installer\provisioning.log') + ' for the sanitized failing stage.');
  end else if CurStep = ssDone then begin
    SetupLogDirectory := ExpandConstant('{commonappdata}\{#DataFolder}\logs\installer');
    if DirExists(SetupLogDirectory) then
      CopyFile(ExpandConstant('{log}'), SetupLogDirectory + '\latest-setup.log', False);
  end;
end;

function InitializeSetup(): Boolean;
begin
  Result := not (Pos('\\', ExpandConstant('{src}')) = 1);
  if not Result then
    MsgBox('For security, copy this installer to a local drive before running it.', mbError, MB_OK);
end;

function RemoveDataParameters(): String;
begin
  Result := '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\windows\Setup-HamdFoodsERP.ps1') + '" -Mode RemoveData' +
    ' -AppRoot "' + ExpandConstant('{app}') + '"' +
    ' -DataRoot "' + ExpandConstant('{commonappdata}\{#DataFolder}') + '"' +
    ' -TaskName "{#AppTask}" -BackupTaskName "{#BackupTask}"' +
    ' -Port {#AppPort} -DatabaseName "{#DatabaseName}" -RoleName "{#RoleName}"' +
    '{#DrillSwitch}';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  { INST-4: keeping data stays the default (and the only behaviour for silent uninstalls). }
  if (CurUninstallStep = usUninstall) and (not UninstallSilent()) and
    FileExists(ExpandConstant('{commonappdata}\{#DataFolder}\config\.env.production')) then begin
    if MsgBox('Keep the ERP database and business data?' + #13#10#13#10 +
        'Yes (recommended): keep everything. Installing Hamd Foods ERP again later continues with the same data and logins.' + #13#10#13#10 +
        'No: permanently remove the ERP database, its login role and configuration. A final backup is taken first and kept in ' +
        ExpandConstant('{commonappdata}\{#DataFolder}\backups') + '. You will be asked for the PostgreSQL administrator password.',
        mbConfirmation, MB_YESNO or MB_DEFBUTTON1) = IDNO then begin
      if Exec(ExpandConstant('{sysnative}\WindowsPowerShell\v1.0\powershell.exe'), RemoveDataParameters(),
          ExpandConstant('{app}'), SW_SHOW, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0) then
        BusinessDataRemoved := True
      else
        MsgBox('The database could not be removed, so it was kept. Nothing was lost; see ' +
          ExpandConstant('{commonappdata}\{#DataFolder}\logs') + '.', mbError, MB_OK);
    end;
  end;
  if CurUninstallStep = usPostUninstall then begin
    if BusinessDataRemoved then
      MsgBox('The ERP database and configuration were removed. The final backup and earlier backups remain under ProgramData.', mbInformation, MB_OK)
    else
      MsgBox('Business data and backups were preserved under ProgramData. The PostgreSQL database and application role were also preserved.', mbInformation, MB_OK);
  end;
end;
