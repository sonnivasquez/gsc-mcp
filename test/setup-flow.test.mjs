import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseProperty, createSetupState, parseChoiceAnswer, terminalPromptAdapter, validatedChoice } from '../dist/setup/flow.js';

test('non-interactive prompt uses deterministic defaults without terminal input', async () => {
  const prompt = terminalPromptAdapter(true);
  assert.equal(await prompt.choose('scope', ['readonly', 'full'], 0), 0);
  assert.equal(await prompt.choose('client', ['desktop', 'code'], 0), 0);
  assert.equal(await prompt.text('property', 'sc-domain:example.com'), 'sc-domain:example.com');
  prompt.close();
});

test('terminal answers select one-based choices or fall back to the supplied default', () => {
  assert.equal(parseChoiceAnswer(' 2 ', 4, 0), 1);
  assert.equal(parseChoiceAnswer('4', 4, 0), 3);
  for (const answer of ['', 'abc', '1.5', '-1', '0', '5']) {
    assert.equal(parseChoiceAnswer(answer, 4, 2), 2, `answer ${JSON.stringify(answer)}`);
  }
});

test('setup state keeps exact property and explicit choices', () => {
  const property = 'sc-domain:Example.COM';
  assert.equal(chooseProperty(['https://example.com/', property], 1), property);
  assert.deepEqual(createSetupState('readonly', property, 'print'), {
    scope: 'readonly', site: property, client: 'print',
  });
});

test('invalid decisions cannot enter setup state', () => {
  assert.throws(() => validatedChoice(['readonly', 'full'], -1), /Invalid setup choice/);
  assert.throws(() => validatedChoice(['readonly', 'full'], 2), /Invalid setup choice/);
  assert.throws(() => chooseProperty([], 0), /No Search Console properties/);
  assert.throws(() => createSetupState('readonly', '  ', 'print'), /property is required/);
  assert.throws(() => createSetupState('unsafe', 'x', 'print'), /Invalid setup scope/);
});
