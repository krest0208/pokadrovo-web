'use strict';
(() => {
  const form = document.getElementById('setup-form'), error = document.getElementById('error'), submit = document.getElementById('submit');
  let token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  history.replaceState(null, '', location.pathname);
  if (!token) { error.textContent = 'Откройте полную одноразовую ссылку из окна запуска. При необходимости перезапустите приложение.'; submit.disabled = true; }
  document.getElementById('show-password').addEventListener('click', event => {
    const show = form.elements.password.type === 'password';
    for (const field of [form.elements.password, form.elements.confirmPassword]) field.type = show ? 'text' : 'password';
    event.currentTarget.textContent = show ? 'Скрыть пароли' : 'Показать пароли';
    event.currentTarget.setAttribute('aria-pressed', String(show));
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (submit.disabled) return; error.textContent = '';
    if (form.elements.password.value !== form.elements.confirmPassword.value) { error.textContent = 'Пароли не совпадают. Проверьте оба поля.'; return; }
    submit.disabled = true;
    try {
      const response = await fetch('/setup-owner', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', 'X-Pokadrovo-Setup-Token': token }, body: JSON.stringify(Object.fromEntries(new FormData(form))), signal: AbortSignal.timeout(20000) });
      const result = await response.json(); if (!response.ok) throw Error(result.error || 'Не удалось создать администратора.');
      token = ''; form.reset(); form.hidden = true;
      const next = new URL(result.nextUrl); if (!['http:', 'https:'].includes(next.protocol)) throw Error('Некорректный адрес приложения.');
      document.getElementById('continue').href = next.href; document.getElementById('success').hidden = false;
    } catch (e) { error.textContent = e.name === 'TimeoutError' ? 'Сервер не ответил. Проверьте окно запуска перед повторной попыткой.' : e.message; submit.disabled = false; }
  });
})();
