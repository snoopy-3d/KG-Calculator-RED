import asyncio
import os
import tempfile
import unittest
from unittest.mock import patch

from aiogram import Bot
from aiogram.client.session.base import BaseSession
from aiogram.methods import SendMessage
from aiogram.types import Update

from main import UNAVAILABLE, build_dispatcher
from config import Config
from profiles import Profiles


class FakeSession(BaseSession):
    def __init__(self):
        super().__init__()
        self.sent = []

    async def close(self):
        pass

    async def make_request(self, bot, method, timeout=None):
        if isinstance(method, SendMessage):
            self.sent.append(method)
            return True
        raise AssertionError(type(method).__name__)

    async def stream_content(self, url, **kwargs):
        yield b""


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = os.path.join(self.temp.name, "profiles.sqlite3")
        self.profiles = Profiles(self.path)

    def test_persistence_isolation_and_registration(self):
        self.profiles.ensure(1, "One")
        self.profiles.ensure(2, "Two")
        self.profiles.set_field(1, "server", "123")
        self.profiles.set_field(1, "season", "S1")
        self.profiles.ensure(1, "Updated")
        reopened = Profiles(self.path)
        self.assertEqual(reopened.get(1)["server"], "123")
        self.assertEqual(reopened.get(1)["season"], "S1")
        self.assertEqual(reopened.get(1)["name"], "Updated")
        self.assertIsNone(reopened.get(2)["server"])

    def test_validation_and_sql_input(self):
        self.profiles.ensure(1, "One")
        for value in ("", " " * 4, "x" * 41, "a\nb"):
            with self.assertRaises(ValueError):
                self.profiles.set_field(1, "server", value)
        with self.assertRaises(ValueError):
            self.profiles.set_field(1, "name", "bad")
        value = "'; DROP TABLE profiles;--"
        self.profiles.set_field(1, "server", value)
        self.assertEqual(self.profiles.get(1)["server"], value)

    def test_delete(self):
        self.profiles.ensure(1, "One")
        self.profiles.delete(1)
        self.assertIsNone(self.profiles.get(1))

    def test_token_required(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValueError):
                Config.from_env()


class HandlerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.profiles = Profiles(os.path.join(self.temp.name, "p.sqlite3"))
        self.session = FakeSession()
        self.bot = Bot("123456:TEST_ONLY_NOT_A_REAL_TOKEN", session=self.session)
        self.dp = build_dispatcher(self.profiles)
        self.counter = 0

    async def send(self, text, user=1, chat_type="private"):
        self.counter += 1
        update = Update.model_validate({"update_id": self.counter, "message": {
            "message_id": self.counter, "date": 1700000000,
            "chat": {"id": user, "type": chat_type},
            "from": {"id": user, "is_bot": False, "first_name": "Player"},
            "text": text,
        }})
        await self.dp.feed_update(self.bot, update)

    async def test_start_edit_profile_and_delete(self):
        await self.send("/start")
        await self.send("/server 555")
        await self.send("/season S2")
        await self.send("/profile")
        self.assertIn("555", self.session.sent[-1].text)
        self.assertIn("S2", self.session.sent[-1].text)
        await self.send("/start", user=2)
        self.assertIsNone(self.profiles.get(2)["server"])
        await self.send("/delete_profile")
        self.assertIsNone(self.profiles.get(1))

    async def test_menu_and_no_invented_calculations(self):
        await self.send("/calc")
        self.assertIsNotNone(self.session.sent[-1].reply_markup)
        await self.send("🧮 Прокачка")
        self.assertEqual(self.session.sent[-1].text, UNAVAILABLE)

    async def test_bad_input_and_groups(self):
        await self.send("/server " + "x" * 41)
        self.assertIn("40", self.session.sent[-1].text)
        await self.send("/start", user=3, chat_type="group")
        self.assertIsNone(self.profiles.get(3))


if __name__ == "__main__":
    unittest.main()
