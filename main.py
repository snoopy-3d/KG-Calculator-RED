import asyncio
import logging

from aiogram import Bot, Dispatcher, F, Router
from aiogram.enums import ChatType
from aiogram.filters import Command
from aiogram.types import KeyboardButton, Message, ReplyKeyboardMarkup

from config import Config
from profiles import Profiles

MAIN = ReplyKeyboardMarkup(keyboard=[
    [KeyboardButton(text="👤 Профиль"), KeyboardButton(text="🧮 Калькуляторы")],
    [KeyboardButton(text="🌐 Сервер"), KeyboardButton(text="📅 Сезон")],
    [KeyboardButton(text="❓ Помощь")],
], resize_keyboard=True)
CALCULATORS = ("Прокачка", "События", "Ресурсы")
CALC_MENU = ReplyKeyboardMarkup(keyboard=[
    [KeyboardButton(text=f"🧮 {name}")] for name in CALCULATORS
] + [[KeyboardButton(text="🏠 Меню")]], resize_keyboard=True)
UNAVAILABLE = "Расчёт пока недоступен: проверенные игровые формулы и таблицы ещё не добавлены. Бот не выдаёт приблизительные игровые значения."


def build_dispatcher(profiles: Profiles) -> Dispatcher:
    router = Router()
    # Profiles are private and always keyed by the sender, never by message input.
    router.message.filter(F.chat.type == ChatType.PRIVATE)

    @router.message(Command("delete_profile"))
    async def delete_profile(message: Message):
        profiles.delete(message.from_user.id)
        await message.answer("Профиль удалён. /start — создать заново.", reply_markup=MAIN)

    @router.message()
    async def handle(message: Message):
        if not message.from_user:
            return
        text = message.text or ""
        command, _, argument = text.partition(" ")
        command = command.split("@", 1)[0]
        user_id = message.from_user.id
        if command in {"/server", "/season"}:
            field = "server" if command == "/server" else "season"
            if not argument.strip():
                await message.answer(f"Введите {command} и значение, например {command} 1. Значение сохраняется как ваша метка, без проверки по игре.")
                return
            try:
                profiles.ensure(user_id, message.from_user.full_name)
                profiles.set_field(user_id, field, argument)
            except ValueError as error:
                await message.answer(str(error))
                return
            await message.answer("Сохранено.", reply_markup=MAIN)
            return
        if text == "🌐 Сервер":
            await message.answer("Укажите сервер: /server 123")
        elif text == "📅 Сезон":
            await message.answer("Укажите сезон: /season 1")
        elif command == "/profile" or text == "👤 Профиль":
            profiles.ensure(user_id, message.from_user.full_name)
            profile = profiles.get(user_id)
            await message.answer(f"Игрок: {profile['name']}\nСервер: {profile['server'] or 'не указан'}\nСезон: {profile['season'] or 'не указан'}", reply_markup=MAIN)
        elif command == "/calc" or text == "🧮 Калькуляторы":
            await message.answer("Выберите раздел. Формулы ожидают проверки.", reply_markup=CALC_MENU)
        elif text in {f"🧮 {name}" for name in CALCULATORS} or command in {"/events", "/resources"}:
            await message.answer(UNAVAILABLE, reply_markup=CALC_MENU)
        elif command == "/start":
            profiles.ensure(user_id, message.from_user.full_name)
            await message.answer("Kingdom Guard Calculator RED\nПрофиль создан. Укажите сервер и сезон через меню.", reply_markup=MAIN)
        elif command in {"/help", "/cancel"} or text in {"❓ Помощь", "🏠 Меню"}:
            await message.answer("/profile — профиль\n/server 123 — сервер\n/season 1 — сезон\n/calc — калькуляторы\n/delete_profile — удалить профиль\nХраним Telegram ID, имя, сервер и сезон. Токен сюда не присылайте.", reply_markup=MAIN)
        else:
            await message.answer("Выберите пункт меню или отправьте /help.", reply_markup=MAIN)

    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    return dispatcher


async def main():
    config = Config.from_env()
    profiles = Profiles(config.database_path)
    # Keep logs free of API URLs and exception strings that could contain tokens.
    bot = Bot(config.token)
    try:
        await bot.delete_webhook(drop_pending_updates=False)
        print("Telegram connection ready; starting polling.", flush=True)
        await build_dispatcher(profiles).start_polling(bot, handle_as_tasks=False)
    finally:
        await bot.session.close()


def run():
    logging.disable(logging.CRITICAL)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except Exception:
        print("Bot stopped. Check BOT_TOKEN, network and persistent disk settings; details suppressed to protect secrets.", flush=True)
        raise SystemExit(1) from None


if __name__ == "__main__":
    run()
