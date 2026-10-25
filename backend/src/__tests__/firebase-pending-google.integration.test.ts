import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { users, auditLog } from '../db/schema';

const state=vi.hoisted(()=>({db:null as any,decoded:{} as any,identity:null as any}));
vi.mock('../config/database',()=>({db:{
    select:(...args:any[])=>state.db.select(...args),
    transaction:(...args:any[])=>state.db.transaction(...args),
    insert:(...args:any[])=>state.db.insert(...args),
}}));
vi.mock('../config/firebase-admin.js',()=>({getFirebaseAdminAuth:()=>({revokeRefreshTokens:vi.fn()})}));
vi.mock('../config/trusted-origins.js',()=>({isTrustedOrigin:(value:string)=>value==='https://trusted.example'}));
vi.mock('../middlewares/firebase-app-check.middleware.js',()=>({
    firebaseAppCheckMiddleware:(_req:any,_res:any,next:any)=>next(),
    firebaseReplayProtectedAppCheckMiddleware:(_req:any,_res:any,next:any)=>next(),
}));
vi.mock('../services/firebase-session.service.js',()=>({
    createFirebaseSession:async()=>({decoded:state.decoded,sessionCookie:'local-cookie',csrfToken:'local-csrf',expiresInMs:3600000}),
    verifyFirebaseSessionCsrfToken:()=>true,
    createFirebaseSessionCsrfToken:()=> 'local-csrf',
}));
vi.mock('../services/request-identity.service.js',()=>({verifyRequestIdentity:async()=>state.identity,hasBearerCredential:()=>false}));
vi.mock('../utils/logger',()=>({createLogger:()=>({error:vi.fn(),warn:vi.fn(),info:vi.fn()})}));
import router from '../routes/firebase-auth.routes';
import { authMiddleware } from '../middlewares/auth.middleware';
const app=express(); app.use(cookieParser()); app.use('/auth',router);
app.get('/protected',authMiddleware,(_req,res)=>res.json({businessData:'protected'}));
let database:PGlite;
beforeAll(async()=>{
    database=new PGlite(); state.db=drizzle(database);
    for(const table of [users,auditLog]) {
        const config=getTableConfig(table);
        const columns=config.columns.map(c=>`"${c.name}" ${c.getSQLType()}${c.name==='id'?' PRIMARY KEY DEFAULT gen_random_uuid()':c.name==='created_at'?' DEFAULT now()':''}`).join(',');
        await database.exec(`CREATE TABLE "${config.name}" (${columns})`);
    }
    await database.exec('CREATE UNIQUE INDEX user_email_test ON users(email); CREATE UNIQUE INDEX user_firebase_test ON users(firebase_uid);');
},60_000);
beforeEach(async()=>{
    vi.stubEnv('AUTH_PROVIDER','firebase');vi.stubEnv('FIREBASE_PROJECT_ID','local-test-project');
    vi.stubEnv('GOOGLE_PENDING_SIGNUP_ENABLED','true');vi.stubEnv('NODE_ENV','test');
    await database.exec('DELETE FROM audit_log; DELETE FROM users;');
    state.decoded={uid:'google-new',email:'new@example.test',email_verified:true,name:'New Google',firebase:{sign_in_provider:'google.com'}};
    state.identity=null;
});
afterAll(async()=>{await database?.close();vi.unstubAllEnvs();});
async function exchange(){return request(app).post('/auth/session').set('Origin','https://trusted.example').send({idToken:'x'.repeat(100)});}
async function seed(extra:Record<string,unknown>={}) {
    return (await state.db.insert(users).values({email:'existing@example.test',name:'Existing',role:'admin_unit',unitKerjaId:'ditjen',isActive:true,emailVerified:true,firebaseUid:'google-new',identityProvider:'firebase',createdAt:new Date(),updatedAt:new Date(),...extra}).returning())[0];
}
it('creates one identity-only pending user and retains it across repeat verified Google logins',async()=>{
    const response=await exchange();expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({email:'new@example.test',role:'user',unitKerjaId:null,isActive:true});
    expect((await exchange()).status).toBe(200);
    const saved=(await database.query('SELECT role,unit_kerja_id,is_active,firebase_uid FROM users')).rows;
    expect(saved).toEqual([{role:'user',unit_kerja_id:null,is_active:true,firebase_uid:'google-new'}]);
    expect((await database.query('SELECT * FROM audit_log')).rows).toHaveLength(1);
});
it.each([['unverified',false,'google.com'],['password',true,'password'],['custom',true,'custom']])('does not register an unknown %s identity',async(_name,verified,provider)=>{
    state.decoded.email_verified=verified;state.decoded.firebase.sign_in_provider=provider;
    expect((await exchange()).status).toBe(403);
    expect((await database.query('SELECT * FROM users')).rows).toEqual([]);
});
it('keeps new account creation disabled when the opt-in flag is absent',async()=>{
    vi.stubEnv('GOOGLE_PENDING_SIGNUP_ENABLED','');
    expect((await exchange()).status).toBe(403);
    expect((await database.query('SELECT * FROM users')).rows).toEqual([]);
});
it('preserves a preprovisioned UID and role even with pending signup disabled',async()=>{
    const user=await seed();state.decoded.email=user.email;vi.stubEnv('GOOGLE_PENDING_SIGNUP_ENABLED','false');
    expect((await exchange()).body.user).toMatchObject({id:user.id,role:'admin_unit',unitKerjaId:'ditjen'});
    expect((await database.query('SELECT * FROM users')).rows).toHaveLength(1);
});
it('never rebinds an email belonging to another Firebase UID',async()=>{
    await seed({email:'new@example.test',firebaseUid:'existing-other-uid'});
    expect((await exchange()).status).toBe(403);
    expect((await database.query('SELECT firebase_uid FROM users')).rows[0]).toEqual({firebase_uid:'existing-other-uid'});
});
it('does not recreate or reactivate an inactive identity',async()=>{
    const user=await seed({isActive:false});state.decoded.email=user.email;
    expect((await exchange()).status).toBe(403);
    expect((await database.query('SELECT is_active FROM users')).rows).toEqual([{is_active:false}]);
});
it('returns minimal session identity for an existing pending account without granting archive access',async()=>{
    const user=await seed({role:'user',unitKerjaId:null});
    state.identity={provider:'firebase',subject:user.firebaseUid,email:user.email,emailVerified:true,tokenKind:'firebase-session-cookie'};
    const response=await request(app).get('/auth/get-session').set('Cookie','__session=local-cookie');
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({id:user.id,role:'user',unitKerjaId:null,isActive:true});
    expect(response.body.user).not.toHaveProperty('firebaseUid');
    expect((await request(app).get('/protected').set('Cookie','__session=local-cookie')).status).toBe(403);
});
it('does not duplicate an identity or audit event during concurrent first login',async()=>{
    const responses=await Promise.all([exchange(),exchange()]);
    expect(responses.map(response=>response.status)).toEqual([200,200]);
    expect((await database.query('SELECT * FROM users')).rows).toHaveLength(1);
    expect((await database.query('SELECT * FROM audit_log')).rows).toHaveLength(1);
});
it('rolls back the pending identity if its critical audit cannot be persisted',async()=>{
    await database.exec(`CREATE FUNCTION reject_pending_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'local test audit unavailable'; END $$;
        CREATE TRIGGER reject_pending_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_pending_audit();`);
    try {
        expect((await exchange()).status).toBe(403);
        expect((await database.query('SELECT * FROM users')).rows).toEqual([]);
    } finally {
        await database.exec('DROP TRIGGER reject_pending_audit ON audit_log; DROP FUNCTION reject_pending_audit();');
    }
    expect((await exchange()).status).toBe(200);
});
it('does not rebind a legacy mixed-case email or an unmapped local identity',async()=>{
    await seed({email:'New@Example.Test',firebaseUid:null,identityProvider:'better-auth'});
    expect((await exchange()).status).toBe(403);
    expect((await database.query('SELECT firebase_uid, role FROM users')).rows).toEqual([{firebase_uid:null,role:'admin_unit'}]);
});
it('retains identity-only login for an existing pending account after signup is disabled',async()=>{
    const user=await seed({role:'user',unitKerjaId:null});state.decoded.email=user.email;
    vi.stubEnv('GOOGLE_PENDING_SIGNUP_ENABLED','false');
    expect((await exchange()).body.user).toMatchObject({id:user.id,role:'user',unitKerjaId:null,isActive:true});
});
