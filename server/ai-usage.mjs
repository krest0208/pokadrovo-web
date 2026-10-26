import { deny } from './http.mjs';

/** Operational usage only: no prompts, file names, media, transcripts or API keys. */
export function aiAnalytics(store, now, openrouter, days = 7) {
  if (![1, 7, 30].includes(days)) deny(400, 'Допустимые периоды ИИ-статистики: 1, 7, 30 дней.');
  const today = Math.floor(now() / 86400000) * 86400000, from = today - (days - 1) * 86400000;
  const agent = store.get("SELECT name FROM sqlite_master WHERE type='table' AND name='site_agent_state'") ? store.get('SELECT enabled,use_ai FROM site_agent_state WHERE id=1') : null;
  const aiState = openrouter.state(), agentDailyMaximum = agent?.enabled && agent?.use_ai && aiState.configured && aiState.enabled ? 1 : 0;
  const sums = `count(*) AS attempts, sum(result='ok') AS succeeded, sum(result IN ('failed','interrupted')) AS failed,
    sum(result='started') AS running, count(DISTINCT CASE WHEN account_id!='owner' THEN account_id END) AS users,
    coalesce(sum(input_tokens),0) AS inputTokens, coalesce(sum(output_tokens),0) AS outputTokens,
    sum(input_tokens IS NOT NULL AND output_tokens IS NOT NULL) AS meteredRequests,
    coalesce(sum(media_seconds),0) AS mediaSeconds, coalesce(sum(coin_charge),0) AS coins,
    round(avg(duration_ms)) AS averageMs, sum(provider_cost_usd) AS reportedCostUsd,
    count(provider_cost_usd) AS costReportedRequests`;
  return { days, from, to: now(), timezone: 'UTC',
    totals: store.get(`SELECT ${sums} FROM ai_runs WHERE at>=? AND at<=?`, from, now()),
    models: store.all(`SELECT provider,model,task,${sums} FROM ai_runs WHERE at>=? AND at<=? GROUP BY provider,model,task ORDER BY attempts DESC`, from, now()),
    series: store.all(`SELECT strftime('%Y-%m-%d',at/1000,'unixepoch') AS day,${sums} FROM ai_runs WHERE at>=? AND at<=? GROUP BY day ORDER BY day`, from, now()),
    quota: openrouter.quota(), agentDailyMaximum,
    capacity: [{ label: 'Разбор + план', calls: 2 }, { label: 'Разбор + две правки', calls: 3 }, { label: 'Три разбора + три плана', calls: 6 }].map(s => ({ users: 10, label: s.label, requests: 10 * s.calls, agentRequests: agentDailyMaximum, totalRequests: 10 * s.calls + agentDailyMaximum,
      fitsSiteLimit: 10 * s.calls + agentDailyMaximum <= openrouter.quota().limit, fitsProviderFreeLimit: 10 * s.calls + agentDailyMaximum <= 50 })),
    notes: ['Квота показывает только запросы этого сайта. Другие приложения с тем же аккаунтом OpenRouter тоже расходуют общий лимит.',
      'Ошибки и отмены после отправки учитываются в попытках. Проверка каталога не запускает генерацию.',
      'Стоимость показана только там, где её сообщил провайдер; неизвестная стоимость не считается нулевой.',
      'Каждый разбор или план считается отдельным запросом. Проба даёт три монеты на семь дней, а не три монеты каждый день. Сценарий шести действий выходит за рамки пробы.',
      'Включённый агент с настроенной моделью может добавить до одного запроса идей в сутки; технические проверки квоту не расходуют.',
      'Расчёт квоты не заменяет проверку скорости сервера и качества моделей. Одновременно выполняется один ИИ-запрос.'] };
}
