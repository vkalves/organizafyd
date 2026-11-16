"""Deterministic signup classification using headings, field roles and context."""
from .native_forms import normalized
from .errors import CompanionError

PATTERNS = {
    'email': ('qual e o seu endereco de email', 'qual e seu endereco de email', 'qual e o seu email', 'qual e seu email', 'whats your email', 'enter your email', 'digite seu email'),
    'code': ('insira o codigo', 'digite o codigo', 'enter confirmation code', 'enter security code', 'enter the code', 'enter code', 'codigo de confirmacao', 'enviamos um codigo', 'we sent a code'),
    'password': ('crie uma senha', 'criar uma senha', 'create a password', 'choose a password', 'escolha uma senha'),
    'birthday': ('qual e a sua data de nascimento', 'qual e sua data de nascimento', 'data de nascimento', 'qual e seu aniversario', 'qual e o seu aniversario', 'whats your birthday', 'date of birth', 'when were you born'),
    'name': ('qual e seu nome', 'qual e o seu nome', 'whats your name', 'enter your full name', 'digite seu nome completo'),
    'username': ('crie seu nome de usuario', 'crie um nome de usuario', 'criar nome de usuario', 'create a username', 'choose a username', 'escolha um nome de usuario'),
    'terms': ('agree to instagrams terms', 'concorde com os termos', 'concordar com os termos'),
}


def classify(screen, forms, allow_fields=False):
    labels = [normalized(label) for label in forms.labels(screen)]
    matches = set()
    for state, patterns in PATTERNS.items():
        if any(any(text == pattern or text.startswith(pattern + ' ') for pattern in patterns) for text in labels):
            matches.add(state)
    if allow_fields:
        fields = [node for node in screen.nodes if node.get('displayed', 'true') != 'false' and node.get('enabled', 'true') != 'false' and ((node.get('class') or node.tag) in ('android.widget.EditText', 'android.widget.AutoCompleteTextView') or node.get('editable') == 'true')]
        roles = set()
        for node in fields:
            label = normalized(' '.join(node.get(key, '') for key in ('hint', 'resource-id', 'content-desc')))
            words = set(label.split())
            try: kind = int(node.get('input-type', node.get('inputType', '0')), 0)
            except ValueError: kind = 0
            if words & {'code', 'codigo', 'otp'}: roles.add('code')
            elif 'email' in words or (kind & 15 == 1 and kind & 240 in (32, 208)): roles.add('email')
            elif node.get('password') == 'true' or words & {'password', 'senha'} or (kind & 15 == 1 and kind & 240 in (128, 144, 224)): roles.add('password')
            elif 'username' in words or 'usuario' in words: roles.add('username')
            elif 'full name' in label or 'nome completo' in label: roles.add('name')
        if len(fields) == 6:
            numeric = []
            for node in fields:
                try: numeric.append(int(node.get('input-type', node.get('inputType', '0')), 0) & 15 == 2)
                except ValueError: numeric.append(False)
            if all(numeric): roles.add('code')
        if len(roles) == 1: matches.update(roles)
        elif len(roles) > 1: raise CompanionError('NATIVE_SCREEN_AMBIGUOUS', 'Os campos indicam etapas incompatíveis. Nenhum valor foi digitado.')
    # Multiple headings indicate an ambiguous form; do not choose its first field.
    if len(matches) > 1: raise CompanionError('NATIVE_SCREEN_AMBIGUOUS', 'A tela contém etapas incompatíveis. Nenhuma ação foi escolhida.')
    return next(iter(matches), None)
