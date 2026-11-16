# Python / zyon/native_forms.py / Python 3.11+ / bounded semantic Android form recovery
import hashlib
import re
import unicodedata
from selenium.common.exceptions import (ElementClickInterceptedException, ElementNotInteractableException,
    NoSuchElementException, StaleElementReferenceException, WebDriverException)
from .errors import CompanionError

TRANSIENT = (StaleElementReferenceException, NoSuchElementException, ElementNotInteractableException)


def normalized(value):
    value = (value or '').replace('’', "'").replace('‘', "'")
    value = unicodedata.normalize('NFKD', value or '').encode('ascii', 'ignore').decode().casefold()
    value = re.sub(r'\be[\s-]+mail\b', 'email', value)
    value = re.sub(r'[^a-z0-9]+', ' ', value.replace("'", '')).strip()
    return re.sub(r'\s+', ' ', value)


def attribute(element, name):
    try: value = element.get_attribute(name)
    except (AttributeError, WebDriverException): return ''
    return value if isinstance(value, str) else str(value) if isinstance(value, (int, bool)) else ''


class NativeForms:
    def __init__(self, phone):
        self.phone = phone
        self.actions = []

    def record(self, action):
        self.actions.append(action)
        self.actions = self.actions[-30:]

    def check(self):
        if self.phone.cancel.is_set(): raise CompanionError('CANCELLED', 'Operação cancelada antes da próxima ação no formulário.')
        self.phone.screen()

    def labels(self, screen):
        return [text for node in screen.nodes if node.get('displayed', 'true') != 'false'
            and node.get('package', 'com.instagram.android') == 'com.instagram.android'
            and (node.get('class') or node.tag) not in ('android.widget.EditText', 'android.widget.AutoCompleteTextView')
            and node.get('editable') != 'true'
            for text in screen.labels(node) if text]

    def has(self, screen, labels):
        desired = {normalized(value) for value in labels}
        return any(normalized(value) in desired for value in self.labels(screen))

    def actual_labels(self, screen, labels):
        desired = {normalized(value) for value in labels}
        return tuple(value for value in self.labels(screen) if normalized(value) in desired)

    def security(self, screen):
        labels = [normalized(value) for value in self.labels(screen)]
        markers = ('confirme que voce e humano', 'confirm you are human', 'confirm youre human',
            'confirme sua identidade', 'confirm your identity', 'suspendemos sua conta', 'we suspended your account')
        return any(any(marker in value for marker in markers) or value == 'captcha' for value in labels)

    def inputs(self):
        found = []
        seen = set()
        for kind, value in (('class name', 'android.widget.EditText'), ('class name', 'android.widget.AutoCompleteTextView'), ('xpath', '//*[@editable="true" and not(@class="android.widget.EditText") and not(@class="android.widget.AutoCompleteTextView")]')):
            for element in self.phone.driver.find_elements(kind, value):
                identity = getattr(element, 'id', None)
                key = identity if isinstance(identity, str) else id(element)
                if key not in seen and element.is_displayed() and element.is_enabled():
                    seen.add(key); found.append(element)
        return found

    def role(self, element):
        label = normalized(' '.join(attribute(element, name) for name in ('resourceId', 'resource-id', 'contentDescription', 'hint')))
        kind = attribute(element, 'inputType') or attribute(element, 'input-type')
        try: number = int(kind, 0) if kind else 0
        except ValueError: number = 0
        if number & 15 == 1 and number & 240 == 96: label += ' full name'
        password = attribute(element, 'password').casefold() == 'true' or bool(re.search(r'\b(password|senha)\b', label)) or (number & 15 == 1 and number & 240 in (128, 144, 224))
        email = 'email' in label or (number & 15 == 1 and number & 240 in (32, 208)) or 'email' in normalized(kind)
        username = any(term in label for term in ('username', 'user name', 'usuario'))
        phone = number & 15 in (2, 3) or (any(term in label for term in ('phone', 'telefone', 'celular')) and not email and not username)
        return label, password, email, username, phone

    def select(self, purpose, allow_generic=True):
        candidates = []
        for element in self.inputs():
            label, password, email, username, phone = self.role(element)
            named = any(term in label for term in ('full name', 'nome completo', 'fullname'))
            if purpose == 'password':
                if phone or email or username or named: continue
                score = 100 if password else 1
            else:
                if password or phone: continue
                if purpose in ('email', 'login', 'username') and named: continue
                if purpose == 'email' and username and not email: continue
                score = 1
                if purpose == 'email' and email: score = 100
                elif purpose == 'login' and (email or username): score = 100
                elif purpose == 'username' and username: score = 100
                elif purpose == 'name' and any(term in label for term in ('full name', 'nome completo', 'fullname')): score = 100
                elif purpose not in ('email', 'login') and email: continue
                if purpose == 'name' and username: continue
            candidates.append((score, element))
        if not candidates: return None
        best = max(score for score, _ in candidates)
        if best == 1 and not allow_generic: return None
        winners = [element for score, element in candidates if score == best]
        if len(winners) != 1: raise CompanionError('NATIVE_FORM_AMBIGUOUS', 'O formulário contém vários campos possíveis. Nenhum valor foi digitado para evitar escolher o campo errado.')
        return winners[0]

    def wait_field(self, purpose, guard, allow_generic=True):
        deadline = self.phone.clock() + 8
        announced = False
        while self.phone.clock() < deadline:
            self.check()
            if guard and not guard(self.phone.screen()):
                raise CompanionError('NATIVE_FORM_CHANGED', 'A etapa mudou enquanto o campo era carregado.')
            try:
                field = self.select(purpose, allow_generic=allow_generic)
                if field is not None: return field
            except (StaleElementReferenceException, NoSuchElementException): pass
            if not announced:
                self.phone.progress('native_field_loading', 'Aguardando o campo editável e reavaliando a hierarquia do formulário.')
                self.hide_keyboard(); announced = True
            self.phone.cancel.wait(.35)
        return None

    def infer(self):
        fields = self.inputs()
        if len(fields) != 1: return None
        label, password, email, username, phone = self.role(fields[0])
        if phone: return None
        if password: return 'password'
        if email: return 'email'
        if username: return 'username'
        if any(term in label for term in ('full name', 'nome completo', 'fullname')): return 'name'
        return None

    def hide_keyboard(self):
        try:
            if self.phone.driver.is_keyboard_shown() is True:
                self.phone.driver.hide_keyboard(); return True
        except (AttributeError, WebDriverException): pass
        return False

    def gesture(self, element):
        identity = getattr(element, 'id', None)
        if not isinstance(identity, str) or not identity: return False
        try:
            self.phone.driver.execute_script('mobile: clickGesture', {'elementId': identity})
            return True
        except WebDriverException: return False

    def value_matches(self, element, value, purpose, wrote=False):
        observed = attribute(element, 'text') or attribute(element, 'value')
        if purpose == 'password':
            if observed == value: return True
            return wrote and bool(observed) and all(c in '•●*·' for c in observed)
        if purpose in ('email', 'login', 'username'): return observed.strip().casefold() == value.strip().casefold()
        return unicodedata.normalize('NFC', observed).strip() == unicodedata.normalize('NFC', value).strip()

    def fill(self, value, purpose, guard=None):
        self.record('preencher campo: ' + purpose)
        if not isinstance(value, str) or '\n' in value or '\r' in value:
            raise CompanionError('INVALID_FORM_VALUE', 'O valor configurado para este campo é inválido.')
        for attempt in range(3):
            self.check()
            if guard and not guard(self.phone.screen()):
                raise CompanionError('NATIVE_FORM_CHANGED', 'A etapa mudou antes da digitação. Nenhum valor será enviado ao formulário seguinte.')
            try:
                element = self.wait_field(purpose, guard)
                if element is None:
                    self.hide_keyboard(); self.phone.cancel.wait(.3); continue
                if self.value_matches(element, value, purpose): return
                if attempt:
                    self.phone.progress('native_form_recovery', 'Reobtendo e verificando o campo após uma falha de foco ou digitação.')
                    self.gesture(element)
                else:
                    try: element.click()
                    except (ElementClickInterceptedException, ElementNotInteractableException):
                        self.hide_keyboard()
                        if not self.gesture(element): raise
                self.check()
                if guard and not guard(self.phone.screen()):
                    raise CompanionError('NATIVE_FORM_CHANGED', 'A etapa mudou durante o foco do campo. A digitação foi interrompida.')
                identity = getattr(element, 'id', None)
                if attempt and isinstance(identity, str) and identity and not value.endswith('\\n'):
                    try: self.phone.driver.execute_script('mobile: replaceElementValue', {'elementId': identity, 'text': value})
                    except WebDriverException:
                        element.clear(); element.send_keys(value)
                else:
                    element.clear(); element.send_keys(value)
                for _ in range(4):
                    self.check()
                    if self.value_matches(element, value, purpose, wrote=True): return
                    self.phone.cancel.wait(.15)
            except TRANSIENT:
                pass
            except WebDriverException:
                pass
            self.phone.cancel.wait(.25)
        raise CompanionError('NATIVE_INPUT_UNCONFIRMED', 'Não foi possível confirmar o conteúdo do campo após três tentativas de foco e digitação. Nenhum botão de envio foi pressionado.')

    def click(self, labels):
        self.record('clicar: ' + ' / '.join(labels))
        self.check()
        self.hide_keyboard()
        for attempt in range(2):
            self.check()
            screen = self.phone.screen()
            actual = self.actual_labels(screen, labels)
            if not actual:
                if not attempt and self.hide_keyboard(): continue
                raise CompanionError('NATIVE_CONTROL_MISSING', 'O controle esperado não foi encontrado na tela atual.')
            # Android.click rejects duplicate controls before sending any tap.
            try:
                self.phone.click(actual)
                return
            except (StaleElementReferenceException, NoSuchElementException):
                if attempt: raise CompanionError('NATIVE_CONTROL_CHANGED', 'O controle mudou durante a atualização da tela.') from None
            except (ElementClickInterceptedException, ElementNotInteractableException):
                if attempt or not self.hide_keyboard(): raise CompanionError('NATIVE_CONTROL_BLOCKED', 'O Android bloqueou o toque no controle esperado.') from None

    def fingerprint(self, screen):
        labels = sorted(normalized(text) for text in self.labels(screen))
        return hashlib.sha256('\n'.join(labels).encode()).hexdigest()

    def wait_for(self, predicate, message, seconds=30):
        deadline = self.phone.clock() + seconds
        while self.phone.clock() < deadline:
            screen = self.phone.screen()
            if predicate(screen) or self.security(screen): return screen
            self.phone.cancel.wait(.25)
        raise CompanionError('NATIVE_TRANSITION_UNCONFIRMED', message)

    def navigate(self, labels, expected):
        self.check()
        self.hide_keyboard()
        before = self.fingerprint(self.phone.screen())
        self.click(labels)
        try:
            return self.wait_for(expected, 'A navegação ainda não foi confirmada.', seconds=3)
        except CompanionError as error:
            if error.code != 'NATIVE_TRANSITION_UNCONFIRMED': raise
        # Only a reversible navigation control may receive one alternate gesture.
        # Submission buttons are never passed through this method.
        screen = self.phone.screen()
        if self.fingerprint(screen) == before:
            actual = self.actual_labels(screen, labels)
            controls = screen.controls(actual)
            if len(controls) == 1:
                from .android import xpath_literal
                node = controls[0]
                terms = ['@' + key + '=' + xpath_literal(node.get(key)) for key in ('resource-id', 'text', 'content-desc') if node.get(key)]
                elements = [e for e in self.phone.driver.find_elements('xpath', '//*[' + ' and '.join(terms) + ']') if e.is_displayed() and e.is_enabled()]
                if len(elements) == 1 and self.gesture(elements[0]):
                    self.phone.progress('native_navigation_recovery', 'Repetindo uma navegação local por gesto após confirmar que a tela não mudou.')
        return self.wait_for(expected, 'A navegação do formulário não foi confirmada. Confira o Instagram antes de continuar.', seconds=20)
