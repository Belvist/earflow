-- 000003_users_email_hash_unique.sql
-- UNIQUE на users.email_hash — каноничный идентификатор email при логине.
-- Node auth-service и auth-core (Go) ищут пользователя по email_hash (sha256
-- normalized email). Регистрация делала lookup-затем-insert: параллельные запросы
-- одного email создавали дубликаты. Жёсткий констрейнт закрывает гонку, а
-- auth-core маппит 23505 → 400 EMAIL_TAKEN.
--
-- Не на email (legacy может содержать NULL/дубли), не на telegram_id (PG UNIQUE
-- не конфликтует по NULL, но это отдельный вопрос).
--
-- NOTE: 000002 зарезервирован за 000002_cleanup_legacy_prod.sql (DRAFT, не
-- применён), поэтому этот файл нумерован 000003.

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND indexname = 'users_email_hash_unique'
  ) THEN
    -- Дедуп перед UNIQUE: при legacy-дубликатах email_hash выживает пользователь
    -- с минимальным id, остальным обнуляем hash. Они остаются доступны по
    -- plaintext email (lower(email) lookup), просто без hash-быстрого логина.
    UPDATE public.users u SET email_hash = NULL
      WHERE u.email_hash IS NOT NULL
        AND u.id <> (
          SELECT min(x.id) FROM public.users x WHERE x.email_hash = u.email_hash
        );

    CREATE UNIQUE INDEX users_email_hash_unique
      ON public.users (email_hash)
      WHERE email_hash IS NOT NULL AND email_hash <> '';
  END IF;
END
$mig$;