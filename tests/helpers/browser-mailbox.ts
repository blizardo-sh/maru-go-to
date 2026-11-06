import type { AccessMail } from '../../src/server/mail';
export async function fixtureMail(email:string,kind:AccessMail['kind']='verify'):Promise<AccessMail> {
  const base=process.env.AUTH_MAILBOX_URL;
  if(!base||new URL(base).hostname!=='127.0.0.1'||!email.endsWith('@example.test'))throw new Error('Local fixture mailbox required.');
  const url=new URL(base);url.searchParams.set('email',email);url.searchParams.set('kind',kind);
  const message=await (await fetch(url)).json();
  if(!message)throw new Error('Fixture message was not delivered.');
  return message;
}
export async function confirmFixtureEmail(email:string,api:string,origin:string,ip:string) {
  const message=await fixtureMail(email);
  const token=new URLSearchParams(new URL(message.url).hash.slice(1)).get('token');
  const response=await fetch(api+'/api/email-verification/complete',{method:'POST',headers:{origin,'x-forwarded-for':ip,'content-type':'application/json'},body:JSON.stringify({token})});
  if(!response.ok)throw new Error('Fixture email confirmation failed.');
}
