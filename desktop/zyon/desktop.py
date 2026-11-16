# Python / zyon/desktop.py / Python 3.11+ / native Windows desktop application
import argparse
import copy
import json
import os
from pathlib import Path
import queue
import secrets
import threading
import time
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import unicodedata
import re
from . import __version__
from .android import devices
from .avanca import Avanca
from .errors import CompanionError
from .gmail import Gmail
from .runtime import application_dir, data_dir, load_runtime
from .vault import Vault
from .workflow import Workflow, configuration

BG, PANEL, INPUT, FG, MUTED, CYAN, GREEN, RED = '#08091c', '#11132d', '#090b20', '#e9edff', '#98a4c7', '#1de5eb', '#15e891', '#ed4679'

class Desktop:
    def __init__(self, root, storage=None, vault=None, auto_setup=False):
        self.root, self.storage = root, Path(storage or data_dir())
        self.storage.mkdir(parents=True, exist_ok=True)
        load_runtime(self.storage)
        self.vault = vault or Vault(self.storage)
        self.gmail = Gmail(self.vault); self.avanca = Avanca(self.vault)
        self.workflow = Workflow(self.storage, self.vault, avanca=self.avanca, gmail=self.gmail)
        self.responses = queue.Queue(); self.task = None
        self.values, self.entries = {}, []
        self.field_targets, self.tab_pages = {}, {}
        self.flow_map, self.app_map, self.device_map = {}, {}, {}
        self.pause_id, self.last_event = None, None
        self.saved = {}
        self.current_name = None
        self.root.title('Zyon · Automação Android · ' + __version__)
        width, height = min(1220, root.winfo_screenwidth() - 40), min(860, root.winfo_screenheight() - 70)
        self.root.geometry(f'{width}x{height}+20+20'); self.root.minsize(min(980, width), min(720, height)); self.root.configure(bg=BG)
        self.root.protocol('WM_DELETE_WINDOW', self.close)
        self.style()
        self.build()
        self.restore_library()
        self.poll()
        if auto_setup:
            import shutil
            if not shutil.which('adb') or not (application_dir() / 'tools/node_modules/.bin/appium.cmd').is_file():
                self.root.after(800, self.install_requirements)

    def style(self):
        style = ttk.Style(self.root); style.theme_use('clam')
        style.configure('.', font=('Segoe UI', 10), background=PANEL, foreground=FG)
        style.configure('TNotebook', background=BG, borderwidth=0)
        style.configure('TNotebook.Tab', background=PANEL, foreground=MUTED, padding=(11, 11))
        style.map('TNotebook.Tab', background=[('selected', CYAN)], foreground=[('selected', BG)])
        style.configure('TFrame', background=PANEL)
        style.configure('TLabel', background=PANEL, foreground=FG)
        style.configure('Muted.TLabel', foreground=MUTED)
        style.configure('TEntry', fieldbackground=INPUT, foreground=FG, insertcolor=FG, padding=8, bordercolor='#343b62')
        style.configure('TCombobox', fieldbackground=INPUT, foreground=FG, padding=7, arrowsize=15)
        style.map('TCombobox', fieldbackground=[('readonly', INPUT)], foreground=[('readonly', FG)])
        style.configure('TButton', background='#272d51', foreground=FG, padding=(12, 9))
        style.map('TButton', background=[('active', '#3b486d')])
        style.configure('Action.TButton', background=CYAN, foreground=BG)
        style.configure('Start.TButton', background=GREEN, foreground=BG, font=('Segoe UI', 11, 'bold'))
        style.configure('Stop.TButton', background=RED, foreground='white')
        style.configure('TCheckbutton', background=PANEL, foreground=FG, padding=6)
        style.map('TCheckbutton', background=[('active', PANEL)])
        style.configure('Treeview', background=INPUT, fieldbackground=INPUT, foreground=FG, rowheight=28)
        style.configure('Treeview.Heading', background=PANEL, foreground=CYAN)

    def tab(self, label, title, subtitle):
        outer = ttk.Frame(self.notebook); self.notebook.add(outer, text=label)
        canvas = tk.Canvas(outer, bg=PANEL, highlightthickness=0)
        scrollbar = ttk.Scrollbar(outer, orient='vertical', command=canvas.yview)
        canvas.configure(yscrollcommand=scrollbar.set); scrollbar.pack(side='right', fill='y'); canvas.pack(side='left', fill='both', expand=True)
        body = ttk.Frame(canvas, padding=22); window = canvas.create_window((0, 0), window=body, anchor='nw')
        self.tab_pages[body] = (outer, canvas)
        body.bind('<Configure>', lambda event: canvas.configure(scrollregion=canvas.bbox('all')))
        canvas.bind('<Configure>', lambda event: canvas.itemconfigure(window, width=event.width))
        ttk.Label(body, text=title, font=('Segoe UI', 19, 'bold'), foreground=CYAN).pack(anchor='w', pady=(0, 6))
        ttk.Label(body, text=subtitle, style='Muted.TLabel', wraplength=1030).pack(anchor='w', pady=(0, 18))
        return body

    def field(self, parent, label, name, default='', secret=False, choices=None):
        row = ttk.Frame(parent); row.pack(fill='x', pady=6)
        ttk.Label(row, text=label, width=27).pack(side='left', anchor='n', pady=7)
        value = tk.StringVar(value=default); self.values[name] = value
        if choices is not None:
            entry = ttk.Combobox(row, textvariable=value, values=choices, state='readonly')
        else: entry = ttk.Entry(row, textvariable=value, show='●' if secret else '')
        entry.pack(side='left', fill='x', expand=True); self.entries.append(entry)
        self.field_targets[name] = (entry, parent, *self.tab_pages[parent])
        return entry

    def check(self, parent, label, name, default=False):
        value = tk.BooleanVar(value=default); self.values[name] = value
        entry = ttk.Checkbutton(parent, text=label, variable=value); entry.pack(anchor='w', pady=5); self.entries.append(entry)
        return entry

    def pick(self, parent, label, name, types):
        entry = self.field(parent, label, name)
        button = ttk.Button(parent, text='Escolher arquivo…', command=lambda: self.select_file(name, types))
        button.pack(anchor='e', pady=(0, 8)); self.entries.append(button)
        return entry

    def select_file(self, name, types):
        path = filedialog.askopenfilename(parent=self.root, filetypes=types)
        if path: self.values[name].set(path)

    def build(self):
        header = tk.Frame(self.root, bg=BG, padx=24, pady=15); header.pack(fill='x')
        tk.Label(header, text='ZYON', bg=BG, fg=CYAN, font=('Segoe UI', 23, 'bold')).pack(side='left')
        tk.Label(header, text='  CONTROLE ANDROID  /  INSTAGRAM  /  AVANÇA', bg=BG, fg=MUTED, font=('Segoe UI', 10)).pack(side='left')
        tk.Label(header, text='DESKTOP ' + __version__, bg=BG, fg=GREEN, font=('Segoe UI', 10, 'bold')).pack(side='right')
        self.notebook = ttk.Notebook(self.root); self.notebook.pack(fill='both', expand=True, padx=18)
        data = self.tab('DADOS', 'Dados da conta', 'Configure o mesmo Instagram que será usado no Android, Chrome e AVANÇA.')
        self.check(data, 'Criar uma nova conta no Instagram nativo antes de preparar o perfil', 'create_account', True)
        self.field(data, 'Nome do perfil', 'full_name')
        self.field(data, 'Data de nascimento real', 'birthday', '')
        ttk.Label(data, text='DD/MM/AAAA ou AAAA-MM-DD (ex.: 04/09/2006 = 4 de setembro de 2006).', style='Muted.TLabel').pack(anchor='w')
        self.field(data, '@ esperado', 'username')
        self.field(data, 'Senha do Instagram', 'instagram_password', secret=True)
        ttk.Button(data, text='Gerar senha forte e candidato de @ a partir do nome', command=self.generate).pack(anchor='w', pady=12)
        self.field(data, 'Email da conta Instagram', 'recipient')
        ttk.Label(data, text='O @ será confirmado no perfil nativo, no Chrome e na API Meta antes da associação ao fluxo.', style='Muted.TLabel', wraplength=1020).pack(anchor='w', pady=16)

        profile = self.tab('PERFIL', 'Preparação do perfil', 'As alterações configuradas aqui serão executadas no aplicativo Android.')
        self.field(profile, 'Biografia (até 150 caracteres)', 'bio')
        self.pick(profile, 'Foto do perfil', 'profile_photo', [('Imagens', '*.jpg *.jpeg *.png')])
        self.field(profile, 'Categoria profissional', 'category', 'Artista')
        ttk.Label(profile, text='Deixe a categoria vazia para manter o tipo de conta atual. Uma conta profissional é necessária para publicar pela Meta.', style='Muted.TLabel', wraplength=1000).pack(anchor='w', pady=12)

        publish = self.tab('PUBLICAR', 'Story, link e destaque', 'Quando uma mídia estiver configurada, iniciar o fluxo autoriza a publicação desse Story na conta selecionada.')
        self.pick(publish, 'Mídia do Story', 'story_media', [('Story', '*.jpg *.jpeg *.png *.mp4')])
        self.field(publish, 'URL do link', 'story_link')
        self.field(publish, 'Texto da figurinha', 'story_cta')
        self.field(publish, 'Nome do destaque', 'highlight')
        ttk.Label(publish, text='Sem mídia selecionada, a etapa de publicação é pulada. Uma submissão incerta fica bloqueada para revisão e não é reenviada automaticamente.', style='Muted.TLabel', wraplength=1000).pack(anchor='w', pady=15)

        mail = self.tab('EMAIL', 'Verificação automática por Gmail', 'Autorize uma vez. Durante a execução, o app recupera o código fresco e o preenche no Instagram automaticamente.')
        self.field(mail, 'Caixa Gmail autorizada', 'gmail_mailbox')
        self.pick(mail, 'Cliente OAuth Google Desktop', 'google_client_file', [('JSON OAuth', '*.json')])
        self.field(mail, 'Remetente exato do código', 'email_sender', 'security@mail.instagram.com')
        self.gmail_label = ttk.Label(mail, text='Gmail: verificação pendente', foreground=MUTED); self.gmail_label.pack(anchor='w', pady=12)
        self.gmail_button = ttk.Button(mail, text='Conectar Gmail', style='Action.TButton', command=self.connect_gmail); self.gmail_button.pack(anchor='w')
        self.entries.append(self.gmail_button)

        proxy = self.tab('PROXY', 'Rede do Chrome', 'Opcional: use a conexão normal ou configure seu proxy no Chrome controlado. A rede do telefone continua sendo a rede configurada no Android.')
        self.field(proxy, 'Servidor HTTP/HTTPS/SOCKS5', 'proxy_server')
        self.field(proxy, 'Usuário do proxy', 'proxy_username')
        self.field(proxy, 'Senha do proxy', 'proxy_password', secret=True)

        android = self.tab('ADB', 'Dispositivo Android', 'Conecte o telefone por USB, habilite a depuração e aceite a autorização do computador no aparelho.')
        self.device_combo = self.field(android, 'Dispositivo autorizado', 'device_choice', choices=[])
        self.device_button = ttk.Button(android, text='Consultar dispositivos reais', command=self.refresh_devices); self.device_button.pack(anchor='w', pady=8); self.entries.append(self.device_button)
        self.device_label = ttk.Label(android, text='Nenhum dispositivo consultado.', style='Muted.TLabel'); self.device_label.pack(anchor='w', pady=12)
        ttk.Label(android, text='O app inicia o Appium automaticamente. Você não precisa abrir um servidor ou um painel no navegador.', style='Muted.TLabel', wraplength=1000).pack(anchor='w', pady=8)

        flow = self.tab('FLUXO', 'AVANÇA e convite Meta', 'Entre no seu usuário AVANÇA e selecione um fluxo ativo existente. A associação é executada pela API e confirmada por leitura.')
        self.field(flow, 'Email AVANÇA', 'avanca_email')
        self.field(flow, 'Senha AVANÇA', 'avanca_password', secret=True)
        self.avanca_button = ttk.Button(flow, text='Entrar e consultar meus fluxos / apps', command=self.connect_avanca); self.avanca_button.pack(anchor='w', pady=8); self.entries.append(self.avanca_button)
        self.flow_combo = self.field(flow, 'Fluxo ativo existente', 'flow_choice', choices=[])
        self.app_combo = self.field(flow, 'Aplicativo Meta', 'app_choice', choices=[])
        self.field(flow, 'Nome do app no convite', 'tester_app_name')
        ttk.Label(flow, text='Obrigatório: informe o nome público do app no Meta Developers, como aparecerá no convite de testador do Instagram. O convite será enviado na pausa do fluxo. O nome pode diferir do cadastro no AVANÇA.', style='Muted.TLabel', wraplength=1000).pack(anchor='w', pady=(0, 8))
        ttk.Label(flow, text='A automação pausará antes de aceitar o convite. O @ verificado aparecerá na janela; envie o convite pela Meta e clique em Continuar aqui.', style='Muted.TLabel', wraplength=1000).pack(anchor='w', pady=12)

        program = self.tab('PROGRAMA', 'Instalação e execução', 'Aplicativo nativo para Windows. Os componentes de controle são gerenciados pelo próprio programa.')
        self.install_button = ttk.Button(program, text='Instalar / verificar todos os requisitos', style='Action.TButton', command=self.install_requirements); self.install_button.pack(anchor='w', pady=12); self.entries.append(self.install_button)
        ttk.Button(program, text='Ver diagnóstico Appium', command=self.show_runtime_diagnostic).pack(anchor='w', pady=8)
        self.check(program, 'Guardar esta configuração e senhas criptografadas para este usuário Windows', 'save_secrets', True)
        ttk.Label(program, text='O consentimento inicial Google, a autorização USB e desafios que exigem sua presença continuam interativos. Telas desconhecidas param com diagnóstico, sem inventar conclusão.', style='Muted.TLabel', wraplength=1000).pack(anchor='w', pady=18)

        accounts = self.tab('CONTAS', 'Perfis salvos', 'Configurações e credenciais ficam no cofre criptografado do usuário Windows.')
        self.library = ttk.Treeview(accounts, columns=('username', 'name', 'email'), show='headings', height=10)
        for name, title in [('username', 'Instagram'), ('name', 'Perfil'), ('email', 'Email')]: self.library.heading(name, text=title); self.library.column(name, width=250)
        self.library.pack(fill='both', expand=True)
        actions = ttk.Frame(accounts); actions.pack(fill='x', pady=12)
        for label, callback in [('Salvar perfil atual', self.save_profile), ('Carregar selecionado', self.load_profile), ('Excluir selecionado', self.delete_profile), ('Executar selecionados em sequência', self.start_selected)]:
            button = ttk.Button(actions, text=label, command=callback); button.pack(side='left', padx=(0, 10)); self.entries.append(button)

        logs = self.tab('LOGS', 'Execução real', 'Acompanhe as etapas confirmadas, pausas e erros. Senhas, tokens, chaves e códigos não são registrados aqui.')
        self.logs = tk.Text(logs, bg=INPUT, fg='#b6efd8', insertbackground=FG, relief='flat', font=('Consolas', 10), height=18, state='disabled', wrap='word')
        self.logs.pack(fill='both', expand=True)

        footer = tk.Frame(self.root, bg=BG, padx=20, pady=15); footer.pack(fill='x')
        self.identity = tk.Label(footer, text='Configure a conta para iniciar.', bg=BG, fg=CYAN, font=('Segoe UI', 12, 'bold')); self.identity.pack(anchor='w')
        self.status = tk.Label(footer, text='Pronto.', bg=BG, fg=FG, justify='left', anchor='w', wraplength=1130); self.status.pack(fill='x', pady=(5, 10))
        buttons = ttk.Frame(footer); buttons.pack(fill='x')
        self.start_button = ttk.Button(buttons, text='▶  INICIAR FLUXO AUTOMÁTICO', style='Start.TButton', command=self.start); self.start_button.pack(side='left', fill='x', expand=True, padx=(0, 10))
        self.continue_button = ttk.Button(buttons, text='CONTINUAR', style='Action.TButton', command=self.resume, state='disabled'); self.continue_button.pack(side='left', padx=8)
        self.stop_button = ttk.Button(buttons, text='■  PARAR', style='Stop.TButton', command=self.workflow.stop); self.stop_button.pack(side='right', fill='x', expand=True, padx=(10, 0))

    def generate(self):
        self.values['instagram_password'].set(secrets.token_urlsafe(20))
        name = unicodedata.normalize('NFKD', self.values['full_name'].get()).encode('ascii', 'ignore').decode().lower()
        base = re.sub('[^a-z0-9]', '', name)[:22]
        if base: self.values['username'].set(base + str(secrets.randbelow(90000) + 10000))

    def busy(self):
        return (self.workflow.thread is not None and self.workflow.thread.is_alive()) or self.workflow.snapshot()['status'] in ('running', 'paused', 'resuming') or self.task is not None and self.task.is_alive()

    def background(self, label, work, kind):
        if self.busy(): messagebox.showinfo('Operação em andamento', 'Aguarde a operação atual ou pare o fluxo.', parent=self.root); return
        self.status.configure(text=label)
        def run():
            try: self.responses.put((kind, work(), None))
            except CompanionError as failure: self.responses.put((kind, None, str(failure)))
            except Exception: self.responses.put((kind, None, 'Operação não confirmada. Confira os requisitos e a conexão; dados sensíveis não foram registrados.'))
        self.task = threading.Thread(target=run, daemon=True); self.task.start()

    def connect_gmail(self):
        path, mailbox = self.values['google_client_file'].get(), self.values['gmail_mailbox'].get()
        def work():
            file = Path(path)
            if not file.is_file() or file.stat().st_size > 20000: raise CompanionError('CLIENT_REQUIRED', 'Selecione o JSON OAuth Desktop do Google.')
            return self.gmail.connect(json.loads(file.read_text(encoding='utf-8-sig')), mailbox)
        self.background('Conclua o consentimento Google no navegador que abrir.', work, 'gmail')

    def connect_avanca(self):
        email, password = self.values['avanca_email'].get(), self.values['avanca_password'].get()
        def work():
            if not self.avanca.restore(email): self.avanca.sign_in(email, password)
            return self.avanca.catalog()
        self.background('Consultando seus fluxos e aplicativos…', work, 'catalog')

    def refresh_devices(self):
        self.background('Consultando ADB…', lambda: (load_runtime(self.storage), devices())[1], 'devices')

    def install_requirements(self):
        self.background('Instalação aberta. Aguarde a verificação concluir na janela de instalação.', self.workflow.runtime.install, 'installed')

    def show_runtime_diagnostic(self):
        path = self.workflow.runtime.diagnostic_path
        try:
            if path.stat().st_size > 16000: raise ValueError()
            data = json.loads(path.read_text(encoding='utf-8'))
            message = '\n'.join(str(key) + ': ' + str(data[key]) for key in ('time', 'outcome', 'port', 'exit_code', 'elapsed_seconds', 'node_present', 'appium_present', 'reused') if key in data)
        except (OSError, ValueError): message = 'Nenhum diagnóstico disponível. Inicie o fluxo para verificar o controlador.'
        messagebox.showinfo('Diagnóstico Appium', message, parent=self.root)

    def settings(self):
        data = {name: value.get() for name, value in self.values.items()}
        data['serial'] = self.device_map.get(data.get('device_choice'))
        data['flow_id'] = self.flow_map.get(data.get('flow_choice'), data.get('flow_id'))
        data['meta_app_id'] = self.app_map.get(data.get('app_choice'))
        if data.get('proxy_server'):
            data['proxy'] = {'server': data['proxy_server'], **({'username': data['proxy_username'], 'password': data['proxy_password']} if data['proxy_username'] else {})}
        return data

    def start(self):
        if self.busy(): return
        try:
            data = configuration(self.settings())
            if data.get('create_account'): self.values['birthday'].set(data['birthday'])
            if data.get('save_secrets'): self.save_profile(silent=True)
            self.workflow.start(data)
        except CompanionError as failure: self.configuration_error(failure)
        except Exception: messagebox.showerror('Configuração', 'Confira os campos e o cofre Windows.', parent=self.root)

    def configuration_error(self, failure):
        field = {'serial': 'device_choice', 'flow_id': 'flow_choice', 'meta_app_id': 'app_choice'}.get(failure.field, failure.field)
        target = self.field_targets.get(field)
        if target:
            entry, body, tab, canvas = target
            self.notebook.select(tab)
            self.root.update_idletasks()
            position = (entry.winfo_rooty() - body.winfo_rooty()) / max(1, body.winfo_height())
            canvas.yview_moveto(max(0, position - .1))
        self.status.configure(text=str(failure))
        messagebox.showerror('Configuração necessária', str(failure), parent=self.root)
        if target:
            entry.focus_set()
            entry.selection_range(0, 'end')

    def start_selected(self):
        if self.busy(): return
        names = self.library.selection()
        if not names: return
        try: self.workflow.start_many([copy.deepcopy(self.saved[name]) for name in names])
        except CompanionError as failure: messagebox.showerror('Fila de execução', str(failure), parent=self.root)

    def resume(self): self.workflow.resume(self.pause_id)

    def restore_library(self):
        try:
            self.saved = self.vault.get('desktop-profiles') or {}
            status = self.gmail.status()
            self.gmail_label.configure(text=('Gmail conectado: ' + status['mailbox']) if status['connected'] else 'Conecte o Gmail antes de iniciar.')
            if status.get('mailbox'): self.values['gmail_mailbox'].set(status['mailbox'])
        except CompanionError:
            self.saved = {}; self.gmail_label.configure(text='Cofre Windows indisponível neste ambiente.')
        self.paint_library()

    def paint_library(self):
        self.library.delete(*self.library.get_children())
        for name, record in self.saved.items(): self.library.insert('', 'end', iid=name, values=('@' + name, record.get('full_name', ''), record.get('recipient', '')))

    def save_profile(self, silent=False):
        from .android import handle
        try:
            data = self.settings(); name = handle(data.get('username'))
            data.pop('google_client_file', None)
            if not data.get('save_secrets'):
                for field in ('instagram_password', 'avanca_password', 'proxy_password', 'proxy'): data.pop(field, None)
            self.saved[name] = data; self.vault.put('desktop-profiles', self.saved); self.paint_library()
            if not silent: self.status.configure(text='Perfil salvo no cofre Windows: @' + name)
        except CompanionError as failure:
            if silent: raise
            messagebox.showerror('Salvar perfil', str(failure), parent=self.root)

    def load_profile(self):
        selected = self.library.selection()
        if not selected: return
        data = self.saved[selected[0]]
        for name, variable in self.values.items():
            if name in data: variable.set(data[name])
        if data.get('flow_id'):
            self.flow_map[data.get('flow_choice') or data['flow_id']] = data['flow_id']
        if data.get('app_choice'): self.app_map[data['app_choice']] = data.get('meta_app_id')
        if data.get('device_choice'): self.device_map[data['device_choice']] = data.get('serial')
        self.status.configure(text='Perfil carregado. O executor verificará as identidades ao iniciar.')

    def delete_profile(self):
        selected = self.library.selection()
        if not selected: return
        name = selected[0]
        if messagebox.askyesno('Excluir configuração local', 'Excluir o perfil local @' + name + '? A conta Instagram e o fluxo AVANÇA permanecem no serviço.', parent=self.root):
            self.saved.pop(name, None); self.vault.put('desktop-profiles', self.saved); self.paint_library()

    def poll(self):
        while True:
            try: kind, result, failure = self.responses.get_nowait()
            except queue.Empty: break
            if failure: self.status.configure(text=failure); messagebox.showerror('Operação interrompida', failure, parent=self.root)
            elif kind == 'gmail': self.gmail_label.configure(text='Gmail conectado: ' + result['mailbox']); self.status.configure(text='Gmail pronto para recuperar códigos automaticamente.')
            elif kind == 'catalog':
                self.flow_map = {f['name'] + ' · ' + f['id'][:8]: f['id'] for f in result['flows']}
                self.app_map = {a['name'] + ' · ' + a['id'][:8]: a['id'] for a in result['apps']}
                if result.get('platformReady'): self.app_map['Aplicativo da plataforma'] = None
                self.flow_combo.configure(values=list(self.flow_map)); self.app_combo.configure(values=list(self.app_map))
                if len(self.flow_map) == 1: self.values['flow_choice'].set(next(iter(self.flow_map)))
                if len(self.app_map) == 1: self.values['app_choice'].set(next(iter(self.app_map)))
                self.status.configure(text='Fluxos e aplicativos do seu usuário carregados. Selecione o destino.')
            elif kind == 'devices':
                self.device_map = {d['serial'] + ' · ' + d['state']: d['serial'] for d in result if d['state'] == 'device'}
                self.device_combo.configure(values=list(self.device_map))
                if len(self.device_map) == 1: self.values['device_choice'].set(next(iter(self.device_map)))
                self.device_label.configure(text='\n'.join(d['serial'] + ' — ' + d['state'] for d in result) or 'Nenhum telefone conectado. Confira USB e autorização de depuração.')
            elif kind == 'installed': self.status.configure(text='Requisitos verificados. Consulte o dispositivo e conecte os serviços antes de iniciar.')
        state = self.workflow.snapshot()
        active = state['status'] in ('running', 'paused', 'resuming')
        if active or state['status'] in ('completed', 'needs_attention', 'stopped'):
            self.status.configure(text=state['message']); self.identity.configure(text=str(state.get('cycle', 1)) + '/' + str(state.get('cycles', 1)) + '   @' + state['username'] + '   ·   ' + state['phase'])
        self.pause_id = state.get('pauseId')
        self.continue_button.configure(state='normal' if state['status'] == 'paused' else 'disabled')
        for entry in self.entries:
            try: entry.configure(state='disabled' if active else ('readonly' if isinstance(entry, ttk.Combobox) else 'normal'))
            except tk.TclError: pass
        self.start_button.configure(state='disabled' if self.busy() else 'normal')
        events = state['events']
        if events and events[-1] != self.last_event:
            self.logs.configure(state='normal'); self.logs.delete('1.0', 'end')
            self.logs.insert('end', '\n'.join(e['time'][11:19] + '  [' + e['phase'] + '] ' + e['message'] for e in events)); self.logs.see('end'); self.logs.configure(state='disabled')
            self.last_event = events[-1]
        self.status.configure(wraplength=max(500, self.root.winfo_width() - 70))
        self.root.after(200, self.poll)

    def close(self):
        if self.busy() and not messagebox.askyesno('Encerrar execução', 'Parar e encerrar o controlador? Uma operação já enviada pode precisar de conferência externa.', parent=self.root): return
        self.workflow.close(); self.root.destroy()


def main():
    parser = argparse.ArgumentParser(description='Zyon native Windows automation')
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--smoke-test', action='store_true')
    parser.add_argument('--capture-to', default=None)
    parser.add_argument('--runtime-test', action='store_true')
    parser.add_argument('--report-to', default=None)
    args = parser.parse_args()
    if args.runtime_test:
        from .runtime import Runtime
        runtime = Runtime(threading.Event())
        process = None
        report = {'ready': False, 'owned': False, 'stopped': False}
        try:
            runtime.ensure(); process = runtime.process
            report.update(ready=runtime.ready(), owned=process is not None)
        except CompanionError as failure:
            report.update(code=failure.code, message=str(failure))
        finally:
            runtime.close()
            report['stopped'] = process is not None and process.poll() is not None
            if args.report_to: Path(args.report_to).write_text(json.dumps(report), encoding='utf-8')
        return 0 if report['ready'] and report['owned'] and report['stopped'] else 1
    if args.self_test:
        from .android import client_components
        webdriver, UiAutomator2Options, AppiumClientConfig, Proxy = client_components()
        assert callable(webdriver.Remote)
        assert UiAutomator2Options().load_capabilities({'platformName': 'Android'}).to_capabilities()['platformName'] == 'Android'
        assert AppiumClientConfig(remote_server_addr='http://127.0.0.1:4723', proxy=Proxy({'proxyType': 'direct'})).remote_server_addr == 'http://127.0.0.1:4723'
        import google_auth_oauthlib.flow
        from playwright.sync_api import sync_playwright
        from .browser import chrome_path
        with sync_playwright() as controller:
            browser = controller.chromium.launch(executable_path=chrome_path(), headless=True)
            page = browser.new_page()
            page.set_content('<html><body><button>Desktop driver ready</button></body></html>')
            assert page.get_by_role('button', name='Desktop driver ready').count() == 1
            browser.close()
        json.loads((Path(__file__).parent / 'platform.json').read_text())
        return 0
    root = tk.Tk()
    app = Desktop(root, auto_setup=not args.smoke_test)
    if args.smoke_test:
        root.update()
        assert root.winfo_width() >= min(980, root.winfo_screenwidth() - 40) and len(app.notebook.tabs()) == 10
        if args.capture_to:
            from PIL import ImageGrab
            image = ImageGrab.grab(bbox=(max(0, root.winfo_rootx()-10), max(0, root.winfo_rooty()-35), root.winfo_rootx()+root.winfo_width()+10, root.winfo_rooty()+root.winfo_height()+10))
            image.save(args.capture_to)
        assert app.workflow.snapshot()['status'] == 'idle'
        root.after(1500, app.close)
    root.mainloop()
    return 0

if __name__ == '__main__': raise SystemExit(main())
