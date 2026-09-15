import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema';
import { buildGoogleOAuthConfig } from '../config/google-oauth';
import { getPublicCapabilities } from '../config/public-capabilities';

const databaseState=vi.hoisted(()=>({db:null as any}));
vi.mock('../config/database', () => ({ db: {
    select:(...args:any[])=>databaseState.db.select(...args),
    transaction:(...args:any[])=>databaseState.db.transaction(...args),
} }));
vi.mock('../config/rate-limits.js', async original => ({
    ...await original<typeof import('../config/rate-limits.js')>(), createRateLimiterStore: () => undefined,
}));

const origin='https://simsa.example.test';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const publicJwk={...publicKey.export({format:'jwk'}),kid:'qa-local-google-key',alg:'RS256',use:'sig'};
let base: Awaited<ReturnType<typeof configured>>;
let callbackToken = '';
async function configured() {
    vi.stubEnv('NODE_ENV','production'); vi.stubEnv('APP_PROFILE','internal');
    vi.stubEnv('AUTH_PROVIDER','better-auth'); vi.stubEnv('SIMSA_CLOUD_PLATFORM','local');
    vi.stubEnv('BETTER_AUTH_URL',origin); vi.stubEnv('FRONTEND_URL',origin);
    vi.stubEnv('BETTER_AUTH_SECRET','qa-local-only-auth-secret-minimum-32-characters');
    vi.stubEnv('GOOGLE_CLIENT_ID','qa-local-client'); vi.stubEnv('GOOGLE_CLIENT_SECRET','qa-local-secret');
    vi.stubEnv('GOOGLE_OAUTH_ENABLED','true'); vi.stubEnv('GOOGLE_PENDING_SIGNUP_ENABLED','true');
    vi.resetModules();
    return (await import('../config/auth')).auth;
}
beforeAll(async()=>{
    base=await configured();
    await base.$context;
    vi.stubGlobal('fetch',vi.fn(async(url: string | URL | Request)=>{
        const value=typeof url==='string'?url:url instanceof URL?url.href:url.url;
        if(value==='https://www.googleapis.com/oauth2/v3/certs') return new Response(JSON.stringify({keys:[publicJwk]}),{headers:{'Content-Type':'application/json'}});
        if(value==='https://oauth2.googleapis.com/token') return new Response(JSON.stringify({access_token:'local-access-token',id_token:callbackToken,token_type:'Bearer',expires_in:300}),{headers:{'Content-Type':'application/json'}});
        throw new Error('Unexpected network request blocked by local OAuth test');
    }));
},60_000);
afterEach(()=>vi.clearAllMocks());
afterAll(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.resetModules();});

function fixture(existing?: Record<string,unknown>,enabled=true) {
    const data: Record<string,any[]>={user:existing?[{id:'qa-existing',name:'Existing',email:'existing@example.test',emailVerified:false,createdAt:new Date(),updatedAt:new Date(),isActive:true,...existing}]:[],session:[],account:[],verification:[]};
    const provider=base.options.socialProviders!.google as any;
    const auth=betterAuth({...base.options,database:memoryAdapter(data),rateLimit:{enabled:false},
        socialProviders:{google:enabled?provider:{...provider,disableImplicitSignUp:true,disableSignUp:true}}});
    return {auth,data};
}
function token(email:string,verified=true) {
    const now=Math.floor(Date.now()/1000);
    const header=Buffer.from(JSON.stringify({alg:'RS256',kid:publicJwk.kid,typ:'JWT'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({iss:'https://accounts.google.com',aud:'qa-local-client',sub:`qa-${email}`,email,email_verified:verified,name:'Google name',iat:now,exp:now+300})).toString('base64url');
    return `${header}.${payload}.${sign('RSA-SHA256',Buffer.from(`${header}.${payload}`),privateKey).toString('base64url')}`;
}
async function login(auth:ReturnType<typeof fixture>['auth'],email='new@example.test',verified=true) {
    return auth.handler(new Request(`${origin}/api/auth/sign-in/social`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
        body:JSON.stringify({provider:'google',idToken:{token:token(email,verified)},role:'super_admin',unitKerjaId:'ditjen',isActive:true})}));
}
function cookie(response:Response) { return response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '); }
async function callbackLogin(auth:ReturnType<typeof fixture>['auth'],email:string,verified=true) {
    const start=await auth.handler(new Request(`${origin}/api/auth/sign-in/social`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({provider:'google',callbackURL:`${origin}/dashboard`})}));
    expect(start.status).toBe(200);
    const authorizationURL=new URL((await start.json()).url);
    expect(authorizationURL.origin).toBe('https://accounts.google.com');
    expect(authorizationURL.searchParams.get('code_challenge')).toBeTruthy();
    callbackToken=token(email,verified);
    return auth.handler(new Request(`${origin}/api/auth/callback/google?code=local-code&state=${encodeURIComponent(authorizationURL.searchParams.get('state')!)}`,{headers:{Cookie:cookie(start)}}));
}

it('defaults pending signup off and validates a mistyped flag',()=>{
    expect(buildGoogleOAuthConfig({}).pendingSignupEnabled).toBe(false);
    expect(buildGoogleOAuthConfig({GOOGLE_PENDING_SIGNUP_ENABLED:'tru'}).validationErrors).toContain('GOOGLE_PENDING_SIGNUP_ENABLED must be true or false');
});
it('advertises pending signup only when Google sign-in is configured and the opt-in is valid',()=>{
    const source={APP_PROFILE:'internal',AUTH_PROVIDER:'better-auth',GOOGLE_CLIENT_ID:'qa-client',GOOGLE_CLIENT_SECRET:'qa-secret',GOOGLE_PENDING_SIGNUP_ENABLED:'true'};
    expect(getPublicCapabilities(source).authentication).toMatchObject({googleSignIn:true,pendingGoogleSignup:true});
    expect(getPublicCapabilities({...source,GOOGLE_PENDING_SIGNUP_ENABLED:'false'}).authentication.pendingGoogleSignup).toBe(false);
    expect(getPublicCapabilities({...source,GOOGLE_CLIENT_SECRET:''}).authentication.pendingGoogleSignup).toBe(false);
});
it('creates only a pending identity for a newly verified Google account',async()=>{
    const {auth,data}=fixture();
    const response=await login(auth);
    expect(response.status).toBe(200);
    expect(data.user).toHaveLength(1);
    expect(data.user[0]).toMatchObject({email:'new@example.test',emailVerified:true,role:'user',unitKerjaId:null,isActive:true});
    const session=await auth.handler(new Request(`${origin}/api/auth/get-session`,{headers:{Cookie:cookie(response)}}));
    expect((await session.json()).user).toMatchObject({role:'user',unitKerjaId:null,isActive:true});
});
it('keeps unknown identities denied when signup is disabled',async()=>{
    const {auth,data}=fixture(undefined,false);
    expect((await login(auth)).status).not.toBe(200);
    expect(data.user).toEqual([]);
});
it('rejects an unverified Google identity before persisting a user',async()=>{
    const {auth,data}=fixture();
    const response=await login(auth,'unverified@example.test',false);
    expect(response.status).toBe(403);
    expect(data.user).toEqual([]);
});
it.each([true,false])('preserves a preprovisioned account role and unit with signup flag %s',async enabled=>{
    const {auth,data}=fixture({role:'admin_unit',unitKerjaId:'sesditjen'},enabled);
    const response=await login(auth,'existing@example.test');
    expect(response.status).toBe(200);
    expect(data.user).toHaveLength(1);
    expect(data.user[0]).toMatchObject({id:'qa-existing',role:'admin_unit',unitKerjaId:'sesditjen',isActive:true});
});
it('does not reactivate or issue a session for an inactive preprovisioned account',async()=>{
    const {auth,data}=fixture({role:'admin_unit',unitKerjaId:'ditjen',isActive:false});
    expect((await login(auth,'existing@example.test')).status).not.toBe(200);
    expect(data.user[0].isActive).toBe(false);
    expect(data.session).toEqual([]);
});
it('limits a pending session to session status and logout rather than native profile mutation',async()=>{
    const {auth,data}=fixture({role:'user',unitKerjaId:null,emailVerified:true});
    const signedIn=await login(auth,'existing@example.test');
    expect(signedIn.status).toBe(200);
    const cookies=cookie(signedIn);
    const update=await auth.handler(new Request(`${origin}/api/auth/update-user`,{method:'POST',headers:{Origin:origin,Cookie:cookies,'Content-Type':'application/json'},body:JSON.stringify({name:'Changed while pending'})}));
    expect(update.status).toBe(403);
    expect(data.user[0].name).toBe('Existing');
    const logout=await auth.handler(new Request(`${origin}/api/auth/sign-out`,{method:'POST',headers:{Origin:origin,Cookie:cookies,'Content-Type':'application/json'},body:'{}'}));
    expect(logout.status).toBe(200);
});
it('continues to reject public password signup even while pending Google signup is enabled',async()=>{
    const {auth,data}=fixture();
    const response=await auth.handler(new Request(`${origin}/api/auth/sign-up/email`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'New',email:'new@example.test',password:'Local-test-only-password1!'})}));
    expect(response.status).toBe(400);
    expect(data.user).toEqual([]);
});
it('completes the normal authorization-code redirect callback as a pending identity',async()=>{
    const {auth,data}=fixture();
    const response=await callbackLogin(auth,'callback-new@example.test');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${origin}/dashboard`);
    expect(data.user).toHaveLength(1);
    expect(data.user[0]).toMatchObject({emailVerified:true,role:'user',unitKerjaId:null,isActive:true});
    const session=await auth.handler(new Request(`${origin}/api/auth/get-session`,{headers:{Cookie:cookie(response)}}));
    expect((await session.json()).user.role).toBe('user');
});
it('preserves the existing Google-linked super admin through the redirect callback',async()=>{
    const {auth,data}=fixture({role:'super_admin',unitKerjaId:null,emailVerified:true});
    expect((await login(auth,'existing@example.test')).status).toBe(200);
    expect(data.account).toHaveLength(1);
    const response=await callbackLogin(auth,'existing@example.test');
    expect(response.headers.get('location')).toBe(`${origin}/dashboard`);
    expect(data.user).toHaveLength(1);
    expect(data.account).toHaveLength(1);
    expect(data.user[0]).toMatchObject({id:'qa-existing',role:'super_admin',unitKerjaId:null,isActive:true});
});
it.each(['unverified','disabled'])('does not create a pending identity through an %s callback',async reason=>{
    const {auth,data}=fixture(undefined,reason!=='disabled');
    const response=await callbackLogin(auth,'denied-callback@example.test',reason!=='unverified');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('error=');
    expect(data.user).toEqual([]);
    expect(data.session).toEqual([]);
});
it.each(['/list-accounts','/list-sessions'])('denies pending native account administration at %s',async path=>{
    const {auth}=fixture({role:'user',unitKerjaId:null,emailVerified:true});
    const signedIn=await login(auth,'existing@example.test');
    const response=await auth.handler(new Request(`${origin}/api/auth${path}`,{headers:{Cookie:cookie(signedIn)}}));
    expect(response.status).toBe(403);
});
it('revokes the old native cookie in the real approval transaction and requires a fresh login',async()=>{
    const database=new PGlite();
    try {
        const db=drizzle(database,{schema});databaseState.db=db;
        for(const table of [schema.users,schema.sessions,schema.accounts,schema.verifications,schema.unitKerja,schema.suratKeluar,schema.auditLog]) {
            const config=getTableConfig(table);
            const columns=config.columns.map(column=>`"${column.name}" ${column.getSQLType()}${column.name==='id'?` PRIMARY KEY${column.getSQLType()==='uuid'?' DEFAULT gen_random_uuid()':''}`:['created_at','updated_at'].includes(column.name)?' DEFAULT now()':''}`).join(',');
            await database.exec(`CREATE TABLE "${config.name}" (${columns})`);
        }
        const auth=betterAuth({...base.options,database:drizzleAdapter(db,{provider:'pg',usePlural:true,schema}),rateLimit:{enabled:false}});
        const signedIn=await login(auth,'approval-pending@example.test');
        expect(signedIn.status).toBe(200);
        const oldCookies=cookie(signedIn);
        const readOldSession=()=>auth.handler(new Request(`${origin}/api/auth/get-session`,{headers:{Cookie:oldCookies}}));
        const original=await (await readOldSession()).json();
        expect(original.user.role).toBe('user');
        const [administrator]=await db.insert(schema.users).values({email:'approver@example.test',name:'Approver',role:'super_admin',unitKerjaId:null,isActive:true}).returning();
        await db.insert(schema.unitKerja).values({id:'ditjen',name:'Ditjen',code:'DITJEN'});
        const {userManagementService}=await import('../services/user-management.service');
        const approved=await userManagementService.updateUser(original.user.id,{role:'admin_unit',unitKerjaId:'ditjen'},{userId:administrator.id,userEmail:administrator.email});
        expect(approved).toMatchObject({role:'admin_unit',unitKerjaId:'ditjen',isActive:true});
        expect(await (await readOldSession()).json()).toBeNull();
        const audited=(await database.query('SELECT changes FROM audit_log')).rows;
        expect(audited).toHaveLength(1);
        expect(audited[0].changes).toMatchObject({before:{role:'user',unitKerjaId:null},after:{role:'admin_unit',unitKerjaId:'ditjen'}});
        const freshLogin=await login(auth,'approval-pending@example.test');
        expect(freshLogin.status).toBe(200);
        const freshSession=await auth.handler(new Request(`${origin}/api/auth/get-session`,{headers:{Cookie:cookie(freshLogin)}}));
        expect((await freshSession.json()).user).toMatchObject({role:'admin_unit',unitKerjaId:'ditjen'});
    } finally {databaseState.db=null;await database.close();}
},60_000);
