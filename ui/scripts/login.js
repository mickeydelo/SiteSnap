const params = new URLSearchParams(window.location.search);
document.getElementById('login-next').value = params.get('next') || '/';
document.getElementById('login-error').hidden = params.get('error') !== '1';

const password = document.getElementById('password');
const reveal = document.getElementById('password-reveal');
const form = document.querySelector('.login__form');
const submit = form.querySelector('[type="submit"]');
reveal.hidden = false;
reveal.addEventListener('click', () => {
  const visible = password.type === 'password';
  password.type = visible ? 'text' : 'password';
  reveal.textContent = visible ? 'Hide' : 'Show';
  reveal.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  reveal.setAttribute('aria-pressed', String(visible));
});

form.addEventListener('submit', () => {
  submit.disabled = true;
  form.setAttribute('aria-busy', 'true');
  document.getElementById('login-submit-label').textContent = 'Signing in…';
});

window.addEventListener('pageshow', () => {
  submit.disabled = false;
  form.setAttribute('aria-busy', 'false');
  document.getElementById('login-submit-label').textContent = 'Sign in';
});
