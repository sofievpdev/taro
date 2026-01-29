const { Telegraf, Markup } = require('telegraf');
const OpenAIService = require('./services/openaiService');
const TarotService = require('./services/tarotService');
const SupabaseStorage = require('./services/supabaseStorage');
const { spreadTypes } = require('./data/spreadConfig');

class TarotBot {
  constructor(botToken, openaiApiKey) {
    this.bot = new Telegraf(botToken);
    this.openaiService = new OpenAIService(openaiApiKey);
    this.tarotService = new TarotService();
    this.userStorage = new SupabaseStorage();

    // Хранилище данных пользователей (в продакшене использовать БД)
    this.userSessions = new Map();

    this.setupHandlers();
  }

  // Инициализация хранилища
  async initialize() {
    await this.userStorage.init();
    console.log('✅ User storage initialized');
  }

  setupHandlers() {
    // Команда /start
    this.bot.start((ctx) => this.handleStart(ctx));

    // Обработка выбора расклада
    this.bot.action(/spread_(.+)/, (ctx) => this.handleSpreadSelection(ctx));

    // Обработка кнопки "новый расклад"
    this.bot.action('new_reading', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (error) {
        // Игнорируем ошибки старых callback кнопок
      }
      this.handleStart(ctx);
    });

    // Обработка бесплатного расклада
    this.bot.action('free_trial', (ctx) => this.handleFreeTrial(ctx));

    // Обработка pre_checkout запроса
    this.bot.on('pre_checkout_query', (ctx) => this.handlePreCheckout(ctx));

    // Обработка успешной оплаты
    this.bot.on('successful_payment', (ctx) => this.handleSuccessfulPayment(ctx));

    // Обработка текстовых сообщений (вопрос пользователя)
    this.bot.on('text', (ctx) => this.handleUserQuestion(ctx));

    // Обработка ошибок
    this.bot.catch((err, ctx) => {
      console.error('Bot error:', err);
      ctx.reply('Произошла ошибка. Попробуйте снова.');
    });
  }

  // Приветствие и главное меню
  async handleStart(ctx) {
    const userId = ctx.from.id;
    const balance = this.userStorage.getBalance(userId);
    const canUseFree = this.userStorage.canUseFreeTrial(userId);

    let balanceText = '';
    if (balance > 0) {
      balanceText = `\n💎 У тебя есть ${balance} ${this.getReadingsWord(balance)} в запасе!\n`;
    }

    // Если доступен бесплатный расклад - показываем специальное приветствие
    if (canUseFree) {
      const freeWelcomeText = `🌙 Добро пожаловать в мир Таро 🌙

Я - мистический проводник между мирами, готовый открыть тебе тайны карт Таро.

🎁 СПЕЦИАЛЬНО ДЛЯ ТЕБЯ 🎁
Получи БЕСПЛАТНЫЙ расклад "Одна Карта"!
Задай любой вопрос и получи ответ от Вселенной.

После бесплатного расклада тебе будут доступны:
🌟 Одна Карта - ${spreadTypes.oneCard.price} ⭐
🔮 Три Карты - ${spreadTypes.threeCards.price} ⭐
💖 Любовный Расклад - ${spreadTypes.loveReading.price} ⭐
✨ Кельтский Крест - ${spreadTypes.celticCross.price} ⭐
🎁 Пакет 5 раскладов - ${spreadTypes.package5.price} ⭐ (выгода!)

Начни с бесплатного расклада прямо сейчас! ✨`;

      await ctx.reply(
        freeWelcomeText,
        Markup.inlineKeyboard([
          [Markup.button.callback('🎁 Получить БЕСПЛАТНЫЙ расклад', 'free_trial')]
        ])
      );
      return;
    }

    // Обычное меню для тех, кто уже использовал бесплатный расклад
    const welcomeText = `🌙 Добро пожаловать в мир Таро 🌙

Я - мистический проводник между мирами, готовый открыть тебе тайны карт Таро.${balanceText}
✨ Что я могу для тебя сделать:

🌟 Одна Карта - ${spreadTypes.oneCard.price} ⭐
Быстрый ответ на твой вопрос

🔮 Три Карты - ${spreadTypes.threeCards.price} ⭐
Прошлое, настоящее и будущее

💖 Любовный Расклад - ${spreadTypes.loveReading.price} ⭐
Тайны твоих отношений

✨ Кельтский Крест - ${spreadTypes.celticCross.price} ⭐
Глубочайший анализ ситуации

━━━━━━━━━━━━━━━
🎁 СПЕЦИАЛЬНОЕ ПРЕДЛОЖЕНИЕ 🎁
Пакет 5 раскладов - ${spreadTypes.package5.price} ⭐
Выгода 50+ звезд! Используй на любые расклады

Выбери расклад, чтобы начать путешествие...`;

    await ctx.reply(
      welcomeText,
      Markup.inlineKeyboard([
        [Markup.button.callback(`🎁 Пакет 5 раскладов (${spreadTypes.package5.price} ⭐)`, 'spread_package_5')],
        [Markup.button.callback(`🌟 Одна Карта (${spreadTypes.oneCard.price} ⭐)`, 'spread_one_card')],
        [Markup.button.callback(`🔮 Три Карты (${spreadTypes.threeCards.price} ⭐)`, 'spread_three_cards')],
        [Markup.button.callback(`💖 Любовный Расклад (${spreadTypes.loveReading.price} ⭐)`, 'spread_love_reading')],
        [Markup.button.callback(`✨ Кельтский Крест (${spreadTypes.celticCross.price} ⭐)`, 'spread_celtic_cross')]
      ])
    );
  }

  // Получить правильное склонение слова "расклад"
  getReadingsWord(count) {
    const lastDigit = count % 10;
    const lastTwoDigits = count % 100;

    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
      return 'раскладов';
    }
    if (lastDigit === 1) {
      return 'расклад';
    }
    if (lastDigit >= 2 && lastDigit <= 4) {
      return 'расклада';
    }
    return 'раскладов';
  }

  // Обработка бесплатного расклада
  async handleFreeTrial(ctx) {
    try {
      await ctx.answerCbQuery();
    } catch (error) {
      // Игнорируем ошибки старых callback кнопок
    }

    const userId = ctx.from.id;

    // Проверяем доступность бесплатного расклада
    if (!this.userStorage.canUseFreeTrial(userId)) {
      await ctx.reply('Ты уже использовал свой бесплатный расклад! 😊\n\nВыбери один из платных раскладов:');
      return this.handleStart(ctx);
    }

    // Помечаем, что бесплатный расклад используется
    await this.userStorage.useFreeTrial(userId);

    await ctx.reply('🎉 Отлично! Ты получаешь БЕСПЛАТНЫЙ расклад "Одна Карта"!\n\nТеперь задай свой вопрос Вселенной...\n\nНапиши, что тебя волнует, или просто отправь любое сообщение для общего расклада.');

    // Сохраняем сессию как бесплатный расклад
    this.userSessions.set(userId, {
      spreadType: spreadTypes.oneCard,
      timestamp: Date.now(),
      paid: true,
      isFreeTrialReading: true
    });
  }

  // Обработка выбора расклада
  async handleSpreadSelection(ctx) {
    try {
      await ctx.answerCbQuery();
    } catch (error) {
      // Игнорируем ошибки старых callback кнопок
    }

    const spreadId = ctx.match[1];
    const spread = Object.values(spreadTypes).find(s => s.id === spreadId);

    if (!spread) {
      return ctx.reply('Расклад не найден');
    }

    const userId = ctx.from.id;

    // Если это пакет - просто отправляем инвойс
    if (spread.isPackage) {
      this.userSessions.set(userId, {
        spreadType: spread,
        timestamp: Date.now()
      });
      return await this.sendInvoice(ctx, spread);
    }

    // Если обычный расклад - проверяем баланс
    const balance = this.userStorage.getBalance(userId);

    if (balance > 0) {
      // Есть баланс - используем бесплатно
      await ctx.reply(`💎 Отличный выбор! Использую расклад из твоего пакета.\n\nОсталось раскладов: ${balance - 1}`);

      // Сохраняем выбор как оплаченный
      this.userSessions.set(userId, {
        spreadType: spread,
        timestamp: Date.now(),
        paid: true,
        usedFromBalance: true
      });

      await ctx.reply('Теперь задай свой вопрос картам...\n\nНапиши, что тебя волнует, или просто отправь любое сообщение для общего расклада.');
    } else {
      // Нет баланса - нужна оплата
      this.userSessions.set(userId, {
        spreadType: spread,
        timestamp: Date.now()
      });

      await this.sendInvoice(ctx, spread);
    }
  }

  // Отправка инвойса для оплаты
  async sendInvoice(ctx, spread) {
    const invoice = {
      title: spread.name,
      description: spread.description,
      payload: JSON.stringify({
        spreadId: spread.id,
        userId: ctx.from.id
      }),
      currency: 'XTR', // Telegram Stars
      prices: [{ label: spread.name, amount: spread.price }]
    };

    await ctx.replyWithInvoice(invoice);

    await ctx.reply(
      `Теперь задай свой вопрос картам...\n\nНапиши, что тебя волнует, или просто отправь любое сообщение для общего расклада.`
    );
  }

  // Обработка pre_checkout
  async handlePreCheckout(ctx) {
    await ctx.answerPreCheckoutQuery(true);
  }

  // Обработка успешной оплаты
  async handleSuccessfulPayment(ctx) {
    const userId = ctx.from.id;
    const session = this.userSessions.get(userId);

    if (!session) {
      return ctx.reply('Ошибка: сессия не найдена. Начните заново с /start');
    }

    // Если купили пакет - добавляем расклады в баланс
    if (session.spreadType.isPackage) {
      await this.userStorage.addReadings(userId, session.spreadType.readingsCount);
      const newBalance = this.userStorage.getBalance(userId);

      await ctx.reply(`🎉 Поздравляю! Пакет активирован!

💎 На твоем балансе теперь ${newBalance} ${this.getReadingsWord(newBalance)}

Используй их на любые расклады - просто выбери расклад из меню, и он спишется автоматически!

Выбери расклад из меню ниже или отправь /start`);

      // Очищаем сессию
      this.userSessions.delete(userId);
      return;
    }

    // Обычный расклад - устанавливаем флаг оплаты
    await ctx.reply('💫 Оплата получена! Вселенная слышит твой вопрос...');

    session.paid = true;
    this.userSessions.set(userId, session);

    // Если вопрос уже задан, делаем расклад
    if (session.question) {
      await this.performReading(ctx, session);
    } else {
      await ctx.reply('Теперь задай свой вопрос картам...\n\nНапиши, что тебя волнует, или просто отправь любое сообщение для общего расклада.');
    }
  }

  // Обработка вопроса пользователя
  async handleUserQuestion(ctx) {
    const session = this.userSessions.get(ctx.from.id);

    if (!session) {
      return ctx.reply('Сначала выбери расклад с помощью /start');
    }

    // Сохраняем вопрос
    session.question = ctx.message.text;
    this.userSessions.set(ctx.from.id, session);

    // Если оплата уже прошла, делаем расклад
    if (session.paid) {
      await this.performReading(ctx, session);
    } else {
      await ctx.reply('💫 Вопрос принят. Ожидаю завершения оплаты...');
    }
  }

  // Выполнение расклада
  async performReading(ctx, session) {
    const userId = ctx.from.id;

    try {
      // Если расклад использован из баланса - списываем
      if (session.usedFromBalance) {
        await this.userStorage.useReading(userId);
      }

      await ctx.reply('🔮 Перемешиваю колоду... Карты раскрывают свои тайны...');

      // Вытягиваем карты
      const cards = this.tarotService.drawCards(session.spreadType.cards);

      // Показываем выпавшие карты
      const spreadText = this.tarotService.formatSpread(cards, session.spreadType);
      await ctx.reply(spreadText);

      await ctx.reply('✨ Медитирую над картами...');

      // Получаем толкование от ChatGPT
      const reading = await this.openaiService.getTarotReading(
        session.spreadType,
        cards,
        session.question
      );

      // Отправляем толкование
      await ctx.reply(reading);

      // Если это был бесплатный расклад - показываем специальное предложение
      if (session.isFreeTrialReading) {
        await ctx.reply(
          `🌙 Спасибо, что доверился картам!\n\n✨ Тебе понравилось? Хочешь узнать больше?\n\nЯ могу открыть тебе ещё больше тайн:`,
          Markup.inlineKeyboard([
            [Markup.button.callback(`🎁 Пакет 5 раскладов (${spreadTypes.package5.price} ⭐)`, 'spread_package_5')],
            [Markup.button.callback(`🌟 Одна Карта (${spreadTypes.oneCard.price} ⭐)`, 'spread_one_card')],
            [Markup.button.callback(`🔮 Три Карты (${spreadTypes.threeCards.price} ⭐)`, 'spread_three_cards')],
            [Markup.button.callback(`💖 Любовный Расклад (${spreadTypes.loveReading.price} ⭐)`, 'spread_love_reading')],
            [Markup.button.callback(`✨ Кельтский Крест (${spreadTypes.celticCross.price} ⭐)`, 'spread_celtic_cross')]
          ])
        );
      } else {
        // Обычное сообщение для платных раскладов
        const balance = this.userStorage.getBalance(userId);
        let balanceText = '';
        if (balance > 0) {
          balanceText = `\n\n💎 У тебя осталось ${balance} ${this.getReadingsWord(balance)}`;
        }

        await ctx.reply(
          `🌙 Спасибо, что доверился картам.${balanceText}\n\nЖелаешь сделать ещё один расклад?`,
          Markup.inlineKeyboard([
            [Markup.button.callback('🔮 Да, новый расклад', 'new_reading')],
          ])
        );
      }

      // Очищаем сессию
      this.userSessions.delete(userId);

    } catch (error) {
      console.error('Reading error:', error);
      await ctx.reply('Извини, произошла ошибка при толковании. Попробуй позже.');
      this.userSessions.delete(ctx.from.id);
    }
  }

  // Запуск бота
  async launch() {
    // Инициализируем хранилище
    await this.initialize();

    this.bot.launch();
    console.log('🔮 Tarot Bot is running...');

    // Graceful stop
    process.once('SIGINT', () => this.bot.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
  }
}

module.exports = TarotBot;
