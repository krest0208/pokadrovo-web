> Текущее решение: одна активная модель Qwen3.8-Omni-Flash через Alibaba Cloud. Публичные тарифы, пакеты, покупка монет, выбор других моделей и автоматические ИИ-идеи отключены. `/ai` — объяснение процесса; `/pricing` переводит на `/ai`. MP4 до 60 секунд и 7 МиБ, проекты 9:16 и 16:9. Реальное качество удаления слов-паразитов ещё не проверено; план требует подтверждения. Старые ключи, история и балансы сохранены. Подробности и приёмочные сценарии: `docs/AI-SINGLE-MODEL.md`. Ниже могут оставаться исторические сведения о прежних интеграциях.

# Покадрово — контекст для нового чата

Скопируйте весь этот документ в новый чат. Это техническое задание и карта проекта, а не архив приложения: **точное восстановление требует исходников и ассетов из репозитория**. Без них можно сделать похожую реализацию, но нельзя гарантировать тот же сайт, данные и поведение.

---

Ты продолжаешь разработку **Покадрово**, русскоязычной монтажной студии в браузере с ИИ-помощником. Источник истины — актуальная ветка `main` репозитория **https://github.com/krest0208/pokadrovo-web**. Рабочий сайт — **https://pokadrovo.ru/**, VPS VDSina **[адрес сервера хранится вне публичного контекста]**. Не перепутай домен. Сначала получи текущий `main`, прочитай `AGENTS.md`, этот документ, `package.json` и нужные исходники. Старые отчёты и сообщения не доказывают текущую готовность функций или успешную публикацию. Если документация расходится с работающим кодом, проверь расхождение и объясни его.

## Продукт и страницы

Пользователь добавляет видео, фотографии и музыку, задаёт формат и замысел, монтирует на таймлайне, при доступном подключении получает разбор/план ИИ, проверяет правки и экспортирует результат. Ручной монтаж остаётся самостоятельным рабочим сценарием. Интерфейс должен быть понятным без технических объяснений и лишнего мелкого текста.

- `/` — главная: первый экран «Ваши кадры. Ваша история.», иллюстрация сборки истории, выбор площадки/формата, процесс в картинках, возможности, поле задания, пакеты монет, последние проекты, FAQ и полный футер с навигацией.
- `/studio` — редактор; `/projects` — библиотека проектов с созданием, открытием, импортом и резервной копией JSON; `/profile` — профиль после входа. Гостевой монтаж зависит от серверной настройки.
- `/pricing` — тарифы, мощность и нейросети, сравнение и правила монет. Это каталог, а не доказательство доступности платных услуг.
- Защищённая админ-панель задаётся `server/owner-route.mjs`; путь определяется этим модулем. Её кнопка доступна только административному аккаунту. Проверка прав обязательна на сервере; скрытый URL не заменяет авторизацию.

Публичный текст описывает работающие функции. Упоминания внутренних обсуждений, владельца, его тестов и будущих планов удаляются. Названия тарифов, моделей и нейтральные статусы недоступности сохраняются. Не выдавай запланированную функцию за готовую ради маркетинга.

## Стек и карта исходников

Node.js **22.16+**, React **19**, TypeScript, Vite **6**; сервер на Node.js с SQLite, обычный CSS, `lucide-react`, Motion **14.6.0**. Это полноценное приложение с API, не один HTML-файл.

| Область | Файлы |
| --- | --- |
| Вход, маршруты, сеанс, темы | `src/main.tsx`, `src/Studio.tsx` |
| Главная и иллюстрации | `src/AiHome.tsx`, `src/HomeFormats.tsx`, `src/layered-copy.ts`, `src/layered-assets.ts`, `src/home/` |
| Тарифы и библиотека | `src/AiPlans.tsx`, `src/ProjectLibrary.tsx`, соответствующие CSS |
| Бренд и оформление | `src/BrandMark.tsx`, `src/PlatformIcon.tsx`, `public/`, `src/design-system.css` |
| Монтаж | `src/editor/editor.ts`, `model.ts`, `engine.ts`, `assets.ts`, `workspace.css` |
| Инструменты, ИИ, обучение | `src/editor/tools.ts`, `geometry.ts`, `transform-controls.ts`, `ai-panel.ts`, `ai.ts`, `omni.ts`, `tour.ts` |
| Аккаунты и админка | `src/account/`, `server/accounts.mjs`, `server/security.mjs`, `server/public/admin.*` |
| API и модели | `server/app.mjs`, `billing.mjs`, `ai.mjs`, `openrouter.mjs`, `yandex.mjs`, `shared/` |
| Анимации и служебный агент | `src/motion/`, `server/site-agent.mjs`, `site-checks.mjs`, `site-ideas.mjs` |
| Проверки и публикация | `server/tests/`, `tools/`, `.github/workflows/`, `deploy/autodeploy/` |

Не подменяй эти модули старыми демонстрациями из `src/preview/`. Android-репозиторий `krest0208/pokadrovo` — отдельный проект.

## Дизайн и взаимодействие

Сохраняй бренд: синий `#245ce0`, светлый фон `#f7f8fa`, белые карточки, текст `#17212d`, вторичный `#536174`; тёмная тема — фон `#111923`, поверхности `#192431`, текст `#f0f4fa`, вторичный `#b8c4d5`. Монеты и баланс оформлены нейтрально: тонкие контуры в цвете текста или синего акцента, холодные поверхности, без золотого выделения. Основное содержимое до 1240 px, шаг отступов 8 px, поля около 40 px на компьютере и 16 px на телефоне. Подробности — `docs/DESIGN-SYSTEM.md`.

Главная на компьютере сочетает крупный текст и иллюстрацию рядом; телефон — одна колонка. Процесс показан статичными картинками/схемами, без видео. Используй существующие локальные ассеты, фирменные SVG соцсетей и Lucide, без неоновых заменителей. Логотип и текст «покадрово» меняют цвет с темой и возвращают из редактора на главную. Карточки проектов имеют схематичные обложки с форматом, а не кадры из пользовательского видео.

Главная и тарифы используют крупные насыщенные заголовки Arial 900, капсульные CTA и навигацию, плоские поверхности и тёмно-синие секции возможностей и финального призыва. Монтажные иллюстрации и двухколоночный первый экран сохранены; на телефоне блоки идут в одну колонку. Основные актуальные страницы используют Arial/Helvetica Neue/system sans; Outfit и IBM Plex Mono также подключены в проекте. Копируй реальные CSS и порядок подключения, а не заменяй всю типографику одним шрифтом. `design-system.css` подключён после основных стилей. Motion отвечает за появления и отклик; сохраняй `prefers-reduced-motion`, клавиатурный фокус, доступные имена и кнопки около 44–50 px. На телефоне просмотр расположен над дорожками; панели переключаются, не сжимай весь настольный редактор в экран.

## Редактор, аккаунты и данные

Готовы импорт видео/изображений/аудио, обычное видео и Reels, таймлайн с дорожками, обрезка/разделение/диапазоны, скорость, звук, трансформации и маски, ручной текст/шрифты, импорт SRT, контекстное меню, отмена/повтор. Клип выбирается как на дорожке, так и нажатием на видео. Первое открытие запускает обучение с пропуском; кнопка `?` открывает его повторно. Отметка хранится для браузера и аккаунта. Экспорт WebM включает звук; MP4 зависит от кодировщика браузера.

Документы монтажа автосохраняются в localStorage и синхронизируются с сервером для вошедших пользователей; медиа — в IndexedDB `pokadrovo-media-v1`, в отдельных пространствах аккаунтов. Гостевые проекты отделены от пользовательских. JSON содержит монтаж, не исходные файлы. Смена устройства не переносит видео/музыку автоматически. Не обещай облачную медиатеку.

Регистрация и вход — email + пароль, профиль, изменение имени/пароля, выход. Социальный вход выключен; реализована опциональная интеграция RuSender SMTP для подтверждения адреса и восстановления по одноразовой ссылке. Реальная отправка остаётся выключенной до ввода SMTP-данных, активации отправителя и публикации проверенных документов. Административная роль не выдаётся обычной регистрацией. Пароли хешируются scrypt; сеансы HttpOnly, CSRF и лимиты попыток сохраняются. Админка содержит пользователей, статистику, настройки API и сообщения часового агента сайта. Агент проверяет ограниченный набор признаков, предлагает идеи и доставляет отчёты в административный аккаунт; это не полный браузерный аудит и не агент разработки.

## ИИ и монеты: фактические границы

ИИ предлагает проверяемый план; редактор применяет его отдельно после решения пользователя. Доступ определяется сервером, настройками, ключами, квотами и состоянием провайдера. Наличие интеграции в коде не подтверждает успешный запрос на production.

OpenRouter: визуальные модели `google/gemma-4-26b-a4b-it:free` и `qwen/qwen3.8-27b:free`; текстовый план может использовать `deepseek/deepseek-r1-0528:free`. Бесплатный визуальный разбор не распознаёт речь/аудио. Отдельная интеграция Qwen Omni принимает видео со звуком. Yandex AI Studio получает текст задания, структуру проекта и предыдущий разбор, без исходного видео/аудио. Каталог Яндекса: YandexGPT 5.1 Pro, Alice AI LLM, DeepSeek V4.1 Flash, Qwen3.6 35B (`shared/yandex-models.json`); пользовательский платный доступ закрыт.

На странице тарифов сохранены «Старт» — 1, «Сценарист» — 3, «Автор» — 5, «Студия» — 15 монет. Названия Omni/Max на витрине не означают, что связка подключена. Пакеты: 100/500/1500 монет. В верхнем углу страниц отображается серверный остаток монет (`src/account/CoinBalance.tsx`); новый единый значок — `src/CoinMark.tsx`. Баланс обновляется после ИИ-запроса, при возврате на страницу и пока она открыта. Гость видит предложение войти, ошибка связи не подменяется нулём, административный доступ без списаний обозначен ∞ с пояснением о квотах. Robokassa реализована в `server/billing.mjs` и разделе «Оплата и монеты» админки: подписанные серверные счета, ResultURL, история покупок, отдельный купленный баланс и идемпотентный журнал. Реальные продажи по умолчанию выключены; MerchantLogin, технические пароли, рублёвые цены, оферта и фискализация ещё требуют настройки. Источник актуальной доступности — `/api/billing/catalog`, а не статический JSON. Тест IsTest=1 настоящий баланс не пополняет. После активации покупки действуют в существующих режимах за одну монету; Яндекс и уровни 3/5/15 монет остаются закрыты. Подарок расходуется первым при подходящем проекте, затем купленный баланс; при ошибке или перезапуске удержанные монеты возвращаются. Возврат денег проводится в Robokassa вручную, в админке записывается факт и снимаются монеты. Подключение: `docs/ROBOKASSA.md`. Курс рубль/монета и цена Яндекса для списаний не утверждены. Не подключай оплату и платные вызовы в ходе обычной правки дизайна.

Проба при её включении: 3 монеты, один проект, 7 дней; короткий исходник до 60 секунд и 12 МиБ. Медиа отправляются только по отдельному согласию. Автоматическое распознавание речи с таймкодами, удаление вдохов и поиск лицензированной музыки не входят в готовые возможности.

## Запуск, проверка и публикация

```sh
npm ci
npm run dev
# Проверки перед выпуском:
npm run build
node tools/test-editor.cjs
node tools/test-editor-features.cjs
# Production после сборки:
npm start
```

Разработка — `http://localhost:5173`, API запускается вместе с Vite. `build` включает серверные тесты, TypeScript и Vite. Для точечной проверки есть `npm run typecheck`, `npm run test:accounts`. `npm run admin:setup` предназначен только для первичной локальной настройки; не сбрасывай существующий production-аккаунт. Если в изолированной среде нет `/tmp`, создай доступный временный каталог и укажи `TMPDIR`. Предпросмотр чата ограничен 1 МБ и не заменяет проверку полного приложения.

Перед изменениями проверь текущий remote HEAD, работай из чистой копии, сохраняй чужие правки. Коммить только относящиеся к задаче файлы, без секретов, БД, загрузок, cookie, production environment и `.pokadrovo-private`. Рутинные публикации в `main` и на этот домен разрешены согласно `AGENTS.md`; платформенные ограничения остаются обязательными.

Цепочка: GitHub `main` → успешный **Check Pokadrovo Web** для того же SHA → VPS-агент примерно раз в три минуты → изолированная сборка и тесты → переключение с резервной копией/откатом → HTTPS-проверка. GitHub Actions сам не выкладывает сайт. Подтверди установленный SHA через `/pokadrovo-release.json` и метатег `pokadrovo-release`, затем проверь затронутые страницы в браузере. Не меняй DNS, другие домены, биллинг и учётные данные. Полный порядок — `docs/AUTODEPLOY.md`.

Если репозиторий недоступен, используй разделы выше как краткий brief для прототипа и явно назови его новой реализацией. Не утверждай, что восстановил исходный сайт, аккаунты или серверные настройки. Для точного продолжения запроси доступ к репозиторию либо архив исходников с ассетами без приватных данных.


## Documents and registration (24 October 2026)

Legal pages and public operator configuration are implemented in `server/legal.mjs`; public URLs are `/legal`, `/legal/terms`, `/legal/privacy`, `/legal/consent`, `/legal/payments`, `/legal/cookies`, `/legal/content`, `/legal/contacts`. They are responsive, printable and available without login/JS. Registration has separate unchecked agreement, data-consent and 18+ choices; the server requires the exact current version and records the acceptance atomically with account creation. Do not backfill acceptance for existing users. Published versions archive full document HTML and operator details; bump LEGAL_EDITION when changing templates.

Owner panel → Documents and details contains genuine operator/contact, hosting/backup, processors/countries and notice/grounds fields. Default is a visibly marked draft: new signup, customer AI requests, optional event telemetry and new sales are gated until the required facts/review are supplied. Existing login, local guest montage, data/balances, aggregate request counts and owner testing are preserved. Do not fabricate public details or infer database localization from IP. A natural person without seller status can identify a free-service operator but cannot enable sales.

Users can register access, erasure and withdrawal requests in their profile. They are visible only to the owner in the legal panel. This is an intake queue, not automatic erasure/refund or a completed legal response; the operator must actually process each request in the legal time limit. See `docs/LEGAL-READINESS.md` for operational prerequisites and the YooKassa handoff. YooKassa is not integrated/approved by this change; no real prices or charges are enabled. Existing Robokassa new-order creation additionally requires actual published seller readiness and the exact current `/legal/payments` version. Existing issued invoices/callbacks retain their processing.


## Account operations update (24 October 2026)

`server/account-recovery.mjs` adds one-use, 192-bit offline recovery codes for normal password accounts. New signup shows the code once; storage retains only an account-bound keyed digest. `/api/account/recover` checks same-origin/CSRF/rate limits and consumes the proof atomically with password change, revokes every old user session, preserves projects/wallet/consent, issues a fresh code and never automatically logs in or resets owner credentials. Existing users can generate a code with their current password in Profile → Security; password changes rotate it. Production email delivery is not yet configured; the optional RuSender SMTP integration is implemented separately and remains disabled until setup is completed. The UI reflects the actual connection state. Recovery secrets live only in an explicit React receipt, never persistent browser storage, URLs or telemetry.

`server/database-care.mjs` adds owner-only database diagnostics and verified online backups. HTTPS account servers check daily backup availability after startup. Keep up to seven local copies over seven days with source/history/disk bounds, private modes and a matching key, verify before atomic publication, preserve the last good copy and reject symlink destinations. No database or key is served through HTTP or committed. Copies stay on the same server and are not off-site disaster recovery. Admin → Accounts and database shows integrity, persistent account/project counts, backup states and outstanding legal prerequisites. Publication requires actual operator facts; registration is not unblocked by inventing identity or marking an email verified. See `docs/ACCOUNT-OPERATIONS.md` for the exact workflow and tested restore procedure.

Fixes: auth state refresh recognises legal-version/readiness updates; reopening sign-in retries a failed initial session request. The recovery receipt takes focus without leaving a second active authentication modal underneath.


Live browser audit also found and fixed project-name loss when saving before blur (including Ctrl+S). A pending name draft is preserved across render/other edits and flushed into one undoable model change on save/action/autosave. `tests/project-name.test.mjs` exercises the actual Editor event/save methods with isolated storage. The main CI workflow now runs browser-model/restart/preview tests as well as server/editor checks. `/api/health` exposes only a cached boolean database readiness check, not paths, records or counts.


## Optional service email integration

`server/email.mjs` provides fixed `smtp.rusender.ru:465` TLS transport using pinned Nodemailer, encrypted SMTP credentials, a private encrypted queue and a persistent conservative maximum of 100 reserved sends per rolling 32 days (test, queued and failed attempts included). One worker sends sequentially; interrupted/uncertain SMTP attempts never auto-retry. Pending payloads are cleared after claim/cancellation/expiry and history after 33 days. No provider purchase or billing integration exists. Admin → Почта сайта supports reauthenticated settings, status/quota and one explicit owner test. Provider account creation, domain records and SMTP activation remain external prerequisites, not fabricated successes.

`server/account-email.mjs` queues verification on signup if ready, supports authenticated resend, and sends generic reset-request replies only delivering to verified active accounts. Hash-bound single-use proofs expire in 24 hours (verify) or 30 minutes (reset), are bound to current email/password/status, and are carried in URL fragments. `/account/email` is a separate noindex, no-referrer page with no analytics or third-party scripts; it clears the fragment into memory and consumes only an explicit POST. Verification additionally requires login to the matching normal user account. Reset revokes every old user session, rotates the offline recovery code and preserves projects/wallet/consent. Owner credentials are never reset by email. Public email delivery also requires published current legal documents; receipt consumption and offline recovery remain possible while delivery is paused. No migration silently verifies existing addresses. See `docs/EMAIL-OPERATIONS.md`.


## Automatic signup reliability

`server/password-work.mjs` bounds normal-user scrypt work to two active jobs and eight waiting jobs with an eight-second deadline; overload remains rate-limited. Signup commits user, legal acceptance, offline recovery proof and first session together, then publishes the session cookie. A failed session write rolls everything back. Optional mail queue failure after commit is isolated and audited without turning the successful signup into an error. No per-user manual owner approval or SMTP connection is required for signup. One-time genuine document publication is still a production prerequisite and must not be faked. Isolated stability tests cover concurrent signups, duplicates, queue bounds and storage/mail failures.


## Homepage motion and three visual stories

AiHome owns its Motion page controller so scroll reveals also run in the isolated preview. SiteMotion skips the home screen to avoid duplicate observers. Reveal/stagger replays only after complete viewport exit, supports reverse scroll and preserves visible content, focused elements and reduced-motion preference. Buttons retain native behavior with press/hover feedback; anchor links preserve hash and focus the destination. No wheel/scroll hijacking is used.

HomeShowcase exposes `Shot` and `Timeline` collection props for travel, coffee and city. Three photo atlases feed matching hero labels/timelines and varied process/features/final illustrations. Hero story changes use AnimatePresence; fine-pointer hover gathers fans/exports and moves illustration details via transforms. `src/home/showcase-motion.css` owns these effects; legacy home/layers.css is not reintroduced. Preview builds substitute the small matching atlases from src/preview/media and retain the 1MB/no-network bound. Original demo asset notes are in ASSET-CREDITS.md.
