/**
 * Direct port of apps-script/src/RealtimeListenServices.gs's RealtimeListenApi —
 * mints a Firebase custom token scoped with a numberIds claim listing exactly the
 * numbers the signed-in user has access to, handed to the browser so it can open a
 * direct, security-rules-scoped connection to Realtime Database for live message
 * streaming. The browser never gets admin access, only ever a token scoped to
 * exactly what the signed-in user is allowed to see — same security model as the
 * source, just minted via mintCustomToken() (src/lib/firebaseAdmin.ts) instead of
 * FirebaseConfig_.mintCustomToken_().
 */
import { ApiError } from '../types';
import { mintCustomToken } from '../lib/firebaseAdmin';
import { AppDb } from '../lib/appDb';
import { Phase5Api } from './phase5Api';

export interface RealtimeListenToken {
  token: string;
  databaseUrl: string;
  webApiKey: string;
}

export class RealtimeListenApi {
  private phase5: Phase5Api;

  constructor(private db: AppDb, private identityEmail: string, private env: { FIREBASE_WEB_API_KEY: string }) {
    this.phase5 = new Phase5Api(db, identityEmail);
  }

  async getRealtimeListenToken(): Promise<RealtimeListenToken> {
    const actor = await this.phase5.access.currentUser();
    const numbers = await this.phase5.listMyNumbers();
    const numberIds: Record<string, boolean> = {};
    numbers.forEach((n) => { numberIds[n.id] = true; });

    if (!this.env.FIREBASE_WEB_API_KEY) throw new ApiError(500, 'CONFIGURATION_ERROR', 'FIREBASE_WEB_API_KEY is not configured.');
    const token = await mintCustomToken(this.db.serviceAccount, actor.id, { numberIds });
    return { token, databaseUrl: this.db.databaseUrl, webApiKey: this.env.FIREBASE_WEB_API_KEY };
  }
}
