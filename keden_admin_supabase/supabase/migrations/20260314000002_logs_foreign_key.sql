-- 1. Создаем связь между логами и пользователями для автоматического подтягивания ФИО
-- Это позволит нам видеть ФИО даже в старых логах, если ИИН совпадает.

-- Сначала убедимся, что все ИИН в логах существуют в таблице пользователей (или NULL)
-- Если есть мусор, лучше его не связывать или почистить.

ALTER TABLE public.logs 
DROP CONSTRAINT IF EXISTS logs_user_iin_fkey;

ALTER TABLE public.logs 
ADD CONSTRAINT logs_user_iin_fkey 
FOREIGN KEY (user_iin) REFERENCES public.users(iin) 
ON UPDATE CASCADE ON DELETE SET NULL;

-- 2. Индекс для ускорения джойнов
CREATE INDEX IF NOT EXISTS idx_logs_user_iin ON public.logs(user_iin);

-- 3. (Опционально) Заполняем пропущенные user_fio в таблице logs из таблицы users
UPDATE public.logs l
SET user_fio = u.fio
FROM public.users u
WHERE l.user_iin = u.iin 
AND (l.user_fio IS NULL OR l.user_fio = 'АНОНИМ');
