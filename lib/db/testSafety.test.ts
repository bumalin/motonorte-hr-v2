import test from 'node:test';
import assert from 'node:assert/strict';
import {requireDisposableDatabase} from './testSafety.ts';
test('database test guard rejects live, wrong and missing database URLs before connection',()=>{
 for(const url of [undefined,'postgres://test:test@localhost/live','postgres://test:test@localhost/motonorte_e2e_test'])
  assert.throws(()=>requireDisposableDatabase(url,'motonorte_integrity_test'),/disposable/i);
 assert.equal(requireDisposableDatabase('postgres://test:test@localhost/motonorte_integrity_test','motonorte_integrity_test'),'postgres://test:test@localhost/motonorte_integrity_test');
 assert.throws(()=>requireDisposableDatabase('postgres://test:test@localhost/live','live'),/disposable/i);
});
