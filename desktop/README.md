# Zyon Windows companion 1.0

Local software for the same Instagram account on Android 14, Chrome on Windows 10, and AVANÇA. This package adds Gmail desktop OAuth with refresh, Android UI execution through Appium, and an explicit Meta invitation pause. Existing AVANÇA owner checks, official Meta authorization and verified flow association remain in the website.

## Start on Windows 10

1. Download this repository ZIP, extract it, and open **desktop**. Do not run scripts from inside the ZIP.
2. Install **Python 3.12**, including the Python launcher, from <https://www.python.org/downloads/windows/>. Install **Google Chrome**.
3. Double-click **start.cmd**. The first launch installs the pinned Python dependencies in `desktop/.venv`, then opens the local control page. Keep its console open. Press Enter in that console to reopen the page if needed. Do not refresh the browser page: its per-launch access token is deliberately removed from the address bar.
4. Configure Gmail and Android below. The UI gives the next action and stops on uncertain state.

No `.exe` is included. `start.cmd` runs the Python application; it is not a signed Windows installer.

## Gmail: one initial authorization, automatic renewal

In your own Google Cloud project, enable **Gmail API**, configure the OAuth consent screen, and create an OAuth client with application type **Desktop app**. Download that client's JSON. Select this JSON **in the local companion**, enter the exact mailbox address, and click **Conectar Gmail**. Complete Google's consent in the browser using that mailbox. Do not upload the JSON or credentials to GitHub or send them in chat.

The app uses authorization code + PKCE, a random-port loopback callback, offline access, and only `https://www.googleapis.com/auth/gmail.readonly`. It checks the authorized mailbox with Gmail's profile endpoint. Google's refresh token and client credentials are encrypted with Windows current-user DPAPI under `%LOCALAPPDATA%\ZyonCompanion\vault`. There is no plaintext fallback. Renewal runs through Google's `AuthorizedSession` and updated credentials are saved after requests. A revoked/expired grant stops retrieval and asks for reconnection.

**Google configuration matters:** `gmail.readonly` is a restricted scope. An external OAuth app in **Testing** generally receives refresh tokens that expire after seven days for this scope. Configure the intended audience/publishing status and complete Google's applicable verification requirements for a long-lived deployment. Initial consent and revoked grants always require interaction; the app cannot bypass them.

To receive an Instagram code:

1. Set the exact sender seen in your actual Instagram emails and the exact recipient (including any alias).
2. Click **Iniciar novo desafio**, then request a new code in Instagram.
3. Click **Buscar código**. The companion polls for up to 90 seconds, retries bounded transient Gmail failures, and considers only messages received after the challenge started. It checks exact sender and recipient, ignores attachments and hidden HTML, and rejects ambiguous codes or multiple matching messages. It does not mark, delete or send mail.
4. Enter the displayed code in Instagram. It is hidden after 60 seconds and never written to the workflow journal. Retrieval does not establish that Instagram accepted the code.

**Remover conexão local** deletes the locally stored grant. To revoke provider access as well, remove the application under your Google Account's third-party connections.

## Android controller setup

Install these prerequisites on Windows:

- Node.js **22 LTS**, version 22.12 or newer within 22.x, including npm 10+.
- **JDK 17**, with `JAVA_HOME` set to its installation directory.
- Android SDK Command-line Tools / Platform Tools, with `ANDROID_HOME` pointing to the SDK. Put `platform-tools` on `PATH`; `adb devices -l` must work in a fresh terminal. UiAutomator2 doctor reports any remaining SDK components.
- On the Android 14 phone, enable Developer options and USB debugging, connect USB, unlock it, and accept the Windows computer's debugging key. Device-specific USB drivers may be necessary.

Run **setup-appium.cmd** once. It installs local Appium **3.9.1** from the npm lockfile and UiAutomator2 **5.0.7** under a companion-specific `APPIUM_HOME`, then runs driver diagnostics. Run **start-appium.cmd** and leave that window open. It binds Appium to `127.0.0.1:4723`, uses error-level logs and does not enable relaxed security. Never turn on debug/request logging during credential screens; UI hierarchies can contain secrets.

Open Instagram on the phone and navigate to the intended **own profile**, where **Editar perfil / Edit profile** is visible. In the companion, enter its exact @, query USB devices, select the correct serial, and click **Verificar / ativar 2FA**.

The executor uses semantic accessibility labels in Portuguese and English and unique controls. It checks the profile handle, selects the same account in Accounts Center, inspects authentication-app 2FA, and skips enrollment if already active. For recognized enrollment screens it encrypts the displayed authenticator seed before generating/submitting a TOTP, then waits for a visible activation confirmation. Recovery codes are collected into the encrypted vault only when a recognized code screen exposes them. No screenshots or UI source are retained.

**Device validation still required:** Instagram builds vary. These selectors have fixture coverage, not a live-phone certification. A hidden setup key, password challenge, unfamiliar layout, duplicate control or unclear account scope stops execution. Complete that step on the phone and return to the intended profile before checking again. The application does not clear data, remove other accounts or attempt to defeat Instagram challenges. Exact automatic enrollment on every Instagram build is not established.

Save the authenticator key and recovery codes in your password manager or another secure location. The companion does not display or export stored secrets. Its DPAPI vault remains usable only under the same Windows user; moving encrypted files to another machine is not an account recovery strategy. Confirm recovery material in the UI. Return to the own profile, then click **Conferir e sair desta conta**. The companion re-reads identity and active 2FA before selecting account-specific logout. It refuses an ambiguous all-accounts logout. Completion requires the login screen to appear. A saved-login or unknown confirmation screen needs inspection on the phone.

After an interrupted command, inspect the actual device state before retrying. Restarting the companion restores only the expected handle/device and marks the session interrupted; it never restores a prior 2FA/logout success claim or retries an uncertain tap automatically.

## Chrome → invitation pause → AVANÇA

After native logout is confirmed, **Abrir Instagram no Chrome** opens Instagram's login page. Use the same @. The companion displays the handle and waits while you send the tester invitation through the correct Meta application. Confirm that step and click **Continuar para AVANÇA**.

The browser stage opens <https://www.organizafy.site/avanca/integracao?expected_username=your.handle>. The companion passes only the expected handle. It does not pass Gmail codes, Instagram passwords, AVANÇA sessions, OAuth grants or device secrets. The website prefills a valid handle and still requires explicit prerequisites, authenticated ownership, live Meta identity verification, an existing flow selection and membership readback. Chrome Instagram login, tester-invitation acceptance, AVANÇA sign-in and official Meta consent remain browser actions. This version does not claim unattended browser account creation/login or automatic typing of retrieved email codes.

The verified application host is `www.organizafy.site`. ASCII `avanca.online` and internationalized `avança.online` are different domains; the companion uses the verified Organizafy route.

## Checks and package

From `desktop`:

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Tests cover exact account checks, TOTP generation, enrollment activation/pending state, 2FA-before-logout, unknown controls, stale/ambiguous mail, persisted renewal, revoked grants, invitation gating, interrupted workflow, secret redaction and HTTP origin/Host/bearer restrictions. Windows CI also exercises actual DPAPI encrypt/decrypt and parses the PowerShell setup script. No real Google account, Meta invitation or production publishing job is used by tests.

The GitHub Actions **Windows companion** workflow builds a source ZIP and SHA-256 checksum after Windows and Linux tests. The ZIP excludes virtual environments, dependency directories, credentials and caches. It is a runnable source package with launchers, not evidence that a specific phone completed the workflow.

Operational state is stored in `%LOCALAPPDATA%\ZyonCompanion`. `workflow.json` contains only the handle, device serial and phase. Tokens, TOTP seeds and recovery codes exist only in the encrypted vault; email codes are transient process memory. The HTTP UI binds loopback, checks exact Host/Origin, requires a random bearer capability and serves no cross-origin API access.

No database migration is required for this companion. It does not change account ownership, existing schedules or queued publications.
