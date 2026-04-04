import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PairingIds } from '@busch-jaeger/free-at-home';
import { RuleParser } from './ruleParser';

// ---------------------------------------------------------------------------
// parsePairingId
// ---------------------------------------------------------------------------

test('parsePairingId: numeric string → number', () => {
  assert.equal(RuleParser.parsePairingId('1'), 1);
  assert.equal(RuleParser.parsePairingId('256'), 256);
  assert.equal(RuleParser.parsePairingId('0'), 0);
});

test('parsePairingId: enum name → corresponding number', () => {
  assert.equal(
    RuleParser.parsePairingId('AL_SWITCH_ON_OFF'),
    PairingIds.AL_SWITCH_ON_OFF
  );
});

test('parsePairingId: unknown string → NaN', () => {
  assert.ok(isNaN(RuleParser.parsePairingId('NOT_A_REAL_ID')));
});

test('parsePairingId: empty string → NaN', () => {
  assert.ok(isNaN(RuleParser.parsePairingId('')));
});

// ---------------------------------------------------------------------------
// buildRulesMap
// ---------------------------------------------------------------------------

test('buildRulesMap: empty config → empty map', () => {
  assert.equal(RuleParser.buildRulesMap({}).size, 0);
});

test('buildRulesMap: default-only config → empty map', () => {
  assert.equal(
    RuleParser.buildRulesMap({
      default: { items: { sysApUrl: 'http://localhost', username: 'u', password: 'p' } },
    }).size,
    0
  );
});

test('buildRulesMap: one valid rule → one map entry with one rule', () => {
  const map = RuleParser.buildRulesMap({
    default: { items: {} },
    'uuid-1': {
      items: { deviceSerial: 'ABB700A', webhookUrl: 'https://hook.io/a' },
      deletable: true,
    },
  });
  assert.equal(map.size, 1);
  assert.equal(map.get('ABB700A')?.length, 1);
  assert.equal(map.get('ABB700A')![0].url, 'https://hook.io/a');
});

test('buildRulesMap: rule with missing serial → skipped', () => {
  assert.equal(
    RuleParser.buildRulesMap({
      'uuid-1': { items: { deviceSerial: '', webhookUrl: 'https://hook.io/a' }, deletable: true },
    }).size,
    0
  );
});

test('buildRulesMap: rule with whitespace-only serial → skipped', () => {
  assert.equal(
    RuleParser.buildRulesMap({
      'uuid-1': { items: { deviceSerial: '   ', webhookUrl: 'https://hook.io/a' }, deletable: true },
    }).size,
    0
  );
});

test('buildRulesMap: rule with missing url → skipped', () => {
  assert.equal(
    RuleParser.buildRulesMap({
      'uuid-1': { items: { deviceSerial: 'ABB700A', webhookUrl: '' }, deletable: true },
    }).size,
    0
  );
});

test('buildRulesMap: two rules for same serial → one entry, two rules', () => {
  const map = RuleParser.buildRulesMap({
    'uuid-1': { items: { deviceSerial: 'ABB700A', webhookUrl: 'https://hook.io/a' }, deletable: true },
    'uuid-2': { items: { deviceSerial: 'ABB700A', webhookUrl: 'https://hook.io/b' }, deletable: true },
  });
  assert.equal(map.size, 1);
  assert.equal(map.get('ABB700A')?.length, 2);
});

test('buildRulesMap: two rules for different serials → two entries', () => {
  const map = RuleParser.buildRulesMap({
    'uuid-1': { items: { deviceSerial: 'ABB700A', webhookUrl: 'https://hook.io/a' }, deletable: true },
    'uuid-2': { items: { deviceSerial: 'ABB700B', webhookUrl: 'https://hook.io/b' }, deletable: true },
  });
  assert.equal(map.size, 2);
});

test('buildRulesMap: auth header populated when both name and value given', () => {
  const rule = RuleParser.buildRulesMap({
    'uuid-1': {
      items: {
        deviceSerial: 'ABB700A',
        webhookUrl: 'https://hook.io/a',
        authHeaderName: 'Authorization',
        authHeaderValue: 'Bearer mytoken',
      },
      deletable: true,
    },
  }).get('ABB700A')![0];

  assert.equal(rule.extraHeaders['Authorization'], 'Bearer mytoken');
});

test('buildRulesMap: auth header skipped when only name given', () => {
  const rule = RuleParser.buildRulesMap({
    'uuid-1': {
      items: {
        deviceSerial: 'ABB700A',
        webhookUrl: 'https://hook.io/a',
        authHeaderName: 'Authorization',
      },
      deletable: true,
    },
  }).get('ABB700A')![0];

  assert.equal(Object.keys(rule.extraHeaders).length, 0);
});

test('buildRulesMap: auth header skipped when only value given', () => {
  const rule = RuleParser.buildRulesMap({
    'uuid-1': {
      items: {
        deviceSerial: 'ABB700A',
        webhookUrl: 'https://hook.io/a',
        authHeaderValue: 'Bearer mytoken',
      },
      deletable: true,
    },
  }).get('ABB700A')![0];

  assert.equal(Object.keys(rule.extraHeaders).length, 0);
});

test('buildRulesMap: datapointFilter with numeric ids', () => {
  const rule = RuleParser.buildRulesMap({
    'uuid-1': {
      items: {
        deviceSerial: 'ABB700A',
        webhookUrl: 'https://hook.io/a',
        datapointFilter: '1,256',
      },
      deletable: true,
    },
  }).get('ABB700A')![0];

  assert.ok(rule.datapointFilter.has(1));
  assert.ok(rule.datapointFilter.has(256));
  assert.equal(rule.datapointFilter.size, 2);
});

test('buildRulesMap: datapointFilter with enum name', () => {
  const rule = RuleParser.buildRulesMap({
    'uuid-1': {
      items: {
        deviceSerial: 'ABB700A',
        webhookUrl: 'https://hook.io/a',
        datapointFilter: 'AL_SWITCH_ON_OFF',
      },
      deletable: true,
    },
  }).get('ABB700A')![0];

  assert.ok(rule.datapointFilter.has(PairingIds.AL_SWITCH_ON_OFF));
  assert.equal(rule.datapointFilter.size, 1);
});

test('buildRulesMap: datapointFilter ignores invalid entries', () => {
  const rule = RuleParser.buildRulesMap({
    'uuid-1': {
      items: {
        deviceSerial: 'ABB700A',
        webhookUrl: 'https://hook.io/a',
        datapointFilter: '1,NOT_VALID,256',
      },
      deletable: true,
    },
  }).get('ABB700A')![0];

  assert.equal(rule.datapointFilter.size, 2);
  assert.ok(rule.datapointFilter.has(1));
  assert.ok(rule.datapointFilter.has(256));
});

test('buildRulesMap: empty datapointFilter → empty set (all pass)', () => {
  const rule = RuleParser.buildRulesMap({
    'uuid-1': {
      items: { deviceSerial: 'ABB700A', webhookUrl: 'https://hook.io/a', datapointFilter: '' },
      deletable: true,
    },
  }).get('ABB700A')![0];

  assert.equal(rule.datapointFilter.size, 0);
});

test('buildRulesMap: serials and urls are trimmed', () => {
  const map = RuleParser.buildRulesMap({
    'uuid-1': {
      items: { deviceSerial: '  ABB700A  ', webhookUrl: '  https://hook.io/a  ' },
      deletable: true,
    },
  });
  assert.ok(map.has('ABB700A'));
  assert.equal(map.get('ABB700A')![0].url, 'https://hook.io/a');
});
