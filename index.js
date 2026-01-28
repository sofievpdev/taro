require('dotenv').config();
const TarotBot = require('./src/bot');

// Проверка наличия необходимых переменных окружения
if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is required!');
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY is required!');
  process.exit(1);
}

// Создание и запуск бота
async function startBot() {
  const bot = new TarotBot(process.env.BOT_TOKEN, process.env.OPENAI_API_KEY);
  await bot.launch();
  console.log('✨ Tarot Telegram Bot started successfully!');
}

startBot().catch(error => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
