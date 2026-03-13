# 🔍 Анализ проекта KEDEN ASSISTANT

## Обзор архитектуры

Проект состоит из 4 подсистем:

| Модуль | Стек | Назначение |
|--------|------|------------|
| `keden_admin_backend` | Node.js + Express + Supabase | REST API бэкенд, AI-оркестрация, биллинг |
| `keden_admin_frontend` | React + Vite + Supabase JS | Админ-панель для управления пользователями |
| `keden_admin_supabase` | Deno Edge Functions + Supabase | Серверless AI-экстракция документов |
| `antigravity-kit` | Next.js | Документация (не критичен) |

---

## 🚨 КРИТИЧЕСКИЕ БАГИ И УЯЗВИМОСТИ

### 1. 🔴 HARDCODED SECRETS В КОДЕ (SEVERITY: CRITICAL)

**Файл:** [`db.js`](keden_admin_backend/db.js:11)

```javascript
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

**Файл:** [`.env.example`](keden_admin_backend/.env.example:12)

```
OPENROUTER_API_KEY=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
```

**Проблема:** Supabase **SERVICE_ROLE** ключ и OpenRouter API ключ захардкожены прямо в исходном коде/`.env.example`. Service Role ключ даёт **полный обход RLS** и доступ ко ВСЕМ данным в Supabase. Если репозиторий утечёт — злоумышленник получает полный контроль над базой данных.

**Решение:**

- Немедленно ротировать оба ключа (Supabase Dashboard → Settings → API → Regenerate service_role key)
- Перенести в `.env` файл (который уже в `.gitignore`)
- В `.env.example` оставить только плейсхолдеры: `SUPABASE_SERVICE_KEY=your-service-key-here`
- Добавить `db.js` в pre-commit hook для проверки на секреты (git-secrets, gitleaks)

---

### 2. 🔴 JWT TOKEN ТОЛЬКО ДЕКОДИРУЕТСЯ, НЕ ВЕРИФИЦИРУЕТСЯ (SEVERITY: CRITICAL)

**Файл:** [`server.js`](keden_admin_backend/server.js:230)

```javascript
const decoded = jwt.decode(token); // ← НЕ ВЕРИФИЦИРУЕТ подпись!
```

В эндпоинте `/api/ext/auth` используется `jwt.decode()` вместо `jwt.verify()`. Это означает, что **любой** может создать произвольный JWT с любым IIN и получить доступ к системе. Злоумышленник может:

- Авторизоваться под любым пользователем
- Получить доступ к AI-экстракции чужих документов
- Использовать чужие кредиты

**Решение:**

```javascript
// Необходимо верифицировать подпись JWT через публичный ключ Keden
const decoded = jwt.verify(token, KEDEN_PUBLIC_KEY, { algorithms: ['RS256'] });
```

---

### 3. 🔴 ОТСУТСТВИЕ АУТЕНТИФИКАЦИИ НА КРИТИЧЕСКИХ ЭНДПОИНТАХ (SEVERITY: CRITICAL)

**Файл:** [`server.js`](keden_admin_backend/server.js:276-343)

Эндпоинты `/api/v1/analyze-single`, `/api/v1/analyze-batch`, `/api/v1/merge`, `/api/ext/log` — **не защищены никаким middleware аутентификации**:

```javascript
app.post('/api/v1/analyze-single', async (req, res) => { ... }); // NO AUTH!
app.post('/api/v1/analyze-batch', async (req, res) => { ... });  // NO AUTH!
app.post('/api/v1/merge', async (req, res) => { ... });          // NO AUTH!
app.post('/api/ext/log', async (req, res) => { ... });           // NO AUTH!
```

Любой может вызвать AI-анализ, потратить ваши деньги на OpenRouter, и записать произвольные логи.

**Решение:** Добавить middleware аутентификации (минимум — проверку IIN через `db.getUserByIin` + валидацию JWT).

---

### 4. 🔴 SUPABASE RLS РАЗРЕШАЕТ SELECT ВСЕМ (SEVERITY: HIGH)

**Файл:** [`20260224000000_init_schema.sql`](keden_admin_supabase/supabase/migrations/20260224000000_init_schema.sql:28-29)

```sql
CREATE POLICY "Allow authenticated access to users" ON public.users FOR SELECT USING (true);
CREATE POLICY "Allow authenticated access to logs" ON public.logs FOR SELECT USING (true);
```

Политики RLS используют `USING (true)` — это означает **любой** может читать ВСЕ данные пользователей (IIN, ФИО, кредиты) и логи. Нет политик для INSERT/UPDATE/DELETE, что при включенном RLS означает что **фронтенд не сможет модифицировать данные** (баг), но любой с anon ключом может читать всё (уязвимость).

**Решение:**

```sql
-- Только аутентифицированные через Supabase Auth
CREATE POLICY "Authenticated read users" ON public.users 
  FOR SELECT USING (auth.role() = 'authenticated');
  
-- Полный доступ только через service_role (бэкенд)
CREATE POLICY "Service role full access users" ON public.users 
  FOR ALL USING (auth.role() = 'service_role');
```

---

### 5. 🟠 RACE CONDITION В БИЛЛИНГЕ КРЕДИТОВ (SEVERITY: HIGH)

**Файл:** [`extract.controller.js`](keden_admin_backend/controllers/extract.controller.js:48)

```javascript
const user = db.getUserByIin(iin); // ← AWAIT MISSING!
```

Функция `db.getUserByIin()` — **async** (возвращает Promise), но вызывается **без await**. Результат `user` будет **объектом Promise**, а не данными пользователя. Условие `if (!user)` никогда не сработает (Promise — truthy), а `user.is_allowed` будет `undefined` — соответственно проверка доступа **полностью обходится**.

Аналогично в [`server.js:284`](keden_admin_backend/server.js:284) и [`server.js:309`](keden_admin_backend/server.js:309):

```javascript
const user = db.getUserByIin(iin); // AWAIT MISSING!
```

**Также:** В [`extract.controller.js:120`](keden_admin_backend/controllers/extract.controller.js:120):

```javascript
db.updateUser(user.id, { credits: user.credits - 1 }); // AWAIT MISSING!
db.addLog({ ... }); // AWAIT MISSING!
```

**Решение:** Добавить `await` ко всем вызовам async-функций.

---

### 6. 🟠 ДУБЛИРОВАНИЕ DATA ACCESS LAYER — ФРОНТЕНД НАПРЯМУЮ В SUPABASE (SEVERITY: HIGH)

**Файл:** [`api.js`](keden_admin_frontend/src/api.js:20-55)

Фронтенд админки напрямую обращается к Supabase (CRUD users, logs, stats), **полностью минуя бэкенд**. При этом бэкенд содержит свои аналогичные эндпоинты с аутентификацией через JWT. Это означает:

- Бэкенд `/api/admin/*` эндпоинты **не используются** — мёртвый код
- Вся бизнес-логика бэкенда (валидация, rate-limiting) обходится
- Безопасность зависит исключительно от Supabase RLS (который настроен `USING (true)`)

---

### 7. 🟠 SUPABASE EDGE FUNCTION: CORS = "*" (SEVERITY: MEDIUM)

**Файл:** [`index.ts`](keden_admin_supabase/supabase/functions/extract-ai/index.ts:323)

```typescript
"Access-Control-Allow-Origin": "*"
```

Edge Function принимает запросы от **любого** домена. Вместе с отсутствием серьёзной аутентификации (IIN передаётся в header) — это позволяет создать фишинговый сайт, который будет использовать ваш AI-сервис.

---

### 8. 🟠 UPSERT ПЕРЕЗАПИСЫВАЕТ КРЕДИТЫ СУЩЕСТВУЮЩИХ ПОЛЬЗОВАТЕЛЕЙ (SEVERITY: HIGH)

**Файл:** [`db.js`](keden_admin_backend/db.js:81-95)

```javascript
upsertUser: async (iin, fio) => {
    const { data } = await supabase.from('users')
      .upsert({
        iin,
        fio: fio || '',
        is_allowed: false,
        credits: 10, // ← ПЕРЕЗАПИШЕТ кредиты существующего пользователя!
      }, { onConflict: 'iin', ignoreDuplicates: false })
```

При каждом входе пользователя через расширение вызывается `upsertUser`, который **перезаписывает** кредиты на 10 и `is_allowed` на `false`. Администратор добавляет кредиты, а при следующем логине пользователя — они сбрасываются.

**Решение:** Использовать `INSERT ... ON CONFLICT DO UPDATE SET fio = EXCLUDED.fio` (без перезаписи credits/is_allowed), или разделить на `findOrCreate`.

---

### 9. 🟡 ДЕАКТИВАЦИЯ ПОЛЬЗОВАТЕЛЯ НЕ АТОМАРНА (SEVERITY: MEDIUM)

**Файл:** [`db.js`](keden_admin_backend/db.js:197-212)

```javascript
deductCredit: async (iin) => {
    const { data: user } = await supabase.from('users').select('id, credits').eq('iin', iin).single();
    if (!user || user.credits <= 0) return false;
    const { error } = await supabase.from('users')
      .update({ credits: user.credits - 1 })
      .eq('id', user.id)
      .eq('credits', user.credits); // оптимистичная блокировка
```

Оптимистичная блокировка — хороший подход, но результат `error` не проверяется на "row not updated" (когда кредиты уже изменились). Также нет retry-логики. В Supabase уже есть RPC-функция `deduct_credit` с атомарным UPDATE — она не используется в бэкенде.

---

### 10. 🟡 ПАРОЛЬ АДМИНА ПО УМОЛЧАНИЮ (SEVERITY: MEDIUM)

**Файл:** [`db.js`](keden_admin_backend/db.js:19)

```javascript
password_hash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10)
```

Пароль `admin123` используется если `ADMIN_PASSWORD` не задан в `.env`. Вкупе с тем, что пароль хранится **в памяти** (не в БД), при перезапуске сервера любые изменения пароля теряются.

---

## 🐛 ПРОЧИЕ БАГИ

| # | Файл | Описание | Severity |
|---|------|----------|----------|
| 11 | [`server.js:77`](keden_admin_backend/server.js:77) | `JSON.stringify(req.body)` на каждый extract-запрос с multipart-файлами — body может быть undefined/огромным, потенциальный OOM | LOW |
| 12 | [`extract.controller.js:66`](keden_admin_backend/controllers/extract.controller.js:66) | `req.files[filePtr++]` — нет проверки границ; если metadata описывает больше файлов чем загружено — crash | MEDIUM |
| 13 | [`supabase.js:5`](keden_admin_frontend/src/supabase.js:5) | Anon key `sb_publishable_BzW22spkneL4YLIr32qKmA_5qu0j42T` — не похож на стандартный Supabase anon key (должен быть JWT), возможно невалидный | MEDIUM |
| 14 | [`Dashboard.jsx:33`](keden_admin_frontend/src/Dashboard.jsx:33) | `new Date(date + 'Z')` — если дата уже в ISO с timezone, добавление 'Z' сломает парсинг | LOW |
| 15 | [`migrate.js`](keden_admin_backend/migrate.js:9) | Требует `better-sqlite3`, которого нет в `package.json` — миграция не запустится | LOW |
| 16 | [`index.ts:640`](keden_admin_supabase/supabase/functions/extract-ai/index.ts:640) | Модели `google/gemini-3.1-flash-lite-preview` и `anthropic/claude-haiku-4.5` — fallback cascade, но `claude-haiku-4.5` не поддерживает `response_format: json_object` | LOW |

---

## 📋 ПЛАН РЕФАКТОРИНГА

### Фаза 1: СРОЧНО (Безопасность) — 1-2 дня

- [ ] **Ротировать ВСЕ скомпрометированные ключи** (Supabase service key, OpenRouter API key)
- [ ] **Удалить хардкод секретов из `db.js`** — читать из `process.env`
- [ ] **Заменить `jwt.decode()` на `jwt.verify()`** в `/api/ext/auth`
- [ ] **Добавить аутентификацию** на `/api/v1/analyze-*`, `/api/v1/merge`, `/api/ext/log`
- [ ] **Исправить RLS политики** в Supabase — ограничить SELECT для authenticated, full access для service_role
- [ ] **Исправить `upsertUser()`** — не перезаписывать credits и is_allowed

### Фаза 2: Исправление багов — 2-3 дня

- [ ] **Добавить `await`** ко всем async-вызовам в `extract.controller.js` и `server.js`
- [ ] **Исправить filePtr bounds check** в `extract.controller.js`
- [ ] **Убрать `Access-Control-Allow-Origin: "*"`** из Edge Function — заменить на whitelist
- [ ] **Использовать `deduct_credit` RPC** вместо ручного read-update паттерна
- [ ] **Хранить пароль админа в БД** или использовать Supabase Auth для админки

### Фаза 3: Архитектурный рефакторинг — 1-2 недели

- [ ] **Решить: бэкенд ИЛИ Supabase Edge Functions** — сейчас оба делают одно и то же (AI-экстракцию), это дублирование. Рекомендация: оставить Edge Functions как единственный AI-сервис, бэкенд — только для админки
- [ ] **Унифицировать Data Access Layer** — фронтенд админки должен работать через REST API бэкенда, а не напрямую в Supabase. Либо полностью перейти на Supabase Auth + RLS и убрать бэкенд
- [ ] **Вынести конфигурацию моделей** AI в единое место (env-переменные или таблица в Supabase)
- [ ] **Добавить Helmet.js** для security headers на Express
- [ ] **Добавить валидацию входных данных** (express-validator или zod) на все эндпоинты
- [ ] **Добавить централизованную обработку ошибок** — middleware для Express вместо try/catch в каждом route
- [ ] **Удалить мёртвый код**: `migrate.js` (SQLite → Supabase миграция уже выполнена), `/api/admin/*` эндпоинты (не используются фронтендом)
- [ ] **Добавить тесты** — unit-тесты для `merger.js`, `validators.js`, интеграционные для auth flow
- [ ] **Добавить structured logging** (winston/pino) вместо `console.log` для production

### Фаза 4: DevOps & Observability

- [ ] **Добавить pre-commit hooks** (husky + lint-staged) для проверки на секреты
- [ ] **Docker-compose** для локальной разработки
- [ ] **CI/CD pipeline** с линтингом, тестами, деплоем
- [ ] **Health-check endpoint** (`/health`) для мониторинга
- [ ] **Prometheus metrics** или аналог для отслеживания расхода AI-токенов и кредитов

---

## Резюме

Проект имеет **5 критических уязвимостей безопасности**, которые требуют немедленного внимания:

1. Захардкоженные секреты (полный доступ к БД)
2. JWT не верифицируется (обход аутентификации)
3. Открытые эндпоинты AI (финансовые потери)
4. Permissive RLS (утечка персональных данных)
5. Upsert сбрасывает кредиты (нарушение биллинга)

Архитектурно — основная проблема в **дублировании**: бэкенд и Edge Functions делают одно и то же, фронтенд обходит бэкенд. Необходимо выбрать единую стратегию (рекомендуется: Edge Functions для AI, Supabase Auth + RLS для админки).
