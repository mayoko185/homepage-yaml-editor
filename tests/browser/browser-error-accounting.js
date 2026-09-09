function watchConsoleErrors(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push({
        type: 'console',
        text: message.text(),
        url: message.location().url
      });
    }
  });
  page.on('pageerror', (error) => errors.push({ type: 'pageerror', text: error.message, url: page.url() }));
  return errors;
}

function registerExpectedError(expectedErrors, predicate, description) {
  expectedErrors.push({ predicate, description });
}

function accountBrowserErrors(errors, expectedErrors) {
  const matchedIndexes = new Set();
  const missingExpected = [];

  for (const expected of expectedErrors) {
    const index = errors.findIndex((entry, entryIndex) => (
      !matchedIndexes.has(entryIndex) && expected.predicate(entry)
    ));
    if (index === -1) {
      missingExpected.push(expected.description);
    } else {
      matchedIndexes.add(index);
    }
  }

  return {
    missingExpected,
    unexpected: errors.filter((_, index) => !matchedIndexes.has(index))
  };
}

module.exports = {
  accountBrowserErrors,
  registerExpectedError,
  watchConsoleErrors
};
