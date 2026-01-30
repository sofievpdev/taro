-- Миграция для добавления поддержки бесплатных "Быстрых Решений"
-- Выполни этот SQL запрос в Supabase SQL Editor

-- Добавляем новый столбец quick_decisions_used
ALTER TABLE users
ADD COLUMN IF NOT EXISTS quick_decisions_used INTEGER DEFAULT 0;

-- Для существующих пользователей устанавливаем значение 0
UPDATE users
SET quick_decisions_used = 0
WHERE quick_decisions_used IS NULL;

-- Проверка: посмотреть структуру таблицы
-- SELECT * FROM users LIMIT 5;
