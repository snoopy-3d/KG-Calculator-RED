import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    token: str
    database_path: str

    @classmethod
    def from_env(cls):
        token = os.environ.get("BOT_TOKEN", "").strip()
        if not token:
            raise ValueError("Set BOT_TOKEN in the hosting environment")
        return cls(token, os.environ.get("DATABASE_PATH", "data/profiles.sqlite3"))
