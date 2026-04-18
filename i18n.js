const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const { app } = require('electron');
const path = require('path');

async function initI18n() {
  await i18next
    .use(Backend)
    .init({
      fallbackLng: 'zh',
      lng: 'zh',
      debug: false,
      backend: {
        loadPath: path.join(app.getAppPath(), 'locales/{{lng}}.json')
      },
      interpolation: {
        escapeValue: false
      }
    });
  
  return i18next;
}

function changeLanguage(lng) {
  return i18next.changeLanguage(lng);
}

function t(key, options) {
  return i18next.t(key, options);
}

module.exports = {
  initI18n,
  changeLanguage,
  t
};