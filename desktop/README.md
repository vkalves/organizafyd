# Zyon Desktop 2.0 — Windows Android automation

This release is a native **Windows desktop application** named **Zyon.exe**, with Tk controls and a background execution controller. It does not open a website or localhost dashboard as its user interface. Chrome is controlled for the Instagram browser and official Meta authorization stages that the reference workflow requires.

## Download and start

Download the **Zyon-Desktop-Windows-2.0** artifact from the successful Windows workflow. Extract the outer download, then extract `Zyon-Desktop-Windows-2.0.zip`. Keep the whole **Zyon** folder together and double-click **Zyon.exe**. The `_internal` folder contains the bundled Python/Tk/automation libraries; Python is not required separately for this executable.

On first launch, missing Android runtime tools trigger the included installer. It installs/configures isolated Node.js 22, Temurin Java 17, Android SDK and Appium/UiAutomator2, and installs Chrome if necessary. Windows can request installation approval. Internet access and several gigabytes of disk space are needed for the toolchain and download cache. WinGet/App Installer is needed if Chrome is missing. The **PROGRAMA** tab can run the installer again. Existing system Node/Java/SDK settings are preserved.

The application is unsigned. No signing certificate was supplied for this build.

## Initial configuration

- **DADOS:** enter the intended @, profile name, actual birthdate (YYYY-MM-DD), Instagram password and verification-email recipient. Select creation for a new native account; clear it to prepare an existing account. Generated usernames are candidates; Instagram must accept them and the resulting native profile must match exactly.
- **PERFIL:** configure bio, the supplied profile image and professional category. Empty values skip optional changes. The reference category is Artista.
- **PUBLICAR:** configure the Story file, link, sticker text and highlight name. Selecting media authorizes this publication when starting the workflow. An empty Story file skips publication. Previously uncertain submissions are never blindly replayed.
- **EMAIL:** select your own Google Desktop OAuth client JSON, enter the exact mailbox and connect once. Enable Gmail API in that Google Cloud project. The Google consent screen must be completed interactively. Configure the exact sender found in your actual Instagram emails; `security@mail.instagram.com` is an editable default. The recipient must match the intended address/alias exactly.
- **ADB:** connect the Android 14 phone, enable USB debugging, unlock it and authorize this computer. Query devices and select the intended serial. Some phone manufacturers require their own Windows USB driver.
- **FLUXO:** enter your AVANÇA login, load your owned active flows/apps, select the existing destination and Meta app, and enter the exact tester-invitation app name shown in Instagram. The tester invitation display name can differ from AVANÇA's app name.
- **CONTAS:** save/load profiles. Passwords and local refresh grants are encrypted with current-Windows-user DPAPI. They are never written to the readable workflow journal or log.

Gmail `gmail.readonly` is a restricted scope. External Google OAuth applications in Testing generally receive seven-day refresh grants for this scope. Configure the intended production audience/status and Google's applicable verification requirements for long-lived unattended renewal. Revoked grants always need renewed consent.

## Automatic execution

Press **INICIAR FLUXO AUTOMÁTICO** once configuration is complete. The desktop controller:

1. Authenticates the configured AVANÇA user and checks approval, selected active flow and app availability.
2. Starts the local Appium service automatically and opens native Instagram on the selected Android.
3. Executes configured account creation/login, retrieves and types fresh Gmail codes, verifies the resulting @, and runs the configured bio/photo/professional/Story/link/highlight steps on recognized screens.
4. Enables or verifies authentication-app 2FA, encrypts newly enrolled authenticator material, rechecks identity/2FA and logs out of this native account.
5. Starts installed Google Chrome in an account-specific automation profile, signs into the same Instagram, retrieves/types email codes and uses the locally enrolled TOTP when requested. No stealth or challenge bypass is implemented.
6. **Pauses before tester-invitation acceptance**, showing the verified @ and intended app. Send the invitation through Meta, then press **CONTINUAR** in the desktop window. A stale or repeated Continue cannot release a different pause.
7. Accepts only the exact configured invitation and checks its accepted state. Runs the official account-bound Meta connection when needed and verifies the returned Instagram through the API.
8. Synchronizes that verified owned account into the selected existing AVANÇA flow. Success requires live identity plus membership readback. Lost write responses are inspected before any subsequent attempt; schedules and campaign settings are not replaced.

For multiple configured accounts, select their saved profiles in **CONTAS** and choose **Executar selecionados em sequência**. Each cycle completes native logout and verified association before the next profile starts. Every account keeps its own invitation pause and Chrome profile.

Normal execution continues between steps. Initial USB/Google permissions, the requested invitation pause, Meta asset selection/consent that cannot be resolved uniquely, and unrecognized/security challenge screens can require interaction. The desktop window explains the reason and resumes from its current in-memory pause after Continue. It does not equate a click or redirect with successful account integration.

## Important validation boundary

The executable is built and checked on Windows. Native GUI, browser automation against intercepted fixtures, the orchestration, Gmail handling, DPAPI and owner-scoped platform adapters have automated checks. **A real Android/Instagram/Meta run has not been certified on your phone.** Android selectors are based on Portuguese/English accessibility labels and known resource IDs. Different Instagram builds, gallery pickers, date pickers and consent layouts can pause for inspection. The application should not be represented as universally unattended or already verified end-to-end on your accounts.

In particular, an Android date/gallery picker that does not expose the configured values to accessibility requests supervised completion. A pre-existing external authenticator without a locally enrolled seed may need its code/recovery confirmation. A security challenge requires your action. Uncertain Story submissions remain blocked for review instead of being posted twice. These are explicit unresolved/live-compatibility boundaries, not simulated successes.

## Storage and recovery

`%LOCALAPPDATA%\ZyonCompanion` contains DPAPI-protected credentials, separate Chrome profiles, runtime tools and nonsecret run checkpoints. Moving DPAPI files to a different Windows user/computer does not preserve decryption access. Retain your authenticator and recovery material outside this machine. Stopping a workflow does not undo an operation already committed by Instagram/Meta/AVANÇA.

A restart does not restore a prior device-success claim. Starting again rechecks identities; recorded uncertain Story outcomes block replay. Inspect external state before retrying after a timeout. Logs omit raw provider exceptions, passwords, tokens, setup keys and email codes.

The configured production API is the existing Organizafy/AVANÇA project; its bundled publishable key is public client configuration, not a privileged service key. Every platform read/write is authenticated as the entered AVANÇA user and checked against ownership. No database migration or publishing schedule rewrite is introduced.

## Source development

Python 3.11+ with Tk is required to run source. From `desktop`:

```powershell
python -m pip install -r requirements.txt
python -m zyon.desktop
python -m unittest discover -s tests -v
```

For real browser-engine fixture tests, set `ZYON_TEST_CHROME` to the installed Chrome/Chromium executable. Requests are intercepted; no real Instagram/Meta account is used. Tests needing a native GUI require Windows or an X display.

On Windows, build the standalone executable with:

```powershell
python -m pip install -r requirements-build.txt
python -m PyInstaller --noconfirm Zyon.spec
python package-desktop.py
```

The old loopback companion remains in source for backward compatibility. It is not the desktop executable's interface or execution controller.
