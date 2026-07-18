const errorCode = new URLSearchParams(window.location.search).get('error');
const errorElement = document.getElementById('login-error');
const warningElement = document.getElementById('connection-warning');

if (window.APP_CONFIG && window.APP_CONFIG.loginRequired && window.location.protocol !== 'https:') {
    warningElement.hidden = false;
}
if (errorCode === 'invalid') {
    errorElement.textContent = 'Invalid username or password.';
    errorElement.hidden = false;
} else if (errorCode === 'locked') {
    errorElement.textContent = 'Too many sign-in attempts. Try again later.';
    errorElement.hidden = false;
}
