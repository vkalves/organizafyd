# Python / tests/helpers.py / Python 3.11+ / injected test boundaries
import copy
from contextlib import contextmanager
import time
from xml.sax.saxutils import quoteattr

class MemoryVault:
    def __init__(self): self.data = {}
    def get(self, name): return copy.deepcopy(self.data.get(name))
    def put(self, name, value): self.data[name] = copy.deepcopy(value)
    def delete(self, name): self.data.pop(name, None)


def node(text='', rid='', desc='', cls='android.widget.TextView'):
    return '<node text=' + quoteattr(text) + ' resource-id=' + quoteattr(rid) + ' content-desc=' + quoteattr(desc) + ' class=' + quoteattr(cls) + '/>'


def screen(*nodes): return '<hierarchy><node class="android.widget.FrameLayout">' + ''.join(nodes) + '</node></hierarchy>'


def wait_job(app):
    end = time.monotonic() + 3
    while app.busy and time.monotonic() < end: time.sleep(.01)
    assert not app.busy, 'Worker did not finish'
    return app.snapshot()
