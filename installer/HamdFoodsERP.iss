#ifndef AppVersion
  #error AppVersion must be supplied by scripts/installer.ts
#endif
#ifndef PayloadRoot
  #error PayloadRoot must be supplied by scripts/installer.ts
#endif

#define Publisher "Hamd Foods"
#ifdef DrillBuild
  #define ProductName "Hamd Foods ERP Installer Drill"
  #define ProductId "{{EEEA3D20-202A-4B36-8145-41EC53AECA63}"
  #define InstallFolder "HamdFoodsERP-InstallDrill"
  #define DataFolder "HamdFoodsERP-InstallDrill"
  #define AppTask "HamdFoodsERP-InstallDrill"
  #define BackupTask "HamdFoodsERP-InstallDrill-Backup"
  #define AppPort "3200"
  #define DatabaseName "hamd_foods_erp_installer_drill"
  #define RoleName "hamd_erp_installer_drill"
  #define OutputName "HamdFoodsERP-" + AppVersion + "-InstallDrill-DEVELOPMENT-UNSIGNED"
  #define DrillSwitch " -Drill"
#else
  #define ProductName "Hamd Foods ERP"
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
    #define OutputName "HamdFoodsERP-" + AppVersion + "-Setup"
  #else
    #define OutputName "HamdFoodsERP-" + AppVersion + "-Setup-DEVELOPMENT-UNSIGNED"
  #endif
  #define DrillSwitch ""
#endif

[Setup]
AppId={#ProductId}
AppName={#ProductName}
AppVersion={#AppVersion}
AppPublisher={#Publisher}
AppPublisherURL=https://github.com/abbasimahad/HamdFoods
DefaultDirName={autopf}\{#InstallFolder}
DisableDirPage=yes
DefaultGroupName=Hamd Foods ERP
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

[Files]
Source: "{#PayloadRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Hamd Foods ERP"; Filename: "http://127.0.0.1:{#AppPort}"
Name: "{autodesktop}\Hamd Foods ERP"; Filename: "http://127.0.0.1:{#AppPort}"; Tasks: desktopicon

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\windows\Setup-HamdFoodsERP.ps1"" -Mode UninstallTasks -AppRoot ""{app}"" -DataRoot ""{commonappdata}\{#DataFolder}"" -TaskName ""{#AppTask}"" -BackupTaskName ""{#BackupTask}"" -Port {#AppPort} -DatabaseName ""{#DatabaseName}"" -RoleName ""{#RoleName}""{#DrillSwitch}"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveHamdFoodsTasks"

[Code]
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

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  SetupLogDirectory: String;
begin
  if CurStep = ssPostInstall then begin
    if not Exec(
      ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      SetupParameters(),
      ExpandConstant('{app}'),
      SW_SHOW,
      ewWaitUntilTerminated,
      ResultCode
    ) then
      RaiseException('Could not launch the protected Hamd Foods ERP setup step.');
    if ResultCode <> 0 then
      RaiseException('Hamd Foods ERP setup failed. Review the non-secret installer log and correct the reported prerequisite.');
  end else if CurStep = ssDone then begin
    SetupLogDirectory := ExpandConstant('{commonappdata}\{#DataFolder}\logs\installer');
    if DirExists(SetupLogDirectory) then
      FileCopy(ExpandConstant('{log}'), SetupLogDirectory + '\latest-setup.log', False);
  end;
end;

function InitializeSetup(): Boolean;
begin
  Result := not (Pos('\\', ExpandConstant('{src}')) = 1);
  if not Result then
    MsgBox('For security, copy this installer to a local drive before running it.', mbError, MB_OK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    MsgBox('Business data and backups were preserved under ProgramData. The PostgreSQL database and application role were also preserved.', mbInformation, MB_OK);
end;
