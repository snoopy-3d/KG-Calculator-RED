import sqlite3
from contextlib import contextmanager
from pathlib import Path


def validate_label(value: str) -> str:
    value = value.strip()
    if not value or len(value) > 40 or any(ord(c) < 32 for c in value):
        raise ValueError("Введите от 1 до 40 символов без переносов строк.")
    return value


class Profiles:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS profiles (user_id INTEGER PRIMARY KEY, name TEXT NOT NULL, server TEXT, season TEXT)")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def ensure(self, user_id: int, name: str):
        with self.connect() as db:
            db.execute("INSERT INTO profiles(user_id,name) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name", (user_id, name))

    def get(self, user_id: int):
        with self.connect() as db:
            row = db.execute("SELECT * FROM profiles WHERE user_id=?", (user_id,)).fetchone()
            return dict(row) if row else None

    def set_field(self, user_id: int, field: str, value: str):
        if field not in {"server", "season"}:
            raise ValueError("Unknown profile field")
        value = validate_label(value)
        with self.connect() as db:
            cursor = db.execute(f"UPDATE profiles SET {field}=? WHERE user_id=?", (value, user_id))
            if cursor.rowcount != 1:
                raise ValueError("Profile does not exist")

    def delete(self, user_id: int):
        with self.connect() as db:
            db.execute("DELETE FROM profiles WHERE user_id=?", (user_id,))
