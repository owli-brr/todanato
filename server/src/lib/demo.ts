import { HttpError } from './http';

// DEMO_MODE=true is for the public portfolio deployment. It keeps visitors from
// locking each other out of the shared sample accounts (all on @toms.ph).
// It is on by default on Vercel (VERCEL=1); set DEMO_MODE=false there to turn it off.
export const DEMO_MODE = process.env.DEMO_MODE === 'true' || (!!process.env.VERCEL && process.env.DEMO_MODE !== 'false');

export const isDemoAccount = (email: string) => DEMO_MODE && email.toLowerCase().endsWith('@toms.ph');

export function guardDemoAccount(email: string, what: string) {
  if (isDemoAccount(email)) throw new HttpError(403, `This is a shared demo account, so you can't ${what}. Create your own user to try it.`);
}

export function guardDemo(what: string) {
  if (DEMO_MODE) throw new HttpError(403, `${what} is turned off in the public demo.`);
}
