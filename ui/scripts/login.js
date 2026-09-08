const params = new URLSearchParams(window.location.search);
document.getElementById('login-next').value = params.get('next') || '/';
document.getElementById('login-error').hidden = params.get('error') !== '1';
