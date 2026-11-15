# Python / zyon/errors.py / Python 3.11+ / Windows 10 companion
class CompanionError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status
