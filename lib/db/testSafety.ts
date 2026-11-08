/** Validate before creating any database client. Never echo credentials on failure. */
export function requireDisposableDatabase(url:string|undefined,expectedName:string):string {
 try {
  if(!url||!expectedName.endsWith('_test')||new URL(url).pathname!==`/${expectedName}`)throw new Error();
  return url;
 }catch{throw new Error('Explicit disposable test database required');}
}
