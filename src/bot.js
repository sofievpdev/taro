const { Telegraf, Markup } = require('telegraf');
const OpenAIService = require('./services/openaiService');
const TarotService = require('./services/tarotService');
const SupabaseStorage = require('./services/supabaseStorage');
const { spreadTypes } = require('./data/spreadConfig');
const { getCardImageUrlAlt } = require('./utils/cardImages');

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

    // Команда /stats - статистика (только для админа)
    this.bot.command('stats', (ctx) => this.handleStats(ctx));

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
    const balance = await this.userStorage.getBalance(userId);
    const canUseFree = await this.userStorage.canUseFreeTrial(userId);
    const freeQuickDecisions = await this.userStorage.getRemainingFreeQuickDecisions(userId);

    let balanceText = '';
    if (balance > 0) {
      balanceText = `\n💎 У тебя есть ${balance} ${this.getReadingsWord(balance)} в запасе!\n`;
    }

    // Добавляем информацию о бесплатных быстрых решениях
    let quickDecisionText = '';
    if (freeQuickDecisions > 0) {
      quickDecisionText = `🎁 У тебя ${freeQuickDecisions} бесплатных "Быстрых Решений"!\n`;
    }

    // Если доступен бесплатный расклад - показываем специальное приветствие
    if (canUseFree) {
      const freeWelcomeText = `🌟 Здравствуй, искатель истины! 🌟

Ты здесь не случайно. В этот момент твоя душа ищет ответы, и Вселенная направила тебя ко мне.

Я - проводник между мирами, мост между твоими вопросами и древней мудростью карт Таро.

🎁 Судьба даровала тебе ДАР 🎁

Прямо сейчас ты можешь получить БЕСПЛАТНЫЙ расклад Таро!

Задай вопрос, который тревожит твоё сердце, и карты откроют то, что Вселенная хочет, чтобы ты узнал.

✨ Это не просто гадание - это послание для тебя ✨

Тысячи людей уже получили ответы на свои вопросы. Многие говорят, что расклад открыл им глаза на то, что они подсознательно уже чувствовали, но боялись признать.

💫 Никакой оплаты, никаких условий - только чистая мудрость 💫

Вселенная ждёт твоего вопроса...`;

      await ctx.reply(
        freeWelcomeText,
        Markup.inlineKeyboard([
          [Markup.button.callback('🎁 Получить БЕСПЛАТНЫЙ расклад', 'free_trial')]
        ])
      );
      return;
    }

    // Обычное меню для тех, кто уже использовал бесплатный расклад
    const welcomeText = `🌙 С возвращением, искатель истины! 🌙

Вселенная продолжает говорить через древние карты. Я чувствую, что ты ищешь более глубокие ответы...${balanceText}
${quickDecisionText}
Многие возвращаются снова, потому что карты не просто предсказывают - они помогают увидеть то, что мы сами уже знаем глубоко внутри, но боимся признать.

✨ Выбери своё послание от Вселенной:

━━━━━━━━━━━━━━━
🎁 БЛАГОСЛОВЕННОЕ ПРЕДЛОЖЕНИЕ 🎁
Пакет 5 раскладов (${spreadTypes.package5.price} ⭐) - Экономия 50+ звезд!
5 раскладов на любые вопросы вашей души

━━━━━━━━━━━━━━━
⚖️ Быстрое Решение ${freeQuickDecisions > 0 ? '(БЕСПЛАТНО - ' + freeQuickDecisions + ' раз!)' : '(' + spreadTypes.quickDecision.price + ' ⭐)'}
Да или Нет? Одна карта даст чёткий ответ перед важным выбором.

🌟 Одна Карта (${spreadTypes.oneCard.price} ⭐)
Мгновенная мудрость от Вселенной. Твоя судьба в одной карте.

🔮 Три Карты (${spreadTypes.threeCards.price} ⭐)
Прошлая карма → Настоящая реальность → Будущая судьба

💖 Любовный Расклад (${spreadTypes.loveReading.price} ⭐)
Будут ли они твоими? 5 карт раскроют правду о ваших отношениях.

✨ Кельтский Крест (${spreadTypes.celticCross.price} ⭐)
Самый мощный расклад! 10 карт откроют ВСЕ тайны: прошлое, скрытые силы, итог.

Что тревожит твоё сердце сегодня?`;

    await ctx.reply(
      welcomeText,
      Markup.inlineKeyboard([
        [Markup.button.callback(`🎁 Пакет 5 раскладов (${spreadTypes.package5.price} ⭐)`, 'spread_package_5')],
        [Markup.button.callback(freeQuickDecisions > 0 ? `⚖️ Быстрое Решение (БЕСПЛАТНО - ${freeQuickDecisions}!)` : `⚖️ Быстрое Решение (${spreadTypes.quickDecision.price} ⭐)`, 'spread_quick_decision')],
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

    await ctx.reply('✨ Прекрасно! Вселенная приняла твоё желание узнать правду. ✨\n\nТеперь задай свой вопрос. Будь искренним - карты чувствуют энергию твоих мыслей.\n\n💭 О чём болит твоя душа? Что держит тебя в напряжении? Напиши это здесь...\n\nИли просто отправь любое сообщение, и я сделаю общий расклад на текущий момент твоей жизни.');

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

    // Проверка на бесплатные "Быстрые Решения"
    if (spread.id === 'quick_decision') {
      const canUseFree = await this.userStorage.canUseFreeQuickDecision(userId);
      const remaining = await this.userStorage.getRemainingFreeQuickDecisions(userId);

      if (canUseFree) {
        // Используем бесплатное быстрое решение
        await this.userStorage.useFreeQuickDecision(userId);
        const newRemaining = remaining - 1;

        await ctx.reply(`🎁 Отлично! Используем бесплатное "Быстрое Решение"!\n\n✨ У тебя осталось ${newRemaining} бесплатных ${newRemaining === 1 ? 'попытка' : newRemaining < 5 ? 'попытки' : 'попыток'}`);

        // Сохраняем сессию как оплаченную
        this.userSessions.set(userId, {
          spreadType: spread,
          timestamp: Date.now(),
          paid: true,
          usedFreeQuickDecision: true
        });

        await ctx.reply('⚖️ Задай свой вопрос, на который нужен ответ ДА или НЕТ...\n\nНапример: "Стоит ли мне менять работу?" или "Получится ли у меня этот проект?"');
        return;
      } else {
        await ctx.reply(`⚖️ Быстрое Решение\n\nТы уже использовал все 5 бесплатных попыток. Теперь стоимость: ${spread.price} ⭐`);
      }
    }

    // Если это пакет - просто отправляем инвойс
    if (spread.isPackage) {
      this.userSessions.set(userId, {
        spreadType: spread,
        timestamp: Date.now()
      });
      return await this.sendInvoice(ctx, spread);
    }

    // Если обычный расклад - проверяем баланс
    const balance = await this.userStorage.getBalance(userId);

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
      provider_token: '', // Empty for Telegram Stars
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

  // Статистика (только для админа)
  async handleStats(ctx) {
    const userId = ctx.from.id;
    const adminId = process.env.ADMIN_USER_ID || '178223077'; // Твой Telegram ID

    // Проверка, что это админ
    if (adminId && userId.toString() !== adminId) {
      return; // Игнорируем команду для не-админов
    }

    try {
      await ctx.reply('📊 Собираю статистику...');

      // Получаем все данные из Supabase
      const { data: users, error } = await this.userStorage.supabase
        .from('users')
        .select('*');

      if (error) throw error;

      // Базовые метрики
      const totalUsers = users.length;
      const usedFreeTrial = users.filter(u => u.has_used_free_trial).length;
      const notUsedFreeTrial = totalUsers - usedFreeTrial;
      const usersWithBalance = users.filter(u => u.readings_balance > 0).length;
      const totalPurchases = users.reduce((sum, u) => sum + u.total_purchases, 0);
      const totalBalance = users.reduce((sum, u) => sum + u.readings_balance, 0);

      // Платящие пользователи
      const paidUsers = users.filter(u => u.total_purchases > 0);
      const paidUsersCount = paidUsers.length;
      const payingRate = totalUsers > 0 ? ((paidUsersCount / totalUsers) * 100).toFixed(1) : 0;

      // Конверсия: сколько из тех, кто использовал бесплатный расклад, потом купили
      const conversions = users.filter(u => u.has_used_free_trial && u.total_purchases > 0).length;
      const conversionRate = usedFreeTrial > 0 ? ((conversions / usedFreeTrial) * 100).toFixed(1) : 0;

      // Средние покупки на платящего пользователя
      const avgPurchases = paidUsersCount > 0 ? (totalPurchases / paidUsersCount).toFixed(1) : 0;

      // Расчет дохода (примерно)
      const estimatedRevenue = totalPurchases * 11; // средний чек ~11 звезд

      // Сегменты пользователей
      const freeTrialOnly = users.filter(u => u.has_used_free_trial && u.total_purchases === 0).length;
      const paidNeverTrial = users.filter(u => !u.has_used_free_trial && u.total_purchases > 0).length;
      const noEngagement = users.filter(u => !u.has_used_free_trial && u.total_purchases === 0).length;

      const statsText = `📊 СТАТИСТИКА БОТА (Русский)

👥 БАЗА ПОЛЬЗОВАТЕЛЕЙ:
   Всего: ${totalUsers}
   💰 Платящих: ${paidUsersCount} (${payingRate}%)
   🎁 Использовали триал: ${usedFreeTrial}
   👻 Не активированы: ${noEngagement}

💵 ДОХОД И ПОКУПКИ:
   Всего покупок: ${totalPurchases}
   Примерный доход: ~${estimatedRevenue} ⭐
   Средний чек/юзер: ${avgPurchases}

🎯 ВОРОНКА КОНВЕРСИИ:
   Триал использовали: ${usedFreeTrial}
   → Купили после: ${conversions} (${conversionRate}%)
   → Остались на бесплатном: ${freeTrialOnly}

   Сразу купили (без триала): ${paidNeverTrial}

💎 АКТИВНЫЕ БАЛАНСЫ:
   Пользователей с балансом: ${usersWithBalance}
   Всего раскладов на балансах: ${totalBalance}

📊 СЕГМЕНТЫ ЮЗЕРОВ:
   🟢 Конверсии: ${conversions} (триал + купили)
   🟡 Только триал: ${freeTrialOnly} (потенциал)
   🟠 Купили сразу: ${paidNeverTrial} (пропустили триал)
   🔴 Не вовлечены: ${noEngagement} (зашли и ушли)`;

      await ctx.reply(statsText);

      // Последние 10 пользователей с деталями
      const recent = users
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 10);

      let recentText = '📋 Последние 10 пользователей:\n\n';
      recent.forEach((u, i) => {
        const date = new Date(u.created_at).toLocaleDateString('ru-RU', {
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });

        let status = '🔴'; // не вовлечен
        if (u.total_purchases > 0) status = '🟢'; // платит
        else if (u.has_used_free_trial) status = '🟡'; // только триал

        recentText += `${status} ${i + 1}. User ${u.user_id}\n`;
        recentText += `   📅 ${date}\n`;
        recentText += `   💎 Баланс: ${u.readings_balance} | Покупок: ${u.total_purchases}\n`;
        recentText += `   🎁 Триал: ${u.has_used_free_trial ? 'Да' : 'Нет'}\n\n`;
      });

      await ctx.reply(recentText);

      // Топ покупателей
      const topSpenders = users
        .filter(u => u.total_purchases > 0)
        .sort((a, b) => b.total_purchases - a.total_purchases)
        .slice(0, 5);

      if (topSpenders.length > 0) {
        let topText = '🏆 Топ 5 клиентов:\n\n';
        topSpenders.forEach((u, i) => {
          topText += `${i + 1}. User ${u.user_id}\n`;
          topText += `   💰 ${u.total_purchases} покупок\n`;
          topText += `   💎 Баланс: ${u.readings_balance}\n\n`;
        });
        await ctx.reply(topText);
      }

    } catch (error) {
      console.error('Stats error:', error);
      await ctx.reply('Ошибка при получении статистики');
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

      // Показываем выпавшие карты с изображениями
      await ctx.reply(`✨ ${session.spreadType.name} ✨\n\nТвои карты раскрываются...`);

      // Отправляем изображение каждой карты
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const position = session.spreadType.positions[i];
        const imageUrl = getCardImageUrlAlt(card);

        try {
          await ctx.replyWithPhoto(imageUrl, {
            caption: `🃏 ${position}: ${card.name}\n📖 ${card.keywords}`
          });
        } catch (error) {
          // Если изображение не загрузилось, отправляем текстом
          await ctx.reply(`🃏 ${position}: ${card.name}\n📖 ${card.keywords}`);
        }
      }

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
          `💫 Чувствуешь? Карты открыли то, что ты где-то глубоко внутри уже знал...

Многие говорят: "Расклад попал точно в цель. Как будто кто-то видел мою душу."

🌟 Это только начало. У тебя есть другие вопросы? Сейчас - самый сильный момент для продолжения. Энергия карт ещё открыта для тебя.

✨ Выбери свой следующий шаг:`,
          Markup.inlineKeyboard([
            [Markup.button.callback(`🎁 Пакет 5 раскладов (${spreadTypes.package5.price} ⭐)`, 'spread_package_5')],
            [Markup.button.callback(`⚖️ Быстрое Решение (${spreadTypes.quickDecision.price} ⭐)`, 'spread_quick_decision')],
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
